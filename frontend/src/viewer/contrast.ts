export type ContrastLimits = [number, number];

export const DEFAULT_CONTRAST_LIMITS: ContrastLimits = [0, 1];
export const DEFAULT_CLEAN_CONTRAST_LIMITS: ContrastLimits = [0.025, 1];

export function clampContrastLimits(limits: ContrastLimits): ContrastLimits {
  const low = clamp01(limits[0]);
  const high = clamp01(limits[1]);
  if (high < low) {
    return [high, low];
  }
  return [low, high];
}

export function applyContrastLimits(value: number, limits: ContrastLimits): number {
  const [low, high] = clampContrastLimits(limits);
  const range = Math.max(0.0001, high - low);
  return clamp01((value - low) / range);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}
