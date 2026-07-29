# ADR 0018 — Attest column interpretation + flag within-table inconsistency

- Status: accepted
- Date: 2026-07-12
- Related: #435, #434/ADR 0016 (file-level claims + reconstruction oracle),
         #433/ADR 0017 (show the working), #431/ADR 0015 (source position),
         #404/ADR 0014 (trust net), #429 (stripped-collision), #361/ADR 0013 (claim ledger)

> *(Amended 2026-07-29.)* Recorded as `proposed` when written and never
> re-statused, although the decision was implemented and is enforced: the
> attestation tier, the drift oracle, both within-table passes and the scope
> guard are built (`src/v2/interpretation.ts`, `src/v2/within-table.ts`) and
> guarded by a committed, corpus-level oracle family
> (`src/ci/interpretation-oracle.ts` + `interpretation-oracle.test.ts`), and the
> attested format is load-bearing — the event-time tier (#725) parses date
> cells strictly under it. The status now reads `accepted`. Two boundaries
> remain open: the reader-facing surface (P4) is only partly landed (see the
> final consequence), and the `@interpretation`/`@column-flag` claim streams
> are emitted and oracle-checked on demand rather than riding the canonical
> persisted ledger emit (`emitSourceLedgerClaims`).

## Context

Our canonical reading of a column — its type, and the format we parse it under (a
date column's `DD/MM/YYYY` vs `YYYY-MM-DD`, a thousands-separated integer, an
enumerated licence category, the callsign-token subject) — is an ASSUMPTION,
latent in `FoiColumnSpec.kind` and the open-data variant registry
(`VARIANTS`/`DATE_COLUMNS`). It is never attested, yet the reconstruction (#434)
needs the format to re-serialise a claims-only source, and a wrong or drifting
interpretation is otherwise unfalsifiable.

Separately, an interpretation should be internally consistent WITHIN one table: a
date column should not mix formats, and two distinct raw values collapsing to one
canonical inside one table signals the terms may not be as equivalent as our map
assumes (e.g. both `Full` and `Amateur Full Radio Licence` → `Full`). Variation
ACROSS tables in a release is legitimate drift (open-data uses short forms, FOI
sheets the long forms) and must NOT be flagged.

## Decision

1. **ATTEST the interpretation.** Emit one `@interpretation/<index>` file-level
   DERIVED claim per column, object = the inferred `{type, format}` mini-encoding
   (`date:DD/MM/YYYY`, `enumerated-category`, `callsign-token`, …), riding #434's
   `FILE_LEVEL_ORDINAL` / index-in-predicate convention beside `@column/<index>`.
   It reads out **Looked-up** (#404): the reading is resolved from our authored
   column spec, not inferred from the data.

2. **MATERIALISE it** (a considered departure from #433's reconstruct-on-read),
   justified by CARDINALITY — O(columns × sources) ≈ hundreds, not the ~18M
   per-value claims #433 refused to duplicate — and by #434's
   reconstruct-from-claims-alone contract, which needs the format inline. Store the
   MINIMUM: `{type, format}` only, NOT any canonical mapping (that is the
   licence-category tier's job) and NOT the parsed values. The per-row parse still
   reconstructs on read.

3. **SINGLE SOURCE OF TRUTH stays the code.** `interpretColumns(source)` is the one
   accessor the emit path and the self-checks both read; the lift itself is
   single-sourced in each loader lane (`interpretOpenDataColumns` over the variant
   mapping + `DATE_COLUMNS`; `interpretFoiColumns` over `FoiColumnSpec.kind`), and
   the loader stores the result on the `SourceObservationSet`. A drift oracle
   forbids the stored value from disagreeing with the code.

4. **FLAG within-table inconsistency** via within-source passes (the #429
   collision-pass shape), emitted as file-level DERIVED flag claims
   (`@column-flag/<index>`, **Computed**), review candidates NEVER auto-corrections:
   - `within-table-date-format-mixing` — a date column whose raw values require
     more than one ordering/shape to all parse. Per the messy-external-sources
     reality this is a LOUD, VISIBLE flag that marks the column's date
     interpretation doubtful; it does NOT hard-crash the build (a hard block would
     freeze the pipeline — "hard, not impossible"). Genuine parse FAILURES stay
     fatal in the strict converter, which is unchanged; this observational pass
     reads the raw cells and never throws.
   - `within-table-normalisation-collision` — two distinct raw values collapsing to
     one canonical inside ONE table. The flag's OBJECT names the canonical it flags;
     the colliding raw values reconstruct on read (`explainColumnFlag`, reusing
     #433's `Working`). Parameterised over `(column, canonicaliseFn)`, so a future
     status canonicalisation answers the allocated-vs-live question the same way.

5. **WITHIN-TABLE ONLY, enforced structurally:** each pass consumes exactly one
   `SourceObservationSet` and builds its candidate set from `source.rows` alone, so
   cross-file variation is never in scope. A positive scope-guard self-check asserts
   two forms in SEPARATE tables raise nothing while both in ONE table do.

6. **#404 grounding.** A file-level DERIVED claim grounds in the raw `@column/<i>`
   basis for the SAME file (extend `checkNoInflationClaims` for `isFileLevelClaim`),
   not in an observation subject — its `rawSubject` is `''` on the sentinel ordinal.
   The observation stream is untouched: no per-row claim/field/byte is added.

7. **SELF-CHECKED (a committed oracle family):** the attested format re-parses the
   whole column (load-bearing); no claim/code drift; flags are reproducible and
   complete; the within-table scope guard holds; the observation multiset is
   unchanged.

## Consequences

- A reader sees the format we parsed each column under, links to the header byte,
  and can re-verify it re-parses the column; a claims-only reconstruction has the
  format it needs.
- The interpretation stays single-sourced in the loaders; the claim cannot rot (the
  drift oracle).
- Within-table inconsistencies become visible review candidates without silent
  collapse or loss of the fail-loud guarantee for a true parse failure. The
  date-mixing pass surfaces nothing on the committed corpus (the strict
  converter rejects mixed dates at intake), but the normalisation-collision
  pass has since earned its keep on real data: the 2024-09 register snapshot
  genuinely mixes raw product spellings that fold to one special-event licence
  category, and the oracle surfaces both column flags rather than swallowing
  them — pinned as the expected corpus finding in
  `interpretation-oracle.test.ts`, so any change to that list documents the
  surprise. The detectors are proven by constructed fixtures either way, and a
  future mixed snapshot becomes visible data rather than a silent pass.
- Additive: no observation-claim/golden change; #404's observation trace is
  unaffected beyond the file-level grounding rule.
- The reader-facing surface (attested interpretation on the schema view, flags as
  review candidates, `explainColumnFlag` behind a "why?" affordance) is DEFERRED to
  a follow-up lane (P4). Partly landed since: the fidelity deep-dive
  (`fidelity.html`, built by `src/ci/build-fidelity-page.ts`) describes both
  passes and links this record. The per-file flag listing with its evidence,
  and the schema-view attestation, remain the open remainder — with #435 now
  closed, no live tracker carries them.
