#!/usr/bin/env node

/**
 * Builds the published SQLite database for the GitHub Pages lookup
 * (issue #17 proof of concept): the latest dataset's normalised rows and
 * components, statistics for every dataset, and the reference-data tables -
 * everything the presentation stratum needs to answer "tell me about
 * M7TEE" with one database.
 *
 * DELIBERATELY NOT COMMITTED: SQLite files are not byte-deterministic, so
 * the database lives outside the golden-master lane - it is built fresh by
 * the Pages deploy workflow as an artefact, derived from committed data.
 *
 * Usage: node src/ci/build-sqlite.ts [output-path]
 */

import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { DatabaseSync } from 'node:sqlite';
import { parse } from 'csv-parse/sync';
import { CONSTANTS } from '../shared/utils.ts';
import { listArchiveKeys } from '../shared/archive.ts';
import { type EntryStats } from '../shared/stats.ts';
import { buildFoiObservations, renderObservationsCsvBuffer, OBSERVATION_VALUE_COLUMNS, type FoiObservationRow } from '../shared/foi-observations.ts';
import { time, perfReport } from '../shared/perf.ts';
import { parseCsvCached } from '../shared/parse-cache.ts';
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

// Shared with the register-history table below through the process-wide parse
// memo, so the newest publication's normalised.csv and components.csv - parsed
// here for the latest-dataset tables and again for the history table - are read
// once. Callers that want the parse attributed to a perf label wrap the call
// themselves (parse:register / parse:components); reference-data reads stay
// untimed, exactly as before.
function readCsv(filePath: string): Record<string, string>[] {
  return parseCsvCached(filePath, { columns: true, skip_empty_lines: true });
}

// Rows per multi-row INSERT statement. Each `.run()` is one JS→native crossing
// plus one bytecode execution, so binding N rows in a single statement instead
// of N statements cuts that fixed per-row overhead ~N-fold — the dominant cost
// once the whole load already rides in one transaction.
const INSERT_BATCH_ROWS = 500;
// SQLite's bundled bound-parameter ceiling is 32,766; stay well under it so a
// wide table transparently shrinks its batch (BATCH × columns never nears the
// limit) rather than failing to prepare.
const MAX_BULK_PARAMS = 20_000;

// Insert many rows through a fixed-size multi-row prepared statement, with a
// single remainder statement for the tail so the count need not be a multiple
// of the batch size. Byte-identical to per-row inserts — a multi-row VALUES
// list is exactly sugar for the individual inserts, same rows in the same
// order — and shared by the master, per-dataset and register-history loops.
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

