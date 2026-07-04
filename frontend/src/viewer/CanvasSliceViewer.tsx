import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { uiPalette } from "../theme/palette";
import type { CellRecord } from "../types";
import type { ColorMapId } from "./colorMaps";
import type { ContrastLimits } from "./contrast";
import { composeSliceImage, composeSlicePreviewImage, drawCellOverlay, fitRect } from "./rendering";
import type { ViewerHoverSample } from "./hover";
import type { SlicePreviewData } from "./slicePreview";
import type { VolumeData } from "./tiff";

type Props = {
  real?: VolumeData;
  synth?: VolumeData;
  realSlice?: SlicePreviewData;
  synthSlice?: SlicePreviewData;
  cells: CellRecord[];
  slice: number;
  realEnabled: boolean;
  synthEnabled: boolean;
  cellsEnabled: boolean;
  cellOutlineColors?: Record<string, string>;
  realMap: ColorMapId;
  synthMap: ColorMapId;
  realOpacity: number;
  synthOpacity: number;
  realContrastLimits: ContrastLimits;
  synthContrastLimits: ContrastLimits;
  onRenderStart?: () => void;
  onRenderComplete?: () => void;
  onHoverSample?: (sample: ViewerHoverSample | null) => void;
};

export default function CanvasSliceViewer({
  real,
  synth,
  realSlice,
  synthSlice,
  cells,
  slice,
  realEnabled,
  synthEnabled,
  cellsEnabled,
  cellOutlineColors,
  realMap,
  synthMap,
  realOpacity,
  synthOpacity,
  realContrastLimits,
  synthContrastLimits,
  onRenderStart,
  onRenderComplete,
  onHoverSample,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);
  const hitRef = useRef<{
    imageRect: { x: number; y: number; width: number; height: number };
    imageWidth: number;
    imageHeight: number;
  } | null>(null);
  const baseVolume = real ?? synth;
  const baseSlice = realSlice ?? synthSlice;
  const hasImage = Boolean(baseSlice || baseVolume);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    let animationFrame = 0;
    const render = () => {
      onRenderStart?.();
      const rect = canvas.getBoundingClientRect();
      const pixelRatio = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(rect.width * pixelRatio));
      canvas.height = Math.max(1, Math.floor(rect.height * pixelRatio));
      ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      ctx.clearRect(0, 0, rect.width, rect.height);
      ctx.fillStyle = uiPalette.viewerBackground;
      ctx.fillRect(0, 0, rect.width, rect.height);

      const image = baseSlice
        ? composeSlicePreviewImage(realSlice, synthSlice, {
            realEnabled,
            synthEnabled,
            realMap,
            synthMap,
            realOpacity,
            synthOpacity,
            realContrastLimits,
            synthContrastLimits,
          })
        : composeSliceImage(real, synth, slice, {
            realEnabled,
            synthEnabled,
            realMap,
            synthMap,
            realOpacity,
            synthOpacity,
            realContrastLimits,
            synthContrastLimits,
          });
      if (!image) {
        hitRef.current = null;
        onRenderComplete?.();
        return;
      }

      const offscreen = offscreenRef.current ?? document.createElement("canvas");
      offscreenRef.current = offscreen;
      offscreen.width = image.width;
      offscreen.height = image.height;
      const offscreenCtx = offscreen.getContext("2d");
      if (!offscreenCtx) {
        onRenderComplete?.();
        return;
      }
      offscreenCtx.putImageData(image, 0, 0);
      const imageRect = fitRect(rect.width, rect.height, image.width, image.height);
      hitRef.current = { imageRect, imageWidth: image.width, imageHeight: image.height };
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(offscreen, imageRect.x, imageRect.y, imageRect.width, imageRect.height);

      if (cellsEnabled && (baseSlice || baseVolume)) {
        drawCellOverlay(ctx, cells, slice, imageRect, {
          width: baseSlice?.sourceWidth ?? baseVolume?.sourceWidth ?? image.width,
          height: baseSlice?.sourceHeight ?? baseVolume?.sourceHeight ?? image.height,
        }, cellOutlineColors);
      }
      onRenderComplete?.();
    };
    const scheduleRender = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(render);
    };

    scheduleRender();
    const observer = new ResizeObserver(scheduleRender);
    observer.observe(canvas);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      observer.disconnect();
    };
  }, [
    real,
    synth,
    realSlice,
    synthSlice,
    slice,
    realEnabled,
    synthEnabled,
    realMap,
    synthMap,
    realOpacity,
    synthOpacity,
    realContrastLimits,
    synthContrastLimits,
    cells,
    cellsEnabled,
    cellOutlineColors,
    baseVolume,
    baseSlice,
    onRenderStart,
    onRenderComplete,
  ]);

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const hit = hitRef.current;
    if (!canvas || !hit || !onHoverSample) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const { imageRect, imageWidth, imageHeight } = hit;
    if (x < imageRect.x || y < imageRect.y || x > imageRect.x + imageRect.width || y > imageRect.y + imageRect.height) {
      onHoverSample(null);
      return;
    }
    const imageX = Math.max(0, Math.min(imageWidth - 1, Math.floor(((x - imageRect.x) / imageRect.width) * imageWidth)));
    const imageY = Math.max(0, Math.min(imageHeight - 1, Math.floor(((y - imageRect.y) / imageRect.height) * imageHeight)));
    const sourceWidth = baseSlice?.sourceWidth ?? baseVolume?.sourceWidth ?? imageWidth;
    const sourceHeight = baseSlice?.sourceHeight ?? baseVolume?.sourceHeight ?? imageHeight;
    const sourceX = Math.round((imageX / Math.max(1, imageWidth - 1)) * Math.max(0, sourceWidth - 1));
    const sourceY = Math.round((imageY / Math.max(1, imageHeight - 1)) * Math.max(0, sourceHeight - 1));
    onHoverSample({
      x: sourceX,
      y: sourceY,
      z: realSlice?.sliceIndex ?? synthSlice?.sliceIndex ?? slice,
      brightness: sampleRealBrightness(real, realSlice, imageX, imageY, imageWidth, imageHeight, sourceX, sourceY, slice),
    });
  };

  return (
    <>
      <canvas
        ref={canvasRef}
        className="slice-canvas"
        aria-label="2D TIFF slice preview"
        onPointerMove={handlePointerMove}
        onPointerLeave={() => onHoverSample?.(null)}
      />
      {!hasImage ? <div className="viewer-empty">Waiting for viewer output</div> : null}
    </>
  );
}

