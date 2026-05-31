import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getFrameCells, getJob, getLogs, getManifest, listJobs, toApiUrl } from "./api";
import FrameUpdateToast from "./components/layout/FrameUpdateToast";
import LoadBadge from "./components/layout/LoadBadge";
import PanelResizer from "./components/layout/PanelResizer";
import PanelRestoreRail from "./components/layout/PanelRestoreRail";
import PreloadProgress from "./components/layout/PreloadProgress";
import TopBar from "./components/layout/TopBar";
import ViewerLoadingOverlay from "./components/layout/ViewerLoadingOverlay";
import ViewerToolbar from "./components/layout/ViewerToolbar";
import {
  DEFAULT_PANEL_VISIBILITY,
  LEFT_PANEL_KEYS,
  RIGHT_PANEL_KEYS,
  type FrameUpdateNotice,
  type PanelVisibility,
  type PanelVisibilityKey,
} from "./components/layout/types";
import CollapsedPanel from "./components/panels/CollapsedPanel";
import LayerPanel from "./components/panels/LayerPanel";
import LogPanel from "./components/panels/LogPanel";
import SchedulePanel from "./components/panels/SchedulePanel";
import SidePanelCollapseButton from "./components/panels/SidePanelCollapseButton";
import StatusPanel from "./components/panels/StatusPanel";
import { previewConfigSignature, useViewerConfig, type PreviewConfig } from "./config";
import { useJobEvents } from "./hooks";
import { useViewerStore } from "./store";
import type { CellRecord, JobManifest, JobStatus, LayerEntry } from "./types";
import CanvasSliceViewer from "./viewer/CanvasSliceViewer";
import ThreeVolumeViewer from "./viewer/ThreeVolumeViewer";
import { loadPointCloudPreview } from "./viewer/pointCloud";
import { loadSlicePreview } from "./viewer/slicePreview";
import type { VolumeData } from "./viewer/tiff";
import { useVolumePreload, type VolumePreloadTarget } from "./viewer/useVolumePreload";

const EMPTY_CELLS: CellRecord[] = [];
const PANEL_LAYOUT_STORAGE_KEY = "celluniverse-viewer-panel-layout";
const PANEL_VISIBILITY_STORAGE_KEY = "celluniverse-viewer-panel-visibility";
const DEFAULT_PANEL_LAYOUT = { left: 292, right: 360 };
const MIN_PANEL_WIDTH = 200;
const MAX_PANEL_WIDTH = 520;
const RENDER_LOADING_DELAY_MS = 2500;

