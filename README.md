# PR evidence — audit round (#649-#651, #653-#656)

Before/after screenshots for the accessibility and responsiveness fixes.
"Before" images are built from `main` (a git stash of the fix commit's
working tree, rebuilt with `node src/ci/build-dataset-pages.ts`); "after"
images are built from the fix branch. Both served statically on the same
local static server, captured with Playwright (real `prefers-color-scheme`
emulation, not a simulated toggle) at 360x800 and 1200x900.

`compare.html` needs a live combined database to populate its dataset
picker and composed-query text, which the static preview build does not
have. Its screenshots inject markup matching `compare.js`'s own
`renderPicker()`/`#sql-text` shapes (same classes, same structure) so the
CSS fix under test is exercised identically to how it renders once the
real app boots — noted on each such file below.

## #653 — unwrapped tables overflow at 360px

- `653-publishers-before-360-light.png` — the publishers index register
  table with no scroll wrapper: the whole page renders 603px wide from a
  360px viewport request (matches the issue's own measurement exactly).
- `653-publishers-after-360-light.png` / `-dark.png` / `-1200-light.png` —
  wrapped in `.overflow`; the page is exactly 360px wide, the table scrolls
  within its own box.
- `653-forbidden-index-before-360-light.png` /
  `653-forbidden-index-after-360-light.png` — the forbidden-suffix index's
  three tables (disclosures timeline, first-known-forbidden distribution,
  forbidden-yet-allocated), 450px before, 360px after.
- `653-fidelity-after-360-light.png` — the data-quality flag registry table,
  fixed. The page also carries an unwrapped divergence-record table further
  down (not individually cited in the issue, but same page, same bug,
  discovered while verifying `document.documentElement.scrollWidth` empirically
  rather than trusting the fix by inspection) — fixed alongside it, since the
  page still measured 391px wide otherwise.
- `653-forbidden-suffix-after-360-light.png` — a per-suffix detail page
  (history + callsigns tables), fixed.

## #654 — unwrapped SQL pre/code blocks

- `654-explore-before-360-light.png` — 673px wide (matches the issue's
  measurement).
- `654-explore-after-360-light.png` / `-dark.png` / `-1200-light.png` — the
  worked-example SQL block wrapped in `.overflow`. Verifying this empirically
  surfaced a second, pre-existing, unrelated overflow source on the same
  page: `#sql-form select` (the database picker) has no width constraint, and
  as a flex item its long `<option>` text set a 527px floor that no wrapper
  around the SQL block could fix. Added `width:100%; min-width:0` to let it
  shrink — without it, explore.html (and playground.html, which shares the
  same form) still measured 600px wide after the SQL-block fix alone.
- `654-compare-before-360-light.png` / `654-compare-after-360-light.png` —
  the composed-query `<pre>`, with injected sample content (see note above).

## #655 — dataset-entry chart SVG labels illegible when scaled down

- `655-dataset-entry-before-360-light.png` /
  `655-dataset-entry-after-360-light.png` / `-dark.png` / `-1200-light.png` —
  full dataset-entry page, Distributions section.
- `655-chart-crop-before.png` / `655-chart-crop-after.png` — cropped to the
  first chart only. Before: rendered SVG width 281px (scale 0.469), so the
  nominal 9-unit label text renders at ~4.2px — a blur, not legible digits.
  After: `min-width:600px` on `.chart svg` keeps it at native scale
  (measured: rendered width 600px, scale 1.0, effective font size 9px) at
  every viewport; below that width the chart scrolls within its own
  `.overflow` wrapper rather than shrinking. Measured with
  `getBoundingClientRect()`, not eyeballed.

## #656 — checkbox touch targets under 24px

- `656-home-filter-before-360-light.png` /
  `656-home-filter-after-360-light.png` / `-dark.png` / `-1200-light.png` —
  the home lookup page's "abnormal characters" filter checkbox.
- `656-checkbox-crop-before.png` / `656-checkbox-crop-after.png` — cropped to
  the checkbox row. Measured via `getBoundingClientRect()`: 13x13px before,
  24x24px after (the WCAG 2.5.8 AA minimum, exactly).
- `656-compare-picker-before-360-light.png` /
  `656-compare-picker-after-360-light.png` — the compare dataset picker, with
  injected sample rows (see note above). Measured the same way: 13x13px
  before, 24x24px after.

## Not separately screenshotted

- #649 (duplicate nav aria-labels), #650 (footer landmark), #651 (Publishers
  nav entry) are structural/semantic fixes with no visual delta beyond the
  new "Publishers" link already visible in the nav strip in every screenshot
  above (see the top of each image).
