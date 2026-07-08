# Normalised schema reference

This page covers the **open-data lane**; the FOI lane's row-schema families,
extension-column registry and per-variant conversions are documented in the
generated [`foi-schemas.md`](foi-schemas.md).

## Data strata

The repository's data falls into four strata with distinct lifecycles:

| stratum | contents | lifecycle |
|---|---|---|
| **source mirror** | `archive/*/raw.csv` (+ provenance in `meta.json`) | verbatim publications; never modified |
| **reference data** | `reference-data/` | hand-curated knowledge with citations; an *input*, reviewed like code |
| **derived data** | `normalised.csv`, `components.csv`, `stats.json`, `reports/` | machine-derived in the golden-master lane: byte-deterministic, re-derived by the scheduled sweep, changes arrive as human-reviewed PRs |
| **presentation** | downstream consumers (UI repositories, analyses) | assembles derived + reference data at read time |

`archive/{key}/normalised.csv` presents every publication in ONE stable shape,
regardless of the raw file's per-publication header drift. The filename never
changes; each entry's `meta.json` declares what it achieved
(`normalised.schemaVersion` + `headerVariant`), and the header row itself acts
as a fingerprint. Entries may legitimately lag the current schema version or
be raw-only — the rolling "Normalisation coverage" issue is the dashboard.

Golden-master semantics (ADR 0001): `normalised.csv` is the *current-best*
derivation, re-derived by the scheduled normalise sweep; git history preserves
every earlier version. Byte-identical re-runs are no-ops; any change arrives
as an always-human-reviewed PR.

## Line accounting: `headerLines` and `ignoredLines`

### Vocabulary: line, row, record

Three strata, three words — deliberately distinguished (RFC 4180 conflates
record and line, which is exactly the ambiguity that once let an export
footer masquerade as data; the W3C CSVW tabular-data model draws the same
physical-vs-logical distinction as "source row" vs "row"):

| term | unit of | definition | empty form |
|---|---|---|---|
| **line** | raw text | terminator-delimited physical line of `raw.csv` | *blank line*: empty/whitespace-only — never a row; auto-enumerated in `ignoredLines` (reason `blank`) |
| **row** | the table | syntactically valid unit: correct column count, parsed from one line | *empty row*: all cells empty (`,,`) — **still a row**, stays in the table |
| **record** | structured data | the canonical unit derived 1:1 from a row (`normalised.csv`, `components.csv`) | *empty record*: all canonical fields empty (today 1:1 with empty rows; conceptually distinct, since a variant mapping a subset of columns could differ) |

Counts name their stratum: `files['normalised.csv'].recordCount` counts
records; `stats.json` carries `emptyRecords`/`nonEmptyRecords`
(`recordCount = emptyRecords + nonEmptyRecords` always). Legacy wart,
documented rather than churned: `files['raw.csv'].recordCount` predates
this vocabulary and is by these definitions a **row** count.

### Validity is syntactic here, semantic downstream

A raw line with the correct column count **is a row of the table** and
becomes a record — including all-empty rows and rows with no callsign,
because that is what the raw data provides (deliberate). Whether a row
represents a valid callsign with sensible attributes is a *semantic*
judgement belonging to the flag machinery (`emptyCallsign`,
`excel-date-shaped`, whitespace/encoding detectors…) and downstream
consumers. There is no mechanical semantic gate in normalisation.

Exactly two things keep a line out of the table:

- **blank lines** (not rows at all) — auto-enumerated with reason `blank`;
- **curated ignores**: syntactically valid lines a *human* has judged to be
  export furniture (copyright footers, generated-by stamps). These are
  hand-written into `meta.json`'s `ignoredLines` and treated as **input** by
  the converter, which honours them only if they byte-match the named raw
  line — stale curation fails the conversion loudly. There is deliberately
  no predicate that can make this call; explicitness plus PR review is the
  guard.

### The count invariant

Every physical line is exactly one of header / row / ignored line, and
records = rows (the conversion is a bijection), so — enforced by
`validate:data` for every normalised entry, exact arithmetic:

```
raw.csv physical lines = headerLines.length + recordCount + ignoredLines.length
```

