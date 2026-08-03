from __future__ import annotations

import json
import struct
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

import celluniverse_backend.preview.compact as compact_preview
from celluniverse_backend.jobs.output_scan import scan_output
from celluniverse_backend.preview.compact import (
    _CompactSynthSampler,
    compact_slice_cache_target,
    ensure_compact_pointcloud_preview,
    load_compact_frame,
    resolve_raw_frame_path,
)
from celluniverse_backend.preview.manifest import build_preview_artifacts


class CompactPreviewTest(unittest.TestCase):
    def setUp(self) -> None:
        self._temporary = tempfile.TemporaryDirectory()
        self.job_dir = Path(self._temporary.name) / "job_test"
        self.compact_dir = self.job_dir / "output" / "compact"
        (self.compact_dir / "frames").mkdir(parents=True)
        self._write_manifest()

    def tearDown(self) -> None:
        self._temporary.cleanup()

    def test_real_pointcloud_uses_recorded_z_interpolation_ratio(self) -> None:
        raw_tiff = self.job_dir / "input" / "raw.tif"
        _write_grayscale_tiff(raw_tiff, 2, 1, [bytes([0, 10]), bytes([20, 30])])
        _write_json(
            self.job_dir / "argv.json",
            ["celluniverse", "0", "0", str(raw_tiff), "output", "config.yaml", "initial.csv"],
        )
        self._write_frame(
            frame=0,
            shape=[3, 1, 2],
            ratio=2,
            background={"kind": "scalar", "value": 0.0},
            cells=[],
        )

        preview = self.job_dir / "preview" / "pointcloud" / "real" / "0.cupc"
        ensure_compact_pointcloud_preview(
            self.job_dir,
            0,
            "real",
            preview,
            max_points=100,
            max_slices=10,
            intensity_percentile=0.0,
        )

        header, points, metadata = _read_pointcloud(preview)
        self.assertEqual(header["depth"], 3)
        self.assertEqual(metadata["zInterpolationRatio"], 2)
        self.assertEqual(metadata["zInterpolationSource"], "initial_csv")
        middle_left = next(point for point in points if point[:3] == (0.0, 0.0, 1.0))
        middle_right = next(point for point in points if point[:3] == (1.0, 0.0, 1.0))
        self.assertAlmostEqual(middle_left[3], 10.0 / 30.0, places=5)
        self.assertAlmostEqual(middle_right[3], 20.0 / 30.0, places=5)

    def test_real_pointcloud_supports_fractional_endpoint_grid(self) -> None:
        raw_tiff = self.job_dir / "input" / "raw.tif"
        _write_grayscale_tiff(
            raw_tiff,
            1,
            1,
            [bytes([value]) for value in range(50)],
        )
        _write_json(
            self.job_dir / "argv.json",
            ["celluniverse", "0", "0", str(raw_tiff), "output", "config.yaml", "initial.csv"],
        )
        self._write_frame(
            frame=0,
            shape=[271, 1, 1],
            ratio=5.5,
            background={"kind": "scalar", "value": 0.0},
            cells=[],
        )

        preview = self.job_dir / "preview" / "pointcloud" / "real" / "0.cupc"
        ensure_compact_pointcloud_preview(
            self.job_dir,
            0,
            "real",
            preview,
            max_points=400,
            max_slices=400,
            intensity_percentile=0.0,
        )

        header, points, metadata = _read_pointcloud(preview)
        self.assertEqual(header["depth"], 271)
        self.assertEqual(header["selectedSlices"], 271)
        self.assertEqual(header["pointCount"], 270)
        self.assertEqual(metadata["zInterpolationRatio"], 5.5)
        midpoint = next(point for point in points if point[2] == 135.0)
        self.assertAlmostEqual(midpoint[3], 0.5, places=6)

    def test_concurrent_pointcloud_requests_share_one_generation(self) -> None:
        self._write_frame(
            frame=13,
            shape=[1, 2, 2],
            ratio=1,
            background={"kind": "scalar", "value": 0.5},
            cells=[],
        )
        preview = self.job_dir / "preview" / "pointcloud" / "synth" / "13.cupc"
        original_build = compact_preview._build_pointcloud_from_sampler
        first_build_started = threading.Event()
        release_first_build = threading.Event()
        build_calls = 0
        build_calls_lock = threading.Lock()

        def delayed_build(*args: object, **kwargs: object) -> None:
            nonlocal build_calls
            with build_calls_lock:
                build_calls += 1
                is_first_build = build_calls == 1
            if is_first_build:
                first_build_started.set()
                self.assertTrue(release_first_build.wait(timeout=2))
            original_build(*args, **kwargs)

        def ensure() -> Path:
            return ensure_compact_pointcloud_preview(
                self.job_dir,
                13,
                "synth",
                preview,
                max_points=100,
                max_slices=10,
                intensity_percentile=0.0,
            )

        with patch.object(compact_preview, "_build_pointcloud_from_sampler", delayed_build):
            with ThreadPoolExecutor(max_workers=2) as executor:
                first = executor.submit(ensure)
                self.assertTrue(first_build_started.wait(timeout=2))
                second = executor.submit(ensure)
                release_first_build.set()
                self.assertEqual(first.result(timeout=5), preview)
                self.assertEqual(second.result(timeout=5), preview)

        self.assertEqual(build_calls, 1)
        self.assertTrue(preview.is_file())
        self.assertEqual(list(preview.parent.glob(f".{preview.name}.*.tmp")), [])

    def test_failed_pointcloud_generation_removes_temporary_file(self) -> None:
        self._write_frame(
            frame=14,
            shape=[1, 2, 2],
            ratio=1,
            background={"kind": "scalar", "value": 0.5},
            cells=[],
        )
        preview = self.job_dir / "preview" / "pointcloud" / "synth" / "14.cupc"

        def fail_after_write(
            _sampler: object,
            temporary_path: Path,
            **_kwargs: object,
        ) -> None:
            temporary_path.write_bytes(b"partial")
            raise ValueError("simulated generation failure")

        with patch.object(compact_preview, "_build_pointcloud_from_sampler", fail_after_write):
            with self.assertRaisesRegex(ValueError, "simulated generation failure"):
                ensure_compact_pointcloud_preview(
                    self.job_dir,
                    14,
                    "synth",
                    preview,
                    max_points=100,
                    max_slices=10,
                    intensity_percentile=0.0,
                )

        self.assertFalse(preview.exists())
        self.assertEqual(list(preview.parent.glob(f".{preview.name}.*.tmp")), [])

    def test_raw_source_resolution_uses_absolute_frame_for_patterns_and_filename_for_directories(self) -> None:
        raw_dir = self.job_dir / "input" / "raw"
        raw_dir.mkdir(parents=True)
        expected = raw_dir / "SPIMA_t042.tif"
        expected.write_bytes(b"test")

        _write_json(
            self.job_dir / "argv.json",
            ["celluniverse", "42", "42", str(raw_dir), "output", "config.yaml", "initial.csv"],
        )
        self.assertEqual(
            resolve_raw_frame_path(self.job_dir, 42, "SPIMA_t042.tif"),
            expected,
        )

        _write_json(
            self.job_dir / "argv.json",
            [
                "celluniverse",
                "42",
                "42",
                str(raw_dir / "SPIMA_t%03d.tif"),
                "output",
                "config.yaml",
                "initial.csv",
            ],
        )
        self.assertEqual(resolve_raw_frame_path(self.job_dir, 42), expected)

        expanded = raw_dir / "SPIMA_t000.tif"
        expanded.write_bytes(b"different frame")
        _write_json(
            self.job_dir / "argv.json",
            [
                "celluniverse",
                "0",
                "0",
                str(raw_dir / "SPIMA_t%03d.tif"),
                "output",
                "config.yaml",
                "initial.csv",
            ],
        )
        self.assertEqual(
            resolve_raw_frame_path(self.job_dir, 0, "SPIMA_t042.tif"),
            expected,
        )

    def test_compact_slice_cache_target_clamps_before_selecting_path(self) -> None:
        self._write_frame(
            frame=0,
            shape=[3, 2, 2],
            ratio=1,
            background={"kind": "scalar", "value": 0.5},
            cells=[],
        )
        high_path, high_index = compact_slice_cache_target(
            self.job_dir, 0, "synth", 999, 64
        )
        low_path, low_index = compact_slice_cache_target(
            self.job_dir, 0, "synth", -999, 64
        )
        self.assertEqual((high_index, high_path.name), (2, "z2_xy64.cusl"))
        self.assertEqual((low_index, low_path.name), (0, "z0_xy64.cusl"))
        self.assertEqual(high_path.parent, low_path.parent)

    def test_synth_pointcloud_honors_draw_order_and_renders_trash(self) -> None:
        self._write_frame(
            frame=4,
            shape=[1, 3, 3],
            ratio=1,
            background={"kind": "scalar", "value": 0.0},
            cells=[
                _cell(0, "outer", [1, 1, 0], [2, 2, 1], 0.3, is_trash=False),
                _cell(1, "trash-overwrite", [1, 1, 0], [0.5, 0.5, 0.5], 0.9, is_trash=True),
            ],
        )

        record = load_compact_frame(self.job_dir, 4)
        sampler = _CompactSynthSampler(record, self.compact_dir)
        sampled = sampler.read_slice(0)
        self.assertEqual(sampled[4], 230.0)
        self.assertEqual(sampled[0], 76.0)

        preview = self.job_dir / "preview" / "pointcloud" / "synth" / "4.cupc"
        ensure_compact_pointcloud_preview(
            self.job_dir,
            4,
            "synth",
            preview,
            max_points=100,
            max_slices=10,
            intensity_percentile=0.0,
        )

        _header, points, _metadata = _read_pointcloud(preview)
        center = next(point for point in points if point[:3] == (1.0, 1.0, 0.0))
        corner = next(point for point in points if point[:3] == (0.0, 0.0, 0.0))
        self.assertAlmostEqual(center[3], 1.0, places=6)
        self.assertAlmostEqual(corner[3], 76.0 / 230.0, places=6)

    def test_binary_mask_uses_lsb_first_zyx_payload(self) -> None:
        masks_dir = self.compact_dir / "masks"
        masks_dir.mkdir()
        mask_path = masks_dir / "region.cubm"
        mask_path.write_bytes(
            struct.pack("<4sHHIIIQ", b"CUBM", 1, 1, 2, 2, 1, 4)
            + bytes([0b00000101])
        )
        self._write_frame(
            frame=8,
            shape=[1, 2, 2],
            ratio=1,
            background={
                "kind": "binary_mask",
                "cold": 0.2,
                "hot": 0.8,
                "mask_format": "CUBM1",
                "mask_path": "masks/region.cubm",
            },
            cells=[],
        )

        record = load_compact_frame(self.job_dir, 8)
        sampler = _CompactSynthSampler(record, self.compact_dir)
        self.assertEqual(sampler.read_slice(0), [204.0, 51.0, 204.0, 51.0])

    def test_analytic_background_applies_offset_updates_with_each_clamp(self) -> None:
        self._write_frame(
            frame=9,
            shape=[1, 1, 1],
            ratio=1,
            background={
                "kind": "rotated_soft_ellipsoid",
                "center": {"x": 0.0, "y": 0.0, "z": 0.0},
                "radii": {"a": 1.0, "b": 1.0, "c": 1.0},
                "rotation": {"theta_x": 0.0, "theta_y": 0.0, "theta_z": 0.0},
                "cold": 0.9,
                "hot": 0.9,
                "soft_margin": 0.0,
                "additive_offset": 0.1,
                "offset_updates": [0.3, -0.2],
            },
            cells=[],
        )

        record = load_compact_frame(self.job_dir, 9)
        sampler = _CompactSynthSampler(record, self.compact_dir)
        self.assertEqual(sampler.read_slice(0)[0], 204.0)

    def test_small_soft_margin_uses_hard_edge_cutoff(self) -> None:
        self._write_frame(
            frame=10,
            shape=[1, 1, 2],
            ratio=1,
            background={
                "kind": "rotated_soft_ellipsoid",
                "center": {"x": 0.0, "y": 0.0, "z": 0.0},
                "radii": {"a": 0.9999999995, "b": 1.0, "c": 1.0},
                "rotation": {"theta_x": 0.0, "theta_y": 0.0, "theta_z": 0.0},
                "cold": 0.0,
                "hot": 1.0,
                "soft_margin": 1e-9,
                "additive_offset": 0.0,
                "offset_updates": [],
            },
            cells=[],
        )

        record = load_compact_frame(self.job_dir, 10)
        sampler = _CompactSynthSampler(record, self.compact_dir)
        self.assertEqual(sampler.read_slice(0), [255.0, 0.0])

    def test_cv8u_contract_rounds_low_nonzero_values_to_zero(self) -> None:
        self._write_frame(
            frame=11,
            shape=[1, 1, 2],
            ratio=1,
            background={"kind": "scalar", "value": 0.001},
            cells=[
                _cell(0, "bright", [1, 0, 0], [0.25, 0.25, 0.25], 1.0, is_trash=False),
            ],
        )

        record = load_compact_frame(self.job_dir, 11)
        sampler = _CompactSynthSampler(record, self.compact_dir)
        self.assertEqual(sampler.read_slice(0), [0.0, 255.0])

    def test_compact_cells_remap_pavak_source_filename_to_record_frame(self) -> None:
        cells_csv = self.job_dir / "output" / "cells.csv"
        cells_csv.parent.mkdir(parents=True, exist_ok=True)
        cells_csv.write_text(
            "file,name,x,y,z,aRadius,bRadius,cRadius,theta_x,theta_y,theta_z,isTrash\n"
            "SPIMA_t001.tif,AB,999,2,3,4,5,6,0,0,0,0\n",
            encoding="utf-8",
        )
        self._write_frame(
            frame=0,
            source_frame="SPIMA_t001.tif",
            shape=[1, 4, 4],
            ratio=1,
            background={"kind": "scalar", "value": 0.0},
            cells=[_cell(0, "AB", [1, 2, 0], [1, 1, 1], 0.5, is_trash=False)],
        )
        stale_cells = self.job_dir / "preview" / "frames" / "t001" / "cells.json"
        _write_json(stale_cells, [{"name": "stale"}])
        stale_lineage = self.job_dir / "preview" / "lineage-frames" / "1.json"
        _write_json(stale_lineage, {"frame": 1})
        outside_dir = self.job_dir / "outside-preview"
        outside_cells = outside_dir / "cells.json"
        _write_json(outside_cells, [{"name": "must survive"}])
        stale_link = self.job_dir / "preview" / "frames" / "t999"
        stale_link.symlink_to(outside_dir, target_is_directory=True)

        manifest = build_preview_artifacts(self.job_dir, "job_test")
        self.assertEqual([frame["t"] for frame in manifest["frames"]], [0])
        self.assertIn("cells", manifest["frames"][0]["layers"])

        cells = json.loads(
            (self.job_dir / "preview" / "frames" / "t000" / "cells.json").read_text(
                encoding="utf-8"
            )
        )
        self.assertEqual(len(cells), 1)
        self.assertEqual(cells[0]["file"], "SPIMA_t001.tif")
        self.assertEqual(cells[0]["x"], 1.0)
        self.assertFalse(stale_cells.exists())

        lineage = json.loads(
            (self.job_dir / "preview" / "lineage.json").read_text(encoding="utf-8")
        )
        self.assertEqual(lineage["frames"], [0])
        node = next(node for node in lineage["nodes"] if node["id"] == "AB")
        self.assertEqual(node["observedFrames"], [0])
        self.assertFalse(stale_lineage.exists())
        self.assertTrue(stale_link.is_symlink())
        self.assertTrue(outside_cells.exists())

    def test_manifest_and_status_discover_compact_frames_without_tiffs(self) -> None:
        self._write_frame(
            frame=12,
            shape=[1, 2, 2],
            ratio=1,
            background={"kind": "scalar", "value": 1.0},
            cells=[],
        )

        manifest = build_preview_artifacts(self.job_dir, "job_test")
        frame = next(item for item in manifest["frames"] if item["t"] == 12)
        self.assertEqual(frame["layers"]["realPointCloud"]["format"], "point-cloud-v1")
        self.assertEqual(frame["layers"]["synthPointCloud"]["format"], "point-cloud-v1")
        self.assertNotIn("realTiff", frame["layers"])
        self.assertNotIn("synthTiff", frame["layers"])
        artifacts = json.loads((self.job_dir / "artifacts.json").read_text(encoding="utf-8"))
        compact_artifact = next(
            artifact for artifact in artifacts["artifacts"]
            if artifact["id"] == "compact_manifest"
        )
        self.assertEqual(compact_artifact["path"], "output/compact/manifest.json")

        status = scan_output(self.job_dir, 12, 12)
        self.assertEqual(status["outputReady"]["compactFrames"], [12])
        self.assertEqual(status["completedFrames"], 1)

    def _write_manifest(self) -> None:
        _write_json(
            self.compact_dir / "manifest.json",
            {
                "schema": "celluniverse.compact.manifest",
                "version": 1,
                "frame_schema": "celluniverse.compact.frame",
                "mask_schema": "CUBM1",
                "frames": [],
            },
        )

    def _write_frame(
        self,
        *,
        frame: int,
        source_frame: str | None = None,
        shape: list[int],
        ratio: float,
        background: dict[str, object],
        cells: list[dict[str, object]],
    ) -> None:
        frame_path = self.compact_dir / "frames" / f"frame_{frame:06d}.json"
        _write_json(
            frame_path,
            {
                "schema": "celluniverse.compact.frame",
                "version": 1,
                "frame": frame,
                "source_frame": source_frame or f"raw-{frame}.tif",
                "pipeline_mode": "traditional",
                "dimensions": {"x": shape[2], "y": shape[1], "z": shape[0]},
                "coordinates": {
                    "cell_order": "xyz",
                    "volume_order": "zyx",
                    "space": "interpolated",
                    "z_interpolation_ratio": ratio,
                    "z_interpolation_source": "initial_csv",
                    "initial_z_space": "raw",
                },
                "render_contract": {
                    "id": "ellipsoid_rz_ry_rx_overwrite_cv8u_v1",
                    "rotation": "Rz*Ry*Rx",
                    "membership": "squared_local_radius<=1",
                    "overlap": "later_draw_order_overwrites",
                    "output": "opencv_float32_to_uint8_scale_255",
                },
                "background": background,
                "cells": cells,
            },
        )
        manifest_path = self.compact_dir / "manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest["frames"] = [
            entry for entry in manifest["frames"] if entry["frame"] != frame
        ]
        manifest["frames"].append({
            "frame": frame,
            "path": f"frames/{frame_path.name}",
        })
        manifest["frames"].sort(key=lambda entry: entry["frame"])
        _write_json(manifest_path, manifest)


