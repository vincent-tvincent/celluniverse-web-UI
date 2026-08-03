from __future__ import annotations

import getpass
import json
import re
import shlex
import shutil
import subprocess
from pathlib import Path

from celluniverse_backend.config.models import BackendConfig
from celluniverse_backend.contracts.models import (
    SlurmJobOptions,
    SlurmNode,
    SlurmNodesResponse,
    SlurmStatus,
)
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


def inspect_slurm_nodes() -> SlurmNodesResponse:
    preferred_bin_dir = _slurm_bin_dir_from_config()
    sinfo = _resolve_slurm_command("sinfo", preferred_bin_dir)
    if not sinfo:
        return SlurmNodesResponse(
            available=False,
            diagnostics=["sinfo was not found on PATH or in the configured Slurm client directory"],
        )
    try:
        json_result = subprocess.run(
            [sinfo, "--json"],
            check=False,
            capture_output=True,
            text=True,
            timeout=5,
        )
    except subprocess.TimeoutExpired:
        return SlurmNodesResponse(
            available=False,
            sinfo=sinfo,
            diagnostics=["sinfo timed out while reading the Slurm machine inventory"],
        )
    except OSError:
        return SlurmNodesResponse(
            available=False,
            sinfo=sinfo,
            diagnostics=["sinfo could not read the Slurm machine inventory"],
        )
    if json_result.returncode == 0:
        try:
            nodes, diagnostics = _parse_slurm_nodes_json(json_result.stdout)
        except (TypeError, ValueError, json.JSONDecodeError):
            pass
        else:
            return SlurmNodesResponse(
                available=True,
                sinfo=sinfo,
                nodes=nodes,
                diagnostics=diagnostics,
            )
    try:
        text_result = subprocess.run(
            [
                sinfo,
                "-h",
                "-N",
                "-o",
                "%N|%P|%T|%c|%C|%m|%G|%E",
            ],
            check=False,
            capture_output=True,
            text=True,
            timeout=5,
        )
    except subprocess.TimeoutExpired:
        return SlurmNodesResponse(
            available=False,
            sinfo=sinfo,
            diagnostics=["sinfo timed out while reading the Slurm machine inventory"],
        )
    except OSError:
        return SlurmNodesResponse(
            available=False,
            sinfo=sinfo,
            diagnostics=["sinfo could not read the Slurm machine inventory"],
        )
    if text_result.returncode != 0:
        return SlurmNodesResponse(
            available=False,
            sinfo=sinfo,
            diagnostics=["sinfo failed to return a readable Slurm machine inventory"],
        )
    return SlurmNodesResponse(
        available=True,
        sinfo=sinfo,
        nodes=_parse_slurm_nodes(text_result.stdout),
    )


def _parse_slurm_nodes_json(output: str) -> tuple[list[SlurmNode], list[str]]:
    payload = json.loads(output)
    if not isinstance(payload, dict):
        raise ValueError("sinfo JSON response must be an object")
    raw_nodes = payload.get("nodes")
    if not isinstance(raw_nodes, list):
        raise ValueError("sinfo JSON response is missing nodes")
    nodes_by_name: dict[str, SlurmNode] = {}
    for raw_node in raw_nodes[:10_000]:
        if not isinstance(raw_node, dict):
            continue
        name = str(raw_node.get("name") or "").strip()
        if not name:
            continue
        raw_partitions = raw_node.get("partitions")
        partitions = (
            [str(partition).strip().rstrip("*") for partition in raw_partitions if str(partition).strip()]
            if isinstance(raw_partitions, list)
            else []
        )
        state = str(raw_node.get("state") or "unknown").strip().lower()
        raw_flags = raw_node.get("state_flags")
        flags = (
            [str(flag).strip().lower() for flag in raw_flags if str(flag).strip()]
            if isinstance(raw_flags, list)
            else []
        )
        cpus_total = _parse_int(raw_node.get("cpus"))
        cpus_allocated = _parse_int(raw_node.get("alloc_cpus"))
        cpus_idle = _parse_int(raw_node.get("idle_cpus"))
        cpus_other = None
        if cpus_total is not None and cpus_allocated is not None and cpus_idle is not None:
            cpus_other = max(0, cpus_total - cpus_allocated - cpus_idle)
        node = SlurmNode(
            name=name,
            partitions=list(dict.fromkeys(partitions)),
            state=state,
            cpusTotal=cpus_total,
            cpusAllocated=cpus_allocated,
            cpusIdle=cpus_idle,
            cpusOther=cpus_other,
            memoryMb=_parse_int(raw_node.get("real_memory")),
            gres=_nullish_slurm_value(raw_node.get("gres")),
            reason=_nullish_slurm_value(raw_node.get("reason")),
            selectable=_is_node_selectable(state, flags),
        )
        nodes_by_name[name] = node
    raw_errors = payload.get("errors")
    diagnostics = (
        [f"sinfo reported {len(raw_errors)} machine inventory error(s)"]
        if isinstance(raw_errors, list) and raw_errors
        else []
    )
    return (
        sorted(nodes_by_name.values(), key=lambda node: _natural_node_key(node.name)),
        diagnostics,
    )


