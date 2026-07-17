# PR evidence — #687 holdings-map letter cells keep their ink colour

Before/after screenshots of the publisher holdings map (`.hold-map`, including
its legend), rendered via the shipped `publisherPage()` composite against a
fixture publisher carrying one dataset per kind, so every kind letter and the
legend appear in one frame. "Before" is built from `main` (the specificity
collision in place); "after" is built from the `fix/687-hold-cell-contrast`
branch. Both are the identical fixture, same viewport, same browser
(headless Chromium, `prefers-color-scheme` set per screenshot).

- `before-light.png` / `after-light.png` — light theme. Before: every map-cell
  letter renders in the ledger link blue (`--raw`), visibly dimmer than the
  legend row beneath it, on an identical tint — the specificity collision
  described in the issue. Measured contrast against each cell's own tinted
  background ranged 3.96–4.33:1, failing WCAG AA (4.5:1) on all seven kinds.
  After: every map-cell letter matches the legend's dark ink (`--ink`) exactly.
  Measured contrast now ranges 12.28–13.42:1.
- `before-dark.png` / `after-dark.png` — the same pair, dark theme. The dark
  link blue happens to sit at a workable luminance against these tints, so the
  before/after difference reads as subtle rather than stark, but it was
  measurably fragile: before, contrast ranged 4.51–5.09:1 (three kinds within
  0.15:1 of the 4.5:1 floor, one within 0.01:1) — passing by accident, not
  design. After: every kind measures 10.91–12.32:1, matching the legend's own
  11.71:1 reading.

Full measured ratios (WCAG relative-luminance contrast, ink/raw letter against
its own rendered cell background, headless Chromium `getComputedStyle`):

| kind | light before | light after | dark before | dark after |
|---|---|---|---|---|
| register-snapshot | 4.14 | 12.81 | 4.84 | 11.71 |
| available-pool | 4.26 | 13.19 | 4.63 | 11.21 |
| issuance-events | 4.25 | 13.15 | 4.65 | 11.25 |
| forbidden-list | 3.96 | 12.28 | 5.09 | 12.32 |
| statistics-aggregate | 4.11 | 12.74 | 4.89 | 11.84 |
| attribute-addendum | 4.33 | 13.42 | 4.51 | 10.91 |
| reference-context | 4.33 | 13.41 | 4.55 | 11.02 |

legend (unaffected control, both before and after): 12.81:1 light, 11.71:1 dark.
