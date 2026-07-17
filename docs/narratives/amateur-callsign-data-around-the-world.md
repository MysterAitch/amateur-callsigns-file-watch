# Amateur callsign data around the world

*A comparative reference, not a data narrative in the [observed]/[derived]/[hypothesis] sense
used elsewhere in this collection — there is no derivation to walk. It exists
to give the UK/Ofcom model context by setting out, with primary citations, how
a handful of other national regulators publish (or decline to publish) their
amateur-radio callsign registers, and under what licence.*

**Context, not collection.** No foreign register data enters this project's
corpus. This mirror archives one register: the UK's, published by Ofcom (see
the [publisher register](https://mysteraitch.github.io/amateur-callsigns-file-watch/publishers/index.html)
and [`README.md`](../../README.md)). Every source cited below is recorded in
[`docs/source-register.md`](../source-register.md) with the status `context`
— that vocabulary's own definition is *"retained for reference, not a
dataset"* — meaning: looked at once, cited here, and not fetched, monitored,
or ingested. Nothing here carries a source-authority rung under
[ADR 0014](../adr/0014-trust-rating-safety-net.md); that axis is for material
this project actually holds, and none of it applies to a register this
project has deliberately chosen not to touch.

The comparison below comes from the source survey recorded on
[issue #109](https://github.com/MysterAitch/amateur-callsigns-file-watch/issues/109)
(the pass covering international regulators, logged 2026-07-16/17), which
verified each regulator's own terms/legal-basis page directly. This write-up
re-checked a subset of those pages again on 2026-07-17; where a re-check could
not be completed, that is recorded honestly below rather than left implied.

---

## At a glance

| Regulator | What is published | Licence position |
|---|---|---|
| [FCC](https://www.fcc.gov/wireless/data/public-access-files-database-downloads) (USA) | Full bulk downloads of the entire amateur ("AM") service, as daily and weekly pipe-delimited files | Public domain — US federal government works carry no copyright ([17 U.S.C. §105](https://www.fcc.gov/wireless/data/public-access-files-database-downloads)); catalogued under [usa.gov/government-works](https://www.usa.gov/government-works) |
| [BNetzA](https://data.bundesnetzagentur.de/Bundesnetzagentur/SharedDocs/Downloads/DE/Sachgebiete/Telekommunikation/Unternehmen_Institutionen/Frequenzen/Amateurfunk/Rufzeichenliste/rufzeichenliste_afu.pdf) (Germany) | Every currently-assigned callsign, republished monthly as a PDF; a daily-updated live single-callsign search sits alongside it | Explicitly **excluded** from formal Open Data status — the personal-data exception at [§12a EGovG](https://www.verwaltungsdaten-informationsplattform.de/register/199) is the stated reason |
| [ACMA](https://www.acma.gov.au/radiocomms-licence-data) (Australia) | Daily bulk CSV extract plus a documented, credentialled API; amateur callsign and qualification level are on the public register | All rights reserved — reuse is contractually restricted to spectrum-management purposes, not granted generally |
| [ANFR](https://data.anfr.fr/node/31) (France) | Aggregate/anonymised statistics only (age pyramids, exam pass rates, geographic distribution) | n/a — no per-callsign register export is published under this open-data programme |
| Ofcom (UK) | No routine, catalogued per-callsign publication; the current register is FOI-mediated for anything beyond the live snapshot | Ofcom's own [terms of use](https://www.ofcom.org.uk/about-ofcom/website/terms-of-use) is the confirmed basis; OGL v3 applies where Crown-copyright FOI material is disclosed — the "UK model in this context" section below unpacks the nuance this cell compresses |

---

## United States — FCC

The [Universal Licensing System](https://www.fcc.gov/wireless/data/public-access-files-database-downloads)
publishes the entire amateur-service register as daily and weekly zip files —
the `HD`/`EN`/`AM`/`SH` record types join into a complete licensee profile —
catalogued at [catalog.data.gov](https://catalog.data.gov/dataset/fcc-universal-licensing-system-uls),
whose licence field points to [usa.gov/government-works](https://www.usa.gov/government-works):
US federal government works carry no copyright, under 17 U.S.C. §105, and the
OPEN Government Data Act requires open licensing of published federal data
with no reuse restriction. This is the standard public-domain posture for
federal data generally, not a grant specific to amateur radio.

The **ARRL**, the US national society, adds nothing independent here: its
["Advanced Call Sign Search"](https://www.arrl.org/advanced-call-sign-search)
is a lookup UI over the same ULS bulk files, not a second data source.

UK relevance here is reciprocal/visiting-operator recognition — but
"reciprocal" alone overstates a symmetry the rule text itself does not
support, so this is worth stating precisely rather than leaving implied.
Under [47 CFR §97.107](https://www.law.cornell.edu/cfr/text/47/97.107)
("Reciprocal operating authority"; mirrored at
[eCFR](https://www.ecfr.gov/current/title-47/chapter-I/subchapter-D/part-97/subpart-B/section-97.107)),
a UK-licensed visitor operates in the US under their own home callsign with a
US call-district prefix (e.g. `W4/M0ABC`) — no FCC-issued licence, no
application, no fee, and no ULS row. The FCC once issued an actual document
for this, the "Reciprocal Permit for Alien Amateur Licensee" (RPAAL), before
discontinuing it in favour of the current licence-exempt regime; the exact
transition date was not independently pinned down, so that detail is
recorded as unverified rather than dated. Either way the direction of travel
is the opposite of the UK's own: away from a register-visible tier, not
towards one. A UK national can separately become an ordinary FCC licensee by
sitting a US exam — open to any nationality, not a reciprocal mechanism at
all — and that produces a genuine ULS entry, but against a US mailing
address, with no nationality field recorded anywhere in ULS; it surfaces as
an ordinary US licensee, invisible as UK-origin in the data itself.

The UK's own side of this relationship is not symmetric either, and this
project's own corpus is the evidence — though the exact licence-product
naming needs care, since the corpus deliberately keeps two reciprocal
categories distinct
([`reference-data/licence-category.csv`](../../reference-data/licence-category.csv);
[`reference-data/README.md`](../../reference-data/README.md), the "two
reciprocal categories" note). Ofcom's *Amateur Radio Guidance* (updated 14
October 2025), §2.1.4, states plainly that CEPT T/R 61-01 short stays (under
three months) are licence-exempt and leave no Ofcom record, exactly like the
US case above, and that the UK's reciprocal-visitor licence is itself
scheduled for phase-out. Visitors outside that exemption — longer stays, or
those on a bilateral reciprocal arrangement rather than the CEPT route —
instead hold an actual **"Amateur Temporary Reciprocal Radio Licence"**: the
exact product string this project's own register data carries, not a
paraphrase (`reference-data/licence-category.csv`; the Ofcom formal name is
understood to add a "(Full)" licence-class qualifier, but that specific
wording is guidance-derived rather than confirmed against a primary form, so
this write-up anchors on the register's own citation-grade string). This
project already holds that tier's evidence directly: the
`ofcom-498906--reciprocal-licences-since-2010`
FOI disclosure is precisely that callsign list, and the three `Reserved` rows
flagged in [ADR 0005](../adr/0005-canonical-callsign-forms.md) — `M/#PT2FM`,
`M/#VK4VGK`, `M/#YO3IES`, home calls from Brazil, Australia and Romania —
carry that exact product name in the register (`archive/2023-02-20/normalised.csv`)
— a real register entry naming a foreign home callsign, not the licence-exempt
case.

A separate, permanent category — **"Amateur Full (Reciprocal) Radio
Licence"** — must not be confused with the tier above: it is a permanent UK
Full licence granted on a recognised foreign qualification (HAREC / CEPT
T/R 61-02), producing an ordinary UK-format callsign (`G0`/`M0`…), not an
`M/#` visitor call.
`reference-data/README.md` keeps `Temporary Reciprocal` and `Full Reciprocal`
distinct precisely because they differ in duration, rights and legal basis:
the HAREC/CEPT T/R 61-02 route belongs to `Full Reciprocal`, never to the
short-term visitor tier the `M/#` rows sit in. This write-up defers to the
register's own verified product name for any claim about what a specific
`M/#` row *is*, and cites the guidance only for what it states unambiguously
here: the T/R 61-01 exemption, and the Temporary Reciprocal tier's scheduled
phase-out.

So the asymmetry runs one way, not two: the UK records a slice of its
visitors more explicitly than the FCC records any of the UK's, and no UK
callsign appears in the ULS for the reciprocal/visiting-operator case. That
is a confirmation of this project's Ofcom-only mirroring scope, not a
limitation of it — there is nowhere else a UK callsign as such would show up.

Of the regulators surveyed, this is the clean contrast case: a national
regulator publishing its entire register as free, daily-updated,
machine-readable bulk downloads — the opposite end of the spectrum from a
residential-IP-gated, on-request posture.

*Re-verification note: the FCC page and the ACMA page below could not be
re-fetched from this write-up's own network on 2026-07-17 — both a
content-fetch and a direct HTTP request timed out repeatedly against
`fcc.gov` and `acma.gov.au`. That is recorded honestly as "not re-verified
this pass," not as evidence either page is down: the #109 survey did
successfully retrieve both, and the [catalog.data.gov](https://catalog.data.gov/dataset/fcc-universal-licensing-system-uls)
mirror of the FCC listing resolved cleanly on the same re-check pass.*

## Germany — BNetzA

This is the case the project's own openness narrative most directly bears on,
and the reason this comparison exists at all. BNetzA publishes a monthly
"Rufzeichenliste" PDF listing every currently-assigned German amateur
callsign, alongside a daily-updated [live single-callsign search](https://ans.bundesnetzagentur.de/Amateurfunk/Rufzeichen.aspx).
That is complete, current, bulk publication — closer to the FCC's posture
than to Ofcom's. But the register's own catalogue entry, at
[verwaltungsdaten-informationsplattform.de/register/199](https://www.verwaltungsdaten-informationsplattform.de/register/199),
states plainly (re-verified 2026-07-17, quoting the German original so nothing
is lost in translation):

> "Aufgrund von Ausnahmetatbeständen nach § 12a EGovG (Schutz personenbezogener
> Daten) ist der Datenbestand nicht Open Data-tauglich."

— because of the exemption at §12a of the E-Government Act (protection of
personal data), the dataset is **not suitable for Open Data status**. The page
adds that a system modernisation is under way that may eventually enable
machine-readable release under the same privacy safeguards.

**This is the load-bearing case for the whole page.** Publication and open
licensing are demonstrably separable regulatory decisions — BNetzA does the
former every month and has explicitly declined the latter, on record, citing
personal data as the reason. That is the same tension a register carrying real
individuals' identifiers always sits inside; BNetzA is simply the one
regulator surveyed that states its position in so many words rather than
leaving it implicit.

**DARC**, the German national society, does not maintain an independent
callsign database; its own enquiry guidance points straight back to the
BNetzA search tool. UK relevance follows the same asymmetric pattern set out
in the FCC section above: Germany is a CEPT T/R 61-01/61-02 signatory, so a
UK visitor operates licence-exempt with no BNetzA register trace, while the
UK's own Temporary Reciprocal licence tier (see above) remains the more
explicit side of the relationship. No BNetzA-specific visitor-licensing page
was checked independently this pass, so this rests on the CEPT-bloc-general
finding rather than a direct read of a German source.

## Australia — ACMA

The [Register of Radiocommunications Licences](https://www.acma.gov.au/radiocomms-licence-data)
offers a daily CSV extract, a documented credentialled API, and an offline
browsing tool, with amateur callsign and qualification level on the public
register. But its terms state (per the #109 survey's direct quotation of the
page):

> "Intellectual Property in the Register is retained by the ACMA... all
> rights [are] reserved and you may not make copies of the Register or any
> part of the Register, except as expressly provided in the Licence"

with permitted use scoped to spectrum-management purposes. So the RRL is the
sharpest illustration in this survey that **publicly downloadable is not the
same thing as openly licensed**: daily bulk access exists, but reuse beyond
the stated purpose is contractually gated, unlike the FCC's public-domain
posture.

**WIA**, the Australian national society, historically compiled a printed and
CD-ROM "Callbook" from RRL extracts under a formal agreement with ACMA — but
in 2020 ACMA advised WIA to move away from using RRL data for that purpose,
consistent with a tightening rather than a loosening of terms over time.

UK relevance follows the same asymmetric pattern set out in the FCC section
above: the current [Radiocommunications (Amateur Stations) Class Licence 2023](https://www.wia.org.au/members/legislation/classlicences/documents/Radiocommunications%20%28Amateur%20Stations%29%20Class%20Licence%202023.pdf)
(successor to the [2015 instrument](https://www.legislation.gov.au/Details/F2015L01114))
is licence-exempt on the same shape as the UK's own short-stay tier: no RRL
entry, home callsign with a "VK" prefix. ACMA's own guidance gives two
different duration figures for this exemption — 365 days for qualifications
listed in its Tables A/B, and separately 90 days as the threshold beyond
which "an Australian amateur apparatus licence" is required — and the two
were not reconciled this pass, recorded as an open discrepancy rather than
resolved by picking one. Whether that longer-stay licence would create an
RRL entry naming a UK home qualification — structurally the closest thing to
an ACMA equivalent of the UK's own Temporary Reciprocal licence tier — is a genuine
open lead, not confirmed either way. (See the FCC section above for this
page's own re-verification note, which covers ACMA too: ACMA's
visiting-amateur pages could not be re-fetched directly this pass, so this
rests on search-indexed excerpts and the legislation.gov.au primary text,
not a direct read of the current instrument.)

## France — ANFR

ANFR runs an ["Observatoire des radioamateurs"](https://data.anfr.fr/node/31)
open-data portal, re-verified 2026-07-17: it publishes **aggregate and
anonymised statistics only** — age pyramids, exam pass rates, geographic
distribution by department, spanning 1960 to date — and states explicitly
that the figures are "sourced from official registers... consolidated and
anonymized." There is no per-callsign register export under this programme,
and no licence statement was found on the page itself.

ANFR separately runs a live per-callsign lookup, the "annuaire" at
`amatpres.anfr.fr` — its bulk-export capability could not be confirmed by the
#109 survey, and this write-up's own re-check found the same: the page issues
a malformed redirect (`https://www.anfr.fr` with the following path
concatenated straight on, missing the separating slash) rather than resolving
cleanly. That is recorded as **unverified**, not as **absent** — a genuinely
open question, not a closed one.

ANFR's general open-data portal otherwise uses the Etalab
[Licence Ouverte v2.0](https://www.etalab.gouv.fr/wp-content/uploads/2017/04/ETALAB-Licence-Ouverte-v2.0.pdf)
for its other datasets, so a bulk amateur export, if one exists, would likely
carry that licence — a follow-up worth revisiting if the annuaire's export
capability is ever confirmed.

**REF**, the French national society, maintains its own opt-in
["Nomenclature"](https://nomenclature.r-e-f.org/) directory — member-submitted,
not authoritative, the same shape as the RSGB Yearbook's self-compiled
directory rather than a regulator mirror. UK relevance follows the same
asymmetric pattern set out in the FCC section above: France is a CEPT
signatory, so the licence-exempt T/R 61-01/61-02 model applies and no UK
callsign would appear in a French register for a short visit. No ANFR-specific
visitor-licensing page was checked independently this pass, so, as with
BNetzA above, this rests on the CEPT-bloc-general finding rather than a
direct ANFR source.

---

## The UK model in this context

Ofcom's posture does not sit at either end of this spectrum, and the
comparison table's single cell compresses more than it should say on its own,
so this section spells out the nuance directly rather than leaving the
compressed version to stand unqualified.

Ofcom **does** publish a current register CSV — that file is exactly what
this project's [open-data lane](../../README.md) mirrors on every change. What
it does not do is what marks out the FCC/ACMA/BNetzA end of this survey: there
is no dedicated open-data catalogue entry for the register, no stated reuse
licence attached to that specific file, no historical archive of past
snapshots maintained by Ofcom itself (each publication simply overwrites the
last), and the live file sits behind Cloudflare, fetchable only from a
residential IP, not a documented API or bulk-download programme. Recovering
anything earlier than "whatever is live right now" runs through Freedom of
Information requests instead — this project's own
[FOI lane](../adr/0004-foi-source-lane.md) exists precisely because Ofcom does
not publish that history itself; it now holds 25+ recovered vintages back to
2016.

On licensing, the project's own verified position
([`reference-data/publishers.json`](../../reference-data/publishers.json),
[`archive/LICENSE.md`](../../archive/LICENSE.md)) is more cautious than the
table's "OGL v3 where published" shorthand: the confirmed, cited basis for the
register itself is Ofcom's general [terms of use](https://www.ofcom.org.uk/about-ofcom/website/terms-of-use)
— reproduce accurately, do not mislead, acknowledge Ofcom copyright — not an
explicit invocation of the Open Government Licence on that page. OGL v3 is
confirmed as the operative basis where Crown-copyright material is disclosed
through Freedom of Information (the WhatDoTheyKnow-mediated FOI responses this
project also holds); it is recorded as "a consideration," not asserted, for
the live open-data CSV specifically. That distinction is exactly the kind of
gap this project's epistemics conventions ask to be surfaced rather than
smoothed over — so it is surfaced here rather than left inside a one-line
table cell.

Set against the four regulators above, the UK model reads as: publication
exists but is neither catalogued, licensed at the file level, nor historically
retained by the regulator; access is IP-gated rather than open; and the
licence basis that *is* confirmed (Ofcom's own terms of use) is narrower than
a formal open-data grant. It is closer to the ACMA shape (access without a
general reuse grant) than to the FCC's public-domain posture, and shares with
BNetzA the underlying reason a register carrying real people's identifiers
tends to stop short of full openness — without BNetzA's advantage of stating
that reason on the record.

None of this is a finding about *this* project's own data quality or
completeness — that is what the [fidelity](https://mysteraitch.github.io/amateur-callsigns-file-watch/fidelity.html)
and [glossary](https://mysteraitch.github.io/amateur-callsigns-file-watch/glossary.html)
pages cover. This page is scoped narrowly to *how open the underlying register
is, and under what licence* — the context a reader needs to judge whether
Ofcom's posture is unusual, and it turns out the honest answer is: not
uniquely closed, not uniquely open, and — per BNetzA — not even uniquely
justified by personal data as the reason for stopping short.

---

## Sourcing and verification

- **Primary sources only.** Every claim above cites the regulator's own
  terms/legal-basis page (or, for the FCC, the equivalent catalog.data.gov
  entry when the primary page could not be re-fetched this pass) — no
  secondary write-up, blog, or Wikipedia summary stands in for the regulator's
  own statement.
- **What was verified, and when.** The #109 survey verified all five
  regulator pages directly, logged 2026-07-16/17. This write-up re-checked
  BNetzA, ANFR, and Ofcom's terms of use again on 2026-07-17, quoting the
  live text where it matters (the §12a EGovG line, the ANFR methodology
  statement, Ofcom's reproduction terms) — all three matched the #109
  survey's findings on re-check. The FCC and ACMA primary pages could not be
  re-fetched from this write-up's own network on 2026-07-17 (repeated
  timeouts); that is recorded as **not re-verified this pass**, not as a claim
  that either page has gone offline — the #109 survey's original fetch of
  both stands, and the FCC's catalog.data.gov listing re-resolved cleanly as a
  partial check.
- **Tiering.** These sources carry no source-authority rung under
  [ADR 0014](../adr/0014-trust-rating-safety-net.md) — that axis derives
  trust from the lane a source lives in *inside this project's archive*, and
  none of this material lives there. The applicable vocabulary is
  [`docs/source-register.md`](../source-register.md)'s own `context` status:
  retained for reference, not a dataset. Every regulator above is recorded
  there under that status, so the disposition does not need re-deciding if
  this comparison is ever revisited.
- **What this page is not.** It is not a fetch, a monitor, or a standing
  comparator that needs keeping current with each regulator's own changes —
  it is a snapshot of a landscape survey, dated, with its own verification
  trail. A future revisit should re-run the same checks and update the dates,
  not assume the table above still holds indefinitely.

---

## Provenance and related threads

- The underlying source survey — FCC/ACMA/ANFR/BNetzA findings, licence
  citations, and the recommendation that BNetzA's case deserved "a durable
  one-line note... given how directly it bears on the 'how open should a
  register be' narrative this project already carries": **issue #109**
  ([thread](https://github.com/MysterAitch/amateur-callsigns-file-watch/issues/109)).
- This page: **issue #697**
  ([tracker](https://github.com/MysterAitch/amateur-callsigns-file-watch/issues/697)).
- The stable-endpoint conversation this comparison feeds context into:
  **issue #12**.
- The RSGB Special Contest Calls scheduled-refresh work, a UK-administered
  register-class source surveyed alongside the international material on
  #109: **issue #693**.
- The reciprocal/asymmetry correction to the "UK relevance" framing across
  this page, checked against Ofcom's own guidance and 47 CFR §97.107:
  **issue #762** ([thread](https://github.com/MysterAitch/amateur-callsigns-file-watch/issues/762)).
- This narrative form (curious-reader walkthroughs, published under
  `docs/narratives/` and discovered automatically by the reports hub):
  **issue #657**.

*The comparative table and per-country sections were checked against each
regulator's own primary page as described above; where a page could not be
re-fetched this pass, that is stated rather than implied. Foreign regulator
postures can and do change — treat the dates given as the last-verified point,
not a permanent status.*
