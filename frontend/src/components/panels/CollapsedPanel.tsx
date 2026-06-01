import { Activity, ChevronDown, Eye, GitBranch, Layers, ListRestart, Monitor, TerminalSquare } from "lucide-react";
import type { ComponentType } from "react";
import type { PanelVisibilityKey } from "../layout/types";

const PANEL_ICONS: Record<PanelVisibilityKey, ComponentType<{ size?: number }>> = {
  status: Activity,
  layers: Layers,
  update: ListRestart,
  logs: TerminalSquare,
  lineage: GitBranch,
  viewer: Monitor,
};

type CollapsedPanelProps = {
  panel: PanelVisibilityKey;
  title: string;
  onShow: () => void;
};

export default function CollapsedPanel({ panel, title, onShow }: CollapsedPanelProps) {
  const Icon = PANEL_ICONS[panel];
  return (
    <button
      type="button"
      className="folded-panel"
      onClick={onShow}
      title={`Expand ${title} panel`}
      aria-label={`Expand ${title} panel`}
    >
      <span className="folded-panel-label">
        <Icon size={16} />
        {title}
      </span>
      <span className="folded-panel-action">
        <Eye size={15} />
        <ChevronDown size={15} />
      </span>
    </button>
  );
}
