# Hypothesis register

The durable, statused ledger of assumptions and hypotheses about the data —
each with an explicit STATUS, the re-runnable evidence that grounds it, and its
[epistemics tag](../site/glossary.html#epistemics). Its purpose is to turn
ad-hoc exploration into an accumulating scientific record: a question we ask of
the register, once asked, is recorded here with whatever answer the evidence
supports — and stays recorded when the answer changes.

This is the natural home for "questions we discover we want to ask". A sibling
of [`docs/source-register.md`](source-register.md) (which is institutional
memory for *sources*); this is institutional memory for *claims*.

**Statuses**:

- `validated` — checked against named, re-runnable evidence and found to hold.
- `refuted` — checked against named, re-runnable evidence and found NOT to hold.
  A refuted entry is a *result*, not an embarrassment; it stays.
- `untested` — recorded as worth asking, with a route to an answer identified,
  but not yet run.
- `undeterminable` — cannot be settled from the data and sources held; the
  reason it cannot is itself the finding.

**The rules**:

1. **Entries are never deleted.** A status changes only when new evidence
   warrants it; the prior status is kept in the entry's dated history. A
   refuted hypothesis that later turns out true (on better evidence) is
   *re-statused with a new dated line*, never erased — the record of having
   been wrong is part of the science.
2. **A status change requires evidence.** Every status, and every change to one,
   names the evidence (an issue, a query, a test) that grounds it and how to
   re-run it. No status moves on opinion.
3. **The epistemics tag classifies the evidence**, using the four narrative
   claim tags defined in the [glossary epistemics
   section](../site/glossary.html#epistemics): **[observed]** (read directly off
   the register data), **[derived]** (a conclusion combining observations under
   a stated rule), **[hypothesis]** (a candidate not asserted as fact), and
   **[confirmed]** (a hypothesis checked against a named, citable source and
   found to hold). The tag describes *what kind of claim the current status
   rests on*; it is distinct from the status itself.

Every entry's evidence is re-runnable against committed files — the DuckDB
recipes below read the `normalised.csv` snapshots under `archive/`, so any
reader can reproduce the figure that grounds a status rather than taking it on
trust.

---

## H1 — Register modifications happen in Mon–Fri business hours

**Status: `refuted`** &nbsp;·&nbsp; epistemics: **[derived]**

The intuitive assumption that the register is edited by staff during the working
week. Refuted for the bulk of modifications: the day-of-week distribution of
`licence_version_last_modified_date` is essentially **flat across all seven
days** — Sunday 14,485 rising only gently to Friday 17,302 — which is the
signature of a system-generated column running daily, not of Monday-to-Friday
human activity. The single largest day in the 2016 migration was a **Saturday**
(2,929 rows on 2016-07-23) — a batch job, not a staff shift.

**Evidence (re-runnable):** the timestamp exploration on
[#858](https://github.com/MysterAitch/amateur-callsigns-file-watch/issues/858)
(comment thread). DuckDB over
[`archive/2025-06-04/normalised.csv`](../archive/2025-06-04/normalised.csv) — the
vintage carrying full datetimes in both `created_date` and
`last_modified_date` — grouping timed rows by `dayofweek(last_modified_date)`.

**Status history:**

- 2026-07-21 — `refuted`. Day-of-week distribution flat (Sun 14,485 → Fri
  17,302); largest migration day a Saturday. Source: #858.

---

## H2 — Modification timestamps cluster in business hours

**Status: `refuted`** (for the bulk) &nbsp;·&nbsp; epistemics: **[derived]**

The hour-of-day companion to H1. Refuted for the bulk: `last_modified_date`
hours are dominated by a **02:00–04:00 cluster** (~69k of ~112k timed rows —
nightly automated processing), with business hours only a modest ~1.2–1.5k per
hour, plus an **18:00–19:00 spike** (~22k) and ~2.2k at 21:00. The nocturnal
and evening structure is far too large to be staff activity.

A **thin organic daytime band** does exist within the 09:00–17:00 window; and
the large evening band raises a *distinct, still-open* sub-hypothesis (see H2a
below). But the headline "timestamps cluster in business hours" does not hold.

**Caveat (resolved 2026-07-22):** every hour label inherited the timezone
ambiguity that H3 exists to classify. The #858 per-source classification
([`reports/timezone-rendering.md`](../reports/timezone-rendering.md)) has since
pinned the `2025-06-04` vintage's rendering as **UTC**, so the labels read:
the nocturnal cluster is 02:00–04:00 UTC (03:00–05:00 BST for summer-dated
stamps), the evening spike 18:00–19:00 UTC (19:00–20:00 BST). The refutation
itself never depended on the labels.

**Evidence (re-runnable):**
[#858](https://github.com/MysterAitch/amateur-callsigns-file-watch/issues/858),
DuckDB over [`archive/2025-06-04/normalised.csv`](../archive/2025-06-04/normalised.csv)
grouping by `hour(last_modified_date)`.

**Status history:**

- 2026-07-22 — hour labels pinned: `2025-06-04` classified as rendering UTC
  (#858 classifier, reports/timezone-rendering.md), so the clusters are
  02:00–04:00 UTC and 18:00–19:00 UTC (one hour later in BST local time).
  Status unchanged.
- 2026-07-21 — `refuted` for the bulk. 02:00–04:00 cluster ~69k/~112k; evening
  18:00–19:00 spike ~22k; business-hours band only ~1.2–1.5k/hour. Source: #858.

### H2a — The 18:00–19:00 evening band is holder self-service (human), not a cron job (machine)

**Status: `untested`** &nbsp;·&nbsp; epistemics: **[hypothesis]**

A question *discovered while refuting H2*: the ~22k evening spike is either a
second scheduled job or genuine holder self-service in personal time (the Ofcom
portal is self-service). The two are distinguishable by a **weekend-dip test** —
a cron-like job runs flat across all seven days, whereas human self-service dips
at weekends. Not yet cut.

**Evidence route (not yet run):** weekend-dip profile of the 18:00–19:00 band
alone, DuckDB over
[`archive/2025-06-04/normalised.csv`](../archive/2025-06-04/normalised.csv);
the follow-up cut named on
[#858](https://github.com/MysterAitch/amateur-callsigns-file-watch/issues/858).

**Status history:**

- 2026-07-22 — clock label pinned via the #858 classification (`2025-06-04`
  renders UTC): the band is 18:00–19:00 UTC, i.e. 19:00–20:00 BST for
  summer-dated stamps — squarely evening personal time under the self-service
  reading. The weekend-dip test itself remains not run; status unchanged.
- 2026-07-21 — `untested`. Recorded as a discovered question; route identified
  (weekend-dip test), not yet run. Source: #858.

---

## H3 — `wdtk-1141667` renders timestamps in UTC; the 2024-07 register renders local time

**Status: `validated`** &nbsp;·&nbsp; epistemics: **[confirmed]**

A natural experiment settled this. The `wdtk-1141667` FOI disclosure and the
July-2024 open-data register are two renderings of overlapping register content;
comparing the same rows across them showed a **632-of-632** consistent offset —
the disclosure's clock reads UTC where the register reads local time. A perfect
match across every one of the 632 comparable rows is strong evidence the two
sources differ by exactly a timezone convention, not by content.

**Evidence (re-runnable):** the 632/632 comparison on
[#858](https://github.com/MysterAitch/amateur-callsigns-file-watch/issues/858).
DuckDB joining
[`archive/foi/wdtk-1141667--issued-callsigns/normalised--sheet-1-sheet1.csv`](../archive/foi/wdtk-1141667--issued-callsigns/normalised--sheet-1-sheet1.csv)
against the corresponding open-data vintage on the shared key.

**Status history:**

- 2026-07-22 — generalised: the #858 per-source classifier
  ([`reports/timezone-rendering.md`](../reports/timezone-rendering.md),
  `src/ci/timezone-rendering.ts`) reproduces the anchor signal (629 subjects
  under its stricter exclusions — the three dropped records are all
  BST-transition-margin exclusions: 20CLB stamped 2020-10-24, M6NNX and
  20KPU both stamped 2024-04-01, each within a day of a clock change),
  corroborates it at minute precision (the `wdtk-1141667` × `2025-06-04`
  pair's 47,205 summer-dated shared records agree to the exact minute), and
  chains the pair's orientation across the corpus. Status unchanged.
- 2026-07-21 — `validated`. 632/632 rows consistent with a UTC-vs-local offset;
  the natural experiment established in the #857 review and recorded on #858.

---

## H3a — The register's export rendering switched from local time to UTC between the 2024-07 and 2024-10-21 copies

**Status: `validated`** &nbsp;·&nbsp; epistemics: **[derived]**

A finding *discovered while generalising H3* (issue #858). Every register copy
held from the 2020 reserved-callsigns disclosure through the 2024-07 copy
renders its dates in **local time**: the UTC-rendered timed sources'
summer-dated 23:xx stamps consistently carry a one-day-later date in each of
them (204–629 boundary subjects per pair; zero opposite-orientation shifts,
and in-window contradictions of at most 3 subjects on any pair plus at most 4
unexplained — all within the classifier's 5% noise tolerance). From the
**2024-10-21** copy onwards the same boundary-window stamps AGREE in both
midnight-offset windows — those copies render **UTC** days, as do all the
datetime-bearing vintages (the `wdtk-1141667` × `2025-06-04` pair alone
shares 47,205 summer-dated records agreeing to the exact minute, and every
timed-pair minute delta in the corpus is exactly zero). Somewhere between
the 2024-07 and 2024-10-21 exports, the rendering convention flipped. This is
exactly the per-export scope caveat of #858 made concrete: the annotation is
per-export, never per-system.

**Evidence (re-runnable):** the committed golden
[`reports/timezone-rendering.md`](../reports/timezone-rendering.md),
regenerated by the fold `src/ci/timezone-rendering.ts`
(`node src/ci/timezone-rendering.ts`) and gated byte-for-byte by
`src/ci/timezone-rendering-corpus.test.ts` (which pins the per-era label
sets).

**Status history:**

- 2026-07-22 — `validated`. Local-time rendering through 2024-07; UTC
  rendering from 2024-10-21 onwards; discovered and pinned by the #858
  classification.

---

## H4 — Reserved callsigns cool for two years before reallocation

**Status: `untested`** &nbsp;·&nbsp; epistemics: **[hypothesis]**

Ofcom states on the record (FOI 756622's Allocated/Reserved definitions) that a
surrendered or lapsed callsign is held in reservation for a cooling period
before it can be reissued. Whether the held data actually *shows* two-year
`reserved-until` windows and reservation→reallocation cycles matching that
stated policy is now empirically checkable against the event claims, but has not
been run. A known counter-instance already exists ([#568](https://github.com/MysterAitch/amateur-callsigns-file-watch/issues/568)'s
reserved-over-five-years observation), which any test must account for as a
policy exception, data artefact, or genuine policy change — flagged, never
adjudicated.

**Evidence route (not yet run):** the first case of the policy-as-tests work,
[#863](https://github.com/MysterAitch/amateur-callsigns-file-watch/issues/863) —
encode the two-year window as an executable invariant over the event claims and
emit a fold + golden report of every window that does not match.

**Status history:**

- 2026-07-21 — `untested`. Route identified (#863's first policy invariant);
  known counter-instance #568 noted. Source: #863.

---

## H5 — Callsigns within a series are issued sequentially

**Status: `refuted`** (as a strict claim) &nbsp;·&nbsp; epistemics: **[derived]**

The assumption that a series such as `M7xxx` is handed out in suffix order.
Refuted as stated: across every series with datable evidence, the rank
correlation between a suffix's sequence position and its allocation day is at
most a **broad forward drift**, never the near-perfect ordering "issued
sequentially" implies. The strongest series, the Full-series `G0`, reaches only
Spearman **ρ ≈ 0.73**; the young foundation `M7` sits at **0.25**, `M6` at
**0.24**; and the old, reissue-heavy vintage series run the OTHER way — `G2` at
**ρ ≈ −0.45** (reverse-ordered). Two mechanisms visible in the data break strict
sequentiality: applicants may request any *available* callsign in their series
(vanity / choice, not next-in-line), and a lapsed callsign is reissued to a new
holder years out of suffix order. What survives is a weak tendency for
later-suffix callsigns to be issued somewhat later — a drift, not a sequence.

The companion figures are honestly bounded: dated allocation coverage is uneven
between series (77.3% of ~162.6k parsed slots corpus-wide, but as low as ~35% for
some), the order reading leans on the earliest-SURVIVING original-start date
wherever firm `licence-issued` evidence is absent (issue #800 caveat; `M7` is
only ~10% firm-issued), and the exhaustion projections are explicitly NAIVE
flat-rate extrapolation behind a dated-evidence ceiling — the engaging figure
(`M7` ~78% full, a nominal run-out near 2029) is illustrative arithmetic, not a
forecast.

That low firm-issued share now has a sharper reading (H8, #915/#918): the
original-start dates a young series leans on are the LICENCE CHAIN's origin, not
the callsign's issuance, so where firm-issued share is low (`M7` ~10%; `M8`/`M9`
0%) the ρ correlates suffix position against carried licence history rather than
against when the callsign was handed out. This does not change H5's `refuted`
verdict — it explains WHY those series' order signal is weak, and the report
carries the per-series scope warning.

**Evidence (re-runnable):** the committed golden
[`reports/sequence-analytics.md`](../reports/sequence-analytics.md), regenerated
by the fold `src/ci/sequence-analytics.ts` (`node src/ci/sequence-analytics.ts`)
over the S1 allocation-time event claims (`licence-issued`, the earliest-surviving
original-start kinds) and gated byte-for-byte by
`src/ci/sequence-analytics-corpus.test.ts`. The per-series ρ, gap structure,
issuance-rate curves and projection are all folded from the claim ledger.

**Status history:**

- 2026-07-22 — annotation, no status change. The weak order signal for the young
  series is re-read through the licence-chain-origin finding (H8, #915/#918): the
  original-start dates `M7` (~10% firm-issued) and `M8`/`M9` (0%) lean on are
  carried licence-chain origins, not callsign issuance, so their ρ measures
  chain order, not issuance order. Verdict unchanged (`refuted`). Source: #918,
  reports/sequence-analytics.md.
- 2026-07-21 — `refuted` (as a strict claim). Per-series Spearman ρ between suffix
  sequence position and allocation day is at most ~0.73 (`G0`) and negative for
  the old reissue-heavy series (`G2` ≈ −0.45); applicant callsign choice and
  reissue break strict order, leaving only a weak forward drift. Source: #864,
  reports/sequence-analytics.md.
- 2026-07-21 — `untested`. Route identified (#864's sequence analytics), not yet
  run. Source: #864.

---

## H6 — A pre-1977 `Original Start Date` can be trusted as the licence's true issue date

**Status: `undeterminable`** &nbsp;·&nbsp; epistemics: **[hypothesis]**

The OARC community wiki records that, "due to an administrative glitch by the
then Regulator", the register's `Original Start Date` field "is not reliable
prior to 1977". Taking any individual pre-1977 start date as the true issue date
is therefore **undeterminable from the data held**: the register is itself the
field whose reliability is in question, and the mirror holds no independent
ground truth against which a given pre-1977 date could be confirmed or refuted.
The claim is held on a *cited community attestation* (community tier), not on
our own evidence, and has not been independently corroborated against Ofcom.

This is the citable caveat behind the
`forbidden-suffix-issued-after-first-known-list` flag: a pre-1977 (or otherwise
glitch-affected) start date cannot support an "issued after the suffix became
forbidden" inference.

**Evidence (cited, external):** the OARC community wiki,
[wiki.oarc.uk/uk-callsigns](https://wiki.oarc.uk/uk-callsigns), captured on
[#565](https://github.com/MysterAitch/amateur-callsigns-file-watch/issues/565)
and recorded as a caveat in
[`reference-data/flags.md`](../reference-data/flags.md). Independent
corroboration against Ofcom is the open follow-up named on #565.

**Status history:**

- 2026-07-21 — `undeterminable`. Grounded on the cited OARC community
  attestation of the pre-1977 administrative glitch; no independent ground
  truth held; corroboration against Ofcom outstanding. Source: #565.

---

## H7 — Ofcom's bulk reprocessing touches are callsign-series-stratified

**Status: `validated`** &nbsp;·&nbsp; epistemics: **[derived]**

Ofcom periodically bulk-reprocesses the register, stamping a cohort of records
with a fresh `record-last-modified` date. The intuitive assumption is that such
a run is a uniform sweep of the register. **Validated as false:** the touch
cohorts are stratified by callsign series, and the direction of the
stratification changes from run to run. The 2024-10-21 export's touch cohort
(49,427 subjects, the window `2024-07-22 → 2024-10-21`) largely **excludes**
`M7` — 2.0% of the cohort against 6.9% of the same export — while the older
G-series are enriched as a bloc (52.7% of the cohort vs 48.6% of the export).
The nearest earlier FULL-export window (`2024-01-01 → 2024-07-01`) does the
**opposite**, enriching `M7` (17.4% vs 6.6%), `M6` and `M0`; the narrower
issued-only 2024-07-22 window sits between them, with `M7` at parity (1.03×).
It is not a coverage artefact: `M7` is present in the 2024-10 export (10,854
records) with prior observations available — those records were simply not
touched.

The touch signal is bounded at the 2025-06-04 export: no later snapshot carries
`record-last-modified` (the open-data lane stopped populating it after that
date; the sole later FOI export renders a licence-scoped last-modified). That
schema evolution is a finding of its own, tracked on #911, and the report is
honestly bounded at the signal rather than the corpus.

**Flags, never verdicts.** Candidate mechanisms — a run scoped to a licence
class or renewal cohort, a phased migration touching record eras in turn, a
data-quality campaign confined to particular series — are offered and none is
chosen. **Nothing in the held correspondence names or dates these runs.** The
cohorts are also invisible to the S2 mass-episode detector at its default 21-day
window (they are the spread-out mass touches issue #872 anticipates), so their
overlap with the two detected episodes (the 2016 migration, the 2025-10 touch)
is nil — a coincidence, never a contradiction.

**Evidence (re-runnable):** [`reports/reprocessing-stratification.md`](../reports/reprocessing-stratification.md),
regenerated from the claim ledger by the fold in
[`src/ci/reprocessing-stratification.ts`](../src/ci/reprocessing-stratification.ts)
and pinned against the committed corpus by
`src/ci/reprocessing-stratification-corpus.test.ts`. The touch signal is the S1
`record-last-modified` event claim; the series key is the canonical
`prefix_series` parse claim; the touch window is the half-open interval
(predecessor snapshot date, snapshot date] on the record-last-modified value.
First surfaced by the #867 co-occurrence spike and confirmed by a second
independent derivation before [#871](https://github.com/MysterAitch/amateur-callsigns-file-watch/issues/871)
was filed; the report reconciles both prior derivations under the pinned
convention.

**Status history:**

- 2026-07-22 — `validated`. Touch cohorts fold as series-stratified in 11 of the
  12 analysed inter-snapshot windows (the 12th, the 2023-02-20 republication,
  carries no cohort); the 2024-10 run excludes `M7` (0.29× its export share)
  where the 2024-07 run enriches it (2.65×). Two independent derivations agree;
  both reconciled under one pinned window convention. Signal bounded at 2025-06-04
  (#911). Source: #871, reports/reprocessing-stratification.md.

---

## H8 — `licence_version_original_start_date` dates the callsign's issuance

**Status: `refuted`** &nbsp;·&nbsp; epistemics: **[confirmed]**

The intuitive reading of the `licence_version_original_start_date` column: that
it dates when the callsign was issued. **Refuted against a named regulator
source.** Ofcom's own Licence-View field dictionary (its 2014/15 FOI disclosure
of the pre-Salesforce system's views,
`archive/foi/wdtk-238892--out-of-sequence-callsigns/normalised--sheet-2-database-fields.csv`)
defines "Original Start Date" as a **Licence-view** field sitting beside
`Revision` and a *separate* current `Start Date` — i.e. the licence has
revisions, `Start Date` is the current revision's, and `Original Start Date` is
the licence chain's first-ever start, surviving revisions. It is the licence
CHAIN's origin, not the callsign's issuance.

The register bears this out at scale (#915, 2026-06-23 register): ~1,430 `M8`/`M9`
callsigns (both series introduced October 2025) and 14 `M7` callsigns (introduced
October 2018) carry pre-introduction original-start dates, **none of which appear
in any pre-introduction publication**. A callsign cannot have been on the air
before its series existed, so the date is the holder's inherited licence chain,
not the callsign's own issue date. Every consumer of the column was audited under
this reading (#918): the on-this-day superlatives, the survival-cohort curves and
the sequence-analytics order/rate figures now carry the licence-chain-vs-callsign
scope explicitly.

**What remains undeterminable** (the recorded ask-Ofcom question, #915): whether
Salesforce's `Licence_Version.Original_start_date` faithfully preserves the Siebel
semantics across migration, and why the paired `2#0`/`2#1` records' values are
systematically blanked (682/687). The licence-chain-origin *reading* is confirmed;
the residual migration/blanking questions are a separate open item.

**Evidence (cited, held + re-runnable):** the Ofcom field dictionary above (held,
Ofcom FOI tier); the full-population analysis on
[#915](https://github.com/MysterAitch/amateur-callsigns-file-watch/issues/915)
(re-runnable against the archived `normalised.csv` snapshots); the consumer
annotations committed in
[`reports/survival-cohort.md`](../reports/survival-cohort.md),
[`reports/sequence-analytics.md`](../reports/sequence-analytics.md),
[`reports/policy-invariants.md`](../reports/policy-invariants.md) and
[`reference-data/flags.md`](../reference-data/flags.md); audit tracked on
[#918](https://github.com/MysterAitch/amateur-callsigns-file-watch/issues/918).

**Status history:**

- 2026-07-22 — `refuted`, epistemics `[confirmed]`. The column is the licence
  chain's original start (Ofcom Licence-View field dictionary, 2014/15 FOI), not
  callsign issuance; ~1,430 `M8`/`M9` + 14 `M7` carried pre-introduction origins
  absent from every pre-introduction publication corroborate. Residual migration/
  blanking semantics remain the ask-Ofcom question. Source: #915, #918.

---

## H9 — The `M2` prefix has never been issued: its sole register row is a reservation

**Status: `validated`** (bounded to the copies held, 2016-09 onwards) &nbsp;·&nbsp; epistemics: **[derived]**

A register row beginning `M2` reads at first like a data error, or like a
missing reference-data entry. It is neither. Across every register copy held
— the nine open-data snapshots (`2022-05-30` → `2026-06-23`) and the 62
committed FOI parse sources spanning 2016-09 → 2025-09 — exactly **one** `M2`
callsign appears anywhere: **`M2IBX`**. It carries the status **`Reserved`**
in every one of the 19 sources that hold it, the earliest being the
2016-09-20 register snapshot, and **no `M2` callsign has ever been observed
`Allocated`** in any copy. The prefix is correspondingly **absent from
[`reference-data/prefix-formats.csv`](../reference-data/prefix-formats.csv)**
(which mirrors Ofcom's current Table 1), so the row draws the
`unknown-prefix-series` flag — of which it is the *sole* instance in every
snapshot that carries it — and the unexpected-locator marker in the regional
identifier matrix. Both are correct behaviour rather than defects to repair:
an honest unknown, with no licence class implied.

**What the evidence supports, and what it does not.** This is an argument
from absence, and its reach is bounded in three named ways.

- The corpus begins at 2016-09. No earlier register copy is held, so nothing
  here speaks to issuance before that date.
- Ofcom holds no record of the never-allocated pool at all (**H10**), so the
  absence of an unissued block from the register is *expected* rather than
  probative. The claim the corpus positively supports is therefore the
  narrow one: **no copy held records an `M2` callsign as allocated** — not
  the unbounded "never issued in the history of UK amateur licensing".
- The primary-source support the finding was first recorded with — a
  2018-07-05 per-prefix live-callsign count table which omits `M2` entirely
  while listing G2 (164) and G5 (58) — **cannot be re-run against this
  repository**. That disclosure is `pending-ingest`
  ([`docs/source-register.md`](source-register.md), attribute-addenda table),
  its counts held only inline in correspondence outside the archive. It is a
  lead, not evidence, until ingested.

**One observation recorded, not adjudicated.** The earliest disclosure
carrying a licence-class column (2016-09-29) records `M2IBX` as `Reserved`
with the class `Amateur Foundation Radio Licence`; every later export leaves
its product blank. 3,005 rows in that disclosure carry the
Reserved + Foundation combination, so the value is unremarkable in itself —
but it is the only class ever attributed to an `M2` callsign, and it is
Foundation. No mechanism is chosen.

`M2IBX` is also absent from three publications (`2025-05-27`, `2025-06-04`,
`2025-06-08`) — not a change of status, but a consequence of its blank
product field and the omission recorded at **H14**.

**Evidence (re-runnable):** scan the callsign column of every
`archive/*/normalised.csv` and `archive/foi/*/normalised--*.csv` for the
pattern `^M2[A-Z]` and tabulate the status column — one distinct value
(`M2IBX`), `Reserved` in all 19 sources that hold it, oldest
[`archive/foi/ofcom-2016-09-20--callsign-database--all-callsigns/normalised--sheet-1-sheet1.csv`](../archive/foi/ofcom-2016-09-20--callsign-database--all-callsigns/normalised--sheet-1-sheet1.csv).
The Foundation class is in
[`archive/foi/wdtk-356636--all-callsigns-plus-forbidden/normalised--sheet-1-all-call-signs.csv`](../archive/foi/wdtk-356636--all-callsigns-plus-forbidden/normalised--sheet-1-all-call-signs.csv).
The flag definition is in
[`reference-data/flags.md`](../reference-data/flags.md); its per-snapshot
count is `callsignFlags["unknown-prefix-series"]` in each
`archive/*/stats.json`.

**Status history:**

- 2026-07-29 — `validated` as the narrow claim, on migration from working
  notes to this register. Verified against the corpus as it stands: one `M2`
  callsign, `Reserved` in all 19 sources holding it; `M2` absent from
  `prefix-formats.csv`; `unknown-prefix-series` count 1 per snapshot. The
  note being migrated dated the Reserved run from `2022-05-30`; the FOI
  corpus **extends it back to 2016-09-20**, roughly a decade rather than the
  four years recorded. The 2018 count-table support was found **not
  re-runnable** (`pending-ingest`) and is recorded as a lead. Originally
  observed 2026-07-07.

### H9a — `M2` was withheld to avoid a clash with VHF Marine Channel M2

**Status: `untested`** &nbsp;·&nbsp; epistemics: **[hypothesis]**

The *reason* the block was never brought into use — a separate question from
H9's observation that it was not. A rationale recorded alongside H9 on
2026-07-07 attributes it to a clash with **VHF Marine Channel M2**
(161.425 MHz, used at UK ports and marinas). This is **not asserted here, and
must not be cited as fact**: it arrived as a third-party web summary, not
from any Ofcom document, and **no source held connects the marine channel to
an amateur allocation decision**. That marine Channel M2 exists and is in use
is separately attested by community sources; the *causal* step from that to
Ofcom withholding amateur `M2` is precisely the untested part.

A companion claim from the same summary — that `M2` appeared in
amateur-licensing reform paperwork as a candidate **Intermediate**
designation — is equally unverified, and the one class ever recorded against
an `M2` callsign is Foundation (H9), which does not support it.

Worth holding in mind when reading any source that appears to discuss the
block: in UK amateur usage "M2" far more often means the 2-metre band, or an
antenna manufacturer, than a callsign prefix.

**Evidence route (not yet run):** Ofcom's amateur-licensing consultation and
statement series, for any documented consideration of an `M2` designation;
failing that, a targeted request for the allocation rationale, in the manner
of the correspondence already held under `archive/foi/`. Neither has been
done, and the community sources held support only the existence of the marine
channel, never the causal link.

**Status history:**

- 2026-07-29 — `untested`. Recorded on migration, deliberately separated from
  H9's validated core so the unverified rationale cannot be read as part of
  it. Route identified; not run. Originally noted 2026-07-07, flagged
  unverified from the outset.

---

## H10 — Ofcom holds a record of the callsigns available for issue

**Status: `refuted`** &nbsp;·&nbsp; epistemics: **[confirmed]**

The natural assumption behind any "which callsigns are free?" question, and
the reason the register lists far fewer callsigns than the callsign space
allows. **Refuted against Ofcom's own repeated statements**, held verbatim in
the archive: since a 2016 licensing-system change, availability is computed on
demand and no list of available callsigns is kept.

- **Ofcom 337399, 29 September 2016** — "We do not hold a list of call signs
  that are available. Due to a system change, the assignment of call signs is
  now done using an algorithm rather than 'grabbing' from a list."
- **Ofcom 671462, 27 February 2019** — "We do not hold lists of available
  call signs, but instead our licensing system generates them on demand."
  Ofcom 518689 and 632469 carry the same refusal.
- **FOI 01842686, 22 July 2024** — "We do not hold a list of completely new
  callsigns which have never been previously allocated as our system
  generates new callsigns on demand." The same letter describes its annex as
  the callsigns "which have been issued".
- **FOI 1562825, 1 March 2023** — no discrete list of formerly-issued Full
  callsigns is held either; the system generates callsigns on demand.

Two consequences the register's semantics rest on. First, **most of the
callsign space is absent by design**: a callsign that has never been seen is
outside what Ofcom stores, so "not yet in the record" is normal rather than
notable. Second, the register is a record of **callsigns with a reason to
exist** — issued, reserved, released — never an enumeration of availability,
so its size must not be read as a count of what is in use or free.

**A bound worth stating**: "not held" dates from the 2016 system change, not
from always. Nine available-callsign lists spanning 2013-09 → 2016-01 *were*
served and are held (`archive/foi/wdtk-174341--available-callsigns-list`
through `wdtk-309076--available-callsigns-list`), and the 337399 letter itself
signposts a July 2016 list as historic. Any statement about availability must
therefore be dated: pre-2016 snapshots of the available pool exist; after
2016 they do not, because the underlying list ceased to.

**Evidence (cited, held):** the letters above, extracted verbatim beside the
originals in
[`archive/foi/ofcom-337399--all-callsigns-published-copy/`](../archive/foi/ofcom-337399--all-callsigns-published-copy/)
(requester-served copy under
[`archive/foi/wdtk-356636--all-callsigns-plus-forbidden/`](../archive/foi/wdtk-356636--all-callsigns-plus-forbidden/)),
[`archive/foi/ofcom-671462--suffix-availability-not-held/`](../archive/foi/ofcom-671462--suffix-availability-not-held/),
`archive/foi/ofcom-518689--suffix-availability-not-held/`,
`archive/foi/ofcom-632469--suffix-availability-not-held/`,
[`archive/foi/wdtk-1141667--issued-callsigns/correspondence.md`](../archive/foi/wdtk-1141667--issued-callsigns/correspondence.md)
and
[`archive/foi/wdtk-945167--available-full-callsigns-not-held/`](../archive/foi/wdtk-945167--available-full-callsigns-not-held/).
A further on-the-record statement to the same effect (internal review
01224257, 2021) is listed `pending-fetch` in
[`docs/source-register.md`](source-register.md) and is **not** relied on here.

**Status history:**

- 2026-07-29 — `refuted`, epistemics `[confirmed]`. Migrated from working
  notes, where the supporting references were recorded as "pin the exact
  references and wording before publishing". They are now pinned: five
  distinct Ofcom references (337399, 518689, 632469, 671462, 01842686) plus
  FOI 1562825, all held verbatim under `archive/foi/`, spanning 2016 → 2024.
  The pre-2016 bound was added on verification; the note did not carry it.
  Originally recorded 2026-07-13.

### H10a — Once a callsign is in the record it stays there, so a disappearance is an anomaly

**Status: `undeterminable`** &nbsp;·&nbsp; epistemics: **[hypothesis]**

The companion to H10, and the intended grounding for treating a callsign that
vanishes after appearing as notable rather than routine: if Ofcom retains a
record of every callsign it has ever had reason to record, a disappearance
cannot be a routine gap. **Undeterminable from the data and sources held —
and the reason it cannot be settled is the finding.**

Two obstacles, both concrete. **No held source states a retention policy**:
the refusals pinned in H10 establish what Ofcom does *not* hold, never that
what it does hold is never removed. And **the publications show removal at
scale**: 14,253 callsigns present in the `2025-11-11` publication are absent
from `2026-01-14` (159,677 → 146,218 distinct callsigns, against only 794
new).

That dropout also demonstrates why the two readings cannot be separated from
the copies held. **6,138 of the 14,253 — 43% — are callsigns ending in the
letter `Z`, and *no* callsign ending in `Z` survives in the `2026-01-14`
publication at all (6,138 → 0).** An entire terminal-letter class leaving
wholesale is not a licensing event; it is the export-shape anomaly already
recorded in
[`reports/column-drift.md`](../reports/column-drift.md) and on #564. So at
least part of publication-level disappearance is an artefact of the export,
which is exactly what a retention claim would need to be distinguished from.
Whether the remainder reflects Ofcom's record shrinking or a differently
scoped report cannot be told apart here; both readings fit.

The practical consequence is a narrowing, not an abandonment: a callsign
disappearing between publications stays worth **flagging** — but as an
unexplained divergence *between publications*, never as evidence about what
Ofcom retains. Flags, never verdicts.

**Evidence route (not yet run):** distinguishing the two readings needs a
statement from Ofcom on record retention, or an export whose scope is
declared precisely enough to attribute each disappearance. The dropout figures
above are re-runnable now — set-difference the callsign column of
[`archive/2025-11-11/normalised.csv`](../archive/2025-11-11/normalised.csv)
against
[`archive/2026-01-14/normalised.csv`](../archive/2026-01-14/normalised.csv) —
and the `Z`-cohort omission is folded mechanically into
[`reports/column-drift.md`](../reports/column-drift.md).

**Status history:**

- 2026-07-29 — `undeterminable`. Migrated at a **weaker status than the
  working note carried**: the note recorded the retention half as high
  confidence, domain-owner-stated. On verification no held Ofcom source
  states a retention policy, and the publications contradict a naive reading
  of persistence (14,253 dropouts across one vintage pair, 43% of them the
  `Z`-terminal cohort). The claim is retained because the *reason* it cannot
  be settled is itself worth recording. Originally recorded 2026-07-13.

---

## H11 — The register's two "reciprocal" licence strings name the same product

**Status: `refuted`** &nbsp;·&nbsp; epistemics: **[confirmed]**

Two similar strings for a licence granted on the strength of a foreign
qualification invite collapsing into one category. **Refuted against named
guidance**: they are distinct products, differing in duration, rights,
lifecycle and legal basis.

- **`Amateur Temporary Reciprocal Radio Licence`** — a short-term *visitor*
  authorisation for an amateur from a non-CEPT country with which the UK
  holds a bilateral reciprocal agreement. Time-limited and renewable, tied to
  the holder's home licence, and excluding Special Event Station callsigns.
  This is the visitor lane that CEPT T/R 61-01 otherwise covers for CEPT
  countries.
- **`Amateur Full (Reciprocal) Radio Licence`** — a substantive, ongoing UK
  **Full** licence with a UK callsign, granted to an amateur holding a
  recognised foreign qualification (typically a HAREC under CEPT T/R 61-02)
  who is UK-resident or has a permanent UK contact address. Not time-limited:
  the same Full licence a UK-examined amateur holds, entered through
  qualification recognition rather than a UK examination.

One is a temporary visitor permit; the other a full ongoing licence on
qualification recognition. They are consequently kept as **two** categories,
`Temporary Reciprocal` and `Full Reciprocal`, in
[`reference-data/licence-category.csv`](../reference-data/licence-category.csv),
with source fidelity preserved rather than the strings merged.

**Caveat — the mapping to the application form is inferred, not read.** The
`OfW346` application form is published image-encoded rather than as
machine-readable text, so the correspondence between these register strings
and the form's own fields is **inferred from Ofcom and RSGB guidance**, never
confirmed verbatim against the form. A further claim recorded with the
finding — that the temporary product is being wound down as short visits
become licence-exempt — is guidance-derived, **has not been checked here**,
and is not asserted by this entry, which is worth knowing because
[`reference-data/README.md`](../reference-data/README.md) states it
unqualified ("being phased out"). The distinctness of the two products does
not depend on it either way.

**How thinly the second product is witnessed** (established on verification,
and not part of the original note). Across the whole corpus the two strings
are **not co-witnessed in any single export**:
`Amateur Temporary Reciprocal Radio Licence` appears 1,620 times across 23
sources, including 100 rows of the current `2026-06-23` publication, whereas
`Amateur Full (Reciprocal) Radio Licence` appears in **exactly one source** —
15 rows of the 2016-09-29 disclosure's licence-class column — and in **no**
publication since. Keeping the categories separate is therefore right, but
the Full (Reciprocal) category presently rests on a single decade-old
witness. That is consistent with the product being rare, renamed, or no
longer separately reported; none of the three is chosen.

**Evidence (cited, external + re-runnable):** Ofcom's amateur licence
guidance for licensees and its introductory licensing guidance; RSGB's
visitor and overseas-operating guidance (T/R 61-01 versus T/R 61-02, HAREC) —
all named, none reproduced. The corpus counts are re-runnable: tabulate the
product / licence-class column of every `archive/*/normalised.csv` and
`archive/foi/*/normalised--*.csv` for values containing "Reciprocal". The
two-category outcome is committed in
[`reference-data/licence-category.csv`](../reference-data/licence-category.csv).

**Status history:**

- 2026-07-29 — `refuted`, epistemics `[confirmed]`. Migrated from research
  recorded 2026-07-09. The image-encoded-form caveat is carried across intact:
  the register-string-to-form-field mapping remains inferred from guidance.
  Added on verification: the two strings are never co-witnessed, and
  `Amateur Full (Reciprocal) Radio Licence` has exactly one witness in the
  whole corpus.

---

## H12 — The forbidden-suffix vocabulary dates from the August 2019 disclosure

**Status: `refuted`** &nbsp;·&nbsp; epistemics: **[confirmed]**

A trap once set by the reference data's own provenance.
[`reference-data/forbidden-suffixes.csv`](../reference-data/forbidden-suffixes.csv)
was distilled from an August 2019 disclosure and originally documented only
that vintage — from which it is natural, and wrong, to read August 2019 as
when the list came into force. **Refuted twice over.**

- **The vocabulary is identical three years earlier.** The September 2016
  disclosure and the August 2019 disclosure carry the **same 1,465-suffix
  set**, with zero set difference in either direction. A third witness, the
  September 2019 published register, agrees exactly.
- **Ofcom's own per-suffix timestamps date it earlier still.** The December
  2024 disclosure carries a `LastModifiedDate` column the earlier lists
  lacked, and **1,463 of its suffixes are stamped 2016-07-29** — earlier than
  the September 2016 disclosure that first exposed the list.

So 2016-07-29 is the earliest date Ofcom's own data attributes to the bulk of
the list, and 2016-09 the earliest date a *disclosure* attests it. Anything
before that is unknown: no earlier list is held, so **2016-07-29 is the
earliest defensible effective date, not a claimed origin**.

Why it matters operationally: a per-suffix "forbidden from" date is what makes
an "issued after the suffix became forbidden" reading possible at all, and
anchoring it at 2019-08 rather than 2016 would misdate every such reading by
three years. Any such inference additionally inherits the pre-1977
start-date caveat at **H6**.

**Evidence (re-runnable):** the committed golden
[`reports/forbidden-suffix-history.md`](../reports/forbidden-suffix-history.md),
regenerated from the committed FOI `forbidden-list` entries and gated by
`src/ci/forbidden-suffix-history-fold.test.ts`, which tabulates all four
disclosures with their distinct counts, duplicates and set diffs. The
underlying comparison can be run directly: sort the unique suffixes of
[`archive/foi/wdtk-356636--all-callsigns-plus-forbidden/normalised--sheet-2-forbidden-suffixes.csv`](../archive/foi/wdtk-356636--all-callsigns-plus-forbidden/normalised--sheet-2-forbidden-suffixes.csv)
(2016-09) against
[`archive/foi/wdtk-596532--allocated-reserved-forbidden/normalised--sheet-2-forbidden-call-signs.csv`](../archive/foi/wdtk-596532--allocated-reserved-forbidden/normalised--sheet-2-forbidden-call-signs.csv)
(2019-08) and diff both ways — 1,465 distinct each, empty difference. The
2016-07-29 stamps are in
[`archive/foi/ofcom-2024-12--forbidden-suffixes/normalised--forbidden-amateur-radio-callsigns.csv`](../archive/foi/ofcom-2024-12--forbidden-suffixes/normalised--forbidden-amateur-radio-callsigns.csv).

**Status history:**

- 2026-07-29 — `refuted`, epistemics `[confirmed]`. Verified against the
  corpus as it stands: 1,465 distinct suffixes in each of the 2016 and 2019
  sources, empty set difference both ways. Two figures recorded on migration
  because they have **moved since the finding was made**:
  `reference-data/forbidden-suffixes.csv` is no longer the 2019 snapshot the
  comparison was originally run against but the ever-forbidden **union**
  (header `suffix,first_known_forbidden`, **1,466** rows, verified to equal
  the 2016 set plus `JIZ` exactly), so the 2019 vocabulary must now be read
  from the `wdtk-596532` disclosure named above. And the trap itself is
  **closed**: [`reference-data/README.md`](../reference-data/README.md) now
  documents the union basis, all four disclosures and the `2016-07-29` bulk
  origin, so the misdating this entry guards against is no longer invited by
  the file's own documentation. The entry stays as the record of the claim.
- 2026-07-13 — **correction of an earlier over-claim, recorded rather than
  erased.** The two files had been reported as "byte-for-byte identical".
  That was wrong, and a filtered, sorted set comparison had been mistaken for
  a byte comparison. The accurate finding is **same set, different bytes**:
  the 2016 sheet uses LF line endings where the reference table uses CRLF,
  and the 2016 sheet carries a **duplicated `ZIT` row** — 1,466 rows for
  1,465 distinct suffixes, `ZIT` being on both lists, so the duplicate is a
  data-quality artefact of the 2016 disclosure and not an extra suffix. All
  three details re-verified 2026-07-29 and surfaced in the report's
  `duplicated` column, never silently deduplicated.

### H12a — The forbidden-suffix vocabulary is fixed

**Status: `refuted`** &nbsp;·&nbsp; epistemics: **[derived]**

The tempting corollary of H12's three-year invariance: that the list, once
set, does not move. **It does.** Stability 2016 → 2019 holds, but by the
December 2024 disclosure the vocabulary has changed: **`JIZ` added**
(`LastModifiedDate` 2020-12-10, the one post-2016 change carrying a date) and
**`QNF` and `ZFJ` removed** — both present in 2016 *and* 2019, absent in
2024, with no date, removals leaving no stamp behind. Net 1,465 → 1,464.

Two consequences. A per-suffix date is load-bearing rather than decorative: a
callsign carrying `JIZ` and issued before 2020-12-10 did not contradict the
list of its day. And the distilled reference table is deliberately the
**ever-forbidden union** (1,466 suffixes, `QNF` and `ZFJ` retained at
`2016-09`, `JIZ` at `2020-12-10`) rather than any single snapshot, so it
survives churn and de-listing instead of ageing into a stale copy.

The `QNF`/`ZFJ` de-listing is **flagged, not explained**. A working reading is
that the removal is an artefact rather than a deliberate policy change, and
the union retains them on that basis; that reading is not established.

**Evidence (re-runnable):** the per-disclosure diff rows and the
first-known-forbidden distribution in
[`reports/forbidden-suffix-history.md`](../reports/forbidden-suffix-history.md)
(fold gated by `src/ci/forbidden-suffix-history-fold.test.ts`); the union
itself in
[`reference-data/forbidden-suffixes.csv`](../reference-data/forbidden-suffixes.csv),
verified 2026-07-29 to carry 1,466 rows including `JIZ,2020-12-10`,
`QNF,2016-09` and `ZFJ,2016-09`.

**Status history:**

- 2026-07-29 — `refuted`. Migrated and re-verified against the committed
  union and report: `JIZ` added 2020-12-10; `QNF` and `ZFJ` present 2016 and
  2019, absent 2024. Originally established 2026-07-13.

---

## H13 — The 2021 annex's `#REF!` corruption was introduced downstream of Ofcom

**Status: `refuted`** &nbsp;·&nbsp; epistemics: **[confirmed]**

The first question to ask of a published spreadsheet carrying broken formula
errors where callsigns should be: is the damage ours? **Refuted — the file was
published already corrupt**, and the finding is recorded here in claim form
because the archived-source side is documented separately in
[`docs/source-register.md`](source-register.md).

The decisive step was an **independent second witness**. The asset URL,
recovered from web-archive index queries, resolves to two independently
captured copies of the same 2021-01 annex — a UK Government Web Archive
memento and an Internet Archive capture — and **both carry the same broken
call-sign cells**. Two archives capturing identical corruption is evidence
about what Ofcom served, not about any later handling of it. The live asset
URL is additionally a genuine 404 (an HTML not-found page, not an access
block) following a publisher site redesign, so no clean re-fetch of that asset
is possible: there is nothing cleaner upstream to fetch.

A **clean same-vintage alternative is already held** by a different disclosure
route: the 2021-01 FOI annex
[`archive/foi/ofcom-2021-01--all-callsigns/`](../archive/foi/ofcom-2021-01--all-callsigns/)
carries zero error cells over a wider six-column shape. The corrupt asset is
therefore kept as the divergent copy it is — errors preserved verbatim and
flagged `spreadsheet-error-token`, never repaired or substituted — while the
clean twin stands as the faithful record of the vintage. Corruption at source
is itself the useful finding.

**Evidence (re-runnable, held):** the two-witness comparison and the 404 are
recorded in
[`archive/foi/ofcom-210648--corrupt-annex-callsigns/correspondence.md`](../archive/foi/ofcom-210648--corrupt-annex-callsigns/correspondence.md)
with the affected cells enumerated in that entry's `meta.json`
`divergences[]`. The counts are re-runnable now: the committed parse source
`archive/foi/ofcom-210648--corrupt-annex-callsigns/normalised--sheet-1-sheet1.csv`
carries the error token in **14 rows** where a call sign should be, against
**zero** in the clean twin's
`normalised--sheet-1-callsigns.csv`.

**Status history:**

- 2026-07-29 — `refuted`, epistemics `[confirmed]`. Recorded in claim form on
  migration; the source-side facts were already public in the source register
  and are not duplicated. Figure reconciled on verification: the note being
  migrated counted 42 error tokens in the workbook (each broken cell holding
  a two-operand formula plus its rendered value), whereas the committed parse
  source carries **14** — one per affected row. Both describe the same
  fourteen cells; the surface counted differs, and the committed extract is
  the figure a reader can reproduce. Originally established 2026-07-15.

---

## H14 — A publication declaring complete coverage contains every record Ofcom held

**Status: `refuted`** &nbsp;·&nbsp; epistemics: **[derived]**

The assumption that makes absence usable as evidence: if a publication
declares complete coverage, a callsign missing from it was not on the
register. **Refuted for at least one publication**, and the consequence is
that `intendedCoverage.complete` must always be read as **declared intent,
never verified fact**.

The `2025-06-04` publication declares `"intendedCoverage": {"complete": true}`
in its `meta.json` and carries **112,650 records with not one blank product
field**, where the neighbouring `2025-04-08` publication carries 157,427
records of which **45,157 have a blank product**. The records that survive
line up closely across the pair, status by status — Allocated with a product
101,875 → 102,213, Reserved 10,134 → 10,177, Available 248 → 246 — which is
the shape of *one class of record being dropped*, not of a register that
shrank by a third in eight weeks.

**The omission is not confined to the reserved pool.** In the neighbouring
vintage the blank-product records include **2,752 `Allocated`** and **263
`Available`** rows alongside 42,141 `Reserved`. A blank product field is
common on live allocations, so treating "blank product" as "never licensed"
is a false equivalence, and records omitted on that basis include live
allocations. `M2IBX` (**H9**) is one such casualty.

**Three epistemic layers, not two**, follow for any absence argument:
declared-partial publications, where absence carries no information at all;
declared-complete-but-demonstrably-filtered, where absence of a blank-product
callsign is weak evidence at best; and genuinely complete. Scope-aware
analysis may treat absence in an intended-complete publication as evidence —
the right default — but only carrying the declared-not-verified caveat.

**Flags, never verdicts.** Candidate mechanisms are offered and **none is
chosen**: an export filter on the product field; a differently scoped report
run against the same system; a join that drops productless rows. Nothing here
adjudicates the publisher's intent, and no motive is imputed.

**Two bounds on the finding.** The publication's bytes carry
`"provenance": "reconstructed-from-git-history"` rather than a captured live
fetch, so "as published" rests on that reconstruction; the reconstructed
`raw.csv` does already carry the 112,650-record shape, placing the omission
upstream of this project's normalisation rather than in it. And the two other
zero-blank-product publications (`2025-05-27`, `2025-06-08`) are a **separate,
already-documented case** — the 1,074-row truncation and its byte-twin — not
further instances of this one.

**Evidence (re-runnable):** the coverage declaration and a dated
`qualityObservations` entry are committed in
[`archive/2025-06-04/meta.json`](../archive/2025-06-04/meta.json); the
per-publication figures are in each `archive/*/stats.json` as
`columns.product.empty` against `recordCount`; the status-by-status
reconciliation is a cross-tabulation of the `status` and `product` columns of
[`archive/2025-06-04/normalised.csv`](../archive/2025-06-04/normalised.csv)
and [`archive/2025-04-08/normalised.csv`](../archive/2025-04-08/normalised.csv).
The blank-share shift is also folded mechanically into
[`reports/column-drift.md`](../reports/column-drift.md). Tracked on #177.

**Status history:**

- 2026-07-29 — `refuted`. Migrated from a finding recorded 2026-07-09 and
  re-verified end to end against the corpus as it stands: the coverage
  declaration, the 112,650 / 157,427 record counts, the 45,157 blank-product
  rows in the neighbouring vintage, the per-status reconciliation, and the
  2,752 Allocated + 263 Available rows in the omitted class. The
  reconstructed-provenance bound was added on verification; the note did not
  carry it.

### H14a — Comparing blank-product counts across publications identifies which of them omitted those records

**Status: `validated`** (for the open-data lane) &nbsp;·&nbsp; epistemics: **[derived]**

The detection method proposed alongside H14: rather than inspecting
publications one at a time, compare `columns.product.empty` against
`recordCount` across every `archive/*/stats.json` — a publication whose
blank-product count collapses to near zero while its neighbours carry
thousands is a filter suspect. **Run across the nine open-data snapshots, the
comparison discriminates**, isolating `2025-06-04` (0 blanks against 45,157
next door) and correctly leaving the intended-blank cases alone: `2022-05-30`
has no product data at all rather than a filtered column, and the two
1,074-row publications are the separately documented truncation.

**It yields suspects, not verdicts, and its scope is narrow.** Three limits,
all named.

- Separating "omitted" from "differently scoped" needed the per-status
  reconciliation done by hand in H14; the count comparison alone cannot do it.
  A declared issued-scope export legitimately carries no blank-product rows —
  `wdtk-1141667` is exactly that — and would show up as a suspect.
- It has been run over the **open-data lane only**. The FOI entries do not
  carry the same `stats.json` shape, so the corpus-wide sweep is not done.
- **No standing detector attributes filtering to a publication.**
  [`reports/column-drift.md`](../reports/column-drift.md) flags the
  blank-share shift at the boundaries of the zero-blank run (28.7% → 0.0%,
  then 0.0% → 26.9%) but, because the 1,074-row truncation sits
  chronologically between them, its consecutive-pair comparison never
  attributes the omission to `2025-06-04` itself. Mechanising that attribution
  is the outstanding work.

**Evidence (re-runnable):** tabulate `recordCount` and
`columns.product.empty` from every `archive/*/stats.json`; the discriminating
figures are 45,157 blanks of 157,427 records (`2025-04-08`) and 0 of 112,650
(`2025-06-04`), with `2025-11-11` at 42,956 of 159,895 and `2026-06-23` at
40,160 of 158,318 either side of the run. Tracked on #177.

**Status history:**

- 2026-07-29 — `validated` for the open-data lane. **Migrated at a stronger
  status than the working note carried**: the note recorded this as a
  candidate method not yet run, and it was run during migration, so recording
  it as untested would misstate the record. Scope bounded explicitly — the
  FOI lane is not swept, filter-versus-scope still needs the per-status
  reconciliation, and no standing detector performs the attribution.
  Originally proposed 2026-07-09.
