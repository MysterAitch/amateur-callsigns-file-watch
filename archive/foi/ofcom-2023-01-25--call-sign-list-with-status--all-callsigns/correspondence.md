# FOI publication record — call sign list with status, 25 January 2023 (Ofcom)

| | |
|---|---|
| **Ofcom reference** | not stated (published on the FOI disclosure log without a case number) |
| **Publication channel** | Ofcom FOI disclosure log, filed under February 2023 |
| **Response date** | not held precisely (filed under February 2023; see the vintage note below) |
| **Requester** | not attributed on the disclosure log |
| **Data vintage** | **2023-01-25** — declared and well-supported (see below) |

## Overview

- **What this entry is**: a full amateur-callsign register export disclosed as an
  Excel workbook on Ofcom's FOI disclosure log. The single worksheet lists every
  callsign with its status, licence product and a record last-modified date; the
  header shape is `Value, Status, Product, Call Sign MMSI: Last Modified Date`.
  This is the earliest snapshot held in the Value/Status/Product export family
  and the ONLY one without a `Type` column (four columns rather than five).
- **Contents**: 152,084 records — 100,351 `Allocated`, 51,301 `Reserved`, 422
  `Available`, and 10 blank statuses. `Product` carries the source's own licence
  vocabulary verbatim: 58,725 `Amateur Full Radio Licence`, 33,190
  `Amateur Foundation Radio Licence`, 13,551 `Amateur Intermediate Radio Licence`,
  1,829 `Amateur Club Radio Licence`, 75 `Amateur Temporary Reciprocal Radio
  Licence`, 2 `Special Event Station`, and 44,712 blank (the reserved pool).
  Last-modified dates span 2016-07-23 to 2023-01-25.
- **Anomalies, recorded not repaired**: TWO records carry a blank `Value` (an
  empty callsign with a status and last-modified date) — these sort first in the
  normalised output. One `Value` is literally `,,` (two commas). Fifteen `Value`
  cells were mangled into dates by Excel at Ofcom's export and are rendered ISO by
  the mechanical extract — e.g. `2023-11-20`, `2023-03-20`, `2023-05-20` (all
  Intermediate `20…` callsigns whose suffix read as a date); they are carried
  verbatim as callsigns, never reconstructed to a guessed suffix. The trailing
  non-breaking-space trio (`G0TQK`, `G7IWE`, `2E1HON`) is trimmed-and-counted at
  normalise time; `G6 FMU` keeps its interior space; `g0jrk` and `2e1GTD` keep
  their lower case; the reciprocal `M/…` forms (including `M/#PT2FM`) survive
  verbatim.
- **Vintage (declared, well-supported)**: three independent signals agree. The
  worksheet name `Report1674642037414` embeds the report-generation instant
  (1674642037414 = 2023-01-25T10:20:37Z); the served filename dates the export
  `25-01-2023`; and the latest `Last Modified Date` in the data is exactly
  2023-01-25.
- **Provenance (dual witness, byte-identical)**: the workbook is held from two
  independent channels — the live disclosure-log copy and the UK Government Web
  Archive mirror (asset 253624) — and the two are byte-identical (same sha256
  `73d17c0c…`), so the provenance witnesses agree.

## Exchange

No request/response email thread is held for this disclosure. The record is the
disclosed workbook and its provenance, captured above and in `meta.json`.
