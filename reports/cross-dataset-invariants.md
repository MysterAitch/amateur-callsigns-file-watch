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

| available-pool snapshot | vintage | available | now allocated | still absent | drawn down |
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
