# Reprocessing-touch series stratification

Ofcom periodically bulk-reprocesses the register. Each run leaves a
fingerprint: a cohort of records whose `record-last-modified` date lands in
the window between two consecutive register snapshots. This report folds,
for every such inter-snapshot window, how that touch cohort is distributed
across callsign series — and compares it against the asserting snapshot’s
own series composition. The finding (issue #871): the touches are **not a
uniform sample** of the register; they are stratified by series, and the
stratification’s direction changes from run to run.

**Flags, never verdicts** (issue #467): a stratified touch is reported with
candidate explanations and NONE is chosen. Nothing in the held
correspondence names these runs — that absence is stated, not filled in.

_Corpus assertion ceiling: 2025-06-04 (the latest snapshot carrying the touch signal; this report carries no build-time date)._

The ceiling is NOT the newest snapshot held. Four newer full exports
(2025-09-11, 2025-11-11, 2026-01-14, 2026-06-23; 146k–160k subjects each)
are absent because they no longer carry the `record-last-modified` touch
signal at all: the open-data lane stopped populating `created_date` /
`last_modified_date` after 2025-06-04 (the columns are present but blank)
and now populates the licence-version date family instead, while the sole
later FOI export (2025-09-11) renders a licence-scoped last-modified, a
different kind. That schema evolution is itself a finding, tracked as its
own issue (#911); this report is honestly bounded at the signal, not the
corpus.

## Method and pinned conventions

- **Touch signal.** The S1 `record-last-modified` event claim — the register
  export’s own "this row last changed" date, the column a reprocessing run
  stamps. One kind by design; mixing licence-scoped or original-start dates
  would conflate distinct facts.
- **Series key.** The canonical `prefix_series` parse claim the ledger
  already carries (exactly parseCallsign’s grouping — `M7`, `G0`, `20` for
  the 2E0 intermediates, …), never a bespoke SQL re-derivation. A visitor,
  special-event or unparseable callsign has no series and lands in
  `(unclassified)` — kept in the totals, never given a verdict.
- **Vintage sequence.** Register snapshots asserting the touch kind for at
  least 10,000 distinct subjects, ordered by ISO anchor date. A
  month-only vintage anchors to its first day (`2024-07` → `2024-07-01`);
  a fold-time invariant fails loud if such a vintage ever carries a touch
  dated later in its month (which would push it out of its own window).
  Two kinds of snapshot are excluded: a partial or trial publication below
  the floor (not a snapshot "touched since" is meaningful against), and any
  snapshot that does not carry the touch signal (the post-2025-06-04 full
  exports — see the ceiling note above and #911).
- **Interleaved export shapes.** The corpus mixes full "all-callsigns"
  exports (~152k–160k subjects) with narrower "issued-only" / partial ones
  (~108k–110k: the 2023-11-24, 2023-12-07 and 2024-07-22 snapshots). A
  window whose snapshot is a narrower export only sees touches of subjects
  present in it, so touches of subjects confined to the wider exports’
  reserved/available pool fall in the gap — those windows’ base and cohort
  are the narrower population, not the whole register, and are not strictly
  comparable to the full-export windows.
- **Touch window (the pinned convention).** For a vintage `V` with
  predecessor `P`, the cohort is every subject whose latest `record-last-
modified` value `d` satisfies `P.date < d ≤ V.date` — predecessor-EXCLUSIVE,
  snapshot-INCLUSIVE. The earliest snapshot has no predecessor and no window.
- **Enrichment measure.** Per (vintage, series): the cohort’s share of the
  series against the export’s base share, shown as BOTH the absolute counts
  and the ratio `cohort-share / base-share` — never a bare ratio. Cohort ⊆
  base, so shares are honest fractions of the whole snapshot (the
  `(unclassified)` bucket included in the denominators).
- **Small-n guard.** A series needs ≥ 500 base and ≥ 50 cohort
  subjects before its ratio earns an enriched/depleted verdict; below
  either floor the counts are shown but the ratio is not read as signal.
  A ratio ≥ 1.50× reads as enriched, ≤ 0.67× as depleted.
- **Mass-episode overlap.** Each window is checked against the S2 detector’s
  flagged mass-update episodes (src/ci/event-time-coherency.ts, default
  parameters). An overlap would mean the cohort coincides with a detected
  episode; the spread-out reprocessing runs studied here deliberately do
  NOT (they are exactly the mass touches the 21-day S2 window cannot see —
  issue #872) — a coincidence, not a contradiction.

Vocabulary:

- **enriched** — the cohort holds a LARGER share of this series than the export does — the run touched it disproportionately
- **depleted** — the cohort holds a SMALLER share of this series than the export does — the run largely passed it over
- **proportionate** — the cohort’s share of this series is close to the export’s — touched roughly in line with its presence
- **small-n** — too few base or cohort subjects (or no series at all) for an enrichment verdict — the counts are shown, the ratio is not read as signal

## Candidate explanations (offered, adjudicated as none)

A stratified touch is consistent with several mechanisms, and this report
chooses between none of them:

- a reprocessing run scoped to a **licence class or renewal cohort** (the
  series map onto licence classes — M7/M6/M3 Foundation, M0/M1/M5 and the
  G-series Full, 20/21 Intermediate — so a class-scoped run would look
  exactly like a series-stratified one);
- a **phased migration** touching record eras in turn (older G-series
  records in one wave, newer Foundation issues in another);
- a **data-quality campaign** confined to particular series or vintages.

Nothing in the held correspondence names or dates these runs. The
stratification is an observation about the data; the mechanism behind it is
not settled here.

## Inter-snapshot windows

Every analysed vintage, its touch window, and the cohort it carries. "Touch
rate" is the cohort as a share of the snapshot’s record-bearing subjects.

| snapshot | window (touched since) | base subjects | cohort subjects | touch rate | overlaps S2 episode |
|---|---|---:|---:|---:|---|
| `2023-01-25` (2023-01-25) | 2020-10-23 → 2023-01-25 | 152,075 | 24,172 | 15.9% | no |
| `2023-02-20` (2023-02-20) | 2023-01-25 → 2023-02-20 | 152,075 | 0 | 0.0% | no |
| `2023-08-18` (2023-08-18) | 2023-02-20 → 2023-08-18 | 153,242 | 5,155 | 3.4% | no |
| `2023-11-24` (2023-11-24) | 2023-08-18 → 2023-11-24 | 108,919 | 2,855 | 2.6% | no |
| `2023-12-07` (2023-12-07) | 2023-11-24 → 2023-12-07 | 108,989 | 382 | 0.4% | no |
| `2024-01` (2024-01-01) | 2023-12-07 → 2024-01-01 | 153,932 | 518 | 0.3% | no |
| `2024-07` (2024-07-01) | 2024-01-01 → 2024-07-01 | 155,342 | 42,503 | 27.4% | no |
| `2024-07-22` (2024-07-22) | 2024-07-01 → 2024-07-22 | 110,619 | 2,676 | 2.4% | no |
| `2024-10-21` (2024-10-21) | 2024-07-22 → 2024-10-21 | 156,275 | 49,427 | 31.6% | no |
| `2025-03-13` (2025-03-13) | 2024-10-21 → 2025-03-13 | 157,220 | 3,648 | 2.3% | no |
| `2025-04-08` (2025-04-08) | 2025-03-13 → 2025-04-08 | 157,420 | 736 | 0.5% | no |
| `2025-06-04` (2025-06-04) | 2025-04-08 → 2025-06-04 | 112,645 | 1,419 | 1.3% | no |

## Named cohorts and reconciliation with the #867 spike

The stratification was first seen in the #867 co-occurrence spike and
confirmed by a second, independent derivation before #871 was filed. The
two derivations used slightly different window conventions; this report
pins ONE (predecessor-exclusive, snapshot-inclusive) and reconciles both.

### 2024-07 — enriched in the newer Foundation series

_Spike derivation:_ `M7` 18.8% vs 9.4% base; `M6` 17.8% vs 10.1%; `M0` 14.8% vs 8.9%.

_This report (window `2024-01-01 → 2024-07-01`):_

- `M7` 17.4% of the cohort vs 6.6% of the export (7,407/10,219, 2.65×) — enriched.
- `M6` 14.4% of the cohort vs 9.5% of the export (6,135/14,726, 1.52×).
- `M0` 12.2% of the cohort vs 8.2% of the export (5,190/12,722, 1.49×).

The direction and the identity of the enriched series match the spike
exactly. The base shares differ (this report’s `M7` base is ~6.6%, the
spike’s 9.4%): the spike measured against a smaller, issued-only
denominator, whereas the pinned base here is every record-last-modified-
bearing subject in the asserting snapshot. The enrichment survives either
denominator — the finding is the disproportion, not its exact multiple.

### 2024-10-21 — the run that largely excludes M7

_Verification derivation:_ `M7` ~1.3–2.0% of the cohort vs 6.9% base;
older G-series enriched (52.7% vs 48.6%); `M7` present in the export
(10,854 records) with prior observations available — not a coverage gap.

_This report (window `2024-07-22 → 2024-10-21`):_

- `M7` 2.0% of the cohort vs 6.9% of the export (983/10,854, 0.29×) — depleted.
- the G-series as a bloc: 52.7% of the cohort vs 48.6% of the export (26,046/75,970).
- `M7` base 10,854 records — present and touchable, simply not touched.

This report’s `M7` cohort share (2.0%) sits within the verification
derivation’s stated 1.3–2.0% range — at its upper edge, and the minimum
reached across plausible window-start choices; the exact 1.3% lower bound
reflects that derivation’s own, slightly different window convention, which
this report does not reconstruct rather than guess at. The base share
(6.9%), the G-series bloc (52.7% vs 48.6%) and the `M7` record count
(10,854) reproduce it. This is the only analysed window in which `M7` is DEPLETED rather than enriched — the observation that
prompted #871. Between this window and the enriched 2024-07 one sits the
narrower issued-only 2024-07-22 window, where `M7` is proportionate.

## Per-window series stratification

One table per analysed window with a non-empty cohort, every series ordered
by base population. A window whose cohort is empty (a republication of the
previous snapshot with nothing touched since) is listed above but has no
stratification to show.

### 2023-01-25 — window 2020-10-23 → 2023-01-25

Cohort 24,172 of 152,075 subjects (15.9% touch rate).
**Enriched:** `M7` (4.65×), `20` (2.03×), `M0` (1.65×). **Depleted:** `21` (0.27×), `M3` (0.39×), `G7` (0.39×), `M1` (0.50×), `G1` (0.52×), `G3` (0.53×), `G0` (0.58×), `G6` (0.62×), `G4` (0.65×).

| series | base | base share | cohort | cohort share | ratio | enrichment |
|---|---:|---:|---:|---:|---:|---|
| `M3` | 16,693 | 11.0% | 1,042 | 4.3% | 0.39× | depleted |
| `M6` | 14,726 | 9.7% | 2,082 | 8.6% | 0.89× | proportionate |
| `G0` | 14,146 | 9.3% | 1,305 | 5.4% | 0.58× | depleted |
| `G4` | 13,984 | 9.2% | 1,434 | 5.9% | 0.65× | depleted |
| `20` | 12,931 | 8.5% | 4,178 | 17.3% | 2.03× | enriched |
| `G7` | 12,766 | 8.4% | 799 | 3.3% | 0.39× | depleted |
| `M0` | 12,433 | 8.2% | 3,253 | 13.5% | 1.65× | enriched |
| `G1` | 9,140 | 6.0% | 753 | 3.1% | 0.52× | depleted |
| `G3` | 9,078 | 6.0% | 763 | 3.2% | 0.53× | depleted |
| `G6` | 8,308 | 5.5% | 822 | 3.4% | 0.62× | depleted |
| `M7` | 8,061 | 5.3% | 5,954 | 24.6% | 4.65× | enriched |
| `G8` | 7,407 | 4.9% | 834 | 3.5% | 0.71× | proportionate |
| `21` | 6,189 | 4.1% | 267 | 1.1% | 0.27× | depleted |
| `M1` | 4,452 | 2.9% | 352 | 1.5% | 0.50× | depleted |
| `M5` | 829 | 0.5% | 121 | 0.5% | 0.92× | proportionate |
| `G2` | 598 | 0.4% | 44 | 0.2% | 0.46× | small-n |
| `G5` | 236 | 0.2% | 150 | 0.6% | 4.00× | small-n |
| `(unclassified)` | 97 | 0.1% | 19 | 0.1% | 1.23× | small-n |
| `M2` | 1 | 0.0% | 0 | 0.0% | 0.00× | small-n |

### 2023-02-20 — no cohort

No record’s `record-last-modified` falls in `2023-01-25 → 2023-02-20`: this snapshot
repeats its predecessor’s dates (a republication, or a genuinely quiet
window). Nothing touched, so nothing to stratify.

### 2023-08-18 — window 2023-02-20 → 2023-08-18

Cohort 5,155 of 153,242 subjects (3.4% touch rate).
**Enriched:** `M7` (4.84×), `20` (2.00×). **Depleted:** `21` (0.26×), `M3` (0.38×), `M1` (0.43×), `G1` (0.46×), `G7` (0.47×), `G3` (0.48×), `G0` (0.52×), `G4` (0.61×), `G6` (0.61×).

| series | base | base share | cohort | cohort share | ratio | enrichment |
|---|---:|---:|---:|---:|---:|---|
| `M3` | 16,693 | 10.9% | 214 | 4.2% | 0.38× | depleted |
| `M6` | 14,726 | 9.6% | 430 | 8.3% | 0.87× | proportionate |
| `G0` | 14,154 | 9.2% | 249 | 4.8% | 0.52× | depleted |
| `G4` | 13,995 | 9.1% | 285 | 5.5% | 0.61× | depleted |
| `20` | 13,153 | 8.6% | 883 | 17.1% | 2.00× | enriched |
| `G7` | 12,770 | 8.3% | 200 | 3.9% | 0.47× | depleted |
| `M0` | 12,556 | 8.2% | 614 | 11.9% | 1.45× | proportionate |
| `G1` | 9,152 | 6.0% | 141 | 2.7% | 0.46× | depleted |
| `G3` | 9,086 | 5.9% | 148 | 2.9% | 0.48× | depleted |
| `M7` | 8,784 | 5.7% | 1,429 | 27.7% | 4.84× | enriched |
| `G6` | 8,318 | 5.4% | 170 | 3.3% | 0.61× | depleted |
| `G8` | 7,420 | 4.8% | 184 | 3.6% | 0.74× | proportionate |
| `21` | 6,200 | 4.0% | 54 | 1.0% | 0.26× | depleted |
| `M1` | 4,458 | 2.9% | 65 | 1.3% | 0.43× | depleted |
| `M5` | 830 | 0.5% | 21 | 0.4% | 0.75× | small-n |
| `G2` | 598 | 0.4% | 20 | 0.4% | 0.99× | small-n |
| `G5` | 258 | 0.2% | 39 | 0.8% | 4.49× | small-n |
| `(unclassified)` | 90 | 0.1% | 9 | 0.2% | 2.97× | small-n |
| `M2` | 1 | 0.0% | 0 | 0.0% | 0.00× | small-n |

### 2023-11-24 — window 2023-08-18 → 2023-11-24

Cohort 2,855 of 108,919 subjects (2.6% touch rate).
**Enriched:** `M7` (3.42×). **Depleted:** `M3` (0.43×), `G0` (0.58×), `G1` (0.58×), `G7` (0.58×), `M6` (0.60×).

| series | base | base share | cohort | cohort share | ratio | enrichment |
|---|---:|---:|---:|---:|---:|---|
| `M6` | 14,569 | 13.4% | 230 | 8.1% | 0.60× | depleted |
| `20` | 12,156 | 11.2% | 438 | 15.3% | 1.37× | proportionate |
| `M3` | 10,638 | 9.8% | 121 | 4.2% | 0.43× | depleted |
| `M0` | 10,567 | 9.7% | 333 | 11.7% | 1.20× | proportionate |
| `G4` | 10,086 | 9.3% | 217 | 7.6% | 0.82× | proportionate |
| `G0` | 9,515 | 8.7% | 144 | 5.0% | 0.58× | depleted |
| `M7` | 9,053 | 8.3% | 811 | 28.4% | 3.42× | enriched |
| `G7` | 6,070 | 5.6% | 93 | 3.3% | 0.58× | depleted |
| `G3` | 5,796 | 5.3% | 111 | 3.9% | 0.73× | proportionate |
| `G1` | 5,246 | 4.8% | 80 | 2.8% | 0.58× | depleted |
| `G6` | 5,229 | 4.8% | 99 | 3.5% | 0.72× | proportionate |
| `G8` | 5,200 | 4.8% | 112 | 3.9% | 0.82× | proportionate |
| `M1` | 2,387 | 2.2% | 31 | 1.1% | 0.50× | small-n |
| `21` | 1,677 | 1.5% | 13 | 0.5% | 0.30× | small-n |
| `M5` | 314 | 0.3% | 6 | 0.2% | 0.73× | small-n |
| `G2` | 237 | 0.2% | 7 | 0.2% | 1.13× | small-n |
| `(unclassified)` | 104 | 0.1% | 7 | 0.2% | 2.57× | small-n |
| `G5` | 75 | 0.1% | 2 | 0.1% | 1.02× | small-n |

### 2023-12-07 — window 2023-11-24 → 2023-12-07

Cohort 382 of 108,989 subjects (0.4% touch rate).
**Enriched:** `M7` (3.63×), `20` (1.69×). **Depleted:** none above the floor.

| series | base | base share | cohort | cohort share | ratio | enrichment |
|---|---:|---:|---:|---:|---:|---|
| `M6` | 14,569 | 13.4% | 32 | 8.4% | 0.63× | small-n |
| `20` | 12,180 | 11.2% | 72 | 18.8% | 1.69× | enriched |
| `M3` | 10,638 | 9.8% | 20 | 5.2% | 0.54× | small-n |
| `M0` | 10,573 | 9.7% | 46 | 12.0% | 1.24× | small-n |
| `G4` | 10,086 | 9.3% | 21 | 5.5% | 0.59× | small-n |
| `G0` | 9,515 | 8.7% | 15 | 3.9% | 0.45× | small-n |
| `M7` | 9,109 | 8.4% | 116 | 30.4% | 3.63× | enriched |
| `G7` | 6,070 | 5.6% | 12 | 3.1% | 0.56× | small-n |
| `G3` | 5,796 | 5.3% | 6 | 1.6% | 0.30× | small-n |
| `G1` | 5,246 | 4.8% | 11 | 2.9% | 0.60× | small-n |
| `G6` | 5,229 | 4.8% | 10 | 2.6% | 0.55× | small-n |
| `G8` | 5,200 | 4.8% | 10 | 2.6% | 0.55× | small-n |
| `M1` | 2,387 | 2.2% | 3 | 0.8% | 0.36× | small-n |
| `21` | 1,679 | 1.5% | 3 | 0.8% | 0.51× | small-n |
| `M5` | 314 | 0.3% | 2 | 0.5% | 1.82× | small-n |
| `G2` | 237 | 0.2% | 0 | 0.0% | 0.00× | small-n |
| `(unclassified)` | 86 | 0.1% | 3 | 0.8% | 9.95× | small-n |
| `G5` | 75 | 0.1% | 0 | 0.0% | 0.00× | small-n |

### 2024-01 — window 2023-12-07 → 2024-01-01

Cohort 518 of 153,932 subjects (0.3% touch rate).
**Enriched:** `M7` (4.91×), `20` (1.84×), `M0` (1.63×). **Depleted:** none above the floor.

| series | base | base share | cohort | cohort share | ratio | enrichment |
|---|---:|---:|---:|---:|---:|---|
| `M3` | 16,693 | 10.8% | 24 | 4.6% | 0.43× | small-n |
| `M6` | 14,726 | 9.6% | 41 | 7.9% | 0.83× | small-n |
| `G0` | 14,154 | 9.2% | 21 | 4.1% | 0.44× | small-n |
| `G4` | 13,998 | 9.1% | 26 | 5.0% | 0.55× | small-n |
| `20` | 13,263 | 8.6% | 82 | 15.8% | 1.84× | enriched |
| `G7` | 12,770 | 8.3% | 19 | 3.7% | 0.44× | small-n |
| `M0` | 12,606 | 8.2% | 69 | 13.3% | 1.63× | enriched |
| `M7` | 9,256 | 6.0% | 153 | 29.5% | 4.91× | enriched |
| `G1` | 9,160 | 6.0% | 13 | 2.5% | 0.42× | small-n |
| `G3` | 9,093 | 5.9% | 12 | 2.3% | 0.39× | small-n |
| `G6` | 8,324 | 5.4% | 12 | 2.3% | 0.43× | small-n |
| `G8` | 7,430 | 4.8% | 25 | 4.8% | 1.00× | small-n |
| `21` | 6,203 | 4.0% | 5 | 1.0% | 0.24× | small-n |
| `M1` | 4,461 | 2.9% | 11 | 2.1% | 0.73× | small-n |
| `M5` | 834 | 0.5% | 2 | 0.4% | 0.71× | small-n |
| `G2` | 598 | 0.4% | 1 | 0.2% | 0.50× | small-n |
| `G5` | 273 | 0.2% | 1 | 0.2% | 1.09× | small-n |
| `(unclassified)` | 89 | 0.1% | 1 | 0.2% | 3.34× | small-n |
| `M2` | 1 | 0.0% | 0 | 0.0% | 0.00× | small-n |

### 2024-07 — window 2024-01-01 → 2024-07-01

Cohort 42,503 of 155,342 subjects (27.4% touch rate).
**Enriched:** `M7` (2.65×), `20` (1.74×), `M6` (1.52×). **Depleted:** `21` (0.28×), `G2` (0.44×), `M3` (0.48×), `G3` (0.54×), `G7` (0.55×), `G1` (0.58×), `M1` (0.65×), `G0` (0.66×).

| series | base | base share | cohort | cohort share | ratio | enrichment |
|---|---:|---:|---:|---:|---:|---|
| `M3` | 16,693 | 10.7% | 2,203 | 5.2% | 0.48× | depleted |
| `M6` | 14,726 | 9.5% | 6,135 | 14.4% | 1.52× | enriched |
| `G0` | 14,160 | 9.1% | 2,561 | 6.0% | 0.66× | depleted |
| `G4` | 14,005 | 9.0% | 2,937 | 6.9% | 0.77× | proportionate |
| `20` | 13,446 | 8.7% | 6,383 | 15.0% | 1.74× | enriched |
| `G7` | 12,772 | 8.2% | 1,933 | 4.5% | 0.55× | depleted |
| `M0` | 12,722 | 8.2% | 5,190 | 12.2% | 1.49× | proportionate |
| `M7` | 10,219 | 6.6% | 7,407 | 17.4% | 2.65× | enriched |
| `G1` | 9,180 | 5.9% | 1,465 | 3.4% | 0.58× | depleted |
| `G3` | 9,108 | 5.9% | 1,350 | 3.2% | 0.54× | depleted |
| `G6` | 8,342 | 5.4% | 1,532 | 3.6% | 0.67× | proportionate |
| `G8` | 7,449 | 4.8% | 1,714 | 4.0% | 0.84× | proportionate |
| `21` | 6,204 | 4.0% | 481 | 1.1% | 0.28× | depleted |
| `M1` | 4,474 | 2.9% | 793 | 1.9% | 0.65× | depleted |
| `M5` | 843 | 0.5% | 181 | 0.4% | 0.78× | proportionate |
| `G2` | 598 | 0.4% | 72 | 0.2% | 0.44× | depleted |
| `G5` | 298 | 0.2% | 157 | 0.4% | 1.93× | small-n |
| `(unclassified)` | 102 | 0.1% | 9 | 0.0% | 0.32× | small-n |
| `M2` | 1 | 0.0% | 0 | 0.0% | 0.00× | small-n |

### 2024-07-22 — window 2024-07-01 → 2024-07-22

Cohort 2,676 of 110,619 subjects (2.4% touch rate).
**Enriched:** `M6` (3.09×), `M3` (1.78×). **Depleted:** `G4` (0.38×), `G1` (0.39×), `G8` (0.40×), `G7` (0.42×), `G3` (0.42×), `20` (0.50×), `G0` (0.50×).

| series | base | base share | cohort | cohort share | ratio | enrichment |
|---|---:|---:|---:|---:|---:|---|
| `M6` | 14,569 | 13.2% | 1,088 | 40.7% | 3.09× | enriched |
| `20` | 12,421 | 11.2% | 150 | 5.6% | 0.50× | depleted |
| `M0` | 10,719 | 9.7% | 206 | 7.7% | 0.79× | proportionate |
| `M3` | 10,638 | 9.6% | 458 | 17.1% | 1.78× | enriched |
| `M7` | 10,313 | 9.3% | 256 | 9.6% | 1.03× | proportionate |
| `G4` | 10,090 | 9.1% | 93 | 3.5% | 0.38× | depleted |
| `G0` | 9,516 | 8.6% | 115 | 4.3% | 0.50× | depleted |
| `G7` | 6,070 | 5.5% | 61 | 2.3% | 0.42× | depleted |
| `G3` | 5,797 | 5.2% | 59 | 2.2% | 0.42× | depleted |
| `G1` | 5,248 | 4.7% | 50 | 1.9% | 0.39× | depleted |
| `G6` | 5,234 | 4.7% | 38 | 1.4% | 0.30× | small-n |
| `G8` | 5,205 | 4.7% | 50 | 1.9% | 0.40× | depleted |
| `M1` | 2,389 | 2.2% | 22 | 0.8% | 0.38× | small-n |
| `21` | 1,679 | 1.5% | 15 | 0.6% | 0.37× | small-n |
| `M5` | 314 | 0.3% | 3 | 0.1% | 0.39× | small-n |
| `G2` | 237 | 0.2% | 8 | 0.3% | 1.40× | small-n |
| `(unclassified)` | 105 | 0.1% | 1 | 0.0% | 0.39× | small-n |
| `G5` | 75 | 0.1% | 3 | 0.1% | 1.65× | small-n |

### 2024-10-21 — window 2024-07-22 → 2024-10-21

Cohort 49,427 of 156,275 subjects (31.6% touch rate).
**Enriched:** none above the floor. **Depleted:** `M7` (0.29×), `G2` (0.48×), `M5` (0.53×), `21` (0.57×).

| series | base | base share | cohort | cohort share | ratio | enrichment |
|---|---:|---:|---:|---:|---:|---|
| `M3` | 16,693 | 10.7% | 6,657 | 13.5% | 1.26× | proportionate |
| `M6` | 14,727 | 9.4% | 5,588 | 11.3% | 1.20× | proportionate |
| `G0` | 14,162 | 9.1% | 5,230 | 10.6% | 1.17× | proportionate |
| `G4` | 14,011 | 9.0% | 5,364 | 10.9% | 1.21× | proportionate |
| `20` | 13,577 | 8.7% | 3,838 | 7.8% | 0.89× | proportionate |
| `M0` | 12,797 | 8.2% | 3,681 | 7.4% | 0.91× | proportionate |
| `G7` | 12,777 | 8.2% | 3,525 | 7.1% | 0.87× | proportionate |
| `M7` | 10,854 | 6.9% | 983 | 2.0% | 0.29× | depleted |
| `G1` | 9,189 | 5.9% | 3,191 | 6.5% | 1.10× | proportionate |
| `G3` | 9,116 | 5.8% | 2,714 | 5.5% | 0.94× | proportionate |
| `G6` | 8,352 | 5.3% | 3,131 | 6.3% | 1.19× | proportionate |
| `G8` | 7,461 | 4.8% | 2,774 | 5.6% | 1.18× | proportionate |
| `21` | 6,212 | 4.0% | 1,128 | 2.3% | 0.57× | depleted |
| `M1` | 4,482 | 2.9% | 1,356 | 2.7% | 0.96× | proportionate |
| `M5` | 852 | 0.5% | 142 | 0.3% | 0.53× | depleted |
| `G2` | 598 | 0.4% | 90 | 0.2% | 0.48× | depleted |
| `G5` | 304 | 0.2% | 27 | 0.1% | 0.28× | small-n |
| `(unclassified)` | 110 | 0.1% | 8 | 0.0% | 0.23× | small-n |
| `M2` | 1 | 0.0% | 0 | 0.0% | 0.00× | small-n |

### 2025-03-13 — window 2024-10-21 → 2025-03-13

Cohort 3,648 of 157,220 subjects (2.3% touch rate).
**Enriched:** `M7` (5.63×), `20` (1.57×). **Depleted:** `M3` (0.28×), `G7` (0.33×), `G0` (0.37×), `G6` (0.44×), `G3` (0.45×), `G1` (0.46×), `G4` (0.50×), `G8` (0.56×), `M6` (0.65×).

| series | base | base share | cohort | cohort share | ratio | enrichment |
|---|---:|---:|---:|---:|---:|---|
| `M3` | 16,693 | 10.6% | 110 | 3.0% | 0.28× | depleted |
| `M6` | 14,727 | 9.4% | 223 | 6.1% | 0.65× | depleted |
| `G0` | 14,166 | 9.0% | 122 | 3.3% | 0.37× | depleted |
| `G4` | 14,016 | 8.9% | 162 | 4.4% | 0.50× | depleted |
| `20` | 13,672 | 8.7% | 498 | 13.7% | 1.57× | enriched |
| `M0` | 12,903 | 8.2% | 426 | 11.7% | 1.42× | proportionate |
| `G7` | 12,779 | 8.1% | 97 | 2.7% | 0.33× | depleted |
| `M7` | 11,483 | 7.3% | 1,499 | 41.1% | 5.63× | enriched |
| `G1` | 9,200 | 5.9% | 98 | 2.7% | 0.46× | depleted |
| `G3` | 9,124 | 5.8% | 96 | 2.6% | 0.45× | depleted |
| `G6` | 8,360 | 5.3% | 86 | 2.4% | 0.44× | depleted |
| `G8` | 7,471 | 4.8% | 97 | 2.7% | 0.56× | depleted |
| `21` | 6,210 | 3.9% | 23 | 0.6% | 0.16× | small-n |
| `M1` | 4,490 | 2.9% | 42 | 1.2% | 0.40× | small-n |
| `M5` | 858 | 0.5% | 18 | 0.5% | 0.90× | small-n |
| `G2` | 598 | 0.4% | 5 | 0.1% | 0.36× | small-n |
| `G5` | 329 | 0.2% | 36 | 1.0% | 4.72× | small-n |
| `(unclassified)` | 140 | 0.1% | 10 | 0.3% | 3.08× | small-n |
| `M2` | 1 | 0.0% | 0 | 0.0% | 0.00× | small-n |

### 2025-04-08 — window 2025-03-13 → 2025-04-08

Cohort 736 of 157,420 subjects (0.5% touch rate).
**Enriched:** `M7` (6.10×), `20` (1.75×). **Depleted:** none above the floor.

| series | base | base share | cohort | cohort share | ratio | enrichment |
|---|---:|---:|---:|---:|---:|---|
| `M3` | 16,693 | 10.6% | 14 | 1.9% | 0.18× | small-n |
| `M6` | 14,727 | 9.4% | 47 | 6.4% | 0.68× | small-n |
| `G0` | 14,168 | 9.0% | 21 | 2.9% | 0.32× | small-n |
| `G4` | 14,018 | 8.9% | 27 | 3.7% | 0.41× | small-n |
| `20` | 13,692 | 8.7% | 112 | 15.2% | 1.75× | enriched |
| `M0` | 12,918 | 8.2% | 89 | 12.1% | 1.47× | proportionate |
| `G7` | 12,780 | 8.1% | 17 | 2.3% | 0.28× | small-n |
| `M7` | 11,633 | 7.4% | 332 | 45.1% | 6.10× | enriched |
| `G1` | 9,201 | 5.8% | 11 | 1.5% | 0.26× | small-n |
| `G3` | 9,124 | 5.8% | 10 | 1.4% | 0.23× | small-n |
| `G6` | 8,363 | 5.3% | 17 | 2.3% | 0.43× | small-n |
| `G8` | 7,471 | 4.7% | 10 | 1.4% | 0.29× | small-n |
| `21` | 6,211 | 3.9% | 11 | 1.5% | 0.38× | small-n |
| `M1` | 4,492 | 2.9% | 7 | 1.0% | 0.33× | small-n |
| `M5` | 858 | 0.5% | 3 | 0.4% | 0.75× | small-n |
| `G2` | 598 | 0.4% | 2 | 0.3% | 0.72× | small-n |
| `G5` | 331 | 0.2% | 4 | 0.5% | 2.58× | small-n |
| `(unclassified)` | 141 | 0.1% | 2 | 0.3% | 3.03× | small-n |
| `M2` | 1 | 0.0% | 0 | 0.0% | 0.00× | small-n |

### 2025-06-04 — window 2025-04-08 → 2025-06-04

Cohort 1,419 of 112,645 subjects (1.3% touch rate).
**Enriched:** `M7` (4.44×), `20` (1.67×). **Depleted:** `M6` (0.44×).

| series | base | base share | cohort | cohort share | ratio | enrichment |
|---|---:|---:|---:|---:|---:|---|
| `M6` | 14,570 | 12.9% | 80 | 5.6% | 0.44× | depleted |
| `20` | 12,709 | 11.3% | 267 | 18.8% | 1.67× | enriched |
| `M7` | 11,805 | 10.5% | 661 | 46.6% | 4.44× | enriched |
| `M0` | 10,910 | 9.7% | 138 | 9.7% | 1.00× | proportionate |
| `M3` | 10,638 | 9.4% | 32 | 2.3% | 0.24× | small-n |
| `G4` | 10,093 | 9.0% | 46 | 3.2% | 0.36× | small-n |
| `G0` | 9,517 | 8.4% | 39 | 2.7% | 0.33× | small-n |
| `G7` | 6,071 | 5.4% | 30 | 2.1% | 0.39× | small-n |
| `G3` | 5,798 | 5.1% | 13 | 0.9% | 0.18× | small-n |
| `G1` | 5,252 | 4.7% | 22 | 1.6% | 0.33× | small-n |
| `G6` | 5,245 | 4.7% | 34 | 2.4% | 0.51× | small-n |
| `G8` | 5,214 | 4.6% | 25 | 1.8% | 0.38× | small-n |
| `M1` | 2,391 | 2.1% | 15 | 1.1% | 0.50× | small-n |
| `21` | 1,679 | 1.5% | 8 | 0.6% | 0.38× | small-n |
| `M5` | 315 | 0.3% | 1 | 0.1% | 0.25× | small-n |
| `G2` | 237 | 0.2% | 0 | 0.0% | 0.00× | small-n |
| `(unclassified)` | 122 | 0.1% | 4 | 0.3% | 2.60× | small-n |
| `G5` | 79 | 0.1% | 4 | 0.3% | 4.02× | small-n |
