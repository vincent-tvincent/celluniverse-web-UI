from __future__ import annotations

import json
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import UploadFile

from celluniverse_backend.config.models import BackendConfig
from celluniverse_backend.contracts.models import UploadResponse
from celluniverse_backend.security.paths import ensure_inside_roots, validate_input_reference
from celluniverse_backend.storage.json_store import write_json_atomic


class DatasetValidationError(ValueError):
    pass


class DatasetService:
    def __init__(self, config: BackendConfig):
        self.config = config

    @property
    def uploads_root(self) -> Path:
        root = self.config.runtime.runtimeRoot / "uploads"
        root.mkdir(parents=True, exist_ok=True)
        return root

    async def save_dataset_upload(self, files: list[UploadFile]) -> UploadResponse:
        upload_id = f"upload_{uuid.uuid4().hex[:12]}"
        root = self.uploads_root / upload_id / "raw"
        root.mkdir(parents=True, exist_ok=True)
        saved = []
        total_bytes = 0
        max_bytes = self.config.uploads.maxUploadSizeMb * 1024 * 1024
        for upload in files:
            name = Path(upload.filename or "").name
            if not name:
                raise DatasetValidationError("uploaded file has no filename")
            if Path(name).suffix.lower() not in self.config.uploads.allowedTiffExtensions:
                raise DatasetValidationError(f"unsupported TIFF extension: {name}")
            dest = root / name
            written = await _copy_upload(upload, dest, max_bytes - total_bytes)
            total_bytes += written
            if total_bytes > max_bytes:
                raise DatasetValidationError("uploaded dataset exceeds maxUploadSizeMb")
            saved.append(str(dest))
        manifest = {
            "uploadId": upload_id,
            "kind": "dataset",
            "files": [Path(path).name for path in saved],
        }
        write_json_atomic(self.uploads_root / upload_id / "upload-manifest.json", manifest)
        return UploadResponse(uploadId=upload_id, kind="dataset", files=saved)

    async def save_single_upload(self, upload: UploadFile, kind: str) -> UploadResponse:
        upload_id = f"upload_{uuid.uuid4().hex[:12]}"
        root = self.uploads_root / upload_id
        root.mkdir(parents=True, exist_ok=True)
        name = Path(upload.filename or kind).name
        dest = root / name
        await _copy_upload(upload, dest, self.config.uploads.maxUploadSizeMb * 1024 * 1024)
        manifest = {"uploadId": upload_id, "kind": kind, "files": [name]}
        write_json_atomic(root / "upload-manifest.json", manifest)
        return UploadResponse(uploadId=upload_id, kind=kind, files=[str(dest)])

    def upload_file_path(self, upload_id: str) -> Path:
        root = ensure_inside_roots(self.uploads_root / upload_id, [self.uploads_root])
        manifest_path = root / "upload-manifest.json"
        if not manifest_path.exists():
            raise DatasetValidationError(f"unknown upload id: {upload_id}")
        manifest = json.loads(manifest_path.read_text())
        files = manifest.get("files") or []
        if not files:
            raise DatasetValidationError(f"upload has no files: {upload_id}")
        return ensure_inside_roots(root / files[0], [root])

    def uploaded_dataset_raw_dir(self, upload_id: str) -> Path:
        root = ensure_inside_roots(self.uploads_root / upload_id / "raw", [self.uploads_root])
        if not root.exists():
            raise DatasetValidationError(f"uploaded dataset raw directory is missing: {upload_id}")
        return root

    def list_uploads(self) -> list[dict[str, object]]:
        uploads = []
        for upload_dir in sorted(self.uploads_root.glob("upload_*"), key=lambda p: p.stat().st_mtime, reverse=True):
            if not upload_dir.is_dir():
                continue
            try:
                uploads.append(self.get_upload(upload_dir.name))
            except DatasetValidationError:
                continue
        return uploads

    def get_upload(self, upload_id: str) -> dict[str, object]:
        root = ensure_inside_roots(self.uploads_root / upload_id, [self.uploads_root])
        manifest_path = root / "upload-manifest.json"
        if not manifest_path.exists():
            raise DatasetValidationError(f"unknown upload id: {upload_id}")
        manifest = json.loads(manifest_path.read_text())
        files = []
        total_bytes = 0
        for rel in manifest.get("files", []):
            path = root / rel
            if manifest.get("kind") == "dataset" and not path.exists():
                path = root / "raw" / rel
            if path.exists() and path.is_file():
                size = path.stat().st_size
                total_bytes += size
                files.append({
                    "name": path.name,
                    "relativePath": str(path.relative_to(root)),
                    "size": size,
                })
        created = datetime.fromtimestamp(manifest_path.stat().st_mtime, tz=timezone.utc).isoformat()
        return {
            "uploadId": upload_id,
            "kind": manifest.get("kind", "unknown"),
            "createdAt": created,
            "fileCount": len(files),
            "totalBytes": total_bytes,
            "files": files,
        }

    def validate_local_input(self, input_path: str, first_frame: int, last_frame: int) -> dict[str, object]:
        if last_frame < first_frame:
            raise DatasetValidationError("lastFrame must be >= firstFrame")
        frame_count = last_frame - first_frame + 1
        if frame_count > self.config.limits.maxFrameCount:
            raise DatasetValidationError(f"frame count exceeds limit: {frame_count}")
        runnable = validate_input_reference(input_path, self.config.security.allowedInputRoots)
        return {
            "sourceType": "local",
            "inputPath": runnable,
            "firstFrame": first_frame,
            "lastFrame": last_frame,
            "frameCount": frame_count,
        }

    def materialize_uploaded_dataset(self, upload_id: str, job_input_dir: Path) -> str:
        raw_dir = self.uploaded_dataset_raw_dir(upload_id)
        dest = job_input_dir / "raw"
        dest.mkdir(parents=True, exist_ok=True)
        for file in sorted(raw_dir.iterdir()):
            if file.is_file():
                _link_or_copy(file, dest / file.name)
        return str(dest)


async def _copy_upload(upload: UploadFile, dest: Path, max_bytes: int) -> int:
    dest.parent.mkdir(parents=True, exist_ok=True)
    written = 0
    with dest.open("wb") as handle:
        while True:
            chunk = await upload.read(1024 * 1024)
            if not chunk:
                break
            written += len(chunk)
            if written > max_bytes:
                raise DatasetValidationError("upload exceeds maxUploadSizeMb")
            handle.write(chunk)
    return written


def _link_or_copy(source: Path, dest: Path) -> None:
    if dest.exists():
        return
    try:
        dest.hardlink_to(source)
    except OSError:
        shutil.copy2(source, dest)
