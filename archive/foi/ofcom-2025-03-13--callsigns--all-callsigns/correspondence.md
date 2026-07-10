# FOI publication record — amateur callsigns register (Ofcom disclosure log, March 2025)

| | |
|---|---|
| **Ofcom reference** | not stated in the material held (published on Ofcom's FOI disclosure log without a visible case number in the file itself) |
| **Publication channel** | Ofcom FOI disclosure log; filed under January 2025, though the filename dates the export 13/03/2025 (`.../about-ofcom/foi/2025/january/call-signs-13mar2025.csv`) |
| **Response date** | not stated (see the vintage caveat below) |
| **Requester** | not known (a disclosure-log publication is not attributed) |
| **Data vintage** | **2025-03-13** — declared from the filename, well-supported by the data (see below) |

## Overview

- **What this entry is**: a full amateur-callsign register export served as a
  CSV on Ofcom's FOI disclosure log — every callsign with its licence product,
  status, a record last-modified date and, uniquely in this family, a record
  creation date. It is the machine-readable register for the March-2025 export,
  the latest snapshot of the 2024–2025 disclosure-log register family.
- **Header shape** (`Callsign,Product,Status,Type,LastModifiedDate,CreatedDate`):
  the callsign column is spelled `Callsign`; the two date headers are run
  together without spaces; and this export adds a `CreatedDate` column the
  earlier two snapshots lack. No byte-order mark.
- **Contents**: 157,227 records — 104,441 `Allocated`, 52,265 `Reserved`,
  507 `Available` and 14 blank statuses (preserved as data). Products:
  59,180 Full, 36,594 Foundation, 14,291 Intermediate, 1,901 Club, 112 Temporary
  Reciprocal, and 45,149 blank. `Type` is `Call Sign - Amateur` on every row.
- **Dates**: both date columns run 2016-07-23 to 2025-03-13; last-modified is
  day-first-verified by 70,402 day>12 values and created-date by 104,297, none
  month>12 in either. `created_date` is carried as a registered extension column
  (record creation timestamp), distinct from `last_modified_date`.
- **Anomalies, recorded not repaired**: this snapshot carries the most
  out-of-shape callsigns of the family — Excel date-mangled values such as
  `20-Dec` and `21-Oct` (carried verbatim, never reconstructed); over-length
  reciprocal forms up to twelve characters including `M/TKG 2021` (an interior
  space, a Temporary Reciprocal licence); `g0jrk` and `2e1GTD` lower-case;
  `G6 FMU` interior space; and 481 four-, 54 six-, 39 seven-, 54 eight-, 5 nine-,
  3 ten-, 1 eleven- and 1 twelve-character callsigns. All preserved as data.
- **Filing-vs-filename note**: the disclosure is filed on the log under January
  2025, yet the served filename and both date columns' maxima say 13 March 2025;
  the filename date is taken as the vintage and the entry keyed to it.
- **Provenance witnesses**: only the live Ofcom disclosure-log copy is held
  (sha256 `70668244…`). No UK Government Web Archive capture of these exact bytes
  appears in the harvest manifest, so the vintage rests on a single witness,
  though the filename and both date columns' maxima agree internally.

## Exchange

No request/response email thread is held for this disclosure; the record is the
disclosure-log CSV itself and its provenance, captured above.
