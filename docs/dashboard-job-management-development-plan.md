# Dashboard And Job Management Development Plan

## Purpose

Add a dashboard and job-control workflow for the CellUniverse web UI so users can
prepare jobs, start and stop jobs, choose a job to monitor, delete jobs, upload
inputs, and download job outputs.

This document is a planning draft for discussion. It intentionally separates
likely implementation phases from open product decisions.

## Goals

- Provide a dashboard where users can see all jobs and their current state.
- Let users upload a dataset or pick an existing dataset, then create a
  stand-by job from that dataset.
- Let users select an existing job and open it in the live monitor.
- Let users start, terminate/cancel, and delete jobs from the dashboard.
- Add start/terminate controls to the live monitor status panel.
- Support upload of required input files, including folder-based dataset upload
  with a scan-and-confirm step, preview uploaded datasets before job creation,
  and expose backend-approved local datasets that already exist on the server.
- Support download of uploaded datasets, selected artifacts, or all files from
  the current job.
- Preserve the current live monitor experience as the monitoring surface.

## Non-Goals For The First Pass

- Full production deployment, HTTPS, auth, shared-token access control, or
  multi-user permission design. Security/access control is deferred for this
  pass and should be handled before broader internal rollout.
- A broad visual redesign of the monitor page.
- Running arbitrary user-provided commands or binaries.
- Direct frontend access to server filesystem paths beyond backend-approved
  references.

## Existing Pieces To Inventory First

Before implementation, inspect the current backend and frontend contracts:

- Job list and job detail endpoints.
- Job creation endpoint behavior.
- Existing cancel/terminate endpoint.
- Upload endpoints for datasets, dataset folders, initial CSV, and config YAML.
- Existing backend configuration patterns for approved local data roots.
- Dataset preview or dataset file-serving endpoints, if any already exist.
- Artifact and file-serving endpoints.
- Current frontend API client and selected-job state.
- Current live monitor status panel and action placement.

The implementation should reuse existing endpoints wherever possible before
adding new ones.

## Proposed User Workflow

1. User opens the dashboard.
2. User sees recent jobs with state, progress, frame range, created time, and
   available actions.
3. User uploads a new dataset or selects an existing uploaded/approved
   dataset.
4. User can preview the raw dataset before creating a job from it.
5. User creates a workflow/job based on that dataset. The create-workflow action
   should be available both in the dataset preview and directly on each dataset
   block or row in the uploaded-datasets dashboard.
6. The newly created job is stored as a stand-by/prepared job and appears on the
   jobs dashboard. It does not start automatically.
7. User edits configuration for prepared/stand-by jobs as needed. For
   completed, cancelled, or failed jobs, editing creates a new revision or clone
   rather than mutating the historical run.
8. User starts the prepared job from the dashboard or job detail panel.
9. User selects a running or completed job to open it in the live monitor.
10. User can terminate a running job from either dashboard or monitor status
    panel.
11. User can download uploaded datasets or outputs from a completed, cancelled,
    or failed job.
12. User can delete a job after confirmation.

## Recommended Workflow Refinements

The dataset-to-job workflow is a good direction, but a few details should be
handled carefully so the system stays understandable and auditable:

- Use one user-facing term consistently. The UI can say "job" for the concrete
  executable run and reserve "workflow" for the creation/configuration flow, or
  use only "job" if simpler.
- Creating a job from a dataset should create a prepared/stand-by job snapshot.
  It should not launch the worker until the user presses start.
- Prepared/stand-by jobs should be directly editable.
- Running jobs should not be editable unless a specific runtime-edit feature is
  intentionally designed for a safe subset of parameters.
- Completed, cancelled, or failed jobs should keep their historical run record
  stable. If the user edits one of these jobs, the safer behavior is to create
  a new editable revision or clone that returns to prepared/stand-by state.
- Dataset deletion should account for dependencies. If a prepared or historical
  job references an uploaded dataset, deletion should either be blocked or
  require a confirmation that explains which jobs will be affected.
- Dataset preview assets should be separate from job output artifacts so raw
  previews do not make the dataset look like a completed CellUniverse run.


## Dashboard View

The dashboard should be an operational workspace, not a landing page.

Expected sections:

- Hideable left navigation panel for available dashboard tabs.
- Jobs page with list and block display modes.
- Uploaded datasets page with matching list and block display modes.
- New job action.
- Search/filter by job id, dataset id/name, state, and recent activity.
- Per-job and per-dataset quick actions.
- Empty state for no jobs or datasets.
- Error/loading states for failed API requests.

Suggested tabs in the left navigation:

- Jobs.
- New job.
- Uploaded datasets.
- Outputs/downloads.
- Settings or runtime configuration, if needed later.

The left navigation should be collapsible so the jobs and uploaded-datasets
pages can use more horizontal space when users are scanning many items or
monitoring a selected job/dataset.

## Jobs Page Display Modes

The jobs page should let users switch between two display modes:

- Block view.
- List view.

Block view should be the more visual default for a small to medium number of
jobs. Each job appears as a compact block panel with clear status and progress.
The block should not become a large nested card or decorative tile; it should
stay compact and operational.

List view should be optimized for scanning many jobs. It can use a table-like
layout with denser rows and the same core actions.

Suggested job fields for both modes:

