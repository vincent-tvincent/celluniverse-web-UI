from __future__ import annotations

from pathlib import Path
from typing import Any

from celluniverse_backend.parsers.cells import parse_cells_csv
from celluniverse_backend.preview.lineage import ensure_lineage_artifacts
from celluniverse_backend.storage.json_store import write_json_atomic


def build_preview_artifacts(job_dir: Path, job_id: str) -> dict[str, Any]:
    output_dir = job_dir / "output"
    preview_dir = job_dir / "preview"
    frames_dir = preview_dir / "frames"
    frames_dir.mkdir(parents=True, exist_ok=True)

    cell_frames = parse_cells_csv(output_dir / "cells.csv")
    for frame, cells in cell_frames.items():
        frame_dir = frames_dir / f"t{frame:03d}"
        frame_dir.mkdir(parents=True, exist_ok=True)
        write_json_atomic(frame_dir / "cells.json", cells)

    ensure_lineage_artifacts(job_dir, job_id)

    frames = sorted(
        set(_png_frames(output_dir, "real"))
        | set(_png_frames(output_dir, "synth"))
        | set(_tiff_frames(output_dir, "real"))
        | set(_tiff_frames(output_dir, "synth"))
        | set(cell_frames)
    )
    manifest_frames = []
    for frame in frames:
        layers: dict[str, Any] = {}
        if (output_dir / "png" / "real" / str(frame)).exists():
            layers["real"] = {
                "format": "png-stack",
                "urlTemplate": f"/api/jobs/{job_id}/files/output/png/real/{frame}/{{z}}.png",
            }
        if (output_dir / "png" / "synth" / str(frame)).exists():
            layers["synth"] = {
                "format": "png-stack",
                "urlTemplate": f"/api/jobs/{job_id}/files/output/png/synth/{frame}/{{z}}.png",
            }
        real_tiff = output_dir / "tiff" / "real" / f"{frame}.tif"
        synth_tiff = output_dir / "tiff" / "synth" / f"{frame}.tif"
        if real_tiff.exists():
            layers["realTiff"] = {
                "format": "tiff",
                "url": f"/api/jobs/{job_id}/files/output/tiff/real/{frame}.tif",
            }
            layers["realPointCloud"] = {
                "format": "point-cloud-v1",
                "url": _versioned_url(f"/api/jobs/{job_id}/pointcloud/real/{frame}.cupc", real_tiff),
            }
        if synth_tiff.exists():
            layers["synthTiff"] = {
                "format": "tiff",
                "url": f"/api/jobs/{job_id}/files/output/tiff/synth/{frame}.tif",
            }
            layers["synthPointCloud"] = {
                "format": "point-cloud-v1",
                "url": _versioned_url(f"/api/jobs/{job_id}/pointcloud/synth/{frame}.cupc", synth_tiff),
            }
        if frame in cell_frames:
            layers["cells"] = {
                "format": "ellipsoid-json",
                "url": f"/api/jobs/{job_id}/frames/{frame}/cells",
            }
        manifest_frames.append({"t": frame, "layers": layers})

    manifest = {
        "jobId": job_id,
        "axes": ["t", "z", "y", "x"],
        "frames": manifest_frames,
        "lineage": f"/api/jobs/{job_id}/lineage",
    }
    write_json_atomic(preview_dir / "manifest.json", manifest)
    write_json_atomic(job_dir / "artifacts.json", build_artifact_registry(job_dir))
    return manifest


def _versioned_url(url: str, source_path: Path) -> str:
    try:
        stat = source_path.stat()
    except OSError:
        return url
    separator = "&" if "?" in url else "?"
    return f"{url}{separator}v={stat.st_size}-{stat.st_mtime_ns}"


def build_artifact_registry(job_dir: Path) -> dict[str, Any]:
    artifacts = []
    candidates = [
        ("request", "Request", "request.json", "metadata"),
        ("status", "Status", "status.json", "metadata"),
        ("effective_config", "Effective Config", "effective-config.yaml", "config"),
        ("initial_csv", "Initial CSV", "initial.csv", "table"),
        ("stdout_log", "Standard Output Log", "stdout.log", "log"),
        ("stderr_log", "Standard Error Log", "stderr.log", "log"),
        ("cells_csv", "Cells CSV", "output/cells.csv", "table"),
        ("manifest", "Preview Manifest", "preview/manifest.json", "preview"),
        ("lineage", "Lineage Graph", "preview/lineage.json", "lineage"),
    ]
    for artifact_id, label, rel, kind in candidates:
        if (job_dir / rel).exists():
            artifacts.append({
                "id": artifact_id,
                "label": label,
                "path": rel,
                "kind": kind,
                "download": True,
            })
    return {"artifacts": artifacts}


def _png_frames(output_dir: Path, layer: str) -> list[int]:
    root = output_dir / "png" / layer
    if not root.exists():
        return []
    frames = []
    for child in root.iterdir():
        if child.is_dir() and child.name.isdigit():
            frames.append(int(child.name))
    return frames


def _tiff_frames(output_dir: Path, layer: str) -> list[int]:
    root = output_dir / "tiff" / layer
    if not root.exists():
        return []
    frames = []
    for child in root.iterdir():
        if child.suffix.lower() in {".tif", ".tiff"} and child.stem.isdigit():
            frames.append(int(child.stem))
    return frames
