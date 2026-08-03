from __future__ import annotations

import json
import math
import re
import struct
import tempfile
import threading
from collections import OrderedDict
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any, BinaryIO, Iterable, Iterator, Mapping, Sequence

from celluniverse_backend.preview.pointcloud import (
    DEFAULT_INTENSITY_PERCENTILE,
    DEFAULT_MAX_POINTS,
    DEFAULT_MAX_SLICES,
    POINTCLOUD_MAGIC,
    POINTCLOUD_VERSION,
    _HEADER_FORMAT,
    _HEADER_SIZE,
    _choose_xy_step,
    _percentile,
    _read_page,
    _read_preview_metadata,
    _read_tiff_pages,
    _select_slice_indices,
    _validate_supported_pages,
)
from celluniverse_backend.preview.slice import (
    DISPLAY_MAX,
    SLICE_HEADER_FORMAT,
    SLICE_MAGIC,
    SLICE_VERSION,
    _downsample_nearest,
    _fit_preview_size,
    _normalize_to_u8,
)
from celluniverse_backend.storage.json_store import read_json


COMPACT_EXPORT_SCHEMA = "celluniverse.compact.manifest"
COMPACT_FRAME_SCHEMA = "celluniverse.compact.frame"
COMPACT_VERSION = 1
COMPACT_MASK_MAGIC = b"CUBM"
COMPACT_MASK_VERSION = 1
_COMPACT_MASK_HEADER = struct.Struct("<4sHHIIIQ")
_FRAME_NAME_RE = re.compile(r"frame_(\d{6,})\.json$")
_TIFF_SUFFIXES = {".tif", ".tiff"}
_PREVIEW_LOCKS_GUARD = threading.Lock()
_PREVIEW_LOCKS: dict[Path, list[Any]] = {}


@dataclass(frozen=True)
class CompactFrame:
    path: Path
    frame: int
    source: Any
    pipeline: Any
    shape_zyx: tuple[int, int, int]
    z_ratio: float
    z_ratio_source: str
    coordinate_space: str
    initial_z_space: str
    background: Mapping[str, Any]
    cells: tuple[Mapping[str, Any], ...]


@dataclass(frozen=True)
class _Ellipsoid:
    center: tuple[float, float, float]
    radii: tuple[float, float, float]
    rotation: tuple[float, float, float]
    brightness: float


@dataclass(frozen=True)
class _BinaryMask:
    shape_zyx: tuple[int, int, int]
    payload: bytes

    def contains(self, z: int, y: int, x: int) -> bool:
        depth, height, width = self.shape_zyx
        if not (0 <= z < depth and 0 <= y < height and 0 <= x < width):
            return False
        bit_index = (z * height + y) * width + x
        return bool((self.payload[bit_index >> 3] >> (bit_index & 7)) & 1)


def load_compact_manifest(output_dir: Path) -> dict[str, Any] | None:
    path = output_dir / "compact" / "manifest.json"
    if not path.exists():
        return None
    data = _read_json_object(path)
    if data.get("schema") != COMPACT_EXPORT_SCHEMA:
        raise ValueError(f"unsupported compact manifest schema: {data.get('schema')!r}")
    if _positive_int(data.get("version"), "compact manifest version") != COMPACT_VERSION:
        raise ValueError(f"unsupported compact manifest version: {data.get('version')!r}")
    if data.get("frame_schema") != COMPACT_FRAME_SCHEMA:
        raise ValueError(f"unsupported compact frame schema: {data.get('frame_schema')!r}")
    if data.get("mask_schema") != "CUBM1":
        raise ValueError(f"unsupported compact mask schema: {data.get('mask_schema')!r}")
    if not isinstance(data.get("frames"), list):
        raise ValueError("compact manifest frames must be an array")
    return data


def compact_frame_paths(output_dir: Path) -> dict[int, Path]:
    manifest = load_compact_manifest(output_dir)
    if manifest is None:
        return {}
    compact_root = output_dir / "compact"
    frames: dict[int, Path] = {}
    for index, entry_raw in enumerate(manifest["frames"]):
        entry = _mapping(entry_raw, f"manifest.frames[{index}]")
        frame = _nonnegative_int(entry.get("frame"), f"manifest.frames[{index}].frame")
        relative = _nonempty_string(entry.get("path"), f"manifest.frames[{index}].path")
        path = _safe_compact_child(compact_root, relative, field=f"manifest.frames[{index}].path")
        match = _FRAME_NAME_RE.fullmatch(path.name)
        if not match or int(match.group(1)) != frame:
            raise ValueError(f"compact manifest frame/path mismatch for frame {frame}")
        if frame in frames:
            raise ValueError(f"compact manifest repeats frame {frame}")
        frames[frame] = path
    return frames


def compact_frame_path(job_dir: Path, frame: int) -> Path | None:
    return compact_frame_paths(job_dir / "output").get(frame)


