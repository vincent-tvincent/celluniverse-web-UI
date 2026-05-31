from __future__ import annotations

import json
import math
import struct
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO


POINTCLOUD_MAGIC = b"CUPC"
POINTCLOUD_VERSION = 1
DEFAULT_MAX_POINTS = 250_000
DEFAULT_MAX_SLICES = 48
DEFAULT_INTENSITY_PERCENTILE = 35.0
_HEADER_SIZE = 40
_HEADER_FORMAT = "<IIIIIIIfI"

_TIFF_TYPES = {
    1: ("B", 1),
    2: ("c", 1),
    3: ("H", 2),
    4: ("I", 4),
}


@dataclass(frozen=True)
class TiffPage:
    width: int
    height: int
    bits_per_sample: int
    compression: int
    samples_per_pixel: int
    rows_per_strip: int
    strip_offsets: tuple[int, ...]
    strip_byte_counts: tuple[int, ...]


def ensure_pointcloud_preview(
    source_tiff: Path,
    preview_path: Path,
    *,
    max_points: int = DEFAULT_MAX_POINTS,
    max_slices: int = DEFAULT_MAX_SLICES,
    intensity_percentile: float = DEFAULT_INTENSITY_PERCENTILE,
) -> Path:
    if _preview_cache_matches(
        preview_path,
        source_tiff,
        max_points=max_points,
        max_slices=max_slices,
        intensity_percentile=intensity_percentile,
    ):
        return preview_path

    preview_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = preview_path.with_suffix(preview_path.suffix + ".tmp")
    build_pointcloud_preview(
        source_tiff,
        tmp_path,
        max_points=max_points,
        max_slices=max_slices,
        intensity_percentile=intensity_percentile,
    )
    tmp_path.replace(preview_path)
    return preview_path


def build_pointcloud_preview(
    source_tiff: Path,
    preview_path: Path,
    *,
    max_points: int,
    max_slices: int,
    intensity_percentile: float,
) -> None:
    with source_tiff.open("rb") as handle:
        endian, pages = _read_tiff_pages(handle)
        if not pages:
            raise ValueError("TIFF file has no image pages")
        first = pages[0]
        _validate_supported_pages(pages)
        selected_indices = _select_slice_indices(len(pages), max_slices)
        xy_step = _choose_xy_step(first.width, first.height, len(selected_indices), max_points)
        threshold = _compute_threshold(handle, pages, selected_indices, xy_step, intensity_percentile)
        candidates = _count_candidates(handle, pages, selected_indices, xy_step, threshold)
        keep_stride = max(1, math.ceil(candidates / max(1, max_points)))

        preview_path.parent.mkdir(parents=True, exist_ok=True)
        with preview_path.open("wb") as out:
            out.write(b"\x00" * _HEADER_SIZE)
            point_count = _write_points(out, handle, pages, selected_indices, xy_step, threshold, keep_stride)
            metadata = {
                "source": source_tiff.name,
                "maxPoints": max_points,
                "maxSlices": max_slices,
                "intensityPercentile": intensity_percentile,
                "sourceWidth": first.width,
                "sourceHeight": first.height,
                "depth": len(pages),
                "selectedSlices": len(selected_indices),
                "xyStep": xy_step,
                "threshold": threshold,
            }
            metadata_bytes = json.dumps(metadata, separators=(",", ":")).encode("utf-8")
            out.write(metadata_bytes)
            out.seek(0)
            out.write(POINTCLOUD_MAGIC)
            out.write(struct.pack(
                _HEADER_FORMAT,
                POINTCLOUD_VERSION,
                point_count,
                first.width,
                first.height,
                len(pages),
                len(selected_indices),
                xy_step,
                float(threshold),
                len(metadata_bytes),
            ))


def _preview_cache_matches(
    preview_path: Path,
    source_tiff: Path,
    *,
    max_points: int,
    max_slices: int,
    intensity_percentile: float,
) -> bool:
    if not preview_path.exists() or preview_path.stat().st_mtime < source_tiff.stat().st_mtime:
        return False
    metadata = _read_preview_metadata(preview_path)
    if not metadata:
        return False
    return (
        metadata.get("source") == source_tiff.name
        and metadata.get("maxPoints") == max_points
        and metadata.get("maxSlices") == max_slices
        and abs(float(metadata.get("intensityPercentile", -1.0)) - intensity_percentile) < 1e-6
    )


def _read_preview_metadata(preview_path: Path) -> dict[str, object] | None:
    try:
        with preview_path.open("rb") as handle:
            header = handle.read(_HEADER_SIZE)
            if len(header) != _HEADER_SIZE or header[:4] != POINTCLOUD_MAGIC:
                return None
            unpacked = struct.unpack(_HEADER_FORMAT, header[4:])
            version, point_count, *_rest, metadata_len = unpacked
            if version != POINTCLOUD_VERSION or metadata_len <= 0:
                return None
            handle.seek(_HEADER_SIZE + point_count * 16)
            return json.loads(handle.read(metadata_len).decode("utf-8"))
    except (OSError, struct.error, UnicodeDecodeError, json.JSONDecodeError):
        return None


