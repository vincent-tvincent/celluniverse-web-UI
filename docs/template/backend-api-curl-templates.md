# Backend API Curl Templates

Set the base URL:

```bash
BASE_URL="http://127.0.0.1:8765"
```

## Health And Config

```bash
curl -sS "$BASE_URL/api/health"
```

```bash
curl -sS "$BASE_URL/api/client-config"
```

```bash
curl -sS "$BASE_URL/api/engine/status"
```

```bash
curl -sS "$BASE_URL/api/config/exposed-parameter-modules"
```

```bash
curl -sS "$BASE_URL/api/config/exposed-parameter-modules/debug-basic"
```

## Dataset APIs

```bash
curl -sS "$BASE_URL/api/datasets/roots"
```

```bash
curl -sS "$BASE_URL/api/datasets/browse?rootId=root_0&path="
```

```bash
curl -sS -X POST "$BASE_URL/api/datasets/validate-local" \
  -H "Content-Type: application/json" \
  -d '{
    "inputPath": "/home/blue-lobster/p2/UCI/CS295p/images/Fluo-N3DH-CE/01/t%03d.tif",
    "firstFrame": 0,
    "lastFrame": 1
  }'
```

```bash
curl -sS -X POST "$BASE_URL/api/datasets/uploads" \
  -F "files=@/absolute/path/to/t000.tif" \
  -F "files=@/absolute/path/to/t001.tif"
```

```bash
curl -sS "$BASE_URL/api/datasets/uploads"
```

```bash
curl -sS "$BASE_URL/api/datasets/uploads/upload_xxx"
```

## Single File Uploads

```bash
curl -sS -X POST "$BASE_URL/api/uploads/initial-csv" \
  -F "file=@/absolute/path/to/initial.csv"
```

```bash
curl -sS -X POST "$BASE_URL/api/uploads/config-yaml" \
  -F "file=@/absolute/path/to/config.yaml"
```

## Jobs

Create a job from local paths:

```bash
curl -sS -X POST "$BASE_URL/api/jobs" \
  -H "Content-Type: application/json" \
  -d '{
    "label": "debug fluo 0-1",
    "type": "tracking",
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
  }'
```

Create a job from uploaded files:

```bash
curl -sS -X POST "$BASE_URL/api/jobs" \
  -H "Content-Type: application/json" \
  -d '{
    "label": "uploaded debug run",
    "type": "tracking",
    "datasetId": "upload_dataset_id",
    "firstFrame": 0,
    "lastFrame": 1,
    "initialCsvUploadId": "upload_initial_csv_id",
    "parameterModuleId": "debug-basic",
    "overrides": {
      "simulation.parallel_threads": 8,
      "simulation.preprocess_mode": "none",
      "pipeline.mode": "standard"
    }
  }'
```

Create a job from uploaded files with uploaded config:

```bash
curl -sS -X POST "$BASE_URL/api/jobs" \
  -H "Content-Type: application/json" \
  -d '{
    "label": "uploaded debug run with config",
    "type": "tracking",
    "datasetId": "upload_dataset_id",
    "firstFrame": 0,
    "lastFrame": 1,
    "initialCsvUploadId": "upload_initial_csv_id",
    "configYamlUploadId": "upload_config_yaml_id",
    "parameterModuleId": "debug-basic",
    "overrides": {
      "simulation.parallel_threads": 8,
      "simulation.preprocess_mode": "none",
      "pipeline.mode": "standard"
    }
  }'
```

```bash
curl -sS "$BASE_URL/api/jobs"
```

```bash
curl -sS "$BASE_URL/api/jobs/job_xxx"
```

```bash
curl -sS -X POST "$BASE_URL/api/jobs/job_xxx/cancel"
```

```bash
curl -sS "$BASE_URL/api/jobs/job_xxx/logs?stream=stdout&tail=500"
```

```bash
curl -sS "$BASE_URL/api/jobs/job_xxx/logs?stream=stderr&tail=500"
```

## Viewer And Artifacts

```bash
curl -sS "$BASE_URL/api/jobs/job_xxx/manifest"
```

```bash
curl -sS "$BASE_URL/api/jobs/job_xxx/frames/0/cells"
```

```bash
curl -sS "$BASE_URL/api/jobs/job_xxx/lineage"
```

```bash
curl -sS "$BASE_URL/api/jobs/job_xxx/artifacts"
```

```bash
curl -sS "$BASE_URL/api/jobs/job_xxx/files/output/cells.csv"
```

```bash
curl -L -OJ "$BASE_URL/api/jobs/job_xxx/download"
```

## SSE Streams

```bash
curl -N "$BASE_URL/api/events"
```

```bash
curl -N "$BASE_URL/api/jobs/job_xxx/events"
```
