import type {
  CellRecord,
  CreateJobPayload,
  DatasetPreviewManifest,
  DatasetUpload,
  DataSourceRoot,
  DeleteDatasetUploadResponse,
  InitialCsvPreset,
  JobManifest,
  JobRequest,
  JobStatus,
  LocalDataset,
  ParameterModule,
  LineageFrameSnapshot,
  LineageGraph,
  LineageLayout,
  LogResponse,
} from "./types";

const API_BASE = "/api";

export async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
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

export function getJobRequest(jobId: string): Promise<JobRequest> {
  return requestJson<JobRequest>(`/jobs/${encodeURIComponent(jobId)}/request`);
}

export async function getJobEffectiveConfig(jobId: string): Promise<string> {
  const response = await fetch(`${API_BASE}/jobs/${encodeURIComponent(jobId)}/files/effective-config.yaml`, {
    headers: { Accept: "text/yaml,text/plain" },
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${detail}`);
  }
  return response.text();
}

export function createJob(payload: CreateJobPayload): Promise<JobStatus> {
  return requestJson<JobStatus>("/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function updatePreparedJob(jobId: string, payload: CreateJobPayload): Promise<JobStatus> {
  return requestJson<JobStatus>(`/jobs/${encodeURIComponent(jobId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function startJob(jobId: string): Promise<JobStatus> {
  return requestJson<JobStatus>(`/jobs/${encodeURIComponent(jobId)}/start`, { method: "POST" });
}

export function cancelJob(jobId: string): Promise<JobStatus> {
  return requestJson<JobStatus>(`/jobs/${encodeURIComponent(jobId)}/cancel`, { method: "POST" });
}

export function archiveJob(jobId: string): Promise<JobStatus> {
  return requestJson<JobStatus>(`/jobs/${encodeURIComponent(jobId)}`, { method: "DELETE" });
}

export function cloneJob(jobId: string): Promise<JobStatus> {
  return requestJson<JobStatus>(`/jobs/${encodeURIComponent(jobId)}/clone`, { method: "POST" });
}

export function listDatasetUploads(): Promise<DatasetUpload[]> {
  return requestJson<DatasetUpload[]>("/datasets/uploads");
}

export function listLocalDatasets(): Promise<LocalDataset[]> {
  return requestJson<LocalDataset[]>("/datasets/local");
}

export function getUploadedDatasetPreview(uploadId: string): Promise<DatasetPreviewManifest> {
  return requestJson<DatasetPreviewManifest>(`/datasets/uploads/${encodeURIComponent(uploadId)}/preview`);
}

export function getLocalDatasetPreview(datasetId: string): Promise<DatasetPreviewManifest> {
  return requestJson<DatasetPreviewManifest>(`/datasets/local/${encodeURIComponent(datasetId)}/preview`);
}

export function deleteDatasetUpload(uploadId: string): Promise<DeleteDatasetUploadResponse> {
  return requestJson<DeleteDatasetUploadResponse>(`/datasets/uploads/${encodeURIComponent(uploadId)}`, { method: "DELETE" });
}

export function listDatasetRoots(): Promise<DataSourceRoot[]> {
  return requestJson<DataSourceRoot[]>("/datasets/roots");
}

export function addDatasetRoot(payload: { path: string; label?: string | null; enabled?: boolean; sourceRole?: "dataset" | "initial-csv" }): Promise<DataSourceRoot> {
  return requestJson<DataSourceRoot>("/datasets/roots", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function updateDatasetRoot(sourceId: string, payload: { label?: string | null; path?: string | null; enabled?: boolean; sourceRole?: "dataset" | "initial-csv" }): Promise<DataSourceRoot> {
  return requestJson<DataSourceRoot>(`/datasets/roots/${encodeURIComponent(sourceId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function deleteDatasetRoot(sourceId: string): Promise<DataSourceRoot> {
  return requestJson<DataSourceRoot>(`/datasets/roots/${encodeURIComponent(sourceId)}`, { method: "DELETE" });
}

export function listInitialCsvPresets(): Promise<InitialCsvPreset[]> {
  return requestJson<InitialCsvPreset[]>("/config/initial-csv-presets");
}

export function getParameterModule(moduleId: string): Promise<ParameterModule> {
  return requestJson<ParameterModule>(`/config/exposed-parameter-modules/${encodeURIComponent(moduleId)}`);
}

export function getBaseYaml(moduleId: string): Promise<{ moduleId: string; path: string; content: string }> {
  return requestJson<{ moduleId: string; path: string; content: string }>(`/config/base-yaml/${encodeURIComponent(moduleId)}`);
}

export async function uploadDataset(
  files: File[],
  onProgress?: (loaded: number, total: number) => void,
): Promise<{ uploadId: string; kind: string; files: string[] }> {
  const form = new FormData();
  files.forEach((file) => form.append("files", file));
  if (!onProgress) {
    return requestJson<{ uploadId: string; kind: string; files: string[] }>("/datasets/uploads", {
      method: "POST",
      body: form,
    });
  }
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE}/datasets/uploads`);
    xhr.responseType = "text";
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(event.loaded, event.total);
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as { uploadId: string; kind: string; files: string[] });
        } catch (error) {
          reject(error);
        }
        return;
      }
      reject(new Error(`${xhr.status} ${xhr.statusText}: ${xhr.responseText}`));
    };
    xhr.onerror = () => reject(new Error("upload failed"));
    xhr.send(form);
  });
}

export async function uploadInitialCsv(file: File): Promise<{ uploadId: string; kind: string; files: string[] }> {
  const form = new FormData();
  form.append("file", file);
  return requestJson<{ uploadId: string; kind: string; files: string[] }>("/uploads/initial-csv", {
    method: "POST",
    body: form,
  });
}

export async function uploadConfigYaml(file: File): Promise<{ uploadId: string; kind: string; files: string[] }> {
  const form = new FormData();
  form.append("file", file);
  return requestJson<{ uploadId: string; kind: string; files: string[] }>("/uploads/config-yaml", {
    method: "POST",
    body: form,
  });
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
