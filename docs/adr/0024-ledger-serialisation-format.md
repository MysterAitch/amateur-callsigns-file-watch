# ADR 0024 — JSON Lines is the ledger serialisation, and the bar an alternative must clear

- Status: accepted
- Date: 2026-07-29
- Related: ADR 0013 (the raw-keyed claim ledger this serialises, and where the engine that must ingest it is adopted as a pinned CLI), ADR 0012 (supply-chain posture — constrains which codecs and libraries are admissible), ADR 0023 (resource tuning by measurement); issues #997 (compression), #994 (whether the intermediate is needed at all), #361 (the original ledger exploration)

## Context

ADR 0013 established the raw-keyed claim ledger and named JSON Lines as its
serialisation, but recorded the reasons in a single sentence. The question
"should this be CSV / TSV / RDF / a binary format / a graph database?" has since
been raised repeatedly, and each time answered from first principles at
considerable cost — most recently a full day of benchmarking that rediscovered
constraints already recorded elsewhere.

This ADR exists to stop that. It states the decision, the measured evidence, the
**objective bar** an alternative must clear, and a worked example of a proposal
that looks viable and is not.

## Relationship to ADR 0013 — SUPPLEMENTS, does not supersede

ADR 0013 decides the **ledger model**: raw-keyed claims as the canonical record,
everything else a derived fold. That decision stands entirely unchanged.

This ADR supplements it by expanding **one clause** — that the canonical
serialisation is JSON Lines — into the reasoning, the measured evidence, and a
bar for alternatives. The format decision is 0013's; what is new here is *why*,
*how much*, and *what would change it*.

It also prompted a **wording fix in 0013**. That clause formerly read "the
committed canonical serialisation", which carries two readings: the serialisation
the project has *committed to*, or a file *committed to git*. No `.jsonl` has ever
been in git, so only the first matched reality — but the second is the natural
reading in a document that elsewhere uses "committed" to mean precisely "tracked
in the repository" (of golden masters, of `normalised.csv`, of the reconstruction
oracle). 0013 now says "canonical" and states the ledger's build-output status
outright. Nothing in 0013 is reversed; ambiguous wording is repaired and the
evidence attached.

## Three orthogonal concerns, routinely conflated

Most of the recurring confusion comes from treating these as one question. They
are not, and compression has a *different answer* in each:

