import { useEffect, useRef } from "react";
import type { CellRecord } from "../types";
import type { ColorMapId } from "./colorMaps";
import { composeSliceImage, composeSlicePreviewImage, drawCellOverlay, fitRect } from "./rendering";
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
  realMap: ColorMapId;
  synthMap: ColorMapId;
  synthOpacity: number;
  onRenderStart?: () => void;
  onRenderComplete?: () => void;
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
  realMap,
  synthMap,
  synthOpacity,
  onRenderStart,
  onRenderComplete,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);
  const baseVolume = real ?? synth;
  const baseSlice = realSlice ?? synthSlice;

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
      ctx.fillStyle = "#070a0f";
      ctx.fillRect(0, 0, rect.width, rect.height);

      const image = baseSlice
        ? composeSlicePreviewImage(realSlice, synthSlice, {
            realEnabled,
            synthEnabled,
            realMap,
            synthMap,
            synthOpacity,
          })
        : composeSliceImage(real, synth, slice, {
            realEnabled,
            synthEnabled,
            realMap,
            synthMap,
            synthOpacity,
          });
      if (!image) {
        drawEmptyState(ctx, rect.width, rect.height);
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
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(offscreen, imageRect.x, imageRect.y, imageRect.width, imageRect.height);

      if (cellsEnabled && (baseSlice || baseVolume)) {
        drawCellOverlay(ctx, cells, slice, imageRect, {
          width: baseSlice?.sourceWidth ?? baseVolume?.sourceWidth ?? image.width,
          height: baseSlice?.sourceHeight ?? baseVolume?.sourceHeight ?? image.height,
        });
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
    synthOpacity,
    cells,
    cellsEnabled,
    baseVolume,
    baseSlice,
    onRenderStart,
    onRenderComplete,
  ]);

  return <canvas ref={canvasRef} className="slice-canvas" aria-label="2D TIFF slice preview" />;
}

function drawEmptyState(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.58)";
  ctx.font = "500 14px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Waiting for TIFF output", width / 2, height / 2);
  ctx.restore();
}
