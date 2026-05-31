import { useQuery } from "@tanstack/react-query";

export type PreviewConfig = {
  maxXY: number;
  maxSlices: number;
  preloadConcurrency: number;
};

export type ViewerRuntimeConfig = {
  preview: PreviewConfig;
  rendering: {
    maxPixelRatio: number;
  };
  pointCloud: {
    maxPoints: number;
    intensityPercentile: number;
    pointSize: number;
    realOpacity: number;
    synthOpacityScale: number;
    zCompression: number;
    overlayStaggerFraction: number;
  };
};

export const defaultViewerConfig: ViewerRuntimeConfig = {
  preview: {
    maxXY: 512,
    maxSlices: 48,
    preloadConcurrency: 1,
  },
  rendering: {
    maxPixelRatio: 1,
  },
  pointCloud: {
    maxPoints: 120000,
    intensityPercentile: 35,
    pointSize: 3.6,
    realOpacity: 0.95,
    synthOpacityScale: 0.55,
    zCompression: 1,
    overlayStaggerFraction: 0.38,
  },
};

export function useViewerConfig() {
  return useQuery({
    queryKey: ["viewer-config"],
    queryFn: loadViewerConfig,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
}

export function previewConfigSignature(config: PreviewConfig): string {
  return `xy${config.maxXY}-z${config.maxSlices}`;
}

async function loadViewerConfig(): Promise<ViewerRuntimeConfig> {
  try {
    const response = await fetch("/viewer-config.json", { cache: "no-store" });
    if (response.status === 404) {
      return defaultViewerConfig;
    }
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    const raw = (await response.json()) as Partial<ViewerRuntimeConfig>;
    return normalizeConfig(raw);
  } catch (error) {
    console.warn("Using default viewer config:", error);
    return defaultViewerConfig;
  }
}

function normalizeConfig(raw: Partial<ViewerRuntimeConfig>): ViewerRuntimeConfig {
  return {
    preview: {
      maxXY: clampNumber(raw.preview?.maxXY, 128, 4096, defaultViewerConfig.preview.maxXY),
      maxSlices: clampNumber(raw.preview?.maxSlices, 8, 256, defaultViewerConfig.preview.maxSlices),
      preloadConcurrency: clampNumber(
        raw.preview?.preloadConcurrency,
        1,
        6,
        defaultViewerConfig.preview.preloadConcurrency,
      ),
    },
    rendering: {
      maxPixelRatio: clampFloat(
        raw.rendering?.maxPixelRatio,
        1,
        2,
        defaultViewerConfig.rendering.maxPixelRatio,
      ),
    },
    pointCloud: {
      maxPoints: clampNumber(raw.pointCloud?.maxPoints, 5000, 1000000, defaultViewerConfig.pointCloud.maxPoints),
      intensityPercentile: clampFloat(
        raw.pointCloud?.intensityPercentile,
        50,
        99.5,
        defaultViewerConfig.pointCloud.intensityPercentile,
      ),
      pointSize: clampFloat(raw.pointCloud?.pointSize, 0.25, 8, defaultViewerConfig.pointCloud.pointSize),
      realOpacity: clampFloat(raw.pointCloud?.realOpacity, 0.05, 1, defaultViewerConfig.pointCloud.realOpacity),
      synthOpacityScale: clampFloat(
        raw.pointCloud?.synthOpacityScale,
        0,
        1,
        defaultViewerConfig.pointCloud.synthOpacityScale,
      ),
      zCompression: clampFloat(
        raw.pointCloud?.zCompression,
        0.03,
        4,
        defaultViewerConfig.pointCloud.zCompression,
      ),
      overlayStaggerFraction: clampFloat(
        raw.pointCloud?.overlayStaggerFraction,
        0,
        0.75,
        defaultViewerConfig.pointCloud.overlayStaggerFraction,
      ),
    },
  };
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.round(numberValue)));
}

function clampFloat(value: unknown, min: number, max: number, fallback: number): number {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, numberValue));
}