def load_compact_frame(
    job_dir: Path,
    frame: int,
    *,
    record_path: Path | None = None,
) -> CompactFrame:
    output_dir = job_dir / "output"
    path = record_path or compact_frame_paths(output_dir).get(frame)
    if path is None:
        raise FileNotFoundError(f"compact frame {frame} not found")
    data = _read_json_object(path)
    if data.get("schema") != COMPACT_FRAME_SCHEMA:
        raise ValueError(f"unsupported compact frame schema: {data.get('schema')!r}")
    if _positive_int(data.get("version"), "compact frame version") != COMPACT_VERSION:
        raise ValueError(f"unsupported compact frame version: {data.get('version')!r}")
    record_frame = _nonnegative_int(data.get("frame"), "compact frame number")
    if record_frame != frame:
        raise ValueError(f"compact frame number mismatch: expected {frame}, found {record_frame}")

    dimensions = _mapping(data.get("dimensions"), "dimensions")
    shape = (
        _positive_int(dimensions.get("z"), "dimensions.z"),
        _positive_int(dimensions.get("y"), "dimensions.y"),
        _positive_int(dimensions.get("x"), "dimensions.x"),
    )
    if any(dimension > 1_000_000 for dimension in shape):
        raise ValueError("compact frame dimension is unreasonably large")
    coordinates = _mapping(data.get("coordinates"), "coordinates")
    if coordinates.get("cell_order") != "xyz" or coordinates.get("volume_order") != "zyx":
        raise ValueError("unsupported compact coordinate ordering")
    coordinate_space = _nonempty_string(coordinates.get("space"), "coordinates.space")
    if coordinate_space != "interpolated":
        raise ValueError(f"unsupported compact coordinate space: {coordinate_space!r}")
    ratio = _interpolation_ratio(
        coordinates.get("z_interpolation_ratio"),
        "coordinates.z_interpolation_ratio",
    )
    initial_z_space = _nonempty_string(
        coordinates.get("initial_z_space"),
        "coordinates.initial_z_space",
    )
    ratio_source = _nonempty_string(
        coordinates.get("z_interpolation_source"),
        "coordinates.z_interpolation_source",
    )
    if ratio_source not in {"config", "initial_csv", "cell_lumen_profile"}:
        raise ValueError(f"unsupported z interpolation source: {ratio_source!r}")
    render_contract = _mapping(data.get("render_contract"), "render_contract")
    expected_render_contract = {
        "id": "ellipsoid_rz_ry_rx_overwrite_cv8u_v1",
        "rotation": "Rz*Ry*Rx",
        "membership": "squared_local_radius<=1",
        "overlap": "later_draw_order_overwrites",
        "output": "opencv_float32_to_uint8_scale_255",
    }
    for key, expected in expected_render_contract.items():
        if render_contract.get(key) != expected:
            raise ValueError(f"unsupported render_contract.{key}: {render_contract.get(key)!r}")
    background = _validate_background(data.get("background"), shape, job_dir / "output" / "compact")
    cells_raw = data.get("cells")
    if not isinstance(cells_raw, list):
        raise ValueError("compact frame cells must be an array")
    cells: list[Mapping[str, Any]] = []
    previous_draw_order = -1
    for index, cell_raw in enumerate(cells_raw):
        cell = _mapping(cell_raw, f"cells[{index}]")
        draw_order = _nonnegative_int(cell.get("draw_order"), f"cells[{index}].draw_order")
        if draw_order <= previous_draw_order:
            raise ValueError("compact cells must be in strictly increasing draw_order")
        previous_draw_order = draw_order
        _nonempty_string(cell.get("name"), f"cells[{index}].name")
        center = _xyz(cell.get("center"), f"cells[{index}].center")
        radii = _abc(cell.get("radii"), f"cells[{index}].radii", positive=True)
        rotation = _rotation_xyz(cell.get("rotation"), f"cells[{index}].rotation")
        _finite_float(cell.get("brightness"), f"cells[{index}].brightness")
        if not isinstance(cell.get("is_trash"), bool):
            raise ValueError(f"cells[{index}].is_trash must be boolean")
        cells.append({
            "drawOrder": draw_order,
            "name": cell["name"],
            "centerXYZ": list(center),
            "radiiABC": list(radii),
            "rotationXYZ": list(rotation),
            "brightness": cell["brightness"],
            "isTrash": cell["is_trash"],
        })

    return CompactFrame(
        path=path,
        frame=record_frame,
        source=_nonempty_string(data.get("source_frame"), "source_frame"),
        pipeline=_nonempty_string(data.get("pipeline_mode"), "pipeline_mode"),
        shape_zyx=shape,
        z_ratio=ratio,
        z_ratio_source=ratio_source,
        coordinate_space=coordinate_space,
        initial_z_space=initial_z_space,
        background=background,
        cells=tuple(cells),
    )


def compact_cells_to_ellipsoid_payload(record: CompactFrame) -> list[dict[str, Any]]:
    payload: list[dict[str, Any]] = []
    for cell in record.cells:
        center = _vec3(cell["centerXYZ"], "cell.centerXYZ")
        radii = _vec3(cell["radiiABC"], "cell.radiiABC", positive=True)
        rotation = _vec3(cell["rotationXYZ"], "cell.rotationXYZ")
        payload.append({
            "file": str(record.source),
            "name": str(cell["name"]),
            "x": center[0],
            "y": center[1],
            "z": center[2],
            "aRadius": radii[0],
            "bRadius": radii[1],
            "cRadius": radii[2],
            "thetaX": rotation[0],
            "thetaY": rotation[1],
            "thetaZ": rotation[2],
            "isTrash": bool(cell["isTrash"]),
        })
    return payload


