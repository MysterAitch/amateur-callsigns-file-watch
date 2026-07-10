# ADR 0010 — The archive contract: raw bytes verbatim, keyed, provenanced, accepted before processability

- Status: accepted
- Date: 2026-07-10
- Related: ADR 0001 (golden-master derivation), ADR 0004 (FOI lane), ADR 0009 (how entries land)

## Context

`archive/` is the authoritative record the whole project rests on: every
derived artefact (normalised CSVs, components, reports, the SQLite database, the
site) is rebuildable from it, and consumers are told they may walk it as
ordinary files without git. That guarantee only holds if the rules governing
what an entry *is* — its bytes, its key, its provenance, and the conditions
under which it may be admitted at all — are fixed and honest. Those rules were
settled early and incrementally, but their canonical description is scattered
across `.gitattributes` comments, the `ArchiveMeta` type in
`src/shared/utils.ts`, the key-resolution code in `src/shared/archive.ts`, and
the README design notes. This ADR consolidates them.

## Decision

1. **Raw bytes are preserved verbatim.** `.gitattributes` marks
   `archive/**/raw.*`, `latest-raw.*`, and the FOI lane's data attachments as
   `binary`, so a publisher's exact bytes (Ofcom's CRLF-terminated CSVs among
   them) survive checkout on any platform. This is not cosmetic: the archive
   idempotence check hashes the freshly-downloaded staging file against the
   archived `raw.*` hash, and any line-ending normalisation would break that
   invariant. Derived files (sorted CSVs, JSON, `meta.json`, `normalised.csv`)
   are deliberately text with pinned LF — Node's writers emit `\n`
   unconditionally, and text handling gives readable git diffs.

2. **Keys are publication dates, content-hash-suffixed on collision, and
   correctable.** An open-data key is Ofcom's own publication date
   (human-meaningful and chronologically sortable). When two publications want
   the same date with different content, a short content-hash suffix
   distinguishes them (`2025-06-04--0a1b2c`), so both are preserved rather than
   one overwriting the other. The open-data lane is constrained to date-shaped
   keys (`^\d{4}-\d{2}-\d{2}(--[0-9a-f]+)?$`); anything else under `archive/`
   belongs to another lane (ADR 0004's `archive/foi/`) and must never surface
   through `listArchiveKeys()`, because a non-date key would hijack
   newest-entry and latest-pointer logic. Keys are correctable when better
   provenance emerges — the key names the entry, it does not freeze a claim.

3. **Provenance is declared, from a closed vocabulary.** Every entry's
   `meta.json` carries a `provenance` field, one of `live`,
   `reconstructed-from-git-history`, or `reconstructed-from-prior-download`.
   `live` entries were fetched first-hand by the current codebase;
   reconstructed entries were materialised retroactively (from prior git blobs,
   or from downloads retained outside the repository) and may legitimately lack
   fields only a live fetch captures (source URL, cache-buster value), with
   `reconstructionNotes` recording what is known about how and when the bytes
   were originally obtained. Consumers surface the distinction rather than
   hiding it: a reconstructed entry is not first-hand and says so.

4. **`intendedCoverage` records intent, never verified quality.**
   `intendedCoverage.complete = true` means the publisher presented the entry as
   the full dataset; `false` means it is knowingly partial (an FOI response
   scoped to a subset, or a visibly truncated publication), with `scopeNotes`
   describing what a partial view covers. This is deliberately about intent, not
   quality: an intended-complete export can still carry defects (blank fields,
   suspected missing records), and those are a separate observation axis, not a
   reason to mark coverage incomplete. Consumers diffing or aggregating across
   entries must not read missing rows in a partial entry as revocations — they
   are scope, not change.

5. **Raw acceptance is never blocked on processability.** A dataset enters the
   archive on the strength of honest provenance metadata alone. Normalisation
   and other derivation are optional enhancements layered on later (ADR 0001's
   golden-master sweep), and their absence never keeps well-provenanced raw
   bytes out. The founding preference is that an honest crash or an
   un-normalised raw entry beats silently mirroring truncated or broken data:
   the sanity gates exist to fail loud, and a raw record worth keeping despite
   failing checks lands through the deliberate admin-bypass escape hatch
   (ADR 0009).

## Consequences

- Idempotence and reconstruction both depend on byte-exact raw preservation;
  the `.gitattributes` binary markings are a hard invariant, not a convenience.
- The schema-versioning *policy* for derived data folds in here: `meta.json`
  carries a `schemaVersion`, and `docs/normalised-schema.md` stays a living
  reference for the schema *contents* rather than becoming an ADR — contents
  evolve, the contract that versions them does not.
- Derived metadata is a snapshot, not a live truth: a `meta.json` diff summary
  is written once and is not rewritten if publications are later inserted
  between existing entries, so consumers needing an authoritative current diff
  re-derive from the raw files.
- Every consumer surface inherits the honesty obligations: reconstructed
  provenance and declared-partial coverage are shown to readers, so absence of a
  callsign from a partial entry is never presented as evidence of anything.
