# ADR 0013 — A raw-keyed claim ledger as the canonical record, everything else a derived fold

- Status: accepted; implementation in progress (strangler migration)
- Date: 2026-07-11
- Related: ADR 0001 (PR-gated in-repo processing), ADR 0002 (write controls), ADR 0003 (frameworkless site, vendored `sql.js-httpvfs`), ADR 0005 (canonical callsign forms), ADR 0006 (componentisation), ADR 0008 (offline-first PWA), ADR 0010 (archive contract), ADR 0011 (two-tier architecture), ADR 0012 (supply-chain posture); issues #361 (exploration tracker), #376 (`/data-status`)

## Context

The project's derived data has, from the start, treated each published
**snapshot as canonical**: every register export or disclosure is normalised
into a per-entry `normalised.csv` (ADR 0010), and every cross-cutting question —
how a callsign's status moved over the years, how a forbidden-suffix list
changed, how far one pool depletes into a later register — is answered by
bespoke, per-report code that reaches back across those snapshots and reasons
about time on the side.

That framing is upside-down relative to what the data actually is. The register
is not a sequence of independent tables; it is **temporal knowledge** — a stream
of observations about the same subjects, made at different times by different
publishers with differing authority. The snapshot is an *input* to that
knowledge, not its canonical form. Building each temporal or cross-dataset view
as its own generator meant the same reasoning (what is a genuine change, what is
mere vocabulary drift, what is a coverage artefact) was re-implemented, subtly
differently, in each report.

Two facts made the moment right to invert the model. First, the raw archive —
source bytes plus `sha256` plus provenance metadata — is the only irreplaceable
asset, and it is safe; every other artefact is a pure function of it (ADR 0010).
A re-derivation is therefore verifiable against a complete regression oracle (the
committed golden masters), not a leap of faith. Second, with the whole corpus now
ingested, the shapes, the scale, and the edge cases are known rather than
guessed, so the essential complexity can be separated from the accidental.

Exploratory proofs over the real corpus, recorded under the tracker, established
the thesis empirically before any production code was written:

- **The normalised CSV is a lossless fold of atomic claims.** Decomposing every
  committed `normalised.csv` into per-cell claims and re-deriving the CSV from
  the claims alone reproduced every file exactly. En route it forced four
  modelling facts into the open: source order is a *stored* fact (some sources
  are event lists, not sorted registers), bare membership needs an explicit
  existence assertion, recurring subjects need **observation** identity rather
  than subject identity, and value parsing must respect per-file quoting.
- **The temporal fold is truthful, and the payoff is large.** Folding status and
  licence class per callsign across the register vintages — comparing *canonical*
  values and treating unobserved or blank as "no evidence", not as change —
  showed that a naïve snapshot-to-snapshot diff overstates change by roughly
  sixtyfold: the overwhelming majority of apparent change is vocabulary drift,
  blanks, synonyms, and first sightings, while genuine progressions
  (Reserved → Allocated → class upgrade) are recovered cleanly.
- **Keying on the raw token recovers fidelity the normalised CSV discards.** A
  callsign that appeared to hold two conflicting statuses in one snapshot was,
  in the raw bytes, two *distinct* tokens (one carrying a non-breaking-space
  artefact) that both normalise to the same clean form. The normalised CSV keeps
  both rows but shows both as clean, discarding which was damaged; a raw-keyed
  ledger with an explicit normalisation edge carries the raw token, the rule, and
  the attributes in one artefact.

## Decision

**Invert the model: the canonical record becomes a raw-keyed claim ledger, and
every other artefact — the normalised CSV, the query databases, the reports, the
pages — becomes a derived projection over it.**

### The ledger

- **The canonical unit is an observation:** one row of one published source,
  identified by `(source_file, ordinal)`. Recurring subjects are real — a single
  snapshot can list the same callsign twice — so keying by subject would silently
  merge two distinct rows and hide a genuine finding; observation identity keeps
  them apart. Source **order** is stored as the ordinal, not reconstructed by a
  guessed sort, because some sources are event lists in source order rather than
  callsign-sorted registers.
- **Each observation carries the raw subject token verbatim** — whitespace, case,
  and encoding artefacts preserved. Normalised values genuinely collide across
  distinct raw tokens, so the raw token, never the cleaned entity, is what the
  ledger stores; the cleaned entity is *derived*.