def _parse_slurm_nodes(output: str) -> list[SlurmNode]:
    nodes_by_name: dict[str, SlurmNode] = {}
    for line in output.splitlines():
        parts = [part.strip() for part in line.split("|", 7)]
        if len(parts) != 8:
            continue
        name, partition, raw_state, raw_cpus, raw_breakdown, raw_memory, raw_gres, raw_reason = parts
        if not name:
            continue
        state = re.sub(r"[^A-Za-z_-].*$", "", raw_state).lower() or "unknown"
        state_is_decorated = raw_state.lower() != state
        cpus_allocated, cpus_idle, cpus_other, breakdown_total = _parse_cpu_breakdown(raw_breakdown)
        node = SlurmNode(
            name=name,
            partitions=[partition.rstrip("*")] if partition else [],
            state=state,
            cpusTotal=_parse_int(raw_cpus) or breakdown_total,
            cpusAllocated=cpus_allocated,
            cpusIdle=cpus_idle,
            cpusOther=cpus_other,
            memoryMb=_parse_int(raw_memory),
            gres=_nullish_slurm_value(raw_gres),
            reason=_nullish_slurm_value(raw_reason),
            selectable=_is_node_selectable(state) and not state_is_decorated,
        )
        existing = nodes_by_name.get(name)
        if existing is None:
            nodes_by_name[name] = node
            continue
        for node_partition in node.partitions:
            if node_partition not in existing.partitions:
                existing.partitions.append(node_partition)
        if node.selectable and not existing.selectable:
            node.partitions = existing.partitions
            nodes_by_name[name] = node
    return sorted(nodes_by_name.values(), key=lambda node: _natural_node_key(node.name))


def _parse_cpu_breakdown(value: str) -> tuple[int | None, int | None, int | None, int | None]:
    parts = value.split("/")
    if len(parts) != 4:
        return None, None, None, None
    parsed = tuple(_parse_int(part) for part in parts)
    return parsed[0], parsed[1], parsed[2], parsed[3]


def _parse_int(value: object) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _nullish_slurm_value(value: object) -> str | None:
    normalized = str(value or "").strip()
    return None if normalized.lower() in {"", "none", "(null)", "n/a"} else normalized


def _is_node_selectable(state: str, flags: list[str] | None = None) -> bool:
    blocking_flags = {
        "drain",
        "fail",
        "invalid",
        "maint",
        "not_responding",
        "power_down",
        "reboot_requested",
    }
    return (
        state in {"allocated", "completing", "idle", "mixed"}
        and not blocking_flags.intersection(flags or [])
    )


def _natural_node_key(value: str) -> tuple[tuple[int, str | int], ...]:
    return tuple(
        (1, int(part)) if part.isdigit() else (0, part.lower())
        for part in re.split(r"(\d+)", value)
        if part
    )


def normalize_slurm_options(options: SlurmJobOptions) -> SlurmJobOptions:
    account = _valid_account_for_user(options.account)
    if account == options.account:
        return options
    return options.model_copy(update={"account": account})


def validate_slurm_machine(options: SlurmJobOptions) -> SlurmJobOptions:
    machine = options.nodelist
    if not machine:
        return options
    if options.nodes != 1:
        raise ValueError("A specific Slurm machine requires a node count of 1")
    inventory = inspect_slurm_nodes()
    if not inventory.available:
        detail = "; ".join(inventory.diagnostics) or "machine inventory is unavailable"
        raise ValueError(f"Cannot validate Slurm machine {machine!r}: {detail}")
    node = next((candidate for candidate in inventory.nodes if candidate.name == machine), None)
    if node is None:
        raise ValueError(f"Unknown Slurm machine: {machine}")
    if not node.selectable:
        raise ValueError(f"Slurm machine {machine} is currently unavailable ({node.state})")
    if node.cpusTotal is not None and options.cpusPerTask > node.cpusTotal:
        raise ValueError(
            f"Slurm machine {machine} has {node.cpusTotal} CPUs, "
            f"but {options.cpusPerTask} CPUs per task were requested"
        )
    requested_memory_mb = _parse_memory_mb(options.memory)
    if (
        node.memoryMb is not None
        and requested_memory_mb is not None
        and requested_memory_mb > node.memoryMb
    ):
        raise ValueError(
            f"Slurm machine {machine} has {node.memoryMb} MB of memory, "
            f"but {options.memory} was requested"
        )
    if options.partition and node.partitions and options.partition not in node.partitions:
        raise ValueError(
            f"Slurm machine {machine} is not in partition {options.partition}; "
            f"available partitions: {', '.join(node.partitions)}"
        )
    if not options.partition and len(node.partitions) == 1:
        return options.model_copy(update={"partition": node.partitions[0]})
    return options


