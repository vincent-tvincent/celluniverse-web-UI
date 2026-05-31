import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Box,
  Braces,
  ChevronLeft,
  ChevronRight,
  CircleOff,
  Eye,
  EyeOff,
  Layers3,
  ListRestart,
  PauseCircle,
  PlayCircle,
  RefreshCcw,
  ScanLine,
  TerminalSquare,
} from "lucide-react";
import { getFrameCells, getJob, getLogs, getManifest, listJobs, toApiUrl } from "./api";
import { previewConfigSignature, useViewerConfig, type PreviewConfig } from "./config";
import { useJobEvents } from "./hooks";
import { useViewerStore } from "./store";
import type { CellRecord, JobManifest, JobStatus, LayerEntry } from "./types";
import { colorMaps, type ColorMapId } from "./viewer/colorMaps";
import CanvasSliceViewer from "./viewer/CanvasSliceViewer";
import ThreeVolumeViewer from "./viewer/ThreeVolumeViewer";
import { loadPointCloudPreview, type PointCloudPreviewData } from "./viewer/pointCloud";
import { loadSlicePreview, type SlicePreviewData } from "./viewer/slicePreview";
import type { VolumeData } from "./viewer/tiff";
import { useVolumePreload, type VolumePreloadState, type VolumePreloadTarget } from "./viewer/useVolumePreload";

type FrameUpdateNotice = {
  frames: number[];
  latestFrame: number;
  createdAt: number;
};

const EMPTY_CELLS: CellRecord[] = [];

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
    synthOpacity,
    setSynthOpacity,
    logStream,
    setLogStream,
    autoRefreshEnabled,
    autoRefreshSeconds,
    setAutoRefreshEnabled,
    setAutoRefreshSeconds,
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
  const frameHistoryRef = useRef<{ jobId: string; frames: Set<number> } | null>(null);

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
  const viewerLoadingOverlayVisible = viewerMetadataLoading || (
    mode === "slice"
      ? activeSliceWaiting || slicePreviewLoading || sliceRenderPending
      : preload.isLoading || pointCloudLoading || volumeRenderPending || activeVolumeWaiting
  );

  return (
    <main className="app-shell">
      <TopBar
        jobs={sortedJobs}
        selectedJobId={selectedJobId}
        onSelect={setSelectedJobId}
        onRefresh={refreshAll}
      />

      <section className="workspace">
        <aside className="side-panel left-panel">
          <StatusPanel job={jobQuery.data} loading={jobQuery.isLoading} />
          <LayerPanel
            realEnabled={realEnabled}
            synthEnabled={synthEnabled}
            cellsEnabled={cellsEnabled}
            setLayer={setLayer}
            realMap={realMap}
            synthMap={synthMap}
            setRealMap={setRealMap}
            setSynthMap={setSynthMap}
            synthOpacity={synthOpacity}
            setSynthOpacity={setSynthOpacity}
          />
          <SchedulePanel
            enabled={autoRefreshEnabled}
            seconds={autoRefreshSeconds}
            setEnabled={setAutoRefreshEnabled}
            setSeconds={setAutoRefreshSeconds}
            onRefresh={refreshAll}
          />
        </aside>

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
                renderPending={mode === "slice" ? sliceRenderPending : volumeRenderPending}
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

        <aside className="side-panel right-panel">
          <LogPanel
            stream={logStream}
            setStream={setLogStream}
            lines={logsQuery.data?.lines ?? []}
            loading={logsQuery.isFetching}
          />
        </aside>
      </section>
    </main>
  );
}

type TopBarProps = {
  jobs: JobStatus[];
  selectedJobId: string;
  onSelect: (jobId: string) => void;
  onRefresh: () => void;
};

