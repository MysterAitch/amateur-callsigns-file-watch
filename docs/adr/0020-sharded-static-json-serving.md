# ADR 0020 — Sharded static JSON as the serving projection for the single-callsign intent

- Status: accepted
- Date: 2026-07-16
- Related: ADR 0003 (the in-repo presentation PoC and its published SQLite — the path this departs from), ADR 0008 (offline-first PWA over that SQLite), ADR 0013 (raw-keyed claim ledger — the shards are one of its derived projections), ADR 0019 (deploy assembly / build-vs-publish split that hosts this build); issues #594 (the instant per-callsign page), #572 (interactive surfaces repointed onto ledger-derived projection databases), #475 (in-browser database cold-load cost), #361 (ledger exploration tracker), #438 (surfacing fidelity to readers); PRs #602 (the build and the page), #612 (the live anatomy figure on it)

## Context

Resolving **one** callsign — typing a callsign and asking "what does the record
say about this?" — is the site's most common entry intent. Under the presentation
model of [ADR 0003](0003-in-repo-presentation-poc.md), every path that could
answer it rode the in-browser SQLite database: the worker starts, `sql.js-httpvfs`
range-reads the published file, and only then can a query run. That machinery is
the right tool for the workloads it was chosen for — reference joins, the suffix
availability matrix, temporal folds, raw-byte provenance traversals — but for a
single-callsign answer it is enormously overproportioned. Cold opens of that path
were measured at roughly **20–30 seconds** on GitHub Pages (issue #475, 2026-07),
dominated by worker start-up and the first range reads, for a result that is a few
hundred bytes of data. (#475 has since been closed — chunked serving cut the
cold-open cost on the database path — but that reduces, not removes, machinery the
single-callsign intent never needed; the decision does not rest on the worst-case
figure remaining current.)

Two shifts made a different serving shape both possible and consistent with the
project's direction. First, [ADR 0013](0013-raw-keyed-claim-ledger.md) inverted the
canonical model: the raw-keyed claim ledger is the record, and the normalised CSV,
the query databases, the reports and the pages are all **derived projections** over
it. The published SQLite database stopped being *the* data source and became one
projection among several — a framing [ADR 0003](0003-in-repo-presentation-poc.md)
predates and no longer describes on its own. Second, issue #572 had already
repointed the interactive surfaces (lookup, comparison, entry browser, Explore)
onto ledger-derived projection databases, folded from the claim ledger and verified
against the legacy databases by a full-corpus parity oracle — establishing the
pattern that a surface may be served by a projection shaped for its own workload,
provided that projection is a verified fold of the canonical inputs.

The single-callsign intent invites its own projection: not a database at all, but a
static answer the page can fetch directly.

## Decision

**Serve the single-callsign intent from a deploy-built, deterministic,
prefix-sharded static-JSON projection — no SQLite, no worker, no WebAssembly on
that path.** The database-backed deep dives are retained and linked out to, never
re-implemented.

### The projection

- **Built at deploy, from the same canonical inputs the databases fold.**
  `src/ci/build-callsign-shards.ts` runs in the Pages deploy assembly
  ([ADR 0019](0019-layered-build-cache-and-unified-cicd.md)) over every archived
  open-data `normalised.csv` plus every callsign-bearing FOI normalised file (the
  union the combined database's observations table also ships), per the
  ledger-canonical direction (#361/#572). Nothing is asserted that those inputs do
  not carry; the claim ledger remains the deep-provenance surface, and the page
  links out to it.
- **Precomputed parsed components, so the client re-derives no decomposition.**
  Each callsign's record carries its components (prefix series, RSL, suffix,
  placeholder form, home callsign, implied class) and its data-quality flags as
  produced by the same build-time parser (`parseCallsign`) the archive derivatives
  use. The page renders these directly; it never re-parses a callsign in the
  browser. The one thing the client does compute is trivial: it cleans the typed
  input and, on a literal miss, tries the register's RSL-less core form (so a
  regional rendering such as `MW7TEE` resolves to the core record `M7TEE`,
  mirroring the ledger's placeholder hop).
- **Sharded on a two-character key, with hot buckets subdivided.** The shard key
  is the first two characters of the cleaned form, with an `irregular` fallback
  bucket for forms whose first two characters are not both `[A-Z0-9]` (visitor
  `M/…` renderings, one-character tokens). Real callsigns concentrate into a
  handful of hot two-character buckets (`M7`, `M0`, `G0`, …), each far too large
  for an instant fetch, so a bucket exceeding a fixed threshold
  (`SHARD_SPLIT_THRESHOLD`, 2,000 callsigns) is subdivided by its third character;
  the residue (two-character forms, or a non-alphanumeric third character) stays in
  the parent shard. This keeps every fetch small without abandoning the decided
  two-character rule.
- **The client does a longest-prefix match against a once-fetched manifest.** A
  single `datasets.json` manifest carries the dataset list in vintage order, the
  status-letter legend, the product/type/implied-class vocabularies the records
  index into, and the shard list. To resolve a callsign the page tests its
  three-character then two-character prefix against that shard list, then the
  fallback — so the sharding rule lives **once**, in the builder, and the page
  mirrors it as a pure longest-prefix match. The build emits the projection; the
  page fetches the manifest once and then exactly one shard.

## Consequences

- **The motivating cost is removed for the common intent.** Measured on the real
  corpus (2026-07-16, PR #602): the previous database path cost roughly **20–30 s**
  cold; the sharded page answers a cold deep-link in a full page-load-to-rendered-card
  time of **254–290 ms** (the shard lookup itself 44–113 ms cold, 10–12 ms warm),
  from a single small fetch. The projection folded 62 datasets (9 open-data + 53
  callsign-bearing FOI files) into 180,089 cleaned-form entities across **413
  shards** plus the manifest; the largest shard was **13.8 KB gzipped** (185.2 KB
  raw, 999 callsigns), well inside a fetch-sized budget. Rows with no addressable
  callsign characters (39 of them) are counted as `unkeyable`, never silently
  dropped. Those counts are the 2026-07-16 measurement, not a contract: the
  corpus keeps growing (71 ledger sources by 2026-07-29 — ADR 0024's per-source
  table), and the builder re-shards on every deploy, so dataset, entity and
  shard counts drift upward by design. Current values are recomputed — and the
  shard-size bound re-asserted — by the committed self-check on every CI run;
  what this record owns is the *mechanism* (the two-character rule, the
  2,000-callsign `SHARD_SPLIT_THRESHOLD` subdivision, the manifest-driven
  longest-prefix match), which holds regardless of corpus size until a
  threshold or rule change re-opens it.
- **The projection is verified by a committed self-check, not by a committed
  artefact.** Like the SQLite databases (ADR 0003, ADR 0019) the shards are built
  at deploy and **never committed** — so they are not golden masters. Unlike the
  SQLite databases they *are* byte-deterministic, and the self-check suite
  (`src/ci/build-callsign-shards.corpus.test.ts`, run over the real archive) turns
  that into an assertion. It builds twice and requires byte-identical output;
  checks **callsign-count parity** against an independently recomputed
  derivation-source union (every open-data `normalised.csv` plus every FOI
  observation, cleaned); asserts every record is structurally sound and lands in
  the shard the resolution rule picks; spot-checks round-trips for known rows (a
  plain Foundation callsign, the month-suffix Intermediate oddity that keeps its
  spreadsheet-rendered variant visible, an RSL-carrying form, a stripped-collision
  twin); and bounds the largest shard's size. Determinism is asserted *because* the
  artefact is not committed: the guarantee lives in the check, not in a reviewed
  blob.
- **It is a projection in the ADR 0013 sense, and a sibling of the #572 projection
  databases.** The shards are a purpose-shaped fold of the canonical inputs,
  answering one workload, exactly as the interactive surfaces' projection databases
  are — the difference is only that this workload is served with no database engine
  at all. The canonical record is untouched; this adds a rendering of data already
  public in the repository, it does not create a new data surface.
- **The database deep dives stay, and are linked to.** The Ledger (raw-byte
  provenance and derivation rules) and the database Lookup (reference joins,
  regional variants, FOI history, the suffix availability matrix) remain the paths
  for the workloads they suit; the per-callsign page links out to both rather than
  duplicating them, and surfaces fidelity inline in keeping with #438.
- **The deliberate constraints are retained.** The path stays frameworkless with no
  client build step and no client-side npm supply chain; the published surface is
  static; there is no repository writeback. The shards ride the static host's
  default caching with no version stamp, so a manifest/shard pair straddling a
  deploy boundary is bounded by the page cache's lifetime and self-heals; a version
  stamp can be adopted later if that ever bites.

The live anatomy figure added to the page (issue #595, PR #612) follows the same
discipline: it draws the callsign's decomposition from the record's **precomputed**
components and accepts them only when they reassemble the resolved key exactly,
never re-deriving a segmentation in the browser.