def _parse_memory_mb(value: str) -> int | None:
    match = re.fullmatch(r"(\d+(?:\.\d+)?)([KMGTP]?)", value.upper())
    if not match:
        return None
    amount = float(match.group(1))
    factor = {
        "": 1,
        "K": 1 / 1024,
        "M": 1,
        "G": 1024,
        "T": 1024 * 1024,
        "P": 1024 * 1024 * 1024,
    }[match.group(2)]
    return int(amount * factor + 0.999999)


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


def slurm_job_state(slurm_job_id: str, *, strict: bool = False) -> str | None:
    status = inspect_slurm()
    if not status.squeue:
        if strict:
            raise RuntimeError("Slurm state query failed: squeue was not found")
        return None
    try:
        result = subprocess.run(
            [status.squeue, "-h", "-j", slurm_job_id, "-o", "%T"],
            check=False,
            capture_output=True,
            text=True,
            timeout=5,
        )
    except subprocess.TimeoutExpired as exc:
        if strict:
            raise RuntimeError(f"Slurm state query timed out for job {slurm_job_id}") from exc
        return None
    except OSError as exc:
        if strict:
            raise RuntimeError(
                f"Slurm state query could not start for job {slurm_job_id}: {exc}"
            ) from exc
        return None
    if result.returncode != 0:
        if strict:
            detail = " ".join((result.stderr or result.stdout or "").split())
            suffix = detail or f"squeue exited with code {result.returncode}"
            raise RuntimeError(f"Slurm state query failed for job {slurm_job_id}: {suffix}")
        return None
    states = [line.strip() for line in result.stdout.splitlines() if line.strip()]
    return states[0] if states else None


def slurm_job_accounting_state(
    slurm_job_id: str,
    *,
    strict: bool = False,
) -> str | None:
    status = inspect_slurm()
    if not status.sacct:
        if strict:
            raise RuntimeError("Slurm accounting query failed: sacct was not found")
        return None
    try:
        result = subprocess.run(
            [
                status.sacct,
                "-n",
                "-j",
                slurm_job_id,
                "--format=JobIDRaw,State",
                "--parsable2",
            ],
            check=False,
            capture_output=True,
            text=True,
            timeout=5,
        )
    except subprocess.TimeoutExpired as exc:
        if strict:
            raise RuntimeError(
                f"Slurm accounting query timed out for job {slurm_job_id}"
            ) from exc
        return None
    except OSError as exc:
        if strict:
            raise RuntimeError(
                f"Slurm accounting query could not start for job {slurm_job_id}: {exc}"
            ) from exc
        return None
    if result.returncode != 0:
        if strict:
            detail = " ".join((result.stderr or result.stdout or "").split())
            suffix = detail or f"sacct exited with code {result.returncode}"
            raise RuntimeError(
                f"Slurm accounting query failed for job {slurm_job_id}: {suffix}"
            )
        return None
    for line in result.stdout.splitlines():
        parts = [part.strip() for part in line.split("|")]
        if len(parts) < 2 or parts[0] != slurm_job_id or not parts[1]:
            continue
        return re.split(r"[\s+]", parts[1], maxsplit=1)[0].upper()
    return None


def cancel_slurm_job(slurm_job_id: str) -> None:
    status = inspect_slurm()
    if not status.scancel:
        raise RuntimeError("Slurm cancel failed: scancel was not found on PATH")
    try:
        result = subprocess.run(
            [status.scancel, slurm_job_id],
            check=False,
            capture_output=True,
            text=True,
            timeout=10,
        )
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(f"Slurm cancel timed out for job {slurm_job_id}") from exc
    except OSError as exc:
        raise RuntimeError(f"Slurm cancel could not start for job {slurm_job_id}: {exc}") from exc
    if result.returncode != 0:
        detail = " ".join((result.stderr or result.stdout or "").split())
        if len(detail) > 500:
            detail = detail[:497] + "..."
        suffix = detail or f"scancel exited with code {result.returncode}"
        raise RuntimeError(f"Slurm cancel failed for job {slurm_job_id}: {suffix}")


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
