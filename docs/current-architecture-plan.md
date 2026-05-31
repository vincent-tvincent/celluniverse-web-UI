# Current Architecture Plan

This document captures the current partial plan for integrating the existing
CellUniverse C++ compute engine into this production web UI project.

## Project Roles

```text
celluniverse-web-UI/
  frontend/   Web interface only
  backend/    Business logic, API, job orchestration, output parsing
  docs/       Architecture and integration notes
```

The existing CellUniverse C++ project remains the compute engine. The web UI
backend controls it as a validated dependency.

```text
CellUniverse/C++/
  C++ compute engine
  scientific tracking algorithm
  configs, scripts, models, build output
```

## Naming Decision

Use `backend/`, not a separate `worker/` folder for now.

The earlier "worker" concept lives inside backend modules such as:

```text
backend/src/jobs/
backend/src/runners/
backend/src/parsers/
```

Only split into a separate `worker/` process later if the system needs:

```text
backend/  API server
worker/   separate background compute daemon
```

For the current stage, one backend service is enough.

## Backend Responsibilities

The backend owns business logic and the boundary to CellUniverse:

```text
Create and validate jobs
Validate configured CellUniverse engine root
Build safe CellUniverse command arguments
Launch and monitor the C++ process
Set runtime environment such as CELLUNIVERSE_THREADS
Track job lifecycle: queued, running, completed, failed, cancelled
Parse stdout/stderr into progress events
Parse cells.csv into web-friendly JSON
Expose output images, TIFFs, checkpoints, logs, and manifests
Support resume/cancel/retry later
```

The frontend should not know how to run the C++ binary directly.

## Frontend Responsibilities

The frontend should stay focused on user interaction and visualization:

```text
Configure a job through forms
Start/cancel/resume jobs through backend API
Show job status and logs
Browse frames and z-slices
Display real/synthetic output images
Overlay or visualize cell positions from parsed cells.csv
Show lineage information
```

## Compute Engine Configuration

Instead of copying the C++ engine into this repo immediately, provide a backend
configuration file where the user supplies one CellUniverse C++ root.

Preferred root meaning:

```text
celluniverseCppRoot = /home/blue-lobster/p2/UCI/CS295p/CellUniverse/C++
```

From that root, derive engine paths:

```text
binary:       <celluniverseCppRoot>/<buildDir>/celluniverse
configDir:    <celluniverseCppRoot>/config
scriptsDir:   <celluniverseCppRoot>/scripts
modelsDir:    <celluniverseCppRoot>/models
defaultConfig:<celluniverseCppRoot>/config/config.yaml
presetIni:    <celluniverseCppRoot>/scripts/run_config.ini
```

Example backend config shape:

```json
{
  "celluniverseCppRoot": "/home/blue-lobster/p2/UCI/CS295p/CellUniverse/C++",
  "buildDir": "build",
  "runtimeRoot": "/run/media/blue-lobster/disk3/celluniverse_web_runtime",
  "threads": "auto"
}
```

Optional overrides can be added later for unusual deployments:

```json
{
  "overrides": {
    "binary": null,
    "configDir": null,
    "modelsDir": null
  }
}
```

## Engine Validation

At backend startup or before first job, validate:

```text
celluniverseCppRoot exists
CMakeLists.txt exists
src/ exists
includes/ exists
config/ exists
configured build binary exists
binary is executable
runtimeRoot exists or can be created
runtimeRoot is writable
```

If the binary is missing, report a clear "engine not built" error instead of
failing during job execution.

## CellUniverse Runtime Contract

Normal tracking command:

```bash
celluniverse <firstFrame> <lastFrame> <input_pattern_or_dir_or_file> <output_dir> <config.yaml> <initial.csv> [resumeFrom] [resumeSourceDir]
```

Other supported modes:

```bash
celluniverse --cell-lumen <input_frame.tif> <output_dir> <config.yaml> <csv_output>
celluniverse --lineage-tree [options] <output.png|output.mp4> <cells.csv> [...]
```

Important output files:

```text
<output_dir>/cells.csv
<output_dir>/png/real/<frame>/<slice>.png
<output_dir>/png/synth/<frame>/<slice>.png
<output_dir>/tiff/real/<frame>.tif
<output_dir>/tiff/synth/<frame>.tif
<output_dir>/checkpoints/frame_XXX.txt
```

Primary CSV contract:

```csv
file,name,x,y,z,aRadius,bRadius,cRadius,theta_x,theta_y,theta_z,isTrash
```

The first backend parser should focus on `cells.csv`.

## Runtime Data Placement

Keep generated runtime data outside git.

Recommended runtime root:

```text
/run/media/blue-lobster/disk3/celluniverse_web_runtime/
  jobs/
    <job_id>/
      request.json
      status.json
      stdout.log
      stderr.log
      output/
        cells.csv
        png/
        tiff/
        checkpoints/
  uploads/
  cache/
  tmp/
```

The repo may keep a small ignored local runtime directory:

```text
backend/runtime/
  .gitkeep
```

Large microscopy inputs, generated PNG/TIFF output, C++ build directories, and
model/dependency artifacts should not be committed to the web UI repo.

