# ADR 0016 — File-level claims and the reconstruction oracle

- Status: accepted
- Date: 2026-07-12
- Related: #434, #431 (source position, ADR 0015), #361 (raw-keyed claim ledger, ADR 0013), #404 (trust-rating net, ADR 0014)

## Context

The ledger keys every observation by `(source_file, ordinal)` and emits, per
source row, one `@listed` existence claim plus one attribute claim per non-empty
non-subject cell. That faithfully captures the DATA GRID (row order/count via the
gap-free ordinal, duplicate rows via observation identity, verbatim cell content
in the raw token) but drops the source's STRUCTURAL FRAMING:

- the verbatim, as-published column headers — the full set, in source order, as
  exact strings (weird casing, interior/edge whitespace, encoding artefacts,
  truncations like the literal `Licence Issued Dat`). A column empty on every row
  produces no attribute claim and vanishes entirely; column order is not encoded;
  the subject column's header is never emitted at all;
- which column is the subject, and where it sits among the headers;
- the curated footer furniture and blank lines the loader strips before parsing
  (the salesforce copyright/generated-by block on the open-data export).

Attesting the verbatim header is a standing requirement in its own right, not
merely a reconstruction input: our canonical column mappings (the header-variant
registry, the FOI converter bindings) are ASSUMPTIONS that can be wrong, and the
source's own header is the only ground truth against which a mis-mapping can be
identified and corrected later (the mis-mapping self-check is #433/E5, out of
scope here). This ADR settles how that framing is attested, and lands the
reconstruction oracle that proves the raw layer — grid plus framing — is
canonical.

## Decision

1. **File-level claims are a distinct, non-observation claim class, marked by a
   sentinel ordinal.** A claim that describes the FILE rather than a row carries
   `provenance.ordinal === FILE_LEVEL_ORDINAL` (`-1`). Observations occupy the
   gap-free range `0..n-1`, so `-1` can never collide with one. Consumers test
   membership through `isFileLevelClaim`, never by open-coding the sentinel. This
   is the convention #431's file-level metadata stream reuses, so the ledger
   grows ONE file-level convention, not two.

   A sentinel ordinal was chosen over a new `kind` discriminator because the
   folds are ALREADY ordinal-keyed and already enforce a `0..maxOrdinal` bound
   (the reconstruction's gap-free row-count; the `@listed` existence fold): a
   sentinel is rejected by the same check they already make, with no new field on
   the wire and no migration of legacy ledgers.

2. **File-level claims are `layer:'raw'`, reading out As-published.** A verbatim
   header or furniture string IS a source byte, not a derivation of anything, so
   it sits cleanly under #404's no-inflation invariant (no rule; As-published).
   The reserved predicate vocabulary is atomic (one claim each), matching the
   ledger's grain and staying greppable/diffable:
   - `@column/<index>` — object = the verbatim as-published header string; the
     column INDEX is encoded in the PREDICATE, not as a delimiter in the object,
     because a header may itself contain whitespace or tabs. Both the order and
     the exact string are therefore stored facts, never inferred.
   - `@subject` — object = the verbatim header of the subject column (its index
     falls out of the `@column` set).
   - `@ignored` — object = one curated/blank line verbatim, positioned by its
     source line on the shared `provenance.position` (issue #431/#436).

3. **The folds exclude the file-level stream by construction.** `projectNormalised`
   (the observation reprojection) skips `isFileLevelClaim`, so a mixed stream
   reprojects to exactly the observation rows. The compact-DB build already keys
   attributes to an observation created only from `@listed` claims, so a
   file-level claim (no `@listed`, sentinel ordinal) contributes no observation
   and joins no attribute — the `claims` VIEW multiset is untouched. The
   no-inflation invariant sees file-level claims as ordinary raw claims and
   raises nothing.

4. **The reconstruction oracle compares at DECODED-TEXT level, modulo cosmetics.**
   Each source is rebuilt from its claim stream alone — the manifest from the
   file-level claims, the grid from the per-row claims grouped by ordinal — and
   compared to the original raw bytes decoded with the loader's encoding. Both
   sides pass through one canonicaliser that normalises away exactly: a leading
   BOM; CRLF/CR line endings; a single trailing newline; and quoting STYLE
   (re-rendered through the one minimal RFC-4180 `renderCell`, which never
   touches data quotes). Every other byte — cell values, column set/order,
   subject placement, row count/order, furniture content/position — must match.
   Byte-level (re-encoding) comparison is a later phase (#434 Phase 2 / G6).

5. **The oracle is a committed CI self-check, and non-coverage is explicit.** It
   runs over the real corpus and fails the build loudly on any miss, like
   `trust-rating.ts`. It covers the three CSV-producing families (open-data
   register, FOI-CSV register, attribute-addendum). The FOI markdown-table,
   preamble, and prefixed (synthesised-callsign) shapes emit no claims today and
   so cannot be reconstructed: they are enumerated as explicit not-yet-covered
   (never a silent pass), pending the ingest work (#434 Phase 3 / E3).

## Consequences

- The raw claim layer is demonstrably canonical for the CSV lanes: the committed
  raw file is redundant-by-derivation, and any future change that drops or
  corrupts source structure fails the oracle rather than passing silently.
- The verbatim as-published header is now attested, giving #433's header→canonical
  mapping self-check the ground truth it needs.
- Additive: legacy ledgers (no file-level claims) parse and fold unchanged; #404,
  the compact `claims` VIEW parity, and the `@listed`/ordinal invariants are all
  undisturbed, because the sentinel keeps the file-level stream out of the
  observation multiset.
- The open-data lane is the strongest pass: `parseRawRegister`'s line-accounting
  invariant already rules out the one hazard (a multiline cell) the CSV serialiser
  cannot otherwise detect.
