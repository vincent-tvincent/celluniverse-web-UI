import { X as XIcon } from "lucide-react";
import type { FrameUpdateNotice } from "./types";

type FrameUpdateToastProps = {
  notice: FrameUpdateNotice | null;
  onView: () => void;
  onDismiss: () => void;
};

export default function FrameUpdateToast({ notice, onView, onDismiss }: FrameUpdateToastProps) {
  if (!notice) {
    return null;
  }

  const label =
    notice.frames.length === 1
      ? `Frame t${notice.latestFrame} ready`
      : `${notice.frames.length} new frames ready`;

  return (
    <div className="frame-toast" aria-live="polite" key={notice.createdAt}>
      <div>
        <strong>{label}</strong>
        <span>Preload queue updated</span>
      </div>
      <button type="button" onClick={onView}>
        View
      </button>
      <button type="button" className="toast-dismiss" onClick={onDismiss} aria-label="Dismiss frame update notice">
        <XIcon size={15} />
      </button>
    </div>
  );
}
