# FOI publication record — list of allocated and reserved amateur radio callsigns (Ofcom 01420046)

| | |
|---|---|
| **Ofcom reference** | 01420046 |
| **Publication channel** | Ofcom FOI disclosure log (published-responses page), filed under March 2022; the workbook annex and a companion response PDF |
| **Response date** | not held precisely (filed under March 2022; see the vintage note below) |
| **Requester** | not attributed on the disclosure log; the project source register associates the response with a WhatDoTheyKnow request by Gareth Steele (February 2022), recorded but not re-verified here |
| **Data vintage** | **2022-03-07** — declared and well-supported (see below) |

## Overview

- **What this entry is**: a full amateur-callsign register export disclosed as an
  Excel workbook alongside Ofcom's FOI response 01420046. Sheet 1 lists every
  callsign with its status; the header shape is `Value, Status, Type` — the same
  three-column export the open-data lane would later publish, but reduced from
  the 2017 register's `Value, Prefix, Suffix, Type, Status` (Ofcom's own
  prefix/suffix decomposition is not present here).
- **Contents (sheet 1)**: 150,181 records — 98,521 `Allocated`, 51,271
  `Reserved`, 377 `Available`, and 12 blank statuses. `Type` is
  `Call Sign - Amateur` on every row (the service discriminator). No licence
  class is disclosed.
- **The "allocated and reserved" label vs the data**: the FOI is titled a list
  of *allocated and reserved* callsigns, yet the export also carries 377
  `Available` rows and 12 blank statuses. These are preserved as data, not
  reconciled to the title.
- **Anomalies, recorded not repaired**: one `Value` is literally `,,` (two
  commas) carrying a `Reserved` status; `G6 FMU` carries an interior space (the
  same anomaly seen in the 2017 register); three callsigns carry a trailing
  non-breaking space (`G0TQK`, `G7IWE`, `2E1HON`); 479 four-character callsigns
  appear (two-letter-suffix heritage series), and 96 callsigns run to six, seven,
  eight or nine characters — mostly reciprocal `M/…` forms, including curiosities
  such as `M/M/PT2FM`, `M/#YO3IES`, `M/#VK4VGK` and `M/EI-8-DJ`. All are kept
  verbatim in the raw extract; the normalised projection trims only the trailing
  non-breaking spaces, and that trim is counted in the converter notes.
- **The second worksheet**: the workbook carries a second sheet (`Sheet1`) — a
  header-less single column of 36,526 callsigns, every one of them a subset of
  sheet 1 and appearing in sheet 1's own row order (an order-preserving
  subsequence spanning all statuses). The material discloses no purpose for it,
  and it asserts no status or attribute of its own. It is preserved verbatim as a
  raw extract but deliberately **not** normalised into a dataset: doing so would
  invent a set-membership meaning the source never states. Absence of an
  explanation is recorded, not guessed at.
- **Vintage (declared, well-supported)**: sheet 1's worksheet name,
  `Report1646659776237`, embeds the report-generation instant as a Unix epoch in
  milliseconds — 1646659776237 = 2022-03-07T13:29:36Z. Ofcom filed the response
  under March 2022, and the disclosed bytes are byte-identical across the live
  disclosure-log copy and the UK Government Web Archive capture (both sha256
  `8a61da94…`), so the vintage is corroborated by two independent retrievals.
- **Significance**: it sits between the September-2019 FOI register
  ([`ofcom-756622`](../ofcom-756622--published-register-csv/), 141,295 records)
  and the October-2024 FOI register
  ([`wdtk-1180568`](../wdtk-1180568--licence-breakdown-duration-age/)), and lands
  roughly two months before the earliest open-data publication (2022-05-30) — a
  cross-lane comparison point at the moment the register was about to become a
  live open-data feed.

## Exchange

No request/response email thread is held for this disclosure. The record is the
disclosed workbook and its provenance, captured above and in `meta.json`.