function App() {
  const queryClient = useQueryClient();
  const {
    selectedJobId,
    setSelectedJobId,
    frame,
    setFrame,
    slice,
    setSlice,
    mode,
    setMode,
    realEnabled,
    synthEnabled,
    cellsEnabled,
    setLayer,
    realMap,
    synthMap,
    setRealMap,
    setSynthMap,
    realOpacity,
    setRealOpacity,
    synthOpacity,
    setSynthOpacity,
    logStream,
    setLogStream,
    autoRefreshEnabled,
    autoRefreshSeconds,
    autoRefreshUnit,
    setAutoRefreshEnabled,
    setAutoRefreshSeconds,
    setAutoRefreshUnit,
  } = useViewerStore();
  const configQuery = useViewerConfig();
  const previewConfig = configQuery.data?.preview;
  const previewSignature = previewConfig ? previewConfigSignature(previewConfig) : "";

  const scheduledRefreshMs = autoRefreshEnabled ? autoRefreshSeconds * 1000 : false;
  const jobsQuery = useQuery({ queryKey: ["jobs"], queryFn: listJobs, refetchInterval: scheduledRefreshMs });
  const sortedJobs = useMemo(() => sortJobs(jobsQuery.data ?? []), [jobsQuery.data]);
  const [frameNotice, setFrameNotice] = useState<FrameUpdateNotice | null>(null);
  const [manualSliceOverride, setManualSliceOverride] = useState(false);
  const [sliceRenderPending, setSliceRenderPending] = useState(false);
  const [delayedRenderPending, setDelayedRenderPending] = useState(false);
  const [panelLayout, setPanelLayout] = useState(readPanelLayout);
  const [panelVisibility, setPanelVisibility] = useState(readPanelVisibility);
  const frameHistoryRef = useRef<{ jobId: string; frames: Set<number> } | null>(null);
  const workspaceRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (selectedJobId || !sortedJobs.length) {
      return;
    }
    setSelectedJobId(sortedJobs[0].id);
  }, [sortedJobs, selectedJobId, setSelectedJobId]);

  useJobEvents(selectedJobId);

  const jobQuery = useQuery({
    queryKey: ["job", selectedJobId],
    queryFn: () => getJob(selectedJobId),
    enabled: Boolean(selectedJobId),
    refetchInterval: selectedJobId ? scheduledRefreshMs : false,
  });

  const manifestQuery = useQuery({
    queryKey: ["manifest", selectedJobId],
    queryFn: () => getManifest(selectedJobId),
    enabled: Boolean(selectedJobId),
    refetchInterval: selectedJobId ? scheduledRefreshMs : false,
  });

  const frames = manifestQuery.data?.frames ?? [];
  const availableFrameNumbers = useMemo(() => frames.map((item) => item.t), [frames]);

  useEffect(() => {
    if (!selectedJobId) {
      frameHistoryRef.current = null;
      setFrameNotice(null);
      return;
    }

    const currentFrames = new Set(availableFrameNumbers);
    const history = frameHistoryRef.current;
    if (!history || history.jobId !== selectedJobId) {
      frameHistoryRef.current = { jobId: selectedJobId, frames: currentFrames };
      setFrameNotice(null);
      return;
    }

    const newFrames = availableFrameNumbers.filter((frameNumber) => !history.frames.has(frameNumber));
    frameHistoryRef.current = { jobId: selectedJobId, frames: currentFrames };
    if (newFrames.length > 0) {
      setFrameNotice({
        frames: newFrames,
        latestFrame: Math.max(...newFrames),
        createdAt: Date.now(),
      });
    }
  }, [availableFrameNumbers, selectedJobId]);

  useEffect(() => {
    if (!frameNotice) {
      document.title = "CellUniverse Live Viewer";
      return undefined;
    }

    document.title = `Frame t${frameNotice.latestFrame} ready - CellUniverse`;
    const timeout = window.setTimeout(() => setFrameNotice(null), 12000);
    return () => {
      window.clearTimeout(timeout);
      document.title = "CellUniverse Live Viewer";
    };
  }, [frameNotice]);

  useEffect(() => {
    if (!availableFrameNumbers.length) {
      return;
    }
    const statusFrame = jobQuery.data?.currentFrame ?? jobQuery.data?.lastCompletedFrame;
    const target = statusFrame != null && availableFrameNumbers.includes(statusFrame)
      ? statusFrame
      : availableFrameNumbers[availableFrameNumbers.length - 1];
    if (!availableFrameNumbers.includes(frame)) {
      setFrame(target);
    }
  }, [availableFrameNumbers, frame, jobQuery.data, setFrame]);

  const activeFrame = frames.find((item) => item.t === frame) ?? frames.at(-1);
  const activeFrameNumber = activeFrame?.t;
  const realUrl = getLayerUrl(activeFrame?.layers.realTiff);
  const synthUrl = getLayerUrl(activeFrame?.layers.synthTiff);
  const realPointCloudUrl = getPointCloudLayerUrl(activeFrame?.layers.realPointCloud);
  const synthPointCloudUrl = getPointCloudLayerUrl(activeFrame?.layers.synthPointCloud);
  const usePointCloudPreview = mode === "volume" && Boolean(realPointCloudUrl || synthPointCloudUrl);
  const realSliceUrl = getSlicePreviewUrl(selectedJobId, activeFrameNumber, "real", slice, previewConfig, realUrl);
  const synthSliceUrl = getSlicePreviewUrl(selectedJobId, activeFrameNumber, "synth", slice, previewConfig, synthUrl);
  const preloadTargets = useMemo(
    () => (previewConfig && !usePointCloudPreview && mode !== "slice"
      ? buildPreloadTargets(frames, activeFrameNumber, previewConfig, previewSignature)
      : []),
    [activeFrameNumber, frames, mode, previewConfig, previewSignature, usePointCloudPreview],
  );
  const preload = useVolumePreload(preloadTargets, previewConfig?.preloadConcurrency ?? 1);
  const realVolume = !usePointCloudPreview && realUrl && previewConfig
    ? preload.volumes[getPreloadKey(realUrl, previewSignature)]
    : undefined;
  const synthVolume = !usePointCloudPreview && synthUrl && previewConfig
    ? preload.volumes[getPreloadKey(synthUrl, previewSignature)]
    : undefined;
  const realPointCloudQuery = useQuery({
    queryKey: ["point-cloud", realPointCloudUrl],
    queryFn: () => loadPointCloudPreview(toApiUrl(realPointCloudUrl!)),
    enabled: usePointCloudPreview && realEnabled && Boolean(realPointCloudUrl),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const synthPointCloudQuery = useQuery({
    queryKey: ["point-cloud", synthPointCloudUrl],
    queryFn: () => loadPointCloudPreview(toApiUrl(synthPointCloudUrl!)),
    enabled: usePointCloudPreview && synthEnabled && Boolean(synthPointCloudUrl),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const realSliceQuery = useQuery({
    queryKey: ["slice-preview", realSliceUrl],
    queryFn: () => loadSlicePreview(toApiUrl(realSliceUrl!)),
    enabled: mode === "slice" && realEnabled && Boolean(realSliceUrl),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const synthSliceQuery = useQuery({
    queryKey: ["slice-preview", synthSliceUrl],
    queryFn: () => loadSlicePreview(toApiUrl(synthSliceUrl!)),
    enabled: mode === "slice" && synthEnabled && Boolean(synthSliceUrl),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const slicePreviewLoading = (
    (realEnabled && Boolean(realSliceUrl) && realSliceQuery.isLoading) ||
    (synthEnabled && Boolean(synthSliceUrl) && synthSliceQuery.isLoading)
  );
  const pointCloudLoading = (
    (realEnabled && Boolean(realPointCloudUrl) && realPointCloudQuery.isLoading) ||
    (synthEnabled && Boolean(synthPointCloudUrl) && synthPointCloudQuery.isLoading)
  );
  const volumeRenderKey = useMemo(() => {
    if (
      mode !== "volume" ||
      (!realVolume && !synthVolume && !realPointCloudQuery.data && !synthPointCloudQuery.data)
    ) {
      return "";
    }
    return [
      selectedJobId,
      activeFrame?.t ?? "",
      realUrl ?? "",
      synthUrl ?? "",
      realPointCloudUrl ?? "",
      synthPointCloudUrl ?? "",
      realEnabled,
      synthEnabled,
      cellsEnabled,
      realMap,
      synthMap,
      realOpacity,
      synthOpacity,
      configQuery.data?.rendering.maxPixelRatio ?? 1,
      JSON.stringify(configQuery.data?.pointCloud ?? {}),
    ].join("|");
  }, [
    activeFrame?.t,
    cellsEnabled,
    configQuery.data,
    mode,
    realEnabled,
    realMap,
    realOpacity,
    realUrl,
    realVolume,
    realPointCloudQuery.data,
    realPointCloudUrl,
    selectedJobId,
    synthEnabled,
    synthMap,
    synthOpacity,
    synthUrl,
    synthVolume,
    synthPointCloudQuery.data,
    synthPointCloudUrl,
  ]);
  const [renderedVolumeKey, setRenderedVolumeKey] = useState("");
  const volumeRenderPending = Boolean(volumeRenderKey && renderedVolumeKey !== volumeRenderKey);
  const handleVolumeFirstRender = useCallback(() => {
    if (volumeRenderKey) {
      setRenderedVolumeKey(volumeRenderKey);
    }
  }, [volumeRenderKey]);
  const handleSliceRenderStart = useCallback(() => setSliceRenderPending(true), []);
  const handleSliceRenderComplete = useCallback(() => setSliceRenderPending(false), []);
  const activeRenderPending = mode === "slice" ? sliceRenderPending : volumeRenderPending;
  const renderDelayKey = activeRenderPending
    ? mode === "slice"
      ? [
          mode,
          selectedJobId,
          activeFrame?.t ?? "",
          slice,
          realSliceUrl ?? "",
          synthSliceUrl ?? "",
          realEnabled,
          synthEnabled,
          cellsEnabled,
          realMap,
          synthMap,
          realOpacity,
          synthOpacity,
        ].join("|")
      : volumeRenderKey
    : "";

  const cellsQuery = useQuery({
    queryKey: ["cells", selectedJobId, activeFrame?.t],
    queryFn: () => getFrameCells(selectedJobId, activeFrame!.t),
    enabled: Boolean(selectedJobId && activeFrame),
  });
  const frameCells = cellsQuery.data ?? EMPTY_CELLS;

  const logsQuery = useQuery({
    queryKey: ["logs", selectedJobId, logStream],
    queryFn: () => getLogs(selectedJobId, logStream, 80),
    enabled: Boolean(selectedJobId),
    refetchInterval: selectedJobId ? 3000 : false,
  });

  const maxDepth = Math.max(
    realVolume?.depth ?? 0,
    synthVolume?.depth ?? 0,
    realSliceQuery.data?.depth ?? 0,
    synthSliceQuery.data?.depth ?? 0,
    realPointCloudQuery.data?.depth ?? 0,
    synthPointCloudQuery.data?.depth ?? 0,
    1,
  );
  useEffect(() => {
    if (maxDepth > 1 && slice > maxDepth - 1) {
      setSlice(Math.max(0, maxDepth - 1));
    }
  }, [maxDepth, setSlice, slice]);

  useEffect(() => {
    if (mode === "slice") {
      setSliceRenderPending(true);
    }
  }, [mode, realSliceQuery.data, realVolume, slice, synthSliceQuery.data, synthVolume]);

  useEffect(() => {
    setDelayedRenderPending(false);
    if (!activeRenderPending) {
      return undefined;
    }
    const timeout = window.setTimeout(() => setDelayedRenderPending(true), RENDER_LOADING_DELAY_MS);
    return () => window.clearTimeout(timeout);
  }, [activeRenderPending, renderDelayKey]);

  useEffect(() => {
    setManualSliceOverride(false);
  }, [selectedJobId, activeFrameNumber]);

  useEffect(() => {
    if (mode !== "slice" || manualSliceOverride) {
      return;
    }
    const targetSlice = chooseInformativeSlice(frameCells, realVolume, synthVolume, maxDepth);
    if (targetSlice == null || targetSlice === slice) {
      return;
    }
    setSlice(targetSlice);
  }, [activeFrameNumber, frameCells, manualSliceOverride, maxDepth, mode, realVolume, selectedJobId, setSlice, slice, synthVolume]);

  const refreshAll = () => {
    void queryClient.invalidateQueries();
  };
  const viewerMetadataLoading = manifestQuery.isFetching || configQuery.isLoading;
  const activeSliceWaiting = Boolean(
    activeFrame &&
    (
      (realEnabled && Boolean(realSliceUrl) && !realSliceQuery.data) ||
      (synthEnabled && Boolean(synthSliceUrl) && !synthSliceQuery.data)
    ),
  );
  const activeVolumeWaiting = Boolean(
    activeFrame && !realVolume && !synthVolume && !realPointCloudQuery.data && !synthPointCloudQuery.data,
  );
  const nonRenderLoadingOverlayVisible = viewerMetadataLoading || (
    mode === "slice"
      ? activeSliceWaiting || slicePreviewLoading
      : preload.isLoading || pointCloudLoading || activeVolumeWaiting
  );
  const renderLoadingOverlayVisible = activeRenderPending && delayedRenderPending;
  const viewerLoadingOverlayVisible = nonRenderLoadingOverlayVisible || renderLoadingOverlayVisible;
  const workspaceStyle = {
    "--left-panel-width": `${panelLayout.left}px`,
    "--right-panel-width": `${panelLayout.right}px`,
  } as CSSProperties;
  const leftPanelVisible = panelVisibility.status || panelVisibility.layers || panelVisibility.update;
  const rightPanelVisible = panelVisibility.logs;
  const workspaceClassName = [
    "workspace",
    leftPanelVisible ? "" : "hide-left",
    rightPanelVisible ? "" : "hide-right",
  ].filter(Boolean).join(" ");
  const setPanelVisible = useCallback((panel: PanelVisibilityKey, visible: boolean) => {
    setPanelVisibility((current) => ({
      ...current,
      [panel]: visible,
    }));
  }, []);
  const hidePanel = useCallback((panel: PanelVisibilityKey) => setPanelVisible(panel, false), [setPanelVisible]);
  const showPanel = useCallback((panel: PanelVisibilityKey) => setPanelVisible(panel, true), [setPanelVisible]);
  const showPanels = useCallback((panels: readonly PanelVisibilityKey[]) => {
    setPanelVisibility((current) => {
      const next = { ...current };
      panels.forEach((panel) => {
        next[panel] = true;
      });
      return next;
    });
  }, []);
  const hidePanels = useCallback((panels: readonly PanelVisibilityKey[]) => {
    setPanelVisibility((current) => {
      const next = { ...current };
      panels.forEach((panel) => {
        next[panel] = false;
      });
      return next;
    });
  }, []);
  const showLeftPanels = useCallback(() => showPanels(LEFT_PANEL_KEYS), [showPanels]);
  const showRightPanels = useCallback(() => showPanels(RIGHT_PANEL_KEYS), [showPanels]);
  const hideLeftPanels = useCallback(() => hidePanels(LEFT_PANEL_KEYS), [hidePanels]);
  const resizePanel = useCallback((panel: "left" | "right", nextWidth: number) => {
    const workspaceWidth = workspaceRef.current?.getBoundingClientRect().width ?? window.innerWidth;
    const maxByViewport = Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, workspaceWidth * 0.42));
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
    window.localStorage.setItem(PANEL_LAYOUT_STORAGE_KEY, JSON.stringify(panelLayout));
  }, [panelLayout]);

  useEffect(() => {
    window.localStorage.setItem(PANEL_VISIBILITY_STORAGE_KEY, JSON.stringify(panelVisibility));
  }, [panelVisibility]);

  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) {
      return undefined;
    }
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? workspace.clientWidth;
      const maxByViewport = Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, width * 0.42));
      setPanelLayout((current) => {
        const left = Math.round(clampNumber(current.left, MIN_PANEL_WIDTH, maxByViewport));
        const right = Math.round(clampNumber(current.right, MIN_PANEL_WIDTH, maxByViewport));
        return left === current.left && right === current.right ? current : { left, right };
      });
    });
    observer.observe(workspace);
    return () => observer.disconnect();
  }, []);

  return (
    <main className="app-shell">
      <TopBar
        jobs={sortedJobs}
        selectedJobId={selectedJobId}
        onSelect={setSelectedJobId}
        onRefresh={refreshAll}
      />

      <section className={workspaceClassName} ref={workspaceRef} style={workspaceStyle}>
        <PanelRestoreRail
          leftHidden={!leftPanelVisible}
          rightHidden={!rightPanelVisible}
          onShowLeft={showLeftPanels}
          onShowRight={showRightPanels}
        />
        {leftPanelVisible ? (
          <>
            <aside className="side-panel left-panel">
              <SidePanelCollapseButton onClick={hideLeftPanels} />
              {panelVisibility.status ? (
                <StatusPanel job={jobQuery.data} loading={jobQuery.isLoading} onHide={() => hidePanel("status")} />
              ) : (
                <CollapsedPanel panel="status" title="Status" onShow={() => showPanel("status")} />
              )}
              {panelVisibility.layers ? (
                <LayerPanel
                  realEnabled={realEnabled}
                  synthEnabled={synthEnabled}
                  cellsEnabled={cellsEnabled}
                  setLayer={setLayer}
                  realMap={realMap}
                  synthMap={synthMap}
                  setRealMap={setRealMap}
                  setSynthMap={setSynthMap}
                  realOpacity={realOpacity}
                  setRealOpacity={setRealOpacity}
                  synthOpacity={synthOpacity}
                  setSynthOpacity={setSynthOpacity}
                  onHide={() => hidePanel("layers")}
                />
              ) : (
                <CollapsedPanel panel="layers" title="Layers" onShow={() => showPanel("layers")} />
              )}
              {panelVisibility.update ? (
                <SchedulePanel
                  enabled={autoRefreshEnabled}
                  seconds={autoRefreshSeconds}
                  unit={autoRefreshUnit}
                  setEnabled={setAutoRefreshEnabled}
                  setSeconds={setAutoRefreshSeconds}
                  setUnit={setAutoRefreshUnit}
                  onRefresh={refreshAll}
                  onHide={() => hidePanel("update")}
                />
              ) : (
                <CollapsedPanel panel="update" title="Update" onShow={() => showPanel("update")} />
              )}
            </aside>
            <PanelResizer
              side="left"
              onPointerDown={(event) => beginPanelResize("left", event)}
              onKeyboardResize={(delta) => resizePanel("left", panelLayout.left + delta)}
            />
          </>
        ) : null}

        <section className="viewer-column">
          <ViewerToolbar
            mode={mode}
            setMode={setMode}
            frame={activeFrame?.t ?? frame}
            frames={availableFrameNumbers}
            setFrame={setFrame}
            slice={slice}
            maxDepth={maxDepth}
            setSlice={(nextSlice) => {
              setManualSliceOverride(true);
              setSlice(nextSlice);
            }}
            realVolume={realVolume}
            synthVolume={synthVolume}
            realSlice={realSliceQuery.data}
            synthSlice={synthSliceQuery.data}
            realPointCloud={realPointCloudQuery.data}
            synthPointCloud={synthPointCloudQuery.data}
            manifest={manifestQuery.data}
            frameControlsDisabled={pointCloudLoading}
          />
          <PreloadProgress preload={preload} />
          <div className="viewer-shell">
            {mode === "slice" ? (
              <CanvasSliceViewer
                real={realVolume}
                synth={synthVolume}
                realSlice={realSliceQuery.data}
                synthSlice={synthSliceQuery.data}
                cells={frameCells}
                slice={slice}
                realEnabled={realEnabled}
                synthEnabled={synthEnabled}
                cellsEnabled={cellsEnabled}
                realMap={realMap}
                synthMap={synthMap}
                realOpacity={realOpacity}
                synthOpacity={synthOpacity}
                onRenderStart={handleSliceRenderStart}
                onRenderComplete={handleSliceRenderComplete}
              />
            ) : (
              <ThreeVolumeViewer
                real={realVolume}
                synth={synthVolume}
                realPointCloud={realPointCloudQuery.data}
                synthPointCloud={synthPointCloudQuery.data}
                cells={frameCells}
                realEnabled={realEnabled}
                synthEnabled={synthEnabled}
                cellsEnabled={cellsEnabled}
                realMap={realMap}
                synthMap={synthMap}
                realOpacity={realOpacity}
                synthOpacity={synthOpacity}
                maxPixelRatio={configQuery.data?.rendering.maxPixelRatio ?? 1}
                pointCloudConfig={configQuery.data?.pointCloud}
                onFirstRender={handleVolumeFirstRender}
              />
            )}
            <LoadBadge
              manifestLoading={viewerMetadataLoading}
              preload={preload}
              pointCloudLoading={mode === "slice" ? slicePreviewLoading : pointCloudLoading}
              previewLoadingLabel={mode === "slice" ? "Loading 2D slice" : "Loading point cloud"}
              activeFrameWaiting={mode === "slice" ? activeSliceWaiting : activeVolumeWaiting}
              error={
                manifestQuery.error ??
                configQuery.error ??
                realSliceQuery.error ??
                synthSliceQuery.error ??
                realPointCloudQuery.error ??
                synthPointCloudQuery.error ??
                firstPreloadError(preload.errors)
              }
            />
            {viewerLoadingOverlayVisible ? (
              <ViewerLoadingOverlay
                preload={preload}
                metadataLoading={viewerMetadataLoading}
                pointCloudLoading={mode === "slice" ? slicePreviewLoading : pointCloudLoading}
                previewLoadingLabel={mode === "slice" ? "loading 2D slice" : "loading point cloud preview"}
                previewLoadingDetail={mode === "slice" ? "fetching backend slice preview" : "downloading compact backend preview"}
                activeFrameWaiting={mode === "slice" ? activeSliceWaiting : activeVolumeWaiting}
                renderPending={renderLoadingOverlayVisible}
                renderLabel={mode === "slice" ? "rendering 2D slice" : "rendering 3D view"}
                renderDetail={mode === "slice" ? "drawing selected z slice" : "building point cloud"}
              />
            ) : null}
            <FrameUpdateToast
              notice={frameNotice}
              onView={() => {
                if (!frameNotice) {
                  return;
                }
                setFrame(frameNotice.latestFrame);
                setFrameNotice(null);
              }}
              onDismiss={() => setFrameNotice(null)}
            />
          </div>
        </section>

        {rightPanelVisible ? (
          <>
            <PanelResizer
              side="right"
              onPointerDown={(event) => beginPanelResize("right", event)}
              onKeyboardResize={(delta) => resizePanel("right", panelLayout.right - delta)}
            />
            <aside className="side-panel right-panel">
              {panelVisibility.logs ? (
                <LogPanel
                  stream={logStream}
                  setStream={setLogStream}
                  lines={logsQuery.data?.lines ?? []}
                  loading={logsQuery.isFetching}
                  onHide={() => hidePanel("logs")}
                />
              ) : (
                <CollapsedPanel panel="logs" title="Runtime Log" onShow={() => showPanel("logs")} />
              )}
            </aside>
          </>
        ) : null}
      </section>
    </main>
  );
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

