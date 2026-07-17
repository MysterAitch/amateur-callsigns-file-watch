# The QNF gap: forbidden, de-listed, then issued

*A data narrative — one finding in the amateur-callsign mirror, walked from
the first surprise to a recorded, unresolved question. It is a story about
how a regulator's own exclusion list drifted over eight years, not about the
people who now hold the callsigns it touches.*

Every claim below is tagged so you can tell what kind of statement it is and
check it yourself:

- **[obs]** — an **observation**: something read directly off the archived
  FOI disclosures or register exports. Re-runnable against the files named.
- **[der]** — a **derivation**: a conclusion drawn by combining observations.
  The working is shown so the step can be repeated.
- **[hyp]** — a **hypothesis**: a possible explanation, recorded for
  investigation and **not asserted as fact**.

Every figure quoted here is **declared, not verified** — the same standing
this mirror gives the whole
[forbidden-suffix section](https://mysteraitch.github.io/amateur-callsigns-file-watch/forbidden/index.html)
it is drawn from. Where a count appears, the file that produces it is named,
so it can be regenerated rather than taken on trust.

---

## Summary

`QNF` — a three-letter suffix — sat on Ofcom's forbidden-suffix list in
September 2016 and again in August/September 2019. **[obs]** By the
disclosure Ofcom published in December 2024, it is gone: absent from the
current list, with no explanation on record.

**[obs]** That would be a quiet footnote on its own. What makes it a story is
what the mirror's archive shows either side of the gap. Back in 2016, the
register itself — not just the separate suffix list — carried an explicit
row for `M3QNF` with the status **`Forbidden`**, one of a curated set of
specific prefix-plus-suffix combinations Ofcom withheld outright. By November
2025, `M3QNF` is a real, **Allocated** Foundation licence. The exact string
once marked "forbidden" in the register is now issued to someone. A second
callsign, `M7QNF`, was allocated even earlier, in February 2025.

**[der]** Both callsigns are still caught by the mirror's own
`forbidden-suffix` data-quality flag, because the flag is deliberately keyed
off the **union** of every disclosure ever held rather than any single
point-in-time list — a design choice made precisely so that a de-listing like
this one does not quietly stop being visible.

**[hyp]** Whether `QNF`'s removal was a deliberate policy change or an export
artefact is **not established** anywhere in the material this mirror holds.
That is not a gap in this write-up; it is the honest state of the evidence,
and it is exactly what a fresh, broad FOI request now open
([issue #293](https://github.com/MysterAitch/amateur-callsigns-file-watch/issues/293))
asks Ofcom to resolve.

---

## What the forbidden-suffix list is, and why Q matters

**[obs]** Ofcom's own explanation, given in its earliest disclosure of the
list, is on the record in this mirror's holdings
([`archive/foi/wdtk-356636--all-callsigns-plus-forbidden/correspondence.md`](../../archive/foi/wdtk-356636--all-callsigns-plus-forbidden/correspondence.md)):

> We do not hold a policy on reserving unsuitable or inappropriate call
> signs for allocation. However, as a matter of conventional practice we do
> not issue call signs or parts of call signs that might spell out (English)
> words that we think are likely to be generally offensive or which may lead
> to undue on-air bullying of the licensee. […] It does change over time, as
> taste and social tolerance change.
>
> In addition to the list of potentially offensive call signs, we are
> required by Art 19.46 et seq of the Radio Regulations not to allow call
> signs that might be confused with internationally accepted signals. […] In
> addition, there is an international list of so-called 'Q-Codes'. […] Our
> licensing system has been programmed not to allow these as suffixes.

So two quite different reasons feed one list: a curated, changeable set of
offensive-word suffixes, and a fixed international obligation to keep
Q-codes and distress-confusable signals off the air. `QNF` falls in the
second category — Q-codes are exactly the three-letter, `Q`-prefixed strings
the letter describes.

**[der]** The archive shows *how* Ofcom implemented the Q-code rule, and it
is more sweeping than "block the real Q-codes": every one of the **676**
possible three-letter strings from `QAA` to `QZZ` is on the 2016 and 2019
forbidden-suffix disclosures — the entire combinatorial space, not a curated
subset of the couple of hundred codes the ITU actually assigns meaning to
(counted directly from
[`archive/foi/wdtk-356636--all-callsigns-plus-forbidden/normalised--sheet-2-forbidden-suffixes.csv`](../../archive/foi/wdtk-356636--all-callsigns-plus-forbidden/normalised--sheet-2-forbidden-suffixes.csv)
and the 2019 equivalent). By contrast, every other letter carries only a
handful of curated entries — a dozen or so `P`-suffixes, a handful of `S`- and
`R`-suffixes, matching the "offensive English word" category rather than a
blanket rule. Only one other letter is blocked wholesale in the same way:
`Z`, at 676 distinct suffixes (677 raw rows in the 2016 sheet, because of a
duplicated `ZIT` row already noted in
[`reports/forbidden-suffix-history.md`](../../reports/forbidden-suffix-history.md)) —
no stated reason for that one is on record.

**[der]** By the December 2024 disclosure, the `Q`-block has dropped to
**675** entries — exactly `QNF` missing, nothing else — and the `Z`-block has
likewise dropped to 675, missing exactly `ZFJ`
([`archive/foi/ofcom-2024-12--forbidden-suffixes/normalised--forbidden-amateur-radio-callsigns.csv`](../../archive/foi/ofcom-2024-12--forbidden-suffixes/normalised--forbidden-amateur-radio-callsigns.csv)).
Two otherwise-complete combinatorial blocks, each missing exactly one entry,
is a distinctive shape: it reads far more like two individual rows being
dropped from an export than like a reasoned decision to re-admit one specific
Q-code while keeping the other 675.

---

## Four disclosures, one list, one gap

**[obs]** Every forbidden-suffix disclosure this mirror holds, and where
`QNF` stands in each
(full table: [`reports/forbidden-suffix-history.md`](../../reports/forbidden-suffix-history.md);
rendered section: [the forbidden-suffix index](https://mysteraitch.github.io/amateur-callsigns-file-watch/forbidden/index.html)):

| vintage | disclosure | distinct suffixes | `QNF` present? |
|---|---|---:|---|
| 2016-09 | [`wdtk-356636--all-callsigns-plus-forbidden`](https://mysteraitch.github.io/amateur-callsigns-file-watch/datasets/foi/wdtk-356636--all-callsigns-plus-forbidden/index.html) | 1,465 | yes |
| 2019-08-12 | [`wdtk-596532--allocated-reserved-forbidden`](https://mysteraitch.github.io/amateur-callsigns-file-watch/datasets/foi/wdtk-596532--allocated-reserved-forbidden/index.html) | 1,465 | yes |
| 2019-09-12 | [`ofcom-756622--published-register-csv`](https://mysteraitch.github.io/amateur-callsigns-file-watch/datasets/foi/ofcom-756622--published-register-csv/index.html) | 1,465 | yes |
| 2024-12 | [`ofcom-2024-12--forbidden-suffixes`](https://mysteraitch.github.io/amateur-callsigns-file-watch/datasets/foi/ofcom-2024-12--forbidden-suffixes/index.html) | 1,464 | **no** |

**[obs]** The three earliest disclosures agree exactly — the same
1,465-suffix set, zero drift, across three years and two separate FOI
requesters. The December 2024 export is the first to differ at all, and it
differs by exactly three suffixes: `JIZ` added, `QNF` and `ZFJ` removed. The
2024 file's own per-suffix `LastModifiedDate` column dates the bulk of the
list's origin to **29 July 2016** and dates `JIZ`'s addition precisely to
**10 December 2020** — but it carries no date at all for `QNF` or `ZFJ`,
because they are simply absent rather than modified. **[der]** So the mirror
can pin *when `JIZ` was added* to the day, but can only bound *when `QNF` was
removed* to somewhere between the September 2019 disclosure and the December
2024 one — a five-year window, not a date.

**[obs]** `QNF`'s own detail page,
[`/forbidden/suffix/QNF/`](https://mysteraitch.github.io/amateur-callsigns-file-watch/forbidden/suffix/QNF/index.html),
records its first-known-forbidden date as **2016-09** (the earliest
disclosure vintage, since the 2024 export carries no `LastModifiedDate` for a
suffix it no longer lists) — the same anchor used throughout this mirror's
data-quality machinery
([`reference-data/forbidden-suffixes.csv`](../../reference-data/forbidden-suffixes.csv)).

---

## The register once spelled it out: `M3QNF,Forbidden`

**[obs]** The 2016 disclosure did not confine the exclusion to a side list.
Its main callsign sheet — otherwise a straightforward
callsign/status/licence-class export — carries **5,431** rows whose status
is the literal value `Forbidden`, each one a specific prefix joined to a
withheld suffix
([`archive/foi/wdtk-356636--all-callsigns-plus-forbidden/normalised--sheet-1-all-call-signs.csv`](../../archive/foi/wdtk-356636--all-callsigns-plus-forbidden/normalised--sheet-1-all-call-signs.csv);
also noted in [`docs/source-register.md`](../source-register.md)). Four of
those rows pair a prefix with `QNF` specifically:

| row (2016 register) | status |
|---|---|
| `20QNF` | Forbidden |
| `M0QNF` | Forbidden |
| `M3QNF` | Forbidden |
| `M6QNF` | Forbidden |

**[der]** `M3QNF` — the exact callsign now Allocated — was one of these four.
The 2016 register did not merely fail to mention it; it explicitly recorded
`M3QNF,Forbidden` as a row in its own right. Note also what is *not* among
the four: `M7QNF`. The 2016 disclosure's Forbidden-placeholder rows cover
only the prefixes `20`, `21`, `G0`, `G1`, `G3`, `G4`, `G6`, `G7`, `G8`, `M0`,
`M1`, `M3`, `M5`, `M6` and `ZB` — `M7` never appears among them, forbidden or
otherwise. Why `M7` is absent from that 2016 enumeration is **not
established** from anything this mirror holds; it is recorded here rather
than assumed.

**[obs]** By 2019, the shape of the disclosure itself had changed: the
register sheet in both the August and September 2019 FOI responses carries
only the ordinary statuses (`Allocated`, `Available`, `Reserved`) and the
forbidden suffixes sit in a genuinely separate sheet — bare three-letter
suffixes, no prefix attached
([`archive/foi/wdtk-596532--allocated-reserved-forbidden/normalised--sheet-1-all-callsigns-on-record.csv`](../../archive/foi/wdtk-596532--allocated-reserved-forbidden/normalised--sheet-1-all-callsigns-on-record.csv)
and its sibling
[`normalised--sheet-2-forbidden-call-signs.csv`](../../archive/foi/wdtk-596532--allocated-reserved-forbidden/normalised--sheet-2-forbidden-call-signs.csv)).
Every register export this mirror holds since — including the live 23 June
2026 snapshot,
[`archive/2026-06-23/normalised.csv`](../../archive/2026-06-23/normalised.csv) —
carries only those three ordinary status values. `Forbidden` as a status
value on a callsign row is a feature of the 2016 disclosure alone; by 2019
the exclusion had already moved to being a separate reference list rather
than register rows, which is the shape the mirror's own flag machinery
still assumes today.

---

## The re-issuance

**[obs]** Two callsigns carrying the `QNF` suffix are Allocated in the
mirror's holdings, both Foundation-class licences:

| callsign | product | original start | first seen in this mirror | 2016 register row |
|---|---|---|---|---|
| [`M7QNF`](https://mysteraitch.github.io/amateur-callsigns-file-watch/callsign.html?c=M7QNF) | Amateur Foundation Radio Licence | 2025-02-07 | [2025-04-08](../../archive/2025-04-08/normalised.csv) snapshot | no `M7QNF` row (prefix absent from the 2016 list) |
| [`M3QNF`](https://mysteraitch.github.io/amateur-callsigns-file-watch/callsign.html?c=M3QNF) | Amateur Foundation Radio Licence | 2025-11-20 | [2026-01-14](../../archive/2026-01-14/normalised.csv) snapshot | `M3QNF,Forbidden` |

**[obs]** `M7QNF` also appears, Allocated, in the independently-held FOI
snapshots from
[13 March 2025](../../archive/foi/ofcom-2025-03-13--callsigns--all-callsigns/normalised--call-signs-13mar2025.csv)
and
[11 September 2025](../../archive/foi/ofcom-2025-09-11--callsigns--all-callsigns/normalised--sheet-1-amateur-callsgn-11092025.csv),
corroborating the open-data reading rather than resting on a single source.
Neither `20QNF`, `M0QNF` nor `M6QNF` — the other three combinations the 2016
register named `Forbidden` — appears Allocated, Reserved or Available in any
snapshot held, then or since; only the `M3`- and `M7`-prefixed forms have
been issued.

**[der]** Both original-start dates fall well after every disclosure that
still listed `QNF` as forbidden (the last confirmed sighting is the 2019-09-12
disclosure). Whether the suffix was already off Ofcom's internal exclusion
list by the time these licences were issued, or the licences were issued
while `QNF` was still nominally forbidden and the list only caught up in the
paperwork later, cannot be told apart from the disclosures alone — both read
identically from the outside, and this mirror does not have a disclosure
dated in between to arbitrate.

---

## How the mirror flags this today

**[obs]** Both `M3QNF` and `M7QNF` carry two data-quality flags in the
mirror's own records
([`archive/2026-06-23/components.csv`](../../archive/2026-06-23/components.csv)):
`forbidden-suffix` and
`forbidden-suffix-issued-after-first-known-list`
(defined in [`reference-data/flags.md`](../../reference-data/flags.md)).

**[der]** This is deliberate, and it is worth being explicit about why
neither flag has quietly gone stale now that `QNF` is off the current list.
`forbidden-suffix` is keyed to the **ever-forbidden union** — every suffix
that has appeared on *any* disclosure this mirror holds, 1,466 in total —
precisely so that a de-listing which is only *suspected* to be an export
artefact does not silently un-flag the rows it touches. The second flag
compares each row's original start date against that suffix's own
**first-known-forbidden** date (2016-09 for `QNF`), not against whichever
list happens to be current. Both `M3QNF` (2025-11) and `M7QNF` (2025-02) post-date
2016-09, so both trip it. The per-suffix page states the same shape in its
own words
([`src/ci/build-forbidden-section.ts`](../../src/ci/build-forbidden-section.ts)):

> Forbidden, then de-listed, then issued. […] is now Allocated — issued
> after the de-listing. The row-level `forbidden-suffix` flag still fires
> because the suffix is on the ever-forbidden union […] so a de-listing
> (suspected to be an artefact) does not un-flag it […] A reconciliation
> candidate: possibly the de-listing was an error, or the issuance was.
> Declared, not verified.

Read the flags in full context on the
[fidelity page](https://mysteraitch.github.io/amateur-callsigns-file-watch/fidelity.html#flag-forbidden-suffix)
and the
[second flag's entry](https://mysteraitch.github.io/amateur-callsigns-file-watch/fidelity.html#flag-forbidden-suffix-issued-after-first-known-list),
or see both callsigns flagged live on
[`QNF`'s own detail page](https://mysteraitch.github.io/amateur-callsigns-file-watch/forbidden/suffix/QNF/index.html).

**[obs]** Nothing here is adjudicated. The flag is framed throughout as "a
candidate for scrutiny, not a verdict" — innocent explanations (a heritage
re-issue, a publisher date artefact, an export omission) are named alongside
the possibility of a genuine process gap, and the mirror does not pick
between them.

---

## The hypothesis (recorded, not asserted)

**[hyp]** The corpus's own working theory, stated in
[`reports/forbidden-suffix-history.md`](../../reports/forbidden-suffix-history.md)
and echoed in the flag definitions, is that the `QNF`/`ZFJ` de-listing is
**an export artefact rather than a deliberate policy change** — a
single-row (or two-row) drop from whatever system now produces the list,
not a reasoned decision to re-admit two arbitrary suffixes while leaving the
other 1,462 untouched. The shape of the evidence supports this reading: two
otherwise-complete alphabetic blocks, each missing exactly one entry, with
no stated reason and no dated modification for either removal — unlike
`JIZ`'s addition, which the same export dates precisely.

**[hyp]** An alternative is equally undisproven: that Ofcom did deliberately
review and shorten the list at some point between September 2019 and
December 2024, and `QNF`/`ZFJ` were judged no longer to warrant exclusion —
perhaps because they are not, after all, allocated meanings under ITU-R
M.1172, or for some other reasoned basis this mirror has no record of.
Nothing held here distinguishes the two readings.

**What would settle it.** A fresh, broad FOI request is open specifically to
ask Ofcom this —
[issue #293](https://github.com/MysterAitch/amateur-callsigns-file-watch/issues/293)
requests the current forbidden-suffix list with its change metadata, plus
the full logic (quarantine periods, format rules, manual holds) the
licensing system actually uses, precisely because the December 2024 export
answered "what changed" without ever answering "why." Until that lands, both
readings above stay open.

---

## Reproduce this yourself

Every count above comes from files already committed to this repository.
In short: read each forbidden-suffix disclosure's normalised CSV, count
distinct suffixes and Q-/Z-prefixed ones, and diff consecutive vintages; read
the 2016 register's main sheet and filter rows whose status is literally
`Forbidden`; read each register snapshot's `normalised.csv` for `QNF`-suffixed
callsigns and their `licence_version_original_start_date`. The full,
programmatic version of the first half of this lives in
[`src/ci/forbidden-suffix-history.ts`](../../src/ci/forbidden-suffix-history.ts),
which regenerates
[`reports/forbidden-suffix-history.md`](../../reports/forbidden-suffix-history.md)
on every sweep — a change there is itself a drift signal, the same idea this
narrative is built on.

---

## Provenance and related threads

- The list-drift finding across disclosures: **issue #289**
  ([thread](https://github.com/MysterAitch/amateur-callsigns-file-watch/issues/289)).
- The forbidden-suffix site section (index, per-disclosure and per-suffix
  pages) this narrative crosslinks throughout: **issue #291**
  ([thread](https://github.com/MysterAitch/amateur-callsigns-file-watch/issues/291)).
- This narrative form, and the `QNF` story as its named first candidate:
  **issue #292**
  ([tracker](https://github.com/MysterAitch/amateur-callsigns-file-watch/issues/292)).
- The open request to ask Ofcom directly why the list changed:
  **issue #293**
  ([thread](https://github.com/MysterAitch/amateur-callsigns-file-watch/issues/293)).

*Observations were re-derived from the archived disclosures and register
snapshots for this write-up. The current forbidden-suffix list, and the
status of `M3QNF`/`M7QNF`, should be read fresh from the linked pages above —
both can change between snapshots.*
