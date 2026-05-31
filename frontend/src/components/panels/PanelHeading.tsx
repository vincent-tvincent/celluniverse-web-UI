import { EyeOff } from "lucide-react";
import type { ReactNode } from "react";

type PanelHeadingProps = {
  title: string;
  icon: ReactNode;
  onHide: () => void;
};

export default function PanelHeading({ title, icon, onHide }: PanelHeadingProps) {
  return (
    <div className="panel-heading">
      <span className="panel-heading-title">{title}</span>
      <div className="panel-heading-actions">
        {icon}
        <button type="button" className="panel-hide-button" onClick={onHide} title={`Hide ${title} panel`}>
          <EyeOff size={15} />
        </button>
      </div>
    </div>
  );
}
