# PR evidence — #683 size/bytes naming + exact FOI record counts

Text evidence for the second finding (persisting `convertFoiEntry`'s exact
`recordCount` and rendering it instead of the curated `~approx` figure).
The first finding (converging `ArchivedFileMeta.size` to `bytes`) is a
field-name rename with no rendered-output change, so it has nothing to show
before/after.

## Provenance

`node src/ci/build-dataset-pages.ts` was run against both `origin/main`
(before) and the feature branch (after) to produce the actual rendered
`datasets/foi/{key}/index.html` for three representative entries, and the
`<div class="notable">…</div>` fragment quoted below is copied verbatim from
those real build outputs (not retyped or paraphrased). The accompanying PNGs
(`case1/2/3--before/after--light/dark.png`) are element screenshots of the
same Notable panels: the before set captured from the deployed site, the
after set from a local static build of this branch served on the fixed
preview port — light and dark colour schemes in each case. The HTML and the
screenshots show the same content and are independently reproducible from
the two commits named.

## Case 1 — a CSV disclosure with no `sheetsIndicative` at all

`archive/foi/ofcom-2024-07--call-signs--all-callsigns` disclosed a single CSV
(no workbook, so no per-sheet indicative counts were ever declared). Before
this change the entry's "Notable" panel had nothing to say about record
count at all — `foiApproxRecords` summed zero. The converter's own
`recordCount: 155346` (already computed by `convertFoiEntry`, previously
discarded) is now persisted on the normalised file's declaration and
rendered directly.

**Before** (`datasets/foi/ofcom-2024-07--call-signs--all-callsigns/index.html`, built from `origin/main`):

```html
<div class="notable"><h3>Notable</h3><ul><li><b>4</b> related entries — see below.</li></ul></div>
```

**After** (same page, built from this branch):

```html
<div class="notable"><h3>Notable</h3><ul><li><b>155,346</b> records disclosed.</li><li><b>4</b> related entries — see below.</li></ul></div>
```

## Case 2 — a fully-converted multi-sheet workbook: approx becomes exact

`archive/foi/wdtk-174341--available-callsigns-list` disclosed a 3-sheet
workbook; every sheet was extracted and normalised (full mechanical
coverage), so the entry now drops its leading `~` entirely. The 3-row
difference (26,649 vs 26,646) is the pre-existing, honestly-labelled gap
between the xlsx dimension-derived `approxRows` and the converter's
actual parsed count — the entry's own `sheetsIndicative.note` already said
"authoritative record counts come from the converter/normaliser".

**Before**:

```html
<div class="notable"><h3>Notable</h3><ul><li><b>~26,649</b> records across the disclosed sheets.</li></ul></div>
```

**After**:

```html
<div class="notable"><h3>Notable</h3><ul><li><b>26,646</b> records disclosed.</li></ul></div>
```

## Case 3 — partial coverage: still approximate, but no longer invisible

`archive/foi/ofcom-01420046--allocated-reserved-callsigns` disclosed a
2-sheet workbook; only sheet 1 (the register) was normalised — sheet 2 (an
unexplained 36,526-callsign subset, deliberately left unconverted per its own
`contentsIndicative`) has no mechanical count. Before this change the entry
showed nothing (its sheets are declared with `dataRows`, a field
`foiApproxRecords` never read — a separate, pre-existing quirk left alone
here). After, sheet 1's exact 150,181 is surfaced, correctly still marked
`~` because sheet 2 remains uncounted — the combined total is only exact
when every contributing sheet is.

**Before**:

```html
<div class="notable"><h3>Notable</h3><ul><li><b>3</b> related entries — see below.</li></ul></div>
```

**After**:

```html
<div class="notable"><h3>Notable</h3><ul><li><b>~150,181</b> records across the disclosed sheets.</li><li><b>3</b> related entries — see below.</li></ul></div>
```