def _cell(
    draw_order: int,
    name: str,
    center: list[float],
    radii: list[float],
    brightness: float,
    *,
    is_trash: bool,
) -> dict[str, object]:
    return {
        "draw_order": draw_order,
        "name": name,
        "center": {"x": center[0], "y": center[1], "z": center[2]},
        "radii": {"a": radii[0], "b": radii[1], "c": radii[2]},
        "rotation": {"theta_x": 0.0, "theta_y": 0.0, "theta_z": 0.0},
        "brightness": brightness,
        "is_trash": is_trash,
    }


def _write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value), encoding="utf-8")


def _write_grayscale_tiff(path: Path, width: int, height: int, pages: list[bytes]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    output = bytearray(struct.pack("<2sHI", b"II", 42, 8))
    entries_per_page = 8
    ifd_size = 2 + entries_per_page * 12 + 4
    for index, pixels in enumerate(pages):
        if len(pixels) != width * height:
            raise ValueError("invalid test TIFF page size")
        ifd_offset = len(output)
        pixel_offset = ifd_offset + ifd_size
        next_ifd = pixel_offset + len(pixels) if index + 1 < len(pages) else 0
        output.extend(struct.pack("<H", entries_per_page))
        for tag, type_id, value in [
            (256, 3, width),
            (257, 3, height),
            (258, 3, 8),
            (259, 3, 1),
            (273, 4, pixel_offset),
            (277, 3, 1),
            (278, 4, height),
            (279, 4, len(pixels)),
        ]:
            output.extend(struct.pack("<HHI", tag, type_id, 1))
            output.extend(struct.pack("<H", value) + b"\x00\x00" if type_id == 3 else struct.pack("<I", value))
        output.extend(struct.pack("<I", next_ifd))
        output.extend(pixels)
    path.write_bytes(output)


def _read_pointcloud(path: Path) -> tuple[dict[str, int | float], list[tuple[float, float, float, float]], dict[str, object]]:
    payload = path.read_bytes()
    if payload[:4] != b"CUPC":
        raise AssertionError("not a CUPC file")
    values = struct.unpack("<IIIIIIIfI", payload[4:40])
    version, point_count, width, height, depth, selected_slices, xy_step, threshold, metadata_len = values
    points = [
        struct.unpack("<ffff", payload[40 + index * 16:56 + index * 16])
        for index in range(point_count)
    ]
    metadata_offset = 40 + point_count * 16
    metadata = json.loads(payload[metadata_offset:metadata_offset + metadata_len])
    return {
        "version": version,
        "pointCount": point_count,
        "width": width,
        "height": height,
        "depth": depth,
        "selectedSlices": selected_slices,
        "xyStep": xy_step,
        "threshold": threshold,
    }, points, metadata


if __name__ == "__main__":
    unittest.main()
