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

export type ColorMap = {
  id: ColorMapId;
  label: string;
  stops: [number, string][];
  sample: (value: number) => [number, number, number];
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  return [
    Number.parseInt(clean.slice(0, 2), 16),
    Number.parseInt(clean.slice(2, 4), 16),
    Number.parseInt(clean.slice(4, 6), 16),
  ];
}

function interpolateStops(stops: [number, string][], value: number): [number, number, number] {
  const t = clamp01(value);
  let left = stops[0];
  let right = stops[stops.length - 1];
  for (let i = 1; i < stops.length; i += 1) {
    if (t <= stops[i][0]) {
      left = stops[i - 1];
      right = stops[i];
      break;
    }
  }
  const range = Math.max(0.0001, right[0] - left[0]);
  const local = (t - left[0]) / range;
  const a = hexToRgb(left[1]);
  const b = hexToRgb(right[1]);
  return [
    Math.round(a[0] + (b[0] - a[0]) * local),
    Math.round(a[1] + (b[1] - a[1]) * local),
    Math.round(a[2] + (b[2] - a[2]) * local),
  ];
}

function createMap(id: ColorMapId, label: string, stops: [number, string][]): ColorMap {
  return {
    id,
    label,
    stops,
    sample: (value) => interpolateStops(stops, value),
  };
}

export const colorMaps: ColorMap[] = [
  createMap("gray", "Gray", [
    [0, "#000000"],
    [1, "#f7f7f2"],
  ]),
  createMap("cyan", "Cyan", [
    [0, "#001011"],
    [0.55, "#00a7b8"],
    [1, "#d8ffff"],
  ]),
  createMap("magenta", "Magenta", [
    [0, "#12000f"],
    [0.55, "#c43b9c"],
    [1, "#ffe0f8"],
  ]),
  createMap("green", "Green", [
    [0, "#031008"],
    [0.58, "#3bb56d"],
    [1, "#e4ffe8"],
  ]),
  createMap("yellow", "Yellow", [
    [0, "#151000"],
    [0.55, "#d6b83d"],
    [1, "#fff9ca"],
  ]),
  createMap("red", "Red", [
    [0, "#160300"],
    [0.55, "#d64a3b"],
    [1, "#ffe1d4"],
  ]),
  createMap("blue", "Blue", [
    [0, "#020617"],
    [0.55, "#3a7df0"],
    [1, "#dce9ff"],
  ]),
  createMap("viridis", "Viridis", [
    [0, "#440154"],
    [0.25, "#31688e"],
    [0.5, "#35b779"],
    [0.75, "#fde725"],
    [1, "#fff9bf"],
  ]),
  createMap("magma", "Magma", [
    [0, "#000004"],
    [0.28, "#51127c"],
    [0.58, "#b73779"],
    [0.8, "#fc8961"],
    [1, "#fcfdbf"],
  ]),
];

export function getColorMap(id: ColorMapId): ColorMap {
  return colorMaps.find((map) => map.id === id) ?? colorMaps[0];
}