function TopBar({ jobs, selectedJobId, onSelect, onRefresh }: TopBarProps) {
  return (
    <header className="top-bar">
      <div className="brand-block">
        <div className="brand-mark">
          <Layers3 size={20} />
        </div>
        <div>
          <h1>CellUniverse Live Viewer</h1>
          <p>3D TIFF preview with synthetic overlay and cell geometry</p>
        </div>
      </div>
      <div className="job-select-row">
        <label htmlFor="job-select">Job</label>
        <select id="job-select" value={selectedJobId} onChange={(event) => onSelect(event.target.value)}>
          <option value="">Select job</option>
          {jobs.map((job) => (
            <option key={job.id} value={job.id}>
              {job.id} {job.state ? `(${job.state})` : ""}
            </option>
          ))}
        </select>
        <input
          value={selectedJobId}
          onChange={(event) => onSelect(event.target.value.trim())}
          placeholder="job_..."
          aria-label="Job id"
        />
        <button className="icon-button" type="button" onClick={onRefresh} title="Refresh">
          <RefreshCcw size={17} />
        </button>
      </div>
    </header>
  );
}

function StatusPanel({ job, loading }: { job?: JobStatus; loading: boolean }) {
  const progress = Math.round((job?.progress ?? 0) * 100);
  const stateIcon = job?.state === "running" ? <PlayCircle size={17} /> : job?.state === "cancelled" ? <PauseCircle size={17} /> : <Activity size={17} />;
  return (
    <section className="tool-panel">
      <div className="panel-heading">
        <span>Status</span>
        {stateIcon}
      </div>
      {loading && !job ? (
        <p className="muted">Loading job status</p>
      ) : job ? (
        <>
          <div className="status-line">
            <span className={`state-dot ${job.state}`} />
            <strong>{job.state}</strong>
            <span>{job.completedFrames}/{job.totalFrames} frames</span>
          </div>
          <div className="progress-track">
            <div style={{ width: `${progress}%` }} />
          </div>
          <dl className="metric-grid">
            <div>
              <dt>Current</dt>
              <dd>{job.currentFrame ?? "-"}</dd>
            </div>
            <div>
              <dt>Last Done</dt>
              <dd>{job.lastCompletedFrame ?? "-"}</dd>
            </div>
            <div>
              <dt>Range</dt>
              <dd>{job.firstFrame}-{job.lastFrame}</dd>
            </div>
            <div>
              <dt>TIFF</dt>
              <dd>{job.outputReady.tiffFrames.length}</dd>
            </div>
          </dl>
          {job.error ? <p className="error-text">{job.error}</p> : null}
        </>
      ) : (
        <p className="muted">No job selected</p>
      )}
    </section>
  );
}

type LayerPanelProps = {
  realEnabled: boolean;
  synthEnabled: boolean;
  cellsEnabled: boolean;
  setLayer: (layer: "realEnabled" | "synthEnabled" | "cellsEnabled", value: boolean) => void;
  realMap: ColorMapId;
  synthMap: ColorMapId;
  setRealMap: (map: ColorMapId) => void;
  setSynthMap: (map: ColorMapId) => void;
  synthOpacity: number;
  setSynthOpacity: (opacity: number) => void;
};

function LayerPanel({
  realEnabled,
  synthEnabled,
  cellsEnabled,
  setLayer,
  realMap,
  synthMap,
  setRealMap,
  setSynthMap,
  synthOpacity,
  setSynthOpacity,
}: LayerPanelProps) {
  return (
    <section className="tool-panel">
      <div className="panel-heading">
        <span>Layers</span>
        <Eye size={17} />
      </div>
      <ToggleRow
        label="Real"
        enabled={realEnabled}
        onToggle={(value) => setLayer("realEnabled", value)}
        colorMap={realMap}
        onMapChange={setRealMap}
      />
      <ToggleRow
        label="Synthetic"
        enabled={synthEnabled}
        onToggle={(value) => setLayer("synthEnabled", value)}
        colorMap={synthMap}
        onMapChange={setSynthMap}
      />
      <label className="slider-row">
        <span>Synth opacity</span>
        <output>{Math.round(synthOpacity * 100)}%</output>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={synthOpacity}
          onChange={(event) => setSynthOpacity(Number(event.target.value))}
        />
      </label>
      <button
        type="button"
        className={`toggle-button ${cellsEnabled ? "active" : ""}`}
        onClick={() => setLayer("cellsEnabled", !cellsEnabled)}
      >
        {cellsEnabled ? <Eye size={16} /> : <EyeOff size={16} />}
        Cell ellipsoids
      </button>
    </section>
  );
}

