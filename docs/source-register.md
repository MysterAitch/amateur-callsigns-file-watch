# Source register

The durable record of every data source this project knows about — ingested,
pending, or deliberately not pursued. Its purpose is institutional memory:
a rejected or dead-end source recorded here never needs re-investigating
when it resurfaces. One entry per source; update statuses in place (git
history preserves the trail).

**Statuses**: `ingested` (in archive/ or reference-data/, with pointer) ·
`pending-fetch` (known, authoritative copy not yet obtained) ·
`pending-ingest` (authoritative bytes on disk in the drop zone, converter or
decision outstanding) · `context` (retained for reference, not a dataset) ·
`not-held` (FOI answered "information not held" — the answer IS the record) ·
`rejected` (deliberate decision not to ingest, with reason).

**Drop zone**: `landing/` (gitignored, local-only). Drop new material —
attachments in original format, WDTK `.json`, saved HTML pages — anywhere
under it; filing into per-source directories with hashes and provenance
notes is maintenance work done in-session. Nothing under `landing/` is
committed; everything durable about a source lives HERE, and ingested bytes
live in `archive/` or `reference-data/`.

## Open-data register snapshots (source: Ofcom open data page)

| key | status | notes |
|---|---|---|
| 2022-05-30 | ingested | oldest known publication; `v2022-minimal` variant; reconstructed-from-prior-download (Browser repo, two byte-identical downloads 05-30/07-26) |
| 2023-02-20 | ingested | `v2023-mmsi` variant |
| 2025-04-08 | ingested | `v2025-salesforce` |
| 2025-05-27 | ingested | 1,074-row truncated publication, bot-fetched; cause unknown upstream; complete-row ending rules out cut download |
| 2025-06-08 | ingested | **NOT an independent publication**: byte-equal to 2025-05-27 modulo line endings; produced by the old repo's pipeline-migration commit. scopeNotes correction / keep-vs-remove decision pending |
| 2025-06-04 | ingested | `v2025-friendly` |
| 2026-06-23 | ingested | `v2026-licence-version`; live watcher continues |

## FOI datasets — register snapshots

| source | date | status | notes |
|---|---|---|---|
| WDTK 356636 (Nan Smith, "List of ALL Amateur radio callsigns") | 2016-09-29 | pending-ingest | pristine xlsx verified (WDTK refetch hash-identical to 2020 copy); Ofcom ref 337399; needs xlsx converter |
| Ofcom web-link CSV ("FOI Request 13 Jul 17") | 2017-07-13 | pending-ingest | `Value,Prefix,Suffix,Type,Status` header, 135,866 records; vintage caveat (downloaded 2019 via 2017 link; record count supports 2017); original response page not yet located |
| WDTK 596532 (Roger Howell, "Issued and available UK amateur radio callsigns") | 2019-09-06 | pending-ingest | pristine annex xlsx obtained 2026-07-07 (creator+modifier Julia Snape); Ofcom ref 756622; includes Forbidden Call Signs tab; Roger's 2019 enriched xlsx/csv retained as labelled derivative — enrichment diff outstanding |
| FOI 01649066 (Billy McFarland, response 2023-08-21) | 2023-08-21 | pending-fetch | full callsigns + licence class — fills the 2023-02→2025-04 gap WITH class data; cited by FOI 01667041; locate the WDTK request carrying it (likely Billy's user page 2) |
| callsign-explorer FOI sets ×8 (2021-05 → 2024-07) | various | pending-ingest | on disk with WDTK metadata.json each; xlsx mostly; includes special-event (2021-12) and NoV (2022-03) subsets |
| WDTK: Roger, "Previously available amateur radio callsign publications" | TBC | pending-fetch | attachments unchecked; may hold historical publications |
| WDTK: Roger, "Historical amateur radio call sign allocation rules and data" | TBC | pending-fetch | rules → reference library; data → datasets |

## FOI datasets — attribute addenda (join by callsign/prefix/suffix)

| source | date | status | notes |
|---|---|---|---|
| Reciprocal licences since 2010 (Billy McFarland) | 2017-12-22 | pending-fetch | callsign + reciprocal-since date, 2010→mid-2016; paste held in landing/pasted-artefacts; authoritative attachment wanted; BST-midnight-in-UTC timestamps need care |
| Club callsigns / T-numbers (Billy McFarland, Ofcom 00896085) | 2020-04-23 | pending-ingest | currently PDF-only locally; check WDTK for native attachment before attempting PDF extraction |
| Forbidden suffixes FOI (Aug 2019) | 2019-08 | ingested (distilled) | reference-data/forbidden-suffixes.csv; TWO raw variants exist (landing copy vs Browser-repo copy, byte-different — BOM/EOL suspected, equivalence unverified); raw originals not yet archived |
| Temporary Reciprocal Licenses issued (Billy, 2018-01-12) | 2018-01-12 | pending-fetch | attribute addendum if attachment exists |
| Total call sign adoption refusals 2017 (Billy) | 2018-01-12 | pending-fetch | counts, not per-callsign; possibly context |
| Re-issue of Amateur Radio Call Signs (Billy, 2017-12-22) + Re issue of amateur call signs/T numbers (2018-11-29, ref 633968) | 2017-2018 | pending-fetch | reissue policy/data — suffix-attribute and reference-library material |

## FOI responses that are records, not datasets

| source | date | status | notes |
|---|---|---|---|
| FOI 01667041 (Billy, "Amateur Radio Licence Errors") | 2023-10-02 | not-held | Ofcom: "we do not record it in this way" for class-product mismatches, citing M5SHA — official confirmation the mismatch table is information Ofcom does not hold. Grounding candidate for the `class-product-mismatch` registry row. Paste in landing; authoritative PDF wanted |
| Nan Smith letter's July 2016 predecessor (Ofcom 285990) | 2016-07 | pending-fetch | stakeholders.ofcom.org.uk FOI responses July 2016 — may carry an even earlier list |
| Issued Amateur Radio Call Signs (Billy, 2018-01-12) | 2018-01-12 | rejected | WDTK state: refused — record retained so it is not re-chased |
| Club Amateur Radio call signs (Billy, 2018-01-12) | 2018-01-12 | rejected | refused (superseded by the successful 2020 request) |
| Reports of operating without a license (Billy) | 2018 | context | long overdue/no response; enforcement context only |

## Context documents (retained, not datasets)

| source | status | notes |
|---|---|---|
| RSGB contracts/MoU FOI (00930955, James Andrew, WDTK 669549) | context | RSGB relationship background |
| Ofcom–RSGB examination schedule of terms | context | licensing-system background |
| Monies received from RSGB (Billy, 2021-03-18) | context | RSGB finances |
| EMF/mast Halton refusal (719860) | rejected | unrelated to callsigns; retained in landing/context only because it arrived in the same folder |

## Reference/documentation sources

Tracked separately in `docs/reference/callsign-structure/sources.md`
(mirrored primary documents + community sources with copyright notes) and
`reference-data/README.md` (provenance policy for distilled tables).
