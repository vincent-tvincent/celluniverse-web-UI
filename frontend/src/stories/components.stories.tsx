import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Activity } from "lucide-react";
import FrameUpdateToast from "../components/layout/FrameUpdateToast";
import LoadBadge from "../components/layout/LoadBadge";
import PanelResizer from "../components/layout/PanelResizer";
import PanelRestoreRail from "../components/layout/PanelRestoreRail";
import PreloadProgress from "../components/layout/PreloadProgress";
import TopBar from "../components/layout/TopBar";
import ViewerLoadingOverlay from "../components/layout/ViewerLoadingOverlay";
import ViewerToolbar from "../components/layout/ViewerToolbar";
import CollapsedPanel from "../components/panels/CollapsedPanel";
import LayerPanel from "../components/panels/LayerPanel";
import LineagePanel from "../components/panels/LineagePanel";
import LogPanel from "../components/panels/LogPanel";
import PanelHeading from "../components/panels/PanelHeading";
import SchedulePanel from "../components/panels/SchedulePanel";
import SidePanelCollapseButton from "../components/panels/SidePanelCollapseButton";
import StatusPanel from "../components/panels/StatusPanel";
import ViewModePanel from "../components/panels/ViewModePanel";
import type { RefreshUnit, ViewMode } from "../store";
import type { JobStatus, LineageFrameSnapshot, LineageGraph, LineageLayout } from "../types";
import CanvasSliceViewer from "../viewer/CanvasSliceViewer";
import ThreeVolumeViewer from "../viewer/ThreeVolumeViewer";
import type { ColorMapId } from "../viewer/colorMaps";
import type { ContrastLimits } from "../viewer/contrast";
import type { VolumePreloadState } from "../viewer/useVolumePreload";

