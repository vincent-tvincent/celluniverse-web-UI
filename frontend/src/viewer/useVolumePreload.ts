import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadTiffVolume, type PreviewDecodeOptions, type TiffLoadProgress, type VolumeData } from "./tiff";

export type VolumePreloadTarget = {
  key: string;
  url: string;
  label: string;
  options: PreviewDecodeOptions;
};

export type VolumePreloadState = {
  volumes: Record<string, VolumeData>;
  errors: Record<string, string>;
  totalFiles: number;
  readyFiles: number;
  failedFiles: number;
  progress: number;
  loadedBytes: number;
  totalBytes: number;
  bytesPerSecond: number;
  currentLabel: string;
  currentPhase: "download" | "decode" | "idle";
  queuedFiles: number;
  activeFiles: number;
  isLoading: boolean;
};

const initialState: VolumePreloadState = {
  volumes: {},
  errors: {},
  totalFiles: 0,
  readyFiles: 0,
  failedFiles: 0,
  progress: 0,
  loadedBytes: 0,
  totalBytes: 0,
  bytesPerSecond: 0,
  currentLabel: "",
  currentPhase: "idle",
  queuedFiles: 0,
  activeFiles: 0,
  isLoading: false,
};

export function useVolumePreload(targets: VolumePreloadTarget[], preloadConcurrency: number): VolumePreloadState {
  const uniqueTargets = useMemo(() => dedupeTargets(targets), [targets]);
  const signature = useMemo(
    () => uniqueTargets.map((target) => `${target.key}\u0000${target.url}`).join("\u0001"),
    [uniqueTargets],
  );

  const [state, setState] = useState<VolumePreloadState>(initialState);
  const targetMapRef = useRef(new Map<string, VolumePreloadTarget>());
  const volumesRef = useRef<Record<string, VolumeData>>({});
  const errorsRef = useRef<Record<string, string>>({});
  const progressByKeyRef = useRef(new Map<string, TiffLoadProgress>());
  const finishedRef = useRef(new Set<string>());
  const loadingRef = useRef(new Set<string>());
  const queueRef = useRef<VolumePreloadTarget[]>([]);
  const activeRef = useRef(0);
  const currentRef = useRef<{ label: string; phase: "download" | "decode" } | undefined>(undefined);
  const startedAtRef = useRef<number | undefined>(undefined);

  const publish = useCallback(() => {
    const activeTargets = Array.from(targetMapRef.current.values());
    const progressSummary = summarizeProgress(activeTargets, finishedRef.current, progressByKeyRef.current);
    const elapsedSeconds = startedAtRef.current ? Math.max(0.001, (Date.now() - startedAtRef.current) / 1000) : 0;
    const readyFiles = countKnown(activeTargets, volumesRef.current);
    const failedFiles = countKnown(activeTargets, errorsRef.current);
    const isLoading = readyFiles + failedFiles < activeTargets.length;
    setState({
      volumes: { ...volumesRef.current },
      errors: { ...errorsRef.current },
      totalFiles: activeTargets.length,
      readyFiles,
      failedFiles,
      progress: progressSummary.progress,
      loadedBytes: progressSummary.loadedBytes,
      totalBytes: progressSummary.totalBytes,
      bytesPerSecond: elapsedSeconds > 0 && progressSummary.loadedBytes > 0
        ? progressSummary.loadedBytes / elapsedSeconds
        : 0,
      currentLabel: currentRef.current?.label ?? "",
      currentPhase: currentRef.current?.phase ?? (activeRef.current > 0 ? "download" : "idle"),
      queuedFiles: queueRef.current.length,
      activeFiles: activeRef.current,
      isLoading,
    });
  }, []);

  const pumpRef = useRef<() => void>(() => undefined);

  const startLoad = useCallback((target: VolumePreloadTarget) => {
    activeRef.current += 1;
    loadingRef.current.add(target.key);
    currentRef.current = { label: target.label, phase: "download" };
    publish();

    void loadTiffVolume(target.url, target.options, (progress) => {
      if (!targetMapRef.current.has(target.key)) {
        return;
      }
      const previous = progressByKeyRef.current.get(target.key);
      progressByKeyRef.current.set(target.key, { ...previous, ...progress, phase: progress.phase });
      currentRef.current = { label: target.label, phase: progress.phase };
      publish();
    })
      .then((volume) => {
        if (targetMapRef.current.has(target.key)) {
          volumesRef.current[target.key] = volume;
          delete errorsRef.current[target.key];
        }
      })
      .catch((error: Error) => {
        if (targetMapRef.current.has(target.key)) {
          errorsRef.current[target.key] = error.message;
        }
      })
      .finally(() => {
        activeRef.current = Math.max(0, activeRef.current - 1);
        loadingRef.current.delete(target.key);
        finishedRef.current.add(target.key);
        currentRef.current = undefined;
        publish();
        pumpRef.current();
      });
  }, [publish]);

  const pump = useCallback(() => {
    const maxConcurrentLoads = Math.max(1, Math.min(6, Math.round(preloadConcurrency)));
    while (activeRef.current < maxConcurrentLoads && queueRef.current.length > 0) {
      const target = queueRef.current.shift();
      if (!target) {
        break;
      }
      if (
        !targetMapRef.current.has(target.key) ||
        volumesRef.current[target.key] ||
        errorsRef.current[target.key] ||
        loadingRef.current.has(target.key)
      ) {
        continue;
      }
      startLoad(target);
    }
    publish();
  }, [preloadConcurrency, publish, startLoad]);

  pumpRef.current = pump;

  useEffect(() => {
    if (!uniqueTargets.length) {
      targetMapRef.current = new Map();
      volumesRef.current = {};
      errorsRef.current = {};
      progressByKeyRef.current = new Map();
      finishedRef.current = new Set();
      loadingRef.current = new Set();
      queueRef.current = [];
      activeRef.current = 0;
      currentRef.current = undefined;
      startedAtRef.current = undefined;
      setState(initialState);
      return undefined;
    }

    const nextKeys = new Set(uniqueTargets.map((target) => target.key));
    if (!startedAtRef.current) {
      startedAtRef.current = Date.now();
    }
    targetMapRef.current = new Map(uniqueTargets.map((target) => [target.key, target]));
    volumesRef.current = pickKnown(volumesRef.current, nextKeys);
    errorsRef.current = pickKnown(errorsRef.current, nextKeys);
    progressByKeyRef.current = pickProgress(progressByKeyRef.current, nextKeys);
    finishedRef.current = pickSet(finishedRef.current, nextKeys);
    queueRef.current = queueRef.current.filter((target) => nextKeys.has(target.key));

    const queuedKeys = new Set(queueRef.current.map((target) => target.key));
    for (const target of uniqueTargets) {
      if (
        volumesRef.current[target.key] ||
        errorsRef.current[target.key] ||
        loadingRef.current.has(target.key) ||
        queuedKeys.has(target.key)
      ) {
        continue;
      }
      queueRef.current.push(target);
      queuedKeys.add(target.key);
    }
    publish();
    pump();

    return undefined;
  }, [pump, publish, signature, uniqueTargets]);

  return state;
}

