import type { VolumePreloadState } from "../../viewer/useVolumePreload";
import { formatPreloadLabel } from "./preloadFormat";

type ViewerLoadingOverlayProps = {
  preload: VolumePreloadState;
  metadataLoading: boolean;
  pointCloudLoading: boolean;
  previewLoadingLabel: string;
  previewLoadingDetail: string;
  activeFrameWaiting: boolean;
  renderPending: boolean;
  renderLabel: string;
  renderDetail: string;
};

export default function ViewerLoadingOverlay({
  preload,
  metadataLoading,
  pointCloudLoading,
  previewLoadingLabel,
  previewLoadingDetail,
  activeFrameWaiting,
  renderPending,
  renderLabel,
  renderDetail,
}: ViewerLoadingOverlayProps) {
  const label = preload.currentLabel
    ? formatPreloadLabel(preload.currentLabel)
    : metadataLoading
      ? "loading viewer metadata"
    : pointCloudLoading
      ? previewLoadingLabel
    : renderPending
      ? renderLabel
    : activeFrameWaiting
      ? "waiting for frame"
      : "preparing volume";
  const detail = preload.isLoading
    ? `${preload.readyFiles}/${preload.totalFiles} cached`
    : metadataLoading
      ? "refreshing manifest"
    : pointCloudLoading
      ? previewLoadingDetail
    : renderPending
      ? renderDetail
    : "waiting for preview data";

  return (
    <div className="viewer-loading-overlay" aria-live="polite">
      <div className="viewer-loading-card">
        <div className="viewer-loading-spinner" />
        <div>
          <strong>{label}</strong>
          <span>{detail}</span>
        </div>
      </div>
    </div>
  );
}
