import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Database, Download, FileCog, PanelLeftOpen, RotateCcw } from "lucide-react";
import { getLocalDatasetPreview, getUploadedDatasetPreview, toApiUrl } from "../../api";
import { previewConfigSignature, useViewerConfig, type PreviewConfig } from "../../config";
import type { CellRecord, DatasetPreviewManifest, LayerEntry } from "../../types";
import type { ColorMapId } from "../../viewer/colorMaps";
import { DEFAULT_CLEAN_CONTRAST_LIMITS, type ContrastLimits } from "../../viewer/contrast";
import type { ViewerHoverSample } from "../../viewer/hover";
import { loadPointCloudPreview } from "../../viewer/pointCloud";
import { loadSlicePreview } from "../../viewer/slicePreview";
import CanvasSliceViewer from "../../viewer/CanvasSliceViewer";
import ThreeVolumeViewer from "../../viewer/ThreeVolumeViewer";
import { useVolumePreload, type VolumePreloadTarget } from "../../viewer/useVolumePreload";
import LoadBadge from "../layout/LoadBadge";
import PanelResizer from "../layout/PanelResizer";
import PreloadProgress from "../layout/PreloadProgress";
import ViewerLoadingOverlay from "../layout/ViewerLoadingOverlay";
import ViewerToolbar from "../layout/ViewerToolbar";
import LayerPanel from "../panels/LayerPanel";
import PanelHeading from "../panels/PanelHeading";
import ViewModePanel from "../panels/ViewModePanel";
import type { ViewMode } from "../../store";

const EMPTY_CELLS: CellRecord[] = [];
const EMPTY_IDS: string[] = [];
const PREVIEW_LOADING_OVERLAY_DELAY_MS = 10000;
const DEFAULT_PANEL_LAYOUT = { left: 292, right: 340 };
const MIN_PANEL_WIDTH = 200;
const MAX_PANEL_WIDTH = 520;

type DatasetPreviewPanelProps = {
  kind: "upload" | "local";
  datasetId: string;
  onBack: () => void;
  onCreateJob: (datasetRef: string) => void;
};

