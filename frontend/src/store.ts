import { create } from "zustand";
import type { ColorMapId } from "./viewer/colorMaps";
import { clampContrastLimits, DEFAULT_CLEAN_CONTRAST_LIMITS, DEFAULT_CONTRAST_LIMITS, type ContrastLimits } from "./viewer/contrast";

export type ViewMode = "slice" | "volume";
export type RefreshUnit = "seconds" | "minutes" | "hours";
export type ViewerBackgroundMode = "bright" | "dark";


type ViewerDefaults = {
  default3dBackgroundMode: ViewerBackgroundMode;
  defaultRealEnabled: boolean;
  defaultSynthEnabled: boolean;
  defaultCellsEnabled: boolean;
};

type ViewerState = {
  selectedJobId: string;
  frame: number;
  slice: number;
  mode: ViewMode;
  realEnabled: boolean;
  synthEnabled: boolean;
  cellsEnabled: boolean;
  realMap: ColorMapId;
  synthMap: ColorMapId;
  realOpacity: number;
  synthOpacity: number;
  realContrastLimits: ContrastLimits;
  synthContrastLimits: ContrastLimits;
  pointAlphaByBrightness: boolean;
  default3dBackgroundMode: ViewerBackgroundMode;
  defaultRealEnabled: boolean;
  defaultSynthEnabled: boolean;
  defaultCellsEnabled: boolean;
  logStream: "stdout" | "stderr";
  autoRefreshEnabled: boolean;
  autoRefreshSeconds: number;
  autoRefreshUnit: RefreshUnit;
  setSelectedJobId: (jobId: string) => void;
  setFrame: (frame: number) => void;
  setSlice: (slice: number) => void;
  setMode: (mode: ViewMode) => void;
  setLayer: (layer: "realEnabled" | "synthEnabled" | "cellsEnabled", value: boolean) => void;
  setRealMap: (map: ColorMapId) => void;
  setSynthMap: (map: ColorMapId) => void;
  setRealOpacity: (opacity: number) => void;
  setSynthOpacity: (opacity: number) => void;
  setRealContrastLimits: (limits: ContrastLimits) => void;
  setSynthContrastLimits: (limits: ContrastLimits) => void;
  setPointAlphaByBrightness: (enabled: boolean) => void;
  setDefault3dBackgroundMode: (mode: ViewerBackgroundMode) => void;
  setDefaultRealEnabled: (enabled: boolean) => void;
  setDefaultSynthEnabled: (enabled: boolean) => void;
  setDefaultCellsEnabled: (enabled: boolean) => void;
  setLogStream: (stream: "stdout" | "stderr") => void;
  setAutoRefreshEnabled: (enabled: boolean) => void;
  setAutoRefreshSeconds: (seconds: number) => void;
  setAutoRefreshUnit: (unit: RefreshUnit) => void;
};

const VIEWER_DEFAULTS_STORAGE_KEY = "celluniverse.viewer.defaults.v1";

const FALLBACK_VIEWER_DEFAULTS: ViewerDefaults = {
  default3dBackgroundMode: "dark",
  defaultRealEnabled: true,
  defaultSynthEnabled: true,
  defaultCellsEnabled: false,
};

const storedViewerDefaults = readStoredViewerDefaults();

