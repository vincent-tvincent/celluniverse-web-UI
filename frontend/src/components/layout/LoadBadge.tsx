import { Activity, CircleOff } from "lucide-react";
import type { VolumePreloadState } from "../../viewer/useVolumePreload";

type LoadBadgeProps = {
  manifestLoading: boolean;
  preload: VolumePreloadState;
  pointCloudLoading: boolean;
  previewLoadingLabel: string;
  activeFrameWaiting: boolean;
  error: Error | null;
};

export default function LoadBadge({
  manifestLoading,
  preload,
  pointCloudLoading,
  previewLoadingLabel,
  activeFrameWaiting,
  error,
}: LoadBadgeProps) {
  const text = error
    ? error.message
    : manifestLoading
      ? "Loading manifest"
    : pointCloudLoading
      ? previewLoadingLabel
    : preload.isLoading
      ? `Caching TIFF ${preload.readyFiles}/${preload.totalFiles}`
    : activeFrameWaiting
      ? "Waiting for frame"
      : "";
  if (!text) {
    return null;
  }
  return (
    <div className={`load-badge ${error ? "error" : ""}`}>
      {error ? <CircleOff size={14} /> : <Activity size={14} />}
      <span>{text}</span>
    </div>
  );
}