export default function DatasetPreviewPanel({ kind, datasetId, onBack, onCreateJob }: DatasetPreviewPanelProps) {
  const workspaceRef = useRef<HTMLElement | null>(null);
  const [mode, setMode] = useState<ViewMode>("volume");
  const [frame, setFrameState] = useState(0);
  const [slice, setSlice] = useState(0);
  const [leftPanelVisible, setLeftPanelVisible] = useState(true);
  const [rightPanelVisible, setRightPanelVisible] = useState(true);
  const [panelLayout, setPanelLayout] = useState(DEFAULT_PANEL_LAYOUT);
  const [realEnabled, setRealEnabled] = useState(true);
  const [realMap, setRealMap] = useState<ColorMapId>("viridis");
  const [realOpacity, setRealOpacity] = useState(0.9);
  const [realContrastLimits, setRealContrastLimits] = useState<ContrastLimits>(DEFAULT_CLEAN_CONTRAST_LIMITS);
  const [synthMap, setSynthMap] = useState<ColorMapId>("magma");
  const [synthOpacity, setSynthOpacity] = useState(0);
  const [synthContrastLimits, setSynthContrastLimits] = useState<ContrastLimits>(DEFAULT_CLEAN_CONTRAST_LIMITS);
  const [pointAlphaByBrightness, setPointAlphaByBrightness] = useState(false);
  const [sliceRenderPending, setSliceRenderPending] = useState(false);
  const [renderedVolumeKey, setRenderedVolumeKey] = useState("");
  const [hoverSample, setHoverSample] = useState<ViewerHoverSample | null>(null);
  const [delayedViewerLoading, setDelayedViewerLoading] = useState(false);

  const manifestQuery = useQuery({
    queryKey: ["dataset-preview", kind, datasetId],
    queryFn: () => kind === "upload" ? getUploadedDatasetPreview(datasetId) : getLocalDatasetPreview(datasetId),
  });
  const configQuery = useViewerConfig();
  const manifest = manifestQuery.data;
  const frames = manifest?.frames ?? [];
  const availableFrameNumbers = useMemo(() => frames.map((item) => item.t), [frames]);

  const setFrame = useCallback((nextFrame: number) => {
    setFrameState(nextFrame);
    setSlice(0);
  }, []);

  useEffect(() => {
    if (!availableFrameNumbers.length) {
      return;
    }
    if (!availableFrameNumbers.includes(frame)) {
      setFrame(availableFrameNumbers[0]);
    }
  }, [availableFrameNumbers, frame, setFrame]);

  useEffect(() => setHoverSample(null), [datasetId, frame, mode, slice]);

  const activeFrame = frames.find((item) => item.t === frame) ?? frames[0];
  const activeFrameNumber = activeFrame?.t;
  const activeSourceName = activeFrame?.sourceName;
  const sourceFrameIndex = activeFrame ? activeFrame.sourceIndex ?? Math.max(0, frames.indexOf(activeFrame)) : undefined;
  const realUrl = getLayerUrl(activeFrame?.layers.realTiff);
  const realPointCloudUrl = getPointCloudLayerUrl(activeFrame?.layers.realPointCloud);
  const previewConfig = configQuery.data?.preview;
  const previewSignature = previewConfig ? previewConfigSignature(previewConfig) : "";
  const usePointCloudPreview = mode === "volume" && Boolean(realPointCloudUrl);
  const realSliceUrl = getDatasetSlicePreviewUrl(kind, datasetId, sourceFrameIndex, slice, previewConfig, realUrl);

  const preloadTargets = useMemo(
    () => realUrl && previewConfig && mode !== "slice" && !usePointCloudPreview
      ? [buildPreviewTarget(realUrl, activeFrameNumber ?? 0, previewConfig, previewSignature)]
      : [],
    [activeFrameNumber, mode, previewConfig, previewSignature, realUrl, usePointCloudPreview],
  );
  const preload = useVolumePreload(preloadTargets, previewConfig?.preloadConcurrency ?? 1);
  const realVolume = !usePointCloudPreview && realUrl && previewConfig ? preload.volumes[getPreloadKey(realUrl, previewSignature)] : undefined;

  const realPointCloudQuery = useQuery({
    queryKey: ["dataset-point-cloud", realPointCloudUrl],
    queryFn: () => loadPointCloudPreview(toApiUrl(realPointCloudUrl!)),
    enabled: usePointCloudPreview && realEnabled && Boolean(realPointCloudUrl),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const realSliceQuery = useQuery({
    queryKey: ["dataset-slice-preview", realSliceUrl],
    queryFn: () => loadSlicePreview(toApiUrl(realSliceUrl!)),
    enabled: mode === "slice" && realEnabled && Boolean(realSliceUrl),
    staleTime: Number.POSITIVE_INFINITY,
  });

  const maxDepth = Math.max(
    realSliceQuery.data?.depth ?? 0,
    realVolume?.depth ?? 0,
    realPointCloudQuery.data?.depth ?? 0,
    1,
  );
  const readoutWidth = realSliceQuery.data?.sourceWidth ?? realVolume?.sourceWidth ?? realPointCloudQuery.data?.sourceWidth ?? 0;
  const readoutHeight = realSliceQuery.data?.sourceHeight ?? realVolume?.sourceHeight ?? realPointCloudQuery.data?.sourceHeight ?? 0;

  useEffect(() => {
    if (maxDepth > 1 && slice > maxDepth - 1) {
      setSlice(Math.max(0, maxDepth - 1));
    }
  }, [maxDepth, slice]);

  useEffect(() => {
    if (mode === "slice") {
      setSliceRenderPending(true);
    }
  }, [mode, realSliceQuery.data, realVolume, slice]);

  const volumeRenderKey = useMemo(() => {
    if (mode !== "volume" || (!realVolume && !realPointCloudQuery.data)) {
      return "";
    }
    return [
      kind,
      datasetId,
      activeFrameNumber ?? "",
      sourceFrameIndex ?? "",
      realUrl ?? "",
      realPointCloudUrl ?? "",
      realEnabled,
      realMap,
      realOpacity,
      realContrastLimits,
      pointAlphaByBrightness,
      configQuery.data?.rendering.maxPixelRatio ?? 1,
      JSON.stringify(configQuery.data?.pointCloud ?? {}),
    ].join("|");
  }, [
    activeFrameNumber,
    configQuery.data,
    datasetId,
    kind,
    mode,
    pointAlphaByBrightness,
    realContrastLimits,
    realEnabled,
    realMap,
    realOpacity,
    realPointCloudQuery.data,
    realPointCloudUrl,
    realUrl,
    realVolume,
    sourceFrameIndex,
  ]);
  const volumeRenderPending = Boolean(volumeRenderKey && renderedVolumeKey !== volumeRenderKey);
  const handleVolumeFirstRender = useCallback(() => {
    if (volumeRenderKey) {
      setRenderedVolumeKey(volumeRenderKey);
    }
  }, [volumeRenderKey]);
  const handleSliceRenderStart = useCallback(() => setSliceRenderPending(true), []);
  const handleSliceRenderComplete = useCallback(() => setSliceRenderPending(false), []);
  const activeRenderPending = mode === "slice" ? sliceRenderPending : volumeRenderPending;

  const metadataLoading = manifestQuery.isFetching || configQuery.isLoading;
  const slicePreviewLoading = realEnabled && Boolean(realSliceUrl) && realSliceQuery.isLoading;
  const pointCloudLoading = realEnabled && Boolean(realPointCloudUrl) && realPointCloudQuery.isLoading;
  const activeSliceWaiting = Boolean(activeFrame && realEnabled && Boolean(realSliceUrl) && !realSliceQuery.data);
  const activeVolumeWaiting = Boolean(activeFrame && !realVolume && !realPointCloudQuery.data);
  const rawLoadingVisible = metadataLoading || (
    mode === "slice"
      ? activeSliceWaiting || slicePreviewLoading
      : preload.isLoading || pointCloudLoading || activeVolumeWaiting
  ) || activeRenderPending;
  const loadingDelayKey = [
    kind,
    datasetId,
    activeFrameNumber ?? "",
    sourceFrameIndex ?? "",
    mode,
    slice,
    realSliceUrl ?? "",
    realPointCloudUrl ?? "",
    volumeRenderKey,
  ].join("|");

  useEffect(() => {
    setDelayedViewerLoading(false);
    if (!rawLoadingVisible) {
      return undefined;
    }
    const timeout = window.setTimeout(() => setDelayedViewerLoading(true), PREVIEW_LOADING_OVERLAY_DELAY_MS);
    return () => window.clearTimeout(timeout);
  }, [loadingDelayKey, rawLoadingVisible]);

  const viewerLoadingOverlayVisible = rawLoadingVisible && delayedViewerLoading;
  const error = toError(manifestQuery.error ?? configQuery.error ?? realPointCloudQuery.error ?? realSliceQuery.error) ?? firstPreloadError(preload.errors);
  const workspaceStyle = {
    "--left-panel-width": `${panelLayout.left}px`,
    "--right-panel-width": `${panelLayout.right}px`,
  } as CSSProperties;
  const workspaceClassName = [
    "workspace",
    "dataset-preview-workspace",
    leftPanelVisible ? "" : "hide-left",
    rightPanelVisible ? "" : "hide-right",
  ].filter(Boolean).join(" ");

  const setLayer = useCallback((layer: "realEnabled" | "synthEnabled" | "cellsEnabled", value: boolean) => {
    if (layer === "realEnabled") {
      setRealEnabled(value);
    }
  }, []);

  const resizePanel = useCallback((panel: "left" | "right", nextWidth: number) => {
    const workspaceWidth = workspaceRef.current?.getBoundingClientRect().width ?? window.innerWidth;
    const maxByViewport = panel === "right"
      ? Math.max(MIN_PANEL_WIDTH, workspaceWidth - MIN_PANEL_WIDTH)
      : Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, workspaceWidth * 0.42));
    setPanelLayout((current) => ({
      ...current,
      [panel]: Math.round(clampNumber(nextWidth, MIN_PANEL_WIDTH, maxByViewport)),
    }));
  }, []);

  const beginPanelResize = useCallback((panel: "left" | "right", event: ReactPointerEvent<HTMLDivElement>) => {
    const workspace = workspaceRef.current;
    if (!workspace) {
      return;
    }
    event.preventDefault();
    const rect = workspace.getBoundingClientRect();
    const handlePointerMove = (moveEvent: PointerEvent) => {
      const nextWidth = panel === "left"
        ? moveEvent.clientX - rect.left
        : rect.right - moveEvent.clientX;
      resizePanel(panel, nextWidth);
    };
    const handlePointerUp = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  }, [resizePanel]);

  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) {
      return undefined;
    }
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? workspace.clientWidth;
      const leftMaxByViewport = Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, width * 0.42));
      const rightMaxByViewport = Math.max(MIN_PANEL_WIDTH, width - MIN_PANEL_WIDTH);
      setPanelLayout((current) => {
        const left = Math.round(clampNumber(current.left, MIN_PANEL_WIDTH, leftMaxByViewport));
        const right = Math.round(clampNumber(current.right, MIN_PANEL_WIDTH, rightMaxByViewport));
        return left === current.left && right === current.right ? current : { left, right };
      });
    });
    observer.observe(workspace);
    return () => observer.disconnect();
  }, []);

  return (
    <main className="app-shell dataset-preview-shell">
      <header className="top-bar dashboard-top-bar">
        <div className="brand-block">
          <button className="brand-mark brand-back-button" type="button" onClick={onBack} title="Back" aria-label="Back">
            <ArrowLeft size={22} />
          </button>
          <div>
            <h1>{manifest?.label ?? "Dataset Preview"}</h1>
          </div>
        </div>
        <div className="dashboard-top-actions">
          <button className="action-button" type="button" onClick={() => onCreateJob(`${kind}:${datasetId}`)}>
            <FileCog size={16} /> Create Job
          </button>
          {kind === "upload" ? (
            <a className="secondary-button icon-text-button" href={`/api/datasets/uploads/${encodeURIComponent(datasetId)}/download`}>
              <Download size={16} /> Download
            </a>
          ) : null}
          <button className="icon-button" type="button" onClick={() => void manifestQuery.refetch()} title="Refresh preview" aria-label="Refresh preview">
            <RotateCcw size={17} />
          </button>
        </div>
      </header>

      <section className={workspaceClassName} ref={workspaceRef} style={workspaceStyle}>
        {!leftPanelVisible ? (
          <button
            type="button"
            className="side-restore-tab left"
            onClick={() => setLeftPanelVisible(true)}
            title="Show viewer controls"
            aria-label="Show viewer controls"
          >
            <PanelLeftOpen size={17} />
          </button>
        ) : null}
        {!rightPanelVisible ? (
          <button
            type="button"
            className="side-restore-tab right"
            onClick={() => setRightPanelVisible(true)}
            title="Show dataset"
            aria-label="Show dataset"
          >
            <Database size={18} />
          </button>
        ) : null}

        {leftPanelVisible ? (
          <>
            <aside className="side-panel left-panel dataset-preview-left">
              <ViewModePanel mode={mode} setMode={setMode} onHide={() => setLeftPanelVisible(false)} />
              <LayerPanel
                realEnabled={realEnabled}
                synthEnabled={false}
                cellsEnabled={false}
                setLayer={setLayer}
                realMap={realMap}
                synthMap={synthMap}
                setRealMap={setRealMap}
                setSynthMap={setSynthMap}
                realOpacity={realOpacity}
                setRealOpacity={setRealOpacity}
                realContrastLimits={realContrastLimits}
                setRealContrastLimits={setRealContrastLimits}
                synthOpacity={synthOpacity}
                setSynthOpacity={setSynthOpacity}
                synthContrastLimits={synthContrastLimits}
                setSynthContrastLimits={setSynthContrastLimits}
                pointAlphaByBrightness={pointAlphaByBrightness}
                setPointAlphaByBrightness={setPointAlphaByBrightness}
                showCells={false}
                showSynth={false}
                onHide={() => setLeftPanelVisible(false)}
              />
            </aside>
            <PanelResizer
              side="left"
              onPointerDown={(event) => beginPanelResize("left", event)}
              onKeyboardResize={(delta) => resizePanel("left", panelLayout.left + delta)}
            />
          </>
        ) : null}

        <section className="viewer-column dataset-preview-viewer">
          <ViewerToolbar
            mode={mode}
            frame={activeFrameNumber ?? frame}
            frames={availableFrameNumbers}
            setFrame={setFrame}
            slice={slice}
            maxDepth={maxDepth}
            setSlice={setSlice}
            frameControlsDisabled={mode === "volume" ? pointCloudLoading : slicePreviewLoading}
          />
          <PreloadProgress preload={preload} />
          <div className="viewer-shell">
            {mode === "slice" ? (
              <CanvasSliceViewer
                real={realVolume}
                realSlice={realSliceQuery.data}
                cells={EMPTY_CELLS}
                slice={slice}
                realEnabled={realEnabled}
                synthEnabled={false}
                cellsEnabled={false}
                realMap={realMap}
                synthMap={synthMap}
                realOpacity={realOpacity}
                synthOpacity={synthOpacity}
                realContrastLimits={realContrastLimits}
                synthContrastLimits={synthContrastLimits}
                onRenderStart={handleSliceRenderStart}
                onRenderComplete={handleSliceRenderComplete}
                onHoverSample={setHoverSample}
              />
            ) : (
              <ThreeVolumeViewer
                real={realVolume}
                realPointCloud={realPointCloudQuery.data}
                cells={EMPTY_CELLS}
                realEnabled={realEnabled}
                synthEnabled={false}
                cellsEnabled={false}
                realMap={realMap}
                synthMap={synthMap}
                realOpacity={realOpacity}
                synthOpacity={synthOpacity}
                realContrastLimits={realContrastLimits}
                synthContrastLimits={synthContrastLimits}
                pointAlphaByBrightness={pointAlphaByBrightness}
                maxPixelRatio={configQuery.data?.rendering.maxPixelRatio ?? 1}
                pointCloudConfig={configQuery.data?.pointCloud}
                focusCellIds={EMPTY_IDS}
                focusFrame={null}
                focusRequestId={0}
                labeledCellIds={EMPTY_IDS}
                frame={activeFrameNumber ?? frame}
                onFirstRender={handleVolumeFirstRender}
                onHoverSample={setHoverSample}
              />
            )}
            <DatasetPreviewReadout
              manifest={manifest}
              frame={activeFrameNumber ?? frame}
              sourceName={activeSourceName}
              depth={maxDepth}
              width={readoutWidth}
              height={readoutHeight}
              hoverSample={hoverSample}
            />
            <div className="interaction-hint viewer-interaction-hint">
              {mode === "slice" ? "2D: hover to sample brightness" : "3D: drag to rotate, wheel to zoom, right-drag to pan"}
            </div>
            <LoadBadge
              manifestLoading={metadataLoading}
              preload={preload}
              pointCloudLoading={mode === "slice" ? slicePreviewLoading : pointCloudLoading}
              previewLoadingLabel={mode === "slice" ? "Loading 2D slice" : "Loading point cloud"}
              activeFrameWaiting={mode === "slice" ? activeSliceWaiting : activeVolumeWaiting}
              error={error}
            />
            {viewerLoadingOverlayVisible ? (
              <ViewerLoadingOverlay
                preload={preload}
                metadataLoading={metadataLoading}
                pointCloudLoading={mode === "slice" ? slicePreviewLoading : pointCloudLoading}
                previewLoadingLabel={mode === "slice" ? "loading 2D slice" : "loading point cloud preview"}
                previewLoadingDetail={mode === "slice" ? "fetching backend slice preview" : "downloading compact backend preview"}
                activeFrameWaiting={mode === "slice" ? activeSliceWaiting : activeVolumeWaiting}
                renderPending={activeRenderPending}
                renderLabel={mode === "slice" ? "rendering 2D slice" : "rendering 3D view"}
                renderDetail={mode === "slice" ? "drawing selected z slice" : "building point cloud"}
              />
            ) : null}
          </div>
        </section>

        {rightPanelVisible ? (
          <>
            <PanelResizer
              side="right"
              onPointerDown={(event) => beginPanelResize("right", event)}
              onKeyboardResize={(delta) => resizePanel("right", panelLayout.right + delta)}
            />
            <aside className="side-panel dataset-preview-side">
              <section className="tool-panel dataset-preview-info">
                <PanelHeading title="Dataset" icon={<Database size={16} />} onHide={() => setRightPanelVisible(false)} />
                <dl className="metric-grid dashboard-metrics">
                  <div><dt>Source</dt><dd>{kind}</dd></div>
                  <div><dt>Frames</dt><dd>{frames.length}</dd></div>
                  <div><dt>Current</dt><dd>{activeFrameNumber ?? "-"}</dd></div>
                </dl>
                <div className="dataset-preview-paths">
                  {metadataEntries(manifest).map(([key, value]) => (
                    <p key={key}><span>{key}</span><strong>{value}</strong></p>
                  ))}
                </div>
                <div className="item-actions dataset-preview-actions">
                  <button className="action-button" type="button" onClick={() => onCreateJob(`${kind}:${datasetId}`)}>
                    <FileCog size={15} /> Create Job
                  </button>
                  {kind === "upload" ? (
                    <a className="secondary-button icon-text-button" href={`/api/datasets/uploads/${encodeURIComponent(datasetId)}/download`}>
                      <Download size={15} /> Download
                    </a>
                  ) : null}
                </div>
              </section>
            </aside>
          </>
        ) : null}
      </section>
    </main>
  );
}

