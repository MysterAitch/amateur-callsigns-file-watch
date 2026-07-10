# FOI publication record — amateur callsigns (Ofcom FOI 1734722, "complete spreadsheet")

| | |
|---|---|
| **Ofcom reference** | FOI 1734722 |
| **Publication channel** | a CSV served directly from Ofcom's website, published in the disclosure log for January 2024 alongside a response PDF ("FOI-1734722-Amateur-Radio-Callsign-complete-Spreadsheet.pdf"); the same CSV bytes are mirrored on the UK Government Web Archive (UKGWA) |
| **Data vintage** | **~January 2024** (declared, not proven) — the latest `Last Modified Date` in the data is 2023-12-19, so the export was taken on or after that date; the exact snapshot day is not stated (see the caveat below) |
| **Requester** | not known (name not disclosed) |

## Overview

- **What this entry is**: the *complete* amateur-callsign register disclosed
  under FOI 1734722 — the response document is titled "Amateur Radio Callsign
  complete Spreadsheet". Same header shape as the two December 2023 lists
  (`Value,Status,Product,Type,Call Sign MMSI: Last Modified Date`) but a fuller
  extract.
- **Contents**: 153,938 records — 101,947 `Allocated`, 51,533 `Reserved`,
  447 `Available`, 11 blank statuses.
- **Why it is ~45,000 records larger than the December lists**: it carries the
  full **reserved pool** — 44,860 rows have a blank `Product` (almost all
  `Reserved`) that the open-data lists omit. This is the "blank-product"
  population appearing in full, not an error.
- **Richer product vocabulary**: as well as the five products in the December
  lists, three rows carry a `Special Event Station` product (`G4ZUL`, `G6DGK`,
  `M0MBB`).
- **Anomalies, recorded not repaired**:
  - **The NBSP trio** — `2E1HON`, `G0TQK` and `G7IWE` each carry a trailing
    non-breaking space (the same trio seen in the 2019 and 2024-10 snapshots).
    The trim is the *only* canonicalisation applied and it is counted, never
    silent; the December lists of the same shape do **not** carry it.
  - `W4WNZ` — a `W`-prefix (non-UK-style) callsign sits in the reserved pool
    with a blank product; carried verbatim.
  - `G6 FMU` interior space; `g0jrk` lower-case; a 10-character callsign and
    several 7–9 character reciprocal/regional forms — all preserved.
  - 11 rows assert a callsign with a blank status — data, never backfilled.
  - No Excel date-mangling of `20xxx` callsigns (unlike the 24 November list).
- **Vintage caveat (declared, not proven)**: the disclosure appears in the
  January 2024 disclosure log and the register is served under the `2024/january`
  path, but the CSV states no snapshot date. The latest last-modified date in the
  data (2023-12-19) is a firm *lower bound* on the snapshot date; the true
  capture likely falls between then and the January 2024 response. The entry is
  keyed at month precision (`ofcom-2024-01`) rather than inventing a day.
- **Provenance witnesses agree**: the live Ofcom copy and the UKGWA mirror are
  **byte-identical** (sha256 `b4f264…`). The live copy is ingested as the primary
  raw; the UKGWA mirror is the corroborating witness. (The companion response PDF
  is recorded here as context but is not part of this entry.)

## Exchange

No request/response email thread is held; the record is the published CSV itself
and its provenance (captured above and in `meta.json`).
