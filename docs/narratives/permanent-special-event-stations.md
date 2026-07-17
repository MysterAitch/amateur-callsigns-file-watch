# Permanent Special Event Stations: a paradox resolved at the regulator

*A data narrative — one finding in the amateur-callsign mirror, walked from a
data oddity to a labelled conjecture to a regulatory confirmation. It is a
story about licensing mechanics, not about the people or societies who run
these stations.*

Every claim below is tagged so you can tell what kind of statement it is and
check it yourself:

- **[observed]** — an **observation**: something read directly off the published
  register data. Re-runnable against the files named.
- **[derived]** — a **derivation**: a conclusion drawn by combining observations.
  The working is shown so the step can be repeated.
- **[hypothesis]** — a **hypothesis**: a possible explanation, recorded for
  investigation and **not asserted as fact**.
- **[confirmed]** — a **confirmation**: a hypothesis subsequently checked against a
  named, citable authority and found to hold.

Figures carry the vintage they were read from. Where a station's identity is
asserted, the source tier — primary, community, or unconfirmed — is stated
plainly rather than smoothed away.

---

## Summary

**[observed]** Ofcom's ["Every radio callsign spreadsheet"](https://mysteraitch.github.io/amateur-callsigns-file-watch/datasets/foi/ofcom-2024-09--every-radio-callsign--all-callsigns/index.html)
— the September-2024 snapshot — classes 53 register rows
`Permanent Special Event Station`. The class name is a small paradox on its
own terms: if a station is *permanent*, why does its register row carry a
finish date? And if the licence is genuinely time-bound, why is the class
called *permanent*?

**[confirmed]** The paradox resolves cleanly, and not merely as an educated guess:
Ofcom's own *Amateur Radio Guidance* (updated 14 October 2025), section 6.3,
states that Permanent SES variations run a fixed five-year term and that
Ofcom deliberately batches their expiry dates for review. "Permanent"
describes the **station** — a fixture at a museum or heritage site, intended
to stand indefinitely — while the finish date belongs to the **current
licensing term**, not to the station's intended life. The two readings were
never in tension; the register field just carries the paperwork's clock, not
the site's.

---

## The puzzle

