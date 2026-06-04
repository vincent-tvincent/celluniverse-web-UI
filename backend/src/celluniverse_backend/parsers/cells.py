from __future__ import annotations

import csv
import math
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
    active_by_frame: dict[int, set[str]] = defaultdict(set)
    observed_frames: dict[str, set[int]] = defaultdict(set)
    latest_cell: dict[str, dict[str, Any]] = {}
    nodes: dict[str, dict[str, Any]] = {}

    for frame, cells in sorted(frames.items()):
        for cell in cells:
            name = cell.get("name") or ""
            if not name or cell.get("isTrash"):
                continue
            active_by_frame[frame].add(name)
            observed_frames[name].add(frame)
            latest_cell[name] = cell
            for ancestor in lineage_chain(name):
                node = _ensure_lineage_node(nodes, ancestor)
                node["firstFrame"] = min(node["firstFrame"], frame)
                node["lastFrame"] = max(node["lastFrame"], frame)

    for name, frame_set in observed_frames.items():
        node = _ensure_lineage_node(nodes, name)
        node["observedFrames"] = sorted(frame_set)
        node["lastCell"] = _lineage_cell_payload(latest_cell.get(name, {}))

    for node in nodes.values():
        parent = node.get("parentId")
        if parent and parent in nodes:
            nodes[parent]["children"].add(node["id"])

    edges = [
        {
            "id": f"{node['parentId']}->{node['id']}",
            "source": node["parentId"],
            "target": node["id"],
            "type": "division",
            "frame": node["firstFrame"],
        }
        for node in nodes.values()
        if node.get("parentId") and node["parentId"] in nodes
    ]

    node_list = []
    for node in nodes.values():
        node_list.append({
            **node,
            "children": sorted(node["children"], key=natural_key),
            "observedFrames": node.get("observedFrames", []),
            "lastCell": node.get("lastCell"),
        })

    frame_list = sorted(frames)
    return {
        "source": "cells.csv",
        "frames": frame_list,
        "firstFrame": frame_list[0] if frame_list else None,
        "lastFrame": frame_list[-1] if frame_list else None,
        "nodes": sorted(node_list, key=lambda n: (n["firstFrame"], n["rootId"], n["code"], n["id"])),
        "edges": sorted(edges, key=lambda e: (e["frame"], e["source"], e["target"])),
        "roots": sorted([node["id"] for node in node_list if not node.get("parentId")], key=natural_key),
        "activeByFrame": {str(frame): sorted(names, key=natural_key) for frame, names in active_by_frame.items()},
    }


def build_lineage_snapshot(lineage: dict[str, Any], frame: int) -> dict[str, Any]:
    nodes = {node["id"]: node for node in lineage.get("nodes", [])}
    visible_nodes = [
        node_id
        for node_id, node in nodes.items()
        if _frame_or_default(node.get("firstFrame"), frame + 1) <= frame
    ]
    visible_set = set(visible_nodes)
    visible_edges = [
        edge
        for edge in lineage.get("edges", [])
        if edge.get("source") in visible_set and edge.get("target") in visible_set
    ]
    active_by_frame = lineage.get("activeByFrame", {})
    source_frame = frame if str(frame) in active_by_frame else _nearest_previous_frame(active_by_frame, frame)
    active_nodes = active_by_frame.get(str(source_frame), []) if source_frame is not None else []
    return {
        "frame": frame,
        "sourceFrame": source_frame,
        "missingFrameData": source_frame != frame,
        "visibleNodes": sorted(visible_nodes, key=natural_key),
        "visibleEdges": visible_edges,
        "activeNodes": sorted([name for name in active_nodes if name in visible_set], key=natural_key),
    }


def build_lineage_layout(lineage: dict[str, Any], background: str = "#070a0f") -> dict[str, Any]:
    nodes = {node["id"]: dict(node) for node in lineage.get("nodes", [])}
    frames = [int(frame) for frame in lineage.get("frames", [])]
    if not nodes:
        return {
            "mode": "radial-time-v1",
            "background": background,
            "center": {"x": 0, "y": 0},
            "ringSpacing": 28,
            "rings": [],
            "nodes": {},
            "edges": [],
        }

    first_frame = min(frames) if frames else min(int(node["firstFrame"]) for node in nodes.values())
    last_frame = max(frames) if frames else max(int(node["lastFrame"]) for node in nodes.values())
    ring_spacing = 28
    inner_radius = 42
    roots = sorted(
        [node_id for node_id, node in nodes.items() if not node.get("parentId")],
        key=natural_key,
    )
    root_colors = assign_root_colors(roots, background)
    angles = _assign_radial_angles(nodes, roots)

    layout_nodes: dict[str, dict[str, Any]] = {}
    for node_id, node in nodes.items():
        first = int(node.get("firstFrame") if node.get("firstFrame") is not None else first_frame)
        radius = inner_radius + max(0, first - first_frame) * ring_spacing
        angle = angles.get(node_id, 0.0)
        color = root_colors.get(str(node.get("rootId")), "#d9f99d")
        layout_nodes[node_id] = {
            "id": node_id,
            "label": node_id,
            "compactLabel": compact_lineage_label(node),
            "angle": angle,
            "radius": radius,
            "radiusFrame": first,
            "x": radius * math.cos(angle),
            "y": radius * math.sin(angle),
            "color": color,
            "rootId": node.get("rootId"),
            "depth": node.get("depth", 0),
        }

    rings = [
        {"frame": frame, "radius": inner_radius + max(0, frame - first_frame) * ring_spacing}
        for frame in range(first_frame, last_frame + 1)
    ]
    layout_edges = _build_lineage_layout_edges(lineage.get("edges", []), layout_nodes, ring_spacing)
    return {
        "mode": "radial-time-v2",
        "background": background,
        "center": {"x": 0, "y": 0},
        "innerRadius": inner_radius,
        "ringSpacing": ring_spacing,
        "firstFrame": first_frame,
        "lastFrame": last_frame,
        "rings": rings,
        "nodes": layout_nodes,
        "edges": layout_edges,
    }


