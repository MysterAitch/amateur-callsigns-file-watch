# Column distributional drift (per-vintage fingerprints)

Per-column, per-vintage distribution FINGERPRINTS over the open-data
register vintages (issue #862): for every canonical column of each
vintage’s `normalised.csv`, the populated/blank split, the distinct-value
cardinality, the value histogram, the length distribution and a
character-class / per-character profile — then the vintage-over-vintage
DIVERGENCES the thresholds flag. This generalises `EXPECTED_STATUS` from
one hand-authored column to EVERY column with no hand-authored
expectations: the detector says only that "the shape changed", never what
to look for. Regenerated and committed, so a new vintage shifting any
fingerprint shows up as a PR diff.

**This is one of two anomaly-detection surfaces, and the one that sees a
STRUCTURAL anomaly** — a whole cohort or character class entering or leaving
a publication. The other, `dataset-anomaly-flags`, compares a vintage’s
aggregate metrics (record count, per-status shares, product-column
emptiness) against its neighbours; it does not look inside the value space,
so a class-wide disappearance is invisible there and visible here. Named
because "where are anomalies detected?" leads naturally to the aggregate
detector and straight past this report — which is where the `Z`-cohort
omission between the 2025-11-11 and 2026-01-14 vintages was actually caught.

**Flags, never verdicts** (issue #467): every divergence carries candidate
explanations (a schema/variant change, an export filter, an upstream data
event) and chooses none; a novel value is surfaced, never auto-suppressed.
The measures are a deliberately naive v1 — simple, named comparisons
against named, tunable thresholds — and are expected to be tuned against
the corpus rather than trusted as calibrated. The canonical schema is
stable across every open-data vintage (the normaliser absorbs raw header
drift), so the signal here is per-column POPULATION and DISTRIBUTION, not
header presence; raw-header/schema drift is out of this report’s scope.

## Parameters

The named thresholds each measure is tuned by (issue #862). A flag is not
a calibrated alarm — a threshold too loud on this corpus is a parameter to
move.

| parameter | value | meaning |
|---|---:|---|
| categorical cardinality cap | 50 | value-distribution and novel/retired-value measures apply only to columns at or below this many distinct values on both sides |
| min populated for shape | 100 | shape measures need at least this many populated values on both sides |
| blank-share delta | 5.0% | `blank-share-shift` fires at or above this absolute change in blank share |
| cardinality fold-change | x2 | `cardinality-shift` fires at or above this growth or shrink factor |
| mean-length delta | 1 | `length-shift` fires at or above this absolute change in mean length |
| class-share delta | 5.0% | `char-class-shift` fires at or above this absolute change in a class-containment share |
| character-presence floor | 1.0% | `character-appeared`/`character-vanished` fire when a character crosses this containment share |
| total-variation threshold | 0.10 | `value-distribution-shift` fires at or above this distance over the value shares |
| novel-value share | 0.5% | a categorical value present on one side only, at or above this share, is `novel-value`/`retired-value` |

## Divergence vocabulary

Every flag names exactly one measure (used only with these meanings), with
the candidate explanations it is weighed against — none ever chosen.

- **column-populated** — a column left entirely blank in the previous vintage carries values in this one — a coverage change, not a per-record event. Candidate explanations: a schema / export-variant change added the field; an upstream backfill populated previously-absent data.
- **column-emptied** — a column populated in the previous vintage is entirely blank in this one. Candidate explanations: a schema / export-variant change dropped the field; an export filter excluded the field for this publication.
- **blank-share-shift** — the share of blank cells moved by at least the blank-share threshold — a cohort of rows gained or lost the field. Candidate explanations: an export filter omitted (or restored) a cohort of rows; an upstream data event grew or shrank the populated pool; a schema / export-variant change.
- **cardinality-shift** — the count of distinct values grew or shrank by at least the cardinality fold-change. Candidate explanations: an upstream data event added or removed distinct values; a coverage change (a partial publication); a de-duplication or expansion in the export.
- **length-shift** — the mean value length moved by at least the length threshold — often a rendering or format change. Candidate explanations: a rendering / date-format change; a change in the underlying value space.
- **char-class-shift** — the share of values containing a character class (digit / letter-case / space / punctuation / non-ASCII) moved by at least the class-share threshold. Candidate explanations: an encoding or format change; a contamination (NBSP / Excel-mangle) arriving or cleaned; a change in the underlying value space.
- **character-appeared** — a character crossed the presence floor from absent to present — a contaminant arriving, or a cohort of values re-entering. Candidate explanations: a contamination arriving; a cohort of values re-entering the publication; an encoding change.
- **character-vanished** — a character crossed the presence floor from present to absent — a contaminant cleaned, or a cohort of values omitted (the Z-suffix omission shape). Candidate explanations: a cohort of values omitted from the publication (an export filter); a contamination cleaned; an encoding change.
- **value-distribution-shift** — the value shares of a categorical column moved by a total-variation distance at or above the threshold. Candidate explanations: an upstream data event re-weighted the categories; an export filter changed the row population; a relabelling upstream.
- **novel-value** — a categorical value present here was absent in the previous vintage, at or above the novel-value share. Candidate explanations: a new category introduced upstream; a relabelling of an existing category; a coverage change surfacing a value.
- **retired-value** — a categorical value present in the previous vintage is absent here, at or above the novel-value share. Candidate explanations: a category withdrawn upstream; a relabelling of an existing category; an export filter removing its rows.

## Per-column fingerprints

One row per vintage per column: rows, the populated/blank split, distinct
values, the length distribution (min / mean / max) and the notable
character classes (those present in a minority of values, where a
contaminant hides). The full per-character profile and the complete value
histogram are re-derivable from the fold (src/ci/column-drift.ts).

### `callsign`

| vintage | rows | populated | blank | distinct | length min/mean/max | notable char classes |
|---|---:|---:|---:|---:|---|---|
| 2022-05-30 | 151,152 | 151,148 (100.0%) | 4 | 151,148 | 2 / 5.00 / 9 | digit 100.0%, upper 100.0%, lower 0.0%, space 0.0%, punct 0.1%, nonascii 0.0% |
| 2023-02-20 | 152,084 | 152,082 (100.0%) | 2 | 152,082 | 2 / 5.00 / 9 | digit 100.0%, upper 100.0%, lower 0.0%, space 0.0%, punct 0.1%, nonascii 0.0% |
| 2025-04-08 | 157,427 | 157,427 (100.0%) | 0 | 157,427 | 4 / 5.00 / 12 | digit 100.0%, upper 100.0%, lower 0.0%, space 0.0%, punct 0.1%, nonascii 0.0% |
| 2025-05-27 | 1,074 | 1,074 (100.0%) | 0 | 1,074 | 5 / 5.01 / 8 | digit 99.9%, upper all, punct 0.4% |
| 2025-06-04 | 112,650 | 112,650 (100.0%) | 0 | 112,650 | 2 / 5.00 / 10 | digit 100.0%, upper 100.0%, lower 0.0%, space 0.0%, punct 0.1%, nonascii 0.0% |
| 2025-06-08 | 1,074 | 1,074 (100.0%) | 0 | 1,074 | 5 / 5.01 / 8 | digit 99.9%, upper all, punct 0.4% |
| 2025-11-11 | 159,895 | 159,895 (100.0%) | 0 | 159,678 | 4 / 5.00 / 10 | digit 100.0%, upper 100.0%, lower 0.0%, space 0.0%, punct 0.0%, nonascii 0.0% |
| 2026-01-14 | 146,417 | 146,417 (100.0%) | 0 | 146,219 | 4 / 5.00 / 12 | digit 100.0%, upper 100.0%, lower 0.0%, space 0.0%, punct 0.0%, nonascii 0.0% |
| 2026-06-23 | 158,318 | 158,318 (100.0%) | 0 | 158,318 | 4 / 5.00 / 12 | digit 100.0%, upper 100.0%, lower 0.0%, space 0.0%, punct 0.1%, nonascii 0.0% |

### `product`

| vintage | rows | populated | blank | distinct | length min/mean/max | notable char classes |
|---|---:|---:|---:|---:|---|---|
| 2022-05-30 | 151,152 | 0 (0.0%) | 151,152 | 0 | — | — |
| 2023-02-20 | 152,084 | 107,372 (70.6%) | 44,712 | 6 | 21 / 28.88 / 42 | upper all, lower all, space all |
| 2025-04-08 | 157,427 | 112,270 (71.3%) | 45,157 | 6 | 21 / 29.00 / 42 | upper all, lower all, space all |
| 2025-05-27 | 1,074 | 1,074 (100.0%) | 0 | 5 | 26 / 31.82 / 42 | upper all, lower all, space all |
| 2025-06-04 | 112,650 | 112,650 (100.0%) | 0 | 5 | 26 / 29.01 / 42 | upper all, lower all, space all |
| 2025-06-08 | 1,074 | 1,074 (100.0%) | 0 | 5 | 26 / 31.82 / 42 | upper all, lower all, space all |
| 2025-11-11 | 159,895 | 116,939 (73.1%) | 42,956 | 6 | 21 / 28.97 / 42 | upper all, lower all, space all |
| 2026-01-14 | 146,417 | 106,430 (72.7%) | 39,987 | 6 | 21 / 28.99 / 42 | upper all, lower all, space all |
| 2026-06-23 | 158,318 | 118,158 (74.6%) | 40,160 | 5 | 26 / 29.03 / 42 | upper all, lower all, space all |

### `status`

| vintage | rows | populated | blank | distinct | length min/mean/max | notable char classes |
|---|---:|---:|---:|---:|---|---|
| 2022-05-30 | 151,152 | 151,140 (100.0%) | 12 | 3 | 8 / 8.66 / 9 | upper all, lower all |
| 2023-02-20 | 152,084 | 152,074 (100.0%) | 10 | 3 | 8 / 8.66 / 9 | upper all, lower all |
| 2025-04-08 | 157,427 | 157,413 (100.0%) | 14 | 3 | 8 / 8.67 / 9 | upper all, lower all |
| 2025-05-27 | 1,074 | 1,074 (100.0%) | 0 | 3 | 8 / 8.96 / 9 | upper all, lower all |
| 2025-06-04 | 112,650 | 112,636 (100.0%) | 14 | 3 | 8 / 8.91 / 9 | upper all, lower all |
| 2025-06-08 | 1,074 | 1,074 (100.0%) | 0 | 3 | 8 / 8.96 / 9 | upper all, lower all |
| 2025-11-11 | 159,895 | 159,884 (100.0%) | 11 | 3 | 8 / 8.66 / 9 | upper all, lower all |
| 2026-01-14 | 146,417 | 146,407 (100.0%) | 10 | 3 | 8 / 8.66 / 9 | upper all, lower all |
| 2026-06-23 | 158,318 | 158,318 (100.0%) | 0 | 3 | 8 / 8.67 / 9 | upper all, lower all |

### `type`

| vintage | rows | populated | blank | distinct | length min/mean/max | notable char classes |
|---|---:|---:|---:|---:|---|---|
| 2022-05-30 | 151,152 | 151,150 (100.0%) | 2 | 1 | 19 / 19.00 / 19 | upper all, lower all, space all, punct all |
| 2023-02-20 | 152,084 | 0 (0.0%) | 152,084 | 0 | — | — |
| 2025-04-08 | 157,427 | 157,427 (100.0%) | 0 | 1 | 19 / 19.00 / 19 | upper all, lower all, space all, punct all |
| 2025-05-27 | 1,074 | 1,074 (100.0%) | 0 | 1 | 19 / 19.00 / 19 | upper all, lower all, space all, punct all |
| 2025-06-04 | 112,650 | 112,648 (100.0%) | 2 | 1 | 19 / 19.00 / 19 | upper all, lower all, space all, punct all |
| 2025-06-08 | 1,074 | 1,074 (100.0%) | 0 | 1 | 19 / 19.00 / 19 | upper all, lower all, space all, punct all |
| 2025-11-11 | 159,895 | 159,895 (100.0%) | 0 | 1 | 19 / 19.00 / 19 | upper all, lower all, space all, punct all |
| 2026-01-14 | 146,417 | 146,417 (100.0%) | 0 | 1 | 19 / 19.00 / 19 | upper all, lower all, space all, punct all |
| 2026-06-23 | 158,318 | 158,318 (100.0%) | 0 | 1 | 19 / 19.00 / 19 | upper all, lower all, space all, punct all |

### `created_date`

| vintage | rows | populated | blank | distinct | length min/mean/max | notable char classes |
|---|---:|---:|---:|---:|---|---|
| 2022-05-30 | 151,152 | 0 (0.0%) | 151,152 | 0 | — | — |
| 2023-02-20 | 152,084 | 0 (0.0%) | 152,084 | 0 | — | — |
| 2025-04-08 | 157,427 | 157,427 (100.0%) | 0 | 2,958 | 10 / 10.00 / 10 | digit all, punct all |
| 2025-05-27 | 1,074 | 1,074 (100.0%) | 0 | 1,062 | 16 / 16.00 / 16 | digit all, space all, punct all |
| 2025-06-04 | 112,650 | 112,650 (100.0%) | 0 | 22,760 | 16 / 16.00 / 16 | digit all, space all, punct all |
| 2025-06-08 | 1,074 | 1,074 (100.0%) | 0 | 1,062 | 16 / 16.00 / 16 | digit all, space all, punct all |
| 2025-11-11 | 159,895 | 0 (0.0%) | 159,895 | 0 | — | — |
| 2026-01-14 | 146,417 | 0 (0.0%) | 146,417 | 0 | — | — |
| 2026-06-23 | 158,318 | 0 (0.0%) | 158,318 | 0 | — | — |

### `last_modified_date`

| vintage | rows | populated | blank | distinct | length min/mean/max | notable char classes |
|---|---:|---:|---:|---:|---|---|
| 2022-05-30 | 151,152 | 0 (0.0%) | 151,152 | 0 | — | — |
| 2023-02-20 | 152,084 | 152,084 (100.0%) | 0 | 2,350 | 10 / 10.00 / 10 | digit all, punct all |
| 2025-04-08 | 157,427 | 157,427 (100.0%) | 0 | 2,084 | 10 / 10.00 / 10 | digit all, punct all |
| 2025-05-27 | 1,074 | 1,074 (100.0%) | 0 | 762 | 16 / 16.00 / 16 | digit all, space all, punct all |
| 2025-06-04 | 112,650 | 112,650 (100.0%) | 0 | 27,757 | 16 / 16.00 / 16 | digit all, space all, punct all |
| 2025-06-08 | 1,074 | 1,074 (100.0%) | 0 | 762 | 16 / 16.00 / 16 | digit all, space all, punct all |
| 2025-11-11 | 159,895 | 0 (0.0%) | 159,895 | 0 | — | — |
| 2026-01-14 | 146,417 | 0 (0.0%) | 146,417 | 0 | — | — |
| 2026-06-23 | 158,318 | 0 (0.0%) | 158,318 | 0 | — | — |

### `licence_version_last_modified_date`

| vintage | rows | populated | blank | distinct | length min/mean/max | notable char classes |
|---|---:|---:|---:|---:|---|---|
| 2022-05-30 | 151,152 | 0 (0.0%) | 151,152 | 0 | — | — |
| 2023-02-20 | 152,084 | 0 (0.0%) | 152,084 | 0 | — | — |
| 2025-04-08 | 157,427 | 0 (0.0%) | 157,427 | 0 | — | — |
| 2025-05-27 | 1,074 | 0 (0.0%) | 1,074 | 0 | — | — |
| 2025-06-04 | 112,650 | 0 (0.0%) | 112,650 | 0 | — | — |
| 2025-06-08 | 1,074 | 0 (0.0%) | 1,074 | 0 | — | — |
| 2025-11-11 | 159,895 | 105,716 (66.1%) | 54,179 | 38 | 10 / 10.00 / 10 | digit all, punct all |
| 2026-01-14 | 146,417 | 96,155 (65.7%) | 50,262 | 101 | 10 / 10.00 / 10 | digit all, punct all |
| 2026-06-23 | 158,318 | 105,332 (66.5%) | 52,986 | 249 | 10 / 10.00 / 10 | digit all, punct all |

### `licence_version_original_start_date`

| vintage | rows | populated | blank | distinct | length min/mean/max | notable char classes |
|---|---:|---:|---:|---:|---|---|
| 2022-05-30 | 151,152 | 0 (0.0%) | 151,152 | 0 | — | — |
| 2023-02-20 | 152,084 | 0 (0.0%) | 152,084 | 0 | — | — |
| 2025-04-08 | 157,427 | 0 (0.0%) | 157,427 | 0 | — | — |
| 2025-05-27 | 1,074 | 0 (0.0%) | 1,074 | 0 | — | — |
| 2025-06-04 | 112,650 | 0 (0.0%) | 112,650 | 0 | — | — |
| 2025-06-08 | 1,074 | 0 (0.0%) | 1,074 | 0 | — | — |
| 2025-11-11 | 159,895 | 105,716 (66.1%) | 54,179 | 15,309 | 10 / 10.00 / 10 | digit all, punct all |
| 2026-01-14 | 146,417 | 96,155 (65.7%) | 50,262 | 14,917 | 10 / 10.00 / 10 | digit all, punct all |
| 2026-06-23 | 158,318 | 105,332 (66.5%) | 52,986 | 15,488 | 10 / 10.00 / 10 | digit all, punct all |

## Top values per vintage

Up to 8 most frequent values per column per vintage, with their
share of populated values. For a low-cardinality column this is the whole
distribution; for a date or callsign column it is the concentration
profile — a single day holding a majority is the mass-update fingerprint
(issue #801). Values carrying invisibles/contaminants are exploded to
`{U+XXXX}` markers.

### `callsign`

- **2022-05-30** (151,148 distinct): `,,` 1 (0.0%), `20-Apr` 1 (0.0%), `20-Aug` 1 (0.0%), `20-Dec` 1 (0.0%), `20-Feb` 1 (0.0%), `20-Jan` 1 (0.0%), `20-Jul` 1 (0.0%), `20-Mar` 1 (0.0%)
- **2023-02-20** (152,082 distinct): `,,` 1 (0.0%), `20-Apr` 1 (0.0%), `20-Aug` 1 (0.0%), `20-Dec` 1 (0.0%), `20-Feb` 1 (0.0%), `20-Jan` 1 (0.0%), `20-Jul` 1 (0.0%), `20-Mar` 1 (0.0%)
- **2025-04-08** (157,427 distinct): `20-Apr` 1 (0.0%), `20-Aug` 1 (0.0%), `20-Dec` 1 (0.0%), `20-Feb` 1 (0.0%), `20-Jan` 1 (0.0%), `20-Jul` 1 (0.0%), `20-Jun` 1 (0.0%), `20-Mar` 1 (0.0%)
- **2025-05-27** (1,074 distinct): `20FEV` 1 (0.1%), `20FEZ` 1 (0.1%), `20FFB` 1 (0.1%), `20FFD` 1 (0.1%), `20FFI` 1 (0.1%), `20FFJ` 1 (0.1%), `20FFK` 1 (0.1%), `20FFN` 1 (0.1%)
- **2025-06-04** (112,650 distinct): `,,` 1 (0.0%), `20AAA` 1 (0.0%), `20AAB` 1 (0.0%), `20AAC` 1 (0.0%), `20AAD` 1 (0.0%), `20AAE` 1 (0.0%), `20AAF` 1 (0.0%), `20AAG` 1 (0.0%)
- **2025-06-08** (1,074 distinct): `20FEV` 1 (0.1%), `20FEZ` 1 (0.1%), `20FFB` 1 (0.1%), `20FFD` 1 (0.1%), `20FFI` 1 (0.1%), `20FFJ` 1 (0.1%), `20FFK` 1 (0.1%), `20FFN` 1 (0.1%)
- **2025-11-11** (159,678 distinct): `G3EVA` 3 (0.0%), `G5CWP` 3 (0.0%), `G8SDX` 3 (0.0%), `M0BUS` 3 (0.0%), `20CAM` 2 (0.0%), `20NAE` 2 (0.0%), `20TWA` 2 (0.0%), `21DQG` 2 (0.0%)
- **2026-01-14** (146,219 distinct): `G3EVA` 3 (0.0%), `G5CWP` 3 (0.0%), `G8SDX` 3 (0.0%), `M0BUS` 3 (0.0%), `20CAM` 2 (0.0%), `20NAE` 2 (0.0%), `20TWA` 2 (0.0%), `21DQG` 2 (0.0%)
- **2026-06-23** (158,318 distinct): `G0TQK` 2 (0.0%), `G7IWE` 2 (0.0%), `20AAA` 1 (0.0%), `20AAB` 1 (0.0%), `20AAC` 1 (0.0%), `20AAD` 1 (0.0%), `20AAE` 1 (0.0%), `20AAF` 1 (0.0%)

### `product`

- **2023-02-20** (6 distinct): `Amateur Full Radio Licence` 58,725 (54.7%), `Amateur Foundation Radio Licence` 33,190 (30.9%), `Amateur Intermediate Radio Licence` 13,551 (12.6%), `Amateur Club Radio Licence` 1,829 (1.7%), `Amateur Temporary Reciprocal Radio Licence` 75 (0.1%), `Special Event Station` 2 (0.0%)
- **2025-04-08** (6 distinct): `Amateur Full Radio Licence` 59,193 (52.7%), `Amateur Foundation Radio Licence` 36,744 (32.7%), `Amateur Intermediate Radio Licence` 14,311 (12.7%), `Amateur Club Radio Licence` 1,904 (1.7%), `Amateur Temporary Reciprocal Radio Licence` 113 (0.1%), `Special Event Station` 5 (0.0%)
- **2025-05-27** (5 distinct): `Amateur Foundation Radio Licence` 708 (65.9%), `Amateur Intermediate Radio Licence` 243 (22.6%), `Amateur Full Radio Licence` 103 (9.6%), `Amateur Club Radio Licence` 16 (1.5%), `Amateur Temporary Reciprocal Radio Licence` 4 (0.4%)
- **2025-06-04** (5 distinct): `Amateur Full Radio Licence` 59,220 (52.6%), `Amateur Foundation Radio Licence` 37,016 (32.9%), `Amateur Intermediate Radio Licence` 14,389 (12.8%), `Amateur Club Radio Licence` 1,909 (1.7%), `Amateur Temporary Reciprocal Radio Licence` 116 (0.1%)
- **2025-06-08** (5 distinct): `Amateur Foundation Radio Licence` 708 (65.9%), `Amateur Intermediate Radio Licence` 243 (22.6%), `Amateur Full Radio Licence` 103 (9.6%), `Amateur Club Radio Licence` 16 (1.5%), `Amateur Temporary Reciprocal Radio Licence` 4 (0.4%)
- **2025-11-11** (6 distinct): `Amateur Full Radio Licence` 61,854 (52.9%), `Amateur Foundation Radio Licence` 37,995 (32.5%), `Amateur Intermediate Radio Licence` 14,816 (12.7%), `Amateur Club Radio Licence` 2,222 (1.9%), `Amateur Temporary Reciprocal Radio Licence` 47 (0.0%), `Special Event Station` 5 (0.0%)
- **2026-01-14** (6 distinct): `Amateur Full Radio Licence` 55,907 (52.5%), `Amateur Foundation Radio Licence` 34,719 (32.6%), `Amateur Intermediate Radio Licence` 13,645 (12.8%), `Amateur Club Radio Licence` 2,119 (2.0%), `Amateur Temporary Reciprocal Radio Licence` 37 (0.0%), `Special Event Station` 3 (0.0%)
- **2026-06-23** (5 distinct): `Amateur Full Radio Licence` 61,466 (52.0%), `Amateur Foundation Radio Licence` 38,784 (32.8%), `Amateur Intermediate Radio Licence` 15,529 (13.1%), `Amateur Club Radio Licence` 2,279 (1.9%), `Amateur Temporary Reciprocal Radio Licence` 100 (0.1%)

### `status`

- **2022-05-30** (3 distinct): `Allocated` 99,464 (65.8%), `Reserved` 51,269 (33.9%), `Available` 407 (0.3%)
- **2023-02-20** (3 distinct): `Allocated` 100,351 (66.0%), `Reserved` 51,301 (33.7%), `Available` 422 (0.3%)
- **2025-04-08** (3 distinct): `Allocated` 104,627 (66.5%), `Reserved` 52,275 (33.2%), `Available` 511 (0.3%)
- **2025-05-27** (3 distinct): `Allocated` 1,033 (96.2%), `Reserved` 39 (3.6%), `Available` 2 (0.2%)
- **2025-06-04** (3 distinct): `Allocated` 102,213 (90.7%), `Reserved` 10,177 (9.0%), `Available` 246 (0.2%)
- **2025-06-08** (3 distinct): `Allocated` 1,033 (96.2%), `Reserved` 39 (3.6%), `Available` 2 (0.2%)
- **2025-11-11** (3 distinct): `Allocated` 105,716 (66.1%), `Reserved` 53,673 (33.6%), `Available` 495 (0.3%)
- **2026-01-14** (3 distinct): `Allocated` 96,155 (65.7%), `Reserved` 49,723 (34.0%), `Available` 529 (0.4%)
- **2026-06-23** (3 distinct): `Allocated` 105,332 (66.5%), `Reserved` 52,418 (33.1%), `Available` 568 (0.4%)

### `type`

- **2022-05-30** (1 distinct): `Call Sign - Amateur` 151,150 (100.0%)
- **2025-04-08** (1 distinct): `Call Sign - Amateur` 157,427 (100.0%)
- **2025-05-27** (1 distinct): `Call Sign - Amateur` 1,074 (100.0%)
- **2025-06-04** (1 distinct): `Call Sign - Amateur` 112,648 (100.0%)
- **2025-06-08** (1 distinct): `Call Sign - Amateur` 1,074 (100.0%)
- **2025-11-11** (1 distinct): `Call Sign - Amateur` 159,895 (100.0%)
- **2026-01-14** (1 distinct): `Call Sign - Amateur` 146,417 (100.0%)
- **2026-06-23** (1 distinct): `Call Sign - Amateur` 158,318 (100.0%)

### `created_date`

- **2025-04-08** (2,958 distinct): `2016-07-23` 89,694 (57.0%), `2016-08-12` 37,872 (24.1%), `2016-08-02` 5,864 (3.7%), `2016-07-29` 79 (0.1%), `2021-12-14` 62 (0.0%), `2019-04-29` 51 (0.0%), `2018-12-21` 48 (0.0%), `2018-12-06` 47 (0.0%)
- **2025-05-27** (1,062 distinct): `2019-02-28 18:23` 2 (0.2%), `2019-04-29 15:35` 2 (0.2%), `2019-04-29 15:45` 2 (0.2%), `2019-04-29 15:57` 2 (0.2%), `2019-04-29 16:09` 2 (0.2%), `2019-04-29 17:15` 2 (0.2%), `2019-04-29 17:27` 2 (0.2%), `2021-08-19 11:25` 2 (0.2%)
- **2025-06-04** (22,760 distinct): `2016-07-23 16:26` 9,600 (8.5%), `2016-07-23 16:25` 9,200 (8.2%), `2016-07-23 16:28` 9,173 (8.1%), `2016-07-23 16:31` 8,578 (7.6%), `2016-07-23 16:34` 8,383 (7.4%), `2016-07-23 16:30` 8,377 (7.4%), `2016-07-23 16:27` 7,975 (7.1%), `2016-07-23 16:29` 7,965 (7.1%)
- **2025-06-08** (1,062 distinct): `2019-02-28 18:23` 2 (0.2%), `2019-04-29 15:35` 2 (0.2%), `2019-04-29 15:45` 2 (0.2%), `2019-04-29 15:57` 2 (0.2%), `2019-04-29 16:09` 2 (0.2%), `2019-04-29 17:15` 2 (0.2%), `2019-04-29 17:27` 2 (0.2%), `2021-08-19 11:25` 2 (0.2%)

### `last_modified_date`

- **2023-02-20** (2,350 distinct): `2016-08-12` 57,054 (37.5%), `2016-07-23` 32,982 (21.7%), `2016-08-02` 6,332 (4.2%), `2016-08-10` 3,360 (2.2%), `2021-03-03` 203 (0.1%), `2021-03-04` 123 (0.1%), `2021-05-20` 119 (0.1%), `2021-03-16` 117 (0.1%)
- **2025-04-08** (2,084 distinct): `2016-08-12` 39,760 (25.3%), `2016-08-02` 3,394 (2.2%), `2016-07-23` 2,934 (1.9%), `2024-09-02` 1,062 (0.7%), `2024-09-05` 1,053 (0.7%), `2024-07-25` 1,033 (0.7%), `2024-08-27` 1,032 (0.7%), `2024-07-29` 1,030 (0.7%)
- **2025-05-27** (762 distinct): `2024-04-24 18:05` 6 (0.6%), `2024-04-29 18:05` 6 (0.6%), `2024-04-23 18:38` 5 (0.5%), `2024-04-27 18:33` 5 (0.5%), `2024-04-28 18:18` 5 (0.5%), `2024-06-11 02:45` 5 (0.5%), `2024-06-11 03:23` 5 (0.5%), `2024-06-12 02:38` 5 (0.5%)
- **2025-06-04** (27,757 distinct): `2016-07-23 16:29` 406 (0.4%), `2016-07-23 16:31` 374 (0.3%), `2016-07-23 16:28` 326 (0.3%), `2016-07-23 16:30` 322 (0.3%), `2016-07-23 16:32` 321 (0.3%), `2016-07-23 16:33` 293 (0.3%), `2016-07-23 16:34` 248 (0.2%), `2016-07-23 16:26` 246 (0.2%)
- **2025-06-08** (762 distinct): `2024-04-24 18:05` 6 (0.6%), `2024-04-29 18:05` 6 (0.6%), `2024-04-23 18:38` 5 (0.5%), `2024-04-27 18:33` 5 (0.5%), `2024-04-28 18:18` 5 (0.5%), `2024-06-11 02:45` 5 (0.5%), `2024-06-11 03:23` 5 (0.5%), `2024-06-12 02:38` 5 (0.5%)

### `licence_version_last_modified_date`

- **2025-11-11** (38 distinct): `2025-10-11` 86,890 (82.2%), `2025-10-30` 11,749 (11.1%), `2025-10-14` 915 (0.9%), `2025-10-13` 631 (0.6%), `2025-10-15` 496 (0.5%), `2025-10-17` 483 (0.5%), `2025-10-16` 366 (0.3%), `2025-10-18` 305 (0.3%)
- **2026-01-14** (101 distinct): `2025-10-11` 75,280 (78.3%), `2025-10-30` 10,433 (10.9%), `2025-11-17` 855 (0.9%), `2025-10-14` 534 (0.6%), `2025-10-13` 374 (0.4%), `2025-10-17` 323 (0.3%), `2025-10-15` 302 (0.3%), `2025-10-19` 260 (0.3%)
- **2026-06-23** (249 distinct): `2025-10-11` 76,378 (72.5%), `2025-10-30` 11,062 (10.5%), `2026-02-13` 630 (0.6%), `2025-11-17` 402 (0.4%), `2026-02-16` 402 (0.4%), `2026-02-14` 343 (0.3%), `2025-10-14` 256 (0.2%), `2025-10-20` 214 (0.2%)

### `licence_version_original_start_date`

- **2025-11-11** (15,309 distinct): `1982-04-16` 137 (0.1%), `1990-07-24` 89 (0.1%), `2004-01-09` 89 (0.1%), `1985-07-18` 87 (0.1%), `2015-07-08` 84 (0.1%), `2013-07-09` 83 (0.1%), `1985-07-12` 79 (0.1%), `1996-04-01` 74 (0.1%)
- **2026-01-14** (14,917 distinct): `1982-04-16` 130 (0.1%), `2004-01-09` 86 (0.1%), `1990-07-24` 85 (0.1%), `1985-07-18` 80 (0.1%), `1985-07-12` 78 (0.1%), `2013-07-09` 75 (0.1%), `2015-07-08` 74 (0.1%), `1986-07-23` 69 (0.1%)
- **2026-06-23** (15,488 distinct): `1982-04-16` 137 (0.1%), `1990-07-24` 89 (0.1%), `2004-01-09` 89 (0.1%), `1985-07-18` 87 (0.1%), `2015-07-08` 83 (0.1%), `2013-07-09` 82 (0.1%), `1985-07-12` 79 (0.1%), `1996-04-01` 74 (0.1%)

## Flagged divergences

Every vintage-over-vintage flag the thresholds raised, in column then
vintage order. A flag names a shape change and weighs candidate
explanations; it reaches no verdict (issue #467). The `magnitude` column
orders the biggest movers within a measure and is not a severity score.

| column | from | to | measure | detail | magnitude |
|---|---|---|---|---|---:|
| `callsign` | 2025-04-08 | 2025-05-27 | cardinality-shift | distinct values 157,427 -> 1,074 (x0.01) | 7.196 |
| `callsign` | 2025-04-08 | 2025-05-27 | character-vanished | character `1`: 12.7% -> 0.5% of values | 0.122 |
| `callsign` | 2025-04-08 | 2025-05-27 | character-vanished | character `3`: 16.4% -> 0.0% of values | 0.164 |
| `callsign` | 2025-04-08 | 2025-05-27 | character-vanished | character `4`: 8.9% -> 0.1% of values | 0.088 |
| `callsign` | 2025-04-08 | 2025-05-27 | character-vanished | character `6`: 14.7% -> 0.1% of values | 0.146 |
| `callsign` | 2025-04-08 | 2025-05-27 | character-vanished | character `8`: 4.8% -> 0.2% of values | 0.046 |
| `callsign` | 2025-05-27 | 2025-06-04 | cardinality-shift | distinct values 1,074 -> 112,650 (x104.89) | 6.713 |
| `callsign` | 2025-05-27 | 2025-06-04 | character-appeared | character `1`: 0.5% -> 8.3% of values | 0.078 |
| `callsign` | 2025-05-27 | 2025-06-04 | character-appeared | character `3`: 0.0% -> 14.6% of values | 0.146 |
| `callsign` | 2025-05-27 | 2025-06-04 | character-appeared | character `4`: 0.1% -> 9.0% of values | 0.089 |
| `callsign` | 2025-05-27 | 2025-06-04 | character-appeared | character `6`: 0.1% -> 17.6% of values | 0.175 |
| `callsign` | 2025-05-27 | 2025-06-04 | character-appeared | character `8`: 0.2% -> 4.6% of values | 0.045 |
| `callsign` | 2025-06-04 | 2025-06-08 | cardinality-shift | distinct values 112,650 -> 1,074 (x0.01) | 6.713 |
| `callsign` | 2025-06-04 | 2025-06-08 | character-vanished | character `1`: 8.3% -> 0.5% of values | 0.078 |
| `callsign` | 2025-06-04 | 2025-06-08 | character-vanished | character `3`: 14.6% -> 0.0% of values | 0.146 |
| `callsign` | 2025-06-04 | 2025-06-08 | character-vanished | character `4`: 9.0% -> 0.1% of values | 0.089 |
| `callsign` | 2025-06-04 | 2025-06-08 | character-vanished | character `6`: 17.6% -> 0.1% of values | 0.175 |
| `callsign` | 2025-06-04 | 2025-06-08 | character-vanished | character `8`: 4.6% -> 0.2% of values | 0.045 |
| `callsign` | 2025-06-08 | 2025-11-11 | cardinality-shift | distinct values 1,074 -> 159,678 (x148.68) | 7.216 |
| `callsign` | 2025-06-08 | 2025-11-11 | character-appeared | character `1`: 0.5% -> 12.5% of values | 0.120 |
| `callsign` | 2025-06-08 | 2025-11-11 | character-appeared | character `3`: 0.0% -> 16.2% of values | 0.162 |
| `callsign` | 2025-06-08 | 2025-11-11 | character-appeared | character `4`: 0.1% -> 8.8% of values | 0.087 |
| `callsign` | 2025-06-08 | 2025-11-11 | character-appeared | character `6`: 0.1% -> 14.5% of values | 0.144 |
| `callsign` | 2025-06-08 | 2025-11-11 | character-appeared | character `8`: 0.2% -> 5.1% of values | 0.049 |
| `callsign` | 2025-11-11 | 2026-01-14 | character-vanished | character `Z`: 8.9% -> 0.0% of values | 0.089 |
| `callsign` | 2026-01-14 | 2026-06-23 | character-appeared | character `Z`: 0.0% -> 6.2% of values | 0.062 |
| `created_date` | 2023-02-20 | 2025-04-08 | column-populated | blank in 2023-02-20, 157,427 populated here | 157427.000 |
| `created_date` | 2025-04-08 | 2025-05-27 | cardinality-shift | distinct values 2,958 -> 1,062 (x0.36) | 1.478 |
| `created_date` | 2025-04-08 | 2025-05-27 | length-shift | mean length 10.00 -> 16.00 | 6.000 |
| `created_date` | 2025-04-08 | 2025-05-27 | char-class-shift | space share 0.0% -> 100.0% | 1.000 |
| `created_date` | 2025-04-08 | 2025-05-27 | character-appeared | character `:`: 0.0% -> 100.0% of values | 1.000 |
| `created_date` | 2025-04-08 | 2025-05-27 | character-appeared | character `U+0020`: 0.0% -> 100.0% of values | 1.000 |
| `created_date` | 2025-05-27 | 2025-06-04 | cardinality-shift | distinct values 1,062 -> 22,760 (x21.43) | 4.422 |
| `created_date` | 2025-06-04 | 2025-06-08 | cardinality-shift | distinct values 22,760 -> 1,062 (x0.05) | 4.422 |
| `created_date` | 2025-06-08 | 2025-11-11 | column-emptied | 1,074 populated in 2025-06-08, blank here | 1074.000 |
| `last_modified_date` | 2022-05-30 | 2023-02-20 | column-populated | blank in 2022-05-30, 152,084 populated here | 152084.000 |
| `last_modified_date` | 2025-04-08 | 2025-05-27 | cardinality-shift | distinct values 2,084 -> 762 (x0.37) | 1.451 |
| `last_modified_date` | 2025-04-08 | 2025-05-27 | length-shift | mean length 10.00 -> 16.00 | 6.000 |
| `last_modified_date` | 2025-04-08 | 2025-05-27 | char-class-shift | space share 0.0% -> 100.0% | 1.000 |
| `last_modified_date` | 2025-04-08 | 2025-05-27 | character-appeared | character `:`: 0.0% -> 100.0% of values | 1.000 |
| `last_modified_date` | 2025-04-08 | 2025-05-27 | character-appeared | character `U+0020`: 0.0% -> 100.0% of values | 1.000 |
| `last_modified_date` | 2025-05-27 | 2025-06-04 | cardinality-shift | distinct values 762 -> 27,757 (x36.43) | 5.187 |
| `last_modified_date` | 2025-06-04 | 2025-06-08 | cardinality-shift | distinct values 27,757 -> 762 (x0.03) | 5.187 |
| `last_modified_date` | 2025-06-08 | 2025-11-11 | column-emptied | 1,074 populated in 2025-06-08, blank here | 1074.000 |
| `licence_version_last_modified_date` | 2025-06-08 | 2025-11-11 | column-populated | blank in 2025-06-08, 105,716 populated here | 105716.000 |
| `licence_version_last_modified_date` | 2025-11-11 | 2026-01-14 | cardinality-shift | distinct values 38 -> 101 (x2.66) | 1.410 |
| `licence_version_last_modified_date` | 2025-11-11 | 2026-01-14 | character-appeared | character `6`: 0.6% -> 1.8% of values | 0.013 |
| `licence_version_last_modified_date` | 2025-11-11 | 2026-01-14 | character-appeared | character `7`: 0.7% -> 1.8% of values | 0.011 |
| `licence_version_last_modified_date` | 2026-01-14 | 2026-06-23 | cardinality-shift | distinct values 101 -> 249 (x2.47) | 1.302 |
| `licence_version_last_modified_date` | 2026-01-14 | 2026-06-23 | character-appeared | character `8`: 0.9% -> 1.5% of values | 0.006 |
| `licence_version_last_modified_date` | 2026-01-14 | 2026-06-23 | character-appeared | character `9`: 0.9% -> 1.5% of values | 0.005 |
| `licence_version_original_start_date` | 2025-06-08 | 2025-11-11 | column-populated | blank in 2025-06-08, 105,716 populated here | 105716.000 |
| `product` | 2022-05-30 | 2023-02-20 | column-populated | blank in 2022-05-30, 107,372 populated here | 107372.000 |
| `product` | 2025-04-08 | 2025-05-27 | blank-share-shift | blank 28.7% -> 0.0% | 0.287 |
| `product` | 2025-04-08 | 2025-05-27 | length-shift | mean length 29.00 -> 31.82 | 2.826 |
| `product` | 2025-04-08 | 2025-05-27 | value-distribution-shift | total-variation distance 0.433 | 0.433 |
| `product` | 2025-05-27 | 2025-06-04 | length-shift | mean length 31.82 -> 29.01 | 2.815 |
| `product` | 2025-05-27 | 2025-06-04 | value-distribution-shift | total-variation distance 0.432 | 0.432 |
| `product` | 2025-06-04 | 2025-06-08 | length-shift | mean length 29.01 -> 31.82 | 2.815 |
| `product` | 2025-06-04 | 2025-06-08 | value-distribution-shift | total-variation distance 0.432 | 0.432 |
| `product` | 2025-06-08 | 2025-11-11 | blank-share-shift | blank 0.0% -> 26.9% | 0.269 |
| `product` | 2025-06-08 | 2025-11-11 | length-shift | mean length 31.82 -> 28.97 | 2.856 |
| `product` | 2025-06-08 | 2025-11-11 | value-distribution-shift | total-variation distance 0.437 | 0.437 |
| `status` | 2025-04-08 | 2025-05-27 | value-distribution-shift | total-variation distance 0.297 | 0.297 |
| `status` | 2025-06-08 | 2025-11-11 | value-distribution-shift | total-variation distance 0.301 | 0.301 |
| `type` | 2022-05-30 | 2023-02-20 | column-emptied | 151,150 populated in 2022-05-30, blank here | 151150.000 |
| `type` | 2023-02-20 | 2025-04-08 | column-populated | blank in 2023-02-20, 157,427 populated here | 157427.000 |
