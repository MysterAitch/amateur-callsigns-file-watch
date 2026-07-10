# FOI publication record — amateur callsign list (Ofcom disclosure log, "Copy all call signs 30 Apr 24")

| | |
|---|---|
| **Ofcom reference** | none stated on the disclosure; the file is published as `copy-all-callsigns-30-apr-24.csv` under Ofcom's FOI/disclosure area for May 2024 |
| **Publication channel** | a CSV served directly from Ofcom's website (`.../about-ofcom/foi/2024/may/copy-all-callsigns-30-apr-24.csv`) |
| **Data vintage** | **2024-04-30** — from the filename's `30-apr-24`; this export carries no per-record date column to corroborate the day independently |
| **Requester** | not known (a disclosure-log/open-data style publication, no requester named) |

## Overview

- **What this entry is**: a full amateur-callsign register export listing every
  callsign with its status and licence product. The header shape is
  `Value__c,Product__c,Status__c,Type__c` — a Salesforce object-export shape
  (the `__c` suffix is Salesforce's custom-field marker), the only disclosure
  held in that shape. It sits between the January 2024 FOI 1734722 snapshot
  ([`ofcom-2024-01`](../ofcom-2024-01--foi-1734722--all-callsigns/)) and the
  September 2024 snapshot
  ([`ofcom-2024-09`](../ofcom-2024-09--every-radio-callsign--all-callsigns/)).
- **Contents**: 154,582 records — 102,533 `Allocated`, 51,903 `Reserved`,
  145 `Available`, 1 blank status. `Product__c` carries the licence-product
  vocabulary verbatim (Full 58,928 / Foundation 35,075 / Intermediate 13,975 /
  Club 1,821 / Special Event Station 5 / Temporary Reciprocal 1) and is **blank
  on 44,777 rows** — the reserved pool the export asserts no product for.
  `Type__c` is `Call Sign - Amateur` on every row (the service discriminator),
  and is dropped from the normalised projection.
- **Anomalies, recorded not repaired**:
  - **15 Excel-mangled callsigns** — Intermediate `20xxx`/`21xxx` callsigns
    whose suffix reads as a month abbreviation (`20APR`, `20NOV`, `21JAN`…)
    were auto-formatted to dates by the spreadsheet tool at Ofcom's export and
    are served as `20-Apr`, `20-Nov`, `21-Jan` and so on. Carried **verbatim**,
    never repaired back to a guessed suffix — the same artefact class seen in
    the November 2023 list and the 2015 typed exports.
  - **Two over-length callsigns**, `EDUCATIONAL` (11) and `ENVIRONMENTS` (12) —
    special-event/educational allocations, longer than any ordinary callsign;
    carried unfiltered.
  - `g0jrk` is lower-case; preserved letter-for-letter.
  - `G7IWE` carries a **trailing raw `0xA0` (non-breaking space)** byte — the
    published file is latin-1, and the single high byte in the whole file is
    this one. Trimming is the only canonicalisation applied and it is counted,
    never silent. After trimming, `G7IWE` and `G0TQK` each appear **twice** (a
    genuine duplicate callsign in the source, in `G7IWE`'s case the clean row
    plus the NBSP row).
  - 1 row asserts a callsign with a blank status — data, never backfilled.
- **Provenance**: a single witness — the copy served live from Ofcom's
  disclosure area. No UK Government Web Archive (UKGWA) mirror of this specific
  2024-04-30 export was found; the earlier register CSVs on UKGWA are different
  vintages and shapes.

## Exchange

No request/response email thread is held; the record is the published CSV itself
and its provenance (captured above and in `meta.json`).
