import { ChevronRight, PanelBottomOpen, PanelLeftOpen } from "lucide-react";

type PanelRestoreRailProps = {
  leftHidden: boolean;
  logHidden: boolean;
  onShowLeft: () => void;
  onShowLog: () => void;
};

export default function PanelRestoreRail({
  leftHidden,
  logHidden,
  onShowLeft,
  onShowLog,
}: PanelRestoreRailProps) {
  return (
    <>
      {leftHidden ? (
        <button
          type="button"
          className="side-restore-tab left"
          onClick={onShowLeft}
          title="Show left panels"
          aria-label="Show left panels"
        >
          <PanelLeftOpen size={17} />
          <ChevronRight size={19} />
        </button>
      ) : null}
      {logHidden ? (
        <button
          type="button"
          className="side-restore-tab log"
          onClick={onShowLog}
          title="Show log panel"
          aria-label="Show log panel"
        >
          <PanelBottomOpen size={18} />
        </button>
      ) : null}
    </>
  );
}
