# celluniverse-web-UI

Web UI and backend orchestration layer for the CellUniverse C++ compute engine.

In particular, frontend agents are expected to read the visual-language and
token documentation before changing UI code. This keeps new pages, controls,
colors, shadows, layouts, and workflows from drifting away from the established
scientific-operations interface even when the contributor delegates most of the
implementation details to an AI agent.

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

Backend quick local start:

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

## Frontend Debug Server

The first frontend implementation is a live 2D/3D job viewer for generated TIFF
outputs and cell overlays.

[frontend/README.md](frontend/README.md)

Frontend quick local start after the backend is running:

```bash
cd frontend
npm install
npm run dev
```

Default frontend URL:

```text
http://127.0.0.1:5173
```

Frontend preview limits are configured in:

[frontend/public/viewer-config.json](frontend/public/viewer-config.json)

This file controls the browser preview resolution and sampled Z-plane count
without changing the original exported TIFF files.

## Planning Docs

Current backend/frontend integration plan:

[docs/current-architecture-plan.md](docs/current-architecture-plan.md)

## Temporary Development Log

### 2026-06-03 Light Theme And Visual Language Snapshot

Current viewer-page development state after the light visual theme pass. The
page now shows the live viewer as a pale scientific operations workspace with a
dark top bar, centered job selector, left operational control stack, central 3D
volume viewer, right lineage tree panel, and bottom runtime log dock.

Important progress in this snapshot:

- Reworked the frontend color system into layered hex-only design tokens:
  palette, broad semantic colors, component mappings, and specific component
  colors.
- Added a documented frontend visual language so future pages can follow the
  same layout, surface, typography, control, and interaction rules.
- Added root `AGENTS.md` instructions so future AI-assisted frontend work reads
  the visual-language guide and checks risky UI consistency changes with the
  team.
- Improved job selector behavior so opening the dropdown shows all detected
  jobs, while filtering only begins after the user types.
- Refined button semantics and color ownership for action buttons, toggle
  buttons, cancel/close buttons, slider arrow buttons, and popup dismiss
  controls.
- Tuned the layer controls, dropdown readability, slider handles, status metric
  labels, toast popup colors, and top-bar refresh icon for the current light UI.
- Added a visible runtime log dock under the viewer while keeping the 3D viewer
  and lineage tree visible in the same monitoring workspace.

![Light theme live viewer visual language snapshot](docs/Screenshot%20From%202026-06-03%2004-43-21.png)

### 2026-06-01 Live Viewer And Lineage UI Snapshot

Current viewer-page development state with the portable demo job loaded. The
page now combines the live 3D point-cloud viewer, color-map themed layer
controls, contrast-limit controls, responsive frame-offset navigation, and the
new disk-shaped lineage tree panel in one resizable monitoring workspace.

Important progress in this snapshot:

- Added a right-side lineage tree panel with disk-shaped temporal layout,
  frame-ring guides, colored roots, node labels, pan/zoom interaction, and
  cursor-centered zooming.
- Added lineage-to-viewer interaction: a lineage node can route the 3D viewer
  to the cell's frame and focus region, with a selected-cell outline layer.
- Improved 3D viewer controls with real/synthetic opacity, contrast limits,
  color-map previews, and color-map themed sliders.
- Added responsive frame-offset buttons that keep a readable minimum size and
  reduce the visible offset range instead of collapsing.
- Added a portable cancelled demo job with cached point-cloud previews and
  downsampled 2D TIFF previews so both 3D and 2D viewer paths can be tested
  without committing full-resolution TIFF stacks.

![Live viewer and lineage UI snapshot](docs/Screenshot%20From%202026-06-01%2010-12-06.png)

### 2026-05-31 Live Viewer UI Snapshot

Current 3D live viewer development state with the resizable monitoring layout,
frame-offset controls, layer controls, color-map previews, and color-map themed
opacity/contrast sliders.

![Live viewer UI snapshot](docs/Screenshot%20From%202026-05-31%2014-53-04.png)

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

## Why `AGENTS.md` Exists
This project is open to future open-source contributions from developers who
work primarily through LLM-powered coding agents or developer with good sense on 
visual design but may need assistance from AI on coding. The root `AGENTS.md` file and
the design/architecture documents under `docs/` are part of the project contract
for those agents. They constrain how AI assistants read, modify, and verify the
codebase so a useful deliverable can be produced with a minimum amount of prompt
text while still respecting CellUniverse's visual language, interaction
patterns, and user experience.
