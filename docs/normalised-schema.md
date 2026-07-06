# Normalised schema reference

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

## Companion artefact: `stats.json`

Each normalised entry also carries `archive/{key}/stats.json` (issue #46):
data-quality statistics computed from the canonical rows — a callsign format
taxonomy (statsSchemaVersion 2: uppercase→`A`, lowercase→`a`, digit→`N`;
whitespace/unprintable/invisible characters — including regular space, since
whitespace in a callsign is unambiguously invalid — appear as printable
`{U+XXXX}` markers so each offending codepoint is immediately visible and
distinct; all other characters preserved verbatim) and per-column
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
