# API Debug Templates

This folder contains copy/import templates for debugging the backend API.

Default local backend:

```text
http://127.0.0.1:8765
```

## Files

```text
celluniverse-backend.postman_collection.json
  Import this directly into Postman.

backend-api-curl-templates.md
  Copy individual curl commands or import a curl command into Postman.
```

## Postman Variables

The collection uses these variables:

```text
baseUrl        http://127.0.0.1:8765
moduleId       debug-basic
rootId         root_0
browsePath
jobId          job_xxx
frame          0
filePath       output/cells.csv
uploadId       upload_xxx
datasetFile1   /absolute/path/to/t000.tif
datasetFile2   /absolute/path/to/t001.tif
initialCsvFile /absolute/path/to/initial.csv
configYamlFile /absolute/path/to/config.yaml
```

For file-upload requests, set the file path in Postman's form-data file picker
after importing. Postman may not preserve local file paths from the collection.
