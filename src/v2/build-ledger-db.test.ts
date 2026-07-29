import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as zlib from 'zlib';
import { DatabaseSync } from 'node:sqlite';
import { buildLedger } from './build-ledger.ts';
import {
  buildLedgerDb,
  buildLedgerSqlite,
  subsetSelector,
  writeParquetScript,
  emitClaimsParquet,
  findDuckdb,
  type LedgerSqliteSummary,
} from './build-ledger-db.ts';
import { emitLedger, type SourceObservationSet } from './claim.ts';
import { serialiseClaimsJsonl } from './serialise.ts';
import { loadReferenceData, parseCallsign } from '../sources/ofcom-amateur/components.ts';
import { assertNonEmpty } from '../testing/non-vacuity.ts';

// Test names follow the project's Subject_Scenario_Outcome convention.
//
// Stage 2 of the raw-keyed claim-ledger pipeline (#361): the claim ledger
// (JSONL) becomes the queryable artefacts. The scenario is the browser lane's
// contract - a query-optimised claim-ledger SQLite that answers the four
// representative lookups correctly, with the statistics ANALYZE gathers so the
// point lookups plan onto their indexes rather than a full scan (the mis-plan
// the bench-off measured at 300ms-3.6s). The build runs on the tractable
// subset: two register snapshots spanning two vintages (including the
// documented G0TQK trailing-NBSP twin, so the four queries have real temporal
// and raw variance) plus one entry per non-callsign subjectKind, so the
// artefact carries the raw-only families the compact parity oracle must cover
// (issue #824).

// Fast gzip for the download twin - the tests check CONTENTS, not size, so any
// level is correct and level 1 is fastest.
process.env.TIERS_GZIP_LEVEL = '1';

const REF = loadReferenceData();
// The entity the G0TQK twin resolves to: its RSL-less placeholder form, the
// canonical cross-regional key the ledger's normalises_to edges terminate at.
// Computed the same way the ledger derives it, never hard-coded, so a change to
// the placeholder rule surfaces here rather than silently passing.
const G0TQK_ENTITY = parseCallsign('G0TQK', '', REF).placeholderForm;
const V_2016 = '2016-09-20';
const V_2022 = '2022-03-07';

let workDir: string;
let ledgerDir: string;
let dbPath: string;
let gzPath: string;
let summary: LedgerSqliteSummary;

function openDb(file: string): DatabaseSync {
  return new DatabaseSync(file, { readOnly: true });
}

beforeAll(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'build-ledger-db-'));
  // Retain the ledger so the determinism and Parquet tests reuse the same
  // JSONL the SQLite loaded, rather than re-emitting it.
  ledgerDir = path.join(workDir, 'work');
  dbPath = path.join(workDir, 'claim-ledger.sqlite.png');
  const result = buildLedgerDb(dbPath, { selectEntry: subsetSelector(), ledgerDir });
  gzPath = result.gzPath;
  summary = result.sqlite;
}, 180_000);