## Backend Module Sketch

Planned backend hierarchy:

```text
backend/
  README.md
  src/
    api/
    jobs/
    runners/
    parsers/
    services/
    storage/
    config/
    contracts/
    utils/
  tests/
  scripts/
  runtime/
```

Suggested ownership:

```text
api/       HTTP/WebSocket/SSE endpoints for frontend
jobs/      job state, queue, cancellation, resume metadata
runners/   process execution wrappers for CellUniverse modes
parsers/   cells.csv, checkpoints, logs, output manifests
services/  higher-level business logic
storage/   filesystem/runtime persistence
config/    environment and engine config loading
contracts/ shared API/result/event shapes
utils/     safe paths, IDs, time, command argument helpers
```

## Production Engine Strategy

Current preferred approach:

```text
Use a configurable external CellUniverse C++ root.
Derive required engine paths relative to that root.
Treat the engine as a validated production dependency.
```

Possible future production mode:

```text
Bundle a frozen CellUniverse engine snapshot under compute/celluniverse/
and point the same backend config at that bundled root.
```

The backend should support both strategies by depending on the configured
`celluniverseCppRoot`, not hardcoded absolute paths.

## User Config And Initial CSV Handling

Users may upload their own `initial.csv`, and they may need to modify selected
CellUniverse config parameters. The backend should control this pipeline. The
frontend should not pass arbitrary production config files directly to the C++
process.

Per job, backend materializes frozen inputs:

```text
runtime/jobs/<job_id>/
  request.json
  status.json
  effective-config.yaml
  initial.csv
  stdout.log
  stderr.log
  output/
```

CellUniverse should run against the per-job files:

```bash
celluniverse <firstFrame> <lastFrame> <input> <jobOutputDir> \
  <runtime/jobs/job_id/effective-config.yaml> \
  <runtime/jobs/job_id/initial.csv>
```

This makes every run reproducible: the output directory contains the exact
effective config and initial cells used for that job.

### Config Pipeline

Use this model:

```text
trusted base config.yaml
+ allowlisted user overrides
= runtime/jobs/<job_id>/effective-config.yaml
```

The trusted base config can come from the configured CellUniverse root:

```text
<celluniverseCppRoot>/config/config.yaml
```

Later, backend-owned templates can also be added:

```text
backend/config/templates/
  embryo-base.yaml
  hl60-base.yaml
```

The backend must validate all overrides before merging them into the effective
config. User-editable paths should be allowlisted by a schema module, not
hardcoded in frontend forms.

### Uploaded Config Modes

If users upload a full `config.yaml`, support it cautiously.

Recommended default mode:

```text
Uploaded config is treated as a base candidate.
Backend validates structure and required keys.
Backend still applies the exposed-parameter allowlist for user changes.
```

Advanced/admin-only mode:

```text
Use uploaded config as-is after validation.
```

The second mode should not be the default because CellUniverse has many
scientific and runtime parameters that can make jobs unstable, very expensive,
or incompatible with production expectations.

### Uploaded Initial CSV

Uploaded `initial.csv` is allowed, but it should be validated and copied into
the per-job runtime directory before launch.

Validation should check:

```text
CSV parses
recognized CellUniverse or Napari-style columns exist
cell names are non-empty and unique when names are provided
x, y, z are numeric
radii are numeric when provided
coordinates and radii are within reasonable configured limits
file/frame column is compatible with selected input and first frame
file size and row count are within backend limits
```

Never run directly from an upload temp path.

## Exposed Parameter Modules

The list of CellUniverse parameters open to users should be modularized as
backend-owned schema files. These modules define the user-facing config surface
for a job type or dataset profile.

Suggested layout:

```text
backend/
  config/
    exposed-parameters/
      default.json
      embryo.json
      hl60.json
      advanced.json
```

Each module declares:

```text
module id
display label
base config reference
groups for UI organization
field paths into YAML
field type
allowed range or enum values
default value
optional UI hints
```

Example shape:

```json
{
  "id": "embryo-basic",
  "label": "Embryo Basic",
  "baseConfig": "config/config.yaml",
  "groups": [
    {
      "id": "runtime",
      "label": "Runtime",
      "fields": [
        {
          "path": "simulation.iterations_per_cell",
          "label": "Iterations Per Cell",
          "type": "integer",
          "min": 1,
          "max": 10000,
          "default": 500,
          "ui": "number"
        },
        {
          "path": "simulation.preprocess_mode",
          "label": "Preprocess Mode",
          "type": "enum",
          "values": ["none", "n2v2"],
          "default": "none",
          "ui": "select"
        }
      ]
    }
  ]
}
```

Frontend can render configuration controls from the selected module:

```text
GET /config/exposed-parameter-modules
GET /config/exposed-parameter-modules/:id
```

A job request should submit only module-approved overrides:

```json
{
  "parameterModuleId": "embryo-basic",
  "overrides": {
    "simulation.iterations_per_cell": 750,
    "simulation.preprocess_mode": "n2v2"
  }
}
```

Backend validation rules:

