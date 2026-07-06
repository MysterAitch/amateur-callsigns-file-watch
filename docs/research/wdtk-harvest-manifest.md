# WhatDoTheyKnow FOI harvest manifest — amateur radio datasets

Working manifest for the one-off historical harvest (see issues #9, #25) and input to the
feed-watch monitoring idea (#19). Assembled 2026-07-06 from WDTK search feeds
(`/feed/search/{query} requested_from:ofcom`), web search, and request-page sidebars.

**Harvest flow:** open each request page in a browser → save HTML into a local folder →
attachment URLs + provenance get extracted from the saved pages → attachments fetched
directly (the `…/attach/…?cookie_passthrough=1` URLs serve to plain HTTP clients) →
land in `holding/wdtk-{request_id}/` with `provenance.json` + `meta.json` (entry shape
and metadata split per #25).

Base URL: `https://www.whatdotheyknow.com/request/`

## Tier A — callsign list datasets (core mirror scope)

| Request slug | Title / notes |
|---|---|
| `amateur_radio_callsigns` | 2014 — attachment seen: "Call Sign list available as at 14 March 2014.xlsx" |
| `list_of_allocated_amateur_radio` | 2021-05 — "Amateur callsigns.xlsx" (already held locally) |
| `amateur_radio_callsigns_2` | 2022-03 — "Amateur NoV.xlsx" (already held locally) |
| `callsign_allocation_data` | 2023-12 — "Call sign list 241123.csv" (already held locally) |
| `listing_of_uk_amateur_radio_call` | 2024-07 — "Annex 1 All callsigns.xlsx" (already held locally) |
| `issued_and_available_uk_amateur` | 2019-08 — "Allocated reserved forbidden Call Sign FOI Aug19.xlsx" (source of the forbidden-suffixes list) |
| `list_of_amateur_radio_callsigns` | needs date check |
| `list_of_amateur_radio_callsigns_2` | needs date check |
| `list_of_amateur_radio_callsigns_3` | ~2023-01 — list up to 25 Jan 2023 |
| `list_of_all_amateur_radio_callsi` | "List of ALL Amateur radio callsigns" |
| `list_of_allocated_callsign` | 2022-05 |
| `requesting_list_of_allocated_and`* | 2022-03 — "Allocated and Reserved" (slug unverified) |
| `list_of_available_amateur_radio_2` | available callsigns, needs date check |
| `list_of_available_amateur_radio_4` | available callsigns, needs date check |
| `list_of_available_amateur_radio_6` | 2021 — "Updated for 2021" |
| `available_amateur_radio_call_sig` | ~2016 — available list as at 21 Jan 2016 |
| `unallocated_uk_amateur_radio_cal_3` | ~2016 |
| `unallocated_uk_amateur_radio_cal_4` | needs date check |
| `amateur_radio_full_licence_calls` | 2023-02 — Full-licence callsigns available |
| `amateur_radio_special_event_call` | special event (GB) callsigns |
| `out_of_sequence_amateur_radio_ca` | out-of-sequence issuances |
| `uk_callsign_request` | seen via attachment link; needs review |

The four "already held locally" rows still deserve a page-save so the archive captures the
request/response correspondence context, and so held-file provenance can be re-verified.
Four further locally-held datasets (2021-12-19, 2022-03-10, 2022-06-08, 2023-02-10) have
unresolved slugs — match them by response date while saving pages.

## Tier B — licence statistics datasets

| Request slug | Title / notes |
|---|---|
| `amateur_radio_licenses_up_to_dat` | 2017 — monthly licence counts by class, "Amateur Radio.pdf" (page already saved) |
| `amateur_radio_licence_statistics_3` | Q1 2018 |
| `amateur_radio_licence_statistics_4` | Q2 2018 — check for siblings `_1`, `_2`, unsuffixed |
| *(slug tbc)* | "Amateur radio licensing statistics" (from feed; date tbc) |
| *(slug tbc)* | 2024-10 — "Radio amateur licence breakdown by duration held and age" |
| `number_of_licences` | licence counts |
| `amateur_licences_revoked_period` | revocations 2011–2021 |
| `amateur_radio_licences_issued_20` | 2019/2020 issuances, NI-focused |

## Tier C — policy / reference context (harvest-worthy, secondary)

| Request slug | Title / notes |
|---|---|
| `change_of_call_sign_policy` | callsign change/transfer policy |
| `allocation_of_amateur_radio_call` | allocation rules |
| *(slug tbc)* | "Historical amateur radio call sign allocation rules and data" (from feed) |
| *(slug tbc)* | 2023 — "Previously available amateur radio callsign publications" (meta: what Ofcom used to publish) |
| `amateur_radio_licence_errors` | 2023-10 — data-quality errors in licensing records |
| `rsgbs_licence_to_use_amateur_rad` | RSGB's licence to use call book data |
| *(slug tbc)* | "RSGB Licences Ltd"; "Agreement between OFCOM & RSGB (NoVs)" (from feed) |
| `foi_ham_radio` | needs review |
| `list_of_licence_holders` | needs review — may be non-amateur |

## Tier D — noted, likely out of scope (decide during harvest)

Exam syllabus/conduct; ICNIRP; Medium/Long Wave bands; prosecutions & unlicensed-operation
reports; individual-licensee requests (e.g. M5SHA); US-licence conversion; Ofcom staff licences.

## Monitoring (future, separate from harvest)

Settled design lives on #25 (intake flow + follow-up refinements) and #19 (access map):
the residential watcher polls `feed/search/callsign requested_from:ofcom` (+ spelling
variants — `"call sign"`, `amateur radio`), deduplicates by event id, and scaffolds an
intake branch per new request; a scheduled sweep workflow manages the PRs. Email-alert
ingestion is a possible future enrichment (#27). Cadence: weekly is ample.
