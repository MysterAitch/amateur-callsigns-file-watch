# FOI publication record — amateur callsign list (Ofcom open data, "Call Sign List for Open Data 07-12-23")

| | |
|---|---|
| **Ofcom reference** | none stated; published as `Call-Sign-List-for-Open-Data-07-12-23.csv` under Ofcom's FOI/disclosure area for December 2023 |
| **Publication channel** | a CSV served directly from Ofcom's website (an open-data publication); the same bytes are mirrored on the UK Government Web Archive (UKGWA) |
| **Data vintage** | **2023-12-07** — the filename's `07-12-23` and the latest `Last Modified Date` in the data (2023-12-07) agree |
| **Requester** | not applicable (an open-data publication, no requester) |

## Overview

- **What this entry is**: a full amateur-callsign register export in the same
  Salesforce-era shape as the 24 November 2023 list
  ([`ofcom-2023-11-24`](../ofcom-2023-11-24--call-sign-list--all-callsigns/)),
  published thirteen days later as open data. Header shape
  `Value,Status,Product,Type,Call Sign MMSI: Last Modified Date`.
- **Contents**: 108,992 records — 99,581 `Allocated`, 9,169 `Reserved`,
  233 `Available`, 9 blank statuses. `Product` carries the licence-product
  vocabulary verbatim; `Type` is `Call Sign - Amateur` throughout. The
  last-modified dates span 2016-07-23 to 2023-12-07.
- **Relationship to the 24 November list**: 70 more records than the 24 November
  snapshot, consistent with a fortnight of ordinary register churn.
- **Anomalies, recorded not repaired**:
  - **No Excel-mangled callsigns** — unlike the 24 November list (which carries
    13), this export is free of the `20APR → 20-Apr` date-mangling artefact,
    despite the identical header shape. A genuine divergence between the two
    export runs, recorded not smoothed over.
  - `G6 FMU` carries an interior space; `g0jrk` is lower-case. Preserved
    verbatim.
  - 9 rows assert a callsign with a blank status — data, never backfilled.
- **Provenance witnesses agree**: the live Ofcom copy and the UKGWA mirror are
  **byte-identical** (sha256 `855875…`). The live copy is ingested as the primary
  raw; the UKGWA mirror is the corroborating witness.

## Exchange

No request/response email thread is held; the record is the published CSV itself
and its provenance (captured above and in `meta.json`).
