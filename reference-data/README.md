# Reference data

Small, hand-curated datasets distilling authoritative sources into
machine-readable form, for use by converters, statistics, and analyses
(callsign component parsing and flags — normalised schema v2, issue #51).

These are **inputs**, not derivatives: they are maintained by hand, reviewed
like code, and live outside `archive/` and the golden-master lanes. Changing
a row here is a reviewed code change; the next sweep then re-derives whatever
depends on it.

**Provenance policy for this directory**: every dataset here derives
exclusively from sources whose authorship and shareability are unambiguous —
Ofcom publications (© Ofcom, reproduced with acknowledgement per Ofcom's
terms of use), Ofcom FOI disclosures, and the ITU call-sign-series table
(© ITU). Community-derived reference material (series issue-date histories,
club conventions) is deliberately **excluded** from this directory and will
be proposed separately, where faithfulness to the original authors and
shareability can be reviewed on their own merits.

One further source sits on the **cite-don't-copy** footing the ITU table
already establishes: the RSGB Special Contest Calls table
(`rsgb-special-contest-calls.csv`). Its source page is largely RSGB-authored
prose (eligibility rules, contest lists, an FAQ) which is copyrightable and is
**never reproduced** — only the uncopyrightable three-column factual layer (the
SCC-code → base-call → status enumeration) is extracted, cited by URL and fetch
date. That is the same distinction the ITU inclusion rests on (an uncopyrightable
factual table, cited, not the surrounding authored material), which is why it
belongs here and the excluded community-derived material above does not.

**Carve-out — `publishers.json`**: this file is the one exception, and
deliberately so. It is not *distilled source data* at all — it holds no
callsigns, allocations or facts drawn from any source. It is project-authored
metadata **about** the sources: who originates, archives, aggregates or hosts
the material the mirror holds, and under what terms it may be republished. The
Ofcom/ITU-only rule governs data lifted *from* a source; it does not govern the
project's own description *of* those sources, which necessarily names
community and third-party bodies (WhatDoTheyKnow, the Internet Archive, RSGB,
Wikipedia). It lives here because it is a hand-curated, code-reviewed
vocabulary consumed like the others (a typed reader plus a validator), not
because it distils an authoritative dataset. Its own provenance discipline is
different in kind: the licence statements it makes are **public claims about
other parties' terms**, so each entry cites the governing terms it relies on
(`licenceUrl`), and a basis that has not been established is recorded as
`unverified` rather than asserted (fail-honest). A publisher entry's
`licenceBasis`/`licenceStatement` is the **default/typical** basis, not a
blanket claim over its whole catalogue: licensing is publication-specific —
current publications may carry one licence while historical ones carry another
— so each dataset/publication may override the default with its own basis (the
per-publication licence fields land in a later increment). Increment 1 of #618.

## Datasets

### `rsl.csv` — Regional Secondary Locators

One row per RSL letter. `scope` is `all` (any licence) or `full-club-only`.
Since the 2023–2025 licensing review RSLs are optional except for
Intermediate stations retaining a `2`-format callsign.

Source: Ofcom, *Amateur radio guidance* (updated 14 October 2025), §5.7
Table 2, <https://www.ofcom.org.uk/siteassets/resources/documents/manage-your-licence/amateur/amateur_radio_licence_guidance_for_licensees.pdf>;
the England-`E` extension: Ofcom, *Statement: updating the amateur radio
licensing framework* (11 December 2023), Q4 decision.

### `prefix-formats.csv` — callsign prefix → station level

One row per prefix series as Ofcom issues them today. `issuing_status` is
`currently-issuing` or `formerly-issued`; `rsl_required` is true only for
the retained `2#0`/`2#1` Intermediate formats (`#` = the mandatory RSL
position). This table is the **current** system only — historical series
issue-date ranges are community-sourced and out of scope for this directory.

Source: Ofcom, *Amateur radio guidance* (updated 14 October 2025), §5.2
Table 1; M8/M9 reservation detail: Ofcom, *Implementing Phase 2 and 3 of the
Amateur Review* (14 October 2025), <https://www.ofcom.org.uk/siteassets/resources/documents/manage-your-licence/amateur/amateur-radio-phase-2-and-3-review.pdf>.

### `special-formats.csv` — special station callsign formats

Only the formats Ofcom's own documents state (Special Event Stations,
Special Contest Callsigns). Repeater/beacon/gateway conventions (GB3, GB7,
MB7) are community-documented and therefore excluded here pending a
primary citation.

Sources: Ofcom, *Implementing Phase 2 and 3 of the Amateur Review*
(14 October 2025), p. 2 (SES); Ofcom, *Amateur radio guidance* (updated
14 October 2025), §6.4 (SCC).

### `licence-category.csv` — product/class string → canonical category

