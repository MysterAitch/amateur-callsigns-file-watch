# Adding a dataset

How to add a new callsign dataset to the archive, end to end, so it validates
and its derived goldens stay current. This is the step-by-step companion to the
architecture in [ADR 0004](adr/0004-foi-source-lane.md) (the FOI/recovered
lane), [ADR 0001](adr/0001-post-fetch-processing-in-repo.md) (post-fetch
processing) and [`normalised-schema.md`](normalised-schema.md).

## Prerequisites: the DuckDB CLI

Several derived goldens are folded through DuckDB. Install the pinned,
checksum-verified CLI once:

```
npm run setup:duckdb
```

This downloads the pinned version into `.duckdb/` and prints the path. Export
`DUCKDB_BIN` to that path for any command or test that folds (the sweep, the
value-catalogue fold, the cross-dataset invariants):

```
export DUCKDB_BIN="$(pwd)/.duckdb/duckdb.exe"   # or .../duckdb on Linux/macOS
```

## Step 1 — choose the lane

There are two archive lanes:

- **Open-data lane** (`archive/{YYYY-MM-DD}/`): a snapshot fetched **live** from
  Ofcom's open-data page on that date. `raw.csv` verbatim plus generated
  `normalised.csv` / `components.csv` / `stats.json`. Its `diffSummary` chain is
  newest-only and its `latest-*` pointers assume the newest entry.
- **FOI / recovered lane** (`archive/foi/{key}/`): everything else — FOI
  disclosures, and snapshots **recovered from a web archive** (Internet Archive,
  UK Government Web Archive). Per-entry `meta.json` + `correspondence.md`, every
  file hash-declared, `witnesses[]` recording where each copy came from, and no
  newest-only diff chain.

**A web-archive-recovered snapshot goes in the FOI/recovered lane** — even a
CSV, even though the bytes are "open data" — because the open-data lane cannot
represent web-archive provenance and back-dated insertion corrupts its
`latest-*` pointers. Only a genuinely-live fetch of the newest snapshot uses the
open-data lane.

## Step 2 — add the entry (FOI/recovered lane)

Key the directory `archive/foi/ofcom-{vintage}--{slug}/` (an `ofcom-` prefix
means `sourceKey: "ofcom-foi"`, `requestId: null`). Then:

1. **Drop the verbatim raw file in.** For an `.xlsx`, also run the mechanical
   extractor and note the printed bytes/sha256:

   ```
   node src/shared/xlsx-extract.ts archive/foi/{key}
   ```

   It writes `raw-extract-sheet-N-{slug}.csv` (`role: "extract"`).

2. **Add a converter variant** to `FOI_ENTRY_CONVERSIONS` in
   [`src/shared/foi-normalise.ts`](../src/shared/foi-normalise.ts). Columns are
   matched by exact header name. Use `kind: 'date'` for day-first `DD/MM/YYYY`
   CSV values, `kind: 'iso-date'` for workbook-extract values already ISO.
   Anything present but not projected goes in `ignoredColumns`. Set
   `referenceDateIso` to the vintage — dates must not postdate it.

3. **Author `meta.json`** (copy the closest sibling as a template —
   `ofcom-2024-04-30--copy-all-callsigns--all-callsigns` for a CSV,
   `ofcom-2025-09-11--callsigns--all-callsigns` for a workbook). Required:
   `schemaVersion`, `sourceKey`, `requestId` (null for ofcom), `title`,
   `outcome`, `dataVintage` + `dataVintageNote`, `datasetClasses`, `converter`
   `{script, variant}`, `relatedEntries` (**only to siblings already on `main`**
   — see gotchas), `publicationUrl`, and `files{}` with per-file
   `bytes`/`sha256`/`role`, derivation refs, and `witnesses[]` (`channel`,
   `url`, `fetchedAt`; `channel` is free text, so `wayback`/`ukgwa` are fine).

4. **Author `correspondence.md`** (`role: "transcript"`, always required — it is
   the provenance record even when there is no request/response thread).

