from __future__ import annotations

import os
import subprocess
from pathlib import Path

from celluniverse_backend.config.models import BackendConfig

THREAD_ENV_KEYS = [
    "CELLUNIVERSE_THREADS",
    "OMP_NUM_THREADS",
    "OPENCV_FOR_THREADS_NUM",
    "OPENBLAS_NUM_THREADS",
    "MKL_NUM_THREADS",
    "NUMEXPR_NUM_THREADS",
]


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


def start_celluniverse_process(
    config: BackendConfig,
    argv: list[str],
    *,
    stdout_path: Path,
    stderr_path: Path,
) -> subprocess.Popen[bytes]:
    env = os.environ.copy()
    thread_count = str(resolve_threads(config))
    for key in THREAD_ENV_KEYS:
        env[key] = thread_count

    launch_argv = list(argv)
    if config.celluniverse.cpuSet:
        launch_argv = ["taskset", "-c", config.celluniverse.cpuSet, *launch_argv]

    stdout_path.parent.mkdir(parents=True, exist_ok=True)
    stderr_path.parent.mkdir(parents=True, exist_ok=True)
    stdout_handle = stdout_path.open("ab", buffering=0)
    stderr_handle = stderr_path.open("ab", buffering=0)
    try:
        process = subprocess.Popen(
            launch_argv,
            cwd=str(config.celluniverse.celluniverseCppRoot),
            stdin=subprocess.DEVNULL,
            stdout=stdout_handle,
            stderr=stderr_handle,
            env=env,
            start_new_session=True,
            close_fds=True,
        )
    finally:
        stdout_handle.close()
        stderr_handle.close()
    return process