def merge_compact_cell_frames(
    job_dir: Path,
    csv_frames: Mapping[int, Sequence[Mapping[str, Any]]],
    *,
    frame_paths: Mapping[int, Path] | None = None,
) -> dict[int, list[dict[str, Any]]]:
    discovered = dict(frame_paths) if frame_paths is not None else compact_frame_paths(job_dir / "output")
    if not discovered:
        return {
            int(frame): [dict(cell) for cell in cells]
            for frame, cells in csv_frames.items()
        }

    records = [
        load_compact_frame(job_dir, frame, record_path=path)
        for frame, path in sorted(discovered.items())
    ]
    compact_source_names = {
        _source_filename(str(record.source))
        for record in records
    }
    merged: dict[int, list[dict[str, Any]]] = {}
    for frame, cells in csv_frames.items():
        retained = [
            dict(cell)
            for cell in cells
            if _source_filename(str(cell.get("file") or "")) not in compact_source_names
        ]
        if retained:
            merged[int(frame)] = retained

    for record in records:
        merged[record.frame] = compact_cells_to_ellipsoid_payload(record)
    return merged


def ensure_compact_pointcloud_preview(
    job_dir: Path,
    frame: int,
    layer: str,
    preview_path: Path,
    *,
    max_points: int = DEFAULT_MAX_POINTS,
    max_slices: int = DEFAULT_MAX_SLICES,
    intensity_percentile: float = DEFAULT_INTENSITY_PERCENTILE,
    xy_density_multiplier: float = 1.0,
) -> Path:
    with _preview_generation_lock(preview_path):
        record = load_compact_frame(job_dir, frame)
        sampler, dependencies = _make_sampler(job_dir, record, layer)
        try:
            fingerprint = _dependency_fingerprint(dependencies)
            metadata = _read_preview_metadata(preview_path)
            if metadata and _pointcloud_cache_matches(
                metadata,
                fingerprint,
                layer=layer,
                max_points=max_points,
                max_slices=max_slices,
                intensity_percentile=intensity_percentile,
                xy_density_multiplier=xy_density_multiplier,
            ):
                return preview_path

            preview_path.parent.mkdir(parents=True, exist_ok=True)
            with _temporary_preview_path(preview_path) as tmp_path:
                _build_pointcloud_from_sampler(
                    sampler,
                    tmp_path,
                    record=record,
                    layer=layer,
                    fingerprint=fingerprint,
                    max_points=max_points,
                    max_slices=max_slices,
                    intensity_percentile=intensity_percentile,
                    xy_density_multiplier=xy_density_multiplier,
                )
                tmp_path.replace(preview_path)
            return preview_path
        finally:
            sampler.close()


def ensure_compact_slice_preview(
    job_dir: Path,
    frame: int,
    layer: str,
    preview_path: Path,
    *,
    slice_index: int,
    max_xy: int,
) -> Path:
    with _preview_generation_lock(preview_path):
        record = load_compact_frame(job_dir, frame)
        sampler, dependencies = _make_sampler(job_dir, record, layer)
        try:
            newest_dependency = max(path.stat().st_mtime_ns for path in dependencies)
            try:
                if preview_path.stat().st_mtime_ns >= newest_dependency:
                    return preview_path
            except OSError:
                pass

            source_index = max(0, min(sampler.depth - 1, round(slice_index)))
            source = sampler.read_slice(source_index)
            width, height = _fit_preview_size(sampler.width, sampler.height, max_xy)
            values = _downsample_nearest(source, sampler.width, sampler.height, width, height)
            pixels = _normalize_to_u8(values)

            preview_path.parent.mkdir(parents=True, exist_ok=True)
            with _temporary_preview_path(preview_path) as tmp_path:
                with tmp_path.open("wb") as out:
                    out.write(SLICE_MAGIC)
                    out.write(struct.pack(
                        SLICE_HEADER_FORMAT,
                        SLICE_VERSION,
                        width,
                        height,
                        sampler.width,
                        sampler.height,
                        sampler.depth,
                        source_index,
                        DISPLAY_MAX,
                    ))
                    out.write(pixels)
                tmp_path.replace(preview_path)
            return preview_path
        finally:
            sampler.close()


def compact_slice_cache_target(
    job_dir: Path,
    frame: int,
    layer: str,
    requested_slice: int,
    max_xy: int,
) -> tuple[Path, int]:
    """Return the bounded cache target and source slice for a compact frame."""
    if layer not in {"real", "synth"}:
        raise ValueError(f"unsupported compact preview layer: {layer}")
    record = load_compact_frame(job_dir, frame)
    source_index = max(0, min(record.shape_zyx[0] - 1, requested_slice))
    target = (
        job_dir
        / "preview"
        / "slices"
        / layer
        / str(frame)
        / f"z{source_index}_xy{max_xy}.cusl"
    )
    return target, source_index


