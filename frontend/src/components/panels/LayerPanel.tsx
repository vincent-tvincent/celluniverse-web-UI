import { useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Eye, EyeOff } from "lucide-react";
import { colorMaps, type ColorMapId } from "../../viewer/colorMaps";
import { clampContrastLimits, type ContrastLimits } from "../../viewer/contrast";
import PanelHeading from "./PanelHeading";

type LayerPanelProps = {
  realEnabled: boolean;
  synthEnabled: boolean;
  cellsEnabled: boolean;
  setLayer: (layer: "realEnabled" | "synthEnabled" | "cellsEnabled", value: boolean) => void;
  realMap: ColorMapId;
  synthMap: ColorMapId;
  setRealMap: (map: ColorMapId) => void;
  setSynthMap: (map: ColorMapId) => void;
  realOpacity: number;
  setRealOpacity: (opacity: number) => void;
  realContrastLimits: ContrastLimits;
  setRealContrastLimits: (limits: ContrastLimits) => void;
  synthOpacity: number;
  setSynthOpacity: (opacity: number) => void;
  synthContrastLimits: ContrastLimits;
  setSynthContrastLimits: (limits: ContrastLimits) => void;
  onHide: () => void;
};

export default function LayerPanel({
  realEnabled,
  synthEnabled,
  cellsEnabled,
  setLayer,
  realMap,
  synthMap,
  setRealMap,
  setSynthMap,
  realOpacity,
  setRealOpacity,
  realContrastLimits,
  setRealContrastLimits,
  synthOpacity,
  setSynthOpacity,
  synthContrastLimits,
  setSynthContrastLimits,
  onHide,
}: LayerPanelProps) {
  return (
    <section className="tool-panel">
      <PanelHeading title="Layers" icon={<Eye size={17} />} onHide={onHide} />
      <LayerControlGroup
        label="Real"
        enabled={realEnabled}
        onToggle={(value) => setLayer("realEnabled", value)}
        colorMap={realMap}
        onMapChange={setRealMap}
        opacity={realOpacity}
        onOpacityChange={setRealOpacity}
        contrastLimits={realContrastLimits}
        onContrastLimitsChange={setRealContrastLimits}
      />
      <LayerControlGroup
        label="Synthetic"
        enabled={synthEnabled}
        onToggle={(value) => setLayer("synthEnabled", value)}
        colorMap={synthMap}
        onMapChange={setSynthMap}
        opacity={synthOpacity}
        onOpacityChange={setSynthOpacity}
        contrastLimits={synthContrastLimits}
        onContrastLimitsChange={setSynthContrastLimits}
      />
      <button
        type="button"
        className={`toggle-button ${cellsEnabled ? "active" : ""}`}
        onClick={() => setLayer("cellsEnabled", !cellsEnabled)}
      >
        {cellsEnabled ? <Eye size={16} /> : <EyeOff size={16} />}
        Cell outlines
      </button>
    </section>
  );
}

function LayerControlGroup({
  label,
  enabled,
  onToggle,
  colorMap,
  onMapChange,
  opacity,
  onOpacityChange,
  contrastLimits,
  onContrastLimitsChange,
}: {
  label: string;
  enabled: boolean;
  onToggle: (value: boolean) => void;
  colorMap: ColorMapId;
  onMapChange: (map: ColorMapId) => void;
  opacity: number;
  onOpacityChange: (opacity: number) => void;
  contrastLimits: ContrastLimits;
  onContrastLimitsChange: (limits: ContrastLimits) => void;
}) {
  return (
    <fieldset className="layer-control-group">
      <legend>{label}</legend>
      <div className="layer-row">
        <button type="button" className={`toggle-button ${enabled ? "active" : ""}`} onClick={() => onToggle(!enabled)}>
          {enabled ? <Eye size={16} /> : <EyeOff size={16} />}
          {label}
        </button>
        <select value={colorMap} onChange={(event) => onMapChange(event.target.value as ColorMapId)}>
          {colorMaps.map((map) => (
            <option key={map.id} value={map.id}>
              {map.label}
            </option>
          ))}
        </select>
      </div>
      <label className="slider-row layer-opacity-row">
        <span>Opacity</span>
        <output>{Math.round(opacity * 100)}%</output>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={opacity}
          onChange={(event) => onOpacityChange(Number(event.target.value))}
        />
      </label>
      <ContrastLimitSlider value={contrastLimits} onChange={onContrastLimitsChange} />
    </fieldset>
  );
}