function getSlicePreviewUrl(
  jobId: string,
  frame: number | undefined,
  layer: "real" | "synth",
  slice: number,
  previewConfig: PreviewConfig | undefined,
  sourceUrl: string | undefined,
): string | undefined {
  if (!jobId || frame == null || !previewConfig || !sourceUrl) {
    return undefined;
  }
  const requestedSlice = Math.max(0, Math.round(slice));
  return `/api/jobs/${encodeURIComponent(jobId)}/slices/${layer}/${frame}/${requestedSlice}.cusl?max_xy=${previewConfig.maxXY}`;
}

function chooseInformativeSlice(
  cells: CellRecord[],
  realVolume: VolumeData | undefined,
  synthVolume: VolumeData | undefined,
  maxDepth: number,
): number | null {
  const cellSlice = chooseCellSlice(cells, maxDepth);
  if (cellSlice != null) {
    return cellSlice;
  }
  return chooseBrightestLoadedSlice(realVolume ?? synthVolume, maxDepth);
}

function chooseCellSlice(cells: CellRecord[], maxDepth: number): number | null {
  const candidates = cells
    .filter((cell) => !cell.isTrash)
    .map((cell) => Number(cell.z))
    .filter((value) => Number.isFinite(value));
  const zValues = candidates.length
    ? candidates
    : cells.map((cell) => Number(cell.z)).filter((value) => Number.isFinite(value));
  if (!zValues.length) {
    return null;
  }
  zValues.sort((a, b) => a - b);
  return clampSlice(Math.round(zValues[Math.floor(zValues.length / 2)]), maxDepth);
}

