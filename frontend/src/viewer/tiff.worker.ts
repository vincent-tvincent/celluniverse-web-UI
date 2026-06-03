/// <reference lib="webworker" />

import UTIF from "utif";

const ctx = self as unknown as DedicatedWorkerGlobalScope;

type DecodeRequest = {
  id: number;
  url: string;
  options?: PreviewDecodeOptions;
};

type DecodedVolume = {
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  depth: number;
  displayMax: number;
  sliceIndices: number[];
  slices: ArrayBuffer[];
};

type PreviewDecodeOptions = {
  maxXY: number;
  maxSlices: number;
};

ctx.onmessage = async (event: MessageEvent<DecodeRequest>) => {
  const { id, url } = event.data;
  const options = normalizeOptions(event.data.options);
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }

    const totalBytes = Number(response.headers.get("content-length")) || undefined;
    const buffer = await readResponseBuffer(response, id, totalBytes);
    const volume = decodeTiffVolume(buffer, id, options);
    ctx.postMessage({ id, type: "result", ok: true, volume }, volume.slices);
  } catch (error) {
    ctx.postMessage({
      id,
      type: "result",
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

async function readResponseBuffer(response: Response, id: number, totalBytes?: number): Promise<ArrayBuffer> {
  if (!response.body) {
    const buffer = await response.arrayBuffer();
    postProgress(id, { phase: "download", loadedBytes: buffer.byteLength, totalBytes: buffer.byteLength });
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loadedBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    chunks.push(value);
    loadedBytes += value.byteLength;
    postProgress(id, { phase: "download", loadedBytes, totalBytes });
  }

  const merged = new Uint8Array(loadedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged.buffer;
}

function decodeTiffVolume(buffer: ArrayBuffer, id: number, options: PreviewDecodeOptions): DecodedVolume {
  const ifds = UTIF.decode(buffer);
  if (ifds.length === 0) {
    throw new Error("TIFF file has no image frames");
  }

  const sourceWidth = getIfdWidth(ifds[0]);
  const sourceHeight = getIfdHeight(ifds[0]);
  const previewSize = fitPreviewSize(sourceWidth, sourceHeight, options.maxXY);
  const stride = ifds.length <= 50 ? 1 : Math.max(1, Math.ceil(ifds.length / options.maxSlices));
  const selected = ifds
    .map((ifd, index) => ({ ifd, index }))
    .filter(({ index }) => index % stride === 0 || index === ifds.length - 1);

  let displayMax = 0;
  const slices = selected.map(({ ifd }, selectedIndex) => {
    UTIF.decodeImage(buffer, ifd);
    const frameWidth = getIfdWidth(ifd);
    const frameHeight = getIfdHeight(ifd);
    const rgba = UTIF.toRGBA8(ifd);
    const gray = new Uint8ClampedArray(previewSize.width * previewSize.height);
    for (let y = 0; y < previewSize.height; y += 1) {
      const sourceY = Math.min(frameHeight - 1, Math.floor((y * frameHeight) / previewSize.height));
      for (let x = 0; x < previewSize.width; x += 1) {
        const sourceX = Math.min(frameWidth - 1, Math.floor((x * frameWidth) / previewSize.width));
        const sourceOffset = (sourceY * frameWidth + sourceX) * 4;
        const targetOffset = y * previewSize.width + x;
        gray[targetOffset] = Math.round(
          rgba[sourceOffset] * 0.2126 + rgba[sourceOffset + 1] * 0.7152 + rgba[sourceOffset + 2] * 0.0722,
        );
        if (gray[targetOffset] > displayMax) {
          displayMax = gray[targetOffset];
        }
      }
    }
    if (selectedIndex % 4 === 0 || selectedIndex === selected.length - 1) {
      postProgress(id, {
        phase: "decode",
        decodedSlices: selectedIndex + 1,
        totalSlices: selected.length,
      });
    }
    return gray;
  });

  return {
    width: previewSize.width,
    height: previewSize.height,
    sourceWidth,
    sourceHeight,
    depth: ifds.length,
    displayMax: Math.max(1, displayMax),
    sliceIndices: selected.map(({ index }) => index),
    slices: slices.map((slice) => slice.buffer as ArrayBuffer),
  };
}

function getIfdWidth(ifd: { width?: number; t256?: number[] }): number {
  return Number(ifd.width ?? ifd.t256?.[0] ?? 0);
}

function getIfdHeight(ifd: { height?: number; t257?: number[] }): number {
  return Number(ifd.height ?? ifd.t257?.[0] ?? 0);
}

function fitPreviewSize(width: number, height: number, maxXY: number): { width: number; height: number } {
  const longest = Math.max(width, height, 1);
  const scale = Math.min(1, maxXY / longest);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function normalizeOptions(options?: Partial<PreviewDecodeOptions>): PreviewDecodeOptions {
  return {
    maxXY: clampNumber(options?.maxXY, 128, 4096, 512),
    maxSlices: clampNumber(options?.maxSlices, 8, 256, 48),
  };
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.round(numberValue)));
}

function postProgress(
  id: number,
  progress: {
    phase: "download" | "decode";
    loadedBytes?: number;
    totalBytes?: number;
    decodedSlices?: number;
    totalSlices?: number;
  },
) {
  ctx.postMessage({ id, type: "progress", progress });
}
