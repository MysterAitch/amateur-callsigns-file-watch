# FOI publication record — list of all UK amateur radio call signs (Ofcom, early 2021)

| | |
|---|---|
| **Ofcom reference** | not held (the disclosure is identified only by its Ofcom asset id, 214225, as captured by the UK Government Web Archive) |
| **Publication channel** | UK Government Web Archive (UKGWA) capture of an Ofcom FOI annex workbook |
| **UKGWA capture** | 2023-09-04 (snapshot timestamp `20230904223900`) |
| **Response date** | not held (see the vintage note below) |
| **Requester** | not held |
| **Data vintage** | **2021-01-29** — declared, not proven (an evidenced lower bound; see below) |

## Overview

- **What this entry is**: a full amateur-callsign register export disclosed as an
  Excel workbook annex ("Annex A — list of all call signs"). One worksheet lists
  every call sign with its status, licence product and two dates; the header shape
  is `Value, Status, Type, Reserved to Date, Original Start Date, Licence Type`.
  This is the `Value, Status, Type` register export (as later seen in
  [`ofcom-01420046`](../ofcom-01420046--allocated-reserved-callsigns/)) *extended*
  with a reservation-expiry date, an original-start (issue) date and the licence
  product — richer than the 2022 disclosure, which dropped the date and class
  columns.
- **Contents**: 146,763 records — 96,222 `Allocated`, 50,250 `Reserved`, 281
  `Available`, and 10 blank statuses. `Type` is `Call Sign - Amateur` on every row
  (the service discriminator, not carried into the normalised output). Licence
  product (`Licence Type`): 53,886 `Amateur Full Radio Licence`, 28,595
  `Amateur Foundation Radio Licence`, 12,057 `Amateur Intermediate Radio Licence`,
  1,644 `Amateur Club Radio Licence`, 37 `Amateur Temporary Reciprocal Radio
  Licence`, and 50,544 blank (the reserved/available pool carries no product).
- **Dates**: `Original Start Date` is populated on 96,161 rows, ranging from
  `1903-05-03` (the recurring migration-placeholder floor seen across the
  register history) to `2021-01-29`. `Reserved to Date` (a reservation expiry) is
  populated on 112 rows, from `2021-02-02` to `2023-01-07` — legitimately after
  the vintage, as a validity end. Dates arrive typed in the workbook and are
  rendered ISO by the mechanical extract; none carry a time-of-day component.
- **Anomalies, recorded not repaired** (carried verbatim in the raw extract):
  one `Value` is empty (blank call sign, `Reserved`); one is literally `,,` (two
  commas, `Reserved`); `G6 FMU` carries an interior space; three call signs carry
  a trailing non-breaking space (`G0TQK`, `G7IWE`, `2E1HON`); two are lower-case
  (`g0jrk`, `2e1GTD`); 472 four-character call signs appear (two-letter-suffix
  heritage series), and 87 run to six–nine characters — mostly reciprocal `M/…`
  forms, including curiosities such as `M/#PT2FM`, `M/#YO3IES` and `M/EI-8-DJ`.
  The normalised projection trims only the three trailing non-breaking spaces,
  and that trim is counted in the converter notes; every other anomaly is
  preserved.
- **Vintage (declared, not proven)**: no report-generation instant is embedded
  in this workbook (unlike `ofcom-01420046`, whose sheet name carried a Unix
  epoch). The vintage is taken as `2021-01-29`, the most recent `Original Start
  Date` in the file — a firm lower bound (the snapshot cannot predate its most
  recently issued licence), not a proven generation day. The entry is therefore
  keyed by month (`ofcom-2021-01`).
- **Provenance — a single witness**: this disclosure survives only as a UK
  Government Web Archive capture (snapshot `20230904223900`, 2023-09-04); no
  Ofcom disclosure-log (`live/`) copy is held, so the raw bytes rest on this one
  witness. The staged raw sha256 (`ebd4143c…`) matches the byte size recorded in
  the harvest manifest.
- **Significance**: with [`ofcom-2021-04`](../ofcom-2021-04--all-callsigns/) it
  fills the 2021 gap between the September-2019 FOI register
  ([`ofcom-756622`](../ofcom-756622--published-register-csv/), 141,295 records)
  and the March-2022 snapshot
  ([`ofcom-01420046`](../ofcom-01420046--allocated-reserved-callsigns/), 150,181
  records). Its 146,763 records place it early in that growth.

## Exchange

No request/response email thread is held for this disclosure. The record is the
archived workbook and its provenance, captured above and in `meta.json`.
