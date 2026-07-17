#!/usr/bin/env node

/**
 * Builds the published DOWNLOAD data tiers for the GitHub Pages site
 * (issue #149 item 4): the flat union CSV, one SQLite per archive entry, and
 * the combined database's gzipped download twin. These are the no-SQL and
 * archival download artefacts, not the range-queried runtime databases: the
 * interactive lookup/compare/browser/explore surfaces now read the
 * ledger-derived projection databases (src/v2/build-projection-db.ts, issue
 * #572), so the legacy runtime pair (callsigns.sqlite.png, combined.sqlite.png)
 * this build once served has been retired (issue #445). The download tiers'
 * own future - which artefacts continue to exist at all - is a decision
 * tracked on #630; their DERIVED-FILE INPUTS already resolve through the
 * archive/projection switch (src/shared/derived-entries.ts, issue #629), so
 * the tiers fold the same bytes whichever home the deploy selects and a
 * publication newer than the committed derivatives still reaches them.
 *
 * The combined database is still built here as the intermediate the gzipped
 * download twin (combined.sqlite.gz) compresses from, then removed in the
 * PUBLISH build so the runtime .png never reaches the deploy; the raw
 * verification build keeps it for the tiers oracle to read directly.
 *
 * DELIBERATELY NOT COMMITTED: SQLite files are not byte-deterministic, so
 * these artefacts live outside the golden-master lane - they are built fresh by
 * the Pages deploy workflow, derived from committed data.
 *
 * Usage: node src/ci/build-sqlite.ts [data-dir]
 */

import * as fs from 'fs';
import * as path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { parse } from 'csv-parse/sync';
import { CONSTANTS } from '../shared/utils.ts';
import { listArchiveKeys } from '../shared/archive.ts';
import { derivedEntryFile, derivedEntryFileExists, derivedEntryFileNamesPresent, isDerivedEntryFile } from '../shared/derived-entries.ts';
import { buildFoiObservations, renderObservationsCsvBuffer, OBSERVATION_VALUE_COLUMNS, type FoiObservationRow } from '../shared/foi-observations.ts';
import { time, timeAsync, perfReport } from '../shared/perf.ts';
import { gzipFileToFile, gzipBufferToFile, gzipManyFilesToFiles, type GzipJob } from '../shared/gzip.ts';
import { parseCsvCached } from '../shared/parse-cache.ts';
import { applyBuildPragmas } from '../shared/sqlite-build.ts';
import { cleanedCallsign, parseCallsign, loadReferenceData, normaliseLicenceCategory, componentsFlagsForRows, type ComponentRow } from '../sources/ofcom-amateur/components.ts';

// Gzip level for the published .gz download artefacts. The deploy uses maximum
// compression (level 9) for the smallest downloads; tests set
// TIERS_GZIP_LEVEL=1 for speed. The level is purely a size/time trade-off — any
// level decompresses to identical bytes — so the tiers tests, which verify the
// artefacts' CONTENTS (gunzip + row/query checks), not their size, are correct
// at any level and run far faster at level 1.
const GZIP_LEVEL = process.env.TIERS_GZIP_LEVEL !== undefined ? Number(process.env.TIERS_GZIP_LEVEL) : 9;

// Reference data is repo-anchored (same convention as the component parser).
const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const REFERENCE_DATA_DIR = path.join(REPO_ROOT, 'reference-data');

// Rows per multi-row INSERT statement. Each `.run()` is one JS→native crossing
// plus one bytecode execution, so binding N rows in a single statement instead
// of N statements cuts that fixed per-row overhead ~N-fold — the dominant cost
// once the whole load already rides in one transaction.
const INSERT_BATCH_ROWS = 2000;
// SQLite's bound-parameter ceiling (SQLITE_MAX_VARIABLE_NUMBER) is 32,766 in
// the library Node bundles - verified empirically: a 32,766-parameter INSERT
// prepares, 32,767 fails with "too many SQL variables". Stay comfortably
// under it so a wide table transparently shrinks its batch (BATCH × columns
// never nears the limit) rather than failing to prepare: at 30,000 the widest
// published table (19 columns) still batches ~1,500 rows per statement.
const MAX_BULK_PARAMS = 30_000;

