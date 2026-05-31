from __future__ import annotations

import json
import os
from pathlib import Path

from .models import BackendConfig


REPO_BACKEND_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_CONFIG_PATH = REPO_BACKEND_ROOT / "config" / "backend.config.example.json"


def load_backend_config() -> BackendConfig:
    configured = os.environ.get("CELLUNIVERSE_BACKEND_CONFIG")
    path = Path(configured).expanduser() if configured else DEFAULT_CONFIG_PATH
    if path.exists():
        data = json.loads(path.read_text())
        return BackendConfig.model_validate(data).normalized()
    return BackendConfig().normalized()
