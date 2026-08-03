# CellUniverse Backend

FastAPI backend for the CellUniverse web UI. This service is the production
boundary around the C++ compute engine: it validates inputs, materializes
per-job configs, launches CellUniverse, tracks job status, parses outputs, and
serves viewer/download APIs.

## Local Debug Server

Default debug server:

```text
http://127.0.0.1:8765
```

From the repository root:

```bash
cd /home/blue-lobster/p2/UCI/CS295p/celluniverse-web-UI
```

Install dependencies into a local virtual environment:

```bash
cd backend
python3 -m venv .venv
. .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

Run:

```bash
./scripts/run-dev.sh
```

Verify:

```bash
curl -sS http://127.0.0.1:8765/api/health
curl -sS http://127.0.0.1:8765/api/engine/status
```

If using a config other than `config/backend.config.example.json`:

```bash
export CELLUNIVERSE_BACKEND_CONFIG=/path/to/backend.config.local.json
./scripts/run-dev.sh
```

## Configuration

The example backend config is:

```text
config/backend.config.example.json
```

For local machine-specific paths, copy it:

```bash
cp config/backend.config.example.json config/backend.config.local.json
```

Then edit:

```text
server.host
server.port
server.publicBaseUrl
celluniverse.celluniverseCppRoot
celluniverse.buildDir
runtime.runtimeRoot
runtime.maxConcurrentJobs
security.allowedInputRoots
security.allowedInitialCsvRoots
security.allowedConfigRoots
```

Run with that config:

```bash
export CELLUNIVERSE_BACKEND_CONFIG="$PWD/config/backend.config.local.json"
./scripts/run-dev.sh
```

`backend.config.local.json` is gitignored.

### Parallel Jobs

Jobs are queued when all scheduler slots are busy. The default is 10 active
jobs.

To allow more jobs to run at the same time, set `runtime.maxConcurrentJobs` in
your local backend config:

```json
{
  "runtime": {
    "runtimeRoot": "/path/to/celluniverse_web_runtime",
    "maxConcurrentJobs": 10,
    "keepJobDays": 14
  }
}
```

Use this together with `celluniverse.threads` and `limits.maxThreads` so the
machine is not overloaded.

## Deployment Modes

### Same-Machine Debug

Use the default host/port:

```json
{
  "server": {
    "host": "127.0.0.1",
    "port": 8765,
    "publicBaseUrl": "http://127.0.0.1:8765"
  }
}
```

This is the first-version debug mode.

### Temporary Network Deployment

For a machine such as `vulcan.ics.uci.edu`, use a local config like:

```json
{
  "server": {
    "host": "0.0.0.0",
    "port": 8765,
    "publicBaseUrl": "http://vulcan.ics.uci.edu:8765",
    "apiPrefix": "/api",
    "corsAllowedOrigins": [
      "http://vulcan.ics.uci.edu:5173",
      "http://localhost:5173"
    ],
    "eventsTransport": "sse"
  }
}
```

Run:

```bash
export CELLUNIVERSE_BACKEND_CONFIG="$PWD/config/backend.config.local.json"
PYTHONPATH=src .venv/bin/python -m uvicorn \
  celluniverse_backend.main:app \
  --host 0.0.0.0 \
  --port 8765
```

For network-visible deployments, enable at least shared-token auth:

```json
{
  "auth": {
    "mode": "shared-token",
    "tokenEnv": "CELLUNIVERSE_WEB_TOKEN"
  }
}
```

Then run:

```bash
export CELLUNIVERSE_WEB_TOKEN='choose-a-long-random-token'
```

Clients must send:

```text
Authorization: Bearer <token>
```

## No-Sudo Deployment

If the server does not provide `sudo`, a project-local venv is still enough as
long as Python has `venv` and pip.

Check:

```bash
python3 -m venv --help
```

If internet access is available:

```bash
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.txt
```

If internet access is blocked, build a wheelhouse on a compatible machine:

```bash
mkdir wheelhouse
python3 -m pip download -d wheelhouse -r requirements.txt
```

Copy `wheelhouse/` to the server, then:

```bash
python3 -m venv .venv
. .venv/bin/activate
python -m pip install --no-index --find-links ./wheelhouse -r requirements.txt
```

If `venv` is missing, fallback options are:

```text
pip --user
micromamba/conda under your home directory
portable Python
asking the admin to enable python3-venv
```

## CellUniverse Engine Requirements

The backend does not build CellUniverse automatically. It expects a configured
C++ root and an existing binary:

```text
<celluniverseCppRoot>/<buildDir>/celluniverse
```

The default example points to:

```text
/home/blue-lobster/p2/UCI/CS295p/CellUniverse/C++/build/celluniverse
```

Check engine status:

```bash
curl -sS http://127.0.0.1:8765/api/engine/status
```

The response should include:

```json
{
  "ok": true,
  "diagnostics": []
}
```

If `ok` is false, build the C++ engine separately or update
`celluniverseCppRoot` / `buildDir`.

## Important Endpoints

```text
GET  /api/health
GET  /api/client-config
GET  /api/engine/status
GET  /api/slurm/status
GET  /api/slurm/nodes
POST /api/slurm/rescan

