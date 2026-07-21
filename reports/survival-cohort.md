# Survival and cohort analysis (the register as a life table)

The actuarial view of the register (issue #865), folded from the S1
event-time claims and the open-data snapshot-presence anchors: licence
lifetime distributions, retention by licence class and era-cohort, and the
reservation→reallocation picture. It generalises the vanished-cohort
narrative (`docs/narratives/the-vanished-cohort.md`) from one story into a
mechanism. Regenerated and committed, so a new vintage shifting the picture
shows up as a PR diff.

**Right-censoring is first-class.** Most licences are still alive — present
in the newest declared-complete export with no dated end — so every curve
states its censored count, and the age curve below is explicitly the age of
the LIVING (censored at the latest vintage), never a completed-lifespan
distribution. **"Vanished" is evidence-of-absence-from-exports, never
death** (the availability trap): a subject absent from the newest export is
not cancelled, available, or expired — only "no longer published".
**The denominators are sparse and kind-dependent**, stated per curve.
**Bookkeeping never reads as a lifecycle event** (issue #801): the
created / last-modified / version-last-modified stamps cluster onto
mass-update episode days and are EXCLUDED from every curve here — only the
licence-start, licence-end and reservation-end kinds feed a curve.
**Flags, never verdicts** (issue #467).

Presence is judged against the **7 declared-complete open-data
vintages** held (`2022-05-30` … `2026-06-23`); the
truncated partial fetches are set aside, exactly as the vanished-cohort
narrative sets them aside. The latest, `2026-06-23`, is the
censoring horizon and the retention endpoint. Subjects join across
publications on the `cleaned` callsign key (a join key, not an identity).

## Dated-evidence coverage (why the denominators are sparse)

How much dated lifecycle evidence the whole corpus holds, per kind. Start
and cancellation dates are attested by different, small sets of
disclosures — and the two ends of a lifespan are attested by
STRUCTURALLY DIFFERENT disclosures — so a joined start→cancellation
lifespan is near-absent by construction (see the observed-ends section).
Start-date kinds carry the earliest-surviving (#800) and pre-1977 (#565)
unreliability caveats.

| event kind | contribution | subjects | datasets | earliest | latest |
|---|---|---:|---:|---|---|
| `licence-cancelled` | licence-end | 7,397 | 1 | 1932-01-26 | 2020-10-06 |
| `licence-issued` | licence-start | 103,901 | 2 | 1903-05-03 | 2019-08-10 |
| `licence-original-start` | licence-start | 105,849 | 2 | 1903-05-03 | 2025-09-11 |
| `licence-version-original-start` | licence-start | 112,438 | 5 | 1903-05-03 | 2026-06-11 |
| `reserved-until` | reservation-end | 4,369 | 5 | 2016-01-04 | 2099-12-31 |

## Outcome taxonomy

Every subject present in any declared-complete open-data vintage, by
outcome. Each term is used only with this meaning:

- **still-listed** (151,634) — present in the latest declared-complete open-data export with no dated cancellation — RIGHT-CENSORED (alive): no end has been observed, and this is the overwhelming majority
- **cancelled-still-listed** (6,678) — carries a dated cancellation yet is STILL present in the latest export — the cancellation pre-dates the current listing (the reserved-callsigns cohort re-appearing as reserved); recorded, not adjudicated
- **cancelled-and-departed** (717) — carries a dated cancellation AND is absent from the latest export — a dated end that coincides with departure from the exports
- **vanished** (3,969) — absent from the latest declared-complete export with NO dated cancellation — evidence-of-absence-from-exports, NEVER death: absence of a row is non-observation (the availability trap), and this reads only as "no longer published"

| outcome | subjects | share |
|---|---:|---:|
| still-listed | 151,634 | 93.0% |
| cancelled-still-listed | 6,678 | 4.1% |
| cancelled-and-departed | 717 | 0.4% |
| vanished | 3,969 | 2.4% |
| **total** | **162,998** | — |

The censored share is decisive: **97.1%** of
subjects are still listed in the latest export (alive/right-censored). A
survival curve read off the observed ends alone would be catastrophically
biased, which is why the next section is the age of the living, not a
completed-lifespan curve.

## Curve A — age of currently-listed licences (right-censored)

For every subject still listed in the latest declared-complete export that
carries a start date, its age = whole years from its earliest attested
licence-start to `2026-06-23`. These are ALL right-censored
(no observed end), split by the pre-1977 reliability boundary (#565): the
pre-1977 body is attested-unreliable and shown apart rather than mixed in.
The start date is the earliest SURVIVING one in the corpus (#800), so a
true first start may be earlier and an age here is a lower bound.

| age band | from 1977 onward | pre-1977 (attested-unreliable, #565) |
|---|---:|---:|
| under 5 years | 11,434 | — |
| 5–9 years | 16,130 | — |
| 10–19 years | 31,389 | — |
| 20–39 years | 37,182 | — |
| 40–59 years | 22,888 | 2,806 |
| 60 years or more | — | 2,025 |
| **total (living)** | **119,023** | **4,831** |

## Curve A2 — observed complete lifespans are near-absent

The honest complement to Curve A: a fully-observed lifespan needs a dated
start AND a dated cancellation for the same licence. The corpus barely
supports one.

- **7,397** subjects carry a dated cancellation at all (a single disclosure attests them).
- **7,330** of those also carry a start dated on or before the cancellation.
- **7,324** of THOSE have their latest such start on the SAME day as the cancellation — the two columns record one event, not a licence that began and ended (candidate: a reservation record carrying one date in both fields; not adjudicated).
- Only **6** have a start strictly before the cancellation, and **5** by at least a whole year — the only genuinely observed lifespans in the whole corpus.

So there is no completed-lifespan distribution to draw: the two ends of a
licence life are attested by structurally different disclosures (the
allocated/issued register vs the reserved-callsigns disclosure), and where
they meet they coincide. This is a coverage finding, stated rather than
papered over.

## Curve B — retention by era-cohort

Cohort definition (authored): a subject belongs to the decade of its
**earliest attested licence-start date**. Only subjects that both carry a
start and appear in a declared-complete open-data vintage are counted, so
retention is defined. `still-listed` is present in the latest export;
`cancelled-departed` and `vanished` are the two ways of being absent from
it (a dated cancellation, versus evidence-of-absence with no dated end).
The cohort is bounded by start-date coverage: cancellation attestation
stops in `2020-10-06`, so a later cohort structurally
cannot show `cancelled-departed` — its absentees are `vanished` by
construction, not by a change in behaviour.

| start decade | subjects | still-listed | cancelled-departed | vanished | retention |
|---|---:|---:|---:|---:|---:|
| 1900s | 4 | 3 | 0 | 1 | 75.0% |
| 1920s | 3 | 3 | 0 | 0 | 100.0% |
| 1930s | 25 | 23 | 2 | 0 | 92.0% |
| 1940s | 165 | 156 | 6 | 3 | 94.5% |
| 1950s | 698 | 680 | 11 | 7 | 97.4% |
| 1960s | 2,002 | 1,961 | 27 | 14 | 98.0% |
| 1970s | 7,221 | 7,055 | 95 | 71 | 97.7% |
| 1980s | 23,392 | 22,955 | 229 | 208 | 98.1% |
| 1990s | 14,495 | 14,305 | 93 | 97 | 98.7% |
| 2000s | 28,555 | 28,070 | 151 | 334 | 98.3% |
| 2010s | 29,893 | 29,558 | 94 | 241 | 98.9% |
| 2020s | 19,309 | 19,085 | 0 | 224 | 98.8% |

## Curve C — retention by licence class

Cohort definition (authored): subjects present in the **base vintage**
(`2022-05-30`, the earliest declared-complete export) under a
resolved prefix-implied licence class, and how many survive into the
latest (`2026-06-23`). Retention is measured over the
mirror's own observation window — NOT licence age. The class is the
prefix-implied class (`reference-data/prefix-formats.csv`); an unparseable
token that resolves to none is bucketed `(unresolved)`, never dropped.

| licence class | in base vintage | still listed in latest | retention |
|---|---:|---:|---:|
| Full | 93,170 | 90,035 | 96.6% |
| Foundation | 38,891 | 38,143 | 98.1% |
| Intermediate | 18,985 | 18,416 | 97.0% |
| (unresolved) | 95 | 82 | 86.3% |

## Curve D — reservation → reallocation cycle

The `reserved-until` windows (the stated END of a reservation). The
window's START is nowhere attested (the state-at-t
reservation-window-start-unattested rule), so what is measured is the
stated end minus the assertion's own vintage — never a true window length.
This pairs with the two-year reservation policy test (**issue #863**), now
folded as an executable invariant in `reports/policy-invariants.md` (the
two-year reservation window): that report classifies these same
`reserved-until` observations against the stated cooling policy
(conformant / longer-than-stated / shorter-than-stated / undeterminable,
honouring day- vs month-vintage precision). This section is the
reservation-cycle side of the same evidence — the coarse counts below read
the same signal that report classifies precisely.

- **5,257** reservation-window assertions across **4,369** subjects.
- **3,240** state an end BEFORE their own asserting vintage — a retrospective termination record, not a future window (the reserved-cohort-ambiguity: the same column carries a planned close on Reserved rows and a retrospective termination on Available rows; not adjudicated here).
- **374** state an end more than two years beyond their asserting vintage — candidate exceptions to the stated two-year cooling policy (issue #863); **1** exceed five years (the shape of issue #568's reserved-over-five-years observation).
- **1** carry the far-future indefinite sentinel (`2099-12-31`).
- **121** reserved subjects later carry start evidence dated after the reservation — a coarse reallocation signal (the callsign moving on from its reservation), not a completed cycle time: the reservation's own start is unattested.

Reservation-window end years (each assertion counted once):

| reserved-until year | assertions |
|---|---:|
| 2016 | 282 |
| 2017 | 292 |
| 2018 | 290 |
| 2019 | 350 |
| 2020 | 335 |
| 2021 | 631 |
| 2022 | 618 |
| 2023 | 407 |
| 2024 | 486 |
| 2025 | 613 |
| 2026 | 590 |
| 2028 | 110 |
| 2029 | 252 |
| 2099 | 1 |
