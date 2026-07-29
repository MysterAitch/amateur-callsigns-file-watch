# State-at-t reconstruction (bi-temporal)

The state-at-t inference engine (issue #725, S3): given the event-time
claims (S1) and the coherency picture over them (S2), what can the mirror
honestly say about a callsign at an arbitrary date t? Every answer is
**inferred** in the issue #723 trichotomy — the ACTUAL state is Ofcom’s
own, in principle unknowable from outside; the DECLARED evidence is each
vintage’s dated cells (the S1 claims, each wearing its asserting source
and vintage); an INFERRED answer is a derivation of ours, always naming
the asserting vintages and always conservative. Answers are parameterised
by BOTH temporal axes: event-time t, and an optional assertion-time
ceiling ("as asserted by vintages up to v") — a 2026 vintage’s claim
about 1952 is evidence FROM 2026, and issue #800’s forward-only creep
means a later vintage can carry LESS early history than an earlier one.
Where vintages disagree, the answer surfaces the disagreement and
resolves nothing (issue #467). Absence of evidence is NON-OBSERVATION:
it never reads as "was available", "nothing happened", or "did not
exist", and a query outside coverage returns an explicit cannot-infer.

The engine is `deriveStateAtT` / `stateAtT` (src/ci/state-at-t.ts) — the
mechanism the issue #726 reader-facing surfaces will call. This report is
the engine demonstrated over the real corpus: regenerated and committed,
so a new vintage shifting any answer shows up as a PR diff. No state
answer is ever stored as a ledger claim — answers are read-time
derivations, re-runnable from the ledger alone.

## Inference rules

Every finding names exactly one rule (used only with these meanings):

- **no-evidence-for-subject** — no event-time claim for this subject exists in the consulted corpus at all — outside coverage: an explicit cannot-infer, never "did not exist" or "was available"
- **licence-start-on-or-before-t** — at least one consulted vintage asserts a licence(-version) start or issue date on or before t — evidence a licence had started by t, as asserted by the named vintages; for the version-scoped kinds the date is only the earliest start SURVIVING in the asserting vintage, so the true first start may be earlier still
- **consistent-with-licence-in-force-at-t** — start evidence on or before t, with no cancellation evidence dated on or after that start and on or before t (a cancellation dated on the start day itself is treated as addressing that start) — CONSISTENT WITH a licence being in force at t, never proof: absence of a cancellation claim is non-observation (cancellation dates are sparsely attested in the held corpus), and a licence can end without any held dataset recording a dated end; the finding inherits the earliest-surviving/pre-1977 unreliability of the start it rests on, so it stays honest rendered alone
- **licence-cancelled-on-or-before-t** — a consulted vintage asserts a licence cancellation date on or before t — evidence a licence had been cancelled by then
- **cancelled-with-no-later-start-evidence-by-t** — the latest cancellation evidence on or before t post-dates every consulted start assertion on or before t — evidence the then-licence had been cancelled by t with no surviving evidence of a later start by t; NOT evidence the callsign was available at t (non-observation of a later grant is not absence of one)
- **reservation-window-consistent-with-covering-t** — a reservation window whose stated end is on or after t was asserted by a vintage collected on or before t — consistent with a reservation covering t; the source column carries three cohort meanings (planned close / retrospective termination / anomaly), so this is a conservative reading of the stated window bound, never a status claim
- **reservation-window-start-unattested** — a reservation window end on or after t is asserted, but only by vintages not proven to precede t — the window’s START is nowhere attested, so whether the reservation had begun by t cannot be inferred
- **reservation-window-stated-ended-by-t** — every asserted reservation window end precedes t — the stated window had ended by t on the asserting vintage’s reading; on the Available-status cohort the same cell records a retrospective termination, and neither reading says what the callsign’s state at t was
- **record-in-system-on-or-before-t** — the publisher’s record bookkeeping (created / last-modified stamps) dates on or before t — a statement about the record’s presence in the export system by t, never a licensing event; a stamp inside a detected mass-update episode largely records the system episode (for pre-2016 records, the migration into the current system), not a per-record happening
- **no-licensing-evidence-on-or-before-t** — no consulted vintage asserts any licensing event (start, cancellation, reservation bound) dated on or before t — non-observation: the corpus cannot say what the callsign’s state at t was, and this NEVER reads as "the callsign did not exist" or "was available"

## Caveats

Findings carry caveats by id (each used only with this meaning):

- **earliest-surviving** — a version-scoped start date is the earliest start SURVIVING in the asserting vintage, not "the true original": rolling retention and reissues drop or replace older rows, so earlier starts may have existed and left no surviving trace
- **pre-1977** — original start dates before 1977 are attested-unreliable (OARC, citing an administrative glitch by the then regulator)
- **availability-trap** — absence of evidence is non-observation, never "was available" or "did not exist": event-time coverage is only as complete as what sources attested
- **cancellation-sparsity** — cancellation dates are attested by very few held vintages (see the per-kind coverage table), so "no cancellation evidence" is weak: a cancellation may simply be unrecorded in what is held
- **reserved-cohort-ambiguity** — the reserved-until column carries three meanings by cohort (a planned close on Reserved rows, a retrospective termination record on Available rows, and an undecidable anomaly) — the engine reads only the stated window bound, never a status
- **window-restated** — the consulted vintages state more than one reservation window end — renewal/termination bookkeeping is routine for this column; every stated end appears in the evidence table
- **mass-episode-window** — at least one supporting date falls inside a detected mass-update episode window: tens of thousands of identical stamps record ONE system episode, not per-record events
- **month-precision-vintage** — at least one asserting vintage is keyed by month, not day — its assertion time carries month precision, and every comparison against it treats the whole month conservatively
- **vintages-disagree** — the consulted vintages disagree on this fact — the disagreement is surfaced in the answer’s disagreements list and resolved nowhere

## How each event kind contributes

The authored contribution registry — total over the S1 kind vocabulary,
so a new kind cannot silently join (or silently skip) the state reading.
Bookkeeping kinds NEVER feed a licensing inference: inside a detected
mass-update episode (the **mass-episode-window** caveat above) their
stamps record one system episode, not per-record licensing events, and
even outside an episode they attest only the record’s presence in the
publisher’s system.

| event kind | contribution | reading |
|---|---|---|
| `record-created` | system-presence | system presence of the register record, never a licensing event |
| `record-last-modified` | system-presence | system presence of the register record, never a licensing event |
| `licence-version-last-modified` | system-presence | system presence of the register record, never a licensing event |
| `licence-version-original-start` | licence-start | licence-start evidence; earliest SURVIVING start only, pre-1977 unreliability (the **earliest-surviving** and **pre-1977** caveats above) |
| `licence-issued` | licence-start | licence-start evidence |
| `licence-cancelled` | licence-end | cancellation evidence (sparsely attested — see coverage) |
| `reserved-until` | reservation-end | stated window bound only; three cohort meanings, never a status |
| `licence-created` | system-presence | system presence of the licence RECORD (Salesforce-era stamp), never the grant |
| `licence-last-modified` | system-presence | system presence of the register record, never a licensing event |
| `licence-original-start` | licence-start | licence-start evidence; earliest SURVIVING start only, pre-1977 unreliability (the **earliest-surviving** and **pre-1977** caveats above) |

## Coverage honesty

What fraction of the corpus a state query can even address. The subject
universe below counts DISTINCT cleaned subjects across EVERY claim in the
ledger — deliberately broad (it includes non-callsign subject families
such as forbidden suffixes), an honest over-count preferred to an
invented classifier — so the addressable shares are, if anything,
understated.

- Cleaned subjects in the ledger: 193,092
- …with at least one event-time claim: 166,683 (86.3%)
- …with at least one LICENSING-evidence claim (start / cancellation / reservation bound): 129,875 (67.3%)

Per-kind coverage — the vintages that attest each kind at all, and the
asserted-day span they cover. A kind absent from a period cannot support
any inference there: in particular, cancellation evidence is confined to
the vintages below, which is why "no cancellation evidence" is always a
weak, caveated absence.

| event kind | contribution | datasets | subjects | claims | asserted-day span | asserting vintages |
|---|---|---:|---:|---:|---|---|
| `licence-cancelled` | licence-end | 1 | 7,397 | 7,397 | 1932-01-26 → 2020-10-06 | 2020-10-23 |
| `licence-created` | system-presence | 1 | 103,504 | 103,718 | 2019-02-13 → 2024-10-17 | 2024-10 |
| `licence-issued` | licence-start | 2 | 103,901 | 207,806 | 1903-05-03 → 2019-08-10 | 2019-08-12, 2019-09-12 |
| `licence-last-modified` | system-presence | 1 | 105,518 | 105,518 | 2020-10-15 → 2025-09-11 | 2025-09-11 |
| `licence-original-start` | licence-start | 2 | 105,849 | 209,236 | 1903-05-03 → 2025-09-11 | 2024-10, 2025-09-11 |
| `licence-version-last-modified` | system-presence | 3 | 108,112 | 307,203 | 2017-01-27 → 2026-06-11 | 2025-11-11, 2026-01-14, 2026-06-23 |
| `licence-version-original-start` | licence-start | 5 | 112,438 | 500,233 | 1903-05-03 → 2026-06-11 | 2021-01-29, 2021-04-21, 2025-11-11, 2026-01-14, 2026-06-23 |
| `record-created` | system-presence | 7 | 161,756 | 639,970 | 2016-07-23 → 2025-06-03 | 2020-10-23, 2024-09, 2025-03-13, 2025-04-08, 2025-05-27, 2025-06-04, 2025-06-08 |
| `record-last-modified` | system-presence | 15 | 157,823 | 1,731,482 | 2016-07-23 → 2025-06-03 | 2020-10-23, 2023-01-25, 2023-02-20, 2023-08-18, 2023-11-24, 2023-12-07, 2024-01, 2024-07, 2024-07-22, 2024-10-21, 2025-03-13, 2025-04-08, 2025-05-27, 2025-06-04, 2025-06-08 |
| `reserved-until` | reservation-end | 5 | 4,369 | 5,257 | 2016-01-04 → 2099-12-31 | 2020-10-23, 2021-01-29, 2021-04-21, 2024-09, 2024-10 |

## Mass-update episode windows consulted

The S2 detector’s episode windows (parameters: window ≤
21 days, share > 50.0%, minimum 1,000 populated dates
— see reports/event-time-coherency.md for the full witness tables).
Evidence lines whose day falls inside a window are annotated in every
answer, so a bookkeeping stamp never masquerades as a per-record event.

- Episode 1: 2016-07-23 → 2016-08-12 (13 witness signals)
- Episode 2: 2025-10-11 → 2025-10-30 (3 witness signals)

## Worked examples

Authored ground-truth scenarios, run live through the engine over the
real corpus at report-build time — the committed answers ARE the
engine’s output, so any drift in the corpus or the rules shows here.

### A rich event history, whole corpus: G3ATI at 1960-06-01

G3ATI is issue #800’s mechanism-A exemplar: a 1952-10-10 licence-version row
survives in the 2025-11-11 open-data vintage but is absent from the 2021
register annexes and from 2026-06-23. Consulting the whole corpus, the 1952
start is on the record, so a start on or before 1960-06-01 is asserted —
and the per-dataset earliest starts disagree, which the answer surfaces
without resolving.

Query: state of `G3ATI` at t = 1960-06-01, consulting the whole corpus.

Vintages consulted: 2019-08-12, 2019-09-12, 2021-01-29, 2021-04-21, 2023-01-25, 2023-02-20, 2023-08-18, 2023-11-24, 2023-12-07, 2024-01, 2024-07, 2024-07-22, 2024-09, 2024-10, 2024-10-21, 2025-03-13, 2025-04-08, 2025-06-04, 2025-09-11, 2025-11-11, 2026-01-14, 2026-06-23.

Bounding assertions: latest on or before t: `licence-original-start` 1952-10-10, `licence-version-original-start` 1952-10-10; earliest after t: `licence-issued` 2015-02-07, `licence-original-start` 2015-02-07, `licence-version-original-start` 2015-02-07.

Findings (every finding is **[inferred]** — issue #723):

- **licence-start-on-or-before-t** — a licence(-version) start dated 1952-10-10 is asserted on or before 1960-06-01. Asserting vintages: 2024-10, 2025-11-11, 2026-01-14. Caveats: earliest-surviving, pre-1977, vintages-disagree, month-precision-vintage.
- **consistent-with-licence-in-force-at-t** — start evidence dated 1952-10-10 with no cancellation evidence dated in [1952-10-10, 1960-06-01] among the consulted claims — consistent with a licence being in force at 1960-06-01, never proof. Asserting vintages: 2024-10, 2025-11-11, 2026-01-14. Caveats: earliest-surviving, pre-1977, cancellation-sparsity, availability-trap, month-precision-vintage.

Vintage disagreements (surfaced, never resolved — issue #467):

- `licence-original-start` (earliest-asserted): 1952-10-10 per `wdtk-1180568--licence-breakdown-duration-age` (2024-10) vs 2015-02-07 per `ofcom-2025-09-11--callsigns--all-callsigns` (2025-09-11)
- `licence-version-original-start` (earliest-asserted): 1952-10-10 per `2025-11-11` (2025-11-11), `2026-01-14` (2026-01-14) vs 2015-02-07 per `ofcom-2021-01--all-callsigns` (2021-01-29), `ofcom-2021-04--all-callsigns` (2021-04-21), `2026-06-23` (2026-06-23)

Evidence:

| event kind | contribution | event day | relation to t | asserted by | episode window |
|---|---|---|---|---|---|
| `licence-original-start` | licence-start | 1952-10-10 | on-or-before-t | `wdtk-1180568--licence-breakdown-duration-age` (2024-10) | — |
| `licence-version-original-start` | licence-start | 1952-10-10 | on-or-before-t | `2025-11-11` (2025-11-11); `2026-01-14` (2026-01-14) | — |
| `licence-issued` | licence-start | 2015-02-07 | after-t | `wdtk-596532--allocated-reserved-forbidden` (2019-08-12); `ofcom-756622--published-register-csv` (2019-09-12) | — |
| `licence-original-start` | licence-start | 2015-02-07 | after-t | `wdtk-1180568--licence-breakdown-duration-age` (2024-10); `ofcom-2025-09-11--callsigns--all-callsigns` (2025-09-11) | — |
| `licence-version-original-start` | licence-start | 2015-02-07 | after-t | `ofcom-2021-01--all-callsigns` (2021-01-29); `ofcom-2021-04--all-callsigns` (2021-04-21); `2025-11-11` (2025-11-11); `2026-01-14` (2026-01-14); `2026-06-23` (2026-06-23) | — |
| `record-created` | system-presence | 2016-07-23 | after-t | `ofcom-2024-09--every-radio-callsign--all-callsigns` (2024-09); `ofcom-2025-03-13--callsigns--all-callsigns` (2025-03-13); `2025-04-08` (2025-04-08); `2025-06-04` (2025-06-04) | 2016-07-23 → 2016-08-12 |
| `record-last-modified` | system-presence | 2016-08-12 | after-t | `ofcom-2023-01-25--call-sign-list-with-status--all-callsigns` (2023-01-25); `2023-02-20` (2023-02-20); `ofcom-2023-08-18--call-sign-list--all-callsigns` (2023-08-18); `ofcom-2023-11-24--call-sign-list--all-callsigns` (2023-11-24); `ofcom-2023-12-07--open-data-call-sign-list--all-callsigns` (2023-12-07); `ofcom-2024-01--foi-1734722--all-callsigns` (2024-01) | 2016-07-23 → 2016-08-12 |
| `licence-created` | system-presence | 2024-03-09 | after-t | `wdtk-1180568--licence-breakdown-duration-age` (2024-10) | — |
| `licence-last-modified` | system-presence | 2024-03-09 | after-t | `ofcom-2025-09-11--callsigns--all-callsigns` (2025-09-11) | — |
| `record-last-modified` | system-presence | 2024-03-09 | after-t | `ofcom-2024-07--call-signs--all-callsigns` (2024-07); `wdtk-1141667--issued-callsigns` (2024-07-22) | — |
| `licence-created` | system-presence | 2024-08-19 | after-t | `wdtk-1180568--licence-breakdown-duration-age` (2024-10) | — |
| `record-last-modified` | system-presence | 2024-08-19 | after-t | `ofcom-2024-10-21--callsigns--all-callsigns` (2024-10-21); `ofcom-2025-03-13--callsigns--all-callsigns` (2025-03-13); `2025-04-08` (2025-04-08); `2025-06-04` (2025-06-04) | — |
| `licence-version-last-modified` | system-presence | 2025-10-11 | after-t | `2025-11-11` (2025-11-11, 2 rows); `2026-01-14` (2026-01-14, 2 rows); `2026-06-23` (2026-06-23) | 2025-10-11 → 2025-10-30 |

### The same question under a 2021 assertion ceiling: G3ATI at 1960-06-01, as asserted by 2021

The bi-temporal crux: restricted to vintages proven on or before 2021-12-31,
the earliest surviving start assertion is 2015-02-07 — AFTER t — so the same
event-time question honestly cannot be answered. Issue #800’s forward-only
creep means later vintages can carry LESS early history than earlier ones;
here the 1952 evidence only enters the record with the 2025-11-11 vintage,
so widening the ceiling surfaces evidence the narrow ceiling lacked.

Query: state of `G3ATI` at t = 1960-06-01, consulting only vintages proven on or before 2021-12-31.

Vintages consulted: 2019-08-12, 2019-09-12, 2021-01-29, 2021-04-21. Excluded by the ceiling: 2023-01-25, 2023-02-20, 2023-08-18, 2023-11-24, 2023-12-07, 2024-01, 2024-07, 2024-07-22, 2024-09, 2024-10, 2024-10-21, 2025-03-13, 2025-04-08, 2025-06-04, 2025-09-11, 2025-11-11, 2026-01-14, 2026-06-23.

Bounding assertions: none on or before t; earliest after t: `licence-issued` 2015-02-07, `licence-version-original-start` 2015-02-07.

Findings (every finding is **[inferred]** — issue #723):

- **no-licensing-evidence-on-or-before-t** — no licensing-evidence claim (start, cancellation, reservation bound) is dated on or before 1960-06-01 — the subject’s earliest dated evidence is 2015-02-07, after 1960-06-01; the state at 1960-06-01 cannot be inferred, and this never reads as "did not exist" or "was available". Asserting vintages: 2019-08-12, 2019-09-12, 2021-01-29, 2021-04-21. Caveats: availability-trap.

Evidence:

| event kind | contribution | event day | relation to t | asserted by | episode window |
|---|---|---|---|---|---|
| `licence-issued` | licence-start | 2015-02-07 | after-t | `wdtk-596532--allocated-reserved-forbidden` (2019-08-12); `ofcom-756622--published-register-csv` (2019-09-12) | — |
| `licence-version-original-start` | licence-start | 2015-02-07 | after-t | `ofcom-2021-01--all-callsigns` (2021-01-29); `ofcom-2021-04--all-callsigns` (2021-04-21) | — |

### A vintage disagreement, surfaced not resolved: G3SDS at 2000-01-01

G3SDS is issue #800’s mechanism-B exemplar: four version-scoped vintages
assert an original start of 1977-07-09, and the 2026-06-23 vintage asserts
2026-02-23 — a wholesale sole-row replacement. At t = 2000-01-01 the 1977
assertions support a start on or before t while the 2026 assertion does
not; the answer lists both camps by vintage and adjudicates neither.

Query: state of `G3SDS` at t = 2000-01-01, consulting the whole corpus.

Vintages consulted: 2019-08-12, 2019-09-12, 2021-01-29, 2021-04-21, 2023-01-25, 2023-02-20, 2023-08-18, 2023-11-24, 2023-12-07, 2024-01, 2024-07, 2024-07-22, 2024-09, 2024-10, 2024-10-21, 2025-03-13, 2025-04-08, 2025-06-04, 2025-09-11, 2025-11-11, 2026-01-14, 2026-06-23.

Bounding assertions: latest on or before t: `licence-issued` 1977-07-09, `licence-original-start` 1977-07-09, `licence-version-original-start` 1977-07-09; earliest after t: `record-created` 2016-07-23.

Findings (every finding is **[inferred]** — issue #723):

- **licence-start-on-or-before-t** — a licence(-version) start dated 1977-07-09 is asserted on or before 2000-01-01. Asserting vintages: 2019-08-12, 2019-09-12, 2021-01-29, 2021-04-21, 2024-10, 2025-09-11, 2025-11-11, 2026-01-14. Caveats: earliest-surviving, vintages-disagree, month-precision-vintage.
- **consistent-with-licence-in-force-at-t** — start evidence dated 1977-07-09 with no cancellation evidence dated in [1977-07-09, 2000-01-01] among the consulted claims — consistent with a licence being in force at 2000-01-01, never proof. Asserting vintages: 2019-08-12, 2019-09-12, 2021-01-29, 2021-04-21, 2024-10, 2025-09-11, 2025-11-11, 2026-01-14. Caveats: earliest-surviving, cancellation-sparsity, availability-trap, month-precision-vintage.

Vintage disagreements (surfaced, never resolved — issue #467):

- `licence-version-original-start` (earliest-asserted): 1977-07-09 per `ofcom-2021-01--all-callsigns` (2021-01-29), `ofcom-2021-04--all-callsigns` (2021-04-21), `2025-11-11` (2025-11-11), `2026-01-14` (2026-01-14) vs 2026-02-23 per `2026-06-23` (2026-06-23)

Evidence:

| event kind | contribution | event day | relation to t | asserted by | episode window |
|---|---|---|---|---|---|
| `licence-issued` | licence-start | 1977-07-09 | on-or-before-t | `wdtk-596532--allocated-reserved-forbidden` (2019-08-12); `ofcom-756622--published-register-csv` (2019-09-12) | — |
| `licence-original-start` | licence-start | 1977-07-09 | on-or-before-t | `wdtk-1180568--licence-breakdown-duration-age` (2024-10); `ofcom-2025-09-11--callsigns--all-callsigns` (2025-09-11) | — |
| `licence-version-original-start` | licence-start | 1977-07-09 | on-or-before-t | `ofcom-2021-01--all-callsigns` (2021-01-29); `ofcom-2021-04--all-callsigns` (2021-04-21); `2025-11-11` (2025-11-11); `2026-01-14` (2026-01-14) | — |
| `record-created` | system-presence | 2016-07-23 | after-t | `ofcom-2024-09--every-radio-callsign--all-callsigns` (2024-09); `ofcom-2025-03-13--callsigns--all-callsigns` (2025-03-13); `2025-04-08` (2025-04-08); `2025-06-04` (2025-06-04) | 2016-07-23 → 2016-08-12 |
| `record-last-modified` | system-presence | 2016-10-28 | after-t | `ofcom-2023-01-25--call-sign-list-with-status--all-callsigns` (2023-01-25); `2023-02-20` (2023-02-20); `ofcom-2023-08-18--call-sign-list--all-callsigns` (2023-08-18); `ofcom-2023-11-24--call-sign-list--all-callsigns` (2023-11-24); `ofcom-2023-12-07--open-data-call-sign-list--all-callsigns` (2023-12-07); `ofcom-2024-01--foi-1734722--all-callsigns` (2024-01) | — |
| `licence-created` | system-presence | 2024-03-15 | after-t | `wdtk-1180568--licence-breakdown-duration-age` (2024-10) | — |
| `licence-last-modified` | system-presence | 2024-03-15 | after-t | `ofcom-2025-09-11--callsigns--all-callsigns` (2025-09-11) | — |
| `record-last-modified` | system-presence | 2024-03-15 | after-t | `ofcom-2024-07--call-signs--all-callsigns` (2024-07); `wdtk-1141667--issued-callsigns` (2024-07-22); `ofcom-2024-10-21--callsigns--all-callsigns` (2024-10-21); `ofcom-2025-03-13--callsigns--all-callsigns` (2025-03-13); `2025-04-08` (2025-04-08); `2025-06-04` (2025-06-04) | — |
| `licence-version-last-modified` | system-presence | 2025-10-11 | after-t | `2025-11-11` (2025-11-11); `2026-01-14` (2026-01-14) | 2025-10-11 → 2025-10-30 |
| `licence-version-original-start` | licence-start | 2026-02-23 | after-t | `2026-06-23` (2026-06-23) | — |
| `licence-version-last-modified` | system-presence | 2026-04-17 | after-t | `2026-06-23` (2026-06-23) | — |

### A reservation window bound: GB0SNB at 2025-06-01

GB0SNB (the Kelvedon Hatch bunker’s permanent special-event station) carries
a stated reservation window end of 2026-08-09 in the 2024-09 disclosure —
the permanent-SES cohort whose column carries three meanings (issue #725).
The engine reads only the window bound: the assertion precedes t and the
stated end follows it, so the answer is consistent-with-covering, never a
status claim.

Query: state of `GB0SNB` at t = 2025-06-01, consulting the whole corpus.

Vintages consulted: 2024-09.

Bounding assertions: latest on or before t: `record-created` 2016-07-23; earliest after t: `reserved-until` 2026-08-09.

Findings (every finding is **[inferred]** — issue #723):

- **reservation-window-consistent-with-covering-t** — a reservation window with stated end 2026-08-09 (on or after 2025-06-01) was asserted by a vintage collected on or before 2025-06-01 — consistent with a reservation covering 2025-06-01. Asserting vintages: 2024-09. Caveats: reserved-cohort-ambiguity, month-precision-vintage.
- **record-in-system-on-or-before-t** — record bookkeeping stamps dated on or before 2025-06-01 (earliest 2016-07-23) — the record existed in the publisher’s system by 2025-06-01; a statement about the system, never a licensing event. Asserting vintages: 2024-09. Caveats: mass-episode-window, month-precision-vintage.

Evidence:

| event kind | contribution | event day | relation to t | asserted by | episode window |
|---|---|---|---|---|---|
| `record-created` | system-presence | 2016-07-23 | on-or-before-t | `ofcom-2024-09--every-radio-callsign--all-callsigns` (2024-09) | 2016-07-23 → 2016-08-12 |
| `reserved-until` | reservation-end | 2026-08-09 | after-t | `ofcom-2024-09--every-radio-callsign--all-callsigns` (2024-09) | — |

### Outside coverage, the explicit cannot-infer: Q1ZZZ at 2020-01-01

No held dataset carries any event-time claim for this subject. The answer
is an explicit cannot-infer — and, per the availability-trap convention,
it is NEVER read as "the callsign did not exist" or "was available":
non-observation is not an observation of absence.

Query: state of `Q1ZZZ` at t = 2020-01-01, consulting the whole corpus.

Vintages consulted: (none).

**Outside coverage — cannot infer.**

Findings (every finding is **[inferred]** — issue #723):

- **no-evidence-for-subject** — no event-time claim for this subject exists in the consulted corpus — the state at 2020-01-01 cannot be inferred; this is non-observation, never "did not exist" or "was available". Caveats: availability-trap.
