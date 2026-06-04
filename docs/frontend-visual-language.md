# Frontend Visual Language

This guide describes the current CellUniverse web UI visual language so new
pages and features feel consistent with the existing dashboard, live monitor,
dataset previewer, and lineage viewer. It is based on the current React
components, `frontend/src/styles.css`, and `frontend/src/theme/tokens.css`.

Use this file as a design contract. When implementation details are unclear,
prefer the patterns already present in the UI over inventing new surfaces,
colors, button roles, or page structures.

## Design Character

The UI should feel like a scientific operations console: compact, calm,
inspectable, and built for repeated use. It should look useful before it looks
showy.

Core qualities:

- Pale paper-like workspaces with dark command strips.
- Dense but organized information, not marketing composition.
- Small-radius controls and panels, normally using `--radius-control` or
  `--radius-panel`.
- Strong blue for active, selected, running, and primary action states.
- Cyan for completed/success state, so completed does not look like running.
- Peach/orange for cancellation controls and high-signal feedback.
- Danger red only for destructive actions, failed states, and removed/blocked
  conditions.
- Lucide icons paired with short action labels in operational controls.

Avoid decorative gradients, hero sections, large empty card layouts, bokeh/orb
decoration, and one-off colors outside the token system.

## Token Hierarchy

Use `frontend/src/theme/tokens.css` as the source of truth. Do not hard-code
page colors in component CSS unless the value is a data visualization color or a
rendered scientific colormap.

The token hierarchy is:

```text
palette -> broad semantic meaning -> component mapping -> specific component color
```

Application CSS should usually use semantic or component tokens, not palette
tokens directly. If a new visual role is required, add a semantic or component
token first.

Common token usage:

- Page background: `--color-bg`
- Standard panels/cards: `--color-panel`
- Raised pale tile: `--color-panel-raised`
- Top bar and dark strips: `--surface-top-bar`, `--surface-viewer-strong`
- Viewer field: `--surface-viewer`
- Tool panels: `--surface-tool-panel`
- Primary readable text: `--color-text-strong`
- Supporting text: `--color-text-soft`, `--color-text-muted`,
  `--color-text-dim`
- Section headings: `--color-heading`
- Important readouts: `--color-readout-important-text`
- Active/selected/running: `--color-accent`, `--surface-toggle-active`,
  `--surface-strong-action`
- Completed/success: `--color-cyan`
- Warning/queued: `--color-warn`
- Failed/cancelled/danger: `--color-danger`, `--color-danger-text`,
  `--surface-danger-action`
- Neutral state: `--color-status-idle`, `--surface-control`
- Standard action button: `--surface-action`, `--color-action-text`
- Strong action button: `--surface-strong-action`,
  `--color-strong-action-text`
- Cancel/terminate button: `--surface-cancel-button`,
  `--color-cancel-button-text`
- More/context-menu button: `--surface-more-button`,
  `--color-more-button-text`
- Slider surfaces: `--surface-slider-track`, `--surface-slider-accent`,
  `--surface-slider-thumb`
- Floating panel shadow: `--shadow-panel`
- Viewer panel shadow: `--shadow-viewer-panel`

When a new component needs independent control, add a specific token that maps
back to an existing semantic token. Example:

```css
--surface-new-widget-panel: var(--color-panel);
--color-new-widget-title: var(--color-text-strong);
```

## Layout Rules

Use a stable app-shell structure:

- Top global bar first.
- Main workspace below.
- Viewer or primary work area in the center.
- Tool panels on the sides or docked around the viewer.
- Right-side preview/info panels for detail pages when the main canvas needs
  breathing room.

Use CSS grid for structural layout. Give tool-heavy regions fixed or bounded
tracks so controls do not jump when text, loading indicators, or labels change.

Preferred proportions:

- Side panels are compact and scroll internally.
- Tool panels use full-width section blocks, not nested decorative cards.
- Repeated items may be cards; page sections should not become cards inside
  cards.
- Repeated block cards should use stable action zones at the bottom.
- List rows should reserve enough room for controls to align on one line.
- Responsive behavior should collapse dense control rows into one-column stacks,
  not shrink text until it becomes unreadable.

Full-width controls are acceptable when the section itself is a bounded panel.
Avoid a control group stretching to one edge while the related group remains
compact; either cap both groups intentionally or use a shared grid so spacing is
predictable.

## Surface Rules

Use surfaces consistently:

