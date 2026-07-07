# Source manifest

All web material fetched 2026-07-07 unless stated. PDFs are mirrored in
[`sources/`](sources/); the `.txt` files beside them are lossy
`pdftotext -layout` extractions kept for searchability — the PDFs are
authoritative.

## Mirrored primary documents (Ofcom)

Ofcom material is © Ofcom and is reproduced here for reference with source
acknowledged, per Ofcom's terms of use (accurate reproduction, source
acknowledged, non-misleading context).

| document | published | sha256 | original URL |
|---|---|---|---|
| Amateur radio guidance — licensing guidance document for amateur radio (`amateur_radio_licence_guidance_for_licensees.pdf`) | **Updated 14 October 2025** — the post-implementation authority for the current system | `89fe14a5a818eaa8afc2c006ecff6710783c290bcd37da8ca2659168270dcd76` | [ofcom.org.uk](https://www.ofcom.org.uk/siteassets/resources/documents/manage-your-licence/amateur/amateur_radio_licence_guidance_for_licensees.pdf) |
| Statement: Updating the amateur radio licensing framework (`ofcom-statement-updating-amateur-radio-licensing-framework-2023-12.pdf`) | **11 December 2023** — the decision document for the licensing review | `a1aaca20b03ae644752029f2f13dbc3bb23d8bb0a513f15a61b19f3c562ab293` | [ofcom.org.uk](https://www.ofcom.org.uk/siteassets/resources/documents/consultations/category-2-6-weeks/263174-amateur-radio-licensing-framework/associated-documents/statement-updating-the-amateur-radio-licensing-framework) |
| Guidance: Implementing Phase 2 and 3 of the Amateur Review (`ofcom-guidance-amateur-radio-phase-2-and-3-review-2025-10.pdf`) | **14 October 2025** — go-live announcement for M8/M9, call sign changes, single licence, SES | `ffcc058444f2c7b446f71fc5eb35c593a02d7929a96efb4b9b34d3e193352504` | [ofcom.org.uk](https://www.ofcom.org.uk/siteassets/resources/documents/manage-your-licence/amateur/amateur-radio-phase-2-and-3-review.pdf) |
| Policy on temporary call signs and call sign enhancement (`policy-on-temporary-call-signs-and-call-sign-enhancement.pdf`) | **March 2018** — ⚠ SUPERSEDED by the 2023–2025 review; mirrored deliberately as the authoritative record of the *pre-2024* RSL and special-event regime | `877d4f7647f44482b03f420fdd8bc273befe0655953e6db61f1e041450e5ef00` | [ofcom.org.uk](https://www.ofcom.org.uk/siteassets/resources/documents/manage-your-licence/amateur/policy-on-temporary-call-signs-and-call-sign-enhancement.pdf) |

## Mirrored primary data (ITU)

- **ITU — Table of International Call Sign Series (Appendix 42 to the Radio
  Regulations)**, exported as
  [`sources/itu-call-sign-series-appendix42.xlsx`](sources/itu-call-sign-series-appendix42.xlsx)
  from the ITU GLAD application
  (<https://www.itu.int/gladapp/Allocation/CallSigns>; landing page:
  <https://www.itu.int/en/ITU-R/terrestrial/fmd/Pages/call_sign_series.aspx>),
  fetched 2026-07-07. © ITU. A derived
  [`itu-call-sign-series-appendix42.csv`](sources/itu-call-sign-series-appendix42.csv)
  (952 series rows, extracted from the xlsx) sits alongside for
  searchability — the xlsx is authoritative.
  The United Kingdom of Great Britain and Northern Ireland holds **93
  series**: the complete `2AA–2ZZ`, `GAA–GZZ`, and `MAA–MZZ` blocks — i.e.
  every `2x`, `Gx`, and `Mx` combination, which is why Ofcom can issue any
  RSL letter — plus overseas-territory blocks `VPA–VQZ`, `VSA–VSZ`,
  `ZBA–ZJZ`, `ZNA–ZNZ`, `ZOA–ZOZ`, `ZQA–ZQZ` (Gibraltar's ZB, the
  Falklands' VP, and related territories).

## Secondary sources (interpretations — quality varies)

| source | licence/terms | assessment |
|---|---|---|
| [Wikipedia: Call signs in the United Kingdom](https://en.wikipedia.org/wiki/Call_signs_in_the_United_Kingdom) | CC BY-SA 4.0 | Good structural overview incl. RSL table and special-case SES prefixes (GQ/GO/GR/MQ/GA/MO/2O); already reflects M8/M9 |
| [OARC Wiki: UK callsigns](https://wiki.oarc.uk/uk-callsigns) | CC BY-SA 4.0; community-maintained (Online Amateur Radio Community), last modified 2026-07-05 | Actively maintained; strongest community source for historical dates (1927 ITU prefixes; 1937 GM/GW; 1946 GC; 1977 GC→GU/GJ; 1991 `2` prefix) and special-station formats (GB3/GB7/MB7) |
| [OARC Wiki: UK licence archive](https://wiki.oarc.uk/uk-licence-archive) | CC BY-SA 4.0 | Archive of primary licence documents 1907→present (BR68 variants, Class A/B era terms) — the place to source pre-Ofcom-era primary documents |
| [RSGB: International prefixes](https://rsgb.org/main/operating/licensing-novs-visitors/international-prefixes/) | © RSGB | G/M prefix table incl. club secondary locators (GX/MX etc.) |
| [RSGB GB2RS 17 Oct 2025: Ofcom implements Phases 2 and 3](https://rsgb.org/main/blog/news/gb2rs/headlines/2025/10/17/ofcom-implements-phases-2-and-3-of-the-amateur-radio-licence-review/) | © RSGB | Implementation-date evidence for M8/M9 go-live |
| [Electronics Notes: UK amateur radio callsigns](https://www.electronics-notes.com/articles/ham_radio/call-signs/uk-amateur-radio-callsigns.php) | © Electronics Notes (Ian Poole) | Series/date table (pre-war 2-letter series through M7 2018); largely agrees with M0YBC |
| [M0YBC: UK callsigns history](https://m0ybc.weebly.com/uk-callsigns-history.html) | personal page; no author attribution visible beyond the callsign | Series/date table closely matching Electronics Notes (probably a shared lineage — treat as one voice, not two independent confirmations) |
| [G3LRS (club page): UK call signs](https://www.g3lrs.org.uk/training/callsign-types.html) | © Leicester Radio Society | Useful for Class A/B history, Q-suffix prohibition, and "RSL optional except `2`" — but ⚠ contains at least one error: gives `GA0AAA` as a Scotland example (Scotland is `GM`/`GS`; `GA` is not an RSL form, only a rarely-issued special SES prefix per Wikipedia). Demonstrates why club pages are treated as interpretations |
| [SOTA Reflector: "UK callsigns – potted history please?"](https://reflector.sota.org.uk/t/uk-callsigns-potted-history-please/30736) | forum posts © their authors | Community recollections, attributed per post in `licence-class-history.md` (ZL4NVW, GM4LLD, MW0PJE) |
| [Horsham ARC dates page](https://www.harc.org.uk/?page=technical&sub=Dates) | © HARC | Failed to fetch (JavaScript-rendered); listed for future manual capture |

## Research directories (not yet mined)

- **OARC Wiki A–Z directory**: <https://wiki.oarc.uk/directory> — further
  pages of interest: `uk-callsigns`, `callbooks`, `licence`,
  `licence_statistics`, `uk-licence-archive`, `clubcalls`.
- **OARC Wiki reference library**: <https://wiki.oarc.uk/referencelibrary> —
  scanned T&R Bulletin/RadCom (1925–1959) and RSGB callbooks (1920–2019);
  note the callbooks carry RSGB copyright and access conditions.
- **World Radio History**: <https://www.worldradiohistory.com/index.htm> —
  vast scanned-periodical archive; candidate for verifying pre-war series
  claims against contemporary magazines.

## Related material awaiting import

- A forbidden-callsign-suffixes FOI response (August 2019, 1,464 suffixes) is
  held by the maintainer and planned for import as a properly archived
  dataset — see issue #51 discussion.