```text
parameterModuleId is known
all override paths exist in the selected module
all override values match declared type
numbers satisfy min/max constraints
enum values are allowed
base config exists
merged effective config can be written to the job directory
```

This separates responsibilities:

```text
CellUniverse config.yaml: full scientific configuration
Backend exposed-parameter modules: safe user-editable surface
Frontend: dynamic controls generated from modules
Job runtime: frozen effective config for reproducibility
```

## Output, Preview, And Download Dataflow

CellUniverse will export microscopy outputs to a configured local runtime
location. Users need both:

```text
downloadable original/exported files
online napari-like preview in the browser
```

These should be treated as two related but separate outputs.

```text
archive output: original files for download and reproducibility
preview output: web-optimized files/chunks for interactive viewing
```

Recommended job layout:

```text
runtime/jobs/<job_id>/
  output/
    cells.csv
    png/
      real/
      synth/
    tiff/
      real/
      synth/
    checkpoints/

  preview/
    manifest.json
    frames/
      t000/
        real.ome.zarr/
        synth.ome.zarr/
        cells.json
      t001/
        real.ome.zarr/
        synth.ome.zarr/
        cells.json

  downloads/
    output.zip
```

The original exported TIFF/PNG/CSV files remain the archive/download source.
The preview directory exists to make browser interaction responsive.

### Browser Dataflow

The backend should not send large TIFF stacks or full image payloads through
normal JSON API responses. Instead, it sends metadata, events, and URLs.

Dataflow:

```text
CellUniverse C++ output
  -> backend detects new output
    -> backend parses cells.csv and builds/updates preview files
      -> backend updates preview/manifest.json
        -> backend emits small live event
          -> frontend refetches manifest if needed
            -> frontend viewer fetches only visible image chunks/slices by URL
```

Example live event:

```json
{
  "type": "frame.preview_ready",
  "jobId": "job_123",
  "frame": 0
}
```

Example manifest shape:

```json
{
  "jobId": "job_123",
  "frames": [
    {
      "t": 0,
      "layers": {
        "real": {
          "format": "ome-zarr",
          "url": "/api/jobs/job_123/preview/frames/t000/real.ome.zarr"
        },
        "synth": {
          "format": "ome-zarr",
          "url": "/api/jobs/job_123/preview/frames/t000/synth.ome.zarr"
        },
        "cells": {
          "format": "ellipsoid-json",
          "url": "/api/jobs/job_123/frames/0/cells"
        }
      }
    }
  ]
}
```

The frontend uses this manifest to construct viewer layers.

### Preview Format Strategy

Start simple, then scale.

First implementation:

```text
Use existing PNG slice output for 2D preview.
Load only current time T and current z-slice Z.
Add real/synth/cell layer toggles.
```

PNG preview manifest can use URL templates:

```json
{
  "real": {
    "format": "png-stack",
    "urlTemplate": "/api/jobs/job_123/files/png/real/0/{z}.png"
  }
}
```

Scale-up implementation:

```text
Convert or index each completed frame into per-frame OME-Zarr.
Use OME-Zarr/chunked access for large datasets.
```

Per-frame OME-Zarr is preferred first:

```text
preview/frames/t000/real.ome.zarr/
preview/frames/t000/synth.ome.zarr/
preview/frames/t001/real.ome.zarr/
preview/frames/t001/synth.ome.zarr/
```

This is simpler than maintaining one append-only time-series Zarr while the
job is still running. Later, the backend can compact or additionally produce:

```text
preview/real_timeseries.ome.zarr/
preview/synth_timeseries.ome.zarr/
```

### Napari-Like Viewer Features

Target frontend viewer behavior:

```text
layer panel with real/synth/cell overlays
turn layers on/off
opacity controls
time slider
z slider
2D slice view first
3D volume view later
live update as new frames become preview-ready
```

Cell overlays come from parsed `cells.csv`, stored per frame:

```text
preview/frames/t000/cells.json
preview/frames/t001/cells.json
```

Initial overlay rendering can be simple:

```text
cell centers
approximate circles/ellipses on current z-slice
labels/toggleable names
```

Later overlay rendering can use full rotated ellipsoid cross-sections from:

```text
x, y, z, aRadius, bRadius, cRadius, theta_x, theta_y, theta_z
```

### Live Update Model

Backend emits events over SSE or WebSocket:

```text
job.started
frame.output_detected
frame.preview_building
frame.preview_ready
cells.updated
job.completed
job.failed
```

When a new frame becomes available, the frontend should update viewer metadata
without loading that frame immediately unless the user navigates to it.

```text
User viewing frame 3
Frame 20 becomes ready
Frontend updates time-slider range/availability
Frontend does not load frame 20 image data yet
```

### Download Model

Downloads should be served separately from preview.

Suggested endpoint:

```text
GET /api/jobs/:jobId/download
```

The download archive should include:

```text
cells.csv
effective-config.yaml
initial.csv
stdout.log
stderr.log
png/
tiff/
checkpoints/
```

Preview chunks should not be included in the default download unless the user
explicitly asks for them.

### Performance Rules

To keep the browser responsive:

```text
Do not use raw TIFF stacks as the primary browser preview.
Do not send large image payloads through JSON.
Do not load all z-slices at once.
Do not load all timepoints at once.
Make 2D slice viewing the first viewer target.
Add 3D volume viewing after the 2D path is stable.
Load only visible layers.
Load only current T/Z for PNG preview.
For OME-Zarr, fetch only needed chunks/resolution levels.
Debounce slider scrubbing.
Cancel stale image requests while the user scrubs.
Prefetch nearby z/time slices only after idle.
Use lower-resolution previews while dragging when available.
Switch to full resolution after interaction settles.
Keep cell overlay JSON small and per-frame.
Run TIFF-to-preview conversion as a backend background step.
```

If preview conversion lags behind CellUniverse output, the frontend should show
a clear intermediate state:

```text
Frame ready, preview building...
```

Then replace it with the interactive preview once `frame.preview_ready` arrives.

### Suggested Implementation Order

```text
1. Launch jobs and capture stdout/stderr logs.
2. Serve original CellUniverse output files and zip downloads.
3. Parse cells.csv into per-frame JSON.
4. Add job events through SSE or WebSocket.
5. Build 2D PNG slice viewer with real/synth layer toggles.
6. Add cell overlays from parsed cells.json.
7. Add live frame updates.
8. Add OME-Zarr preview conversion for larger data.
9. Add 3D view.
```

## Deployment Wiring And Security Boundaries

The web app may be temporarily deployed on a shared or network-visible machine,
for example:

```text
vulcan.ics.uci.edu
```

Backend configuration should make frontend/backend wiring explicit and should
protect the host from arbitrary filesystem access or arbitrary command
execution.

### Backend Deployment Config

Backend server config should live under:

```text
backend/config/
  backend.config.example.json
  backend.config.local.json
  backend.config.production.json
```

Commit example/default config files. Gitignore machine-specific config files
that contain local paths, hostnames, or tokens.

Example temporary deployment config:

```json
{
  "server": {
    "host": "0.0.0.0",
    "port": 8000,
    "publicBaseUrl": "http://vulcan.ics.uci.edu:8000",
    "apiPrefix": "/api",
    "corsAllowedOrigins": [
      "http://vulcan.ics.uci.edu:5173",
      "http://localhost:5173"
    ],
    "eventsTransport": "sse"
  },
  "celluniverse": {
    "celluniverseCppRoot": "/home/blue-lobster/p2/UCI/CS295p/CellUniverse/C++",
    "buildDir": "build",
    "threads": "auto"
  },
  "runtime": {
    "runtimeRoot": "/run/media/blue-lobster/disk3/celluniverse_web_runtime",
    "maxConcurrentJobs": 1,
    "keepJobDays": 14
  },
  "security": {
    "allowedInputRoots": [
      "/home/blue-lobster/p2/UCI/CS295p/images",
      "/run/media/blue-lobster/disk3/celluniverse_inputs"
    ]
  },
  "uploads": {
    "maxUploadSizeMb": 500
  },
  "preview": {
    "defaultFormat": "png-stack",
    "enableOmeZarr": true,
    "enable3D": false
  }
}
```

### Frontend Client Config

The frontend should not hardcode backend URLs into source code. It should load
runtime client configuration from the backend:

```text
GET /api/client-config
```

Example same-origin response:

```json
{
  "apiBaseUrl": "/api",
  "eventsTransport": "sse",
  "eventsUrl": "/api/events",
  "previewUrlPrefix": "/api/jobs",
  "downloadUrlPrefix": "/api/jobs",
  "features": {
    "pngPreview": true,
    "omeZarrPreview": true,
    "threeDViewer": false
  }
}
```

For split frontend/backend development, the same config can use absolute URLs:

```json
{
  "apiBaseUrl": "http://vulcan.ics.uci.edu:8000/api",
  "eventsTransport": "sse",
  "eventsUrl": "http://vulcan.ics.uci.edu:8000/api/events",
  "previewUrlPrefix": "http://vulcan.ics.uci.edu:8000/api/jobs",
  "downloadUrlPrefix": "http://vulcan.ics.uci.edu:8000/api/jobs"
}
```

### Filesystem Protection

Treat every path and job request from the frontend as untrusted.

Use allowed roots:

```json
{
  "security": {
    "allowedInputRoots": [
      "/home/blue-lobster/p2/UCI/CS295p/images",
      "/run/media/blue-lobster/disk3/celluniverse_inputs"
    ]
  },
  "runtime": {
    "runtimeRoot": "/run/media/blue-lobster/disk3/celluniverse_web_runtime"
  }
}
```

Backend should accept input paths only if their canonical resolved paths are
inside an allowed root.

Validation model:

```text
user path
  -> normalize
  -> resolve symlinks / realpath
  -> compare against realpath of each allowed root
  -> allow only if resolved path is inside one allowed root
```

Do not compare raw path strings. Resolve symlinks first, otherwise a symlink
inside an allowed directory could point outside it.

Reject paths such as:

```text
/etc/passwd
/home/other-user/private
../../somewhere
/run/media/blue-lobster/disk3/random-system-folder
```