- Job id.
- Job type.
- State.
- Frame progress.
- Visible progress bar.
- Created/started/finished timestamps when available.
- Input/config summary.
- Latest useful status message.
- Actions: monitor, start, terminate, download, delete.

Block view should include:

- Job id and state.
- Progress bar.
- Current frame or completed frame count when available.
- Short input/config summary.
- Single primary start/terminate action.
- Secondary monitor, download, and delete actions.

Job blocks and rows can also expose a right-click context menu for secondary or
less-common actions. Primary lifecycle actions should remain visible and should
not be available only through right click.

List view should include the same information with less vertical space.

The selected display mode should persist during the session, and can optionally
be persisted in local storage if that matches existing frontend patterns.

## Uploaded Datasets Page Display Modes

Uploaded datasets should be managed in their own dashboard panel with the same
visual language as the jobs page. This page should support block view and list
view, using the same density, spacing, action styling, progress treatment, and
empty/error-state patterns as the job monitor dashboard.

Suggested dataset fields for both modes:

- Upload id, local dataset id, or dataset id.
- Dataset name, original file name, or approved-root display label.
- Upload/preprocessing state.
- Upload or preview-preparation progress when available.
- Visible progress bar for upload/preprocessing states.
- File count, frame count, dimensions, and size when available.
- Upload time, detection time, and last preview time.
- Source type: uploaded, selected multi-file upload, folder upload, or approved local path.
- Validation status.
- Actions: preview, create job, download, delete/archive.

Dataset block view should include:

- Dataset id/name and state.
- Upload or preview progress bar.
- Short metadata summary.
- Primary preview or create-job action, depending on state.
- Secondary download and delete/archive actions.

Dataset blocks and rows can also expose a right-click context menu for secondary
or less-common actions. Preview and create-workflow should remain visible enough
that users do not need to discover right click before using the page.

Dataset list view should include the same information with less vertical space.

Dataset actions should follow the same button semantics as job actions. Delete
or cleanup should require confirmation and should clearly state whether uploaded
files will be removed.

## Approved Local Dataset Roots And Auto-Detection

The system should support datasets that already exist on the server without
requiring users to re-upload them. Treat these as backend-approved local datasets
rather than browser uploads. The frontend should only receive stable dataset ids,
friendly display names, and approved metadata; raw filesystem paths should stay a
backend concern unless an administrator view intentionally reveals them.

Observed on this machine:

- The relevant root is `/extra/wayne2/preserve/CellUniverse`.
- It currently contains `PAVAK/2026/Pos0` through `PAVAK/2026/Pos8`.
- Each `Pos*` folder has a nested `SPIMA/` folder with first-layer TIFF frames.
- `Pos0` through `Pos3` have 150 detected first-layer TIFFs in `SPIMA/`.
- `Pos4` through `Pos8` have 149 detected first-layer TIFFs in `SPIMA/`.
- Deeper files under paths such as `SPIMA/SPIMA/` include metadata or prior
  analysis artifacts and should not be treated as raw frame inputs by default.

Also observed from the CellUniverse C++ `scripts/run_config.ini` on this
machine:

- `run_config.ini` lives at
  `/home/puv/celluniverse/CellUniverse/C++/scripts/run_config.ini`.
- It references the Cell Tracking Challenge Fluo dataset at
  `/extra/wayne2/src/CellUniverse/celltrackingchallenge.net/Fluo-N3DH-CE-0train/Fluo-N3DH-CE/01/t%03d.tif`.
  This directory has 250 first-layer TIFF frames and appears in 91 presets.
- It references the original/demo dataset at
  `/home/puv/celluniverse/input/frame%03d.tif`. This directory has 399 real
  frame TIFFs when `._*.tif` sidecar files are ignored, and appears in 25
  presets.
- The config also references output roots `/home/puv/output_fluo` and
  `/home/puv/celluniverse/output`, plus several `resume_source_dir` folders.
  Treat those as existing output/resume-history candidates, not raw input
  datasets by default.
- The many `initial_csv_file` entries under `../config/embryo/` and
  `../config/Original/` should be considered initial-CSV presets for the
  create-job page after resolving them relative to the C++ scripts directory.

Recommended detection behavior:

- Configure one or more approved local dataset roots in backend configuration.
- Allow optional bootstrap/import from known CellUniverse config files such as
  `scripts/run_config.ini`, but keep the parsed paths subject to the same
  approved-root validation.
- On startup or on manual rescan, scan only those approved roots.
- Detect candidate datasets as directories whose own first layer contains TIFFs.
- Also support a configurable shallow search depth so preserved layouts like
  `PAVAK/2026/Pos0/SPIMA/*.tif` can be detected without registering the parent
  folder as a dataset.
- Support explicit frame-pattern datasets discovered from config, such as
  `t%03d.tif` or `frame%03d.tif`, in addition to plain directories.
- Store detected candidates in a dataset registry with source type, root id,
  relative path or pattern, frame count, size estimate, file naming pattern,
  first/last detected frame number when parsable, and scan timestamp.
- Mark local detected datasets as linked/read-only by default. If users need an
  app-owned copy, provide an explicit import/copy action.
- Show detected local datasets in the same uploaded-datasets dashboard using the
  same block/list visual language, with a clear source label such as `Local`.
- Allow create-workflow/job from a detected local dataset exactly like from an
  uploaded dataset.

Advanced configuration should include:

