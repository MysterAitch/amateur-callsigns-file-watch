# Publication record — amateur callsign list (Ofcom open data, "amateur-callsigns-11-nov-2025.csv")

| | |
|---|---|
| **Ofcom reference** | none; an open-data export published as `amateur-callsigns-11-nov-2025.csv` (`?v=407704`) under Ofcom's amateur "manage your licence" resources |
| **Publication channel** | Ofcom open-data CSV, recovered here from an Internet Archive (Wayback) capture dated 2025-12-02 (the `id_` raw replay served the file verbatim) |
| **Data vintage** | **2025-11-11** — corroborated by the filename's `11-nov-2025` **and** the maximum `Licence_Version.LastModifiedDate` in the data (2025-11-11) |
| **Requester** | not applicable (an open-data publication, no request thread) |

## Overview

- **What this entry is**: a full amateur-callsign register export listing every
  callsign with its status, licence product and two licence-version dates. The
  header is the open-data export's Salesforce-flavoured shape —
  `Callsign,Product__c,Status,Type__c,Licence_Version.LastModifiedDate,Licence_Version.Original_start_date__c`
  — a UTF-8 file with a byte-order mark, CRLF line endings, and **five trailing
  columns** the export appends to every row (empty on all but 29 rows — see the
  stray-token anomaly below; csv-parse collapses the five into a single unnamed
  column, carried verbatim in the raw and dropped from the normalised
  projection). It follows
  the 11 September 2025 workbook snapshot
  ([`ofcom-2025-09-11`](../ofcom-2025-09-11--callsigns--all-callsigns/)), which
  carries the same six columns but with ISO dates typed at source.
- **Contents**: 159,895 records — 105,716 `Allocated`, 53,673 `Reserved`,
  495 `Available`, 11 blank status. `Product__c` carries the licence-product
  vocabulary verbatim (Full 61,854 / Foundation 37,995 / Intermediate 14,816 /
  Club 2,222 / Temporary Reciprocal 47 / Special Event Station 5) and is
  **blank on 42,956 rows** — the reserved/available pool the export asserts no
  product for. `Type__c` is `Call Sign - Amateur` on every row (the service
  discriminator), dropped from the normalised projection. The two date columns
  are day-first `DD/MM/YYYY` and **blank on 54,179 rows** (the non-allocated
  pool): last-modified spans 2017-01-27 → 2025-11-11; original-start runs from
  the recurring **1903-05-03** migration-placeholder floor up to 2025-11-11.
- **Anomalies, recorded not repaired**:
  - **47 `M/`-prefixed visitor/reciprocal callsigns** (a visiting licensee's
    home call behind the UK secondary marker), carried verbatim.
  - **2 callsigns carrying a `#` RSL/secondary marker** (`2#0MVL`, `M/#PT2FM`);
    carried verbatim.
  - **15 Excel-mangled callsigns** — Intermediate `20xxx`/`21xxx` callsigns
    whose suffix reads as a month abbreviation were auto-formatted to
    day-month tokens (`20-Apr`, `21-Jan`…) by the spreadsheet tool at Ofcom's
    export; carried verbatim in field 1 as normalised callsign rows, never
    repaired to a guessed suffix (the same artefact class seen in earlier
    register exports).
  - **29 stray month-tokens in the trailing columns** — on 29 rows the fifth
    trailing column carries one of those same 15 mangled tokens (`20-Oct`,
    `20-Jun`…) belonging to a *different* callsign than the row's own field-1
    callsign — a spreadsheet artefact that duplicated the mangled value into an
    adjacent row's overflow column. Each token also appears exactly once as its
    own proper field-1 callsign row, so these 29 occurrences are **redundant
    stray copies — no unique callsign survives only here.** Preserved verbatim
    in the raw; dropped from the normalised projection (the projection carries
    the six documented columns). Recorded here rather than silently discarded.
  - **16 callsigns with lower-case letters**; preserved letter-for-letter.
  - **3 callsigns carrying a trailing non-breaking space** (`G7IWE`, `G0TQK`,
    `2E1HON`) — the file's non-ASCII content; the trailing `0xA0` is trimmed
    and counted by the converter (three cells), never silently. After trimming,
    `G0TQK` coincides with its clean row and appears twice.
  - **Duplicate callsigns** — 213 distinct callsigns repeat in the source
    register; after the NBSP trim the sorted normalised projection carries 214
    duplicated values (the added one is `G0TQK`). Genuine repeats, preserved
    and made adjacent/diffable by the `sorted-by-callsign` order.
- **Provenance**: a single witness — the Wayback capture of Ofcom's open-data
  CSV. No UK Government Web Archive (UKGWA) mirror of this specific dated CSV
  was found; the replay URL and retrieval date are recorded per file under
  `witnesses[]` in `meta.json`, and the original Ofcom URL under
  `publicationUrl`.

## Exchange

No request/response thread is held; the record is the published CSV itself and
its provenance (captured above and in `meta.json`).
