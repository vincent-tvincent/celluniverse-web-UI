export type JobState = "prepared" | "queued" | "running" | "completed" | "failed" | "cancelled" | "interrupted" | "archived";

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
  resumeAvailable?: boolean;
  resumeFromFrame?: number | null;
  resumeSourceDir?: string | null;
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

export type DatasetPreviewManifest = {
  datasetId: string;
  jobId?: string;
  label: string;
  sourceType: "upload" | "local";
  axes: string[];
  frames: (ManifestFrame & { sourceIndex?: number; sourceName?: string })[];
  lineage: "none";
  metadata?: Record<string, unknown>;
};

export type DeleteDatasetUploadResponse = {
  uploadId: string;
  deleted: boolean;
};

export type DataSourceRoot = {
  id: string;
  label: string;
  path: string;
  enabled: boolean;
  preset: boolean;
  sourceRole: "dataset" | "initial-csv" | string;
  sourceKind: "preset" | "tiff-image" | "initial-csv" | "initial-csv-preset" | string;
  exists: boolean;
  pathKind: "directory" | "file" | "missing";
  createdAt?: string | null;
  updatedAt?: string | null;
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

export type DatasetUploadFile = {
  name: string;
  relativePath: string;
  size: number;
};

export type DatasetUpload = {
  uploadId: string;
  kind: string;
  createdAt: string;
  fileCount: number;
  totalBytes: number;
  files: DatasetUploadFile[];
};

export type LocalDataset = {
  id: string;
  label: string;
  sourceType: "local";
  source: string;
  rootId: string;
  inputPath: string;
  pathKind: "directory" | "frame-pattern" | "file";
  fileCount: number;
  frameCount: number;
  firstFrame: number;
  lastFrame: number;
  filePattern: string;
  totalBytes: number;
  detectedAt: string;
  warnings: string[];
};

export type InitialCsvPreset = {
  id: string;
  label: string;
  path: string;
  source: string;
  size: number;
};

export type ParameterField = {
  path: string;
  label: string;
  type: "integer" | "number" | "boolean" | "enum" | "string";
  min?: number | null;
  max?: number | null;
  values?: string[] | null;
  default?: unknown;
  ui?: string | null;
  virtual?: boolean;
};

export type ParameterModule = {
  id: string;
  label: string;
  baseConfig: string;
  groups: {
    id: string;
    label: string;
    fields: ParameterField[];
  }[];
};

export type CreateJobPayload = {
  label?: string | null;
  type?: string;
  inputPath?: string | null;
  datasetId?: string | null;
  firstFrame: number;
  lastFrame: number;
  initialCsvPath?: string | null;
  initialCsvUploadId?: string | null;
  configYamlPath?: string | null;
  configYamlUploadId?: string | null;
  parameterModuleId?: string;
  overrides?: Record<string, unknown>;
  autoStart?: boolean;
};

export type JobRequest = CreateJobPayload;

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
