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
        self._processes: dict[str, subprocess.Popen[str]] = {}
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
        for job_id in list(self._processes):
            self.cancel_job(job_id)

    def create_job(self, request: CreateJobRequest) -> JobStatus:
        if request.lastFrame < request.firstFrame:
            raise ValueError("lastFrame must be >= firstFrame")
        frame_count = request.lastFrame - request.firstFrame + 1
        if frame_count > self.config.limits.maxFrameCount:
            raise ValueError(f"frame count exceeds limit: {frame_count}")

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
            state=JobState.queued,
            createdAt=utc_now(),
            firstFrame=request.firstFrame,
            lastFrame=request.lastFrame,
            currentFrame=request.firstFrame,
            totalFrames=frame_count,
        )
        self._write_status(status)
        self._event(job_id, "job.queued", status.model_dump(mode="json"))
        self._queue.put(job_id)
        return status

    def list_jobs(self) -> list[dict[str, Any]]:
        statuses = []
        queued = list(self._queue.queue)
        for path in sorted(self.jobs_root.glob("job_*/status.json"), reverse=True):
            data = read_json(path, {})
            if data.get("state") == JobState.queued.value and data.get("id") in queued:
                data["queuePosition"] = queued.index(data["id"]) + 1
            statuses.append(data)
        return statuses

    def get_status(self, job_id: str) -> dict[str, Any]:
        try:
            return read_json(self.job_dir(job_id) / "status.json", {})
        except KeyError:
            return {}

    def cancel_job(self, job_id: str) -> dict[str, Any]:
        status = self.get_status(job_id)
        if not status:
            raise KeyError(job_id)
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
            active = sum(1 for process in self._processes.values() if process.poll() is None)
            if active >= self.config.runtime.maxConcurrentJobs:
                time.sleep(1)
                continue
            try:
                job_id = self._queue.get(timeout=1)
            except queue.Empty:
                continue
            status = self.get_status(job_id)
            if status.get("state") != JobState.queued.value:
                continue
            self._run_job(job_id)

    def _run_job(self, job_id: str) -> None:
        job_dir = self.job_dir(job_id)
        request = CreateJobRequest.model_validate(read_json(job_dir / "request.json"))
        status = self.get_status(job_id)
        status.update({"state": JobState.running.value, "startedAt": utc_now()})
        self._write_status_dict(job_id, status)
        self._event(job_id, "job.started", {"jobId": job_id})

        argv = read_json(job_dir / "argv.json")
        process = start_celluniverse_process(self.config, argv)
        self._processes[job_id] = process
        status["pid"] = process.pid
        self._write_status_dict(job_id, status)
        self._event(job_id, "process.started", {"jobId": job_id, "pid": process.pid, "argv": argv})

        stdout_thread = threading.Thread(target=self._pipe_log, args=(job_id, process.stdout, "stdout"), daemon=True)
        stderr_thread = threading.Thread(target=self._pipe_log, args=(job_id, process.stderr, "stderr"), daemon=True)
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

    def _materialize_inputs(self, job_id: str, request: CreateJobRequest) -> None:
        job_dir = self.job_dir(job_id)
        input_path = self._resolve_job_input(job_dir, request)
        initial_csv = self._resolve_initial_csv(job_dir, request)
        effective_config = job_dir / "effective-config.yaml"
        module = self.exposed_registry.load_module(request.parameterModuleId)
        base_config = self._resolve_base_config(request, module)
        materialize_effective_config(base_config, effective_config, module, request.overrides)

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

    def _resolve_initial_csv(self, job_dir: Path, request: CreateJobRequest) -> Path:
        if request.initialCsvUploadId:
            source = self.dataset_service.upload_file_path(request.initialCsvUploadId)
        elif request.initialCsvPath:
            source = ensure_inside_roots(Path(request.initialCsvPath), self.config.security.allowedInitialCsvRoots)
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

    def _pipe_log(self, job_id: str, pipe: Any, stream: str) -> None:
        if pipe is None:
            return
        log_path = self.job_dir(job_id) / f"{stream}.log"
        with log_path.open("a", encoding="utf-8", errors="replace") as handle:
            for line in pipe:
                handle.write(line)
                handle.flush()
                self._event(job_id, "log.line", {"jobId": job_id, "stream": stream, "line": line.rstrip("\n")})
                match = FRAME_HINT_RE.search(line)
                if match:
                    status = self.get_status(job_id)
                    status["currentFrame"] = int(match.group(1))
                    self._write_status_dict(job_id, status)

    def _refresh_progress(self, job_id: str) -> None:
        status = self.get_status(job_id)
        if not status:
            return
        scan = scan_output(self.job_dir(job_id), int(status["firstFrame"]), int(status["lastFrame"]))
        changed = False
        for key in ["lastCompletedFrame", "completedFrames", "totalFrames", "progress", "outputReady", "partialOutputsAvailable"]:
            if status.get(key) != scan[key]:
                status[key] = scan[key]
                changed = True
        if status.get("state") == JobState.running.value and scan["lastCompletedFrame"] is not None:
            current = min(int(status["lastFrame"]), int(scan["lastCompletedFrame"]) + 1)
            if status.get("currentFrame") != current:
                status["currentFrame"] = current
                changed = True
        if changed:
            self._write_status_dict(job_id, status)
            build_preview_artifacts(self.job_dir(job_id), job_id)
            self._event(job_id, "job.updated", status)

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
            if status.get("state") == JobState.running.value:
                status["state"] = JobState.interrupted.value
                status["finishedAt"] = utc_now()
                status["error"] = "Backend restarted while job was running"
                write_json_atomic(path, status)