- `--surface-top-bar` for global headers and dark command bars.
- `--surface-side-panel` for side panel backplates.
- `--color-panel` for cards, tool-panel interiors, settings blocks, scan
  results, and repeated dashboard blocks.
- `--surface-viewer` for main 2D/3D visualization fields.
- `--surface-viewer-strong` for docked viewer status/progress strips.
- `--surface-control` for neutral metrics, status blocks, and inactive controls.
- `--surface-popup` or `--surface-toast` for floating feedback panels.
- `--surface-loading-card` for loading overlays on top of viewers.

Panels and repeated dashboard blocks use visible `--shadow-panel`; keep that
shadow consistent. Live monitor and dataset preview controls use the lighter
`--shadow-viewer-panel` so adjacent viewer panes do not create hard visual cuts.
Do not add custom drop shadows per component unless the token is updated.

Do not add page gradients. The current operational pages use flat paper
backgrounds and tokenized shadows instead.

## Typography Rules

Use small, functional type:

- Section/panel headings: 11-13px, uppercase where the current panel pattern
  uses headings.
- Body/control labels: 12-14px.
- Compact metric values: about 15px and semibold.
- Card titles: strong text, compact line height, ellipsis where necessary.
- Viewer readouts: compact, high-contrast text on badge or dark surfaces.

Color rules:

- Primary readable text: `--color-text-strong`.
- Secondary explanatory text: `--color-text-soft`.
- Low-emphasis metadata: `--color-text-muted` or `--color-text-dim`.
- Important metric titles/readouts: `--color-readout-important-text`.
- Text inside active toggles: `--color-toggle-text-active`.
- Loading overlay titles: `--color-loading-title`.

Avoid viewport-scaled font sizes and negative letter spacing. Text must not
overlap controls or be clipped inside buttons. Use grid/flex wrapping or a more
appropriate layout instead of reducing font size aggressively.

## Color Semantics

Status colors are meaningful and should not be swapped casually:

- Running: accent blue via `--color-status-running` / `--color-accent`.
- Completed: cyan via `--color-cyan`.
- Queued/waiting: warning yellow via `--color-warn`.
- Prepared/idle/archived/interrupted: neutral gray via `--color-status-idle` or
  `--surface-control`.
- Cancelled/failed: danger via `--color-danger` or `--color-danger-text`.
- Terminate/cancel controls: peach/orange cancel-button tokens, not generic red
  unless the action is destructive removal.
- Remove/delete/destructive action: `--surface-danger-action` with normal light
  action text.

Running and completed must remain visually distinct. Completed should not use
the same blue as running.

## Control Rules

Buttons should use semantic roles, not shared styling by accident.

- Toggle groups use `--surface-toggle`, `--surface-toggle-active`,
  `--color-toggle-text`, and `--color-toggle-text-active`.
- Strong actions use `.strong-action-button` and strong action tokens.
- Standard actions use `.action-button`.
- Secondary actions use `.secondary-button` unless scoped dashboard styles turn
  them into strong blue actions.
- Cancel/terminate actions use `.cancel-button` and cancel tokens.
- Destructive remove/delete actions use `.danger-action-button`.
- Context/more buttons use `.more-button` and the accent-soft token family.
- Icon-only buttons should use Lucide icons and accessible labels/titles.

Use text buttons when the label is the command (`View all`, `View last frame`,
`Refresh now`, `Create Job`). Use icon-only buttons for compact common tools
such as refresh, hide, zoom, collapse, and overflow menus.

Button layout rules:

- Related buttons should align to the bottom of their block/panel.
- Job cards should keep lifecycle controls visually separated from view/archive
  controls.
- In block cards, action rows should not drift upward because of short content;
  use `margin-top: auto` patterns already present in the dashboard.
- In list rows, keep action buttons on one line when there is room.
- Do not make a button look like a toggle unless it changes persistent state.

## Interaction Rules

Interaction should be obvious but not flashy:

- Hover background: `--surface-hover`.
- Focus ring: `--focus-ring` or `--focus-ring-soft`.
- Active selection: `--color-accent` or `--surface-toggle-active`.
- Disabled state: `--color-control-disabled` plus reduced opacity when needed.
- Popups should appear above workspace panels and use readable tokenized text.
- Long-running loading states should show the same animated overlay language as
  the live viewer.