def _read_tiff_pages(handle: BinaryIO) -> tuple[str, list[TiffPage]]:
    handle.seek(0)
    byte_order = handle.read(2)
    if byte_order == b"II":
        endian = "<"
    elif byte_order == b"MM":
        endian = ">"
    else:
        raise ValueError("not a TIFF file")
    magic = _read_scalar(handle, endian, "H")
    if magic != 42:
        raise ValueError("BigTIFF or unsupported TIFF variant")
    offset = _read_scalar(handle, endian, "I")
    pages: list[TiffPage] = []
    while offset:
        tags, offset = _read_ifd(handle, endian, offset)
        pages.append(TiffPage(
            width=int(_tag_values(tags, 256)[0]),
            height=int(_tag_values(tags, 257)[0]),
            bits_per_sample=int(_tag_values(tags, 258, [8])[0]),
            compression=int(_tag_values(tags, 259, [1])[0]),
            samples_per_pixel=int(_tag_values(tags, 277, [1])[0]),
            rows_per_strip=int(_tag_values(tags, 278, [_tag_values(tags, 257)[0]])[0]),
            strip_offsets=tuple(int(v) for v in _tag_values(tags, 273)),
            strip_byte_counts=tuple(int(v) for v in _tag_values(tags, 279)),
        ))
    return endian, pages


def _read_ifd(handle: BinaryIO, endian: str, offset: int) -> tuple[dict[int, list[int]], int]:
    handle.seek(offset)
    entry_count = _read_scalar(handle, endian, "H")
    tags: dict[int, list[int]] = {}
    for _ in range(entry_count):
        raw = handle.read(12)
        tag, type_id, count = struct.unpack(endian + "HHI", raw[:8])
        if type_id not in _TIFF_TYPES:
            continue
        fmt, item_size = _TIFF_TYPES[type_id]
        total_size = count * item_size
        value_bytes = raw[8:12]
        if total_size > 4:
            value_offset = struct.unpack(endian + "I", value_bytes)[0]
            current = handle.tell()
            handle.seek(value_offset)
            value_bytes = handle.read(total_size)
            handle.seek(current)
        if type_id == 2:
            continue
        values = [
            struct.unpack(endian + fmt, value_bytes[i:i + item_size])[0]
            for i in range(0, total_size, item_size)
        ]
        tags[tag] = values
    next_offset = _read_scalar(handle, endian, "I")
    return tags, next_offset


def _read_scalar(handle: BinaryIO, endian: str, fmt: str) -> int:
    return int(struct.unpack(endian + fmt, handle.read(struct.calcsize(fmt)))[0])


def _tag_values(tags: dict[int, list[int]], tag: int, default: list[int] | None = None) -> list[int]:
    values = tags.get(tag, default)
    if not values:
        raise ValueError(f"required TIFF tag {tag} is missing")
    return values


def _validate_supported_pages(pages: list[TiffPage]) -> None:
    first = pages[0]
    for page in pages:
        if page.width != first.width or page.height != first.height:
            raise ValueError("variable-size TIFF pages are not supported")
        if page.bits_per_sample != 8 or page.samples_per_pixel != 1 or page.compression != 1:
            raise ValueError("only uncompressed 8-bit grayscale TIFF previews are supported")
        if not page.strip_offsets or not page.strip_byte_counts:
            raise ValueError("TIFF page is missing strip offsets/counts")


def _select_slice_indices(depth: int, max_slices: int) -> list[int]:
    stride = max(1, math.ceil(depth / max(1, max_slices)))
    selected = [index for index in range(depth) if index % stride == 0]
    if selected[-1] != depth - 1:
        selected.append(depth - 1)
    return selected


def _choose_xy_step(width: int, height: int, selected_slices: int, max_points: int) -> int:
    voxel_count = max(1, width * height * selected_slices)
    return max(1, math.ceil(math.sqrt(voxel_count / (max(1, max_points) * 7))))


def _compute_threshold(
    handle: BinaryIO,
    pages: list[TiffPage],
    selected_indices: list[int],
    xy_step: int,
    percentile: float,
) -> int:
    histogram = [0] * 256
    nonzero = 0
    for page_index in selected_indices:
        data = _read_page(handle, pages[page_index])
        page = pages[page_index]
        for y in range(0, page.height, xy_step):
            row = y * page.width
            for x in range(0, page.width, xy_step):
                value = data[row + x]
                if value:
                    histogram[value] += 1
                    nonzero += 1
    if nonzero == 0:
        return 1
    target = max(1, int(nonzero * max(0.0, min(100.0, percentile)) / 100.0))
    seen = 0
    for value in range(1, 256):
        seen += histogram[value]
        if seen >= target:
            return value
    return 1


def _count_candidates(
    handle: BinaryIO,
    pages: list[TiffPage],
    selected_indices: list[int],
    xy_step: int,
    threshold: int,
) -> int:
    count = 0
    for page_index in selected_indices:
        data = _read_page(handle, pages[page_index])
        page = pages[page_index]
        for y in range(0, page.height, xy_step):
            row = y * page.width
            for x in range(0, page.width, xy_step):
                if data[row + x] >= threshold:
                    count += 1
    return count


def _write_points(
    out: BinaryIO,
    handle: BinaryIO,
    pages: list[TiffPage],
    selected_indices: list[int],
    xy_step: int,
    threshold: int,
    keep_stride: int,
) -> int:
    candidate_index = 0
    point_count = 0
    for page_index in selected_indices:
        data = _read_page(handle, pages[page_index])
        page = pages[page_index]
        for y in range(0, page.height, xy_step):
            row = y * page.width
            for x in range(0, page.width, xy_step):
                value = data[row + x]
                if value < threshold:
                    continue
                if candidate_index % keep_stride == 0:
                    out.write(struct.pack("<ffff", float(x), float(y), float(page_index), float(value) / 255.0))
                    point_count += 1
                candidate_index += 1
    return point_count


def _read_page(handle: BinaryIO, page: TiffPage) -> bytes:
    chunks: list[bytes] = []
    for offset, byte_count in zip(page.strip_offsets, page.strip_byte_counts, strict=False):
        handle.seek(offset)
        chunks.append(handle.read(byte_count))
    data = b"".join(chunks)
    expected = page.width * page.height
    if len(data) < expected:
        raise ValueError("TIFF strip data is shorter than expected")
    return data[:expected]
