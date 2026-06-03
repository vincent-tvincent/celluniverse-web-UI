# Frontend Visual Language

This guide describes the current CellUniverse web UI visual language so new
pages can feel consistent with the existing live viewer. It is based on the
current React components, `frontend/src/styles.css`, and
`frontend/src/theme/tokens.css`.

## Design Character

The UI should feel like a scientific operations console: compact, calm,
inspectable, and built for repeated use. Prefer dense but organized information
over marketing-style presentation.

Use the current page as the model:

- Pale paper-like workspace surfaces.
- Dark command/header strips for global context and docked viewer controls.
- Small-radius controls, panels, and popups.
- Strong blue for selected/active states.
- Orange/peach for focus, important readouts, cancel controls, and high-signal
  feedback.
- Icons paired with short labels for tools and view controls.

Avoid decorative gradients, large hero sections, large empty card layouts, and
one-off colors outside the token system.

## Token Hierarchy

Use `frontend/src/theme/tokens.css` as the source of truth. Do not hard-code
page colors in component CSS unless the value is a data visualization color.

The token hierarchy is:

```text
palette -> broad semantic meaning -> component mapping -> specific component color
```

Use palette tokens only inside `tokens.css`. Application CSS should usually use
semantic or component tokens.

Recommended usage:

- Page backgrounds: `--color-bg`
- Standard panels: `--color-panel`
- Top bar and dark strips: `--surface-top-bar`, `--surface-viewer-strong`
- Main viewer background: `--surface-viewer`
- Strong readable text: `--color-text-strong`
- Supporting text: `--color-text-soft`, `--color-text-muted`
- Important labels/readouts: `--color-readout-important-text`
- Active/selected state: `--color-accent`, `--surface-toggle-active`
- Hover state: `--surface-hover`
- Action buttons: `--surface-action`, `--color-action-text`
- Cancel/close buttons: `--surface-cancel-button`,
  `--color-cancel-button-text`
- Sliders: `--surface-slider-track`, `--surface-slider-accent`,
  `--surface-slider-thumb`

When a new component needs independent control, add a specific token that maps
back to a component or semantic token. Example:

```css
--surface-new-widget-panel: var(--color-panel);
--color-new-widget-title: var(--color-text-strong);
```

## Layout Rules

Use a stable app-shell structure:

- Top global bar first.
- Main workspace below.
- Viewer or primary work area in the center.
- Tool panels on sides or docked around the viewer.

Use CSS grid for structural layout. Give tool-heavy regions fixed or bounded
tracks so controls do not jump when text changes.

Preferred proportions:

- Side panels are compact and scroll internally.
- Tool panels use full-width section blocks, not nested decorative cards.
- Repeated items may be cards, but page sections should not look like floating
  cards inside other cards.
- Keep panel radii at `--radius-panel` and control radii at
  `--radius-control`.

Responsive behavior should collapse dense control rows into one-column stacks,
not shrink text until unreadable.

## Surface Rules

Use surfaces consistently:

- `--surface-top-bar` for the global header.
- `--surface-side-panel` for side panel backplates.
- `--color-panel` for tool-panel interiors and form sections.
- `--surface-viewer` for the main visualization field.
- `--surface-viewer-strong` for dark docked viewer status/progress strips.
- `--surface-popup` or `--surface-toast` for floating feedback panels.
- `--surface-control` for compact neutral data blocks.

Do not add page gradients. The current page uses a flat paper background.

## Typography Rules

Use small, functional type:

- Section/panel headings: 11-13px, uppercase where the current panel pattern
  uses legends.
- Body/control labels: 12-14px.
- Compact metric values: about 15px and semibold.
- Avoid viewport-scaled type.
- Keep letter spacing at `0`.

Color rules:

- Primary readable text: `--color-text-strong`.
- Secondary explanatory text: `--color-text-soft`.
- Low-emphasis metadata: `--color-text-muted` or `--color-text-dim`.
- Important metric titles and viewer readouts:
  `--color-readout-important-text`.