function chooseBrightestLoadedSlice(volume: VolumeData | undefined, maxDepth: number): number | null {
  if (!volume?.slices.length) {
    return null;
  }
  let bestIndex = 0;
  let bestScore = -1;
  for (let sliceIndex = 0; sliceIndex < volume.slices.length; sliceIndex += 1) {
    const slice = volume.slices[sliceIndex];
    let score = 0;
    for (let i = 0; i < slice.length; i += 64) {
      score += slice[i];
    }
    if (score > bestScore) {
      bestScore = score;
      bestIndex = sliceIndex;
    }
  }
  return clampSlice(volume.sliceIndices[bestIndex] ?? bestIndex, maxDepth);
}

function clampSlice(slice: number, maxDepth: number): number {
  if (maxDepth <= 1) {
    return Math.max(0, slice);
  }
  return Math.max(0, Math.min(Math.max(0, maxDepth - 1), slice));
}

function readPanelLayout(): { left: number; right: number } {
  if (typeof window === "undefined") {
    return DEFAULT_PANEL_LAYOUT;
  }
  try {
    const raw = window.localStorage.getItem(PANEL_LAYOUT_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_PANEL_LAYOUT;
    }
    const parsed = JSON.parse(raw) as Partial<{ left: number; right: number }>;
    return {
      left: clampNumber(Number(parsed.left), MIN_PANEL_WIDTH, MAX_PANEL_WIDTH),
      right: clampNumber(Number(parsed.right), MIN_PANEL_WIDTH, MAX_PANEL_WIDTH),
    };
  } catch {
    return DEFAULT_PANEL_LAYOUT;
  }
}