// Insert many rows through a fixed-size multi-row prepared statement, with a
// single remainder statement for the tail so the count need not be a multiple
// of the batch size. Byte-identical to per-row inserts — a multi-row VALUES
// list is exactly sugar for the individual inserts, same rows in the same
// order — and shared by the combined, per-dataset and register-history loops.
// The caller owns the surrounding transaction; `tableToken` is the table
// identifier exactly as it must follow INSERT INTO (already quoted where the
// name needs it). `toValues` returns one row's column values, left to right.
function insertBatched<T>(
  db: DatabaseSync,
  tableToken: string,
  columnCount: number,
  items: readonly T[],
  toValues: (item: T, index: number) => (string | null)[],
): void {
  const n = items.length;
  if (n === 0) return;
  const batchRows = Math.max(1, Math.min(INSERT_BATCH_ROWS, Math.floor(MAX_BULK_PARAMS / columnCount)));
  const oneRow = `(${Array.from({ length: columnCount }, () => '?').join(', ')})`;
  const fullCount = n - (n % batchRows);
  let i = 0;
  if (fullCount > 0) {
    const bulk = db.prepare(`INSERT INTO ${tableToken} VALUES ${Array.from({ length: batchRows }, () => oneRow).join(', ')}`);
    const flat = new Array<string | null>(batchRows * columnCount);
    for (; i < fullCount; i += batchRows) {
      let p = 0;
      for (let k = 0; k < batchRows; k += 1) {
        const values = toValues(items[i + k], i + k);
        for (let c = 0; c < columnCount; c += 1) { flat[p] = values[c]; p += 1; }
      }
      bulk.run(...flat);
    }
  }
  if (i < n) {
    const single = db.prepare(`INSERT INTO ${tableToken} VALUES ${oneRow}`);
    for (; i < n; i += 1) single.run(...toValues(items[i], i));
  }
}

// The flag registry table in reference-data/flags.md is the single source of
// flag semantics; parse its markdown table so the lookup can explain flags.
export function parseFlagRegistry(): { flag: string; meaning: string; grounding: string }[] {
  const md = fs.readFileSync(path.join(REFERENCE_DATA_DIR, 'flags.md'), 'utf8');
  const rows: { flag: string; meaning: string; grounding: string }[] = [];
  for (const line of md.split('\n')) {
    const m = /^\| `([a-z-]+)` \| (.+) \| (.+) \|$/.exec(line.trim());
    if (m) rows.push({ flag: m[1], meaning: m[2], grounding: m[3] });
  }
  if (rows.length === 0) throw new Error('parsed zero flag-registry rows from reference-data/flags.md - table format changed?');
  return rows;
}

// The component fields FOI observations gain by running every callsign
// through the same parser the open-data lane uses (issue #171), so the
// anomaly flags and the component decomposition span both lanes. These are
// callsign-level determinations, so they apply to every callsign-bearing
// observation regardless of register state; register-state semantics stay
// per-class elsewhere.
const OBSERVATION_COMPONENT_COLUMNS = ['prefix_series', 'rsl', 'placeholder_form', 'implied_class', 'parse_status', 'flags'] as const;

export function fillObservations(db: DatabaseSync, rows: FoiObservationRow[]): number {
  const valueColumns = OBSERVATION_VALUE_COLUMNS.map(c => `"${c}" TEXT`).join(', ');
  const componentColumns = OBSERVATION_COMPONENT_COLUMNS.map(c => `"${c}" TEXT`).join(', ');
  // cleaned: the artefact-unifying join key (computed here at build - the
  // FOI committed files stay verbatim). A join key, not an identity:
  // duplicates are expected, so its index is plain, never UNIQUE.
  // normalised_licence_category: the canonical category the disclosed
  // licence_class collapses to (reference-data/licence-category.csv). A derived
  // view - the raw licence_class is still carried verbatim beside it; NULL where
  // no class is disclosed or none maps, so the distinction stays queryable.
  db.exec(`CREATE TABLE observations (callsign TEXT, cleaned TEXT, entry TEXT, source_file TEXT, dataset_classes TEXT, vintage TEXT, ${valueColumns}, ${componentColumns}, normalised_licence_category TEXT)`);

  // Parse each callsign through the shared component parser, grouped by entry
  // so the whole-set stripped-collision flag is scoped to one snapshot. The
  // FOI licence_class stands in for the open-data product column, so
  // class-product-mismatch fires where a class is disclosed and is simply
  // absent where it is not - per-schema, never assumed universal.
  const ref = loadReferenceData();
  const parsed = new Array<ComponentRow>(rows.length);
  const byEntry = new Map<string, number[]>();
  rows.forEach((row, i) => { const a = byEntry.get(row.entry); if (a) a.push(i); else byEntry.set(row.entry, [i]); });
  for (const idxs of byEntry.values()) {
    const comps = idxs.map(i => parseCallsign(rows[i].callsign, rows[i].values['licence_class'] ?? '', ref));
    componentsFlagsForRows(comps);
    idxs.forEach((i, k) => { parsed[i] = comps[k]; });
  }

  const columnCount = 6 + OBSERVATION_VALUE_COLUMNS.length + OBSERVATION_COMPONENT_COLUMNS.length + 1;
  db.exec('BEGIN');
  insertBatched(db, 'observations', columnCount, rows, (row, i) => {
    const c = parsed[i];
    return [
      row.callsign, cleanedCallsign(row.callsign), row.entry, row.sourceFile, row.datasetClasses, row.vintage,
      ...OBSERVATION_VALUE_COLUMNS.map(column => row.values[column] ?? null),
      c.prefixSeries, c.rsl, c.placeholderForm, c.impliedClass, c.parseStatus, c.flags.join(';'),
      normaliseLicenceCategory(row.values['licence_class'] ?? '', ref),
    ];
  });
  db.exec('COMMIT');
  db.exec('CREATE INDEX idx_observations_callsign ON observations("callsign")');
  db.exec('CREATE INDEX idx_observations_cleaned ON observations("cleaned")');
  db.exec('CREATE INDEX idx_observations_placeholder ON observations("placeholder_form")');
  return rows.length;
}

