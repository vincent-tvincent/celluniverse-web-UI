# celluniverse-web-UI

Web UI and backend orchestration layer for the CellUniverse C++ compute engine.

## Project Layout

```text
frontend/   Web interface
backend/    FastAPI backend, job runner, output parser, viewer/download API
docs/       Architecture and integration plan
```

## Backend Debug Server

The backend currently has the first runnable implementation. Full setup and
deployment notes are in:

[backend/README.md](backend/README.md)

Quick local start:

```bash
cd backend
python3 -m venv .venv
. .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
./scripts/run-dev.sh
```

Default debug URL:

```text
http://127.0.0.1:8765
```

Verify:

```bash
curl -sS http://127.0.0.1:8765/api/health
curl -sS http://127.0.0.1:8765/api/engine/status
```

## Planning Docs

Current backend/frontend integration plan:

[docs/current-architecture-plan.md](docs/current-architecture-plan.md)

## Postman API Debugging

Import this collection into Postman:

[docs/template/celluniverse-backend.postman_collection.json](docs/template/celluniverse-backend.postman_collection.json)

Postman will parse it into separate clickable requests grouped by area:

```text
Health And Engine
Config
Datasets
Uploads
Jobs
Viewer And Artifacts
SSE Events
```

You do not need to delete unrelated requests. Keep the whole collection and run
only the request you need.

Copyable curl templates are also available:

[docs/template/backend-api-curl-templates.md](docs/template/backend-api-curl-templates.md)
