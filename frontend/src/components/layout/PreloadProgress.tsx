import type { VolumePreloadState } from "../../viewer/useVolumePreload";
import { formatBytes, formatPreloadLabel } from "./preloadFormat";

type PreloadProgressProps = {
  preload: VolumePreloadState;
};

export default function PreloadProgress({ preload }: PreloadProgressProps) {
  if (preload.totalFiles === 0) {
    return null;
  }

  const percent = Math.round(preload.progress * 100);
  const totalBytesText =
    preload.totalBytes > 0
      ? `Total ${formatBytes(preload.loadedBytes)} / ${formatBytes(preload.totalBytes)}`
      : preload.loadedBytes > 0
        ? `Total ${formatBytes(preload.loadedBytes)}`
        : "";
  const speedText = preload.bytesPerSecond > 0 ? `${formatBytes(preload.bytesPerSecond)}/s` : "";
  const bytesText = [totalBytesText, speedText].filter(Boolean).join(" · ");
  const statusText = preload.isLoading
    ? `Caching ${preload.readyFiles}/${preload.totalFiles}`
    : `Cached ${preload.readyFiles}/${preload.totalFiles}`;
  const current = preload.currentLabel
    ? `${formatPreloadLabel(preload.currentLabel)} · ${preload.currentPhase}`
    : preload.failedFiles
      ? `${preload.failedFiles} failed`
      : "ready";

  return (
    <div className={`preload-strip ${preload.isLoading ? "loading" : "complete"}`}>
      <div className="preload-copy">
        <span>{statusText}</span>
        <span>{current}</span>
        {bytesText ? <span>{bytesText}</span> : null}
      </div>
      <div className="preload-track">
        <div style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
