# Backend API Reference

This document lists the FastAPI endpoints currently implemented by the
CellUniverse backend.

Default local debug server:

```text
http://127.0.0.1:8765
```

Interactive OpenAPI docs while the backend is running:

```text
http://127.0.0.1:8765/docs
http://127.0.0.1:8765/openapi.json
```

Copy/import debug templates are available in:

```text
docs/template/
```

Postman collection:

```text
docs/template/celluniverse-backend.postman_collection.json
```

## Health And Client Config

```text
GET /api/health
GET /api/client-config
GET /api/engine/status
GET /api/slurm/status
GET /api/slurm/nodes
POST /api/slurm/rescan
```

## Exposed Parameter Config

```text
GET /api/config/exposed-parameter-modules
GET /api/config/exposed-parameter-modules/{module_id}
```

Current module:

```text
debug-basic
```

Currently exposed fields:

```text
simulation.parallel_threads
simulation.preprocess_mode
pipeline.mode
```

## Dataset APIs

```text
GET  /api/datasets/roots
GET  /api/datasets/browse?rootId={root_id}&path={relative_path}
POST /api/datasets/validate-local
POST /api/datasets/uploads
GET  /api/datasets/uploads
GET  /api/datasets/uploads/{upload_id}
```

### Validate Local Dataset

```http
POST /api/datasets/validate-local
Content-Type: application/json
```

```json
{
  "inputPath": "/home/blue-lobster/p2/UCI/CS295p/images/Fluo-N3DH-CE/01/t%03d.tif",
  "firstFrame": 0,
  "lastFrame": 1
}
```

### Upload Dataset TIFFs

```http
POST /api/datasets/uploads
Content-Type: multipart/form-data
```

Field:

```text
files: one or more .tif/.tiff files
```

### List Uploaded Datasets And Files

```text
GET /api/datasets/uploads
GET /api/datasets/uploads/{upload_id}
```

Response shape:

```json
[
  {
    "uploadId": "upload_abc123",
    "kind": "dataset",
    "createdAt": "2026-05-31T18:00:00Z",
    "fileCount": 2,
    "totalBytes": 123456789,
    "files": [
      {
        "name": "t000.tif",
        "relativePath": "raw/t000.tif",
        "size": 61728394
      }
    ]
  }
]
```

## Upload APIs

```text
POST /api/uploads/initial-csv
POST /api/uploads/config-yaml
```

### Upload Initial CSV

```http
POST /api/uploads/initial-csv
Content-Type: multipart/form-data
```

Field:

```text
file: .csv
```

### Upload Config YAML

```http
POST /api/uploads/config-yaml
Content-Type: multipart/form-data
```

Field:

```text
file: .yaml or .yml
```

## Job APIs

```text
POST /api/jobs
GET  /api/jobs
GET  /api/jobs/{job_id}
POST /api/jobs/{job_id}/cancel
GET  /api/jobs/{job_id}/logs?stream=stdout|stderr&tail=500
GET  /api/events
GET  /api/jobs/{job_id}/events
```

### Create Tracking Job

```http
POST /api/jobs
Content-Type: application/json
```

Using local paths:

```json
{
  "label": "debug fluo 0-1",
  "type": "tracking",
  "exportMode": "compact",
  "inputPath": "/home/blue-lobster/p2/UCI/CS295p/images/Fluo-N3DH-CE/01/t%03d.tif",
  "firstFrame": 0,
  "lastFrame": 1,
  "initialCsvPath": "/home/blue-lobster/p2/UCI/CS295p/CellUniverse/C++/config/embryo/initial_embryo_0.csv",
  "parameterModuleId": "debug-basic",
  "overrides": {
    "simulation.parallel_threads": 8,
    "simulation.preprocess_mode": "none",
    "pipeline.mode": "standard"
  }
}
```

`exportMode` is optional and defaults to `full`. Use `compact` to suppress
full real/synthetic frame stacks and serve reconstructed previews from the
compact frame records plus the original source TIFF.

To target a specific Slurm machine, set `runner` to `slurm` and send its node
name through `slurm.nodelist`. The Start Job page lists current nodes from
`GET /api/slurm/nodes`. Omit `nodelist` or set it to `null` to let the scheduler
choose. A selected machine requires `nodes: 1` and is revalidated when the
prepared job starts:

```json
{
  "runner": "slurm",
  "slurm": {
    "enabled": true,
    "nodelist": "vulcan",
    "nodes": 1,
    "cpusPerTask": 32,
    "memory": "64G",
    "timeLimit": "24:00:00"
  }
}
```

Using uploaded dataset/config files:

```json
{
  "label": "uploaded debug run",
  "type": "tracking",
  "exportMode": "compact",
  "datasetId": "upload_abc123",
  "firstFrame": 0,
  "lastFrame": 1,
  "initialCsvUploadId": "upload_def456",
  "configYamlUploadId": "upload_ghi789",
  "parameterModuleId": "debug-basic",
  "overrides": {
    "simulation.parallel_threads": 8,
    "simulation.preprocess_mode": "none",
    "pipeline.mode": "standard"
  }
}
```

## Viewer And Artifact APIs

```text
GET /api/jobs/{job_id}/manifest
GET /api/jobs/{job_id}/frames/{frame}/cells
GET /api/jobs/{job_id}/lineage
GET /api/jobs/{job_id}/artifacts
GET /api/jobs/{job_id}/files/{file_path}
GET /api/jobs/{job_id}/download
```

The frontend should use `/manifest`, `/frames/{frame}/cells`, `/lineage`, and
`/artifacts` instead of scraping job folders directly.

## SSE Events

Global job snapshot stream:

```text
GET /api/events
```

Job-specific event stream:

```text
GET /api/jobs/{job_id}/events
```

Event types currently emitted include:

```text
job.queued
job.started
process.started
log.line
job.updated
job.finished
job.cancelled
```
