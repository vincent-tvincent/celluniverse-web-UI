import { PanelBottomOpen, PanelLeftOpen, PanelRightOpen, PanelTopOpen } from "lucide-react";

type PanelRestoreRailProps = {
  leftHidden: boolean;
  rightHidden: boolean;
  logHidden: boolean;
  viewerHidden: boolean;
  onShowLeft: () => void;
  onShowRight: () => void;
  onShowLog: () => void;
  onShowViewer: () => void;
};

export default function PanelRestoreRail({
  leftHidden,
  rightHidden,
  logHidden,
  viewerHidden,
  onShowLeft,
  onShowRight,
  onShowLog,
  onShowViewer,
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
        </button>
      ) : null}
      {rightHidden ? (
        <button
          type="button"
          className="side-restore-tab right"
          onClick={onShowRight}
          title="Show lineage panel"
          aria-label="Show lineage panel"
        >
          <PanelRightOpen size={18} />
        </button>
      ) : null}
      {viewerHidden ? (
        <button
          type="button"
          className="side-restore-tab top"
          onClick={onShowViewer}
          title="Show viewer panel"
          aria-label="Show viewer panel"
        >
          <PanelTopOpen size={18} />
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
