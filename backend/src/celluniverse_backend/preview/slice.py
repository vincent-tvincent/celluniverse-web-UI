from __future__ import annotations

import struct
from pathlib import Path

from celluniverse_backend.preview.pointcloud import _read_page, _read_tiff_pages, _validate_supported_pages


SLICE_MAGIC = b"CUSL"
SLICE_VERSION = 1
SLICE_HEADER_FORMAT = "<IIIIIIII"
SLICE_HEADER_SIZE = 36


def ensure_slice_preview(source_tiff: Path, preview_path: Path, *, slice_index: int, max_xy: int) -> Path:
    if preview_path.exists() and preview_path.stat().st_mtime >= source_tiff.stat().st_mtime:
        return preview_path

    preview_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = preview_path.with_suffix(preview_path.suffix + ".tmp")
    build_slice_preview(source_tiff, tmp_path, slice_index=slice_index, max_xy=max_xy)
    tmp_path.replace(preview_path)
    return preview_path


def build_slice_preview(source_tiff: Path, preview_path: Path, *, slice_index: int, max_xy: int) -> None:
    with source_tiff.open("rb") as handle:
        _, pages = _read_tiff_pages(handle)
        if not pages:
            raise ValueError("TIFF file has no image pages")
        _validate_supported_pages(pages)
        depth = len(pages)
        source_index = max(0, min(depth - 1, round(slice_index)))
        page = pages[source_index]
        source = _read_page(handle, page)
        width, height = _fit_preview_size(page.width, page.height, max_xy)
        pixels = _downsample_nearest(source, page.width, page.height, width, height)
        display_max = max(1, max(pixels) if pixels else 1)

    with preview_path.open("wb") as out:
        out.write(SLICE_MAGIC)
        out.write(struct.pack(
            SLICE_HEADER_FORMAT,
            SLICE_VERSION,
            width,
            height,
            page.width,
            page.height,
            depth,
            source_index,
            display_max,
        ))
        out.write(pixels)


def _fit_preview_size(width: int, height: int, max_xy: int) -> tuple[int, int]:
    longest = max(width, height, 1)
    scale = min(1.0, max(1, max_xy) / longest)
    return max(1, round(width * scale)), max(1, round(height * scale))


def _downsample_nearest(source: bytes, source_width: int, source_height: int, width: int, height: int) -> bytes:
    output = bytearray(width * height)
    for y in range(height):
        source_y = min(source_height - 1, int((y * source_height) / height))
        source_row = source_y * source_width
        target_row = y * width
        for x in range(width):
            source_x = min(source_width - 1, int((x * source_width) / width))
            output[target_row + x] = source[source_row + source_x]
    return bytes(output)
