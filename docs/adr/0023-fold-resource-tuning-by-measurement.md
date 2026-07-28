# ADR 0023 — Report-fold resource tuning is settled by controlled measurement, and no lever survives without evidence

- Status: accepted
- Date: 2026-07-28
- Related: ADR 0002 (DuckDB as a pinned CLI, never a native npm dependency — the engine this tunes), ADR 0012 (supply-chain posture), ADR 0013 (the raw-keyed claim ledger these folds read), ADR 0019 (layered build cache and unified CI/CD — the caching model whose invalidation this affects); issues #929 (CI perf), #987 (closed: spill exhaustion), #991 (the full experimental record this consolidates), #994 (whether the rebuild model itself is right)

## Context

The report sweep folds every committed report out of the claim ledger through
DuckDB. Between #929 and #951 three levers were added to that path to control
what was believed to be memory and IO contention between concurrent folds:

- a per-fold DuckDB `memory_limit` of 3 GB;
- a per-fold `threads` pin of 1;
- a disk-reclaim step deleting preinstalled runner toolchains.

Each was introduced on a **hypothesis**, and none was validated afterwards. The
first was justified by arithmetic (four folds at 3 GB fits 12 GB of a 16 GB
runner) rather than by measurement of what a fold actually needs. The second was
retained even though #951's own measurement recorded no speed-up from it.

The regeneration then began failing intermittently — two of three cache-miss
runs, in a different fold each time, with no diagnostic. Three separate gaps
made it unexplainable: the sweep's perf breakdown was written only on success so
a crash uploaded nothing; a killed child process leaves no stderr, and
`foldQuery` discarded the child's stderr, exit status and signal alike; and
nothing recorded machine state, so the leading hypothesis could be neither
confirmed nor ruled out.

## Decision

**Resource levers on the fold path are settled by controlled measurement, and a
lever that cannot be varied from outside is treated as a defect.**

Concretely, and as applied in #996:

1. **No per-fold `memory_limit` is imposed.** DuckDB's own default applies. The
   environment override remains for a genuinely constrained host.
2. **The claims CTE is declared `NOT MATERIALIZED`** at every call site, guarded
   by a mutation-proven test.
3. **Every lever must honour an externally-supplied value.** An unconditional
   assignment makes a documented-overridable setting un-overridable in the only
   region where it acts.
4. **Diagnostics must survive the failure they describe.** Records stream to
   disk as events happen; a post-mortem runs on failure as well as success; and
   the *absence* of a signal is recorded explicitly rather than left as a gap.

## The evidence

A ten-arm matrix at three repetitions, varying one lever at a time.

**The memory cap caused the failures it was introduced to prevent.**

| cap | failures |
|---|---|
| 1 GB | 3/3 |
| 3 GB (as shipped) | 1/3 |
| 8 GB | 0/3 |
| unset | 0/3 |

Monotonic, and opposite to the intuition that produced the lever. Folds sat at
2.88–3.04 GB against a 3 GB ceiling, and DuckDB at that boundary **segfaults**
(exit 139, no stderr) rather than erroring cleanly — which is why the failure
was intermittent and why its evidence appeared to implicate three different
subsystems. The same root cause produced a spill-file IO error at 1 GB, a clean
out-of-memory error at 3 GB with threads unpinned, and a segfault at 3 GB with
threads pinned.

Peak usage across the whole job was **6.9 GB of 16 GB**, with 9.1 GB still
available and swap untouched. The cap was rationing a resource that was never
scarce.

**The CTE was being materialised.** `EXPLAIN ANALYZE` against the real corpus:
the plain CTE plans as a materialised relation with each of its three to seven
references scanning all **55,426,648** rows and the filter applied afterwards;
declared `NOT MATERIALIZED`, the filters push into the Parquet scan and the same
predicate reads **20,649,907** rows. Measured effect: a 19–25% faster sweep, 20%
lower peak fold memory, and no failures **even with the 3 GB cap still in
force** — which is what identifies materialisation as the mechanism rather than
merely the trigger.

