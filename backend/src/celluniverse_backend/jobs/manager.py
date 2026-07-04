from __future__ import annotations

import os
import queue
import re
import shutil
import signal
import subprocess
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml

from celluniverse_backend.config.exposed import ExposedParameterRegistry
from celluniverse_backend.config.merge import materialize_effective_config
from celluniverse_backend.config.models import BackendConfig
from celluniverse_backend.contracts.models import CreateJobRequest, JobState, JobStatus, JobType
from celluniverse_backend.datasets.service import DatasetService
from celluniverse_backend.jobs.output_scan import scan_output
from celluniverse_backend.preview.manifest import build_preview_artifacts
from celluniverse_backend.runners.celluniverse import build_tracking_argv, start_celluniverse_process
from celluniverse_backend.security.paths import ensure_inside_roots, validate_input_reference
from celluniverse_backend.storage.json_store import append_ndjson, read_json, write_json_atomic


FRAME_HINT_RE = re.compile(r"(?:frame|Frame)\D+(\d+)")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class JobManager:
    def __init__(self, config: BackendConfig, exposed_registry: ExposedParameterRegistry):
        self.config = config
        self.exposed_registry = exposed_registry
        self.dataset_service = DatasetService(config)
        self.jobs_root = config.runtime.runtimeRoot / "jobs"
        self.jobs_root.mkdir(parents=True, exist_ok=True)
        self._queue: queue.Queue[str] = queue.Queue()
        self._processes: dict[str, subprocess.Popen[Any]] = {}
        self._active_jobs: set[str] = set()
        self._job_threads: dict[str, threading.Thread] = {}
        self._status_lock = threading.RLock()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        self._recover_interrupted_jobs()
        if self._thread and self._thread.is_alive():
            return
        self._thread = threading.Thread(target=self._worker_loop, name="celluniverse-job-manager", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    def create_job(self, request: CreateJobRequest) -> JobStatus:
        if request.lastFrame < request.firstFrame:
            raise ValueError("lastFrame must be >= firstFrame")
        frame_count = request.lastFrame - request.firstFrame + 1
        if frame_count > self.config.limits.maxFrameCount:
            raise ValueError(f"frame count exceeds limit: {frame_count}")
        requested_resume = self._resolve_requested_resume(request)

        job_id = f"job_{uuid.uuid4().hex[:12]}"
        label = request.label or f"{request.type.value} {request.firstFrame}-{request.lastFrame}"
        job_dir = self.job_dir(job_id, create=True)
        (job_dir / "output").mkdir(parents=True, exist_ok=True)
        (job_dir / "input").mkdir(parents=True, exist_ok=True)
        write_json_atomic(job_dir / "request.json", request.model_dump(mode="json"))

        self._materialize_inputs(job_id, request)
        status = JobStatus(
            id=job_id,
            label=label,
            type=request.type,
            state=JobState.prepared,
            createdAt=utc_now(),
            firstFrame=request.firstFrame,
            lastFrame=request.lastFrame,
            currentFrame=request.firstFrame,
            totalFrames=frame_count,
            resumeAvailable=False,
            resumeFromFrame=requested_resume["resumeFromFrame"] if requested_resume else None,
            resumeSourceDir=requested_resume["resumeSourceDir"] if requested_resume else None,
            resumeSourceJobId=requested_resume["resumeSourceJobId"] if requested_resume else None,
        )
        self._write_status(status)
        self._event(job_id, "job.prepared", status.model_dump(mode="json"))
        if request.autoStart:
            return JobStatus.model_validate(self.start_job(job_id))
        return status

    def list_jobs(self, include_archived: bool = False) -> list[dict[str, Any]]:
        statuses = []
        queued = list(self._queue.queue)
        for path in sorted(self.jobs_root.glob("job_*/status.json"), reverse=True):
            data = read_json(path, {})
            if data.get("state") in {
                JobState.running.value,
                JobState.cancelled.value,
                JobState.failed.value,
                JobState.interrupted.value,
            }:
                self._refresh_progress(path.parent.name, rebuild_preview=False)
                data = read_json(path, {})
            if data.get("state") == JobState.archived.value and not include_archived:
                continue
            if data.get("state") == JobState.queued.value and data.get("id") in queued:
                data["queuePosition"] = queued.index(data["id"]) + 1
            statuses.append(data)
        return statuses

    def get_status(self, job_id: str) -> dict[str, Any]:
        try:
            return read_json(self.job_dir(job_id) / "status.json", {})
        except KeyError:
            return {}

    def get_fresh_status(self, job_id: str) -> dict[str, Any]:
        status = self.get_status(job_id)
        if status.get("state") in {
            JobState.running.value,
            JobState.cancelled.value,
            JobState.failed.value,
            JobState.interrupted.value,
        }:
            self._refresh_progress(job_id, rebuild_preview=False)
            status = self.get_status(job_id)
        return status

    def get_request(self, job_id: str) -> dict[str, Any]:
        return read_json(self.job_dir(job_id) / "request.json", {})

    def clone_job(self, job_id: str) -> JobStatus:
        status = self.get_status(job_id)
        if not status:
            raise KeyError(job_id)
        request = CreateJobRequest.model_validate(read_json(self.job_dir(job_id) / "request.json"))
        request.label = f"Revision of {status.get('label') or request.label or job_id}"
        request.autoStart = False
        return self.create_job(request)

    def jobs_for_dataset_upload(self, upload_id: str) -> list[dict[str, Any]]:
        matches = []
        for path in self.jobs_root.glob("job_*/request.json"):
            request = read_json(path, {})
            if request.get("datasetId") != upload_id:
                continue
            job_id = path.parent.name
            status = self.get_status(job_id)
            if status and status.get("state") != JobState.archived.value:
                matches.append(status)
        return matches

    def update_prepared_job(self, job_id: str, request: CreateJobRequest) -> dict[str, Any]:
        status = self.get_status(job_id)
        if not status:
            raise KeyError(job_id)
        if status.get("state") != JobState.prepared.value:
            raise ValueError("only prepared jobs can be edited")
        if request.lastFrame < request.firstFrame:
            raise ValueError("lastFrame must be >= firstFrame")
        frame_count = request.lastFrame - request.firstFrame + 1
        if frame_count > self.config.limits.maxFrameCount:
            raise ValueError(f"frame count exceeds limit: {frame_count}")
        requested_resume = self._resolve_requested_resume(request)

        job_dir = self.job_dir(job_id)
        shutil.rmtree(job_dir / "input", ignore_errors=True)
        (job_dir / "input").mkdir(parents=True, exist_ok=True)
        write_json_atomic(job_dir / "request.json", request.model_dump(mode="json"))
        self._materialize_inputs(job_id, request)

        status.update({
            "label": request.label or f"{request.type.value} {request.firstFrame}-{request.lastFrame}",
            "type": request.type.value,
            "firstFrame": request.firstFrame,
            "lastFrame": request.lastFrame,
            "currentFrame": request.firstFrame,
            "lastCompletedFrame": None,
            "completedFrames": 0,
            "totalFrames": frame_count,
            "progress": 0.0,
            "error": None,
            "partialOutputsAvailable": False,
            "outputReady": {},
            "resumeAvailable": False,
            "resumeFromFrame": requested_resume["resumeFromFrame"] if requested_resume else None,
            "resumeSourceDir": requested_resume["resumeSourceDir"] if requested_resume else None,
            "resumeSourceJobId": requested_resume["resumeSourceJobId"] if requested_resume else None,
        })
        self._write_status_dict(job_id, status)
        self._event(job_id, "job.updated", status)
        return status

    def start_job(self, job_id: str) -> dict[str, Any]:
        status = self.get_status(job_id)
        if not status:
            raise KeyError(job_id)
        if status.get("state") != JobState.prepared.value:
            raise ValueError("only prepared jobs can be started")
        prepared_resume_from = status.get("resumeFromFrame") if isinstance(status.get("resumeFromFrame"), int) else None
        prepared_resume_source = status.get("resumeSourceDir") if prepared_resume_from is not None else None
        prepared_resume_source_job = status.get("resumeSourceJobId") if prepared_resume_from is not None else None
        status.update({
            "state": JobState.queued.value,
            "startedAt": None,
            "finishedAt": None,
            "pid": None,
            "exitCode": None,
            "error": None,
            "currentFrame": prepared_resume_from if prepared_resume_from is not None else status.get("firstFrame"),
            "resumeAvailable": False,
            "resumeFromFrame": prepared_resume_from,
            "resumeSourceDir": prepared_resume_source,
            "resumeSourceJobId": prepared_resume_source_job,
        })
        self._write_status_dict(job_id, status)
        self._event(job_id, "job.queued", status)
        self._queue.put(job_id)
        return status


    def resume_job(self, job_id: str) -> dict[str, Any]:
        self._refresh_progress(job_id, rebuild_preview=False)
        status = self.get_status(job_id)
        if not status:
            raise KeyError(job_id)
        if status.get("state") not in {JobState.cancelled.value, JobState.failed.value, JobState.interrupted.value}:
            raise ValueError("only cancelled, failed, or interrupted jobs can be resumed")
        if not status.get("resumeAvailable"):
            raise ValueError("job has no resumable checkpoint")
        resume_from = status.get("resumeFromFrame")
        if not isinstance(resume_from, int):
            raise ValueError("job has no valid resume frame")

        self._write_resume_config(job_id, resume_from)
        status.update({
            "state": JobState.queued.value,
            "startedAt": None,
            "finishedAt": None,
            "pid": None,
            "exitCode": None,
            "error": None,
            "currentFrame": resume_from,
            "resumeAvailable": False,
            "resumeFromFrame": resume_from,
            "resumeSourceDir": str(self.job_dir(job_id) / "output"),
        })
        self._write_status_dict(job_id, status)
        self._event(job_id, "job.resume_queued", status)
        self._queue.put(job_id)
        return status

    def archive_job(self, job_id: str) -> dict[str, Any]:
        status = self.get_status(job_id)
        if not status:
            raise KeyError(job_id)
        if status.get("state") in {JobState.running.value, JobState.queued.value}:
            raise ValueError("running or queued jobs must be terminated before archive")
        status["archivedFromState"] = status.get("state")
        status["state"] = JobState.archived.value
        status["archivedAt"] = utc_now()
        self._write_status_dict(job_id, status)
        self._event(job_id, "job.archived", {"jobId": job_id})
        return status

    def unarchive_job(self, job_id: str) -> dict[str, Any]:
        status = self.get_status(job_id)
        if not status:
            raise KeyError(job_id)
        if status.get("state") != JobState.archived.value:
            raise ValueError("only archived jobs can be restored")
        restored_state = self._unarchive_state(status)
        status["state"] = restored_state
        status["unarchivedAt"] = utc_now()
        status.pop("archivedAt", None)
        self._write_status_dict(job_id, status)
        self._event(job_id, "job.unarchived", status)
        return status

    def purge_archived_job(self, job_id: str) -> dict[str, Any]:
        status = self.get_status(job_id)
        if not status:
            raise KeyError(job_id)
        if status.get("state") != JobState.archived.value:
            raise ValueError("only archived jobs can be permanently deleted")
        job_dir = self.job_dir(job_id)
        with self._status_lock:
            shutil.rmtree(job_dir)
        return {"jobId": job_id, "deleted": True}

    def cancel_job(self, job_id: str) -> dict[str, Any]:
        status = self.get_status(job_id)
        if not status:
            raise KeyError(job_id)
        if status.get("state") == JobState.prepared.value:
            status["state"] = JobState.cancelled.value
            status["finishedAt"] = utc_now()
            status["error"] = "Cancelled by user"
            self._write_status_dict(job_id, status)
            self._event(job_id, "job.cancelled", {"jobId": job_id})
            return status
        if status.get("state") == JobState.queued.value:
            status["state"] = JobState.cancelled.value
            status["finishedAt"] = utc_now()
            status["error"] = "Cancelled by user"
            self._write_status_dict(job_id, status)
            self._event(job_id, "job.cancelled", {"jobId": job_id})
            return status
        process = self._processes.get(job_id)
        if process and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
        elif status.get("state") == JobState.running.value:
            pid = status.get("pid")
            if isinstance(pid, int):
                self._terminate_process_group(pid)
        status["state"] = JobState.cancelled.value
        status["finishedAt"] = utc_now()
        status["error"] = "Cancelled by user"
        status["partialOutputsAvailable"] = True
        self._write_status_dict(job_id, status)
        self._event(job_id, "job.cancelled", {"jobId": job_id})
        return status

    def job_dir(self, job_id: str, create: bool = False) -> Path:
        if "/" in job_id or "\\" in job_id or not job_id.startswith("job_"):
            raise KeyError(job_id)
        path = self.jobs_root / job_id
        if create:
            path.mkdir(parents=True, exist_ok=True)
            return path
        if not path.exists() or not path.is_dir():
            raise KeyError(job_id)
        return path

    def _worker_loop(self) -> None:
        while not self._stop.is_set():
            if self._active_job_count() >= self.config.runtime.maxConcurrentJobs:
                time.sleep(1)
                continue
            try:
                job_id = self._queue.get(timeout=1)
            except queue.Empty:
                continue
            status = self.get_status(job_id)
            if status.get("state") != JobState.queued.value:
                continue
            with self._status_lock:
                if job_id in self._active_jobs:
                    continue
                self._active_jobs.add(job_id)
                thread = threading.Thread(
                    target=self._run_job_safely,
                    args=(job_id,),
                    name=f"celluniverse-job-{job_id}",
                    daemon=True,
                )
                self._job_threads[job_id] = thread
            thread.start()

    def _active_job_count(self) -> int:
        with self._status_lock:
            return len(self._active_jobs)

    def _run_job_safely(self, job_id: str) -> None:
        try:
            self._run_job(job_id)
        except Exception as exc:
            process = self._processes.get(job_id)
            if process:
                self._terminate_process(process)
            status = self.get_status(job_id)
            if status and status.get("state") != JobState.cancelled.value:
                status.update({
                    "state": JobState.failed.value,
                    "finishedAt": utc_now(),
                    "error": str(exc),
                })
                self._write_status_dict(job_id, status)
                self._event(job_id, "job.failed", {"jobId": job_id, "error": str(exc)})
        finally:
            with self._status_lock:
                self._active_jobs.discard(job_id)
                self._processes.pop(job_id, None)
                self._job_threads.pop(job_id, None)

    def _run_job(self, job_id: str) -> None:
        job_dir = self.job_dir(job_id)
        request = CreateJobRequest.model_validate(read_json(job_dir / "request.json"))
        status = self.get_status(job_id)
        if status.get("state") != JobState.queued.value:
            return
        status.update({"state": JobState.running.value, "startedAt": utc_now()})
        self._write_status_dict(job_id, status)
        self._event(job_id, "job.started", {"jobId": job_id})

        argv = read_json(job_dir / "argv.json")
        stdout_path = job_dir / "stdout.log"
        stderr_path = job_dir / "stderr.log"
        resume_from = status.get("resumeFromFrame") if isinstance(status.get("resumeFromFrame"), int) else None
        resume_source_dir = status.get("resumeSourceDir") or str(job_dir / "output")
        if resume_from and stdout_path.exists():
            with stdout_path.open("a", encoding="utf-8") as handle:
                handle.write(f"\n[Web Resume] resume_from={resume_from} resume_source_dir={resume_source_dir}\n")
            stdout_offset = stdout_path.stat().st_size
            stderr_offset = stderr_path.stat().st_size if stderr_path.exists() else 0
        else:
            stdout_path.write_text("", encoding="utf-8")
            stderr_path.write_text("", encoding="utf-8")
            stdout_offset = 0
            stderr_offset = 0

        process = start_celluniverse_process(
            self.config,
            argv,
            stdout_path=stdout_path,
            stderr_path=stderr_path,
        )
        self._processes[job_id] = process
        status = self.get_status(job_id)
        if status.get("state") != JobState.running.value:
            self._terminate_process(process)
            return
        status["pid"] = process.pid
        self._write_status_dict(job_id, status)
        self._event(job_id, "process.started", {"jobId": job_id, "pid": process.pid, "argv": argv})

        stdout_thread = threading.Thread(target=self._tail_log_file, args=(job_id, stdout_path, "stdout", process, stdout_offset), daemon=True)
        stderr_thread = threading.Thread(target=self._tail_log_file, args=(job_id, stderr_path, "stderr", process, stderr_offset), daemon=True)
        stdout_thread.start()
        stderr_thread.start()

        while process.poll() is None:
            self._refresh_progress(job_id)
            time.sleep(1)

        stdout_thread.join(timeout=2)
        stderr_thread.join(timeout=2)
        self._refresh_progress(job_id)
        exit_code = process.returncode
        status = self.get_status(job_id)
        if status.get("state") != JobState.cancelled.value:
            status["exitCode"] = exit_code
            status["finishedAt"] = utc_now()
            status["state"] = JobState.completed.value if exit_code == 0 else JobState.failed.value
            if exit_code != 0:
                status["error"] = f"CellUniverse exited with code {exit_code}"
        self._write_status_dict(job_id, status)
        self._event(job_id, "job.finished", {"jobId": job_id, "state": status["state"], "exitCode": exit_code})
        self._processes.pop(job_id, None)

    def _terminate_process(self, process: subprocess.Popen[Any]) -> None:
        if process.poll() is not None:
            return
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            return
        except OSError:
            process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                return
            except OSError:
                process.kill()
            process.wait(timeout=5)

    def _materialize_inputs(self, job_id: str, request: CreateJobRequest) -> None:
        job_dir = self.job_dir(job_id)
        input_path = self._resolve_job_input(job_dir, request)
        requested_resume = self._resolve_requested_resume(request)
        initial_csv = self._resolve_initial_csv(job_dir, request, requested_resume)
        effective_config = job_dir / "effective-config.yaml"
        module = self.exposed_registry.load_module(request.parameterModuleId)
        base_config = self._resolve_base_config(request, module)
        has_user_config = bool(request.configYamlUploadId or request.configYamlPath)
        materialize_effective_config(
            base_config,
            effective_config,
            module,
            request.overrides,
            config_search_dir=self.config.celluniverse.config_dir,
            use_pipeline_base_config=not has_user_config,
        )

        if requested_resume:
            self._write_resume_config(job_id, requested_resume["resumeFromFrame"], Path(requested_resume["resumeSourceDir"]))

        argv = build_tracking_argv(
            self.config,
            request.firstFrame,
            request.lastFrame,
            input_path,
            job_dir / "output",
            effective_config,
            initial_csv,
        )
        write_json_atomic(job_dir / "argv.json", argv)

    def _resolve_job_input(self, job_dir: Path, request: CreateJobRequest) -> str:
        if request.datasetId:
            return self.dataset_service.materialize_uploaded_dataset(request.datasetId, job_dir / "input")
        if not request.inputPath:
            raise ValueError("inputPath or datasetId is required")
        return validate_input_reference(request.inputPath, self.config.security.allowedInputRoots)

    def _resolve_initial_csv(self, job_dir: Path, request: CreateJobRequest, requested_resume: dict[str, Any] | None = None) -> Path:
        if request.initialCsvUploadId:
            source = self.dataset_service.upload_file_path(request.initialCsvUploadId)
        elif request.initialCsvPath:
            source = ensure_inside_roots(Path(request.initialCsvPath), self.config.security.allowedInitialCsvRoots)
        elif requested_resume:
            source = self.job_dir(requested_resume["resumeSourceJobId"]) / "initial.csv"
            if not source.exists():
                raise ValueError("resume source job is missing its stored initial.csv")
        else:
            raise ValueError("initialCsvPath or initialCsvUploadId is required")
        dest = job_dir / "initial.csv"
        shutil.copy2(source, dest)
        return dest

    def _resolve_base_config(self, request: CreateJobRequest, module: Any) -> Path:
        if request.configYamlUploadId:
            return self.dataset_service.upload_file_path(request.configYamlUploadId)
        if request.configYamlPath:
            return ensure_inside_roots(Path(request.configYamlPath), self.config.security.allowedConfigRoots)
        base = Path(module.baseConfig)
        if base.is_absolute():
            return ensure_inside_roots(base, self.config.security.allowedConfigRoots)
        return self.config.celluniverse.celluniverseCppRoot / base

    def _resolve_requested_resume(self, request: CreateJobRequest) -> dict[str, Any] | None:
        has_source = bool(request.resumeSourceJobId)
        has_frame = request.resumeFromFrame is not None
        if not has_source and not has_frame:
            return None
        if not has_source or not has_frame:
            raise ValueError("resume source job and resume frame must be provided together")
        source_job_id = str(request.resumeSourceJobId or "").strip()
        if not source_job_id:
            raise ValueError("resume source job is required")
        resume_from = int(request.resumeFromFrame)
        if request.firstFrame != resume_from:
            raise ValueError("firstFrame must match resumeFromFrame for a resumed job")
        if request.lastFrame < resume_from:
            raise ValueError("lastFrame must be greater than or equal to resumeFromFrame")

        source_status = self.get_status(source_job_id)
        if not source_status:
            raise ValueError(f"resume source job does not exist: {source_job_id}")
        source_first = int(source_status.get("firstFrame", 0))
        source_last = int(source_status.get("lastFrame", resume_from))
        if resume_from <= source_first:
            raise ValueError("resumeFromFrame must be after the source job's first frame")
        if resume_from > source_last + 1:
            raise ValueError("resumeFromFrame is beyond the source job range")

        source_job_dir = self.job_dir(source_job_id)
        checkpoint_frame = resume_from - 1
        if not self._checkpoint_has_resume_state(source_job_dir, checkpoint_frame, source_last):
            raise ValueError(f"source job has no complete resume checkpoint for frame {checkpoint_frame}")
        return {
            "resumeSourceJobId": source_job_id,
            "resumeFromFrame": resume_from,
            "resumeSourceDir": str(source_job_dir / "output"),
        }

    def _write_resume_config(self, job_id: str, resume_from: int, resume_source_dir: Path | None = None) -> None:
        job_dir = self.job_dir(job_id)
        config_path = job_dir / "effective-config.yaml"
        if not config_path.exists():
            raise ValueError("effective config is missing")
        with config_path.open("r", encoding="utf-8") as handle:
            data = yaml.safe_load(handle) or {}
        if not isinstance(data, dict):
            raise ValueError("effective config YAML must be a mapping")
        simulation = data.setdefault("simulation", {})
        if not isinstance(simulation, dict):
            raise ValueError("effective config simulation block must be a mapping")
        simulation["resume_from"] = resume_from
        simulation["resume_source_dir"] = str(resume_source_dir or (job_dir / "output"))
        with config_path.open("w", encoding="utf-8") as handle:
            yaml.safe_dump(data, handle, sort_keys=False)

    def _apply_resume_fields(self, job_id: str, status: dict[str, Any], scan: dict[str, Any]) -> bool:
        checkpoints = set(scan.get("outputReady", {}).get("checkpointFrames") or [])
        last_completed = scan.get("lastCompletedFrame")
        job_dir = self.job_dir(job_id)
        can_resume = (
            status.get("state") in {JobState.cancelled.value, JobState.failed.value, JobState.interrupted.value}
            and isinstance(last_completed, int)
            and last_completed in checkpoints
            and last_completed < int(status.get("lastFrame", last_completed))
            and (job_dir / "argv.json").exists()
            and (job_dir / "effective-config.yaml").exists()
            and self._checkpoint_has_resume_state(job_dir, last_completed, int(status.get("lastFrame", last_completed)))
        )
        resume_from = last_completed + 1 if can_resume else None
        resume_source = str(job_dir / "output") if can_resume else None
        changed = False
        for key, value in {
            "resumeAvailable": can_resume,
            "resumeFromFrame": resume_from,
            "resumeSourceDir": resume_source,
        }.items():
            if status.get(key) != value:
                status[key] = value
                changed = True
        return changed


    def _checkpoint_has_resume_state(self, job_dir: Path, checkpoint_frame: int, last_frame: int) -> bool:
        checkpoint_path = job_dir / "output" / "checkpoints" / f"frame_{checkpoint_frame:03d}.txt"
        if not checkpoint_path.exists() or checkpoint_path.stat().st_size == 0:
            return False
        required = {"frame", "z_slices", "maxZ", "perFrameAdaptiveBackground", "perFrameMeanBrightness"}
        if checkpoint_frame < last_frame:
            required.add("nextFrameBackgroundValue")
        seen: set[str] = set()
        has_cell = False
        try:
            with checkpoint_path.open("r", encoding="utf-8", errors="replace") as handle:
                for raw_line in handle:
                    line = raw_line.strip()
                    if not line or line.startswith("#"):
                        continue
                    tag, *_ = line.split(maxsplit=1)
                    if tag == "frame":
                        parts = line.split()
                        if len(parts) < 2 or not parts[1].lstrip("-").isdigit() or int(parts[1]) != checkpoint_frame:
                            return False
                    if tag == "cell":
                        has_cell = True
                    if tag in required:
                        seen.add(tag)
        except OSError:
            return False
        return required.issubset(seen) and has_cell

    def _tail_log_file(self, job_id: str, log_path: Path, stream: str, process: subprocess.Popen[Any], initial_offset: int = 0) -> None:
        with log_path.open("r", encoding="utf-8", errors="replace") as handle:
            if initial_offset > 0:
                handle.seek(initial_offset)
            while True:
                line = handle.readline()
                if line:
                    self._handle_log_line(job_id, stream, line.rstrip("\n"))
                    continue
                if process.poll() is not None:
                    break
                time.sleep(0.1)

    def _handle_log_line(self, job_id: str, stream: str, line: str) -> None:
        self._event(job_id, "log.line", {"jobId": job_id, "stream": stream, "line": line})
        match = FRAME_HINT_RE.search(line)
        if match:
            with self._status_lock:
                status = self.get_status(job_id)
                status["currentFrame"] = int(match.group(1))
                self._write_status_dict(job_id, status)

    def _refresh_progress(self, job_id: str, rebuild_preview: bool = True) -> None:
        status = self.get_status(job_id)
        if not status:
            return
        scan = scan_output(self.job_dir(job_id), int(status["firstFrame"]), int(status["lastFrame"]))
        changed = False
        with self._status_lock:
            status = self.get_status(job_id)
            if not status:
                return
            for key in ["lastCompletedFrame", "completedFrames", "totalFrames", "progress", "outputReady", "partialOutputsAvailable"]:
                if status.get(key) != scan[key]:
                    status[key] = scan[key]
                    changed = True
            if self._apply_resume_fields(job_id, status, scan):
                changed = True
            if status.get("state") == JobState.running.value and scan["lastCompletedFrame"] is not None:
                current = min(int(status["lastFrame"]), int(scan["lastCompletedFrame"]) + 1)
                if status.get("currentFrame") != current:
                    status["currentFrame"] = current
                    changed = True
            if changed:
                self._write_status_dict(job_id, status)
                self._event(job_id, "job.updated", status)
        if changed and rebuild_preview:
            build_preview_artifacts(self.job_dir(job_id), job_id)

    def _monitor_existing_pid(self, job_id: str, pid: int) -> None:
        self._event(job_id, "process.recovered", {"jobId": job_id, "pid": pid})
        try:
            while not self._stop.is_set() and self._pid_is_running(pid):
                self._refresh_progress(job_id)
                time.sleep(1)
            if self._stop.is_set():
                return
            self._refresh_progress(job_id)
            status = self.get_status(job_id)
            if status.get("state") == JobState.running.value:
                completed = int(status.get("completedFrames") or 0)
                total = int(status.get("totalFrames") or 0)
                status["finishedAt"] = utc_now()
                status["exitCode"] = None
                if total > 0 and completed >= total:
                    status["state"] = JobState.completed.value
                    status["error"] = None
                else:
                    status["state"] = JobState.interrupted.value
                    status["error"] = "Recovered worker exited before completion"
                self._write_status_dict(job_id, status)
                self._event(job_id, "job.finished", {"jobId": job_id, "state": status["state"], "exitCode": None})
        finally:
            with self._status_lock:
                self._active_jobs.discard(job_id)
                self._job_threads.pop(job_id, None)

    def _pid_is_running(self, pid: int) -> bool:
        if pid <= 0:
            return False
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return False
        except PermissionError:
            return True
        return True

    def _terminate_process_group(self, pid: int) -> None:
        if not self._pid_is_running(pid):
            return
        for sig, wait_seconds in ((signal.SIGTERM, 5.0), (signal.SIGKILL, 0.0)):
            try:
                os.killpg(pid, sig)
            except ProcessLookupError:
                return
            except PermissionError:
                return
            deadline = time.time() + wait_seconds
            while wait_seconds > 0 and time.time() < deadline:
                if not self._pid_is_running(pid):
                    return
                time.sleep(0.1)

    def _unarchive_state(self, status: dict[str, Any]) -> str:
        archived_from = status.get("archivedFromState")
        if archived_from in {
            JobState.prepared.value,
            JobState.completed.value,
            JobState.failed.value,
            JobState.cancelled.value,
            JobState.interrupted.value,
        }:
            return str(archived_from)
        if status.get("completedFrames") == status.get("totalFrames") and status.get("totalFrames", 0) > 0:
            return JobState.completed.value
        error = str(status.get("error") or "").lower()
        if "cancel" in error:
            return JobState.cancelled.value
        if error:
            return JobState.failed.value
        if int(status.get("completedFrames") or 0) > 0:
            return JobState.interrupted.value
        return JobState.prepared.value

    def _write_status(self, status: JobStatus) -> None:
        self._write_status_dict(status.id, status.model_dump(mode="json"))

    def _write_status_dict(self, job_id: str, status: dict[str, Any]) -> None:
        write_json_atomic(self.job_dir(job_id) / "status.json", status)

    def _event(self, job_id: str, event_type: str, payload: dict[str, Any]) -> None:
        event = {"time": utc_now(), "type": event_type, "jobId": job_id, "payload": payload}
        append_ndjson(self.job_dir(job_id) / "events.ndjson", event)

    def _recover_interrupted_jobs(self) -> None:
        for path in self.jobs_root.glob("job_*/status.json"):
            status = read_json(path, {})
            job_id = path.parent.name
            if status.get("state") == JobState.running.value:
                pid = status.get("pid")
                if isinstance(pid, int) and self._pid_is_running(pid):
                    with self._status_lock:
                        self._active_jobs.add(job_id)
                        thread = threading.Thread(
                            target=self._monitor_existing_pid,
                            args=(job_id, pid),
                            name=f"celluniverse-recovered-{job_id}",
                            daemon=True,
                        )
                        self._job_threads[job_id] = thread
                    thread.start()
                    continue
                self._refresh_progress(job_id, rebuild_preview=False)
                status = read_json(path, {})
                completed = int(status.get("completedFrames") or 0)
                total = int(status.get("totalFrames") or 0)
                status["finishedAt"] = utc_now()
                if total > 0 and completed >= total:
                    status["state"] = JobState.completed.value
                    status["error"] = None
                    status["exitCode"] = 0
                else:
                    status["state"] = JobState.interrupted.value
                    status["error"] = "Backend restarted after worker stopped"
                write_json_atomic(path, status)
            elif status.get("state") == JobState.queued.value:
                status["state"] = JobState.prepared.value
                status["error"] = "Backend restarted before queued job started"
                write_json_atomic(path, status)
