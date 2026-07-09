# Cross-dataset invariants

Relationships the FOI lane and the open-data register only reveal when
joined on the `cleaned` callsign key (uppercased, stripped outside
A–Z/0–9/`/`) — a join key, not an identity, so counts are of distinct
cleaned keys. Regenerated and committed, so a change in a PR diff is a
drift signal. First cut: one probe (available-pool depletion); the rest
of issue #241 is staged.

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
