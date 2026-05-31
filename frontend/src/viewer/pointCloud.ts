export type PointCloudPreviewData = {
  pointCount: number;
  sourceWidth: number;
  sourceHeight: number;
  depth: number;
  selectedSlices: number;
  xyStep: number;
  threshold: number;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  intensity: Float32Array;
};

const cache = new Map<string, Promise<PointCloudPreviewData>>();

export function loadPointCloudPreview(url: string): Promise<PointCloudPreviewData> {
  const cached = cache.get(url);
  if (cached) {
    return cached;
  }
  const promise = fetchPointCloudPreview(url).catch((error: Error) => {
    cache.delete(url);
    throw error;
  });
  cache.set(url, promise);
  return promise;
}

async function fetchPointCloudPreview(url: string): Promise<PointCloudPreviewData> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return parsePointCloudPreview(await response.arrayBuffer());
}

function parsePointCloudPreview(buffer: ArrayBuffer): PointCloudPreviewData {
  const view = new DataView(buffer);
  if (view.byteLength < 40 || readMagic(view) !== "CUPC") {
    throw new Error("Invalid point-cloud preview file");
  }

  const version = view.getUint32(4, true);
  if (version !== 1) {
    throw new Error(`Unsupported point-cloud preview version ${version}`);
  }

  const pointCount = view.getUint32(8, true);
  const sourceWidth = view.getUint32(12, true);
  const sourceHeight = view.getUint32(16, true);
  const depth = view.getUint32(20, true);
  const selectedSlices = view.getUint32(24, true);
  const xyStep = view.getUint32(28, true);
  const threshold = view.getFloat32(32, true);
  const recordOffset = 40;
  const recordBytes = pointCount * 16;
  if (view.byteLength < recordOffset + recordBytes) {
    throw new Error("Truncated point-cloud preview file");
  }

  const x = new Float32Array(pointCount);
  const y = new Float32Array(pointCount);
  const z = new Float32Array(pointCount);
  const intensity = new Float32Array(pointCount);
  let offset = recordOffset;
  for (let index = 0; index < pointCount; index += 1) {
    x[index] = view.getFloat32(offset, true);
    y[index] = view.getFloat32(offset + 4, true);
    z[index] = view.getFloat32(offset + 8, true);
    intensity[index] = view.getFloat32(offset + 12, true);
    offset += 16;
  }

  return { pointCount, sourceWidth, sourceHeight, depth, selectedSlices, xyStep, threshold, x, y, z, intensity };
}

function readMagic(view: DataView): string {
  return String.fromCharCode(
    view.getUint8(0),
    view.getUint8(1),
    view.getUint8(2),
    view.getUint8(3),
  );
}
