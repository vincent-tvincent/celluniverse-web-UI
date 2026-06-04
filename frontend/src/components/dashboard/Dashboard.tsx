import { useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArrowDownToLine,
  Copy,
  Database,
  Download,
  Edit3,
  Eye,
  FileCog,
  FileText,
  FolderOpen,
  Gauge,
  HardDrive,
  LayoutGrid,
  List,
  LoaderCircle,
  Menu,
  MonitorPlay,
  MoreVertical,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Plus,
  RefreshCcw,
  Search,
  Settings,
  Square,
  Trash2,
  Upload,
} from "lucide-react";
import {
  archiveJob,
  cancelJob,
  cloneJob,
  createJob,
  deleteDatasetRoot,
  deleteDatasetUpload,
  addDatasetRoot,
  getBaseYaml,
  getJobEffectiveConfig,
  getJobRequest,
  getParameterModule,
  listDatasetRoots,
  listDatasetUploads,
  listInitialCsvPresets,
  listJobs,
  listLocalDatasets,
  resumeJob,
  startJob,
  updateDatasetRoot,
  updatePreparedJob,
  uploadConfigYaml,
  uploadDataset,
  uploadInitialCsv,
} from "../../api";
import type {
  CreateJobPayload,
  DatasetUpload,
  DataSourceRoot,
  InitialCsvPreset,
  JobRequest,
  JobStatus,
  LocalDataset,
  ParameterField,
} from "../../types";

export type DashboardTab = "jobs" | "new" | "datasets" | "outputs" | "settings";
type DisplayMode = "block" | "list";
type DataSourceRole = "dataset" | "initial-csv";
export type DatasetSource =
  | { id: string; kind: "upload"; label: string; upload: DatasetUpload }
  | { id: string; kind: "local"; label: string; local: LocalDataset };

type PendingUpload = {
  mode: "files" | "folder";
  files: File[];
  accepted: File[];
  ignoredCount: number;
  ignoredSubfolderCount: number;
  folderName?: string;
  totalBytes: number;
  warnings: string[];
};

export type ConfirmIntent = {
  title: string;
  message: string;
  sequence: string;
  confirmLabel: string;
  onConfirm: () => void;
};

type ContextMenuState = {
  x: number;
  y: number;
  kind: "job" | "dataset";
  id: string;
} | null;

const JOB_VIEW_KEY = "celluniverse-dashboard-job-view";
const DATASET_VIEW_KEY = "celluniverse-dashboard-dataset-view";
const DATA_SOURCE_VIEW_KEY = "celluniverse-dashboard-data-source-view";
const SIDEBAR_KEY = "celluniverse-dashboard-sidebar-collapsed";
const DEFAULT_MODULE_ID = "debug-basic";

const tabs: { id: DashboardTab; label: string; icon: ReactNode }[] = [
  { id: "jobs", label: "Jobs", icon: <Gauge size={17} /> },
  { id: "new", label: "New Job", icon: <FileCog size={17} /> },
  { id: "datasets", label: "Datasets", icon: <Database size={17} /> },
  { id: "outputs", label: "Outputs", icon: <ArrowDownToLine size={17} /> },
  { id: "settings", label: "Settings", icon: <Settings size={17} /> },
];

