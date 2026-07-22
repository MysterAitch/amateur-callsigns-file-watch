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
  under its stricter exclusions — BST-transition margins and multi-valued
  subjects excluded), corroborates it at minute precision (47,205 summer
  records of `wdtk-1141667` and `2025-06-04` agree to the exact minute), and
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
them (204–629 boundary subjects per pair, zero contrary). From the
**2024-10-21** copy onwards the same boundary-window stamps AGREE in both
midnight-offset windows — those copies render **UTC** days, as do all the
datetime-bearing 2025 vintages (which agree with the proven-UTC `wdtk-1141667`
workbook to the exact minute across ~47k summer records). Somewhere between
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

**Evidence (re-runnable):** the committed golden
[`reports/sequence-analytics.md`](../reports/sequence-analytics.md), regenerated
by the fold `src/ci/sequence-analytics.ts` (`node src/ci/sequence-analytics.ts`)
over the S1 allocation-time event claims (`licence-issued`, the earliest-surviving
original-start kinds) and gated byte-for-byte by
`src/ci/sequence-analytics-corpus.test.ts`. The per-series ρ, gap structure,
issuance-rate curves and projection are all folded from the claim ledger.

**Status history:**

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