5. **Generate the normalised file** — reads `converter.variant` from `meta.json`,
   writes `normalised--{stem}.csv`, and prints the bytes/sha256 (and a `notes`
   block of blank/NBSP/date-ambiguity counts — the authoritative anomaly report;
   base your `contentsIndicative` prose on it):

   ```
   node src/shared/foi-normalise.ts archive/foi/{key}
   ```

   Paste the printed hash/bytes into `meta.json`.

## Step 2a — a raw CSV with empty/duplicate trailing headers

Some open-data CSV exports append empty-named trailing columns. A CSV parser
collapses duplicate empty headers into one, losing the true column count, so the
raw cannot round-trip and the reconstruction oracle rejects it. The remedy is a
committed **shape-only extract**: byte-for-byte the raw with only the empty
header names filled in (`unknown-1`, `unknown-2`, …) and LF line endings — **no
data cell changed**. Point the converter's `sourceFile` at that extract, add the
`unknown-*` names to `ignoredColumns`, and declare the extract `role: "extract"`,
`extractOf: <raw>`. All columns then survive distinctly and the source
reconstructs losslessly (any stray content lands in its own column, carried in
the ledger). The self-check in
[`foi-csv-extract-shape-only.test.ts`](../src/ci/foi-csv-extract-shape-only.test.ts)
proves, row for row, that such an extract changed only the shape.

## Step 3 — regenerate the corpus goldens

Adding a dataset shifts several corpus-wide goldens. These trip CI **by design**
(a new dataset must be noticed, not slip through), so regenerate and commit them
in the same PR — the diffs are the reviewable evidence. Run:

```
npm run regen          # normalise:sweep + foi:schemas + dataset:status
```

That covers:

- `reports/**` — the value catalogue and cross-dataset-invariants reports
  (the **golden-master** gate). The sweep is the slow step (minutes; it folds
  the whole corpus through DuckDB).
- `docs/dataset-status.md` and `docs/foi-schemas.md`.

Then hand-update the **hand-authored goldens** the sweep does not regenerate:

- `EXPECTED_CATEGORIES` in
  [`value-catalogue-fold.test.ts`](../src/ci/value-catalogue-fold.test.ts) — the
  licence-category legacy + folded figures. Running that test on a drift prints
  a paste-ready block; copy it in (variants and reasons are unchanged).
- The register-column count in
  [`cross-dataset-invariants.test.ts`](../src/ci/cross-dataset-invariants.test.ts)
  — an FOI-lane register snapshot bumps the total and the FOI count by one;
  open-data stays put.
- [`source-register.md`](source-register.md) — add a row for the new snapshot.
  **This one has no freshness test**, so nothing fails CI if you forget it; keep
  it current by hand as part of the same PR.

## Step 4 — verify

- `npm run foi:sweep` — re-derives every extract and normalised file from the
  committed bytes and byte-compares (must report `verified`).
- `npm run validate:data` — meta shape, byte integrity, no undeclared files,
  `relatedEntries` resolve, line accounting.
- The reconstruction oracle
  ([`reconstruction-oracle.test.ts`](../src/ci/reconstruction-oracle.test.ts)) —
  the source must reconstruct byte-identically from the ledger (modulo
  cosmetics). **Round-trip fidelity is non-negotiable.**
- The FOI golden master (`foi-normalise.test.ts`), `tsc --noEmit`, and `eslint`.

## Gotchas

- **Reference only siblings already on `main`.** The validator requires
  `relatedEntries` targets to exist, and the internal-link guard flags dead
  links. Two in-flight datasets that reference each other create a merge-order
  trap — add the bidirectional link once both have landed.
- **Verify "ignored" columns are actually empty** before ignoring them —
  don't assume. A column assumed empty may carry stray data on a few rows;
  preserve and document it rather than dropping it silently.
- **Do not use the live open-data ingest for a back-dated snapshot** — it
  clobbers the `latest-*` pointers.
- Long sweeps/folds should run in the foreground with a generous timeout.
