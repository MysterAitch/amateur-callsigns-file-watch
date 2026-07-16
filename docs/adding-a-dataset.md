# Adding a dataset

How to add a new callsign dataset to the archive, end to end, so it validates
and its derived goldens stay current. This is the step-by-step companion to the
architecture in [ADR 0001](adr/0001-post-fetch-processing-in-repo.md)
(post-fetch processing), [ADR 0004](adr/0004-foi-source-lane.md) (the FOI
lane), [`data-flow.md`](data-flow.md) (the pipeline and its stage-gates) and
[`normalised-schema.md`](normalised-schema.md).

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

## Step 1 — choose the lane by WHAT the dataset is

- **Open-data lane** (`archive/{YYYY-MM-DD}/`): a publication of Ofcom's
  **open-data amateur callsign list** — however it was obtained. A live fetch
  is `provenance: "live"`; a copy recovered from a web archive is
  `provenance: "recovered-from-web-archive"` with `witnesses[]` recording the
  capture; a maintainer's retained download is
  `reconstructed-from-prior-download`. Historical recovered copies are how the
  older backlog here was populated; **back-dated insertion is supported** —
  older keys sort before the newest entry, so the `latest-*` pointers and the
  diff chain are untouched (a back-dated entry simply omits `diffSummary`,
  like `archive/2022-05-30/`).
- **FOI lane** (`archive/foi/{key}/`): material from an **FOI request or
  disclosure** — request-keyed entries with `meta.json` + `correspondence.md`
  always, data optional ([ADR 0004](adr/0004-foi-source-lane.md)).

The lane is chosen by what the dataset *is* (an open-data-page publication vs
FOI material), never by how it was fetched.

## Step 2 — add an open-data entry

Key the directory by the publication's data vintage: `archive/{YYYY-MM-DD}/`.

1. **Archive the publication verbatim, in the format Ofcom published.** A CSV
   is `raw.csv`; a workbook is `raw.xlsx` — the publisher's format is never
   converted away.

2. **Add a parse-source extract when the raw cannot be parsed directly**
   (declared in `files{}` with `role: "extract"`, `extractOf`, and
   `extractedBy` where a tool produced it):
   - A **workbook**: run the shared extractor —
     `node src/shared/xlsx-extract.ts archive/{date}` — which writes
     `raw-extract-sheet-N-{slug}.csv` and prints its bytes/sha256.
   - A **CSV with empty-named trailing columns** (a parser collapses duplicate
     empty header names, losing the true column count): commit a **shape-only
     header fill** — byte-for-byte the raw with only the empty header names
     filled (`unknown-1`, `unknown-2`, …) and LF line endings, **no data cell
     changed**.
   The sweep, validator, line accounting and ledger all parse the declared
   extract (`parseSourceFileName` in `src/shared/archive.ts`); entries without
   one parse `raw.csv` as always.

