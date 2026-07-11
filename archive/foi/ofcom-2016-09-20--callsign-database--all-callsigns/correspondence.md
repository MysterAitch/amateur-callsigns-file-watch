# FOI publication record — Ofcom callsign database, 20 September 2016 (earliest register snapshot held)

| | |
|---|---|
| **Ofcom reference** | not held (the disclosure is identified only by its Ofcom asset id, 90397, as captured by the UK Government Web Archive) |
| **Publication channel** | UK Government Web Archive (UKGWA) capture of an Ofcom `__data` asset (`Callsign-database-20-Sep.xlsx`) |
| **UKGWA capture** | 2020-04-10 (snapshot timestamp `20200410122042`) |
| **Response date** | not held |
| **Requester** | not held |
| **Data vintage** | **2016-09-20** — proven by the workbook's own document properties (see below) |

## Overview

- **What this entry is**: the **earliest** amateur-callsign register snapshot in
  the archive, and the oldest and sparsest export shape held — a single Excel
  worksheet of just **two** columns, `Call Sign` and `Status`. There is no
  licence class, no date column and no prefix/suffix decomposition; this is the
  register reduced to callsign and status alone. It predates the 2017-07-13
  register ([`ofcom-2017-07-13--all-callsigns`](../ofcom-2017-07-13--all-callsigns/))
  and every open-data publication.
- **Contents**: 139,758 records — 84,690 `Allocated`, 49,624 `Reserved`, 5,431
  `Forbidden`, 3 `Available`, 1 `Quarantine`, and 9 blank statuses (preserved as
  data). The blank-status rows are `G0OXG`, `G1BWQ`, `G1TVX`, `G3TRJ`, `G6AX`,
  `M0SYW`, `M0VII`, `M0ZZV` and `mogfs`.
- **The Forbidden values, folded into the callsign column**: unlike the sibling
  WDTK disclosure (below), this file does **not** isolate the withheld suffixes
  in a separate sheet. It folds 5,431 `Forbidden` values straight into the
  `Call Sign` column — 5,430 of them full callsign-shaped (mostly 20-series
  intermediate callsigns built on withheld suffixes: `20ADS`, `20ASS`, `20BOM`,
  `20BUM`, `20COC`, `20CUM`, …), plus one bare three-letter suffix (`ZBX`).
  These are carried verbatim as `status=Forbidden` observations — the source's
  own single-column structure, not reshaped into a suffix list.
- **Anomalies, recorded not repaired** (carried verbatim in the raw extract):
  two call signs are lower-case (`g0jrk`, and `mogfs` which also has a blank
  status); `G5 ZZ` carries an interior space; 811 four-character call signs
  appear (two-letter-suffix heritage series), five run to six characters
  (`2E1BGN`, `2E1DLR`, `2E1EXP`, `GI0OXB`, `GI4OKU`), and one to seven
  (`M/K2BBC`, a reciprocal form). Thirteen call-sign values occur twice (e.g.
  `21FEB`, `21APR`, `20AUG`, `20JFK`). No non-breaking spaces are present, and
  nothing was trimmed. The normalised projection changes nothing beyond dropping
  the constant, undisclosed licence-class column (there is none to keep).
- **Vintage (proven)**: the workbook's OOXML document properties embed
  `dcterms:created` and `dcterms:modified` of **2016-09-20** (15:13–15:14 UTC),
  authored by "Julia Snape" — a rare case where the export instant is recorded
  in the file itself, so the vintage is proven rather than merely declared. The
  UKGWA capture (2020-04-10) is a later archival event and only bounds when the
  bytes were preserved.
- **Provenance — a single byte-witness, cross-corroborated content**: the raw
  bytes survive only as one UK Government Web Archive capture (snapshot
  `20200410122042`); no Ofcom disclosure-log (`live/`) copy is held. The staged
  raw sha256 (`ebd9e04b…`) matches the byte size recorded in the harvest
  manifest. The register content itself, however, is independently corroborated:
  its 139,758 `Call Sign`/`Status` rows are **byte-for-byte identical** to sheet
  1 of the WhatDoTheyKnow disclosure
  [`wdtk-356636`](../wdtk-356636--all-callsigns-plus-forbidden/) (also dated
  2016-09-20), which carries the same register plus an `SF List` licence-class
  column and a separate forbidden-suffix sheet. This entry is the Ofcom-published
  two-column projection of that same export.
- **Significance**: it opens the register timeline. It sits before the
  2017-07-13 snapshot and roughly two years before the September-2019 FOI
  register ([`ofcom-756622`](../ofcom-756622--published-register-csv/), 141,295
  records), making it the earliest datum for register-growth and
  status-vocabulary comparison.

## Exchange

No request/response email thread is held for this disclosure. The record is the
archived workbook and its provenance, captured above and in `meta.json`.
