from __future__ import annotations

import hashlib
import json
import re
import shutil
import uuid
from configparser import RawConfigParser
from datetime import datetime, timezone
from pathlib import Path

from fastapi import UploadFile

from celluniverse_backend.config.models import BackendConfig
from celluniverse_backend.contracts.models import UploadResponse
from celluniverse_backend.security.paths import PathSecurityError, ensure_inside_roots, validate_input_reference
from celluniverse_backend.storage.json_store import write_json_atomic


class DatasetValidationError(ValueError):
    pass


class DatasetService:
    def __init__(self, config: BackendConfig):
        self.config = config

    def list_local_datasets(self) -> list[dict[str, object]]:
        candidates: dict[str, dict[str, object]] = {}
        for idx, root in enumerate(self.config.security.allowedInputRoots):
            try:
                resolved = root.expanduser().resolve(strict=True)
            except FileNotFoundError:
                continue
            if resolved.is_dir():
                self._scan_dataset_root(resolved, f"root_{idx}", candidates)
            elif resolved.is_file() and _is_tiff_file(resolved):
                self._add_file_candidate(resolved, f"root_{idx}", candidates, source="approved-root")
        self._scan_run_config_inputs(candidates)
        return sorted(candidates.values(), key=lambda item: str(item.get("label", "")).lower())

    def list_initial_csv_presets(self) -> list[dict[str, object]]:
        presets: dict[str, dict[str, object]] = {}
        for root in self.config.security.allowedInitialCsvRoots:
            try:
                resolved = root.expanduser().resolve(strict=True)
            except FileNotFoundError:
                continue
            if resolved.is_file() and _looks_like_initial_csv(resolved):
                self._add_initial_csv_preset(resolved, presets, source="approved-root")
                continue
            if not resolved.is_dir():
                continue
            for csv_path in sorted(resolved.rglob("*.csv"), key=lambda p: str(p).lower()):
                if len(presets) >= 500:
                    break
                if csv_path.name.startswith(".") or csv_path.is_symlink() or not _looks_like_initial_csv(csv_path):
                    continue
                self._add_initial_csv_preset(csv_path, presets, source="approved-root")
        self._scan_run_config_initial_csv(presets)
        return sorted(presets.values(), key=lambda item: str(item.get("label", "")).lower())

    def _scan_dataset_root(self, root: Path, root_id: str, candidates: dict[str, dict[str, object]]) -> None:
        stack: list[tuple[Path, int]] = [(root, 0)]
        max_depth = 6
        while stack and len(candidates) < 500:
            current, depth = stack.pop()
            if current.name.startswith(".") or current.is_symlink():
                continue
            try:
                tiffs = _first_layer_tiffs(current)
            except OSError:
                continue
            if tiffs:
                self._add_directory_candidate(current, root_id, tiffs, candidates, source="approved-root")
                continue
            if depth >= max_depth:
                continue
            try:
                children = sorted(current.iterdir(), key=lambda p: p.name.lower(), reverse=True)
            except OSError:
                continue
            for child in children:
                if child.is_dir() and not child.name.startswith(".") and not child.is_symlink():
                    stack.append((child, depth + 1))

    def _scan_run_config_inputs(self, candidates: dict[str, dict[str, object]]) -> None:
        run_config = self.config.celluniverse.scripts_dir / "run_config.ini"
        if not run_config.exists():
            return
        parser = RawConfigParser()
        parser.read(run_config)
        seen: set[str] = set()
        for section in parser.sections():
            if not parser.has_option(section, "input_path"):
                continue
            raw = parser.get(section, "input_path")
            if raw in seen:
                continue
            seen.add(raw)
            try:
                path_text = _resolve_config_path_text(raw, self.config.celluniverse.scripts_dir)
                runnable = validate_input_reference(path_text, self.config.security.allowedInputRoots)
            except (PathSecurityError, FileNotFoundError, ValueError):
                continue
            if "%" in runnable:
                self._add_pattern_candidate(runnable, candidates, source="run_config.ini")
            else:
                path = Path(runnable)
                if path.is_dir():
                    tiffs = _first_layer_tiffs(path)
                    if tiffs:
                        self._add_directory_candidate(path, "run_config", tiffs, candidates, source="run_config.ini")
                elif path.is_file() and _is_tiff_file(path):
                    self._add_file_candidate(path, "run_config", candidates, source="run_config.ini")

    def _scan_run_config_initial_csv(self, presets: dict[str, dict[str, object]]) -> None:
        run_config = self.config.celluniverse.scripts_dir / "run_config.ini"
        if not run_config.exists():
            return
        parser = RawConfigParser()
        parser.read(run_config)
        for section in parser.sections():
            if not parser.has_option(section, "initial_csv_file"):
                continue
            raw = parser.get(section, "initial_csv_file")
            try:
                resolved_text = _resolve_config_path_text(raw, self.config.celluniverse.scripts_dir)
                resolved = ensure_inside_roots(Path(resolved_text), self.config.security.allowedInitialCsvRoots)
            except (PathSecurityError, FileNotFoundError, ValueError):
                continue
            self._add_initial_csv_preset(resolved, presets, source="run_config.ini")

    def _add_directory_candidate(
        self,
        directory: Path,
        root_id: str,
        tiffs: list[Path],
        candidates: dict[str, dict[str, object]],
        *,
        source: str,
    ) -> None:
        input_path = str(directory)
        label = _dataset_label(directory)
        candidates.setdefault(_candidate_id(input_path), {
            "id": _candidate_id(input_path),
            "label": label,
            "sourceType": "local",
            "source": source,
            "rootId": root_id,
            "inputPath": input_path,
            "pathKind": "directory",
            "fileCount": len(tiffs),
            "frameCount": len(tiffs),
            "firstFrame": 0,
            "lastFrame": max(0, len(tiffs) - 1),
            "filePattern": _infer_file_pattern(tiffs),
            "totalBytes": _total_size(tiffs),
            "detectedAt": datetime.now(timezone.utc).isoformat(),
            "warnings": [],
        })

    def _add_pattern_candidate(self, pattern: str, candidates: dict[str, dict[str, object]], *, source: str) -> None:
        parent_candidate_id = _candidate_id(str(Path(pattern).parent))
        if parent_candidate_id in candidates:
            return
        files = _pattern_files(pattern)
        if not files:
            return
        frame_numbers = _extract_frame_numbers(files)
        candidate_id = _candidate_id(pattern)
        candidates.setdefault(candidate_id, {
            "id": candidate_id,
            "label": _dataset_label(Path(pattern).parent),
            "sourceType": "local",
            "source": source,
            "rootId": "run_config",
            "inputPath": pattern,
            "pathKind": "frame-pattern",
            "fileCount": len(files),
            "frameCount": len(files),
            "firstFrame": min(frame_numbers) if frame_numbers else 0,
            "lastFrame": max(frame_numbers) if frame_numbers else max(0, len(files) - 1),
            "filePattern": Path(pattern).name,
            "totalBytes": _total_size(files),
            "detectedAt": datetime.now(timezone.utc).isoformat(),
            "warnings": [],
        })

    def _add_file_candidate(self, file_path: Path, root_id: str, candidates: dict[str, dict[str, object]], *, source: str) -> None:
        input_path = str(file_path)
        candidate_id = _candidate_id(input_path)
        frame_numbers = _extract_frame_numbers([file_path])
        candidates.setdefault(candidate_id, {
            "id": candidate_id,
            "label": file_path.name,
            "sourceType": "local",
            "source": source,
            "rootId": root_id,
            "inputPath": input_path,
            "pathKind": "file",
            "fileCount": 1,
            "frameCount": 1,
            "firstFrame": frame_numbers[0] if frame_numbers else 0,
            "lastFrame": frame_numbers[0] if frame_numbers else 0,
            "filePattern": file_path.name,
            "totalBytes": file_path.stat().st_size,
            "detectedAt": datetime.now(timezone.utc).isoformat(),
            "warnings": [],
        })

    def _add_initial_csv_preset(self, csv_path: Path, presets: dict[str, dict[str, object]], *, source: str) -> None:
        preset_id = _candidate_id(str(csv_path))
        presets.setdefault(preset_id, {
            "id": preset_id,
            "label": _csv_label(csv_path),
            "path": str(csv_path),
            "source": source,
            "size": csv_path.stat().st_size,
        })

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

    def uploaded_dataset_files(self, upload_id: str) -> list[Path]:
        raw_dir = self.uploaded_dataset_raw_dir(upload_id)
        files = _first_layer_tiffs(raw_dir)
        if not files:
            raise DatasetValidationError(f"uploaded dataset has no previewable TIFF files: {upload_id}")
        return files

    def get_local_dataset(self, dataset_id: str) -> dict[str, object]:
        for dataset in self.list_local_datasets():
            if str(dataset.get("id")) == dataset_id:
                return dataset
        raise DatasetValidationError(f"unknown local dataset id: {dataset_id}")

    def local_dataset_files(self, dataset_id: str) -> tuple[dict[str, object], list[Path]]:
        dataset = self.get_local_dataset(dataset_id)
        input_path = str(dataset.get("inputPath") or "")
        path_kind = str(dataset.get("pathKind") or "")
        if path_kind == "frame-pattern":
            files = _pattern_files(input_path)
        else:
            path = Path(input_path)
            if path.is_dir():
                files = _first_layer_tiffs(path)
            elif _is_tiff_file(path):
                files = [path]
            else:
                files = []
        if not files:
            raise DatasetValidationError(f"dataset has no previewable TIFF files: {dataset_id}")
        return dataset, files

    def delete_uploaded_dataset(self, upload_id: str) -> None:
        root = ensure_inside_roots(self.uploads_root / upload_id, [self.uploads_root])
        manifest_path = root / "upload-manifest.json"
        if not manifest_path.exists():
            raise DatasetValidationError(f"unknown upload id: {upload_id}")
        shutil.rmtree(root)

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


