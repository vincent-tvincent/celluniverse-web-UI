export type SlicePreviewData = {
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  depth: number;
  sliceIndex: number;
  displayMax: number;
  pixels: Uint8ClampedArray;
};

const cache = new Map<string, Promise<SlicePreviewData>>();

export function loadSlicePreview(url: string): Promise<SlicePreviewData> {
  const cached = cache.get(url);
  if (cached) {
    return cached;
  }
  const promise = fetchSlicePreview(url).catch((error: Error) => {
    cache.delete(url);
    throw error;
  });
  cache.set(url, promise);
  return promise;
}

async function fetchSlicePreview(url: string): Promise<SlicePreviewData> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return parseSlicePreview(await response.arrayBuffer());
}

function parseSlicePreview(buffer: ArrayBuffer): SlicePreviewData {
  const view = new DataView(buffer);
  if (view.byteLength < 36 || readMagic(view) !== "CUSL") {
    throw new Error("Invalid slice preview file");
  }
  const version = view.getUint32(4, true);
  if (version !== 1) {
    throw new Error(`Unsupported slice preview version ${version}`);
  }
  const width = view.getUint32(8, true);
  const height = view.getUint32(12, true);
  const sourceWidth = view.getUint32(16, true);
  const sourceHeight = view.getUint32(20, true);
  const depth = view.getUint32(24, true);
  const sliceIndex = view.getUint32(28, true);
  const displayMax = view.getUint32(32, true);
  const pixelBytes = width * height;
  if (view.byteLength < 36 + pixelBytes) {
    throw new Error("Truncated slice preview file");
  }
  return {
    width,
    height,
    sourceWidth,
    sourceHeight,
    depth,
    sliceIndex,
    displayMax,
    pixels: new Uint8ClampedArray(buffer, 36, pixelBytes),
  };
}

function readMagic(view: DataView): string {
  return String.fromCharCode(
    view.getUint8(0),
    view.getUint8(1),
    view.getUint8(2),
    view.getUint8(3),
  );
}