function sampleRealBrightness(
  real: VolumeData | undefined,
  realSlice: SlicePreviewData | undefined,
  imageX: number,
  imageY: number,
  imageWidth: number,
  imageHeight: number,
  sourceX: number,
  sourceY: number,
  z: number,
): number | null {
  if (realSlice) {
    const x = Math.max(0, Math.min(realSlice.width - 1, Math.round((imageX / Math.max(1, imageWidth - 1)) * Math.max(0, realSlice.width - 1))));
    const y = Math.max(0, Math.min(realSlice.height - 1, Math.round((imageY / Math.max(1, imageHeight - 1)) * Math.max(0, realSlice.height - 1))));
    return realSlice.pixels[y * realSlice.width + x] ?? null;
  }
  if (!real?.slices.length) {
    return null;
  }
  const sliceIndex = nearestLoadedSliceIndex(real, z);
  const source = real.slices[sliceIndex];
  const x = Math.max(0, Math.min(real.width - 1, Math.round((sourceX / Math.max(1, real.sourceWidth - 1)) * Math.max(0, real.width - 1))));
  const y = Math.max(0, Math.min(real.height - 1, Math.round((sourceY / Math.max(1, real.sourceHeight - 1)) * Math.max(0, real.height - 1))));
  return source?.[y * real.width + x] ?? null;
}

function nearestLoadedSliceIndex(volume: VolumeData, z: number): number {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < volume.sliceIndices.length; index += 1) {
    const distance = Math.abs((volume.sliceIndices[index] ?? index) - z);
    if (distance < bestDistance) {
      bestIndex = index;
      bestDistance = distance;
    }
  }
  return bestIndex;
}

