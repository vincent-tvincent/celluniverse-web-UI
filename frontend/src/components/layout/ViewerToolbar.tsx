import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ViewMode } from "../../store";

const MAX_FRAME_OFFSET_BUTTONS = 100;

type ViewerToolbarProps = {
  mode: ViewMode;
  frame: number;
  frames: number[];
  setFrame: (frame: number) => void;
  slice: number;
  maxDepth: number;
  setSlice: (slice: number) => void;
  frameControlsDisabled: boolean;
};

export default function ViewerToolbar({
  mode,
  frame,
  frames,
  setFrame,
  slice,
  maxDepth,
  setSlice,
  frameControlsDisabled,
}: ViewerToolbarProps) {
  const frameIndex = Math.max(0, frames.indexOf(frame));
  const maxFrameIndex = Math.max(0, frames.length - 1);
  const [draftFrameIndex, setDraftFrameIndex] = useState(frameIndex);
  const [frameOffsetBaseIndex, setFrameOffsetBaseIndex] = useState(frameIndex);
  const [selectedFrameOffset, setSelectedFrameOffset] = useState(0);
  const [draftSlice, setDraftSlice] = useState(slice);
  const sliceInputRef = useRef<HTMLInputElement | null>(null);
  const sliceCommitTimerRef = useRef(0);
  const pendingSliceRef = useRef(slice);
  const draftFrame = frames[draftFrameIndex] ?? frame;
  const frameOffsets = useMemo(
    () => buildFrameOffsets(frameOffsetBaseIndex, maxFrameIndex),
    [frameOffsetBaseIndex, maxFrameIndex],
  );

  useEffect(() => {
    setDraftFrameIndex(frameIndex);
    if (selectedFrameOffset === 0) {
      setFrameOffsetBaseIndex(frameIndex);
    }
  }, [frameIndex, selectedFrameOffset]);

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
    if (frameOffsetBaseIndex > maxFrameIndex) {
      setFrameOffsetBaseIndex(maxFrameIndex);
      setSelectedFrameOffset(0);
    }
  }, [draftFrameIndex, frameOffsetBaseIndex, maxFrameIndex]);

  useEffect(() => {
    const maxSlice = Math.max(0, maxDepth - 1);
    if (draftSlice > maxSlice) {
      setDraftSlice(maxSlice);
    }
  }, [draftSlice, maxDepth]);

  const setFrameFromIndex = (index: number, preserveOffset = false) => {
    const nextIndex = Math.max(0, Math.min(frames.length - 1, Math.round(index)));
    const nextFrame = frames[nextIndex];
    if (nextFrame != null) {
      setDraftFrameIndex(nextIndex);
      if (!preserveOffset) {
        setFrameOffsetBaseIndex(nextIndex);
        setSelectedFrameOffset(0);
      }
      setFrame(nextFrame);
    }
  };
  const stepFrame = (delta: number) => {
    const nextIndex = Math.max(0, Math.min(maxFrameIndex, draftFrameIndex + delta));
    setFrameFromIndex(nextIndex);
  };
  const selectFrameOffset = (offset: number) => {
    const targetIndex = frameOffsetBaseIndex + offset;
    if (targetIndex < 0 || targetIndex > maxFrameIndex || frameControlsDisabled) {
      return;
    }
    setSelectedFrameOffset(offset);
    setFrameFromIndex(targetIndex, true);
  };
  const resetFrameOffsetForSlider = () => {
    if (selectedFrameOffset === 0) {
      return;
    }
    setSelectedFrameOffset(0);
    setDraftFrameIndex(frameOffsetBaseIndex);
    setFrameFromIndex(frameOffsetBaseIndex);
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
    <div className={`viewer-toolbar ${mode === "volume" ? "volume-mode" : "slice-mode"}`}>
      <fieldset className="range-control slider-field frame-control">
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
          onPointerDown={resetFrameOffsetForSlider}
          onInput={(event) => {
            setSelectedFrameOffset(0);
            setDraftFrameIndex(Number(event.currentTarget.value));
          }}
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
        <div
          className="frame-offset-strip"
          aria-label="Frame offset shortcuts"
          style={{ "--frame-offset-count": frameOffsets.length } as CSSProperties}
        >
          {frameOffsets.map((offset) => {
            const targetIndex = frameOffsetBaseIndex + offset;
            const unavailable = targetIndex < 0 || targetIndex > maxFrameIndex;
            const label = offset > 0 ? `+${offset}` : String(offset);
            return (
              <button
                key={offset}
                type="button"
                className={`frame-offset-button ${selectedFrameOffset === offset ? "active" : ""}`}
                disabled={frames.length <= 1 || frameControlsDisabled || unavailable}
                onClick={() => selectFrameOffset(offset)}
                title={offset === 0 ? "Current frame" : `Frame offset ${label}`}
                aria-label={offset === 0 ? "Current frame" : `Frame offset ${label}`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </fieldset>
      {mode === "slice" ? (
        <fieldset className="range-control slider-field slice-control">
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
    </div>
  );
}

function buildFrameOffsets(baseIndex: number, maxFrameIndex: number): number[] {
  if (maxFrameIndex <= 0) {
    return [0];
  }
  const minOffset = -Math.max(0, baseIndex);
  const maxOffset = Math.max(0, maxFrameIndex - baseIndex);
  const total = maxOffset - minOffset + 1;
  if (total <= MAX_FRAME_OFFSET_BUTTONS) {
    return range(minOffset, maxOffset);
  }

  const left = Math.floor((MAX_FRAME_OFFSET_BUTTONS - 1) / 2);
  let start = Math.max(minOffset, -left);
  let end = start + MAX_FRAME_OFFSET_BUTTONS - 1;
  if (end > maxOffset) {
    end = maxOffset;
    start = end - MAX_FRAME_OFFSET_BUTTONS + 1;
  }
  return range(start, end);
}

function range(start: number, end: number): number[] {
  const values: number[] = [];
  for (let value = start; value <= end; value += 1) {
    values.push(value);
  }
  return values;
}