def _build_lineage_layout_edges(
    edges: list[dict[str, Any]],
    layout_nodes: dict[str, dict[str, Any]],
    ring_spacing: int,
) -> list[dict[str, Any]]:
    layout_edges: list[dict[str, Any]] = []
    for edge in edges:
        source = layout_nodes.get(str(edge.get("source")))
        target = layout_nodes.get(str(edge.get("target")))
        routed = dict(edge)
        if source and target:
            outward = max(0.0, float(target["radius"]) - float(source["radius"]))
            # Split branches close to their parent instead of drawing every
            # sibling edge on the same long radial segment until child birth.
            split = min(
                outward,
                max(float(ring_spacing) * 0.75, min(float(ring_spacing) * 1.5, outward * 0.28)),
            )
            routed["routeRadius"] = float(source["radius"]) + split
        layout_edges.append(routed)
    return layout_edges


def lineage_parts(name: str) -> tuple[str, str]:
    if "_" in name:
        prefix, code = name.rsplit("_", 1)
        return f"{prefix}_", code
    match = re.search(r"[01]+$", name)
    if not match:
        return name, ""
    return name[:match.start()], match.group(0)


def parent_name(name: str) -> str | None:
    prefix, code = lineage_parts(name)
    if not code or code[-1] not in {"0", "1"} or len(code) <= 1:
        return None
    return f"{prefix}{code[:-1]}"


def root_name(name: str) -> str:
    prefix, code = lineage_parts(name)
    if not code:
        return name
    return f"{prefix}{code[0]}"


def lineage_chain(name: str) -> list[str]:
    chain = [name]
    current = name
    while True:
        parent = parent_name(current)
        if not parent:
            break
        chain.append(parent)
        current = parent
    return chain


def natural_key(value: Any) -> list[Any]:
    return [int(part) if part.isdigit() else part.lower() for part in re.split(r"(\d+)", str(value))]


def compact_lineage_label(node: dict[str, Any]) -> str:
    code = str(node.get("code") or node.get("id") or "")
    if len(code) <= 5:
        return str(node.get("id") or "")
    return f"...{code[-5:]}"


def assign_root_colors(roots: list[str], background: str = "#070a0f") -> dict[str, str]:
    # Start with large, readable categorical sets commonly used for plots, then
    # extend deterministically. This avoids the original demo's four-color loop.
    palette = [
        "#4e79a7", "#f28e2b", "#e15759", "#76b7b2", "#59a14f",
        "#edc949", "#af7aa1", "#ff9da7", "#9c755f", "#bab0ac",
        "#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd",
        "#8c564b", "#e377c2", "#7f7f7f", "#bcbd22", "#17becf",
        "#0072b2", "#d55e00", "#009e73", "#cc79a7", "#56b4e9",
        "#e69f00", "#f0e442", "#b07aa1", "#499894", "#86bcb6",
    ]
    colors: dict[str, str] = {}
    bg_luminance = _relative_luminance(background)
    for index, root in enumerate(roots):
        candidate = palette[index] if index < len(palette) else _generated_color(index)
        if abs(_relative_luminance(candidate) - bg_luminance) < 0.34:
            candidate = _lighten_hex(candidate, 0.22)
        colors[root] = candidate
    return colors


def _ensure_lineage_node(nodes: dict[str, dict[str, Any]], name: str) -> dict[str, Any]:
    existing = nodes.get(name)
    if existing:
        return existing
    prefix, code = lineage_parts(name)
    parent = parent_name(name)
    node = {
        "id": name,
        "name": name,
        "parentId": parent,
        "rootId": root_name(name),
        "prefix": prefix,
        "code": code or name,
        "depth": len(code),
        "firstFrame": 10**12,
        "lastFrame": -1,
        "children": set(),
        "observedFrames": [],
        "lastCell": None,
    }
    nodes[name] = node
    if parent:
        _ensure_lineage_node(nodes, parent)
    return node