- Text inside active toggles: `--color-toggle-text-active`.

## Control Rules

Buttons should use semantic roles, not shared styling by accident.

- Toggle groups use `--surface-toggle`, `--surface-toggle-active`,
  `--color-toggle-text`, and `--color-toggle-text-active`.
- Action buttons use `--surface-action` and `--color-action-text`.
- Cancel/close buttons use cancel tokens only.
- Icon-only close/cancel buttons should use a Lucide icon, not a text `x`.
- Sliders should use slider tokens; layer palette contrast handles currently
  use the brighter action text color for visibility.
- Dropdowns and inputs should use dropdown/input tokens, with strong text on
  light menu surfaces.

Prefer icon buttons for common tool actions. Use text buttons for commands
where the label is the action, such as `View` or `Refresh now`.

## Interaction Rules

Interaction should be obvious but not flashy:

- Hover background: `--surface-hover`.
- Focus ring: `--focus-ring` or `--focus-ring-soft`.
- Active selection: `--color-accent` or `--surface-toggle-active`.
- Disabled state: `--color-control-disabled` plus reduced opacity when needed.
- Popups should appear above workspace panels and keep readable text colors.

Avoid hover effects that change a control's role. For example, a normal action
button should not look like a toggle button, and a close button should not
inherit a generic card button style.

## Data Visualization Rules

Visualization colors may come from data-specific sources such as color maps,
cell state, or lineage node colors. Keep those separate from app chrome tokens.

Use app tokens for the UI around the visualization:

- Viewer background: `--surface-viewer`.
- Viewer grid: `--viewer-grid`.
- Viewer readouts: `--surface-badge`, `--color-readout-important-text`.
- Cell/lineage hover affordances: `--lineage-node-hover-stroke` unless a
  data-driven color is required.

Color-map gradients can remain data definitions rather than design tokens.

## Component Patterns

Top bar:

- Dark surface.
- Brand mark on raised pale tile.
- Job selector centered and layered above the workspace.
- Refresh icon uses strong dark text on the pale raised button.

Tool panels:

- Pale panel surface.
- Small uppercase headings with Lucide icons.
- Controls arranged in stable rows.
- Avoid nested cards inside panels.

Layer controls:

- Fieldset groups with compact legends.
- Visibility toggle on the left, color-map dropdown on the right.
- Dropdown text must remain readable on the pale menu.
- Slider handles should be visible against color-map gradients.

Viewer toolbar:

- Use segmented toggles for 2D/3D view mode.
- Time and slice controls use panel surfaces and independent slider colors.
- Slider arrow buttons are action buttons, not toggles.

Popups/toasts:

- Use `--surface-toast`/`--surface-popup`.
- Text should use `--color-text-strong` and `--color-text-soft`.
- Primary popup action can use accent background with active-toggle text.
- Dismiss action must use cancel-button tokens.

Lineage panel:

- Viewer background stays pale with subtle grid.
- Floating node detail card uses popup surface.
- Cell names and important labels use strong text.
- Close button uses cancel tokens and a close icon.

## Do And Do Not

Do:

- Start from existing tokens and component classes.
- Add semantic/component tokens before adding raw colors.
- Use `--radius-control` and `--radius-panel`.
- Keep controls compact and aligned.
- Make text readable against the surface it sits on.

Do not:

- Add gradients to page backgrounds.
- Hard-code ad hoc colors in page CSS.
- Use a generic button class for cancel, action, and toggle behavior at once.
- Put cards inside cards.
- Use oversized headings or marketing-style hero layouts for operational pages.
- Let dropdowns or popups render underneath the main workspace.

## Current Tensions To Preserve Carefully

Some current choices are intentional even if unusual:

- `--color-text` is light because dark surfaces inherit it in places.
- `--color-status-running` currently uses the orange danger-family color.
- `--border-accent` and `--border-accent-muted` are pale, not blue.
- Cancel buttons use peach/orange rather than red.

When changing these, treat it as a visual-design change, not a cleanup.