- Approved dataset roots, each with an id, display label, absolute path, enabled
  flag, and optional default scan depth.
- File extensions/patterns accepted as frame files, defaulting to `.tif` and
  `.tiff`.
- Filename sorting strategy, including natural sort and optional frame-number
  extraction.
- Whether auto-scan runs on backend startup, on a schedule, or only by manual
  admin action.
- Maximum scan depth and maximum candidate count to prevent expensive scans on
  broad shared filesystems.
- Whether symlinks are followed; default should be disabled.
- Access mode per root: linked read-only, linked writable only if ever needed,
  or import/copy-on-use.
- Ignore patterns for sidecar files such as `._*.tif`, defaulting to enabled for
  local filesystem scans.
- Optional CellUniverse config bootstrap sources, each with path, enabled flag,
  and whether to import job presets, dataset references, initial CSV presets,
  and resume/output references.
- A validation action that checks root existence, read permissions, and whether
  any candidate TIFF directories or configured frame patterns are found.

Deployment note:

- Do not hard-code `/extra/wayne2/preserve/CellUniverse`,
  `/extra/wayne2/src/CellUniverse/...`, or `/home/puv/celluniverse/input` into
  product logic. Use environment variables or a backend YAML/JSON settings file
  for approved roots and optional CellUniverse config bootstrap sources. This
  UCI server can ship with local config entries for those paths, while other
  deployments can define their own roots without code changes.

## Context Menus

Job and dataset blocks may support right-click context menus for secondary
actions. These menus should improve efficiency for power users without becoming
the only way to complete core workflows.

Possible job context menu actions:

- Monitor/open.
- Edit configuration for prepared/stand-by jobs.
- Create revision or clone for historical jobs, if supported.
- Download outputs.
- Delete/archive.

Possible dataset context menu actions:

- Preview.
- Create workflow/job.
- Download dataset.
- Rename or edit metadata, if supported.
- Delete/archive.

Destructive context-menu actions should still use the same confirmation flows as
visible buttons.

## Live Progress Synchronization And Monitor Entry

Running jobs should keep both the dashboard block/list display and the live
monitor synchronized with backend progress. The visible progress bar on each
running job block or row should continue updating without requiring the user to
refresh the page. The selected job in the live monitor should use the same
progress source so status, current frame, logs/events, available 3D/2D image
stack, and lineage tree data do not drift between dashboard and monitor.

When a user clicks the view/monitor action from a job block or row, the initial
monitor load should open at the latest completed output state. For example, if
the worker has completed frame `n` and is currently working on frame `n + 1`, the
initial monitor view should load the complete available stack from frame `0`
through frame `n`. This is an initial-load behavior, not a forced playback mode:
after the monitor opens, the live monitor's own scheduler/playback/follow-latest
controls should remain in charge.

As new frames complete, the live monitor update path should refresh all
frame-dependent panels that are enabled for a running job: the 3D stack, any 2D
slice/frame display, synthetic/outline overlays when available, progress/status
readouts, and the lineage tree snapshot/layout. Dataset-preview mode is the
exception: raw uploaded or local datasets do not have job lineage/progress output,
so those job-only panels stay disabled there.

For slow networks or large stacks, provide a lightweight entry option such as
`latest-frame quick preview`. In that mode, the monitor can initially load only
the latest completed frame or a minimal preview payload, then let the user choose
whether to load the full completed stack. The job block should make this option
available without replacing the normal full monitor view.

## State-Aware Start And Terminate Action

Each job block or row should expose one primary lifecycle button that changes
based on job state:

- Prepared, queued if restartable, cancelled if restartable, or failed if
  restartable: show start.
- Running: show terminate.
- Cancelling: show disabled terminating state.
- Completed: hide the lifecycle button or show restart only if backend supports
  restart.

The button style should also change by operation:

- Start uses the normal primary/action button semantics.
- Terminate uses the existing cancel/destructive button semantics.
- Disabled or pending states should make it clear that the request is already in
  progress.

Terminate must always require confirmation. The confirmation modal should make
the operation explicit and should consider a high-friction confirmation pattern,
such as asking the user to type a short random sequence shown in the modal.

The confirmation should include:

- Job id.
- Current job state.
- What termination means for the worker process.
- Whether partial outputs remain available.
- The required confirmation input, if enabled.

Start should not require the same high-friction confirmation, but it should
surface validation errors clearly if the job cannot start.

## Job Preparation Flow

The canonical job-preparation workflow should be:

1. Upload a dataset or pick an existing uploaded/approved dataset.
2. Create a workflow/job based on that dataset.
3. Configure the job.
4. Store the job as stand-by/prepared.
5. Start the job only after the user explicitly starts it.

The create-workflow action should be available in both places:

- Dataset preview panel.
- Dataset block or row in the uploaded-datasets dashboard.

The create-new-job panel should collect the current required information for a
CellUniverse tracking job:

- Input dataset reference from an uploaded dataset or approved server-side
  dataset.
- First and last frame.
- Initial CSV, selected from an approved server path or uploaded through the
  create-job page.
- Config source, selected from a preset/module, approved YAML path, or uploaded
  YAML.
- Editable per-job YAML copy generated from the selected config source.
- Simple GUI-configurable parameters exposed by the backend.
- Optional job name or description if supported.

The page should make required fields clear before allowing the job to be stored
as stand-by/prepared.