export default function Dashboard({
  tab,
  initialDatasetId = "",
  onChangeTab,
  onOpenMonitor,
  onPreviewDataset,
}: {
  tab: DashboardTab;
  initialDatasetId?: string;
  onChangeTab: (tab: DashboardTab) => void;
  onOpenMonitor: (job: JobStatus, quickPreview?: boolean) => void;
  onPreviewDataset: (kind: "upload" | "local", datasetId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [sidebarCollapsed, setSidebarCollapsed] = useStoredBoolean(SIDEBAR_KEY, false);
  const [jobView, setJobView] = useStoredDisplayMode(JOB_VIEW_KEY, "block");
  const [datasetView, setDatasetView] = useStoredDisplayMode(DATASET_VIEW_KEY, "block");
  const [dataSourceView, setDataSourceView] = useStoredDisplayMode(DATA_SOURCE_VIEW_KEY, "block");
  const [seedDatasetId, setSeedDatasetId] = useState<string>(initialDatasetId);
  const [editingJobId, setEditingJobId] = useState<string | null>(null);
  const [confirmIntent, setConfirmIntent] = useState<ConfirmIntent | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [pendingUpload, setPendingUpload] = useState<PendingUpload | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [jobSearch, setJobSearch] = useState("");
  const [datasetSearch, setDatasetSearch] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  const jobsQuery = useQuery({ queryKey: ["jobs"], queryFn: listJobs, refetchInterval: 2000 });
  const uploadsQuery = useQuery({ queryKey: ["dataset-uploads"], queryFn: listDatasetUploads, refetchInterval: 5000 });
  const localDatasetsQuery = useQuery({ queryKey: ["local-datasets"], queryFn: listLocalDatasets, staleTime: 10000 });
  const datasetRootsQuery = useQuery({ queryKey: ["dataset-roots"], queryFn: listDatasetRoots, staleTime: 10000 });
  const initialCsvQuery = useQuery({ queryKey: ["initial-csv-presets"], queryFn: listInitialCsvPresets, staleTime: 10000 });

  const jobs = useMemo(() => sortJobs(jobsQuery.data ?? []), [jobsQuery.data]);
  const uploads = uploadsQuery.data ?? [];
  const localDatasets = localDatasetsQuery.data ?? [];
  const datasetSources = useMemo(() => buildDatasetSources(uploads, localDatasets), [uploads, localDatasets]);
  const filteredJobs = useMemo(() => filterJobs(jobs, jobSearch), [jobSearch, jobs]);
  const filteredDatasets = useMemo(() => filterDatasets(datasetSources, datasetSearch), [datasetSearch, datasetSources]);
  const dashboardBusy = (jobsQuery.isFetching && !jobs.length) || (uploadsQuery.isFetching && !uploads.length) || (localDatasetsQuery.isFetching && !localDatasets.length);
  const delayedDashboardLoading = useDelayedLoading(dashboardBusy, `${tab}:${jobs.length}:${uploads.length}:${localDatasets.length}`);

  useEffect(() => {
    if (!initialDatasetId) return;
    setEditingJobId(null);
    setSeedDatasetId(initialDatasetId);
  }, [initialDatasetId]);

  const startMutation = useMutation({
    mutationFn: startJob,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["jobs"] }),
  });
  const cancelMutation = useMutation({
    mutationFn: cancelJob,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["jobs"] }),
  });

  const resumeMutation = useMutation({
    mutationFn: resumeJob,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["jobs"] }),
  });
  const archiveMutation = useMutation({
    mutationFn: archiveJob,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["jobs"] }),
  });
  const cloneMutation = useMutation({
    mutationFn: cloneJob,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["jobs"] }),
  });
  const deleteUploadMutation = useMutation({
    mutationFn: deleteDatasetUpload,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["dataset-uploads"] }),
  });
  const refreshDataRoots = () => {
    void queryClient.invalidateQueries({ queryKey: ["dataset-roots"] });
    void queryClient.invalidateQueries({ queryKey: ["local-datasets"] });
    void queryClient.invalidateQueries({ queryKey: ["initial-csv-presets"] });
  };
  const addRootMutation = useMutation({
    mutationFn: addDatasetRoot,
    onSuccess: refreshDataRoots,
  });
  const updateRootMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => updateDatasetRoot(id, { enabled }),
    onSuccess: refreshDataRoots,
  });
  const deleteRootMutation = useMutation({
    mutationFn: deleteDatasetRoot,
    onSuccess: refreshDataRoots,
  });
  const uploadMutation = useMutation({
    mutationFn: (files: File[]) => uploadDataset(files, (loaded, total) => {
      setUploadProgress(total > 0 ? loaded / total : null);
    }),
    onSuccess: () => {
      setPendingUpload(null);
      setUploadProgress(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      if (folderInputRef.current) folderInputRef.current.value = "";
      void queryClient.invalidateQueries({ queryKey: ["dataset-uploads"] });
    },
    onError: () => setUploadProgress(null),
  });

  const requestDanger = (title: string, message: string, confirmLabel: string, onConfirm: () => void) => {
    setConfirmIntent({ title, message, confirmLabel, sequence: randomSequence(), onConfirm });
  };

  const handleLifecycle = (job: JobStatus) => {
    if (job.state === "prepared") {
      startMutation.mutate(job.id);
      return;
    }
    if (job.resumeAvailable) {
      resumeMutation.mutate(job.id);
      return;
    }
    if (job.state === "running" || job.state === "queued") {
      requestDanger(
        "Terminate Job",
        `${job.label ?? job.id} is ${job.state}. Partial outputs may remain available after termination.`,
        "Terminate",
        () => cancelMutation.mutate(job.id),
      );
    }
  };

  const handleArchive = (job: JobStatus) => {
    requestDanger(
      "Archive Job",
      `${job.label ?? job.id} will be hidden from the dashboard. Runtime files are kept on disk.`,
      "Archive",
      () => archiveMutation.mutate(job.id),
    );
  };

  const handleCloneJob = async (job: JobStatus) => {
    try {
      const clone = await cloneMutation.mutateAsync(job.id);
      setSeedDatasetId("");
      setEditingJobId(clone.id);
      onChangeTab("new");
    } catch {
      // The mutation error is surfaced through React Query's state when the form reloads.
    }
  };

  const handlePreviewDataset = (dataset: DatasetSource) => {
    onPreviewDataset(dataset.kind, dataset.kind === "upload" ? dataset.upload.uploadId : dataset.local.id);
  };

  const handleDeleteDataset = (dataset: DatasetSource) => {
    if (dataset.kind !== "upload") return;
    requestDanger(
      "Delete Uploaded Dataset",
      `${dataset.label} will be removed from dashboard uploads. Jobs using it will block this operation.`,
      "Delete",
      () => deleteUploadMutation.mutate(dataset.upload.uploadId),
    );
  };

  const openCreateForDataset = (datasetId: string) => {
    setEditingJobId(null);
    setSeedDatasetId(datasetId);
    onChangeTab("new");
  };

  const openEditJob = (jobId: string) => {
    setSeedDatasetId("");
    setEditingJobId(jobId);
    onChangeTab("new");
  };

  const handleUploadSelection = (files: FileList | null, mode: "files" | "folder") => {
    const allFiles = Array.from(files ?? []);
    setUploadProgress(null);
    if (!allFiles.length) {
      setPendingUpload(null);
      return;
    }
    setPendingUpload(scanSelectedFiles(allFiles, mode));
    onChangeTab("datasets");
  };

  const contextJob = contextMenu?.kind === "job" ? jobs.find((job) => job.id === contextMenu.id) : null;
  const contextDataset = contextMenu?.kind === "dataset" ? datasetSources.find((dataset) => dataset.id === contextMenu.id) : null;

  return (
    <main className="app-shell dashboard-shell" onClick={() => setContextMenu(null)}>
      <header className="top-bar dashboard-top-bar">
        <div className="brand-block">
          <div className="brand-mark"><Database size={20} /></div>
          <div><h1>CellUniverse Dashboard</h1></div>
        </div>
        <div className="dashboard-top-actions">
          <button className="action-button" type="button" onClick={() => onChangeTab("new")}>
            <FileCog size={16} /> New Job
          </button>
          <button className="icon-button" type="button" onClick={() => void queryClient.invalidateQueries()} title="Refresh">
            <RefreshCcw size={17} />
          </button>
        </div>
      </header>

      <section className={`dashboard-workspace ${sidebarCollapsed ? "nav-collapsed" : ""}`}>
        <aside className="dashboard-nav" aria-label="Dashboard tabs">
          <button
            type="button"
            className="dashboard-nav-toggle"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            title={sidebarCollapsed ? "Show tabs" : "Hide tabs"}
          >
            {sidebarCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
          </button>
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`dashboard-tab ${tab === item.id ? "active" : ""}`}
              onClick={() => onChangeTab(item.id)}
              title={item.label}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </aside>

        <section className="dashboard-main">
          {delayedDashboardLoading ? <DashboardLoadingOverlay label="Loading dashboard data" detail="refreshing jobs and datasets" /> : null}
          {tab === "jobs" ? (
            <DashboardSection
              title="Jobs"
              toolbar={
                <div className="dashboard-section-tools">
                  <SearchBox value={jobSearch} onChange={setJobSearch} placeholder="Search jobs" />
                  <DisplayToggle value={jobView} onChange={setJobView} />
                </div>
              }
            >
              <JobsPanel
                jobs={filteredJobs}
                view={jobView}
                loading={jobsQuery.isLoading}
                error={jobsQuery.error ?? cloneMutation.error}
                emptyLabel={jobSearch ? "No jobs match this filter" : "No jobs yet"}
                lifecyclePending={startMutation.isPending || cancelMutation.isPending}
                clonePending={cloneMutation.isPending}
                onLifecycle={handleLifecycle}
                onOpenMonitor={onOpenMonitor}
                onEdit={openEditJob}
                onClone={handleCloneJob}
                onArchive={handleArchive}
                onContextMenu={(event, job) => {
                  event.preventDefault();
                  setContextMenu({ x: event.clientX, y: event.clientY, kind: "job", id: job.id });
                }}
              />
            </DashboardSection>
          ) : null}

          {tab === "new" ? (
            <DashboardSection title={editingJobId ? "Edit Job" : "New Job"}>
              <NewJobPanel
                datasetSources={datasetSources}
                csvPresets={initialCsvQuery.data ?? []}
                seedDatasetId={seedDatasetId}
                editingJobId={editingJobId}
                onDone={(job) => {
                  setEditingJobId(null);
                  setSeedDatasetId("");
                  onChangeTab("jobs");
                  void queryClient.invalidateQueries({ queryKey: ["jobs"] });
                  if (job.state === "running" || job.state === "queued") {
                    onOpenMonitor(job);
                  }
                }}
              />
            </DashboardSection>
          ) : null}

          {tab === "datasets" ? (
            <DashboardSection
              title="Datasets"
              toolbar={
                <div className="dashboard-section-tools">
                  <SearchBox value={datasetSearch} onChange={setDatasetSearch} placeholder="Search datasets" />
                  <DisplayToggle value={datasetView} onChange={setDatasetView} />
                </div>
              }
            >
              <div className="dataset-upload-strip">
                <input
                  ref={fileInputRef}
                  className="hidden-file-input"
                  type="file"
                  accept=".tif,.tiff"
                  multiple
                  onChange={(event) => handleUploadSelection(event.target.files, "files")}
                />
                <input
                  ref={folderInputRef}
                  className="hidden-file-input"
                  type="file"
                  accept=".tif,.tiff"
                  multiple
                  onChange={(event) => handleUploadSelection(event.target.files, "folder")}
                  {...{ webkitdirectory: "", directory: "" }}
                />
                <button className="action-button" type="button" onClick={() => fileInputRef.current?.click()}>
                  <Upload size={16} /> Select Files
                </button>
                <button className="secondary-button" type="button" onClick={() => folderInputRef.current?.click()}>
                  <FolderOpen size={16} /> Select Folder
                </button>
                <button className="secondary-button" type="button" onClick={() => void queryClient.invalidateQueries({ queryKey: ["local-datasets"] })}>
                  <RefreshCcw size={15} /> Rescan Local
                </button>
              </div>
              {pendingUpload ? (
                <UploadScanPanel
                  scan={pendingUpload}
                  uploading={uploadMutation.isPending}
                  error={uploadMutation.error}
                  progress={uploadProgress}
                  onCancel={() => { setPendingUpload(null); setUploadProgress(null); }}
                  onUpload={() => { setUploadProgress(0); uploadMutation.mutate(pendingUpload.accepted); }}
                />
              ) : null}
              <DatasetsPanel
                datasets={filteredDatasets}
                view={datasetView}
                loading={uploadsQuery.isLoading || localDatasetsQuery.isLoading}
                error={uploadsQuery.error ?? localDatasetsQuery.error ?? deleteUploadMutation.error}
                emptyLabel={datasetSearch ? "No datasets match this filter" : "No datasets detected or uploaded yet"}
                deletePending={deleteUploadMutation.isPending}
                onCreateJob={openCreateForDataset}
                onPreview={handlePreviewDataset}
                onDelete={handleDeleteDataset}
                onContextMenu={(event, dataset) => {
                  event.preventDefault();
                  setContextMenu({ x: event.clientX, y: event.clientY, kind: "dataset", id: dataset.id });
                }}
              />
            </DashboardSection>
          ) : null}

          {tab === "outputs" ? (
            <DashboardSection title="Outputs">
              <OutputsPanel jobs={jobs} />
            </DashboardSection>
          ) : null}

          {tab === "settings" ? (
            <DashboardSection title="Settings">
              <SettingsPanel
                localDatasets={localDatasets}
                csvPresets={initialCsvQuery.data ?? []}
                dataSources={datasetRootsQuery.data ?? []}
                view={dataSourceView}
                onViewChange={setDataSourceView}
                onAdd={(path, sourceRole) => addRootMutation.mutate({ path, sourceRole })}
                onToggle={(source) => updateRootMutation.mutate({ id: source.id, enabled: !source.enabled })}
                onDelete={(source) => deleteRootMutation.mutate(source.id)}
                pending={addRootMutation.isPending || updateRootMutation.isPending || deleteRootMutation.isPending}
                error={datasetRootsQuery.error ?? addRootMutation.error ?? updateRootMutation.error ?? deleteRootMutation.error}
              />
            </DashboardSection>
          ) : null}
        </section>
      </section>

      {contextMenu ? (
        <ContextMenu
          state={contextMenu}
          job={contextJob ?? undefined}
          dataset={contextDataset ?? undefined}
          onClose={() => setContextMenu(null)}
          onOpenMonitor={(job, quick) => {
            setContextMenu(null);
            onOpenMonitor(job, quick);
          }}
          onLifecycle={(job) => {
            setContextMenu(null);
            handleLifecycle(job);
          }}
          onEdit={(jobId) => {
            setContextMenu(null);
            openEditJob(jobId);
          }}
          onClone={(job) => {
            setContextMenu(null);
            void handleCloneJob(job);
          }}
          onArchive={(job) => {
            setContextMenu(null);
            handleArchive(job);
          }}
          onCreateJob={(datasetId) => {
            setContextMenu(null);
            openCreateForDataset(datasetId);
          }}
          onPreview={(dataset) => {
            setContextMenu(null);
            handlePreviewDataset(dataset);
          }}
          onDeleteDataset={(dataset) => {
            setContextMenu(null);
            handleDeleteDataset(dataset);
          }}
        />
      ) : null}

      <DangerConfirmDialog intent={confirmIntent} onClose={() => setConfirmIntent(null)} />
    </main>
  );
}

