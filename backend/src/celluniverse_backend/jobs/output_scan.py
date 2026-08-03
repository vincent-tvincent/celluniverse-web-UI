from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from celluniverse_backend.parsers.cells import parse_cells_csv
from celluniverse_backend.preview.compact import compact_frame_paths


CHECKPOINT_RE = re.compile(r"frame_(\d+)\.txt$")


def scan_output(job_dir: Path, first_frame: int, last_frame: int) -> dict[str, Any]:
    output_dir = job_dir / "output"
    checkpoints = []
    checkpoint_dir = output_dir / "checkpoints"
    if checkpoint_dir.exists():
        for path in checkpoint_dir.iterdir():
            match = CHECKPOINT_RE.match(path.name)
            if match:
                checkpoints.append(int(match.group(1)))

    cells_frames = sorted(parse_cells_csv(output_dir / "cells.csv").keys())
    png_frames = _scan_png_frames(output_dir)
    tiff_frames = _scan_tiff_frames(output_dir)
    try:
        compact_frames = set(compact_frame_paths(output_dir))
    except (OSError, ValueError):
        compact_frames = set()

    completed_candidates = checkpoints or [
        frame
        for frame in sorted(set(cells_frames) | compact_frames)
        if frame in compact_frames or frame in png_frames or frame in tiff_frames
    ]
    last_completed = max(completed_candidates) if completed_candidates else None
    if last_completed is None:
        completed_count = 0
    else:
        completed_count = max(0, min(last_completed, last_frame) - first_frame + 1)
    total = max(1, last_frame - first_frame + 1)

    return {
        "lastCompletedFrame": last_completed,
        "completedFrames": min(completed_count, total),
        "totalFrames": total,
        "progress": min(1.0, max(0.0, completed_count / total)),
        "outputReady": {
            "cellsCsv": (output_dir / "cells.csv").exists(),
            "pngFrames": sorted(png_frames),
            "tiffFrames": sorted(tiff_frames),
            "compactFrames": sorted(compact_frames),
            "checkpointFrames": sorted(checkpoints),
        },
        "partialOutputsAvailable": output_dir.exists() and any(output_dir.iterdir()) if output_dir.exists() else False,
    }


def _scan_png_frames(output_dir: Path) -> set[int]:
    frames: set[int] = set()
    for layer in ["real", "synth"]:
        root = output_dir / "png" / layer
        if not root.exists():
            continue
        for child in root.iterdir():
            if child.is_dir() and child.name.isdigit():
                frames.add(int(child.name))
    return frames


def _scan_tiff_frames(output_dir: Path) -> set[int]:
    frames: set[int] = set()
    for layer in ["real", "synth"]:
        root = output_dir / "tiff" / layer
        if not root.exists():
            continue
        for child in root.iterdir():
            if child.suffix.lower() in {".tif", ".tiff"} and child.stem.isdigit():
                frames.add(int(child.stem))
    return frames
