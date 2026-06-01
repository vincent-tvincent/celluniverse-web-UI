# Lineage Tree Reverse Engineering Report

Date: 2026-06-01

Source analyzed:

- `/home/blue-lobster/p2/UCI/CS295p/CellUniverse/C++/scripts/4_Windows_Demo_16-9.py`
- `/home/blue-lobster/p2/UCI/CS295p/CellUniverse/C++/scripts/make_lineage_tree_demo.py`
- `/home/blue-lobster/p2/UCI/CS295p/CellUniverse/C++/docs/plans/2026-03-27-cpp-restructure.md`
- `/home/blue-lobster/p2/UCI/CS295p/CellUniverse/C++/docs/changelogs/changelogv4.md`
- Current web backend reference: `backend/src/celluniverse_backend/parsers/cells.py`

This report focuses only on the lineage tree panel in `4_Windows_Demo_16-9.py`. The other three visual panels in the four-window demo are intentionally ignored except where they affect timing or layout.

Note on naming: the user request referred to `cell.csv`; in the inspected code and outputs, the file is usually named `cells.csv`, and the script accepts any discovered CSV whose filename contains `cell`.

Note on napari: the optional `--napari-preview` path opens a napari viewer for projected real and synthetic image stacks only. The lineage tree window/panel itself is rendered into the MP4 frames with OpenCV drawing calls, not as a native napari layer.

## Primary Source Map

Important source locations in `4_Windows_Demo_16-9.py`:

- `Node` and `TreeLayout` data classes: lines 59-79.
- CSV discovery and frame parsing: lines 120-151.
- lineage name parsing: lines 191-230.
- frame-name ingestion and filtering: lines 233-261.
- ancestor chain and birth frame inference: lines 264-283.
- node construction: lines 286-310.
- root/child sorting and leaf collection: lines 313-330.
- time-to-radius mapping and angular layout: lines 333-377.
- compact label generation: lines 380-403.
- time rings: lines 587-610.
- lineage edge drawing: lines 612-629.
- active life-line drawing: lines 632-651.
- root-family statistics: lines 654-691.
- label placement: lines 694-810.
- lineage panel render entry point: lines 812-872.
- tree panel rectangle and disk layout: lines 875-890 and 971-988.
- main data assembly and render loop: lines 1116-1221.

## Executive Summary

The lineage tree in `4_Windows_Demo_16-9.py` is built from CellUniverse's daughter-name contract in `cells.csv`. CellUniverse labels daughter cells by appending `0` or `1` to the parent lineage code, and the demo reconstructs the binary tree from that naming convention. The tree is then drawn as a radial disk:

- angle encodes lineage branch identity;
- radius encodes the frame where a node first appears;
- colored edge paths connect parent birth points to child birth points;
- active cells extend outward to the current frame radius;
- root families receive one of four repeating colors.

The result is visually useful for an offline demo because the whole future tree is known before rendering. For the web UI, the same naming contract is a valid first production source of lineage updates as long as the backend keeps re-reading the live `cells.csv` during tracking. Explicit lineage fields would still be useful later for validation, uncertainty, split status, and non-standard uploaded data.

## Input Data Flow

The demo accepts one or more CSV files through `--csv`, or discovers CSVs under the selected output directory. Discovery uses every `*/*.csv` file whose filename contains `cell`.

Relevant functions:

- `discover_csvs(base_dir)` scans stage folders and sorts them by a natural stage key.
- `read_frame_names(csv_paths)` reads only `file` and `name` columns from each CSV.
- `frame_number(frame_file)` extracts the first number from the `file` stem.
- `filter_frame_names(...)` keeps only frames between `--first-frame` and `--last-frame`.

The lineage tree ignores all geometric columns such as `x`, `y`, `z`, radii, and rotation. It also ignores `isTrash`. A row contributes to the lineage tree if:

- its `file` value contains a parseable frame number;
- its `name` value is non-empty.

Important behavior: when several CSV files contain the same frame, the later CSV in sorted order replaces the previous set of names for that frame. The code does not union duplicate frames and does not report a duplicate-frame conflict.

## Name Grammar

The lineage parser has two modes.

For names containing an underscore:

```text
cell_0101
```

The parser splits at the final underscore:

```text
prefix = "cell_"
code   = "0101"
```

The root is `prefix + code[0]`, so `cell_0101` belongs to root `cell_0`.

The parent is produced only when the code length is greater than one and the final code character is `0` or `1`:

```text
cell_0101 -> cell_010
cell_010  -> cell_01
cell_01   -> cell_0
cell_0    -> no parent
```

For names without an underscore:

```text
abc0101
```

The parent is inferred by removing a trailing `0` or `1`:

```text
abc0101 -> abc010
abc010  -> abc01
abc01   -> abc0
abc0    -> abc
abc     -> no parent
```