### Output Directory Protection

Users should not choose arbitrary output directories.

Bad request shape:

```json
{
  "outputDir": "/some/user/chosen/path"
}
```

Preferred model:

```text
backend generates runtimeRoot/jobs/<job_id>/output
```

Users may choose a display label/job name, but backend owns the filesystem
location.

### Upload Protection

Uploads should land only in backend-controlled directories:

```text
runtimeRoot/uploads/<upload_id>/
runtimeRoot/jobs/<job_id>/initial.csv
runtimeRoot/jobs/<job_id>/effective-config.yaml
```

Validation rules:

```text
initial.csv must parse as CSV
config.yaml must parse as YAML
TIFF uploads must use accepted .tif/.tiff extensions when upload support exists
max upload size is enforced
file count limits are enforced
uploaded files are copied into the job directory before execution
```

Never run CellUniverse directly from a temporary upload path.

### Process Launch Protection

Launch CellUniverse with an argument array, not a shell string.

Good:

```text
spawn(binary, [firstFrame, lastFrame, input, output, config, initialCsv])
```

Bad:

```text
exec("celluniverse " + userInput)
```

Only the configured and validated CellUniverse binary may be launched. The
frontend must never provide an executable path or shell command.

### Config Override Protection

User config overrides must come from exposed-parameter modules.

Validation rules:

```text
override path must exist in selected exposed-parameter module
value must match declared type
numbers must satisfy min/max
enum values must be allowed
admin-only fields require admin mode
unknown config paths are rejected
```

Examples:

```text
simulation.iterations_per_cell -> allowed if module exposes it
simulation.resume_source_dir -> admin-only or rejected
some.random.path -> rejected
```

### Runtime Limits

Protect the machine from accidental huge jobs:

```json
{
  "limits": {
    "maxConcurrentJobs": 1,
    "maxFrameCount": 200,
    "maxUploadSizeMb": 500,
    "maxRuntimeMinutes": 720,
    "maxThreads": 32
  }
}
```

Backend should reject or cap job requests outside configured limits.

When `threads` is set to `auto`, backend should resolve it to hardware capacity
but still respect `maxThreads`.

### File Serving Protection

Frontend file access should be job-scoped.

Good:

```text
GET /api/jobs/:jobId/files/<job-relative-path-or-file-id>
```

Bad:

```text
GET /api/file?path=/arbitrary/local/path
```

For every file request:

```text
resolve requested file under runtimeRoot/jobs/<job_id>/
ensure resolved path is still inside that job directory
serve only allowed file types or known manifest entries
```

This prevents the API from becoming a general filesystem browser.

### Temporary Network Auth

For temporary deployment on a network-visible host, add at least a simple
shared-token mode before allowing job creation or file browsing.

Example config:

```json
{
  "auth": {
    "mode": "shared-token",
    "tokenEnv": "CELLUNIVERSE_WEB_TOKEN"
  }
}
```

Clients send:

```text
Authorization: Bearer <token>
```

This is not full account management, but it is much safer than exposing an open
file browser and process launcher on a shared host.

### Audit Trail

Each job should store the validated request:

```text
runtime/jobs/<job_id>/request.json
```

Include:

```text
submitted user or token identity if available
original requested paths
resolved/canonical input paths
selected exposed-parameter module
validated overrides
effective config path
initial CSV path
generated output directory
CellUniverse argv array
timestamps
```

Compact security rule:

```text
Frontend can request actions.
Backend validates paths/config, creates runtime files, chooses output locations,
and launches only the known CellUniverse binary.
```

## Job Manager, Status Dashboard, And Cancellation

Users may start several jobs from the frontend. The backend should therefore
include a persistent job manager even if the first production setting allows
only one active CellUniverse process at a time.

Job states:

```text
queued
running
completed
failed
cancelled
interrupted
```

Initial queue policy:

```text
many submitted jobs
one active running job by default
remaining jobs queued
maxConcurrentJobs configurable
```

Each job should have a runtime folder:

```text
runtime/jobs/<job_id>/
  request.json
  status.json
  stdout.log
  stderr.log
  events.ndjson
  effective-config.yaml
  initial.csv
  output/
  preview/
```

Example `status.json`:

```json
{
  "id": "job_123",
  "label": "embryo frame 0-50",
  "type": "tracking",
  "state": "running",
  "createdAt": "2026-05-30T12:00:00Z",
  "startedAt": "2026-05-30T12:00:08Z",
  "finishedAt": null,
  "firstFrame": 0,
  "lastFrame": 50,
  "currentFrame": 18,
  "lastCompletedFrame": 17,
  "completedFrames": 18,
  "totalFrames": 51,
  "progress": 0.3529,
  "pid": 12345,
  "exitCode": null,
  "error": null,
  "partialOutputsAvailable": true,
  "outputReady": {
    "cellsCsv": true,
    "previewFrames": [0, 1, 2, 3]
  }
}
```

### Task Dashboard API

The frontend task/status page should be backed by these APIs:

