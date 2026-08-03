import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isAbortLikeError } from "./errors";
import { loadPointCloudPreview, type PointCloudLoadProgress, type PointCloudPreviewData } from "./pointCloud";

export type PointCloudPreloadTarget = {
  key: string;
  url: string;
  label: string;
  frame: number;
  order: number;
};

export type PointCloudPreloadState = {
  volumes: Record<string, PointCloudPreviewData>;
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

const initialState: PointCloudPreloadState = {
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

const EMPTY_PROTECTED_URLS: ReadonlySet<string> = new Set();

export function usePointCloudPreload(
  targets: PointCloudPreloadTarget[],
  preloadConcurrency: number,
  paused = false,
  protectedUrls: ReadonlySet<string> = EMPTY_PROTECTED_URLS,
): PointCloudPreloadState {
  const uniqueTargets = useMemo(() => dedupeTargets(targets), [targets]);
  const signature = useMemo(
    () => uniqueTargets.map((target) => `${target.key}\u0000${target.url}`).join("\u0001"),
    [uniqueTargets],
  );
  const protectedSignature = useMemo(
    () => Array.from(protectedUrls, canonicalPointCloudUrl).sort().join("\u0001"),
    [protectedUrls],
  );
  const protectedResources = useMemo(
    () => new Set(protectedSignature ? protectedSignature.split("\u0001") : []),
    [protectedSignature],
  );

  const [state, setState] = useState<PointCloudPreloadState>(initialState);
  const targetMapRef = useRef(new Map<string, PointCloudPreloadTarget>());
  const volumesRef = useRef<Record<string, PointCloudPreviewData>>({});
  const errorsRef = useRef<Record<string, string>>({});
  const progressByKeyRef = useRef(new Map<string, PointCloudLoadProgress>());
  const finishedRef = useRef(new Set<string>());
  const loadingRef = useRef(new Set<string>());
  const loadingTargetsRef = useRef(new Map<string, PointCloudPreloadTarget>());
  const controllersRef = useRef(new Map<string, AbortController>());
  const queueRef = useRef<PointCloudPreloadTarget[]>([]);
  const activeRef = useRef(0);
  const currentRef = useRef<{ label: string; phase: "download" | "decode" } | undefined>(undefined);
  const startedAtRef = useRef<number | undefined>(undefined);

  const publish = useCallback(() => {
    const activeTargets = Array.from(targetMapRef.current.values());
    const summary = summarizeProgress(activeTargets, finishedRef.current, progressByKeyRef.current);
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
      progress: summary.progress,
      loadedBytes: summary.loadedBytes,
      totalBytes: summary.totalBytes,
      bytesPerSecond: elapsedSeconds > 0 && summary.loadedBytes > 0 ? summary.loadedBytes / elapsedSeconds : 0,
      currentLabel: currentRef.current?.label ?? "",
      currentPhase: currentRef.current?.phase ?? (activeRef.current > 0 ? "download" : "idle"),
      queuedFiles: queueRef.current.length,
      activeFiles: activeRef.current,
      isLoading,
    });
  }, []);

  const pumpRef = useRef<() => void>(() => undefined);

  const startLoad = useCallback((target: PointCloudPreloadTarget) => {
    const controller = new AbortController();
    activeRef.current += 1;
    loadingRef.current.add(target.key);
    loadingTargetsRef.current.set(target.key, target);
    controllersRef.current.set(target.key, controller);
    currentRef.current = { label: target.label, phase: "download" };
    publish();

    void loadPointCloudPreview(target.url, (progress) => {
      if (!targetMapRef.current.has(target.key)) {
        return;
      }
      progressByKeyRef.current.set(target.key, progress);
      currentRef.current = { label: target.label, phase: "download" };
      publish();
    }, controller.signal)
      .then((volume) => {
        if (targetMapRef.current.has(target.key)) {
          volumesRef.current[target.key] = volume;
          delete errorsRef.current[target.key];
        }
      })
      .catch((error: Error) => {
        if (targetMapRef.current.has(target.key) && !isAbortLikeError(error)) {
          errorsRef.current[target.key] = error.message;
        }
      })
      .finally(() => {
        if (controllersRef.current.get(target.key) === controller) {
          controllersRef.current.delete(target.key);
          loadingTargetsRef.current.delete(target.key);
        }
        activeRef.current = Math.max(0, activeRef.current - 1);
        loadingRef.current.delete(target.key);
        if (controller.signal.aborted) {
          finishedRef.current.delete(target.key);
          progressByKeyRef.current.delete(target.key);
        } else {
          finishedRef.current.add(target.key);
        }
        currentRef.current = undefined;
        publish();
        pumpRef.current();
      });
  }, [publish]);

  const pump = useCallback(() => {
    if (paused) {
      publish();
      return;
    }
    const maxConcurrentLoads = Math.max(1, Math.min(2, Math.round(preloadConcurrency)));
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
  }, [paused, preloadConcurrency, publish, startLoad]);

  pumpRef.current = pump;

  useEffect(() => {
    const nextKeys = new Set(uniqueTargets.map((target) => target.key));
    for (const [key, controller] of controllersRef.current) {
      const loadingTarget = loadingTargetsRef.current.get(key);
      const protectedResource = loadingTarget
        ? protectedResources.has(canonicalPointCloudUrl(loadingTarget.url))
        : false;
      if ((paused || !nextKeys.has(key)) && !protectedResource) {
        controller.abort();
      }
    }

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

    if (!startedAtRef.current) {
      startedAtRef.current = Date.now();
    }
    targetMapRef.current = new Map(uniqueTargets.map((target) => [target.key, target]));
    volumesRef.current = pickKnown(volumesRef.current, nextKeys);
    errorsRef.current = pickKnown(errorsRef.current, nextKeys);
    progressByKeyRef.current = pickProgress(progressByKeyRef.current, nextKeys);
    finishedRef.current = pickSet(finishedRef.current, nextKeys);
    queueRef.current = uniqueTargets.filter((target) => (
      !volumesRef.current[target.key] &&
      !errorsRef.current[target.key] &&
      !loadingRef.current.has(target.key)
    ));
    publish();
    if (!paused) {
      pump();
    }

    return undefined;
  }, [paused, protectedResources, pump, publish, signature, uniqueTargets]);

  useEffect(() => () => {
    controllersRef.current.forEach((controller) => controller.abort());
  }, []);

  return state;
}