def resolve_raw_frame_path(job_dir: Path, frame: int, source_frame: str | None = None) -> Path:
    argv = read_json(job_dir / "argv.json", [])
    if not isinstance(argv, list) or len(argv) < 4 or not isinstance(argv[3], str):
        raise ValueError("job argv does not contain a valid input path")
    input_reference = argv[3]
    if re.search(r"%0?\d*d", input_reference):
        try:
            candidate = Path(input_reference % frame)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"invalid TIFF input pattern: {input_reference}") from exc
        # The compact record carries the exact source filename. Prefer that
        # filename in the directory selected by the expanded input pattern so
        # zero-based job frames can still resolve one-based microscopy names.
        # Keep the expanded pattern as a fallback for patterns whose frame
        # placeholder selects a subdirectory rather than the filename.
        if source_frame:
            _validate_source_frame_name(source_frame)
            source_named_candidate = candidate.parent / source_frame
            if source_named_candidate.is_file():
                candidate = source_named_candidate
    else:
        source = Path(input_reference)
        if source.is_dir():
            if source_frame:
                _validate_source_frame_name(source_frame)
                candidate = source / source_frame
            else:
                files = sorted(
                    (
                        path
                        for path in source.iterdir()
                        if path.is_file()
                        and not path.name.startswith("._")
                        and path.suffix.lower() in _TIFF_SUFFIXES
                    ),
                    key=lambda path: path.name,
                )
                if frame < 0 or frame >= len(files):
                    raise FileNotFoundError(f"raw input frame {frame} is outside the dataset")
                candidate = files[frame]
        else:
            candidate = source
    if not candidate.is_file() or candidate.suffix.lower() not in _TIFF_SUFFIXES:
        raise FileNotFoundError(f"raw TIFF for frame {frame} not found")
    return candidate


def _validate_source_frame_name(source_frame: str) -> None:
    if (
        not source_frame
        or source_frame in {".", ".."}
        or Path(source_frame).name != source_frame
        or "/" in source_frame
        or "\\" in source_frame
    ):
        raise ValueError("compact source_frame must be a filename")


class _VolumeSampler:
    width: int
    height: int
    depth: int

    def read_slice(self, z: int) -> list[float]:
        raise NotImplementedError

    def close(self) -> None:
        return


class _InterpolatedTiffSampler(_VolumeSampler):
    def __init__(self, source_tiff: Path, record: CompactFrame):
        self._handle: BinaryIO = source_tiff.open("rb")
        try:
            _, self._pages = _read_tiff_pages(self._handle)
            if not self._pages:
                raise ValueError("raw TIFF file has no image pages")
            _validate_supported_pages(self._pages)
            first = self._pages[0]
            self.width = first.width
            self.height = first.height
            self.depth = record.shape_zyx[0]
            self._ratio = record.z_ratio
            self._source_intervals = len(self._pages) - 1
            self._output_intervals = self.depth - 1
            expected_depth = round(self._source_intervals * self._ratio) + 1
            if self.depth != expected_depth:
                raise ValueError(
                    "compact shape/interpolation mismatch: "
                    f"shape depth {self.depth}, expected {expected_depth} from raw depth "
                    f"{len(self._pages)} and ratio {self._ratio}"
                )
            if (self.height, self.width) != record.shape_zyx[1:]:
                raise ValueError(
                    "compact shape/raw TIFF mismatch: "
                    f"compact YX {record.shape_zyx[1:]}, raw YX {(self.height, self.width)}"
                )
            self._page_cache: OrderedDict[int, list[float]] = OrderedDict()
        except Exception:
            self._handle.close()
            raise

    def read_slice(self, z: int) -> list[float]:
        z = max(0, min(self.depth - 1, z))
        if self._source_intervals == 0 or self._output_intervals == 0:
            return self._read_raw_page(0)
        source_position = z * self._source_intervals / self._output_intervals
        lower = math.floor(source_position)
        upper = min(len(self._pages) - 1, lower + 1)
        alpha = source_position - lower
        if alpha == 0 or lower == upper:
            return self._read_raw_page(lower)
        low = self._read_raw_page(lower)
        high = self._read_raw_page(upper)
        return [(1.0 - alpha) * left + alpha * right for left, right in zip(low, high, strict=True)]

    def _read_raw_page(self, page_index: int) -> list[float]:
        cached = self._page_cache.pop(page_index, None)
        if cached is not None:
            self._page_cache[page_index] = cached
            return cached
        data = _read_page(self._handle, self._pages[page_index])
        self._page_cache[page_index] = data
        while len(self._page_cache) > 4:
            self._page_cache.popitem(last=False)
        return data

    def close(self) -> None:
        self._handle.close()