const meta = {
  title: "CellUniverse/Components",
  parameters: {
    docs: {
      description: {
        component: "Standalone previews for the main CellUniverse viewer components using local mock data.",
      },
    },
  },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

const mockJobs: JobStatus[] = [
  {
    id: "job_demo_running",
    label: "Demo running job",
    type: "tracking",
    state: "running",
    firstFrame: 0,
    lastFrame: 200,
    currentFrame: 18,
    lastCompletedFrame: 17,
    completedFrames: 18,
    totalFrames: 201,
    progress: 18 / 201,
    outputReady: {
      cellsCsv: true,
      checkpointFrames: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
      pngFrames: [],
      tiffFrames: [0, 1, 2, 3, 4, 5],
    },
    partialOutputsAvailable: true,
  },
  {
    id: "job_demo_cancelled",
    label: "Demo cancelled job",
    type: "tracking",
    state: "cancelled",
    firstFrame: 0,
    lastFrame: 200,
    currentFrame: 20,
    lastCompletedFrame: 19,
    completedFrames: 20,
    totalFrames: 201,
    progress: 20 / 201,
    outputReady: {
      cellsCsv: true,
      checkpointFrames: [0, 1, 2, 3],
      pngFrames: [],
      tiffFrames: [0, 1, 2, 3],
    },
    partialOutputsAvailable: true,
    error: "Cancelled by user",
  },
];

const mockLineageGraph: LineageGraph = {
  jobId: "job_demo_running",
  source: "cells.csv",
  frames: [0, 1, 2, 3, 4],
  firstFrame: 0,
  lastFrame: 4,
  roots: ["cell_0", "cell_1"],
  activeByFrame: {
    "0": ["cell_0", "cell_1"],
    "4": ["cell_00", "cell_01", "cell_1"],
  },
  nodes: [
    {
      id: "cell_0",
      name: "cell_0",
      parentId: null,
      rootId: "cell_0",
      code: "0",
      depth: 1,
      firstFrame: 0,
      lastFrame: 4,
      children: ["cell_00", "cell_01"],
      observedFrames: [0, 1, 2, 3],
      lastCell: { name: "cell_0", x: 180, y: 140, z: 25, aRadius: 9, bRadius: 8, cRadius: 7 },
    },
    {
      id: "cell_00",
      name: "cell_00",
      parentId: "cell_0",
      rootId: "cell_0",
      code: "00",
      depth: 2,
      firstFrame: 4,
      lastFrame: 4,
      children: [],
      observedFrames: [4],
      lastCell: { name: "cell_00", x: 165, y: 120, z: 27, aRadius: 7, bRadius: 7, cRadius: 6 },
    },
    {
      id: "cell_01",
      name: "cell_01",
      parentId: "cell_0",
      rootId: "cell_0",
      code: "01",
      depth: 2,
      firstFrame: 4,
      lastFrame: 4,
      children: [],
      observedFrames: [4],
      lastCell: { name: "cell_01", x: 205, y: 150, z: 28, aRadius: 7, bRadius: 6, cRadius: 6 },
    },
    {
      id: "cell_1",
      name: "cell_1",
      parentId: null,
      rootId: "cell_1",
      code: "1",
      depth: 1,
      firstFrame: 0,
      lastFrame: 4,
      children: [],
      observedFrames: [0, 1, 2, 3, 4],
      lastCell: { name: "cell_1", x: 260, y: 220, z: 31, aRadius: 10, bRadius: 8, cRadius: 7 },
    },
  ],
  edges: [
    { id: "cell_0->cell_00", source: "cell_0", target: "cell_00", type: "division", frame: 4 },
    { id: "cell_0->cell_01", source: "cell_0", target: "cell_01", type: "division", frame: 4 },
  ],
};

const mockLineageLayout: LineageLayout = {
  jobId: "job_demo_running",
  mode: "radial-time-v1",
  background: "#070a0f",
  center: { x: 0, y: 0 },
  innerRadius: 42,
  ringSpacing: 28,
  firstFrame: 0,
  lastFrame: 4,
  rings: [
    { frame: 0, radius: 42 },
    { frame: 1, radius: 70 },
    { frame: 2, radius: 98 },
    { frame: 3, radius: 126 },
    { frame: 4, radius: 154 },
  ],
  nodes: {
    cell_0: {
      id: "cell_0",
      label: "cell_0",
      compactLabel: "cell_0",
      angle: -2.4,
      radius: 42,
      radiusFrame: 0,
      x: -31,
      y: -28,
      color: "#4e79a7",
      rootId: "cell_0",
      depth: 1,
    },
    cell_00: {
      id: "cell_00",
      label: "cell_00",
      compactLabel: "cell_00",
      angle: -2.7,
      radius: 154,
      radiusFrame: 4,
      x: -139,
      y: -66,
      color: "#4e79a7",
      rootId: "cell_0",
      depth: 2,
    },
    cell_01: {
      id: "cell_01",
      label: "cell_01",
      compactLabel: "cell_01",
      angle: -2.1,
      radius: 154,
      radiusFrame: 4,
      x: -78,
      y: -133,
      color: "#4e79a7",
      rootId: "cell_0",
      depth: 2,
    },
    cell_1: {
      id: "cell_1",
      label: "cell_1",
      compactLabel: "cell_1",
      angle: 0.85,
      radius: 42,
      radiusFrame: 0,
      x: 28,
      y: 32,
      color: "#f28e2b",
      rootId: "cell_1",
      depth: 1,
    },
  },
  edges: [
    { id: "cell_0->cell_00", source: "cell_0", target: "cell_00", type: "division", frame: 4 },
    { id: "cell_0->cell_01", source: "cell_0", target: "cell_01", type: "division", frame: 4 },
  ],
};

const mockLineageSnapshot: LineageFrameSnapshot = {
  jobId: "job_demo_running",
  frame: 4,
  sourceFrame: 4,
  missingFrameData: false,
  visibleNodes: ["cell_0", "cell_00", "cell_01", "cell_1"],
  visibleEdges: [
    { id: "cell_0->cell_00", source: "cell_0", target: "cell_00", type: "division", frame: 4 },
    { id: "cell_0->cell_01", source: "cell_0", target: "cell_01", type: "division", frame: 4 },
  ],
  activeNodes: ["cell_00", "cell_01", "cell_1"],
};

const idlePreload: VolumePreloadState = {
  volumes: {},
  errors: {},
  totalFiles: 0,
  readyFiles: 0,
  failedFiles: 0,
  progress: 0,
  loadedBytes: 0,
  totalBytes: 0,
  bytesPerSecond: 0,
  currentLabel: "",
  currentPhase: "idle",
  queuedFiles: 0,
  activeFiles: 0,
  isLoading: false,
};

const loadingPreload: VolumePreloadState = {
  volumes: {},
  errors: {},
  totalFiles: 6,
  readyFiles: 2,
  failedFiles: 0,
  progress: 0.42,
  loadedBytes: 9_420_000,
  totalBytes: 22_500_000,
  bytesPerSecond: 1_820_000,
  currentLabel: "t004 real",
  currentPhase: "decode",
  queuedFiles: 3,
  activeFiles: 1,
  isLoading: true,
};

export const TopBarPreview: Story = {
  render: () => {
    const [selectedJobId, setSelectedJobId] = useState(mockJobs[0].id);
    return (
      <TopBar
        jobs={mockJobs}
        selectedJobId={selectedJobId}
        onSelect={setSelectedJobId}
        onRefresh={() => {}}
      />
    );
  },
};

export const PanelHeadingPreview: Story = {
  render: () => (
    <div className="storybook-panel-width">
      <section className="tool-panel">
        <PanelHeading title="Example Panel" icon={<Activity size={17} />} onHide={() => {}} />
        <p className="muted">Shared heading with icon and hide control.</p>
      </section>
    </div>
  ),
};

export const StatusPanelStates: Story = {
  render: () => (
    <div className="storybook-panel-grid">
      <StatusPanel job={mockJobs[0]} loading={false} onHide={() => {}} />
      <StatusPanel job={mockJobs[1]} loading={false} onHide={() => {}} />
      <StatusPanel loading={false} onHide={() => {}} />
    </div>
  ),
};

export const CollapsedPanelPreview: Story = {
  render: () => (
    <div className="storybook-panel-grid">
      <CollapsedPanel panel="status" title="Status" onShow={() => {}} />
      <CollapsedPanel panel="layers" title="Layers" onShow={() => {}} />
      <CollapsedPanel panel="lineage" title="Lineage" onShow={() => {}} />
      <CollapsedPanel panel="logs" title="Runtime Log" onShow={() => {}} />
    </div>
  ),
};

export const SidePanelCollapseButtonPreview: Story = {
  render: () => (
    <div className="storybook-panel-width">
      <SidePanelCollapseButton onClick={() => {}} />
    </div>
  ),
};

export const LayerPanelInteractive: Story = {
  render: () => {
    const [realEnabled, setRealEnabled] = useState(true);
    const [synthEnabled, setSynthEnabled] = useState(true);
    const [cellsEnabled, setCellsEnabled] = useState(false);
    const [cellCentersEnabled, setCellCentersEnabled] = useState(false);
    const [realMap, setRealMap] = useState<ColorMapId>("viridis");
    const [synthMap, setSynthMap] = useState<ColorMapId>("magma");
    const [realOpacity, setRealOpacity] = useState(0.5);
    const [synthOpacity, setSynthOpacity] = useState(0.5);
    const [realContrastLimits, setRealContrastLimits] = useState<ContrastLimits>([0.05, 0.95]);
    const [synthContrastLimits, setSynthContrastLimits] = useState<ContrastLimits>([0.05, 0.95]);

    return (
      <div className="storybook-panel-width">
        <LayerPanel
          realEnabled={realEnabled}
          synthEnabled={synthEnabled}
          cellsEnabled={cellsEnabled}
          cellCentersEnabled={cellCentersEnabled}
          setLayer={(layer, value) => {
            if (layer === "realEnabled") setRealEnabled(value);
            if (layer === "synthEnabled") setSynthEnabled(value);
            if (layer === "cellsEnabled") setCellsEnabled(value);
            if (layer === "cellCentersEnabled") setCellCentersEnabled(value);
          }}
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
          onHide={() => {}}
        />
      </div>
    );
  },
};

export const PanelRestoreRailPreview: Story = {
  render: () => (
    <div className="storybook-restore-shell">
      <PanelRestoreRail
        leftHidden
        rightHidden
        logHidden
        viewerHidden
        onShowLeft={() => {}}
        onShowRight={() => {}}
        onShowLog={() => {}}
        onShowViewer={() => {}}
      />
    </div>
  ),
};

export const PanelResizerPreview: Story = {
  render: () => (
    <div className="storybook-resizer-shell">
      <PanelResizer side="left" onPointerDown={() => {}} onKeyboardResize={() => {}} />
      <PanelResizer side="right" onPointerDown={() => {}} onKeyboardResize={() => {}} />
    </div>
  ),
};

export const ViewAndScheduleControls: Story = {
  render: () => {
    const [mode, setMode] = useState<ViewMode>("volume");
    const [enabled, setEnabled] = useState(true);
    const [seconds, setSeconds] = useState(5);
    const [unit, setUnit] = useState<RefreshUnit>("seconds");

    return (
      <div className="storybook-panel-grid">
        <ViewModePanel mode={mode} setMode={setMode} onHide={() => {}} />
        <SchedulePanel
          enabled={enabled}
          seconds={seconds}
          unit={unit}
          setEnabled={setEnabled}
          setSeconds={setSeconds}
          setUnit={setUnit}
          onRefresh={() => {}}
          onHide={() => {}}
        />
      </div>
    );
  },
};

export const ViewerToolbarPreview: Story = {
  render: () => {
    const frames = Array.from({ length: 24 }, (_, index) => index);
    const [mode, setMode] = useState<ViewMode>("slice");
    const [frame, setFrame] = useState(8);
    const [slice, setSlice] = useState(18);

    return (
      <div className="storybook-toolbar-shell">
        <ViewModePanel mode={mode} setMode={setMode} onHide={() => {}} />
        <ViewerToolbar
          mode={mode}
          frame={frame}
          frames={frames}
          setFrame={setFrame}
          slice={slice}
          maxDepth={64}
          setSlice={setSlice}
          frameControlsDisabled={false}
        />
      </div>
    );
  },
};

export const LoadingIndicators: Story = {
  render: () => (
    <div className="storybook-loading-grid">
      <LoadBadge
        manifestLoading
        preload={idlePreload}
        pointCloudLoading={false}
        previewLoadingLabel="Loading point cloud"
        activeFrameWaiting={false}
        error={null}
      />
      <LoadBadge
        manifestLoading={false}
        preload={loadingPreload}
        pointCloudLoading={false}
        previewLoadingLabel="Loading point cloud"
        activeFrameWaiting={false}
        error={null}
      />
      <LoadBadge
        manifestLoading={false}
        preload={idlePreload}
        pointCloudLoading={false}
        previewLoadingLabel="Loading point cloud"
        activeFrameWaiting={false}
        error={new Error("Preview file is unavailable")}
      />
      <PreloadProgress preload={loadingPreload} />
    </div>
  ),
};

export const ViewerLoadingOverlayPreview: Story = {
  render: () => (
    <div className="storybook-viewer-shell">
      <ViewerLoadingOverlay
        preload={loadingPreload}
        metadataLoading={false}
        pointCloudLoading={false}
        previewLoadingLabel="loading point cloud"
        previewLoadingDetail="reading cached preview"
        activeFrameWaiting={false}
        renderPending={false}
        renderLabel="rendering volume"
        renderDetail="building point buffer"
      />
    </div>
  ),
};

export const FrameUpdateToastPreview: Story = {
  render: () => (
    <div className="storybook-toast-shell">
      <FrameUpdateToast
        notice={{ frames: [18, 19, 20], latestFrame: 20, createdAt: Date.now() }}
        onView={() => {}}
        onDismiss={() => {}}
      />
    </div>
  ),
};

export const RuntimeLog: Story = {
  render: () => {
    const [stream, setStream] = useState<"stdout" | "stderr">("stdout");
    return (
      <div className="storybook-log-dock">
        <LogPanel
          stream={stream}
          setStream={setStream}
          loading={false}
          onHide={() => {}}
          lines={[
            "[00:00:01] CellUniverse started",
            "[00:00:02] Loading input frame 0",
            "[00:00:04] Frame 0 complete",
            "[00:00:08] Frame 1 complete",
          ]}
        />
      </div>
    );
  },
};

export const LineagePanelPreview: Story = {
  render: () => {
    const [selectedNodeId, setSelectedNodeId] = useState<string | null>("cell_00");
    const [labeledNodeId, setLabeledNodeId] = useState<string | null>("cell_00");
    return (
      <div className="storybook-lineage-shell">
        <LineagePanel
          graph={mockLineageGraph}
          layout={mockLineageLayout}
          snapshot={mockLineageSnapshot}
          frame={4}
          loading={false}
          selectedNodeId={selectedNodeId}
          labeledNodeId={labeledNodeId}
          onSelectNode={setSelectedNodeId}
          onGoToCell={(node) => setLabeledNodeId(node.id)}
          onHide={() => {}}
        />
      </div>
    );
  },
};

export const ViewerEmptyStates: Story = {
  render: () => (
    <div className="storybook-viewer-grid">
      <div className="storybook-viewer-shell">
        <CanvasSliceViewer
          cells={[]}
          slice={0}
          realEnabled
          synthEnabled
          cellsEnabled={false}
          realMap="viridis"
          synthMap="magma"
          realOpacity={0.5}
          synthOpacity={0.5}
          realContrastLimits={[0, 1]}
          synthContrastLimits={[0, 1]}
        />
      </div>
      <div className="storybook-viewer-shell">
        <ThreeVolumeViewer
          cells={[]}
          realEnabled
          synthEnabled
          cellsEnabled={false}
          cellCentersEnabled={false}
          realMap="viridis"
          synthMap="magma"
          realOpacity={0.5}
          synthOpacity={0.5}
          realContrastLimits={[0, 1]}
          synthContrastLimits={[0, 1]}
          maxPixelRatio={1}
          focusCellIds={[]}
          focusFrame={null}
          focusRequestId={0}
          labeledCellIds={[]}
          frame={0}
          backgroundMode="dark"
          onBackgroundModeChange={() => {}}
        />
      </div>
    </div>
  ),
};
