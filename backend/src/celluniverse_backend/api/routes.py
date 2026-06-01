from __future__ import annotations

import json
import os
import time
import zipfile
from pathlib import Path
from typing import Any, Iterable

from fastapi import APIRouter, Depends, FastAPI, File, Header, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, StreamingResponse

from celluniverse_backend.config.exposed import ExposedParameterRegistry
from celluniverse_backend.config.models import BackendConfig
from celluniverse_backend.contracts.models import (
    ClientConfig,
    CreateJobRequest,
    LocalDatasetValidationRequest,
)
from celluniverse_backend.datasets.service import DatasetService, DatasetValidationError
from celluniverse_backend.jobs.manager import JobManager
from celluniverse_backend.parsers.cells import parse_cells_csv
from celluniverse_backend.preview.manifest import build_preview_artifacts
from celluniverse_backend.preview.pointcloud import ensure_pointcloud_preview
from celluniverse_backend.preview.slice import ensure_slice_preview
from celluniverse_backend.runners.engine import inspect_engine
from celluniverse_backend.security.paths import PathSecurityError, safe_child_path, validate_input_reference
from celluniverse_backend.storage.json_store import read_json


def install_routes(app: FastAPI, config: BackendConfig, jobs: JobManager, exposed: ExposedParameterRegistry) -> None:
    router = APIRouter(prefix=config.server.apiPrefix)
    dataset_service = DatasetService(config)

    def require_auth(authorization: str | None = Header(default=None)) -> None:
        if config.auth.mode == "none":
            return
        token = os.environ.get(config.auth.tokenEnv)
        if not token:
            raise HTTPException(status_code=500, detail="shared-token auth is enabled but token env is unset")
        if authorization != f"Bearer {token}":
            raise HTTPException(status_code=401, detail="invalid token")

    def job_dir_or_404(job_id: str) -> Path:
        try:
            return jobs.job_dir(job_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="job not found") from exc

    @router.get("/health")
    def health(_: None = Depends(require_auth)) -> dict[str, str]:
        return {"status": "ok"}

    @router.get("/client-config", response_model=ClientConfig)
    def client_config(_: None = Depends(require_auth)) -> ClientConfig:
        prefix = config.server.apiPrefix
        return ClientConfig(
            apiBaseUrl=prefix,
            eventsTransport=config.server.eventsTransport,
            eventsUrl=f"{prefix}/events",
            previewUrlPrefix=f"{prefix}/jobs",
            downloadUrlPrefix=f"{prefix}/jobs",
            features={
                "pngPreview": True,
                "omeZarrPreview": config.preview.enableOmeZarr,
                "threeDViewer": config.preview.enable3D,
            },
        )

    @router.get("/engine/status")
    def engine_status(_: None = Depends(require_auth)) -> dict[str, Any]:
        return inspect_engine(config).model_dump()

    @router.get("/config/exposed-parameter-modules")
    def list_parameter_modules(_: None = Depends(require_auth)) -> list[dict[str, str]]:
        return exposed.list_modules()

    @router.get("/config/exposed-parameter-modules/{module_id}")
    def get_parameter_module(module_id: str, _: None = Depends(require_auth)) -> dict[str, Any]:
        try:
            return exposed.load_module(module_id).model_dump()
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @router.get("/datasets/roots")
    def dataset_roots(_: None = Depends(require_auth)) -> list[dict[str, str]]:
        return [
            {"id": f"root_{idx}", "path": str(path)}
            for idx, path in enumerate(config.security.allowedInputRoots)
            if path.exists()
        ]

    @router.get("/datasets/browse")
    def browse_dataset_root(
        rootId: str = Query(...),
        path: str = Query(default=""),
        _: None = Depends(require_auth),
    ) -> dict[str, Any]:
        try:
            idx = int(rootId.removeprefix("root_"))
            root = config.security.allowedInputRoots[idx].resolve(strict=True)
            target = safe_child_path(root, path)
        except (ValueError, IndexError, PathSecurityError, FileNotFoundError) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        if not target.exists() or not target.is_dir():
            raise HTTPException(status_code=404, detail="directory not found")
        entries = []
        for child in sorted(target.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower())):
            if child.name.startswith("."):
                continue
            entries.append({
                "name": child.name,
                "path": str(child.relative_to(root)),
                "type": "directory" if child.is_dir() else "file",
                "size": child.stat().st_size if child.is_file() else None,
            })
        return {"rootId": rootId, "path": path, "entries": entries}

    @router.post("/datasets/validate-local")
    def validate_local_dataset(body: LocalDatasetValidationRequest, _: None = Depends(require_auth)) -> dict[str, Any]:
        try:
            return dataset_service.validate_local_input(body.inputPath, body.firstFrame, body.lastFrame)
        except (DatasetValidationError, PathSecurityError, FileNotFoundError, ValueError) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @router.post("/datasets/uploads")
    async def upload_dataset(files: list[UploadFile] = File(...), _: None = Depends(require_auth)) -> dict[str, Any]:
        try:
            return (await dataset_service.save_dataset_upload(files)).model_dump()
        except (DatasetValidationError, OSError) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @router.get("/datasets/uploads")
    def list_dataset_uploads(_: None = Depends(require_auth)) -> list[dict[str, Any]]:
        return dataset_service.list_uploads()

    @router.get("/datasets/uploads/{upload_id}")
    def get_dataset_upload(upload_id: str, _: None = Depends(require_auth)) -> dict[str, Any]:
        try:
            return dataset_service.get_upload(upload_id)
        except (DatasetValidationError, PathSecurityError, FileNotFoundError) as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @router.post("/uploads/initial-csv")
    async def upload_initial_csv(file: UploadFile = File(...), _: None = Depends(require_auth)) -> dict[str, Any]:
        if not (file.filename or "").lower().endswith(".csv"):
            raise HTTPException(status_code=400, detail="initial file must be .csv")
        return (await dataset_service.save_single_upload(file, "initial_csv")).model_dump()

    @router.post("/uploads/config-yaml")
    async def upload_config_yaml(file: UploadFile = File(...), _: None = Depends(require_auth)) -> dict[str, Any]:
        if Path(file.filename or "").suffix.lower() not in {".yaml", ".yml"}:
            raise HTTPException(status_code=400, detail="config file must be .yaml or .yml")
        return (await dataset_service.save_single_upload(file, "config_yaml")).model_dump()

    @router.post("/jobs")
    def create_job(body: CreateJobRequest, _: None = Depends(require_auth)) -> dict[str, Any]:
        try:
            return jobs.create_job(body).model_dump(mode="json")
        except Exception as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @router.get("/jobs")
    def list_jobs(_: None = Depends(require_auth)) -> list[dict[str, Any]]:
        return jobs.list_jobs()

    @router.get("/jobs/{job_id}")
    def get_job(job_id: str, _: None = Depends(require_auth)) -> dict[str, Any]:
        status = jobs.get_status(job_id)
        if not status:
            raise HTTPException(status_code=404, detail="job not found")
        return status

    @router.post("/jobs/{job_id}/cancel")
    def cancel_job(job_id: str, _: None = Depends(require_auth)) -> dict[str, Any]:
        try:
            return jobs.cancel_job(job_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="job not found") from exc

    @router.get("/jobs/{job_id}/logs")
    def get_logs(
        job_id: str,
        stream: str = Query(default="stdout", pattern="^(stdout|stderr)$"),
        tail: int = Query(default=500, ge=1, le=5000),
        _: None = Depends(require_auth),
    ) -> dict[str, Any]:
        log_path = job_dir_or_404(job_id) / f"{stream}.log"
        if not log_path.exists():
            return {"jobId": job_id, "stream": stream, "lines": []}
        return {"jobId": job_id, "stream": stream, "lines": _tail_lines(log_path, tail)}

    @router.get("/events")
    def global_events(_: None = Depends(require_auth)) -> StreamingResponse:
        def gen() -> Iterable[str]:
            while True:
                payload = {"type": "jobs.snapshot", "jobs": jobs.list_jobs()}
                yield f"event: jobs.snapshot\ndata: {json.dumps(payload)}\n\n"
                time.sleep(2)
        return StreamingResponse(gen(), media_type="text/event-stream")

    @router.get("/jobs/{job_id}/events")
    def job_events(job_id: str, _: None = Depends(require_auth)) -> StreamingResponse:
        event_path = job_dir_or_404(job_id) / "events.ndjson"

        def gen() -> Iterable[str]:
            offset = 0
            while True:
                if event_path.exists():
                    with event_path.open("r", encoding="utf-8") as handle:
                        handle.seek(offset)
                        while True:
                            line = handle.readline()
                            if not line:
                                break
                            offset = handle.tell()
                            event = json.loads(line)
                            yield f"event: {event.get('type', 'message')}\ndata: {json.dumps(event)}\n\n"
                time.sleep(1)

        return StreamingResponse(gen(), media_type="text/event-stream")

    @router.get("/jobs/{job_id}/manifest")
    def get_manifest(job_id: str, _: None = Depends(require_auth)) -> dict[str, Any]:
        job_dir = job_dir_or_404(job_id)
        manifest_path = job_dir / "preview" / "manifest.json"
        if not manifest_path.exists():
            return build_preview_artifacts(job_dir, job_id)
        manifest = read_json(manifest_path, {})
        if not _manifest_has_pointcloud_layers(manifest):
            return build_preview_artifacts(job_dir, job_id)
        return manifest

    @router.get("/jobs/{job_id}/frames/{frame}/cells")
    def get_frame_cells(job_id: str, frame: int, _: None = Depends(require_auth)) -> list[dict[str, Any]]:
        job_dir = job_dir_or_404(job_id)
        cells_path = job_dir / "preview" / "frames" / f"t{frame:03d}" / "cells.json"
        if not cells_path.exists():
            build_preview_artifacts(job_dir, job_id)
        return read_json(cells_path, [])

    @router.get("/jobs/{job_id}/lineage")
    def get_lineage(job_id: str, _: None = Depends(require_auth)) -> dict[str, Any]:
        job_dir = job_dir_or_404(job_id)
        lineage_path = job_dir / "preview" / "lineage.json"
        if not lineage_path.exists():
            build_preview_artifacts(job_dir, job_id)
        return read_json(lineage_path, {"nodes": [], "edges": []})

    @router.get("/jobs/{job_id}/pointcloud/{layer}/{frame}.cupc")
    def get_pointcloud(job_id: str, layer: str, frame: int, _: None = Depends(require_auth)) -> FileResponse:
        if layer not in {"real", "synth"}:
            raise HTTPException(status_code=404, detail="point-cloud layer not found")
        job_dir = job_dir_or_404(job_id)
        preview_path = job_dir / "preview" / "pointcloud" / layer / f"{frame}.cupc"
        if preview_path.exists() and preview_path.is_file():
            return FileResponse(preview_path, media_type="application/octet-stream")
        source_tiff = job_dir / "output" / "tiff" / layer / f"{frame}.tif"
        if not source_tiff.exists() or not source_tiff.is_file():
            raise HTTPException(status_code=404, detail="source TIFF not found")
        point_cloud_config = config.preview.pointCloud
        intensity_percentile = (
            point_cloud_config.synthIntensityPercentile
            if layer == "synth"
            else point_cloud_config.realIntensityPercentile
        )
        try:
            ensure_pointcloud_preview(
                source_tiff,
                preview_path,
                max_points=point_cloud_config.maxPoints,
                max_slices=point_cloud_config.maxSlices,
                intensity_percentile=intensity_percentile,
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        return FileResponse(preview_path, media_type="application/octet-stream")

    @router.get("/jobs/{job_id}/slices/{layer}/{frame}/{slice_index}.cusl")
    def get_slice_preview(
        job_id: str,
        layer: str,
        frame: int,
        slice_index: int,
        max_xy: int = Query(default=512, ge=64, le=4096),
        _: None = Depends(require_auth),
    ) -> FileResponse:
        if layer not in {"real", "synth"}:
            raise HTTPException(status_code=404, detail="slice layer not found")
        job_dir = job_dir_or_404(job_id)
        source_tiff = job_dir / "output" / "tiff" / layer / f"{frame}.tif"
        if not source_tiff.exists() or not source_tiff.is_file():
            raise HTTPException(status_code=404, detail="source TIFF not found")
        preview_path = job_dir / "preview" / "slices" / layer / str(frame) / f"z{slice_index}_xy{max_xy}.cusl"
        try:
            ensure_slice_preview(source_tiff, preview_path, slice_index=slice_index, max_xy=max_xy)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        return FileResponse(preview_path, media_type="application/octet-stream")

    @router.get("/jobs/{job_id}/artifacts")
    def get_artifacts(job_id: str, _: None = Depends(require_auth)) -> dict[str, Any]:
        job_dir = job_dir_or_404(job_id)
        artifacts_path = job_dir / "artifacts.json"
        if not artifacts_path.exists():
            build_preview_artifacts(job_dir, job_id)
        return read_json(artifacts_path, {"artifacts": []})

    @router.get("/jobs/{job_id}/files/{file_path:path}")
    def get_job_file(job_id: str, file_path: str, _: None = Depends(require_auth)) -> FileResponse:
        try:
            path = safe_child_path(job_dir_or_404(job_id), file_path)
        except PathSecurityError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        if not path.exists() or not path.is_file():
            raise HTTPException(status_code=404, detail="file not found")
        return FileResponse(path)

    @router.get("/jobs/{job_id}/download")
    def download_job(job_id: str, _: None = Depends(require_auth)) -> FileResponse:
        job_dir = job_dir_or_404(job_id)
        if not (job_dir / "status.json").exists():
            raise HTTPException(status_code=404, detail="job not found")
        downloads = job_dir / "downloads"
        downloads.mkdir(exist_ok=True)
        zip_path = downloads / "output.zip"
        _build_zip(job_dir, zip_path)
        return FileResponse(zip_path, filename=f"{job_id}-output.zip")

    app.include_router(router)


def _tail_lines(path: Path, count: int) -> list[str]:
    with path.open("r", encoding="utf-8", errors="replace") as handle:
        lines = handle.readlines()
    return [line.rstrip("\n") for line in lines[-count:]]


def _manifest_has_pointcloud_layers(manifest: dict[str, Any]) -> bool:
    for frame in manifest.get("frames", []):
        layers = frame.get("layers", {})
        if layers.get("realTiff") and not layers.get("realPointCloud"):
            return False
        if layers.get("synthTiff") and not layers.get("synthPointCloud"):
            return False
    return True


def _build_zip(job_dir: Path, zip_path: Path) -> None:
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for rel in ["request.json", "status.json", "effective-config.yaml", "initial.csv", "stdout.log", "stderr.log"]:
            path = job_dir / rel
            if path.exists():
                archive.write(path, rel)
        for folder in ["output", "preview"]:
            root = job_dir / folder
            if not root.exists():
                continue
            for path in root.rglob("*"):
                if path.is_file():
                    archive.write(path, path.relative_to(job_dir))