function buildPreviewTarget(
  url: string,
  frame: number,
  previewConfig: { maxXY: number; maxSlices: number },
  previewSignature: string,
): VolumePreloadTarget {
  return {
    key: getPreloadKey(url, previewSignature),
    url: toApiUrl(url),
    label: `t${frame} real`,
    options: {
      maxXY: previewConfig.maxXY,
      maxSlices: Math.max(previewConfig.maxSlices, 50),
    },
  };
}

function getLayerUrl(layer?: LayerEntry): string | undefined {
  if (!layer || layer.format !== "tiff") {
    return undefined;
  }
  return layer.url;
}

function getPointCloudLayerUrl(layer?: LayerEntry): string | undefined {
  if (!layer || layer.format !== "point-cloud-v1") {
    return undefined;
  }
  return layer.url;
}

function getDatasetSlicePreviewUrl(
  kind: "upload" | "local",
  datasetId: string,
  sourceFrameIndex: number | undefined,
  slice: number,
  previewConfig: PreviewConfig | undefined,
  sourceUrl: string | undefined,
): string | undefined {
  if (sourceFrameIndex == null || !previewConfig || !sourceUrl) {
    return undefined;
  }
  const requestedSlice = Math.max(0, Math.round(slice));
  const encodedId = encodeURIComponent(datasetId);
  const source = kind === "upload" ? "uploads" : "local";
  return `/api/datasets/${source}/${encodedId}/slices/${sourceFrameIndex}/${requestedSlice}.cusl?max_xy=${previewConfig.maxXY}`;
}

