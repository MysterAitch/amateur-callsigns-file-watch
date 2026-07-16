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

   Beyond `channel`/`url`/`fetchedAt`, a witness carries two optional fields:
   `sha256` — the hash of the bytes *that witness served* — and
   `originalFilename` — the name the copy carried at its source (provenance the
   held filename may itself have sanitised away). Neither is required, but
   together they let a witness's **agreement** with the held copy be *derived
   on read* (`src/shared/witness-agreement.ts`), never hand-declared:

   - no `sha256` → **citation-grade** (a location only, unverified);
   - `sha256` matches a held copy's hash → **corroborating** (byte-identity
     mechanically proven);
   - `sha256` matches no held copy → **divergent** (a genuinely differing
     copy).

   A **divergent** witness cannot stand alone: it must be paired with an
   entry-level `divergences[]` record (`file`, a `counterpart` naming the
   diverging publisher/url/sha256, a `level` — `bytes`/`cells`/`rows`/
   `format-shifted` — and a plain-English `summary`) whose counterpart hash
   equals the witness's. An unpaired divergent witness — a differing hash with
   no explanation — is a hard validation failure by design (the fail-fast-
   fail-loud rule, issues #618/#619): a copy that disagrees with the held bytes
   is exactly the case that must never pass silently.

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
`transcript`) always, per-file roles/hashes, and per-file `witnesses[]` (same
schema, agreement classes and divergence-pairing rule as the open-data lane's
entry-level witnesses — see step 4). Every
FOI `meta.json` also declares a top-level `datasetClasses` array against the
vocabulary in
[`foi-schemas.md`](foi-schemas.md#dataset-classes-entry-level-vocabulary) —
the same field the [scheduled dataset-class labels](../CONTRIBUTING.md#dataset-class-labels)
mirror onto the entry's PR.

**Bind the parse source when the raw cannot be parsed directly**, exactly as the
open-data lane does (step 2, point 2): declare the extract in `files{}` with
`role: "extract"`, `extractOf` (the raw it derives from) and `extractedBy`
(the tool, where one produced it). The raw stays the truth; the extract is only
the parse source. Three extract idioms are in use:

- a **workbook** → the shared extractor (`node src/shared/xlsx-extract.ts
  archive/foi/{key}`), writing `raw-extract-sheet-N-{slug}.csv`;
- a **spreadsheet Save-As-PDF table** — the **PDF-disclosure class** (#668) —
  → the PDF-table extractor
  [`src/shared/pdf-table-extract.ts`](../src/shared/pdf-table-extract.ts): the
  raw PDF stays the truth and a byte-deterministic CSV transcription is
  committed as the parse source (`role: "extract"`, `extractOf` the PDF,
  `extractedBy: "src/shared/pdf-table-extract.ts"`). The extractor runs a full
  content-stream interpreter (Node built-ins only, no third-party PDF library),
  so any deviation from the expected table shape **surfaces loudly** rather than
  mis-parsing. Its committed **self-check**
  ([`pdf-table-extract.test.ts`](../src/shared/pdf-table-extract.test.ts))
  re-runs it over the committed PDF and asserts the CSV reproduces
  byte-identically, with the reconciliation arithmetic as assertions — row and
  text-operator totals, the per-status counts, the recurring/blank-key/oddity
  counts, and the page-1 opening anchor. Reach for this class when a disclosure
  arrives **only** as a PDF rendering of a table and no native workbook/CSV
  attachment can be obtained (check WhatDoTheyKnow and the disclosure log first);
- a **letter or prose PDF** → a mechanical markdown transcription
  (`raw-extract-*.md`, `role: "extract"`, `extractOf` the letter; substantive
  text verbatim, standard boilerplate footer omitted and noted), or a
  **markdown-table transcription** for a tabular PDF the interpreter does not
  cover (bound as the converter's `markdown-table` parse source — see the
  `wdtk-184767`/`wdtk-251507` variants in [`foi-schemas.md`](foi-schemas.md)).

Generate the normalised file with
`node src/shared/foi-normalise.ts archive/foi/{key}` and verify with
`npm run foi:sweep` (it re-derives every extract and normalised file
byte-identically). Template entries:
`archive/foi/ofcom-2025-09-11--callsigns--all-callsigns` (workbook),
`archive/foi/ofcom-2024-04-30--copy-all-callsigns--all-callsigns` (CSV),
`archive/foi/ofcom-2020-04-23--club-call-signs` (a Save-As-PDF disclosure with
a byte-deterministic CSV extract and a transcribed response letter).

## Step 2c — collect corroborating or divergent copies (optional)

Independent of adding an entry, the mirror **collects copies** of publications
it already holds: a second copy from another channel either corroborates the
held bytes or is a genuinely divergent copy that must be recorded. The
collection tooling — [`src/tools/collect-witness.ts`](../src/tools/collect-witness.ts)
(#618/#619) — makes that mechanical. Given a URL and the held file the copy
claims to be, it fetches the bytes, hashes them, compares the hash against the
bytes the mirror already holds, and emits the declaration the metadata needs:

```
node src/tools/collect-witness.ts \
  --url <copy-url> --publisher <register-id> --held-file <name> --held <sha256>…
```

- **Byte-identical to a held copy → a corroborating witness.** It emits a
  `witnesses[]` record (`channel`, `url`, `fetchedAt`, `sha256`,
  `originalFilename`) to add to the held file — the copy is **not** stored a
  second time (store-once, witness-many). The `channel` is resolved through the
  register (`--channel` is required only when the publisher owns several
  channels).
- **Differing at all (even one byte) → a divergent copy.** It emits a
  `role: "divergent-copy"` file declaration (`divergesFrom` the faithful held
  copy) plus a **stub `divergences[]` record** to complete by hand — the tool
  can prove *that* a copy differs, never *what* differs, so the `summary` and
  `enumeration` land as `TODO` to be characterised by hand (the
  divergence-pairing rule in step 4 then holds until they are filled in).

Fetching is courtesy-paced by design: one request per URL, an honest
identifying User-Agent (no browser spoof — WhatDoTheyKnow rejects those), a
hard abort on the first blocking status (403/429/5xx), and a pause between
sequential requests to one host. A 404/410 is a legitimate "not held" answer,
not a block.

**When a copy cannot yet be redistributed** (its redistribution basis is not
cleared), reach for `--local-only`: the bytes are held in the **gitignored**
`archive/local-holdings/bytes/` area and their existence is recorded in the
**public** index [`archive/local-holdings/index.json`](../archive/local-holdings/index.json)
(sha256, size, `originalFilename`, `publisher`, `obtainFrom`, `fetchedAt`,
`withheldReason`), so the availability claim stays public and re-verifiable
even though the bytes are withheld. Republication is always a deliberate,
manual, per-item decision — never performed by the tool.

Reach for this tooling to **corroborate or record a copy of an
already-held publication**; it does not graduate a new dataset. A copy that
turns out to be a genuinely new publication (a new vintage, a new shape) is a
full entry via step 2 or 2b, not a witness.

## Step 3 — regenerate the corpus goldens

Adding a dataset shifts several corpus-wide goldens. These trip CI **by
design** (a new dataset must be noticed, not slip through), so regenerate and
commit them in the same PR — the diffs are the reviewable evidence. Run:

```
npm run regen          # normalise:sweep + foi:schemas + dataset:status
```

That covers `reports/**` (the golden-master gate; the sweep is the slow step —
several minutes, whole-corpus DuckDB folds): the new entry's own
`reports/entries/{key}.md` drill-down, the cross-lane
[`reports/value-catalogue.md`](../reports/value-catalogue.md) and
[`reports/data-quality.md`](../reports/data-quality.md), and the standing
reports (`prefixes.md`, `regional-identifiers.md`, `class-product-mismatches.md`,
`callsign-patterns.md`, `forbidden-suffix-history.md`, `cross-dataset-invariants.md`,
`README.md`) — plus `docs/dataset-status.md` and `docs/foi-schemas.md` (the
latter re-rendered from the converter registry). **Every** dataset — open-data
or FOI — trips the `reports/**` set, so run `regen` on any intake.

Then hand-update the **hand-authored goldens** the sweep does not regenerate.
Each fires only when the intake actually shifts it, so check every one against
this dataset — the historical pain was discovering them one CI round at a time:

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
- `npm run validate:data` — meta shape, witnesses (including that every
  divergent witness is paired with a `divergences[]` record), byte integrity,
  extract declarations, line accounting against the parse source,
  attested-duplicates policy. (FOI lane: `npm run foi:sweep` re-derives every
  extract and normalised file byte-identically.)
- The reconstruction oracle
  ([`reconstruction-oracle.test.ts`](../src/ci/reconstruction-oracle.test.ts))
  — the source must reconstruct byte-identically from the ledger (modulo
  cosmetics). **Round-trip fidelity is non-negotiable**; a manual, recorded
  step (like the shape-only extract) to achieve it is fine.
- `tsc --noEmit` and `eslint` when the converter registry changed.

## Publisher-register touchpoints

When an intake records a witness on a **new channel** — or names a **new
publisher** in a `divergences[]` counterpart or the local-holdings index — that
channel and publisher must exist in
[`reference-data/publishers.json`](../reference-data/publishers.json) **first**,
or `validate:data` fails loudly (`src/ci/validate-publishers.ts` enforces that
every witness channel across both lanes resolves to exactly one publisher). Add
the entry with a stable `id`, `name`, `roles`, the `channels` token(s) the
witness uses, an `authorityCeiling` (the [ADR 0014](adr/0014-trust-rating-safety-net.md)
rung material witnessed only via this publisher may at most carry), and the
licence fields.

A publisher's `licenceStatement`/`licenceBasis` is a **public claim about
another party's terms**, so cite the governing terms in `licenceUrl`; where a
basis has not been established, record it as `unverified` rather than asserting
one (fail-honest). The basis is the publisher's default/typical one — a specific
publication may override it. Adding or renaming a publisher also shifts the
deploy-time About-page acknowledgement generated from the register:
[`build-about-acknowledgement.test.ts`](../src/ci/build-about-acknowledgement.test.ts)
asserts the About page names every publisher and its licence basis, so a
register edit that leaves the page stale fails there. The register's own
provenance discipline is in
[`reference-data/README.md`](../reference-data/README.md#publishersjson--the-publisher-register-618).

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
- **Commit the raw bytes verbatim, first.** The publisher's exact bytes are the
  authoritative record and are admitted on **provenance, not processability**
  ([ADR 0001](adr/0001-post-fetch-processing-in-repo.md),
  [ADR 0010](adr/0010-archive-contract.md)): a raw you cannot yet parse is still
  archived, with the parse deferred to a committed extract (step 2 point 2,
  step 2b). Every derivation — extract, `normalised.csv`, reports — must
  regenerate from that raw; never edit the raw to make a converter happy.
- **Fetching is unrestricted; redistribution is gated.** Opportunistically
  fetching a copy is fine (equivalent to viewing it), but never commit bytes
  whose redistribution basis is not cleared — hold them in the gitignored
  local-holdings area with a public index entry instead
  (`collect-witness --local-only`, step 2c). Republication is a deliberate,
  manual, per-item decision.
- **Link the PR to its issue** ([CONTRIBUTING](../CONTRIBUTING.md)): `Closes #N`
  when the PR fully resolves the issue, `Addresses #N` / `Part of #N` with what
  remains for a partial contribution (multiple targeted PRs to one issue are
  fine). Include the reviewable evidence — before/after counts, the regenerated
  diffs — in the body.
- Long sweeps/folds should run in the foreground with a generous timeout.
