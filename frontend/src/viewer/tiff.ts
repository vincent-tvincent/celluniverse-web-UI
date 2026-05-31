export type VolumeData = {
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  depth: number;
  displayMax: number;
  sliceIndices: number[];
  slices: Uint8ClampedArray[];
};

export type LoadState = {
  status: "idle" | "loading" | "ready" | "error";
  error?: string;
};

export type TiffLoadProgress = {
  phase: "download" | "decode";
  loadedBytes?: number;
  totalBytes?: number;
  decodedSlices?: number;
  totalSlices?: number;
};

export type PreviewDecodeOptions = {
  maxXY: number;
  maxSlices: number;
};

type WorkerSuccess = {
  id: number;
  type: "result";
  ok: true;
  volume: Omit<VolumeData, "slices"> & {
    slices: ArrayBuffer[];
  };
};

type WorkerFailure = {
  id: number;
  type: "result";
  ok: false;
  error: string;
};

type WorkerProgress = {
  id: number;
  type: "progress";
  progress: TiffLoadProgress;
};

type WorkerResponse = WorkerSuccess | WorkerFailure | WorkerProgress;

type PendingRequest = {
  resolve: (volume: VolumeData) => void;
  reject: (error: Error) => void;
  onProgress?: (progress: TiffLoadProgress) => void;
};

const cache = new Map<string, Promise<VolumeData>>();
const pending = new Map<number, PendingRequest>();
let nextRequestId = 1;
let worker: Worker | undefined;

export function loadTiffVolume(
  url: string,
  options: PreviewDecodeOptions,
  onProgress?: (progress: TiffLoadProgress) => void,
): Promise<VolumeData> {
  const key = makeCacheKey(url, options);
  const cached = cache.get(key);
  if (cached) {
    return cached;
  }

  const promise = decodeInWorker(url, options, onProgress).catch((error: Error) => {
    cache.delete(key);
    throw error;
  });
  cache.set(key, promise);
  return promise;
}

function decodeInWorker(
  url: string,
  options: PreviewDecodeOptions,
  onProgress?: (progress: TiffLoadProgress) => void,
): Promise<VolumeData> {
  const id = nextRequestId;
  nextRequestId += 1;

  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    getWorker().postMessage({ id, url, options });
  });
}

function getWorker(): Worker {
  if (worker) {
    return worker;
  }

  worker = new Worker(new URL("./tiff.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const request = pending.get(event.data.id);
    if (!request) {
      return;
    }

    if (event.data.type === "progress") {
      request.onProgress?.(event.data.progress);
      return;
    }

    pending.delete(event.data.id);

    if (!event.data.ok) {
      request.reject(new Error(event.data.error));
      return;
    }

    request.resolve({
      ...event.data.volume,
      slices: event.data.volume.slices.map((buffer) => new Uint8ClampedArray(buffer)),
    });
  };
  worker.onerror = (event) => {
    const error = new Error(event.message || "TIFF worker failed");
    pending.forEach((request) => request.reject(error));
    pending.clear();
    worker?.terminate();
    worker = undefined;
  };
  return worker;
}

function makeCacheKey(url: string, options: PreviewDecodeOptions): string {
  return `${url}\u0000xy=${options.maxXY}\u0000z=${options.maxSlices}`;
}
