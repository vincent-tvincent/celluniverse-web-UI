from __future__ import annotations

import json
import math
import struct
import zlib
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
    5: ("II", 8),
    11: ("f", 4),
    12: ("d", 8),
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
    endian: str
    sample_format: int = 1
    planar_config: int = 1
    predictor: int = 1


def ensure_pointcloud_preview(
    source_tiff: Path,
    preview_path: Path,
    *,
    max_points: int = DEFAULT_MAX_POINTS,
    max_slices: int = DEFAULT_MAX_SLICES,
    intensity_percentile: float = DEFAULT_INTENSITY_PERCENTILE,
    xy_density_multiplier: float = 1.0,
) -> Path:
    if _preview_cache_matches(
        preview_path,
        source_tiff,
        max_points=max_points,
        max_slices=max_slices,
        intensity_percentile=intensity_percentile,
        xy_density_multiplier=xy_density_multiplier,
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
        xy_density_multiplier=xy_density_multiplier,
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
    xy_density_multiplier: float = 1.0,
) -> None:
    with source_tiff.open("rb") as handle:
        _endian, pages = _read_tiff_pages(handle)
        if not pages:
            raise ValueError("TIFF file has no image pages")
        first = pages[0]
        _validate_supported_pages(pages)
        selected_indices = _select_slice_indices(len(pages), max_slices)
        xy_step = _choose_xy_step(
            first.width,
            first.height,
            len(selected_indices),
            max_points,
            xy_density_multiplier=xy_density_multiplier,
        )
        threshold = _compute_threshold(handle, pages, selected_indices, xy_step, intensity_percentile)
        candidates = _count_candidates(handle, pages, selected_indices, xy_step, threshold)
        keep_stride = max(1, math.ceil(candidates / max(1, max_points)))
        intensity_max = _compute_intensity_max(handle, pages, selected_indices, xy_step)

        preview_path.parent.mkdir(parents=True, exist_ok=True)
        with preview_path.open("wb") as out:
            out.write(b"\x00" * _HEADER_SIZE)
            point_count = _write_points(
                out,
                handle,
                pages,
                selected_indices,
                xy_step,
                threshold,
                keep_stride,
                intensity_max,
            )
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
                "xyDensityMultiplier": xy_density_multiplier,
                "threshold": threshold,
                "intensityMax": intensity_max,
                "bitsPerSample": first.bits_per_sample,
                "sampleFormat": first.sample_format,
                "samplesPerPixel": first.samples_per_pixel,
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
    xy_density_multiplier: float,
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
        and abs(float(metadata.get("xyDensityMultiplier", 1.0)) - xy_density_multiplier) < 1e-6
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
        bits = [int(value) for value in _tag_values(tags, 258, [8])]
        bit_depth = bits[0]
        if any(bit != bit_depth for bit in bits):
            raise ValueError("mixed per-channel TIFF bit depths are not supported")
        height = int(_tag_values(tags, 257)[0])
        pages.append(TiffPage(
            width=int(_tag_values(tags, 256)[0]),
            height=height,
            bits_per_sample=bit_depth,
            compression=int(_tag_values(tags, 259, [1])[0]),
            samples_per_pixel=int(_tag_values(tags, 277, [1])[0]),
            rows_per_strip=int(_tag_values(tags, 278, [height])[0]),
            strip_offsets=tuple(int(v) for v in _tag_values(tags, 273)),
            strip_byte_counts=tuple(int(v) for v in _tag_values(tags, 279)),
            endian=endian,
            sample_format=int(_tag_values(tags, 339, [1])[0]),
            planar_config=int(_tag_values(tags, 284, [1])[0]),
            predictor=int(_tag_values(tags, 317, [1])[0]),
        ))
    return endian, pages


def _read_ifd(handle: BinaryIO, endian: str, offset: int) -> tuple[dict[int, list[int | float]], int]:
    handle.seek(offset)
    entry_count = _read_scalar(handle, endian, "H")
    tags: dict[int, list[int | float]] = {}
    for _ in range(entry_count):
        raw = handle.read(12)
        if len(raw) != 12:
            raise ValueError("truncated TIFF directory")
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
        values: list[int | float] = []
        if type_id == 5:
            for i in range(0, total_size, item_size):
                numerator, denominator = struct.unpack(endian + fmt, value_bytes[i:i + item_size])
                values.append(float(numerator) / float(denominator or 1))
        else:
            for i in range(0, total_size, item_size):
                values.append(struct.unpack(endian + fmt, value_bytes[i:i + item_size])[0])
        tags[tag] = values
    next_offset = _read_scalar(handle, endian, "I")
    return tags, next_offset


def _read_scalar(handle: BinaryIO, endian: str, fmt: str) -> int:
    return int(struct.unpack(endian + fmt, handle.read(struct.calcsize(fmt)))[0])


