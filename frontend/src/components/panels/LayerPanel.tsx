import { useRef, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Check, ChevronDown, Crosshair, Eye, EyeOff } from "lucide-react";
import { colorMaps, getColorMap, type ColorMap, type ColorMapId } from "../../viewer/colorMaps";
import { clampContrastLimits, type ContrastLimits } from "../../viewer/contrast";
import PanelHeading from "./PanelHeading";

type LayerPanelProps = {
  realEnabled: boolean;
  synthEnabled: boolean;
  cellsEnabled: boolean;
  cellCentersEnabled: boolean;
  setLayer: (layer: "realEnabled" | "synthEnabled" | "cellsEnabled" | "cellCentersEnabled", value: boolean) => void;
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
  pointAlphaByBrightness?: boolean;
  setPointAlphaByBrightness?: (enabled: boolean) => void;
  showCells?: boolean;
  showSynth?: boolean;
  onHide: () => void;
};

export default function LayerPanel({
  realEnabled,
  synthEnabled,
  cellsEnabled,
  cellCentersEnabled,
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
  pointAlphaByBrightness = false,
  setPointAlphaByBrightness,
  showCells = true,
  showSynth = true,
  onHide,
}: LayerPanelProps) {
  return (
    <section className="tool-panel">
      <PanelHeading title="Layers" icon={<Eye size={17} />} onHide={onHide} />
      {showCells || setPointAlphaByBrightness ? (
        <div className="layer-toggle-stack">
          {showCells ? (
            <>
              <button
                type="button"
                className={`toggle-button ${cellCentersEnabled ? "active" : ""}`}
                onClick={() => setLayer("cellCentersEnabled", !cellCentersEnabled)}
              >
                {cellCentersEnabled ? <Crosshair size={16} /> : <EyeOff size={16} />}
                Cell centers
              </button>
              <button
                type="button"
                className={`toggle-button ${cellsEnabled ? "active" : ""}`}
                onClick={() => setLayer("cellsEnabled", !cellsEnabled)}
              >
                {cellsEnabled ? <Eye size={16} /> : <EyeOff size={16} />}
                Cell outlines
              </button>
            </>
          ) : null}
          {setPointAlphaByBrightness ? (
            <button
              type="button"
              className={`toggle-button layer-brightness-toggle ${pointAlphaByBrightness ? "active" : ""}`}
              onClick={() => setPointAlphaByBrightness(!pointAlphaByBrightness)}
              title="Make point opacity proportional to brightness"
            >
              {pointAlphaByBrightness ? <Eye size={16} /> : <EyeOff size={16} />}
              Brightness alpha
            </button>
          ) : null}
        </div>
      ) : null}
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
      {showSynth ? (
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
      ) : null}
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
  const selectedColorMap = getColorMap(colorMap);
  const layerStyle = {
    "--layer-gradient": colorMapGradient(selectedColorMap),
    "--layer-accent": selectedColorMap.stops[selectedColorMap.stops.length - 1]?.[1] ?? "var(--color-accent)",
  } as CSSProperties;

  return (
    <fieldset className="layer-control-group" style={layerStyle}>
      <legend>{label}</legend>
      <div className="layer-row">
        <button type="button" className={`toggle-button ${enabled ? "active" : ""}`} onClick={() => onToggle(!enabled)}>
          {enabled ? <Eye size={16} /> : <EyeOff size={16} />}
          {label}
        </button>
        <ColorMapSelect value={colorMap} onChange={onMapChange} />
      </div>
      <label className="slider-row layer-opacity-row">
        <span>Opacity</span>
        <output>{Math.round(opacity * 100)}%</output>
        <input
          className="color-map-range"
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={opacity}
          onChange={(event) => onOpacityChange(Number(event.target.value))}
        />
      </label>
      <ContrastLimitSlider value={contrastLimits} onChange={onContrastLimitsChange} gradient={colorMapGradient(selectedColorMap)} />
    </fieldset>
  );
}

function ContrastLimitSlider({
  value,
  onChange,
  gradient,
}: {
  value: ContrastLimits;
  onChange: (limits: ContrastLimits) => void;
  gradient: string;
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
        style={{ "--layer-gradient": gradient } as CSSProperties}
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

function ColorMapSelect({
  value,
  onChange,
}: {
  value: ColorMapId;
  onChange: (map: ColorMapId) => void;
}) {
  const detailsRef = useRef<HTMLDetailsElement | null>(null);
  const selectedColorMap = getColorMap(value);

  const chooseColorMap = (nextValue: ColorMapId) => {
    onChange(nextValue);
    if (detailsRef.current) {
      detailsRef.current.open = false;
    }
  };

  return (
    <details ref={detailsRef} className="color-map-select">
      <summary aria-label={`Color map: ${selectedColorMap.label}`}>
        <span className="color-map-preview" style={{ background: colorMapGradient(selectedColorMap) }} />
        <span>{selectedColorMap.label}</span>
        <ChevronDown size={16} />
      </summary>
      <div className="color-map-menu" role="listbox" aria-label="Color map options">
        {colorMaps.map((map) => {
          const selected = map.id === value;
          return (
            <button
              key={map.id}
              type="button"
              className={`color-map-option ${selected ? "selected" : ""}`}
              role="option"
              aria-selected={selected}
              onClick={() => chooseColorMap(map.id)}
            >
              <span className="color-map-preview" style={{ background: colorMapGradient(map) }} />
              <span>{map.label}</span>
              {selected ? <Check size={15} /> : null}
            </button>
          );
        })}
      </div>
    </details>
  );
}

function colorMapGradient(map: ColorMap): string {
  return `linear-gradient(90deg, ${map.stops.map(([position, color]) => `${color} ${Math.round(position * 100)}%`).join(", ")})`;
}

function valueFromPointer(slider: HTMLDivElement | null, clientX: number): number {
  if (!slider) {
    return 0;
  }
  const rect = slider.getBoundingClientRect();
  const local = (clientX - rect.left) / Math.max(1, rect.width);
  return Math.round(Math.max(0, Math.min(1, local)) * 100) / 100;
}
