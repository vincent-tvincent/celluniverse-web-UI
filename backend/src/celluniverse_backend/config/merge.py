from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any

import yaml

from .exposed import ExposedParameterModule


class ConfigValidationError(ValueError):
    pass


def _set_nested(data: dict[str, Any], dotted_path: str, value: Any) -> None:
    parts = dotted_path.split(".")
    current = data
    for part in parts[:-1]:
        if part not in current or not isinstance(current[part], dict):
            current[part] = {}
        current = current[part]
    current[parts[-1]] = value


def _coerce_and_validate(value: Any, field: Any) -> Any:
    if field.type == "integer":
        if isinstance(value, bool):
            raise ConfigValidationError(f"{field.path} must be an integer")
        coerced = int(value)
        if field.min is not None and coerced < field.min:
            raise ConfigValidationError(f"{field.path} must be >= {field.min}")
        if field.max is not None and coerced > field.max:
            raise ConfigValidationError(f"{field.path} must be <= {field.max}")
        return coerced
    if field.type == "number":
        coerced = float(value)
        if field.min is not None and coerced < field.min:
            raise ConfigValidationError(f"{field.path} must be >= {field.min}")
        if field.max is not None and coerced > field.max:
            raise ConfigValidationError(f"{field.path} must be <= {field.max}")
        return coerced
    if field.type == "enum":
        if value not in (field.values or []):
            raise ConfigValidationError(f"{field.path} must be one of {field.values}")
        return value
    if field.type == "boolean":
        if not isinstance(value, bool):
            raise ConfigValidationError(f"{field.path} must be boolean")
        return value
    raise ConfigValidationError(f"unsupported field type for {field.path}: {field.type}")


def _apply_pipeline(data: dict[str, Any], mode: str) -> None:
    if mode == "standard":
        _set_nested(data, "cell_lumen.enabled", False)
        _set_nested(data, "cell_lumen.fusionEnabled", False)
        _set_nested(data, "simulation.quit_after_preprocessing", False)
    elif mode == "cell_lumen_fusion":
        _set_nested(data, "cell_lumen.enabled", True)
        _set_nested(data, "cell_lumen.fusionEnabled", True)
        _set_nested(data, "simulation.quit_after_preprocessing", False)
    elif mode == "preprocess_only":
        _set_nested(data, "simulation.quit_after_preprocessing", True)
    else:
        raise ConfigValidationError(f"unknown pipeline mode: {mode}")


def materialize_effective_config(
    base_config: Path,
    destination: Path,
    module: ExposedParameterModule,
    overrides: dict[str, Any],
) -> None:
    if not base_config.exists():
        raise ConfigValidationError(f"base config does not exist: {base_config}")
    fields = module.fields_by_path()
    unknown = sorted(set(overrides) - set(fields))
    if unknown:
        raise ConfigValidationError(f"override paths are not exposed: {unknown}")

    with base_config.open("r", encoding="utf-8") as handle:
        data = yaml.safe_load(handle) or {}
    if not isinstance(data, dict):
        raise ConfigValidationError("base config YAML must be a mapping")

    for path, raw_value in overrides.items():
        field = fields[path]
        value = _coerce_and_validate(raw_value, field)
        if field.virtual and path == "pipeline.mode":
            _apply_pipeline(data, value)
        elif field.virtual:
            raise ConfigValidationError(f"unsupported virtual field: {path}")
        else:
            _set_nested(data, path, value)

    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open("w", encoding="utf-8") as handle:
        yaml.safe_dump(data, handle, sort_keys=False)


def copy_config_as_effective(source: Path, destination: Path) -> None:
    if not source.exists():
        raise ConfigValidationError(f"config file does not exist: {source}")
    with source.open("r", encoding="utf-8") as handle:
        yaml.safe_load(handle)
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)
