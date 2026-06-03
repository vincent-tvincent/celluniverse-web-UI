# Agent Instructions

Before making frontend UI or styling changes, read:

- `docs/frontend-visual-language.md`
- `frontend/src/theme/tokens.css`

Follow the existing visual language. Do not introduce ad hoc colors, page
gradients, large hero layouts, nested cards, or new button semantics unless the
user explicitly asks for that design direction.

Use design tokens first. If a new visual role is needed, add a semantic,
component, or specific-component token instead of hard-coding colors.

If a proposed frontend change may risk breaking the consistency of the current
UI visual language, stop before implementation and ask the user to confirm with
their teammate. Do not proceed with that risky UI change until the user confirms
the direction.

For frontend changes, run `npm run build` in `frontend` when practical and
report whether it passed.