## Simple GUI-Configurable Parameters

The create-job panel should use the backend exposed-parameter modules for simple
GUI controls. These controls are the user-friendly layer on top of the generated
job YAML and should stay synchronized with the editable per-job YAML copy.

Current exposed module:

- `debug-basic` based on `config/config.yaml`.

Current exposed fields:

- `simulation.parallel_threads`
  Label: Parallel Threads. Type: integer. UI: number input. Range: 1-128.
- `simulation.preprocess_mode`
  Label: Preprocessing. Type: enum/select. Values: `none`, `n2v2`.
- `pipeline.mode`
  Label: Pipeline. Type: enum/select. Values: `standard`,
  `cell_lumen_fusion`, `preprocess_only`. This is a virtual field that maps to
  concrete YAML changes, such as CellLumen enable/fusion flags and
  preprocessing-only mode.

Recommended UI behavior:

- Show exposed parameters as simple controls in the create-job panel.
- Apply exposed-parameter changes into the job-specific YAML copy.
- Keep the direct YAML editor available for advanced edits.
- Validate exposed controls before save/start using backend ranges and enum
  values.
- If a direct YAML edit conflicts with a simple GUI control, show the conflict or
  refresh the control state from the YAML rather than silently hiding the change.
- Do not expose arbitrary YAML fields as simple controls until they are added to
  an exposed-parameter module with label, type, range/options, and UI semantics.


The flow should support two kinds of source selection:

- Upload files into backend-managed runtime storage.
- Select a detected dataset from backend-approved local roots.
- Select or reference paths from backend-approved roots when advanced access is enabled.

When the user selects a config source, the backend should create or materialize
a job-specific YAML copy for the prepared job. The create-job panel should allow
the user to directly edit that copy before the job is stored or before it is
started. The editor should make clear that the user is editing the job copy, not
the global preset/source YAML.

The backend should validate all inputs and parse/check the edited YAML before
storing the prepared job and again before starting the worker.

Prepared/stand-by jobs should be editable. Running jobs should not expose
editable configuration unless the backend supports safe runtime updates for
specific parameters. For completed, cancelled, or failed jobs, editing should
prefer creating a new editable revision or clone instead of mutating the
historical run record.

## Backend Lifecycle API

Current backend behavior should be checked first. If missing, likely additions
are:

- `POST /api/jobs/prepare`
  Create a prepared job without starting the worker.
- `POST /api/jobs/{jobId}/start`
  Start a prepared job.
- `POST /api/jobs/{jobId}/cancel`
  Terminate or cancel a running job.
- `DELETE /api/jobs/{jobId}`
  Delete a job after safety checks.
- `GET /api/jobs/{jobId}/download`
  Download a zip archive of job files.

For this dashboard workflow, job creation should prepare/store the job rather
than starting it immediately. Starting should be a separate explicit operation.
If `POST /api/jobs` currently starts immediately, we should either add a prepare
endpoint or change/create an endpoint whose behavior is clearly prepare-only.

## Job States

The UI should handle at least these states:

- Draft or prepared/stand-by.
- Queued.
- Running.
- Cancelling.
- Cancelled.
- Failed.
- Completed.
- Deleted or archived if soft delete is chosen.

Actions should be state-aware:

- Prepared/stand-by: edit configuration, start, delete.
- Queued: cancel, delete if safe.
- Running: terminate/cancel, monitor.
- Cancelling: monitor only.
- Cancelled/failed/completed: create editable revision or clone if
  restartable, monitor, download, delete.

The dashboard should prefer a single state-aware lifecycle button over separate
start and terminate buttons. Secondary actions can remain separate icon or
icon-text buttons where appropriate.

## Live Monitor Status Panel Actions

The status sub panel should expose job actions without becoming the primary
management dashboard.

Expected actions:

- Running job: terminate/cancel.
- Prepared/stand-by job: edit configuration, start.
- Failed/cancelled job: create editable revision or restart if backend supports
  it.
- Completed job: download.
- Any non-running job: delete after confirmation.

The panel should keep actions compact and consistent with existing button
semantics and design tokens.

## Upload Handling

Uploads should be handled by the backend:

- Enforce file size limits.
- Enforce allowed extensions.
- Store uploads under backend runtime upload directories.
- Return stable upload references to the frontend.
- Prevent arbitrary filesystem writes.
- Validate that uploaded files can be used by the job runner.

Upload categories:

- Flat multi-file TIFF dataset upload by selecting multiple files.
- Folder-based dataset upload.
- Initial CSV.
- Config YAML.

Current backend support should be treated as flat multi-file upload only. Folder
upload needs additional frontend and backend handling.

Dataset intake should feel like mainstream file platforms: users should be able
to drag/drop or browse-select multiple TIFF files as one dataset, or select a
folder when that is more convenient. Both entry paths should lead into a similar
scan, confirmation, upload, preview, and create-workflow flow.

## Multi-File Dataset Upload

Multi-file upload should remain a first-class dataset intake path. Users should
be able to select multiple TIFF files at once and upload them as one dataset.

Recommended behavior:

1. User selects or drag/drops multiple files.
2. Frontend filters or flags allowed TIFF files.
3. Frontend shows a scan result before upload.
4. If no TIFF files are selected, block upload.
5. User confirms the detected dataset files.
6. Confirmed TIFF files upload as a single dataset.