// The CSV file names one open-data entry's download database ingests: the
// entry's committed CSVs unioned with the derived per-entry files as resolved
// through the archive/projection switch (issue #629). In archive mode the
// derived files ARE the committed ones, so the union is a no-op; in projection
// mode it adds derived files an entry carries only in the projection (a
// publication newer than the frozen committed baseline) and never drops one.
// Exported (with the archiveDir seam) so the enumeration is unit-testable in
// both modes against a scratch corpus.
export function openDataEntryCsvNames(key: string, archiveDir: string = CONSTANTS.DIRS.archive): string[] {
  const names = new Set([
    ...fs.readdirSync(path.join(archiveDir, key)),
    ...derivedEntryFileNamesPresent(key, archiveDir),
  ].filter(file => file.endsWith('.csv')));
  return [...names].sort();
}

// Where one of those CSVs' bytes come from: derived files through the switch
// (projection when selected, committed archive otherwise - loud failure on a
// projection gap), everything else from the committed entry directory.
export function openDataEntryCsvPath(key: string, file: string, archiveDir: string = CONSTANTS.DIRS.archive): string {
  return isDerivedEntryFile(file) ? derivedEntryFile(key, file, archiveDir) : path.join(archiveDir, key, file);
}

// The remaining published tiers (issue #149 item 4 + the composed-stack
// decision): the mandatory flat union CSV, one SQLite per archive entry,
// and the combined database. All derived at deploy time, never committed.
// compress (default true) controls the PUBLISH packaging: the gzipped download
// twins (combined.sqlite.gz, the per-dataset .sqlite.gz, the union .csv.gz). The
// deploy needs them; the CI verification build passes compress:false to emit the
// raw databases + CSV only. That skips the two dominant, publish-only costs - the
// combined twin's gzip and the 45 per-dataset gzips (~61% of the build, measured
// #478) - none of which any data assertion depends on (they gunzip and compare
// CONTENTS, which the raw files carry directly). The tables/rows built are
// identical either way; only the on-disk packaging differs.
export async function buildPublishedTiers(dataDir: string, options: { compress?: boolean } = {}): Promise<Record<string, number>> {
  const compress = options.compress ?? true;
  const summary: Record<string, number> = {};
  const foiDir = path.join(CONSTANTS.DIRS.archive, 'foi');
  const observations = buildFoiObservations(foiDir);

  // Mandatory union CSV - the no-SQL consumption path. Published gzipped:
  // the plain text is several hundred MB, which alone would strain the Pages
  // 1 GB site cap alongside the published dataset files; .csv.gz keeps the
  // no-SQL property (universally decompressible) at a fraction of the size.
  // The union exceeds V8's maximum single-string length, so it is assembled
  // as a Buffer in row batches. The faithful NULL-vs-blank form lives in the
  // combined database.
  fs.mkdirSync(dataDir, { recursive: true });
  const unionBuffer = time('foi-observations:render', () => renderObservationsCsvBuffer(observations), observations.length);
  if (compress) {
    await timeAsync('gzip:union-csv', () => gzipBufferToFile(unionBuffer, path.join(dataDir, 'foi-observations.csv.gz'), GZIP_LEVEL), unionBuffer.length);
  } else {
    fs.writeFileSync(path.join(dataDir, 'foi-observations.csv'), unionBuffer);
  }
  summary['foi-observations.csv.gz rows'] = observations.length;

  // One database per archive entry (both lanes): every CSV in the entry
  // becomes a table named for its file (non-CSV files are in the dataset
  // pages, not the databases). Extension follows consumption path: these
  // exist for DOWNLOAD/archiving, not range-request querying, so they wear
  // their honest name, gzipped - only the site's range-queried databases
  // need the .png hosting workaround.
  const perDatasetDir = path.join(dataDir, 'datasets');
  fs.mkdirSync(perDatasetDir, { recursive: true });
  let perDataset = 0;
  // The per-dataset gzips are independent, so they are collected here and
  // compressed concurrently after every database is built (see below) rather
  // than one-at-a-time in this loop - the many-independent-files parallelism.
  const perDatasetGzipJobs: GzipJob[] = [];
  // Each entry contributes its CSV file NAMES and a per-name byte source. The
  // open-data lane's derived files (normalised.csv, components.csv) resolve
  // through the archive/projection switch: the union with the projection's
  // names means an entry whose derivatives exist only in the projection (a
  // publication newer than the frozen committed baseline) still ships them in
  // its download database, and in archive mode the union is a no-op. The FOI
  // lane stays a plain directory read (its derivatives are committed files,
  // not projected - the #445/#447 chain).
  const entryDirs: { name: string; csvNames: string[]; csvPath: (file: string) => string }[] = [
    ...listArchiveKeys().sort().map(key => ({
      name: `open-data--${key}`,
      csvNames: openDataEntryCsvNames(key),
      csvPath: (file: string) => openDataEntryCsvPath(key, file),
    })),
    ...fs.readdirSync(foiDir).filter(n => fs.statSync(path.join(foiDir, n)).isDirectory()).sort()
      .map((key) => {
        const dir = path.join(foiDir, key);
        return {
          name: `foi--${key}`,
          csvNames: fs.readdirSync(dir).filter(file => file.endsWith('.csv')).sort(),
          csvPath: (file: string) => path.join(dir, file),
        };
      }),
  ];
  for (const { name, csvNames, csvPath } of entryDirs) {
    const buildPath = path.join(perDatasetDir, `${name}.sqlite.tmp`);
    fs.rmSync(buildPath, { force: true });
    const db = new DatabaseSync(buildPath);
    applyBuildPragmas(db);
    let tables = 0;
    for (const file of csvNames) {
      const records = time('parse:per-dataset-csv', () => parse(fs.readFileSync(csvPath(file), 'utf8'), { columns: true, skip_empty_lines: true, bom: true }) as Record<string, string>[]);
      if (records.length === 0) continue;
      const columns = Object.keys(records[0]);
      const tableName = file.replace(/\.csv$/, '').replace(/[^a-zA-Z0-9]+/g, '_');
      db.exec(`CREATE TABLE "${tableName}" (${columns.map(c => `"${c}" TEXT`).join(', ')})`);
      time('sqlite:per-dataset-insert', () => {
        db.exec('BEGIN');
        insertBatched(db, `"${tableName}"`, columns.length, records, record => columns.map(c => record[c] ?? ''));
        db.exec('COMMIT');
      }, records.length);
      tables += 1;
    }
    db.close();
    if (tables > 0) {
      if (compress) {
        // Defer the gzip: the scratch database stays on disk until the parallel
        // batch below compresses it, then every buildPath is removed together.
        perDatasetGzipJobs.push({ inputPath: buildPath, outPath: path.join(perDatasetDir, `${name}.sqlite.gz`) });
      } else {
        // Raw database: keep it under its honest name, no gzip - the verification
        // build reads the tables directly.
        fs.renameSync(buildPath, path.join(perDatasetDir, `${name}.sqlite`));
        // No-op when renamed away (force); nothing else uses the scratch path.
        fs.rmSync(buildPath, { force: true });
      }
      perDataset += 1;
    } else {
      // No tables built: drop the empty scratch database.
      fs.rmSync(buildPath, { force: true });
    }
  }
  // Compress the per-dataset databases concurrently across cores, then remove the
  // scratch databases once their gzips exist.
  if (perDatasetGzipJobs.length > 0) {
    await timeAsync('gzip:per-dataset', () => gzipManyFilesToFiles(perDatasetGzipJobs, GZIP_LEVEL));
    for (const job of perDatasetGzipJobs) fs.rmSync(job.inputPath, { force: true });
  }
  summary['per-dataset databases'] = perDataset;

  // The combined database: the observations union + every open-data
  // publication's normalised rows as one dataset-keyed history table.
  const combinedPath = path.join(dataDir, 'combined.sqlite.png');
  fs.rmSync(combinedPath, { force: true });
  const combined = new DatabaseSync(combinedPath);
  applyBuildPragmas(combined);
  summary['combined observations'] = time('sqlite:combined-observations', () => fillObservations(combined, observations), observations.length);
  // Longitudinal join keys ride along: each publication's components.csv
  // contributes the derived cleaned (artefact-unifying) and suffix keys,
  // so cross-publication cohort queries (e.g. the forbidden-suffix
  // cohort) are runnable in SQL. cleaned is a JOIN KEY, not an identity -
  // duplicates are expected and deliberate (G6 FMU / G6FMU), so its
  // index is plain, never UNIQUE.
  const historyColumns = new Set<string>(['dataset', 'cleaned', 'suffix', 'implied_class', 'prefix_series', 'parse_status', 'normalised_licence_category']);
  const historyRef = loadReferenceData();
  // Derived-file reads resolve through the archive/projection switch: in
  // projection mode the register history folds the projection's bytes (proven
  // byte-identical to the committed files by the parity gate), so it spans
  // every folded publication - including one newer than the frozen committed
  // baseline. An entry with no derived register at all (a raw-only source with
  // no authored converter binding) is legitimately absent in either mode.
  const publications = time('parse:register-history', () => listArchiveKeys().sort()
    .filter(key => derivedEntryFileExists(key, 'normalised.csv'))
    .map((key) => {
      const componentKeys = new Map<string, { cleaned: string; suffix: string; impliedClass: string; prefixSeries: string; parseStatus: string }>(
        derivedEntryFileExists(key, 'components.csv')
          ? parseCsvCached(derivedEntryFile(key, 'components.csv'), { columns: true, skip_empty_lines: true })
            .map(c => [c.callsign, { cleaned: c.cleaned ?? cleanedCallsign(c.callsign), suffix: c.suffix ?? '', impliedClass: c.implied_class ?? '', prefixSeries: c.prefix_series ?? '', parseStatus: c.parse_status ?? '' }])
          : []);
      return {
        key,
        componentKeys,
        records: parseCsvCached(derivedEntryFile(key, 'normalised.csv'), { columns: true, skip_empty_lines: true }),
      };
    }));
  for (const publication of publications) {
    for (const column of Object.keys(publication.records[0] ?? {})) historyColumns.add(column);
  }
  // Per-publication scope facts, so consumers can interpret ABSENCE
  // honestly: a callsign missing from a declared-partial publication
  // (Ofcom has published 1,074-row truncations of a ~150k register) is
  // scope, not an event. intended_complete mirrors meta.json's
  // intendedCoverage.complete ('true'/'false'/'' when undeclared) - intent
  // as published, deliberately not verified quality. coverage_affecting
  // carries the statement of any VERIFIED-QUALITY observation that means
  // the publication omits records it claims to hold (the 2025-06-04
  // blank-product filter): absence there is not evidence, exactly as for a
  // declared-partial, even though intent said complete.
  combined.exec('CREATE TABLE history_datasets (dataset TEXT, record_count TEXT, intended_complete TEXT, scope_notes TEXT, coverage_affecting TEXT)');
  const insertDataset = combined.prepare('INSERT INTO history_datasets VALUES (?, ?, ?, ?, ?)');
  for (const publication of publications) {
    const metaPath = path.join(CONSTANTS.DIRS.archive, publication.key, 'meta.json');
    const meta = fs.existsSync(metaPath)
      ? JSON.parse(fs.readFileSync(metaPath, 'utf8')) as {
        intendedCoverage?: { complete: boolean; scopeNotes?: string };
        qualityObservations?: { statement: string; coverageAffecting?: boolean }[];
      }
      : {};
    const coverageAffecting = (meta.qualityObservations ?? [])
      .filter(o => o.coverageAffecting === true).map(o => o.statement).join(' ');
    insertDataset.run(
      publication.key,
      String(publication.records.length),
      meta.intendedCoverage === undefined ? '' : String(meta.intendedCoverage.complete),
      meta.intendedCoverage?.scopeNotes ?? '',
      coverageAffecting,
    );
  }

  const historyColumnList = [...historyColumns];
  combined.exec(`CREATE TABLE register_history (${historyColumnList.map(c => `"${c}" TEXT`).join(', ')})`);
  let historyRows = 0;
  time('sqlite:register-history-insert', () => {
    combined.exec('BEGIN');
    for (const publication of publications) {
      insertBatched(combined, 'register_history', historyColumnList.length, publication.records, record => {
        const keys = publication.componentKeys.get(record.callsign);
        return historyColumnList.map(c => {
          if (c === 'dataset') return publication.key;
          if (c === 'cleaned') return keys?.cleaned ?? cleanedCallsign(record.callsign ?? '');
          if (c === 'suffix') return keys?.suffix ?? '';
          if (c === 'implied_class') return keys?.impliedClass ?? '';
          if (c === 'prefix_series') return keys?.prefixSeries ?? '';
          if (c === 'parse_status') return keys?.parseStatus ?? '';
          if (c === 'normalised_licence_category') return normaliseLicenceCategory(record['product'] ?? '', historyRef);
          return record[c] ?? null;
        });
      });
      historyRows += publication.records.length;
    }
    combined.exec('COMMIT');
  });
  combined.exec('CREATE INDEX idx_register_history_callsign ON register_history("callsign")');
  combined.exec('CREATE INDEX idx_register_history_cleaned ON register_history("cleaned")');
  // Scoped-browser lookups filter one publication at a time
  // (WHERE dataset = ?); index it so the entry-page data browser reads
  // pages instead of scanning the whole cross-publication history.
  combined.exec('CREATE INDEX idx_register_history_dataset ON register_history("dataset")');

  // The withheld-suffix list rides into the combined so cohort queries
  // (join register_history/observations against it) run in one database.
  const combinedForbidden = parse(fs.readFileSync(path.join(REFERENCE_DATA_DIR, 'forbidden-suffixes.csv'), 'utf8'),
    { columns: true, skip_empty_lines: true }) as Record<string, string>[];
  combined.exec('CREATE TABLE ref_forbidden_suffixes (suffix TEXT)');
  const insertForbidden = combined.prepare('INSERT INTO ref_forbidden_suffixes VALUES (?)');
  combined.exec('BEGIN');
  for (const r of combinedForbidden) insertForbidden.run(r.suffix);
  combined.exec('COMMIT');
  combined.exec('CREATE INDEX idx_combined_forbidden ON ref_forbidden_suffixes("suffix")');
  summary['combined ref_forbidden_suffixes'] = combinedForbidden.length;
  summary['combined register_history'] = historyRows;
  combined.close();

  // Download twin of the combined: honest name, gzipped. The combined database
  // is built above only as the intermediate this twin compresses from - the
  // interactive surfaces now read the ledger-history projection (issue #572),
  // so the legacy combined.sqlite.png runtime database no longer serves the
  // site and must not reach the deploy (issue #445). Publish-only (the twin is
  // gzip of the raw database, so it can only ever gunzip back to it), so the
  // raw verification build skips both the gzip - the single most expensive step
  // in the build (#478) - and the removal, keeping the raw database for the
  // tiers oracle to read directly.
  if (compress) {
    // The single most expensive step (#478): one big stream, which zlib cannot
    // split across cores - so gzipFileToFile prefers pigz (all cores on one
    // stream) and streams a zlib fallback when pigz is absent.
    await timeAsync('gzip:combined', () => gzipFileToFile(combinedPath, path.join(dataDir, 'combined.sqlite.gz'), GZIP_LEVEL));
    // Drop the runtime .png once the download twin exists: it is retired from
    // the served site, so the deploy carries the twin only, not both.
    fs.rmSync(combinedPath, { force: true });
  }

  return summary;
}

if (import.meta.main) {
  const args = process.argv.slice(2).filter(a => a.trim().length > 0);
  const dataDir = args.find(a => !a.startsWith('--')) ?? path.join('_site', 'data');
  const tiers = await buildPublishedTiers(dataDir);
  console.log(`built the download data tiers into ${dataDir}`);
  for (const [what, n] of Object.entries(tiers)) console.log(`  tiers: ${what}: ${n}`);
  // Self-guarded: prints the profiling breakdown to stderr only under PERF.
  perfReport();
}
