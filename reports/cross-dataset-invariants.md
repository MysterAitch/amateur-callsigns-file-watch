# Cross-dataset invariants

Relationships the FOI lane and the open-data register only reveal when
joined on the `cleaned` callsign key (uppercased, stripped outside
A–Z/0–9/`/`) — a join key, not an identity, so counts are of distinct
cleaned keys. Regenerated and committed, so a change in a PR diff is a
drift signal. Every figure below is **declared, not verified**: a
candidate for reconciliation, never a verdict.

## Available-pool depletion

Each FOI "available callsigns" snapshot lists callsigns Ofcom declared
available at its vintage. Joined against the latest register
(`2026-06-23`, 105,332 Allocated): how many of
that pool are now Allocated (drawn down) versus still absent from the
allocated set. Absence is not evidence of current availability — a
callsign may since have moved through Reserved or been withheld.

| available-pool snapshot | vintage | available | now allocated | still absent | now allocated (share) |
|---|---|---:|---:|---:|---:|
| `wdtk-174341--available-callsigns-list` | 2013-09-06 | 26,646 | 14,966 | 11,680 | 56.2% |
| `wdtk-197896--available-callsigns-list` | 2014-03-14 | 25,391 | 13,860 | 11,531 | 54.6% |
| `wdtk-224333--available-callsigns-list` | 2014-08-18 | 24,200 | 12,838 | 11,362 | 53.0% |
| `wdtk-247308--available-callsigns-list` | 2015-02-25 | 23,032 | 11,823 | 11,209 | 51.3% |
| `wdtk-261814--available-callsigns-list` | 2015-04-16 | 22,584 | 11,445 | 11,139 | 50.7% |
| `wdtk-271469--available-callsigns-list` | 2015-06-11 | 22,218 | 11,141 | 11,077 | 50.1% |
| `wdtk-294011--available-callsigns-list` | 2015-10-13 | 21,481 | 10,516 | 10,965 | 49.0% |
| `wdtk-299321--available-callsigns-list` | 2015-10-13 | 21,481 | 10,516 | 10,965 | 49.0% |
| `wdtk-309076--available-callsigns-list` | 2016-01-21 | 20,734 | 9,880 | 10,854 | 47.7% |

## Absent-from-both, decomposed

The still-absent remainder (available at the snapshot, not now
Allocated) split by the callsign's CURRENT status in the register:
now **Reserved** (held back), still **Available** (declared available
years on, never taken up), or **absent from the register entirely**
(no current row — withdrawn, never re-listed, or an artefact of the
cleaned join). The three sum to the still-absent column above.

| available-pool snapshot | vintage | still absent | now reserved | still available | absent from register |
|---|---|---:|---:|---:|---:|
| `wdtk-174341--available-callsigns-list` | 2013-09-06 | 11,680 | 2,662 | 121 | 8,897 |
| `wdtk-197896--available-callsigns-list` | 2014-03-14 | 11,531 | 2,524 | 119 | 8,888 |
| `wdtk-224333--available-callsigns-list` | 2014-08-18 | 11,362 | 2,374 | 117 | 8,871 |
| `wdtk-247308--available-callsigns-list` | 2015-02-25 | 11,209 | 2,232 | 114 | 8,863 |
| `wdtk-261814--available-callsigns-list` | 2015-04-16 | 11,139 | 2,170 | 112 | 8,857 |
| `wdtk-271469--available-callsigns-list` | 2015-06-11 | 11,077 | 2,111 | 112 | 8,854 |
| `wdtk-294011--available-callsigns-list` | 2015-10-13 | 10,965 | 2,010 | 110 | 8,845 |
| `wdtk-299321--available-callsigns-list` | 2015-10-13 | 10,965 | 2,010 | 110 | 8,845 |
| `wdtk-309076--available-callsigns-list` | 2016-01-21 | 10,854 | 1,911 | 110 | 8,833 |

## Original-issue-date invariant

Of each pool now allocated, callsigns whose licence
original-start-date **predates** the snapshot that declared them
available. A callsign both "available" at vintage V and first licensed
before V is an apparent contradiction — a reconciliation candidate,
not a proven error (the available list may have included re-issuable
callsigns, or the recorded start-date may reflect an earlier holder).

