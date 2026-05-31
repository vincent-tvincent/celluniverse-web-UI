import { colorMapDefinitions, type ColorMapId } from "../theme/palette";

export type { ColorMapId } from "../theme/palette";

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
  ...colorMapDefinitions.map((definition) => createMap(definition.id, definition.label, definition.stops)),
];

export function getColorMap(id: ColorMapId): ColorMap {
  return colorMaps.find((map) => map.id === id) ?? colorMaps[0];
}
