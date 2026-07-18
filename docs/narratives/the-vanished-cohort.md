# The vanished cohort: four blank years, then gone

*A data narrative — one finding in the amateur-callsign mirror, walked from a
small, stubborn oddity in the `status` column to a clean disappearance. It is
a story about how a register's own edge cases get held, and eventually
dropped, not about the people who once held these callsigns.*

Every claim below carries one of three tags — **[observed]**, **[derived]**,
or **[hypothesis]** — so you can tell at a glance what kind of statement it is
and check it yourself. Select any tag to see its full definition in the
[glossary](https://mysteraitch.github.io/amateur-callsigns-file-watch/glossary.html#epistemics).

The counts and rows below were re-derived directly from the archived
snapshots for this write-up, not carried over from an earlier pass. Where a
figure appears, the file it comes from is named, so it can be regenerated
rather than taken on trust.

---

## Summary

**[observed]** Nine [vintages](https://mysteraitch.github.io/amateur-callsigns-file-watch/glossary.html#vintage)
of the open-data register are held in this archive. Two of them —
[2025-05-27](../../archive/2025-05-27/normalised.csv) and
[2025-06-08](../../archive/2025-06-08/normalised.csv) — are
[declared partial](https://mysteraitch.github.io/amateur-callsigns-file-watch/glossary.html#declared-complete)
(1,074 rows each, a truncated fetch) and are set aside here, the same way the
project's own sweep set them aside. That leaves seven declared-complete
vintages: six older ones, tested here, plus the newest.

**[observed]** In every one of the six older vintages — from
[2022-05-30](../../archive/2022-05-30/normalised.csv) through
[2026-01-14](../../archive/2026-01-14/normalised.csv), a span of just under
four years — a small number of rows carry a **blank `status` field**: not
`Allocated`, not `Reserved`, not `Available`, nothing at all. **Four
callsigns** — `G1RRV`, `G8LEN`, `GOOUC`, `M0KXY` — are blank in every single
one of those six vintages, without exception. A wider set of **seventeen**
callsigns is blank in at least one of them.

**[observed]** By the newest vintage, [2026-06-23](../../archive/2026-06-23/normalised.csv),
the blank-status count is **zero** — and sixteen of those seventeen
callsigns, including all four of the persisting core, are not merely
resolved to a real status: they are **absent from the export altogether**,
verified against the raw text of the publication itself. Only one member of
the wider seventeen, `G5EFV`, escapes this pattern: it picked up a genuine
status years earlier and is still on the register today.

**[hypothesis]** Whether this is a deliberate administrative clear-out of
long-dormant, status-less entries, or the same kind of export-mechanism
idiosyncrasy already documented twice elsewhere in this exact vintage
lineage — extended, in the newest publication, to drop every remaining
status-less row outright — is **not established** from anything this mirror
holds. Both readings are recorded below; neither is asserted.

---

## What a blank `status` is

**[observed]** The register's [status](https://mysteraitch.github.io/amateur-callsigns-file-watch/glossary.html#status-values)
column is meant to record one of a small, closed set of values — chiefly
[Allocated](https://mysteraitch.github.io/amateur-callsigns-file-watch/glossary.html#allocated),
[Reserved](https://mysteraitch.github.io/amateur-callsigns-file-watch/glossary.html#reserved),
or [Available](https://mysteraitch.github.io/amateur-callsigns-file-watch/glossary.html#available).
A **blank** value is a fourth, unlabelled case: the register still holds a
row for the callsign — a `product`, usually a `type` — but declines to say
what state it is in. This is not the same as no row at all; it is a row that
stops short of stating a status.

**[observed]** The plainest example is the oldest surviving header shape.
[`archive/2022-05-30/raw.csv`](../../archive/2022-05-30/raw.csv) uses a bare
three-column `Value,Status,Type` layout, and the row for `GOOUC` reads,
verbatim:

```
GOOUC,,Call Sign - Amateur
```

The empty field between the two commas is the blank status — not a
formatting artefact, but the literal published value. The same shape
persists into the newer, richer six-column export. `archive/2025-04-08/raw.csv`
carries, for `G1RRV`:

```
G1RRV,Amateur Full Radio Licence,,Call Sign - Amateur,06/09/2018,06/09/2018
```

A real product (`Amateur Full Radio Licence`), a real type, real creation
and modification dates either side — and still no status, sitting as the
empty field in the middle.

---

## The four that never wavered

**[observed]** Reading each declared-complete vintage's `normalised.csv` for
rows whose `status` is empty, and intersecting the six older ones, yields
exactly four callsigns present in all six:

| callsign | 2022-05-30 | 2023-02-20 | 2025-04-08 | 2025-06-04 | 2025-11-11 | 2026-01-14 |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| `G1RRV` | blank | blank | blank | blank | blank | blank |
| `G8LEN` | blank | blank | blank | blank | blank | blank |
| `GOOUC` | blank | blank | blank | blank | blank | blank |
| `M0KXY` | blank | blank | blank | blank | blank | blank |

**[derived]** Four callsigns, blank on every one of six independent
publications spanning 2022-05-30 to 2026-01-14 — roughly three years and
eight months of republication — is not a one-off gap in a single export. The
value is stable across two entirely different header shapes (the bare
three-column 2022 layout and the six/eight-column Salesforce-family layouts
of 2025 onward), so it survives a schema change as well as time.

**[observed]** Two of the four, `GOOUC` and `G98JSS` (part of the wider set,
below), match no known UK callsign formation at all — the components parser
records them as `unparseable`
([`archive/2025-11-11/components.csv`](../../archive/2025-11-11/components.csv)),
the same closed vocabulary documented in
[`reference-data/flags.md`](../../reference-data/flags.md) and put to work
narrating a different pair of unparseable values on
[issue #802](https://github.com/MysterAitch/amateur-callsigns-file-watch/issues/802).
`G1RRV`, `G8LEN` and `M0KXY`, by contrast, parse cleanly as ordinary Full
callsigns (`G#1RRV`, `G#8LEN`, `M#0KXY`) — the blank status is not confined
to malformed entries.

**[observed]** In the two vintages that carry
`licence_version_last_modified_date`/`licence_version_original_start_date`
(2025-11-11 and 2026-01-14), all four rows carry **neither field**, at any
point — no licence-version record ever backs these entries. But they are not
simply frozen and forgotten: in the Salesforce-family exports that carry
`created_date`/`last_modified_date` instead, the same rows show real
activity. `M0KXY`'s `last_modified_date` reads **2025-03-19** in
[`archive/2025-04-08/normalised.csv`](../../archive/2025-04-08/normalised.csv)
— touched a matter of weeks before that publication, while its `status`
stayed empty throughout.

---

## The wider seventeen, and how they thinned out

**[observed]** Taking the union of every blank-status callsign across all six
older vintages gives seventeen distinct values:

`20JUU`, `22032024`, `2#0MVL`, `G0LVW`, `G1RRV`, `G1ZJL`, `G1ZRU`, `G3ZQE`,
`G4ISZ`, `G5EFV`, `G5EOA`, `G8LEN`, `G98JSS`, `GOOUC`, `LR388`, `M0KXY`,
`M1NSK`.

**[derived]** Not all seventeen ran the same course. Reading when each one
first appears and last appears in the blank-status set shows the population
thinning in three distinct steps, not one single cut-over:

| step | callsigns leaving the blank-status set | count |
|---|---|---:|
| between 2025-06-04 and 2025-11-11 | `G1ZJL`, `G1ZRU`, `G3ZQE`, `G4ISZ`, `22032024` | 5 |
| between 2025-11-11 and 2026-01-14 | `LR388` | 1 |
| between 2026-01-14 and 2026-06-23 | `G1RRV`, `G8LEN`, `GOOUC`, `M0KXY`, `M1NSK`, `20JUU`, `G0LVW`, `G98JSS`, `G5EOA`, `2#0MVL` | 10 |

**[observed]** The first five (`G1ZJL`, `G1ZRU`, `G3ZQE`, `G4ISZ`, `22032024`)
do not merely gain a status — they are absent from
[`archive/2025-11-11/normalised.csv`](../../archive/2025-11-11/normalised.csv)
entirely, and stay absent from every vintage since. `LR388` follows the same
pattern one step later: present and blank through 2025-11-11, gone entirely
by [`archive/2026-01-14/normalised.csv`](../../archive/2026-01-14/normalised.csv).
The final ten — the persisting core of four plus six others still blank as
of 2026-01-14 — are the group that survives longest, and vanishes together
in the last step, between 2026-01-14 and 2026-06-23.

**[derived]** So the clear-out was not a single clean event applied to a
static population; it was a gradual thinning across at least three separate
publications, with the last and largest step landing on whatever remained.
That shape — several small, staggered departures rather than one bulk
removal — reads more like each vintage independently dropping a few more
edge-case rows than like one deliberate administrative sweep timed to a
single date, though this reading is a characterisation of the *shape* of the
evidence, not a claim about its cause.

**[observed]** One callsign in the seventeen does not fit the "vanished"
story at all. `G5EFV` is blank in 2022-05-30 and 2023-02-20 only; by
[`archive/2025-04-08/normalised.csv`](../../archive/2025-04-08/normalised.csv)
it carries a real status, `Allocated`; by 2025-11-11 it reads `Reserved`;
and it is still present, still `Reserved`, in the newest vintage,
2026-06-23. `G5EFV` resolved to an ordinary status years before the rest of
the cohort disappeared, and never left the register at all — the opposite
outcome to its sixteen former neighbours.

**[observed]** One callsign shows a shorter, stranger detour. `M1NSK` is
blank in 2022-05-30, 2023-02-20 and 2025-04-08, then **absent altogether**
from `archive/2025-06-04/normalised.csv` — not blank, not present with a
status, simply not in that one export — before reappearing blank in
2025-11-11 and 2026-01-14, and finally vanishing for good with the rest of
the final ten. **[derived]** That one-vintage gap lines up exactly with an
already-documented defect in that specific publication: `M1NSK`'s `product`
field is blank in every vintage it appears (confirmed in
[`archive/2025-04-08/normalised.csv`](../../archive/2025-04-08/normalised.csv)),
and `archive/2025-06-04`'s own `meta.json` records that this publication
"omits every record with a blank product field (~45,000, many of them live
allocations) despite declaring complete coverage." `M1NSK`'s single-vintage
disappearance is consistent with that known omission, not a second,
independent flicker in the underlying register.

---

## Some of the cohort were never valid callsigns to begin with

**[observed]** Running the seventeen against the components parser's `parse_status`
column shows five with no valid UK callsign formation at all —
`unparseable`, the same vocabulary [issue #802](https://github.com/MysterAitch/amateur-callsigns-file-watch/issues/802)
uses for a different pair of rows:

| callsign | `parse_status` | note |
|---|---|---|
| `GOOUC` | unparseable | part of the persisting core of four |
| `G98JSS` | unparseable | vanishes in the final step |
| `22032024` | unparseable | reads plainly as a date (22 March 2024), not a callsign shape |
| `LR388` | unparseable | vanishes in the second step |
| `2#0MVL` | unparseable | vanishes in the final step |

**[observed]** The other twelve parse as ordinary, validly-shaped callsigns —
`G1RRV`, `G8LEN`, `M0KXY` and `M1NSK` among them — so the blank-status
population was never confined to malformed entries; well-formed callsigns
sat in it for years too.

**[observed]** A small aside, not the point of this story: three of the
twelve well-formed members — `G1ZJL`, `G1ZRU`, `G3ZQE` — carry suffixes
(`ZJL`, `ZRU`, `ZQE`) that fall inside the wholesale `Z`-block on the
[forbidden-suffix list](../../reference-data/forbidden-suffixes.csv), the
same 676-strong block discussed in
["The QNF gap"](the-qnf-gap.md). As that flag's own registry entry states,
this is "empirically not an anomaly by itself" — thousands of ordinary,
long-standing rows carry it — so it is noted here as a shared characteristic
of the first wave to leave, not as a cause.

---

## The disappearance, and what it does not prove

**[observed]** [`archive/2026-06-23/normalised.csv`](../../archive/2026-06-23/normalised.csv)
(158,318 rows) carries **zero** rows with a blank status. Searching its raw
text directly for the sixteen vanished callsigns —
[`archive/2026-06-23/raw.csv`](../../archive/2026-06-23/raw.csv) — returns no
match for any of them. They are not recategorised into `Allocated`,
`Reserved`, or `Available`; they are not in the file at all.

**[derived]** This is the same shape of evidence the mirror's own
[availability trap](https://mysteraitch.github.io/amateur-callsigns-file-watch/glossary.html#available)
warns readers about, applied to a whole cohort at once. Looking any of these
sixteen callsigns up on the mirror today returns "no record" — and per that
warning, **absence of a record is not evidence of availability**. It means
only that this export holds no row for the callsign; it is not a statement
that the callsign is free to issue, or that Ofcom has withdrawn it, or
anything else about the licence itself. The honest reading stops at "no
longer published," not "confirmed available."

**[observed]** Nothing in `archive/2026-06-23/meta.json`'s own quality
observations mentions this cohort or its disappearance — unlike the
already-documented 2025-06-04 blank-product omission or the 2026-01-14
Z-suffix omission (both cited above and in `docs/source-register.md`), the
newest vintage carries no note that would explain the drop. This is a fresh
observation, not one this mirror had already recorded before this write-up.

---

## The hypothesis (recorded, not asserted)

**[hypothesis]** Two candidate explanations account for the same evidence,
and this mirror cannot tell them apart:

- **A genuine administrative clear-out.** Ofcom (or its licensing system)
  may have identified a set of long-dormant, status-less entries and removed
  them from the published register outright — a housekeeping sweep of rows
  that had carried no determinate state for years. Under this reading, the
  callsigns are genuinely gone from Ofcom's own current register, not merely
  absent from this one export.
- **A continuation of the same export-mechanism pattern already seen twice
  in this exact lineage.** The 2025-06-04 publication is already documented
  as omitting every blank-product row; the 2026-01-14 publication is already
  documented as omitting every Z-suffix row (`docs/source-register.md`,
  issue #564). Both are publisher-side export idiosyncrasies affecting a
  category of row, not a change to the underlying register. A newest export
  that omits every row lacking a status value — rather than genuinely
  deleting the licences behind them — would produce identical evidence to
  the clear-out reading, from outside the export process.

**[hypothesis]** The staggered, three-step thinning documented above is
weak evidence in favour of the second reading over the first: a single
administrative sweep decided on one date would be expected to remove its
target population in one step, not leak members away across three separate
publications spread over roughly eight months before finishing the job.
Weak, not decisive — an administrative process reviewed and actioned in
batches would look the same from here.

**What would settle it.** Nothing this mirror holds distinguishes the two
readings; the same gap in evidence that leaves
["the QNF gap"](the-qnf-gap.md#the-hypothesis-recorded-not-asserted)'s
de-listing unresolved applies here too — only Ofcom's own account of what,
if anything, changed in how the 2026-06-23 export is produced, or a
disclosure describing the removal of specific licence records, could
arbitrate. No such request is currently open for this specific finding.

---

## How the record handles it today

**[observed]** The mirror does not adjudicate this. Each archived vintage is
kept exactly as published, so the blank-status rows are still readable in
every one of the six older snapshots linked throughout this page — the
evidence is not overwritten by the newest publication superseding it. The
newest vintage's own [data-status page](https://mysteraitch.github.io/amateur-callsigns-file-watch/data-status.html)
and the callsigns' own lookup pages
(for example [`GOOUC`](https://mysteraitch.github.io/amateur-callsigns-file-watch/callsign.html?c=GOOUC)
or [`G5EFV`](https://mysteraitch.github.io/amateur-callsigns-file-watch/callsign.html?c=G5EFV))
report only what the current export states, which is why this write-up
exists alongside them: the multi-vintage story is not visible from any
single snapshot on its own.

---

## Reproduce this yourself

Every figure above comes from reading each declared-complete vintage's
`normalised.csv`, filtering to rows whose `status` field is empty, and
comparing the resulting callsign sets across vintages — set intersection for
the persisting four, set union for the wider seventeen, and a per-callsign
first-seen/last-seen check for the wave table. The `parse_status` and `flags`
columns come from each vintage's `components.csv`. The pinned DuckDB CLI
(`npm run setup:duckdb`) reads every `normalised.csv` directly with
`read_csv_auto`, so the same queries run against the same committed files
reproduce the same counts.

---

## Provenance and related threads

- The finding, filed directly from the data-coherency sweep, with the
  original cohort count and the note that it reads as "historical note
  rather than a live defect": **issue #803**
  ([thread](https://github.com/MysterAitch/amateur-callsigns-file-watch/issues/803)).
- The wider sweep this finding was one of four results from (alongside
  #800, #801, #802): **issue #804**
  ([thread](https://github.com/MysterAitch/amateur-callsigns-file-watch/issues/804)).
- The `unparseable-callsign` flag and its own narrative material (`GOOUC`
  and `G98JSS`'s classification, and the free-text/callsign-shape
  distinction it draws): **issue #802**
  ([thread](https://github.com/MysterAitch/amateur-callsigns-file-watch/issues/802)).
- The already-documented export omissions this write-up leans on
  (2025-06-04's blank-product filter; 2026-01-14's Z-suffix omission):
  **issue #564** ([thread](https://github.com/MysterAitch/amateur-callsigns-file-watch/issues/564))
  and `docs/source-register.md`.
- This narrative form: **issue #292**
  ([tracker](https://github.com/MysterAitch/amateur-callsigns-file-watch/issues/292)).

*Observations were re-derived from the archived snapshots for this write-up.
The current register holds no row for the sixteen vanished callsigns named
above; that can change in a future publication, and should be read fresh
from the linked lookup pages rather than assumed to stand indefinitely.*