class _CompactSynthSampler(_VolumeSampler):
    def __init__(self, record: CompactFrame, compact_root: Path):
        self.depth, self.height, self.width = record.shape_zyx
        self._background = record.background
        self._background_rotation = _rotation_matrix(
            _vec3(self._background.get("rotationXYZ"), "background.rotationXYZ")
        ) if self._background["kind"] == "rotated_soft_ellipsoid" else None
        self._mask: _BinaryMask | None = None
        if self._background["kind"] == "binary_mask":
            mask_path = _safe_compact_child(compact_root, self._background["mask"])
            self._mask = _read_binary_mask(mask_path, record.shape_zyx)
        self._cells = tuple(
            _Ellipsoid(
                center=_vec3(cell["centerXYZ"], "cell.centerXYZ"),
                radii=_vec3(cell["radiiABC"], "cell.radiiABC", positive=True),
                rotation=_vec3(cell["rotationXYZ"], "cell.rotationXYZ"),
                brightness=_finite_float(cell["brightness"], "cell.brightness"),
            )
            for cell in record.cells
        )
        self._cell_rotations = tuple(_rotation_matrix(cell.rotation) for cell in self._cells)

    def read_slice(self, z: int) -> list[float]:
        z = max(0, min(self.depth - 1, z))
        values = self._background_slice(z)
        for cell, rotation in zip(self._cells, self._cell_rotations, strict=True):
            max_radius = max(cell.radii)
            if abs(z - cell.center[2]) > max_radius:
                continue
            min_x = max(0, math.floor(cell.center[0] - max_radius))
            max_x = min(self.width - 1, math.ceil(cell.center[0] + max_radius))
            min_y = max(0, math.floor(cell.center[1] - max_radius))
            max_y = min(self.height - 1, math.ceil(cell.center[1] + max_radius))
            for y in range(min_y, max_y + 1):
                row = y * self.width
                for x in range(min_x, max_x + 1):
                    if _inside_ellipsoid(x, y, z, cell.center, cell.radii, rotation):
                        values[row + x] = cell.brightness
        return [_saturating_cv8u(value) for value in values]

    def _background_slice(self, z: int) -> list[float]:
        kind = self._background["kind"]
        if kind == "scalar":
            return [float(self._background["value"])] * (self.width * self.height)
        cold = float(self._background["cold"])
        hot = float(self._background["hot"])
        if kind == "binary_mask":
            assert self._mask is not None
            return [
                hot if self._mask.contains(z, y, x) else cold
                for y in range(self.height)
                for x in range(self.width)
            ]

        center = _vec3(self._background["centerXYZ"], "background.centerXYZ")
        radii = _vec3(self._background["radiiABC"], "background.radiiABC", positive=True)
        soft_margin = _finite_float(self._background["softMargin"], "background.softMargin")
        additive_offset = _finite_float(
            self._background["additiveOffset"],
            "background.additiveOffset",
        )
        offset_updates = self._background.get("offsetUpdates")
        assert self._background_rotation is not None
        values = [cold] * (self.width * self.height)
        for y in range(self.height):
            row = y * self.width
            for x in range(self.width):
                local = _inverse_rotate(x - center[0], y - center[1], z - center[2], self._background_rotation)
                radial = math.sqrt(sum((local[index] / radii[index]) ** 2 for index in range(3)))
                if soft_margin <= 1e-8:
                    membership = 1.0 if radial <= 1.0 else 0.0
                else:
                    u = max(0.0, min(1.0, (1.0 + soft_margin - radial) / (2.0 * soft_margin)))
                    membership = u * u * (3.0 - 2.0 * u)
                background = cold + membership * (hot - cold)
                if isinstance(offset_updates, list):
                    for delta in offset_updates:
                        background = max(0.0, min(1.0, background + float(delta)))
                else:
                    background = max(0.0, min(1.0, background + additive_offset))
                values[row + x] = background
        return values


def _make_sampler(
    job_dir: Path,
    record: CompactFrame,
    layer: str,
) -> tuple[_VolumeSampler, tuple[Path, ...]]:
    if layer == "real":
        raw_tiff = resolve_raw_frame_path(job_dir, record.frame, str(record.source))
        return _InterpolatedTiffSampler(raw_tiff, record), (record.path, raw_tiff)
    if layer != "synth":
        raise ValueError(f"unsupported compact preview layer: {layer}")
    compact_root = job_dir / "output" / "compact"
    dependencies = [record.path]
    if record.background["kind"] == "binary_mask":
        dependencies.append(_safe_compact_child(compact_root, record.background["mask"]))
    return _CompactSynthSampler(record, compact_root), tuple(dependencies)


