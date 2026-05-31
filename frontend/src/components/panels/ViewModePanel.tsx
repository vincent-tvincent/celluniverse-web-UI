import { Box, EyeOff, PanelLeftClose, ScanLine } from "lucide-react";
import type { ViewMode } from "../../store";

type ViewModePanelProps = {
  mode: ViewMode;
  setMode: (mode: ViewMode) => void;
  onHide: () => void;
};

export default function ViewModePanel({ mode, setMode, onHide }: ViewModePanelProps) {
  return (
    <section className="view-mode-panel" aria-label="Viewer mode">
      <button
        type="button"
        className="view-mode-hide-button"
        onClick={onHide}
        title="Hide the left panel"
        aria-label="Hide the left panel"
      >
        <PanelLeftClose size={15} />
        <EyeOff size={14} />
      </button>
      <div className="segmented wide">
        <button type="button" className={mode === "slice" ? "active" : ""} onClick={() => setMode("slice")}>
          <ScanLine size={16} />
          2D
        </button>
        <button type="button" className={mode === "volume" ? "active" : ""} onClick={() => setMode("volume")}>
          <Box size={16} />
          3D
        </button>
      </div>
    </section>
  );
}
