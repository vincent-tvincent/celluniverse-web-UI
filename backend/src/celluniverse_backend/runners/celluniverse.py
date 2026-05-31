from __future__ import annotations

import os
import subprocess
from pathlib import Path

from celluniverse_backend.config.models import BackendConfig


def resolve_threads(config: BackendConfig) -> int:
    configured = config.celluniverse.threads
    hardware = os.cpu_count() or 1
    if configured == "auto":
        return max(1, min(hardware, config.limits.maxThreads))
    return max(1, min(int(configured), config.limits.maxThreads))


def build_tracking_argv(
    config: BackendConfig,
    first_frame: int,
    last_frame: int,
    input_path: str,
    output_dir: Path,
    config_yaml: Path,
    initial_csv: Path,
) -> list[str]:
    return [
        str(config.celluniverse.binary),
        str(first_frame),
        str(last_frame),
        input_path,
        str(output_dir),
        str(config_yaml),
        str(initial_csv),
    ]


def start_celluniverse_process(config: BackendConfig, argv: list[str]) -> subprocess.Popen[str]:
    env = os.environ.copy()
    env["CELLUNIVERSE_THREADS"] = str(resolve_threads(config))
    return subprocess.Popen(
        argv,
        cwd=str(config.celluniverse.celluniverseCppRoot),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
        env=env,
    )