export const useViewerStore = create<ViewerState>((set) => ({
  selectedJobId: "",
  frame: 0,
  slice: 0,
  mode: "volume",
  realEnabled: storedViewerDefaults.defaultRealEnabled,
  synthEnabled: storedViewerDefaults.defaultSynthEnabled,
  cellsEnabled: storedViewerDefaults.defaultCellsEnabled,
  realMap: "viridis",
  synthMap: "magma",
  realOpacity: 0.5,
  synthOpacity: 0.5,
  realContrastLimits: DEFAULT_CLEAN_CONTRAST_LIMITS,
  synthContrastLimits: DEFAULT_CLEAN_CONTRAST_LIMITS,
  pointAlphaByBrightness: false,
  default3dBackgroundMode: storedViewerDefaults.default3dBackgroundMode,
  defaultRealEnabled: storedViewerDefaults.defaultRealEnabled,
  defaultSynthEnabled: storedViewerDefaults.defaultSynthEnabled,
  defaultCellsEnabled: storedViewerDefaults.defaultCellsEnabled,
  logStream: "stdout",
  autoRefreshEnabled: true,
  autoRefreshSeconds: 5,
  autoRefreshUnit: "seconds",
  setSelectedJobId: (selectedJobId) => set((state) => (state.selectedJobId === selectedJobId ? state : { selectedJobId })),
  setFrame: (frame) => set((state) => (state.frame === frame && state.slice === 0 ? state : { frame, slice: 0 })),
  setSlice: (slice) => set((state) => (state.slice === slice ? state : { slice })),
  setMode: (mode) => set((state) => (state.mode === mode ? state : { mode })),
  setLayer: (layer, value) => set((state) => (state[layer] === value ? state : { [layer]: value })),
  setRealMap: (realMap) => set((state) => (state.realMap === realMap ? state : { realMap })),
  setSynthMap: (synthMap) => set((state) => (state.synthMap === synthMap ? state : { synthMap })),
  setRealOpacity: (realOpacity) => set((state) => {
    const opacity = clampOpacity(realOpacity);
    return state.realOpacity === opacity ? state : { realOpacity: opacity };
  }),
  setSynthOpacity: (synthOpacity) => set((state) => {
    const opacity = clampOpacity(synthOpacity);
    return state.synthOpacity === opacity ? state : { synthOpacity: opacity };
  }),
  setRealContrastLimits: (realContrastLimits) => set((state) => {
    const limits = clampContrastLimits(realContrastLimits);
    return areContrastLimitsEqual(state.realContrastLimits, limits) ? state : { realContrastLimits: limits };
  }),
  setSynthContrastLimits: (synthContrastLimits) => set((state) => {
    const limits = clampContrastLimits(synthContrastLimits);
    return areContrastLimitsEqual(state.synthContrastLimits, limits) ? state : { synthContrastLimits: limits };
  }),
  setPointAlphaByBrightness: (pointAlphaByBrightness) => (
    set((state) => (state.pointAlphaByBrightness === pointAlphaByBrightness ? state : { pointAlphaByBrightness }))
  ),
  setDefault3dBackgroundMode: (default3dBackgroundMode) => set((state) => {
    if (state.default3dBackgroundMode === default3dBackgroundMode) return state;
    const nextDefaults = { ...pickViewerDefaults(state), default3dBackgroundMode };
    writeStoredViewerDefaults(nextDefaults);
    return { default3dBackgroundMode };
  }),
  setDefaultRealEnabled: (defaultRealEnabled) => set((state) => {
    if (state.defaultRealEnabled === defaultRealEnabled && state.realEnabled === defaultRealEnabled) return state;
    const nextDefaults = { ...pickViewerDefaults(state), defaultRealEnabled };
    writeStoredViewerDefaults(nextDefaults);
    return { defaultRealEnabled, realEnabled: defaultRealEnabled };
  }),
  setDefaultSynthEnabled: (defaultSynthEnabled) => set((state) => {
    if (state.defaultSynthEnabled === defaultSynthEnabled && state.synthEnabled === defaultSynthEnabled) return state;
    const nextDefaults = { ...pickViewerDefaults(state), defaultSynthEnabled };
    writeStoredViewerDefaults(nextDefaults);
    return { defaultSynthEnabled, synthEnabled: defaultSynthEnabled };
  }),
  setDefaultCellsEnabled: (defaultCellsEnabled) => set((state) => {
    if (state.defaultCellsEnabled === defaultCellsEnabled && state.cellsEnabled === defaultCellsEnabled) return state;
    const nextDefaults = { ...pickViewerDefaults(state), defaultCellsEnabled };
    writeStoredViewerDefaults(nextDefaults);
    return { defaultCellsEnabled, cellsEnabled: defaultCellsEnabled };
  }),
  setLogStream: (logStream) => set((state) => (state.logStream === logStream ? state : { logStream })),
  setAutoRefreshEnabled: (autoRefreshEnabled) => (
    set((state) => (state.autoRefreshEnabled === autoRefreshEnabled ? state : { autoRefreshEnabled }))
  ),
  setAutoRefreshSeconds: (autoRefreshSeconds) => set((state) => {
    const seconds = clampRefreshSeconds(autoRefreshSeconds);
    return state.autoRefreshSeconds === seconds ? state : { autoRefreshSeconds: seconds };
  }),
  setAutoRefreshUnit: (autoRefreshUnit) => set((state) => (
    state.autoRefreshUnit === autoRefreshUnit ? state : { autoRefreshUnit }
  )),
}));

function readStoredViewerDefaults(): ViewerDefaults {
  if (typeof window === "undefined") {
    return FALLBACK_VIEWER_DEFAULTS;
  }
  try {
    const raw = window.localStorage.getItem(VIEWER_DEFAULTS_STORAGE_KEY);
    if (!raw) return FALLBACK_VIEWER_DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<ViewerDefaults>;
    return normalizeViewerDefaults(parsed);
  } catch {
    return FALLBACK_VIEWER_DEFAULTS;
  }
}

function writeStoredViewerDefaults(defaults: ViewerDefaults): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(VIEWER_DEFAULTS_STORAGE_KEY, JSON.stringify(normalizeViewerDefaults(defaults)));
}

function normalizeViewerDefaults(defaults: Partial<ViewerDefaults>): ViewerDefaults {
  return {
    default3dBackgroundMode: defaults.default3dBackgroundMode === "bright" || defaults.default3dBackgroundMode === "dark"
      ? defaults.default3dBackgroundMode
      : FALLBACK_VIEWER_DEFAULTS.default3dBackgroundMode,
    defaultRealEnabled: typeof defaults.defaultRealEnabled === "boolean" ? defaults.defaultRealEnabled : FALLBACK_VIEWER_DEFAULTS.defaultRealEnabled,
    defaultSynthEnabled: typeof defaults.defaultSynthEnabled === "boolean" ? defaults.defaultSynthEnabled : FALLBACK_VIEWER_DEFAULTS.defaultSynthEnabled,
    defaultCellsEnabled: typeof defaults.defaultCellsEnabled === "boolean" ? defaults.defaultCellsEnabled : FALLBACK_VIEWER_DEFAULTS.defaultCellsEnabled,
  };
}

function pickViewerDefaults(state: ViewerDefaults): ViewerDefaults {
  return {
    default3dBackgroundMode: state.default3dBackgroundMode,
    defaultRealEnabled: state.defaultRealEnabled,
    defaultSynthEnabled: state.defaultSynthEnabled,
    defaultCellsEnabled: state.defaultCellsEnabled,
  };
}

function clampRefreshSeconds(seconds: number): number {
  if (!Number.isFinite(seconds)) {
    return 5;
  }
  return Math.max(2, Math.min(86400, Math.round(seconds)));
}

function clampOpacity(opacity: number): number {
  if (!Number.isFinite(opacity)) {
    return 1;
  }
  return Math.max(0, Math.min(1, opacity));
}

function areContrastLimitsEqual(a: ContrastLimits, b: ContrastLimits): boolean {
  return a[0] === b[0] && a[1] === b[1];
}