```text
GET  /api/jobs
GET  /api/jobs/:jobId
GET  /api/jobs/:jobId/logs?stream=stdout&tail=500
GET  /api/jobs/:jobId/logs?stream=stderr&tail=500
GET  /api/jobs/:jobId/events
POST /api/jobs/:jobId/cancel
```

`GET /api/jobs` should return active and recent jobs:

```json
[
  {
    "id": "job_123",
    "label": "embryo 0-50",
    "state": "running",
    "currentFrame": 18,
    "lastCompletedFrame": 17,
    "totalFrames": 51,
    "progress": 0.3529,
    "createdAt": "2026-05-30T12:00:00Z",
    "startedAt": "2026-05-30T12:00:08Z"
  },
  {
    "id": "job_124",
    "label": "test 0-10",
    "state": "queued",
    "queuePosition": 1,
    "progress": 0
  }
]
```

The dashboard should show:

```text
job label/id
job state
queue position
current frame
last completed frame
completion percentage
start/end time
stdout/stderr debug logs
preview/download availability
cancel button for queued/running jobs
```

### Cancellation Behavior

Cancellation rules:

```text
queued job:
  remove from queue
  mark cancelled
  keep request/status files

running job:
  send graceful terminate to child process
  wait configured grace period
  force kill if still running
  mark cancelled
  keep partial outputs
  emit job.cancelled
```

Partial outputs should not be deleted automatically. If completed frames already
exist, the user should still be able to preview or download them.

Cancelled status example:

```json
{
  "state": "cancelled",
  "finishedAt": "2026-05-30T12:30:00Z",
  "exitCode": null,
  "error": "Cancelled by user",
  "partialOutputsAvailable": true
}
```

### Backend Restart Recovery

On startup, backend should scan:

```text
runtime/jobs/*/status.json
```

For jobs previously marked `running`, backend should check whether the stored
PID still exists and still belongs to a CellUniverse process launched by this
backend. If not, mark the job:

```text
interrupted
```

Keep files for inspection/download. Do not assume a job completed just because
the backend was restarted.

## Frame Progress Tracking From Output Folder

Current-frame and completed-frame status can be derived by monitoring the
configured job output folder. This should be used as the reliable completion
source, with stdout parsing used for faster live updates.

Recommended hybrid model:

```text
primary fast signal: stdout/stderr parser
reliable completion signal: output folder scanner
```

Backend should monitor:

```text
runtime/jobs/<job_id>/output/cells.csv
runtime/jobs/<job_id>/output/png/real/<frame>/
runtime/jobs/<job_id>/output/png/synth/<frame>/
runtime/jobs/<job_id>/output/tiff/real/<frame>.tif
runtime/jobs/<job_id>/output/tiff/synth/<frame>.tif
runtime/jobs/<job_id>/output/checkpoints/frame_XXX.txt
```

The strongest completion marker is expected to be:

```text
output/checkpoints/frame_XXX.txt
```

because checkpoint save happens after a frame has been optimized, copied
forward, images exported, cells saved, and checkpointed.

Frame completion rule:

```text
Frame N completed if:
  checkpoints/frame_NNN.txt exists
or:
  cells.csv contains rows for frame N
  and a corresponding image output marker exists
```

Image preview readiness is separate from tracking completion:

```text
Frame N output detected:
  raw PNG/TIFF files exist

Frame N preview ready:
  preview/manifest.json includes frame N
  and frame N preview layer files exist
```

For PNG folders, avoid treating directory existence alone as complete. A folder
may exist before all slice files are written. Use one of:

```text
expected file count from z_slices
or file count stability for 1-2 polling intervals
```

The backend can read `z_slices` from `effective-config.yaml`.

Suggested polling algorithm:

```text
every 1-2 seconds while job is queued/running/recently finishing:
  scan checkpoints/
  parse highest checkpoint frame number
  parse cells.csv frame/file column
  scan png/tiff output markers
  update lastCompletedFrame
  if process is running:
    currentFrame = max(stdoutCurrentFrame, lastCompletedFrame + 1)
  else:
    currentFrame = lastCompletedFrame
  progress = completedFrames / totalFrames
  write status.json
  emit job.updated if values changed
```

Example status:

```json
{
  "currentFrame": 18,
  "lastCompletedFrame": 17,
  "completedFrames": 18,
  "totalFrames": 51,
  "progress": 0.3529
}
```

Filesystem watchers can be added later, but polling should be implemented
first because it is reliable on external disks and mounted filesystems.

### Debug Log Parsing

CellUniverse may export debug logs into configured output/debug folders. The
backend should support configurable debug log roots instead of hardcoding a
single path.

Example config:

```json
{
  "debugLogs": {
    "enabled": true,
    "roots": [
      "/run/media/blue-lobster/disk3/celluniverse_output"
    ],
    "patterns": [
      "**/*.log",
      "**/*.txt",
      "**/logs/*"
    ]
  }
}
```

The exact root should be validated the same way as other filesystem paths. If
a configured debug log root does not exist, backend should report it in engine
or runtime diagnostics rather than failing job execution.

Debug log parser goals:

