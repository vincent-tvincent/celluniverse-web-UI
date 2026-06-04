export const uiPalette = {
  // Pale neutral background used behind microscopy slice and volume views.
  viewerBackground: "#fffefa",
  // Dark neutral background for high-contrast 3D inspection.
  viewerBackgroundDark: "#090d13",
  // Subtle bounding-box guide around the rendered 3D volume.
  volumeBox: "#60616d",
  // Bounding-box guide for dark-background 3D inspection.
  volumeBoxDark: "#bfc8ff",
  // Default color for valid cell ellipsoid overlays.
  cellNormal: "#00df82",
  // Alert color for cells marked as trash or rejected output.
  cellTrash: "#ff765e",
  // Highlight color for the currently selected or lineage-focused cell.
  cellSelected: "#00e7c8",
  // Stroke for normal cell outlines in the 2D slice overlay.
  cellNormalStroke: "#00df82",
  // Stroke for trash/rejected cell outlines in the 2D slice overlay.
  cellTrashStroke: "#ff765e",
  // Fill for normal cell markers and overlay accents.
  cellNormalFill: "#00df82",
  // Fill for trash/rejected cell markers and overlay accents.
  cellTrashFill: "#ff765e",
  // Muted text shown inside empty viewer states.
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
    // Neutral luminance map for inspecting raw intensity without hue bias.
    id: "gray",
    label: "Gray",
    stops: [
      [0, "#000000"],
      [1, "#f7f7f2"],
    ],
  },
  {
    // Cool single-hue map; useful for real-channel fluorescence-like signal.
    id: "cyan",
    label: "Cyan",
    stops: [
      [0, "#001011"],
      [0.55, "#00a7b8"],
      [1, "#d8ffff"],
    ],
  },
  {
    // Warm single-hue map; useful for synthetic or secondary-channel contrast.
    id: "magenta",
    label: "Magenta",
    stops: [
      [0, "#12000f"],
      [0.55, "#c43b9c"],
      [1, "#ffe0f8"],
    ],
  },
  {
    // Green fluorescence-style map for biological signal inspection.
    id: "green",
    label: "Green",
    stops: [
      [0, "#031008"],
      [0.58, "#3bb56d"],
      [1, "#e4ffe8"],
    ],
  },
  {
    // Bright warm map that makes mid/high intensities stand out strongly.
    id: "yellow",
    label: "Yellow",
    stops: [
      [0, "#151000"],
      [0.55, "#d6b83d"],
      [1, "#fff9ca"],
    ],
  },
  {
    // Heat-style map for emphasizing high-intensity regions and warnings.
    id: "red",
    label: "Red",
    stops: [
      [0, "#160300"],
      [0.55, "#d64a3b"],
      [1, "#ffe1d4"],
    ],
  },
  {
    // Cool blue map for separating one layer from warmer overlays.
    id: "blue",
    label: "Blue",
    stops: [
      [0, "#020617"],
      [0.55, "#3a7df0"],
      [1, "#dce9ff"],
    ],
  },
  {
    // Perceptually ordered scientific map; good default for continuous intensity.
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
    // High-contrast scientific map; useful for dim structures on dark backgrounds.
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
