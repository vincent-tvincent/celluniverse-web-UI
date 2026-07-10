from __future__ import annotations

import getpass
import re
import shlex
import shutil
import subprocess
from pathlib import Path

from celluniverse_backend.config.models import BackendConfig
from celluniverse_backend.contracts.models import SlurmJobOptions, SlurmStatus
from celluniverse_backend.runners.celluniverse import THREAD_ENV_KEYS, resolve_threads


SLURM_ID_RE = re.compile(r"^(\d+)")


SLURM_CONF_PATH = Path("/etc/slurm/slurm.conf")


def _slurm_bin_dir_from_config() -> Path | None:
    try:
        lines = SLURM_CONF_PATH.read_text(encoding="utf-8").splitlines()
    except OSError:
        return None
    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        if key.strip() != "PluginDir":
            continue
        plugin_dir = Path(value.strip())
        candidate = plugin_dir.parent.parent / "bin"
        return candidate if candidate.exists() else None
    return None


def _resolve_slurm_command(name: str, preferred_bin_dir: Path | None) -> str | None:
    if preferred_bin_dir:
        candidate = preferred_bin_dir / name
        if candidate.exists() and candidate.is_file():
            return str(candidate)
    return shutil.which(name)


def inspect_slurm() -> SlurmStatus:
    preferred_bin_dir = _slurm_bin_dir_from_config()
    sbatch = _resolve_slurm_command("sbatch", preferred_bin_dir)
    squeue = _resolve_slurm_command("squeue", preferred_bin_dir)
    scancel = _resolve_slurm_command("scancel", preferred_bin_dir)
    sacct = _resolve_slurm_command("sacct", preferred_bin_dir)
    diagnostics: list[str] = []
    if preferred_bin_dir:
        diagnostics.append(f"using Slurm client directory from PluginDir: {preferred_bin_dir}")
    if not sbatch:
        diagnostics.append("sbatch was not found on PATH or in the configured Slurm client directory")
    if not squeue:
        diagnostics.append("squeue was not found on PATH or in the configured Slurm client directory")
    if not scancel:
        diagnostics.append("scancel was not found on PATH or in the configured Slurm client directory")
    if not sacct:
        diagnostics.append("sacct was not found; completed Slurm state will use the job exit marker")
    return SlurmStatus(
        available=bool(sbatch and squeue and scancel),
        sbatch=sbatch,
        squeue=squeue,
        scancel=scancel,
        sacct=sacct,
        diagnostics=diagnostics,
    )


def normalize_slurm_options(options: SlurmJobOptions) -> SlurmJobOptions:
    account = _valid_account_for_user(options.account)
    if account == options.account:
        return options
    return options.model_copy(update={"account": account})


def _valid_account_for_user(requested: str | None) -> str | None:
    associations = _slurm_accounts_for_user()
    if not associations:
        return requested
    cleaned = requested.strip() if requested else None
    if cleaned and cleaned in associations:
        return cleaned
    return associations[0]


def _slurm_accounts_for_user() -> list[str]:
    preferred_bin_dir = _slurm_bin_dir_from_config()
    sacctmgr = _resolve_slurm_command("sacctmgr", preferred_bin_dir)
    if not sacctmgr:
        return []
    result = subprocess.run(
        [sacctmgr, "-n", "-P", "show", "assoc", f"user={getpass.getuser()}", "format=Account"],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        return []
    accounts: list[str] = []
    for line in result.stdout.splitlines():
        account = line.strip().split("|", 1)[0].strip()
        if account and account not in accounts:
            accounts.append(account)
    return accounts


def write_slurm_script(
    config: BackendConfig,
    argv: list[str],
    *,
    job_dir: Path,
    stdout_path: Path,
    stderr_path: Path,
    options: SlurmJobOptions,
) -> Path:
    job_name = _clean_job_name(options.jobName or job_dir.name)
    exit_path = job_dir / "slurm-exit-code.txt"
    marker_path = job_dir / "slurm-started.txt"
    thread_count = str(min(int(options.cpusPerTask), resolve_threads(config), config.limits.maxThreads))
    ld_library_path = _ld_library_path(config)
    lines = [
        "#!/usr/bin/env bash",
        f"#SBATCH --job-name={job_name}",
        f"#SBATCH --nodes={options.nodes}",
        f"#SBATCH --cpus-per-task={options.cpusPerTask}",
        f"#SBATCH --mem={options.memory}",
        f"#SBATCH --time={options.timeLimit}",
        f"#SBATCH --output={stdout_path}",
        f"#SBATCH --error={stderr_path}",
    ]
    for key, value in [
        ("partition", options.partition),
        ("account", options.account),
        ("qos", options.qos),
        ("nodelist", options.nodelist),
    ]:
        if value:
            lines.append(f"#SBATCH --{key}={value}")
    lines.extend([
        "",
        "set +e",
        f"cd {shlex.quote(str(config.celluniverse.celluniverseCppRoot))}",
        f"echo \"$(date -Is)\" > {shlex.quote(str(marker_path))}",
    ])
    for key in THREAD_ENV_KEYS:
        lines.append(f"export {key}={shlex.quote(thread_count)}")
    if ld_library_path:
        lines.append(f"export LD_LIBRARY_PATH={shlex.quote(ld_library_path)}${{LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}}")
    quoted_argv = " ".join(shlex.quote(part) for part in argv)
    lines.extend([
        quoted_argv,
        "exit_code=$?",
        f"echo \"$exit_code\" > {shlex.quote(str(exit_path))}",
        "exit \"$exit_code\"",
        "",
    ])
    script_path = job_dir / "run-slurm.sbatch"
    script_path.write_text("\n".join(lines), encoding="utf-8")
    script_path.chmod(0o750)
    return script_path


def submit_slurm_job(script_path: Path) -> str:
    status = inspect_slurm()
    if not status.sbatch:
        raise RuntimeError("Slurm is not available: sbatch was not found on PATH")
    result = subprocess.run(
        [status.sbatch, "--parsable", str(script_path)],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "sbatch failed").strip()
        raise RuntimeError(f"Slurm submission failed: {detail}")
    raw = result.stdout.strip()
    match = SLURM_ID_RE.match(raw)
    if not match:
        raise RuntimeError(f"Slurm submission did not return a job id: {raw}")
    return match.group(1)


def slurm_job_state(slurm_job_id: str) -> str | None:
    status = inspect_slurm()
    if not status.squeue:
        return None
    result = subprocess.run(
        [status.squeue, "-h", "-j", slurm_job_id, "-o", "%T"],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        return None
    states = [line.strip() for line in result.stdout.splitlines() if line.strip()]
    return states[0] if states else None


def cancel_slurm_job(slurm_job_id: str) -> None:
    status = inspect_slurm()
    if not status.scancel:
        raise RuntimeError("Slurm cancel failed: scancel was not found on PATH")
    subprocess.run([status.scancel, slurm_job_id], check=False, capture_output=True, text=True)


def _clean_job_name(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_.-]+", "_", value.strip())
    return (cleaned or "celluniverse")[:80]


def _ld_library_path(config: BackendConfig) -> str:
    cpp_root = config.celluniverse.celluniverseCppRoot
    paths = [
        cpp_root / "external" / "libtorch" / "lib",
        cpp_root / "external" / "opencv" / "lib",
        cpp_root / "build" / "lib",
        cpp_root / "lib",
        config.celluniverse.binary.parent,
    ]
    return ":".join(str(path) for path in paths if path.exists())