Maps each raw `product` (open-data) / `licence_class` (FOI) string the
register uses to one canonical `normalised_category`. The same class is
written differently across source vintages — `Full` vs `Amateur Full Radio
Licence`, `Foundation` vs `Amateur Foundation Radio Licence` — so this table
collapses the vocabulary drift to a single category while the raw value is
still carried verbatim elsewhere (source fidelity). The value catalogue's
"Normalised licence category" section is generated from it, and flags any
non-blank product with no mapping rather than dropping it.

The two reciprocal categories are kept **distinct**: `Temporary Reciprocal`
is a short-term visitor authorisation (being phased out), whereas `Full
(Reciprocal)` is a permanent UK Full licence granted on a recognised foreign
qualification (HAREC / CEPT T/R 61-02) — different duration, rights and legal
basis. A blank product is not a category and is left as-is.

The special-event / Notice-of-Variation family is likewise kept in **three
distinct** categories rather than folded together: `Special Event Station`
(the event-bounded working — plain and the `NoV …` spellings), `Permanent
Special Event Station` (the open-ended `Perm …` / `NoV Permanent …`
spellings), and `Special Research Permit` (a research instrument, not an event
station). They differ in licence mechanics and temporal character — the
non-permanent stations are typically bounded by an event window, the permanent
variant and the research permit are open-ended — so they are held apart on the
same precedent as the reciprocal pair, with the raw spellings carried verbatim.
The value catalogue reports each category's attested reservation-window
coverage beside the table and flags the register's own counter-examples
(permanent records that nonetheless expire, event records left open) rather
than smoothing them.

Sources: Ofcom, *Amateur radio licence guidance for licensees* (2025); RSGB,
*Operating for Visitors* / *Operating Abroad* (CEPT T/R 61-01 vs 61-02).

### `forbidden-suffixes.csv` — suffixes Ofcom will not issue

The **ever-forbidden union**: **1,466** three-letter suffixes, one row each,
with a `first_known_forbidden` date column. This is the distinct union across
*every* forbidden-list disclosure the archive holds — the September 2016 FOI
sheet, the two August/September 2019 witnesses, and the December 2024 export —
each suffix carrying the earliest date at which it is known to have been
withheld. It replaces the earlier 2019-only list (a bare `suffix` column of
1,465 entries, which lacked `JIZ`).

The union basis is deliberate. A single point-in-time list is fragile: the
2024 export drops `QNF`/`ZFJ` (the working theory is that this is an artefact,
not a deliberate de-listing) and adds `JIZ`. Flagging against "ever forbidden"
is robust to that churn and to suspected omission errors — `QNF`/`ZFJ` stay in
the union, so a register row carrying them stays flagged. Treat presence here
as "was withheld at some point on the disclosures held", not as a statement of
current policy — Ofcom's current guidance describes withheld callsigns only
generally ("is not withheld (for example because it is offensive)", *Amateur
radio guidance*, §5.4.1 fn. 5).

`first_known_forbidden` is the earliest disclosure vintage or per-suffix
`LastModifiedDate` at which a suffix appears (ISO-ordered `yyyy-mm-dd` or
`yyyy-mm`). Most suffixes sit at the 2024 export's `2016-07-29` bulk origin;
`QNF`/`ZFJ`, absent from that export, are dated `2016-09` from the earliest
disclosure vintage; `JIZ` is `2020-12-10` from its own `LastModifiedDate`. It
is the per-suffix anchor for the `forbidden-suffix-issued-after-first-known-list`
flag (see `flags.md`).