function readPanelVisibility(): PanelVisibility {
  if (typeof window === "undefined") {
    return DEFAULT_PANEL_VISIBILITY;
  }
  try {
    const raw = window.localStorage.getItem(PANEL_VISIBILITY_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_PANEL_VISIBILITY;
    }
    const parsed = JSON.parse(raw) as Partial<PanelVisibility>;
    return {
      status: typeof parsed.status === "boolean" ? parsed.status : DEFAULT_PANEL_VISIBILITY.status,
      layers: typeof parsed.layers === "boolean" ? parsed.layers : DEFAULT_PANEL_VISIBILITY.layers,
      update: typeof parsed.update === "boolean" ? parsed.update : DEFAULT_PANEL_VISIBILITY.update,
      logs: typeof parsed.logs === "boolean" ? parsed.logs : DEFAULT_PANEL_VISIBILITY.logs,
    };
  } catch {
    return DEFAULT_PANEL_VISIBILITY;
  }
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
}

function buildPreloadTargets(
  frames: JobManifest["frames"],
  activeFrame: number | undefined,
  previewConfig: PreviewConfig,
  previewSignature: string,
): VolumePreloadTarget[] {
  const targets: VolumePreloadTarget[] = [];
  const activeFirst = [...frames].sort((a, b) => {
    if (a.t === activeFrame) {
      return -1;
    }
    if (b.t === activeFrame) {
      return 1;
    }
    return b.t - a.t;
  });
  for (const frame of activeFirst) {
    addPreloadTarget(targets, frame.t, "real", frame.layers.realTiff, previewConfig, previewSignature);
    addPreloadTarget(targets, frame.t, "synth", frame.layers.synthTiff, previewConfig, previewSignature);
  }
  return targets;
}

