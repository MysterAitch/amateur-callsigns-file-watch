# Namespace sequence analytics

Allocation order, gap structure, issuance-rate curves and a naive
series-exhaustion projection per callsign prefix series (issue #864) — the
hypothesis register’s H5 ("callsigns within a series are issued
sequentially") moved off opinion and onto re-runnable evidence. Folded from
the S1 allocation-time event claims and committed, so a new vintage shifting
the picture shows up as a PR diff.

**Epistemics (issue #723):** every rate and projection is **[derived]** or
**[inferred]**, never observed. Projections are NAIVE EXTRAPOLATION, not
prediction — flat-rate arithmetic over a stated capacity, behind the
dated-evidence ceiling named below. Absence of dated evidence is
non-observation: a sparsely-dated series is not one that stopped being
issued, and nothing here reads it as such.

## What counts as allocation-time evidence

Each S1 event kind is classified for whether its date can time an allocation
(the registry is total over the S1 vocabulary, so a new kind cannot silently
join or skip the analysis). A slot’s allocation day is its earliest firm
`licence-issued` date where one exists, else its earliest original-start date
carrying the earliest-surviving caveat.

Roles (each used only with this meaning):

- **issued** — a firm stated licence issue date (the 2019 disclosures’ `Licence Issued Dat` column) — the closest the corpus holds to a true allocation date
- **earliest-surviving-start** — an original-start date that is only the earliest start SURVIVING in the asserting vintage (issue #800), pre-1977 attested-unreliable (issue #565) — a ceiling on how early the allocation was, moved by a reissue or a dropped version row
- **non-allocation** — bookkeeping (created / last-modified), a cancellation, or a reservation window bound — none dates an allocation, so it feeds no sequence figure

| event kind | allocation role |
|---|---|
| `record-created` | non-allocation |
| `record-last-modified` | non-allocation |
| `licence-version-last-modified` | non-allocation |
| `licence-version-original-start` | earliest-surviving-start |
| `licence-issued` | issued |
| `licence-cancelled` | non-allocation |
| `reserved-until` | non-allocation |
| `licence-created` | non-allocation |
| `licence-last-modified` | non-allocation |
| `licence-original-start` | earliest-surviving-start |

## Coverage honesty

A series’ population is the distinct cleaned callsigns that parse into it and
appear anywhere in the event-claim corpus (every held register row carries a
bookkeeping stamp, so this is "ever observed in a snapshot"). Dated
allocation evidence is far sparser, and unevenly so — every figure states the
dated coverage of the series it rests on.

- Parsed core/2-format slots across all series: 162,563
- …with allocation-time dated evidence: 125,726 (77.3%)
- Dated-evidence ceiling (latest allocation day dating any series): 2026-06-11 — the boundary every rate and projection sits behind; allocation-dating columns are carried by disclosures of a bounded vintage range, so later issuance is largely undated here.

## Per-series summary

Every observed series, richest first. `ρ` is Spearman’s rank correlation
between suffix sequence position and allocation day over the dated slots (a
figure is shown only where at least 30 slots are dated — a ρ over a
handful of points is noise); adjacent-monotonic is the fraction of
ordinal-adjacent dated slots in chronological order. Fill is the observed
slots as a share of the span between the first and last suffix.

| series | level | status | population | dated | coverage | suffix range | fill | ρ | adjacent-monotonic |
|---|---|---|---:|---:|---:|---|---:|---:|---:|
| `M3` | Foundation | currently-issuing | 16,694 | 12,607 | 75.5% | `AAA`–`ZZZ` | 95.0% | 0.572 | 63.1% |
| `M6` | Foundation | currently-issuing | 14,803 | 14,737 | 99.6% | `CB`–`ZZZ` | 81.3% | 0.243 | 58.7% |
| `G0` | Full | currently-issuing | 14,227 | 10,385 | 73.0% | `DX`–`ZZZ` | 78.4% | 0.729 | 82.6% |
| `G4` | Full | currently-issuing | 14,098 | 10,916 | 77.4% | `AL`–`ZZZ` | 77.3% | 0.596 | 73.2% |
| `20` | Intermediate | formerly-issued | 13,882 | 13,287 | 95.7% | `DR`–`ZZZ` | 76.5% | 0.150 | 56.7% |
| `M7` | Foundation | currently-issuing | 13,721 | 13,598 | 99.1% | `AP`–`ZAK` | 78.1% | 0.252 | 59.0% |
| `M0` | Full | currently-issuing | 13,091 | 11,407 | 87.1% | `BB`–`ZZZ` | 71.8% | 0.460 | 60.9% |
| `G7` | Full | currently-issuing | 12,803 | 6,759 | 52.8% | `DX`–`ZZZ` | 70.5% | 0.581 | 75.7% |
| `G3` | Full | currently-issuing | 9,333 | 6,613 | 70.9% | `AB`–`ZZZ` | 51.1% | -0.037 | 56.2% |
| `G1` | Full | currently-issuing | 9,305 | 5,888 | 63.3% | `H`–`ZZY` | 50.9% | 0.469 | 74.2% |
| `G6` | Full | currently-issuing | 8,411 | 5,810 | 69.1% | `AD`–`ZZZ` | 46.1% | 0.315 | 65.7% |
| `G8` | Full | currently-issuing | 7,531 | 5,700 | 75.7% | `AA`–`ZZZ` | 41.3% | 0.273 | 60.5% |
| `21` | Intermediate | formerly-issued | 6,210 | 2,136 | 34.4% | `GW`–`ZPR` | 34.9% | 0.560 | 73.3% |
| `M1` | Full | currently-issuing | 4,559 | 2,753 | 60.4% | `KE`–`ZZY` | 25.3% | 0.660 | 75.1% |
| `M9` | Intermediate | currently-issuing | 982 | 982 | 100.0% | `ACO`–`YZT` | 5.8% | 0.093 | 52.4% |
| `M5` | Full | currently-issuing | 911 | 469 | 51.5% | `AA`–`ZZZ` | 5.0% | 0.363 | 58.5% |
| `M8` | Intermediate | currently-issuing | 875 | 875 | 100.0% | `PS`–`ZBW` | 5.1% | 0.175 | 55.4% |
| `G2` | Full | formerly-issued | 599 | 320 | 53.4% | `AA`–`XYL` | 3.6% | -0.446 | 51.1% |
| `G5` | Full | currently-issuing | 527 | 484 | 91.8% | `AT`–`YZI` | 3.0% | 0.327 | 49.1% |
| `M2` ⚠ | — | — | 1 | 0 | 0.0% | `IBX` | 100.0% | — | — |

⚠ series absent from `reference-data/prefix-formats.csv` — an unexpected primary locator is a finding in its own right.

## Allocation order — is issuance sequential? (H5)

The register’s H5 asks whether a series is handed out in suffix order. Read
the Spearman `ρ` per series below over its dated slots: `ρ` near +1 is
strongly sequential issuance (later suffix, later allocation day), near 0 no
ordering, negative the reverse. The reading inherits the earliest-surviving
caveat wherever a series leans on original-start rather than firm
`licence-issued` dates, and is only as strong as the series’ dated coverage.

| series | dated slots | ρ | adjacent-monotonic | firm-issued share | reading |
|---|---:|---:|---:|---:|---|
| `M3` | 12,607 | 0.572 | 63.1% | 99.4% | weakly sequential |
| `M6` | 14,737 | 0.243 | 58.7% | 99.4% | no clear order |
| `G0` | 10,385 | 0.729 | 82.6% | 97.5% | broadly sequential |
| `G4` | 10,916 | 0.596 | 73.2% | 97.4% | weakly sequential |
| `20` | 13,287 | 0.150 | 56.7% | 78.5% | no clear order |
| `M7` | 13,598 | 0.252 | 59.0% | 10.0% | no clear order |
| `M0` | 11,407 | 0.460 | 60.9% | 84.5% | weakly sequential |
| `G7` | 6,759 | 0.581 | 75.7% | 96.2% | weakly sequential |
| `G3` | 6,613 | -0.037 | 56.2% | 94.9% | no clear order |
| `G1` | 5,888 | 0.469 | 74.2% | 94.4% | weakly sequential |
| `G6` | 5,810 | 0.315 | 65.7% | 95.1% | no clear order |
| `G8` | 5,700 | 0.273 | 60.5% | 95.1% | no clear order |
| `21` | 2,136 | 0.560 | 73.3% | 92.0% | weakly sequential |
| `M1` | 2,753 | 0.660 | 75.1% | 93.5% | weakly sequential |
| `M9` | 982 | 0.093 | 52.4% | 0.0% | no clear order |
| `M5` | 469 | 0.363 | 58.5% | 75.1% | no clear order |
| `M8` | 875 | 0.175 | 55.4% | 0.0% | no clear order |
| `G2` | 320 | -0.446 | 51.1% | 91.6% | reverse-ordered |
| `G5` | 484 | 0.327 | 49.1% | 16.5% | no clear order |

## Per-series detail

Gap structure, the dated issuance-rate curve, and (for currently-issuing
series) the naive exhaustion projection — for every series with at least
1,000 observed slots. Smaller series stay in the summary above; their
full detail is re-derivable from the fold (`analyseSeries`,
src/ci/sequence-analytics.ts).

### `M3` — Foundation (currently-issuing)

Population 16,694 slots, 12,607 dated (75.5% coverage: 12,527 firm-issued, 80 earliest-surviving only). Suffix range `AAA`–`ZZZ` (3-letter); span 17,576, fill 95.0%, largest unallocated run 343. Dated allocations 2002-01-01 → 2026-06-10.

Dated issuance-rate curve (allocations per calendar year — [derived], sparse where the allocation-dating disclosures are sparse):

| year | dated allocations |
|---|---:|
| 2002 | 2,616 |
| 2003 | 1,793 |
| 2004 | 1,747 |
| 2005 | 1,682 |
| 2006 | 1,618 |
| 2007 | 1,715 |
| 2008 | 823 |
| 2009 | 286 |
| 2010 | 116 |
| 2011 | 26 |
| 2012 | 16 |
| 2013 | 16 |
| 2014 | 20 |
| 2015 | 22 |
| 2016 | 12 |
| 2017 | 10 |
| 2018 | 10 |
| 2019 | 8 |
| 2020 | 10 |
| 2021 | 5 |
| 2022 | 6 |
| 2023 | 8 |
| 2024 | 8 |
| 2025 | 22 |
| 2026 | 12 |

Naive exhaustion projection ([inferred], extrapolation not prediction):

- Current issuing suffix length: 3 letters — theoretical capacity 17,576 (26^3). Up to 1,466 suffixes of that length are forbidden for NEW issuance (many are long-standing allocations already counted in the population), further shrinking the usable remainder.
- Slots observed at that length (snapshot presence): 16,694 — 95.0% of the space full; remaining under the model: 882.
- Flat rate: 14.0 dated allocations/year (42 dated over 2024–2026).
- **Naive projection: ~95.0% full with only 882 slots left — effectively exhausted; the remainder (much of it forbidden or unpopular suffixes) trickles out at 14.0/year.** Ofcom’s response to a full series is a new prefix (e.g. the M8/M9 intermediate series introduced October 2025).

### `M6` — Foundation (currently-issuing)

Population 14,803 slots, 14,737 dated (99.6% coverage: 14,646 firm-issued, 91 earliest-surviving only). Suffix range `CB`–`ZZZ` (2, 3-letter); span 18,199, fill 81.3%, largest unallocated run 539. Dated allocations 2002-03-30 → 2026-06-10.

Dated issuance-rate curve (allocations per calendar year — [derived], sparse where the allocation-dating disclosures are sparse):

| year | dated allocations |
|---|---:|
| 2002 | 1 |
| 2008 | 825 |
| 2009 | 1,318 |
| 2010 | 1,385 |
| 2011 | 1,514 |
| 2012 | 1,568 |
| 2013 | 1,554 |
| 2014 | 1,401 |
| 2015 | 1,437 |
| 2016 | 1,407 |
| 2017 | 1,289 |
| 2018 | 953 |
| 2019 | 1 |
| 2020 | 2 |
| 2021 | 1 |
| 2024 | 1 |
| 2025 | 25 |
| 2026 | 55 |

Naive exhaustion projection ([inferred], extrapolation not prediction):

- Current issuing suffix length: 3 letters — theoretical capacity 17,576 (26^3). Up to 1,466 suffixes of that length are forbidden for NEW issuance (many are long-standing allocations already counted in the population), further shrinking the usable remainder.
- Slots observed at that length (snapshot presence): 14,798 — 84.2% of the space full; remaining under the model: 2,778.
- Flat rate: 27.0 dated allocations/year (81 dated over 2024–2026).
- **Naive projection: ~102.9 years of capacity at that rate — a nominal run-out near 2129.** Extrapolation, not prediction: it holds the flat rate fixed, ignores forbidden-suffix scatter and non-sequential issuance, and runs off dated evidence ending 2026 (the register has issued callsigns since, uncounted here).

### `G0` — Full (currently-issuing)

Population 14,227 slots, 10,385 dated (73.0% coverage: 10,126 firm-issued, 259 earliest-surviving only). Suffix range `DX`–`ZZZ` (2, 3-letter); span 18,151, fill 78.4%, largest unallocated run 676. Dated allocations 1970-08-27 → 2026-06-08.

Dated issuance-rate curve (allocations per calendar year — [derived], sparse where the allocation-dating disclosures are sparse):

| year | dated allocations |
|---|---:|
| 1970 | 1 |
| 1982 | 3 |
| 1983 | 1 |
| 1984 | 126 |
| 1985 | 1,308 |
| 1986 | 943 |
| 1987 | 885 |
| 1988 | 792 |
| 1989 | 822 |
| 1990 | 670 |
| 1991 | 789 |
| 1992 | 732 |
| 1993 | 681 |
| 1994 | 578 |
| 1995 | 536 |
| 1996 | 259 |
| 1997 | 21 |
| 1998 | 20 |
| 1999 | 19 |
| 2000 | 19 |
| 2001 | 18 |
| 2002 | 29 |
| 2003 | 34 |
| 2004 | 52 |
| 2005 | 35 |
| 2006 | 41 |
| 2007 | 145 |
| 2008 | 88 |
| 2009 | 73 |
| 2010 | 56 |
| 2011 | 51 |
| 2012 | 66 |
| 2013 | 52 |
| 2014 | 46 |
| 2015 | 42 |
| 2016 | 49 |
| 2017 | 35 |
| 2018 | 37 |
| 2019 | 32 |
| 2020 | 47 |
| 2021 | 28 |
| 2022 | 17 |
| 2023 | 23 |
| 2024 | 29 |
| 2025 | 39 |
| 2026 | 16 |

Naive exhaustion projection ([inferred], extrapolation not prediction):

- Current issuing suffix length: 3 letters — theoretical capacity 17,576 (26^3). Up to 1,466 suffixes of that length are forbidden for NEW issuance (many are long-standing allocations already counted in the population), further shrinking the usable remainder.
- Slots observed at that length (snapshot presence): 14,225 — 80.9% of the space full; remaining under the model: 3,351.
- Flat rate: 28.0 dated allocations/year (84 dated over 2024–2026).
- **Naive projection: ~119.7 years of capacity at that rate — a nominal run-out near 2146.** Extrapolation, not prediction: it holds the flat rate fixed, ignores forbidden-suffix scatter and non-sequential issuance, and runs off dated evidence ending 2026 (the register has issued callsigns since, uncounted here).

### `G4` — Full (currently-issuing)

Population 14,098 slots, 10,916 dated (77.4% coverage: 10,630 firm-issued, 286 earliest-surviving only). Suffix range `AL`–`ZZZ` (2, 3-letter); span 18,241, fill 77.3%, largest unallocated run 677. Dated allocations 1903-05-03 → 2026-06-09.

Dated issuance-rate curve (allocations per calendar year — [derived], sparse where the allocation-dating disclosures are sparse):

| year | dated allocations |
|---|---:|
| 1903 | 1 |
| 1909 | 1 |
| 1926 | 1 |
| 1933 | 1 |
| 1939 | 4 |
| 1943 | 1 |
| 1946 | 2 |
| 1947 | 1 |
| 1952 | 1 |
| 1953 | 1 |
| 1957 | 1 |
| 1964 | 2 |
| 1965 | 1 |
| 1968 | 1 |
| 1969 | 2 |
| 1970 | 8 |
| 1971 | 144 |
| 1972 | 175 |
| 1973 | 207 |
| 1974 | 168 |
| 1975 | 178 |
| 1976 | 170 |
| 1977 | 986 |
| 1978 | 370 |
| 1979 | 410 |
| 1980 | 617 |
| 1981 | 857 |
| 1982 | 1,056 |
| 1983 | 2,070 |
| 1984 | 1,619 |
| 1985 | 28 |
| 1986 | 44 |
| 1987 | 54 |
| 1988 | 38 |
| 1989 | 70 |
| 1990 | 54 |
| 1991 | 60 |
| 1992 | 60 |
| 1993 | 73 |
| 1994 | 59 |
| 1995 | 21 |
| 1996 | 25 |
| 1997 | 26 |
| 1998 | 10 |
| 1999 | 17 |
| 2000 | 23 |
| 2001 | 16 |
| 2002 | 29 |
| 2003 | 36 |
| 2004 | 42 |
| 2005 | 44 |
| 2006 | 36 |
| 2007 | 125 |
| 2008 | 81 |
| 2009 | 73 |
| 2010 | 60 |
| 2011 | 70 |
| 2012 | 60 |
| 2013 | 61 |
| 2014 | 47 |
| 2015 | 60 |
| 2016 | 53 |
| 2017 | 34 |
| 2018 | 31 |
| 2019 | 29 |
| 2020 | 50 |
| 2021 | 37 |
| 2022 | 30 |
| 2023 | 24 |
| 2024 | 26 |
| 2025 | 26 |
| 2026 | 18 |

Naive exhaustion projection ([inferred], extrapolation not prediction):

- Current issuing suffix length: 3 letters — theoretical capacity 17,576 (26^3). Up to 1,466 suffixes of that length are forbidden for NEW issuance (many are long-standing allocations already counted in the population), further shrinking the usable remainder.
- Slots observed at that length (snapshot presence): 14,041 — 79.9% of the space full; remaining under the model: 3,535.
- Flat rate: 23.3 dated allocations/year (70 dated over 2024–2026).
- **Naive projection: ~151.5 years of capacity at that rate — a nominal run-out near 2178.** Extrapolation, not prediction: it holds the flat rate fixed, ignores forbidden-suffix scatter and non-sequential issuance, and runs off dated evidence ending 2026 (the register has issued callsigns since, uncounted here).

### `20` — Intermediate (formerly-issued)

Population 13,882 slots, 13,287 dated (95.7% coverage: 10,427 firm-issued, 2,860 earliest-surviving only). Suffix range `DR`–`ZZZ` (2, 3-letter); span 18,157, fill 76.5%, largest unallocated run 676. Dated allocations 1991-09-05 → 2026-03-23.

Dated issuance-rate curve (allocations per calendar year — [derived], sparse where the allocation-dating disclosures are sparse):

| year | dated allocations |
|---|---:|
| 1991 | 4 |
| 1992 | 15 |
| 1993 | 8 |
| 1994 | 11 |
| 1995 | 14 |
| 1996 | 17 |
| 1997 | 8 |
| 1998 | 13 |
| 1999 | 9 |
| 2000 | 18 |
| 2001 | 19 |
| 2002 | 36 |
| 2003 | 123 |
| 2004 | 611 |
| 2005 | 695 |
| 2006 | 565 |
| 2007 | 634 |
| 2008 | 682 |
| 2009 | 664 |
| 2010 | 592 |
| 2011 | 640 |
| 2012 | 678 |
| 2013 | 662 |
| 2014 | 673 |
| 2015 | 637 |
| 2016 | 650 |
| 2017 | 584 |
| 2018 | 695 |
| 2019 | 687 |
| 2020 | 708 |
| 2021 | 581 |
| 2022 | 403 |
| 2023 | 335 |
| 2024 | 372 |
| 2025 | 242 |
| 2026 | 2 |

Naive exhaustion projection: not applicable — the series is not currently issuing.

### `M7` — Foundation (currently-issuing)

Population 13,721 slots, 13,598 dated (99.1% coverage: 1,357 firm-issued, 12,241 earliest-surviving only). Suffix range `AP`–`ZAK` (2, 3-letter); span 17,572, fill 78.1%, largest unallocated run 461. Dated allocations 2002-09-04 → 2026-06-11.

Dated issuance-rate curve (allocations per calendar year — [derived], sparse where the allocation-dating disclosures are sparse):

| year | dated allocations |
|---|---:|
| 2002 | 1 |
| 2003 | 1 |
| 2006 | 1 |
| 2007 | 1 |
| 2008 | 2 |
| 2009 | 1 |
| 2010 | 1 |
| 2013 | 1 |
| 2014 | 5 |
| 2015 | 2 |
| 2016 | 1 |
| 2018 | 427 |
| 2019 | 1,365 |
| 2020 | 2,730 |
| 2021 | 1,970 |
| 2022 | 1,383 |
| 2023 | 1,296 |
| 2024 | 1,888 |
| 2025 | 1,761 |
| 2026 | 761 |

Naive exhaustion projection ([inferred], extrapolation not prediction):

- Current issuing suffix length: 3 letters — theoretical capacity 17,576 (26^3). Up to 1,466 suffixes of that length are forbidden for NEW issuance (many are long-standing allocations already counted in the population), further shrinking the usable remainder.
- Slots observed at that length (snapshot presence): 13,718 — 78.0% of the space full; remaining under the model: 3,858.
- Flat rate: 1470.0 dated allocations/year (4,410 dated over 2024–2026).
- **Naive projection: ~2.6 years of capacity at that rate — a nominal run-out near 2029.** Extrapolation, not prediction: it holds the flat rate fixed, ignores forbidden-suffix scatter and non-sequential issuance, and runs off dated evidence ending 2026 (the register has issued callsigns since, uncounted here).

### `M0` — Full (currently-issuing)

Population 13,091 slots, 11,407 dated (87.1% coverage: 9,635 firm-issued, 1,772 earliest-surviving only). Suffix range `BB`–`ZZZ` (2, 3-letter); span 18,225, fill 71.8%, largest unallocated run 553. Dated allocations 1991-08-19 → 2026-06-10.

Dated issuance-rate curve (allocations per calendar year — [derived], sparse where the allocation-dating disclosures are sparse):

| year | dated allocations |
|---|---:|
| 1991 | 1 |
| 1993 | 1 |
| 1996 | 318 |
| 1997 | 347 |
| 1998 | 306 |
| 1999 | 294 |
| 2000 | 240 |
| 2001 | 446 |
| 2002 | 350 |
| 2003 | 429 |
| 2004 | 731 |
| 2005 | 383 |
| 2006 | 458 |
| 2007 | 425 |
| 2008 | 346 |
| 2009 | 517 |
| 2010 | 340 |
| 2011 | 409 |
| 2012 | 487 |
| 2013 | 491 |
| 2014 | 419 |
| 2015 | 417 |
| 2016 | 396 |
| 2017 | 398 |
| 2018 | 429 |
| 2019 | 427 |
| 2020 | 302 |
| 2021 | 382 |
| 2022 | 234 |
| 2023 | 207 |
| 2024 | 223 |
| 2025 | 203 |
| 2026 | 51 |

Naive exhaustion projection ([inferred], extrapolation not prediction):

- Current issuing suffix length: 3 letters — theoretical capacity 17,576 (26^3). Up to 1,466 suffixes of that length are forbidden for NEW issuance (many are long-standing allocations already counted in the population), further shrinking the usable remainder.
- Slots observed at that length (snapshot presence): 13,082 — 74.4% of the space full; remaining under the model: 4,494.
- Flat rate: 159.0 dated allocations/year (477 dated over 2024–2026).
- **Naive projection: ~28.3 years of capacity at that rate — a nominal run-out near 2054.** Extrapolation, not prediction: it holds the flat rate fixed, ignores forbidden-suffix scatter and non-sequential issuance, and runs off dated evidence ending 2026 (the register has issued callsigns since, uncounted here).

### `G7` — Full (currently-issuing)

Population 12,803 slots, 6,759 dated (52.8% coverage: 6,503 firm-issued, 256 earliest-surviving only). Suffix range `DX`–`ZZZ` (2, 3-letter); span 18,151, fill 70.5%, largest unallocated run 676. Dated allocations 1980-11-01 → 2026-05-27.

Dated issuance-rate curve (allocations per calendar year — [derived], sparse where the allocation-dating disclosures are sparse):

| year | dated allocations |
|---|---:|
| 1980 | 1 |
| 1983 | 2 |
| 1987 | 1 |
| 1988 | 595 |
| 1989 | 609 |
| 1990 | 645 |
| 1991 | 595 |
| 1992 | 708 |
| 1993 | 695 |
| 1994 | 639 |
| 1995 | 627 |
| 1996 | 202 |
| 1997 | 26 |
| 1998 | 25 |
| 1999 | 24 |
| 2000 | 26 |
| 2001 | 23 |
| 2002 | 23 |
| 2003 | 30 |
| 2004 | 37 |
| 2005 | 34 |
| 2006 | 36 |
| 2007 | 142 |
| 2008 | 106 |
| 2009 | 98 |
| 2010 | 79 |
| 2011 | 54 |
| 2012 | 53 |
| 2013 | 65 |
| 2014 | 70 |
| 2015 | 78 |
| 2016 | 59 |
| 2017 | 57 |
| 2018 | 35 |
| 2019 | 40 |
| 2020 | 72 |
| 2021 | 37 |
| 2022 | 18 |
| 2023 | 24 |
| 2024 | 31 |
| 2025 | 30 |
| 2026 | 8 |

Naive exhaustion projection ([inferred], extrapolation not prediction):

- Current issuing suffix length: 3 letters — theoretical capacity 17,576 (26^3). Up to 1,466 suffixes of that length are forbidden for NEW issuance (many are long-standing allocations already counted in the population), further shrinking the usable remainder.
- Slots observed at that length (snapshot presence): 12,800 — 72.8% of the space full; remaining under the model: 4,776.
- Flat rate: 23.0 dated allocations/year (69 dated over 2024–2026).
- **Naive projection: ~207.7 years of capacity at that rate — a nominal run-out near 2234.** Extrapolation, not prediction: it holds the flat rate fixed, ignores forbidden-suffix scatter and non-sequential issuance, and runs off dated evidence ending 2026 (the register has issued callsigns since, uncounted here).

### `G3` — Full (currently-issuing)

Population 9,333 slots, 6,613 dated (70.9% coverage: 6,275 firm-issued, 338 earliest-surviving only). Suffix range `AB`–`ZZZ` (2, 3-letter); span 18,251, fill 51.1%, largest unallocated run 676. Dated allocations 1920-03-03 → 2026-06-04.

Dated issuance-rate curve (allocations per calendar year — [derived], sparse where the allocation-dating disclosures are sparse):

| year | dated allocations |
|---|---:|
| 1920 | 1 |
| 1922 | 1 |
| 1937 | 1 |
| 1938 | 3 |
| 1943 | 1 |
| 1946 | 30 |
| 1947 | 37 |
| 1948 | 42 |
| 1949 | 33 |
| 1950 | 23 |
| 1951 | 34 |
| 1952 | 70 |
| 1953 | 103 |
| 1954 | 50 |
| 1955 | 69 |
| 1956 | 75 |
| 1957 | 82 |
| 1958 | 94 |
| 1959 | 77 |
| 1960 | 92 |
| 1961 | 131 |
| 1962 | 117 |
| 1963 | 147 |
| 1964 | 214 |
| 1965 | 198 |
| 1966 | 194 |
| 1967 | 243 |
| 1968 | 205 |
| 1969 | 192 |
| 1970 | 195 |
| 1971 | 37 |
| 1972 | 18 |
| 1973 | 15 |
| 1974 | 12 |
| 1975 | 9 |
| 1976 | 22 |
| 1977 | 1,612 |
| 1978 | 36 |
| 1979 | 42 |
| 1980 | 57 |
| 1981 | 46 |
| 1982 | 36 |
| 1983 | 306 |
| 1984 | 133 |
| 1985 | 39 |
| 1986 | 54 |
| 1987 | 108 |
| 1988 | 62 |
| 1989 | 66 |
| 1990 | 43 |
| 1991 | 51 |
| 1992 | 40 |
| 1993 | 35 |
| 1994 | 31 |
| 1995 | 15 |
| 1996 | 25 |
| 1997 | 19 |
| 1998 | 16 |
| 1999 | 26 |
| 2000 | 25 |
| 2001 | 21 |
| 2002 | 26 |
| 2003 | 47 |
| 2004 | 60 |
| 2005 | 33 |
| 2006 | 24 |
| 2007 | 54 |
| 2008 | 47 |
| 2009 | 35 |
| 2010 | 27 |
| 2011 | 34 |
| 2012 | 40 |
| 2013 | 37 |
| 2014 | 33 |
| 2015 | 35 |
| 2016 | 29 |
| 2017 | 26 |
| 2018 | 25 |
| 2019 | 21 |
| 2020 | 16 |
| 2021 | 24 |
| 2022 | 18 |
| 2023 | 20 |
| 2024 | 23 |
| 2025 | 44 |
| 2026 | 24 |

Naive exhaustion projection ([inferred], extrapolation not prediction):

- Current issuing suffix length: 3 letters — theoretical capacity 17,576 (26^3). Up to 1,466 suffixes of that length are forbidden for NEW issuance (many are long-standing allocations already counted in the population), further shrinking the usable remainder.
- Slots observed at that length (snapshot presence): 9,259 — 52.7% of the space full; remaining under the model: 8,317.
- Flat rate: 30.3 dated allocations/year (91 dated over 2024–2026).
- **Naive projection: ~274.2 years of capacity at that rate — a nominal run-out near 2300.** Extrapolation, not prediction: it holds the flat rate fixed, ignores forbidden-suffix scatter and non-sequential issuance, and runs off dated evidence ending 2026 (the register has issued callsigns since, uncounted here).

### `G1` — Full (currently-issuing)

Population 9,305 slots, 5,888 dated (63.3% coverage: 5,557 firm-issued, 331 earliest-surviving only). Suffix range `H`–`ZZY` (1, 2, 3-letter); span 18,270, fill 50.9%, largest unallocated run 676. Dated allocations 1965-07-16 → 2026-06-10.

Dated issuance-rate curve (allocations per calendar year — [derived], sparse where the allocation-dating disclosures are sparse):

| year | dated allocations |
|---|---:|
| 1965 | 1 |
| 1982 | 5 |
| 1983 | 457 |
| 1984 | 1,258 |
| 1985 | 994 |
| 1986 | 792 |
| 1987 | 666 |
| 1988 | 32 |
| 1989 | 49 |
| 1990 | 53 |
| 1991 | 55 |
| 1992 | 55 |
| 1993 | 64 |
| 1994 | 38 |
| 1995 | 21 |
| 1996 | 32 |
| 1997 | 36 |
| 1998 | 25 |
| 1999 | 23 |
| 2000 | 15 |
| 2001 | 20 |
| 2002 | 23 |
| 2003 | 21 |
| 2004 | 41 |
| 2005 | 28 |
| 2006 | 36 |
| 2007 | 107 |
| 2008 | 84 |
| 2009 | 78 |
| 2010 | 65 |
| 2011 | 59 |
| 2012 | 49 |
| 2013 | 68 |
| 2014 | 59 |
| 2015 | 51 |
| 2016 | 53 |
| 2017 | 33 |
| 2018 | 46 |
| 2019 | 43 |
| 2020 | 58 |
| 2021 | 44 |
| 2022 | 29 |
| 2023 | 32 |
| 2024 | 37 |
| 2025 | 39 |
| 2026 | 14 |

Naive exhaustion projection ([inferred], extrapolation not prediction):

- Current issuing suffix length: 3 letters — theoretical capacity 17,576 (26^3). Up to 1,466 suffixes of that length are forbidden for NEW issuance (many are long-standing allocations already counted in the population), further shrinking the usable remainder.
- Slots observed at that length (snapshot presence): 9,300 — 52.9% of the space full; remaining under the model: 8,276.
- Flat rate: 30.0 dated allocations/year (90 dated over 2024–2026).
- **Naive projection: ~275.9 years of capacity at that rate — a nominal run-out near 2302.** Extrapolation, not prediction: it holds the flat rate fixed, ignores forbidden-suffix scatter and non-sequential issuance, and runs off dated evidence ending 2026 (the register has issued callsigns since, uncounted here).

### `G6` — Full (currently-issuing)

Population 8,411 slots, 5,810 dated (69.1% coverage: 5,524 firm-issued, 286 earliest-surviving only). Suffix range `AD`–`ZZZ` (2, 3-letter); span 18,249, fill 46.1%, largest unallocated run 679. Dated allocations 1904-02-16 → 2026-06-09.

Dated issuance-rate curve (allocations per calendar year — [derived], sparse where the allocation-dating disclosures are sparse):

| year | dated allocations |
|---|---:|
| 1904 | 1 |
| 1932 | 1 |
| 1961 | 3 |
| 1969 | 1 |
| 1971 | 1 |
| 1973 | 2 |
| 1975 | 1 |
| 1977 | 4 |
| 1978 | 2 |
| 1979 | 1 |
| 1980 | 4 |
| 1981 | 876 |
| 1982 | 1,318 |
| 1983 | 1,560 |
| 1984 | 131 |
| 1985 | 31 |
| 1986 | 45 |
| 1987 | 47 |
| 1988 | 47 |
| 1989 | 51 |
| 1990 | 62 |
| 1991 | 68 |
| 1992 | 56 |
| 1993 | 68 |
| 1994 | 55 |
| 1995 | 30 |
| 1996 | 31 |
| 1997 | 28 |
| 1998 | 24 |
| 1999 | 20 |
| 2000 | 19 |
| 2001 | 19 |
| 2002 | 18 |
| 2003 | 25 |
| 2004 | 40 |
| 2005 | 45 |
| 2006 | 45 |
| 2007 | 111 |
| 2008 | 88 |
| 2009 | 60 |
| 2010 | 66 |
| 2011 | 56 |
| 2012 | 47 |
| 2013 | 44 |
| 2014 | 54 |
| 2015 | 55 |
| 2016 | 65 |
| 2017 | 42 |
| 2018 | 57 |
| 2019 | 48 |
| 2020 | 53 |
| 2021 | 46 |
| 2022 | 38 |
| 2023 | 23 |
| 2024 | 34 |
| 2025 | 27 |
| 2026 | 16 |

Naive exhaustion projection ([inferred], extrapolation not prediction):

- Current issuing suffix length: 3 letters — theoretical capacity 17,576 (26^3). Up to 1,466 suffixes of that length are forbidden for NEW issuance (many are long-standing allocations already counted in the population), further shrinking the usable remainder.
- Slots observed at that length (snapshot presence): 8,352 — 47.5% of the space full; remaining under the model: 9,224.
- Flat rate: 25.7 dated allocations/year (77 dated over 2024–2026).
- **Naive projection: ~359.4 years of capacity at that rate — a nominal run-out near 2385.** Extrapolation, not prediction: it holds the flat rate fixed, ignores forbidden-suffix scatter and non-sequential issuance, and runs off dated evidence ending 2026 (the register has issued callsigns since, uncounted here).

### `G8` — Full (currently-issuing)

Population 7,531 slots, 5,700 dated (75.7% coverage: 5,421 firm-issued, 279 earliest-surviving only). Suffix range `AA`–`ZZZ` (2, 3-letter); span 18,252, fill 41.3%, largest unallocated run 678. Dated allocations 1904-02-04 → 2026-06-10.

Dated issuance-rate curve (allocations per calendar year — [derived], sparse where the allocation-dating disclosures are sparse):

| year | dated allocations |
|---|---:|
| 1904 | 1 |
| 1936 | 1 |
| 1937 | 2 |
| 1946 | 1 |
| 1953 | 3 |
| 1964 | 23 |
| 1965 | 29 |
| 1966 | 29 |
| 1967 | 27 |
| 1968 | 77 |
| 1969 | 63 |
| 1970 | 74 |
| 1971 | 66 |
| 1972 | 123 |
| 1973 | 97 |
| 1974 | 114 |
| 1975 | 98 |
| 1976 | 116 |
| 1977 | 874 |
| 1978 | 327 |
| 1979 | 415 |
| 1980 | 667 |
| 1981 | 108 |
| 1982 | 23 |
| 1983 | 299 |
| 1984 | 102 |
| 1985 | 50 |
| 1986 | 47 |
| 1987 | 71 |
| 1988 | 59 |
| 1989 | 60 |
| 1990 | 54 |
| 1991 | 47 |
| 1992 | 57 |
| 1993 | 53 |
| 1994 | 35 |
| 1995 | 43 |
| 1996 | 42 |
| 1997 | 29 |
| 1998 | 24 |
| 1999 | 21 |
| 2000 | 21 |
| 2001 | 11 |
| 2002 | 16 |
| 2003 | 40 |
| 2004 | 38 |
| 2005 | 42 |
| 2006 | 35 |
| 2007 | 125 |
| 2008 | 87 |
| 2009 | 80 |
| 2010 | 66 |
| 2011 | 58 |
| 2012 | 53 |
| 2013 | 52 |
| 2014 | 54 |
| 2015 | 53 |
| 2016 | 40 |
| 2017 | 41 |
| 2018 | 53 |
| 2019 | 46 |
| 2020 | 50 |
| 2021 | 27 |
| 2022 | 38 |
| 2023 | 33 |
| 2024 | 43 |
| 2025 | 27 |
| 2026 | 20 |

Naive exhaustion projection ([inferred], extrapolation not prediction):

- Current issuing suffix length: 3 letters — theoretical capacity 17,576 (26^3). Up to 1,466 suffixes of that length are forbidden for NEW issuance (many are long-standing allocations already counted in the population), further shrinking the usable remainder.
- Slots observed at that length (snapshot presence): 7,470 — 42.5% of the space full; remaining under the model: 10,106.
- Flat rate: 30.0 dated allocations/year (90 dated over 2024–2026).
- **Naive projection: ~336.9 years of capacity at that rate — a nominal run-out near 2363.** Extrapolation, not prediction: it holds the flat rate fixed, ignores forbidden-suffix scatter and non-sequential issuance, and runs off dated evidence ending 2026 (the register has issued callsigns since, uncounted here).

### `21` — Intermediate (formerly-issued)

Population 6,210 slots, 2,136 dated (34.4% coverage: 1,965 firm-issued, 171 earliest-surviving only). Suffix range `GW`–`ZPR` (2, 3-letter); span 17,806, fill 34.9%, largest unallocated run 685. Dated allocations 1955-10-23 → 2026-03-17.

Dated issuance-rate curve (allocations per calendar year — [derived], sparse where the allocation-dating disclosures are sparse):

| year | dated allocations |
|---|---:|
| 1955 | 1 |
| 1991 | 27 |
| 1992 | 87 |
| 1993 | 109 |
| 1994 | 124 |
| 1995 | 165 |
| 1996 | 135 |
| 1997 | 142 |
| 1998 | 173 |
| 1999 | 173 |
| 2000 | 162 |
| 2001 | 180 |
| 2002 | 137 |
| 2003 | 90 |
| 2004 | 26 |
| 2005 | 24 |
| 2006 | 14 |
| 2007 | 33 |
| 2008 | 18 |
| 2009 | 21 |
| 2010 | 15 |
| 2011 | 14 |
| 2012 | 10 |
| 2013 | 19 |
| 2014 | 11 |
| 2015 | 17 |
| 2016 | 12 |
| 2017 | 9 |
| 2018 | 15 |
| 2019 | 12 |
| 2020 | 48 |
| 2021 | 34 |
| 2022 | 21 |
| 2023 | 16 |
| 2024 | 20 |
| 2025 | 21 |
| 2026 | 1 |

Naive exhaustion projection: not applicable — the series is not currently issuing.

### `M1` — Full (currently-issuing)

Population 4,559 slots, 2,753 dated (60.4% coverage: 2,575 firm-issued, 178 earliest-surviving only). Suffix range `KE`–`ZZY` (2, 3-letter); span 17,987, fill 25.3%, largest unallocated run 725. Dated allocations 1992-08-08 → 2026-06-09.

Dated issuance-rate curve (allocations per calendar year — [derived], sparse where the allocation-dating disclosures are sparse):

| year | dated allocations |
|---|---:|
| 1992 | 1 |
| 1996 | 327 |
| 1997 | 350 |
| 1998 | 368 |
| 1999 | 323 |
| 2000 | 230 |
| 2001 | 221 |
| 2002 | 200 |
| 2003 | 240 |
| 2004 | 32 |
| 2005 | 26 |
| 2006 | 23 |
| 2007 | 46 |
| 2008 | 27 |
| 2009 | 15 |
| 2010 | 17 |
| 2011 | 19 |
| 2012 | 22 |
| 2013 | 17 |
| 2014 | 14 |
| 2015 | 17 |
| 2016 | 17 |
| 2017 | 14 |
| 2018 | 17 |
| 2019 | 9 |
| 2020 | 18 |
| 2021 | 17 |
| 2022 | 21 |
| 2023 | 13 |
| 2024 | 29 |
| 2025 | 32 |
| 2026 | 31 |

Naive exhaustion projection ([inferred], extrapolation not prediction):

- Current issuing suffix length: 3 letters — theoretical capacity 17,576 (26^3). Up to 1,466 suffixes of that length are forbidden for NEW issuance (many are long-standing allocations already counted in the population), further shrinking the usable remainder.
- Slots observed at that length (snapshot presence): 4,558 — 25.9% of the space full; remaining under the model: 13,018.
- Flat rate: 30.7 dated allocations/year (92 dated over 2024–2026).
- **Naive projection: ~424.5 years of capacity at that rate — a nominal run-out near 2451.** Extrapolation, not prediction: it holds the flat rate fixed, ignores forbidden-suffix scatter and non-sequential issuance, and runs off dated evidence ending 2026 (the register has issued callsigns since, uncounted here).