def _build_pointcloud_from_sampler(
    sampler: _VolumeSampler,
    preview_path: Path,
    *,
    record: CompactFrame,
    layer: str,
    fingerprint: list[dict[str, int | str]],
    max_points: int,
    max_slices: int,
    intensity_percentile: float,
    xy_density_multiplier: float,
) -> None:
    selected_indices = _select_slice_indices(sampler.depth, max_slices)
    xy_step = _choose_xy_step(
        sampler.width,
        sampler.height,
        len(selected_indices),
        max_points,
        xy_density_multiplier=xy_density_multiplier,
    )
    samples = list(_iter_samples(sampler, selected_indices, xy_step))
    sampled_values = [
        value for _, _, _, value in samples if value > 0 and math.isfinite(value)
    ]
    threshold = (
        _percentile(sampled_values, max(0.0, min(100.0, float(intensity_percentile))))
        if sampled_values
        else 1.0
    )
    candidate_count = 0
    intensity_max = 0.0
    for _, _, _, value in samples:
        if math.isfinite(value):
            intensity_max = max(intensity_max, value)
            if value >= threshold:
                candidate_count += 1
    keep_stride = max(1, math.ceil(candidate_count / max(1, max_points)))
    intensity_max = intensity_max if intensity_max > 0 else 1.0

    with preview_path.open("wb") as out:
        out.write(b"\x00" * _HEADER_SIZE)
        point_count = 0
        candidate_index = 0
        for x, y, z, value in samples:
            if not math.isfinite(value) or value < threshold:
                continue
            if candidate_index % keep_stride == 0:
                intensity = max(0.0, min(1.0, value / intensity_max))
                out.write(struct.pack("<ffff", float(x), float(y), float(z), float(intensity)))
                point_count += 1
            candidate_index += 1
        metadata = {
            "source": f"compact-{layer}-frame-{record.frame}",
            "compactLayer": layer,
            "compactSchema": COMPACT_FRAME_SCHEMA,
            "compactVersion": COMPACT_VERSION,
            "dependencyFingerprint": fingerprint,
            "maxPoints": max_points,
            "maxSlices": max_slices,
            "intensityPercentile": intensity_percentile,
            "sourceWidth": sampler.width,
            "sourceHeight": sampler.height,
            "depth": sampler.depth,
            "selectedSlices": len(selected_indices),
            "xyStep": xy_step,
            "xyDensityMultiplier": xy_density_multiplier,
            "threshold": threshold,
            "intensityMax": intensity_max,
            "zInterpolationRatio": record.z_ratio,
            "zInterpolationSource": record.z_ratio_source,
            "zCoordinateSpace": record.coordinate_space,
            "initialZSpace": record.initial_z_space,
        }
        metadata_bytes = json.dumps(metadata, separators=(",", ":")).encode("utf-8")
        out.write(metadata_bytes)
        out.seek(0)
        out.write(POINTCLOUD_MAGIC)
        out.write(struct.pack(
            _HEADER_FORMAT,
            POINTCLOUD_VERSION,
            point_count,
            sampler.width,
            sampler.height,
            sampler.depth,
            len(selected_indices),
            xy_step,
            float(threshold),
            len(metadata_bytes),
        ))


@contextmanager
def _preview_generation_lock(preview_path: Path) -> Iterator[None]:
    """Serialize generation for one cache target without retaining locks forever."""
    key = preview_path.absolute()
    with _PREVIEW_LOCKS_GUARD:
        entry = _PREVIEW_LOCKS.get(key)
        if entry is None:
            entry = [threading.Lock(), 0]
            _PREVIEW_LOCKS[key] = entry
        entry[1] += 1
    lock = entry[0]
    lock.acquire()
    try:
        yield
    finally:
        lock.release()
        with _PREVIEW_LOCKS_GUARD:
            entry[1] -= 1
            if entry[1] == 0 and _PREVIEW_LOCKS.get(key) is entry:
                del _PREVIEW_LOCKS[key]


@contextmanager
def _temporary_preview_path(preview_path: Path) -> Iterator[Path]:
    """Create a collision-free sibling for atomic preview publication."""
    with tempfile.NamedTemporaryFile(
        dir=preview_path.parent,
        prefix=f".{preview_path.name}.",
        suffix=".tmp",
        delete=False,
    ) as handle:
        tmp_path = Path(handle.name)
    try:
        yield tmp_path
    finally:
        tmp_path.unlink(missing_ok=True)


def _iter_samples(
    sampler: _VolumeSampler,
    selected_indices: Sequence[int],
    xy_step: int,
) -> Iterable[tuple[int, int, int, float]]:
    for z in selected_indices:
        data = sampler.read_slice(z)
        for y in range(0, sampler.height, xy_step):
            row = y * sampler.width
            for x in range(0, sampler.width, xy_step):
                yield x, y, z, data[row + x]


def _pointcloud_cache_matches(
    metadata: Mapping[str, Any],
    fingerprint: list[dict[str, int | str]],
    *,
    layer: str,
    max_points: int,
    max_slices: int,
    intensity_percentile: float,
    xy_density_multiplier: float,
) -> bool:
    try:
        return (
            metadata.get("compactLayer") == layer
            and metadata.get("compactSchema") == COMPACT_FRAME_SCHEMA
            and int(metadata.get("compactVersion", -1)) == COMPACT_VERSION
            and metadata.get("dependencyFingerprint") == fingerprint
            and int(metadata.get("maxPoints", -1)) == max_points
            and int(metadata.get("maxSlices", -1)) == max_slices
            and abs(float(metadata.get("intensityPercentile", -1.0)) - intensity_percentile) < 1e-6
            and abs(float(metadata.get("xyDensityMultiplier", -1.0)) - xy_density_multiplier) < 1e-6
        )
    except (TypeError, ValueError):
        return False