For CellUniverse-generated tracking output, this is the expected daughter-label convention. There is no separate parent column in `cells.csv`; parentage is derived from the lineage code. Missing parents are synthesized as tree nodes so the branch remains drawable even if the parent row is not present in the currently loaded frame range.

## Tree Node Model

The demo's `Node` object stores:

- `name`: original or synthesized cell name;
- `parent`: inferred parent name or `None`;
- `root`: inferred root family name;
- `code`: lineage code used for sorting and depth;
- `depth`: code depth, adjusted through parent recursion;
- `children`: inferred children;
- `angle`: assigned later by the layout algorithm;
- `radius`: assigned later by the time/radius layout.

The node graph is built by `build_nodes(all_visible_names)`, which calls `ensure_node(name)` for every observed name. `ensure_node()` recursively creates missing ancestors and adds the child to the parent node's `children` set.

This means the rendered tree may contain nodes that never existed as CSV rows. That is intentional for name-derived parent branches, but it can also create false ancestors when the naming convention is accidentally matched.

## Birth Frame Inference

The function `build_birth_frames(frame_names)` walks frames in increasing order. For every observed name, it calls `lineage_chain(name)` and assigns the first frame seen for every member of the chain.

Example:

```text
frame 12 has cell_0101
```

If `cell_010`, `cell_01`, or `cell_0` were not already seen, they all receive birth frame `12`.

This makes the radial layout complete even when ancestors are missing from the CSV, but it also means missing ancestors are born at the same time as the first observed descendant. That is not biologically precise and should not be treated as a true split history.

## Active Cell State Per Frame

During rendering, the script iterates through every frame. If `frame_names` contains the current frame, `last_active_names` is replaced by that frame's cell names. If the current frame has no lineage CSV data, the previous active set is reused.

This means missing CSV frames do not create a blank tree state. The video keeps the last known active cells. The script prints a warning for missing lineage frames, but the visual output hides the missing-data gap by carrying state forward.

## Radial Disk Layout

The tree panel lives in the lower-left rectangle of the 16:9 canvas. `build_tree_layout(...)` reserves a header area and a bottom statistics area. The drawing region is a disk centered inside the remaining content area.

The radius is time-based:

```text
first frame -> inner radius
last frame  -> outer radius
```

`frame_radius(layout, frame)` linearly interpolates from `inner_radius` to `outer_radius`. Every node's radius is set to the radius for its inferred birth frame.

This is the biggest difference from the standalone `make_lineage_tree_demo.py`, where radius is depth-based. The four-window version uses radius as a time axis, not as generation depth.

## Angular Layout

The angular layout is assigned once, before rendering the video.

Algorithm:

1. Sort roots by natural sort of lineage code.
2. Split the full circle into equal sectors, one sector per root.
3. Leave an 8-degree gap inside each root sector.
4. Collect all terminal leaves under each root.
5. Place leaves uniformly across the root's sector.
6. Place each internal node at the circular average of its children's angles.

Because the layout is built from all visible names across the full selected frame range, it knows future leaves. This gives a stable offline video: branches do not shift when a future cell appears. But it is not directly suitable for live online rendering unless the layout has a strategy for adding future leaves without reflowing the whole tree.

## Edge Drawing

Each parent-child edge is drawn as a polar path:

1. Start at the parent node's birth point:

   ```text
   radius = parent.radius
   angle  = parent.angle
   ```

2. Draw a radial segment outward or inward to the child birth radius while staying at the parent angle.
3. Draw a circular arc at the child birth radius from the parent angle to the child angle.
4. Draw a filled dot at the child birth point.

This creates a clean "radial then angular" branching style. It is easier to read than a straight chord because time remains encoded by distance from the center.

## Active Life Lines

For every currently active cell name, the panel draws a radial line from:

```text
min(node.birth_radius, current_frame_radius)
```

to:

```text
current_frame_radius
```

at the node's assigned angle.

So the active cell appears to grow outward along its lineage ray as time advances. A live dot is drawn at the current frame radius. This is separate from the permanent birth node dot.

## Time Rings

The disk has concentric time rings:

- every frame gets a faint ring;
- the first frame, last frame, and frames divisible by 10 get stronger rings;
- labels are attempted for `[first_frame, 20, 40, 60, last_frame]` when those frames fall within the selected range.

The labels are not fully dynamic. For runs that are not near 1-84 or 0-200, hardcoded labels such as 20/40/60 may be poor choices.

## Node Labels

The script does not display original cell names by default. It generates compact family labels:

```text
P1, P2, ...
G1, G2, ...
Y1, Y2, ...
C1, C2, ...
```

The four families map to four repeating root colors:

- Purple / P
- Green / G
- Gold / Y
- Cyan / C