| concern | what it is | compression |
|---|---|---|
| **Publishing** | shipping data to consumers — Actions artifacts, Release attachments, Pages downloads | **YES — already done, uncontroversial.** Compression is a publish responsibility (ADR 0023's build-vs-publish principle) and hosted size is what it optimises |
| **Storing text in git** | diffability at the claim grain, traceability of derived claims through history | **NO — antagonistic.** A committed `.zst` is binary to git: no textual diff, no line delta, a fresh blob per revision. Compression forfeits the only reason to commit text |
| **Optimising CI/CD steps** | build-time wall clock and I/O on the transport intermediate | **NEUTRAL TO NEGATIVE.** Measured: ~16% more serialise time to save disk that is not scarce (#999 measured a 72.9 GB floor). It is publish-shaped work on the verify path |

So "should we compress the ledger?" has no single answer. **Publishing compressed
is settled and orthogonal** — it neither helps nor hinders the git-storage
question, and it is not a lever on CI time. Keep the three separate when
evaluating any proposal.

## Decision

**The ledger is serialised as JSON Lines.** One claim per line, keys in a fixed
order, UTF-8, newline-delimited.

**The ledger is NOT committed to git.** No `.jsonl` has ever been tracked, on any
branch. Whether one should be is an open question, not an unimplemented decision —
see "The commit question" below.

Nothing enforced that until now, which is worth recording rather than glossing.
There is no `*.jsonl` ignore rule; the ledger stayed out of the repository because
the paths actually exercised happen to fall outside it — CI writes to
`$RUNNER_TEMP`, benchmarks to an OS temp directory. But `build-ledger.ts` with no
path argument defaults to `_build/v2-ledger` **inside the working tree**, so a
plain local build left ~12.7 GiB untracked and one `git add -A` from being staged.
`_build/` is now ignored: the accident should be hard, while a deliberate
`git add -f` remains available if the open question ever resolves to "yes".

**Compression is not applied on the build path.** Per the build-vs-publish
principle, compression is a publish responsibility (see "Compression" below).

## Why JSON Lines — the four load-bearing properties

Each is a *requirement*, not a preference. An alternative must satisfy all four.

### 1. Edge-data is free — and this is a hard block, not a nicety

`Provenance.position` is a **discriminated union of five heterogeneous variants**
(`claim-core.ts`):

| variant | fields |
|---|---|
| `csv-line` | `line` |
| `sheet-cell` | `sheet`, `sheetName`, `row`, `column`, `columnRef` |
| `markdown-row` | `line`, `tableRow` |
| `pdf` | `page`, `x`, `y` |
| `image` | `x`, `y`, `w`, `h` |

`viewAnchor` adds `{repoPath, line, endLine?}`. Both are **additive and sparse** —
absent on legacy ledgers, absent on most claims today, and only `csv-line` is
currently emitted. `rule` is likewise optional.

In JSONL an absent field costs **zero bytes** and a variant carries exactly the
fields it has. **Any fixed-schema format must reserve a column for the union of
every variant's fields** — mostly empty on every row — or nest a serialised
object inside a cell, which reintroduces JSON plus a layer of quoting.

This is the property that disqualifies CSV, TSV and every other tabular format.
It is also why `claims.parquet` is a **lossy projection**: it omits `position`
and `viewAnchor`, which the compact SQLite build consumes as
`observation.pos_kind`/`pos_line` and `source.repo_path`.

### 2. Natively ingestible by the pinned engine

DuckDB reads JSONL directly via `read_json(..., format='newline_delimited')`.
Measured on DuckDB 1.5.4, the **only** accepted compression values are
`auto`, `none`, `gzip`, `zstd`. `7z`, `xz`, `lzma`, `bzip2` and `brotli` are
rejected outright: *"Parser Error: Unrecognized file compression type"*.

### 3. Git-diffable at the claim grain

Drift in a single claim shows as a single changed line. This is a stronger signal
than a row-level golden, and it is the property that makes review meaningful.

**Compression destroys it.** A committed `.zst` is a binary blob to git: no
textual diff, no line-level delta, and each revision stores a fresh blob because
compressed bytes do not delta well. **Compression and diffability are mutually
exclusive on the committed path** — a proposal cannot claim both.

### 4. Deterministic

Keys are emitted in a fixed order by hand rather than relying on
`JSON.stringify` over an arbitrary key order, so a re-run diff is real signal.
Every serialisation path shares the one line encoder, so the whole-string
serialiser and the chunked writer produce byte-identical output.

## Measured baseline — the numbers an alternative is judged against

Full corpus, streamed, **all fields preserved** (2026-07-29):

| | size | share | ratio |
|---|---:|---:|---:|
| raw JSONL | **12.73 GiB** | 100% | — |
| zstd-1 | 0.34 GiB | 2.67% | 37.5× |
| zstd-9 | 0.30 GiB | 2.40% | 41.7× |
| gzip-6 *(git's own codec)* | 0.39 GiB | 3.05% | 32.8× |

Per-source: **largest 537.4 MB**, median 19.9 MB, **33 of 71 files exceed
GitHub's 100 MB hard limit**. The largest source also **exceeds V8's maximum
string length**, which is why `writeClaimsJsonlSync` chunks.

Byte composition of a representative 339.1 MB source:

| component | share |
|---|---:|
| values | ~58% |
| key names | 23.1% |
| quotes | 11.9% |
| colons + commas + braces | 7.0% |
| **newlines — the only structural whitespace** | **0.4%** |

**Whitespace is a non-lever.** `JSON.stringify` emits no pretty-printing; the
only whitespace is one newline per record, which is what makes the format
line-delimited. Proposals to "minify" target 0.4%.

Full-corpus emit takes ~101 s.

### Reproducing these numbers

A bar stated in figures is only enforceable if the figures can be regenerated, so
the measuring tool is committed rather than left as a one-off:

```
node src/ci/ledger-format-bench.ts [sourceCount] [--out results.json]
```

It emits the real ledger, then for each of the N largest sources reports bytes,
serialise time, write time and DuckDB ingest time per candidate format — and
counts TSV-unsafe values, which is how the TSV block below was found rather than
assumed. Current JSONL is itself one of the measured candidates, so the ingest
and emit baselines that criteria 6 and 7 compare against are produced in the
same run as the challenger's figures — a comparison never rests on a stale
number quoted here.

**Two caveats when quoting it.** It profiles the N largest sources, not all 71,
because the production emit is per-source precisely because the corpus does not
fit in memory; a corpus total is an extrapolation and should be labelled as one.
And it deliberately runs on the real corpus — the synthetic figures that preceded
it were wrong in *direction*, not just magnitude (zstd level ordering inverts
above ~26 MB), so a synthetic re-run does not discharge this bar.

## The bar: what an alternative must demonstrate

A proposal to change the serialisation must show, **with measurements on the real
corpus and no fields dropped**:

| # | criterion | how it is judged |
|---|---|---|
| 1 | **Lossless for sparse union-typed fields** | round-trips `position` (all five variants) and `viewAnchor` without a nested serialised object |
| 2 | **Natively ingestible by the pinned DuckDB** | reads via a built-in reader, no extension, no pre-decompression step |
| 3 | **Line-grain diffable as committed** | a one-claim change produces a one-line diff — this rules out any compressed-at-rest form |
| 4 | **Deterministic** | byte-identical output for identical input across runs and platforms |
| 5 | **Smaller than 12.73 GiB raw** | materially, not marginally — and stated raw, since compression applies equally to any text format |
| 6 | **Ingest cost** | DuckDB read time for the whole corpus, against the JSONL baseline |
| 7 | **Emit cost** | serialise + write time, against ~101 s |
| 8 | **File-count cost** | measured at ~**1.4 ms per file** of DuckDB overhead: 1 file 376 ms, 16 files 278 ms, 256 files 533 ms, 2,048 files 3,091 ms, 5,376 files 7,502 ms for identical data |
| 9 | **Seam durability** | adding one claim must not rewrite unrelated files (see below) |
| 10 | **No new native build step** | no `node-gyp` (ADR 0012). WASM or pure JS is admissible |
| 11 | **Test-suite impact** | `report-fold-parquet-equivalence.test.ts` proves folds are format-agnostic, so equivalence is inherited — but the reader layer and any dynamic file discovery must fail LOUDLY on a missing partition, not silently yield fewer rows |

**Criterion 1 is the usual hard block.** Criteria 5–8 are where most proposals
look attractive; criterion 1 is where they fail.

## Worked example: TSV — attractive, and blocked

This is the proposal most likely to recur, so it is recorded in full.

**The case for it.** Measured on real data, TSV is **58–63% of JSONL raw**,
**faster to serialise** (no quote-escaping to evaluate), **faster for DuckDB to
read**, and needs no new dependency. On criteria 5, 6, 7 and 10 it beats JSONL
outright. Dropping key names alone targets 23.1% of the bytes and quotes another
11.9%, which matches the measured saving almost exactly.

**Why it fails.** Criterion 1. A fixed TSV schema cannot carry a five-variant
discriminated union. The options are:

- **a column per variant field** — `sheet`, `sheetName`, `row`, `column`,
  `columnRef`, `tableRow`, `page`, `x`, `y`, `w`, `h`, `line`, `endLine`,
  `repoPath` … empty on virtually every row, so the saving is spent on delimiters
  and the format grows every time a variant is added;
- **JSON inside a cell** — reintroduces JSON, plus TSV's own escaping problem;
- **dropping the fields** — lossy, and the compact SQLite build depends on them.

**The obvious next idea, and how to evaluate it.** A reader who gets this far
usually proposes **denormalised TSV with join columns**: a main claims table plus
a side table per position variant, joined on the observation key
`(source_file, ordinal)`.

That is a genuine design, not a dead end, and it should be evaluated against the
bar rather than dismissed. Specifically it must show:

- **the join cost** — DuckDB must now join N tables per fold instead of scanning
  one; measure against the baseline for the actual fold queries, not a `count(*)`
- **diff locality** — a claim whose position changes now touches two files; does
  a one-claim change still produce a readable diff?
- **atomicity** — main and side tables must stay consistent; a partial write now
  corrupts a join rather than truncating a file, which fails louder or quieter
  depending on design
- **that the saving survives** — the 58–63% figure was measured **without**
  `position`/`viewAnchor`; adding side tables adds back the observation key on
  every side row, and the key is `sourceFile` + `ordinal`, where `sourceFile` is
  already the single most repeated value in the corpus at 29.8% of all bytes

If it clears those, it deserves a serious look. Note also that criterion 3 still
applies: whatever the layout, the committed form must be uncompressed text.

## Rejected alternatives, with the reason each fails

| alternative | fails on | evidence |
|---|---|---|
| **CSV / TSV** | 1 | discriminated union cannot flatten; measured 58–63% raw but only by omitting the fields |
| **JSONL with short keys** (`l`,`s`,`p`…) | 5, 7 | 78–82% of size and **slower to serialise** (2104 ms vs 1779 ms) — the intermediate object costs more than the bytes saved |
| **`v8.serialize`** | 2 | 93% of JSONL size *and* DuckDB cannot read it |
| **7z / xz / LZMA** | 2 | DuckDB rejects the compression type outright; 7z is an archive container, not a stream codec; and both need `node-gyp` or an external binary (10) |
| **RDF (N-Quads / Turtle)** | 1, 2 | our exporter is **itself lossy** (no `position`/`viewAnchor`); measured 122% of JSONL raw, 78% compressed; DuckDB has no native reader. **RDF remains the right DERIVED export** — it is published as a fold, per ADR 0013 |
| **Neo4j / any graph DB** | 2, 3, 4 | storage is a proprietary server directory: not a file, not diffable, not a DuckDB input. Remains valid as an **analyst's lens** loaded from the canonical files |
| **Parquet as canonical** | 1 | already in use as a *lossy projection*; making it canonical requires a schema extension, changing its bytes, row-group layout and cache key, and re-proving fold equivalence |

## Seams — if the ledger is ever committed

The current seam is **one file per source** (`${source.jsonlStem}.jsonl`), which
is durable — a new claim touches only its own source's file.

It is not sufficient for committing: 33 of 71 files exceed GitHub's 100 MB limit.
Measured finer seams:

| seam | files | largest | over 100 MB |
|---|---:|---:|---:|
| per source *(current)* | 71 | 537.4 MB | 33 |
| per source × layer | 135 | 326.3 MB | 62 |
| per source × layer × rule | 336 | 211.1 MB | 44 |

**No semantic seam alone gets under the limit.** A durable seam must be
**content-keyed**, never positional:

- **positional/count-based chunking is disqualified** — inserting one claim at a
  low index shifts every subsequent boundary, so unrelated files are rewritten,
  diffs become noise, and git stores a fresh blob for each. This is the same
  failure as offset/limit pagination over shifting data.
- **hash or prefix buckets are durable** — a new claim lands in its existing
  bucket; boundaries never move. The bucket count must be **fixed**, since an
  adaptive count reintroduces the instability the moment a file crosses the
  threshold.

Trade curve, combining `source × layer × rule` with fixed buckets:

| buckets | files | largest | DuckDB overhead |
|---:|---:|---:|---:|
| 4 | 1,344 | 52.8 MB | ~1.9 s |
| **8** | **2,688** | **26.4 MB** | **~3.8 s** |
| 16 | 5,376 | 13.2 MB | ~7.5 s |

## The commit question — explicitly OPEN

ADR 0013 reads as intending a committed ledger. It has never been implemented,
and the decision is **not settled here**. What is settled is the evidence:

- **git storage** barely differs: one 537.4 MB source costs **15.6 MB** committed
  raw against **14.8 MB** committed as `.zst` — because git already compresses,
  and its zlib achieves 32.8× against zstd's 37.5×.
- **the working tree does not**: raw checks out at **12.73 GiB**, compressed at
  **0.34 GiB**. Git stores compressed and checks out raw, so every clone pays the
  full size. This is the dominant cost, and it also collides with GitHub's
  documented 14 GB runner allowance.
- **compression forfeits the reason to commit**: a `.zst` is binary to git.

So the trade is: commit raw for diffs at ~13 GB per working tree, or commit
compressed and lose the property that motivated committing. Independent of that,
**finer seams enable incremental re-emit** — regenerating only the files a
changed source affects — which is valuable whether or not anything is committed.

## Revisit when

- **DuckDB gains a native reader** for a format that satisfies criterion 1 — a
  self-describing columnar format with union support would change the analysis
  outright.
- **`position` stops being a union**, or the reserved variants (`sheet-cell`,
  `markdown-row`, `pdf`, `image`) are abandoned. Criterion 1 is the hard block;
  if the data model flattens, tabular formats come back into play.
- **The corpus grows past ~50 GiB raw**, or a single source past ~2 GiB — the
  V8 string cap (~536.9 MB) already binds: the largest source, at 537.4 MB, is
  past it, which is why the emit chunks rather than serialising whole.
- **A new derived tier multiplies claim count several-fold** — the emit is ~101 s
  today and scales linearly with claims.
- **Node's `zlib` gains LZMA**, or DuckDB accepts a denser codec — the codec
  comparison here is pinned to DuckDB 1.5.4 and the Node line at measurement
  (the #997 findings were recorded against Node 25's standard library; the
  repository's CI pin is `.nvmrc`, Node 26 as of 2026-07-29 — `zlib` zstd
  support is present in both).
- **The commit question is decided** — that changes which criteria bind, since
  diffability and working-tree size only matter for a committed artefact.
- **Anyone proposes denormalised TSV with join columns** — evaluate it against
  the worked example above rather than from scratch.

## Consequences

- The recurring "why not CSV/RDF/binary?" question has a documented answer with
  numbers, and a bar that makes a serious proposal cheap to evaluate and a
  hand-wave cheap to dismiss.
- Compression remains available for **published** artefacts, where the
  build-vs-publish principle already places it, and is measured at 37.5× — but it
  is not a lever on the committed path, because it forfeits diffability.
- The size problem is real (12.73 GiB) and the honest lever is **not writing the
  intermediate at all** (#994), not making the text smaller: schema changes buy
  ~40% and break criterion 1, while eliminating the round trip removes two thirds
  of the emit step.
