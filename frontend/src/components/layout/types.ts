export type FrameUpdateNotice = {
  frames: number[];
  latestFrame: number;
  createdAt: number;
};

export type PanelVisibility = {
  status: boolean;
  layers: boolean;
  update: boolean;
  logs: boolean;
  lineage: boolean;
  viewer: boolean;
};

export type PanelVisibilityKey = keyof PanelVisibility;

export const LEFT_PANEL_KEYS = ["status", "layers", "update"] as const satisfies PanelVisibilityKey[];

export const DEFAULT_PANEL_VISIBILITY: PanelVisibility = {
  status: true,
  layers: true,
  update: true,
  logs: false,
  lineage: true,
  viewer: true,
};