def _dependency_fingerprint(paths: Sequence[Path]) -> list[dict[str, int | str]]:
    fingerprint: list[dict[str, int | str]] = []
    for path in paths:
        stat = path.stat()
        fingerprint.append({
            "name": path.name,
            "size": stat.st_size,
            "mtimeNs": stat.st_mtime_ns,
        })
    return fingerprint


def _validate_background(value: Any, shape: tuple[int, int, int], compact_root: Path) -> Mapping[str, Any]:
    background = _mapping(value, "background")
    kind = background.get("kind")
    if kind == "scalar":
        _finite_float(background.get("value"), "background.value")
        normalized: Mapping[str, Any] = {
            "kind": "scalar",
            "value": background["value"],
        }
    elif kind == "rotated_soft_ellipsoid":
        center = _xyz(background.get("center"), "background.center")
        radii = _abc(background.get("radii"), "background.radii", positive=True)
        rotation = _rotation_xyz(background.get("rotation"), "background.rotation")
        _finite_float(background.get("cold"), "background.cold")
        _finite_float(background.get("hot"), "background.hot")
        soft_margin = _finite_float(background.get("soft_margin"), "background.soft_margin")
        if soft_margin < 0:
            raise ValueError("background.soft_margin must be nonnegative")
        additive_offset = _finite_float(
            background.get("additive_offset"),
            "background.additive_offset",
        )
        offset_updates_raw = background.get("offset_updates")
        if offset_updates_raw is None:
            offset_updates = None
        elif isinstance(offset_updates_raw, list):
            offset_updates = [
                _finite_float(value, f"background.offset_updates[{index}]")
                for index, value in enumerate(offset_updates_raw)
            ]
        else:
            raise ValueError("background.offset_updates must be an array when present")
        normalized = {
            "kind": kind,
            "centerXYZ": list(center),
            "radiiABC": list(radii),
            "rotationXYZ": list(rotation),
            "cold": background["cold"],
            "hot": background["hot"],
            "softMargin": soft_margin,
            "additiveOffset": additive_offset,
            "offsetUpdates": offset_updates,
        }
    elif kind == "binary_mask":
        _finite_float(background.get("cold"), "background.cold")
        _finite_float(background.get("hot"), "background.hot")
        if background.get("mask_format") != "CUBM1":
            raise ValueError(f"unsupported background.mask_format: {background.get('mask_format')!r}")
        mask_relative = _nonempty_string(background.get("mask_path"), "background.mask_path")
        mask_path = _safe_compact_child(compact_root, mask_relative, field="background.mask_path")
        _validate_binary_mask_header(mask_path, shape)
        normalized = {
            "kind": kind,
            "cold": background["cold"],
            "hot": background["hot"],
            "mask": mask_relative,
        }
    else:
        raise ValueError(f"unsupported compact background kind: {kind!r}")
    return normalized


def _read_binary_mask(path: Path, expected_shape: tuple[int, int, int]) -> _BinaryMask:
    with path.open("rb") as handle:
        header = handle.read(_COMPACT_MASK_HEADER.size)
        if len(header) != _COMPACT_MASK_HEADER.size:
            raise ValueError("compact binary mask header is truncated")
        magic, version, flags, width, height, depth, voxel_count = _COMPACT_MASK_HEADER.unpack(header)
        if magic != COMPACT_MASK_MAGIC or version != COMPACT_MASK_VERSION or flags != 1:
            raise ValueError("unsupported compact binary mask")
        shape = (depth, height, width)
        if shape != expected_shape:
            raise ValueError(f"compact binary mask shape {shape} does not match frame shape {expected_shape}")
        expected_voxels = depth * height * width
        if voxel_count != expected_voxels:
            raise ValueError("compact binary mask voxel count does not match its dimensions")
        expected_bytes = (voxel_count + 7) // 8
        payload = handle.read()
        if len(payload) != expected_bytes:
            raise ValueError(
                f"compact binary mask payload has {len(payload)} bytes; expected {expected_bytes}"
            )
    return _BinaryMask(shape, payload)


def _validate_binary_mask_header(path: Path, expected_shape: tuple[int, int, int]) -> None:
    with path.open("rb") as handle:
        header = handle.read(_COMPACT_MASK_HEADER.size)
    if len(header) != _COMPACT_MASK_HEADER.size:
        raise ValueError("compact binary mask header is truncated")
    magic, version, flags, width, height, depth, voxel_count = _COMPACT_MASK_HEADER.unpack(header)
    if magic != COMPACT_MASK_MAGIC or version != COMPACT_MASK_VERSION or flags != 1:
        raise ValueError("unsupported compact binary mask")
    if (depth, height, width) != expected_shape:
        raise ValueError("compact binary mask shape does not match frame shape")
    expected_voxels = depth * height * width
    if voxel_count != expected_voxels:
        raise ValueError("compact binary mask voxel count does not match its dimensions")
    expected_size = _COMPACT_MASK_HEADER.size + (voxel_count + 7) // 8
    if path.stat().st_size != expected_size:
        raise ValueError("compact binary mask size does not match its declared shape")