function DashboardSection({ title, toolbar, children }: { title: string; toolbar?: ReactNode; children: ReactNode }) {
  return (
    <div className="dashboard-section">
      <div className="dashboard-section-bar">
        <h2>{title}</h2>
        {toolbar}
      </div>
      {children}
    </div>
  );
}

function JobsPanel({
  jobs,
  view,
  loading,
  error,
  emptyLabel,
  lifecyclePending,
  clonePending,
  onLifecycle,
  onOpenMonitor,
  onEdit,
  onClone,
  onArchive,
  onContextMenu,
}: {
  jobs: JobStatus[];
  view: DisplayMode;
  loading: boolean;
  error: unknown;
  emptyLabel: string;
  lifecyclePending: boolean;
  clonePending: boolean;
  onLifecycle: (job: JobStatus) => void;
  onOpenMonitor: (job: JobStatus, quickPreview?: boolean) => void;
  onEdit: (jobId: string) => void;
  onClone: (job: JobStatus) => void;
  onArchive: (job: JobStatus) => void;
  onContextMenu: (event: MouseEvent, job: JobStatus) => void;
}) {
  if (loading && !jobs.length) return <p className="dashboard-muted">Loading jobs</p>;
  if (error) return <p className="dashboard-error">{formatError(error)}</p>;
  if (!jobs.length) return <p className="dashboard-muted">{emptyLabel}</p>;
  return (
    <div className={view === "block" ? "job-block-grid" : "dashboard-list"}>
      {jobs.map((job) => (
        <JobItem
          key={job.id}
          job={job}
          view={view}
          lifecyclePending={lifecyclePending}
          clonePending={clonePending}
          onLifecycle={onLifecycle}
          onOpenMonitor={onOpenMonitor}
          onEdit={onEdit}
          onClone={onClone}
          onArchive={onArchive}
          onContextMenu={onContextMenu}
        />
      ))}
    </div>
  );
}