function getPreloadKey(url: string, previewSignature: string): string {
  return `${url}\u0000${previewSignature}`;
}

function firstPreloadError(errors: Record<string, string>): Error | null {
  const first = Object.values(errors)[0];
  return first ? new Error(first) : null;
}

function toError(value: unknown): Error | null {
  if (!value) {
    return null;
  }
  return value instanceof Error ? value : new Error(String(value));
}

function metadataEntries(manifest: DatasetPreviewManifest | undefined): [string, string][] {
  if (!manifest?.metadata) {
    return [];
  }
  const keys = ["inputPath", "filePattern", "pathKind", "source", "createdAt", "totalBytes"];
  return keys.flatMap((key) => {
    const value = manifest.metadata?.[key];
    if (value == null || value === "") {
      return [];
    }
    const label = key === "inputPath"
      ? "Path"
      : key === "filePattern"
        ? "Pattern"
        : key === "pathKind"
          ? "Kind"
          : key === "totalBytes"
            ? "Size"
            : key;
    const text = key === "totalBytes" ? formatBytes(Number(value)) : String(value);
    return [[label, text] as [string, string]];
  });
}

function DatasetPreviewReadout({
  manifest,
  frame,
  sourceName,
  depth,
  width,
  height,
  hoverSample,
}: {
  manifest?: DatasetPreviewManifest;
  frame: number;
  sourceName?: string;
  depth: number;
  width: number;
  height: number;
  hoverSample: ViewerHoverSample | null;
}) {
  return (
    <div className="viewer-readout" aria-live="polite">
      <div className="viewer-readout-line">
        <span>{manifest?.frames.length ?? 0} t</span>
        <span>frame {frame}</span>
        <span>{depth} z</span>
        <span>{width && height ? `${width}x${height}` : "0 xy"}</span>
      </div>
      {sourceName ? <div className="viewer-readout-line"><span>{sourceName}</span></div> : null}
      {hoverSample ? (
        <div className="viewer-readout-line hover">
          <span>x {hoverSample.x}</span>
          <span>y {hoverSample.y}</span>
          <span>z {hoverSample.z}</span>
          <span>brightness {formatBrightness(hoverSample.brightness)}</span>
        </div>
      ) : null}
    </div>
  );
}

function formatBrightness(value: number | null): string {
  if (value == null || !Number.isFinite(value)) {
    return "0";
  }
  return value > 0 && value <= 1 ? value.toFixed(3) : String(Math.round(value));
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value >= 10 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
}
