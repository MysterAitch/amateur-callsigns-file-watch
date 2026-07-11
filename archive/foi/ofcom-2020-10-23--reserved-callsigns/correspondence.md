# FOI publication record — list of reserved amateur radio callsigns as at 23 October 2020 (Ofcom)

| | |
|---|---|
| **Ofcom reference** | not stated on the disclosed asset (published as a `__data` asset, id 206901) |
| **Publication channel** | Ofcom FOI-response annex, captured by the UK Government Web Archive (National Archives) on 2023-01-03 |
| **Response date** | not held precisely (see the vintage note below) |
| **Requester** | not attributed on the disclosed material |
| **Data vintage** | **2020-10-23** — declared by the worksheet title and corroborated by the data (see below) |

## Overview

- **What this entry is**: the companion *status-filtered* register export to the
  March 2020 allocated list. Its single worksheet, `Reserved Callsigns
  23-10-2020`, is the richer of the pair: `Value, Status, Type, Call Sign MMSI:
  Created Date, Call Sign MMSI: Last Modified Date, Reserved to Date, Licence
  Cancel Date`.
- **Contents**: 50,524 records. `Status` is a genuine per-row column carried
  verbatim — 50,260 `Reserved` and **264 `Available`** rows that ride along
  despite the `Reserved` title (a title/data mismatch, preserved and not
  reconciled, exactly as the 2022 "allocated and reserved" export carries stray
  `Available` rows). It is **not** a declared attribution; what is partial here
  is the disclosure's *coverage* — Ofcom released the reserved slice of the
  register — not any per-row certainty. `Type` is `Call Sign - Amateur` on every
  row (the service discriminator, required-present, not carried). No licence
  product/class is disclosed, so the normalised `licence_class` is emitted empty.
- **Dates carried**: `Created Date` and `Last Modified Date` are populated on
  every row (range 2016-07-23 → 2020-10-23); `Reserved to Date` (a reservation
  expiry — a validity end that may legitimately postdate the snapshot; 2022
  values observed) on 93 rows; `Licence Cancel Date` on 7,397 rows, reaching back
  to the 1930s — the oldest cancellation is 1932-01-26. These arrive typed in the
  workbook and are rendered ISO by the mechanical extractor.
- **Anomalies, recorded not repaired** (all preserved verbatim in the raw
  extract):
  - One row has a **blank callsign** (empty `Value`, status `Reserved`); it sorts
    first in the normalised output and its blank is counted in the converter
    notes.
  - Three callsigns were mangled by Excel into date serials — `20FEB`, `20AUG`
    and `20NOV` appear in the callsign column as `2020-02-20`, `2020-08-20` and
    `2020-11-20`. They are carried verbatim (the extractor renders the stored
    date serial), and flagged here as the same Excel date-mangling class seen in
    the March 2020 allocated companion asset.
  - 84 four-character callsigns (two-letter-suffix heritage series) and a run of
    six-to-nine-character reciprocal `M/…` forms, including the doubled
    `M/M/PT2FM` and `M/#PT2FM`.
- **Vintage (declared and corroborated)**: the worksheet name states 23-10-2020,
  and the data's own `Created Date` and `Last Modified Date` columns top out at
  exactly 2020-10-23 — an independent corroboration the allocated companion (which
  carries no dates) cannot offer.
- **Significance**: with its March-2020 allocated sibling
  ([`ofcom-2020-03-26--allocated-callsigns`](../ofcom-2020-03-26--allocated-callsigns/)),
  it is the only 2020 register-vintage material held, bracketing the gap between
  the September-2019 ([`ofcom-756622`](../ofcom-756622--published-register-csv/))
  and March-2022 ([`ofcom-01420046`](../ofcom-01420046--allocated-reserved-callsigns/))
  full FOI register snapshots.

## Exchange

No request/response email thread is held for this disclosure. The record is the
disclosed workbook and its provenance, captured above and in `meta.json`.
