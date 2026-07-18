# Ofcom's callsign systems and publication practice: a chronology

*A data narrative — the record-keeping story behind the amateur-callsign
mirror, assembled from the archive's own FOI letters and register exports and
walked decade by decade. It is a story about Ofcom's IT systems and how it has
published (or declined to publish) callsign data over time, not about the
people who hold the callsigns.*

Every claim below carries one of three tags — **[observed]**, **[derived]**,
or **[hypothesis]** — so you can tell at a glance what kind of statement it is
and check it yourself. Select any tag to see its full definition in the
[glossary](https://mysteraitch.github.io/amateur-callsigns-file-watch/glossary.html#epistemics).
**[observed]** here means read directly off a held FOI letter, its verbatim
raw-text extract, or a register export in this archive; **[derived]** means
combined from more than one held source under a rule stated on the spot. One
class of statement is deliberately left *untagged*: facts Ofcom states about
its own systems and obligations (the Radio Regulations articles, the year a
database went live) are quoted from the correspondence and attributed to
Ofcom, but they are the regulator's account of itself, not something this
mirror observed in register data — so they carry no observation pill.

Every quotation below was checked against the held file before publication.
Each is a verbatim extract from the letter or export named beside it, and each
row links to the entry it rests on and, where a letter exists, to its
browsable rendered transcript.

---

## Summary

The amateur-callsign record has passed through three system eras and three
publication regimes, and the archive holds Ofcom's own words marking each
boundary.

**[observed]** On the systems side: prior records survive only "in paper
format" (Ofcom, 2014); the current database "went live in 2007 and all
licences were re-issued at this point in a new format" (Ofcom, 2014); and by
2016 a "system change" had replaced list-based assignment with an algorithm,
the licensing database being "Salesforce" (Ofcom, 2017) — a change still
visible in the `salesforce.com` copyright line and the `Value__c` column names
of the register exports this mirror watches today.

**[observed]** On the publication side: until 2016 Ofcom produced an
*available-callsign* list on FOI request; from 2016 it declared that list "not
held", the callsigns being "generated on demand"; and from 2022 it publishes
the *register* — the allocated-and-reserved list — on an open-data page. The
two things are not the same dataset, and the distinction runs right through
the requests that pushed Ofcom towards publishing.

**[derived]** A single thread ties the publication regimes together: amateurs
repeatedly asked Ofcom to *publish* the data rather than answer the same FOI
over and over — from Mr James in 2014 asking it to "consider publishing this
list on your web site", to the 2019 ask for "a periodic public release of this
data", which Ofcom answered was "something that we are actively considering".
The open-data page followed.

---

## The systems timeline

### Before 2007 — paper, then a database go-live

**[observed]** The oldest system state on the record is paper. Answering a
2014 request about historic callsign series, Ofcom pleaded cost and explained
why the older data was hard to reach — the sentence doubles as a statement of
system history (Ofcom reference `1-274894363`, 18 December 2014; browse the
[rendered letter](https://mysteraitch.github.io/amateur-callsigns-file-watch/datasets/foi/wdtk-238892--out-of-sequence-callsigns/raw-extract-call-signs-series-before-ww2.md.html)):

> All licences were re-issued in 2007 in a new format. Where we hold the
> previous information it is in paper format, which would take a considerable
> time to sort through.

Ofcom restated the go-live date in a second 2014 refusal on a neighbouring
request (browse the
[rendered letter](https://mysteraitch.github.io/amateur-callsigns-file-watch/datasets/foi/wdtk-238892--out-of-sequence-callsigns/raw-extract-response-callsigns-out-of-sequential-order-181214.md.html)):

> Our current database went live in 2007 and all licences were re-issued at
> this point in a new format.

The 2007 date and the paper-before-that account are Ofcom's own statements
about its systems, and are carried here as such (untagged) rather than as
register observations. Both sit in the exchange transcribed at
[`archive/foi/wdtk-238892--out-of-sequence-callsigns/correspondence.md`](../../archive/foi/wdtk-238892--out-of-sequence-callsigns/correspondence.md).

### 2007–2016 — the pre-Salesforce database, seen in its fingerprints

**[observed]** This mirror holds no document naming the 2007–2016 system, but
its fingerprints are all over the letters and exports of the period. Every
Ofcom reference number before 2016 takes the form `1-XXXXXXXXX` — for example
`1-274894363` (2014, above), and `1-277200227` / `1-279218761` on the 2015
internal review below. **[derived]** And the available-list exports of the
early 2010s settle, by 2015, into a fixed eight-column report shape —

> Country, Current Series, Reference, Value, Type, Product, Status, Allocated Flag

— the header row of
[`archive/foi/wdtk-247308--available-callsigns-list/raw-extract-sheet-1-foundation.csv`](../../archive/foi/wdtk-247308--available-callsigns-list/raw-extract-sheet-1-foundation.csv).
The `1-` reference form and this report shape are the visible signature of the
pre-2016 licensing system; the archive's own source register associates that
system with a Siebel platform, but the document that would name it is not yet
held, so this narrative does not assert the platform's name — only the shape
its exports and references took.

### 2016 — the system change ends the availability list

**[observed]** The pivot is dated precisely. Answering Nan Smith's request for
all callsigns and their status (Ofcom reference `337399`, 29 September 2016 —
note the plain numeric reference, no longer the `1-XXXXXXXXX` form), Ofcom
explained why it could no longer supply a list of *available* callsigns
(browse the
[rendered letter](https://mysteraitch.github.io/amateur-callsigns-file-watch/datasets/foi/wdtk-356636--all-callsigns-plus-forbidden/raw-extract-all-call-sign-list-nan-smith.md.html)):

> We do not hold a list of call signs that are available. Due to a system
> change, the assignment of call signs is now done using an algorithm rather
> than "grabbing" from a list.

**[derived]** That single sentence closes the availability-list era: the thing
requesters had been asking for since 2013 was, from a system change around
2016, no longer a stored list but a computation. The same letter points the
reader to the last of the old lists — the July 2016 "historic available call
sign list" (Ofcom reference `285990`, applicable from 29 June 2016), held here
as
[`ofcom-285990--available-list-jun-2016`](https://mysteraitch.github.io/amateur-callsigns-file-watch/datasets/foi/ofcom-285990--available-list-jun-2016/index.html).
It is also this snapshot — the
[full disclosure Nan Smith received](https://mysteraitch.github.io/amateur-callsigns-file-watch/datasets/foi/wdtk-356636--all-callsigns-plus-forbidden/index.html),
mirrored again as Ofcom's own
[published copy](https://mysteraitch.github.io/amateur-callsigns-file-watch/datasets/foi/ofcom-337399--all-callsigns-published-copy/index.html) —
that carries the standing licence-type caveat every register export since has
inherited:

> For Club licences, the call signs are the same regime as for Full licences.
> Therefore, we do not know if the call signs were allocated to a Full or Club
> licence.

### 2017 — the database is named: Salesforce

**[observed]** A July 2017 request asked directly what system Ofcom had moved
to. The response letter (created 11 September 2017, no reference number on its
face; browse the
[rendered letter](https://mysteraitch.github.io/amateur-callsigns-file-watch/datasets/foi/ofcom-2017-07-03--all-callsigns-with-status/raw-extract-amatuer-radio-callsigns.md.html))
answers it twice, and then sets out the fullest description of the
assignment algorithm anywhere in the archive:

> Ofcom uses Salesforce as its licencing database.

> This algorithm ensures that the call sign is in the correct format. That
> means that it matches the type of licence and enables us to comply with our
> obligations under Article 19 and Appendix 42 of the Radio Regulations. Our
> system also checks the proposed call sign's availability for use.
> Availability depends on whether or not the call sign has been used in the
> recent past and whether or not it is in a format that we think may cause
> distress (in which case the call sign is not assigned).

The Radio Regulations references (Article 19, Appendix 42) are Ofcom stating
its own legal obligations, and are untagged here on the same footing as the
2007 date. **[derived]** But "availability depends on… used in the recent
past… [or] a format that… may cause distress" is the generator rule-set in
Ofcom's words, and it maps one-to-one onto the three things the register
*does* enumerate: allocated callsigns, reserved ("cooling down") callsigns,
and forbidden suffixes. Availability is what is left over — which is exactly
why it cannot be listed.

### The Salesforce fingerprint in the data this mirror watches

**[observed]** The 2017 letter's "Salesforce" is not just a claim in prose; it
is stamped on the exports themselves. The open-data register files this mirror
archives carry a Salesforce report footer —

> (c) 2000-2022 salesforce.com, inc. All rights reserved.

visible at the foot of
[`archive/2022-05-30/raw.csv`](../../archive/2022-05-30/raw.csv) (generated,
per the same footer, by Tim Smith on 26 July 2022) — and by 2025 the raw
column headers are Salesforce's own API field names rather than friendly
labels:

> Value__c, Product__c, Status__c, Type__c, CreatedDate, LastModifiedDate

the header row of
[`archive/2025-04-08/raw.csv`](../../archive/2025-04-08/raw.csv). **[derived]**
An intermediate shape sits between the two: the 2023 FOI exports head their
modification column `Call Sign MMSI: Last Modified Date` (for example
[`archive/foi/ofcom-2023-08-18--call-sign-list--all-callsigns/raw-extract-sheet-1-call-sign-data.csv`](../../archive/foi/ofcom-2023-08-18--call-sign-list--all-callsigns/raw-extract-sheet-1-call-sign-data.csv)),
a Salesforce object-and-field naming that leaks the platform's schema into the
published file. Three exports, three degrees of the same system showing
through — the friendly `Value, Status, Type` of 2022, the object-qualified
MMSI column of 2023, and the bare `__c` API names of 2025.

### The whole format story, mechanically

The prose above quotes a handful of exports to mark the turning points. The
table below is the complete picture, and it is not hand-written: it is
generated at build time from the archive's own metadata and the committed
export files themselves. **[observed]** Each *column header* cell is the
verbatim first line of the committed export, read straight off the bytes this
mirror holds (the byte-order marks some exports carry are stripped for display
only); the *worksheet shape* is read from the entry's declared
`sheetsIndicative` metadata; the *dataset class* from its `datasetClasses`.
**[derived]** The rows are ordered by data vintage — that ordering, and the
selection of the register/list export classes, are the only editorial acts; no
row states a fact not already committed to the archive. Because it enumerates
the archive, a future export appears here on its own, without a word of this
page changing.

Read down the *column header* column and the system eras surface on their own:
the eight-column Siebel-era report of the mid-2010s available lists; the terse
`Call Sign, Status` of the 2016 register; and the Salesforce progression from
friendly `Value, Status, Type` labels, through the object-qualified
`Call Sign MMSI: Last Modified Date`, to the bare `Value__c`/`Product__c` API
names — the same fingerprints the prose above traced, now shown for every
export at once.

{{chronology:format-evolution-table}}

---

## The publication-practice timeline

### ≤2015 — the available list, produced on request

**[observed]** Before the 2016 system change, Ofcom answered individual FOI
requests for the *available* list — the callsigns free for a new Foundation,
Intermediate or Full applicant — by running the query and sending a
spreadsheet. This mirror holds that series from 2013 through to the last of the
old lists in January 2016. **[observed]** The table below enumerates every
archived snapshot in the series — generated from the archive metadata, so it
closes the series completely and a newly-recovered snapshot would join it
without editing this prose. Each row links to the snapshot's own page; the
worksheet shape is read from the entry's declared metadata. Each answered the
request; none was published for reuse.

{{chronology:available-list-enumeration}}

### 2014–2015 — the s.14(2) episodes and the "too long an interval" concession

**[observed]** When Mr James asked a second time in January 2015, Ofcom refused
under section 14(2) of the FOI Act — the repeat-request exemption — pointing
him at an earlier published answer (from the
[refusal in `wdtk-247308`](https://mysteraitch.github.io/amateur-callsigns-file-watch/datasets/foi/wdtk-247308--available-callsigns-list/correspondence.md.html)):

> We consider that it is reasonable to request an up to date list after 6
> months has elapsed since information on this area has been publicly
> available since 19 November 2014.

**[observed]** He asked for an internal review, arguing the data changed far
faster than six months. Ofcom's review conceded the point (browse the
[rendered outcome letter](https://mysteraitch.github.io/amateur-callsigns-file-watch/datasets/foi/wdtk-247308--available-callsigns-list/raw-extract-2015-03-27-response-to-mr-james-irfinal.md.html)):

> I accept that, due to the nature of the information and the frequent changes
> to it, 6 months was too long an interval to insist on between particular
> requests.

**[derived]** Two things matter here for the later open-data outcome. First,
Ofcom itself acknowledged the data was "dynamic, frequently updated" — the
very property that makes a one-off FOI a poor fit and periodic publication a
good one. Second, the "publicly available since 19 November 2014" line records
that a response had already been posted on Ofcom's stakeholder FOI pages: a
*de-facto* publication, a full seven years before the open-data page, though
of the available list rather than the register.

### 2016–2021 — "not held", generated on demand

**[observed]** After the system change, the same request formula met a flat
"not held" — four times over between 2018 and 2019, with answers ranging from
the bare refusal
([`ofcom-612185`](https://mysteraitch.github.io/amateur-callsigns-file-watch/datasets/foi/ofcom-612185--unallocated-callsigns-not-held/index.html),
September 2018) —

> Ofcom does not hold the information you requested.

— to a fuller explanation of *why*
([`ofcom-671462`](https://mysteraitch.github.io/amateur-callsigns-file-watch/datasets/foi/ofcom-671462--suffix-availability-not-held/index.html),
February 2019):

> We do not hold lists of available call signs, but instead our licensing
> system generates them on demand.

The other two of the quartet are
[`ofcom-518689`](https://mysteraitch.github.io/amateur-callsigns-file-watch/datasets/foi/ofcom-518689--suffix-availability-not-held/index.html)
(February 2018) and
[`ofcom-632469`](https://mysteraitch.github.io/amateur-callsigns-file-watch/datasets/foi/ofcom-632469--suffix-availability-not-held/index.html)
(October 2018). **[derived]** Same request, same period, answers of very
different depth: the explanation given depended on which official replied, not
on any change of policy — the underlying position ("no stored available list")
was constant across all four.

### 2019 — the status definitions go on the record

**[observed]** What Ofcom *does* hold, and what its status words mean, were set
out definitively in a September 2019 response to Roger Howell (Ofcom reference
`756622`; browse the
[rendered letter](https://mysteraitch.github.io/amateur-callsigns-file-watch/datasets/foi/wdtk-596532--allocated-reserved-forbidden/raw-extract-amateur-radio-callsigns-howell.md.html)):

> 'Allocated' means that the callsign is currently assigned to a station under
> an amateur radio licence. It is therefore not currently available for
> assignment to anyone else.

> 'Reserved' means that the callsign has been used within the past two years,
> although it is no longer, and is in the process of 'cooling down'. It is
> therefore not currently available for assignment to anyone else, but
> operators will be able to apply for it again after the two-year period has
> expired.

And, crucially, that availability is *definitional* rather than enumerated:

> We do not hold a comprehensive list of all callsigns that are "available".
> If a callsign is not allocated, reserved or on the list of forbidden
> callsigns, and, if it also complies with our call sign format rules… it is
> by default available to be assigned.

**[derived]** These are the semantics behind the `Status` column of every
register snapshot this mirror holds. They also confirm the 2016 and 2017
letters from the other direction: "available" is not a stored category but the
complement of the three that *are* stored, which is why no list of it can
exist to be disclosed or published.

### 2022 — the open-data page publishes the register

**[observed]** From 2022 Ofcom publishes the register — the allocated-and-
reserved list with status and licence class — on an open-data page, refreshed
periodically. The earliest snapshot this mirror captured is
[`archive/2022-05-30/`](../../archive/2022-05-30/raw.csv); the FOI disclosure
log continues in parallel, its annexes now explicitly framed as open-data
copies (for example the March 2022 register annex
[`ofcom-2022-03-14--available-and-registered--all-callsigns`](https://mysteraitch.github.io/amateur-callsigns-file-watch/datasets/foi/ofcom-2022-03-14--available-and-registered--all-callsigns/index.html)).
**[derived]** Note what got published: the *register*, not the extinct
available list. The 2014–15 requests that pushed hardest for publication were
asking for the available list — a dataset class that ceased to exist in 2016 —
whereas the 2019 ask (below) was for the register, and that is the thing the
open-data page actually delivers.

---

## The publish-it request sequence

**[derived]** Threaded through the publication timeline is a distinct strand:
amateurs asking Ofcom not merely to *answer* but to *publish*. Read in order,
the asks track the shift from wanting the available list to wanting the
register — and it is the register ask that Ofcom acted on.

**[observed]** **2014-08-26 — Mr James** ([`wdtk-224333`](https://mysteraitch.github.io/amateur-callsigns-file-watch/datasets/foi/wdtk-224333--available-callsigns-list/correspondence.md.html)),
the earliest publish-it ask this mirror holds, following his August 2014
available-list request:

> Please will you consider publishing this list on your web site and keeping
> it up to date so we don't have to keep requesting it.

**[observed]** **2015-02-06 — Mr James again**, in his internal-review request
on the refused second attempt
([`wdtk-247308`](https://mysteraitch.github.io/amateur-callsigns-file-watch/datasets/foi/wdtk-247308--available-callsigns-list/correspondence.md.html)):

> I suggested in my first request for this information that you publish the up
> to date list and I again urge you to do so. It would be a useful service to
> new and upgrading radio amateurs.

**[observed]** **~2014-11 — Ofcom's own partial step**: the section-14 refusal
above records that a response had been "publicly available since 19 November
2014" on Ofcom's stakeholder FOI pages — a published copy amateurs could be
pointed at, standing in for a maintained publication of the available list.

**[observed]** **2019-09-09 — Roger Howell** ([`wdtk-596532`](https://mysteraitch.github.io/amateur-callsigns-file-watch/datasets/foi/wdtk-596532--allocated-reserved-forbidden/correspondence.md.html)),
the first ask for periodic release of the full *register* — the thing the
open-data page actually publishes — following the September 2019 disclosure of
the allocated-and-reserved list:

> Finally, would you consider a periodic public release of this data - perhaps
> monthly, bimonthly, or quarterly?

**[observed]** Ofcom's reply, nine days later (2019-09-18):

> On the periodic publication of the data, this is something that we are
> actively considering.

**[observed]** **2022 — the open-data page appears**, publishing the register
([`archive/2022-05-30/`](../../archive/2022-05-30/raw.csv)). **[derived]** The
distinction the sequence draws is the point: the 2014–15 asks were for the
available list (extinct from 2016); the 2019 ask was for the register — and
the register is what got published. The mirror does not claim the 2019 ask
*caused* the publication; it records that the register was asked-for, that
Ofcom said it was "actively considering" it, and that publication followed.

---

## A footnote: the reuse route nobody used

**[observed]** One earlier, formal publication mechanism deserves a footnote
because it shows how long the "how do we get this data out" question has been
live. In May 2009 Ofcom licensed the amateur-radio call-book data for reuse
under the Re-use of Public Sector Information Regulations — a formal PSI
licence — documented in
[`wdtk-248271`](https://mysteraitch.github.io/amateur-callsigns-file-watch/datasets/foi/wdtk-248271--callbook-psi-licensees/index.html).
**[derived]** The entry records that this formal route existed from May 2009
and was never actually used to obtain the data; the separate RSGB call-book
arrangement ran on its own footing. The PSI licence is a road not taken — a
reminder that a publication mechanism existing on paper is not the same as
data actually flowing, which is what the open-data page finally delivered
thirteen years later.

---

## What this chronology does not establish

Fidelity means being explicit about the claims this mirror *cannot* stand
behind from its own holdings — they belong to the story but not to the
evidence:

- **The pre-2016 platform's name.** The archive's source register associates
  the `1-XXXXXXXXX`-referenced, eight-column-export era with a Siebel-based
  licensing system, but the document that would name it is not yet held, so
  this page describes only the reference and export *shapes* it observed, not
  the platform.
- **`ofcom.force.com` and the 2017 Flewin refusal.** A licensing-portal URL
  and a further availability-semantics refusal are cited in this mirror's
  source register as *pending fetch* — not in the archive. This page therefore
  grounds the Salesforce claim on what it does hold (the 2017 letter's own
  words, and the `salesforce.com` / `__c` fingerprints in the exports) rather
  than on the portal hostname.
- **The 2016 acknowledgement's Salesforce artefact.** The `337399`
  acknowledgement is noted elsewhere as carrying a Salesforce
  `ref:_00D…`-style mail artefact; that string is not reproduced in the held
  verbatim extract, so it is not quoted here. The reference-format change
  ( `1-XXXXXXXXX` → plain `337399` ), which *is* visible in the held letters,
  carries the same point.

---

## Reproduce this yourself

Every quotation above sits in a file committed to this repository. In short:
open each entry's `correspondence.md` (the transcribed FOI thread) or its
`raw-extract-*.md` (the mechanical text extraction of a PDF letter) under
[`archive/foi/`](../../archive/foi/), and each export's `raw.csv` header under
[`archive/`](../../archive/), and read the sentence quoted beside its entry
key. The systems boundaries come from `wdtk-238892` (2007, paper),
`wdtk-356636` (2016 algorithm) and `ofcom-2017-07-03` (Salesforce); the
publication boundaries from the available-list series, the 2018–19 not-held
quartet, `wdtk-596532` (2019 definitions) and the 2022 open-data snapshots.
The Salesforce fingerprints are the literal header and footer rows of the
open-data `raw.csv` files.

---

## Provenance and related threads

- This chronology page: **issue #129**
  ([thread](https://github.com/MysterAitch/amateur-callsigns-file-watch/issues/129)).
- The Pages-growth constraint this page is built to (frameworkless, content
  precomputed at build time): **issue #104**
  ([thread](https://github.com/MysterAitch/amateur-callsigns-file-watch/issues/104)).
- The narrative form itself, every claim tagged and evidence-linked: **issue
  #292** ([tracker](https://github.com/MysterAitch/amateur-callsigns-file-watch/issues/292)).

*Every letter and export quoted here was re-read from the archived file for
this write-up. The current register, and Ofcom's current publication practice,
should be read fresh from the linked entry pages and the open-data snapshots —
the record continues to change.*