```text
extract current frame hints
extract frame timing
extract split attempts/accepts/rejects if present
extract warnings/errors
extract preprocessing/preview status hints
surface recent debug lines in the dashboard
link debug files in the job detail page when they are inside allowed roots
```

Parsing should be best-effort. The job status should not depend exclusively on
debug log text because log formats can change. Completion should still be
confirmed through output files such as checkpoints, `cells.csv`, and preview
manifest entries.

Suggested event mapping:

```text
stdout/stderr line parsed         -> log.line
frame start detected              -> frame.started
checkpoint frame_NNN detected     -> frame.completed
cells.csv rows for frame detected -> cells.updated
PNG/TIFF output detected          -> frame.output_detected
preview manifest updated          -> frame.preview_ready
warning/error line parsed         -> job.warning or job.error
```

## Backend Dependency Deployment Backup Plan

If the backend is implemented with FastAPI, the deployment host needs Python
dependencies. This should not require `sudo` if Python `venv` is available.

### Check For Venv

Run:

```bash
python3 -m venv --help
```

If it prints help text, `venv` is available.

Stronger test:

```bash
python3 -m venv /tmp/venv-test
/tmp/venv-test/bin/python --version
/tmp/venv-test/bin/python -m pip --version
```

### Primary No-Sudo Setup

Create a project-local virtual environment:

```bash
cd /home/blue-lobster/p2/UCI/CS295p/celluniverse-web-UI/backend
python3 -m venv .venv
. .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install fastapi uvicorn pydantic pydantic-settings python-multipart pyyaml
```

Packages install under:

```text
backend/.venv/
```

not into system Python.

### Dependency Files To Commit

Commit dependency declarations, not installed packages:

```text
backend/requirements.txt
```

or:

```text
backend/pyproject.toml
```

The `.venv/` directory should be gitignored.

### If Internet Access Is Blocked

Use an offline wheelhouse. On a machine with internet and a compatible Python
version/platform:

```bash
mkdir wheelhouse
python3 -m pip download -d wheelhouse \
  fastapi uvicorn pydantic pydantic-settings python-multipart pyyaml
```

Copy `wheelhouse/` to the server, then install without network:

```bash
python3 -m venv .venv
. .venv/bin/activate
python -m pip install --no-index --find-links ./wheelhouse \
  fastapi uvicorn pydantic pydantic-settings python-multipart pyyaml
```

### If Venv Is Missing

Fallback options:

```text
1. Ask admin to enable/install python3-venv.
2. Use pip --user if pip is available.
3. Use micromamba/conda installed under the user's home directory.
4. Use a portable Python environment.
5. Use Apptainer/Singularity/Podman only if the server supports it.
```

For `pip --user`:

```bash
python3 -m pip install --user fastapi uvicorn pydantic pydantic-settings python-multipart pyyaml
```

This installs under the user's home directory, commonly:

```text
~/.local/
```

### Native Package Caveat

Basic FastAPI backend dependencies are expected to work well in a venv.

Later preview/conversion dependencies may be more sensitive:

```text
numpy
tifffile
zarr
ome-zarr
```

If wheels are available, no `sudo` should be needed. If pip tries to compile
from source and system headers/libraries are missing, use an offline wheelhouse,
micromamba, or ask the admin for the missing system support.

## Dataset Intake: Uploads And Local Dataset Entry

Users need to provide raw 3D TIFF stack datasets, `initial.csv`, and optionally
`config.yaml`. The backend should support two dataset entry paths:

```text
1. Upload dataset through the web UI.
2. Select or enter an existing local dataset path from allowed input roots.
```

The second path is useful for debugging and local production workflows where
datasets already exist on the machine.

### Uploaded Dataset Flow

User uploads:

```text
raw 3D TIFF stack(s)
initial.csv
optional config.yaml
```

Upload staging layout:

```text
runtime/uploads/<upload_id>/
  raw/
    t000.tif
    t001.tif
    ...
  initial.csv
  config.yaml
  upload-manifest.json
```

Before launching a job, backend materializes job-local inputs:

```text
runtime/jobs/<job_id>/
  input/
    raw/
      t000.tif
      t001.tif
      ...
  initial.csv
  effective-config.yaml
  output/
```

CellUniverse then runs against the job-local input files:

```bash
celluniverse 0 50 \
  runtime/jobs/<job_id>/input/raw/t%03d.tif \
  runtime/jobs/<job_id>/output \
  runtime/jobs/<job_id>/effective-config.yaml \
  runtime/jobs/<job_id>/initial.csv
```

Never launch CellUniverse directly against a temporary upload path.

### Uploaded Dataset Validation

Backend should validate uploaded datasets before job creation:

```text
file extensions are .tif or .tiff
file count is greater than 0
file count is within maxFrameCount
total upload size is within maxUploadSize
filenames are sortable or match a supported frame pattern
TIFF pages can be opened enough to inspect dimensions and raw z count
dimensions are consistent across frames
initial.csv parses
initial.csv is compatible with the selected first frame
optional config.yaml parses and follows config policy
```

For very large uploads, resumable/chunked upload may be added later. The first
version can use regular multipart upload with explicit size limits.

### Local Dataset Entry

