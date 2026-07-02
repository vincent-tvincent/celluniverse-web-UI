from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any

import yaml

from .exposed import ExposedParameterModule


class ConfigValidationError(ValueError):
    pass


PIPELINE_BASE_CONFIGS = {
    "celluniverse3": "config_celluniverse3_server_ram.yaml",
}


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
        _set_nested(data, "simulation.celluniverse2_enabled", False)
        _set_nested(data, "simulation.celluniverse3_enabled", False)
    elif mode == "cell_lumen_fusion":
        _set_nested(data, "cell_lumen.enabled", True)
        _set_nested(data, "cell_lumen.fusionEnabled", True)
        _set_nested(data, "simulation.quit_after_preprocessing", False)
        _set_nested(data, "simulation.celluniverse2_enabled", False)
        _set_nested(data, "simulation.celluniverse3_enabled", False)
    elif mode == "celluniverse3":
        _set_nested(data, "cell_lumen.enabled", False)
        _set_nested(data, "cell_lumen.fusionEnabled", False)
        _set_nested(data, "simulation.quit_after_preprocessing", False)
        _set_nested(data, "simulation.celluniverse2_enabled", True)
        _set_nested(data, "simulation.celluniverse3_enabled", True)
    elif mode == "preprocess_only":
        _set_nested(data, "simulation.quit_after_preprocessing", True)
        _set_nested(data, "simulation.celluniverse2_enabled", False)
        _set_nested(data, "simulation.celluniverse3_enabled", False)
    else:
        raise ConfigValidationError(f"unknown pipeline mode: {mode}")


def _read_yaml_mapping(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        data = yaml.safe_load(handle) or {}
    if not isinstance(data, dict):
        raise ConfigValidationError(f"config YAML must be a mapping: {path}")
    return data


def _resolve_base_config_path(path: Path, base_config: str, config_search_dir: Path | None = None) -> Path:
    base_path = Path(base_config)
    if base_path.is_absolute():
        return base_path
    local_path = path.parent / base_path
    if local_path.exists() or config_search_dir is None:
        return local_path
    search_path = config_search_dir / base_path
    if search_path.exists():
        return search_path
    return local_path


def _copy_base_config_chain(
    config_path: Path,
    destination_dir: Path,
    config_search_dir: Path | None = None,
    seen: set[Path] | None = None,
) -> None:
    seen = seen or set()
    resolved = config_path.resolve()
    if resolved in seen:
        raise ConfigValidationError(f"cyclic base_config reference: {config_path}")
    seen.add(resolved)

    data = _read_yaml_mapping(config_path)
    base_config = data.get("base_config")
    if not base_config:
        return
    if not isinstance(base_config, str):
        raise ConfigValidationError(f"base_config must be a string in {config_path}")

    base_path = _resolve_base_config_path(config_path, base_config, config_search_dir)
    if not base_path.exists():
        raise ConfigValidationError(f"base config does not exist: {base_path}")
    if base_path.name == "effective-config.yaml":
        raise ConfigValidationError("base_config may not point to effective-config.yaml")

    destination_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(base_path, destination_dir / base_path.name)
    _copy_base_config_chain(base_path, destination_dir, config_search_dir, seen)


def _select_base_config(
    base_config: Path,
    overrides: dict[str, Any],
    config_search_dir: Path | None = None,
    use_pipeline_base_config: bool = True,
) -> Path:
    mode = overrides.get("pipeline.mode")
    if not use_pipeline_base_config or not isinstance(mode, str) or mode not in PIPELINE_BASE_CONFIGS:
        return base_config
    selected_root = config_search_dir or base_config.parent
    selected = selected_root / PIPELINE_BASE_CONFIGS[mode]
    if not selected.exists():
        raise ConfigValidationError(f"pipeline {mode} base config does not exist: {selected}")
    return selected


def materialize_effective_config(
    base_config: Path,
    destination: Path,
    module: ExposedParameterModule,
    overrides: dict[str, Any],
    *,
    config_search_dir: Path | None = None,
    use_pipeline_base_config: bool = True,
) -> None:
    base_config = _select_base_config(base_config, overrides, config_search_dir, use_pipeline_base_config)
    if not base_config.exists():
        raise ConfigValidationError(f"base config does not exist: {base_config}")
    fields = module.fields_by_path()
    unknown = sorted(set(overrides) - set(fields))
    if unknown:
        raise ConfigValidationError(f"override paths are not exposed: {unknown}")

    data = _read_yaml_mapping(base_config)

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
    _copy_base_config_chain(base_config, destination.parent, config_search_dir)
    with destination.open("w", encoding="utf-8") as handle:
        yaml.safe_dump(data, handle, sort_keys=False)


def copy_config_as_effective(source: Path, destination: Path) -> None:
    if not source.exists():
        raise ConfigValidationError(f"config file does not exist: {source}")
    with source.open("r", encoding="utf-8") as handle:
        yaml.safe_load(handle)
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)