export function buildSqlite(outputPath: string): { datasetKey: string; tables: Record<string, number> } {
  const keys = listArchiveKeys().sort();
  const newest = keys[keys.length - 1];
  if (newest === undefined) throw new Error('no archive entries found');

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.rmSync(outputPath, { force: true });
  const db = new DatabaseSync(outputPath);
  const counts: Record<string, number> = {};

  const createAndFill = (table: string, columns: string[], rows: string[][], indexColumn?: string): void => {
    db.exec(`CREATE TABLE ${table} (${columns.map(c => `"${c}" TEXT`).join(', ')})`);
    // One transaction per table: without it every insert commits separately
    // and a 158k-row table takes minutes instead of milliseconds.
    time('sqlite:createAndFill-insert', () => {
      db.exec('BEGIN');
      insertBatched(db, table, columns.length, rows, row => row);
      db.exec('COMMIT');
    }, rows.length);
    if (indexColumn) db.exec(`CREATE INDEX idx_${table}_${indexColumn} ON ${table}("${indexColumn}")`);
    counts[table] = rows.length;
  };

  const objectRows = (records: Record<string, string>[], columns: string[]): string[][] =>
    records.map(r => columns.map(c => r[c] ?? ''));

  // Latest dataset: normalised + components, joined by callsign.
  const normalisedRecords = time('parse:register', () => readCsv(path.join(CONSTANTS.DIRS.archive, newest, 'normalised.csv')));
  const normalisedColumns = Object.keys(normalisedRecords[0]);
  createAndFill('normalised', normalisedColumns, objectRows(normalisedRecords, normalisedColumns), 'callsign');

  const componentRecords = time('parse:components', () => readCsv(path.join(CONSTANTS.DIRS.archive, newest, 'components.csv')));
  const componentColumns = Object.keys(componentRecords[0]);
  createAndFill('components', componentColumns, objectRows(componentRecords, componentColumns), 'callsign');
  // Second lookup path: the RSL-placeholder form unifies every regional
  // rendering of a callsign, so variant searches are one indexed equality.
  db.exec('CREATE INDEX idx_components_placeholder ON components("placeholder_form")');
  // Third lookup path: suffix search (*TEE) powers the availability matrix.
  db.exec('CREATE INDEX idx_components_suffix ON components("suffix")');
  // Fourth: the artefact-unifying cleaned key ("did you mean" recovery -
  // whitespace/encoding-artefact rows found from a clean search input).
  // Plain index, never UNIQUE: duplicates are expected and deliberate.
  db.exec('CREATE INDEX idx_components_cleaned ON components("cleaned")');

  // Statistics for EVERY dataset (long format - easy to pivot in SQL).
  const datasets: string[][] = [];
  const statsFlags: string[][] = [];
  const statsStatuses: string[][] = [];
  const statsPatterns: string[][] = [];
  for (const key of keys) {
    const statsPath = path.join(CONSTANTS.DIRS.archive, key, 'stats.json');
    if (!fs.existsSync(statsPath)) continue;
    const stats = JSON.parse(fs.readFileSync(statsPath, 'utf8')) as EntryStats;
    datasets.push([key, String(stats.recordCount), String(stats.statsSchemaVersion)]);
    for (const [flag, count] of Object.entries(stats.callsignFlags ?? {})) statsFlags.push([key, flag, String(count)]);
    for (const [status, count] of Object.entries(stats.parseStatuses ?? {})) statsStatuses.push([key, status, String(count)]);
    for (const [pattern, count] of Object.entries(stats.callsignPatterns)) statsPatterns.push([key, pattern, String(count)]);
  }
  createAndFill('datasets', ['key', 'record_count', 'stats_schema_version'], datasets);
  createAndFill('stats_flags', ['dataset', 'flag', 'count'], statsFlags, 'flag');
  createAndFill('stats_statuses', ['dataset', 'status', 'count'], statsStatuses);
  createAndFill('stats_patterns', ['dataset', 'pattern', 'count'], statsPatterns, 'pattern');

  // Reference data (the meanings the lookup joins against).
  const ref = (name: string): Record<string, string>[] => readCsv(path.join(REFERENCE_DATA_DIR, name));
  const rsl = ref('rsl.csv');
  createAndFill('ref_rsl', Object.keys(rsl[0]), objectRows(rsl, Object.keys(rsl[0])), 'rsl');
  const prefixes = ref('prefix-formats.csv');
  createAndFill('ref_prefix_formats', Object.keys(prefixes[0]), objectRows(prefixes, Object.keys(prefixes[0])), 'prefix');
  const special = ref('special-formats.csv');
  createAndFill('ref_special_formats', Object.keys(special[0]), objectRows(special, Object.keys(special[0])));
  const forbidden = ref('forbidden-suffixes.csv');
  createAndFill('ref_forbidden_suffixes', ['suffix'], forbidden.map(r => [r.suffix]), 'suffix');
  const itu = ref('itu-call-sign-series.csv');
  createAndFill('itu_series', ['series', 'allocated_to'], itu.map(r => [r.series, r.allocated_to]));

  const registry = parseFlagRegistry();
  createAndFill('flag_registry', ['flag', 'meaning', 'grounding'], registry.map(r => [r.flag, r.meaning, r.grounding]), 'flag');

  // Precomputed primary-by-secondary locator matrix: a GROUP BY over the
  // full components table would be prohibitively chatty over the site's
  // range-request VFS, so the handful of aggregate rows ship ready-made.
  time('sqlite:aggregate-tables', () => {
  db.exec(`CREATE TABLE rsl_matrix AS
    SELECT prefix_series AS series, rsl, COUNT(*) AS n
    FROM components WHERE parse_status = 'parsed'
    GROUP BY prefix_series, rsl`);
  counts['rsl_matrix'] = Number((db.prepare('SELECT COUNT(*) AS c FROM rsl_matrix').get() as { c: number | bigint }).c);

  // Matrix elaborations, also precomputed for the same reason: exclusion
  // counts for the caption, capped example lists, and the (few) RSL-bearing
  // rows enumerated in full - the interesting finds behind a details block.
  db.exec(`CREATE TABLE matrix_excluded AS
    SELECT parse_status AS status, COUNT(*) AS n
    FROM components WHERE parse_status != 'parsed'
    GROUP BY parse_status`);
  db.exec(`CREATE TABLE excluded_examples AS
    SELECT status, callsign FROM (
      SELECT parse_status AS status, callsign,
             ROW_NUMBER() OVER (PARTITION BY parse_status ORDER BY callsign) AS rn
      FROM components WHERE parse_status != 'parsed'
    ) WHERE rn <= 50`);
  db.exec(`CREATE TABLE rsl_bearing AS
    SELECT callsign, prefix_series AS series, rsl
    FROM components WHERE parse_status = 'parsed' AND rsl != ''
    ORDER BY callsign`);
  for (const table of ['matrix_excluded', 'excluded_examples', 'rsl_bearing']) {
    counts[table] = Number((db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number | bigint }).c);
  }
  });

  db.exec('CREATE TABLE build_info (key TEXT, value TEXT)');
  const info = db.prepare('INSERT INTO build_info VALUES (?, ?)');
  info.run('dataset', newest);
  info.run('generated_at', new Date().toISOString());
  info.run('commit', process.env.GITHUB_SHA ?? 'local');

  db.close();
  return { datasetKey: newest, tables: counts };
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

