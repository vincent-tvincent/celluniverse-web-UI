export function formatPreloadLabel(label: string): string {
  const match = /^t(\d+)\s+(.+)$/.exec(label);
  if (!match) {
    return label;
  }
  return `frame t${match[1]} ${match[2]}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}
