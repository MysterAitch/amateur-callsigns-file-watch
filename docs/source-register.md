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

## Acquisition channels (surveyed 2026-07-07)

| channel | coverage | notes |
|---|---|---|
| Ofcom open data page | 2022→ (live watcher) | the original lane; residential-IP-only (Cloudflare) |
| Ofcom FOI disclosure log (`/about-ofcom/freedom-of-information/foi-responses`) | 2022→ | published responses incl. dataset annexes (XLSX/CSV); year→category accordions; residential-IP fetch works with honest UA; `/siteassets/` not robots-disallowed |
| UK Government Web Archive (UKGWA, National Archives) | 2016→ (quarterly-ish crawls, latest checked 2026-02) | mirrors BOTH FOI page generations AND annex bytes verbatim (`{ts}id_/` replay); CloudFront-fronted, NOT Cloudflare → candidate GitHub-runner lane (smoke test pending); CDX index at `/ukgwa/cdx?url=…` (plain page-URL queries only — file-extension/matchType queries 405); robots.txt blanket-disallows crawling, so targeted known-URL retrieval only, slow and identified |
| WhatDoTheyKnow | 2012→ | request/correspondence pages + attachments; Cloudflare-gated (browser only); site-wide search `"call sign(s)" requested_from:ofcom` ≈ 70 requests; user feeds are recent-window only — user PAGES are the census source |
| National Archives (pre-2017 Ofcom FOI pages) | ≤2016 | old `stakeholders.ofcom.org.uk` era; reachable via UKGWA captures |

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

Full or near-full register exports (callsign + status, sometimes licence class),
ordered by data vintage. "Disclosure log" = Ofcom's published-responses page;
"UKGWA" = recovered from National Archives web-archive captures of it.
2026-07-07 harvest = wide-net download into `landing/ofcom-foi-log/` (see manifest.csv there).