The scan result should show:

- Number of selected TIFF files.
- Example detected TIFF names or a scrollable detected-file list.
- Ignored non-TIFF file count and names when practical.
- Total upload size estimate.
- Duplicate or suspicious file names.

This path should share as much UI and validation behavior as folder upload as
possible so users do not need to learn two different upload systems.

## Folder Upload Scan And Confirmation

Folder upload should be conservative because a selected folder may contain
documents, notes, nested folders, intermediate outputs, or unrelated files. The
first implementation should avoid recursively guessing which nested subfolder is
the true dataset.

Recommended first-pass folder upload behavior:

1. User selects a folder in the browser.
2. Frontend scans only the first layer of that selected folder.
3. Frontend detects TIFF files in that first layer.
4. If the first layer contains no TIFF files, block upload and tell the user to
   choose the folder that directly contains the image frames.
5. Before upload, show a scan result and ask the user to confirm.
6. Only confirmed first-layer TIFF files are uploaded as the dataset.

The scan result should show:

- Selected folder name.
- Number of first-layer TIFF files detected.
- Example detected TIFF names or a scrollable detected-file list.
- Ignored first-layer non-TIFF files count.
- Ignored subfolder count.
- Total upload size estimate.
- Any duplicate or suspicious file names.

The upload confirmation should make it clear that nested subfolders are ignored
in the first-pass behavior. This avoids accidentally uploading documentation,
old outputs, or unrelated data.

Possible later enhancement: support an advanced recursive scan mode that displays
candidate TIFF-containing subfolders and asks the user to choose one explicit
dataset source. Recursive upload should not be the default until the UX can make
that choice unambiguous.

Backend requirements for folder upload:

- Accept relative path metadata from browser folder selection when available.
- Preserve enough metadata to report the original folder and selected first-layer
  files.
- Reject path traversal and normalize file names safely.
- Reject uploads if no first-layer TIFF files are included.
- Continue storing accepted TIFFs under backend-managed runtime upload storage.


## Uploaded Dataset Preview Panel

Uploaded raw datasets should have a preview flow before they become a job input.
This preview should be reachable from the uploaded-datasets management panel and
should reuse live monitor viewer pieces where practical, but it should run in a
raw-dataset mode rather than pretending the upload is a job output.

The raw dataset preview should disable monitor features that require simulation
or segmentation outputs:

- Job progress monitor.
- Lineage tree.
- Synthetic layer or synthetic overlay.
- Cell outline or cell overlay.
- Job logs and worker events, unless a lightweight upload/preview-processing log
  is added later.

The raw dataset preview should keep:

- 3D viewer for real frames.
- Real frame navigation or frame selection.
- Real-layer rendering controls that are meaningful for raw uploaded data.
- Loading and preprocessing progress for the browser preview itself, including
  long-pending loading overlay behavior that matches the current live viewer.
- Dataset metadata summary, such as file name, frame count, dimensions, upload
  time, and size when available.

The preview screen should include an action/details panel for user decisions:

- Download the uploaded dataset.
- Create a workflow/job based on the dataset.
- Select or attach initial CSV and config YAML when creating a job.
- Delete the uploaded dataset if backend cleanup supports it.

Likely backend support:

- `GET /api/datasets/uploads/{uploadId}/preview`
  Return a raw-dataset preview manifest.
- `GET /api/datasets/uploads/{uploadId}/files/...`
  Serve safe preview or original dataset files.
- `GET /api/datasets/uploads/{uploadId}/download`
  Download the uploaded dataset or uploaded dataset bundle.
- `POST /api/jobs/prepare` or `POST /api/jobs`
  Accept an upload reference as the input source.

Preview generation should not require CellUniverse worker output artifacts. If
point-cloud or slice preview assets are needed, the backend should generate them
from the uploaded real frames under runtime-managed preview storage.

## Download Handling

Downloads should also be backend-mediated.

Expected download options:

- Download uploaded raw dataset or dataset bundle.
- Download selected artifact.
- Download logs.
- Download all job files as a zip archive.

The zip endpoint should avoid including unsafe paths and should stream or
generate archives in a way that does not block the server for too long.

## Frontend Structure

Likely frontend additions:

- Dashboard page/view.
- Hideable dashboard tab navigation.
- Jobs page display-mode control.
- Uploaded-datasets page display-mode control.
- Job block component.
- Dataset block component.
- Context menu component or shared context-menu pattern for job and dataset
  blocks.
- Job table or job list component.
- Dataset table or dataset list component.
- Job creation panel or modal that gathers dataset, frame range, initial CSV,
  config source, exposed simple GUI parameters, and editable per-job YAML.
- Upload controls.
- Uploaded dataset preview view.
- Raw-dataset 3D viewer mode that disables lineage, synthetic overlay, cell
  outline, and job progress controls.
- Dataset action/details panel for preview, download, and create-workflow
  actions.
- Job configuration editor for prepared/stand-by jobs, including direct editing
  of the job-specific YAML copy.
- Revision or clone flow for completed, cancelled, or failed jobs when editing
  or restarting is supported.
- Job action controls.
- Download controls.
- Shared job-state formatting helpers.
- API client methods for lifecycle, upload, and download endpoints.

The selected job should be reflected in frontend state so the dashboard and live
monitor can move between each other predictably.

