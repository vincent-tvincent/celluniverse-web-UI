import { uiPalette } from "../theme/palette";
import type { CellRecord } from "../types";
import { getColorMap, type ColorMapId } from "./colorMaps";
import { applyContrastLimits, DEFAULT_CONTRAST_LIMITS, type ContrastLimits } from "./contrast";
import type { SlicePreviewData } from "./slicePreview";
import type { VolumeData } from "./tiff";

export type LayerRenderOptions = {
  realEnabled: boolean;
  synthEnabled: boolean;
  realMap: ColorMapId;
  synthMap: ColorMapId;
  realOpacity: number;
  synthOpacity: number;
  realContrastLimits: ContrastLimits;
  synthContrastLimits: ContrastLimits;
};

export function composeSliceImage(
  real: VolumeData | undefined,
  synth: VolumeData | undefined,
  slice: number,
  options: LayerRenderOptions,
): ImageData | null {
  const base = real ?? synth;
  if (!base) {
    return null;
  }
  const pixels = new Uint8ClampedArray(base.width * base.height * 4);
  for (let i = 0; i < base.width * base.height; i += 1) {
    pixels[i * 4 + 3] = 255;
  }

  if (options.realEnabled && real) {
    applyBottomLayer(pixels, real, slice, options.realMap, options.realOpacity, options.realContrastLimits);
  }
  if (options.synthEnabled && synth) {
    applyOverlayLayer(pixels, synth, slice, options.synthMap, options.synthOpacity, options.synthContrastLimits);
  }

  return new ImageData(pixels, base.width, base.height);
}

export function composeSlicePreviewImage(
  real: SlicePreviewData | undefined,
  synth: SlicePreviewData | undefined,
  options: LayerRenderOptions,
): ImageData | null {
  const base = real ?? synth;
  if (!base) {
    return null;
  }
  const pixels = new Uint8ClampedArray(base.width * base.height * 4);
  for (let i = 0; i < base.width * base.height; i += 1) {
    pixels[i * 4 + 3] = 255;
  }

  if (options.realEnabled && real) {
    applySliceBottomLayer(pixels, real, options.realMap, options.realOpacity, options.realContrastLimits);
  }
  if (options.synthEnabled && synth) {
    applySliceOverlayLayer(pixels, synth, options.synthMap, options.synthOpacity, options.synthContrastLimits);
  }

  return new ImageData(pixels, base.width, base.height);
}

export function createLayerTextureData(
  volume: VolumeData,
  slice: number,
  mapId: ColorMapId,
  opacity: number,
  contrastLimits: ContrastLimits = DEFAULT_CONTRAST_LIMITS,
): Uint8ClampedArray {
  const map = getColorMap(mapId);
  const source = getNearestSlice(volume, slice);
  const out = new Uint8ClampedArray(volume.width * volume.height * 4);
  for (let i = 0; i < source.length; i += 1) {
    const intensity = applyContrastLimits(normalizedIntensity(volume, source[i]), contrastLimits);
    const [r, g, b] = map.sample(intensity);
    const offset = i * 4;
    out[offset] = Math.round(r * intensity);
    out[offset + 1] = Math.round(g * intensity);
    out[offset + 2] = Math.round(b * intensity);
    out[offset + 3] = Math.round(255 * opacity * Math.pow(intensity, 0.72));
  }
  return out;
}

export function drawCellOverlay(
  ctx: CanvasRenderingContext2D,
  cells: CellRecord[],
  slice: number,
  imageRect: { x: number; y: number; width: number; height: number },
  imageSize: { width: number; height: number },
  cellOutlineColors?: Record<string, string>,
): void {
  if (!cells.length) {
    return;
  }
  ctx.save();
  ctx.lineWidth = Math.max(1.2, Math.min(imageRect.width, imageRect.height) / 420);
  for (const cell of cells) {
    const zRadius = Math.max(1, Number(cell.cRadius) || 1);
    const dz = Math.abs(slice - Number(cell.z));
    if (dz > zRadius) {
      continue;
    }
    const scale = Math.sqrt(Math.max(0.05, 1 - (dz * dz) / (zRadius * zRadius)));
    const cx = imageRect.x + (Number(cell.x) / imageSize.width) * imageRect.width;
    const cy = imageRect.y + (Number(cell.y) / imageSize.height) * imageRect.height;
    const rx = Math.max(2, (Number(cell.aRadius) / imageSize.width) * imageRect.width * scale);
    const ry = Math.max(2, (Number(cell.bRadius) / imageSize.height) * imageRect.height * scale);

    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, getCellAngle(cell.thetaZ, cell.theta_z), 0, Math.PI * 2);
    const lineageColorMode = cellOutlineColors !== undefined;
    const trashColor = lineageColorMode ? uiPalette.cellTrashLineage : uiPalette.cellTrashStroke;
    ctx.strokeStyle = cellOutlineColors?.[cell.name] ?? (cell.isTrash ? trashColor : uiPalette.cellNormalStroke);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, 2.2, 0, Math.PI * 2);
    ctx.fillStyle = cell.isTrash ? trashColor : uiPalette.cellNormalFill;
    ctx.fill();
  }
  ctx.restore();
}

