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

The authoritative channel-to-publisher mapping is
[`reference-data/publishers.json`](../reference-data/publishers.json) — every
witness `channel` token resolves through it to exactly one publisher entry
(name, licence basis, authority ceiling), and `src/ci/validate-publishers.ts`
(run inside `validate:data`) freshness-tests that resolution against the real
archive. The table below is the narrative survey of the same channels; treat
the register as authoritative on which publisher a channel resolves to.

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
| 2025-11-11 | ingested | recovered-from-web-archive (Internet Archive Wayback capture 2025-12-02 of the dated `amateur-callsigns-11-nov-2025.csv` publication); `v2026-licence-version-padded` (five empty trailing padding columns, parsed via a shape-only header-fill extract); 159,895 records |
| 2026-01-14 | ingested | recovered-from-web-archive (UK Government Web Archive capture 2026-02-04); published as a WORKBOOK (`amateur-callsign-list.xlsx`, archived verbatim) with a mechanical sheet extract as parse source; `v2026-licence-version-iso`; 146,417 records — ~13,478 fewer than 2025-11-11 (net removal: allocated −9,561, reserved −3,950; flagged for longitudinal analysis) |
| 2026-06-23 | ingested | `v2026-licence-version`; live watcher continues |

## FOI datasets — register snapshots

Full or near-full register exports (callsign + status, sometimes licence class),
ordered by data vintage. "Disclosure log" = Ofcom's published-responses page;
"UKGWA" = recovered from National Archives web-archive captures of it.
2026-07-07 harvest = wide-net download into `landing/ofcom-foi-log/` (see manifest.csv there).

