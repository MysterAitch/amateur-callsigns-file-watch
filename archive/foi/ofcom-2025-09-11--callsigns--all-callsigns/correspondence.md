# FOI publication record — amateur callsigns register, as at 11 September 2025 (published October 2025)

| | |
|---|---|
| **Ofcom reference** | not held (a disclosure-log publication carries no case reference in the held material) |
| **Publication channel** | Ofcom FOI disclosure log, filed under June 2025; served as `callsigns-spreadsheet-october-2025.xlsx` |
| **Response date** | not held precisely (see the vintage note below) |
| **Requester** | not attributed on the disclosure log; not held |
| **Data vintage** | **2025-09-11** — declared and well-supported (see below); this is the data as-at date, not the October in the filename |

## Overview

- **What this entry is**: a full amateur-callsign register export disclosed as
  an Excel workbook, in a sixth and Salesforce-flavoured shape. Its single
  worksheet's header carries the source system's own object/field names:
  `Callsign, Product__c, Status, Type, Licence LastModifiedDate,
  Licence Original_start_date__c`. It is the register core (`Value/Callsign`,
  `Status`, product) extended with both a record last-modified timestamp and the
  licence's original start (issue) date — richer than the 2024-2025 disclosure-log
  CSVs, which carry the last-modified date but not the original-start date.
- **Contents**: 158,470 records — 105,631 `Allocated`, 52,291 `Reserved`, 534
  `Available`, and 14 blank statuses (preserved as data). `Type` is
  `Call Sign - Amateur` on every row (the service discriminator, not carried
  into the normalised output). Licence product (`Product__c`): 61,393
  `Amateur Full Radio Licence`, 37,656 `Amateur Foundation Radio Licence`,
  14,736 `Amateur Intermediate Radio Licence`, 2,147 `Amateur Club Radio
  Licence`, 123 `Amateur Temporary Reciprocal Radio Licence`, and 42,415 blank
  (the reserved/available pool carries no product).
- **Dates**: `Licence LastModifiedDate` and `Licence Original_start_date__c` are
  each populated on 105,519 rows and blank on 52,951. Last-modified dates run
  `2020-10-15` to `2025-09-11`; original-start dates run `1903-05-03` (the
  recurring migration-placeholder floor seen across the register history) to
  `2025-09-11`. Both arrive typed in the workbook and are rendered ISO
  (date-only) by the mechanical extract; neither may postdate the vintage, so
  both are plausibility-bounded at `2025-09-11`.
- **Anomalies, recorded not repaired** (carried verbatim in the raw extract):
  two call signs are lower-case (`g0jrk`, `2e1GTD`); `G6 FMU` and the reciprocal
  `M/TKG 2021` carry interior spaces; three carry a trailing non-breaking space
  (`2E1HON`, `G7IWE`, `G0TQK`); a single value is literally `.`
  (Foundation, Allocated); and two are full English words — `EDUCATIONAL`
  (11 characters) and `ENVIRONMENTS` (12 characters), both `Amateur Full Radio
  Licence`, `Allocated`. 481 four-character call signs appear (heritage series)
  and 148 run to six characters or more — mostly reciprocal `M/…` forms,
  including curiosities such as `M/#YO3IES`, `M/#VK4VGK`, `M/M/PT2FM` and
  `M/EI-8-DJ`.
- **Trimming and its honest consequence**: the only canonicalisation applied is
  trimming the three trailing non-breaking spaces, counted in the converter
  notes and never silent. Because `G0TQK` and `G7IWE` each also appear as a
  bare-callsign row, trimming collapses those two onto duplicate callsign keys in
  the normalised output — an honest consequence, preserved rather than
  de-duplicated. (`2E1HON`'s non-breaking-space form is the only `2E1HON` row, so
  it does not collide.)
- **Vintage (declared, well-supported)**: the worksheet is named
  `Amateur Callsgn 11092025` and the data's maximum date is exactly `2025-09-11`
  — the two agree, dating the snapshot to **11 September 2025**. This is the
  data's as-at date, *not* the "October 2025" of the published filename: the
  workbook's document properties record it as created on `2025-10-07`, so
  "October 2025" is the export/publication month. The file is additionally filed
  on the disclosure log under June 2025 — a triple label-vs-data discrepancy
  (filed June, titled October, data September), resolved in favour of the data
  and the internally-agreeing sheet name.
- **Provenance — a single witness**: the disclosure rests on one live
  disclosure-log copy (`?v=405457`); no UK Government Web Archive capture of
  these exact bytes appears in the harvest manifest, so the vintage cannot be
  corroborated by an independent retrieval, though the sheet name and the data
  agree internally. The staged raw sha256 (`a94977e7…`) matches the byte size
  recorded in the harvest manifest.
- **Significance**: it is the latest full register snapshot held, following the
  March-2025 disclosure-log CSV
  ([`ofcom-2025-03-13--callsigns--all-callsigns`](../ofcom-2025-03-13--callsigns--all-callsigns/),
  157,227 records) and continuing the register's growth to 158,470 records.

## Exchange

No request/response email thread is held for this disclosure. The record is the
disclosed workbook and its provenance, captured above and in `meta.json`.
