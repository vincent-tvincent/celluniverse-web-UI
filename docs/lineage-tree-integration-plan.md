# Lineage Tree Integration Plan

Date: 2026-06-01

Status: first implementation slice started.

Implemented in the current web repo:

- backend `cells.csv` parser now builds a semantic lineage graph from CellUniverse daughter labels;
- backend exposes global graph, radial layout, and selected-frame lineage snapshots;
- frontend has a right-side lineage panel with SVG pan/zoom, active-frame highlighting, node labels, and node details;
- node details provide a `Go to cell` action that switches to the 3D viewer and sends one one-time camera focus request;
- the right lineage panel can be resized/hidden, and the 3D viewer panel has a top-edge restore control.

Still planned:

- stable append-only live layout cache for long running jobs;
- SSE lineage-specific change events instead of relying only on normal query refetch;
- richer label collision/level-of-detail behavior for very large trees;
- selected lineage path highlighting and 2D/3D hover cross-highlighting.

Related documents:

- [Lineage Tree Reverse Engineering Report](./lineage-tree-reverse-engineering.md)
- [Current Architecture Plan](./current-architecture-plan.md)

## Purpose

This document turns the lineage-tree reverse engineering work into an integration plan for `celluniverse-web-UI`.

The goal is to add a live lineage tree panel to the web UI that follows the logic of CellUniverse's existing four-window demo while fitting the production backend/frontend split:

```text
CellUniverse C++ worker -> backend runtime job folder -> FastAPI lineage API -> frontend lineage tree viewer
```

The first implementation should use the existing CellUniverse `cells.csv` output. No extra lineage stream is required for the first version.

## Current Finding Summary

The existing demo script is:

```text
/home/blue-lobster/p2/UCI/CS295p/CellUniverse/C++/scripts/4_Windows_Demo_16-9.py
```

The lineage tree panel in that script is not a native napari widget. It is rendered into video frames with OpenCV.

The important logic:

- CellUniverse labels daughters by appending `0` or `1` to the parent lineage code.
- The tree can be reconstructed from the `name` column in `cells.csv`.
- For names like `cell_0101`, the prefix is `cell_` and the lineage code is `0101`.
- Parent links are produced by removing the last daughter digit:

```text
cell_0101 -> cell_010 -> cell_01 -> cell_0
```

- The radial disk layout uses:
  - angle for lineage branch identity;
  - radius for birth frame/time;
  - live radial line extension to the current frame;
  - root-family colors;
  - time rings;
  - labels with greedy collision avoidance.

## Example CSV Inspection

The debug fixture contains:

```text
backend/runtime/jobs/job_demo_fluo_cancelled/output/cells.csv
```

Observed summary:

```text
frames: 0-19
rows: 169
unique non-trash active names: 20
tree nodes including lineage ancestors: 20
```

Inferred split events:

```text
t004: cell_0  -> cell_00, cell_01
t004: cell_1  -> cell_10, cell_11
t007: cell_2  -> cell_20, cell_21
t011: cell_3  -> cell_30, cell_31
t018: cell_00 -> cell_000, cell_001
t018: cell_01 -> cell_010, cell_011
t018: cell_10 -> cell_100, cell_101
t018: cell_11 -> cell_110, cell_111
```

Frame snapshots from that CSV:

```text
t000: visible_nodes=4,  active=cell_0,cell_1,cell_2,cell_3
t004: visible_nodes=8,  active=cell_00,cell_01,cell_10,cell_11,cell_2,cell_3
t007: visible_nodes=10, active=cell_00,cell_01,cell_10,cell_11,cell_20,cell_21,cell_3
t011: visible_nodes=12, active=cell_00,cell_01,cell_10,cell_11,cell_20,cell_21,cell_30,cell_31
t018: visible_nodes=20, active=cell_000,cell_001,cell_010,cell_011,cell_100,cell_101,cell_110,cell_111,cell_20,cell_21,cell_30,cell_31
```

This proves the backend can build lineage snapshots for any frame up to the current frame from `cells.csv` alone.

## Integration Principle

The backend should own lineage parsing and lineage layout data.

Decision note: the backend processes CellUniverse cell names into the lineage tree. The `cell_0101 -> cell_010 -> cell_01 -> cell_0` rule should live in backend code, not frontend code.