| source | data vintage | status | notes |
|---|---|---|---|
| Ofcom 285990 ("available call sign list", cited in the Nan Smith letter) | 2016-07 | ingested | FOUND via UKGWA (`285990-amateur-call-signs.pdf`); available-list class, PDF; the Nan Smith letter's predecessor; ingested as `archive/foi/ofcom-285990--available-list-jun-2016` (letter only - the list attachment remains an open recovery target, datasetRecovery: unrecovered) |
| Ofcom 299351 ("available amateur call signs") | ~2016 | ingested | UKGWA (`299351-available-amateur-call0-signs.pdf`); second 2016-era available list; ingested as `archive/foi/ofcom-299351--available-list-referral` |
| Ofcom "Callsign database 20 Sep" xlsx | 2016-09-20 | ingested | UKGWA (`Callsign-database-20-Sep.xlsx`); the earliest register snapshot held; ingested as `archive/foi/ofcom-2016-09-20--callsign-database--all-callsigns` (139,758 `Call Sign,Status` rows, variant `ofcom-2016-09-20-register`; the sparsest export shape held — two columns, no licence class and no dates — with the `Forbidden` (5,431) and `Quarantine` (1) status values folded into the callsign column and carried verbatim rather than isolated in a separate forbidden-suffix sheet; its callsign+status content is byte-identical to sheet 1 of the `wdtk-356636` disclosure, the two-column Ofcom projection of the same 2016-09-20 export). Vintage proven by the workbook's docProps (created/modified 2016-09-20) |
| WDTK 356636 (Nan Smith, "List of ALL Amateur radio callsigns") | 2016-09-29 | ingested | pristine xlsx verified (WDTK refetch hash-identical to 2020 copy); Ofcom ref 337399; Ofcom-published copy also recovered via UKGWA (`337399-FOI-All-Call-Signs.zip`) — diff vs WDTK copy; needs xlsx converter; ingested as `archive/foi/wdtk-356636--all-callsigns-plus-forbidden` |
| Ofcom web-link CSV ("FOI Request 13 Jul 17") | 2017-07-13 | ingested | ingested as `archive/foi/ofcom-2017-07-13--all-callsigns` (`Value,Prefix,Suffix,Type,Status` header, 135,866 records - the oldest CSV header shape held, carrying Ofcom's own prefix/suffix decomposition; register-snapshot class, variant `ofcom-2017-07-13-register`). Vintage recorded declared-not-proven (the held CSV was fetched via the 2017 web link in Aug 2019; the 135,866 vs 141,295 count argues genuine 2017 but is inference); the original response PDF recovered via UKGWA (`Amateur-Call-Signs-for-FOI-Request-13-Jul-17.pdf`, under `_resources/documents/about-ofcom/foi/2017/july/`) and the full-list PDF rendering (`Copy-of-Call-Signs.pdf`, 11.1 MB, archived under `ofcom-2017-07-03--all-callsigns-with-status`) remain the corroborating documents, not re-ingested here |
| Ofcom FOI annex xlsx (late 2018) | ~2018-12 | pending-ingest | UKGWA (`Amateur-radio-call-signs-FOI-annex.xlsx`, 3.3 MB); requester/date to pin from paired response PDF (`Amateur-radio-call-signs-FOI.pdf`) |
| WDTK 596532 (Roger Howell, "Issued and available UK amateur radio callsigns") | 2019-09-06 | ingested | pristine annex xlsx obtained 2026-07-07 (creator+modifier Julia Snape); Ofcom ref 756622; includes Forbidden Call Signs tab; Ofcom-published copies also on disclosure log (formats PDF + 7.2 KB allocated-reserved-forbidden CSV); Roger's 2019 enriched xlsx/csv retained as labelled derivative — enrichment diff outstanding; ingested as `archive/foi/wdtk-596532--allocated-reserved-forbidden` |
| Ofcom "Amateur radio callsigns list" (disclosure log) | 2019-09-12 | ingested | UKGWA (`allocated-reserved-forbidden-call-sign-foi-20190912.csv`, 4.4 MB + response PDF); full allocated/reserved/forbidden snapshot six days after 596532; ingested as `archive/foi/ofcom-756622--published-register-csv` |
| Ofcom "Allocated CallSign as at 260320" (assets 194533 AND 196168 — **same export**, recon-verified: identical sheet name + 92,319 rows) | **2020-03-26** | ingested | allocated-only status-filtered slice; ingested as `archive/foi/ofcom-2020-03-26--allocated-callsigns` (92,318 rows, all `Allocated`; minimal `Value,Status` shape; variant `ofcom-2020-03-26-allocated`). The faithful witness 196168 was ingested; the companion 194533 Excel-mangled eleven suffix-month callsigns into date serials (divergence enumerated in the entry meta). `datasetRecovery: partial` records status-filtered COVERAGE, not missing bytes |
| Ofcom "Reserved Callsigns 23-10-2020" (asset 206901 — recon corrected: **reserved-only**, 50,525 rows × G) | **2020-10-23** | ingested | reserved-only status-filtered slice; ingested as `archive/foi/ofcom-2020-10-23--reserved-callsigns` (50,524 rows — 50,260 `Reserved` plus 264 stray `Available` preserved verbatim; seven-column shape with typed dates; variant `ofcom-2020-10-23-reserved`, new `licence_cancel_date` column, oldest 1932). Pairs with the Wilcox reserved request (WDTK, Oct 2020). `datasetRecovery: partial` records status-filtered COVERAGE, not missing bytes |
| Ofcom full call-sign lists ×2, 2021 (assets 214225 "annex-a-list-of-all-call-signs" & 219065 "Amateur-radio-callsigns") | 2021-01 / 2021-04 | ingested | two UKGWA-captured FOI annex workbooks (a single web-archive witness each, snapshot 20230904223900); six-column register-snapshot shape (`Value,Status,Type,Reserved to Date,Original Start Date,Licence Type`, the two annexes differing only in the case of two headers). Ingested as `archive/foi/ofcom-2021-01--all-callsigns` (146,763 records, variant `ofcom-2021-01-register`) and `archive/foi/ofcom-2021-04--all-callsigns` (147,877 records, variant `ofcom-2021-04-register`) — +1,114 records over the three-month gap. No Ofcom disclosure-log copy or covering correspondence held; vintages declared-not-proven (most-recent Original Start Date as lower bound); keyed by data-vintage month, not case reference. Requester/date candidates from paired response PDFs (Rob Wood May 2021 / Dean Apr 2021 / Danielli Dec 2021) remain unpinned |
| Ofcom full list, ~2021 (asset 210648, `annex-list-of-uk-amateur-radio-callsigns.xlsx`) | 2021-01 | ingested | the third 2021 harvest asset, `#REF!`-corrupted: fourteen call-sign cells were published as broken `CONCATENATE(#REF!,#REF!)` formulas (twelve Allocated, two Reserved). Ingested as `archive/foi/ofcom-210648--corrupt-annex-callsigns` (146,469 records, variant `ofcom-210648-corrupt-annex-register`) under the #335 treatment: the `#REF!` cells are carried verbatim as unkeyable-class records (flagged `spreadsheet-error-token`), **no repair, no substitution**. Corruption proven upstream by two web-archive witnesses (UKGWA memento 20210110045626 + an independent Internet Archive capture of the same asset 2021-01-11); the live asset URL is a genuine 404. A `divergences[]` record enumerates the fourteen cells against the clean same-vintage twin `ofcom-2021-01--all-callsigns` (asset 214225, wider six-column export, zero `#REF!`) |
| Ofcom "Available and registered UK amateur radio callsigns" (asset 234734, case 01432624 — recon corrected: **full 150,239-row snapshot**, not PDF-only) | 2022-03-14 | ingested | disclosure log (`available-and-registered-uk-amateur-radio-callsigns-case-01432624.xlsx`); the report-generation instant (sheet name `Report1647268967067` = 2022-03-14T14:42:47Z) dates it a week after 01420046, in the identical `Value,Status,Type` shape; ingested as `archive/foi/ofcom-2022-03-14--available-and-registered--all-callsigns` (150,238 records, variant `ofcom-2022-03-14-register`, sharing the `valueStatusTypeRegisterConversion` factory with `ofcom-01420046-register`; no licence class or date disclosed; a `,,` two-comma callsign and the trailing-NBSP trio carried verbatim) |
| callsign-explorer FOI sets ×8 (2021-05 → Jul 2024) | various | pending-ingest | on disk with WDTK metadata.json each; xlsx mostly; includes special-event (2021-12) and NoV (2022-03) subsets; overlap with disclosure-log copies to reconcile (several of those disclosure-log copies are now separately ingested; this row tracks the still-outstanding bundle reconciliation) |
| Ofcom 01420046 "List of allocated and reserved amateur radio callsigns" | 2022-03-07 | ingested | disclosure log (xlsx); Gareth Steele (WDTK, Feb 2022); ingested as `archive/foi/ofcom-01420046--allocated-reserved-callsigns` (150,181 records, variant `ofcom-01420046-register`) |
| Ofcom "Allocated amateur radio callsigns" + "Available" annex | 2022-06 | pending-ingest | disclosure log (xlsx); Daryanani requests (WDTK, Jun 2022) |
| Ofcom "List of Amateur Radio Callsigns" annex | 2023-01-25 | ingested | disclosure log (`call-sign-list-with-status-25-01-2023.xlsx`, 3.6 MB); Jonathan McComb (WDTK, Jan 2023); ingested as `archive/foi/ofcom-2023-01-25--call-sign-list-with-status--all-callsigns` (152,084 records, variant `ofcom-2023-01-25-register`; the earliest `Value,Status,Product` snapshot held and the ONLY four-column one — no Type column; a workbook, so its last-modified dates are typed ISO; carries the ~44.7k reserved-with-blank-product pool, fifteen Excel-date-mangled `20xxx` Intermediate callsigns carried verbatim, and two blank-callsign rows preserved) |
| **FOI 01649066** ("Amateur Radio Callsign allocation as of July 2023") | 2023-08-18 | ingested | **LOCATED 2026-07-07**: made direct-to-Ofcom (NOT on WDTK — Billy's census complete, no Aug 2023 request); published on disclosure log with annex (`copy-of-call-sign-list-18-08-2023.xlsx`, 4.3 MB); full callsigns + licence class; cited by FOI 01667041; ingested as `archive/foi/ofcom-2023-08-18--call-sign-list--all-callsigns` (153,248 records, variant `ofcom-2023-08-18-register`; the full five-column `Value,Product,Status,Type` + last-modified shape with the constant `Call Sign - Amateur` Type dropped; a workbook, so its dates are typed ISO; carries the ~42.5k reserved-with-blank-product pool but no Special Event Station product, in contrast to the January snapshot). The response letter (`amateur-radio-callsign-allocation-as-of-july-2023.pdf`) is now witnessed and extracted, recovering the request/response dates the entry previously held as not-held: received 2023-07-24, responded 2023-08-21 |
| Ofcom "Callsign allocation data" annex | 2023-11-24 | ingested | disclosure log (`call-sign-list-241123.csv`, 8.1 MB); Andrew Robinson (WDTK, Nov 2023); ingested as `archive/foi/ofcom-2023-11-24--call-sign-list--all-callsigns` (108,922 records, `Value,Status,Product,Type,Last-Modified` shape, variant `ofcom-2023-11-24-register`; 13 Excel-mangled `20xxx` callsigns carried verbatim). The WDTK-served copy of the same disclosure (FOI 01713103, request 1045020) is now held in full as a divergent copy (`wdtk-1045020-call-sign-list-241123.csv`) — identical rows/order/line-count, differing by exactly two bytes: two heritage callsigns (G0TQK, 2E1HON) carry a trailing non-breaking space encoded as a lone `0xA0` byte in the disclosure-log copy versus well-formed UTF-8 `0xC2 0xA0` in the WDTK copy — recorded in the entry's `divergences[]` |
| Ofcom "full list of allocated amateur radio callsigns as of December 2023" | 2023-12-07 | ingested | disclosure log (`call-sign-list-for-open-data-07-12-23.csv`, 8.1 MB); filename says "for open data" — provenance link to the open-data pipeline worth noting; ingested as `archive/foi/ofcom-2023-12-07--open-data-call-sign-list--all-callsigns` (108,992 records, same shape, variant `ofcom-2023-12-07-register`) |
| Ofcom "Amateur Radio Callsign complete Spreadsheet" (FOI 1734722) | ~2024-01 | ingested | disclosure log (`foi-1734722-amateur-call-signs.csv`); ingested as `archive/foi/ofcom-2024-01--foi-1734722--all-callsigns` (153,938 records — the complete register incl. the ~44,860 blank-product reserved pool, almost all Reserved; variant `ofcom-2024-01-register`) |
| Ofcom "Copy of all call-signs" | 2024-04-30 | ingested | disclosure log (`copy-all-callsigns-30-apr-24.csv`); Salesforce object export (`Value__c,Product__c,Status__c,Type__c`, latin-1, no date column); ingested as `archive/foi/ofcom-2024-04-30--copy-all-callsigns--all-callsigns` (154,582 records, variant `ofcom-2024-04-30-register`; carries the ~44,777 blank-product reserved pool; constant `Type__c` dropped; vintage declared-not-proven, resting on the filename alone) |
| Ofcom "Listing of UK Amateur Radio Callsigns" annex | 2024-07 | ingested | disclosure log (`annex-1-all-callsigns.xlsx` + `call-signs.csv`); Andy Pursell (WDTK, Jun/Jul 2024); ingested as `archive/foi/ofcom-2024-07--call-signs--all-callsigns` (155,346 records, variant `ofcom-2024-07-register`) |
| WDTK 1141667 ("Listing of UK Amateur Radio Callsigns", Ofcom ref 01842686) | 2024-07-22 | ingested | a distinct, previously unheld disclosure — **not** a copy of `ofcom-2024-07--call-signs--all-callsigns` — fetched from WhatDoTheyKnow (`Annex 1 All callsigns.xlsx`, Andy Pursell, responded 22 Jul 2024). Ingested as `archive/foi/wdtk-1141667--issued-callsigns` (110,622 data rows, variant `wdtk-1141667-issued-callsigns`). An issued-scope projection: `__c`-suffixed Salesforce header (`Call Sign,Product__c,Status__c,Type__c,LastModifiedDate`), every row carries a licence product (no blank-product pool) and only 9,792 Reserved, against the held 2024-07 open-data snapshot's 155,346 rows / 45,001 blank-product / 51,955 Reserved. Response letter held as a witnessed PDF; two trailing-NBSP callsigns (G0TQK, 2E1HON) trimmed and counted |
| Ofcom "Every radio callsign spreadsheet" | ~2024-09 | ingested | disclosure log (`every-radio-callsign-spreadsheet.csv`); the widest register shape (`Created Date,Product,Reserved to Date,Status,Type,Value`, UTF-8 BOM); ingested as `archive/foi/ofcom-2024-09--every-radio-callsign--all-callsigns` (159,999 records, variant `ofcom-2024-09-register`; the sole snapshot whose `Type` varies, so it is carried verbatim as `call_sign_type` — 3,951 NoV rows; vintage keyed by month, Created Dates top out at 2024-09-10) |
| WDTK 1180568 (Roger Howell, FOI 1900117 "licence breakdown by duration held and age") | 2024-09-30 | ingested | filed in landing 2026-07-07: sheet 1 = full snapshot **with Reserved-to-Date** (156k rows), sheet 2 = per-licence duration data (104k); age data withheld under s40(2); also on disclosure log (2024/october); ingested as `archive/foi/wdtk-1180568--licence-breakdown-duration-age` |
| Ofcom "Callsigns Spreadsheet – October 2024" | 2024-10-21 | ingested | disclosure log (`copy-of-callsigns-21102024.csv`, 10.3 MB); ingested as `archive/foi/ofcom-2024-10-21--callsigns--all-callsigns` (156,278 records, variant `ofcom-2024-10-21-register`) |
| Ofcom "Callsigns spreadsheet (March 2025)" | 2025-03-13 | ingested | disclosure log (`call-signs-13mar2025.csv`, filed under 2025/january); ingested as `archive/foi/ofcom-2025-03-13--callsigns--all-callsigns` (157,227 records, variant `ofcom-2025-03-13-register`) |
| Ofcom "Callsigns spreadsheet (October 2025)" | 2025-09-11 | ingested | disclosure log (`callsigns-spreadsheet-october-2025.xlsx`, filed under 2025/june); a Salesforce-flavoured workbook whose data vintage — the worksheet name `Amateur Callsgn 11092025` and the data's maximum date agree — is 2025-09-11, NOT the October publication month of the filename; ingested as `archive/foi/ofcom-2025-09-11--callsigns--all-callsigns` (158,470 records, variant `ofcom-2025-09-11-register`; the sixth register shape, carrying both a last-modified timestamp and the original-start date) |
| Ofcom "An up to date Callsign list February 2026" | 2026-02 | pending-fetch | disclosure log lists response PDF only — check for annex / whether it signposts open data |
| WDTK: Roger, "Previously available amateur radio callsign publications" | 2023-05-10 | not-held | answered not-held (wdtk-979275 filed); superseded as a lead by the disclosure-log/UKGWA channels above |
| WDTK: Roger, "Historical amateur radio call sign allocation rules and data" | 2023-05-11 | ingested (record) | letter 01618385 filed (wdtk-979811): G2/two-letter 2018-available/2020-withdrawn cycle, M7 2018 intro, "no single list charting status changes" — all on the record |

## FOI datasets — attribute addenda (join by callsign/prefix/suffix)

| source | date | status | notes |
|---|---|---|---|
| Reciprocal licences since 2010 (Billy McFarland) | 2017-12-22 | ingested | callsign + reciprocal-since date, 2010→mid-2016; paste held in landing/pasted-artefacts; **authoritative xlsx recovered via UKGWA** (`list-reciprocal-licences-since-2010.xlsx`, 28 KB) — diff vs paste; BST-midnight-in-UTC timestamps need care; ingested as `archive/foi/ofcom-498906--reciprocal-licences-since-2010` |
| Re-issued call signs since 2010 (Billy McFarland) | 2017-12-22 | ingested | **new dataset class recovered via UKGWA** (`list-re-issue-amateur-radio-call-signs.xlsx`, 19.7 KB) — per-callsign reissue list; pairs with the reciprocal xlsx; ingested as `archive/foi/ofcom-498903--reissued-callsigns-since-2010` |
| Club callsigns / T-numbers (Billy McFarland, Ofcom 00896085) | 2020-04-23 | ingested | no native attachment obtainable (PDF-only disclosure), so ingested as `archive/foi/ofcom-2020-04-23--club-call-signs` via the PDF-disclosure class: the Save-As-PDF `copy-of-club-call-signs-23-04-20.pdf` is the truth, transcribed to a byte-deterministic parse-source CSV by `src/shared/pdf-table-extract.ts` (self-check committed); 2,049 per-licence records (Live 1,613 / Surrendered 258 / Terminated 178), 209 recurring callsigns and 12 blank-callsign rows preserved verbatim; attribute-addendum class, variant `ofcom-2020-04-23-club-callsigns`; response letter transcribed alongside |
| Forbidden suffixes FOI (Aug 2019) | 2019-08 | ingested (distilled) | reference-data/forbidden-suffixes.csv; TWO raw variants exist (landing copy vs Browser-repo copy, byte-different — BOM/EOL suspected, equivalence unverified); raw originals not yet archived |
| Forbidden amateur radio callsigns (disclosure log) | 2024-12 | ingested | ingested as `archive/foi/ofcom-2024-12--forbidden-suffixes` (`forbidden-amateur-radio-callsigns.csv` + `normalised--forbidden-amateur-radio-callsigns.csv`, forbidden-list class); the five-years-later comparison point for the 2016/2019 lists — same 1,465-suffix set modulo +JIZ, −QNF, −ZFJ; feeds `reports/forbidden-suffix-history.md`, the ever-forbidden union (1,466) and the per-suffix first-known-forbidden dates. The companion M7 foundation CSV in the same December 2024 disclosure-log folder is a separate dataset, not yet ingested |
| Per-prefix live-callsign counts (Daryl Spence "Ama" FOI) | 2018-07-05 | pending-ingest | counts inline in the WDTK response (20: 8612, 21: 1596, G0: 8615 … **G2: 164, G5: 58**); bears on the G2/M2 story; Ofcom-published copy likely `Amateur-radio-licence-statistics-FOI.pdf` |
| Amateur licences revoked 2011–2021 (Stewart Baker, WDTK) | 2021-06 | pending-fetch | includes revocation reasons; response confirms on the record that class is denoted by callsign prefix; earlier UKGWA `FOI-list-revoked-amateur-radio-licences.pdf` (~2017) is a companion |
| Amateur licences surrendered or cancelled (disclosure log) | 2024-11 | pending-ingest | PDF |
| Amateur full callsign changes (UKGWA) | ~2020-21 | pending-ingest | `amateur-full-callsign-changes.pdf` — callsign-change events, attribute class |
| Licence-holder statistics (various) | 2018→2024 | pending-ingest | licensing numbers by class / historic licensing numbers / Radio Amateur numbers 2019 / gender split 2022 (xlsx+pdf) / duration+age FOI 1900117 (already filed in landing) |
| Annual licence counts **2003/04→2012/13** (financial years), amateur AND business radio (Nige Coleman, WDTK 184767, Ofcom 1-246847147) | 2013-12 | **graduated to archive/foi** | `Number of licences Coleman.pdf`; requester asked from 1993 but **1993–2003 was refused under s.12** (£450 limit, NCND on archive holdings) — corrected 2026-07-07 after PDF extraction (earlier register/entry text over-claimed "back to 1993"); letter's wording is licences **issued**, not *held*; **caveat on the record**: pre-lifetime-licensing "amateur" figures include CB + Maritime (RLC aggregate) — explains the 2004/5 (167,561) and 2005/6 (157,256) spike vs ~25k normal years; 2012/13 amateur = 28,041; Ofcom published monthly stats at licensing.ofcom.org.uk circa 2013-14 (UKGWA monthly-series lead) |
| Amateur Radio Licence Statistics (Stewart Baker, WDTK: 2013-09 FoI 1-241858032 **in landing**; Q1 2018 + Q2 2018 pending) | 2013, 2018 | partly in landing | 2013 response + ack PDFs fetched (wdtk-174543); request text itself quotes Ofcom's published monthly stats as of 2013-08-28 (F 18,195 / I 7,727 / Full 53,691 / Club 1,487 / Recip 701 = 81,801); Q2 2018 request newly discovered via sidebar |
| Re-issue policy + last-20-applicants reasons (Eckersley, WDTK 251507) | 2015-02 | **in landing (2026-07-07)** | `policy for old call signs.pdf` + `applicants old call signs.pdf` — pre-2016 heritage/re-issue regime |
| Call-book PSI licensees (Mark Witton, WDTK 248271, Ofcom 1-277622422) | 2015-01 | **graduated to archive/foi** | answer: **the empty set** — one application form ever requested, none completed, no licensee known (corrected 2026-07-07 on extract review; earlier note assumed a licensee list existed); the entry archives the never-used PSI 1 form + click-use terms (May 2009) |
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
| FOI 01667041 (Billy, "Amateur Radio Licence Errors") | 2023-10-02 | ingested | Section 84 refusal: Ofcom "we do not record it in this way" for class-product mismatches, citing M5SHA as the example — confirms the mismatch table is information Ofcom does not hold; the M5SHA observation itself is tracked on the class-product-mismatch anomaly review (`reports/class-product-mismatches.md`). Ingested as a correspondence-only placeholder, `archive/foi/wdtk-1021241--licence-class-format-mismatch-not-held` (response-letter PDF + extract + correspondence transcript; no dataset) |
| WDTK 945167 (Mark Savage, "Amateur radio full licence calls", Ofcom FOI 1562825) | 2023-03-01 | not-held | Ofcom holds no discrete list of formerly-issued Full callsigns available to request — the licensing system generates callsigns on demand; companion to the 612185 unallocated-callsigns not-held answer. Ingested as a not-held placeholder, `archive/foi/wdtk-945167--available-full-callsigns-not-held` (response-letter PDF + extract + correspondence transcript) |
| E Munro "Amateur radio licence holder M5SHA/MM5SHA" (Ofcom 01403789) | 2022-01 | rejected | refused (personal data — asked whether a named person holds M5SHA); M5SHA was drawing FOI attention 20 months before 01667041 — footnote/cross-reference for the M5SHA callsign page |
| Adam Dean internal review, "List of available Amateur Radio Callsigns (Updated for 2021)" (ref 01224257) | 2021-04 | pending-fetch | Ofcom on the record: "We do not hold a list of all available amateur radio call signs. Instead, our licensing system generates the call signs on demand… any three-letter combination" — load-bearing statement for availability semantics |
| WDTK October 2016 repeat of the available-list ask (reportedly answered "not held" - the earliest known not-held answer in the series; cited in the January-2016 available-list correspondence) | 2016-10 | pending-fetch | locate the WDTK thread; would date the start of the not-held era between 2016-06 (285990 list served) and 2016-10 |
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
| RSGB contractual/API data access (lead, 2026-07-07) | pending-investigation | reportedly advertised but used only by the annual-yearbook publishers — a potentially untapped modern source; modern continuation of the licensing pipeline documented by the row above; verify what RSGB actually offers and on what terms |
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

| source | why it matters | status |
|---|---|---|
| ITU-R Recommendation M.1172 (10/1995), "Miscellaneous abbreviations and signals to be used for radiocommunications in the maritime mobile service" — `itu.int/dms_pubrec/itu-r/rec/m/R-REC-M.1172-0-199510-I!!PDF-E.pdf` | the Q-code list that Ofcom's licensing system is "programmed not to allow as suffixes", cited in FOI 337399 (with Radio Regulations Art 19.46) — primary source behind the forbidden-suffixes reference data | fetched to drop zone 2026-07-07 (112,114 B, sha256 `cb1f99de…`); ITU copyright — cite, don't commit |
| RSGB Special Contest Calls table (`www.rsgbcc.org/hf/information/scc.shtml`) | the full SCC namespace enumeration (SCC code → base call → status); RSGB-administered NoVs, genuinely independent of the Ofcom register; surveyed and dispositioned in scope on #109 | ingested (reference-data, #693) — `reference-data/rsgb-special-contest-calls.csv` under cite-don't-copy (only the factual table extracted; RSGB prose cited, not reproduced); kept current by the monthly `scc-sweep` workflow; RSGB copyright on the prose — cite, don't commit the page. A richer one-off verbatim capture of this same page (FAQ, lifecycle, and the full allocation table) is additionally mirrored in the callsign-structure reference library (`docs/reference/callsign-structure/sources/rsgb-contest-committee-special-contest-calls-2026-07.html`, captured 2026-07-23, discovered via #109 comment, #959 follow-up); #961 proposes promoting this lane to a full recurring intake with raw-verbatim archiving and bi-temporal linkage, superseding cite-don't-copy-only for this source |
| Ofcom Special Contest Call Sign guidance, as published on the RSGB application page (`rsgb.org/main/operating/licensing-novs-visitors/online-nov-application/application-for-a-special-contest-call-sign/`) | Ofcom-authored guidance (SCC format incl. the RSL slot, the 520-callsign pool, the Ofcom-grants/RSGB-administers mechanism, the ≤48h contest-only usage bound, validity to 31 December 2029) hosted on an RSGB page rather than directly on `ofcom.org.uk`; cited by the structure reference's SCC row (#959) | context — mirrored verbatim in `docs/reference/callsign-structure/sources/rsgb-special-contest-call-sign-application.html`, captured 2026-07-23; hosting recorded honestly (Ofcom-authored, RSGB-hosted) rather than tiered as either a direct Ofcom document or an RSGB-authored page |



## Known data-coherency episodes (cross-vintage)

Register-wide temporal anomalies established by the 2026-07 data-coherency
sweep (#804). Recorded here so a future sweep — and the bi-temporal
event-time work (#725/#726) — inherits them rather than rediscovering them.
Each is flagged as observed, with candidate explanations offered but **not**
adjudicated (the project's flag-don't-adjudicate posture).

> Assumptions and hypotheses *about* the data (as distinct from the episodes
> observed *in* it) live in the sibling
> [`docs/hypothesis-register.md`](hypothesis-register.md) — a statused ledger of
> claims, each with re-runnable evidence and an epistemics tag.

| episode | what was observed | candidate explanations (not chosen) | issue |
|---|---|---|---|
| **Mass-update, 2025-10-11 / 2025-10-30** | `licence_version_last_modified_date` clusters onto two single days across every open-data vintage carrying the column: ~76k rows on 2025-10-11 + ~11k on 2025-10-30 = a **majority of the register** (61.7% / 58.5% / 55.2% in `archive/2025-11-11`, `2026-01-14`, `2026-06-23`). No other single day approaches this scale (next-largest weekly cluster ≈ 1,310 rows). The `v2026-licence-version-*` header variants — the first to carry these columns — first appear in the vintage fetched immediately after this window (2025-11-11). | a back-end/schema migration touching every record; a bulk administrative revision; a genuine data-quality event. The migration coincidence is suggestive, not established. | #801 |
| **Event-time creep** | The same callsign's earliest observed `licence_version_original_start_date` moves **forward** across vintages (never backward), by two mechanisms. **(A) Rolling version-history retention:** a callsign's older `licence_version_*` rows fall out of later exports, so the earliest *surviving* row is more recent — e.g. `G3ATI` holds a 1952-10-10 row in `archive/2025-11-11` that is simply absent from `archive/2026-06-23`. **(B) Reissue replacing the sole row:** a single-version callsign's date jumps wholesale on a variation/reissue — e.g. `G3SDS` 1977-07-09 → 2026-02-23 between the same two vintages, its last-modified moving too. Consequence: a vintage's earliest surviving start date is **not** evidence the earlier ones never existed. | bounded version-history windowing in the export; genuine licence reissue; export-mechanism artefact. The true original date is still true — it is just no longer present in the file. | #800 |

Both are re-runnable against the committed `normalised.csv` files (DuckDB
`read_csv_auto` recipes on the respective issues). The creep episode is the
concrete reason #725's event-claim extraction records "earliest *surviving in
this vintage*", never "the original".

Both episodes are now also detected mechanically: the standing cross-vintage
detector (`src/ci/event-time-coherency.ts`, #725 S2) finds each from the
event-date claims alone and commits the result to
[`reports/event-time-coherency.md`](../reports/event-time-coherency.md) —
episodes, per-step revision classifications and corroboration depth — so a
future vintage shifting either episode's fingerprint (or adding a new one)
surfaces as a PR diff rather than needing rediscovery.

Building on both, the state-at-t engine (`src/ci/state-at-t.ts`, #725 S3)
derives what the corpus can honestly say about a callsign at an arbitrary
date — inferred-only (#723), parameterised by both temporal axes, episode-
and creep-aware — and commits its worked demonstration to
[`reports/state-at-t.md`](../reports/state-at-t.md); the G3ATI/G3SDS episodes
above double as its ground-truth examples.

Generalising beyond the hand-picked episodes, the distributional-drift detector
(`src/ci/column-drift.ts`, #862) folds a per-column, per-vintage fingerprint
over every canonical column of the open-data `normalised.csv`s — the
populated/blank split, cardinality, value histogram, length distribution and a
character-class/per-character profile — and flags the vintage-over-vintage
divergences against named, tunable thresholds, committing the result to
[`reports/column-drift.md`](../reports/column-drift.md). With no hand-authored
expectations it rediscovers the known cases from the data alone: the mass-update
fingerprint above (a single day holding a majority of the modification column),
the 2026-01-14 Z-suffix cohort omission (#564 — the letter Z leaving then
re-entering the callsign column), the blank-product pool shifts, and the
export-variant/date-format drifts. Flags, never verdicts: each divergence
carries candidate explanations and adjudicates none.
