from __future__ import annotations

from pathlib import Path
from typing import Any

from celluniverse_backend.parsers.cells import (
    build_lineage,
    build_lineage_layout,
    build_lineage_snapshot,
    parse_cells_csv,
)
from celluniverse_backend.storage.json_store import read_json, write_json_atomic

LINEAGE_DERIVATION_VERSION = 2


def ensure_lineage_artifacts(job_dir: Path, job_id: str, background: str = "#070a0f") -> dict[str, Any]:
    output_csv = job_dir / "output" / "cells.csv"
    preview_dir = job_dir / "preview"
    lineage_path = preview_dir / "lineage.json"
    layout_path = preview_dir / "lineage-layout.json"
    meta_path = preview_dir / "lineage-source.json"
    frames_dir = preview_dir / "lineage-frames"
    preview_dir.mkdir(parents=True, exist_ok=True)

    source_meta = _source_meta(output_csv, background)
    cached_meta = read_json(meta_path, {})
    if (
        source_meta == cached_meta
        and lineage_path.exists()
        and layout_path.exists()
    ):
        cached = read_json(lineage_path, {})
        if cached:
            return cached

    cell_frames = parse_cells_csv(output_csv)
    lineage = build_lineage(cell_frames)
    lineage.update({
        "jobId": job_id,
        "updatedAt": source_meta.get("mtime"),
        "sourceSize": source_meta.get("size"),
    })
    layout = build_lineage_layout(lineage, background=background)
    layout["jobId"] = job_id

    write_json_atomic(lineage_path, lineage)
    write_json_atomic(layout_path, layout)
    frames_dir.mkdir(parents=True, exist_ok=True)
    for frame in lineage.get("frames", []):
        snapshot = build_lineage_snapshot(lineage, int(frame))
        snapshot["jobId"] = job_id
        write_json_atomic(frames_dir / f"{int(frame)}.json", snapshot)
    write_json_atomic(meta_path, source_meta)
    return lineage


def read_lineage_layout(job_dir: Path, job_id: str, background: str = "#070a0f") -> dict[str, Any]:
    ensure_lineage_artifacts(job_dir, job_id, background=background)
    layout_path = job_dir / "preview" / "lineage-layout.json"
    return read_json(layout_path, {
        "jobId": job_id,
        "mode": "radial-time-v1",
        "rings": [],
        "nodes": {},
        "edges": [],
    })


def read_lineage_snapshot(job_dir: Path, job_id: str, frame: int, background: str = "#070a0f") -> dict[str, Any]:
    lineage = ensure_lineage_artifacts(job_dir, job_id, background=background)
    frame_path = job_dir / "preview" / "lineage-frames" / f"{frame}.json"
    if frame_path.exists():
        return read_json(frame_path, build_lineage_snapshot(lineage, frame))
    snapshot = build_lineage_snapshot(lineage, frame)
    snapshot["jobId"] = job_id
    return snapshot


def _source_meta(path: Path, background: str) -> dict[str, Any]:
    if not path.exists():
        return {
            "exists": False,
            "size": 0,
            "mtime": None,
            "background": background,
            "derivationVersion": LINEAGE_DERIVATION_VERSION,
        }
    stat = path.stat()
    return {
        "exists": True,
        "size": stat.st_size,
        "mtime": stat.st_mtime,
        "background": background,
        "derivationVersion": LINEAGE_DERIVATION_VERSION,
    }