function JobItem({
  job,
  view,
  lifecyclePending,
  clonePending,
  onLifecycle,
  onOpenMonitor,
  onEdit,
  onClone,
  onArchive,
  onContextMenu,
}: {
  job: JobStatus;
  view: DisplayMode;
  lifecyclePending: boolean;
  clonePending: boolean;
  onLifecycle: (job: JobStatus) => void;
  onOpenMonitor: (job: JobStatus, quickPreview?: boolean) => void;
  onEdit: (jobId: string) => void;
  onClone: (job: JobStatus) => void;
  onArchive: (job: JobStatus) => void;
  onContextMenu: (event: MouseEvent, job: JobStatus) => void;
}) {
  const progress = Math.round((job.progress ?? 0) * 100);
  const canMonitor = job.partialOutputsAvailable || job.completedFrames > 0 || job.state === "completed" || job.state === "failed" || job.state === "cancelled";
  const lifecycle = getLifecycleLabel(job);
  const lifecycleIcon = lifecycle?.danger ? <Square size={14} /> : <Play size={14} />;
  const canClone = job.state !== "running" && job.state !== "queued";
  const rowClass = view === "block" ? "job-card dashboard-card job-item" : "dashboard-row job-item";
  return (
    <article className={rowClass} onContextMenu={(event) => onContextMenu(event, job)}>
      <div className="item-mainline">
        <div className="item-title-wrap">
          <span className={`state-dot ${job.state}`} />
          <strong>{job.label ?? job.id}</strong>
          <small>{job.id}</small>
        </div>
        <span className={`state-pill ${job.state}`}>{job.state}</span>
      </div>
      <div className="progress-track dashboard-progress"><div style={{ width: `${progress}%` }} /></div>
      <div className="item-metrics">
        <span>{job.completedFrames}/{job.totalFrames} frames</span>
        <span>current {job.currentFrame ?? "-"}</span>
        <span>range {job.firstFrame}-{job.lastFrame}</span>
      </div>
      <div className="item-actions job-actions">
        <button
          type="button"
          className={`${lifecycle?.danger ? "cancel-button" : "action-button"} job-lifecycle-button`}
          disabled={!lifecycle || lifecyclePending}
          onClick={() => lifecycle ? onLifecycle(job) : undefined}
        >
          {lifecycleIcon}
          {lifecycle?.label ?? "Start / Stop unavailable"}
        </button>
        <div className="job-action-row job-view-actions">
          <button className="action-button strong-action-button" type="button" disabled={!canMonitor} onClick={() => onOpenMonitor(job)}>
            <MonitorPlay size={15} /> View all
          </button>
          <button className="action-button strong-action-button" type="button" disabled={!canMonitor} onClick={() => onOpenMonitor(job, true)}>
            <MonitorPlay size={15} /> View last frame
          </button>
        </div>
        <div className="job-action-row job-manage-actions">
          {job.state === "prepared" ? (
            <button className="action-button" type="button" onClick={() => onEdit(job.id)}>
              <Edit3 size={15} /> Edit
            </button>
          ) : (
            <button className="action-button" type="button" disabled={!canClone || clonePending} onClick={() => onClone(job)} title="Duplicate this job as a prepared copy for editing">
              <Copy size={15} /> Duplicate
            </button>
          )}
          <a className="action-button" href={`/api/jobs/${encodeURIComponent(job.id)}/download`}>
            <Download size={15} /> Download
          </a>
          <button className="action-button" type="button" disabled={job.state === "running" || job.state === "queued"} onClick={() => onArchive(job)} title="Archive">
            <Archive size={15} /> Archive
          </button>
        </div>
      </div>
    </article>
  );
}

function DatasetsPanel({
  datasets,
  view,
  loading,
  error,
  emptyLabel,
  deletePending,
  onCreateJob,
  onPreview,
  onDelete,
  onContextMenu,
}: {
  datasets: DatasetSource[];
  view: DisplayMode;
  loading: boolean;
  error: unknown;
  emptyLabel: string;
  deletePending: boolean;
  onCreateJob: (datasetId: string) => void;
  onPreview: (dataset: DatasetSource) => void;
  onDelete: (dataset: DatasetSource) => void;
  onContextMenu: (event: MouseEvent, dataset: DatasetSource) => void;
}) {
  if (loading && !datasets.length) return <p className="dashboard-muted">Loading datasets</p>;
  if (error) return <p className="dashboard-error">{formatError(error)}</p>;
  if (!datasets.length) return <p className="dashboard-muted">{emptyLabel}</p>;
  return (
    <div className={view === "block" ? "dataset-block-grid" : "dashboard-list"}>
      {datasets.map((dataset) => (
        <DatasetItem
          key={dataset.id}
          dataset={dataset}
          view={view}
          deletePending={deletePending}
          onCreateJob={onCreateJob}
          onPreview={onPreview}
          onDelete={onDelete}
          onContextMenu={onContextMenu}
        />
      ))}
    </div>
  );
}

function DatasetItem({
  dataset,
  view,
  deletePending,
  onCreateJob,
  onPreview,
  onDelete,
  onContextMenu,
}: {
  dataset: DatasetSource;
  view: DisplayMode;
  deletePending: boolean;
  onCreateJob: (datasetId: string) => void;
  onPreview: (dataset: DatasetSource) => void;
  onDelete: (dataset: DatasetSource) => void;
  onContextMenu: (event: MouseEvent, dataset: DatasetSource) => void;
}) {
  const isLocal = dataset.kind === "local";
  const frameCount = isLocal ? dataset.local.frameCount : dataset.upload.fileCount;
  const bytes = isLocal ? dataset.local.totalBytes : dataset.upload.totalBytes;
  const source = isLocal ? dataset.local.source : "upload";
  const pattern = isLocal ? dataset.local.filePattern : dataset.upload.files[0]?.name ?? "uploaded TIFFs";
  return (
    <article className={view === "block" ? "dataset-card dashboard-card dataset-item" : "dashboard-row dataset-item"} onContextMenu={(event) => onContextMenu(event, dataset)}>
      <div className="item-mainline">
        <div className="item-title-wrap">
          <Database size={16} />
          <strong>{dataset.label}</strong>
          <small>{dataset.id}</small>
        </div>
        <span className="state-pill neutral">{isLocal ? "Local" : "Uploaded"}</span>
      </div>
      <div className="item-metrics">
        <span>{frameCount} files</span>
        <span>{formatBytes(bytes)}</span>
        <span>{source}</span>
      </div>
      <p className="dataset-pattern">{pattern}</p>
      <div className="item-actions">
        <button className="secondary-button icon-text-button" type="button" onClick={() => onPreview(dataset)}>
          <Eye size={15} /> Preview
        </button>
        <button className="action-button" type="button" onClick={() => onCreateJob(dataset.id)}>
          <FileCog size={15} /> Create Job
        </button>
        {!isLocal ? (
          <a className="secondary-button icon-text-button" href={`/api/datasets/uploads/${encodeURIComponent(dataset.upload.uploadId)}/download`}>
            <Download size={15} /> Download
          </a>
        ) : null}
        {!isLocal ? (
          <button className="icon-button small-icon-button" type="button" disabled={deletePending} onClick={() => onDelete(dataset)} title="Delete upload">
            <Trash2 size={15} />
          </button>
        ) : null}
        <button className="icon-button small-icon-button more-button" type="button" title="More" onClick={(event) => { event.stopPropagation(); onContextMenu(event, dataset); }}>
          <MoreVertical size={15} />
        </button>
      </div>
    </article>
  );
}