def _tag_values(tags: dict[int, list[int | float]], tag: int, default: list[int] | None = None) -> list[int | float]:
    values = tags.get(tag, default)
    if not values:
        raise ValueError(f"required TIFF tag {tag} is missing")
    return values


def _validate_supported_pages(pages: list[TiffPage]) -> None:
    first = pages[0]
    for page in pages:
        if page.width != first.width or page.height != first.height:
            raise ValueError("variable-size TIFF pages are not supported")
        if page.compression not in {1, 5, 8, 32946}:
            raise ValueError("only uncompressed, LZW, or Deflate TIFF previews are supported")
        if page.samples_per_pixel not in {1, 3, 4}:
            raise ValueError("only grayscale or RGB TIFF previews are supported")
        if page.planar_config != 1:
            raise ValueError("planar TIFF channel storage is not supported")
        if page.predictor not in {1, 2}:
            raise ValueError("unsupported TIFF predictor")
        if page.bits_per_sample not in {8, 16, 32}:
            raise ValueError("only 8-bit, 16-bit, and 32-bit TIFF previews are supported")
        if page.sample_format not in {1, 2, 3}:
            raise ValueError("unsupported TIFF sample format")
        if not page.strip_offsets or not page.strip_byte_counts:
            raise ValueError("TIFF page is missing strip offsets/counts")


def _select_slice_indices(depth: int, max_slices: int) -> list[int]:
    if depth <= 50:
        return list(range(depth))
    stride = max(1, math.ceil(depth / max(1, max_slices)))
    selected = [index for index in range(depth) if index % stride == 0]
    if selected[-1] != depth - 1:
        selected.append(depth - 1)
    return selected


def _choose_xy_step(
    width: int,
    height: int,
    selected_slices: int,
    max_points: int,
    *,
    xy_density_multiplier: float = 1.0,
) -> int:
    voxel_count = max(1, width * height * selected_slices)
    base_step = math.ceil(math.sqrt(voxel_count / (max(1, max_points) * 7)))
    density = max(1.0, float(xy_density_multiplier))
    return max(1, math.floor(base_step / density))


def _compute_threshold(
    handle: BinaryIO,
    pages: list[TiffPage],
    selected_indices: list[int],
    xy_step: int,
    percentile: float,
) -> float:
    values: list[float] = []
    for page_index in selected_indices:
        data = _read_page(handle, pages[page_index])
        page = pages[page_index]
        for y in range(0, page.height, xy_step):
            row = y * page.width
            for x in range(0, page.width, xy_step):
                value = data[row + x]
                if value > 0 and math.isfinite(value):
                    values.append(value)
    if not values:
        return 1.0
    return _percentile(values, max(0.0, min(100.0, float(percentile))))


def _compute_intensity_max(
    handle: BinaryIO,
    pages: list[TiffPage],
    selected_indices: list[int],
    xy_step: int,
) -> float:
    max_value = 0.0
    for page_index in selected_indices:
        data = _read_page(handle, pages[page_index])
        page = pages[page_index]
        for y in range(0, page.height, xy_step):
            row = y * page.width
            for x in range(0, page.width, xy_step):
                value = data[row + x]
                if math.isfinite(value):
                    max_value = max(max_value, value)
    return max_value if max_value > 0 else 1.0


def _count_candidates(
    handle: BinaryIO,
    pages: list[TiffPage],
    selected_indices: list[int],
    xy_step: int,
    threshold: float,
) -> int:
    count = 0
    for page_index in selected_indices:
        data = _read_page(handle, pages[page_index])
        page = pages[page_index]
        for y in range(0, page.height, xy_step):
            row = y * page.width
            for x in range(0, page.width, xy_step):
                value = data[row + x]
                if math.isfinite(value) and value >= threshold:
                    count += 1
    return count


def _write_points(
    out: BinaryIO,
    handle: BinaryIO,
    pages: list[TiffPage],
    selected_indices: list[int],
    xy_step: int,
    threshold: float,
    keep_stride: int,
    intensity_max: float,
) -> int:
    candidate_index = 0
    point_count = 0
    intensity_scale = max(float(intensity_max), 1e-12)
    for page_index in selected_indices:
        data = _read_page(handle, pages[page_index])
        page = pages[page_index]
        for y in range(0, page.height, xy_step):
            row = y * page.width
            for x in range(0, page.width, xy_step):
                value = data[row + x]
                if not math.isfinite(value) or value < threshold:
                    continue
                if candidate_index % keep_stride == 0:
                    intensity = max(0.0, min(1.0, value / intensity_scale))
                    out.write(struct.pack("<ffff", float(x), float(y), float(page_index), float(intensity)))
                    point_count += 1
                candidate_index += 1
    return point_count


