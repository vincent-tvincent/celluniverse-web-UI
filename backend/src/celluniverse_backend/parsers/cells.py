from __future__ import annotations

import csv
import re
from collections import defaultdict
from pathlib import Path
from typing import Any


FRAME_RE = re.compile(r"(\d+)")


def frame_from_text(text: str) -> int | None:
    matches = FRAME_RE.findall(text or "")
    if not matches:
        return None
    return int(matches[-1])


def parse_cells_csv(path: Path) -> dict[int, list[dict[str, Any]]]:
    frames: dict[int, list[dict[str, Any]]] = defaultdict(list)
    if not path.exists():
        return {}
    with path.open("r", newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            frame = frame_from_text(row.get("file", ""))
            if frame is None:
                continue
            cell = {
                "file": row.get("file", ""),
                "name": row.get("name", ""),
                "x": _float(row.get("x")),
                "y": _float(row.get("y")),
                "z": _float(row.get("z")),
                "aRadius": _float(row.get("aRadius")),
                "bRadius": _float(row.get("bRadius")),
                "cRadius": _float(row.get("cRadius")),
                "thetaX": _float(row.get("theta_x")),
                "thetaY": _float(row.get("theta_y")),
                "thetaZ": _float(row.get("theta_z")),
                "isTrash": str(row.get("isTrash", "0")).strip() in {"1", "true", "True"},
            }
            frames[frame].append(cell)
    return dict(frames)


def _float(value: str | None) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except ValueError:
        return None


def build_lineage(frames: dict[int, list[dict[str, Any]]]) -> dict[str, Any]:
    seen: dict[str, dict[str, Any]] = {}
    for frame, cells in frames.items():
        for cell in cells:
            name = cell.get("name") or ""
            if not name:
                continue
            node = seen.setdefault(name, {"id": name, "firstFrame": frame, "lastFrame": frame})
            node["firstFrame"] = min(node["firstFrame"], frame)
            node["lastFrame"] = max(node["lastFrame"], frame)

    edges = []
    for name, node in seen.items():
        if len(name) < 2:
            continue
        if name[-1] not in {"0", "1"}:
            continue
        parent = name[:-1]
        if parent in seen:
            node["parent"] = parent
            edges.append({"source": parent, "target": name, "type": "division"})

    return {"nodes": sorted(seen.values(), key=lambda n: (n["firstFrame"], n["id"])), "edges": edges}