def _looks_like_initial_csv(path: Path) -> bool:
    return path.suffix.lower() == ".csv" and "initial" in path.name.lower()


def _is_tiff_file(path: Path) -> bool:
    return path.is_file() and not path.name.startswith("._") and path.suffix.lower() in {".tif", ".tiff"}


def _first_layer_tiffs(directory: Path) -> list[Path]:
    return sorted(
        [child for child in directory.iterdir() if _is_tiff_file(child)],
        key=lambda path: _natural_key(path.name),
    )


def _pattern_files(pattern: str) -> list[Path]:
    raw = Path(pattern)
    glob_name = re.sub(r"%0?\d*d", "*", raw.name)
    try:
        files = [path for path in raw.parent.glob(glob_name) if _is_tiff_file(path)]
    except OSError:
        return []
    return sorted(files, key=lambda path: _natural_key(path.name))


def _extract_frame_numbers(files: list[Path]) -> list[int]:
    numbers: list[int] = []
    for path in files:
        match = re.search(r"(\d+)(?=\.[^.]+$)", path.name)
        if match:
            numbers.append(int(match.group(1)))
    return numbers


def _infer_file_pattern(files: list[Path]) -> str:
    if not files:
        return "*.tif"
    first = files[0].name
    match = re.search(r"(\d+)(?=\.[^.]+$)", first)
    if not match:
        return Path(first).suffix.lower() or "*.tif"
    width = len(match.group(1))
    return f"{first[:match.start()]}%0{width}d{first[match.end():]}"


def _total_size(files: list[Path]) -> int:
    total = 0
    for path in files:
        try:
            total += path.stat().st_size
        except OSError:
            continue
    return total


def _candidate_id(value: str) -> str:
    return "local_" + hashlib.sha1(value.encode("utf-8")).hexdigest()[:12]


def _dataset_label(path: Path) -> str:
    parts = [part for part in path.parts[-4:] if part not in {"/", ""}]
    return "/".join(parts) if parts else path.name


def _csv_label(path: Path) -> str:
    parts = [part for part in path.parts[-3:] if part not in {"/", ""}]
    return "/".join(parts) if parts else path.name


def _resolve_config_path_text(path_text: str, base_dir: Path) -> str:
    path = Path(path_text).expanduser()
    if path.is_absolute():
        return str(path)
    return str((base_dir / path).resolve(strict=False))


def _natural_key(value: str) -> list[object]:
    return [int(part) if part.isdigit() else part.lower() for part in re.split(r"(\d+)", value)]
