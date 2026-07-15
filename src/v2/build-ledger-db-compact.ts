#!/usr/bin/env node

/**
 * Compactness spike for Stage 2 of the raw-keyed claim-ledger pipeline (issue
 * #361): a size-optimised alternative to the fat, one-row-per-claim SQLite
 * build-ledger-db.ts ships.
 *
 * The fat schema repeats every long string on every claim - `source_file` (a
 * ~50-byte path), `vintage`, `raw_subject`, `cleaned`, `entity` - so a subset
 * of two snapshots already weighs ~301 MB (~230 bytes/claim) and the full
 * corpus (17.9M claims / 21 snapshots) projects to multiple GB, which does not
 * deploy onto GitHub Pages' range-served `.png` SQLite lane. This module keeps
 * the SAME lookup semantics and the SAME query surface (a `claims` VIEW exposes
 * the fat schema's ten columns) but stores the ledger far more compactly:
 *
 *  - PROVENANCE IS SPLIT OFF THE CLAIM. An OBSERVATION (one published row, keyed
 *    (source_file, ordinal)) carries its raw_subject + resolved cleaned/entity
 *    ONCE, instead of on each of its ~6 claims. Only real attribute claims are
 *    stored as rows against an observation.
 *
 *  - THE DERIVED LAYER IS RECONSTRUCTED, NOT STORED. Every observation implies
 *    its @listed anchor, its always-present cleaned-callsign edge, and (when the
 *    token parsed to a placeholder) its placeholder-form edge. Those ~8.7M rows
 *    are synthesised by the VIEW from the observation, never materialised.
 *
 *  - LOW-CARDINALITY STRINGS ARE DICTIONARY-ENCODED. `source_file`+`vintage`
 *    collapse to a 21-row source table; `predicate` and attribute `object`
 *    values collapse to small integer-keyed dictionaries. The high-cardinality
 *    lookup keys (raw_subject / cleaned / entity) stay TEXT ON THE OBSERVATION
 *    so their point-lookup indexes are used verbatim through the VIEW - no
 *    planner gymnastics to translate a typed callsign into a dictionary id.
 *
 * The `claims` VIEW reproduces the fat table's exact ten-column multiset, so the
 * four representative queries and the S3a browser query layer keep working
 * unchanged. build-ledger-db-compact.test.ts asserts the multiset is identical
 * to the fat build's and that the point lookups still plan onto their indexes.
 *
 * Usage:
 *   node src/v2/build-ledger-db-compact.ts [output.sqlite.png] [--subset] [--no-gz-twin]
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { buildLedger, type EntrySelector } from './build-ledger.ts';
import { parseClaimsJsonl } from './serialise.ts';
import { time, timeAsync, perfReport } from '../shared/perf.ts';
import { gzipFileToFile } from '../shared/gzip.ts';
import { applyBuildPragmas } from '../shared/sqlite-build.ts';
import {
  LISTED_PREDICATE,
  NORMALISES_TO_PREDICATE,
  CLEANED_CALLSIGN_RULE,
  PLACEHOLDER_FORM_RULE,
  LICENCE_CATEGORY_PREDICATE,
  LICENCE_CATEGORY_RULE,
  type Claim,
} from './claim.ts';

// Same gzip knob as build-sqlite.ts / build-ledger-db.ts: level 9 for the
// download twin (when a caller wants one - the Pages deploy skips it via
// --no-gz-twin), overridable to level 1 so tests (which check contents, not
// size) stay fast. Any level decompresses to identical bytes.
const GZIP_LEVEL = process.env.TIERS_GZIP_LEVEL !== undefined ? Number(process.env.TIERS_GZIP_LEVEL) : 9;

// Multi-row INSERT batch. Same rationale as the fat build: many rows per
// prepared statement amortise the JS->native crossing. The ceiling is
// SQLite's bound-parameter limit (SQLITE_MAX_VARIABLE_NUMBER, 32,766 in the
// library Node bundles - verified empirically: a 32,766-parameter INSERT
// prepares, 32,767 fails with "too many SQL variables"). The widest insert
// here is the observation (9 bound columns), so a 3,000-row batch binds
// 27,000 parameters - comfortably under the ceiling.
const INSERT_BATCH_ROWS = 3000;

// The compact schema. Four narrow satellite tables plus a `claims` VIEW that
// re-presents the fat schema's ten columns so every existing query keeps
// working. The lookup keys (raw_subject/cleaned/entity) are TEXT on the
// observation - deliberately NOT dictionary-encoded - so `WHERE entity = ?` and
// friends resolve through the VIEW straight onto a real index.
const CREATE_SCHEMA = `
CREATE TABLE source (
  source_id INTEGER PRIMARY KEY,
  source_file TEXT NOT NULL,
  vintage TEXT NOT NULL,
  -- The REAL repo-relative path of the raw source file (issue #431), the true
  -- on-disk path the logical source_file key abstracts. One value per source
  -- (all its observations share it), so it rides here rather than on every
  -- observation row. It is the deep-link's viewAnchor path (§4.5); NULL for a
  -- legacy source whose loader attested no position.
  repo_path TEXT
);
CREATE TABLE predicate (
  predicate_id INTEGER PRIMARY KEY,
  predicate TEXT NOT NULL
);
CREATE TABLE object (
  object_id INTEGER PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE rule (
  rule_id INTEGER PRIMARY KEY,
  rule TEXT NOT NULL
);
CREATE TABLE observation (
  obs_id INTEGER PRIMARY KEY,
  source_id INTEGER NOT NULL,
  ordinal INTEGER NOT NULL,
  raw_subject TEXT NOT NULL,
  cleaned TEXT NOT NULL,
  entity TEXT NOT NULL,
  parses INTEGER NOT NULL,
  -- The SOURCE-INTRINSIC position of this observation in its original (issue
  -- #431, ADR 0015). pos_kind names the coordinate family ('csv-line' in P1);
  -- pos_line is the 1-based physical line for the CSV lane. Both NULL for an
  -- observation whose loader attested no position (a legacy or not-yet-covered
  -- lane). These ENRICH the observation - they do NOT enter the claims VIEW,
  -- so the reconstructed multiset stays byte-identical and no query changes.
  -- P2 adds pos_sheet / pos_row / pos_col / pos_col_ref here for the xlsx lane.
  pos_kind TEXT,
  pos_line INTEGER
);
CREATE TABLE attr (
  obs_id INTEGER NOT NULL,
  predicate_id INTEGER NOT NULL,
  object_id INTEGER NOT NULL
);
-- The placeholder-form edge's object is normally the observation's resolved
-- entity, so the VIEW synthesises it for free. It diverges only in the rare
-- case where two raw tokens share a cleaned form yet parse to DIFFERENT
-- placeholder forms (the resolved entity is last-writer-wins, but each
-- observation's own edge kept its own parse). Those few observations record
-- their true edge object here; everyone else needs no row.
CREATE TABLE ph_override (
  obs_id INTEGER PRIMARY KEY,
  ph_object TEXT NOT NULL
);
-- The derived licence-category tier, kept as a SPARSE satellite (one row per
-- observation whose product mapped to a category, LIFTED via
-- normaliseLicenceCategory) rather than a column on every observation. Sources
-- that disclose no product contribute no rows, so the VIEW's category branch
-- scans an empty relation for them instead of the whole observation table - the
-- same sparse-satellite discipline as ph_override.
CREATE TABLE licence_category (
  obs_id INTEGER PRIMARY KEY,
  category TEXT NOT NULL
);
-- The T1 parse-attribute tier (issue #406): the derived per-callsign attributes
-- parseCallsign yields (prefix_series / implied_class / parse_status, and one
-- row per raised flag). Unlike the normalises_to and licence_category tiers,
-- these are NOT reconstructible from the observation alone (the VIEW is pure
-- SQL and cannot run the parser), so each such claim is stored explicitly,
-- dictionary-encoded on predicate / object / rule and keyed to its observation.
-- A parse yields several per callsign, so this is many rows per observation -
-- still far narrower than the fat table's repeated long strings. Only observed
-- attributes land here (the emit never invents), so the VIEW reconstructs
-- exactly the tier the ledger emitted.
CREATE TABLE derived_attr (
  obs_id INTEGER NOT NULL,
  predicate_id INTEGER NOT NULL,
  object_id INTEGER NOT NULL,
  rule_id INTEGER NOT NULL
);
`;

// The reconstruction VIEW. Every observation implies its @listed anchor and its
// always-present cleaned-callsign edge; an observation that parsed to a
// placeholder (parses = 1) also implies its placeholder-form edge, whose raw
// subject is the CLEANED token (matching how the ledger emits the edge); an
// observation whose product mapped to a category (licence_category <> '')
// implies its derived licence_category claim, keyed to the observation's own raw
// subject. Real attribute claims join through `attr`. The UNION ALL branches
// reproduce the fat table's exact multiset, column-for-column and row-for-row.
const CREATE_CLAIMS_VIEW = `
CREATE VIEW claims (layer, raw_subject, cleaned, entity, predicate, object, rule, source_file, ordinal, vintage) AS
  SELECT 'raw', o.raw_subject, o.cleaned, o.entity, '${LISTED_PREDICATE}', '', NULL, s.source_file, o.ordinal, s.vintage
    FROM observation o JOIN source s ON s.source_id = o.source_id
  UNION ALL
  SELECT 'raw', o.raw_subject, o.cleaned, o.entity, p.predicate, obj.value, NULL, s.source_file, o.ordinal, s.vintage
    FROM attr a
    JOIN observation o ON o.obs_id = a.obs_id
    JOIN source s ON s.source_id = o.source_id
    JOIN predicate p ON p.predicate_id = a.predicate_id
    JOIN object obj ON obj.object_id = a.object_id
  UNION ALL
  SELECT 'derived', o.raw_subject, o.cleaned, o.entity, '${NORMALISES_TO_PREDICATE}', o.cleaned, '${CLEANED_CALLSIGN_RULE}', s.source_file, o.ordinal, s.vintage
    FROM observation o JOIN source s ON s.source_id = o.source_id
    WHERE o.raw_subject <> ''
  UNION ALL
  SELECT 'derived', o.cleaned, o.cleaned, o.entity, '${NORMALISES_TO_PREDICATE}', COALESCE(ov.ph_object, o.entity), '${PLACEHOLDER_FORM_RULE}', s.source_file, o.ordinal, s.vintage
    FROM observation o
    JOIN source s ON s.source_id = o.source_id
    LEFT JOIN ph_override ov ON ov.obs_id = o.obs_id
    WHERE o.parses = 1
  UNION ALL
  SELECT 'derived', o.raw_subject, o.cleaned, o.entity, '${LICENCE_CATEGORY_PREDICATE}', lc.category, '${LICENCE_CATEGORY_RULE}', s.source_file, o.ordinal, s.vintage
    FROM licence_category lc
    JOIN observation o ON o.obs_id = lc.obs_id
    JOIN source s ON s.source_id = o.source_id
  UNION ALL
  SELECT 'derived', o.raw_subject, o.cleaned, o.entity, p.predicate, obj.value, r.rule, s.source_file, o.ordinal, s.vintage
    FROM derived_attr d
    JOIN observation o ON o.obs_id = d.obs_id
    JOIN source s ON s.source_id = o.source_id
    JOIN predicate p ON p.predicate_id = d.predicate_id
    JOIN object obj ON obj.object_id = d.object_id
    JOIN rule r ON r.rule_id = d.rule_id
`;

export interface CompactLedgerSummary {
  observations: number;
  attrClaims: number;
  // Stored T1 parse-attribute claims (issue #406): the derived per-callsign
  // attributes the VIEW cannot synthesise, so they are materialised rows.
  derivedAttrClaims: number;
  claims: number;
  entities: number;
  sources: number;
  predicates: number;
  objects: number;
  overrides: number;
  // Rows in the sparse licence-category satellite: derived canonical-category
  // claims the VIEW reconstructs, one per observation whose product mapped.
  categories: number;
  analyzed: boolean;
}

// The two derived keys a raw token resolves to, using ONLY one source's
// normalises_to edges (never a re-derivation) - the same resolution the fat
// build uses, lifted here so the two builds resolve identically.
interface ResolvedKeys {
  cleaned: string;
  entity: string;
}

function resolveKeys(claims: readonly Claim[]): (rawSubject: string) => ResolvedKeys {
  const cleanedOf = new Map<string, string>();
  const placeholderOf = new Map<string, string>();
  for (const claim of claims) {
    if (claim.predicate !== NORMALISES_TO_PREDICATE) continue;
    if (claim.rule === CLEANED_CALLSIGN_RULE) cleanedOf.set(claim.rawSubject, claim.object);
    else if (claim.rule === PLACEHOLDER_FORM_RULE) placeholderOf.set(claim.rawSubject, claim.object);
  }
  return (rawSubject: string): ResolvedKeys => {
    const cleaned = cleanedOf.get(rawSubject) ?? rawSubject;
    return { cleaned, entity: placeholderOf.get(cleaned) ?? cleaned };
  };
}

// One observation, distilled from a source's claims. `parses` records whether
// THIS observation emitted a placeholder-form edge (read from the actual
// claims, never inferred), so the VIEW reconstructs exactly the edges the
// ledger emitted - not one more, not one fewer.
interface ObservationRecord {
  ordinal: number;
  rawSubject: string;
  cleaned: string;
  entity: string;
  parses: boolean;
  phObject: string | null;
  // The derived licence category for this observation, read from the ledger's
  // own licence_category claim (never re-derived here); '' when none was
  // emitted, so the VIEW omits the derived row exactly as the ledger did.
  licenceCategory: string;
  // The source-intrinsic position (issue #431), read from the observation's
  // @listed anchor claim (position rides on the shared provenance). NULL kind
  // means the loader attested no position for this lane.
  posKind: string | null;
  posLine: number | null;
}

// A dictionary that assigns a stable 1-based integer id to each distinct string
// and remembers insertion order so the table can be written in id order.
class Dictionary {
  private readonly ids = new Map<string, number>();
  private readonly pending: string[] = [];

  intern(value: string): number {
    const existing = this.ids.get(value);
    if (existing !== undefined) return existing;
    const id = this.ids.size + 1;
    this.ids.set(value, id);
    this.pending.push(value);
    return id;
  }

  get size(): number {
    return this.ids.size;
  }

  // Drain the values interned since the last drain, in id order, so the caller
  // can flush them to the table incrementally rather than holding a second copy.
  drainPending(): string[] {
    const drained = this.pending.splice(0, this.pending.length);
    return drained;
  }
}

function bindMany(stmt: ReturnType<DatabaseSync['prepare']>, rows: (string | number | null)[][], width: number): void {
  if (rows.length === 0) return;
  const flat = new Array<string | number | null>(rows.length * width);
  let p = 0;
  for (const row of rows) {
    for (let c = 0; c < width; c += 1) { flat[p] = row[c]; p += 1; }
  }
  stmt.run(...flat);
}

// Insert `rows` through a fixed-size multi-row prepared statement, plus a
// per-row remainder statement for the tail. `sqlBase` is "INSERT INTO t VALUES"
// and each row is `width` bound columns.
function insertBatched(db: DatabaseSync, table: string, width: number, rows: (string | number | null)[][]): void {
  if (rows.length === 0) return;
  const oneRow = `(${Array.from({ length: width }, () => '?').join(', ')})`;
  const bulkStmt = db.prepare(`INSERT INTO ${table} VALUES ${Array.from({ length: INSERT_BATCH_ROWS }, () => oneRow).join(', ')}`);
  const singleStmt = db.prepare(`INSERT INTO ${table} VALUES ${oneRow}`);
  let i = 0;
  const full = rows.length - (rows.length % INSERT_BATCH_ROWS);
  for (; i < full; i += INSERT_BATCH_ROWS) {
    bindMany(bulkStmt, rows.slice(i, i + INSERT_BATCH_ROWS), width);
  }
  for (; i < rows.length; i += 1) {
    singleStmt.run(...rows[i]);
  }
}

// Build the compact claim-ledger SQLite at dbPath from a directory of per-source
// JSONL ledgers (the shape Stage 1 writes into <outputDir>/ledger/). Files are
// read one at a time, so peak memory is one source's claims plus the growing
// predicate/object dictionaries - not the whole corpus.
export function buildCompactLedgerSqlite(ledgerDir: string, dbPath: string): CompactLedgerSummary {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.rmSync(dbPath, { force: true });
  const db = new DatabaseSync(dbPath);
  applyBuildPragmas(db);
  db.exec(CREATE_SCHEMA);

  const predicates = new Dictionary();
  const objects = new Dictionary();
  const rules = new Dictionary();
  const insertSource = db.prepare('INSERT INTO source VALUES (?, ?, ?, ?)');
  const insertPredicate = db.prepare('INSERT INTO predicate VALUES (?, ?)');
  const insertObject = db.prepare('INSERT INTO object VALUES (?, ?)');
  const insertRule = db.prepare('INSERT INTO rule VALUES (?, ?)');
  const insertOverride = db.prepare('INSERT INTO ph_override VALUES (?, ?)');
  const insertCategory = db.prepare('INSERT INTO licence_category VALUES (?, ?)');
  let overrides = 0;
  let categories = 0;
  let totalDerivedAttrClaims = 0;

  const jsonlFiles = fs.readdirSync(ledgerDir).filter(name => name.endsWith('.jsonl')).sort();
  const entities = new Set<string>();
  let nextObsId = 1;
  let totalObservations = 0;
  let totalAttrClaims = 0;

  db.exec('BEGIN');
  jsonlFiles.forEach((file, fileIndex) => {
    const claims = time('ledger:parse-jsonl', () => parseClaimsJsonl(fs.readFileSync(path.join(ledgerDir, file), 'utf8')));
    const keysOf = resolveKeys(claims);
    const sourceId = fileIndex + 1;

    // One pass to distil observations (keyed by ordinal) and mark which parsed.
    const observations = new Map<number, ObservationRecord>();
    let sourceFile = '';
    let vintage = '';
    // The source's real repo path, read from the @listed anchor's viewAnchor
    // (issue #431); one value per source. NULL when the lane attested none.
    let repoPath: string | null = null;
    time('ledger:distil-observations', () => {
      for (const claim of claims) {
        const { ordinal, sourceFile: sf, vintage: vt } = claim.provenance;
        if (sourceFile === '') { sourceFile = sf; vintage = vt; }
        if (claim.predicate === LISTED_PREDICATE) {
          const { cleaned, entity } = keysOf(claim.rawSubject);
          // Read the source position off the anchor's provenance. csv-line is the
          // only kind emitted in P1; a later kind (xlsx sheet-cell) will populate
          // the reserved pos_* columns here.
          const position = claim.provenance.position;
          const posKind = position !== undefined ? position.kind : null;
          const posLine = position !== undefined && position.kind === 'csv-line' ? position.line : null;
          observations.set(ordinal, { ordinal, rawSubject: claim.rawSubject, cleaned, entity, parses: false, phObject: null, licenceCategory: '', posKind, posLine });
          entities.add(entity);
          if (repoPath === null && claim.provenance.viewAnchor !== undefined) repoPath = claim.provenance.viewAnchor.repoPath;
        }
      }
      for (const claim of claims) {
        if (claim.layer === 'derived' && claim.predicate === NORMALISES_TO_PREDICATE && claim.rule === PLACEHOLDER_FORM_RULE) {
          const obs = observations.get(claim.provenance.ordinal);
          if (obs !== undefined) { obs.parses = true; obs.phObject = claim.object; }
        } else if (claim.layer === 'derived' && claim.predicate === LICENCE_CATEGORY_PREDICATE) {
          const obs = observations.get(claim.provenance.ordinal);
          if (obs !== undefined) obs.licenceCategory = claim.object;
        }
      }
    }, claims.length);

    insertSource.run(sourceId, sourceFile, vintage, repoPath);

    // Assign obs_ids in ordinal order and insert the observations (plus their
    // sparse licence-category / placeholder-override satellites).
    const obsIdByOrdinal = new Map<number, number>();
    time('sqlite:obs-insert', () => {
      const obsRows: (string | number | null)[][] = [];
      for (const obs of [...observations.values()].sort((a, b) => a.ordinal - b.ordinal)) {
        const obsId = nextObsId;
        nextObsId += 1;
        obsIdByOrdinal.set(obs.ordinal, obsId);
        obsRows.push([obsId, sourceId, obs.ordinal, obs.rawSubject, obs.cleaned, obs.entity, obs.parses ? 1 : 0, obs.posKind, obs.posLine]);
        // The sparse licence-category satellite: only observations that mapped to
        // a category contribute a row, so a product-less source adds none.
        if (obs.licenceCategory !== '') {
          insertCategory.run(obsId, obs.licenceCategory);
          categories += 1;
        }
        // The rare divergence the VIEW cannot synthesise: this observation's own
        // placeholder-form edge object differs from its resolved entity.
        if (obs.parses && obs.phObject !== null && obs.phObject !== obs.entity) {
          insertOverride.run(obsId, obs.phObject);
          overrides += 1;
        }
      }
      insertBatched(db, 'observation', 9, obsRows);
      totalObservations += obsRows.length;
    }, observations.size);

    // Distil the real attribute claims (raw layer, not @listed, not a
    // normalises_to edge), dictionary-encoding predicate and object.
    const attrRows: (string | number)[][] = [];
    const derivedAttrRows: (string | number)[][] = [];
    time('ledger:dictionary-encode', () => {
      for (const claim of claims) {
        if (claim.layer !== 'raw') continue;
        if (claim.predicate === LISTED_PREDICATE) continue;
        const obsId = obsIdByOrdinal.get(claim.provenance.ordinal);
        if (obsId === undefined) continue;
        attrRows.push([obsId, predicates.intern(claim.predicate), objects.intern(claim.object)]);
      }
      // The T1 parse-attribute tier: every derived claim that is neither a
      // normalises_to edge (synthesised by the VIEW) nor a licence_category tier
      // (its own satellite). Stored explicitly, dictionary-encoded, keyed to the
      // observation whose raw subject the parse ran on - the VIEW cannot run the
      // parser, so these rows carry what it reconstructs.
      for (const claim of claims) {
        if (claim.layer !== 'derived') continue;
        if (claim.predicate === NORMALISES_TO_PREDICATE || claim.predicate === LICENCE_CATEGORY_PREDICATE) continue;
        const obsId = obsIdByOrdinal.get(claim.provenance.ordinal);
        if (obsId === undefined) continue;
        derivedAttrRows.push([obsId, predicates.intern(claim.predicate), objects.intern(claim.object), rules.intern(claim.rule ?? '')]);
      }
    }, claims.length);

    time('sqlite:attr-insert', () => {
      for (const value of predicates.drainPending()) insertPredicate.run(predicates.intern(value), value);
      for (const value of objects.drainPending()) insertObject.run(objects.intern(value), value);
      for (const value of rules.drainPending()) insertRule.run(rules.intern(value), value);
      insertBatched(db, 'attr', 3, attrRows);
      totalAttrClaims += attrRows.length;
      insertBatched(db, 'derived_attr', 4, derivedAttrRows);
      totalDerivedAttrClaims += derivedAttrRows.length;
    }, attrRows.length + derivedAttrRows.length);
  });
  db.exec('COMMIT');

  db.exec(CREATE_CLAIMS_VIEW);

  // Point-lookup indexes live on the observation table (2.9M rows corpus-wide),
  // not on the ~18M synthesised claims - the win that shrinks the indexes. The
  // raw_subject / cleaned / entity indexes back the three fat-schema point
  // lookups verbatim through the VIEW; the attr(obs_id) index backs the
  // per-entity join; the predicate index backs the corpus-aggregate GROUP BY.
  time('sqlite:ledger-indexes', () => {
    db.exec('CREATE INDEX idx_obs_entity ON observation(entity)');
    db.exec('CREATE INDEX idx_obs_cleaned ON observation(cleaned)');
    db.exec('CREATE INDEX idx_obs_raw ON observation(raw_subject)');
    db.exec('CREATE INDEX idx_attr_obs ON attr(obs_id)');
    db.exec('CREATE INDEX idx_attr_predicate ON attr(predicate_id)');
    db.exec('CREATE INDEX idx_derived_attr_obs ON derived_attr(obs_id)');
  });

  // Same load-bearing step as the fat build: without statistics the planner
  // mis-costs the point lookups onto a scan. ANALYZE after the indexes exist.
  // analysis_limit bounds the per-index row sample: statistics only steer the
  // planner towards the point-lookup indexes (asserted by the EXPLAIN QUERY
  // PLAN test), and a 1,000-row sample yields the same plans as a full scan
  // of every multi-million-row index at a fraction of the cost - SQLite's
  // documented approximate-ANALYZE mode, recommended for exactly this.
  db.exec('PRAGMA analysis_limit = 1000');
  time('sqlite:ledger-analyze', () => db.exec('ANALYZE'));
  const analyzed = (db.prepare("SELECT name FROM sqlite_master WHERE name = 'sqlite_stat1'").get() as { name: string } | undefined) !== undefined;

  db.exec('CREATE TABLE build_info (key TEXT, value TEXT)');
  const info = db.prepare('INSERT INTO build_info VALUES (?, ?)');
  const claimCount = Number((db.prepare('SELECT COUNT(*) AS c FROM claims').get() as { c: number | bigint }).c);
  info.run('observations', String(totalObservations));
  info.run('claims', String(claimCount));
  info.run('generated_at', new Date().toISOString());
  info.run('commit', process.env.GITHUB_SHA ?? 'local');

  db.close();
  return {
    observations: totalObservations,
    attrClaims: totalAttrClaims,
    derivedAttrClaims: totalDerivedAttrClaims,
    claims: claimCount,
    entities: entities.size,
    sources: jsonlFiles.length,
    predicates: predicates.size,
    objects: objects.size,
    overrides,
    categories,
    analyzed,
  };
}

export interface BuildCompactDbOptions {
  selectEntry?: EntrySelector;
  ledgerDir?: string;
  // Whether to write the gzipped download twin beside the database (default
  // true). The Pages deploy passes false (--no-gz-twin): chunked serving
  // (issue #475) replaced the twin there, and the workflow otherwise paid a
  // full level-9 gzip of the multi-GB database only to delete the result.
  gzTwin?: boolean;
}

export interface BuildCompactDbResult {
  dbPath: string;
  // null when the twin was skipped (gzTwin: false).
  gzPath: string | null;
  summary: CompactLedgerSummary;
  sizes: { sqlite: number; gz: number | null };
}

// The deploy-artefact orchestrator, mirroring buildLedgerDb: emit the ledger
// (Stage 1), load it into the compact SQLite (in its .png costume), and write
// the gzip download twin unless the caller opted out. dbPath should wear the
// `.png` extension for the httpVFS/Pages range-request path.
export async function buildCompactLedgerDb(dbPath: string, options: BuildCompactDbOptions = {}): Promise<BuildCompactDbResult> {
  const ownsLedgerDir = options.ledgerDir === undefined;
  const ledgerRoot = options.ledgerDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'v2-ledger-compact-'));
  try {
    time('ledger:stage1-emit', () => buildLedger(ledgerRoot, undefined, undefined, options.selectEntry));
    const ledgerDir = path.join(ledgerRoot, 'ledger');
    const summary = buildCompactLedgerSqlite(ledgerDir, dbPath);

    let gzPath: string | null = null;
    if (options.gzTwin ?? true) {
      const twinPath = dbPath.replace(/\.png$/, '') + '.gz';
      // One big stream (a multi-GB database when the twin is built), so pigz
      // splits it across cores when available and a streamed zlib is the
      // fallback - the same parallel gzip the tiers build uses (#546).
      await timeAsync('gzip:ledger-twin', () => gzipFileToFile(dbPath, twinPath, GZIP_LEVEL));
      gzPath = twinPath;
    }

    return {
      dbPath,
      gzPath,
      summary,
      sizes: { sqlite: fs.statSync(dbPath).size, gz: gzPath !== null ? fs.statSync(gzPath).size : null },
    };
  } finally {
    if (ownsLedgerDir) fs.rmSync(ledgerRoot, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2).filter(a => a.trim().length > 0);
  const flags = new Set(args.filter(a => a.startsWith('--')));
  const positional = args.filter(a => !a.startsWith('--'));
  const dbPath = positional[0] ?? path.join('_site', 'data', 'claim-ledger.sqlite.png');
  const { subsetSelector } = await import('./build-ledger-db.ts');
  const useSubset = flags.has('--subset');
  const result = await buildCompactLedgerDb(dbPath, {
    selectEntry: useSubset ? subsetSelector() : undefined,
    // --no-gz-twin: skip the gzipped download twin. The Pages deploy passes
    // this because chunked serving (issue #475) replaced the twin there.
    gzTwin: !flags.has('--no-gz-twin'),
  });
  console.log(`built COMPACT claim-ledger SQLite ${result.dbPath} (${useSubset ? 'subset' : 'full corpus'})`);
  console.log(`  claims: ${result.summary.claims} (observations ${result.summary.observations}, attr ${result.summary.attrClaims}, parse-attr ${result.summary.derivedAttrClaims}), entities: ${result.summary.entities}, sources: ${result.summary.sources}, analyzed: ${result.summary.analyzed}`);
  console.log(`  dictionaries: predicates ${result.summary.predicates}, objects ${result.summary.objects}`);
  console.log(`  sqlite: ${result.sizes.sqlite} bytes${result.sizes.gz !== null ? `, gz twin: ${result.sizes.gz} bytes` : ', gz twin: skipped (--no-gz-twin)'}`);
  // Self-guarded: prints the profiling breakdown to stderr only under PERF.
  perfReport();
}