**[observed]** In the [value catalogue](https://mysteraitch.github.io/amateur-callsigns-file-watch/reports/value-catalogue.html#temporal-character-of-the-special-event-family),
the licence-category vocabulary includes both an event-bounded
`Special Event Station` class (3,740 records corpus-wide) and a `Permanent
Special Event Station` class (53 records). The ordinary class's name reads as
one-off — a jubilee weekend, a single commemoration — while "permanent" reads
as standing. Both categories, though, sit inside the same NoV (Notice of
Variation) mechanism, and NoVs are inherently term-limited instruments. A
class called *permanent* riding on a *renewable, expiring* grant is the seed
of the puzzle this narrative follows to its resolution.

The register does not define its own category names, so — following the
value catalogue's own framing — the "permanent" and "event-bounded" readings
above are the names' nominal sense, not a rule the register enforces; the
per-record evidence in the next section is what actually discriminates.

---

## The three cohorts

**[observed]** Reading the [2024-09 snapshot](https://mysteraitch.github.io/amateur-callsigns-file-watch/datasets/foi/ofcom-2024-09--every-radio-callsign--all-callsigns/index.html)'s
53 permanent-SES rows against their [`status`](https://mysteraitch.github.io/amateur-callsigns-file-watch/glossary.html#status-values)
and `reserved_to_date` fields (the disclosure is dated 2024-09-10, so "the
perspective date" for what follows is around 10 September 2024) splits them
into three cohorts, plus one anomaly:

**Cohort 1 — blank end date + [Allocated](https://mysteraitch.github.io/amateur-callsigns-file-watch/glossary.html#allocated) (17 rows): permanent while held.**
No end date is stated at all — a station in current use, e.g. `GB0MWM`,
`GB0RSM`, `GB0SMA`.

**Cohort 2 — future end date + [Reserved](https://mysteraitch.github.io/amateur-callsigns-file-watch/glossary.html#reserved) (7 rows): active reservations with a forward window.**

| callsign | status | `reserved_to_date` | relation to vintage |
|---|---|---|---|
| [GB0RTM](https://mysteraitch.github.io/amateur-callsigns-file-watch/callsign.html?c=GB0RTM) | Reserved | 2024-10-03 | +3 weeks |
| [GB4HCM](https://mysteraitch.github.io/amateur-callsigns-file-watch/callsign.html?c=GB4HCM) | Reserved | 2025-04-26 | ~7 months |
| [GB2RHQ](https://mysteraitch.github.io/amateur-callsigns-file-watch/callsign.html?c=GB2RHQ) | Reserved | 2025-09-27 | ~1 year |
| [GB4UAS](https://mysteraitch.github.io/amateur-callsigns-file-watch/callsign.html?c=GB4UAS) | Reserved | 2026-02-08 | ~17 months |
| [GB0GPF](https://mysteraitch.github.io/amateur-callsigns-file-watch/callsign.html?c=GB0GPF) | Reserved | 2026-02-20 | ~17 months |
| [GB0YAM](https://mysteraitch.github.io/amateur-callsigns-file-watch/callsign.html?c=GB0YAM) | Reserved | 2026-04-12 | ~19 months |
| [GB0SNB](https://mysteraitch.github.io/amateur-callsigns-file-watch/callsign.html?c=GB0SNB) | Reserved | 2026-08-09 | ~23 months |

Seven distinct, unclustered dates — not one shared national date.

**Cohort 3 — past end date + [Available](https://mysteraitch.github.io/amateur-callsigns-file-watch/glossary.html#available) (28 rows): the termination reading.**
If the field were a forward-looking expiry, a snapshot taken years afterwards
should show either a renewed date or no record at all; instead the *ended*
date persists beside pool-availability. That behaviour is only consistent
with the field recording **when the NoV lapsed and the callsign returned to
the pool** — a retrospective termination record, not a forward plan.

| callsign | status | `reserved_to_date` | relation |
|---|---|---|---|
| GB0MAC | Available | 2017-06-30 | 7 years before |
| GB0AC | Available | 2020-06-30 | 4 years before |
| GB0AMH | Available | 2020-06-30 | 4 years before |
| GB0SSB | Available | 2024-06-30 | 10 weeks before |

**[derived]** Reconciling the two source figures on record for this cohort: 24 of
29 past-dated permanent-SES rows fall on a 30 June — and 29 is exactly
cohort 3's 28 `Available` rows plus the one `Allocated` anomaly below (all
past-dated), not a separate count. So across every past-dated row in the
class, the overwhelming majority land on the same calendar day: 30 June, the
NoV-year anniversary. That is anniversary precision, not day-of-return
precision — the field cannot distinguish a callsign that was returned,
lapsed, or administratively reclaimed on that date, only that its term
boundary fell there.

**The anomaly (1 row): `GB0WFB` — Allocated, `reserved_to_date` 2017-06-30 (seven years past, still held).**
Either renewed with a stale field, or held past its stated expiry; the
snapshot alone cannot decide which, so it is carried as a flagged row, not
smoothed into either cohort's story.

**[derived]** 17 + 7 + 28 + 1 = 53 — the full permanent-SES population for this
vintage accounts for every row.

---

## The conjecture, and its test

**[hypothesis]** Cohort 2 is the one that does not resolve on inspection alone: why
would a class named *permanent* carry an active forward-looking reservation
window at all? The candidate resolution, recorded explicitly as conjecture
before any confirming source was found — **"permanent" describes the
station, not the paperwork**:

- An ordinary Special Event Station is event-bound: it exists for one
  occasion and ends with it.
- A *permanent* SES would instead be a station whose **purpose is standing**
  — a museum, a heritage site, a club's fixed installation — intended to
  operate indefinitely rather than for one dated event.
- The granting instrument is still a Notice of Variation, though, and NoVs
  run on renewable terms. On this reading, `reserved_to_date` is the
  **current term's end**, not the station's own intended end.

Named discriminators were set out before testing them: **supporting**
evidence would be the seven cohort-2 callsigns resolving to standing
institutions whose `reserved_to_date`s track paperwork renewal cycles rather
than event dates; **refuting** evidence would be those callsigns resolving to
genuinely dated one-off events, or windows aligning with an event date. A
definitive answer, it was noted at the time, would need Ofcom's own
definition of the class.

**[confirmed]** That definition turned out to already be published. Ofcom's
*Amateur Radio Guidance* (updated 14 October 2025), section 6.3, "Permanent
Special Event Station (SES)":

> "PSES are valid for 5 years. Variations are renewable every five years,
> upon reapplication. The PSES variations that we grant all expire on the
> same date, allowing us to review them."
> — [Ofcom, *Amateur Radio Guidance*](https://www.ofcom.org.uk/siteassets/resources/documents/manage-your-licence/amateur/amateur_radio_licence_guidance_for_licensees.pdf), s6.3

The same section frames PSES stations as sited **permanently** at a museum
or curated display of national or international significance (citing the
Imperial War Museum and the Abbey Mills pumping station as its own examples)
— corroborating the "standing institution" half of the conjecture directly,
not just the paperwork half.

Reading all three cohorts through this confirmed mechanism, they reconcile
without contradiction: `Allocated` + blank (cohort 1) is a station whose
current term simply is not surfaced in this field; `Reserved` + future date
(cohort 2) is a station mid-term, with its NoV's current expiry recorded;
`Available` + past date (cohort 3) is a station whose term lapsed and was not
renewed, releasing the callsign back to the pool. Across all three,
"permanent" ends up meaning *renewed indefinitely, unless not renewed* — the
station's standing intent, worn by a licence that still has to expire and be
reviewed like any other.

One loose end the confirmation does not close: why the seventeen cohort-1
rows carry no mirrored term-end in this field at all, while cohort 2's do.
That is recorded honestly as unresolved rather than inferred past the
evidence.

---

## The seven stations

**[observed]** Per-callsign research (widened past the licensing data itself, into
public club, museum and lookup-service pages) identified what each cohort-2
station is, with its evidence tiered honestly — primary, community, or
unconfirmed:

| Callsign | What it relates to | Source tier |
|---|---|---|
| [GB0RTM](https://mysteraitch.github.io/amateur-callsigns-file-watch/callsign.html?c=GB0RTM) | Rougham Tower Museum, Bury St Edmunds — the former control tower of the 94th Bomb Group (USAAF), home ground of the Bury St Edmunds Amateur Radio Society | Community-tier: the society's own homepage names the venue and its callsigns; a public callbook-style listing records the station name and location |
| [GB4HCM](https://mysteraitch.github.io/amateur-callsigns-file-watch/callsign.html?c=GB4HCM) | Heron Corn Mill, Beetham, Cumbria — a working watermill heritage site, activated by a local amateur radio group | Community-tier: the activating group's own blog names the site under this callsign; a public lookup-service record matches |
| [GB2RHQ](https://mysteraitch.github.io/amateur-callsigns-file-watch/callsign.html?c=GB2RHQ) | Hack Green Secret Nuclear Bunker, Cheshire — the former RAF Hack Green ROTOR radar station and Cold War Regional Government Headquarters, now a Cold War museum, operated on-air by a local amateur radio society | Community/technical-tier: the one callsign that resisted identification under an initial, narrower search; resolved once the search widened beyond the usual lookup services, corroborated across several independent sources (the site's own technical pages, a companion technical write-up, a contemporary blog post, and directory entries) rather than resting on one. No single primary/regulatory-tier source confirms it, so this sits at community tier, not the higher primary tier below |
| [GB4UAS](https://mysteraitch.github.io/amateur-callsigns-file-watch/callsign.html?c=GB4UAS) | Plausibly the Ulster Aviation Society, Maze Long Kesh, Lisburn (the acronym matches exactly, and the manager callsign carries the Northern Ireland RSL prefix) | **Unconfirmed**: circumstantial only — no source directly states "GB4UAS" alongside the Society's name; the link is inferred from the acronym and the manager callsign, not confirmed in any source found, and is recorded as such rather than as fact |
| [GB0GPF](https://mysteraitch.github.io/amateur-callsigns-file-watch/callsign.html?c=GB0GPF) | Grey Point Fort, Crawfordsburn/Helen's Bay, Co. Down — a coastal artillery fort (built 1904–07), run since 2008 by an amateur radio society formed for the purpose | Community/heritage-tier: a national society's regional news post (2018) confirms the callsign as the fort's permanent one, run by the named society since 2008 |
| [GB0YAM](https://mysteraitch.github.io/amateur-callsigns-file-watch/callsign.html?c=GB0YAM) | Yorkshire Air Museum, Elvington — a former WWII Bomber Command airfield, now the UK's largest independent air museum | **Primary-tier**: the museum's own social-media account states directly, "Our radio station call sign is GB0YAM" |
| [GB0SNB](https://mysteraitch.github.io/amateur-callsigns-file-watch/callsign.html?c=GB0SNB) | Kelvedon Hatch Secret Nuclear Bunker, Essex — a Cold War regional government bunker, with a permanent callsign run by a contest group formed in 2015 | Community-tier: the operating group's own site, a Wikipedia entry for the bunker, and a station-manager's personal page all corroborate |

**[derived]** No individual anniversary, centenary, or event-start date was found
to explain any of the seven cohort-2 dates — every identifiable callsign
resolved to a genuinely permanent fixture (a museum, fort, mill, or bunker)
rather than a one-off commemorative event, so there was never a single-day
anniversary to test the dates against in the first place. That absence is
itself evidence for the confirmed mechanism: the dates are administrative
batch boundaries, not event dates, exactly as Ofcom's guidance states.

**[observed]** There is a pleasing symmetry worth noting on the record: of the
seven cohort-2 stations, two are explicitly branded "Secret Nuclear Bunker"
museums — Kelvedon Hatch (`GB0SNB`) in Essex and Hack Green (`GB2RHQ`) in
Cheshire — both independently holding permanent SES callsigns, identified via
entirely separate research paths (the second only after the first search's
scope was widened).

---

## The administration chain

**[observed]** A separate source survey ([issue #109](https://github.com/MysterAitch/amateur-callsigns-file-watch/issues/109))
prompted directly by these seven callsigns asked a wider question: who
actually administers a Permanent SES grant, and does anyone besides Ofcom
publish a register of them? Citing Ofcom's own guidance sections 6.1–6.5
directly:

- **Ordinary and Permanent SES (s6.2, s6.3)** — applications go **directly to
  Ofcom**; RSGB (the Radio Society of Great Britain) has **no administrative
  role** in either grant. RSGB's only involvement is downstream, optional
  publicity — and that channel is itself opt-in gated: unless the applicant
  specifically ticks a data-protection consent box on Ofcom's own NoV
  application form, "Ofcom cannot tell RSGB about your event and RSGB will
  NOT be able to promote it." **This is the direct explanation for why no
  complete public listing of special-event stations exists anywhere outside
  Ofcom itself**: RSGB structurally cannot see the callsigns that were not
  opted in, and Ofcom — which does hold the complete record — publishes none
  of it.
- **Special Contest Call Signs (s6.4)** — a distinct NoV class, not to be
  confused with SES — is administered by RSGB in full: "All applications for
  SCC NoV (including renewals) are made to the RSGB, who undertake
  administration for Ofcom," with Ofcom retaining only the grant decision.
- **Beacons and Repeaters (s6.5)** — applications go via the RSGB website,
  where its Emerging Technology Coordination Committee (ETCC) performs the
  technical vetting before forwarding the completed NoV to Ofcom for issue.

**[observed]** That repeater/beacon delegation is not on the strongest possible
footing, though: a 2023 Freedom of Information request (WhatDoTheyKnow
reference 01700326) found Ofcom stating it holds **no formal documented
agreement — no memorandum of understanding — with RSGB** for this
arrangement, only internal process maps. The delegation is real in day-to-day
practice, and it is Ofcom's own account that it is undocumented and informal
as a matter of contract.

**[derived]** The net picture: Ofcom authors every grant across every NoV class
discussed here; RSGB's administrative role ranges from none at all (ordinary
and Permanent SES) to full delegation (Special Contest Calls, and — on an
informal, undocumented basis — beacons and repeaters); and RSGB never
independently publishes a complete register for any of these classes. Where
RSGB does the administration, it holds the complete data (repeater/gateway
listings, in practice, come closest to a full public register); where it
does not, it has nothing complete to publish, only what individual licensees
voluntarily hand it for publicity.

---

## The epistemics trail

This finding was built in public, one step at a time, on [issue #725](https://github.com/MysterAitch/amateur-callsigns-file-watch/issues/725):
a data oddity (53 rows with a paradoxical class name) led to worked examples
(the three cohorts, with real callsigns and dates set out plainly); the
worked examples exposed a genuine puzzle in cohort 2, which was written up as
a **named conjecture with explicit discriminators** — what evidence would
support it, what would refute it — before any confirming source was sought;
per-callsign research then went looking for those discriminators station by
station, resolving six of the seven identities (one, `GB4UAS`, staying
explicitly unconfirmed) and turning up nothing that refuted the conjecture;
and only then did a regulatory source — Ofcom's own guidance, already
published, simply not yet found — confirm the mechanism directly, upgrading
the conjecture to a cited finding. Every step of that chain sits on the
public record rather than being folded away once the answer was known, so
the reasoning that got here is exactly as checkable as the answer itself.

---

## Reproduce this yourself

The cohort splits above come from filtering the [2024-09 snapshot](https://mysteraitch.github.io/amateur-callsigns-file-watch/datasets/foi/ofcom-2024-09--every-radio-callsign--all-callsigns/index.html)'s
`normalised--every-radio-callsign-spreadsheet.csv` to rows whose
[licence class](https://mysteraitch.github.io/amateur-callsigns-file-watch/glossary.html#licence-class)
matches `Perm(anent)? Special Event`, then bucketing each row's
`reserved_to_date` against the snapshot's own [vintage](https://mysteraitch.github.io/amateur-callsigns-file-watch/glossary.html#vintage)
(2024-09) and reading its `status` column alongside. A blank date pairs with
`Allocated`; a future date pairs with `Reserved`; a past date pairs with
`Available` (bar the one flagged anomaly). The value catalogue's own
[temporal-character table](https://mysteraitch.github.io/amateur-callsigns-file-watch/reports/value-catalogue.html#temporal-character-of-the-special-event-family)
gives the wider corpus context these 53 rows sit inside.

---

## Provenance and related threads

- The cohort split, the worked examples, the conjecture, the per-callsign
  research, and the regulatory confirmation: **issue #725**
  ([thread](https://github.com/MysterAitch/amateur-callsigns-file-watch/issues/725)).
- The administration-chain survey (who administers each NoV class, and why
  no complete public SES listing exists): **issue #109**
  ([thread](https://github.com/MysterAitch/amateur-callsigns-file-watch/issues/109)).
- This narrative form: **issue #292**
  ([tracker](https://github.com/MysterAitch/amateur-callsigns-file-watch/issues/292)).

*Observations were re-derived from the archived 2024-09 snapshot for this
write-up. Callsign statuses and dates change between snapshots and should be
read fresh from the per-callsign pages linked above; this narrative describes
that one vintage's reading, not a standing state.*
