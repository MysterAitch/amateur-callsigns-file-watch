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

<table>
  <thead>
    <tr>
      <th>ADR</th>
      <th>Decision</th>
      <th>What would reverse it</th>
      <th>Status</th>
      <th>Date</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><a href="0001-post-fetch-processing-in-repo.md">ADR 0001</a></td>
      <td>Post-fetch processing runs in this repository via scheduled, PR-gated GitHub Actions</td>
      <td>Processing outgrows the Actions runner, or a write path wider than opening pull requests becomes unavoidable</td>
      <td>accepted</td>
      <td>2026-07-06</td>
    </tr>
    <tr>
      <td><a href="0002-repo-level-write-controls.md">ADR 0002</a></td>
      <td>Repository-level write controls live in GitHub settings</td>
      <td>Moving off GitHub, or GitHub changing its settings model. <strong>This record must be edited whenever the settings change</strong> — it is their only source of truth, so it goes stale silently</td>
      <td>accepted</td>
      <td>2026-07-06</td>
    </tr>
    <tr>
      <td><a href="0003-in-repo-presentation-poc.md">ADR 0003</a></td>
      <td>In-repo presentation proof of concept (GitHub Pages + published SQLite)</td>
      <td>Largely overtaken already: amended 2026-07-16, and <a href="0020-sharded-static-json-serving.md">ADR 0020</a> took the single-callsign path off this one. Reverses fully if the site outgrows frameworkless static hosting</td>
      <td>accepted</td>
      <td>2026-07-07</td>
    </tr>
    <tr>
      <td><a href="0004-foi-source-lane.md">ADR 0004</a></td>
      <td>FOI source lane — request-keyed entries, data optional, correspondence always</td>
      <td>A source that is neither request-keyed nor date-keyed, so neither lane can hold it without a split rule</td>
      <td>accepted</td>
      <td>2026-07-07</td>
    </tr>
    <tr>
      <td><a href="0005-canonical-callsign-forms.md">ADR 0005</a></td>
      <td>Canonical callsign forms (<code>cleaned</code> / <code>placeholder_form</code>) as the join strategy</td>
      <td>A callsign family that neither <code>cleaned</code> nor <code>placeholder_form</code> can unify — the two forms are unifiers, not identity claims, so a family needing a third would force the question</td>
      <td>accepted</td>
      <td>2026-07-09</td>
    </tr>
    <tr>
      <td><a href="0006-componentisation-strategy.md">ADR 0006</a></td>
      <td>Reusable UI modules via native Web Components, not a framework</td>
      <td>Only a need for framework reactivity/DX strong enough to overturn the supply-chain posture (<a href="0012-supply-chain-posture.md">ADR 0012</a>, <a href="0003-in-repo-presentation-poc.md">ADR 0003</a>) — and that requires its own ADR. Open questions settled and the default mechanism revised by <a href="0022-v1-component-architecture.md">ADR 0022</a>: registry-dispatched JSDoc modules, with custom elements reserved for genuine lifecycle needs</td>
      <td>proposed</td>
      <td>2026-07-09</td>
    </tr>
    <tr>
      <td><a href="0007-coverage-dashboard-placement.md">ADR 0007</a></td>
      <td>Publish the coverage dashboard as a site page, keep a workflow alarm</td>
      <td>A drift signal that a static page cannot carry, since a page cannot itself go red — the workflow alarm exists for exactly that gap</td>
      <td>proposed (not implemented; the dashboard remains the title-keyed issue)</td>
      <td>2026-07-09</td>
    </tr>
    <tr>
      <td><a href="0008-offline-first-pwa.md">ADR 0008</a></td>
      <td>Offline-first progressive web app with opt-in full-database download</td>
      <td>Database size or the Range-from-cache memory cost making an offline copy impractical on a normal device</td>
      <td>accepted</td>
      <td>2026-07-09</td>
    </tr>
    <tr>
      <td><a href="0009-data-landing-via-branches-and-sweep.md">ADR 0009</a></td>
      <td>Raw data lands on <code>main</code> via <code>data/*</code> branches and a scheduled sweep</td>
      <td>The fetch host needing a write path beyond <code>data/*</code> branches, or a legitimate diff the path allowlist cannot express</td>
      <td>accepted</td>
      <td>2026-07-10</td>
    </tr>
    <tr>
      <td><a href="0010-archive-contract.md">ADR 0010</a></td>
      <td>The archive contract: raw bytes verbatim, keyed, provenanced, accepted before processability</td>
      <td><strong>Effectively nothing.</strong> The verbatim-bytes guarantee and its <code>.gitattributes</code> binary markings are a hard invariant that idempotence and reconstruction both rest on, not a preference to be traded</td>
      <td>accepted</td>
      <td>2026-07-10</td>
    </tr>
    <tr>
      <td><a href="0011-two-tier-architecture.md">ADR 0011</a></td>
      <td>Two-tier architecture: a minimal residential fetch host, everything else in-repo</td>
      <td>A second fetch host (the split earns its keep at N=1; N≥2 reopens shared configuration management), or fetching ceasing to need a residential IP</td>
      <td>accepted</td>
      <td>2026-07-10</td>
    </tr>
    <tr>
      <td><a href="0012-supply-chain-posture.md">ADR 0012</a></td>
      <td>Supply-chain posture: a minimal, auditable dependency and write surface</td>
      <td>A genuinely required capability that neither the JS ecosystem nor a scripted, version-pinned external engine can supply. Probed and held on #979: the PDF-tooling evaluation ended in pinned script engines, not a relaxed posture — the tool choice itself stays open on the issue</td>
      <td>accepted</td>
      <td>2026-07-10</td>
    </tr>
    <tr>
      <td><a href="0013-raw-keyed-claim-ledger.md">ADR 0013</a></td>
      <td>A raw-keyed claim ledger as the canonical record, everything else a derived fold</td>
      <td>Foundational — too situational for one line. The FOI lane has not made this crossing (its text sources are ledger-lossy, with a parallel oracle mirror standing in); see the record and <a href="0021-frozen-derived-baseline.md">ADR 0021</a></td>
      <td>accepted (open-data migration complete; FOI lane tracked on #455)</td>
      <td>2026-07-11</td>
    </tr>
    <tr>
      <td><a href="0014-trust-rating-safety-net.md">ADR 0014</a></td>
      <td>The trust-rating model, derived from provenance and guarded against inflation</td>
      <td>A legitimate case where trust must <em>increase</em> through derivation — the committed checks deliberately make that fail loud, so it cannot happen quietly</td>
      <td>accepted</td>
      <td>2026-07-12</td>
    </tr>
    <tr>
      <td><a href="0015-source-intrinsic-vs-archive-provenance.md">ADR 0015</a></td>
      <td>Source-intrinsic vs archive/processing provenance, with the filesystem-stat origin made unrepresentable</td>
      <td>A fact that is genuinely both source-intrinsic and archive-side, which the predicate-namespace split cannot express</td>
      <td>accepted</td>
      <td>2026-07-12</td>
    </tr>
    <tr>
      <td><a href="0016-file-level-claims-and-reconstruction-oracle.md">ADR 0016</a></td>
      <td>File-level claims (sentinel ordinal, <code>@column</code>/<code>@subject</code>/<code>@ignored</code>) and the reconstruction oracle</td>
      <td>A lane whose sources cannot be reconstructed from claims. Already partly live: the FOI text lanes are ledger-lossy and carry an honest residual rather than a clean oracle</td>
      <td>accepted</td>
      <td>2026-07-12</td>
    </tr>
    <tr>
      <td><a href="0017-show-the-working-behind-derived-claims.md">ADR 0017</a></td>
      <td>Show the working behind derived claims by reconstructing it on read, with a self-checking oracle</td>
      <td>Recomputation cost outgrowing the cost of storing the working — the decision rests on <code>explain()</code> being cheap enough to run on demand</td>
      <td>accepted</td>
      <td>2026-07-12</td>
    </tr>
    <tr>
      <td><a href="0018-attest-column-interpretation-and-within-table-flags.md">ADR 0018</a></td>
      <td>Attest each column's inferred <code>{type, format}</code> as a derived file-level claim, and flag within-table date-format mixing / normalisation collisions</td>
      <td>Column-type inference becoming unreliable enough that formats must be declared rather than inferred and attested</td>
      <td>proposed</td>
      <td>2026-07-12</td>
    </tr>
    <tr>
      <td><a href="0019-layered-build-cache-and-unified-cicd.md">ADR 0019</a></td>
      <td>Layered, content-addressed build cache with a stepped deploy fallback, and a unified <code>cicd.yaml</code> gating deploy on <code>main</code></td>
      <td>Too situational for one line — the live tension is that narrowing a cache closure risks a stale-artefact false hit, which is worse than a false miss. See the record and <a href="../ci-cache-behaviour.md"><code>../ci-cache-behaviour.md</code></a></td>
      <td>accepted</td>
      <td>2026-07-14</td>
    </tr>
    <tr>
      <td><a href="0020-sharded-static-json-serving.md">ADR 0020</a></td>
      <td>Sharded static JSON as the serving projection for the single-callsign intent — no database on that path</td>
      <td>Shard count or size outgrowing static hosting, or the single-callsign intent needing a query static JSON cannot answer</td>
      <td>accepted</td>
      <td>2026-07-16</td>
    </tr>
    <tr>
      <td><a href="0021-frozen-derived-baseline.md">ADR 0021</a></td>
      <td>Freeze the committed derived baseline; the ledger projection is the derivation lane (the #446 retirement)</td>
      <td>A consumer needing live re-derivation of a publication from before the freeze</td>
      <td>accepted</td>
      <td>2026-07-17</td>
    </tr>
    <tr>
      <td><a href="0022-v1-component-architecture.md">ADR 0022</a></td>
      <td>The v1 UI component architecture: frameworkless JSDoc-typed modules, DOM-construction rendering, one implementation across build and browser</td>
      <td>Too situational for one line — reverses if the one-shot progressive-enhancement model cannot express a required interaction. See the record</td>
      <td>accepted</td>
      <td>2026-07-24</td>
    </tr>
    <tr>
      <td><a href="0023-fold-resource-tuning-by-measurement.md">ADR 0023</a></td>
      <td>Report-fold resource tuning is settled by controlled measurement; no lever survives without evidence</td>
      <td>Not reversible as such: it is a method, not a setting. The individual <strong>pins</strong> it produced are expected to be revisited on a corpus, Node or runner change</td>
      <td>accepted</td>
      <td>2026-07-28</td>
    </tr>
    <tr>
      <td><a href="0024-ledger-serialisation-format.md">ADR 0024</a></td>
      <td>JSON Lines is the ledger serialisation; records the four load-bearing properties, the measured bar an alternative must clear, and why TSV looks viable but is blocked</td>
      <td>Seven explicit triggers, too many for one line — see <a href="0024-ledger-serialisation-format.md">the record's "Revisit when" section</a></td>
      <td>accepted</td>
      <td>2026-07-29</td>
    </tr>
  </tbody>
</table>

## What goes where — narrative, state of play, and decision

These three are routinely conflated, and the symptom is always the same: an ADR
that reads like a diary, or an issue whose current state can only be recovered by
reading forty comments in order. They are different **tenses**, written for
different readers.

| surface | tense | its job | the reader |
|---|---|---|---|---|
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