def _lineage_cell_payload(cell: dict[str, Any]) -> dict[str, Any] | None:
    if not cell:
        return None
    fields = [
        "file",
        "name",
        "x",
        "y",
        "z",
        "aRadius",
        "bRadius",
        "cRadius",
        "thetaX",
        "thetaY",
        "thetaZ",
        "isTrash",
    ]
    return {field: cell.get(field) for field in fields if field in cell}


def _nearest_previous_frame(active_by_frame: dict[str, Any], frame: int) -> int | None:
    candidates = [int(value) for value in active_by_frame if str(value).lstrip("-").isdigit() and int(value) <= frame]
    return max(candidates) if candidates else None


def _frame_or_default(value: Any, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _assign_radial_angles(nodes: dict[str, dict[str, Any]], roots: list[str]) -> dict[str, float]:
    if not roots:
        return {}
    angles: dict[str, float] = {}
    sector_width = (math.pi * 2) / max(1, len(roots))
    gap = min(math.radians(18), sector_width * 0.24)
    for root_index, root in enumerate(roots):
        start = -math.pi + root_index * sector_width + gap / 2
        end = -math.pi + (root_index + 1) * sector_width - gap / 2
        ordered_nodes = _ordered_subtree_lanes(nodes, root) or [root]
        width = end - start
        for lane_index, node_id in enumerate(ordered_nodes):
            # Use all lineage nodes as angular lanes, not only leaves. A previous
            # leaf-only layout could place internal branch nodes on exactly the
            # same angle as a leaf in a neighboring branch, causing overlaid
            # branch segments in dense trees such as cell_0 and cell_1.
            angle = start + width * ((lane_index + 0.5) / len(ordered_nodes))
            angles[node_id] = angle
    return angles


def _ordered_subtree_lanes(nodes: dict[str, dict[str, Any]], node_id: str) -> list[str]:
    node = nodes.get(node_id)
    if not node:
        return []
    children = sorted(node.get("children", []), key=natural_key)
    if not children:
        return [node_id]
    lanes: list[str] = []
    midpoint = len(children) // 2
    for index, child in enumerate(children):
        if index == midpoint:
            lanes.append(node_id)
        lanes.extend(_ordered_subtree_lanes(nodes, child))
    if node_id not in lanes:
        lanes.append(node_id)
    return lanes


def _collect_leaves(nodes: dict[str, dict[str, Any]], node_id: str) -> list[str]:
    node = nodes.get(node_id)
    if not node:
        return []
    children = sorted(node.get("children", []), key=natural_key)
    if not children:
        return [node_id]
    leaves: list[str] = []
    for child in children:
        leaves.extend(_collect_leaves(nodes, child))
    return leaves


def _assign_internal_angles(
    nodes: dict[str, dict[str, Any]],
    node_id: str,
    angles: dict[str, float],
    fallback: float,
) -> float:
    children = sorted(nodes.get(node_id, {}).get("children", []), key=natural_key)
    if not children:
        angle = angles.get(node_id, fallback)
        angles[node_id] = angle
        return angle
    child_angles = [_assign_internal_angles(nodes, child, angles, fallback) for child in children]
    sin_sum = sum(math.sin(angle) for angle in child_angles)
    cos_sum = sum(math.cos(angle) for angle in child_angles)
    angle = math.atan2(sin_sum, cos_sum) if child_angles else fallback
    angles[node_id] = angle
    return angle


def _generated_color(index: int) -> str:
    hue = (index * 137.508) % 360
    saturation = 0.62
    value = 0.92
    c = value * saturation
    h = hue / 60
    x = c * (1 - abs(h % 2 - 1))
    if 0 <= h < 1:
        r, g, b = c, x, 0
    elif h < 2:
        r, g, b = x, c, 0
    elif h < 3:
        r, g, b = 0, c, x
    elif h < 4:
        r, g, b = 0, x, c
    elif h < 5:
        r, g, b = x, 0, c
    else:
        r, g, b = c, 0, x
    m = value - c
    return _rgb_to_hex(r + m, g + m, b + m)


def _relative_luminance(hex_color: str) -> float:
    text = hex_color.strip().lstrip("#")
    if len(text) != 6:
        return 0
    channels = [int(text[index:index + 2], 16) / 255 for index in (0, 2, 4)]
    linear = [
        value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4
        for value in channels
    ]
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]


def _lighten_hex(hex_color: str, amount: float) -> str:
    text = hex_color.strip().lstrip("#")
    if len(text) != 6:
        return "#d9f99d"
    channels = [int(text[index:index + 2], 16) / 255 for index in (0, 2, 4)]
    channels = [value + (1 - value) * amount for value in channels]
    return _rgb_to_hex(channels[0], channels[1], channels[2])


def _rgb_to_hex(r: float, g: float, b: float) -> str:
    return "#%02x%02x%02x" % (
        max(0, min(255, round(r * 255))),
        max(0, min(255, round(g * 255))),
        max(0, min(255, round(b * 255))),
    )
