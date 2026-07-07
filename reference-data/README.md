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

### `forbidden-suffixes.csv` — suffixes Ofcom will not issue

1,465 three-letter suffixes disclosed by Ofcom in response to a Freedom of
Information request, August 2019. The list is a point-in-time disclosure:
treat presence on this list as "was withheld as of August 2019", not as a
statement about current policy — Ofcom's current guidance describes withheld
callsigns only generally ("is not withheld (for example because it is
offensive)", *Amateur radio guidance*, §5.4.1 fn. 5).

Normalisation applied on import: UTF-8 BOM removed, CRLF→LF, `suffix` header
row added. Content otherwise verbatim (original disclosure order — already
alphabetical — preserved; 1,465 unique entries).

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

## Conventions

- CSV, UTF-8, LF, header row, minimal quoting — matching the repository's
  derivative conventions so tooling is uniform.
- `notes` columns carry row-specific facts only; general context lives in
  this README and (once merged) `docs/reference/callsign-structure/`.
- Consumers must treat unknown values leniently (e.g. an RSL letter absent
  from `rsl.csv` is "unknown", which is itself a reportable signal — see the
  temporary/special RSLs such as the 2022 `Q`, which are deliberately not
  enumerated here).
