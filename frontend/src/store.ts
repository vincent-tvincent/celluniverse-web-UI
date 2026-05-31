import { create } from "zustand";
import type { ColorMapId } from "./viewer/colorMaps";

export type ViewMode = "slice" | "volume";

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
  synthOpacity: number;
  logStream: "stdout" | "stderr";
  autoRefreshEnabled: boolean;
  autoRefreshSeconds: number;
  setSelectedJobId: (jobId: string) => void;
  setFrame: (frame: number) => void;
  setSlice: (slice: number) => void;
  setMode: (mode: ViewMode) => void;
  setLayer: (layer: "realEnabled" | "synthEnabled" | "cellsEnabled", value: boolean) => void;
  setRealMap: (map: ColorMapId) => void;
  setSynthMap: (map: ColorMapId) => void;
  setSynthOpacity: (opacity: number) => void;
  setLogStream: (stream: "stdout" | "stderr") => void;
  setAutoRefreshEnabled: (enabled: boolean) => void;
  setAutoRefreshSeconds: (seconds: number) => void;
};

export const useViewerStore = create<ViewerState>((set) => ({
  selectedJobId: "",
  frame: 0,
  slice: 0,
  mode: "volume",
  realEnabled: true,
  synthEnabled: true,
  cellsEnabled: false,
  realMap: "gray",
  synthMap: "magenta",
  synthOpacity: 0.5,
  logStream: "stdout",
  autoRefreshEnabled: true,
  autoRefreshSeconds: 5,
  setSelectedJobId: (selectedJobId) => set((state) => (state.selectedJobId === selectedJobId ? state : { selectedJobId })),
  setFrame: (frame) => set((state) => (state.frame === frame && state.slice === 0 ? state : { frame, slice: 0 })),
  setSlice: (slice) => set((state) => (state.slice === slice ? state : { slice })),
  setMode: (mode) => set((state) => (state.mode === mode ? state : { mode })),
  setLayer: (layer, value) => set((state) => (state[layer] === value ? state : { [layer]: value })),
  setRealMap: (realMap) => set((state) => (state.realMap === realMap ? state : { realMap })),
  setSynthMap: (synthMap) => set((state) => (state.synthMap === synthMap ? state : { synthMap })),
  setSynthOpacity: (synthOpacity) => set((state) => (state.synthOpacity === synthOpacity ? state : { synthOpacity })),
  setLogStream: (logStream) => set((state) => (state.logStream === logStream ? state : { logStream })),
  setAutoRefreshEnabled: (autoRefreshEnabled) => (
    set((state) => (state.autoRefreshEnabled === autoRefreshEnabled ? state : { autoRefreshEnabled }))
  ),
  setAutoRefreshSeconds: (autoRefreshSeconds) => set((state) => {
    const seconds = clampRefreshSeconds(autoRefreshSeconds);
    return state.autoRefreshSeconds === seconds ? state : { autoRefreshSeconds: seconds };
  }),
}));

function clampRefreshSeconds(seconds: number): number {
  if (!Number.isFinite(seconds)) {
    return 5;
  }
  return Math.max(2, Math.min(300, Math.round(seconds)));
}