**Provenance and curation**: this file is a curated reference input, but its
content is derived one-time from the held disclosures via
`src/ci/forbidden-suffix-history.ts` (which reads only the committed FOI
`forbidden-list` normalised files, never the `landing/` drop zone) so it cannot
silently drift from them. A test in
`src/sources/ofcom-amateur/components.test.ts` asserts this file's union and
first-known dates still match the disclosure-derived history; the standing
observation layer is `reports/forbidden-suffix-history.md`. Normalisation on
the underlying disclosures: UTF-8 BOM removed, CRLF→LF; within-disclosure
duplicate rows (2016's `ZIT`) are surfaced, never silently deduplicated.

### `itu-call-sign-series.csv` — international call sign series (Appendix 42)

The full ITU table (952 series → allocated administration), extracted from
the xlsx export of the ITU GLAD application
(<https://www.itu.int/gladapp/Allocation/CallSigns>), fetched 2026-07-07.
© ITU. The UK holds 93 series: the complete `2AA–2ZZ`, `GAA–GZZ` and
`MAA–MZZ` blocks plus overseas-territory series (`VP/VQ/VS`, `ZB–ZJ`,
`ZN/ZO/ZQ`).

**Open question (to verify against a primary source)**: the series ranges
contain no digits, so how do `M7ABC` or `2E0ABC` fit `MAA–MZZ`/`2AA–2ZZ`?
The likely answer is that the series table allocates *prefixes* (the first
one or two characters — `M…` from `MAA–MZZ`; the two-character prefixes
`2A`–`2Z` from `2AA–2ZZ`), while callsign *formation* — prefix, then a
single digit, then the suffix letters — is defined separately in Article 19
of the ITU Radio Regulations. This reading needs verifying against the
Article 19 text before being stated as fact.

Empirical observations from the mirrored table that inform (but do not
settle) the question:

- **Series shapes**: of the 952 series, 652 are letter+letter (`GA…`), 208
  digit+letter (`2A…`, `3D…`), and 92 letter+digit (`H2A–H2Z` Cyprus,
  `A2A–A2Z` Botswana). **No digit+digit series exist** (nothing like `33A`)
  — the only excluded shape.
- **Allocation granularity reaches the third character**: split blocks exist
  — `3DA–3DM` Eswatini vs `3DN–3DZ` Fiji, and `SSA–SSM` Egypt vs `SSN–SSZ`
  Sudan — so a two-character prefix can be divided between administrations
  mid-range.
- **No `Q`-first series exist**: letter first-characters run A–Z excluding
  Q — the Q block is unallocated at the ITU level (Q codes), paralleling the
  community-cited rule against suffixes beginning with Q.
- A wrinkle sharpening the Article 19 to-do: Fiji's well-known amateur
  prefix is `3D2` — a *digit* in the third position, within its `3DN–3DZ`
  letter-range block — so the mapping from table ranges to transmitted
  prefixes involves formation rules the table alone does not express.

### `itu-entity-iso.csv` — ITU entity → ISO 3166-1 alpha-2 crosswalk

One row per distinct `allocated_to` entity in `itu-call-sign-series.csv`
(`allocated_to`, `iso_3166_alpha2`), so a resolved call-sign-series allocation
can render its administration's flag at the display edge. **Canonical-at-rest,
presentation-at-edge**: this table stores only the two plain ISO letters; the
flag emoji is composed from them at render time by the Unicode Regional
Indicator algorithm (`site/country-flag.js`), never stored.

It is a **separate, separately-sourced** bridge, not a rewrite of the ITU data:
the verbatim ITU entity string stays canonical and authoritative here as
elsewhere, and this file only pairs it with a code. The pairing is necessary
because ITU long-form names do not equal ISO short names by string equality
(`Argentine Republic` → `AR`, `Republic of Türkiye` → `TR`,
`Democratic People's Republic of Korea` → `KP`), and because rows that
concatenate a dependency onto its parent resolve to the **dependency's own**
territory (`… - Hong Kong` → `HK`, `Netherlands (Kingdom of the) - Aruba` →
`AW`, `New Zealand - Cook Islands` → `CK`).

Three entities hold a call-sign series but have **no national flag** — the
International Civil Aviation Organization, the United Nations, and the World
Meteorological Organization — and carry a **blank** code deliberately: they are
surfaced by name, never with a placeholder glyph.

Source: hand-curated by mapping each verbatim ITU entity to its ISO 3166-1
alpha-2 code, cross-checked against ISO 3166-1. ISO country codes are facts,
not a copyrightable table, and the flag itself is algorithmic (the Regional
Indicator composition of the two letters), so no third-party table is
reproduced. Completeness against `itu-call-sign-series.csv` and the tricky
reconciliations are held by
`src/v2/entity-iso-crosswalk.test.ts` (`data-validity`). See issue #201.

### `rsgb-special-contest-calls.csv` — RSGB Special Contest Calls

The full Special Contest Call (SCC) namespace enumeration extracted from the
RSGB Special Contest Calls page (<https://rsgbcc.org/hf/information/scc.shtml>).
One row per SCC code: `scc_code` (e.g. `G3ZME`'s contest call `G3Z`),
`base_callsign` (the licensee or club call the NoV is layered on, blank when the
code is unissued), `status` (the raw token as published), and `notes` (a
closed-vocabulary transparency column, empty for an ordinary row). SCCs are
RSGB-administered Notices of Variation on an Ofcom-issued base callsign, so this
table is genuinely independent of the Ofcom register (issue #693; surveyed on
\#109).

**Cite-don't-copy**: only the uncopyrightable three-column factual table is
extracted; the page's RSGB-authored prose (rules, FAQ, contest lists) is
copyrightable and is cited by URL + fetch date, never reproduced. The verbatim
page bytes are not committed. RSGB's typical terms are recorded in the publisher
register (`copyright-cite-only`).

**Carry-verbatim-and-flag**: the source is an Excel export pasted into the page
and carries artefacts that are surfaced, never silently corrected:
- status values are carried **exactly** as published — a lower-case `withdrawn`
  and a literal typo `Withdrawb` are both preserved and flagged in `notes`
  (`status-noncanonical-case` / `status-typo`), not rewritten. A closed status
  vocabulary (`Issued` / `Available` / `Withdrawn`) is enforced by a
  case-normalised comparison, with the two known anomalies allow-listed; a status
  outside that set stops the sweep loudly (a new class or a scrape error);
- hidden `x:str` cell attributes (leftover Excel content not rendered on the
  page, e.g. `x:str="Hoover GW3RDB "`) are attested source bytes, so they are
  **captured** into `notes` as `source-cell-remnant:<column>=<verbatim>` rather
  than discarded.

**Provenance and currency**: the sidecar `rsgb-special-contest-calls.meta.json`
records the source URL, the fetch timestamp, the page's own "Updated" banner
(text + parsed ISO date), and the row/status shape summary. The table is kept
current by a monthly scheduled sweep (`.github/workflows/scc-sweep.yml`) that
re-fetches, runs the sanity gate (row count within band, three columns, closed
status vocabulary, banner present and parseable — temp write then atomic rename),
and opens a review PR when the table changes. The parser
(`src/sources/rsgb-scc/parse-scc.ts`) is byte-deterministic and fixture-tested;
the committed table's invariants are held by
`src/sources/rsgb-scc/committed-table.test.ts` (`data-validity`).

### `callsign-format.md` — permitted call-sign characters (ITU Article 19)

Not tabular data but a reference note: what characters a call sign may
contain per ITU Radio Regulations **Article 19 §III** — the letters A–Z and
the digits, **accented letters explicitly excluded**, and nothing confusable
with a distress signal. It records how that grounds the parser's plain
alphabet (`A–Z`/`0–9` plus the notation characters `/` and `#`) and the
browsers' legible-call-sign flagging, and the crucial caveat that policy is
not the data — the mirror surfaces whatever is actually in a register value,
flagging (never assuming away) anything outside the permitted set. This also
supplies the Article 19 primary source the `itu-call-sign-series.csv` open
question above asks for on the *alphabet* (the fuller series-to-formation
mapping still merits its own verification). Source cited in the file.

### `publishers.json` — the publisher register (#618)

One hand-curated entry per body that originates, archives, aggregates or hosts
the material the mirror holds — Ofcom, the UK Government Web Archive, The
National Archives, the Internet Archive, WhatDoTheyKnow, the ITU, RSGB, the
OARC wiki, Wikipedia, GitHub, and the mirror itself (`self`). Each entry
carries: `id` (a stable slug referenced elsewhere), `name`, `roles`
(multi-valued: `originator` / `official-archive` / `web-archive` /
`foi-aggregator` / `community-documentation` / `incidental-host`), optional
`operator`, `url`, `channels` (the witness `channel` tokens that resolve to
this publisher), `licenceBasis` (a closed token — the publisher's
default/typical basis, which a specific publication may override),
`licenceStatement` with a cited `licenceUrl`, `authorityCeiling` (the ADR 0014
rung material witnessed only via this publisher may at most carry), optional
`fetchConstraints`, and `notes`.

It is JSON, not CSV, because `roles` and `channels` are multi-valued and
`licenceStatement` is multi-sentence prose. It is the **vocabulary** every
witness `channel` resolves through: `src/ci/validate-publishers.ts` (run inside
`validate:data`) enforces unique ids, one publisher per channel token, the
closed role/licence/ceiling vocabularies, well-formed URLs, and that every
witness channel recorded across both archive lanes resolves to an entry — so
an unknown channel fails loudly rather than rendering as a raw token. The
typed reader is `src/shared/publishers.ts`.

The `authorityCeiling` reuses ADR 0014's source-authority rungs verbatim
(`Official` / `FOI` / `Reference` / `Community` / `Self`) — it is a
cross-check ceiling, never a persisted trust rung. Ceiling assignments for
archive replays (e.g. whether a proven-byte-identical Internet Archive replay
of an official publication sits at the official rung) are subject to the
queued maintainer decision on #618; the Internet Archive's ceiling is recorded
provisionally at `Reference` pending it.

## Conventions

- CSV, UTF-8, LF, header row, minimal quoting — matching the repository's
  derivative conventions so tooling is uniform.
- `notes` columns carry row-specific facts only; general context lives in
  this README and (once merged) `docs/reference/callsign-structure/`.
- Consumers must treat unknown values leniently (e.g. an RSL letter absent
  from `rsl.csv` is "unknown", which is itself a reportable signal — see the
  temporary/special RSLs such as the 2022 `Q`, which are deliberately not
  enumerated here).