## Top Bar And Subpanel Navigation

For dashboard subpanels and nested pages, the left edge of the top bar should
act as navigation rather than decoration. Do not show a secondary explanatory
title under the main title in these subpanel contexts; users should not need an
extra introduction once they are inside the workflow.

Expected behavior:

- Replace the decorative app/view icon in the upper-left top-bar slot with a
  back button when the user is inside a subpanel or nested workflow page.
- The back button should return to the previous layer of the web UI, such as
  dataset preview back to uploaded datasets, job configuration back to jobs, or
  live monitor back to dashboard.
- Keep the main title concise and specific to the current page.
- Omit secondary descriptive subtitles such as explanatory feature summaries in
  nested/dashboard workflow panels.
- Use an icon button with tooltip/accessible label for the back action, matching
  existing button semantics and design tokens.

## Loading And Pending States

Long-running or uncertain loading states should use the same loading overlay
pattern as the current CellUniverse live viewer panel. This applies to dashboard
data loading, upload scanning, upload transfer, dataset preview generation, raw
dataset viewer loading, job list refreshes, and monitor transitions.

Expected behavior:

- Show lightweight inline progress for short operations.
- If loading remains pending for a noticeable duration, show a loading animation
  overlay consistent with the live viewer.
- Keep the overlay scoped to the affected panel when possible rather than
  blocking the entire dashboard unnecessarily.
- Keep existing content visible or dimmed when that helps users understand what
  is refreshing.
- Provide error or retry states if loading fails.
- Avoid layout shifts when switching from loading to loaded state.

## Visual And UX Constraints

Follow the existing frontend visual language:

- Read `docs/frontend-visual-language.md` before UI implementation.
- Use `frontend/src/theme/tokens.css` tokens first.
- Keep the dashboard dense, operational, and scan-friendly.
- Keep job and uploaded-dataset management panels visually consistent with each
  other.
- Do not introduce landing-page patterns, hero sections, ad hoc gradients, or
  nested cards.
- Keep destructive actions clearly confirmed.
- Do not rely on right-click menus as the only path for primary workflows.
- Use a segmented control or equivalent for block/list view selection.
- Use progress bars with stable dimensions so job blocks and rows do not shift
  as progress updates.
- Keep the primary lifecycle button visually consistent with existing normal and
  cancel button semantics.
- Keep raw dataset preview visually related to the live monitor, while clearly
  disabling job-only overlays and controls.
- Reuse the current live viewer loading overlay style for long-pending panel
  loads.
- Keep monitor actions compact and secondary to monitoring.
- In subpanels and nested workflow pages, use the top-bar left icon position as
  a back button and omit secondary explanatory subtitles.

## Safety And Data-Loss Decisions

Delete behavior needs a product decision before implementation:

- Hard delete: remove the runtime job folder and all generated files.
- Soft delete/archive: hide the job from the main list but keep files.
- Hybrid: soft delete by default, with a separate permanent cleanup action.

Recommended first-pass default: require confirmation for any delete action and
make the confirmation text explicit about whether files will be removed.

## Suggested Implementation Phases

### Phase 1: API And State Inventory

- Document current job/upload/download endpoints.
- Inventory current backend configuration patterns for approved local data roots.
- Parse the CellUniverse C++ `scripts/run_config.ini` to identify reusable
  dataset references, initial CSV presets, output roots, resume sources, and job
  template defaults.
- Identify missing lifecycle operations.
- Confirm whether current job creation starts immediately.
- Confirm backend representation of job states.

### Phase 2: Backend Lifecycle Support

- Add configurable approved local dataset roots and a dataset scan/registry layer.
- Add optional `run_config.ini` bootstrap parsing for approved dataset patterns,
  initial CSV presets, and job template defaults.
- Add scan endpoints for validating roots and refreshing detected local datasets.
- Add missing prepare/start/update/delete/download endpoints.
- Add safe job deletion behavior.
- Add zip download support.
- Ensure lifecycle endpoints reject invalid state transitions.
- Ensure update/edit endpoints reject changes to running jobs unless a specific
  runtime-edit feature is intentionally supported.
- Preserve historical run records when completed, cancelled, or failed jobs are
  revised; prefer cloning/revision endpoints over in-place mutation.
- Add focused backend tests or curl smoke checks.

### Phase 3: Dashboard Shell

- Add dashboard view.
- Add hideable left tab navigation.
- Add top-bar subpanel back-navigation behavior.
- Render job list from backend.
- Keep running job blocks and rows subscribed to progress updates so progress
  bars, current frame, and status remain fresh without manual refresh.
- Add jobs block/list display-mode control.
- Add uploaded-datasets block/list display-mode control.
- Add compact job block view with progress bars.
- Add compact dataset block view with upload/preview progress bars.
- Add shared right-click context-menu behavior for job and dataset blocks.
- Add dense list views with the same core job and dataset state.
- Add select-to-monitor navigation/state.
- Ensure monitor entry opens at the latest completed output stack for the
  selected job, while preserving the monitor scheduler controls after load.
- Add optional latest-frame quick-preview entry for slow networks or large
  stacks.
- Add loading, long-pending loading overlay, error, and empty states.

### Phase 4: Job Preparation And Uploads

