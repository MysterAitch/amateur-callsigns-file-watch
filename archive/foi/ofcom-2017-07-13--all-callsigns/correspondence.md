# FOI publication record — amateur callsigns register (web-link CSV, "FOI Request 13 Jul 17")

| | |
|---|---|
| **Ofcom reference** | not stated in the material held (the disclosure is labelled only "FOI Request 13 Jul 17") |
| **Publication channel** | a web link to a CSV, supplied in/alongside the FOI response; the response PDF was later recovered on the UK Government Web Archive (`_resources/documents/about-ofcom/foi/2017/july/`) but is not itself held in this entry |
| **Response date** | 2017-07-13 (from the disclosure's own "13 Jul 17" label; read as the response/publication date per the drop-zone provenance note) |
| **Requester** | not known (no requester name in the material; no matching WhatDoTheyKnow thread identified) |
| **Data vintage** | **2017-07-13** — declared, not proven (see the caveat below) |

## Overview

- **What this entry is**: a full amateur-callsign register export served as a
  CSV via a web link accompanying Ofcom's July-2017 FOI response — the machine-
  readable form of the same July-2017 disclosure. The register itself lists
  every callsign with its status.
- **Header shape** (`Value,Prefix,Suffix,Type,Status`): the oldest CSV header
  variant held, predating all three known open-data header variants, and
  distinctive for carrying **Ofcom's own prefix/suffix decomposition** of each
  callsign alongside the callsign itself. That decomposition is preserved
  verbatim in the archived source CSV; the normalised projection keeps the
  register-snapshot core (callsign, status, licence_class) so the file stays
  comparable with every other register vintage (see the entry meta for why the
  decomposition is not carried as a normalised column).
- **Contents**: 135,866 records — 85,672 `Allocated`, 50,164 `Reserved`,
  30 `Available`; no blank statuses. `Type` is `Call Sign - Amateur` on every
  row (the service discriminator). No licence class is disclosed.
- **Anomalies, recorded not repaired**: one row carries a blank callsign
  (blank `Value`, `Prefix` and `Suffix`) yet a `Reserved` status; twelve
  six-character, four seven-character and seven eight-character callsigns
  appear (regional-locator and reciprocal `M/…` forms), and `G6 FMU` carries an
  interior space. These are preserved as data, never cleaned.
- **Vintage caveat (declared, not proven)**: the disclosure is labelled
  "13 Jul 17" and is filed here at that vintage. The held CSV was itself
  obtained by following the supplied web link in August 2019 (file mtime
  2019-08-09), so were the link to have served live data the true vintage could
  be 2019 rather than 2017. The record count argues for a genuine 2017 vintage
  — 135,866 here versus 141,295 in the September-2019 register
  ([`wdtk-596532`](../wdtk-596532--allocated-reserved-forbidden/) /
  [`ofcom-756622`](../ofcom-756622--published-register-csv/)) — but that is
  inference, not proof, and is recorded as such.
- **Significance**: it sits between the September-2016 register
  ([`wdtk-356636`](../wdtk-356636--all-callsigns-plus-forbidden/)) and the
  September-2019 registers, and shares its July-2017 window with the
  Salesforce-era systems letter and PDF-format register export
  ([`ofcom-2017-07-03`](../ofcom-2017-07-03--all-callsigns-with-status/), vintage
  2017-04-24) — this being the machine-readable register for that period.

## Exchange

No request/response email thread is held for this disclosure; the record is the
web-link CSV itself and its provenance, captured above.
