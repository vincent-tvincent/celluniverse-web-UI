import type {
  CellRecord,
  JobManifest,
  JobStatus,
  LineageFrameSnapshot,
  LineageGraph,
  LineageLayout,
  LogResponse,
} from "./types";

const API_BASE = "/api";

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${detail}`);
  }
  return response.json() as Promise<T>;
}

export function listJobs(): Promise<JobStatus[]> {
  return requestJson<JobStatus[]>("/jobs");
}

export function getJob(jobId: string): Promise<JobStatus> {
  return requestJson<JobStatus>(`/jobs/${encodeURIComponent(jobId)}`);
}

export function getManifest(jobId: string): Promise<JobManifest> {
  return requestJson<JobManifest>(`/jobs/${encodeURIComponent(jobId)}/manifest`);
}

export function getFrameCells(jobId: string, frame: number): Promise<CellRecord[]> {
  return requestJson<CellRecord[]>(`/jobs/${encodeURIComponent(jobId)}/frames/${frame}/cells`);
}

export function getLineage(jobId: string): Promise<LineageGraph> {
  return requestJson<LineageGraph>(`/jobs/${encodeURIComponent(jobId)}/lineage`);
}

export function getLineageLayout(jobId: string, background = "#070a0f"): Promise<LineageLayout> {
  return requestJson<LineageLayout>(
    `/jobs/${encodeURIComponent(jobId)}/lineage/layout?background=${encodeURIComponent(background)}`,
  );
}

export function getLineageFrame(jobId: string, frame: number): Promise<LineageFrameSnapshot> {
  return requestJson<LineageFrameSnapshot>(
    `/jobs/${encodeURIComponent(jobId)}/lineage/frames/${frame}`,
  );
}

export function getLogs(jobId: string, stream: "stdout" | "stderr", tail = 180): Promise<LogResponse> {
  return requestJson<LogResponse>(
    `/jobs/${encodeURIComponent(jobId)}/logs?stream=${stream}&tail=${tail}`,
  );
}

export function toApiUrl(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  return path;
}