The frontend should own interactive rendering, user controls, selection, hover behavior, and display state.

The frontend should not parse raw `cells.csv` directly and should not need to know CellUniverse's daughter-name grammar. It should consume structured lineage JSON from the backend: nodes, edges, frame visibility, active cells, and layout.

## Data Flow

First-version live data flow:

```text
CellUniverse worker writes output/cells.csv
backend detects cells.csv change
backend waits for stable mtime/size
backend parses cells.csv
backend rebuilds lineage graph and per-frame active sets
backend writes/serves lineage preview artifacts
frontend receives SSE notification or polls/refetches
frontend redraws lineage tree for selected frame
```

The backend should treat `cells.csv` as an updating runtime artifact, not only as a final downloadable result.

Live-update requirement: every stable `cells.csv` update should trigger a backend lineage refresh. After the backend rebuilds the lineage graph/frame snapshots, it should notify the frontend through SSE or another job-update signal so the lineage tree can redraw without requiring a full page reload.

Frame-synchronization requirement: the UI lineage tree must always represent the selected frame. If the user switches to frame `n`, the lineage panel should immediately render the tree state at frame `n`:

```text
visible nodes = nodes born by frame n
visible edges = edges whose child is born by frame n
active nodes  = cell names present in cells.csv rows for frame n
```

This applies equally to historical frames and the current live frame.

Animation requirement: every lineage tree display update should transition smoothly. This includes user frame changes, new lineage data from live `cells.csv` updates, node/edge visibility changes, and layout changes. The frontend should animate node positions, edge paths, opacity, and active highlights instead of replacing the tree abruptly.

## Backend Responsibilities

### 1. Watch Or Poll `cells.csv`

For each running job, monitor:

```text
backend/runtime/jobs/<job_id>/output/cells.csv
```

Minimum first-version strategy:

- check file mtime/size during job status refresh;
- debounce changes;
- parse only after file size and mtime are stable across a short interval;
- rebuild lineage artifacts only when the content changed.

Possible later strategy:

- incremental parsing based on byte offset;
- filesystem event watcher;
- worker-side event when `cells.csv` is flushed.

### 2. Parse Cell Rows

The parser should extract:

```text
frame
name
isTrash
x, y, z
aRadius, bRadius, cRadius
thetaX, thetaY, thetaZ
```

Lineage tree generation only needs `frame`, `name`, and optionally `isTrash`, but keeping geometry attached is useful for linking tree nodes to 3D/2D viewer overlays.

Parsing decisions:

- use CellUniverse daughter-label convention for normal jobs;
- ignore `trash_*` and `isTrash=1` by default;
- allow a debug option to include trash cells;
- keep source row provenance for debugging.

### 3. Build Semantic Lineage Graph

For all rows up to the latest parsed frame:

```text
node id = cell name
parent id = remove final 0/1 from lineage code
root id = first lineage-code digit with prefix
children = inferred daughters
firstFrame = first frame where this name or synthesized ancestor appears
lastFrame = last frame where this name appears as active
```

For a requested display frame `f`:

```text
visibleNodes = nodes where firstFrame <= f
visibleEdges = edges where child.firstFrame <= f
activeNodes = names present in frame f
pastNodes = visibleNodes - activeNodes
futureNodes = nodes where firstFrame > f
```

The frontend normally should receive `visibleNodes`, `visibleEdges`, and `activeNodes`; `futureNodes` can be omitted unless a preview/debug mode needs them.

### 4. Build Or Cache Layout

The four-window demo layout needs:

```text
angle
radius
root color
label
```

Disk-layout requirement: our lineage tree should preserve the same radial disk concept as the script. The tree starts at the center and expands outward over time. Frame `n` is represented by the `n`th concentric circle from the center, and a cell whose first appearance/birth is frame `n` should place its node on that frame circle. Parent-child branches should therefore move outward as time advances, making temporal progression readable as distance from the center.

For completed jobs, the backend can use the full final tree and reproduce the offline demo layout exactly:

- divide disk into root sectors;
- collect final leaves per root;
- distribute leaves uniformly in each sector;
- place internal nodes at circular mean of child angles;
- map birth frame to radius.

For live jobs, the layout must avoid major jumps. Candidate strategies:

```text
Strategy A: append-only sectors
  Keep each existing node angle fixed. Allocate new children inside a reserved branch wedge.

Strategy B: stable cache with minor reflow
  Recompute layout, but preserve old angles when movement would exceed a threshold.

Strategy C: final-layout mode only
  During live tracking show semantic tree with simpler layout, then switch to final radial layout after completion.
```

Recommended first version:

```text
Use Strategy A for live jobs.
Use final full-tree layout for completed jobs.
```

This gives live stability while still allowing a polished final view.

### 5. Write Preview Artifacts

The backend can write derived artifacts under:

```text
backend/runtime/jobs/<job_id>/preview/lineage.json
backend/runtime/jobs/<job_id>/preview/lineage-layout.json
backend/runtime/jobs/<job_id>/preview/lineage-frames/<frame>.json
```

Suggested separation:

```text
lineage.json
  semantic graph, node metadata, edge metadata, available frames

lineage-layout.json
  layout coordinates and labels

lineage-frames/<frame>.json
  active/visible state for one frame
```

This avoids returning a huge per-frame payload when the frontend only needs one selected frame.

## Candidate API Surface

These endpoint names are not final, but they define the expected shape.

```text
GET /api/jobs/{job_id}/lineage
```

Returns global lineage graph:

```json
{
  "jobId": "job_demo_fluo_cancelled",
  "source": "cells.csv",
  "updatedAt": "2026-06-01T00:00:00Z",
  "frames": [0, 1, 2],
  "nodes": [],
  "edges": []
}
```

```text
GET /api/jobs/{job_id}/lineage/layout
```

Returns layout coordinates:

```json
{
  "jobId": "job_demo_fluo_cancelled",
  "mode": "live-stable",
  "nodes": {
    "cell_0": { "angle": -1.2, "radiusFrame": 0, "label": "P1", "rootColor": "#ff5cd6" }
  }
}
```

```text
GET /api/jobs/{job_id}/lineage/frames/{frame}
```

Returns frame-specific visibility:

```json
{
  "jobId": "job_demo_fluo_cancelled",
  "frame": 18,
  "visibleNodes": ["cell_0", "cell_00"],
  "visibleEdges": [{ "source": "cell_0", "target": "cell_00" }],
  "activeNodes": ["cell_000", "cell_001"],
  "missingFrameData": false
}
```

Optional:

```text
GET /api/jobs/{job_id}/lineage/snapshot?frame=18
```

This can combine graph, layout, and frame state into one frontend-friendly response if repeated network requests become annoying.

## Frontend Responsibilities

### Panel Arrangement

The lineage tree should be introduced as a right-side panel in the main workspace.

Required behavior:

- the lineage panel sits on the right side of the display area;
- it can be hidden and shown like the existing left-side panels;
- when hidden, it collapses toward the right edge;
- its restore/visible edge button should appear on the right edge, matching the existing restore-tab pattern but mirrored to the right;
- it can be resized freely by the user;
- unlike the current left panel constraints, the lineage panel should not have a strict fixed maximum size limit;
- resizing should allow the user to make the lineage plane very large when needed.

After the lineage panel is added, the 2D/3D viewer panel should also become hideable.

Viewer hide behavior:

- hiding the viewer collapses it toward the top;
- the viewer restore/visible edge button should appear along the top edge;
- this should follow the same interaction idea as the existing hidden-panel restore buttons;
- hiding the viewer should let the lineage panel or other visible workspace content use the freed space;
- restoring the viewer should bring the 2D/3D display back without resetting the selected job, frame, lineage selection, or viewer mode.

### 1. New Lineage Panel

Add a lineage view to the frontend as a floating 2D plane inside the main display panel, not as a fixed-size static chart. The interaction should feel closer to a map viewer: the lineage tree can be much larger than the visible viewport while details stay crisp at every zoom level.

First version capabilities:

- render radial disk tree on a large pan/zoom 2D plane;
- right-mouse drag pans the lineage plane;
- mouse wheel zooms in and out;
- select frame from the existing time slider;
- highlight active cells at that frame;
- show inactive/past branches with lower opacity;
- draw parent-child edges;
- color by root family;
- show labels on all nodes, with collision/level-of-detail behavior if necessary;
- hover node to show original cell name and frame metadata;
- click node to expand a larger detail panel for necessary cell details;
- provide a `Go to cell` action from the detail panel that focuses the matching cell in the 3D viewer.

