# The six twins: one callsign, two register rows

*A data narrative — one finding in the amateur-callsign mirror, walked from the
first surprise to a labelled, testable hypothesis. It is a story about
record-keeping mechanics, not about the people who hold these callsigns.*

Every claim below is tagged so you can tell what kind of statement it is and
check it yourself:

- **[observed]** — an **observation**: something read directly off the published
  register data. Re-runnable against the files named.
- **[derived]** — a **derivation**: a conclusion drawn by combining observations.
  The working is shown so the step can be repeated.
- **[hypothesis]** — a **hypothesis**: a possible explanation, recorded for
  investigation and **not asserted as fact**.

The numbers here were re-checked against the archived data before publication.
Where a count appears, the file and the rule that produces it are given, so the
figure can be regenerated rather than taken on trust.

---

## Summary

Ofcom's open-data callsign export occasionally contains **two rows for what is,
after cleaning, the same callsign** — for example a row for `G6FMU` and a
separate row for `G6 FMU`, with an embedded space. Reduce both to the register's
own cleaned key and they collide on `G6FMU`.

**[observed]** In the 23 June 2026 snapshot there are **six** such cleaned-key groups
(twelve rows in total), and the **same six callsigns** appear in every snapshot
checked back to 30 May 2022 — roughly four years. These are long-lived features
of the published register, republished unchanged, not one-off noise.

**[derived]** In most of these pairs the *oddly-shaped* member — the one carrying an
embedded space, an invisible character, or a stray hyphen — is the one holding
the **active licence**, while the clean, ordinary-looking form sits **parked**
in the register's reservation pool. That inverts the naive expectation that the
tidy form would be the "real" one.

**[hypothesis]** One recorded explanation — clearly a hypothesis, not a finding — is
that the malformed row may be the genuinely-issued licence, with the clean
canonical form deliberately held back to stop it being handed out twice. The
latest snapshot is consistent with this for two of the three UK pairs; the
third, `G6FMU`, is the interesting exception.

The mirror does not pick a winner. Both rows are always kept and the
disagreement is surfaced, never silently resolved. This narrative is about how
the record behaves — the rows are treated as data about callsigns, and the
hypothesis is framed for verification, not as an allegation about any licensee.

---

## What a "cleaned-key twin" is

A callsign as printed can carry characters that are not part of the callsign
itself: a stray space, a non-breaking space that looks identical to an ordinary
one, a placeholder `#`, or a hyphen. To compare callsigns reliably, the mirror
reduces each one to a **cleaned key**: upper-case it and drop everything that is
not a letter, a digit, or a `/`.

**[observed]** The exact rule lives in
[`src/sources/ofcom-amateur/components.ts`](../../src/sources/ofcom-amateur/components.ts):

```js
callsign.toUpperCase().replace(/[^A-Z0-9/]/g, '')
```