Labels are generated by root family, then ordered by birth frame and lineage code. The label placement is greedy:

1. Required labels are roots and branch points that have appeared and have born children.
2. Live cell labels are added up to `--max-labels`.
3. Candidate label rectangles are tested at several radial and tangential offsets.
4. If an optional label cannot fit, it is skipped.
5. If a required label cannot fit, it is drawn anyway, so overlap is still possible.

## Statistics Box

The bottom stats box is titled `Root family mitotic frequency`. It displays only the first four roots.

For each shown root:

- active cell count is counted from active names whose node belongs to that root;
- division count is the number of nodes whose two or more children have been born by the current frame;
- rate is `divisions * 10 / elapsed_frames`.

This statistic is demo-oriented. It counts inferred child birth, not explicit biological split events.

## Known Bugs And Weak Assumptions

### 1. The lineage tree depends on the CellUniverse naming contract

CellUniverse intentionally labels daughters by appending `0` and `1` to the parent lineage code. For normal CellUniverse-generated outputs, this is enough to reconstruct the live lineage tree from `cells.csv`.

The limitation is not that `0`/`1` is wrong. The limitation is that the CSV does not separately record event metadata. If the backend later needs richer validation or non-standard uploaded data, production data could add explicit fields such as:

- `cell_id`
- `parent_id`
- `root_id`
- `birth_frame`
- `split_frame`
- `death_frame` or last observed frame
- `split_confidence` or event status

### 2. Uploaded or non-CellUniverse CSVs need validation

For CellUniverse outputs, names ending in `0` or `1` are meaningful daughter labels. For arbitrary uploaded CSVs, the backend should still validate that the file is using the CellUniverse naming convention before applying this parser.

Without that validation, an unrelated identifier ending in `0` or `1` could be interpreted as a child. This is an input-contract issue, not a problem with CellUniverse's own output.

### 3. Only binary suffixes are supported

The parser only treats trailing `0` and `1` as child markers. A name such as `cell_2` is treated as a root. A name like `cell_20` is treated as a child of `cell_2`, but `cell_2` itself is not a child of anything.

This matches CellUniverse's strict binary daughter labeling. It does not support non-binary events or arbitrary daughter labels without additional rules.

### 4. Trash cells are included

The script does not inspect the `isTrash` column. Names such as `trash_1` can enter the lineage tree as roots. That is probably wrong for the production viewer unless the user explicitly enables a trash/debug layer.

### 5. Missing frames are visually carried forward

If a frame has no lineage CSV data, the script reuses the previous active cell set. This keeps the video smooth but can hide missing data. A production viewer should distinguish "same active cells" from "lineage data missing for this frame."

### 6. Duplicate CSV frame handling is silent replacement

When multiple CSV files contain the same frame, the later CSV replaces the earlier frame's names. This may be useful for stage stitching, but it is not documented, validated, or reported.

For a web backend, this should probably be explicit:

- reject duplicate frames;
- or declare a segment priority rule;
- or merge with conflict warnings.

### 7. Birth frames for missing ancestors are approximated

If a child appears but its parent was never observed, the parent is synthesized and assigned the child's first frame. This creates a visually complete branch, but it is not a true birth or division time.

### 8. The demo layout uses future knowledge

The offline video computes the layout from all cells in the full frame range before rendering frame 1. That keeps angles stable, but a live web viewer cannot know future leaves. If we recompute the same algorithm live, older branches may jump when new children appear.

This does not block live lineage updates. The backend can keep polling `cells.csv`, rebuild or incrementally update the semantic tree, and notify the frontend. The layout layer still needs a live strategy:

- an append-only angular allocation strategy;
- a persistent layout cache per job;
- or an explicit "offline final layout" mode after the run completes.

### 9. Root sectors are equal-size, not leaf-count weighted

Every root gets the same angular sector. A root with many descendants can become crowded while a small root has empty space. The current script accepts this for demo aesthetics.

### 10. Label collision is only a greedy best effort

Optional labels are skipped when they do not fit, but required labels are drawn even if no collision-free slot exists. Dense lineages can still overlap.

### 11. Only four root color identities are named

Colors cycle after four roots. The stats box only shows the first four roots. If the dataset has more root families, visual identity and stats become ambiguous.

### 12. Frame number parsing is fragile

`frame_number()` extracts the first number from the `file` stem. If filenames contain multiple numeric chunks, the parsed frame can be wrong. The current web backend uses a different rule in `frame_from_text()` and extracts the last numeric chunk. This mismatch should be resolved before treating the demo script as authoritative.

### 13. Known biological/debug failure: ghost daughters

The CellUniverse changelog documents a false-positive split that produced a degenerate daughter and made the lineage tree contain a ghost daughter that did not track a real cell. This is not a rendering bug alone. It is an upstream tracking/split-validation problem that the lineage tree faithfully exposes.