// The remaining published tiers (issue #149 item 4 + the composed-stack
// decision): the mandatory flat union CSV, one SQLite per archive entry,
// and the master database. All derived at deploy time, never committed.
// compress (default true) controls the PUBLISH packaging: the gzipped download
// twins (master.sqlite.gz, the per-dataset .sqlite.gz, the union .csv.gz). The
// deploy needs them; the CI verification build passes compress:false to emit the
// raw databases + CSV only. That skips the two dominant, publish-only costs - the
// master twin's gzip and the 45 per-dataset gzips (~61% of the build, measured
// #478) - none of which any data assertion depends on (they gunzip and compare
// CONTENTS, which the raw files carry directly). The tables/rows built are
// identical either way; only the on-disk packaging differs.
export function buildPublishedTiers(dataDir: string, options: { compress?: boolean } = {}): Record<string, number> {
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
  // master database.
  fs.mkdirSync(dataDir, { recursive: true });
  const unionBuffer = time('foi-observations:render', () => renderObservationsCsvBuffer(observations), observations.length);
  if (compress) {
    fs.writeFileSync(path.join(dataDir, 'foi-observations.csv.gz'), time('gzip:union-csv', () => zlib.gzipSync(unionBuffer, { level: GZIP_LEVEL }), unionBuffer.length));
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
  const entryDirs: { name: string; dir: string }[] = [
    ...listArchiveKeys().sort().map(key => ({ name: `open-data--${key}`, dir: path.join(CONSTANTS.DIRS.archive, key) })),
    ...fs.readdirSync(foiDir).filter(n => fs.statSync(path.join(foiDir, n)).isDirectory()).sort()
      .map(key => ({ name: `foi--${key}`, dir: path.join(foiDir, key) })),
  ];
  for (const { name, dir } of entryDirs) {
    const buildPath = path.join(perDatasetDir, `${name}.sqlite.tmp`);
    fs.rmSync(buildPath, { force: true });
    const db = new DatabaseSync(buildPath);
    let tables = 0;
    for (const file of fs.readdirSync(dir).sort()) {
      if (!file.endsWith('.csv')) continue;
      const records = time('parse:per-dataset-csv', () => parse(fs.readFileSync(path.join(dir, file), 'utf8'), { columns: true, skip_empty_lines: true, bom: true }) as Record<string, string>[]);
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
        fs.writeFileSync(path.join(perDatasetDir, `${name}.sqlite.gz`), time('gzip:per-dataset', () => zlib.gzipSync(fs.readFileSync(buildPath), { level: GZIP_LEVEL })));
      } else {
        // Raw database: keep it under its honest name, no gzip - the verification
        // build reads the tables directly.
        fs.renameSync(buildPath, path.join(perDatasetDir, `${name}.sqlite`));
      }
      perDataset += 1;
    }
    // No-op when renamed away (force); removes the scratch DB in the compress path.
    fs.rmSync(buildPath, { force: true });
  }
  summary['per-dataset databases'] = perDataset;

  // The master database: the observations union + every open-data
  // publication's normalised rows as one dataset-keyed history table.
  const masterPath = path.join(dataDir, 'master.sqlite.png');
  fs.rmSync(masterPath, { force: true });
  const master = new DatabaseSync(masterPath);
  summary['master observations'] = time('sqlite:master-observations', () => fillObservations(master, observations), observations.length);
  // Longitudinal join keys ride along: each publication's components.csv
  // contributes the derived cleaned (artefact-unifying) and suffix keys,
  // so cross-publication cohort queries (e.g. the forbidden-suffix
  // cohort) are runnable in SQL. cleaned is a JOIN KEY, not an identity -
  // duplicates are expected and deliberate (G6 FMU / G6FMU), so its
  // index is plain, never UNIQUE.
  const historyColumns = new Set<string>(['dataset', 'cleaned', 'suffix', 'implied_class', 'prefix_series', 'parse_status', 'normalised_licence_category']);
  const historyRef = loadReferenceData();
  const publications = time('parse:register-history', () => listArchiveKeys().sort()
    .map(key => ({ key, path: path.join(CONSTANTS.DIRS.archive, key, 'normalised.csv') }))
    .filter(p => fs.existsSync(p.path))
    .map(p => {
      const componentsPath = path.join(CONSTANTS.DIRS.archive, p.key, 'components.csv');
      const componentKeys = new Map<string, { cleaned: string; suffix: string; impliedClass: string; prefixSeries: string; parseStatus: string }>(
        fs.existsSync(componentsPath)
          ? parseCsvCached(componentsPath, { columns: true, skip_empty_lines: true })
            .map(c => [c.callsign, { cleaned: c.cleaned ?? cleanedCallsign(c.callsign), suffix: c.suffix ?? '', impliedClass: c.implied_class ?? '', prefixSeries: c.prefix_series ?? '', parseStatus: c.parse_status ?? '' }])
          : []);
      return {
        key: p.key,
        componentKeys,
        records: parseCsvCached(p.path, { columns: true, skip_empty_lines: true }),
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
  master.exec('CREATE TABLE history_datasets (dataset TEXT, record_count TEXT, intended_complete TEXT, scope_notes TEXT, coverage_affecting TEXT)');
  const insertDataset = master.prepare('INSERT INTO history_datasets VALUES (?, ?, ?, ?, ?)');
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
  master.exec(`CREATE TABLE register_history (${historyColumnList.map(c => `"${c}" TEXT`).join(', ')})`);
  let historyRows = 0;
  time('sqlite:register-history-insert', () => {
    master.exec('BEGIN');
    for (const publication of publications) {
      insertBatched(master, 'register_history', historyColumnList.length, publication.records, record => {
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
    master.exec('COMMIT');
  });
  master.exec('CREATE INDEX idx_register_history_callsign ON register_history("callsign")');
  master.exec('CREATE INDEX idx_register_history_cleaned ON register_history("cleaned")');
  // Scoped-browser lookups filter one publication at a time
  // (WHERE dataset = ?); index it so the entry-page data browser reads
  // pages instead of scanning the whole cross-publication history.
  master.exec('CREATE INDEX idx_register_history_dataset ON register_history("dataset")');

  // The withheld-suffix list rides into the master so cohort queries
  // (join register_history/observations against it) run in one database.
  const masterForbidden = parse(fs.readFileSync(path.join(REFERENCE_DATA_DIR, 'forbidden-suffixes.csv'), 'utf8'),
    { columns: true, skip_empty_lines: true }) as Record<string, string>[];
  master.exec('CREATE TABLE ref_forbidden_suffixes (suffix TEXT)');
  const insertForbidden = master.prepare('INSERT INTO ref_forbidden_suffixes VALUES (?)');
  master.exec('BEGIN');
  for (const r of masterForbidden) insertForbidden.run(r.suffix);
  master.exec('COMMIT');
  master.exec('CREATE INDEX idx_master_forbidden ON ref_forbidden_suffixes("suffix")');
  summary['master ref_forbidden_suffixes'] = masterForbidden.length;
  summary['master register_history'] = historyRows;
  master.close();

  // Download twin of the master: honest name, gzipped - the .png variant exists
  // solely for the site's range-request path. Publish-only (the twin is gzip of
  // the .png, so it can only ever gunzip back to it), so the raw verification
  // build skips it - it is the single most expensive step in the build (#478).
  if (compress) {
    fs.writeFileSync(path.join(dataDir, 'master.sqlite.gz'), time('gzip:master', () => zlib.gzipSync(fs.readFileSync(masterPath), { level: GZIP_LEVEL })));
  }

  return summary;
}

if (import.meta.main) {
  const args = process.argv.slice(2).filter(a => a.trim().length > 0);
  const tiersFlag = args.indexOf('--tiers');
  const output = args.find(a => !a.startsWith('--')) ?? path.join('_site', 'data', 'callsigns.sqlite');
  const result = buildSqlite(output);
  console.log(`built ${output} from dataset ${result.datasetKey}`);
  for (const [table, n] of Object.entries(result.tables)) console.log(`  ${table}: ${n} rows`);
  if (tiersFlag !== -1) {
    const tiers = buildPublishedTiers(path.dirname(output));
    for (const [what, n] of Object.entries(tiers)) console.log(`  tiers: ${what}: ${n}`);
  }
  // Self-guarded: prints the profiling breakdown to stderr only under PERF.
  perfReport();
}