- **Normalisation is a first-class, rule-attributed edge, never a silent
  transform:** `raw_token --normalises_to--> entity`, tagged with the named rule
  that produced it. The entity a consumer queries is the fold over the
  observations whose raw token resolves to it. The cleaning and placeholder-form
  rules are **lifted** from the existing component logic (ADR 0005, ADR 0006), not
  re-derived — a from-scratch reimplementation was shown to silently drop rules,
  which is precisely the failure the whole exercise exists to prevent.
- **Existence is itself a claim.** A single-column membership roll (a
  forbidden-suffix disclosure, an available-callsign pool) emits no attribute
  claims, so an explicit existence predicate anchors the observation; without it
  the subject would vanish from the ledger.
- **The committed canonical serialisation is JSON Lines.** *(See
  [ADR 0024](0024-ledger-serialisation-format.md) — it supplements this clause
  with the reasoning, measured evidence, and the bar an alternative must clear,
  and resolves the ambiguity in "committed": the serialisation is the one the
  project has committed TO; no `.jsonl` is committed to git, and whether it
  should be is recorded there as open.)* It is approachable,
  diffable at the claim grain (drift is a stronger signal than today's row-level
  golden), and directly loadable by the build-time query engine. A linked-data
  export (N-Quads / Turtle) is offered as a *derived*, provably-folded artefact
  for that audience; it is not the canonical or the primary published surface,
  which must remain a static, git-diffable, in-browser-queryable file under the
  hosting constraints.

### Three distinct axes (kept separate, never conflated)

A recurring source of confusion is that "tier" can mean three different things.
They are orthogonal and each has its own home:

1. **Processing progress, per dataset** — *how far a given file has been taken*
   through the pipeline: Read → Understood → Validated → Normalised → Enriched.
   This is a mechanical, per-file coverage axis, surfaced as the `/data-status`
   view (issue #376), derived at build time from real pipeline state so it can
   never drift from reality. A held-but-unreadable scan and a known-but-unfetched
   dataset are both honest, surfaced states on this axis.

2. **Source authority, per source** — *how trustworthy the publisher is*:
   Official → FOI → Reference → Community → Self. This is a property of where a
   source came from, recorded in that source's provenance metadata (`meta.json`).

3. **Claim confidence, per tuple** — *how much to trust one asserted fact*:
   As-published → Computed → Looked-up → Community → Best-guess. Confidence is not
   an independent editorial dial; it is a **read-out of source authority combined
   with production method** (a verbatim value from an official source is
   as-published; a deterministic transform of it is computed; an authoritative
   external join is looked-up; and so on). Claims are partitioned into committed
   files by this ladder — `published`, `derived`, `inferred`, `attested`,
   `speculative` — so the filesystem boundary *is* the trust boundary: verbatim
   raw facts cannot be contaminated by inference or conjecture, and speculative
   churn never touches the golden raw facts. The query engine unions the
   partitions at build time with a `tier` column, and consumers pick a threshold;
   the public default surfaces the reproducible tiers and treats attested and
   speculative content as opt-in and clearly labelled. Reproducibility is a
   gradient: the reproducible tiers are golden-master-checkable, while the
   community and speculative tiers are reviewed-and-cited content, not
   byte-reproduced. Raising a claim's declared confidence is the sensitive
   operation — it must clear the destination tier's review threshold — whereas a
   downgrade is cheap, so self-declared confidence cannot be quietly inflated.

### Storage and query — one canonical, two query lanes

An engine bench-off over the real ledger settled a deliberate split rather than a
single winner, because the workloads genuinely differ:

- **JSON Lines is the committed canonical.** Everything below is built from it.
- **SQLite serves the in-browser interactive path.** Range-read over a static
  host via the already-proven, already-vendored `sql.js-httpvfs` mechanism
  (ADR 0003, ADR 0008), it answers the lookup-shaped workload the ledger invites
  — per-callsign dossiers, temporal folds, graph traversals of raw variants — in
  sub-millisecond time on its B-tree indexes, and its engine precache is an order
  of magnitude smaller over the wire than the alternative. A compact,
  dictionary-encoded schema (provenance split off the claim, the derived layer
  reconstructed through a view rather than materialised) ships the full corpus
  well within the footprint the static host already tolerates.
- **DuckDB is used at build time.** It reads the canonical JSON Lines natively
  with no bespoke loader, folds the ledger with far cleaner window and aggregate
  SQL, powers the report folds, and emits a compact Parquet artefact as the
  bulk / analyst download lane. Its aggregate speed and expressiveness are
  captured exactly where the engine's on-disk and over-the-wire size do not
  matter. It enters CI as a pinned, checksum-verified static CLI binary — never a
  native-build npm dependency — so the supply-chain posture is unchanged
  (ADR 0012).

A full in-browser DuckDB path is deferred: its engine precache is prohibitive for
the offline-first PWA, the static host cannot send the headers its multi-threaded
build needs, and the aggregates that would justify it are already precomputed.
The published Parquet makes that a small additive step if ad-hoc in-browser
analytics ever become a first-class requirement.

### Migration — strangler, not big-bang

The rebuild proceeds alongside the existing pipeline, never as a teardown:

1. Build the ledger and its projections from the existing raw archive.
2. Re-derive today's artefacts as folds and verify them against the committed
   golden masters. The oracle is **semantic equivalence** — the same field values
   per observation, independent of incidental row order and quoting — because no
   external consumer is pinned to the current exact bytes; byte-identity is
   retained as an optional tripwire where it is cheap.
3. Retire each legacy path only once its projection reproduces the golden. The
   verified reproduction *is* the retirement gate; the working system keeps
   working throughout.

The guiding principles are raw-first / refine-later (record the raw truth, layer
derivation and inference above it), existence-recorded-even-when-unprocessable (a
held-but-unreadable source is a surfaced fact, not a silent gap), and git history
as the record of the model's own evolution.

## Consequences

- **Transparency and traceability become structural, not aspirational.** Every
  derived value carries the named rule and the observation that produced it;
  normalisation is an auditable, reversible edge rather than an overwrite; the
  confidence partitions keep raw facts physically separate from inference and
  conjecture. This is the project's priority-zero commitment made load-bearing.
- **Fidelity improves.** The raw-keyed model recovers distinctions the normalised
  CSV discarded (the whitespace- and encoding-damaged token variants behind an
  apparent single clean value), and the coverage-aware temporal fold separates
  genuine licence-state change from the large majority of apparent change that is
  drift, blanks, synonyms, and births.
- **Reports and queries stop being bespoke.** "Generate report X" and "answer
  query Y" become "fold the ledger", so the per-report reimplementation of
  temporal reasoning collapses into shared fold machinery.
- **A CI parse-once win is unlocked.** Expressing pure-relational cross-dataset
  work as a build-time engine fold, and separating "build the artefact" from
  "test the projection", removes the largest hand-rolled cross-publication join
  and much of the coverage-instrumented rebuild cost that drove the test-timeout
  history.
- **The deliberate constraints are retained, not relaxed.** The system stays
  frameworkless with no client build step, dependencies vendored and pinned, the
  published surface hosted statically, all writeback PR-gated with no third-party
  write credential (ADR 0001, ADR 0002, ADR 0003, ADR 0011, ADR 0012), and every
  external claim declared-and-attributed rather than presented as proven
  (ADR 0005). The rebuild changes the shape of the canonical record; it does not
  spend the posture that protects it.
- **Some bespokeness is essential and stays.** Per-source normalisation, the
  accumulated edge-case handling, and the raw→text extraction for binary sources
  are hard-won domain knowledge, not accidental complexity; the ledger relocates
  them into rule-attributed claim emission but does not eliminate them.

### Status of the migration

Landed at the time of writing: the typed claim model and JSON Lines / linked-data
serialisation; the stage-one build of the ledger from the raw published bytes;
the compact query schema and the build of the browser SQLite and analyst Parquet;
one real page (callsign lookup → dossier → status timeline) serving live data
end-to-end over the full corpus from the ledger; a both-engines query playground;
the reusable "fold a committed report from the claim data via DuckDB" primitive,
with DuckDB adopted in CI as a pinned binary and the first report
(cross-dataset-invariants) migrated onto it and verified against its golden; the
derived canonical licence-category tier; and extension of ledger ingestion
across all seven current source families — the FOI register snapshots, the
open-data register family, the attribute addenda, the bespoke non-callsign
families (forbidden-suffix lists, statistics aggregates, and available-pool
disclosures), and the issuance-events family (callsign-subject dated licensing
events) — each joined through a shared collector registry
(`src/v2/collectors/`) in which adding a family is adding a module plus one
registry line, so the source-family-extension pattern is now proven across the
corpus rather than on a single family. The reports-fold cutover is complete:
every report generator now folds from the raw-keyed claim ledger — the value
catalogue (licence-category and parse-derived field tables), the byte-identical
forbidden-suffix history report, and the quality reports (prefix-series,
class-product-mismatches, regional-identifiers, callsign-patterns and
data-quality) — each verified by a committed equivalence oracle, alongside the
cross-dataset-invariants report that began the cutover; the folds now read one
shared deploy-time `claims.parquet` built once per run rather than each
re-materialising the ledger, cutting the deploy cost from N-per-report to one.
And
a trust-rating safety net derives source authority and claim confidence from
provenance and fails loud on any inflation ([ADR 0014](0014-trust-rating-safety-net.md)),
making the confidence-partition model above enforceable rather than merely
declared. The T1 parse-attribute tier now emits as rule-attributed derived
claims (`prefix_series`, `implied_class`, `parse_status`, and per-row `flag`
claims from a single `parse-callsign` rule, reading out *Computed*, later
extended with `rsl` and `callsign-pattern` claims), unblocking the
parse-dependent quality-report folds. Source-position provenance is now attested
per observation — the exact CSV line or spreadsheet cell an observation came
from — with source-intrinsic facts kept rigorously distinct from
archive/processing artefacts ([ADR 0015](0015-source-intrinsic-vs-archive-provenance.md)).
A committed reconstruction oracle now rebuilds every text source — 44 across the
open-data, FOI-CSV, addendum and FOI free-text lanes (markdown-table, preamble,
prefixed-suffix) — from claims alone, byte-identical modulo cosmetic
quoting/line-ending differences, with the verbatim as-published header attested
as a file-level claim
([ADR 0016](0016-file-level-claims-and-reconstruction-oracle.md)). For the CSV
lanes this proves the *main ledger's* raw layer canonical, not merely asserted.
For the 13 FOI free-text sources, however, the lossless projection is currently
built by the oracle alone rather than promoted into the main ledger (whose
claims for these sources remain lossy), so the oracle mirror — not the ledger —
is canonical for them today; closing that gap against the inversion premise is
tracked in [#455](https://github.com/MysterAitch/amateur-callsigns-file-watch/issues/455).
Every derived claim can now show its working — the input claims, their source
positions, and the named rule that produced it — reconstructed on read
([ADR 0017](0017-show-the-working-behind-derived-claims.md)), guarded by a
fail-loud self-check oracle which already earned its keep by forcing a
completeness gap into the open: a callsign-pattern rule the design's own
inventory had missed. Each column's inferred interpretation (`{type, format}`)
is now itself attested as a *Looked-up* file-level claim, and within-table
date-format mixing and normalisation collisions are surfaced as loud,
non-fatal doubt flags — cross-file terminology drift stays data, not a defect
([ADR 0018](0018-attest-column-interpretation-and-within-table-flags.md)).

With this, the fidelity **emit** foundation is complete: the ledger attests
source position (ADR 0015), attests file structure and reconstructs all 44 text
sources (ADR 0016), explains every derived claim (ADR 0017), and attests column
interpretation with within-table integrity flags (ADR 0018). The next arc —
surfacing that fidelity to readers inline and in linked deep-dive pages
([#438](https://github.com/MysterAitch/amateur-callsigns-file-watch/issues/438),
[#439](https://github.com/MysterAitch/amateur-callsigns-file-watch/issues/439))
— has begun: the first increment landed a fidelity and integrity deep-dive
(`fidelity.html`) reachable by inline nudges from the highest-traffic generated
surfaces, with the ADR 0017 "show the working" disclosure wired into a real
generated page end to end
([#601](https://github.com/MysterAitch/amateur-callsigns-file-watch/pull/601));
the remaining surfaces continue under #438.

Remaining: the reviewed canonical vocabularies and coverage-aware gating the
temporal fold depends on; the continued onboarding through the registry of
heterogeneous sources still pending intake (tracked in
`docs/source-register.md`); and retirement of the legacy snapshot-canonical
flow — every report now folds, and the interactive query surfaces (lookup,
comparison, entry browser, Explore) have been repointed onto ledger-derived
projection databases folded from the claim ledger, verified against the legacy
databases by a full-corpus parity oracle
([#572](https://github.com/MysterAitch/amateur-callsigns-file-watch/issues/572));
the deploy-time builders, validation's derived-file read, the report lane and
the download tiers all read derived views through one explicit
archive/projection switch, gated by a full-corpus byte-parity oracle
([#629](https://github.com/MysterAitch/amateur-callsigns-file-watch/issues/629));
and the derivation sweep itself is retired
([#446](https://github.com/MysterAitch/amateur-callsigns-file-watch/issues/446),
[ADR 0021](0021-frozen-derived-baseline.md)) — the committed golden derivatives
are deliberately retained as the durable comparison baseline, frozen at
retirement and pinned entry by entry by the parity gate, while a new
publication's derived views fold from its raw bytes in the ledger projection
with no derivation step at all.
