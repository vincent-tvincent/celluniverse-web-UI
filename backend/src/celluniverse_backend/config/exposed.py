from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from pydantic import BaseModel


class ExposedField(BaseModel):
    path: str
    label: str
    type: str
    min: int | float | None = None
    max: int | float | None = None
    values: list[Any] | None = None
    default: Any = None
    ui: str | None = None
    virtual: bool = False


class ExposedGroup(BaseModel):
    id: str
    label: str
    fields: list[ExposedField]


class ExposedParameterModule(BaseModel):
    id: str
    label: str
    baseConfig: str
    groups: list[ExposedGroup]

    def fields_by_path(self) -> dict[str, ExposedField]:
        return {field.path: field for group in self.groups for field in group.fields}


class ExposedParameterRegistry:
    def __init__(self, config_dir: Path):
        self.config_dir = config_dir

    def list_modules(self) -> list[dict[str, str]]:
        modules = []
        for path in sorted(self.config_dir.glob("*.json")):
            module = self.load_module(path.stem)
            modules.append({"id": module.id, "label": module.label})
        return modules

    def load_module(self, module_id: str) -> ExposedParameterModule:
        safe_name = module_id.replace("/", "").replace("\\", "")
        path = self.config_dir / f"{safe_name}.json"
        if not path.exists():
            raise KeyError(f"unknown exposed parameter module: {module_id}")
        return ExposedParameterModule.model_validate(json.loads(path.read_text()))