function SchedulePanel({
  enabled,
  seconds,
  setEnabled,
  setSeconds,
  onRefresh,
}: {
  enabled: boolean;
  seconds: number;
  setEnabled: (enabled: boolean) => void;
  setSeconds: (seconds: number) => void;
  onRefresh: () => void;
}) {
  return (
    <section className="tool-panel">
      <div className="panel-heading">
        <span>Update</span>
        <ListRestart size={17} />
      </div>
      <button
        type="button"
        className={`toggle-button ${enabled ? "active" : ""}`}
        onClick={() => setEnabled(!enabled)}
      >
        {enabled ? <PlayCircle size={16} /> : <PauseCircle size={16} />}
        Auto refresh
      </button>
      <label className="number-row">
        <span>Period</span>
        <input
          type="number"
          min={2}
          max={300}
          step={1}
          value={seconds}
          onChange={(event) => setSeconds(Number(event.target.value))}
        />
        <span>sec</span>
      </label>
      <button type="button" className="toggle-button" onClick={onRefresh}>
        <RefreshCcw size={16} />
        Refresh now
      </button>
    </section>
  );
}

function ToggleRow({
  label,
  enabled,
  onToggle,
  colorMap,
  onMapChange,
}: {
  label: string;
  enabled: boolean;
  onToggle: (value: boolean) => void;
  colorMap: ColorMapId;
  onMapChange: (map: ColorMapId) => void;
}) {
  return (
    <div className="layer-row">
      <button type="button" className={`toggle-button ${enabled ? "active" : ""}`} onClick={() => onToggle(!enabled)}>
        {enabled ? <Eye size={16} /> : <EyeOff size={16} />}
        {label}
      </button>
      <select value={colorMap} onChange={(event) => onMapChange(event.target.value as ColorMapId)}>
        {colorMaps.map((map) => (
          <option key={map.id} value={map.id}>
            {map.label}
          </option>
        ))}
      </select>
    </div>
  );
}

type ViewerToolbarProps = {
  mode: "slice" | "volume";
  setMode: (mode: "slice" | "volume") => void;
  frame: number;
  frames: number[];
  setFrame: (frame: number) => void;
  slice: number;
  maxDepth: number;
  setSlice: (slice: number) => void;
  realVolume?: VolumeData;
  synthVolume?: VolumeData;
  realSlice?: SlicePreviewData;
  synthSlice?: SlicePreviewData;
  realPointCloud?: PointCloudPreviewData;
  synthPointCloud?: PointCloudPreviewData;
  manifest?: JobManifest;
  frameControlsDisabled: boolean;
};

