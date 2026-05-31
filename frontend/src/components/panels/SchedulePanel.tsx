import { ListRestart, PauseCircle, PlayCircle, RefreshCcw } from "lucide-react";
import type { RefreshUnit } from "../../store";
import PanelHeading from "./PanelHeading";

type SchedulePanelProps = {
  enabled: boolean;
  seconds: number;
  unit: RefreshUnit;
  setEnabled: (enabled: boolean) => void;
  setSeconds: (seconds: number) => void;
  setUnit: (unit: RefreshUnit) => void;
  onRefresh: () => void;
  onHide: () => void;
};

export default function SchedulePanel({
  enabled,
  seconds,
  unit,
  setEnabled,
  setSeconds,
  setUnit,
  onRefresh,
  onHide,
}: SchedulePanelProps) {
  const unitConfig = refreshUnitConfig(unit);
  const amount = secondsToRefreshAmount(seconds, unit);
  const updateAmount = (nextAmount: number) => {
    setSeconds(nextAmount * unitConfig.multiplier);
  };
  const updateUnit = (nextUnit: RefreshUnit) => {
    setUnit(nextUnit);
    setSeconds(amount * refreshUnitConfig(nextUnit).multiplier);
  };

  return (
    <section className="tool-panel">
      <PanelHeading title="Update" icon={<ListRestart size={17} />} onHide={onHide} />
      <button
        type="button"
        className={`toggle-button ${enabled ? "active" : ""}`}
        onClick={() => setEnabled(!enabled)}
      >
        {enabled ? <PlayCircle size={16} /> : <PauseCircle size={16} />}
        Auto refresh
      </button>
      <label className="number-row">
        <span>Period</span>
        <input
          type="number"
          min={unitConfig.min}
          max={unitConfig.max}
          step={1}
          value={amount}
          onChange={(event) => updateAmount(Number(event.target.value))}
        />
        <select
          aria-label="Refresh interval unit"
          value={unit}
          onChange={(event) => updateUnit(event.target.value as RefreshUnit)}
        >
          <option value="seconds">sec</option>
          <option value="minutes">min</option>
          <option value="hours">hr</option>
        </select>
      </label>
      <button type="button" className="toggle-button" onClick={onRefresh}>
        <RefreshCcw size={16} />
        Refresh now
      </button>
    </section>
  );
}

function refreshUnitConfig(unit: RefreshUnit): { multiplier: number; min: number; max: number } {
  switch (unit) {
    case "hours":
      return { multiplier: 3600, min: 1, max: 24 };
    case "minutes":
      return { multiplier: 60, min: 1, max: 1440 };
    case "seconds":
    default:
      return { multiplier: 1, min: 2, max: 3600 };
  }
}

function secondsToRefreshAmount(seconds: number, unit: RefreshUnit): number {
  const config = refreshUnitConfig(unit);
  return Math.max(config.min, Math.min(config.max, Math.round(seconds / config.multiplier)));
}
