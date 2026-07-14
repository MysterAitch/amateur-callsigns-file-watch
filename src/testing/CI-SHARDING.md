# CI test sharding — how and why (read before changing the shard setup)

This explains how a single expensive test file is fanned across several CI jobs
(`.github/workflows/cicd.yaml` → the `heavy-shard` job), driven by
[`sharded-tests.json`](./sharded-tests.json). It front-loads the **mental model**,
because the intuition from JUnit/xUnit is subtly wrong for vitest and it's easy to
expect the wrong thing.

## The mental-model trap (read this first)

> "It's a parameterised test — 44 sources should mean 44 parallel runs, like 44
> `@ParameterizedTest` cases."

Two independent things get conflated there:

1. **Parameterisation** = how many test *cases* exist. `it.each(sources)` makes
   one case per source — great for reporting (each source passes/fails on its own,
   with its own timing), but it says nothing about parallelism.
2. **Distribution** = how the work spreads across *CPUs/machines*.

They are **not** the same, and vitest does **not** connect them for you:

- **Vitest parallelises at the FILE level.** Separate worker processes / `--shard`s
  run different *files* concurrently. Within one file, `it.each` cases run **in one
  worker** (serially, or `test.concurrent` = event-loop concurrency, which does
  nothing for CPU-bound work and doesn't reduce coverage cost). There is **no
  native "spread these 44 cases across 44 runners."**
- Even in JUnit this intuition is only half-right: 44 `@ParameterizedTest` cases run
  across the executor's **thread pool** (say 8 threads) = 8-way parallel, not 44.
  Parallelism is always bounded by hardware/executors, never the case count.

So to get a file's cases onto multiple machines, **we shard manually in CI**: the
matrix spawns N jobs (the pool of machines), and the test reads which slice it owns.

## Why this file is sharded at all

`reconstruction-oracle.test.ts` reconstructs every archived source from its claim
stream. Each source is independent (embarrassingly parallel), but the gate looped
over all of them in one serial test — ~184 s, and **~5× worse (~755 s) under v8
coverage**, because v8's per-invocation coverage tracking multiplies hot-loop code
(millions of per-claim/per-cell calls). That one job capped the whole fan-out
pipeline. Splitting the sources across jobs splits that per-execution cost the same
way — wall-clock → ~cost/N — **while keeping full per-PR coverage** (each shard emits
its own coverage blob; the `coverage` job merges them). No coverage compromise.

## Why N is tuned to the *next bottleneck*, not the source count

Two reasons you do **not** want N = 44:

1. **Fixed per-job cost.** Every CI job pays ~90 s of `checkout + npm ci +
   setup-duckdb` before any test runs. 44 one-source jobs would be setup-bound and
   would blow the account's concurrent-runner limit.
2. **N only needs to drop this test *below the next-slowest test*.** After sharding,
   the pipeline wall-clock is set by whatever job is now slowest (currently
   `build-sqlite.tiers`, ~430 s). N=4 already puts reconstruction under that, so more
   shards would spend runners shaving time off something that's **no longer the
   critical path**. To go lower, shard the *next* bottleneck too (same mechanism) —
   don't just raise N here.

## The moving parts (data flow)

```
sharded-tests.json          [ { "file": "…reconstruction-oracle.test.ts", "shards": 4 } ]
   │  (single source of truth: which file, and N)
   ▼
matrix-setup (cicd.yaml)    emits `shardmatrix` = [ {file, shard:1, total:4}, … {shard:4} ]
   │                        and removes the file from the non-fold pool
   ▼
heavy-shard job (cicd.yaml) matrix: include: <shardmatrix>  → one job per (file, shard)
   │                        env RECON_SHARD = "${shard}/${total}"   (e.g. "2/4")
   ▼
reconstruction-oracle.test.ts   shardResolved() reads RECON_SHARD and keeps only the
                                sources where index % total === shard-1 (disjoint;
                                union across shards = the whole corpus). Slicing the
                                RESOLVED list BEFORE .load() means each shard also
                                parses only its slice. Unset RECON_SHARD ⇒ all (local).
```

Every shard writes a uniquely-named coverage blob (`shard-<job-index>.json`,
`include-hidden-files: true` because `.vitest-reports` is dot-prefixed); the
`coverage` job downloads them all and `vitest --merge-reports --coverage` applies the
floor to the merged whole. Completeness is asserted on the **unsliced** counts, so a
shard with an empty slice is a valid no-op.

## How to change it

- **Add a source** → nothing to do. It joins the corpus at runtime; each shard just
  gets one more (round-robin).
- **Add another sharded test** → add `{ "file": "…", "shards": M }` to
  `sharded-tests.json`. It leaves the non-fold pool and gets its own M jobs. (If it
  needs the Parquet, it belongs in `fold-tests.json` instead; sharding a fold would
  need it to download the artifact — not wired.)
- **Change N for a file** → edit its `shards`. `RECON_SHARD` and the matrix both
  derive from it, so there's nothing to keep in sync.

## Observability

- Each source is its **own `it.each` case** (`$family/$jsonlStem`), so a failing run
  names exactly which file(s) failed, independently, each with **its own duration** —
  use those timings to spot slow sources.
- Each shard logs its slice: `[recon] shard 2/4: committed-CSV 8/31, full-corpus
  11/44 source(s) this run`.

## Known limitation / future work

The split is **round-robin by index** (`idx % N`), which balances by *count*, not by
*time*. If a handful of sources are much heavier, one shard can get unlucky and
become the bottleneck. The per-source `it.each` timings are exactly the input you'd
use to **bin-pack by measured time** instead — worth doing only if the shards become
visibly imbalanced.
