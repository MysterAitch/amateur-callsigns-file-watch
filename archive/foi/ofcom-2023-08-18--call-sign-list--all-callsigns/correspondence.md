# FOI publication record — call sign list, 18 August 2023 (Ofcom 01649066)

| | |
|---|---|
| **Ofcom reference** | 01649066 |
| **Publication channel** | Ofcom FOI disclosure log, filed under August 2023 |
| **Requested** | 2023-07-24 (recovered from the now-held response letter) |
| **Response date** | 2023-08-21 (letter date; data generated 18 August 2023) |
| **Requester** | not named on the disclosure log or in the letter |
| **Data vintage** | **2023-08-18** — declared and well-supported (see below) |

## Overview

- **What this entry is**: a full amateur-callsign register export disclosed as an
  Excel workbook alongside Ofcom's FOI response 01649066. The single worksheet
  (`Call Sign Data`) lists every callsign with its licence product, status and a
  record last-modified date; the header shape is `Value, Product, Status, Type,
  Call Sign MMSI: Last Modified Date` — the five-column Value/Status/Product
  family, with the constant `Call Sign - Amateur` `Type` discriminator.
- **Contents**: 153,248 records — 101,381 `Allocated`, 51,416 `Reserved`, 440
  `Available`, and 11 blank statuses. `Product` carries the source's own licence
  vocabulary verbatim: 60,566 `Amateur Full Radio Licence`, 34,054
  `Amateur Foundation Radio Licence`, 13,994 `Amateur Intermediate Radio Licence`,
  2,048 `Amateur Club Radio Licence`, 84 `Amateur Temporary Reciprocal Radio
  Licence`, and 42,502 blank (the reserved pool). Unlike the 25 January 2023
  snapshot, this export carries no `Special Event Station` product. `Type` is
  `Call Sign - Amateur` on every row. Last-modified dates span 2016-07-23 to
  2023-08-17.
- **Anomalies, recorded not repaired**: the trailing non-breaking-space trio
  (`G0TQK`, `G7IWE`, `2E1HON`) is trimmed-and-counted at normalise time; `G6 FMU`
  keeps its interior space; `g0jrk` and `2e1GTD` keep their lower case; 480
  four-character heritage callsigns appear, and 46 callsigns run to eight or nine
  characters — reciprocal `M/…` forms including `M/#PT2FM`, `M/#VK4VGK`,
  `M/#YO3IES` and `M/EI-8-DJ`. This snapshot carries no blank callsign, no `,,`
  value and no Excel date-mangling (contrast the 25 January 2023 snapshot).
- **Vintage (declared, well-supported)**: the worksheet name (`Call Sign Data`)
  embeds no timestamp, but the served filename dates the export `18-08-2023` and
  the latest `Last Modified Date` in the data is 2023-08-17, a firm lower bound
  sitting one day inside the filename date.
- **Provenance (dual witness, byte-identical)**: the workbook is held from two
  independent channels — the live disclosure-log copy and the UK Government Web
  Archive mirror (asset 266625) — and the two are byte-identical (same sha256
  `016c51c3…`), so the provenance witnesses agree.

## Exchange

The **response letter is now held**
([raw extract](raw-extract-amateur-radio-callsign-allocation-as-of-july-2023.md)):
it records the request as received **24 July 2023**, is dated **21 August
2023**, and states the data was generated on **18 August 2023** — the vintage
this entry carries. The request wording is quoted within it: *"a list of all UK
amateur radio callsigns previously allocated as of July 2023, showing the type
of the licence, the current status (e.g. allocated, reserved), and, where
possible, the date of allocation for each callsign."* No requester-side email
thread is held (the requester is not named), and the disclosed workbook itself
remains double-witnessed and byte-identical across the live disclosure log and
the UK Government Web Archive, as captured above and in `meta.json`.

A later request, [`wdtk-1021241`](../wdtk-1021241--licence-class-format-mismatch-not-held/)
(FOI 01667041, September 2023), builds directly on this disclosure — citing it
by reference and picking out M5SHA in it as a Foundation licence carrying a
Full-format callsign.
