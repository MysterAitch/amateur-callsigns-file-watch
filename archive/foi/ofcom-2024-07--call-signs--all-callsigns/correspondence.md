# FOI publication record — amateur callsigns register (Ofcom disclosure log, July 2024)

| | |
|---|---|
| **Ofcom reference** | not stated in the material held (the CSV is published on Ofcom's FOI disclosure log without a visible case number in the file itself) |
| **Publication channel** | Ofcom FOI disclosure log, filed under July 2024 (`.../about-ofcom/foi/2024/july/call-signs.csv`) |
| **Response date** | not stated (see the vintage caveat below) |
| **Requester** | not known (a disclosure-log publication is not attributed) |
| **Data vintage** | **2024-07** — declared to month precision, not proven (see the caveat below) |

## Overview

- **What this entry is**: a full amateur-callsign register export served as a
  CSV on Ofcom's FOI disclosure log — every callsign with its licence product,
  status and a record last-modified date. It is the machine-readable register
  for the July-2024 window, one of a family of near-identical disclosure-log
  register CSVs spanning 2024–2025.
- **Header shape** (`Call sign,Product,Status,Type,Call Sign MMSI: Last Modified
  Date`): the callsign column is spelled `Call sign` (with a space); `Product`
  is the licence class; `Type` is the constant service discriminator; the final
  column is a record last-modified timestamp. No byte-order mark.
- **Contents**: 155,346 records — 102,936 `Allocated`, 51,955 `Reserved`,
  444 `Available` and 11 blank statuses (preserved as data). Products:
  58,987 Full, 35,336 Foundation, 14,051 Intermediate, 1,881 Club, 90 Temporary
  Reciprocal, and 45,001 blank (Product is undisclosed for most Reserved and
  Available callsigns). `Type` is `Call Sign - Amateur` on every row.
- **Dates**: last-modified values run 2016-07-23 (a bulk migration floor shared
  across the family) to 2024-06-14; day-first ordering is proven by 61,880
  day>12 values, none month>12.
- **Anomalies, recorded not repaired**: two callsigns are Excel date-mangled at
  source — `21-Feb` (Reserved) and `21-Oct` (Allocated) — carried verbatim, never
  reconstructed to a guessed suffix; `g0jrk` and `2e1GTD` are lower-case;
  `G6 FMU` carries an interior space; and the register holds 465 four-character,
  39 six-, 34 seven- and 45 eight-character callsigns (heritage two-letter and
  reciprocal `M/…` forms). All preserved as data, never cleaned.
- **Vintage caveat (declared, not proven)**: the file is published on the
  disclosure log under July 2024 but is served simply as `call-signs.csv` with
  no day in its name and no in-file response date; the exact day within July is
  therefore not asserted and the entry is keyed to the month. The month is
  well-supported: the disclosure-log path files it under July 2024 and the
  last-modified dates top out at 2024-06-14, immediately before it.
- **Provenance witnesses**: only the live Ofcom disclosure-log copy is held
  (sha256 `232335fe…`). No UK Government Web Archive capture of these exact bytes
  appears in the harvest manifest, so the vintage rests on a single witness and
  cannot be cross-corroborated by an independent retrieval (contrast
  `ofcom-01420046`, corroborated by a UKGWA mirror).

## Exchange

No request/response email thread is held for this disclosure; the record is the
disclosure-log CSV itself and its provenance, captured above.