function canonicalPointCloudUrl(url: string): string {
  const queryIndex = url.indexOf("?");
  const hashIndex = url.indexOf("#");
  const end = [queryIndex, hashIndex]
    .filter((index) => index >= 0)
    .reduce((lowest, index) => Math.min(lowest, index), url.length);
  return url.slice(0, end);
}

function dedupeTargets(targets: PointCloudPreloadTarget[]): PointCloudPreloadTarget[] {
  const seen = new Set<string>();
  const unique: PointCloudPreloadTarget[] = [];
  for (const target of targets) {
    if (seen.has(target.key)) {
      continue;
    }
    seen.add(target.key);
    unique.push(target);
  }
  return unique;
}

function countKnown<T>(targets: PointCloudPreloadTarget[], values: Record<string, T>): number {
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
  progress: Map<string, PointCloudLoadProgress>,
  allowedKeys: Set<string>,
): Map<string, PointCloudLoadProgress> {
  const next = new Map<string, PointCloudLoadProgress>();
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
  targets: PointCloudPreloadTarget[],
  finished: Set<string>,
  progressByKey: Map<string, PointCloudLoadProgress>,
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
    const targetTotalBytes = progress.total ?? 0;
    if (targetTotalBytes > 0) {
      totalBytes += targetTotalBytes;
    }
    if (finished.has(target.key) && targetTotalBytes > 0) {
      loadedBytes += targetTotalBytes;
    } else {
      loadedBytes += progress.loaded;
    }
  }

  return {
    progress: targets.length ? progressUnits / targets.length : 0,
    loadedBytes,
    totalBytes,
  };
}
