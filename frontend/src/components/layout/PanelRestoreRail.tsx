import { ChevronLeft, ChevronRight, PanelLeftOpen, PanelRightOpen } from "lucide-react";

type PanelRestoreRailProps = {
  leftHidden: boolean;
  rightHidden: boolean;
  onShowLeft: () => void;
  onShowRight: () => void;
};

export default function PanelRestoreRail({
  leftHidden,
  rightHidden,
  onShowLeft,
  onShowRight,
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
      {rightHidden ? (
        <button
          type="button"
          className="side-restore-tab right"
          onClick={onShowRight}
          title="Show log panel"
          aria-label="Show log panel"
        >
          <ChevronLeft size={19} />
          <PanelRightOpen size={17} />
        </button>
      ) : null}
    </>
  );
}
