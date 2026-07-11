# FOI publication record — list of allocated amateur radio callsigns as at 26 March 2020 (Ofcom)

| | |
|---|---|
| **Ofcom reference** | not stated on the disclosed asset (published as a `__data` asset, id 196168) |
| **Publication channel** | Ofcom FOI-response annex, captured by the UK Government Web Archive (National Archives) on 2023-01-03 |
| **Response date** | not held precisely (see the vintage note below) |
| **Requester** | not attributed on the disclosed material |
| **Data vintage** | **2020-03-26** — declared from the worksheet title (see below) |

## Overview

- **What this entry is**: a *status-filtered* amateur-callsign register export
  disclosed by Ofcom. Its single worksheet, `Allocated CallSign as at 260320`,
  lists only the callsigns whose status is `Allocated`, in the minimal
  `Value, Status` shape — no `Type`, no licence class, no dates.
- **Contents**: 92,318 records, every one carrying status `Allocated`. `Status`
  is a genuine per-row column carried verbatim; it is **not** a declared
  attribution. What is partial here is the disclosure's *coverage* — Ofcom
  released only the allocated slice of the register that existed on that date —
  not any per-row certainty about status. No licence class is disclosed, so the
  normalised `licence_class` column is emitted empty to keep the
  callsign-observation core schema stable.
- **The companion allocated asset (Excel date-mangling)**: Ofcom disclosed a
  second copy of the same export as asset id 194533
  (`amateur-radio-allocated-call-signs.xlsx`, sha256 `8e7ddcfc…`). It carries the
  same 92,318 logical callsigns, but eleven suffix-month callsigns were mangled
  by Excel into date serials in that copy — `20JAN`, `21JAN`, `20FEB`, `20MAR`,
  `21MAR`, `20APR`, `20MAY`, `20JUL`, `20SEP`, `20OCT`, `20DEC` become
  `2020-01-20`, `2020-01-21`, `2020-02-20`, `2020-03-20`, `2020-03-21`,
  `2020-04-20`, `2020-05-20`, `2020-07-20`, `2020-09-20`, `2020-10-20`,
  `2020-12-20`. The copy ingested here (asset id 196168) preserves those eleven
  as text and is the faithful witness; 194533 is not ingested because its
  worksheet title is identical (so its extract would collide) and it is a
  strictly-corrupted variant of the same data. The divergence is enumerated here
  rather than hidden.
- **Anomalies, recorded not repaired** (all preserved verbatim in the raw
  extract):
  - Three callsigns carry a trailing non-breaking space — `2E1HON`, `G0TQK`,
    `G7IWE`. The normalised projection trims only that trailing whitespace, and
    the trim is counted in the converter notes (three cells, all NBSP), never
    applied silently.
  - `G6 FMU` carries an interior space (the same anomaly seen in the 2017 and
    2022 register snapshots); interior whitespace is part of the assertion and is
    kept.
  - Two callsigns are not upper-case — `2e1GTD` and `g0jrk`; case is never
    changed.
  - 388 four-character callsigns (two-letter-suffix heritage series) and 51
    callsigns of six to nine characters, most of them reciprocal `M/…` forms
    including curiosities such as `M/#YO3IES`, `M/1234`, `M/KNIZ`, `M/TEST` and
    `M/VK5ZFJ`.
- **Vintage (declared)**: the worksheet name, `Allocated CallSign as at 260320`,
  states the snapshot date 26/03/2020. There are no date columns to
  cross-check against, so the vintage rests on that declared title; it is filed
  under the same UK Government Web Archive capture as the October 2020 reserved
  list, and the two together bracket the 2020 register-history gap between the
  September-2019 and March-2022 full FOI register snapshots.
- **Significance**: it sits between the September-2019 FOI register
  ([`ofcom-756622`](../ofcom-756622--published-register-csv/), 141,295 records)
  and the March-2022 FOI register
  ([`ofcom-01420046`](../ofcom-01420046--allocated-reserved-callsigns/), 150,181
  records), and pairs with its October-2020 reserved sibling
  ([`ofcom-2020-10-23--reserved-callsigns`](../ofcom-2020-10-23--reserved-callsigns/))
  — together the only 2020 register-vintage material held.

## Exchange

No request/response email thread is held for this disclosure. The record is the
disclosed workbook and its provenance, captured above and in `meta.json`.