function ViewerToolbar({
  mode,
  setMode,
  frame,
  frames,
  setFrame,
  slice,
  maxDepth,
  setSlice,
  realVolume,
  synthVolume,
  realSlice,
  synthSlice,
  realPointCloud,
  synthPointCloud,
  manifest,
  frameControlsDisabled,
}: ViewerToolbarProps) {
  const frameIndex = Math.max(0, frames.indexOf(frame));
  const maxFrameIndex = Math.max(0, frames.length - 1);
  const previewWidth = realSlice?.width ?? synthSlice?.width ?? realVolume?.width ?? synthVolume?.width ?? realPointCloud?.sourceWidth ?? synthPointCloud?.sourceWidth ?? 0;
  const previewHeight = realSlice?.height ?? synthSlice?.height ?? realVolume?.height ?? synthVolume?.height ?? realPointCloud?.sourceHeight ?? synthPointCloud?.sourceHeight ?? 0;
  const [draftFrameIndex, setDraftFrameIndex] = useState(frameIndex);
  const [draftSlice, setDraftSlice] = useState(slice);
  const sliceInputRef = useRef<HTMLInputElement | null>(null);
  const sliceCommitTimerRef = useRef(0);
  const pendingSliceRef = useRef(slice);
  const draftFrame = frames[draftFrameIndex] ?? frame;

  useEffect(() => {
    setDraftFrameIndex(frameIndex);
  }, [frameIndex]);

  useEffect(() => {
    setDraftSlice(slice);
    pendingSliceRef.current = slice;
    if (sliceInputRef.current) {
      sliceInputRef.current.value = String(slice);
    }
  }, [slice]);

  useEffect(() => () => window.clearTimeout(sliceCommitTimerRef.current), []);

  useEffect(() => {
    if (draftFrameIndex > maxFrameIndex) {
      setDraftFrameIndex(maxFrameIndex);
    }
  }, [draftFrameIndex, maxFrameIndex]);

  useEffect(() => {
    const maxSlice = Math.max(0, maxDepth - 1);
    if (draftSlice > maxSlice) {
      setDraftSlice(maxSlice);
    }
  }, [draftSlice, maxDepth]);

  const setFrameFromIndex = (index: number) => {
    const nextFrame = frames[Math.max(0, Math.min(frames.length - 1, Math.round(index)))];
    if (nextFrame != null) {
      setFrame(nextFrame);
    }
  };
  const stepFrame = (delta: number) => {
    const nextIndex = Math.max(0, Math.min(maxFrameIndex, draftFrameIndex + delta));
    setDraftFrameIndex(nextIndex);
    setFrameFromIndex(nextIndex);
  };
  const stepSlice = (delta: number) => {
    const maxSlice = Math.max(0, maxDepth - 1);
    const currentSlice = Number(sliceInputRef.current?.value ?? draftSlice);
    const nextSlice = Math.max(0, Math.min(maxSlice, currentSlice + delta));
    if (sliceInputRef.current) {
      sliceInputRef.current.value = String(nextSlice);
    }
    setDraftSlice(nextSlice);
    setSlice(nextSlice);
  };
  const commitDraftFrame = () => setFrameFromIndex(draftFrameIndex);
  const commitDraftSlice = () => {
    window.clearTimeout(sliceCommitTimerRef.current);
    const currentSlice = Number(sliceInputRef.current?.value ?? draftSlice);
    const nextSlice = Math.max(0, Math.min(Math.max(0, maxDepth - 1), Math.round(currentSlice)));
    pendingSliceRef.current = nextSlice;
    if (sliceInputRef.current) {
      sliceInputRef.current.value = String(nextSlice);
    }
    setDraftSlice(nextSlice);
    setSlice(nextSlice);
  };
  const scheduleSlice = (nextSlice: number) => {
    pendingSliceRef.current = nextSlice;
    window.clearTimeout(sliceCommitTimerRef.current);
    sliceCommitTimerRef.current = window.setTimeout(() => {
      setDraftSlice(pendingSliceRef.current);
      setSlice(pendingSliceRef.current);
    }, 80);
  };

  return (
    <div className={`viewer-toolbar ${mode === "volume" ? "volume-mode" : ""}`}>
      <div className="segmented">
        <button type="button" className={mode === "slice" ? "active" : ""} onClick={() => setMode("slice")}>
          <ScanLine size={16} />
          2D
        </button>
        <button type="button" className={mode === "volume" ? "active" : ""} onClick={() => setMode("volume")}>
          <Box size={16} />
          3D
        </button>
      </div>
      <fieldset className="range-control slider-field">
        <legend>Time frame</legend>
        <span>Frame {draftFrame}</span>
        <button
          className="range-step-button"
          type="button"
          onClick={() => stepFrame(-1)}
          disabled={frames.length <= 1 || frameControlsDisabled || draftFrameIndex <= 0}
          title="Previous frame"
          aria-label="Previous frame"
        >
          <ChevronLeft size={16} />
        </button>
        <input
          aria-label="Frame"
          type="range"
          min={0}
          max={maxFrameIndex}
          step={1}
          value={draftFrameIndex}
          disabled={frames.length <= 1 || frameControlsDisabled}
          onInput={(event) => setDraftFrameIndex(Number(event.currentTarget.value))}
          onPointerUp={commitDraftFrame}
          onKeyUp={commitDraftFrame}
          onBlur={commitDraftFrame}
        />
        <button
          className="range-step-button"
          type="button"
          onClick={() => stepFrame(1)}
          disabled={frames.length <= 1 || frameControlsDisabled || draftFrameIndex >= maxFrameIndex}
          title="Next frame"
          aria-label="Next frame"
        >
          <ChevronRight size={16} />
        </button>
      </fieldset>
      {mode === "slice" ? (
        <fieldset className="range-control slider-field">
          <legend>Z slice</legend>
          <span>Slice {draftSlice}/{Math.max(0, maxDepth - 1)}</span>
          <button
            className="range-step-button"
            type="button"
            onClick={() => stepSlice(-1)}
            disabled={maxDepth <= 1 || draftSlice <= 0}
            title="Previous slice"
            aria-label="Previous slice"
          >
            <ChevronLeft size={16} />
          </button>
          <input
            ref={sliceInputRef}
            aria-label="Slice"
            type="range"
            min={0}
            max={Math.max(0, maxDepth - 1)}
            step={1}
            defaultValue={draftSlice}
            onInput={(event) => {
              const nextSlice = Number(event.currentTarget.value);
              scheduleSlice(nextSlice);
            }}
            onPointerUp={commitDraftSlice}
            onKeyUp={commitDraftSlice}
            onBlur={commitDraftSlice}
          />
          <button
            className="range-step-button"
            type="button"
            onClick={() => stepSlice(1)}
            disabled={maxDepth <= 1 || draftSlice >= Math.max(0, maxDepth - 1)}
            title="Next slice"
            aria-label="Next slice"
          >
            <ChevronRight size={16} />
          </button>
        </fieldset>
      ) : null}
      <div className="volume-meta">
        <Braces size={15} />
        <span>{manifest?.frames.length ?? 0} t</span>
        <span>{realSlice?.depth ?? synthSlice?.depth ?? realVolume?.depth ?? synthVolume?.depth ?? 0} z</span>
        <span>{previewWidth && previewHeight ? `${previewWidth}x${previewHeight}` : "0 xy"}</span>
      </div>
    </div>
  );
}