3. **Bind the converter when auto-detection cannot.** The lane's default is
   header auto-detection against the variant registry (`VARIANTS` in
   [`src/sources/ofcom-amateur/normalise.ts`](../src/sources/ofcom-amateur/normalise.ts)).
   A genuinely new header shape means a new registry variant (with tests).
   Two registered shapes that share identical headers but differ in date
   rendering (a workbook extract's ISO dates vs the CSV day-first rendering)
   are indistinguishable to auto-detection — the entry binds its variant
   explicitly in `meta.json`:

   ```json
   "converter": { "script": "src/sources/ofcom-amateur/normalise.ts", "variant": "v2026-licence-version-iso" }
   ```

   A bound variant is still verified against the actual headers — a wrong
   binding fails as loudly as an unknown shape. Registry variants may map a
   column to `null`: required-present export padding, not carried into the
   normalised projection (the ledger still carries every raw column verbatim).

4. **Hand-author `meta.json`** (template: `archive/2025-11-11/` for a
   recovered CSV, `archive/2026-01-14/` for a recovered workbook,
   `archive/2022-05-30/` for a prior-download reconstruction): `schemaVersion`,
   `sourceKey: "ofcom-amateur-callsigns"`, the honest `provenance`,
   `intendedCoverage`, `fetchedAt` (the retrieval time),
   `ofcomReportedUpdateIso` (the data vintage — also the date-plausibility
   bound), `publicationUrl`, `witnesses[]` (required for web-archive
   recoveries: channel, replay URL, fetchedAt), `reconstructionNotes`, and the
   `files{}` declarations (size + sha256 for the raw and any extract). **No
   `diffSummary`** on a back-dated entry.

   A witness's `channel` is a **validated closed vocabulary**, not free text:
   every channel token must resolve to a publisher entry in
   [`reference-data/publishers.json`](../reference-data/publishers.json), and
   `npm run validate:data` fails loudly on one that does not. Check the
   register for the current valid tokens, and add a publisher entry there
   before introducing a new channel.

5. **Attest what the data genuinely carries.** If the publication repeats
   callsigns (publisher duplicates), validation fails until a curated
   `qualityObservations[]` entry attests the fact (a statement mentioning the
   duplicate callsigns + evidence) — duplicates are preserved faithfully,
   never repaired, but always loudly. Verify — never assume — that "padding"
   columns are actually empty before ignoring them; document any stray
   content.

6. **Generate the derived files:** `npm run normalise:sweep` produces
   `normalised.csv`, `components.csv`, `stats.json` and augments `meta.json`.
   A second run must be a no-op (`changed=0`) — that is the byte-determinism
   check.

## Step 2b — add an FOI entry

The FOI lane's converter binding lives in `FOI_ENTRY_CONVERSIONS`
(`src/shared/foi-normalise.ts`), bound per entry via `meta.json`'s
`converter: {script, variant}`; entries carry `correspondence.md` (role
`transcript`) always, per-file roles/hashes, and per-file `witnesses[]`. Every
FOI `meta.json` also declares a top-level `datasetClasses` array against the
vocabulary in
[`foi-schemas.md`](foi-schemas.md#dataset-classes-entry-level-vocabulary) —
the same field the [scheduled dataset-class labels](../CONTRIBUTING.md#dataset-class-labels)
mirror onto the entry's PR. Generate the normalised file with
`node src/shared/foi-normalise.ts archive/foi/{key}` and verify with
`npm run foi:sweep`. Template entries:
`archive/foi/ofcom-2025-09-11--callsigns--all-callsigns` (workbook),
`archive/foi/ofcom-2024-04-30--copy-all-callsigns--all-callsigns` (CSV).

## Step 3 — regenerate the corpus goldens

Adding a dataset shifts several corpus-wide goldens. These trip CI **by
design** (a new dataset must be noticed, not slip through), so regenerate and
commit them in the same PR — the diffs are the reviewable evidence. Run:

```
npm run regen          # normalise:sweep + foi:schemas + dataset:status
```

That covers `reports/**` (the golden-master gate; the sweep is the slow step —
several minutes, whole-corpus DuckDB folds), `docs/dataset-status.md` and
`docs/foi-schemas.md`.

Then hand-update the **hand-authored goldens** the sweep does not regenerate:

- `EXPECTED_CATEGORIES` in
  [`value-catalogue-fold.test.ts`](../src/ci/value-catalogue-fold.test.ts) —
  the licence-category legacy + folded figures. Running that test on a drift
  prints a paste-ready block; copy it in (variants and reasons are unchanged).
- The register-column count in
  [`cross-dataset-invariants.test.ts`](../src/ci/cross-dataset-invariants.test.ts)
  — a register snapshot bumps the total and its lane's count by one.
- [`source-register.md`](source-register.md) — add a row for the new dataset.
  **This one has no freshness test**, so nothing fails CI if you forget it;
  keep it current by hand as part of the same PR.
- Neighbour-sensitive page expectations (e.g. the newest entry's
  "Compare with" baseline in
  [`build-dataset-pages.test.ts`](../src/ci/build-dataset-pages.test.ts))
  when the new entry changes an existing entry's chronological neighbour.

## Step 4 — verify

- `npm run normalise:sweep` twice — the second run must report `changed=0`.
- `npm run validate:data` — meta shape, witnesses, byte integrity, extract
  declarations, line accounting against the parse source, attested-duplicates
  policy. (FOI lane: `npm run foi:sweep` re-derives every extract and
  normalised file byte-identically.)
- The reconstruction oracle
  ([`reconstruction-oracle.test.ts`](../src/ci/reconstruction-oracle.test.ts))
  — the source must reconstruct byte-identically from the ledger (modulo
  cosmetics). **Round-trip fidelity is non-negotiable**; a manual, recorded
  step (like the shape-only extract) to achieve it is fine.
- `tsc --noEmit` and `eslint` when the converter registry changed.

## Gotchas

- **Reference only siblings already on `main`.** The validator requires
  referenced entries to exist, and the internal-link guard flags dead links.
  Two in-flight datasets that reference each other create a merge-order trap —
  add the bidirectional link once both have landed.
- **Verify "ignored" columns are actually empty** before ignoring them — a
  column assumed empty may carry stray data on a few rows; preserve and
  document it rather than dropping it silently.
- **Do not use the live open-data ingest (`npm run process`) for a back-dated
  entry** — it derives the key from download metadata and rewrites the
  `latest-*` pointers unconditionally. Hand-author the entry and let the sweep
  generate the derivations.
- Long sweeps/folds should run in the foreground with a generous timeout.