For debug/direct local entry, allow users to select or type an existing dataset
path only if it resolves inside configured `allowedInputRoots`.

Example allowed roots:

```json
{
  "security": {
    "allowedInputRoots": [
      "/home/blue-lobster/p2/UCI/CS295p/images",
      "/run/media/blue-lobster/disk3/celluniverse_inputs"
    ]
  }
}
```

Possible APIs:

```text
GET  /api/datasets/roots
GET  /api/datasets/browse?rootId=images&path=Fluo-N3DH-CE/01
POST /api/datasets/validate-local
POST /api/datasets/uploads
GET  /api/datasets/:datasetId
```

The browse API must be limited to allowed roots and should never become an
arbitrary filesystem browser.

### Dataset Records

Whether uploaded or local, backend should normalize the selected input into a
dataset record.

Uploaded dataset example:

```json
{
  "datasetId": "ds_123",
  "sourceType": "upload",
  "inputMode": "pattern",
  "inputPath": "/runtime/jobs/job_123/input/raw/t%03d.tif",
  "firstFrame": 0,
  "lastFrame": 50,
  "frameCount": 51,
  "zSlicesRaw": 33,
  "width": 512,
  "height": 512
}
```

Local dataset example:

```json
{
  "datasetId": "local_fluo_01",
  "sourceType": "local",
  "inputMode": "pattern",
  "inputPath": "/home/blue-lobster/p2/UCI/CS295p/images/Fluo-N3DH-CE/01/t%03d.tif",
  "firstFrame": 0,
  "lastFrame": 50
}
```

Clean flow:

```text
upload/select dataset
  -> validate dataset
    -> create dataset record
      -> create CellUniverse job from dataset + initial.csv + config choices
```

This keeps dataset validation separate from job execution.

## Cell, Lineage, And Artifact Delivery

CellUniverse output files such as `cells.csv` are core frontend data sources,
not just downloadable artifacts. The frontend needs them for:

```text
cell overlays
cell history over time
lineage tree construction
debug inspection
final download bundle
```

The backend should treat `cells.csv` and similar lineage-related output files
as first-class artifacts.

### Cells CSV Dataflow

Backend should handle `cells.csv` in multiple forms:

```text
raw artifact:
  output/cells.csv

parsed per-frame overlay data:
  preview/frames/t000/cells.json
  preview/frames/t001/cells.json

derived lineage graph:
  preview/lineage.json
```

Dataflow:

```text
CellUniverse writes or appends output/cells.csv
  -> backend detects update
    -> backend parses cells.csv
      -> writes per-frame cells.json
      -> builds or updates lineage.json
      -> updates artifact registry
      -> emits cells.updated / lineage.updated
        -> frontend refreshes overlay or lineage tree data
```

Suggested APIs:

```text
GET /api/jobs/:jobId/cells.csv
GET /api/jobs/:jobId/frames/:frame/cells
GET /api/jobs/:jobId/lineage
GET /api/jobs/:jobId/artifacts
```

### Lineage Graph

CellUniverse lineage can be derived from naming rules:

```text
parent abc -> daughters abc0 and abc1
parent abc0 -> daughters abc00 and abc01
```

Derived `lineage.json` example:

```json
{
  "nodes": [
    {
      "id": "abc",
      "firstFrame": 0,
      "lastFrame": 12
    },
    {
      "id": "abc0",
      "parent": "abc",
      "firstFrame": 13,
      "lastFrame": 50
    }
  ],
  "edges": [
    {
      "source": "abc",
      "target": "abc0",
      "type": "division"
    }
  ]
}
```

If CellUniverse later exports explicit lineage/tree files, backend should
register those artifacts too and prefer explicit exported lineage metadata over
name-derived inference when available.

### Artifact Registry

Each job should have an artifact registry so the frontend does not scrape
folders directly.

Example:

```json
{
  "artifacts": [
    {
      "id": "cells_csv",
      "label": "Cells CSV",
      "path": "output/cells.csv",
      "kind": "table",
      "download": true
    },
    {
      "id": "lineage_json",
      "label": "Lineage Graph",
      "path": "preview/lineage.json",
      "kind": "lineage",
      "download": true
    },
    {
      "id": "stdout_log",
      "label": "Standard Output Log",
      "path": "stdout.log",
      "kind": "log",
      "download": true
    }
  ]
}
```

Frontend should ask backend what exists:

```text
GET /api/jobs/:jobId/artifacts
```

Then use artifact IDs/URLs for preview, lineage tree, debug display, and
downloads.

### Final Download Bundle

The final user download should bundle the useful job artifacts together:

```text
downloads/output.zip
  request.json
  status.json
  effective-config.yaml
  initial.csv
  stdout.log
  stderr.log
  output/
    cells.csv
    png/
    tiff/
    checkpoints/
  preview/
    manifest.json
    lineage.json
    frames/*/cells.json
```

Preview chunks such as OME-Zarr may be optional in the default zip because
they can be large. Include them only if explicitly requested.

Download APIs:

```text
GET /api/jobs/:jobId/download
GET /api/jobs/:jobId/artifacts/:artifactId/download
```