function getCellAngle(camelCaseValue: number | undefined, snakeCaseValue: number | undefined): number {
  const value = Number(camelCaseValue ?? snakeCaseValue ?? 0);
  return Number.isFinite(value) ? value : 0;
}

export function fitRect(
  containerWidth: number,
  containerHeight: number,
  imageWidth: number,
  imageHeight: number,
): { x: number; y: number; width: number; height: number } {
  const scale = Math.min(containerWidth / imageWidth, containerHeight / imageHeight);
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  return {
    x: (containerWidth - width) / 2,
    y: (containerHeight - height) / 2,
    width,
    height,
  };
}

function applyBottomLayer(
  target: Uint8ClampedArray,
  volume: VolumeData,
  slice: number,
  mapId: ColorMapId,
  opacity: number,
  contrastLimits: ContrastLimits,
): void {
  const source = getNearestSlice(volume, slice);
  const map = getColorMap(mapId);
  for (let i = 0; i < source.length; i += 1) {
    const value = applyContrastLimits(normalizedIntensity(volume, source[i]), contrastLimits);
    const [r, g, b] = map.sample(value);
    const offset = i * 4;
    target[offset] = Math.round(r * value * opacity);
    target[offset + 1] = Math.round(g * value * opacity);
    target[offset + 2] = Math.round(b * value * opacity);
  }
}

function applySliceBottomLayer(
  target: Uint8ClampedArray,
  slice: SlicePreviewData,
  mapId: ColorMapId,
  opacity: number,
  contrastLimits: ContrastLimits,
): void {
  const map = getColorMap(mapId);
  for (let i = 0; i < slice.pixels.length; i += 1) {
    const value = applyContrastLimits(normalizedSliceIntensity(slice, slice.pixels[i]), contrastLimits);
    const [r, g, b] = map.sample(value);
    const offset = i * 4;
    target[offset] = Math.round(r * value * opacity);
    target[offset + 1] = Math.round(g * value * opacity);
    target[offset + 2] = Math.round(b * value * opacity);
  }
}

function applyOverlayLayer(
  target: Uint8ClampedArray,
  volume: VolumeData,
  slice: number,
  mapId: ColorMapId,
  opacity: number,
  contrastLimits: ContrastLimits,
): void {
  const source = getNearestSlice(volume, slice);
  const map = getColorMap(mapId);
  for (let i = 0; i < source.length; i += 1) {
    const value = applyContrastLimits(normalizedIntensity(volume, source[i]), contrastLimits);
    const alpha = Math.max(0, Math.min(1, opacity * Math.pow(value, 0.82)));
    if (alpha <= 0.002) {
      continue;
    }
    const [r, g, b] = map.sample(value);
    const offset = i * 4;
    target[offset] = Math.round(target[offset] * (1 - alpha) + r * value * alpha);
    target[offset + 1] = Math.round(target[offset + 1] * (1 - alpha) + g * value * alpha);
    target[offset + 2] = Math.round(target[offset + 2] * (1 - alpha) + b * value * alpha);
  }
}

function applySliceOverlayLayer(
  target: Uint8ClampedArray,
  slice: SlicePreviewData,
  mapId: ColorMapId,
  opacity: number,
  contrastLimits: ContrastLimits,
): void {
  const map = getColorMap(mapId);
  for (let i = 0; i < slice.pixels.length; i += 1) {
    const value = applyContrastLimits(normalizedSliceIntensity(slice, slice.pixels[i]), contrastLimits);
    const alpha = Math.max(0, Math.min(1, opacity * Math.pow(value, 0.82)));
    if (alpha <= 0.002) {
      continue;
    }
    const [r, g, b] = map.sample(value);
    const offset = i * 4;
    target[offset] = Math.round(target[offset] * (1 - alpha) + r * value * alpha);
    target[offset + 1] = Math.round(target[offset + 1] * (1 - alpha) + g * value * alpha);
    target[offset + 2] = Math.round(target[offset + 2] * (1 - alpha) + b * value * alpha);
  }
}

function getNearestSlice(volume: VolumeData, slice: number): Uint8ClampedArray {
  const target = Math.max(0, Math.min(volume.depth - 1, Math.round(slice)));
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < volume.sliceIndices.length; i += 1) {
    const distance = Math.abs(volume.sliceIndices[i] - target);
    if (distance < bestDistance) {
      bestIndex = i;
      bestDistance = distance;
    }
  }
  return volume.slices[bestIndex];
}

function normalizedIntensity(volume: VolumeData, value: number): number {
  return Math.max(0, Math.min(1, value / Math.max(1, volume.displayMax)));
}

function normalizedSliceIntensity(slice: SlicePreviewData, value: number): number {
  return Math.max(0, Math.min(1, value / Math.max(1, slice.displayMax)));
}