For the web viewer, the lineage UI should be able to represent uncertain, rejected, trash, or debug-only branches differently from accepted biological lineage.

## Current Web Backend Gap

The current web backend has a simpler `build_lineage()` implementation. It creates nodes from names seen in `cells.csv` and adds an edge from `name[:-1]` when the name ends in `0` or `1` and the truncated parent already exists.

Compared with the four-window demo, the current backend:

- does not use the underscore lineage-code grammar;
- does not synthesize missing ancestors;
- does not assign birth-radius/angle layout;
- does not preserve root sector/color semantics;
- does not include per-frame active lineage state;
- does not distinguish uncertain or trash-derived nodes.

That is acceptable as a first artifact API, but it is not enough to reproduce the four-window lineage tree panel.

## Live Update Feasibility

A live lineage tree is feasible with the existing CellUniverse `cells.csv` output. The backend does not need a separate lineage stream for the first version. It can watch or poll the job's `output/cells.csv` while tracking runs, parse the rows that have appeared so far, and update the frontend through the existing job status/SSE refresh path.

The practical live data flow should be:

```text
CellUniverse worker writes output/cells.csv
backend detects mtime/size change
backend reparses or incrementally parses cells.csv
backend rebuilds:
  preview/frames/tNNN/cells.json
  preview/lineage.json
  optional preview/lineage-layout.json
frontend refetches or receives SSE update
lineage tree panel redraws
```

For correctness, the backend should treat `cells.csv` as an append/update artifact, not as a one-time completed output. It should also avoid reading while the file is mid-write. A simple first version can debounce file changes and require the file size/mtime to be stable for a short interval before parsing.

The only remaining design question is visual stability. The semantic tree can update live from `cells.csv`; the radial layout needs either a stable append-only allocation or a cached layout so existing branches do not jump every time a new daughter appears.

## Recommended Production Model

The web backend should split lineage into two layers:

### 1. Semantic lineage graph

This should be the authoritative data model:

```text
nodes:
  id
  label
  root_id
  parent_id
  children
  first_frame
  last_frame
  birth_frame
  split_frame
  is_trash
  confidence/debug flags

edges:
  source
  target
  type = division | inferred | debug | uncertain
  frame
```

For normal CellUniverse outputs, edges derived from the `0`/`1` daughter-name contract can be treated as valid CellUniverse lineage edges. If an uploaded CSV does not declare or match that convention, the backend should either reject lineage parsing or mark the edges as lower-confidence/import-inferred.

### 2. View layout

This should be a derived, cacheable layout:

```text
layout:
  node_id
  angle
  birth_radius
  birth_frame
  root_color
  label
```

For completed jobs, the layout can match the four-window demo exactly. For live jobs, the layout should avoid shifting existing nodes when new branches appear.

## Algorithm Summary For Reimplementation

To reproduce the four-window lineage panel:

1. Read `cells.csv`.
2. Group cell names by frame.
3. Infer parent chains from name suffixes.
4. Build a recursive node tree, synthesizing missing ancestors.
5. Infer each node's birth frame from the first frame where it or any descendant appears.
6. Sort roots by lineage code.
7. Divide the disk into equal root sectors.
8. Collect final leaves for each root.
9. Place leaves uniformly in their root sector.
10. Place internal nodes at circular mean of child angles.
11. Convert birth frame to radius by linear interpolation from first-frame radius to last-frame radius.
12. For each displayed frame:
    - draw time rings;
    - draw all born edges;
    - draw active life lines to current radius;
    - draw born node dots;
    - draw active count and root-family stats;
    - draw labels with greedy collision avoidance.

## Open Design Decisions For The Web UI

Before implementing the web lineage viewer, these decisions should be made:

1. Should the viewer exactly match CellUniverse's `0`/`1` daughter-name behavior for normal jobs, while treating only non-CellUniverse imports as lower-confidence?
2. Should trash/debug cells appear by default?
3. Should live jobs use a stable append-only layout instead of recomputing the final layout?
4. Should labels be original cell IDs, compact labels, or both with hover/tooltips?
5. Should duplicated CSV frames be rejected, merged, or stage-prioritized?
6. Should the backend preserve and expose missing-frame gaps instead of carrying the last active state forward?
7. Should more than four roots receive distinct colors and stats rows?
8. Should time rings adapt to arbitrary frame ranges?

## Bottom Line

The demo lineage tree is a useful visual prototype built around CellUniverse's daughter-name contract. For the production web UI, the most important part to preserve is the radial time layout: birth frame as radius and lineage branch as angle. The existing `cells.csv` is enough for a live first version if the backend keeps re-reading it during tracking. The main future improvement is richer lineage metadata for validation, uncertainty, and imported data that may not follow the CellUniverse naming convention.
