# Publication record — amateur callsign list (Ofcom open data, "amateur-callsign-list.xlsx")

| | |
|---|---|
| **Ofcom reference** | none; an open-data export published as `amateur-callsign-list.xlsx` (`?v=410856`) under Ofcom's amateur "manage your licence" resources |
| **Publication channel** | Ofcom open-data workbook, recovered here from a UK Government Web Archive (UKGWA) capture dated 2026-02-04 (the `id_` raw replay served the file verbatim) |
| **Data vintage** | **2026-01-14** — corroborated by the workbook's `dcterms:created` (2026-01-14) **and** the maximum `Licence_Version.LastModifiedDate` in the data (2026-01-14) |
| **Requester** | not applicable (an open-data publication, no request thread) |

## Overview

- **What this entry is**: a full amateur-callsign register export in workbook
  form, listing every callsign with its status, licence product and two
  licence-version dates. The single data sheet carries the open-data export's
  Salesforce-flavoured columns
  `Callsign,Product__c,Status,Type__c,Licence_Version.LastModifiedDate,Licence_Version.Original_start_date__c`.
  It follows the 11 November 2025 CSV snapshot
  ([`ofcom-2025-11-11`](../ofcom-2025-11-11--callsigns--all-callsigns/)) and
  shares the six-column shape of the 11 September 2025 workbook
  ([`ofcom-2025-09-11`](../ofcom-2025-09-11--callsigns--all-callsigns/)).
- **Contents**: 146,417 records — 96,155 `Allocated`, 49,723 `Reserved`,
  529 `Available`, 10 blank status. `Product__c` carries the licence-product
  vocabulary verbatim (Full 55,907 / Foundation 34,719 / Intermediate 13,645 /
  Club 2,119 / Temporary Reciprocal 37 / Special Event Station 3) and is
  **blank on 39,987 rows**. Both date columns are ISO (typed at source,
  rendered by the mechanical extract) and **blank on 50,262 rows** (the
  non-allocated pool); `Type__c` is `Call Sign - Amateur` on every row
  (verified constant), dropped from the normalised projection.
- **A cleaner export than the CSV form**: unlike the 11 November 2025 CSV, this
  workbook carries **no Excel-mangled callsigns** (no `20xxx`/`21xxx`
  month-suffix callsign is auto-formatted to a date) and **no trailing-column
  artefacts** — the cells are typed, so the month-suffix Intermediate callsigns
  survive intact. A useful cross-format fidelity contrast: the same register,
  one export corrupted by spreadsheet auto-formatting and one not.
- **Register change vs the previous snapshot (recorded, not reconciled)**:
  ~13,500 fewer records than 11 November 2025 (105,716→96,155 allocated;
  53,673→49,723 reserved; 495→529 available) — a net **removal** from the
  register rather than a shift into the reserved/available pools. Flagged for
  longitudinal analysis; not adjudicated here.
- **Anomalies, recorded not repaired**: 37 `M/`-prefixed visitor/reciprocal
  callsigns; 2 callsigns carrying a `#` RSL/secondary marker; 1 lower-case
  callsign; 3 callsigns carrying a trailing non-breaking space (`G7IWE`,
  `G0TQK`, `2E1HON`), trimmed and counted by the converter; 194 distinct
  duplicate callsigns in the source (195 in the sorted normalised projection
  after the NBSP trim brings `G0TQK` alongside its clean row). Genuine repeats,
  made adjacent by the `sorted-by-callsign` order.
- **Provenance**: a single witness — the UKGWA capture of Ofcom's open-data
  workbook. The replay URL and retrieval date are recorded per file under
  `witnesses[]` in `meta.json`, and the original Ofcom URL under
  `publicationUrl`.

## Exchange

No request/response thread is held; the record is the published workbook itself
and its provenance (captured above and in `meta.json`).
