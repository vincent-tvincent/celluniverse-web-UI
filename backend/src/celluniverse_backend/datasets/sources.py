from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel

from celluniverse_backend.config.models import BackendConfig
from celluniverse_backend.storage.json_store import read_json, write_json_atomic


SourceRole = Literal["dataset", "initial-csv"]


class DataSourceMutation(BaseModel):
    label: str | None = None
    path: str | None = None
    enabled: bool | None = None
    sourceRole: SourceRole | None = None


class DataSourceRegistry:
    def __init__(self, config: BackendConfig):
        self.config = config
        self.config_roots = [root.expanduser() for root in config.security.allowedInputRoots]
        self.config_csv_roots = [root.expanduser() for root in config.security.allowedInitialCsvRoots]
        self.path = config.runtime.runtimeRoot / "data-sources.json"
        self._ensure_store()
        self.apply_to_config()

    def list_sources(self) -> list[dict[str, Any]]:
        return [self._public_source(source) for source in self._load()]

    def add_source(
        self,
        path_text: str,
        label: str | None = None,
        enabled: bool = True,
        source_role: SourceRole = "dataset",
    ) -> dict[str, Any]:
        resolved = self._resolve_existing_path(path_text)
        role = self._source_role(source_role)
        sources = self._load()
        existing = next((
            item for item in sources
            if self._normalize_path(item.get("path")) == str(resolved) and self._source_role(item.get("sourceRole")) == role
        ), None)
        if existing:
            existing["label"] = label or existing.get("label") or resolved.name or str(resolved)
            existing["enabled"] = enabled
            existing["sourceRole"] = role
            existing["sourceKind"] = self._source_kind(role, bool(existing.get("preset", False)))
            existing["updatedAt"] = _now()
        else:
            sources.append({
                "id": _source_id(str(resolved), role),
                "label": label or resolved.name or str(resolved),
                "path": str(resolved),
                "enabled": enabled,
                "preset": False,
                "sourceRole": role,
                "sourceKind": self._source_kind(role, False),
                "createdAt": _now(),
                "updatedAt": _now(),
            })
        self._save(sources)
        self.apply_to_config()
        return self._public_source(next(
            item for item in self._load()
            if self._normalize_path(item.get("path")) == str(resolved) and self._source_role(item.get("sourceRole")) == role
        ))

    def update_source(self, source_id: str, mutation: DataSourceMutation) -> dict[str, Any]:
        sources = self._load()
        source = self._find(sources, source_id)
        role = self._source_role(source.get("sourceRole"))
        if mutation.sourceRole is not None:
            if source.get("preset"):
                raise ValueError("preset data sources cannot change type")
            role = self._source_role(mutation.sourceRole)
            source["sourceRole"] = role
        if mutation.path is not None:
            if source.get("preset"):
                raise ValueError("preset data sources cannot change path")
            resolved = self._resolve_existing_path(mutation.path)
            source["path"] = str(resolved)
            source["id"] = _source_id(str(resolved), role)
            if not mutation.label:
                source["label"] = resolved.name or str(resolved)
        if mutation.label is not None:
            source["label"] = mutation.label.strip() or source.get("label") or source.get("path")
        if mutation.enabled is not None:
            source["enabled"] = bool(mutation.enabled)
        source["sourceRole"] = role
        source["sourceKind"] = self._source_kind(role, bool(source.get("preset", False)))
        source["updatedAt"] = _now()
        self._save(sources)
        self.apply_to_config()
        return self._public_source(source)

    def delete_source(self, source_id: str) -> dict[str, Any]:
        sources = self._load()
        source = self._find(sources, source_id)
        if source.get("preset"):
            raise ValueError("preset data sources cannot be removed")
        next_sources = [item for item in sources if item.get("id") != source_id]
        self._save(next_sources)
        self.apply_to_config()
        return self._public_source(source)

    def apply_to_config(self) -> None:
        dataset_paths: list[Path] = []
        csv_paths: list[Path] = []
        for source in self._load():
            if not source.get("enabled", True):
                continue
            try:
                path = Path(str(source.get("path", ""))).expanduser().resolve(strict=True)
            except (FileNotFoundError, OSError, RuntimeError):
                continue
            if self._source_role(source.get("sourceRole")) == "initial-csv":
                csv_paths.append(path)
            else:
                dataset_paths.append(path)
        self.config.security.allowedInputRoots = dataset_paths
        self.config.security.allowedInitialCsvRoots = csv_paths

    def _ensure_store(self) -> None:
        if self.path.exists():
            existing = self._load()
        else:
            existing = []
        changed = not self.path.exists()
        for source in existing:
            role = self._source_role(source.get("sourceRole"))
            source["sourceRole"] = role
            source["sourceKind"] = source.get("sourceKind") or self._source_kind(role, bool(source.get("preset", False)))
            source["id"] = source.get("id") or _source_id(self._normalize_path(source.get("path")), role)
        by_role_path = {
            (self._source_role(item.get("sourceRole")), self._normalize_path(item.get("path"))): item
            for item in existing
            if item.get("path")
        }
        changed = self._ensure_config_roots(existing, by_role_path, self.config_roots, "dataset") or changed
        changed = self._ensure_config_roots(existing, by_role_path, self.config_csv_roots, "initial-csv") or changed
        if changed:
            self._save(existing)

    def _ensure_config_roots(
        self,
        existing: list[dict[str, Any]],
        by_role_path: dict[tuple[str, str], dict[str, Any]],
        roots: list[Path],
        role: SourceRole,
    ) -> bool:
        changed = False
        for idx, root in enumerate(roots):
            normalized = self._normalize_path(root)
            key = (role, normalized)
            if key in by_role_path:
                source = by_role_path[key]
                source["preset"] = True
                source["sourceRole"] = role
                source["sourceKind"] = self._source_kind(role, True)
                source["label"] = source.get("label") or root.name or f"Preset root {idx + 1}"
                changed = True
                continue
            source = {
                "id": _source_id(normalized, role),
                "label": root.name or f"Preset root {idx + 1}",
                "path": normalized,
                "enabled": True,
                "preset": True,
                "sourceRole": role,
                "sourceKind": self._source_kind(role, True),
                "createdAt": _now(),
                "updatedAt": _now(),
            }
            existing.append(source)
            by_role_path[key] = source
            changed = True
        return changed

    def _load(self) -> list[dict[str, Any]]:
        data = read_json(self.path, [])
        if not isinstance(data, list):
            return []
        return [dict(item) for item in data if isinstance(item, dict)]

    def _save(self, sources: list[dict[str, Any]]) -> None:
        write_json_atomic(self.path, sources)

    def _find(self, sources: list[dict[str, Any]], source_id: str) -> dict[str, Any]:
        for source in sources:
            if source.get("id") == source_id:
                return source
        raise KeyError(source_id)

    def _public_source(self, source: dict[str, Any]) -> dict[str, Any]:
        path = Path(str(source.get("path", ""))).expanduser()
        exists = path.exists()
        is_dir = exists and path.is_dir()
        is_file = exists and path.is_file()
        role = self._source_role(source.get("sourceRole"))
        return {
            "id": source.get("id") or _source_id(str(path), role),
            "label": source.get("label") or path.name or str(path),
            "path": str(path),
            "enabled": bool(source.get("enabled", True)),
            "preset": bool(source.get("preset", False)),
            "sourceRole": role,
            "sourceKind": source.get("sourceKind") or self._source_kind(role, bool(source.get("preset", False))),
            "exists": exists,
            "pathKind": "directory" if is_dir else "file" if is_file else "missing",
            "createdAt": source.get("createdAt"),
            "updatedAt": source.get("updatedAt"),
        }

    def _resolve_existing_path(self, path_text: str) -> Path:
        if not path_text.strip():
            raise ValueError("path is required")
        try:
            resolved = Path(path_text).expanduser().resolve(strict=True)
        except FileNotFoundError as exc:
            raise ValueError(f"path does not exist: {path_text}") from exc
        if not resolved.is_dir() and not resolved.is_file():
            raise ValueError("data source must be a directory or file")
        return resolved

    def _normalize_path(self, value: object) -> str:
        try:
            return str(Path(str(value)).expanduser().resolve(strict=False))
        except RuntimeError:
            return str(value)

    def _source_role(self, value: object) -> SourceRole:
        return "initial-csv" if value == "initial-csv" else "dataset"

    def _source_kind(self, role: SourceRole, preset: bool) -> str:
        if role == "initial-csv":
            return "initial-csv-preset" if preset else "initial-csv"
        return "preset" if preset else "tiff-image"


def _source_id(path_text: str, role: SourceRole = "dataset") -> str:
    prefix = "csv_source" if role == "initial-csv" else "source"
    return prefix + "_" + hashlib.sha1(path_text.encode("utf-8")).hexdigest()[:12]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()