function NewJobPanel({
  datasetSources,
  csvPresets,
  seedDatasetId,
  editingJobId,
  onDone,
}: {
  datasetSources: DatasetSource[];
  csvPresets: InitialCsvPreset[];
  seedDatasetId: string;
  editingJobId: string | null;
  onDone: (job: JobStatus) => void;
}) {
  const [datasetId, setDatasetId] = useState(seedDatasetId);
  const [label, setLabel] = useState("");
  const [firstFrame, setFirstFrame] = useState(0);
  const [lastFrame, setLastFrame] = useState(0);
  const [initialCsvPath, setInitialCsvPath] = useState("");
  const [initialCsvFile, setInitialCsvFile] = useState<File | null>(null);
  const [moduleId] = useState(DEFAULT_MODULE_ID);
  const [overrides, setOverrides] = useState<Record<string, unknown>>({});
  const [yamlText, setYamlText] = useState("");
  const [yamlTouched, setYamlTouched] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const moduleQuery = useQuery({ queryKey: ["parameter-module", moduleId], queryFn: () => getParameterModule(moduleId) });
  const yamlQuery = useQuery({ queryKey: ["base-yaml", moduleId], queryFn: () => getBaseYaml(moduleId) });
  const editQuery = useQuery({
    queryKey: ["job-request", editingJobId],
    queryFn: () => getJobRequest(editingJobId!),
    enabled: Boolean(editingJobId),
  });
  const editYamlQuery = useQuery({
    queryKey: ["job-effective-config", editingJobId],
    queryFn: () => getJobEffectiveConfig(editingJobId!),
    enabled: Boolean(editingJobId),
  });
  const createMutation = useMutation({ mutationFn: createJob });
  const updateMutation = useMutation({ mutationFn: ({ jobId, payload }: { jobId: string; payload: CreateJobPayload }) => updatePreparedJob(jobId, payload) });

  const selectedDataset = datasetSources.find((dataset) => dataset.id === datasetId);

  useEffect(() => setDatasetId(seedDatasetId), [seedDatasetId]);

  useEffect(() => {
    if (!selectedDataset || editingJobId) return;
    if (selectedDataset.kind === "local") {
      setFirstFrame(selectedDataset.local.firstFrame);
      setLastFrame(selectedDataset.local.lastFrame);
    } else {
      setFirstFrame(0);
      setLastFrame(Math.max(0, selectedDataset.upload.fileCount - 1));
    }
  }, [editingJobId, selectedDataset]);

  useEffect(() => {
    if (!csvPresets.length || initialCsvPath || initialCsvFile) return;
    setInitialCsvPath(csvPresets[0].path);
  }, [csvPresets, initialCsvFile, initialCsvPath]);

  useEffect(() => {
    if (!moduleQuery.data) return;
    setOverrides((current) => {
      const next = { ...current };
      for (const group of moduleQuery.data.groups) {
        for (const field of group.fields) {
          if (next[field.path] === undefined && field.default !== undefined) {
            next[field.path] = field.default;
          }
        }
      }
      return next;
    });
  }, [moduleQuery.data]);

  useEffect(() => {
    if (!yamlQuery.data || yamlTouched || editingJobId) return;
    setYamlText(yamlQuery.data.content);
  }, [editingJobId, yamlQuery.data, yamlTouched]);

  useEffect(() => {
    const request = editQuery.data;
    if (!request) return;
    setLabel(request.label ?? "");
    setFirstFrame(request.firstFrame ?? 0);
    setLastFrame(request.lastFrame ?? 0);
    setInitialCsvPath(request.initialCsvPath ?? "");
    setInitialCsvFile(null);
    setOverrides(request.overrides ?? {});
    const match = datasetSources.find((dataset) => (
      dataset.kind === "upload"
        ? dataset.upload.uploadId === request.datasetId
        : dataset.local.inputPath === request.inputPath
    ));
    if (match) setDatasetId(match.id);
    setAdvancedOpen(true);
  }, [datasetSources, editQuery.data]);

  useEffect(() => {
    if (!editYamlQuery.data || yamlTouched) return;
    setYamlText(editYamlQuery.data);
  }, [editYamlQuery.data, yamlTouched]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    if (!selectedDataset) {
      setFormError("Select a dataset first.");
      return;
    }
    if (!initialCsvPath && !initialCsvFile) {
      setFormError("Select or upload an initial CSV.");
      return;
    }
    if (lastFrame < firstFrame) {
      setFormError("Last frame must be greater than or equal to first frame.");
      return;
    }
    const yamlError = validateYamlSanity(yamlText);
    if (yamlError) {
      setFormError(yamlError);
      setAdvancedOpen(true);
      return;
    }
    try {
      const initialUpload = initialCsvFile ? await uploadInitialCsv(initialCsvFile) : null;
      const configUpload = yamlText.trim()
        ? await uploadConfigYaml(new File([yamlText], "job-config.yaml", { type: "text/yaml" }))
        : null;
      const payload: CreateJobPayload = {
        label: label.trim() || null,
        type: "tracking",
        firstFrame,
        lastFrame,
        initialCsvPath: initialUpload ? null : initialCsvPath,
        initialCsvUploadId: initialUpload?.uploadId ?? null,
        configYamlUploadId: configUpload?.uploadId ?? null,
        parameterModuleId: moduleId,
        overrides,
        autoStart: false,
      };
      if (selectedDataset.kind === "upload") {
        payload.datasetId = selectedDataset.upload.uploadId;
        payload.inputPath = null;
      } else {
        payload.inputPath = selectedDataset.local.inputPath;
        payload.datasetId = null;
      }
      const job = editingJobId
        ? await updateMutation.mutateAsync({ jobId: editingJobId, payload })
        : await createMutation.mutateAsync(payload);
      onDone(job);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : String(error));
    }
  };

  const pending = createMutation.isPending || updateMutation.isPending;

  return (
    <form className="new-job-form" onSubmit={submit}>
      <div className="form-grid two-column-form">
        <label>
          <span>Dataset</span>
          <select value={datasetId} onChange={(event) => setDatasetId(event.target.value)}>
            <option value="">Select dataset</option>
            {datasetSources.map((dataset) => (
              <option key={dataset.id} value={dataset.id}>{dataset.label} ({dataset.kind})</option>
            ))}
          </select>
        </label>
        <label>
          <span>Job Name</span>
          <input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="optional" />
        </label>
        <label>
          <span>First Frame</span>
          <input type="number" value={firstFrame} onChange={(event) => setFirstFrame(Number(event.target.value))} />
        </label>
        <label>
          <span>Last Frame</span>
          <input type="number" value={lastFrame} onChange={(event) => setLastFrame(Number(event.target.value))} />
        </label>
        <label>
          <span>Initial CSV</span>
          <select value={initialCsvPath} onChange={(event) => { setInitialCsvPath(event.target.value); setInitialCsvFile(null); }}>
            <option value="">Select preset</option>
            {csvPresets.map((preset) => <option key={preset.id} value={preset.path}>{preset.label}</option>)}
          </select>
        </label>
        <label>
          <span>Upload CSV</span>
          <input type="file" accept=".csv" onChange={(event) => setInitialCsvFile(event.target.files?.[0] ?? null)} />
        </label>
      </div>

      <fieldset className="simple-config-panel">
        <legend>Simple Configuration</legend>
        {moduleQuery.data?.groups.map((group) => (
          <div className={`parameter-group ${isRuntimeGroup(group) ? "parameter-group-runtime" : ""}`} key={group.id}>
            <h3>{group.label}</h3>
            <div className="form-grid three-column-form">
              {group.fields.map((field) => (
                <ParameterControl
                  key={field.path}
                  field={field}
                  value={overrides[field.path]}
                  onChange={(value) => setOverrides((current) => ({ ...current, [field.path]: value }))}
                />
              ))}
            </div>
          </div>
        )) ?? <p className="dashboard-muted">Loading configuration controls</p>}
      </fieldset>

      <div className="advanced-yaml-panel">
        <button className="secondary-button" type="button" onClick={() => setAdvancedOpen(!advancedOpen)}>
          <FileCog size={15} /> {advancedOpen ? "Hide YAML" : "Edit YAML"}
        </button>
        {advancedOpen ? (
          <>
            <p className="dashboard-muted">Simple controls are applied after the YAML copy when the job is prepared.</p>
            {editYamlQuery.isFetching ? <p className="dashboard-muted">Loading effective YAML copy</p> : null}
            <textarea
              value={yamlText}
              onChange={(event) => { setYamlText(event.target.value); setYamlTouched(true); }}
              spellCheck={false}
              aria-label="Editable job YAML"
            />
          </>
        ) : null}
      </div>

      {formError ? <p className="dashboard-error">{formError}</p> : null}
      <div className="form-actions">
        <button className="action-button strong-action-button prepared-job-submit-button" type="submit" disabled={pending || !selectedDataset}>
          {pending ? <LoaderCircle size={15} /> : <FileCog size={15} />}
          {editingJobId ? "Save Prepared Job" : "Create Prepared Job"}
        </button>
      </div>
    </form>
  );
}

