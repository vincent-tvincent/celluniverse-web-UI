from __future__ import annotations

import os
from pathlib import Path


class PathSecurityError(ValueError):
    pass


def resolve_existing(path: Path) -> Path:
    return path.expanduser().resolve(strict=True)


def resolve_parent_for_pattern(path_text: str) -> tuple[Path, str]:
    expanded = os.path.expanduser(path_text)
    if "%" not in expanded:
        resolved = Path(expanded).resolve(strict=True)
        return resolved, str(resolved)
    raw = Path(expanded)
    parent = raw.parent if str(raw.parent) else Path(".")
    resolved_parent = parent.resolve(strict=True)
    return resolved_parent, str(resolved_parent / raw.name)


def is_relative_to(child: Path, root: Path) -> bool:
    try:
        child.relative_to(root)
        return True
    except ValueError:
        return False


def ensure_inside_roots(path: Path, roots: list[Path]) -> Path:
    resolved = path.expanduser().resolve(strict=True)
    resolved_roots = [root.expanduser().resolve(strict=True) for root in roots if root.expanduser().exists()]
    if any(is_relative_to(resolved, root) for root in resolved_roots):
        return resolved
    raise PathSecurityError(f"path is outside allowed roots: {path}")


def validate_input_reference(path_text: str, roots: list[Path]) -> str:
    check_path, runnable_text = resolve_parent_for_pattern(path_text)
    resolved_roots = [root.expanduser().resolve(strict=True) for root in roots if root.expanduser().exists()]
    if any(is_relative_to(check_path, root) for root in resolved_roots):
        return runnable_text
    raise PathSecurityError(f"input path is outside allowed roots: {path_text}")


def safe_child_path(root: Path, relative_path: str) -> Path:
    if relative_path.startswith("/"):
        raise PathSecurityError("absolute paths are not allowed here")
    root_resolved = root.resolve(strict=True)
    target = (root_resolved / relative_path).resolve(strict=False)
    if not is_relative_to(target, root_resolved):
        raise PathSecurityError(f"path escapes root: {relative_path}")
    return target
