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
import { buildFoiObservations, renderObservationsCsv, OBSERVATION_VALUE_COLUMNS, type FoiObservationRow } from '../shared/foi-observations.ts';
import { cleanedCallsign } from '../sources/ofcom-amateur/components.ts';

// Reference data is repo-anchored (same convention as the component parser).
const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const REFERENCE_DATA_DIR = path.join(REPO_ROOT, 'reference-data');

function readCsv(filePath: string): Record<string, string>[] {
  return parse(fs.readFileSync(filePath, 'utf8'), { columns: true, skip_empty_lines: true }) as Record<string, string>[];
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
    const insert = db.prepare(`INSERT INTO ${table} VALUES (${columns.map(() => '?').join(', ')})`);
    // One transaction per table: without it every insert commits separately
    // and a 158k-row table takes minutes instead of milliseconds.
    db.exec('BEGIN');
    for (const row of rows) insert.run(...row);
    db.exec('COMMIT');
    if (indexColumn) db.exec(`CREATE INDEX idx_${table}_${indexColumn} ON ${table}("${indexColumn}")`);
    counts[table] = rows.length;
  };

  const objectRows = (records: Record<string, string>[], columns: string[]): string[][] =>
    records.map(r => columns.map(c => r[c] ?? ''));

  // Latest dataset: normalised + components, joined by callsign.
  const normalisedRecords = readCsv(path.join(CONSTANTS.DIRS.archive, newest, 'normalised.csv'));
  const normalisedColumns = Object.keys(normalisedRecords[0]);
  createAndFill('normalised', normalisedColumns, objectRows(normalisedRecords, normalisedColumns), 'callsign');

  const componentRecords = readCsv(path.join(CONSTANTS.DIRS.archive, newest, 'components.csv'));
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

  db.exec('CREATE TABLE build_info (key TEXT, value TEXT)');
  const info = db.prepare('INSERT INTO build_info VALUES (?, ?)');
  info.run('dataset', newest);
  info.run('generated_at', new Date().toISOString());
  info.run('commit', process.env.GITHUB_SHA ?? 'local');

  db.close();
  return { datasetKey: newest, tables: counts };
}

function fillObservations(db: DatabaseSync, rows: FoiObservationRow[]): number {
  const valueColumns = OBSERVATION_VALUE_COLUMNS.map(c => `"${c}" TEXT`).join(', ');
  // cleaned: the artefact-unifying join key (computed here at build - the
  // FOI committed files stay verbatim). A join key, not an identity:
  // duplicates are expected, so its index is plain, never UNIQUE.
  db.exec(`CREATE TABLE observations (callsign TEXT, cleaned TEXT, entry TEXT, source_file TEXT, dataset_classes TEXT, vintage TEXT, ${valueColumns})`);
  const placeholders = Array.from({ length: 6 + OBSERVATION_VALUE_COLUMNS.length }, () => '?').join(', ');
  const insert = db.prepare(`INSERT INTO observations VALUES (${placeholders})`);
  db.exec('BEGIN');
  for (const row of rows) {
    insert.run(row.callsign, cleanedCallsign(row.callsign), row.entry, row.sourceFile, row.datasetClasses, row.vintage,
      ...OBSERVATION_VALUE_COLUMNS.map(column => row.values[column] ?? null));
  }
  db.exec('COMMIT');
  db.exec('CREATE INDEX idx_observations_callsign ON observations("callsign")');
  db.exec('CREATE INDEX idx_observations_cleaned ON observations("cleaned")');
  return rows.length;
}