Node detail panel should include at least:

```text
cell name
parent
children
root family
birth frame / first observed frame
last observed frame
active/inactive status at selected frame
trash/debug status when relevant
Go to cell action
```

`Go to cell` behavior:

- trigger an immediate action on the 3D viewer;
- move the selected frame to the cell's relevant frame if needed;
- focus the camera on the cell's recorded 3D location for that frame;
- zoom and place the camera so the selected cell is clearly visible;
- when the selected cell is at or near a split moment, optionally frame the sibling cells from the same parent together;
- do not lock the 3D viewer after the jump;
- after the one-time camera move, the user must still be able to orbit, pan, zoom, and browse the 3D view freely.

### Color Coding Policy

The four-window script uses a small hardcoded root-color list. That is not enough for the web UI. The lineage viewer should use a smarter color policy that avoids duplicate-looking colors and stays comfortable to read.

Requirements:

- assign stable colors by root family;
- avoid exact duplicate colors for visible roots;
- avoid near-duplicate colors when many roots are visible;
- be aware of the current viewer/theme background color when selecting colors;
- maintain readable contrast against the dark viewer background;
- maintain readable contrast between edge/node color and node labels;
- avoid color combinations that feel harsh, vibrating, or tiring when many branches are shown together;
- keep colors stable across frames and live updates;
- preserve existing root colors when new roots appear;
- support color-blind-friendly defaults as much as practical.

Suggested first-version approach:

```text
Use a curated categorical palette for the first N roots.
When roots exceed the palette, generate additional colors in perceptual color space.
Reject generated colors whose contrast against the current background or distance from existing colors is too low.
Store rootId -> color in the backend layout cache so colors remain stable.
```

The frontend should not randomly choose colors each render. Color assignment should come from the backend layout data or from a deterministic shared palette rule. If the UI theme/background changes, the color policy should be able to regenerate or remap colors while still preserving root identity as much as possible.

### 2. Synchronize With Existing Frame State

The lineage tree should use the same selected frame as the viewer:

```text
viewer selected frame -> lineage frame snapshot
lineage node detail Go to cell -> one-time 3D camera focus
```

This keeps 3D/2D image inspection and lineage inspection aligned.

### 3. Live Updates

When backend reports new `cells.csv` data:

- refetch lineage graph/layout/frame snapshot;
- preserve user-selected frame when possible;
- if user is following live, move to latest frame;
- show a small update indicator when new lineage branches appear.

### 4. Rendering Choice

Recommended frontend renderer:

```text
SVG with pan/zoom viewport for first version
```

Reason:

- tree edge and label interaction is easier than canvas;
- node hover/click is direct;
- performance should be fine for hundreds to low thousands of nodes;
- SVG remains sharp while zooming;
- it matches an interactive 2D map-like plane better than a full WebGL scene for the first version.

Canvas can be used later if tree size becomes large.

## Relationship To Existing Viewer

The lineage tree is conceptually different from the current 2D/3D image viewer:

```text
2D/3D viewer:
  shows image volumes and cell geometry for one frame/slice

Lineage tree:
  shows temporal ancestry and active cell identity across frames
```

They should share:

- selected job;
- selected frame;
- selected cell id in a later phase;
- live update notifications.

They should not share rendering code.

## Implementation Phases

### Phase 1: Backend Semantic Lineage

Goal: reliable lineage graph from `cells.csv`.

Tasks:

- replace or extend current simple `build_lineage()`;
- support `cell_010` underscore grammar;
- ignore trash by default;
- produce nodes/edges/active frame sets;
- write tests using the debug fixture;
- expose `/lineage` and `/lineage/frames/{frame}`.

Acceptance checks:

- debug fixture reports the known split events at frames 4, 7, 11, and 18;
- `frame=0`, `frame=4`, `frame=18` snapshots match inspected counts;
- nonexistent job id returns 404;
- missing `cells.csv` returns empty lineage with a clear state.

### Phase 2: Backend Live Refresh

Goal: lineage updates during a running job.

Tasks:

- detect `cells.csv` mtime/size changes;
- debounce mid-write file state;
- rebuild preview lineage artifacts;
- emit job event when lineage changes;
- make artifacts cache-safe and not regenerated when unchanged.

Acceptance checks:

- appending new frame rows updates `lineage.json`;
- unchanged `cells.csv` does not trigger repeated rebuilds;
- frontend receives/refetches after backend event.

### Phase 3: Layout Generation

Goal: radial disk coordinates suitable for frontend rendering.

Tasks:

- implement completed-job final layout equivalent to demo script;
- implement live-stable layout cache;
- generate compact labels;
- map frame to normalized radius;
- expose `/lineage/layout`.

Acceptance checks:

- completed debug fixture layout has stable root sectors;
- live additions do not move existing nodes substantially;
- time radius maps frame 0 near inner radius and last parsed frame near outer radius.

### Phase 4: Frontend Lineage Viewer

Goal: interactive lineage tree panel.

Tasks:

- add lineage query hooks;
- add lineage panel component;
- render nodes/edges as SVG;
- connect selected frame state;
- add node hover and selection state;
- add live update indicator.

Acceptance checks:

- selecting frame 0, 4, 7, 11, 18 changes active nodes correctly;
- branch colors remain stable;
- labels do not cover the entire tree;
- panel remains usable on narrow and wide browser windows.

### Phase 5: Viewer Cross-Linking

Goal: connect lineage and image views.

Tasks:

- clicking lineage node selects cell id;
- node detail panel includes `Go to cell`;
- `Go to cell` sends a one-time focus command to the 3D viewer;
- 3D viewer camera frames the selected cell, or sibling cells at a split moment, using that frame's cell coordinates;
- camera focus does not become a lock mode; user navigation remains free after the jump;
- selected cell highlights in 2D/3D view;
- hovering 2D/3D cell can highlight lineage node;
- selected lineage path can be emphasized.

Acceptance checks:

- selecting `Go to cell` for `cell_010` jumps the 3D camera to that cell's current-frame location when available;
- after the jump, orbit/pan/zoom still work normally;
- inactive/past cells show meaningful metadata instead of failing silently.

## Important Open Decisions

These should be resolved before writing the final implementation plan:

1. Should trash lineage be hidden by default with a debug toggle?
2. Should the first frontend version render lineage as a side panel, bottom panel, or separate tab?
3. Should live jobs always use append-only layout, or is small reflow acceptable?
4. Should the backend expose one combined snapshot endpoint or separate graph/layout/frame endpoints?
5. Should missing CSV frames be shown as "missing data" or carried forward like the demo video?
6. Should labels use original cell names, compact family labels, or both?
7. How many roots should receive distinct colors before cycling?
8. Should non-CellUniverse uploaded CSVs be rejected for lineage or accepted with low-confidence inferred edges?

## Risks

### Layout Jumping

If the backend recomputes the demo's final angular layout on every live update, branches may shift as new daughters appear. This would feel unstable. Use a persistent layout cache for live jobs.

### Large Trees

The SVG approach is good for the first version, but very large lineage trees may require canvas or level-of-detail label rendering.

### Mid-Write CSV Reads

If the backend reads `cells.csv` while CellUniverse is writing it, parsing can fail or produce incomplete state. Use mtime/size debounce and graceful fallback to the previous valid lineage.

### Ambiguous Imports

CellUniverse jobs can trust the `0`/`1` daughter naming convention. Uploaded external CSVs need validation before the same parser is applied.

### Missing Frame Semantics

The demo carries the previous active state forward when a frame has no lineage CSV rows. That is visually smooth but can hide missing output. The web UI should surface missing-data state somewhere.

## What Is Ready

Already understood and ready for detailed planning:

- CellUniverse daughter naming convention.
- How to derive parent/child edges.
- How to build per-frame active state.
- How the demo's radial disk layout works.
- Which parts of the demo are presentation-only.
- How a backend live polling flow can work.
- Which example fixture events can validate implementation.

## Next Planning Step

The next document should be a complete implementation plan with:

- exact backend models and response schemas;
- exact file locations to edit;
- test cases and fixture expectations;
- frontend component hierarchy;
- UI placement decision;
- event/refetch behavior;
- phased pull-request boundaries.