So `G6 FMU`, `G6FMU`, and a `G6FMU` followed by an invisible non-breaking space
all clean to the single key `G6FMU`. A **cleaned-key twin** is what you get when
two *different* raw tokens in the same snapshot clean to the *same* key: one
underlying callsign, written two ways, appearing as two rows. (See the glossary
entry for [Cleaned](https://mysteraitch.github.io/amateur-callsigns-file-watch/glossary.html#cleaned).)

---

## How the mirror noticed them

The mirror builds one page per callsign, and to do that it groups every row by
its cleaned key. Grouping is exactly where twins reveal themselves: two rows
falling into one group is the signal.

You can reproduce the whole grouping in a few lines. Reading
[`archive/2026-06-23/normalised.csv`](../../archive/2026-06-23/normalised.csv)
(158,318 data rows), cleaning each `callsign` field with the rule above, and
keeping the keys that occur more than once yields:

| cleaned key | raw tokens (status in this snapshot) |
|---|---|
| `G6FMU`    | `G6FMU` — Available · `G6 FMU` — Allocated (Full) |
| `G7IWE`    | `G7IWE` — Reserved (Full) · `G7IWE`+`U+00A0` — Allocated (Full) |
| `G0TQK`    | `G0TQK` — Reserved · `G0TQK`+`U+00A0` — Reserved (Full) |
| `M/EI8DJ`  | `M/EI8DJ` — Reserved · `M/EI-8-DJ` — Reserved |
| `M/PT2FM`  | `M/PT2FM` — Reserved · `M/#PT2FM` — Reserved |
| `M/VK4VGK` | `M/VK4VGK` — Reserved · `M/#VK4VGK` — Reserved |

**[observed]** Six groups, twelve rows. Of these, **two disagree on status** in this
snapshot — `G6FMU` and `G7IWE` — while the other four now agree (though, as
below, they do not all agree on the licence *product*).

The odd character in each pair is worth naming precisely, because some of them
are invisible:

**[observed]**

- `G6 FMU` — an ordinary **space** (`U+0020`) sitting inside the callsign.
- `G7IWE` and `G0TQK` — a trailing **non-breaking space** (`U+00A0`), which
  looks exactly like a normal space but is a distinct character. The mirror has a
  whole explainer on why these matter:
  [invisible characters](https://mysteraitch.github.io/amateur-callsigns-file-watch/invisible-characters.html).
- `M/#PT2FM`, `M/#VK4VGK` — a `#` (`U+0023`), the reciprocal/visitor placeholder
  notation, sitting mid-token.
- `M/EI-8-DJ` — stray **hyphens** (`U+002D`).

This is not an artefact of the mirror's processing. **[observed]** Both `G6FMU` rows
are present verbatim in Ofcom's own export,
[`archive/2026-06-23/raw.csv`](../../archive/2026-06-23/raw.csv) — the lines
begin `G6FMU,,Available,…` and `G6 FMU,Amateur Full Radio Licence,Allocated,…`.
The twin is in the source, not introduced downstream.

---

## What the data shows

### They persist, unchanged, across four years

**[observed]** Regrouping the earlier snapshots the same way, the same six keys recur
throughout:

| snapshot | cleaned-key groups >1 row | of which disagree on status |
|---|---:|---:|
| [2022-05-30](../../archive/2022-05-30/normalised.csv) | 6 (12 rows) | 5 |
| [2023-02-20](../../archive/2023-02-20/normalised.csv) | 6 (12 rows) | 5 |
| [2025-04-08](../../archive/2025-04-08/normalised.csv) | 7 (14 rows) | 5 |
| [2026-06-23](../../archive/2026-06-23/normalised.csv) | 6 (12 rows) | 2 |

**[derived]** The six callsigns above appear in all four snapshots — four years of
republication with the twin intact. The 2025-04-08 snapshot carries one extra,
transient group (`M/MKG4BZB` / `M/M#KG4BZB`) that appears in that snapshot alone.
So the population is stable and small: twin rows are the rare exception across
~158,000 rows, and the members are a handful of individual callsigns rather than
a systemic pattern.

### The odd form usually holds the live licence

**[observed]** Take the five groups that pair one ordinary-shaped token with one
oddly-shaped one (`G0TQK`, `G6FMU`, `G7IWE`, `M/EI8DJ`, and the transient
`M/MKG4BZB`). In **four of the five**, the oddly-shaped token is the one carrying
the more active status (`Allocated`) in the snapshots where the pair appears —
`G0TQK`, `G6FMU`, `G7IWE`, `M/MKG4BZB`. Only `M/EI8DJ` runs the other way: there
the ordinary-shaped `M/EI8DJ` is the allocated one and the hyphenated form is
reserved.

**[derived]** So `G6FMU`'s shape — the non-standard token holding the live licence,
the clean form sitting available — is the *typical* case in this small
population, not a curiosity. (The remaining two groups, `M/PT2FM` and
`M/VK4VGK`, pair two *differently-formatted but both expected* reciprocal
notations — the plain visitor form and the `#`-placeholder form — rather than one
tidy and one malformed, so they are not part of this normal-vs-odd count.)

### The state is not frozen — read it fresh per snapshot

**[observed]** `G0TQK` illustrates why a single reading is not enough. In the
2022, 2023 and 2025 snapshots its non-breaking-space twin is `Allocated`; by
23 June 2026 **both** rows read `Reserved` — but the twin still carries the
`Amateur Full Radio Licence` product while the bare form carries none. The status
agrees; the attributes do not.

**[observed]** Timestamps shift too. `G6FMU`'s allocated row was the *older*-dated of
the pair at 2023-02-20 (modified 2017-02-21, against the available row's
2021-05-12), yet by 2025-04-08 it had been touched again (2024-03-20) and become
the *newer* one. Any "most recently modified" reading has to be taken per
snapshot, not assumed to hold.

**[observed]** A caution on dates: in the 23 June 2026 snapshot the modification date
is populated for **exactly the 105,332 `Allocated` rows and no others** — every
`Reserved` and `Available` row is undated by design. So an undated pool twin is a
characteristic of the schema, **not** evidence that the row is stale. And the
30 May 2022 snapshot carries **no** modification dates at all (zero of 151,152
rows), a whole-snapshot gap. Absence of a date is not absence of currency.

---

## The hypothesis (recorded, not asserted)

**[hypothesis]** A single mechanism would tie the typical shape together: the malformed
row may be the **actually-issued** licence, entered under a slightly-mangled
callsign, with the register's clean canonical form deliberately parked as
`Reserved` so the same callsign cannot be issued a second time. Under that
reading the odd twin is "the licence" and the tidy twin is "the guard".

**[observed]** The latest snapshot's own statuses are consistent with this for two of
the three UK pairs, and pointedly *not* for the third:

- [`G7IWE`](https://mysteraitch.github.io/amateur-callsigns-file-watch/callsign.html?c=G7IWE)
  — the clean form is `Reserved`; the non-breaking-space twin is `Allocated`
  with a Full licence. The strongest match.
- [`G0TQK`](https://mysteraitch.github.io/amateur-callsigns-file-watch/callsign.html?c=G0TQK)
  — the clean form is `Reserved`; the twin carries the Full-licence attributes.
- [`G6FMU`](https://mysteraitch.github.io/amateur-callsigns-file-watch/callsign.html?c=G6FMU)
  — **the exception**: the clean form reads `Available` — i.e. apparently
  issuable — while the embedded-space twin holds an active Full licence. If the
  hypothesis held here, this would be a *missed* protection rather than a
  deliberate one.

**[derived]** `M/EI8DJ` is treated separately: both its rows are `Reserved` and the
odd member is a reciprocal-format variant (the hyphenated `M/EI-8-DJ`), so it
looks like a different mechanism — a formatting variant of a reserved
reciprocal callsign — rather than the issued-under-a-malformed-key pattern.

**What would verify it.** **[hypothesis]** The decisive evidence lies outside the
mirror's holdings: what the official callsign-application or availability check
reports for a clean canonical form whose malformed twin is allocated — in
particular, whether that check strips whitespace before deciding a callsign is
free. The `G6FMU` case (clean form marked `Available`) is the most informative
place to look. This is an avenue for checking the record-keeping mechanics, and
is framed as such — an observation about published data and a question about
process, not a claim about any individual.

---

## How the record handles it today

**[observed]** Nothing here is dropped, merged, or resolved to a winner:

- The per-callsign page marks a dataset where a cleaned form's statuses disagree
  and shows the note *"listed more than once — statuses disagree … both are kept;
  neither is picked as the winner."* Each raw row is shown verbatim.
- The [Ledger](https://mysteraitch.github.io/amateur-callsigns-file-watch/ledger.html?c=G6FMU)
  raises its own `co-temporal-status-divergence` flag for the same effect — *"the
  raw variants disagree on status. The register shows both."*
- The reasoning behind keeping both, and how the mirror records this kind of
  within-snapshot conflict, is set out on the
  [fidelity deep-dive](https://mysteraitch.github.io/amateur-callsigns-file-watch/fidelity.html#consistency).

**[derived]** The verdict the counts support is a light-touch one: six twins across
~158,000 rows, the same six for four years, is duplication as the rare exception.
No data-model change is warranted — the raw rows stay distinct, and the conflict
is surfaced independently in two places with no silent resolution.

---

## Reproduce this yourself

Every figure above comes from grouping a snapshot's `normalised.csv` by the
cleaned key. In short: read the file, apply
`callsign.toUpperCase().replace(/[^A-Z0-9/]/g, '')` to the `callsign` column,
and keep the keys that occur more than once. The odd characters are easiest to
see by printing each token's Unicode code points — that is how the `U+00A0`,
`U+0023`, and `U+002D` above were confirmed. The raw, verbatim source rows sit
alongside in each snapshot's `raw.csv`.

---

## Provenance and related threads

- The quantification, the normality and recency analysis, the treatment survey,
  and the recorded hypothesis: **issue #467**
  ([thread](https://github.com/MysterAitch/amateur-callsigns-file-watch/issues/467)).
- This narrative form: **issue #292**
  ([tracker](https://github.com/MysterAitch/amateur-callsigns-file-watch/issues/292)).
- The recency/normality annotation refinement for conflict display: **issue #633**.

*Observations were re-derived from the archived snapshots for this write-up. The
statuses, dates and tokens quoted are those published by the source; they change
between snapshots and should be read fresh from the per-callsign pages linked
above.*