| available-pool snapshot | vintage | allocated with date | issued before vintage | share |
|---|---|---:|---:|---:|
| `wdtk-174341--available-callsigns-list` | 2013-09-06 | 14,966 | 25 | 0.2% |
| `wdtk-197896--available-callsigns-list` | 2014-03-14 | 13,860 | 22 | 0.2% |
| `wdtk-224333--available-callsigns-list` | 2014-08-18 | 12,838 | 24 | 0.2% |
| `wdtk-247308--available-callsigns-list` | 2015-02-25 | 11,823 | 32 | 0.3% |
| `wdtk-261814--available-callsigns-list` | 2015-04-16 | 11,445 | 33 | 0.3% |
| `wdtk-271469--available-callsigns-list` | 2015-06-11 | 11,141 | 38 | 0.3% |
| `wdtk-294011--available-callsigns-list` | 2015-10-13 | 10,516 | 45 | 0.4% |
| `wdtk-299321--available-callsigns-list` | 2015-10-13 | 10,516 | 45 | 0.4% |
| `wdtk-309076--available-callsigns-list` | 2016-01-21 | 9,880 | 30 | 0.3% |

## Available × record-of overlap matrix

Each FOI available-pool snapshot (row, by vintage) against every
register snapshot we hold (column, by vintage): the share of that
pool's cleaned keys **present** in that register — intersection over
pool size. "Record-of" registers are the open-data publications and
the FOI register-snapshots (the union of their `callsign` columns).
Presence means the key carries any row in that register (Allocated,
Reserved or still Available), not that it is allocated.

Columns run oldest→newest left to right, and every register vintage
here falls at or after every pool vintage (the pools are 2013–2016;
the earliest register is 2016-09), so the row reads as an **age
gradient**: overlap climbs rightward as each pool is drawn down /
taken up into successively later registers. Declared, not verified;
`cleaned` is a join key, so a cell counts distinct keys in common,
never distinct stations, and absence is not evidence.

Columns marked ⚠ are **partial publications** (archived as published
but incomplete): a register holding a few thousand rows cannot
overlap much of any pool, so those cells collapse to near-zero by
construction and interrupt the gradient — read the trend across the
complete columns.

Register snapshots (columns), by vintage:

- `2016-09` — FOI `wdtk-356636--all-callsigns-plus-forbidden` (139,745 keys)
- `2016-09-20` — FOI `ofcom-2016-09-20--callsign-database--all-callsigns` (139,745 keys)
- `2017-07-13` — FOI `ofcom-2017-07-13--all-callsigns` (135,864 keys)
- `2019-08-12` — FOI `wdtk-596532--allocated-reserved-forbidden` (141,291 keys)
- `2019-09-12` — FOI `ofcom-756622--published-register-csv` (141,291 keys)
- `2020-03-26` ⚠ — FOI `ofcom-2020-03-26--allocated-callsigns` (92,317 keys, partial publication)
- `2020-10-23` ⚠ — FOI `ofcom-2020-10-23--reserved-callsigns` (50,523 keys, partial publication)
- `2021-01` — FOI `ofcom-210648--corrupt-annex-callsigns` (146,450 keys)
- `2021-01-29` — FOI `ofcom-2021-01--all-callsigns` (146,756 keys)
- `2021-04-21` — FOI `ofcom-2021-04--all-callsigns` (147,870 keys)
- `2022-03-07` — FOI `ofcom-01420046--allocated-reserved-callsigns` (150,175 keys)
- `2022-03-14` — FOI `ofcom-2022-03-14--available-and-registered--all-callsigns` (150,232 keys)
- `2022-05-30` — open-data `2022-05-30` (151,142 keys)
- `2023-01-25` — FOI `ofcom-2023-01-25--call-sign-list-with-status--all-callsigns` (152,076 keys)
- `2023-02-20` — open-data `2023-02-20` (152,076 keys)
- `2023-08-18` — FOI `ofcom-2023-08-18--call-sign-list--all-callsigns` (153,242 keys)
- `2023-11-24` — FOI `ofcom-2023-11-24--call-sign-list--all-callsigns` (108,919 keys)
- `2023-12-07` — FOI `ofcom-2023-12-07--open-data-call-sign-list--all-callsigns` (108,989 keys)
- `2024-01` — FOI `ofcom-2024-01--foi-1734722--all-callsigns` (153,932 keys)
- `2024-04-30` — FOI `ofcom-2024-04-30--copy-all-callsigns--all-callsigns` (154,580 keys)
- `2024-07` — FOI `ofcom-2024-07--call-signs--all-callsigns` (155,342 keys)
- `2024-07-22` — FOI `wdtk-1141667--issued-callsigns` (110,619 keys)
- `2024-09` — FOI `ofcom-2024-09--every-radio-callsign--all-callsigns` (159,989 keys)
- `2024-10` — FOI `wdtk-1180568--licence-breakdown-duration-age` (156,252 keys)
- `2024-10-21` — FOI `ofcom-2024-10-21--callsigns--all-callsigns` (156,275 keys)
- `2025-03-13` — FOI `ofcom-2025-03-13--callsigns--all-callsigns` (157,220 keys)
- `2025-04-08` — open-data `2025-04-08` (157,420 keys)
- `2025-05-27` ⚠ — open-data `2025-05-27` (1,074 keys, partial publication)
- `2025-06-04` — open-data `2025-06-04` (112,646 keys)
- `2025-06-08` ⚠ — open-data `2025-06-08` (1,074 keys, partial publication)
- `2025-09-11` — FOI `ofcom-2025-09-11--callsigns--all-callsigns` (158,463 keys)
- `2025-11-11` — open-data `2025-11-11` (159,675 keys)
- `2026-01-14` — open-data `2026-01-14` (146,216 keys)
- `2026-06-23` — open-data `2026-06-23` (158,312 keys)

