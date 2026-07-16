# FOI correspondence — "Club amateur radio call signs" (23 April 2020)

| | |
|---|---|
| **Ofcom reference** | 00896085 |
| **WDTK request** | https://www.whatdotheyknow.com/request/club_amateur_radio_call_signs (id 896085) |
| **Requester** | Billy McFarland (WDTK user `billy_mcfarland`) |
| **Requested** | 2020-04-08 |
| **Responded** | 2020-04-30 |
| **Data vintage** | **2020-04-23** — the disclosed list is named "Copy of Club Call Signs 23 04 20" |
| **Outcome** | successful |

## Overview

- **Asked**: a list (spreadsheet) of all club amateur radio callsigns issued to
  date.
- **Provided**: a 41-page Save-As-PDF list of the club callsigns Ofcom holds —
  **all licences that are live or were cancelled after 1 April 2014** (Ofcom
  does not hold records of licences cancelled before that date). See the
  [response letter extract](raw-extract-00896085-club-amateur-radio-call-signs.md).
- **Nature — per-licence-record, not a register snapshot**: the list carries
  **2,049 records** with one of three statuses — **1,613 Live, 258 Surrendered,
  178 Terminated**. Because it enumerates *licence records* (live plus
  cancelled-after-2014) rather than one row per callsign, **209 callsigns
  recur**: `G0TRG` appears four times (Live once, Surrendered twice, Terminated
  once). Twelve records carry a status with an **empty callsign cell** (all
  Terminated, on pages 39–41) — a genuine feature of the disclosed document,
  confirmed both by content-stream analysis and by visual inspection of the
  source. The column header names "Call sign / T-number", but **no T-number
  token appears** — every non-blank value is an ordinary callsign.

## Provenance and chain of custody

The disclosure was served through the WhatDoTheyKnow thread above. The two
disclosed PDFs are held verbatim; their bytes are pinned by sha256 in
`meta.json` and were carried unchanged from the retained originals:

| file | bytes | sha256 |
|---|---:|---|
| `00896085-club-amateur-radio-call-signs.pdf` (response letter) | 198067 | `125bc1fd5f88a09ee44d971861cada722a0ee5ca60931f5197fda9e59ff853ae` |
| `copy-of-club-call-signs-23-04-20.pdf` (the list) | 496186 | `585a933cea6089ebaedfcc77fb7805807f1224d3ffd3d7f25eb1595e17d17410` |

## Extraction

The list PDF is the raw truth. Its records are transcribed into
`club-callsigns.csv` by the committed PDF-table extractor
(`src/shared/pdf-table-extract.ts`, Node built-ins only), which runs a full
content-stream interpreter so any deviation from the expected two-column shape
surfaces rather than being mis-parsed. The extract is the converter's parse
source; the extractor reproduces it byte-identically from the committed PDF, and
the self-check test asserts that re-derivation together with the reconciliation
arithmetic (2,049 rows; 4,088 text operators reconciling to 4,088 shows;
per-status counts; 209 recurring callsigns; 12 blank-callsign rows). The
normalised projection carries `callsign,status` only — the extract's page and
row positions are layout provenance, not per-row assertions.
