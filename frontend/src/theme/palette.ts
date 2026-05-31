export const uiPalette = {
  viewerBackground: "#070a0f",
  volumeBox: "#506070",
  cellNormal: "#f6e582",
  cellTrash: "#ff765e",
  cellNormalStroke: "rgba(246, 229, 130, 0.95)",
  cellTrashStroke: "rgba(255, 118, 94, 0.88)",
  cellNormalFill: "rgba(246, 229, 130, 0.95)",
  cellTrashFill: "rgba(255, 118, 94, 0.95)",
  emptyText: "rgba(255,255,255,0.58)",
} as const;

export type ColorMapId =
  | "gray"
  | "cyan"
  | "magenta"
  | "green"
  | "yellow"
  | "red"
  | "blue"
  | "viridis"
  | "magma";

export type ColorMapDefinition = {
  id: ColorMapId;
  label: string;
  stops: [number, string][];
};

export const colorMapDefinitions: ColorMapDefinition[] = [
  {
    id: "gray",
    label: "Gray",
    stops: [
      [0, "#000000"],
      [1, "#f7f7f2"],
    ],
  },
  {
    id: "cyan",
    label: "Cyan",
    stops: [
      [0, "#001011"],
      [0.55, "#00a7b8"],
      [1, "#d8ffff"],
    ],
  },
  {
    id: "magenta",
    label: "Magenta",
    stops: [
      [0, "#12000f"],
      [0.55, "#c43b9c"],
      [1, "#ffe0f8"],
    ],
  },
  {
    id: "green",
    label: "Green",
    stops: [
      [0, "#031008"],
      [0.58, "#3bb56d"],
      [1, "#e4ffe8"],
    ],
  },
  {
    id: "yellow",
    label: "Yellow",
    stops: [
      [0, "#151000"],
      [0.55, "#d6b83d"],
      [1, "#fff9ca"],
    ],
  },
  {
    id: "red",
    label: "Red",
    stops: [
      [0, "#160300"],
      [0.55, "#d64a3b"],
      [1, "#ffe1d4"],
    ],
  },
  {
    id: "blue",
    label: "Blue",
    stops: [
      [0, "#020617"],
      [0.55, "#3a7df0"],
      [1, "#dce9ff"],
    ],
  },
  {
    id: "viridis",
    label: "Viridis",
    stops: [
      [0, "#440154"],
      [0.25, "#31688e"],
      [0.5, "#35b779"],
      [0.75, "#fde725"],
      [1, "#fff9bf"],
    ],
  },
  {
    id: "magma",
    label: "Magma",
    stops: [
      [0, "#000004"],
      [0.28, "#51127c"],
      [0.58, "#b73779"],
      [0.8, "#fc8961"],
      [1, "#fcfdbf"],
    ],
  },
];
