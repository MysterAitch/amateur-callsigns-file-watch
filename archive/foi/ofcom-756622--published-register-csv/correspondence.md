# FOI publication record — Ofcom-published CSVs for response 756622

| | |
|---|---|
| **Ofcom reference** | 756622 |
| **Publication channel** | Ofcom FOI-responses pages (`www.ofcom.org.uk/__data/assets/file/0027/166572/…` and `…/0026/165734/…`) |
| **Recovered from** | UK Government Web Archive, capture 2021-12-13 |
| **Requester-side entry** | [`wdtk-596532--allocated-reserved-forbidden`](../wdtk-596532--allocated-reserved-forbidden/) (Roger Howell; letter, annex and full thread transcript there) |
| **Response date** | 2019-09-06 (requester); published export dated 2019-09-12 |
| **Data vintage** | 2019-09-12 (from the filename; see Overview) |

## Overview

- **What this entry is**: Ofcom's publication of FOI response 756622 as two
  CSVs — a distinct disclosure event from the requester-channel response
  (which served an xlsx annex "as at the date of your request",
  2019-08-12).
- **The register CSV is not a byte- or shape-copy of the annex**: header
  `Call Sign,Status,Licence Class,Licence Issued Date` — it carries a
  **`Licence Issued Date` column absent from the requester annex**, and its
  141,295 data rows (verified by line count) exactly match the annex's
  record count. The likeliest reading is the same underlying snapshot
  re-exported with an extra column for publication, dated 2019-09-12; a
  content diff at converter time confirms or refutes.
- **First row oddity, recorded not interpreted**: the file opens with
  `G4IFJ,Allocated,Full,03/05/1903` — it appears sorted by issued date
  ascending, and the 1903 date at the top is presumably a
  migration/placeholder artefact predating amateur licensing in its modern
  form. Issue-date data quality is a converter-time question.
- **The second CSV is the forbidden-suffixes list** (header `NAME`,
  1,465 rows — matching the annex's Forbidden Call Signs tab extent).
- **Significance**: publication came six days after the requester
  response, within the same weeks as the requester's periodic-publication
  ask ("actively considering", 2019-09-18) — and the published form is
  CSV, the format the open-data page would later adopt. The
  `Licence Issued Date` column makes this the earliest known bulk
  disclosure of per-callsign issue dates.

## Exchange

The request/response exchange is transcribed in the wdtk-596532 entry;
this entry records the publication event, not the exchange.
