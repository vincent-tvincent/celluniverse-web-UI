import { EyeOff, PanelLeftClose } from "lucide-react";

type SidePanelCollapseButtonProps = {
  onClick: () => void;
};

export default function SidePanelCollapseButton({ onClick }: SidePanelCollapseButtonProps) {
  return (
    <button
      type="button"
      className="side-panel-collapse-button"
      onClick={onClick}
      title="Hide the left panel"
      aria-label="Hide the left panel"
    >
      <span>
        <PanelLeftClose size={16} />
        Hide panel
      </span>
      <EyeOff size={15} />
    </button>
  );
}
