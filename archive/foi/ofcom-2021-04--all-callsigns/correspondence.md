# FOI publication record — list of all UK amateur radio call signs (Ofcom, spring 2021)

| | |
|---|---|
| **Ofcom reference** | not held (the disclosure is identified only by its Ofcom asset id, 219065, as captured by the UK Government Web Archive) |
| **Publication channel** | UK Government Web Archive (UKGWA) capture of an Ofcom FOI annex workbook |
| **UKGWA capture** | 2023-09-04 (snapshot timestamp `20230904223900`) |
| **Response date** | not held (see the vintage note below) |
| **Requester** | not held |
| **Data vintage** | **2021-04-21** — declared, not proven (an evidenced lower bound; see below) |

## Overview

- **What this entry is**: a full amateur-callsign register export disclosed as an
  Excel workbook ("Amateur radio callsigns"). One worksheet lists every call sign
  with its status, licence product and two dates; the header shape is
  `Value, Status, Type, Reserved to Date, Original start date, Licence type`. It
  is the same six-column register export as the January-2021 annex
  ([`ofcom-2021-01`](../ofcom-2021-01--all-callsigns/)), **differing only in the
  case of two headers** (`Original start date` / `Licence type` here, versus
  `Original Start Date` / `Licence Type` there). Because the converters match
  columns by exact name, each annex binds its own converter variant.
- **Contents**: 147,877 records — 96,936 `Allocated`, 50,627 `Reserved`, 305
  `Available`, and 9 blank statuses. `Type` is `Call Sign - Amateur` on every row
  (the service discriminator, not carried into the normalised output). Licence
  product (`Licence type`): 53,699 `Amateur Full Radio Licence`, 29,246
  `Amateur Foundation Radio Licence`, 12,291 `Amateur Intermediate Radio Licence`,
  1,658 `Amateur Club Radio Licence`, 39 `Amateur Temporary Reciprocal Radio
  Licence`, and 50,944 blank (the reserved/available pool carries no product).
- **Dates**: `Original start date` is populated on 96,869 rows, ranging from
  `1903-05-03` (the recurring migration-placeholder floor) to `2021-04-21`.
  `Reserved to Date` (a reservation expiry) is populated on 123 rows, from
  `2019-03-23` to `2023-04-19` — the latter legitimately after the vintage, as a
  validity end. Dates arrive typed in the workbook and are rendered ISO by the
  mechanical extract; none carry a time-of-day component.
- **Anomalies, recorded not repaired** (carried verbatim in the raw extract):
  one `Value` is empty (blank call sign, `Reserved`); one is literally `,,` (two
  commas, `Reserved`); `G6 FMU` carries an interior space; three call signs carry
  a trailing non-breaking space (`G0TQK`, `G7IWE`, `2E1HON`); two are lower-case
  (`g0jrk`, `2e1GTD`); 475 four-character call signs appear (two-letter-suffix
  heritage series), and 91 run to six–nine characters — mostly reciprocal `M/…`
  forms, including curiosities such as `M/#PT2FM`, `M/#YO3IES` and `M/EI-8-DJ`.
  The normalised projection trims only the three trailing non-breaking spaces,
  and that trim is counted in the converter notes; every other anomaly is
  preserved.
- **Vintage (declared, not proven)**: no report-generation instant is embedded in
  this workbook. The vintage is taken as `2021-04-21`, the most recent `Original
  start date` in the file — a firm lower bound (the snapshot cannot predate its
  most recently issued licence), not a proven generation day. The entry is
  therefore keyed by month (`ofcom-2021-04`).
- **Provenance — a single witness**: this disclosure survives only as a UK
  Government Web Archive capture (snapshot `20230904223900`, 2023-09-04); no
  Ofcom disclosure-log (`live/`) copy is held, so the raw bytes rest on this one
  witness. The staged raw sha256 (`aa336fad…`) matches the byte size recorded in
  the harvest manifest.
- **Drift from the January-2021 snapshot**: 1,114 more records than
  [`ofcom-2021-01`](../ofcom-2021-01--all-callsigns/) (147,877 vs 146,763), with
  the latest `Original start date` advancing from 2021-01-29 to 2021-04-21 — the
  same register, three months on, not a re-disclosure of identical bytes.
- **Significance**: with the January-2021 annex it fills the 2021 gap between the
  September-2019 FOI register
  ([`ofcom-756622`](../ofcom-756622--published-register-csv/), 141,295 records)
  and the March-2022 snapshot
  ([`ofcom-01420046`](../ofcom-01420046--allocated-reserved-callsigns/), 150,181
  records).

## Exchange

No request/response email thread is held for this disclosure. The record is the
archived workbook and its provenance, captured above and in `meta.json`.