| available-pool snapshot | vintage | pool | 2016-09 | 2016-09-20 | 2017-07-13 | 2019-08-12 | 2019-09-12 | 2020-03-26 ⚠ | 2020-10-23 ⚠ | 2021-01 | 2021-01-29 | 2021-04-21 | 2022-03-07 | 2022-03-14 | 2022-05-30 | 2023-01-25 | 2023-02-20 | 2023-08-18 | 2023-11-24 | 2023-12-07 | 2024-01 | 2024-04-30 | 2024-07 | 2024-07-22 | 2024-09 | 2024-10 | 2024-10-21 | 2025-03-13 | 2025-04-08 | 2025-05-27 ⚠ | 2025-06-04 | 2025-06-08 ⚠ | 2025-09-11 | 2025-11-11 | 2026-01-14 | 2026-06-23 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `wdtk-174341--available-callsigns-list` | 2013-09-06 | 26,646 | 32.8% | 32.8% | 35.0% | 49.6% | 49.6% | 49.5% | 2.2% | 55.0% | 55.3% | 56.6% | 59.2% | 59.3% | 60.3% | 61.2% | 61.2% | 62.5% | 62.3% | 62.4% | 63.1% | 63.8% | 64.2% | 63.8% | 64.8% | 64.9% | 65.0% | 65.8% | 65.9% | 1.3% | 65.6% | 1.3% | 66.8% | 65.8% | 59.1% | 66.6% |
| `wdtk-197896--available-callsigns-list` | 2014-03-14 | 25,391 | 29.5% | 29.5% | 31.8% | 47.1% | 47.1% | 47.2% | 2.1% | 52.8% | 53.1% | 54.5% | 57.2% | 57.3% | 58.4% | 59.3% | 59.3% | 60.6% | 60.5% | 60.6% | 61.2% | 62.0% | 62.4% | 62.1% | 63.0% | 63.2% | 63.2% | 64.1% | 64.2% | 1.4% | 64.0% | 1.4% | 65.2% | 64.2% | 57.6% | 65.0% |
| `wdtk-224333--available-callsigns-list` | 2014-08-18 | 24,200 | 26.0% | 26.0% | 28.5% | 44.5% | 44.5% | 44.9% | 1.9% | 50.5% | 50.8% | 52.2% | 55.1% | 55.1% | 56.3% | 57.3% | 57.3% | 58.7% | 58.6% | 58.7% | 59.3% | 60.1% | 60.6% | 60.3% | 61.2% | 61.4% | 61.4% | 62.3% | 62.4% | 1.5% | 62.3% | 1.5% | 63.5% | 62.4% | 56.0% | 63.3% |
| `wdtk-247308--available-callsigns-list` | 2015-02-25 | 23,032 | 22.3% | 22.3% | 24.8% | 41.6% | 41.6% | 42.3% | 1.8% | 48.0% | 48.3% | 49.8% | 52.8% | 52.8% | 54.1% | 55.1% | 55.1% | 56.5% | 56.5% | 56.6% | 57.2% | 58.1% | 58.6% | 58.3% | 59.2% | 59.4% | 59.4% | 60.4% | 60.5% | 1.5% | 60.4% | 1.5% | 61.6% | 60.5% | 54.3% | 61.5% |
| `wdtk-261814--available-callsigns-list` | 2015-04-16 | 22,584 | 20.7% | 20.7% | 23.3% | 40.5% | 40.5% | 41.3% | 1.7% | 46.9% | 47.2% | 48.8% | 51.9% | 51.9% | 53.2% | 54.2% | 54.2% | 55.7% | 55.7% | 55.8% | 56.4% | 57.2% | 57.8% | 57.5% | 58.4% | 58.6% | 58.6% | 59.6% | 59.7% | 1.6% | 59.6% | 1.6% | 60.8% | 59.8% | 53.6% | 60.8% |
| `wdtk-271469--available-callsigns-list` | 2015-06-11 | 22,218 | 19.4% | 19.4% | 22.1% | 39.5% | 39.5% | 40.4% | 1.6% | 46.0% | 46.4% | 47.9% | 51.1% | 51.1% | 52.4% | 53.4% | 53.4% | 54.9% | 55.0% | 55.1% | 55.7% | 56.5% | 57.1% | 56.8% | 57.7% | 57.9% | 57.9% | 58.9% | 59.1% | 1.6% | 59.0% | 1.6% | 60.2% | 59.1% | 53.0% | 60.1% |
| `wdtk-294011--available-callsigns-list` | 2015-10-13 | 21,481 | 16.7% | 16.7% | 19.4% | 37.4% | 37.4% | 38.5% | 1.5% | 44.2% | 44.5% | 46.1% | 49.4% | 49.4% | 50.8% | 51.8% | 51.8% | 53.4% | 53.5% | 53.6% | 54.1% | 55.0% | 55.6% | 55.4% | 56.3% | 56.4% | 56.5% | 57.5% | 57.6% | 1.6% | 57.6% | 1.6% | 58.8% | 57.7% | 51.7% | 58.8% |
| `wdtk-299321--available-callsigns-list` | 2015-10-13 | 21,481 | 16.7% | 16.7% | 19.4% | 37.4% | 37.4% | 38.5% | 1.5% | 44.2% | 44.5% | 46.1% | 49.4% | 49.4% | 50.8% | 51.8% | 51.8% | 53.4% | 53.5% | 53.6% | 54.1% | 55.0% | 55.6% | 55.4% | 56.3% | 56.4% | 56.5% | 57.5% | 57.6% | 1.6% | 57.6% | 1.6% | 58.8% | 57.7% | 51.7% | 58.8% |
| `wdtk-309076--available-callsigns-list` | 2016-01-21 | 20,734 | 13.6% | 13.6% | 16.5% | 35.1% | 35.1% | 36.4% | 1.4% | 42.2% | 42.5% | 44.2% | 47.6% | 47.6% | 49.0% | 50.1% | 50.1% | 51.7% | 51.8% | 51.9% | 52.5% | 53.4% | 54.0% | 53.8% | 54.7% | 54.9% | 54.9% | 56.0% | 56.1% | 1.7% | 56.1% | 1.7% | 57.4% | 56.3% | 50.5% | 57.4% |

