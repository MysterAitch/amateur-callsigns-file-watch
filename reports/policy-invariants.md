# Policy-as-tests: the regulator’s stated rules as executable invariants

Ofcom has stated, on the record, how the register behaves — what its status
words mean, how callsigns are generated, which suffixes are excluded. Each
such statement is a testable claim about the data this repository mirrors.
This report encodes each as an INVARIANT: an authored entry that cites its
source statement, carries an executable check folded over the claim ledger
(issue #361), and reports its findings in a closed, glossed vocabulary.

**Flags, never verdicts** (issue #467): a datum that does not satisfy a
stated policy is evidence of a policy change since the statement, a
documented exception, or a data artefact — the report offers those
candidates and chooses none. The invariant LOCATES where the data and the
stated rule diverge; a human decides what the divergence means. The engine
is `src/ci/policy-invariants.ts`; this report is it demonstrated over the
real corpus, regenerated and committed so a new vintage shifting any figure
shows up as a PR diff.

## Invariant registry

1 implemented, 2 registered as framework slots (the further invariants the
issue #863 inventory names — each cited, each promoted to implemented with
its own fold and vocabulary when built out).

| invariant | status | source | tier |
|---|---|---|---|
| The two-year reservation window | implemented | FOI 756622 (WhatDoTheyKnow request 596532), Ofcom response letter (Jerin John, Information Rights Adviser), 6 September 2019 | Ofcom primary |
| The generator rule-set: format per licence class | planned | Ofcom Salesforce callsign-generator confirmation letter, 2017 (held in the archive) | Ofcom primary |
| The forbidden-suffix exclusions | planned | Ofcom Forbidden Call Signs disclosures (FOI 756622 annex and later) | Ofcom primary |

## Invariant: The two-year reservation window

### Source statement (cited)

> 'Reserved' means that the callsign has been used within the past two years, although it is no longer, and is in the process of ‘cooling down’. It is therefore not currently available for assignment to anyone else, but operators will be able to apply for it again after the two-year period has expired.

Source: FOI 756622 (WhatDoTheyKnow request 596532), Ofcom response letter (Jerin John, Information Rights Adviser), 6 September 2019 (Ofcom primary). Held at `archive/foi/wdtk-596532--allocated-reserved-forbidden/raw-extract-amateur-radio-callsigns-howell.md`.

### What it asserts

A reservation is a two-year cooling-down window: a callsign is Reserved because it was used within the past two years and is no longer, re-appliable after the two-year period. The stated end of a reservation window (the `reserved-until` cell) should therefore lie on or after, and within two years of, the assertion that records it.

### The check

Fold every `reserved-until` S1 event claim (foldReservationObservations) and classify each stated end against its asserting vintage with the pure classifier (classifyReservationWindow): conformant / longer-than-stated / shorter-than-stated / undeterminable, honouring day- vs month-vintage precision. Report counts, a per-disclosure breakdown, exemplars per class, and the beyond-five-years subset that generalises #568.

The reservation’s START (the last-use date) is nowhere attested, so the
check reads the STATED END against the assertion that records it: under the
two-year policy the end must lie on or after the assertion (a live window)
and within two years of it (the cooling cannot exceed two years from a use
no later than the assertion). Vintage precision is honoured exactly as the
state engine honours it (reports/state-at-t.md): a day-keyed vintage is one
assertion instant and classifies cleanly; a month-keyed vintage is a span,
and only the bands that hold under every day of the month are asserted —
the residual is reported as undeterminable, never guessed.

### An era boundary: the rest period changed in October 2025

The two-year window is **era-scoped**. The cited 2019 FOI statement (reaffirmed
by the December 2023 FOI response) describes a two-year cooling period; Ofcom’s
October 2025 licensing guidance moved the callsign rest period to **five years**
(“in all circumstances”), alongside the portal changes that introduced the
M8/M9 corresponding-callsign scheme (issues #863, #915). So a `reserved-until`
end asserted from a post-October-2025 vintage should be read against a
five-year, not a two-year, expectation. This report does not silently re-scope
the check: it still classifies every observation against the on-the-record
two-year statement — the corpus’s reservation evidence predates the change —
and flags this era boundary so that a future longer-than-stated observation
from a 2025-10-or-later vintage is read as a candidate policy change (the named
candidate under `longer-than-stated`), never as an anomaly. Flag, not verdict.

### Finding vocabulary

Each observation lands in exactly one class (used only with these meanings):

- **conformant** — the stated reservation end lies on or after the asserting vintage and within two years of it — consistent with the two-year cooling window under EVERY assertion instant the vintage’s precision admits (a day-keyed vintage is a single instant; a month-keyed vintage is judged conservatively across its whole month). Consistency is not proof: the window bound is all the cell states, and the reservation’s START (the last-use date) is nowhere attested, so this reads the stated end as compatible with the policy, never as confirmation the policy was applied
- **longer-than-stated** — the stated reservation end lies MORE than two years beyond the asserting vintage (beyond it under every assertion instant the vintage admits) — a window the two-year cooling cannot produce from a last use on or before the vintage. Candidate explanations, none chosen: a PERMANENT or planned multi-year reservation (special-event and broadcast callsigns are reserved indefinitely — a distinct arrangement from a cooling-down window), a policy that has changed since the 2019 statement, or an export/date artefact. #568’s community-tier "reserved beyond five years" observation is the extreme tail of this class
- **shorter-than-stated** — the stated reservation end PRECEDES the asserting vintage (before it under every assertion instant the vintage admits) — the stated window had already closed when the vintage asserted it. Candidate explanations, none chosen: a retrospective TERMINATION record (the Available-status cohort carries a past reserved-to date recording when a reservation ended, not a live window — see reports/state-at-t.md’s reserved-cohort ambiguity), a lapsed reservation not yet cleared, or an artefact
- **undeterminable** — the asserting vintage is keyed by month, not day, and the stated end falls in a band where the two-year test’s answer depends on the exact (unknown) assertion day within that month — conformant under some days of the month, longer or shorter under others. Reported honestly as undeterminable rather than guessed: month-precision is a declared-not-proven assertion time (the state-at-t vintage-precision convention)

### Findings over the corpus

Folded 5,257 `reserved-until` observations across
4,369 distinct cleaned subjects.

| class | observations | share | distinct subjects |
|---|---:|---:|---:|
| conformant | 1,582 | 30.1% | 1,320 |
| longer-than-stated | 370 | 7.0% | 202 |
| shorter-than-stated | 3,240 | 61.6% | 2,901 |
| undeterminable | 65 | 1.2% | 65 |

#### Per-disclosure breakdown

Which publication each cohort comes from. Month-keyed disclosures carry
the undeterminable band by construction (the assertion day is unknown
within the month); day-keyed disclosures classify cleanly.

| lane | dataset | vintage | conformant | longer | shorter | undeterminable | total |
|---|---|---|---:|---:|---:|---:|---:|
| foi | ofcom-2020-10-23--reserved-callsigns | 2020-10-23 | 93 | 0 | 0 | 0 | 93 |
| foi | ofcom-2021-01--all-callsigns | 2021-01-29 | 112 | 0 | 0 | 0 | 112 |
| foi | ofcom-2021-04--all-callsigns | 2021-04-21 | 122 | 0 | 1 | 0 | 123 |
| foi | ofcom-2024-09--every-radio-callsign--all-callsigns | 2024-09 | 1,159 | 201 | 2,898 | 61 | 4,319 |
| foi | wdtk-1180568--licence-breakdown-duration-age | 2024-10 | 96 | 169 | 341 | 4 | 610 |

#### Exemplars per class

Up to 10 per class, ordered by subject — the shape of the working,
not a ranking. Any subject’s observations are re-derivable from the fold.

**conformant**

| callsign | reserved-until | dataset | vintage | class |
|---|---|---|---|---|
| `20PPT` | 2020-11-08 | ofcom-2020-10-23--reserved-callsigns | 2020-10-23 | conformant |
| `20WKL` | 2024-10-08 | ofcom-2024-09--every-radio-callsign--all-callsigns | 2024-09 | conformant |
| `21AJZ` | 2022-01-18 | ofcom-2021-01--all-callsigns | 2021-01-29 | conformant |
| `21AJZ` | 2022-01-18 | ofcom-2021-04--all-callsigns | 2021-04-21 | conformant |
| `21TPE` | 2022-01-14 | ofcom-2021-01--all-callsigns | 2021-01-29 | conformant |
| `21TPE` | 2022-01-14 | ofcom-2021-04--all-callsigns | 2021-04-21 | conformant |
| `21WLL` | 2025-09-09 | ofcom-2024-09--every-radio-callsign--all-callsigns | 2024-09 | conformant |
| `G0ATC` | 2022-10-20 | ofcom-2020-10-23--reserved-callsigns | 2020-10-23 | conformant |
| `G0BAR` | 2022-06-09 | ofcom-2020-10-23--reserved-callsigns | 2020-10-23 | conformant |
| `G0BAR` | 2022-06-09 | ofcom-2021-01--all-callsigns | 2021-01-29 | conformant |

**longer-than-stated**

| callsign | reserved-until | dataset | vintage | class |
|---|---|---|---|---|
| `20HRO` | 2029-06-25 | ofcom-2024-09--every-radio-callsign--all-callsigns | 2024-09 | longer-than-stated |
| `20HRO` | 2029-06-25 | wdtk-1180568--licence-breakdown-duration-age | 2024-10 | longer-than-stated |
| `21ACE` | 2029-04-09 | ofcom-2024-09--every-radio-callsign--all-callsigns | 2024-09 | longer-than-stated |
| `21ACE` | 2029-04-09 | wdtk-1180568--licence-breakdown-duration-age | 2024-10 | longer-than-stated |
| `21DAC` | 2029-01-30 | ofcom-2024-09--every-radio-callsign--all-callsigns | 2024-09 | longer-than-stated |
| `21DAC` | 2029-01-30 | wdtk-1180568--licence-breakdown-duration-age | 2024-10 | longer-than-stated |
| `21DAZ` | 2028-11-03 | ofcom-2024-09--every-radio-callsign--all-callsigns | 2024-09 | longer-than-stated |
| `21DAZ` | 2028-11-03 | wdtk-1180568--licence-breakdown-duration-age | 2024-10 | longer-than-stated |
| `21DDA` | 2029-04-26 | ofcom-2024-09--every-radio-callsign--all-callsigns | 2024-09 | longer-than-stated |
| `21DDA` | 2029-04-26 | wdtk-1180568--licence-breakdown-duration-age | 2024-10 | longer-than-stated |

**shorter-than-stated**

| callsign | reserved-until | dataset | vintage | class |
|---|---|---|---|---|
| `20HBM` | 2016-12-17 | ofcom-2024-09--every-radio-callsign--all-callsigns | 2024-09 | shorter-than-stated |
| `20HBM` | 2016-12-17 | wdtk-1180568--licence-breakdown-duration-age | 2024-10 | shorter-than-stated |
| `20JQD` | 2018-05-11 | ofcom-2024-09--every-radio-callsign--all-callsigns | 2024-09 | shorter-than-stated |
| `20JQD` | 2018-05-11 | wdtk-1180568--licence-breakdown-duration-age | 2024-10 | shorter-than-stated |
| `20KSY` | 2024-05-22 | ofcom-2024-09--every-radio-callsign--all-callsigns | 2024-09 | shorter-than-stated |
| `20KSY` | 2024-05-22 | wdtk-1180568--licence-breakdown-duration-age | 2024-10 | shorter-than-stated |
| `20LHX` | 2023-09-29 | ofcom-2024-09--every-radio-callsign--all-callsigns | 2024-09 | shorter-than-stated |
| `20LHX` | 2023-09-29 | wdtk-1180568--licence-breakdown-duration-age | 2024-10 | shorter-than-stated |
| `20LWZ` | 2024-06-28 | ofcom-2024-09--every-radio-callsign--all-callsigns | 2024-09 | shorter-than-stated |
| `20LWZ` | 2024-06-28 | wdtk-1180568--licence-breakdown-duration-age | 2024-10 | shorter-than-stated |

**undeterminable**

| callsign | reserved-until | dataset | vintage | class |
|---|---|---|---|---|
| `20WKL` | 2024-10-08 | wdtk-1180568--licence-breakdown-duration-age | 2024-10 | undeterminable |
| `G4HRC` | 2026-10-14 | wdtk-1180568--licence-breakdown-duration-age | 2024-10 | undeterminable |
| `G5DAE` | 2024-09-09 | ofcom-2024-09--every-radio-callsign--all-callsigns | 2024-09 | undeterminable |
| `G8HRC` | 2026-10-14 | wdtk-1180568--licence-breakdown-duration-age | 2024-10 | undeterminable |
| `G8HRY` | 2024-09-10 | ofcom-2024-09--every-radio-callsign--all-callsigns | 2024-09 | undeterminable |
| `GB0BCB` | 2024-09-08 | ofcom-2024-09--every-radio-callsign--all-callsigns | 2024-09 | undeterminable |
| `GB0BSC` | 2024-09-13 | ofcom-2024-09--every-radio-callsign--all-callsigns | 2024-09 | undeterminable |
| `GB0BSG` | 2024-09-28 | ofcom-2024-09--every-radio-callsign--all-callsigns | 2024-09 | undeterminable |
| `GB0CSG` | 2024-09-20 | ofcom-2024-09--every-radio-callsign--all-callsigns | 2024-09 | undeterminable |
| `GB0FLS` | 2024-09-14 | ofcom-2024-09--every-radio-callsign--all-callsigns | 2024-09 | undeterminable |

#### Cross-reference: #568 (reserved beyond five years)

Issue #568 records a community-tier (OARC wiki) observation that callsigns
Reserved for more than five years are, in practice, available again — a
specific instance of a reservation outliving the stated two-year window.
This invariant generalises it: the beyond-five-years observations below are
the extreme tail of the longer-than-stated class (their stated end lies
more than five years beyond the asserting vintage). Surfaced, cross-
referenced, and — like every finding here — adjudicated nowhere: a
permanent special-event or broadcast reservation is a legitimate
long-window arrangement, not a policy breach.

| callsign | reserved-until | dataset | vintage | class |
|---|---|---|---|---|
| `GB2RS` | 2099-12-31 | ofcom-2024-09--every-radio-callsign--all-callsigns | 2024-09 | longer-than-stated (beyond 5y) |

## Planned invariants

Registered framework slots for the further rules the issue #863 inventory
names. Each is cited; building one out promotes it to implemented with its
own fold, classifier and exemplars.

### The generator rule-set: format per licence class

- **Asserts**: Every issued callsign’s format matches the format rules stated for its licence class.
- **Check**: PLANNED: fold each callsign’s parsed prefix/format against the stated per-class format rules; a mismatch is a candidate finding (issuance-time input, a legitimate arrangement not publicly stated, or an artefact).
- **Source**: Ofcom Salesforce callsign-generator confirmation letter, 2017 (held in the archive) (Ofcom primary).

### The forbidden-suffix exclusions

- **Asserts**: No issued callsign carries a forbidden suffix (modulo the dated-issue caveats already recorded).
- **Check**: PLANNED: the forbidden-suffix history (reports/forbidden-suffix-history.md) already tests part of this; promote its findings into this registry as an invariant with the same flag-don’t-adjudicate vocabulary.
- **Source**: Ofcom Forbidden Call Signs disclosures (FOI 756622 annex and later) (Ofcom primary).
