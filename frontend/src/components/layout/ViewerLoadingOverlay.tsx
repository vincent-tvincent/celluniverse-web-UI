import type { JsonLoadProgress } from "../../api";
import type { VolumePreloadState } from "../../viewer/useVolumePreload";
import { formatPreloadLabel } from "./preloadFormat";

type ViewerLoadingOverlayProps = {
  preload: VolumePreloadState;
  metadataLoading: boolean;
  metadataProgress?: JsonLoadProgress | null;
  pointCloudLoading: boolean;
  previewLoadingLabel: string;
  previewLoadingDetail: string;
  previewProgress?: JsonLoadProgress | null;
  activeFrameWaiting: boolean;
  renderPending: boolean;
  renderLabel: string;
  renderDetail: string;
};

export default function ViewerLoadingOverlay({
  preload,
  metadataLoading,
  metadataProgress,
  pointCloudLoading,
  previewLoadingLabel,
  previewLoadingDetail,
  previewProgress,
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
      ? formatMetadataProgress(metadataProgress) ?? "refreshing manifest"
    : pointCloudLoading
      ? formatMetadataProgress(previewProgress) ?? previewLoadingDetail
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

function formatMetadataProgress(progress?: JsonLoadProgress | null): string | null {
  if (!progress) {
    return null;
  }
  const loaded = formatMegabytes(progress.loaded);
  if (progress.total && progress.total >= progress.loaded) {
    return `${loaded} of ${formatMegabytes(progress.total)} completed`;
  }
  return `${loaded} completed`;
}

function formatMegabytes(bytes: number): string {
  const value = Math.max(0, bytes) / (1024 * 1024);
  if (value >= 100) {
    return `${Math.round(value).toLocaleString()} MB`;
  }
  if (value >= 10) {
    return `${value.toFixed(1)} MB`;
  }
  return `${value.toFixed(2)} MB`;
}