## Same-vintage complementarity (documented residual)

The invariant: at a single vintage the separately-published
available-callsigns list and the register's occupied set (Allocated
plus Reserved) should be **complementary** — a callsign is either
available for issue or already taken, not both — so the available list
and the occupied register together account for the issuable space,
leaving only a small complement (the ~14% #223 set out to check).

This probe stays a **documented residual**: testing complementarity
needs an available list AND a register snapshot of the *same* vintage,
and we hold no such pairing. The available-pool snapshots are
2013–2016; the earliest register snapshot we hold is later, and no
register vintage coincides with any pool vintage. Rather than force it
against a mismatched vintage — which the overlap matrix above already
covers as a cross-vintage presence gradient — the gap that blocks it
is committed here precisely: for each pool, the nearest register
snapshot held and how far after the pool it falls.

The probe **unblocks automatically** if a register snapshot of a
pool's vintage is ever added (the gap reaches zero); a self-check
guards that condition, so the residual cannot be silently assumed once
holdings change. Partial vintages are normalised to the first day of
their period for the day count.

| available-pool snapshot | vintage | nearest register snapshot | register vintage | gap (days) |
|---|---|---|---|---:|
| `wdtk-174341--available-callsigns-list` | 2013-09-06 | `wdtk-356636--all-callsigns-plus-forbidden` | 2016-09 | 1,091 |
| `wdtk-197896--available-callsigns-list` | 2014-03-14 | `wdtk-356636--all-callsigns-plus-forbidden` | 2016-09 | 902 |
| `wdtk-224333--available-callsigns-list` | 2014-08-18 | `wdtk-356636--all-callsigns-plus-forbidden` | 2016-09 | 745 |
| `wdtk-247308--available-callsigns-list` | 2015-02-25 | `wdtk-356636--all-callsigns-plus-forbidden` | 2016-09 | 554 |
| `wdtk-261814--available-callsigns-list` | 2015-04-16 | `wdtk-356636--all-callsigns-plus-forbidden` | 2016-09 | 504 |
| `wdtk-271469--available-callsigns-list` | 2015-06-11 | `wdtk-356636--all-callsigns-plus-forbidden` | 2016-09 | 448 |
| `wdtk-294011--available-callsigns-list` | 2015-10-13 | `wdtk-356636--all-callsigns-plus-forbidden` | 2016-09 | 324 |
| `wdtk-299321--available-callsigns-list` | 2015-10-13 | `wdtk-356636--all-callsigns-plus-forbidden` | 2016-09 | 324 |
| `wdtk-309076--available-callsigns-list` | 2016-01-21 | `wdtk-356636--all-callsigns-plus-forbidden` | 2016-09 | 224 |

No register snapshot shares a pool vintage, so the complementarity check remains un-computable from current holdings — a documented residual, not an omission.
