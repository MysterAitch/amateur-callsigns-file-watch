# FOI publication record — available and registered UK amateur radio callsigns (Ofcom 01432624)

| | |
|---|---|
| **Ofcom reference** | 01432624 |
| **Publication channel** | Ofcom FOI disclosure log, filed under March 2022; a workbook data annex and a companion response PDF |
| **Response date** | not held precisely (filed under March 2022; see the vintage note below) |
| **Requester** | not attributed on the disclosure log |
| **Data vintage** | **2022-03-14** — declared and well-supported (see below) |

## Overview

- **What this entry is**: a full amateur-callsign register export disclosed as an
  Excel workbook alongside Ofcom's FOI response 01432624. The single worksheet
  lists every callsign with its status; the header shape is `Value, Status, Type`
  — the identical three-column export as [`ofcom-01420046`](../ofcom-01420046--allocated-reserved-callsigns/),
  disclosed a week earlier.
- **Contents**: 150,238 records — 98,575 `Allocated`, 51,271 `Reserved`, 380
  `Available`, and 12 blank statuses. `Type` is `Call Sign - Amateur` on every
  row (the service discriminator). No licence class and no dates are disclosed.
- **Anomalies, recorded not repaired**: one `Value` is literally `,,` (two
  commas) carrying a `Reserved` status; `G6 FMU` carries an interior space; three
  callsigns carry a trailing non-breaking space (`G0TQK`, `G7IWE`, `2E1HON`);
  two callsigns are lower-case (`g0jrk`, `2e1GTD`); 480 four-character callsigns
  appear (two-letter-suffix heritage series), and 38 callsigns run to eight or
  nine characters — mostly reciprocal `M/…` forms, including curiosities such as
  `M/#PT2FM`, `M/#VK4VGK`, `M/#YO3IES` and `M/EI-8-DJ`. All are kept verbatim in
  the raw extract; the normalised projection trims only the trailing non-breaking
  spaces, and that trim is counted in the converter notes.
- **Vintage (declared, well-supported)**: the worksheet name,
  `Report1647268967067`, embeds the report-generation instant as a Unix epoch in
  milliseconds — 1647268967067 = 2022-03-14T14:42:47Z. Ofcom filed the response
  under March 2022. This is one week after the byte-identical-shaped `ofcom-01420046`
  export (`Report1646659776237` = 2022-03-07T13:29:36Z), and the record grew by
  57 rows over that week.
- **Provenance (single witness)**: the workbook is held from ONE channel only —
  the UK Government Web Archive capture of Ofcom's asset library (asset 234734,
  captured 2023-09-04). The disclosure-log copy of case 01432624 that survives on
  the live site is the companion PDF, not this workbook, so no byte-level
  live↔archive cross-check is possible here (contrast the 2023 snapshots in this
  batch, which are dual-witnessed and byte-identical). Recorded honestly rather
  than asserting an agreement that cannot be checked.

## Exchange

No request/response email thread is held for this disclosure. The record is the
disclosed workbook and its provenance, captured above and in `meta.json`.
