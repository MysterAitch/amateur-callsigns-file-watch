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
import { DatabaseSync } from 'node:sqlite';
import { parse } from 'csv-parse/sync';
import { CONSTANTS } from '../shared/utils.ts';
import { listArchiveKeys } from '../shared/archive.ts';
import { type EntryStats } from '../shared/stats.ts';

// Reference data is repo-anchored (same convention as the component parser).
const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const REFERENCE_DATA_DIR = path.join(REPO_ROOT, 'reference-data');

function readCsv(filePath: string): Record<string, string>[] {
  return parse(fs.readFileSync(filePath, 'utf8'), { columns: true, skip_empty_lines: true }) as Record<string, string>[];
}

// The flag registry table in reference-data/flags.md is the single source of
// flag semantics; parse its markdown table so the lookup can explain flags.
function parseFlagRegistry(): { flag: string; meaning: string; grounding: string }[] {
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

  db.exec('CREATE TABLE build_info (key TEXT, value TEXT)');
  const info = db.prepare('INSERT INTO build_info VALUES (?, ?)');
  info.run('dataset', newest);
  info.run('generated_at', new Date().toISOString());
  info.run('commit', process.env.GITHUB_SHA ?? 'local');

  db.close();
  return { datasetKey: newest, tables: counts };
}

if (import.meta.main) {
  const output = process.argv[2] ?? path.join('_site', 'data', 'callsigns.sqlite');
  const result = buildSqlite(output);
  console.log(`built ${output} from dataset ${result.datasetKey}`);
  for (const [table, n] of Object.entries(result.tables)) console.log(`  ${table}: ${n} rows`);
}
