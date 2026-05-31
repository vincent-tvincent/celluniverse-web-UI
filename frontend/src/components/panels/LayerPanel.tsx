import { Eye, EyeOff } from "lucide-react";
import { colorMaps, type ColorMapId } from "../../viewer/colorMaps";
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
  synthOpacity: number;
  setSynthOpacity: (opacity: number) => void;
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
  synthOpacity,
  setSynthOpacity,
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
      />
      <LayerControlGroup
        label="Synthetic"
        enabled={synthEnabled}
        onToggle={(value) => setLayer("synthEnabled", value)}
        colorMap={synthMap}
        onMapChange={setSynthMap}
        opacity={synthOpacity}
        onOpacityChange={setSynthOpacity}
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
}: {
  label: string;
  enabled: boolean;
  onToggle: (value: boolean) => void;
  colorMap: ColorMapId;
  onMapChange: (map: ColorMapId) => void;
  opacity: number;
  onOpacityChange: (opacity: number) => void;
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
    </fieldset>
  );
}
