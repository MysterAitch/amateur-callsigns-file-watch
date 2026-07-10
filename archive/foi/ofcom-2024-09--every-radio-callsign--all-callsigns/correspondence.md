# FOI publication record — amateur callsign list (Ofcom disclosure log, "Every radio callsign spreadsheet")

| | |
|---|---|
| **Ofcom reference** | none stated on the disclosure; the file is published as `every-radio-callsign-spreadsheet.csv` under Ofcom's FOI/disclosure area for September 2024 |
| **Publication channel** | a CSV served directly from Ofcom's website (`.../about-ofcom/foi/2024/september/every-radio-callsign-spreadsheet.csv`) |
| **Data vintage** | **2024-09** (month-level) — filed under the September 2024 disclosure area; the latest `Created Date` in the data is 2024-09-10, consistent with a September vintage; the exact snapshot day is not stated, so the entry is keyed by month |
| **Requester** | not known (a disclosure-log/open-data style publication, no requester named) |

## Overview

- **What this entry is**: a full amateur-callsign register export — the widest
  register shape held — with header `Created Date,Product,Reserved to Date,
  Status,Type,Value`. `Value` is the callsign, `Product` the licence
  product/class, `Status` the status; `Created Date` is the record-creation
  timestamp and `Reserved to Date` a reservation expiry. It is the next
  snapshot after the April 2024 Salesforce export
  ([`ofcom-2024-04-30`](../ofcom-2024-04-30--copy-all-callsigns--all-callsigns/)).
- **Contents**: 159,999 records — 103,621 `Allocated`, 53,230 `Reserved`,
  3,134 `Available`, 14 blank statuses. `Product` carries the licence-product
  vocabulary verbatim (Full 59,053 / Foundation 35,780 / Intermediate 14,156 /
  Club 1,892 / Temporary Reciprocal 103, plus a special-event/permit family:
  Special Event Station 1,316 / NoV Special Event Station 2,256 / NoV Special
  Special Event Station 143 / Perm Special Event Station 32 / NoV Permanent
  Special Event Station 21 / Special Research Permit 1) and is **blank on 45,246
  rows** — the reserved pool. `Created Date` values span 2016-07-23 to
  2024-09-10; `Reserved to Date` is present on 4,319 rows, spanning 2016-01-04
  to a `2099-12-31` "permanent" placeholder (a reservation expiry, legitimately
  in the future).
- **`Type` is a per-row assertion here, uniquely**: unlike every other register
  snapshot, `Type` is **not constant** — it carries `Call Sign - Amateur`
  (156,048) **and** `Call Sign - NoV` (3,951, the Notice-of-Variation
  special-event and permit callsigns). It is **not derivable from `Product`**
  (the `Special Event Station` product appears under both types: 5 Amateur, 1,311
  NoV), so dropping it would erase the NoV distinction. It is carried verbatim
  as the `call_sign_type` column — the one register shape where the type is kept.
- **Anomalies, recorded not repaired**:
  - **One `.` callsign and two blank callsigns** — the source asserts a
    callsign of a single full stop and, separately, two rows with an empty
    `Value`; preserved as data, sorted first under the codepoint order.
  - **Four trailing non-breaking spaces** (`2E1HON`, `G0TQK`, `G7IWE`,
    `GB2DWM`) — UTF-8-encoded `0xC2 0xA0`; trimmed and counted, never silent.
    After trimming, `G0TQK`, `G7IWE` and `GB2DWM` collide with their clean
    counterparts (duplicate callsigns on the record).
  - **Four interior-space callsigns**: `G6 FMU`, `GB 8IMD`, `GB GU75LIB`,
    `M/TKG 2021` — interior whitespace is part of the assertion and is kept.
  - **15 Excel-mangled callsigns** (`20-Apr`…`21-Oct`), plus a numeric-only
    `22032024` (a `22/03/2024` date auto-mangled by the spreadsheet tool) —
    carried verbatim, never repaired.
  - `g0jrk` and `2e1GTD` are lower-case; 153 callsigns exceed seven characters
    (`GB100…` centenary specials, `EDUCATIONAL`, `ENVIRONMENTS`). All carried
    unfiltered.
  - 14 rows assert a callsign with a blank status — data, never backfilled.
- **Provenance**: a single witness — the copy served live from Ofcom's
  disclosure area. No UK Government Web Archive (UKGWA) mirror of this specific
  September 2024 export was found.

## Exchange

No request/response email thread is held; the record is the published CSV itself
and its provenance (captured above and in `meta.json`).
