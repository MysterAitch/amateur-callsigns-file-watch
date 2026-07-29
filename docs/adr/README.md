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
| [0022](0022-v1-component-architecture.md) | The v1 UI component architecture: frameworkless JSDoc-typed modules, DOM-construction rendering, one implementation across build and browser | accepted | 2026-07-24 |
| [0023](0023-fold-resource-tuning-by-measurement.md) | Report-fold resource tuning is settled by controlled measurement; no lever survives without evidence | accepted | 2026-07-28 |
| [0024](0024-ledger-serialisation-format.md) | JSON Lines is the ledger serialisation; records the four load-bearing properties, the measured bar an alternative must clear, and why TSV looks viable but is blocked | accepted | 2026-07-29 |

## What goes where — narrative, state of play, and decision

These three are routinely conflated, and the symptom is always the same: an ADR
that reads like a diary, or an issue whose current state can only be recovered by
reading forty comments in order. They are different **tenses**, written for
different readers.

| surface | tense | its job | the reader |
|---|---|---|---|
| **Issue comments** | past, append-only | narrative as it happened — what was tried, what was measured, what was wrong and how we knew | someone reconstructing how we got here |
| **Issue body** | present, curated, rewritten in place | state of play — what is true *now*, what is next, links to the load-bearing comments | someone joining or resuming |
| **ADR** | perpetual present | the decision, why it was taken, what it costs, and what would reverse it | someone about to change something |
| **This index** | perpetual present, one line | routing — enough to judge relevance *without* opening the record | someone who does not yet know where to look |

Three rules follow, and each exists because the alternative has bitten:

1. **A curated summary belongs in the issue BODY, never in a comment.** Comments
   are append-only narrative; a summary posted as a comment is stale the moment
   the next comment lands, and cannot be corrected without hiding history. The
   body is the only surface that can be edited into truth. Keep the original ask
   at the top and a dated *"where this has got to"* at the bottom, linking to the
   key comments rather than restating them.
2. **An ADR must be readable with no knowledge of its issue**, and an issue must
   not need its ADR to make sense as history. Overlap between them is expected and
   fine — they are the same facts in different tenses. What is not fine is an ADR
   carrying narrative ("we first tried X, then Y") or an issue carrying the
   authoritative decision.
3. **An ADR absorbs from the issue only what a future changer needs**: the
   decision, the reasoning, the measured evidence, the cost, and the conditions
   that would reverse it. The rest stays as narrative and is linked, not copied.

### On the quality of an index row

Completeness is machine-checkable and is checked (`src/ci/adr-index.test.ts`).
**Accuracy is not.** A row can be present, correctly linked, status-matched — and
still overstate the decision, omit the constraint that makes it load-bearing, or
state a conclusion while dropping the downstream effect that makes it matter.

That is the same bar this project applies to its public claims, turned inward, and
it needs a reader rather than a rule. Treat a row as an assertion requiring
evidence: *does it say what the record actually decided, and what followed from
it?* When a row is written or a decision changes, re-read the record against it.
The structural tests below make the mechanical failures impossible so that review
attention is spent where only judgement works.

## Decisions recorded outside the ADR set

Not every durable decision is an ADR. Some are operational findings, some are
campaign histories, and some are constraints best stated next to the code they
constrain. They are indexed here because the alternative — discovering them by
grepping — is how a settled question gets relitigated.

Each entry names **where the decision lives** and, where one exists, **what stops
it silently going stale**. A pointer without enforcement is a claim about the
past; a pointer with a test beside it is a claim about the present.

| decision / finding | where it lives | what enforces it |
|---|---|---|
| **Claim-ledger delivery** — migration maps, oracle milestones, phase coherence | issue #361 (closed) | superseded by the ADRs it produced (0013, 0016, 0017, 0018, 0024) |
| **CI/CD performance, longitudinally** — the ~39 min → 5.2 min campaign, what moved the needle and what did not | issue #929 (open tracker) | `perf-matrix.yml`, re-run on Node / vitest / corpus / runner change |
| **Granular rebuild** — why splitting is worth pursuing independently of committing, and why dirty-detection is the hard half | issue #994 | — (open direction, not yet built) |
| **Cache behaviour and merge cadence** — cache state is a vector, not a hit/miss flag; N merges in a row cost N cold runs | [`../ci-cache-behaviour.md`](../ci-cache-behaviour.md) | `cicd-workflow-structure.test.ts` pins the cache keys and required-check names |
| **Measurement traps** — the five ways a performance reading misleads, including bundled levers | [`../perf-profiling.md`](../perf-profiling.md) | ADR 0023; the benchmark arms in `bench-suite.ts` |
| **SQLite needs `ANALYZE` at build time** — without it point lookups mis-plan onto a scan (300 ms–3.6 s versus sub-millisecond) | `src/v2/build-ledger-db.ts` header | `QueryPlanner_AfterAnalyze_…` in `build-ledger-db.test.ts` and the compact variant |
| **The ledger must not be stageable** — a local build writes ~12.7 GiB inside the working tree | `.gitignore` (`_build/`), ADR 0024 | `ledger-output-hygiene.test.ts`, which derives the path from the CLI |
| **Every test declares a kind tag** — `unit` / `ui` / `data-validity`, so nothing is silently mis-tiered | [`../../src/testing/test-taxonomy.test.ts`](../../src/testing/test-taxonomy.test.ts) | the file is itself the enforcement; exemptions are explicit and retirable |
| **Compression is a publish responsibility, never a verify one** — CI builds raw; the deploy publishes compressed | ADR 0023, ADR 0024 | separate cache scopes for build and publish paths |

## Related documentation

- [`../normalised-schema.md`](../normalised-schema.md) — the open-data lane's normalised schema and line-accounting contract (governed by ADR 0001, ADR 0010; recast as a ledger fold under ADR 0013, frozen as an equivalence baseline under ADR 0021).
- [`../foi-schemas.md`](../foi-schemas.md) — generated FOI schema registry (ADR 0004).
- [`../source-register.md`](../source-register.md) — cross-lane index of every known source and its intake status.
- [`../dataset-status.md`](../dataset-status.md) — generated per-dataset overview of what exists.
- [`../../README.md`](../../README.md) — project overview and deployment guide.
