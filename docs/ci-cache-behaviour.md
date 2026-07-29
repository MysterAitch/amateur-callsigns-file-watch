# CI cache behaviour, and why merge cadence is a performance lever

Three content-addressed caches gate real work in `cicd.yaml`:

| cache | job | key closure |
|---|---|---|
| `claims-parquet-v2-*` | `build-claims` | `archive reference-data src/v2 src/shared src/sources package-lock.json .nvmrc` |
| `golden-reports-v2-*` | `golden-master` | as above **plus an enumerated list** of the report sweep's own imports |
| `pages-db-v3-*` | `build-site-databases` | as above plus `src/ci/build-sqlite.ts` |

Two further caches (`sqlite-tiers-verify-v2-*`, `ledger-corpus-v2-*`) hold an
intermediate their test consumes, but the test runs unconditionally — there is no
`if:` gate on it. They shorten a job rather than skipping work, so they have **no
hit/miss signal** and cannot be read as cache state. An analysis that probes them
anyway reports a miss on every run.

## Cache state is a vector, and the states form a chain

Measured over 36 successful runs (2026-07-28):

| joint state | share | median wall |
|---|---:|---:|
| all three cold | **44%** | 16.0 min |
| all three warm | 28% | 11.1 min |
| `reports` miss only | 14% | 11.6 min |
| `db` miss only | 11% | 13.6 min |
| `reports` + `db` miss | 3% | 16.4 min |

Only five of eight possible states occur. `claims` has the narrowest closure, so
anything invalidating it invalidates the other two — **there is no cheap claims
miss**.

The whole warm-to-cold span is about **4.9 minutes**. A *job-level* cache miss
costs far more than that (`build-site-databases` is ~9.5 min slower on a miss),
but sibling jobs run in parallel and absorb most of it. **Job-level cache deltas
do not sum to run-level deltas** — a distinction that has misled ranking on this
repo's own issues more than once.

## The scope trap: N merges in a row cost N cold runs

GitHub scopes caches **by ref**. A pull-request branch can READ a cache written on
the default branch, but a cache the PR WRITES is visible only to that PR.

So when a change lands that alters a wide closure — most commonly
`package-lock.json`, but any edit under `src/v2`, `src/shared`, `src/sources` or
`archive` does it — a new key is minted, and **every PR opened before `main` next
completes a run pays the full build**. Each of them then saves the result into its
own scope, where nothing else can ever read it.

Observed on 2026-07-28: a single `package-lock.json` change caused the identical
`pages-db-v3-7906ba8a…` key to be rebuilt and re-saved on four separate PR refs
before `main` populated it — roughly **48 minutes of redundant database building
for byte-identical output**.

### What to do about it

**Sequence merges around a completed `main` run** whenever a wide-closure input
changes. Free, purely procedural, and it addresses the cause rather than the
symptom. Merging several PRs faster than `main` can finish a run also cancels the
intervening deploys (`concurrency: cancel-in-progress`), so the cost is paid
twice.

**Do NOT add `restore-keys` prefix fallback to these caches.** For a
content-addressed cache a near-match is *wrong data*: restoring a database built
from a different closure would publish stale artefacts. The `db-cache` block
already states the governing principle — a too-narrow key risks a stale-artefact
false hit, which is worse than a false miss — and a prefix fallback is exactly
that failure with extra steps.

**Narrowing a closure is possible but is not a quick win.** `golden-master`'s was
narrowed from "hash `src/ci` wholesale" to an enumerated import list, which is why
it now hits far more often than `pages-db-v3-*`. Doing the same for the database
build carries the same stale-artefact risk and needs the same enforcement that
`cicd-workflow-structure.test.ts` gives `golden-master`: the list is recomputed
from the real import graph so it cannot silently go stale.

## Reading cache-frequency figures honestly

A table of "how often is the cache cold" describes **what has been changed
lately**, not a property of the pipeline. A docs-only PR, a test-only edit (the
closure hash deliberately excludes `*.test.ts`), a `src/v2` change and a data
ingest land in quite different states. Any such figure gathered over a period
containing a dependency bump will overstate how often work genuinely needs
redoing, because of the scope trap above.

See also [`perf-profiling.md`](perf-profiling.md) for the flag-gated profiling
harness and the resource-diagnostic tooling.