// The remaining published tiers (issue #149 item 4 + the composed-stack
// decision): the mandatory flat union CSV, one SQLite per archive entry,
// and the master database. All derived at deploy time, never committed.
export function buildPublishedTiers(dataDir: string): Record<string, number> {
  const summary: Record<string, number> = {};
  const foiDir = path.join(CONSTANTS.DIRS.archive, 'foi');
  const observations = buildFoiObservations(foiDir);

  // Mandatory union CSV - the no-SQL consumption path. Published gzipped:
  // the plain text is ~160 MB, which alone would strain the Pages 1 GB
  // site cap alongside the published dataset files; .csv.gz keeps the
  // no-SQL property (universally decompressible) at ~15% of the size. The
  // faithful NULL-vs-blank form lives in the master database.
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'foi-observations.csv.gz'), zlib.gzipSync(renderObservationsCsv(observations), { level: 9 }));
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
      const records = parse(fs.readFileSync(path.join(dir, file), 'utf8'), { columns: true, skip_empty_lines: true, bom: true }) as Record<string, string>[];
      if (records.length === 0) continue;
      const columns = Object.keys(records[0]);
      const tableName = file.replace(/\.csv$/, '').replace(/[^a-zA-Z0-9]+/g, '_');
      db.exec(`CREATE TABLE "${tableName}" (${columns.map(c => `"${c}" TEXT`).join(', ')})`);
      const insert = db.prepare(`INSERT INTO "${tableName}" VALUES (${columns.map(() => '?').join(', ')})`);
      db.exec('BEGIN');
      for (const record of records) insert.run(...columns.map(c => record[c] ?? ''));
      db.exec('COMMIT');
      tables += 1;
    }
    db.close();
    if (tables > 0) {
      fs.writeFileSync(path.join(perDatasetDir, `${name}.sqlite.gz`), zlib.gzipSync(fs.readFileSync(buildPath), { level: 9 }));
      perDataset += 1;
    }
    fs.rmSync(buildPath, { force: true });
  }
  summary['per-dataset databases'] = perDataset;

  // The master database: the observations union + every open-data
  // publication's normalised rows as one dataset-keyed history table.
  const masterPath = path.join(dataDir, 'master.sqlite.png');
  fs.rmSync(masterPath, { force: true });
  const master = new DatabaseSync(masterPath);
  summary['master observations'] = fillObservations(master, observations);
  // Longitudinal join keys ride along: each publication's components.csv
  // contributes the derived cleaned (artefact-unifying) and suffix keys,
  // so cross-publication cohort queries (e.g. the forbidden-suffix
  // cohort) are runnable in SQL. cleaned is a JOIN KEY, not an identity -
  // duplicates are expected and deliberate (G6 FMU / G6FMU), so its
  // index is plain, never UNIQUE.
  const historyColumns = new Set<string>(['dataset', 'cleaned', 'suffix', 'implied_class', 'prefix_series']);
  const publications = listArchiveKeys().sort()
    .map(key => ({ key, path: path.join(CONSTANTS.DIRS.archive, key, 'normalised.csv') }))
    .filter(p => fs.existsSync(p.path))
    .map(p => {
      const componentsPath = path.join(CONSTANTS.DIRS.archive, p.key, 'components.csv');
      const componentKeys = new Map<string, { cleaned: string; suffix: string; impliedClass: string; prefixSeries: string }>(
        fs.existsSync(componentsPath)
          ? (parse(fs.readFileSync(componentsPath, 'utf8'), { columns: true, skip_empty_lines: true }) as Record<string, string>[])
            .map(c => [c.callsign, { cleaned: c.cleaned ?? cleanedCallsign(c.callsign), suffix: c.suffix ?? '', impliedClass: c.implied_class ?? '', prefixSeries: c.prefix_series ?? '' }])
          : []);
      return {
        key: p.key,
        componentKeys,
        records: parse(fs.readFileSync(p.path, 'utf8'), { columns: true, skip_empty_lines: true }) as Record<string, string>[],
      };
    });
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
  const insertHistory = master.prepare(`INSERT INTO register_history VALUES (${historyColumnList.map(() => '?').join(', ')})`);
  let historyRows = 0;
  master.exec('BEGIN');
  for (const publication of publications) {
    for (const record of publication.records) {
      const keys = publication.componentKeys.get(record.callsign);
      insertHistory.run(...historyColumnList.map(c => {
        if (c === 'dataset') return publication.key;
        if (c === 'cleaned') return keys?.cleaned ?? cleanedCallsign(record.callsign ?? '');
        if (c === 'suffix') return keys?.suffix ?? '';
        if (c === 'implied_class') return keys?.impliedClass ?? '';
        if (c === 'prefix_series') return keys?.prefixSeries ?? '';
        return record[c] ?? null;
      }));
      historyRows += 1;
    }
  }
  master.exec('COMMIT');
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

  // Download twin of the master: honest name, gzipped - the .png variant
  // exists solely for the site's range-request path.
  fs.writeFileSync(path.join(dataDir, 'master.sqlite.gz'), zlib.gzipSync(fs.readFileSync(masterPath), { level: 9 }));

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
}
