export type JobState = "queued" | "running" | "completed" | "failed" | "cancelled";

export type JobStatus = {
  id: string;
  label?: string | null;
  type: string;
  state: JobState;
  firstFrame: number;
  lastFrame: number;
  currentFrame: number | null;
  lastCompletedFrame: number | null;
  completedFrames: number;
  totalFrames: number;
  progress: number;
  outputReady: {
    cellsCsv: boolean;
    checkpointFrames: number[];
    pngFrames: number[];
    tiffFrames: number[];
  };
  partialOutputsAvailable: boolean;
  pid?: number | null;
  error?: string | null;
  createdAt?: string;
  startedAt?: string | null;
  finishedAt?: string | null;
};

export type LayerEntry =
  | {
      format: "tiff";
      url: string;
    }
  | {
      format: "png-stack";
      urlTemplate: string;
    }
  | {
      format: "ellipsoid-json";
      url: string;
    }
  | {
      format: "point-cloud-v1";
      url: string;
    };

export type ManifestFrame = {
  t: number;
  layers: Record<string, LayerEntry>;
};

export type JobManifest = {
  jobId: string;
  axes: string[];
  frames: ManifestFrame[];
  lineage: string;
};

export type CellRecord = {
  file?: number | string;
  name: string;
  x: number;
  y: number;
  z: number;
  aRadius: number;
  bRadius: number;
  cRadius: number;
  thetaX?: number;
  thetaY?: number;
  thetaZ?: number;
  theta_x?: number;
  theta_y?: number;
  theta_z?: number;
  isTrash?: boolean;
};

export type LogResponse = {
  jobId: string;
  stream: "stdout" | "stderr";
  lines: string[];
};

export type JobEvent = {
  time?: string;
  type: string;
  jobId?: string;
  payload?: unknown;
};

export type LineageNode = {
  id: string;
  name: string;
  parentId?: string | null;
  rootId: string;
  code: string;
  depth: number;
  firstFrame: number;
  lastFrame: number;
  children: string[];
  observedFrames: number[];
  lastCell?: CellRecord | null;
};

export type LineageEdge = {
  id: string;
  source: string;
  target: string;
  type: "division";
  frame: number;
};

export type LineageGraph = {
  jobId: string;
  source: string;
  frames: number[];
  firstFrame: number | null;
  lastFrame: number | null;
  nodes: LineageNode[];
  edges: LineageEdge[];
  roots: string[];
  activeByFrame?: Record<string, string[]>;
  updatedAt?: number | null;
  sourceSize?: number | null;
};

export type LineageLayoutNode = {
  id: string;
  label: string;
  compactLabel: string;
  angle: number;
  radius: number;
  radiusFrame: number;
  x: number;
  y: number;
  color: string;
  rootId: string;
  depth: number;
};

export type LineageLayout = {
  jobId: string;
  mode: string;
  background: string;
  center: { x: number; y: number };
  innerRadius?: number;
  ringSpacing: number;
  firstFrame?: number | null;
  lastFrame?: number | null;
  rings: { frame: number; radius: number }[];
  nodes: Record<string, LineageLayoutNode>;
  edges: LineageEdge[];
};

export type LineageFrameSnapshot = {
  jobId: string;
  frame: number;
  sourceFrame: number | null;
  missingFrameData: boolean;
  visibleNodes: string[];
  visibleEdges: LineageEdge[];
  activeNodes: string[];
};