- Add upload-or-pick-dataset entry flow.
- Include detected approved-local datasets in the pick-existing-dataset flow.
- Add multi-file upload scan-and-confirm flow for selected TIFF files.
- Add folder upload scan-and-confirm flow that inspects first-layer TIFF files
  before upload.
- Add create-workflow actions from dataset blocks/rows and dataset preview.
- Add new-job configuration form based on the selected dataset.
- Add initial CSV select/upload controls inside the create-job panel, including
  presets discovered from approved CellUniverse config files.
- Add config source selection, exposed simple GUI parameter controls, and
  editable per-job YAML copy editor.
- Wire multi-file selection, drag/drop, and folder upload controls.
- Wire backend validation for dataset, frame range, initial CSV, exposed
  parameter overrides, and edited YAML.
- Store newly created jobs as stand-by/prepared.
- Allow configuration edits for prepared/stand-by jobs, including direct edits
  to the job-specific YAML copy.
- For completed, cancelled, or failed jobs, support creating an editable clone or
  revision if restart is needed.
- Allow start only after valid preparation.

### Phase 5: Uploaded Dataset Management And Preview

- Add uploaded-datasets management page/panel with the same visual language as
  the jobs dashboard.
- Display auto-detected approved-local datasets alongside uploaded datasets, with
  source labels and read-only linked-path semantics.
- Surface folder-upload scan metadata on dataset blocks or detail panels when
  available.
- Add dataset block and list views.
- Add uploaded dataset preview route or dashboard panel.
- Reuse live monitor viewer components in raw-dataset mode.
- Disable progress monitor, lineage tree, synthetic overlay, and cell outline.
- Show real-frame 3D preview and meaningful real-layer controls.
- Add dataset action/details panel with preview, download, create-workflow, and
  delete/archive actions.
- Add equivalent secondary actions to dataset context menus where appropriate.
- Ensure create-workflow appears both in dataset preview and on dataset blocks or
  rows.
- Ensure create-job can consume the selected upload reference.

### Phase 6: Job Actions

- Add edit-configuration action for prepared/stand-by job blocks and rows.
- Add create-revision or clone action for completed, cancelled, or failed jobs
  if restart/edit is supported.
- Add state-aware single start/terminate lifecycle button to dashboard job
  blocks and rows.
- Add terminate confirmation modal with explicit job details and optional random
  sequence typing.
- Add delete/download actions to dashboard.
- Add equivalent secondary actions to job context menus where appropriate.
- Add terminate/start/download/delete actions to monitor status panel.
- Keep the monitor status panel synchronized with the same live progress source
  used by the dashboard job block or row.
- Add confirmation for destructive actions.
- Refresh job list and selected-job status after actions.

### Phase 7: Verification

- Run frontend build.
- Run backend smoke checks.
- Manually test multi-file upload, drag/drop upload, folder upload
  scan/confirm/blocking behavior, pick dataset, create workflow from dataset
  block, create workflow from dataset preview, choose/upload initial CSV, edit
  the per-job YAML copy, edit stand-by job configuration, start, monitor,
  terminate, download, and delete.
- Verify uploaded datasets can be managed in block and list views with the same
  visual language as the jobs dashboard.
- Verify approved-local dataset root scanning can detect the UCI example root
  `/extra/wayne2/preserve/CellUniverse`, including the `PAVAK/2026/Pos*/SPIMA`
  frame folders, when that root is configured.
- Verify `run_config.ini` bootstrap can identify the Fluo frame-pattern dataset,
  the original/demo frame-pattern dataset while ignoring `._*.tif` sidecars, and
  the associated initial CSV presets when those roots are configured.
- Verify running job progress updates dashboard progress bars, selected monitor
  status, available 3D/2D display stack, enabled overlays, and lineage tree
  without manual refresh.
- Verify opening a running job from its block/row initially loads the latest
  completed stack, and verify latest-frame quick preview can avoid full-stack
  loading when selected.
- Verify long-pending loads show the same loading overlay pattern as the current
  live viewer panel.
- Verify raw uploaded datasets preview without lineage, synthetic overlay, cell
  outline, or job progress controls.
- Verify the current demo job still loads in the live monitor.

## Recommended Answers For Open Questions

Recommended first-pass decisions:

- Approved local dataset roots should be managed through server-side config for
  now. Do not let normal users edit filesystem roots until an authenticated
  admin/settings model exists.
- Treat `run_config.ini` as an admin bootstrap/import source for the first pass.
  Later, named CellUniverse presets can become an advanced template selector in
  the create-job panel.
- Make local scan depth configurable per root. For this UCI server, configure a
  shallow depth such as `3` so `PAVAK/2026/Pos*/SPIMA` is detected.
- Keep auto-detected local datasets linked/read-only by default. Add explicit
  import/copy into app-owned storage later if users need it.
- Use `Dataset` and `Job` as the main UI terms. Avoid making `workflow` a primary
  user-facing term in the first pass.
- Use soft archive for job deletion by default. Permanent cleanup should be a
  separate dangerous action.
- Support multi-file selection, drag/drop, folder upload, and approved local
  datasets first. Defer zip upload unless users strongly need it.
- Folder upload should initially accept first-layer TIFF files only. If no
  first-layer TIFFs are found, show candidate subfolders as a later enhancement
  rather than silently uploading nested content.
- Upload scan confirmation should show TIFF count, frame range when parsable,
  filename pattern, total size estimate, ignored files, ignored subfolders, and
  warnings for suspicious names or sidecars.