Avoid hover effects that change a control's role. A normal action button should
not become visually indistinguishable from a toggle, and a close/hide button
should not inherit generic card action styling.

## Dashboard Patterns

Dashboard pages are operational lists, not landing pages.

Dashboard shell:

- Use the dark top bar with a raised pale brand/action tile.
- Use a hideable left navigation panel with compact tabs.
- The left nav should not disappear on mobile without a reachable replacement.
- Section bars should keep page title and search/view controls aligned and
  compact.

Cards and rows:

- Dataset/job/source blocks use `--color-panel`, `--border-card`,
  `--radius-panel`, and `--shadow-panel`.
- Block cards use compact metadata, a clear title, and a bottom action area.
- List rows use a denser grid with title/meta, progress or state, and actions.
- Progress bars use `--gradient-progress` and should consume useful horizontal
  space in list view.
- Avoid huge empty gaps above block grids; upload controls should be floating or
  scoped to a compact action area when the content grid is the main task.

Dataset blocks:

- Primary dataset action is `Preview` as a strong blue action.
- `Create Job` is also a strong/action command but should not compete with
  preview when arranged in a row.
- Overflow/context actions use the accent-soft more button.
- Dataset blocks and dataset manager source blocks should share visual language.

Job blocks:

- Use `View all` and `View last frame` for monitor entry points.
- Start/stop/resume lifecycle action should be wide and prominent above
  secondary actions when present.
- If lifecycle action is unavailable, show it disabled rather than hiding the
  whole operation concept.
- Duplicate, download, and archive are normal/secondary actions, not strong
  primary actions.
- Terminating a running/queued job must use a confirmation dialog.

Settings blocks:

- Settings use the same panel/card language as dashboard blocks.
- Viewer defaults should use full panel width with evenly spaced toggle buttons.
- Source manager blocks should show type, enabled state, path, existence, and
  dataset count with actions aligned to the bottom.
- Preset and user-added roots should be visually compatible but clearly labeled.

## Viewer Patterns

The viewer is the primary work surface and should not be framed as a decorative
card.

Live monitor:

- Main 2D/3D viewer occupies the central workspace.
- Tool panels sit left; lineage sits right.
- Time/slice controls use pale panel surfaces and action-color arrow buttons.
- Dark docked strips are used for preload/progress readouts.
- Status, scheduler, and layer panels use `--surface-tool-panel` and
  `--shadow-panel`.
- The top-left of subpages uses a back button instead of a secondary title.

Dataset previewer:

- Should keep the live monitor visual language but remove tracking-only layers.
- Preserve 3D/2D controls, time frame controls, layer controls, loading
  overlays, and right-side dataset metadata.
- Dataset preview layers should support real data inspection without synthetic
  or lineage assumptions.

3D viewer:

- Bright/dark background switch is a floating segmented control on the viewer.
- Default background, real/synthetic/cell-outline visibility are controlled by
  Settings and persisted.
- Point cloud brightness alpha is a layer-panel toggle and should not be hidden
  in unrelated controls.
- Panning/dragging should feel consistent across zoom levels.
- Empty/waiting text must remain visible against the active viewer background.

Loading overlays:

- Use `--surface-loading-card` and `--color-loading-title`.
- Spinner motion should always be visibly animated for pending states.
- Do not use dark text on dark loading cards.

## Layer Panel Patterns

Layer controls are compact but information-rich:

- Use fieldset-like groups with compact legends.
- Visibility toggle belongs on the left; palette dropdown belongs on the right.
- Opacity and contrast controls should stay close to the layer they affect.
- Use existing colormap gradients for data ranges; keep slider handles visible.
- Add vertical spacing between unrelated layer toggles, such as cell outlines and
  brightness alpha.
- Brightness alpha is global for point-cloud layers on the current viewer page.

## Status And Scheduler Patterns

Status panel:

- Heading icon color follows job state.
- State dot matches the state token.
- Metric cards use neutral control surfaces with important labels in readout
  color.
- Terminate button spans the panel width and sits below the metric cards with
  visible spacing.
- Running spinner uses the running/accent color, not cancelled/danger color.

Scheduler panel:

- Auto refresh active state should look active/blue and say it is active.
- Inactive state should look inactive/neutral and say it is inactive.
- Manual refresh remains an action button.
- Period controls use compact input/dropdown surfaces.

## Lineage Panel Patterns

Lineage is a data visualization surface, not a dashboard card.

