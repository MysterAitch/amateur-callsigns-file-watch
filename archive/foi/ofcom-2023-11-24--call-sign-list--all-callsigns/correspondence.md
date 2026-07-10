# FOI publication record — amateur callsign list (Ofcom disclosure log, "Call sign list 241123")

| | |
|---|---|
| **Ofcom reference** | none stated on the disclosure; the file is published as `call-sign-list-241123.csv` under Ofcom's FOI/disclosure area for December 2023 |
| **Publication channel** | a CSV served directly from Ofcom's website; the same bytes are mirrored on the UK Government Web Archive (UKGWA) |
| **Data vintage** | **2023-11-24** — the filename's `241123` and the latest `Last Modified Date` in the data (2023-11-24) agree |
| **Requester** | not known (a disclosure-log/open-data style publication, no requester named) |

## Overview

- **What this entry is**: a full amateur-callsign register export listing every
  callsign with its status, licence product and a per-record last-modified date.
  The header shape is `Value,Status,Product,Type,Call Sign MMSI: Last Modified
  Date` — a Salesforce-era export shape shared with the December 2023 open-data
  list ([`ofcom-2023-12-07`](../ofcom-2023-12-07--open-data-call-sign-list--all-callsigns/))
  and the January 2024 FOI 1734722 disclosure
  ([`ofcom-2024-01`](../ofcom-2024-01--foi-1734722--all-callsigns/)).
- **Contents**: 108,922 records — 99,529 `Allocated`, 9,148 `Reserved`,
  235 `Available`, 10 blank statuses. `Product` carries the licence-product
  vocabulary verbatim (Foundation / Intermediate / Full / Club / Temporary
  Reciprocal); `Type` is `Call Sign - Amateur` on every row (the service
  discriminator). The last-modified dates span 2016-07-23 to 2023-11-24.
- **Anomalies, recorded not repaired**:
  - **13 Excel-mangled callsigns** — Intermediate `20xxx` callsigns whose suffix
    reads as a month abbreviation (`20APR`, `20MAY`, `20NOV`, `21JAN`…) were
    auto-formatted to dates by the spreadsheet tool at Ofcom's export and are
    served as `20-Apr`, `20-May`, `20-Nov`, `21-Jan` and so on. They are carried
    **verbatim**, never repaired back to a guessed suffix — the same class of
    artefact seen in the 2015 typed exports. (The December open-data and FOI
    1734722 snapshots of the same shape carry **none** of this mangling, so the
    corruption is specific to this export.)
  - `G6 FMU` carries an interior space (a separate `G6FMU` also exists); `g0jrk`
    is lower-case. Both preserved letter-for-letter.
  - 10 rows assert a callsign with a blank status — data, never backfilled.
- **Provenance witnesses agree**: the copy served live from Ofcom and the copy
  mirrored on UKGWA are **byte-identical** (sha256
  `e438c141…`). The live copy is ingested as the primary raw; the UKGWA mirror
  is the corroborating witness.

## Exchange

No request/response email thread is held; the record is the published CSV itself
and its provenance (captured above and in `meta.json`).
