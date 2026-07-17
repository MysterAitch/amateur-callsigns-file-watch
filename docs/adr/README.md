# Architecture decision records

Each ADR records one architectural decision — its context, the decision, and
the consequences — as a dated, append-only entry. Accepted ADRs describe the
system as it is built (or is being built); `proposed` ADRs are recorded for
discussion and are not yet ratified. Superseding or amending a decision is done
by a later ADR that references the earlier one, never by rewriting history.

The **canonical-record model's open-data-lane migration is complete**:
[ADR 0013](0013-raw-keyed-claim-ledger.md) inverts the pipeline to a
raw-keyed claim ledger, from which the normalised CSV, query databases,
reports and pages all become derived folds. It is accepted, and for the
open-data lane the strangler migration finished at
[ADR 0021](0021-frozen-derived-baseline.md)'s freeze: the derivation sweep is
retired, and the snapshot-canonical flow the earlier ADRs (notably
[0001](0001-post-fetch-processing-in-repo.md) and
[0010](0010-archive-contract.md)) describe now stands as a frozen equivalence
baseline that every consumer reads alongside the ledger projection, not a
still-running lane. The FOI lane has not made the same crossing — its text
sources are ledger-lossy, with a parallel oracle mirror standing in as their
lossless canonical record instead — tracked on #455. The two trust axes that model
surfaces — source authority and claim confidence — are derived from provenance
and guarded against inflation by [ADR 0014](0014-trust-rating-safety-net.md), the
enforcement companion to 0013's confidence model; and [ADR 0015](0015-source-intrinsic-vs-archive-provenance.md)
keeps source-intrinsic provenance rigorously distinct from archive/processing
artefacts (a filesystem-stat origin is made unrepresentable, not merely
discouraged); and [ADR 0016](0016-file-level-claims-and-reconstruction-oracle.md)
adds the file-level-claim convention and a reconstruction oracle that rebuilds
the CSV-lane text sources from their claims alone; and [ADR 0017](0017-show-the-working-behind-derived-claims.md)
reconstructs on read the working behind every derived claim (its inputs, source
positions and rule); and [ADR 0018](0018-attest-column-interpretation-and-within-table-flags.md)
attests each column's inferred `{type, format}` as a file-level claim and flags
within-table date-format mixing and normalisation collisions as loud,
non-fatal doubt. ADR 0015 through ADR 0018 are the fidelity infrastructure of
the #431 programme.

| ADR | Decision | Status | Date |
|---|---|---|---|
| [0001](0001-post-fetch-processing-in-repo.md) | Post-fetch processing runs in this repository via scheduled, PR-gated GitHub Actions | accepted | 2026-07-06 |
| [0002](0002-repo-level-write-controls.md) | Repository-level write controls live in GitHub settings | accepted | 2026-07-06 |
| [0003](0003-in-repo-presentation-poc.md) | In-repo presentation proof of concept (GitHub Pages + published SQLite) | accepted | 2026-07-07 |
| [0004](0004-foi-source-lane.md) | FOI source lane — request-keyed entries, data optional, correspondence always | accepted | 2026-07-07 |
| [0005](0005-canonical-callsign-forms.md) | Canonical callsign forms (`cleaned` / `placeholder_form`) as the join strategy | accepted | 2026-07-09 |
| [0006](0006-componentisation-strategy.md) | Reusable UI modules via native Web Components, not a framework | proposed | 2026-07-09 |
| [0007](0007-coverage-dashboard-placement.md) | Publish the coverage dashboard as a site page, keep a workflow alarm | proposed | 2026-07-09 |
| [0008](0008-offline-first-pwa.md) | Offline-first progressive web app with opt-in full-database download | accepted | 2026-07-09 |
| [0009](0009-data-landing-via-branches-and-sweep.md) | Raw data lands on `main` via `data/*` branches and a scheduled sweep | accepted | 2026-07-10 |
| [0010](0010-archive-contract.md) | The archive contract: raw bytes verbatim, keyed, provenanced, accepted before processability | accepted | 2026-07-10 |
| [0011](0011-two-tier-architecture.md) | Two-tier architecture: a minimal residential fetch host, everything else in-repo | accepted | 2026-07-10 |
| [0012](0012-supply-chain-posture.md) | Supply-chain posture: a minimal, auditable dependency and write surface | accepted | 2026-07-10 |
| [0013](0013-raw-keyed-claim-ledger.md) | A raw-keyed claim ledger as the canonical record, everything else a derived fold | accepted (open-data migration complete; FOI lane tracked on #455) | 2026-07-11 |
| [0014](0014-trust-rating-safety-net.md) | The trust-rating model, derived from provenance and guarded against inflation | accepted | 2026-07-12 |
| [0015](0015-source-intrinsic-vs-archive-provenance.md) | Source-intrinsic vs archive/processing provenance, with the filesystem-stat origin made unrepresentable | accepted | 2026-07-12 |
| [0016](0016-file-level-claims-and-reconstruction-oracle.md) | File-level claims (sentinel ordinal, `@column`/`@subject`/`@ignored`) and the reconstruction oracle | accepted | 2026-07-12 |
| [0017](0017-show-the-working-behind-derived-claims.md) | Show the working behind derived claims by reconstructing it on read, with a self-checking oracle | accepted | 2026-07-12 |
| [0018](0018-attest-column-interpretation-and-within-table-flags.md) | Attest each column's inferred `{type, format}` as a derived file-level claim, and flag within-table date-format mixing / normalisation collisions | proposed | 2026-07-12 |
| [0019](0019-layered-build-cache-and-unified-cicd.md) | Layered, content-addressed build cache with a stepped deploy fallback, and a unified `cicd.yaml` gating deploy on `main` | accepted | 2026-07-14 |
| [0020](0020-sharded-static-json-serving.md) | Sharded static JSON as the serving projection for the single-callsign intent — no database on that path | accepted | 2026-07-16 |
| [0021](0021-frozen-derived-baseline.md) | Freeze the committed derived baseline; the ledger projection is the derivation lane (the #446 retirement) | accepted | 2026-07-17 |

## Related documentation

- [`../normalised-schema.md`](../normalised-schema.md) — the open-data lane's normalised schema and line-accounting contract (governed by ADR 0001, ADR 0010; recast as a ledger fold under ADR 0013, frozen as an equivalence baseline under ADR 0021).
- [`../foi-schemas.md`](../foi-schemas.md) — generated FOI schema registry (ADR 0004).
- [`../source-register.md`](../source-register.md) — cross-lane index of every known source and its intake status.
- [`../dataset-status.md`](../dataset-status.md) — generated per-dataset overview of what exists.
- [`../../README.md`](../../README.md) — project overview and deployment guide.