def _safe_compact_child(compact_root: Path, value: Any, *, field: str = "background.mask") -> Path:
    relative = _nonempty_string(value, field)
    candidate = (compact_root / relative).resolve()
    root = compact_root.resolve()
    try:
        candidate.relative_to(root)
    except ValueError as exc:
        raise ValueError(f"{field} escapes the compact output directory") from exc
    if not candidate.is_file():
        raise FileNotFoundError(f"compact file not found: {relative}")
    return candidate


def _inside_ellipsoid(
    x: float,
    y: float,
    z: float,
    center: tuple[float, float, float],
    radii: tuple[float, float, float],
    rotation: tuple[tuple[float, float, float], ...],
) -> bool:
    local = _inverse_rotate(x - center[0], y - center[1], z - center[2], rotation)
    normalized_squared = sum((local[index] / radii[index]) ** 2 for index in range(3))
    return normalized_squared <= 1.0


def _inverse_rotate(
    x: float,
    y: float,
    z: float,
    rotation: tuple[tuple[float, float, float], ...],
) -> tuple[float, float, float]:
    return (
        rotation[0][0] * x + rotation[1][0] * y + rotation[2][0] * z,
        rotation[0][1] * x + rotation[1][1] * y + rotation[2][1] * z,
        rotation[0][2] * x + rotation[1][2] * y + rotation[2][2] * z,
    )


def _rotation_matrix(
    rotation_xyz: tuple[float, float, float],
) -> tuple[tuple[float, float, float], ...]:
    rx, ry, rz = rotation_xyz
    sx, cx = math.sin(rx), math.cos(rx)
    sy, cy = math.sin(ry), math.cos(ry)
    sz, cz = math.sin(rz), math.cos(rz)
    return (
        (cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx),
        (sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx),
        (-sy, cy * sx, cy * cx),
    )


def _read_json_object(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError(f"invalid compact JSON file {path.name}: {exc}") from exc
    if not isinstance(data, dict):
        raise ValueError(f"compact JSON file {path.name} must contain an object")
    return data


def _mapping(value: Any, field: str) -> Mapping[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{field} must be an object")
    return value


def _vec3(value: Any, field: str, *, positive: bool = False) -> tuple[float, float, float]:
    if not isinstance(value, list) or len(value) != 3:
        raise ValueError(f"{field} must contain exactly three numbers")
    parsed = tuple(_finite_float(item, f"{field}[{index}]") for index, item in enumerate(value))
    if positive and any(item <= 0 for item in parsed):
        raise ValueError(f"{field} values must be positive")
    return parsed


def _xyz(value: Any, field: str) -> tuple[float, float, float]:
    mapping = _mapping(value, field)
    return tuple(
        _finite_float(mapping.get(axis), f"{field}.{axis}")
        for axis in ("x", "y", "z")
    )


def _abc(value: Any, field: str, *, positive: bool = False) -> tuple[float, float, float]:
    mapping = _mapping(value, field)
    parsed = tuple(
        _finite_float(mapping.get(axis), f"{field}.{axis}")
        for axis in ("a", "b", "c")
    )
    if positive and any(item <= 0 for item in parsed):
        raise ValueError(f"{field} values must be positive")
    return parsed


def _rotation_xyz(value: Any, field: str) -> tuple[float, float, float]:
    mapping = _mapping(value, field)
    return tuple(
        _finite_float(mapping.get(axis), f"{field}.{axis}")
        for axis in ("theta_x", "theta_y", "theta_z")
    )


def _finite_float(value: Any, field: str) -> float:
    if isinstance(value, bool):
        raise ValueError(f"{field} must be a finite number")
    try:
        parsed = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{field} must be a finite number") from exc
    if not math.isfinite(parsed):
        raise ValueError(f"{field} must be a finite number")
    return parsed


def _interpolation_ratio(value: Any, field: str) -> float:
    parsed = _finite_float(value, field)
    try:
        parsed = struct.unpack("<f", struct.pack("<f", parsed))[0]
    except (OverflowError, struct.error) as exc:
        raise ValueError(f"{field} must be finite and at least 1") from exc
    if not math.isfinite(parsed) or parsed < 1.0:
        raise ValueError(f"{field} must be finite and at least 1")
    return parsed


def _saturating_cv8u(value: float) -> float:
    if not math.isfinite(value) or value <= 0:
        return 0.0
    scaled = value * 255.0
    if scaled >= 255.0:
        return 255.0
    # OpenCV's cvRound uses the default nearest-even floating-point mode.
    return float(round(scaled))


def _positive_int(value: Any, field: str) -> int:
    parsed = _nonnegative_int(value, field)
    if parsed <= 0:
        raise ValueError(f"{field} must be positive")
    return parsed


def _nonnegative_int(value: Any, field: str) -> int:
    if isinstance(value, bool):
        raise ValueError(f"{field} must be a nonnegative integer")
    try:
        parsed = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{field} must be a nonnegative integer") from exc
    if parsed < 0 or parsed != value:
        raise ValueError(f"{field} must be a nonnegative integer")
    return parsed


def _nonempty_string(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} must be a nonempty string")
    return value


def _source_filename(value: str) -> str:
    return Path(value.replace("\\", "/")).name
