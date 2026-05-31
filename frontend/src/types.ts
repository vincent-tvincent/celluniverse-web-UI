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