- Raw dataset preview should support 3D real-frame viewing first. Add a
  lightweight latest-frame or 2D preview if practical for slow networks.
- Generate basic dataset metadata eagerly after upload/detection, but generate
  heavy preview assets lazily when the preview panel opens.
- Dataset block/detail metadata should include source type, display name, dataset
  id, frame count, detected frame range, file pattern, size estimate, dimensions
  when known, validation state, upload/detection time, and last preview time.
- Hide the YAML editor under an advanced/edit-config section by default. Simple
  GUI controls should be the normal path.
- YAML validation should report parse errors, missing required fields, invalid
  ranges/enums, unsafe or unapproved paths, dataset/frame mismatches, and
  conflicts with simple GUI controls.
- When direct YAML edits conflict with simple GUI controls, treat the YAML as the
  source of truth after manual editing, show a conflict/sync warning, and let the
  user refresh simple controls from YAML.
- Promote additional YAML fields only after they have labels, validation, and UI
  semantics. Good next candidates are frame range, preprocessing mode, pipeline
  mode, parallel threads, CellLumen fusion, output naming, and resume source.
- Uploaded datasets should have their own archive/delete lifecycle separate from
  job deletion.
- Block destructive dataset deletion when prepared, running, or historical jobs
  reference the dataset. Prefer archive-only behavior unless referenced files are
  no longer needed.
- Jobs and uploaded datasets should maintain separate block/list preferences.
- Use block view as the default for the first pass, with list view available for
  dense scanning.
- Persist block/list display preferences in local storage.
- Completed, cancelled, and failed job restarts should create a new prepared
  revision/clone instead of mutating the historical run.
- Add optional job names/descriptions for easier dashboard scanning.
- Downloads should default to declared artifacts/logs plus a separate `download
  all runtime files` option for advanced/debug use.
- Do not implement auth/shared-token access control in this pass. Keep it listed
  as a later deployment requirement before broad internal use.
- First left-panel tabs should be Jobs, New Job, Datasets, Outputs/Downloads,
  and Settings.
- The random termination confirmation sequence should be 6 characters.
- Keep primary actions visible: view/monitor, preview, create job,
  start/terminate, and download. Put rename, clone/revision, archive/delete,
  metadata details, and advanced actions in context menus or secondary menus.
- Show lightweight inline progress immediately. Show the panel-level long-pending
  loading overlay after roughly 700-1000 ms.
- Use the top-left back button on nested pages: dataset preview, create job, job
  config editor, job monitor opened from dashboard, output browser, and settings
  subpages.


## Open Questions

- Should approved local dataset roots be managed only through server-side config,
  or should an authenticated advanced/admin panel be allowed to edit them?
- Should `run_config.ini` be treated only as an admin bootstrap/import source,
  or should users be able to select named CellUniverse presets directly in the
  create-job panel?
- For preserved local datasets, should the default scanner use a shallow depth
  such as 3 so layouts like `PAVAK/2026/Pos0/SPIMA` are detected automatically,
  or should each configured root point closer to the TIFF-containing folders?
- Should local detected datasets remain linked read-only by default forever, or
  should the UI offer import/copy into app-owned storage before job creation?
- Should the term shown to users be "workflow", "job", or both in different
  contexts?
- Should deleting a job remove files permanently or archive the job?
- Should uploaded image sequences be individual multi-file selections, folder
  uploads, zip archives, or selected from approved server paths?
- For folder upload, should first pass only accept first-layer TIFF files as
  recommended, or should an advanced recursive candidate-subfolder picker be
  included early?
- What scan-result details are enough before upload confirmation for multi-file
  and folder upload?
- Should raw dataset preview support only 3D real-frame viewing, or also a 2D
  slice preview when available?
- Should uploaded dataset previews be generated eagerly after upload or lazily
  when the preview panel is opened?
- What exact dataset metadata should the uploaded-datasets panel and preview
  action/details panel show?
- Should the create-job panel expose the YAML editor by default, or hide it under
  an advanced/edit-config section?
- What validation feedback should the YAML editor show before a job can be saved
  as prepared/stand-by?
- How should the UI resolve conflicts between simple GUI controls and direct YAML
  edits?
- Which additional YAML fields should be promoted into exposed-parameter modules
  after `debug-basic`?
- Should uploaded datasets have their own delete/archive lifecycle separate from
  job deletion?
- Should dataset deletion be blocked when prepared or historical jobs reference
  that dataset?
- Should the uploaded-datasets page share the same block/list display preference
  as the jobs page, or maintain its own preference?
- Should completed jobs support restart with the same inputs/config?
- Should job names/descriptions be added for easier dashboard scanning?
- Should downloads include every runtime file or only declared artifacts/logs?
- Should access control or shared-token auth be enabled before broader internal
  use?
- What tabs should be included in the first version of the hideable left panel?
- Should block view or list view be the default?
- Should the block/list display preference persist in local storage?
- How long should the random termination confirmation sequence be?
- Which actions should be visible buttons versus context-menu-only shortcuts?
- What delay should trigger the long-pending loading overlay versus lightweight
  inline progress?
- Which pages count as nested subpanels that should replace the top-left icon
  with a back button?
- Should restart be supported for cancelled, failed, or completed jobs, and if
  so should it create a new prepared revision instead of mutating the old run?