GET  /api/config/exposed-parameter-modules
GET  /api/config/exposed-parameter-modules/{moduleId}

GET  /api/datasets/roots
GET  /api/datasets/browse
POST /api/datasets/validate-local
POST /api/datasets/uploads
GET  /api/datasets/uploads
GET  /api/datasets/uploads/{uploadId}
POST /api/uploads/initial-csv
POST /api/uploads/config-yaml

POST /api/jobs
GET  /api/jobs
GET  /api/jobs/{jobId}
POST /api/jobs/{jobId}/cancel
GET  /api/jobs/{jobId}/logs
GET  /api/jobs/{jobId}/events

GET  /api/jobs/{jobId}/manifest
GET  /api/jobs/{jobId}/frames/{frame}/cells
GET  /api/jobs/{jobId}/lineage
GET  /api/jobs/{jobId}/artifacts
GET  /api/jobs/{jobId}/files/{path}
GET  /api/jobs/{jobId}/download
```

## Postman Debugging

Import this file into Postman:

```text
../docs/template/celluniverse-backend.postman_collection.json
```

Postman parses the JSON into separate requests. You can keep the whole
collection and click only the request you want to run.

Useful collection variables:

```text
baseUrl
jobId
uploadId
datasetUploadId
initialCsvUploadId
configYamlUploadId
localInputPath
localInitialCsvPath
```

Copyable curl commands are also in:

```text
../docs/template/backend-api-curl-templates.md
```

## First Exposed Config Surface

The first user-editable CellUniverse parameters are defined in:

```text
config/exposed-parameters/debug-basic.json
```

Currently exposed:

```text
simulation.parallel_threads
simulation.preprocess_mode
pipeline.mode
```

`pipeline.mode` is a backend virtual field:

```text
standard
cell_lumen_fusion
preprocess_only
```

Each tracking job also accepts `exportMode`:

```text
full     existing configured PNG/TIFF frame export (default)
compact  versioned reconstruction records without full frame image stacks
```

The backend applies this choice as the final
`simulation.export_mode` override after merging the selected or uploaded YAML,
so a job cannot silently use a conflicting value from that YAML.

For Slurm jobs, `slurm.nodelist` optionally targets a specific machine. Leave
it unset to let the scheduler choose a machine. The Start Job page obtains its
machine choices from `GET /api/slurm/nodes` and disables machines that Slurm
currently reports as unavailable. The backend revalidates the selected machine
when the prepared job starts:

```json
{
  "runner": "slurm",
  "slurm": {
    "enabled": true,
    "nodelist": "vulcan"
  }
}
```

## Job Runtime Layout

Jobs are stored under:

```text
backend/runtime/jobs/<job_id>/
```

Important files:

```text
request.json
status.json
argv.json
stdout.log
stderr.log
events.ndjson
effective-config.yaml
initial.csv
output/
preview/
downloads/
```

The backend scans `output/` for CellUniverse files and builds:

```text
preview/manifest.json
preview/lineage.json
preview/frames/tNNN/cells.json
artifacts.json
```

The frontend should use the manifest and API URLs instead of scraping folders.

Compact jobs additionally write:

```text
output/compact/manifest.json
output/compact/frames/frame_NNNNNN.json
output/compact/masks/*.cubm
```

For those jobs, real point clouds and slices are sampled from the original
source TIFF with the frame record's effective Z-interpolation ratio. Synthetic
point clouds and slices are sampled directly from compact background/cell
records. This happens in memory; the backend does not reconstruct full TIFF or
PNG stacks. `cells.csv` remains the source for cell outlines, lineage, and
trajectory layers.

## Notes

The backend supports full PNG/TIFF URL manifests, compact on-demand frame
sampling, and parsed `cells.csv` overlays. OME-Zarr remains a possible future
preview representation rather than a requirement for compact export.
