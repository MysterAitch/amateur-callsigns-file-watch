# FOI publication record — forbidden amateur radio callsigns (December 2024)

| | |
|---|---|
| **Ofcom reference** | not stated anywhere in what we hold (no reference number on the disclosure-log listing, the CSV, or the paired PDF) |
| **Publication channel** | Ofcom FOI disclosure log (`www.ofcom.org.uk/siteassets/resources/documents/about-ofcom/foi/2024/december/forbidden-amateur-radio-callsigns.csv`) |
| **Requested** | not recorded (no request thread recovered; published on the disclosure log without an associated requester or request date) |
| **Responded** | not dated in the material; the disclosure-log folder places publication in December 2024 |
| **Outcome** | successful (a forbidden-suffix list was published in full) |
| **Requester** | not named on the disclosure log |
| **Data vintage** | **2024-12** (disclosure-log publication month); the list's own `LastModifiedDate` values top out at 2020-12-10, so the data's currency predates publication (see below) |

## Overview

- **Provided**: `forbidden-amateur-radio-callsigns.csv` — the list of
  three-letter suffixes withheld from issue, as **two columns, `Name` and
  `LastModifiedDate`** (1,464 suffix rows). The two-column shape and the
  `LastModifiedDate` attribute are consistent with a **Salesforce object
  export** (declared, not verified) — the same platform Ofcom names as its
  licensing database in the 2017 response (`ofcom-2017-07-03`).
- **Per-suffix provenance** — the feature the earlier forbidden lists lack:
  every row carries a last-modified timestamp. The distribution is **not
  uniform**: 1,463 rows share `29/07/2016 17:19` (the list's apparent origin
  bulk) and a single row — `JIZ` — carries `10/12/2020 09:10`, i.e. one
  suffix modified more than four years after the rest. Showing that shape (a
  one-outlier histogram) is the point; it is not reducible to a single date.
- **Change since 2019** — this is the first forbidden disclosure to differ
  from the 2016/2019 set. Against the 2019 lists (`ofcom-756622`,
  `wdtk-596532`; both the same 1,465-suffix set as 2016) the 2024 list is
  **`+JIZ`, `−QNF`, `−ZFJ`** (1,465 − 2 + 1 = 1,464). `QNF` and `ZFJ` were
  on the list in 2016 and 2019 and are gone by 2024; `JIZ` is new. The
  drivers are not stated in the disclosure — a genuine policy change, an
  export artefact, or both, are all live possibilities (declared, not
  verified).
- **Paired document**: a same-titled PDF
  (`…/pdf_file/0033/196674/forbidden-amateur-radio-callsigns.pdf`) was
  web-archived by the UK Government Web Archive on 2023-01-03 — evidence a
  forbidden-suffix document under this title existed on the disclosure log
  well before the December 2024 CSV listing (declared, not verified as the
  same list; not committed here — the CSV is the machine-readable disclosure).
- **Companion disclosure**: the same December 2024 disclosure-log folder also
  carries an M7-foundation-callsign CSV
  (`amateur-radio-foundation-callsigns-beginning-with-m7.csv`) — a separate
  dataset, out of scope for this entry.

## Exchange

No request or response correspondence was recovered: the material is a
disclosure-log publication of the dataset itself, without an accompanying
letter or thread. The provenance above is drawn from the disclosure-log
folder structure, the file's own columns, and the paired archived PDF.
