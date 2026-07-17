# ADR 0021 — Freeze the committed derived baseline; the ledger projection is the derivation lane

- Status: accepted
- Date: 2026-07-17
- Related: ADR 0001 (post-fetch processing in-repo — the derivation sweep this retires), ADR 0010 (archive contract), ADR 0013 (raw-keyed claim ledger — the inversion this completes a step of), ADR 0019 (deploy assembly hosting the projection build); issues #446 (the retirement this records), #629 (the consumer migration that gated it), #443 (the retirement-readiness tracker), #445/#613 (the precedent: the legacy runtime databases retired once the projection gate held); PRs #674/#676/#677 (projection, consumer repoint, last consumers + the new-publication lane)

## Context

Since ADR 0001, a scheduled sweep derived each open-data publication's
canonical views — `normalised.csv`, `components.csv`, `stats.json` — from its
raw bytes via the authored converter, and committed them beside the raw file.
Every consumer read those committed files; golden-master semantics (byte-
identical re-runs are no-ops) kept them honest.

ADR 0013 inverted the canonical record: the raw-keyed claim ledger is
canonical, and every published table is a fold over it. By #629, a
builder-facing projection folds the SAME three files per entry from the
ledger, proven **byte-identical to the committed files, entry by entry, for
the whole corpus** by a standing parity gate; every deploy-time consumer, the
report lane, the download tiers and the golden-master gate read derived views
through one explicit switch (`src/shared/derived-entries.ts`); and a freshly
fetched publication resolves its authored header binding from its own header
row, so the projection covers it with no curation and no derivation step
(PR #677).

At that point the derivation sweep regenerated files nothing needed
regenerated, and its writeback PR lane was pure ceremony. The question was
never whether to delete the committed files — ADR 0013 deliberately retains
them — but what their standing IS once nothing regenerates them.

## Decision

1. **The derivation lane retires (#446).** The normalise sweep's derivation
   half — converter dispatch, per-entry writeback of the three derived files,
   the `meta.json` normalisation declarations and the `latest-meta.json`
   mirror refresh — is deleted. The scheduled workflow converts to a **report
   sweep** (`reports-sweep.yml`, `src/ci/report-sweep.ts`): it regenerates the
   committed standing reports under `reports/` from the ledger projection and
   writes back `reports/` alone.
2. **The committed derived files freeze as the equivalence baseline.** Every
   pre-freeze publication keeps its committed `normalised.csv`,
   `components.csv` and `stats.json` exactly as derived — pinned entry by
   entry in the parity gate (`FROZEN_BASELINE_KEYS`), which continues to
   byte-compare the projection against them on every CI run. They are the
   durable proof that two independent derivation paths — the authored
   converter lane that wrote them, and the claim-ledger fold — agree
   byte-for-byte, and the standing regression oracle for the fold's code.
3. **Post-freeze publications are projection-only.** A new entry commits raw
   bytes and curated meta only. Its derived views exist wherever a build folds
   them; nothing derived is committed for it, and `meta.json` never gains a
   `normalised` block. The fetch lane, the data sweep and validation are
   untouched.
4. **What "golden" means per artefact from here on:**
   - *Committed derived per-entry files*: a frozen baseline — never
     regenerated, never extended, protected against deletion and against
     divergence from the projection by the parity gate. Removal (if ever) is
     a separate decision; ADR 0013's retention stands.
   - *Committed reports under `reports/`*: live golden masters, regenerated
     deterministically by the report sweep (projection-fed) and drift-gated
     per-PR by the golden-master job — unchanged semantics, new producer.
   - *FOI committed derivatives* (`normalised--*.csv`, extracts): unchanged —
     still committed, still regenerated in reviewed PRs, still byte-verified
     (the #445/#447 chain owns their future).
5. **Protection converts, it does not die.** The retired derivation's
   verification value lives on as: the parity gate over the frozen baseline;
   the projection invariant suite and the reconstruction/interpretation
   oracles (which enumerate the archive dynamically, so a new entry is
   covered the moment it lands); the new-publication lane tests (header-row
   binding resolution, loud refusal of unknown and twin shapes); and the
   line accounting proven inside the ledger emit's own parse.

## Consequences

- A new publication reaches every surface — interactive, reports, download
  tiers, status grids — with **zero derivation latency**: no daily sweep PR
  between landing and visibility, and the auto-merge lane never waits on a
  derivation.
- The archive's byte-growth per publication drops to the raw file + meta
  (~19 MB of derived files per entry no longer accrue).
- Consumers must never assume a committed derived file exists for an
  arbitrary entry: reads go through the switch, presence questions through
  `derivedEntryFileExists`/`derivedEntryFileNamesPresent`. The frozen
  baseline makes archive-mode reads complete only for pre-freeze entries —
  the report sweep and golden gate therefore always run projection-fed.
- The committed history of derived files ends at the freeze; the projection
  (rebuildable at any commit) supplies equivalent views thereafter. The
  reviewable diff for a new publication's DERIVED content moves from the
  derivation PR to the report sweep's PR (aggregate views) and the site's
  published surfaces.
- The `normalised.headerVariant` declaration stops accruing; the authored
  binding for post-freeze entries is resolved from the publication's own
  header row and cross-checked against any curated declaration (PR #677) —
  a forced `converter.variant` remains the curation point for twin shapes.
