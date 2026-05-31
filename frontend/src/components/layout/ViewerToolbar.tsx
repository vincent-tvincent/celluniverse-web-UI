import { useEffect, useRef, useState } from "react";
import { Box, Braces, ChevronLeft, ChevronRight, ScanLine } from "lucide-react";
import type { ViewMode } from "../../store";
import type { JobManifest } from "../../types";
import type { PointCloudPreviewData } from "../../viewer/pointCloud";
import type { SlicePreviewData } from "../../viewer/slicePreview";
import type { VolumeData } from "../../viewer/tiff";

type ViewerToolbarProps = {
  mode: ViewMode;
  setMode: (mode: ViewMode) => void;
  frame: number;
  frames: number[];
  setFrame: (frame: number) => void;
  slice: number;
  maxDepth: number;
  setSlice: (slice: number) => void;
  realVolume?: VolumeData;
  synthVolume?: VolumeData;
  realSlice?: SlicePreviewData;
  synthSlice?: SlicePreviewData;
  realPointCloud?: PointCloudPreviewData;
  synthPointCloud?: PointCloudPreviewData;
  manifest?: JobManifest;
  frameControlsDisabled: boolean;
};

export default function ViewerToolbar({
  mode,
  setMode,
  frame,
  frames,
  setFrame,
  slice,
  maxDepth,
  setSlice,
  realVolume,
  synthVolume,
  realSlice,
  synthSlice,
  realPointCloud,
  synthPointCloud,
  manifest,
  frameControlsDisabled,
}: ViewerToolbarProps) {
  const frameIndex = Math.max(0, frames.indexOf(frame));
  const maxFrameIndex = Math.max(0, frames.length - 1);
  const previewWidth = realSlice?.width ?? synthSlice?.width ?? realVolume?.width ?? synthVolume?.width ?? realPointCloud?.sourceWidth ?? synthPointCloud?.sourceWidth ?? 0;
  const previewHeight = realSlice?.height ?? synthSlice?.height ?? realVolume?.height ?? synthVolume?.height ?? realPointCloud?.sourceHeight ?? synthPointCloud?.sourceHeight ?? 0;
  const [draftFrameIndex, setDraftFrameIndex] = useState(frameIndex);
  const [draftSlice, setDraftSlice] = useState(slice);
  const sliceInputRef = useRef<HTMLInputElement | null>(null);
  const sliceCommitTimerRef = useRef(0);
  const pendingSliceRef = useRef(slice);
  const draftFrame = frames[draftFrameIndex] ?? frame;

  useEffect(() => {
    setDraftFrameIndex(frameIndex);
  }, [frameIndex]);

  useEffect(() => {
    setDraftSlice(slice);
    pendingSliceRef.current = slice;
    if (sliceInputRef.current) {
      sliceInputRef.current.value = String(slice);
    }
  }, [slice]);

  useEffect(() => () => window.clearTimeout(sliceCommitTimerRef.current), []);

  useEffect(() => {
    if (draftFrameIndex > maxFrameIndex) {
      setDraftFrameIndex(maxFrameIndex);
    }
  }, [draftFrameIndex, maxFrameIndex]);

  useEffect(() => {
    const maxSlice = Math.max(0, maxDepth - 1);
    if (draftSlice > maxSlice) {
      setDraftSlice(maxSlice);
    }
  }, [draftSlice, maxDepth]);

  const setFrameFromIndex = (index: number) => {
    const nextFrame = frames[Math.max(0, Math.min(frames.length - 1, Math.round(index)))];
    if (nextFrame != null) {
      setFrame(nextFrame);
    }
  };
  const stepFrame = (delta: number) => {
    const nextIndex = Math.max(0, Math.min(maxFrameIndex, draftFrameIndex + delta));
    setDraftFrameIndex(nextIndex);
    setFrameFromIndex(nextIndex);
  };
  const stepSlice = (delta: number) => {
    const maxSlice = Math.max(0, maxDepth - 1);
    const currentSlice = Number(sliceInputRef.current?.value ?? draftSlice);
    const nextSlice = Math.max(0, Math.min(maxSlice, currentSlice + delta));
    if (sliceInputRef.current) {
      sliceInputRef.current.value = String(nextSlice);
    }
    setDraftSlice(nextSlice);
    setSlice(nextSlice);
  };
  const commitDraftFrame = () => setFrameFromIndex(draftFrameIndex);
  const commitDraftSlice = () => {
    window.clearTimeout(sliceCommitTimerRef.current);
    const currentSlice = Number(sliceInputRef.current?.value ?? draftSlice);
    const nextSlice = Math.max(0, Math.min(Math.max(0, maxDepth - 1), Math.round(currentSlice)));
    pendingSliceRef.current = nextSlice;
    if (sliceInputRef.current) {
      sliceInputRef.current.value = String(nextSlice);
    }
    setDraftSlice(nextSlice);
    setSlice(nextSlice);
  };
  const scheduleSlice = (nextSlice: number) => {
    pendingSliceRef.current = nextSlice;
    window.clearTimeout(sliceCommitTimerRef.current);
    sliceCommitTimerRef.current = window.setTimeout(() => {
      setDraftSlice(pendingSliceRef.current);
      setSlice(pendingSliceRef.current);
    }, 80);
  };

  return (
    <div className={`viewer-toolbar ${mode === "volume" ? "volume-mode" : ""}`}>
      <div className="segmented">
        <button type="button" className={mode === "slice" ? "active" : ""} onClick={() => setMode("slice")}>
          <ScanLine size={16} />
          2D
        </button>
        <button type="button" className={mode === "volume" ? "active" : ""} onClick={() => setMode("volume")}>
          <Box size={16} />
          3D
        </button>
      </div>
      <fieldset className="range-control slider-field">
        <legend>Time frame</legend>
        <span>Frame {draftFrame}</span>
        <button
          className="range-step-button"
          type="button"
          onClick={() => stepFrame(-1)}
          disabled={frames.length <= 1 || frameControlsDisabled || draftFrameIndex <= 0}
          title="Previous frame"
          aria-label="Previous frame"
        >
          <ChevronLeft size={16} />
        </button>
        <input
          aria-label="Frame"
          type="range"
          min={0}
          max={maxFrameIndex}
          step={1}
          value={draftFrameIndex}
          disabled={frames.length <= 1 || frameControlsDisabled}
          onInput={(event) => setDraftFrameIndex(Number(event.currentTarget.value))}
          onPointerUp={commitDraftFrame}
          onKeyUp={commitDraftFrame}
          onBlur={commitDraftFrame}
        />
        <button
          className="range-step-button"
          type="button"
          onClick={() => stepFrame(1)}
          disabled={frames.length <= 1 || frameControlsDisabled || draftFrameIndex >= maxFrameIndex}
          title="Next frame"
          aria-label="Next frame"
        >
          <ChevronRight size={16} />
        </button>
      </fieldset>
      {mode === "slice" ? (
        <fieldset className="range-control slider-field">
          <legend>Z slice</legend>
          <span>Slice {draftSlice}/{Math.max(0, maxDepth - 1)}</span>
          <button
            className="range-step-button"
            type="button"
            onClick={() => stepSlice(-1)}
            disabled={maxDepth <= 1 || draftSlice <= 0}
            title="Previous slice"
            aria-label="Previous slice"
          >
            <ChevronLeft size={16} />
          </button>
          <input
            ref={sliceInputRef}
            aria-label="Slice"
            type="range"
            min={0}
            max={Math.max(0, maxDepth - 1)}
            step={1}
            defaultValue={draftSlice}
            onInput={(event) => {
              const nextSlice = Number(event.currentTarget.value);
              scheduleSlice(nextSlice);
            }}
            onPointerUp={commitDraftSlice}
            onKeyUp={commitDraftSlice}
            onBlur={commitDraftSlice}
          />
          <button
            className="range-step-button"
            type="button"
            onClick={() => stepSlice(1)}
            disabled={maxDepth <= 1 || draftSlice >= Math.max(0, maxDepth - 1)}
            title="Next slice"
            aria-label="Next slice"
          >
            <ChevronRight size={16} />
          </button>
        </fieldset>
      ) : null}
      <div className="volume-meta">
        <Braces size={15} />
        <span>{manifest?.frames.length ?? 0} t</span>
        <span>{realSlice?.depth ?? synthSlice?.depth ?? realVolume?.depth ?? synthVolume?.depth ?? 0} z</span>
        <span>{previewWidth && previewHeight ? `${previewWidth}x${previewHeight}` : "0 xy"}</span>
      </div>
    </div>
  );
}