function ContrastLimitSlider({
  value,
  onChange,
}: {
  value: ContrastLimits;
  onChange: (limits: ContrastLimits) => void;
}) {
  const low = value[0];
  const high = value[1];
  const lowPercent = Math.round(low * 100);
  const highPercent = Math.round(high * 100);
  const sliderRef = useRef<HTMLDivElement | null>(null);
  const updateLow = (nextLow: number) => onChange(clampContrastLimits([Math.min(nextLow, high), high]));
  const updateHigh = (nextHigh: number) => onChange(clampContrastLimits([low, Math.max(nextHigh, low)]));
  const updateNearestHandle = (clientX: number) => {
    const nextValue = valueFromPointer(sliderRef.current, clientX);
    if (Math.abs(nextValue - low) <= Math.abs(nextValue - high)) {
      updateLow(nextValue);
    } else {
      updateHigh(nextValue);
    }
  };
  const startDrag = (handle: "low" | "high", pointerId: number, clientX: number, target: HTMLElement) => {
    target.setPointerCapture(pointerId);
    const moveHandle = (nextClientX: number) => {
      const nextValue = valueFromPointer(sliderRef.current, nextClientX);
      if (handle === "low") {
        updateLow(nextValue);
      } else {
        updateHigh(nextValue);
      }
    };
    moveHandle(clientX);
    const onPointerMove = (event: PointerEvent) => moveHandle(event.clientX);
    const onPointerUp = () => {
      target.removeEventListener("pointermove", onPointerMove);
      target.removeEventListener("pointerup", onPointerUp);
      target.removeEventListener("pointercancel", onPointerUp);
    };
    target.addEventListener("pointermove", onPointerMove);
    target.addEventListener("pointerup", onPointerUp);
    target.addEventListener("pointercancel", onPointerUp);
  };
  const handleKeyDown = (handle: "low" | "high", event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const bigStep = event.shiftKey ? 0.1 : 0.01;
    const delta = event.key === "ArrowRight" || event.key === "ArrowUp"
      ? bigStep
      : event.key === "ArrowLeft" || event.key === "ArrowDown"
        ? -bigStep
        : 0;
    if (delta === 0) {
      return;
    }
    event.preventDefault();
    if (handle === "low") {
      updateLow(low + delta);
    } else {
      updateHigh(high + delta);
    }
  };

  return (
    <div className="contrast-limit-control" role="group" aria-label="Contrast limits">
      <span className="contrast-limit-label">Contrast limits</span>
      <div className="contrast-limit-values">
        <span>{lowPercent}%</span>
        <span>{highPercent}%</span>
      </div>
      <div
        ref={sliderRef}
        className="contrast-limit-slider"
        onPointerDown={(event) => {
          if (event.target !== event.currentTarget) {
            return;
          }
          updateNearestHandle(event.clientX);
        }}
      >
        <div
          className="contrast-limit-window"
          style={{
            left: `${lowPercent}%`,
            right: `${100 - highPercent}%`,
          }}
        />
        <button
          className="contrast-limit-thumb low"
          aria-label="Contrast low limit"
          aria-valuemin={0}
          aria-valuemax={highPercent}
          aria-valuenow={lowPercent}
          role="slider"
          type="button"
          style={{ left: `${lowPercent}%` }}
          onKeyDown={(event) => handleKeyDown("low", event)}
          onPointerDown={(event) => {
            event.preventDefault();
            startDrag("low", event.pointerId, event.clientX, event.currentTarget);
          }}
        />
        <button
          className="contrast-limit-thumb high"
          aria-label="Contrast high limit"
          aria-valuemin={lowPercent}
          aria-valuemax={100}
          aria-valuenow={highPercent}
          role="slider"
          type="button"
          style={{ left: `${highPercent}%` }}
          onKeyDown={(event) => handleKeyDown("high", event)}
          onPointerDown={(event) => {
            event.preventDefault();
            startDrag("high", event.pointerId, event.clientX, event.currentTarget);
          }}
        />
      </div>
    </div>
  );
}

function valueFromPointer(slider: HTMLDivElement | null, clientX: number): number {
  if (!slider) {
    return 0;
  }
  const rect = slider.getBoundingClientRect();
  const local = (clientX - rect.left) / Math.max(1, rect.width);
  return Math.round(Math.max(0, Math.min(1, local)) * 100) / 100;
}