function addPreloadTarget(
  targets: VolumePreloadTarget[],
  frame: number,
  layerName: "real" | "synth",
  layer?: LayerEntry,
  previewConfig?: PreviewConfig,
  previewSignature?: string,
) {
  if (!layer || layer.format !== "tiff" || !previewConfig || !previewSignature) {
    return;
  }
  targets.push({
    key: getPreloadKey(layer.url, previewSignature),
    url: toApiUrl(layer.url),
    label: `t${frame} ${layerName}`,
    options: {
      maxXY: previewConfig.maxXY,
      maxSlices: previewConfig.maxSlices,
    },
  });
}

function getPreloadKey(url: string, previewSignature: string): string {
  return `${url}\u0000${previewSignature}`;
}

function firstPreloadError(errors: Record<string, string>): Error | null {
  const first = Object.values(errors)[0];
  return first ? new Error(first) : null;
}

function sortJobs(jobs: JobStatus[]): JobStatus[] {
  return [...jobs].sort((a, b) => {
    const activeDelta = activeRank(a) - activeRank(b);
    if (activeDelta !== 0) {
      return activeDelta;
    }
    return timestampOf(b) - timestampOf(a);
  });
}

function activeRank(job: JobStatus): number {
  if (job.state === "running") {
    return 0;
  }
  if (job.state === "queued") {
    return 1;
  }
  return 2;
}

function timestampOf(job: JobStatus): number {
  return Date.parse(job.startedAt ?? job.createdAt ?? job.finishedAt ?? "") || 0;
}

export default App;