function PreloadProgress({ preload }: { preload: VolumePreloadState }) {
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

function formatPreloadLabel(label: string): string {
  const match = /^t(\d+)\s+(.+)$/.exec(label);
  if (!match) {
    return label;
  }
  return `frame t${match[1]} ${match[2]}`;
}

function FrameUpdateToast({
  notice,
  onView,
  onDismiss,
}: {
  notice: FrameUpdateNotice | null;
  onView: () => void;
  onDismiss: () => void;
}) {
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
        x
      </button>
    </div>
  );
}

function LogPanel({
  stream,
  setStream,
  lines,
  loading,
}: {
  stream: "stdout" | "stderr";
  setStream: (stream: "stdout" | "stderr") => void;
  lines: string[];
  loading: boolean;
}) {
  return (
    <section className="tool-panel log-panel">
      <div className="panel-heading">
        <span>Runtime Log</span>
        <TerminalSquare size={17} />
      </div>
      <div className="segmented wide">
        <button type="button" className={stream === "stdout" ? "active" : ""} onClick={() => setStream("stdout")}>
          stdout
        </button>
        <button type="button" className={stream === "stderr" ? "active" : ""} onClick={() => setStream("stderr")}>
          stderr
        </button>
      </div>
      <pre className="log-box" aria-live="polite">
        {lines.length ? lines.join("\n") : loading ? "Loading log..." : "No log lines"}
      </pre>
    </section>
  );
}

function LoadBadge({
  manifestLoading,
  preload,
  pointCloudLoading,
  previewLoadingLabel,
  activeFrameWaiting,
  error,
}: {
  manifestLoading: boolean;
  preload: VolumePreloadState;
  pointCloudLoading: boolean;
  previewLoadingLabel: string;
  activeFrameWaiting: boolean;
  error: Error | null;
}) {
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
          : "Live";
  return (
    <div className={`load-badge ${error ? "error" : ""}`}>
      {error ? <CircleOff size={14} /> : <Activity size={14} />}
      <span>{text}</span>
    </div>
  );
}

function ViewerLoadingOverlay({
  preload,
  metadataLoading,
  pointCloudLoading,
  previewLoadingLabel,
  previewLoadingDetail,
  activeFrameWaiting,
  renderPending,
  renderLabel,
  renderDetail,
}: {
  preload: VolumePreloadState;
  metadataLoading: boolean;
  pointCloudLoading: boolean;
  previewLoadingLabel: string;
  previewLoadingDetail: string;
  activeFrameWaiting: boolean;
  renderPending: boolean;
  renderLabel: string;
  renderDetail: string;
}) {
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
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
