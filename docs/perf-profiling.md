# Performance profiling (flag-gated)

The build entrypoints carry a permanent, flag-gated profiling harness
([`src/shared/perf.ts`](../src/shared/perf.ts), issue #354). It exists so the
genuinely expensive paths can be measured on demand — now, or in months or
years — without re-instrumenting, and so candidate optimisations are ranked by
measured cost rather than hunch (big hitters first; small clean wins still
count). Measurements exist to rank the optimisation candidates.

## Turning it on

Set the `PERF` environment variable to any non-empty value:

```sh
PERF=1 node src/ci/build-sqlite.ts _site/data
PERF=1 node src/ci/build-dataset-pages.ts _site
```

The harness prints a sorted per-label breakdown (call counts, total ms, share
of measured time, and size hints where cheap to collect) to **stderr** at the
end of the run. Spans may nest, so a parent's total includes its children's;
the per-label totals still rank the hotspots correctly.

**Off is the default and is provably inert.** With `PERF` unset, every timing
helper is a straight pass-through — no timestamp taken, nothing allocated, no
output, no file. The instrumentation is observationally transparent: a build
run with `PERF` unset produces byte-identical artefacts to one without the
harness at all, which the golden-master tests enforce.

## The persistent JSON report

Profiling is only useful over time if runs can be compared. Point `PERF_JSON`
at a destination path (honoured only while `PERF` is on) and the same run also
writes a machine-readable per-run report there:

```sh
PERF=1 PERF_JSON=perf/build-sqlite-$(date +%Y%m%dT%H%M%S).json \
  node src/ci/build-sqlite.ts _site/data
```

File emission is **doubly gated** — nothing is written unless both `PERF` and
`PERF_JSON` are set — so the disabled path, and the `PERF`-on-without-`PERF_JSON`
path, write no file and leave every golden build byte-identical. The report is
written atomically (temp file + rename) so a reader never sees a half-written
file; an unwritable path throws loudly rather than dropping the requested
measurements silently.

### Report shape

The field names are a stable contract; `schema` carries the version so
consumers can evolve safely. `generatedAt` is the only per-run-varying field
and is what makes each report a distinct, comparable record.

```json
{
  "schema": "perf-report/v1",
  "entrypoint": "build-dataset-pages",
  "generatedAt": "2026-07-17T08:33:24.589Z",
  "node": "v25.0.0",
  "totalMs": 158367.5,
  "rows": [
    { "label": "dataset-pages:forbidden-section", "calls": 1, "totalMs": 35088.9, "size": 0 },
    { "label": "dataset-pages:foi-entry", "calls": 53, "totalMs": 27784.1, "size": 0 }
  ]
}
```

| field | meaning |
|---|---|
| `schema` | report schema version (`perf-report/v1`) |
| `entrypoint` | which build produced the run (e.g. `build-sqlite`), or `null` |
| `generatedAt` | ISO-8601 UTC timestamp, one per run |
| `node` | the Node.js version the run executed under |
| `totalMs` | grand total across every label (nested spans double-count by design) |
| `rows` | per-label rows, sorted by `totalMs` descending |
| `rows[].label` | the profiled operation |
| `rows[].calls` | how many times the label was timed |
| `rows[].totalMs` | accumulated wall time for the label |
| `rows[].size` | accumulated size hint (e.g. row counts) where a call site supplies one; `0` otherwise |

## Instrumented entrypoints

The harness is wired into the genuinely expensive build entrypoints, each
tagging its report with its own `entrypoint` name:

- `src/ci/build-sqlite.ts` — the published download-tier SQLite builds
- `src/v2/build-ledger-db-compact.ts` — the compact claim-ledger SQLite build
- `src/ci/build-dataset-pages.ts` — the per-dataset page build
- `src/ci/report-sweep.ts` — the report sweep / projection build
- `src/ci/cross-dataset-invariants.ts` — the depletion / overlap joins

The hot internals they call — register CSV parse/load, `buildFoiObservations`
and the observations union render, the per-entry and combined SQLite inserts,
report and page renders — are timed with individual labels so the breakdown
ranks them directly.
