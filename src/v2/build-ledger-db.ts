#!/usr/bin/env node

/**
 * Stage 2 of the raw-keyed claim-ledger pipeline (issue #361): turn the claim
 * ledger (the JSONL Stage 1 emits from the RAW published bytes) into the two
 * queryable artefacts a consumer actually reads.
 *
 * The engine split is settled (a bench-off decided it; not re-litigated here):
 *
 *  - SQLite is the PRIMARY browser/interactive lane. The lookup-shaped workload
 *    ("tell me about this entity", "which raw tokens are this entity") is an
 *    indexed point/range query - sub-0.1ms on SQLite - and the 0.5MB engine is
 *    the already-vendored sql.js-httpvfs path that fits the offline PWA. This
 *    module builds a query-optimised claim-ledger SQLite and ships it in the
 *    same `.png` costume (+ gzip twin) the existing tiers use, as a DEPLOY-TIME
 *    artefact - never committed (SQLite files are not byte-deterministic).
 *
 *  - DuckDB is a BUILD-TIME tool only: it reads claims.jsonl natively and emits
 *    a compact `claims.parquet` for the bulk/analyst lane. It is kept cleanly
 *    separable (writeParquetScript / emitClaimsParquet) because the repo's
 *    supply-chain posture forbids native-build npm dependencies, so DuckDB
 *    enters CI as a pinned CLI binary (or duckdb-wasm-in-node), never as a
 *    node-gyp package. See the module tail and the PR for the CI options.
 *
 * CRITICAL SQLite gotcha the bench-off surfaced: without table statistics the
 * planner mis-costs the entity/raw_subject point lookups and picks a full scan
 * (300ms-3.6s) over the index (sub-ms). ANALYZE is therefore run at build time,
 * after the load and the indexes, so the shipped database plans the lookups
 * onto its indexes. buildLedgerSqlite asserts nothing here - the tests assert
 * the sqlite_stat tables exist and the query plans use the indexes.
 *
 * Usage:
 *   node src/v2/build-ledger-db.ts [output.sqlite.png] [--subset] [--parquet]
 *   node src/v2/build-ledger-db.ts [output.parquet] --parquet-only [--subset]
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as zlib from 'zlib';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { buildLedger, type EntrySelector } from './build-ledger.ts';
import { readClaimsJsonlSync } from './serialise.ts';
import {
  NORMALISES_TO_PREDICATE,
  CLEANED_CALLSIGN_RULE,
  PLACEHOLDER_FORM_RULE,
  type Claim,
} from './claim.ts';

// Gzip level for the published .gz twin - the same size/time trade-off knob
// build-sqlite.ts uses, honouring the same TIERS_GZIP_LEVEL override so the
// tests (which check CONTENTS, not size) run fast at level 1. Any level
// decompresses to identical bytes.
const GZIP_LEVEL = process.env.TIERS_GZIP_LEVEL !== undefined ? Number(process.env.TIERS_GZIP_LEVEL) : 9;

// Rows per multi-row INSERT. Each `.run()` is one JS->native crossing plus one
// bytecode execution, so binding many rows per statement cuts that fixed
// per-row overhead - the dominant cost once the whole load rides in one
// transaction. Byte-identical to per-row inserts (a VALUES list is sugar for
// them). SQLite's bound-parameter ceiling is 32,766; the claims table is nine
// columns wide, so a 500-row batch binds 4,500 parameters - comfortably under.
const INSERT_BATCH_ROWS = 500;

// The representative subset the tractable build+test uses: two register
// snapshots at DISTINCT vintages so the temporal fold has something to fold
// (2016-09-20 and 2022-03-07), the later of which carries the documented G0TQK
// trailing-NBSP twin so the variants-of-entity lookup has real raw variance to
// resolve; PLUS one entry per non-callsign subjectKind in the corpus (a
// forbidden-suffix list, a statistics aggregate, an available-pool disclosure,
// the pre-war annex's raw-only token sheets), so the fat-vs-compact parity
// oracle structurally covers the raw-only families whose observations must NOT
// gain normalisation edges (issue #824 - the compact VIEW once fabricated them,
// and a callsign-only fixture never saw it).
// The full corpus is the default (no selector); this is opt-in.
export const SUBSET_ENTRIES: readonly string[] = [
  // callsign register entries (subjectKind 'callsign')
  'ofcom-2016-09-20--callsign-database--all-callsigns',
  'ofcom-01420046--allocated-reserved-callsigns',
  // subjectKind 'suffix': the standalone forbidden-suffix disclosure
  'ofcom-2024-12--forbidden-suffixes',
  // subjectKind 'aggregate': the annual-licence-counts statistics table
  'wdtk-184767--annual-licence-counts',
  // subjectKind 'pool-slot': a 2014 available-suffix-lists disclosure
  'wdtk-197896--available-callsigns-list',
  // subjectKind 'token': the pre-war annex (issue #813 Stage B), whose sheet 2
  // additionally carries an EMPTY-STRING first header - the round-trip hazard
  // the parity fixture must keep exercising.
  'wdtk-238892--out-of-sequence-callsigns',
];

export function subsetSelector(): EntrySelector {
  const wanted = new Set(SUBSET_ENTRIES);
  return (entry: string) => wanted.has(entry);
}

// The claim-ledger SQLite schema, denormalised for the LOOKUP workload: one row
// per claim, carrying both derived keys beside the verbatim `raw_subject` in
// derivation order (raw -> cleaned -> entity), so every lookup path is a single
// indexed equality. TEXT throughout except the stored source ordinal (INTEGER),
// matching the ledger's own types. `rule` is NULL for raw claims and the named
// rule for derived ones, so a consumer can trust the raw layer and treat the
// derived layer as reproducible opinion - the same layering the ledger models.
//
// The two derived keys serve distinct purposes:
//   - entity  = the RSL-less placeholder form (G#0TQK). The cross-regional
//               unification key: every regional rendering of one licence
//               collapses to it, so it is what per-entity views group on. Never
//               shown to a user (it carries the '#' placeholder marker).
//   - cleaned = cleanedCallsign of the raw token (G0TQK). The human-readable
//               canonical, and the direct-lookup key: a user typing a literal
//               callsign matches it in one indexed hop, without the browser
//               having to compute the placeholder form itself.
const CREATE_CLAIMS_TABLE = `CREATE TABLE claims (
  layer TEXT NOT NULL,
  raw_subject TEXT NOT NULL,
  cleaned TEXT NOT NULL,
  entity TEXT NOT NULL,
  predicate TEXT NOT NULL,
  object TEXT NOT NULL,
  rule TEXT,
  source_file TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  vintage TEXT NOT NULL
)`;

const CLAIMS_COLUMN_COUNT = 10;

export interface LedgerSqliteSummary {
  claims: number;
  entities: number;
  sources: number;
  analyzed: boolean;
}

// The two derived keys a claim resolves to.
interface ResolvedKeys {
  cleaned: string;
  entity: string;
}

// Resolve every raw token in one source's claims to its cleaned form and its
// terminal entity, using ONLY that source's normalises_to edges - never a
// re-derivation. The edges are self-contained per source (Stage 1 emits
// raw -> cleaned for every listed token, then cleaned -> placeholder where the
// token parses to one), so resolution is local to the file and needs no
// cross-source state:
//   cleaned(token) = cleaned-edge(token) ?? token
//   entity(token)  = placeholder-edge(cleaned(token)) ?? cleaned(token)
// A token with no placeholder edge (a callsign that does not parse) has its
// cleaned form as its entity, so it is still indexed and queryable rather than
// dropped.
function resolveKeys(claims: readonly Claim[]): (claim: Claim) => ResolvedKeys {
  const cleanedOf = new Map<string, string>();
  const placeholderOf = new Map<string, string>();
  for (const claim of claims) {
    if (claim.predicate !== NORMALISES_TO_PREDICATE) continue;
    if (claim.rule === CLEANED_CALLSIGN_RULE) cleanedOf.set(claim.rawSubject, claim.object);
    else if (claim.rule === PLACEHOLDER_FORM_RULE) placeholderOf.set(claim.rawSubject, claim.object);
  }
  return (claim: Claim): ResolvedKeys => {
    const cleaned = cleanedOf.get(claim.rawSubject) ?? claim.rawSubject;
    return { cleaned, entity: placeholderOf.get(cleaned) ?? cleaned };
  };
}

// Insert claims through a fixed-size multi-row prepared statement, with a
// single remainder statement for the tail. The caller owns the surrounding
// transaction.
function insertClaims(db: DatabaseSync, claims: readonly Claim[], keysOf: (claim: Claim) => ResolvedKeys): void {
  const n = claims.length;
  if (n === 0) return;
  const toValues = (claim: Claim): (string | number | null)[] => {
    const { cleaned, entity } = keysOf(claim);
    return [
      claim.layer,
      claim.rawSubject,
      cleaned,
      entity,
      claim.predicate,
      claim.object,
      claim.rule ?? null,
      claim.provenance.sourceFile,
      claim.provenance.ordinal,
      claim.provenance.vintage,
    ];
  };
  const oneRow = `(${Array.from({ length: CLAIMS_COLUMN_COUNT }, () => '?').join(', ')})`;
  const fullCount = n - (n % INSERT_BATCH_ROWS);
  let i = 0;
  if (fullCount > 0) {
    const bulk = db.prepare(`INSERT INTO claims VALUES ${Array.from({ length: INSERT_BATCH_ROWS }, () => oneRow).join(', ')}`);
    const flat = new Array<string | number | null>(INSERT_BATCH_ROWS * CLAIMS_COLUMN_COUNT);
    for (; i < fullCount; i += INSERT_BATCH_ROWS) {
      let p = 0;
      for (let k = 0; k < INSERT_BATCH_ROWS; k += 1) {
        const values = toValues(claims[i + k]);
        for (let c = 0; c < CLAIMS_COLUMN_COUNT; c += 1) { flat[p] = values[c]; p += 1; }
      }
      bulk.run(...flat);
    }
  }
  if (i < n) {
    const single = db.prepare(`INSERT INTO claims VALUES ${oneRow}`);
    for (; i < n; i += 1) single.run(...toValues(claims[i]));
  }
}

// Build the claim-ledger SQLite at dbPath from a directory of per-source JSONL
// ledgers (the shape Stage 1 writes into <outputDir>/ledger/). Files are read
// one at a time - the same streaming discipline the emit stage uses - so peak
// memory is one source's claims, not the whole corpus. The load, indexing and
// ANALYZE all happen here so the shipped database is query-ready.
export function buildLedgerSqlite(ledgerDir: string, dbPath: string): LedgerSqliteSummary {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.rmSync(dbPath, { force: true });
  const db = new DatabaseSync(dbPath);
  db.exec(CREATE_CLAIMS_TABLE);

  const jsonlFiles = fs.readdirSync(ledgerDir).filter(name => name.endsWith('.jsonl')).sort();
  let totalClaims = 0;
  const entities = new Set<string>();

  db.exec('BEGIN');
  for (const file of jsonlFiles) {
    // Chunked read: the biggest per-source ledgers exceed V8's maximum string
    // length (issue #725 S1), so the JSONL decodes line by line off the Buffer.
    const claims = readClaimsJsonlSync(path.join(ledgerDir, file));
    const keysOf = resolveKeys(claims);
    insertClaims(db, claims, keysOf);
    for (const claim of claims) entities.add(keysOf(claim).entity);
    totalClaims += claims.length;
  }
  db.exec('COMMIT');

  // The lookup paths the browser workload hits: per-entity dossier and
  // variants-of-entity key on `entity` (the cross-regional unification key); a
  // user-typed literal callsign and the human-readable display path key on
  // `cleaned` (one indexed hop, no placeholder computation in the browser); the
  // "did you mean this raw token" and raw-fidelity paths key on `raw_subject`;
  // corpus aggregates and the temporal fold filter/partition on `predicate`.
  db.exec('CREATE INDEX idx_claims_entity ON claims(entity)');
  db.exec('CREATE INDEX idx_claims_cleaned ON claims(cleaned)');
  db.exec('CREATE INDEX idx_claims_raw_subject ON claims(raw_subject)');
  db.exec('CREATE INDEX idx_claims_predicate ON claims(predicate)');

  // The load-bearing step: without statistics the planner mis-costs the point
  // lookups onto a full scan (the bench-off measured 300ms-3.6s); ANALYZE lets
  // it choose the indexes (sub-ms). Run AFTER the indexes exist so it has them
  // to gather statistics on.
  db.exec('ANALYZE');
  const analyzed = (db.prepare("SELECT name FROM sqlite_master WHERE name = 'sqlite_stat1'").get() as { name: string } | undefined) !== undefined;

  db.exec('CREATE TABLE build_info (key TEXT, value TEXT)');
  const info = db.prepare('INSERT INTO build_info VALUES (?, ?)');
  info.run('claims', String(totalClaims));
  info.run('sources', String(jsonlFiles.length));
  info.run('generated_at', new Date().toISOString());
  info.run('commit', process.env.GITHUB_SHA ?? 'local');

  db.close();
  return { claims: totalClaims, entities: entities.size, sources: jsonlFiles.length, analyzed };
}

// The DuckDB SQL that reads the per-source JSONL ledgers natively and writes a
// single compact, zstd-compressed Parquet. The column schema is stated
// explicitly rather than sniffed: raw claims (which carry no `rule`) precede
// the derived edges in every file, so a sampled inference would miss the
// optional `rule` field; declaring the columns pins the schema and makes the
// field NULL wherever a claim asserts none. Returned as text (not executed) so
// it is deterministic and unit-testable without a DuckDB binary present - the
// binary only enters at emitClaimsParquet.
export function writeParquetScript(ledgerGlob: string, parquetPath: string): string {
  const glob = ledgerGlob.replace(/\\/g, '/').replace(/'/g, "''");
  const out = parquetPath.replace(/\\/g, '/').replace(/'/g, "''");
  const columns = "{layer: 'VARCHAR', rawSubject: 'VARCHAR', predicate: 'VARCHAR', object: 'VARCHAR', sourceFile: 'VARCHAR', ordinal: 'BIGINT', vintage: 'VARCHAR', rule: 'VARCHAR'}";
  return [
    `COPY (`,
    `  SELECT layer, rawSubject, predicate, object, sourceFile, ordinal, vintage, rule`,
    `  FROM read_json('${glob}', format = 'newline_delimited', columns = ${columns})`,
    `) TO '${out}' (FORMAT parquet, COMPRESSION zstd);`,
  ].join('\n') + '\n';
}

// Locate a DuckDB CLI: an explicit path (env DUCKDB_BIN) wins, else `duckdb` on
// PATH. Returns null when neither resolves - the Parquet lane is optional at
// build time (see the CI note in the module tail), so callers degrade rather
// than fail.
export function findDuckdb(): string | null {
  const explicit = process.env.DUCKDB_BIN;
  if (explicit !== undefined && explicit.trim() !== '') return explicit;
  try {
    execFileSync('duckdb', ['--version'], { stdio: 'ignore' });
    return 'duckdb';
  } catch {
    return null;
  }
}

export interface ParquetSummary {
  parquetPath: string;
  rows: number;
}

// Emit claims.parquet from the JSONL ledgers via DuckDB. Throws when no DuckDB
// CLI is available so the caller can decide to skip rather than half-build. The
// row count is read back from the written Parquet, so it is a fact about the
// artefact, not an assumption about the input.
export function emitClaimsParquet(ledgerDir: string, parquetPath: string, duckdbBin?: string): ParquetSummary {
  const bin = duckdbBin ?? findDuckdb();
  if (bin === null) {
    throw new Error('no DuckDB CLI available (set DUCKDB_BIN or put `duckdb` on PATH) - the Parquet lane is a separately-runnable build step');
  }
  fs.mkdirSync(path.dirname(parquetPath), { recursive: true });
  fs.rmSync(parquetPath, { force: true });
  const glob = path.join(ledgerDir, '*.jsonl');
  // Quiet on success, loud on failure: capture DuckDB's stderr and surface it in
  // the thrown error rather than letting `stdio: 'ignore'` swallow it into an
  // opaque non-zero exit - a silent COPY failure (e.g. no scratch space for the
  // sort spill, or a malformed source row) is exactly the integrity fault that
  // must fail loudly, naming what broke.
  try {
    execFileSync(bin, ['-no-stdin', '-c', writeParquetScript(glob, parquetPath)], {
      // Capture both streams: the DuckDB CLI reports a failed `-c` command on
      // stdout ("IO Error: …"), not stderr, so ignoring stdout would drop the
      // one line that names what broke.
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    const detail = [e.stdout, e.stderr].map(s => (s ?? '').trim()).filter(Boolean).join('\n');
    throw new Error(`DuckDB failed to write Parquet ${parquetPath} from ${glob}: ${detail || String(err)}`);
  }
  const countScript = `SELECT COUNT(*) AS n FROM parquet_scan('${parquetPath.replace(/\\/g, '/').replace(/'/g, "''")}');`;
  const out = execFileSync(bin, ['-no-stdin', '-noheader', '-list', '-c', countScript], { encoding: 'utf8' });
  return { parquetPath, rows: Number(out.trim()) };
}

export interface BuildLedgerDbOptions {
  // Restrict the emit to a subset of entries (the tractable representative
  // build). Omit for the full corpus.
  selectEntry?: EntrySelector;
  // Where the intermediate per-source JSONL ledgers land. A temp dir is used
  // (and cleaned up) when omitted. Provide one to keep the ledger for the
  // Parquet lane.
  ledgerDir?: string;
  // Also emit claims.parquet beside the SQLite when a DuckDB CLI is available.
  parquet?: boolean;
}

export interface BuildLedgerDbResult {
  dbPath: string;
  gzPath: string;
  parquet: ParquetSummary | null;
  sqlite: LedgerSqliteSummary;
  sizes: { sqlite: number; gz: number; parquet: number | null };
}

// The deploy-artefact orchestrator: emit the ledger (Stage 1), load it into the
// claim-ledger SQLite (in its .png costume), write the gzip download twin, and
// optionally the Parquet bulk lane. dbPath should wear the `.png` extension for
// the httpVFS/Pages range-request path, exactly as the combined database does.
export function buildLedgerDb(dbPath: string, options: BuildLedgerDbOptions = {}): BuildLedgerDbResult {
  const ownsLedgerDir = options.ledgerDir === undefined;
  const ledgerRoot = options.ledgerDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'v2-ledger-db-'));
  try {
    buildLedger(ledgerRoot, undefined, undefined, options.selectEntry);
    const ledgerDir = path.join(ledgerRoot, 'ledger');
    const sqlite = buildLedgerSqlite(ledgerDir, dbPath);

    // The download twin: honest name, gzipped. The .png variant exists solely
    // for the site's range-request path (Pages gzip-transcodes text-like
    // content types, corrupting httpVFS reads; image types are never
    // re-compressed). Same rationale as the combined database.
    const gzPath = dbPath.replace(/\.png$/, '') + '.gz';
    fs.writeFileSync(gzPath, zlib.gzipSync(fs.readFileSync(dbPath), { level: GZIP_LEVEL }));

    let parquet: ParquetSummary | null = null;
    if (options.parquet === true) {
      const bin = findDuckdb();
      if (bin !== null) parquet = emitClaimsParquet(ledgerDir, path.join(path.dirname(dbPath), 'claims.parquet'), bin);
    }

    return {
      dbPath,
      gzPath,
      parquet,
      sqlite,
      sizes: {
        sqlite: fs.statSync(dbPath).size,
        gz: fs.statSync(gzPath).size,
        parquet: parquet !== null ? fs.statSync(parquet.parquetPath).size : null,
      },
    };
  } finally {
    if (ownsLedgerDir) fs.rmSync(ledgerRoot, { recursive: true, force: true });
  }
}

export interface BuildClaimsParquetResult {
  parquet: ParquetSummary;
  sizeBytes: number;
}

// Build ONLY the shared claims.parquet (issue #403): materialise the ledger ONCE
// and emit the Parquet the report folds consume, WITHOUT the SQLite the deploy
// database build produces. This is the single materialisation the folds share —
// a workflow runs it once and exports its path as CLAIMS_PARQUET, so every fold
// reads it via read_parquet instead of re-emitting the multi-GB ledger per
// report. skipFailedSources matches how the folds materialise on demand, so the
// Parquet carries the exact claims a fold's fallback would have emitted. Throws
// when no DuckDB CLI is available (the Parquet lane needs the engine, ADR 0002).
export function buildClaimsParquet(parquetPath: string, options: { selectEntry?: EntrySelector } = {}): BuildClaimsParquetResult {
  const bin = findDuckdb();
  if (bin === null) {
    throw new Error('no DuckDB CLI available (set DUCKDB_BIN or put `duckdb` on PATH) - required to build the shared claims.parquet');
  }
  const ledgerRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-claims-parquet-'));
  try {
    buildLedger(ledgerRoot, undefined, undefined, options.selectEntry, true);
    const parquet = emitClaimsParquet(path.join(ledgerRoot, 'ledger'), parquetPath, bin);
    return { parquet, sizeBytes: fs.statSync(parquet.parquetPath).size };
  } finally {
    fs.rmSync(ledgerRoot, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2).filter(a => a.trim().length > 0);
  const flags = new Set(args.filter(a => a.startsWith('--')));
  const positional = args.filter(a => !a.startsWith('--'));
  const useSubset = flags.has('--subset');

  // Parquet-only mode (issue #403): build just the shared claims.parquet the
  // report folds consume, skipping the SQLite database build entirely. The
  // positional argument is the Parquet path.
  if (flags.has('--parquet-only')) {
    const parquetPath = positional[0] ?? path.join('_site', 'data', 'claims.parquet');
    const result = buildClaimsParquet(parquetPath, { selectEntry: useSubset ? subsetSelector() : undefined });
    console.log(`built shared claims.parquet ${result.parquet.parquetPath} (${useSubset ? 'subset' : 'full corpus'})`);
    console.log(`  rows: ${result.parquet.rows}, ${result.sizeBytes} bytes`);
  } else {
    const dbPath = positional[0] ?? path.join('_site', 'data', 'claim-ledger.sqlite.png');
    const wantParquet = flags.has('--parquet');

    // Keep the ledger for the Parquet lane so DuckDB reads the same JSONL the
    // SQLite loaded, rather than re-emitting it.
    const ledgerDir = wantParquet ? fs.mkdtempSync(path.join(os.tmpdir(), 'v2-ledger-db-cli-')) : undefined;
    try {
      const result = buildLedgerDb(dbPath, {
        selectEntry: useSubset ? subsetSelector() : undefined,
        ledgerDir,
        parquet: wantParquet,
      });
      console.log(`built claim-ledger SQLite ${result.dbPath} (${useSubset ? 'subset' : 'full corpus'})`);
      console.log(`  claims: ${result.sqlite.claims}, entities: ${result.sqlite.entities}, sources: ${result.sqlite.sources}, analyzed: ${result.sqlite.analyzed}`);
      console.log(`  sqlite: ${result.sizes.sqlite} bytes, gz twin: ${result.sizes.gz} bytes`);
      if (result.parquet !== null) console.log(`  parquet: ${result.parquet.rows} rows, ${result.sizes.parquet} bytes`);
      else if (wantParquet) console.log('  parquet: skipped - no DuckDB CLI (set DUCKDB_BIN or put `duckdb` on PATH)');
    } finally {
      if (ledgerDir !== undefined) fs.rmSync(ledgerDir, { recursive: true, force: true });
    }
  }
}

/*
 * CI INTEGRATION NOTE (Parquet bulk lane).
 *
 * The repo's supply-chain posture (ADR 0012: ignore-scripts, no native builds)
 * rules out the `duckdb` node package (node-gyp) as a dependency. Two posture-
 * compatible ways to run the Parquet emission in the Pages workflow:
 *
 *  1. Pinned DuckDB CLI binary. Download a specific DuckDB release, verify its
 *     published SHA-256, and invoke it via emitClaimsParquet (DUCKDB_BIN). The
 *     binary is a build tool fetched at deploy time, never committed and never a
 *     package dependency - the same shape as any other pinned CI tool.
 *
 *  2. duckdb-wasm in Node. @duckdb/duckdb-wasm ships a WASM build (no native
 *     compile), driven from a small Node harness. Heavier to wire than the CLI
 *     and slower on a multi-million-row COPY, but it needs no external binary.
 *
 * Until one is wired, the SQLite lane is the fully-built artefact and this
 * Parquet step is separately runnable (`--parquet`, or emitClaimsParquet), so a
 * developer or a future CI step can produce claims.parquet on demand.
 */
