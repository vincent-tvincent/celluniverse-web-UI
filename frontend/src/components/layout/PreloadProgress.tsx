import { formatBytes, formatPreloadLabel } from "./preloadFormat";

type PreloadProgressState = {
  totalFiles: number;
  readyFiles: number;
  failedFiles: number;
  progress: number;
  loadedBytes: number;
  totalBytes: number;
  bytesPerSecond: number;
  currentLabel: string;
  currentPhase: "download" | "decode" | "idle";
  isLoading: boolean;
};

type PreloadProgressProps = {
  preload: PreloadProgressState;
  label?: string;
};

export default function PreloadProgress({ preload, label = "Caching" }: PreloadProgressProps) {
  if (preload.totalFiles === 0 || !preload.isLoading) {
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
  const statusText = `${label} ${preload.readyFiles}/${preload.totalFiles}`;
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