| source | data vintage | status | notes |
|---|---|---|---|
| Ofcom 285990 ("available call sign list", cited in the Nan Smith letter) | 2016-07 | pending-ingest | FOUND via UKGWA (`285990-amateur-call-signs.pdf`); available-list class, PDF; the Nan Smith letter's predecessor |
| Ofcom 299351 ("available amateur call signs") | ~2016 | pending-ingest | UKGWA (`299351-available-amateur-call0-signs.pdf`); second 2016-era available list |
| Ofcom "Callsign database 20 Sep" xlsx | 2016-09-20 | pending-ingest | UKGWA (`Callsign-database-20-Sep.xlsx`); database export 9 days before the 356636 response — vintage relationship to 337399 to check |
| WDTK 356636 (Nan Smith, "List of ALL Amateur radio callsigns") | 2016-09-29 | pending-ingest | pristine xlsx verified (WDTK refetch hash-identical to 2020 copy); Ofcom ref 337399; Ofcom-published copy also recovered via UKGWA (`337399-FOI-All-Call-Signs.zip`) — diff vs WDTK copy; needs xlsx converter |
| Ofcom web-link CSV ("FOI Request 13 Jul 17") | 2017-07-13 | pending-ingest | `Value,Prefix,Suffix,Type,Status` header, 135,866 records; **vintage caveat resolved**: original response recovered via UKGWA (`Amateur-Call-Signs-for-FOI-Request-13-Jul-17.pdf`, under `_resources/documents/about-ofcom/foi/2017/july/`); full-list PDF rendering also exists (`Copy-of-Call-Signs.pdf`, 11.1 MB) |
| Ofcom FOI annex xlsx (late 2018) | ~2018-12 | pending-ingest | UKGWA (`Amateur-radio-call-signs-FOI-annex.xlsx`, 3.3 MB); requester/date to pin from paired response PDF (`Amateur-radio-call-signs-FOI.pdf`) |
| WDTK 596532 (Roger Howell, "Issued and available UK amateur radio callsigns") | 2019-09-06 | pending-ingest | pristine annex xlsx obtained 2026-07-07 (creator+modifier Julia Snape); Ofcom ref 756622; includes Forbidden Call Signs tab; Ofcom-published copies also on disclosure log (formats PDF + 7.2 KB allocated-reserved-forbidden CSV); Roger's 2019 enriched xlsx/csv retained as labelled derivative — enrichment diff outstanding |
| Ofcom "Amateur radio callsigns list" (disclosure log) | 2019-09-12 | pending-ingest | UKGWA (`allocated-reserved-forbidden-call-sign-foi-20190912.csv`, 4.4 MB + response PDF); full allocated/reserved/forbidden snapshot six days after 596532 |
| Ofcom "Allocated CallSign as at 260320" (assets 194533 AND 196168 — **same export**, recon-verified: identical sheet name + 92,319 rows) | **2020-03-26** | in landing (harvest) | allocated-only list |
| Ofcom "Reserved Callsigns 23-10-2020" (asset 206901 — recon corrected: **reserved-only**, 50,525 rows × G) | **2020-10-23** | in landing (harvest) | pairs with the Wilcox reserved request (WDTK, Oct 2020) |
| Ofcom full lists ×3, ~2021 (assets 210648: 146,472 rows; 214225 "annex-a-list-of-all-call-signs": 146,764 × F; 219065: 147,878 × F) | ~2021 | in landing (harvest) | requesters/dates to pin from paired response PDFs (Rob Wood May 2021 / Dean Apr 2021 / Danielli Dec 2021 candidates) |
| Ofcom "Available and registered UK amateur radio callsigns" (asset 234734, case 01432624 — recon corrected: **full 150,239-row snapshot**, not PDF-only) | 2022-04 | in landing (harvest) | |
| callsign-explorer FOI sets ×8 (2021-05 → 2024-07) | various | pending-ingest | on disk with WDTK metadata.json each; xlsx mostly; includes special-event (2021-12) and NoV (2022-03) subsets; overlap with disclosure-log copies to reconcile |
| Ofcom 01420046 "List of allocated and reserved amateur radio callsigns" | ~2022-03 | pending-ingest | disclosure log (xlsx); Gareth Steele (WDTK, Feb 2022) |
| Ofcom "Allocated amateur radio callsigns" + "Available" annex | 2022-06 | pending-ingest | disclosure log (xlsx); Daryanani requests (WDTK, Jun 2022) |
| Ofcom "List of Amateur Radio Callsigns" annex | 2023-01-25 | pending-ingest | disclosure log (`call-sign-list-with-status-25-01-2023.xlsx`, 3.6 MB); Jonathan McComb (WDTK, Jan 2023) |
| **FOI 01649066** ("Amateur Radio Callsign allocation as of July 2023") | 2023-08-18 | pending-ingest | **LOCATED 2026-07-07**: made direct-to-Ofcom (NOT on WDTK — Billy's census complete, no Aug 2023 request); published on disclosure log with annex (`copy-of-call-sign-list-18-08-2023.xlsx`, 4.3 MB); full callsigns + licence class; cited by FOI 01667041 |
| Ofcom "Callsign allocation data" annex | 2023-11-24 | pending-ingest | disclosure log (`call-sign-list-241123.csv`, 8.1 MB); Andrew Robinson (WDTK, Nov 2023) |
| Ofcom "full list of allocated amateur radio callsigns as of December 2023" | 2023-12-07 | pending-ingest | disclosure log (`call-sign-list-for-open-data-07-12-23.csv`, 8.1 MB); filename says "for open data" — provenance link to the open-data pipeline worth noting |
| Ofcom "Amateur Radio Callsign complete Spreadsheet" (FOI 1734722) | ~2024-01 | pending-ingest | disclosure log (`foi-1734722-amateur-call-signs.csv`) |
| Ofcom "Copy of all call-signs" | 2024-04-30 | pending-ingest | disclosure log (`copy-all-callsigns-30-apr-24.csv`) |
| Ofcom "Listing of UK Amateur Radio Callsigns" annex | ~2024-07 | pending-ingest | disclosure log (`annex-1-all-callsigns.xlsx` + `call-signs.csv`); Andy Pursell (WDTK, Jun/Jul 2024) |
| Ofcom "Every radio callsign spreadsheet" | ~2024-09 | pending-ingest | disclosure log (`every-radio-callsign-spreadsheet.csv`) |
| WDTK 1180568 (Roger Howell, FOI 1900117 "licence breakdown by duration held and age") | 2024-09-30 | pending-ingest | filed in landing 2026-07-07: sheet 1 = full snapshot **with Reserved-to-Date** (156k rows), sheet 2 = per-licence duration data (104k); age data withheld under s40(2); also on disclosure log (2024/october) |
| Ofcom "Callsigns Spreadsheet – October 2024" | 2024-10-21 | pending-ingest | disclosure log (`copy-of-callsigns-21102024.csv`, 10.3 MB) |
| Ofcom "Callsigns spreadsheet (March 2025)" | 2025-03-13 | pending-ingest | disclosure log (`call-signs-13mar2025.csv`, filed under 2025/january) |
| Ofcom "Callsigns spreadsheet (October 2025)" | ~2025-10 | pending-ingest | disclosure log (`callsigns-spreadsheet-october-2025.xlsx`, filed under 2025/june) |
| Ofcom "An up to date Callsign list February 2026" | 2026-02 | pending-fetch | disclosure log lists response PDF only — check for annex / whether it signposts open data |
| WDTK: Roger, "Previously available amateur radio callsign publications" | 2023-05-10 | not-held | answered not-held (wdtk-979275 filed); superseded as a lead by the disclosure-log/UKGWA channels above |
| WDTK: Roger, "Historical amateur radio call sign allocation rules and data" | 2023-05-11 | ingested (record) | letter 01618385 filed (wdtk-979811): G2/two-letter 2018-available/2020-withdrawn cycle, M7 2018 intro, "no single list charting status changes" — all on the record |

## FOI datasets — attribute addenda (join by callsign/prefix/suffix)

| source | date | status | notes |
|---|---|---|---|
| Reciprocal licences since 2010 (Billy McFarland) | 2017-12-22 | pending-ingest | callsign + reciprocal-since date, 2010→mid-2016; paste held in landing/pasted-artefacts; **authoritative xlsx recovered via UKGWA** (`list-reciprocal-licences-since-2010.xlsx`, 28 KB) — diff vs paste; BST-midnight-in-UTC timestamps need care |
| Re-issued call signs since 2010 (Billy McFarland) | 2017-12-22 | pending-ingest | **new dataset class recovered via UKGWA** (`list-re-issue-amateur-radio-call-signs.xlsx`, 19.7 KB) — per-callsign reissue list; pairs with the reciprocal xlsx |
| Club callsigns / T-numbers (Billy McFarland, Ofcom 00896085) | 2020-04-23 | pending-ingest | currently PDF-only locally; check WDTK for native attachment before attempting PDF extraction |
| Forbidden suffixes FOI (Aug 2019) | 2019-08 | ingested (distilled) | reference-data/forbidden-suffixes.csv; TWO raw variants exist (landing copy vs Browser-repo copy, byte-different — BOM/EOL suspected, equivalence unverified); raw originals not yet archived |
| Forbidden amateur radio callsigns (disclosure log) | 2024-12 | pending-ingest | `forbidden-amateur-radio-callsigns.csv` — five-years-later comparison point for the 2019 forbidden list; same response also carries M7 foundation CSV |
| Per-prefix live-callsign counts (Daryl Spence "Ama" FOI) | 2018-07-05 | pending-ingest | counts inline in the WDTK response (20: 8612, 21: 1596, G0: 8615 … **G2: 164, G5: 58**); bears on the G2/M2 story; Ofcom-published copy likely `Amateur-radio-licence-statistics-FOI.pdf` |
| Amateur licences revoked 2011–2021 (Stewart Baker, WDTK) | 2021-06 | pending-fetch | includes revocation reasons; response confirms on the record that class is denoted by callsign prefix; earlier UKGWA `FOI-list-revoked-amateur-radio-licences.pdf` (~2017) is a companion |
| Amateur licences surrendered or cancelled (disclosure log) | 2024-11 | pending-ingest | PDF |
| Amateur full callsign changes (UKGWA) | ~2020-21 | pending-ingest | `amateur-full-callsign-changes.pdf` — callsign-change events, attribute class |
| Licence-holder statistics (various) | 2018→2024 | pending-ingest | licensing numbers by class / historic licensing numbers / Radio Amateur numbers 2019 / gender split 2022 (xlsx+pdf) / duration+age FOI 1900117 (already filed in landing) |
| Annual licence counts 1993→2013, amateur AND business radio (Nige Coleman, WDTK 184767) | 2013-12 | **in landing (2026-07-07)** | `Number of licences Coleman.pdf`; **caveat on the record**: pre-lifetime-licensing "amateur" figures include CB + Maritime (RLC aggregate) — explains the 2004/5-2005/6 spike; 2012/13 amateur = 28,041; Ofcom published monthly stats at licensing.ofcom.org.uk circa 2013-14 (UKGWA monthly-series lead) |
| Amateur Radio Licence Statistics (Stewart Baker, WDTK: 2013-09 FoI 1-241858032 **in landing**; Q1 2018 + Q2 2018 pending) | 2013, 2018 | partly in landing | 2013 response + ack PDFs fetched (wdtk-174543); request text itself quotes Ofcom's published monthly stats as of 2013-08-28 (F 18,195 / I 7,727 / Full 53,691 / Club 1,487 / Recip 701 = 81,801); Q2 2018 request newly discovered via sidebar |
| Re-issue policy + last-20-applicants reasons (Eckersley, WDTK 251507) | 2015-02 | **in landing (2026-07-07)** | `policy for old call signs.pdf` + `applicants old call signs.pdf` — pre-2016 heritage/re-issue regime |
| Call-book PSI licensees (Mark Witton, WDTK 248271, Ofcom 1-277622422) | 2015-01 | **in landing (2026-07-07)** | `Amateur Radio Callbook PSI 1.pdf` + response/ack — pre-open-data commercial licensing regime for callsign data |
| Amateur licence statistics, historical (Peter Bowyer, WDTK) | 2017-10 | pending-fetch | response enumerates the full licence *product* list (Foundation/Intermediate/Full/Club/Reciprocal variants) — product-taxonomy reference + stats |

**Discovery coverage note (2026-07-07)**: WDTK `amateur requested_from:ofcom`
returns ~200 requests over 8 pages; pages 2–8 not yet fully triaged —
follow-up sweep queued (most dataset-bearing requests are already
captured via the callsign/allocated/business-radio/WTR/PMSE sweeps).
| Available-callsign lists (many requesters) | 2013→2025 | **partly ingested to landing (2026-07-07)** | recurring request class; snapshots of the *available* pool — complements allocated-register snapshots. **WDTK originals now in landing/foi/: 2013-09-06 xlsx (wdtk-174341, oldest machine-readable dataset held), 2014-03-14 xlsx (197896), 2014-08-18 xlsx (224333), 2015-02-25 xlsx (247308, post-refusal IR), 2015-04-16 xlsx (261814), 2015-06-11 xlsx (271469), 2015-10-21 xlsx (294011), 2015-10-29 xlsx (299321 — same size as 294011, different sha256, diff at ingest), 2016-01-21 xlsx (309076 — last before the system change)**. Still to fetch: 2018 M6-series PDF (UKGWA), 2022-06, 2024-03/05/06, 2025 ×4 (disclosure log/harvest). NB Ofcom on the record (Adam Dean IR, 2021, ref 01224257): no availability list held, callsigns generated on demand |
| Pre-war callsign series (Eckersley, WDTK 238892) | pre-1939 | **in landing (2026-07-07)** | `Pre War Callsigns.xlsx` + "Call signs series before WW2" PDF — deepest-history dataset held; heritage-series reference for the G2/two-letter story; companion out-of-sequence counts + IR PDFs in same dir |
| Temporary Reciprocal Licenses issued (Billy, 2018-01-12) | 2018-01-12 | pending-fetch | attribute addendum if attachment exists |
| Total call sign adoption refusals 2017 (Billy) | 2018-01-12 | pending-fetch | counts, not per-callsign; possibly context; UKGWA `Total-refusals-of-amateur-radio-call-sign-adoptions.pdf` covers the companion Dec 2017 not-held request |
| Re-issue of Amateur Radio Call Signs (Billy, 2017-12-22) + Re issue of amateur call signs/T numbers (2018-11-29, ref 633968) | 2017-2018 | pending-ingest | reissue policy/data; UKGWA copies recovered (`foi-re-issue-amateur-radio-call-signs.pdf`, `Re-issue-of-amateur-call-signs-FOI.pdf`); Eckersley 2014/2015 out-of-sequence + reissue-policy responses are companions |

## FOI responses that are records, not datasets

| source | date | status | notes |
|---|---|---|---|
| FOI 01667041 (Billy, "Amateur Radio Licence Errors") | 2023-10-02 | pending-ingest | Ofcom: "we do not record it in this way" for class-product mismatches, citing M5SHA — official confirmation the mismatch table is information Ofcom does not hold. Grounding candidate for the `class-product-mismatch` registry row. **Ofcom-published PDF located on disclosure log** (`list-of-amateur-radio-call-signs-where-the-format-doesnt-fit-the-licence-class.pdf`); WDTK copy also exists |
| E Munro "Amateur radio licence holder M5SHA/MM5SHA" (Ofcom 01403789) | 2022-01 | rejected | refused (personal data — asked whether a named person holds M5SHA); M5SHA was drawing FOI attention 20 months before 01667041 — footnote/cross-reference for the M5SHA callsign page |
| Adam Dean internal review, "List of available Amateur Radio Callsigns (Updated for 2021)" (ref 01224257) | 2021-04 | pending-fetch | Ofcom on the record: "We do not hold a list of all available amateur radio call signs. Instead, our licensing system generates the call signs on demand… any three-letter combination" — load-bearing statement for availability semantics |
| 2016 "system change" not-held responses (Hutton, Chance, Martin, McKissock, Lewis) | 2016-10→12 | pending-fetch | repeated "We do not hold a list of call signs that are available. Due to a system change…" — documents the Siebel→new-licensing-system transition; Hutton response signposts the July 2016 available-list on the FOI page ("listed under 7 July") |
| M0LID / MM0LID status queries (Stewart Baker 2018; Peter Bowyer 2017 refused) | 2017-2018 | pending-fetch | per-callsign status Q&A (M0LID "reserved"); UKGWA `Amateur-radio-call-signs-M0LID-and-M0AWA-468728.pdf`; callsign-page footnote material |
| Per-callsign curios (G1MXP 1984-88 entries; G1DZC; Skelmersdale callsign lists 2018-19; GB3TC repeater location; GB1SS Tim Peake NoV; GB2RS NoV; GB3MI NoV; GB3TU complaints 2025-26) | various | pending-ingest | callsign-level attributes/trivia with citable sources — exactly the "nuggets" class; UKGWA + disclosure-log PDFs |
| Issued Amateur Radio Call Signs (Billy, 2018-01-12) | 2018-01-12 | rejected | WDTK state: refused (G*XX format list) — record retained so it is not re-chased |
| Club Amateur Radio call signs (Billy, 2018-01-12) | 2018-01-12 | rejected | refused (superseded by the successful 2020 request) |
| Reports of operating without a license (Billy) | 2018 | context | long overdue/no response; enforcement context only; UKGWA `investigations-into-radio-amateurs-foi.pdf` + `enforcement-of-the-amateur-radio-service.pdf` are companions |
| UK Amature Radio Call Sign Data Base (david gilmore, WDTK) | 2018-06 | not-held | access-to-database request, not held — retained so it is not re-chased |

## Context documents (retained, not datasets)

| source | status | notes |
|---|---|---|
| RSGB contracts/MoU FOI (00930955, James Andrew, WDTK 669549) | context | RSGB relationship background |
| Ofcom–RSGB examination schedule of terms | context | licensing-system background |
| Monies received from RSGB (Billy, 2021-03-18) | context | RSGB finances |
| RSGB call-book data licensing set | context / pending-ingest | pre-open-data publication history: Mark Witton PSI request (call-book licensees, 2015-01), `rsgb-licence-foi.pdf`, `Call-signs-provided-to-RSGB.pdf`, `amateur-radio-call-book-data-licence-foi.pdf`, `Amateur-radio-call-book.pdf` (all UKGWA) — how callsign data reached the public before the open-data page |
| OFCOM–RSGB NoV administration agreement + repeater/beacon process maps | pending-ingest | disclosure log 2023-10; reference-library material |
| Ofcom–RSGB Forum meeting papers 15 Mar 2016 (Jayne Newtown, WDTK) | pending-fetch | includes "Paper describing call sign formats" + club-callsign RSL clarification action — format reference material |
| Kernow (K) regional-secondary-locator documentation (Charlie Hill, WDTK) | pending-fetch | RSL policy history — the Cornwall RSL decision trail |
| Amateur radio licences G1 and M5 series (UKGWA) | pending-ingest | series-level reference (M5 relevant to M5SHA story) |
| SIEBEL / licensing-system documentation (Mark Salter, 2014) | pending-ingest | the pre-2016 system whose replacement caused the "no availability list" era; `362192-Database-systems.pdf` companion |
| Amateur Radio Special Research Permits (UKGWA, xls + pdf) | pending-ingest | permit class adjacent to amateur licensing |
| WTR light licences (disclosure log: 2023-11 CSV 2.2 MB; 2025-01 PDF; 2025-10 xlsx) | pending-ingest | feeds issue #7 (WTR daily extract source) |
| data.gov.uk WTR dump (dataset `wireless-telegraphy-register`) | pending-fetch | revealed by Glen Turnbull's 2017 WDTK request: dumped once, April 2016, despite quarterly intent — possible pre-2022 WTR snapshot; check data.gov.uk + its archives; old WTR web UI was `spectruminfo.ofcom.org.uk` (UKGWA capture check) |
| WTR publication-policy records (Mr James 2014 machine-readable refusal; Ceri Watson 2023 "WTR missing entries") | context / pending-fetch | WTR completeness + publication history for #7 |
| Business Radio licence holders (2023-10) + business radio licences (2025-06) | pending-ingest | feeds issue #6 (Business Radio Light source) |
| PMSE publication context (White Space DB operators 2023; ships/PMSE licence-holders 2022) | pending-fetch | PMSE assignment/venue datasets flow to White Space databases; ships' licences go to ITU — publication-surface map for #8 |
| Enforcement/prosecution records (Mark Thompson 2018 CB + 2019 amateur piracy/repeater prosecutions; Durbridge 2018) | pending-fetch | enforcement-history context |
| "Randomly allocates on request" refusal (Derek Flewin, 2017-11) | pending-fetch | another on-the-record availability-semantics statement, incl. licensing-portal guide link |
| Home Office's callsign register (disclosure log 2026-02) | pending-ingest | cross-government callsign register curio — scope note for "callsign" semantics outside Ofcom |
| Change of call sign policy (ian hope, WDTK 2021, long overdue) | context | quotes the 31 May 2006 Ofcom policy statement on callsign transfer — policy-history nugget |
| EMF/mast Halton refusal (719860) | rejected | unrelated to callsigns; retained in landing/context only because it arrived in the same folder |

## Reference/documentation sources

Tracked separately in `docs/reference/callsign-structure/sources.md`
(mirrored primary documents + community sources with copyright notes) and
`reference-data/README.md` (provenance policy for distilled tables).
