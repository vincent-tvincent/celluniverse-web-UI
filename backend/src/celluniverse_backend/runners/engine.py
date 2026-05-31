from __future__ import annotations

import os

from celluniverse_backend.config.models import BackendConfig
from celluniverse_backend.contracts.models import EngineStatus


def inspect_engine(config: BackendConfig) -> EngineStatus:
    cu = config.celluniverse
    diagnostics: list[str] = []
    root = cu.celluniverseCppRoot
    binary = cu.binary
    for label, path in [
        ("root", root),
        ("CMakeLists.txt", root / "CMakeLists.txt"),
        ("src", root / "src"),
        ("includes", root / "includes"),
        ("config", cu.config_dir),
    ]:
        if not path.exists():
            diagnostics.append(f"missing {label}: {path}")
    if not binary.exists():
        diagnostics.append(f"engine not built or binary missing: {binary}")
    elif not os.access(binary, os.X_OK):
        diagnostics.append(f"binary is not executable: {binary}")

    return EngineStatus(
        ok=not diagnostics,
        root=str(root),
        binary=str(binary),
        configDir=str(cu.config_dir),
        scriptsDir=str(cu.scripts_dir),
        modelsDir=str(cu.models_dir),
        diagnostics=diagnostics,
    )
