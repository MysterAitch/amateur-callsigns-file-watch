# FOI publication record — list of UK amateur radio call signs, corrupt annex (Ofcom asset 210648, early 2021)

| | |
|---|---|
| **Ofcom reference** | not held (the disclosure is identified only by its Ofcom asset id, 210648, as captured by the UK Government Web Archive) |
| **Publication channel** | UK Government Web Archive (UKGWA) capture of an Ofcom-hosted annex workbook |
| **UKGWA capture** | 2021-01-10 (memento timestamp `20210110045626`) |
| **Response date** | not held (see the vintage note below) |
| **Requester** | not held |
| **Data vintage** | **2021-01** — declared, not proven (no date is embedded in this three-column shape; see below) |

## Overview

- **What this entry is**: a full amateur-callsign register export disclosed as an
  Excel workbook (`annex-list-of-uk-amateur-radio-callsigns.xlsx`), in the minimal
  `Value, Status, Type` three-column shape (the same export shape later seen in
  [`ofcom-01420046`](../ofcom-01420046--allocated-reserved-callsigns/), with no
  date or class column). It is the **corrupt sibling** of the same-vintage clean
  twin [`ofcom-2021-01`](../ofcom-2021-01--all-callsigns/) (issue #335), held here
  precisely **because it diverges** — under the collect-all-copies posture a
  differing copy is retained in full, never discarded.
- **The corruption — fourteen `#REF!` callsign cells, carried verbatim**: fourteen
  rows carry the spreadsheet formula-error literal `#REF!` in the call-sign
  (`Value`) column instead of a call sign. In the workbook each is a broken
  `CONCATENATE(#REF!,#REF!)` formula whose two source cells were deleted, cached as
  the error value `#REF!` (42 `#REF!` occurrences in the sheet XML — two in each
  formula plus one cached value, across the fourteen cells). They are carried
  **verbatim** as **unkeyable-class records** (a real row whose key is unusable),
  **never repaired and never substituted**; the call-sign parser flags each one
  `spreadsheet-error-token` so the defect surfaces in the data-quality reporting
  rather than being silently taken as a call sign or dropped. Their `Status` is
  intact: twelve `Allocated`, two `Reserved` (rows A138302 and A141343). The
  affected cells are A1801, A2405, A5708, A6352, A7464, A50012, A59764, A63856,
  A72944, A77907, A133723, A138302, A141343 and A143282.
- **The corruption is upstream, not introduced here**: the workbook was
  **published already corrupt**. The UK Government Web Archive holds this exact
  Ofcom asset (`…/__data/assets/file/0021/210648/annex-list-of-uk-amateur-radio-callsigns.xlsx`,
  memento `20210110045626`, 2021-01-10), and an independent Internet Archive
  capture of the same asset the following day (2021-01-11) carries the identical
  corruption — two web-archive witnesses proving the defect was in Ofcom's
  published file (issue #335). The live asset URL is now a genuine 404 (the
  `__data/assets/` path was removed in Ofcom's site redesign), so there is no clean
  copy of **this** asset to re-fetch; the clean same-vintage record survives only
  as the separate, wider FOI annex twin.
- **Contents**: 146,469 records — 95,944 `Allocated`, 50,240 `Reserved`, 275
  `Available`, and 10 blank statuses. `Type` is `Call Sign - Amateur` on every row
  (the service discriminator, not carried into the normalised output). No licence
  class or date is disclosed in this three-column shape, so `licence_class` is
  emitted empty. Apart from the fourteen `#REF!` values, every call sign is
  distinct.
- **Relationship to the clean twin**: the clean twin
  [`ofcom-2021-01`](../ofcom-2021-01--all-callsigns/) (asset 214225) is a **wider**
  six-column export (`Value, Status, Type, Reserved to Date, Original Start Date,
  Licence Type`) of **146,763** records with **zero** `#REF!` cells. The two are
  not a row-for-row copy of one another: this corrupt asset is a narrower,
  slightly smaller export (294 fewer rows) of the same early-2021 vintage. The
  clean twin therefore stands as the faithful same-vintage record; this asset is
  retained only as the divergent, corrupt copy, cross-referenced both ways and
  enumerated in `meta.json`'s `divergences[]`.
- **Vintage (declared, not proven)**: this three-column shape embeds no date, so
  no lower bound can be read from the data (unlike the clean twin, whose Original
  Start Date column dates it to 2021-01-29). The vintage is taken as `2021-01`,
  upper-bounded by the 2021-01-10 web-archive capture; the entry is keyed by the
  asset id rather than a proven day.
- **Provenance — a single held witness**: this copy rests on the UKGWA capture
  (memento `20210110045626`), fetched via the archive's identity replay; its raw
  sha256 (`ef1e59c2…`) is recorded in `meta.json`.

## Exchange

No request/response email thread is held for this disclosure. The record is the
archived workbook, its verbatim corruption and its provenance, captured above and
in `meta.json`.