function dedupeTargets(targets: VolumePreloadTarget[]): VolumePreloadTarget[] {
  const seen = new Set<string>();
  const unique: VolumePreloadTarget[] = [];
  for (const target of targets) {
    if (seen.has(target.key)) {
      continue;
    }
    seen.add(target.key);
    unique.push(target);
  }
  return unique;
}

function countKnown<T>(targets: VolumePreloadTarget[], values: Record<string, T>): number {
  return targets.reduce(
    (count, target) => count + (Object.prototype.hasOwnProperty.call(values, target.key) ? 1 : 0),
    0,
  );
}

function pickKnown<T>(values: Record<string, T>, allowedKeys: Set<string>): Record<string, T> {
  const next: Record<string, T> = {};
  for (const [key, value] of Object.entries(values)) {
    if (allowedKeys.has(key)) {
      next[key] = value;
    }
  }
  return next;
}

function pickProgress(
  progress: Map<string, TiffLoadProgress>,
  allowedKeys: Set<string>,
): Map<string, TiffLoadProgress> {
  const next = new Map<string, TiffLoadProgress>();
  for (const [key, value] of progress) {
    if (allowedKeys.has(key)) {
      next.set(key, value);
    }
  }
  return next;
}

function pickSet(values: Set<string>, allowedKeys: Set<string>): Set<string> {
  const next = new Set<string>();
  for (const value of values) {
    if (allowedKeys.has(value)) {
      next.add(value);
    }
  }
  return next;
}

function summarizeProgress(
  targets: VolumePreloadTarget[],
  finished: Set<string>,
  progressByKey: Map<string, TiffLoadProgress>,
): { progress: number; loadedBytes: number; totalBytes: number } {
  let progressUnits = 0;
  let loadedBytes = 0;
  let totalBytes = 0;

  for (const target of targets) {
    if (finished.has(target.key)) {
      progressUnits += 1;
    }

    const progress = progressByKey.get(target.key);
    if (!progress) {
      continue;
    }

    const targetTotalBytes = progress.totalBytes ?? 0;
    if (targetTotalBytes > 0) {
      totalBytes += targetTotalBytes;
    }
    if (finished.has(target.key) && targetTotalBytes > 0) {
      loadedBytes += targetTotalBytes;
    } else if (progress.loadedBytes != null) {
      loadedBytes += progress.loadedBytes;
    }

    if (finished.has(target.key)) {
      continue;
    }

    if (progress.phase === "decode" && progress.decodedSlices != null && progress.totalSlices) {
      progressUnits += 0.85 + Math.min(0.15, (progress.decodedSlices / progress.totalSlices) * 0.15);
    } else if (progress.loadedBytes != null && progress.totalBytes) {
      progressUnits += Math.min(0.85, (progress.loadedBytes / progress.totalBytes) * 0.85);
    } else {
      progressUnits += 0.1;
    }
  }

  return {
    progress: targets.length ? Math.min(1, progressUnits / targets.length) : 0,
    loadedBytes,
    totalBytes,
  };
}