(a file-terminating newline ends the last line; it does not start a blank
one.) `headerLines` records the verbatim header bytes with line numbers
(`columnNames` records the *parsed* header; this records the *bytes*, so
header drift in a re-fetch is loudly visible) — an array so a future source
with multi-row headers (title lines above the column row, as
PDF-transcribed FOI tables have) fits without a schema change. The
validator re-verifies every declared header and ignored line byte-for-byte
against the immutable, hash-pinned `raw.csv`, and requires a reason on
every ignored line.

## Companion artefact: `stats.json`

Each normalised entry also carries `archive/{key}/stats.json` (issue #46):
data-quality statistics computed from the canonical rows — a callsign format
taxonomy (uppercase→`A`, lowercase→`a`, digit→`N`;
whitespace/unprintable/invisible characters — including regular space, since
whitespace in a callsign is unambiguously invalid — appear as printable
`{U+XXXX}` markers so each offending codepoint is immediately visible and
distinct; all other characters preserved verbatim), automated callsign-defect
detectors (statsSchemaVersion 3, issue #51: Excel-date-shaped values,
encoding-failure characters, whitespace-bearing values, post-normalisation
duplicates, empty and lowercase-bearing callsigns — counts plus capped,
sorted example values), and per-column
distributions (distinct/empty counts, string-length
ranges, date min/max; distinct and ranges consider non-empty values only,
emptiness being its own counter). It lives in the same golden-master lane:
produced by the sweep, declared in `meta.files` (size + sha256), versioned via
`normalised.statsSchemaVersion` in meta, serialised with lexicographically
sorted keys so diffs between publications stay minimal and are themselves a
review signal.

Derivation PRs and the coverage dashboard include a neighbour-comparison
table for each changed entry — up to three chronological neighbours on *each
side* (archive-key order), showing record-count deltas and callsign patterns
gained/lost, so a reviewer can judge whether a new or retrospectively
inserted publication is plausible in both directions.

## Schema v1

Faithful column mapping plus date normalisation. Values are otherwise
verbatim from raw.

| column | notes |
|---|---|
| `callsign` | the callsign value, verbatim |
| `product` | licence product, verbatim (legitimately empty for never-licensed callsigns) |
| `status` | e.g. Allocated / Available / Reserved, verbatim |
| `type` | verbatim; empty for variants that carry no Type column |
| `created_date` | ISO-ordered; populated by the 2025 variants only |
| `last_modified_date` | ISO-ordered; populated by the 2023 and 2025 variants |
| `licence_version_last_modified_date` | ISO-ordered; populated by the 2026 variant only |
| `licence_version_original_start_date` | ISO-ordered; populated by the 2026 variant only |

- **Union columns**: the header is identical for every entry; a column the
  entry's raw variant doesn't carry is empty on every row. `headerVariant` in
  meta says which columns are real for that entry — distinguishing
  "empty because absent from the variant" from "empty in the raw data".
- **Dates**: `yyyy-mm-dd`, with ` hh:mm` (or `:ss`) kept where the raw
  supplies time, zero-padded. Raw dates are strictly `dd/mm/yyyy` (day-first
  is empirically proven per column by day>12 values; the converter reports
  per-column verification and fails loudly on anything unparseable, including
  a wholesale month-first flip). Plausibility window: 1900 (pre-dating the
  first UK amateur licences) to the entry's own publication/fetch date.
- **Ordering**: rows sorted by `callsign` in codepoint order, whole-row
  tie-break. Deterministic across platforms by construction.
- **Encoding**: UTF-8, LF line endings, minimal RFC-4180 quoting, trailing
  newline. No BOM (stripped from raw where present).

## Interaction with `intendedCoverage`

`meta.intendedCoverage.complete` describes the RAW record's intended scope
as published — intent, not verified data quality — and flows
through to how the normalised file may be used: a partial entry (scoped FOI
response, truncated publication) normalises fine, but its rows must never be
read as the full population, and cross-entry diffs against it mislead. The
sweep's dashboard flags such entries.

## Evolving the schema

A new version = a converter change (with tests and fixtures) merged like any
code, after which the next sweep re-derives every supported entry in one
reviewable PR — the cross-entry diff is the review artefact. Anticipated v2:
derived callsign-component columns (prefix / region identifier / number /
suffix) and licence-level classification.