**Not implicated.** Sweep concurrency (1, 2, 6 and 8 all passed); runner size.

**Disk is not a constraint, and the earlier reading understated why.** The first
rounds sampled free space from a point *after* the Parquet build, by which time
the JSONL intermediate had already been written and deleted — so they recorded a
2.6 GB trough for a step that in fact consumes five times that, and would have
supported "disk is fine" for the wrong reason. Sampling from before the build
(2026-07-28, run 30384764770) measures the real peak:

| arm | free at start | min free | peak consumed |
|---|---|---|---|
| baseline | 106.4 GB | 93.5 GB | 12.8 GB |
| no disk-reclaim | 85.8 GB | **72.9 GB** | 12.9 GB |

The peak is the 12.727 GiB ledger intermediate, exactly. **Without the reclaim
step the regeneration still floors at 72.9 GB free**, so the step is defending a
margin roughly six times larger than the largest thing the job writes. It is
removed from `golden-master` here. The same step in `build-site-databases` is a
different job with a different disk profile and is not covered by this
measurement; the `df` it already logs shows that job starting at **88 GB
available** before reclaiming, but its peak *consumption* has not been measured,
so it stays until it is.

**Insertion-order preservation is resolved, and the ordering of the two changes
was load-bearing.** Re-tested against the post-`NOT MATERIALIZED` baseline, as
this ADR deferred it to be: `preserve_insertion_order = false` takes the Parquet
build's peak resident memory from 5.88 GB to **1.28 GB** (reproduced across a
four-arm round), with 4/4 clean folds and byte-identical reports. It failed 3/3
*before* the CTE change, because the folds then scanned all 55.4M rows and
depended on the row-group locality that emission order incidentally provided;
with the filters pushed into the Parquet scan they no longer do. Adopted
unconditionally in #1001.

## Arguments considered and rejected

- **"Lower the cap further to bound the spill."** The intuitive direction, and
  exactly wrong: 1 GB failed 3/3. Rejected on evidence.
- **"Keep the cap but raise it to 8 GB."** Works (0/3), but re-imposes an
  arbitrary number that would need re-deriving as the corpus grows. DuckDB's
  default is a proportion of the host, which tracks the machine rather than a
  guess.
- **"Sort the Parquet so row groups prune."** Attractive — `@listed`, the
  commonest fold filter, currently reads 39.81% of the corpus to find 9.48%.
  Rejected for now: the sort alone costs 13.46 GB of build memory against a
  6.48 GB baseline and produces a *larger* file, on a runner documented at 16 GB.
- **"Turn off insertion-order preservation."** Deferred when this ADR was
  written, because alone it failed 3/3; **subsequently re-tested and adopted**
  (see the evidence above). The largest single memory win found.
- **"Remove the threads pin too."** Deliberately **not** taken in #996: it
  failed 2/3 and 3/3 while the cap was on, and no arm isolated it with the cap
  off, so it has no clean evidence of its own yet.

## Consequences

- The regeneration is 19–25% faster with no failures, and every arm produced
  byte-identical reports: none of these levers changes what is generated.
- Two measurement lessons are now standing practice. **Predictions are recorded
  before the run**, so a wrong one cannot be reinterpreted afterwards — one was,
  and the correction is on #991. And **a measurement can be censored by the
  configuration it runs under**: peak fold memory was predicted to fall and
  appeared not to, because both arms sat under a 3 GB cap that bounded the
  reading. The prediction was right; the instrument was wrong.
- A lever introduced on a hypothesis **owes a measurement**, and the burden sits
  with the lever rather than with the person questioning it.
- Stale figures in comments actively mislead: a `~37 min` regeneration figure
  predating the shared-Parquet change was cited as current for a job that by
  then took under six minutes. Measurements in comments now carry their date and
  source run (see `CONTRIBUTING.md`).

## What this does not settle

The rebuild model itself — whether regenerating everything on any input change
is the right shape at all — is #994, and is not addressed here. Nor is the
12.73 GiB ledger intermediate (#997) or the served database's size (#995). This
ADR settles only how the fold path's resource levers are decided.