def _read_page(handle: BinaryIO, page: TiffPage) -> list[float]:
    chunks: list[bytes] = []
    for offset, byte_count in zip(page.strip_offsets, page.strip_byte_counts, strict=False):
        handle.seek(offset)
        chunks.append(_decompress_strip(handle.read(byte_count), page.compression))
    raw = b"".join(chunks)
    bytes_per_sample = page.bits_per_sample // 8
    if page.predictor == 2:
        raw = _undo_horizontal_predictor(raw, page, bytes_per_sample)
    samples_per_pixel = page.samples_per_pixel
    pixel_count = page.width * page.height
    expected = pixel_count * samples_per_pixel * bytes_per_sample
    if len(raw) < expected:
        raise ValueError("TIFF strip data is shorter than expected")
    sample_fmt = _sample_struct_format(page.bits_per_sample, page.sample_format)
    unpack = struct.Struct(page.endian + sample_fmt).unpack_from
    values = [0.0] * pixel_count
    offset = 0
    for pixel_index in range(pixel_count):
        if samples_per_pixel == 1:
            value = float(unpack(raw, offset)[0])
        else:
            first = float(unpack(raw, offset)[0])
            second = float(unpack(raw, offset + bytes_per_sample)[0]) if samples_per_pixel > 1 else first
            third = float(unpack(raw, offset + (2 * bytes_per_sample))[0]) if samples_per_pixel > 2 else first
            value = first * 0.2126 + second * 0.7152 + third * 0.0722
        values[pixel_index] = max(0.0, value) if math.isfinite(value) else 0.0
        offset += samples_per_pixel * bytes_per_sample
    return values


def _sample_struct_format(bits_per_sample: int, sample_format: int) -> str:
    if bits_per_sample == 8:
        return "b" if sample_format == 2 else "B"
    if bits_per_sample == 16:
        return "h" if sample_format == 2 else "H"
    if bits_per_sample == 32:
        if sample_format == 3:
            return "f"
        return "i" if sample_format == 2 else "I"
    raise ValueError("unsupported TIFF bit depth")


def _percentile(values: list[float], percentile: float) -> float:
    values.sort()
    if not values:
        return 1.0
    if len(values) == 1:
        return values[0]
    index = int(round((len(values) - 1) * percentile / 100.0))
    return float(values[max(0, min(len(values) - 1, index))])



def _decompress_strip(data: bytes, compression: int) -> bytes:
    if compression == 1:
        return data
    if compression == 5:
        return _decode_lzw(data)
    if compression in {8, 32946}:
        return zlib.decompress(data)
    raise ValueError("unsupported TIFF compression")


def _decode_lzw(data: bytes) -> bytes:
    clear_code = 256
    end_code = 257
    bit_reader = _MsbBitReader(data)

    def reset_table() -> tuple[dict[int, bytes], int, int]:
        return {index: bytes([index]) for index in range(256)}, 258, 9

    table, next_code, code_size = reset_table()
    previous = b""
    output = bytearray()

    while True:
        code = bit_reader.read(code_size)
        if code is None:
            break
        if code == clear_code:
            table, next_code, code_size = reset_table()
            previous = b""
            continue
        if code == end_code:
            break
        if code in table:
            entry = table[code]
        elif code == next_code and previous:
            entry = previous + previous[:1]
        else:
            raise ValueError("invalid TIFF LZW code stream")
        output.extend(entry)
        if previous and next_code < 4096:
            table[next_code] = previous + entry[:1]
            next_code += 1
            if next_code == (1 << code_size) - 1 and code_size < 12:
                code_size += 1
        previous = entry
    return bytes(output)


class _MsbBitReader:
    def __init__(self, data: bytes):
        self._data = data
        self._bit_offset = 0

    def read(self, width: int) -> int | None:
        if self._bit_offset + width > len(self._data) * 8:
            return None
        value = 0
        for _ in range(width):
            byte = self._data[self._bit_offset // 8]
            shift = 7 - (self._bit_offset % 8)
            value = (value << 1) | ((byte >> shift) & 1)
            self._bit_offset += 1
        return value


def _undo_horizontal_predictor(raw: bytes, page: TiffPage, bytes_per_sample: int) -> bytes:
    if page.sample_format == 3:
        raise ValueError("floating-point horizontal TIFF predictor is not supported")
    sample_count = page.width * page.height * page.samples_per_pixel
    sample_fmt = _sample_struct_format(page.bits_per_sample, page.sample_format)
    unpack = struct.Struct(page.endian + sample_fmt).unpack_from
    pack = struct.Struct(page.endian + sample_fmt).pack
    modulus = 1 << page.bits_per_sample
    samples = [0] * sample_count
    offset = 0
    for index in range(sample_count):
        samples[index] = int(unpack(raw, offset)[0])
        offset += bytes_per_sample
    for y in range(page.height):
        row = y * page.width * page.samples_per_pixel
        for x in range(1, page.width):
            pixel = row + x * page.samples_per_pixel
            previous = pixel - page.samples_per_pixel
            for channel in range(page.samples_per_pixel):
                samples[pixel + channel] = (samples[pixel + channel] + samples[previous + channel]) % modulus
    return b"".join(pack(value) for value in samples)
