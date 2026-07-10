# FOI publication record — amateur callsigns register (Ofcom disclosure log, October 2024)

| | |
|---|---|
| **Ofcom reference** | not stated in the material held (published on Ofcom's FOI disclosure log without a visible case number in the file itself) |
| **Publication channel** | Ofcom FOI disclosure log; filed under September 2024, though the filename dates the export 21/10/2024 (`.../about-ofcom/foi/2024/september/copy-of-callsigns-21102024.csv`) |
| **Response date** | not stated (see the vintage caveat below) |
| **Requester** | not known (a disclosure-log publication is not attributed) |
| **Data vintage** | **2024-10-21** — declared from the filename, well-supported by the data (see below) |

## Overview

- **What this entry is**: a full amateur-callsign register export served as a
  CSV on Ofcom's FOI disclosure log — every callsign with its licence product,
  status and a record last-modified date. It is the machine-readable register
  for the October-2024 export, the middle snapshot of the 2024–2025 disclosure-
  log register family.
- **Header shape** (`Callsign,Product,Status,Type,Last Modified Date`): the
  callsign column is spelled `Callsign` (one word); the file carries a UTF-8
  byte-order mark, decoded and stripped by the converter. `Product` is the
  licence class, `Type` the constant discriminator, the last column a record
  last-modified timestamp.
- **Contents**: 156,278 records — 103,632 `Allocated`, 52,160 `Reserved`,
  474 `Available` and 12 blank statuses (preserved as data). Products:
  59,073 Full, 35,969 Foundation, 14,184 Intermediate, 1,893 Club, 97 Temporary
  Reciprocal, and 45,062 blank. `Type` is `Call Sign - Amateur` on every row.
- **Dates**: last-modified values run 2016-07-23 to exactly 2024-10-21 — the
  filename date — which is the strongest support for the vintage; day-first
  ordering is proven by 69,839 day>12 values, none month>12.
- **Anomalies, recorded not repaired**: three callsigns carry a trailing
  non-breaking space at source — `G7IWE`, `G0TQK`, `2E1HON`, the same trio seen
  in the 2019 and 2024 register snapshots — trimmed here (the only
  canonicalisation applied) and counted, never silent. Because each of the trio
  also appears as an ordinary bare-callsign row, the three collapse onto
  duplicate callsign keys in the normalised output — an honest consequence of
  trimming, preserved. `g0jrk` and `2e1GTD` are lower-case; `G6 FMU` carries an
  interior space; 481 four-character and 113 six-to-eight-character callsigns
  appear (heritage and reciprocal forms). All preserved as data.
- **Filing-vs-filename note**: the disclosure is filed on the log under
  September 2024, yet the served filename and the data's own maximum
  last-modified date both say 21 October 2024; the filename date is taken as the
  vintage and the entry keyed to it.
- **Provenance witnesses**: only the live Ofcom disclosure-log copy is held
  (sha256 `44d416b8…`). No UK Government Web Archive capture of these exact bytes
  appears in the harvest manifest, so the vintage rests on a single witness,
  though the filename and the data's maximum last-modified date agree
  internally.

## Exchange

No request/response email thread is held for this disclosure; the record is the
disclosure-log CSV itself and its provenance, captured above.
