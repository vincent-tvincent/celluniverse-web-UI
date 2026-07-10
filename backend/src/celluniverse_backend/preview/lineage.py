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

LINEAGE_DERIVATION_VERSION = 5


def ensure_lineage_artifacts(job_dir: Path, job_id: str, background: str = "#070a0f") -> dict[str, Any]:
    output_csv = job_dir / "output" / "cells.csv"
    preview_dir = job_dir / "preview"
    lineage_path = preview_dir / "lineage.json"
    layout_path = preview_dir / "lineage-layout.json"
    meta_path = preview_dir / "lineage-source.json"
    frames_dir = preview_dir / "lineage-frames"
    preview_dir.mkdir(parents=True, exist_ok=True)

    resume_context = _resume_lineage_context(job_dir)
    source_meta = _source_meta(output_csv, background, resume_context)
    cached_meta = read_json(meta_path, {})
    if (
        source_meta == cached_meta
        and lineage_path.exists()
        and layout_path.exists()
    ):
        cached = read_json(lineage_path, {})
        if cached:
            return cached

    cell_frames = _lineage_cell_frames(output_csv, resume_context)
    lineage = build_lineage(cell_frames)
    lineage.update({
        "jobId": job_id,
        "updatedAt": source_meta.get("mtime"),
        "sourceSize": source_meta.get("size"),
    })
    if resume_context:
        lineage.update({
            "source": "resume-merged-cells.csv",
            "resumeSourceJobId": resume_context["sourceJobId"],
            "resumeFromFrame": resume_context["resumeFromFrame"],
        })
    layout = build_lineage_layout(lineage, background=background)
    layout["jobId"] = job_id
    if resume_context:
        layout["resumeFromFrame"] = resume_context["resumeFromFrame"]
        layout["resumeSourceJobId"] = resume_context["sourceJobId"]

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


def _lineage_cell_frames(output_csv: Path, resume_context: dict[str, Any] | None) -> dict[int, list[dict[str, Any]]]:
    current_frames = parse_cells_csv(output_csv)
    if not resume_context:
        return current_frames

    resume_from = int(resume_context["resumeFromFrame"])
    source_frames = parse_cells_csv(Path(resume_context["sourceCellsCsv"]))
    merged = {
        frame: cells
        for frame, cells in source_frames.items()
        if frame < resume_from
    }
    merged.update({
        frame: cells
        for frame, cells in current_frames.items()
        if frame >= resume_from
    })
    return merged


def _resume_lineage_context(job_dir: Path) -> dict[str, Any] | None:
    request = read_json(job_dir / "request.json", {})
    status = read_json(job_dir / "status.json", {})
    source_job_id = request.get("resumeSourceJobId") or status.get("resumeSourceJobId")
    resume_from = request.get("resumeFromFrame") or status.get("resumeFromFrame")
    if not source_job_id or resume_from is None:
        return None
    try:
        resume_from_int = int(resume_from)
    except (TypeError, ValueError):
        return None
    source_job_dir = job_dir.parent / str(source_job_id)
    source_cells_csv = source_job_dir / "output" / "cells.csv"
    if not source_cells_csv.exists():
        return None
    return {
        "sourceJobId": str(source_job_id),
        "resumeFromFrame": resume_from_int,
        "sourceCellsCsv": str(source_cells_csv),
    }


def _file_meta(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"exists": False, "size": 0, "mtime": None}
    stat = path.stat()
    return {"exists": True, "size": stat.st_size, "mtime": stat.st_mtime}


def _source_meta(path: Path, background: str, resume_context: dict[str, Any] | None = None) -> dict[str, Any]:
    meta = {
        **_file_meta(path),
        "background": background,
        "derivationVersion": LINEAGE_DERIVATION_VERSION,
    }
    if resume_context:
        meta["resume"] = {
            "sourceJobId": resume_context["sourceJobId"],
            "resumeFromFrame": resume_context["resumeFromFrame"],
            "sourceCells": _file_meta(Path(resume_context["sourceCellsCsv"])),
        }
    return meta