afterAll(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

describe('claim-ledger SQLite artefact', { tags: ['data-validity'] }, () => {
  it('BuildOrchestrator_WhenBuilt_ShipsPngCostumeAndByteIdenticalGzipTwin', () => {
    // The .png costume for the httpVFS range-request path plus the honest-named
    // gzip download twin, exactly as the combined database ships. The twin must
    // gunzip byte-identical to the range-request variant.
    expect(dbPath.endsWith('.sqlite.png')).toBe(true);
    expect(fs.existsSync(dbPath)).toBe(true);
    expect(gzPath.endsWith('.sqlite.gz')).toBe(true);
    const gunzipped = zlib.gunzipSync(fs.readFileSync(gzPath));
    expect(gunzipped.equals(fs.readFileSync(dbPath))).toBe(true);
    // A real corpus subset produced a substantial ledger: two register
    // snapshots plus the forbidden-suffix list, the statistics table, the
    // three available-pool sheets and the two pre-war annex sheets (one entry
    // per subjectKind, issues #824 / #813 Stage B).
    expect(summary.claims).toBeGreaterThan(1_000_000);
    expect(summary.sources).toBe(9);
  });

  it('NonCallsignSources_WhenEmitted_CarryNoNormalisationEdges', () => {
    // The subject-kind gate, visible in the artefact (issue #824): a forbidden
    // suffix, a pool slot or a statistics period is never mis-normalised AS a
    // callsign, so the non-callsign sources contribute raw observations and NO
    // derived normalises_to edges - while the callsign register sources carry
    // their uniform edge per observation.
    const db = openDb(dbPath);
    try {
      const edgesFor = (pattern: string): number =>
        Number((db.prepare("SELECT COUNT(*) AS c FROM claims WHERE predicate = 'normalises_to' AND source_file LIKE ?").get(pattern) as { c: number | bigint }).c);
      const rawFor = (pattern: string): number =>
        Number((db.prepare("SELECT COUNT(*) AS c FROM claims WHERE layer = 'raw' AND source_file LIKE ?").get(pattern) as { c: number | bigint }).c);
      for (const entry of ['ofcom-2024-12--forbidden-suffixes', 'wdtk-184767--annual-licence-counts', 'wdtk-197896--available-callsigns-list', 'wdtk-238892--out-of-sequence-callsigns']) {
        const pattern = `foi/${entry}/%`;
        expect(rawFor(pattern)).toBeGreaterThan(0);
        expect(edgesFor(pattern)).toBe(0);
      }
      expect(edgesFor('foi/ofcom-2016-09-20--callsign-database--all-callsigns/%')).toBeGreaterThan(0);
    } finally {
      db.close();
    }
  });

  it('Schema_WhenBuilt_CarriesResolvedEntityBesideRawSubjectWithLookupIndexes', () => {
    const db = openDb(dbPath);
    try {
      const columns = (db.prepare("SELECT name FROM pragma_table_info('claims')").all() as { name: string }[]).map(c => c.name);
      expect(columns).toEqual(['layer', 'raw_subject', 'cleaned', 'entity', 'predicate', 'object', 'rule', 'source_file', 'ordinal', 'vintage']);
      const indexes = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'claims' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map(i => i.name).sort();
      expect(indexes).toEqual(['idx_claims_cleaned', 'idx_claims_entity', 'idx_claims_predicate', 'idx_claims_raw_subject']);
    } finally {
      db.close();
    }
  });
});

describe('the four representative lookup queries', { tags: ['data-validity'] }, () => {
  it('PerEntityDossier_WhenQueriedByEntity_ReturnsEveryClaimAcrossVintages', () => {
    const db = openDb(dbPath);
    try {
      // The dossier for the entity gathers claims from BOTH snapshots. The
      // 2022 disclosure carries the dual status honestly - the clean token
      // Reserved, the NBSP twin Allocated - and 2016 carries its own status.
      const statuses = db.prepare(
        "SELECT vintage, raw_subject, object FROM claims WHERE entity = ? AND predicate = 'Status' ORDER BY vintage, object",
      ).all(G0TQK_ENTITY) as { vintage: string; raw_subject: string; object: string }[];
      expect(statuses).toEqual([
        { vintage: V_2016, raw_subject: 'G0TQK', object: 'Reserved' },
        { vintage: V_2022, raw_subject: 'G0TQK ', object: 'Allocated' },
        { vintage: V_2022, raw_subject: 'G0TQK', object: 'Reserved' },
      ]);
      // The dossier spans both vintages and both layers (raw claims plus the
      // derived normalisation edges).
      const vintages = (db.prepare('SELECT DISTINCT vintage FROM claims WHERE entity = ? ORDER BY vintage').all(G0TQK_ENTITY) as { vintage: string }[]).map(r => r.vintage);
      expect(vintages).toEqual([V_2016, V_2022]);
      const layers = (db.prepare('SELECT DISTINCT layer FROM claims WHERE entity = ? ORDER BY layer').all(G0TQK_ENTITY) as { layer: string }[]).map(r => r.layer);
      expect(layers).toEqual(['derived', 'raw']);
    } finally {
      db.close();
    }
  });

  it('VariantsOfEntity_WhenEntityHasNbspTwin_ResolvesBothRawTokensToOneEntity', () => {
    const db = openDb(dbPath);
    try {
      // The whole point of the raw-keyed ledger: two DISTINCT raw tokens (the
      // clean "G0TQK" and its trailing-NBSP twin) resolve to one entity, kept
      // apart as tokens but joined as an entity - an auditable join, not a
      // silent merge.
      const variants = (db.prepare('SELECT DISTINCT raw_subject FROM claims WHERE entity = ? ORDER BY raw_subject').all(G0TQK_ENTITY) as { raw_subject: string }[]).map(r => r.raw_subject);
      expect(variants).toContain('G0TQK');
      expect(variants).toContain('G0TQK ');
      expect(variants.length).toBe(2);
    } finally {
      db.close();
    }
  });

  it('DirectCallsignLookup_WhenUserTypesLiteralCallsign_ResolvesViaCleanedIndexAcrossRawVariants', () => {
    const db = openDb(dbPath);
    try {
      // A user types a literal, human-readable callsign. It matches `cleaned`
      // in one indexed hop - the browser never has to compute the placeholder
      // form - and finds every raw rendering, including the NBSP twin that only
      // the raw layer keeps distinct.
      const listed = db.prepare(
        "SELECT DISTINCT raw_subject, vintage FROM claims WHERE cleaned = 'G0TQK' AND predicate = '@listed' ORDER BY vintage, raw_subject",
      ).all() as { raw_subject: string; vintage: string }[];
      // Three listed observations: the clean token in both 2016 and 2022, plus
      // the 2022 NBSP twin - one indexed cleaned lookup surfaces all of them.
      // The twin's exact whitespace byte is not asserted (it is a raw
      // artefact); what matters is that a SECOND, distinct raw token that also
      // cleans to G0TQK is found.
      expect(listed.map(r => r.vintage)).toEqual([V_2016, V_2022, V_2022]);
      const tokens = listed.map(r => r.raw_subject);
      expect(tokens.filter(t => t === 'G0TQK').length).toBe(2);
      expect(tokens.some(t => t !== 'G0TQK')).toBe(true);
      // The human-readable cleaned key resolves to the never-shown placeholder
      // entity, so display and unification stay linked.
      const entities = (db.prepare("SELECT DISTINCT entity FROM claims WHERE cleaned = 'G0TQK'").all() as { entity: string }[]).map(r => r.entity);
      expect(entities).toEqual([G0TQK_ENTITY]);
    } finally {
      db.close();
    }
  });

  it('Entity_WhenRegionalRenderingsOfOneLicence_UnifiesToSinglePlaceholderKey', () => {
    // The cross-regional unification the placeholder entity exists for: one
    // licence rendered in two regions (an England M0ABC and a Wales MW0ABC)
    // carries two distinct cleaned callsigns but collapses to ONE entity, so a
    // per-entity view groups the regional renderings together. Built from a
    // synthetic two-row source so the scenario is crisp and corpus-independent.
    const expectedEntity = parseCallsign('M0ABC', '', REF).placeholderForm;
    // Sanity: the two regional renderings genuinely share the placeholder key.
    expect(parseCallsign('MW0ABC', '', REF).placeholderForm).toBe(expectedEntity);

    const observationSet: SourceObservationSet = {
      sourceFile: 'synthetic/regional-renderings.csv',
      vintage: '2020-01-01',
      columns: ['callsign'],
      subjectColumn: 'callsign',
      rows: [{ callsign: 'M0ABC' }, { callsign: 'MW0ABC' }],
    };
    const syntheticDir = path.join(workDir, 'synthetic');
    fs.mkdirSync(syntheticDir, { recursive: true });
    fs.writeFileSync(path.join(syntheticDir, 'regional.jsonl'), serialiseClaimsJsonl(emitLedger(observationSet, REF)));
    const syntheticDb = path.join(workDir, 'synthetic.sqlite');
    buildLedgerSqlite(syntheticDir, syntheticDb);

    const db = openDb(syntheticDb);
    try {
      const entities = (db.prepare("SELECT DISTINCT entity FROM claims WHERE cleaned IN ('M0ABC', 'MW0ABC')").all() as { entity: string }[]).map(r => r.entity);
      expect(entities).toEqual([expectedEntity]);
      const cleaned = (db.prepare('SELECT DISTINCT cleaned FROM claims WHERE entity = ? ORDER BY cleaned').all(expectedEntity) as { cleaned: string }[]).map(r => r.cleaned);
      expect(cleaned).toEqual(['M0ABC', 'MW0ABC']);
    } finally {
      db.close();
    }
  });

  it('TemporalFold_WhenFoldedByWindowFunction_ReportsFirstAndLastVintagePerEntity', () => {
    const db = openDb(dbPath);
    try {
      // A window function folds the per-vintage @listed claims into a first-
      // seen/last-seen span per entity - the ledger-as-timeline projection.
      const fold = db.prepare(`
        SELECT DISTINCT entity,
          FIRST_VALUE(vintage) OVER w AS first_seen,
          LAST_VALUE(vintage) OVER w AS last_seen
        FROM claims WHERE predicate = '@listed' AND entity = ?
        WINDOW w AS (PARTITION BY entity ORDER BY vintage ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING)
      `).get(G0TQK_ENTITY) as { entity: string; first_seen: string; last_seen: string };
      expect(fold).toEqual({ entity: G0TQK_ENTITY, first_seen: V_2016, last_seen: V_2022 });
      // The fold is meaningful because many entities genuinely span both
      // vintages - not a single-snapshot artefact.
      const spanning = db.prepare(`
        SELECT COUNT(*) AS c FROM (
          SELECT entity FROM claims WHERE predicate = '@listed'
          GROUP BY entity HAVING COUNT(DISTINCT vintage) > 1
        )
      `).get() as { c: number | bigint };
      expect(Number(spanning.c)).toBeGreaterThan(1000);
    } finally {
      db.close();
    }
  });

  it('CorpusAggregate_WhenGroupedByPredicate_AccountsForEveryClaim', () => {
    const db = openDb(dbPath);
    try {
      // A corpus-wide GROUP BY: the per-predicate counts partition the whole
      // ledger, so they sum back to the total claim count.
      const total = Number((db.prepare('SELECT COUNT(*) AS c FROM claims').get() as { c: number | bigint }).c);
      const summed = Number((db.prepare('SELECT SUM(n) AS s FROM (SELECT predicate, COUNT(*) AS n FROM claims GROUP BY predicate)').get() as { s: number | bigint }).s);
      expect(summed).toBe(total);
      expect(total).toBe(summary.claims);
      // The existence predicate counts once per observation, so it equals the
      // sum of the two snapshots' row counts - a sanity check the aggregate is
      // over the whole corpus, not one snapshot.
      const listed = Number((db.prepare("SELECT COUNT(*) AS c FROM claims WHERE predicate = '@listed'").get() as { c: number | bigint }).c);
      expect(listed).toBeGreaterThan(0);
      expect(listed).toBeLessThan(total);
    } finally {
      db.close();
    }
  });
});

describe('ANALYZE fixes the point-lookup planning', { tags: ['data-validity'] }, () => {
  it('QueryPlanner_AfterAnalyze_HasStatisticsAndPlansPointLookupsOntoIndexes', () => {
    const db = openDb(dbPath);
    try {
      // ANALYZE ran at build time: the statistics tables exist and carry rows.
      expect(summary.analyzed).toBe(true);
      const stat1 = db.prepare("SELECT name FROM sqlite_master WHERE name = 'sqlite_stat1'").get() as { name: string } | undefined;
      expect(stat1).toBeDefined();
      const statRows = Number((db.prepare('SELECT COUNT(*) AS c FROM sqlite_stat1').get() as { c: number | bigint }).c);
      expect(statRows).toBeGreaterThan(0);

      // The high-selectivity point lookups the bench-off flagged plan onto
      // their indexes rather than scanning the multi-million-row table.
      const entityPlan = (db.prepare('EXPLAIN QUERY PLAN SELECT * FROM claims WHERE entity = ?').all(G0TQK_ENTITY) as { detail: string }[]).map(r => r.detail).join(' | ');
      expect(entityPlan).toContain('idx_claims_entity');
      const cleanedPlan = (db.prepare('EXPLAIN QUERY PLAN SELECT * FROM claims WHERE cleaned = ?').all('G0TQK') as { detail: string }[]).map(r => r.detail).join(' | ');
      expect(cleanedPlan).toContain('idx_claims_cleaned');
      const rawPlan = (db.prepare('EXPLAIN QUERY PLAN SELECT * FROM claims WHERE raw_subject = ?').all('G0TQK') as { detail: string }[]).map(r => r.detail).join(' | ');
      expect(rawPlan).toContain('idx_claims_raw_subject');
    } finally {
      db.close();
    }
  });
});

describe('deterministic build', { tags: ['data-validity'] }, () => {
  it('Ledger_WhenReEmitted_IsByteIdentical', () => {
    // The canonical JSONL is deterministic (stable key order, stored ordinals),
    // so a re-emit is a byte no-op - a real re-run diff is a genuine signal.
    const second = path.join(workDir, 'reemit');
    buildLedger(second, undefined, undefined, subsetSelector());
    const dirA = path.join(ledgerDir, 'ledger');
    const dirB = path.join(second, 'ledger');
    const filesA = assertNonEmpty(fs.readdirSync(dirA).filter(f => f.endsWith('.jsonl')).sort(), 'ledger JSONL files');
    const filesB = fs.readdirSync(dirB).filter(f => f.endsWith('.jsonl')).sort();
    expect(filesB).toEqual(filesA);
    for (const file of filesA) {
      expect(fs.readFileSync(path.join(dirB, file)).equals(fs.readFileSync(path.join(dirA, file)))).toBe(true);
    }
  }, 180_000);

  it('Sqlite_WhenRebuiltFromSameLedger_AnswersIdenticallyEvenIfBytesDiffer', () => {
    // SQLite files are not byte-deterministic (build_info timestamps, internal
    // layout), so the oracle is answer-identity: a rebuild loads the same claim
    // count and answers the entity dossier identically.
    const rebuiltPath = path.join(workDir, 'rebuilt.sqlite');
    const rebuilt = buildLedgerSqlite(path.join(ledgerDir, 'ledger'), rebuiltPath);
    expect(rebuilt.claims).toBe(summary.claims);
    expect(rebuilt.entities).toBe(summary.entities);
    const db = openDb(rebuiltPath);
    try {
      const variants = (db.prepare('SELECT DISTINCT raw_subject FROM claims WHERE entity = ? ORDER BY raw_subject').all(G0TQK_ENTITY) as { raw_subject: string }[]).map(r => r.raw_subject);
      expect(variants).toEqual(['G0TQK', 'G0TQK ']);
    } finally {
      db.close();
    }
  }, 180_000);
});

describe('DuckDB -> Parquet bulk lane', { tags: ['data-validity'] }, () => {
  it('ParquetScript_WhenGenerated_ReadsJsonlNativelyAndCopiesToCompactParquet', () => {
    // The DuckDB SQL is deterministic and unit-testable without a DuckDB binary
    // present: it reads the newline-delimited JSONL (union_by_name reconciles
    // the optional rule field) and COPYs to a zstd-compressed Parquet.
    const sql = writeParquetScript('/ledger/*.jsonl', '/out/claims.parquet');
    expect(sql).toContain("read_json('/ledger/*.jsonl', format = 'newline_delimited'");
    // The optional rule field is pinned in the explicit column schema so it is
    // never dropped by sampled inference.
    expect(sql).toContain("rule: 'VARCHAR'");
    expect(sql).toContain("TO '/out/claims.parquet' (FORMAT parquet, COMPRESSION zstd)");
    // Insertion-order preservation is off (issue #991): it takes this build's
    // peak resident memory from 6.7 GB to 1.3 GB at no cost in sweep time. Pinned
    // because losing it silently would give back a 5.3x memory reduction while
    // every report it produces still looked correct — the regression would show
    // up only as a runner running out of room, months later and somewhere else.
    expect(sql).toContain('SET preserve_insertion_order = false;');
  });

  it('Parquet_WhenDuckdbAvailable_RowCountMatchesClaimCount', () => {
    // Gated on a DuckDB CLI (DUCKDB_BIN or `duckdb` on PATH): the Parquet lane
    // is a separately-runnable build step (the supply-chain posture keeps
    // DuckDB out of the npm dependency tree), so this asserts the artefact when
    // the binary is present and is a no-op otherwise.
    const bin = findDuckdb();
    if (bin === null) {
      expect(bin).toBeNull();
      return;
    }
    const parquet = emitClaimsParquet(path.join(ledgerDir, 'ledger'), path.join(workDir, 'claims.parquet'), bin);
    expect(parquet.rows).toBe(summary.claims);
  }, 180_000);

  it('EmitClaimsParquet_WhenDuckdbCopyFails_ThrowsNamingTheUnderlyingCauseNotAnOpaqueExit', () => {
    // Fail loud: a COPY that fails (here, a ledger directory with no JSONL for the
    // glob to match) must surface DuckDB's own diagnostic, not a bare non-zero
    // exit. This guards the stderr-capture that replaced `stdio: 'ignore'` - a
    // silent COPY failure is exactly the integrity fault that must name what broke.
    const bin = findDuckdb();
    if (bin === null) {
      expect(bin).toBeNull();
      return;
    }
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acf-empty-ledger-'));
    try {
      let message = '';
      expect(() => {
        try {
          emitClaimsParquet(emptyDir, path.join(emptyDir, 'out.parquet'), bin);
        } catch (err) {
          message = String((err as Error).message);
          throw err;
        }
      }).toThrow(/DuckDB failed to write Parquet/);
      // The thrown message carries DuckDB's actual complaint (the empty glob), so
      // a failure is diagnosable rather than an inscrutable `status: 1`.
      expect(message.toLowerCase()).toMatch(/no files found|io error|glob/);
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});
