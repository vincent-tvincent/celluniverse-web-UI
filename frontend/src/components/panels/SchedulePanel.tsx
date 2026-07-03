import { useEffect, useState } from "react";
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
  nextRefreshAt?: number | null;
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
  nextRefreshAt = null,
}: SchedulePanelProps) {
  const unitConfig = refreshUnitConfig(unit);
  const amount = secondsToRefreshAmount(seconds, unit);
  const [draftAmount, setDraftAmount] = useState(String(amount));
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setDraftAmount(String(amount));
  }, [amount, unit]);

  useEffect(() => {
    if (!enabled || !nextRefreshAt) {
      return undefined;
    }
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [enabled, nextRefreshAt]);

  const updateAmount = (nextValue: string) => {
    setDraftAmount(nextValue);
    if (!nextValue.trim()) {
      return;
    }
    const parsed = Number(nextValue);
    if (!Number.isFinite(parsed)) {
      return;
    }
    setSeconds(normalizeRefreshAmount(parsed, unit) * unitConfig.multiplier);
  };
  const commitAmount = () => {
    const nextAmount = normalizeRefreshAmount(Number(draftAmount), unit);
    setDraftAmount(String(nextAmount));
    setSeconds(nextAmount * unitConfig.multiplier);
  };
  const updateUnit = (nextUnit: RefreshUnit) => {
    const nextConfig = refreshUnitConfig(nextUnit);
    const nextAmount = normalizeRefreshAmount(Number(draftAmount), nextUnit);
    setUnit(nextUnit);
    setDraftAmount(String(nextAmount));
    setSeconds(nextAmount * nextConfig.multiplier);
  };
  const secondsRemaining = enabled && nextRefreshAt ? Math.max(0, Math.ceil((nextRefreshAt - now) / 1000)) : null;

  return (
    <section className="tool-panel">
      <PanelHeading title="Update Scheduler" icon={<ListRestart size={17} />} onHide={onHide} />
      <button
        type="button"
        className={enabled ? "toggle-button active" : "toggle-button"}
        aria-pressed={enabled}
        title={enabled ? "Auto refresh is active" : "Auto refresh is inactive"}
        onClick={() => setEnabled(!enabled)}
      >
        {enabled ? <PlayCircle size={16} /> : <PauseCircle size={16} />}
        {enabled ? "Auto refresh active" : "Auto refresh inactive"}
      </button>
      <label className="number-row">
        <span>Period</span>
        <input
          type="number"
          min={unitConfig.min}
          max={unitConfig.max}
          step={1}
          value={draftAmount}
          onChange={(event) => updateAmount(event.currentTarget.value)}
          onBlur={commitAmount}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            }
          }}
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
      <div className="scheduler-countdown" aria-live="polite">
        <span>Next update</span>
        <strong>{secondsRemaining == null ? "inactive" : formatRemaining(secondsRemaining)}</strong>
      </div>
      <button type="button" className="action-button" onClick={onRefresh}>
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
  return normalizeRefreshAmount(seconds / config.multiplier, unit);
}

function normalizeRefreshAmount(amount: number, unit: RefreshUnit): number {
  const config = refreshUnitConfig(unit);
  if (!Number.isFinite(amount)) {
    return config.min;
  }
  return Math.max(config.min, Math.min(config.max, Math.round(amount)));
}

function formatRemaining(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) {
    return `${minutes}m ${String(rest).padStart(2, "0")}s`;
  }
  const hours = Math.floor(minutes / 60);
  const minuteRest = minutes % 60;
  return `${hours}h ${String(minuteRest).padStart(2, "0")}m ${String(rest).padStart(2, "0")}s`;
}
