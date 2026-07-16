#!/usr/bin/env node

/**
 * The surface-shaped PROJECTION of the claim ledger (issue #572): build the two
 * databases the interactive site surfaces query - the lookup database (latest
 * publication + reference tables, queried by site/app.js and Explore's "latest")
 * and the history database (every publication's register rows + the FOI
 * observations union, queried by compare/entry-browser/explore and the lookup's
 * history cards) - as a FOLD OVER THE CLAIM LEDGER rather than a parallel
 * normalised build.
 *
 * The table names, schemas and indexes deliberately mirror what the legacy
 * build (src/ci/build-sqlite.ts) exposes, so the surfaces' SQL runs unchanged;
 * only the database URL moves. Equivalence against the legacy build is asserted
 * by the parity suite (projection-parity.test.ts) - the merge gate the
 * migration rides on - and the legacy build keeps running beside this one until
 * that retirement lands (#445).
 *
 * WHAT FOLDS FROM THE LEDGER (the canonical source, ADR 0013):
 *  - Each open-data publication's canonical register rows: the raw-layer claims
 *    of its ledger source are reprojected into records (projectNormalised, over
 *    the @column/@subject file manifest), the raw->canonical column binding is
 *    the authored header-variant registry (never re-guessed), and date columns
 *    are re-rendered ISO under the format the ledger's own @interpretation
 *    claims attest (day-first CSV vs ISO workbook extract).
 *  - The component decomposition and the per-row flags: the SAME authored
 *    parse (parseCallsign / componentsFlagsForRows) whose output the ledger's
 *    derived tiers are projections of - consumed here on the folded rows, so
 *    the derivation is owned by components.ts alone, exactly as in the tiers.
 *  - The canonical licence category (normaliseLicenceCategory), likewise the
 *    computation the ledger's licence-category tier projects.
 *
 * WHAT DOES NOT (curation and reference inputs, not source observations):
 *  - reference-data/*.csv and flags.md - the meanings the lookup joins against.
 *  - Each publication's meta.json scope facts (history_datasets): declared
 *    coverage is publisher intent recorded by curation, not a register row.
 *  - The FOI observations union: folded from the committed FOI normalised
 *    files via the shared buildFoiObservations, exactly as the legacy build
 *    does. Moving this union onto a ledger fold needs the FOI reconstruction
 *    tiers and is deliberately follow-on work, tracked on the #445 chain.
 *
 * DELIBERATELY NOT COMMITTED: SQLite files are not byte-deterministic, so both
 * databases are deploy artefacts built fresh from committed data, wearing the
 * same `.png` costume (Pages gzip-transcodes text-like content types, which
 * corrupts httpvfs range reads; image types are never re-compressed).
 *
 * Usage:
 *   node src/v2/build-projection-db.ts [lookup.sqlite.png] [history.sqlite.png] [--ledger-dir=<dir>]
 *
 * --ledger-dir names a directory whose ledger/ subdirectory already holds the
 * per-source JSONL ledgers (the deploy emits the corpus ONCE for the compact
 * ledger database and hands the same emit here); when absent or empty, the
 * projection emits its own ledger restricted to the open-data register entries
 * it folds.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { parse } from 'csv-parse/sync';
import { buildLedger, type EntrySelector } from './build-ledger.ts';
import { parseClaimsJsonl } from './serialise.ts';
import { type Claim } from './claim.ts';
import { projectNormalised } from './project-normalised.ts';
import { collectOpenDataRegisterSources } from './collectors/open-data-register.ts';
import {
  CANONICAL_COLUMNS,
  interpretOpenDataColumns,
  mappingForVariant,
  rawColumnForCanonical,
} from '../sources/ofcom-amateur/normalise.ts';
import { parseUkDateTimeDetailed, codepointCompare } from '../shared/normalise.ts';
import {
  COMPONENT_COLUMNS,
  cleanedCallsign,
  componentRowToCells,
  componentsFlagsForRows,
  loadReferenceData,
  normaliseLicenceCategory,
  parseCallsign,
  type ComponentRow,
  type ReferenceData,
} from '../sources/ofcom-amateur/components.ts';
import { buildFoiObservations, OBSERVATION_VALUE_COLUMNS, type FoiObservationRow } from '../shared/foi-observations.ts';
import { applyBuildPragmas } from '../shared/sqlite-build.ts';
import { CONSTANTS } from '../shared/utils.ts';

// Reference data is repo-anchored, same convention as the component parser and
// the legacy build.
const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const REFERENCE_DATA_DIR = path.join(REPO_ROOT, 'reference-data');

// Rows per multi-row INSERT statement, and the bound-parameter ceiling to stay
// under (SQLITE_MAX_VARIABLE_NUMBER is 32,766 in the library Node bundles).
// Same batching rationale as the sibling builders: one prepared statement
// binding N rows amortises the per-row JS->native crossing, byte-identical to
// per-row inserts.
const INSERT_BATCH_ROWS = 2000;
const MAX_BULK_PARAMS = 30_000;

// Insert many rows through a fixed-size multi-row prepared statement, with a
// single remainder statement for the tail. The caller owns the surrounding
// transaction; `toValues` returns one row's column values, left to right.
function insertBatched<T>(
  db: DatabaseSync,
  table: string,
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
    const bulk = db.prepare(`INSERT INTO ${table} VALUES ${Array.from({ length: batchRows }, () => oneRow).join(', ')}`);
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
    const single = db.prepare(`INSERT INTO ${table} VALUES ${oneRow}`);
    for (; i < n; i += 1) single.run(...toValues(items[i], i));
  }
}

// The flag registry table in reference-data/flags.md is the single source of
// flag semantics; parse its markdown table so the lookup can explain flags.
// (The legacy build carries its own copy; this one outlives it when #445 lands.)
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

// One open-data publication folded back out of its ledger claims: the canonical
// register rows (CANONICAL_COLUMNS order, sorted exactly as the committed
// normalised.csv is) and their component decomposition, parallel by index.
export interface ProjectedPublication {
  // The archive date key ('2026-06-23'), recovered from the ledger source's
  // self-locating provenance path ('opendata/<key>/<file>').
  key: string;
  sourceFile: string;
  vintage: string;
  rows: string[][];
  components: ComponentRow[];
}

// Fold one open-data register source's claims back into its canonical rows and
// components - the ledger-fold twin of convertRawCsv's mapping half. The raw
// values come from the ledger's raw-layer claims; the ordered headers and the
// raw->canonical binding come from the authored variant registry, under the
// variant the entry's committed meta.json DECLARES (normalised.headerVariant -
// the curated record of which authored binding produced the committed
// normalisation), never re-guessed; date columns are re-rendered ISO under the
// format that variant's authored interpretation attests (day-first CSV vs ISO
// workbook extract). Rows are sorted callsign-codepoint-first with a whole-row
// tie-break - the exact deterministic order the committed normalised.csv uses -
// and the components derive from the sorted rows via the same authored parse
// the ledger's derived tiers project.
export function projectPublicationFromClaims(claims: readonly Claim[], ref: ReferenceData, variant: string): ProjectedPublication {
  const first = claims[0];
  if (first === undefined) throw new Error('cannot project an empty claim set');
  const sourceFile = first.provenance.sourceFile;
  const keyMatch = /^opendata\/([^/]+)\//.exec(sourceFile);
  if (keyMatch === null) {
    throw new Error(`${sourceFile}: not an open-data register source - the projection folds opendata/<key>/ sources only`);
  }
  const key = keyMatch[1];

  const mapping = mappingForVariant(variant);
  if (mapping === undefined) {
    throw new Error(`${sourceFile}: declared variant "${variant}" is not in the variant registry`);
  }
  // The registry declares each variant's raw headers in their exact file order
  // (header detection is order-sensitive), so the mapping's key order IS the
  // source column order.
  const columns = Object.keys(mapping);
  const subjectColumn = rawColumnForCanonical(mapping, 'callsign');
  if (subjectColumn === undefined) {
    throw new Error(`${sourceFile}: variant "${variant}" maps no raw header to callsign`);
  }
  const records = projectNormalised(claims, columns, subjectColumn);

  // Per raw column: whether the authored interpretation reads it as a date, and
  // under which format - the same lift the ledger's @interpretation tier
  // projects (interpretOpenDataColumns), consumed here directly.
  const interpretations = interpretOpenDataColumns(columns, mapping, {
    subjectColumn,
    categoryColumn: rawColumnForCanonical(mapping, 'product'),
    variant,
  });
  const dateFormatByColumn = new Map<string, string>();
  columns.forEach((column, index) => {
    const interpretation = interpretations[index];
    if (interpretation.type === 'date' && interpretation.format !== undefined) {
      dateFormatByColumn.set(column, interpretation.format);
    }
  });

  const rows: string[][] = records.map((record) => {
    const canonical: Record<string, string> = {};
    for (const [rawColumn, canonicalColumn] of Object.entries(mapping)) {
      // null-mapped columns are required-present export padding: not carried
      // into the canonical projection (the ledger carries them verbatim).
      if (canonicalColumn === null) continue;
      const rawValue = record.values[rawColumn] ?? '';
      const dateFormat = dateFormatByColumn.get(rawColumn);
      if (dateFormat !== undefined && rawValue.trim() !== '') {
        if (dateFormat === 'YYYY-MM-DD') {
          // Workbook-extract dates arrive ISO - validated shape, carried
          // verbatim, mirroring convertRawCsv's ISO branch.
          const trimmed = rawValue.trim();
          const match = /^\d{4}-(\d{2})-(\d{2})( \d{2}:\d{2}:\d{2})?$/.exec(trimmed);
          if (match === null || Number(match[1]) < 1 || Number(match[1]) > 12 || Number(match[2]) < 1 || Number(match[2]) > 31) {
            throw new Error(`${sourceFile} ordinal ${record.ordinal}: "${trimmed}" is not a well-formed ISO extract date`);
          }
          canonical[canonicalColumn] = trimmed;
        } else {
          // The UK day-first CSV rendering the interpretation attests.
          canonical[canonicalColumn] = parseUkDateTimeDetailed(rawValue).iso;
        }
      } else {
        canonical[canonicalColumn] = rawValue;
      }
    }
    return CANONICAL_COLUMNS.map(c => canonical[c] ?? '');
  });

  // Deterministic order: callsign (codepoint), then the whole row as tie-break -
  // exactly convertRawCsv's ordering, so the fold reproduces normalised.csv's
  // stored row order.
  rows.sort((a, b) => codepointCompare(a[0], b[0]) || codepointCompare(a.join('\u0000'), b.join('\u0000')));

  // Components derive from the SAME sorted canonical rows: column 0 is callsign,
  // column 1 product, and the original-start-date column reaches the parser so
  // the date-aware forbidden-suffix flag can be asserted - per CANONICAL_COLUMNS,
  // exactly as convertRawCsv derives the committed components.csv.
  const originalStartDateIndex = CANONICAL_COLUMNS.indexOf('licence_version_original_start_date');
  const components = componentsFlagsForRows(rows.map(r => parseCallsign(r[0], r[1], ref, r[originalStartDateIndex])));

  return { key, sourceFile, vintage: first.provenance.vintage, rows, components };
}

// Whether a claim set belongs to the open-data register family, judged from its
// self-locating provenance path. Reads only the first JSONL line, so skipping a
// multi-hundred-MB FOI ledger costs one line parse. Fails loud on a line that
// does not parse - a family must never be silently dropped from the projection
// because its ledger file looked unreadable.
function isOpenDataLedgerFile(filePath: string): boolean {
  const fd = fs.openSync(filePath, 'r');
  let firstLine: string;
  try {
    const buffer = Buffer.alloc(1024 * 1024);
    const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
    const text = buffer.subarray(0, bytesRead).toString('utf8');
    const newline = text.indexOf('\n');
    if (newline === -1 && bytesRead === buffer.length) {
      throw new Error(`${filePath}: first JSONL line exceeds 1 MiB - not a per-claim ledger file`);
    }
    firstLine = newline === -1 ? text : text.slice(0, newline);
  } finally {
    fs.closeSync(fd);
  }
  if (firstLine.trim() === '') return false;
  let parsed: { sourceFile?: string };
  try {
    parsed = JSON.parse(firstLine) as { sourceFile?: string };
  } catch (err) {
    throw new Error(`${filePath}: first line is not JSON (${String(err)}) - refusing to classify the ledger file`);
  }
  return typeof parsed.sourceFile === 'string' && parsed.sourceFile.startsWith('opendata/');
}

// The variant an entry's committed meta.json declares its normalisation was
// produced under - the curated record of the authored raw->canonical binding.
// Fail loud when absent: an entry with no declared variant has no committed
// normalisation to be equivalent to.
function declaredVariantFor(archiveDir: string, key: string): string {
  const metaPath = path.join(archiveDir, key, 'meta.json');
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as {
    normalised?: { headerVariant?: string };
    converter?: { variant?: string };
  };
  const variant = meta.normalised?.headerVariant ?? meta.converter?.variant;
  if (variant === undefined) {
    throw new Error(`archive/${key}/meta.json declares no normalised.headerVariant - cannot project without the authored binding`);
  }
  return variant;
}

// Read every open-data publication out of a ledger directory, oldest first.
export function projectPublicationsFromLedger(
  ledgerDir: string,
  ref: ReferenceData,
  archiveDir: string = CONSTANTS.DIRS.archive,
): ProjectedPublication[] {
  const jsonlFiles = fs.readdirSync(ledgerDir).filter(name => name.endsWith('.jsonl')).sort();
  const publications: ProjectedPublication[] = [];
  for (const file of jsonlFiles) {
    const filePath = path.join(ledgerDir, file);
    if (!isOpenDataLedgerFile(filePath)) continue;
    const claims = parseClaimsJsonl(fs.readFileSync(filePath, 'utf8'));
    const keyMatch = /^opendata\/([^/]+)\//.exec(claims[0]?.provenance.sourceFile ?? '');
    if (keyMatch === null) continue;
    publications.push(projectPublicationFromClaims(claims, ref, declaredVariantFor(archiveDir, keyMatch[1])));
  }
  publications.sort((a, b) => codepointCompare(a.key, b.key));
  if (publications.length === 0) {
    throw new Error(`${ledgerDir}: no open-data register sources in the ledger - nothing to project`);
  }
  return publications;
}

function readReferenceCsv(name: string): Record<string, string>[] {
  return parse(fs.readFileSync(path.join(REFERENCE_DATA_DIR, name), 'utf8'), { columns: true, skip_empty_lines: true }) as Record<string, string>[];
}

// The lookup database: the newest publication's normalised rows + components,
// the reference tables the lookup joins against, and the precomputed series x
// RSL matrix - the same tables (schemas, indexes) site/app.js queries today.
export function buildLookupDb(dbPath: string, newest: ProjectedPublication): Record<string, number> {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.rmSync(dbPath, { force: true });
  const db = new DatabaseSync(dbPath);
  applyBuildPragmas(db);
  const counts: Record<string, number> = {};

  const createAndFill = (table: string, columns: readonly string[], rows: readonly string[][], indexColumn?: string): void => {
    db.exec(`CREATE TABLE ${table} (${columns.map(c => `"${c}" TEXT`).join(', ')})`);
    db.exec('BEGIN');
    insertBatched(db, table, columns.length, rows, row => [...row]);
    db.exec('COMMIT');
    if (indexColumn !== undefined) db.exec(`CREATE INDEX idx_${table}_${indexColumn} ON ${table}("${indexColumn}")`);
    counts[table] = rows.length;
  };
  const objectRows = (records: Record<string, string>[], columns: string[]): string[][] =>
    records.map(r => columns.map(c => r[c] ?? ''));

  createAndFill('normalised', CANONICAL_COLUMNS, newest.rows, 'callsign');
  createAndFill('components', COMPONENT_COLUMNS, newest.components.map(componentRowToCells), 'callsign');
  // The lookup's further indexed paths: the RSL-placeholder form (regional
  // variant searches), suffix search (*TEE availability matrix), and the
  // artefact-unifying cleaned key ("did you mean" recovery). Plain indexes,
  // never UNIQUE: duplicates are expected and deliberate.
  db.exec('CREATE INDEX idx_components_placeholder ON components("placeholder_form")');
  db.exec('CREATE INDEX idx_components_suffix ON components("suffix")');
  db.exec('CREATE INDEX idx_components_cleaned ON components("cleaned")');

  const rsl = readReferenceCsv('rsl.csv');
  createAndFill('ref_rsl', Object.keys(rsl[0]), objectRows(rsl, Object.keys(rsl[0])), 'rsl');
  const prefixes = readReferenceCsv('prefix-formats.csv');
  createAndFill('ref_prefix_formats', Object.keys(prefixes[0]), objectRows(prefixes, Object.keys(prefixes[0])), 'prefix');
  const forbidden = readReferenceCsv('forbidden-suffixes.csv');
  createAndFill('ref_forbidden_suffixes', ['suffix'], forbidden.map(r => [r.suffix]), 'suffix');
  const itu = readReferenceCsv('itu-call-sign-series.csv');
  createAndFill('itu_series', ['series', 'allocated_to'], itu.map(r => [r.series, r.allocated_to]));
  const registry = parseFlagRegistry();
  createAndFill('flag_registry', ['flag', 'meaning', 'grounding'], registry.map(r => [r.flag, r.meaning, r.grounding]), 'flag');

  // Precomputed series x RSL locator matrix: a GROUP BY over the full
  // components table would be prohibitively chatty over the site's
  // range-request VFS, so the handful of aggregate rows ship ready-made.
  db.exec(`CREATE TABLE rsl_matrix AS
    SELECT prefix_series AS series, rsl, COUNT(*) AS n
    FROM components WHERE parse_status = 'parsed'
    GROUP BY prefix_series, rsl`);
  counts['rsl_matrix'] = Number((db.prepare('SELECT COUNT(*) AS c FROM rsl_matrix').get() as { c: number | bigint }).c);

  db.exec('CREATE TABLE build_info (key TEXT, value TEXT)');
  const info = db.prepare('INSERT INTO build_info VALUES (?, ?)');
  info.run('dataset', newest.key);
  info.run('generated_at', new Date().toISOString());
  info.run('commit', process.env.GITHUB_SHA ?? 'local');

  db.close();
  return counts;
}

// The component fields FOI observations gain by running every callsign through
// the same parser the open-data lane uses, mirroring the legacy combined build
// column-for-column (see fillObservations in src/ci/build-sqlite.ts, which this
// supersedes when #445 retires it).
const OBSERVATION_COMPONENT_COLUMNS = ['prefix_series', 'rsl', 'placeholder_form', 'implied_class', 'parse_status', 'flags'] as const;

function fillObservationsTable(db: DatabaseSync, rows: FoiObservationRow[], ref: ReferenceData): number {
  const valueColumns = OBSERVATION_VALUE_COLUMNS.map(c => `"${c}" TEXT`).join(', ');
  const componentColumns = OBSERVATION_COMPONENT_COLUMNS.map(c => `"${c}" TEXT`).join(', ');
  // cleaned: the artefact-unifying join key (computed at build - the FOI
  // committed files stay verbatim); a join key, not an identity, so its index
  // is plain, never UNIQUE. normalised_licence_category: the canonical category
  // the disclosed licence_class collapses to; NULL where none is disclosed or
  // none maps, so the distinction stays queryable.
  db.exec(`CREATE TABLE observations (callsign TEXT, cleaned TEXT, entry TEXT, source_file TEXT, dataset_classes TEXT, vintage TEXT, ${valueColumns}, ${componentColumns}, normalised_licence_category TEXT)`);

  // Parse each callsign through the shared component parser, grouped by entry
  // so the whole-set stripped-collision flag is scoped to one snapshot.
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

// Per-publication scope facts (meta.json), so consumers can interpret ABSENCE
// honestly: a callsign missing from a declared-partial publication is scope,
// not an event. Same semantics as the legacy history_datasets table.
interface ScopeMeta {
  intendedCoverage?: { complete: boolean; scopeNotes?: string };
  qualityObservations?: { statement: string; coverageAffecting?: boolean }[];
}

function readScopeMeta(archiveDir: string, key: string): ScopeMeta {
  const metaPath = path.join(archiveDir, key, 'meta.json');
  if (!fs.existsSync(metaPath)) return {};
  return JSON.parse(fs.readFileSync(metaPath, 'utf8')) as ScopeMeta;
}

// The history database: every publication's register rows as one dataset-keyed
// history table (with the derived component join keys riding along), the
// per-publication scope facts, the FOI observations union and the withheld-
// suffix list - the same tables compare/entry-browser/explore and the lookup's
// history cards query today.
export function buildHistoryDb(
  dbPath: string,
  publications: readonly ProjectedPublication[],
  ref: ReferenceData,
  foiDir: string = path.join(CONSTANTS.DIRS.archive, 'foi'),
  archiveDir: string = CONSTANTS.DIRS.archive,
): Record<string, number> {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.rmSync(dbPath, { force: true });
  const db = new DatabaseSync(dbPath);
  applyBuildPragmas(db);
  const counts: Record<string, number> = {};

  counts['observations'] = fillObservationsTable(db, buildFoiObservations(foiDir), ref);

  db.exec('CREATE TABLE history_datasets (dataset TEXT, record_count TEXT, intended_complete TEXT, scope_notes TEXT, coverage_affecting TEXT)');
  const insertDataset = db.prepare('INSERT INTO history_datasets VALUES (?, ?, ?, ?, ?)');
  for (const publication of publications) {
    const meta = readScopeMeta(archiveDir, publication.key);
    const coverageAffecting = (meta.qualityObservations ?? [])
      .filter(o => o.coverageAffecting === true).map(o => o.statement).join(' ');
    insertDataset.run(
      publication.key,
      String(publication.rows.length),
      meta.intendedCoverage === undefined ? '' : String(meta.intendedCoverage.complete),
      meta.intendedCoverage?.scopeNotes ?? '',
      coverageAffecting,
    );
  }
  counts['history_datasets'] = publications.length;

  // The register-history union schema: the derived join keys first, then every
  // canonical column - the same column set (and order) the legacy build derives
  // from the committed normalised files, kept as an explicit union so a future
  // schema version's extra columns still widen it.
  const historyColumns = new Set<string>(['dataset', 'cleaned', 'suffix', 'implied_class', 'prefix_series', 'parse_status', 'normalised_licence_category']);
  for (const column of CANONICAL_COLUMNS) historyColumns.add(column);
  const historyColumnList = [...historyColumns];
  db.exec(`CREATE TABLE register_history (${historyColumnList.map(c => `"${c}" TEXT`).join(', ')})`);
  const productIndex = CANONICAL_COLUMNS.indexOf('product');
  let historyRows = 0;
  db.exec('BEGIN');
  for (const publication of publications) {
    insertBatched(db, 'register_history', historyColumnList.length, publication.rows, (row, i) => {
      const component = publication.components[i];
      return historyColumnList.map((c) => {
        if (c === 'dataset') return publication.key;
        if (c === 'cleaned') return cleanedCallsign(row[0] ?? '');
        if (c === 'suffix') return component.suffix;
        if (c === 'implied_class') return component.impliedClass;
        if (c === 'prefix_series') return component.prefixSeries;
        if (c === 'parse_status') return component.parseStatus;
        if (c === 'normalised_licence_category') return normaliseLicenceCategory(row[productIndex] ?? '', ref);
        const canonicalIndex = CANONICAL_COLUMNS.indexOf(c as (typeof CANONICAL_COLUMNS)[number]);
        return canonicalIndex === -1 ? null : row[canonicalIndex] ?? null;
      });
    });
    historyRows += publication.rows.length;
  }
  db.exec('COMMIT');
  db.exec('CREATE INDEX idx_register_history_callsign ON register_history("callsign")');
  db.exec('CREATE INDEX idx_register_history_cleaned ON register_history("cleaned")');
  // Scoped-browser lookups filter one publication at a time (WHERE dataset = ?).
  db.exec('CREATE INDEX idx_register_history_dataset ON register_history("dataset")');
  counts['register_history'] = historyRows;

  // The withheld-suffix list rides along so cohort queries run in one database.
  const forbidden = readReferenceCsv('forbidden-suffixes.csv');
  db.exec('CREATE TABLE ref_forbidden_suffixes (suffix TEXT)');
  const insertForbidden = db.prepare('INSERT INTO ref_forbidden_suffixes VALUES (?)');
  db.exec('BEGIN');
  for (const r of forbidden) insertForbidden.run(r.suffix);
  db.exec('COMMIT');
  db.exec('CREATE INDEX idx_history_forbidden ON ref_forbidden_suffixes("suffix")');
  counts['ref_forbidden_suffixes'] = forbidden.length;

  db.exec('CREATE TABLE build_info (key TEXT, value TEXT)');
  const info = db.prepare('INSERT INTO build_info VALUES (?, ?)');
  const newest = publications[publications.length - 1];
  info.run('dataset', newest.key);
  info.run('generated_at', new Date().toISOString());
  info.run('commit', process.env.GITHUB_SHA ?? 'local');

  db.close();
  return counts;
}

export interface BuildProjectionOptions {
  // A directory whose ledger/ subdirectory already holds the per-source JSONL
  // ledgers - the deploy emits the corpus once (for the compact ledger
  // database) and hands the same emit here. When absent or empty, the
  // projection emits its own ledger restricted to the open-data register
  // entries it folds.
  ledgerDir?: string;
  // Restrict the projection's OWN emit to a subset of entries (ignored when an
  // already-populated ledgerDir is reused).
  selectEntry?: EntrySelector;
  foiDir?: string;
  archiveDir?: string;
}

export interface BuildProjectionResult {
  lookupPath: string;
  historyPath: string;
  publications: string[];
  lookup: Record<string, number>;
  history: Record<string, number>;
  sizes: { lookup: number; history: number };
}

// Whether a ledger root already carries emitted per-source JSONL files.
function hasEmittedLedger(ledgerRoot: string): boolean {
  const ledgerDir = path.join(ledgerRoot, 'ledger');
  return fs.existsSync(ledgerDir) && fs.readdirSync(ledgerDir).some(name => name.endsWith('.jsonl'));
}

// The default emit scope when the projection owns its own ledger emit: exactly
// the open-data register entries (the family this projection folds), so a
// standalone build never pays for the FOI families it does not read.
export function openDataEntrySelector(): EntrySelector {
  const entries = new Set(collectOpenDataRegisterSources().map(source => source.entry));
  return (entry: string) => entries.has(entry);
}

export function buildProjectionDbs(lookupPath: string, historyPath: string, options: BuildProjectionOptions = {}): BuildProjectionResult {
  const ref = loadReferenceData();
  const ownsLedgerRoot = options.ledgerDir === undefined;
  const ledgerRoot = options.ledgerDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'v2-projection-'));
  try {
    if (!hasEmittedLedger(ledgerRoot)) {
      buildLedger(ledgerRoot, undefined, ref, options.selectEntry ?? openDataEntrySelector());
    }
    const publications = projectPublicationsFromLedger(path.join(ledgerRoot, 'ledger'), ref);
    const newest = publications[publications.length - 1];
    const lookup = buildLookupDb(lookupPath, newest);
    const history = buildHistoryDb(historyPath, publications, ref, options.foiDir, options.archiveDir);
    return {
      lookupPath,
      historyPath,
      publications: publications.map(p => p.key),
      lookup,
      history,
      sizes: { lookup: fs.statSync(lookupPath).size, history: fs.statSync(historyPath).size },
    };
  } finally {
    if (ownsLedgerRoot) fs.rmSync(ledgerRoot, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2).filter(a => a.trim().length > 0);
  const positional = args.filter(a => !a.startsWith('--'));
  const ledgerDirFlag = args.find(a => a.startsWith('--ledger-dir='));
  const lookupPath = positional[0] ?? path.join('_site', 'data', 'ledger-lookup.sqlite.png');
  const historyPath = positional[1] ?? path.join('_site', 'data', 'ledger-history.sqlite.png');
  const result = buildProjectionDbs(lookupPath, historyPath, {
    ledgerDir: ledgerDirFlag?.slice('--ledger-dir='.length),
  });
  console.log(`built ledger projection databases from ${result.publications.length} publications (${result.publications[0]} → ${result.publications[result.publications.length - 1]})`);
  console.log(`  lookup ${result.lookupPath} (${result.sizes.lookup} bytes):`);
  for (const [table, n] of Object.entries(result.lookup)) console.log(`    ${table}: ${n} rows`);
  console.log(`  history ${result.historyPath} (${result.sizes.history} bytes):`);
  for (const [table, n] of Object.entries(result.history)) console.log(`    ${table}: ${n} rows`);
}