- Use `--surface-viewer` plus subtle `--viewer-grid` for the SVG stage.
- Rings are pale gray and should stay visually behind colored lineage edges.
- Node/edge colors are data-driven root colors, not app chrome tokens.
- Selected and hover states use tokenized app affordances.
- Node labels use a viewer-background stroke so they remain readable.
- Floating zoom/reset controls use a compact surface with `--shadow-panel`.
- Detail cards use `--surface-lineage-card`/popup language and close with a
  proper icon button.

Lineage layout rules:

- Branch edges should split near parent nodes, not draw long overlapping radial
  segments through the whole child birth radius.
- Dense trees should assign unique angular lanes to internal nodes as well as
  leaves so subtrees like `cell_0` and `cell_1` do not overlap.
- Panning speed should be independent of zoom level.
- Keep right-click/drag instructions in the unobtrusive interaction hint.

## Data Visualization Rules

Visualization colors may come from data-specific sources such as colormaps,
cell states, intensity values, and lineage root IDs. Keep those separate from
app chrome tokens.

Use app tokens for the UI around the visualization:

- Viewer background: `--surface-viewer`.
- Viewer grid: `--viewer-grid`.
- Viewer readouts: `--surface-badge`, `--color-readout-important-text`.
- Cell/lineage hover affordances: `--lineage-node-hover-stroke` unless a
  data-driven color is required.
- Point clouds should account for 8-bit, 16-bit, and future higher-bit-depth
  TIFF intensity ranges.
- For low-depth image stacks, do not over-skip middle slices in previews.

Color-map gradients can remain data definitions rather than design tokens.

## Upload And IO Patterns

Dataset upload should feel like mainstream data products:

- Support file selection, multi-file dataset upload, and folder upload.
- Folder upload should scan the first layer and block/flag folders with no TIFFs
  at that layer.
- Before confirming a folder upload, show a scan summary of detected TIFFs.
- Upload controls should not create a large empty horizontal panel in block
  views; prefer compact/floating actions when the grid is the main content.
- Dataset blocks should offer preview and create-job pathways.
- Download actions should be clear but secondary unless they are the page's main
  purpose.

## Forms And Job Creation

New job forms should be dense, explicit, and editable:

- Dataset selection is the first decision.
- Required frame range and initial CSV fields should be visible early.
- Simple configuration exposes the common runtime/pipeline settings.
- Runtime subpanels use `--surface-simple-config-runtime`.
- YAML editing is available for advanced users and should not hide the simple
  path.
- Create/prepared-job submission is a strong action button.
- Non-running prepared jobs should remain editable.

Avoid explanatory marketing copy in the form. Labels should be enough when the
workflow is clear.

## Responsive Rules

Responsive behavior should preserve access, not merely hide complexity:

- Sidebar/navigation must have a reachable mobile state.
- Dense grids collapse to one column at smaller widths.
- Action rows may wrap, but buttons should remain readable and aligned.
- Viewer controls should remain stable and not overlap the canvas.
- Text inside buttons and cards must not clip or spill outside its container.

## Do And Do Not

Do:

- Start from existing tokens and component classes.
- Add semantic/component tokens before adding raw colors.
- Use `--radius-control` and `--radius-panel`.
- Keep controls compact, aligned, and bottom-anchored when inside cards.
- Make text readable against the surface it sits on.
- Use Lucide icons for common controls.
- Keep operational workflows immediately usable on first screen.

Do not:

- Add gradients to page backgrounds.
- Hard-code ad hoc colors in page CSS.
- Use one generic button class for cancel, action, strong action, and toggle
  behavior at once.
- Put cards inside cards.
- Use oversized headings or marketing-style hero layouts for operational pages.
- Let dropdowns or popups render underneath the main workspace.
- Hide important mobile navigation without an alternate access point.
- Reuse running blue for completed state or danger state.

## Current Tensions To Preserve Carefully

Some current choices are intentional even if unusual:

- `--color-text` is light because dark surfaces inherit it in places.
- `--border-accent` and `--border-accent-muted` are pale, not blue.
- Cancel buttons use peach/orange rather than red.
- Running is blue, completed is cyan, and cancelled/failed are danger colors.
- Dashboard secondary buttons are scoped to strong blue in dashboard and dataset
  preview shells.
- Viewer controls are compact and utility-first; avoid adding explanatory text
  inside the app chrome.

When changing these, treat it as a visual-design change, not a cleanup.
