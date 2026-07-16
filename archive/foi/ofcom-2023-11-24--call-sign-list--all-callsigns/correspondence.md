# FOI publication record — amateur callsign list (Ofcom disclosure log, "Call sign list 241123")

| | |
|---|---|
| **Ofcom reference** | **01713103** (recovered via the WhatDoTheyKnow thread; the disclosure-log filename carries none) |
| **Publication channel** | a CSV served directly from Ofcom's website; the same bytes are mirrored on the UK Government Web Archive (UKGWA), and a byte-divergent copy of the same disclosure was served on the WDTK thread |
| **Requested** | 2023-11-08 (received; from the recovered response letter) |
| **Responded** | 2023-12-05 (letter date; data generated 24 November 2023) |
| **Data vintage** | **2023-11-24** — the filename's `241123` and the latest `Last Modified Date` in the data (2023-11-24) agree |
| **Requester** | Andrew Robinson (WDTK user `andrew_robinson_7`) |

## Overview

- **What this entry is**: a full amateur-callsign register export listing every
  callsign with its status, licence product and a per-record last-modified date.
  The header shape is `Value,Status,Product,Type,Call Sign MMSI: Last Modified
  Date` — a Salesforce-era export shape shared with the December 2023 open-data
  list ([`ofcom-2023-12-07`](../ofcom-2023-12-07--open-data-call-sign-list--all-callsigns/))
  and the January 2024 FOI 1734722 disclosure
  ([`ofcom-2024-01`](../ofcom-2024-01--foi-1734722--all-callsigns/)).
- **Contents**: 108,922 records — 99,529 `Allocated`, 9,148 `Reserved`,
  235 `Available`, 10 blank statuses. `Product` carries the licence-product
  vocabulary verbatim (Foundation / Intermediate / Full / Club / Temporary
  Reciprocal); `Type` is `Call Sign - Amateur` on every row (the service
  discriminator). The last-modified dates span 2016-07-23 to 2023-11-24.
- **Anomalies, recorded not repaired**:
  - **13 Excel-mangled callsigns** — Intermediate `20xxx` callsigns whose suffix
    reads as a month abbreviation (`20APR`, `20MAY`, `20NOV`, `21JAN`…) were
    auto-formatted to dates by the spreadsheet tool at Ofcom's export and are
    served as `20-Apr`, `20-May`, `20-Nov`, `21-Jan` and so on. They are carried
    **verbatim**, never repaired back to a guessed suffix — the same class of
    artefact seen in the 2015 typed exports. (The December open-data and FOI
    1734722 snapshots of the same shape carry **none** of this mangling, so the
    corruption is specific to this export.)
  - `G6 FMU` carries an interior space (a separate `G6FMU` also exists); `g0jrk`
    is lower-case. Both preserved letter-for-letter.
  - 10 rows assert a callsign with a blank status — data, never backfilled.
- **Provenance witnesses**: the copy served live from Ofcom and the copy
  mirrored on UKGWA are **byte-identical** (sha256 `e438c141…`) — the live copy
  is ingested as the primary raw and the UKGWA mirror corroborates it. A **third
  copy**, served on the WhatDoTheyKnow thread (FOI 01713103), is the *same
  disclosure* but **not byte-identical**: it differs by two bytes (see below),
  so it is retained in full as a divergent copy rather than folded into the
  witness set.

## Exchange

The **request/response thread is now recovered** via WhatDoTheyKnow
([request 1045020](https://www.whatdotheyknow.com/request/callsign_allocation_data),
requester Andrew Robinson). The FOI 01713103 response letter
([raw extract](raw-extract-foi-01713103-callsign-allocation-data.md)) records
the request as received **8 November 2023**, is dated **5 December 2023**, and
states the data was generated on **24 November 2023** — the vintage this entry
carries. It also preserves Ofcom's explanation that a callsign is marked
Reserved following a licence surrender and generally stays reserved for two
years.

## Divergent copy (collect-all-copies)

The WDTK-served copy `wdtk-1045020-call-sign-list-241123.csv` carries the
identical 108,922 rows in the identical order but is **two bytes larger** than
the held disclosure-log copy. The difference is a byte-encoding artefact on two
heritage callsigns: the disclosure-log copy encodes the trailing non-breaking
space on **G0TQK** (line 99345) and **2E1HON** (line 101998) as a lone `0xA0`
byte (invalid UTF-8 / Latin-1), while the WDTK copy encodes the same trailing
non-breaking space as the well-formed UTF-8 sequence `0xC2 0xA0`. Both copies
normalise identically (the trailing non-breaking space is trimmed at convert
time), so the divergence is cosmetic; both are held so the difference is
directly verifiable. See `divergences[0]` in `meta.json`.