function isRuntimeGroup(group: { id: string; label: string }): boolean {
  return group.id.toLowerCase() === "runtime" || group.label.toLowerCase() === "runtime";
}

function ParameterControl({ field, value, onChange }: { field: ParameterField; value: unknown; onChange: (value: unknown) => void }) {
  if (field.type === "enum" && field.values?.length) {
    return (
      <label>
        <span>{field.label}</span>
        <select value={String(value ?? field.default ?? field.values[0])} onChange={(event) => onChange(event.target.value)}>
          {field.values.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </label>
    );
  }
  if (field.type === "integer" || field.type === "number") {
    return (
      <label>
        <span>{field.label}</span>
        <input
          type="number"
          min={field.min ?? undefined}
          max={field.max ?? undefined}
          value={Number(value ?? field.default ?? 0)}
          onChange={(event) => onChange(field.type === "integer" ? Math.round(Number(event.target.value)) : Number(event.target.value))}
        />
      </label>
    );
  }
  return (
    <label>
      <span>{field.label}</span>
      <input value={String(value ?? field.default ?? "")} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function UploadScanPanel({
  scan,
  uploading,
  error,
  progress,
  onUpload,
  onCancel,
}: {
  scan: PendingUpload;
  uploading: boolean;
  error: unknown;
  progress: number | null;
  onUpload: () => void;
  onCancel: () => void;
}) {
  const progressPercent = progress == null ? null : Math.round(Math.max(0, Math.min(1, progress)) * 100);
  return (
    <div className="upload-scan-panel">
      <div>
        <strong>{scan.mode === "folder" ? scan.folderName ?? "Selected folder" : "Selected files"}</strong>
        <p>{scan.accepted.length} TIFF files detected, {scan.ignoredCount} ignored, {scan.ignoredSubfolderCount} nested entries ignored.</p>
        <p>{formatBytes(scan.totalBytes)}</p>
        {scan.warnings.map((warning) => <p className="dashboard-error" key={warning}>{warning}</p>)}
        {progressPercent != null ? (
          <div className="upload-progress" aria-label="Upload progress">
            <div className="progress-track dashboard-progress"><div style={{ width: `${progressPercent}%` }} /></div>
            <span>{progressPercent}%</span>
          </div>
        ) : null}
        {error ? <p className="dashboard-error">{formatError(error)}</p> : null}
      </div>
      <div className="item-actions">
        <button className="action-button" type="button" disabled={!scan.accepted.length || uploading} onClick={onUpload}>
          {uploading ? <LoaderCircle size={15} /> : <Upload size={15} />} Upload Dataset
        </button>
        <button className="secondary-button" type="button" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function OutputsPanel({ jobs }: { jobs: JobStatus[] }) {
  const outputJobs = jobs.filter((job) => job.partialOutputsAvailable || job.completedFrames > 0 || job.state === "completed" || job.state === "failed" || job.state === "cancelled");
  if (!outputJobs.length) return <p className="dashboard-muted">No job outputs available</p>;
  return (
    <div className="dashboard-list">
      {outputJobs.map((job) => (
        <article key={job.id} className="dashboard-row">
          <div className="item-title-wrap"><strong>{job.label ?? job.id}</strong><small>{job.id}</small></div>
          <div className="item-metrics"><span>{job.state}</span><span>{job.completedFrames}/{job.totalFrames} frames</span></div>
          <a className="action-button" href={`/api/jobs/${encodeURIComponent(job.id)}/download`}><Download size={15} /> Download</a>
        </article>
      ))}
    </div>
  );
}

function SettingsPanel({
  localDatasets,
  csvPresets,
  dataSources,
  view,
  onViewChange,
  onAdd,
  onToggle,
  onDelete,
  pending,
  error,
}: {
  localDatasets: LocalDataset[];
  csvPresets: InitialCsvPreset[];
  dataSources: DataSourceRoot[];
  view: DisplayMode;
  onViewChange: (value: DisplayMode) => void;
  onAdd: (path: string, sourceRole: DataSourceRole) => void;
  onToggle: (source: DataSourceRoot) => void;
  onDelete: (source: DataSourceRoot) => void;
  pending: boolean;
  error?: unknown;
}) {
  const [path, setPath] = useState("");
  const [sourceRole, setSourceRole] = useState<DataSourceRole>("dataset");
  const enabledSources = dataSources.filter((source) => source.enabled);
  const presetSources = dataSources.filter((source) => source.preset);
  const csvSources = dataSources.filter((source) => source.sourceRole === "initial-csv");
  const tiffSources = dataSources.filter((source) => source.sourceRole !== "initial-csv" && !source.preset);
  const sourceClass = view === "block" ? "data-source-grid" : "dashboard-list";
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = path.trim();
    if (!trimmed) return;
    onAdd(trimmed, sourceRole);
    setPath("");
  };
  return (
    <div className="settings-stack">
      <div className="settings-stats-row">
        <section className="settings-block">
          <h3>Data Resources</h3>
          <dl className="metric-grid dashboard-metrics">
            <div><dt>Datasets</dt><dd>{localDatasets.length}</dd></div>
            <div><dt>Enabled Sources</dt><dd>{enabledSources.length}</dd></div>
            <div><dt>CSV Presets</dt><dd>{csvPresets.length}</dd></div>
          </dl>
        </section>
        <section className="settings-block">
          <h3>Source Types</h3>
          <dl className="metric-grid dashboard-metrics source-type-metrics">
            <div><dt>Preset</dt><dd>{presetSources.length}</dd></div>
            <div><dt>TIFF Image</dt><dd>{tiffSources.length}</dd></div>
            <div><dt>Initial CSV</dt><dd>{csvSources.length}</dd></div>
            <div><dt>Missing</dt><dd>{dataSources.filter((source) => !source.exists).length}</dd></div>
          </dl>
        </section>
      </div>

      <section className="data-source-manager">
        <div className="settings-section-bar">
          <div>
            <h3>Server Data Sources</h3>
            <p className="dashboard-muted">Preset roots come from backend config; added dataset and initial CSV roots are stored in runtime settings.</p>
          </div>
          <DisplayToggle value={view} onChange={onViewChange} />
        </div>
        <form className="data-source-add-form" onSubmit={submit}>
          <label>
            Source type
            <select value={sourceRole} onChange={(event) => setSourceRole(event.target.value as DataSourceRole)}>
              <option value="dataset">TIFF dataset source</option>
              <option value="initial-csv">Initial CSV source</option>
            </select>
          </label>
          <label>
            Add server path
            <input value={path} onChange={(event) => setPath(event.target.value)} placeholder={sourceRole === "initial-csv" ? "/home/puv/celluniverse/CellUniverse/C++/config" : "/home/puv/celluniverse/input"} />
          </label>
          <button className="action-button strong-action-button" type="submit" disabled={pending || !path.trim()}>
            <Plus size={15} /> Add Source
          </button>
        </form>
        {error ? <p className="dashboard-error">{String(error instanceof Error ? error.message : error)}</p> : null}
        <div className={sourceClass}>
          {dataSources.map((source) => (
            <DataSourceItem
              key={source.id}
              source={source}
              view={view}
              pending={pending}
              datasetCount={source.sourceRole === "initial-csv" ? csvPresets.filter((preset) => preset.path.startsWith(source.path)).length : localDatasets.filter((dataset) => dataset.inputPath.startsWith(source.path)).length}
              onToggle={onToggle}
              onDelete={onDelete}
            />
          ))}
          {!dataSources.length ? <p className="dashboard-muted">No server data sources configured</p> : null}
        </div>
      </section>
    </div>
  );
}

function DataSourceItem({
  source,
  view,
  pending,
  datasetCount,
  onToggle,
  onDelete,
}: {
  source: DataSourceRoot;
  view: DisplayMode;
  pending: boolean;
  datasetCount: number;
  onToggle: (source: DataSourceRoot) => void;
  onDelete: (source: DataSourceRoot) => void;
}) {
  const isCsvSource = source.sourceRole === "initial-csv";
  const sourceType = isCsvSource ? (source.preset ? "Preset initial CSV source" : "Initial CSV source") : (source.preset ? "Preset data source" : "TIFF image data source");
  const countLabel = isCsvSource ? `${datasetCount} CSV presets` : `${datasetCount} datasets`;
  const SourceIcon = isCsvSource ? FileText : HardDrive;
  const className = view === "block" ? "dashboard-card data-source-item" : "dashboard-row data-source-item";
  return (
    <article className={className}>
      <div className="item-mainline">
        <div className="item-title-wrap">
          <SourceIcon size={15} />
          <strong>{source.label}</strong>
        </div>
        <span className={`state-pill ${source.enabled ? "completed" : "neutral"}`}>{source.enabled ? "enabled" : "disabled"}</span>
      </div>
      <div className="data-source-path">{source.path}</div>
      <div className="item-metrics">
        <span>{sourceType}</span>
        <span>{source.pathKind}</span>
        <span>{source.exists ? "exists" : "missing"}</span>
        <span>{countLabel}</span>
      </div>
      <div className="item-actions data-source-actions">
        <button className={source.enabled ? "cancel-button" : "action-button strong-action-button"} type="button" disabled={pending || !source.exists} onClick={() => onToggle(source)}>
          {source.enabled ? "Disable" : "Enable"}
        </button>
        <button className="action-button danger-action-button" type="button" disabled={pending || source.preset} onClick={() => onDelete(source)} title={source.preset ? "Preset sources cannot be removed" : "Remove source"}>
          <Trash2 size={15} /> Remove
        </button>
      </div>
    </article>
  );
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <label className="dashboard-search">
      <Search size={15} />
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
    </label>
  );
}

function DashboardLoadingOverlay({ label, detail }: { label: string; detail: string }) {
  return (
    <div className="dashboard-loading-overlay" aria-live="polite">
      <div className="viewer-loading-card">
        <div className="viewer-loading-spinner" />
        <div>
          <strong>{label}</strong>
          <span>{detail}</span>
        </div>
      </div>
    </div>
  );
}

function DisplayToggle({ value, onChange }: { value: DisplayMode; onChange: (value: DisplayMode) => void }) {
  return (
    <div className="segmented-control" role="group" aria-label="Display mode">
      <button type="button" className={value === "block" ? "active" : ""} onClick={() => onChange("block")} title="Block view"><LayoutGrid size={15} /></button>
      <button type="button" className={value === "list" ? "active" : ""} onClick={() => onChange("list")} title="List view"><List size={15} /></button>
    </div>
  );
}

function ContextMenu({
  state,
  job,
  dataset,
  onClose,
  onOpenMonitor,
  onLifecycle,
  onEdit,
  onClone,
  onArchive,
  onCreateJob,
  onPreview,
  onDeleteDataset,
}: {
  state: NonNullable<ContextMenuState>;
  job?: JobStatus;
  dataset?: DatasetSource;
  onClose: () => void;
  onOpenMonitor: (job: JobStatus, quickPreview?: boolean) => void;
  onLifecycle: (job: JobStatus) => void;
  onEdit: (jobId: string) => void;
  onClone: (job: JobStatus) => void;
  onArchive: (job: JobStatus) => void;
  onCreateJob: (datasetId: string) => void;
  onPreview: (dataset: DatasetSource) => void;
  onDeleteDataset: (dataset: DatasetSource) => void;
}) {
  return (
    <div className="dashboard-context-menu" style={{ left: state.x, top: state.y }} onClick={(event) => event.stopPropagation()}>
      {job ? (
        <>
          <button type="button" disabled={!job.partialOutputsAvailable && job.completedFrames === 0} onClick={() => onOpenMonitor(job)}><MonitorPlay size={14} /> View all</button>
          <button type="button" disabled={!job.partialOutputsAvailable && job.completedFrames === 0} onClick={() => onOpenMonitor(job, true)}><MonitorPlay size={14} /> View last frame</button>
          {getLifecycleLabel(job) ? <button type="button" onClick={() => onLifecycle(job)}>{getLifecycleLabel(job)?.label}</button> : null}
          {job.state === "prepared" ? <button type="button" onClick={() => onEdit(job.id)}><Edit3 size={14} /> Edit</button> : null}
          {job.state !== "running" && job.state !== "queued" ? <button type="button" onClick={() => onClone(job)}><Copy size={14} /> Duplicate for editing</button> : null}
          <a href={`/api/jobs/${encodeURIComponent(job.id)}/download`}><Download size={14} /> Download</a>
          <button type="button" disabled={job.state === "running" || job.state === "queued"} onClick={() => onArchive(job)}><Archive size={14} /> Archive</button>
        </>
      ) : null}
      {dataset ? (
        <>
          <button type="button" onClick={() => onPreview(dataset)}><Eye size={14} /> Preview</button>
          <button type="button" onClick={() => onCreateJob(dataset.id)}><FileCog size={14} /> Create Job</button>
          {dataset.kind === "upload" ? <a href={`/api/datasets/uploads/${encodeURIComponent(dataset.upload.uploadId)}/download`}><Download size={14} /> Download</a> : null}
          {dataset.kind === "upload" ? <button type="button" onClick={() => onDeleteDataset(dataset)}><Trash2 size={14} /> Delete Upload</button> : null}
        </>
      ) : null}
      <button type="button" onClick={onClose}>Close</button>
    </div>
  );
}

export function DangerConfirmDialog({ intent, onClose }: { intent: ConfirmIntent | null; onClose: () => void }) {
  const [value, setValue] = useState("");
  useEffect(() => setValue(""), [intent?.sequence]);
  if (!intent) return null;
  const canConfirm = value.trim() === intent.sequence;
  return (
    <div className="modal-backdrop" role="presentation">
      <div className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <h2 id="confirm-title">{intent.title}</h2>
        <p>{intent.message}</p>
        <label>
          <span>Type {intent.sequence}</span>
          <input value={value} onChange={(event) => setValue(event.target.value)} autoFocus />
        </label>
        <div className="form-actions">
          <button className="cancel-button" type="button" disabled={!canConfirm} onClick={() => { intent.onConfirm(); onClose(); }}>{intent.confirmLabel}</button>
          <button className="secondary-button" type="button" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function getLifecycleLabel(job: JobStatus): { label: string; danger: boolean } | null {
  if (job.state === "prepared") return { label: "Start", danger: false };
  if (job.resumeAvailable) return { label: "Resume", danger: false };
  if (job.state === "running" || job.state === "queued") return { label: "Stop", danger: true };
  return null;
}

function buildDatasetSources(uploads: DatasetUpload[], localDatasets: LocalDataset[]): DatasetSource[] {
  const uploaded = uploads
    .filter((upload) => upload.kind === "dataset")
    .map((upload) => ({
      id: `upload:${upload.uploadId}`,
      kind: "upload" as const,
      label: upload.files[0]?.name ?? upload.uploadId,
      upload,
    }));
  const local = localDatasets.map((dataset) => ({
    id: `local:${dataset.id}`,
    kind: "local" as const,
    label: dataset.label,
    local: dataset,
  }));
  return [...local, ...uploaded];
}

function scanSelectedFiles(files: File[], mode: "files" | "folder"): PendingUpload {
  const warnings: string[] = [];
  const accepted: File[] = [];
  let ignoredCount = 0;
  let ignoredSubfolderCount = 0;
  const folderName = mode === "folder" ? firstFolderName(files) : undefined;
  for (const file of files) {
    const relativePath = getRelativePath(file);
    const parts = relativePath.split("/").filter(Boolean);
    const isTiff = /\.tiff?$/i.test(file.name) && !file.name.startsWith("._");
    if (mode === "folder" && parts.length > 2) {
      ignoredSubfolderCount += 1;
      continue;
    }
    if (!isTiff) {
      ignoredCount += 1;
      continue;
    }
    accepted.push(file);
  }
  if (mode === "folder" && !accepted.length) {
    warnings.push("No first-layer TIFF files were detected in this folder.");
  }
  return {
    mode,
    files,
    accepted,
    ignoredCount,
    ignoredSubfolderCount,
    folderName,
    totalBytes: accepted.reduce((sum, file) => sum + file.size, 0),
    warnings,
  };
}

function getRelativePath(file: File): string {
  return (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
}

function firstFolderName(files: File[]): string | undefined {
  const first = files.find((file) => getRelativePath(file).includes("/"));
  return first ? getRelativePath(first).split("/")[0] : undefined;
}

function filterJobs(jobs: JobStatus[], query: string): JobStatus[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return jobs;
  return jobs.filter((job) => [job.id, job.label ?? "", job.state, job.type].some((value) => value.toLowerCase().includes(needle)));
}

function filterDatasets(datasets: DatasetSource[], query: string): DatasetSource[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return datasets;
  return datasets.filter((dataset) => {
    const values = dataset.kind === "upload"
      ? [dataset.id, dataset.label, dataset.upload.uploadId, ...dataset.upload.files.map((file) => file.name)]
      : [dataset.id, dataset.label, dataset.local.inputPath, dataset.local.filePattern, dataset.local.source];
    return values.some((value) => value.toLowerCase().includes(needle));
  });
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function validateYamlSanity(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (/\t/.test(text)) {
    return "YAML contains tab indentation; use spaces before saving the job.";
  }
  const brackets = new Map([["{", "}"], ["[", "]"]]);
  const stack: string[] = [];
  for (const char of strippedYamlComments(text)) {
    if (brackets.has(char)) {
      stack.push(brackets.get(char)!);
    } else if ((char === "}" || char === "]") && stack.pop() !== char) {
      return "YAML has unmatched braces or brackets.";
    }
  }
  if (stack.length) return "YAML has unmatched braces or brackets.";
  return null;
}

function strippedYamlComments(text: string): string {
  return text.split(/\r?\n/).map((line) => line.replace(/#.*/, "")).join("\n");
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value >= 10 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
}

function sortJobs(jobs: JobStatus[]): JobStatus[] {
  return [...jobs].sort((a, b) => activeRank(a) - activeRank(b) || timestampOf(b) - timestampOf(a));
}

function activeRank(job: JobStatus): number {
  if (job.state === "running") return 0;
  if (job.state === "queued") return 1;
  if (job.state === "prepared") return 2;
  return 3;
}

function timestampOf(job: JobStatus): number {
  return Date.parse(job.startedAt ?? job.createdAt ?? job.finishedAt ?? "") || 0;
}

function randomSequence(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function useDelayedLoading(active: boolean, key: string): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    setVisible(false);
    if (!active) return undefined;
    const timeout = window.setTimeout(() => setVisible(true), 10000);
    return () => window.clearTimeout(timeout);
  }, [active, key]);
  return active && visible;
}

function useStoredDisplayMode(key: string, fallback: DisplayMode): [DisplayMode, (value: DisplayMode) => void] {
  const [value, setValue] = useState<DisplayMode>(() => {
    const stored = window.localStorage.getItem(key);
    return stored === "block" || stored === "list" ? stored : fallback;
  });
  const write = (next: DisplayMode) => {
    setValue(next);
    window.localStorage.setItem(key, next);
  };
  return [value, write];
}

function useStoredBoolean(key: string, fallback: boolean): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState<boolean>(() => {
    const stored = window.localStorage.getItem(key);
    return stored == null ? fallback : stored === "true";
  });
  const write = (next: boolean) => {
    setValue(next);
    window.localStorage.setItem(key, String(next));
  };
  return [value, write];
}
