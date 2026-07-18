import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as zlib from 'zlib';
import { parse } from 'csv-parse/sync';
import { DatabaseSync } from 'node:sqlite';
import { buildLedger } from './build-ledger.ts';
import { buildLedgerSqlite, subsetSelector } from './build-ledger-db.ts';
import { buildCompactLedgerDb, buildCompactLedgerSqlite, type CompactLedgerSummary } from './build-ledger-db-compact.ts';
import { emitLedger, type SourceObservationSet } from './claim.ts';
import { serialiseClaimsJsonl } from './serialise.ts';
import { loadReferenceData, parseCallsign } from '../sources/ofcom-amateur/components.ts';
import { physicalLines } from '../sources/ofcom-amateur/normalise.ts';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');

// Test names follow the project's Subject_Scenario_Outcome convention.
//
// The compactness spike for Stage 2 (#361): a size-optimised claim-ledger
// SQLite that stores provenance once per observation, reconstructs the derived
// layer through a `claims` VIEW, and dictionary-encodes the low-cardinality
// columns - WITHOUT changing what a consumer sees. The load-bearing scenario is
// therefore parity: the compact `claims` VIEW must return the EXACT same
// ten-column multiset as the fat one-row-per-claim table, so the four
// representative queries and the S3a browser query layer keep working. The
// build runs on the same tractable subset the fat build's tests use: two
// register snapshots (two vintages, the documented G0TQK trailing-NBSP twin,
// the rare placeholder-object divergence the override table exists for - the
// M/EI8DJ observation) PLUS one entry per non-callsign subjectKind (a
// forbidden-suffix list, a statistics aggregate, an available-pool disclosure,
// the pre-war annex's raw-only token sheets - issue #813 Stage B), so parity
// structurally covers the raw-only families whose observations must NOT gain
// normalisation edges (issue #824).

process.env.TIERS_GZIP_LEVEL = '1';

const REF = loadReferenceData();
const G0TQK_ENTITY = parseCallsign('G0TQK', '', REF).placeholderForm;

let workDir: string;
let ledgerDir: string;
let fatPath: string;
let compactPath: string;
let compact: CompactLedgerSummary;

function openDb(file: string): DatabaseSync {
  return new DatabaseSync(file, { readOnly: true });
}

// The fat schema's ten columns, in order, nulls normalised so the two engines'
// row shapes compare cleanly.
const CLAIM_COLUMNS = "layer, raw_subject, cleaned, entity, predicate, object, IFNULL(rule, '') AS rule, source_file, ordinal, vintage";

beforeAll(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'build-ledger-db-compact-'));
  const root = path.join(workDir, 'root');
  // One subset ledger, both schemas built from it, so any difference is the
  // schema's - not a different corpus underneath.
  buildLedger(root, undefined, undefined, subsetSelector());
  ledgerDir = path.join(root, 'ledger');
  fatPath = path.join(workDir, 'fat.sqlite');
  compactPath = path.join(workDir, 'compact.sqlite.png');
  buildLedgerSqlite(ledgerDir, fatPath);
  compact = buildCompactLedgerSqlite(ledgerDir, compactPath);
}, 180_000);

afterAll(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

describe('compact claim-ledger schema', { tags: ['data-validity'] }, () => {
  it('Schema_WhenBuilt_NormalisesProvenanceAndReconstructsClaimsThroughAView', () => {
    const db = openDb(compactPath);
    try {
      // The satellite tables the compaction rests on, plus the `claims` VIEW
      // that re-presents the fat schema so consumers never see the difference.
      const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map(t => t.name).sort();
      // file_claim carries the file-level manifest (issue #434/#455) - the
      // header/subject/furniture claims that describe a source FILE rather than a
      // row, which are not observations and so ride their own satellite.
      expect(tables).toEqual(['attr', 'build_info', 'derived_attr', 'file_claim', 'licence_category', 'object', 'observation', 'ph_override', 'predicate', 'rule', 'source']);
      const views = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'view'").all() as { name: string }[]).map(v => v.name);
      expect(views).toEqual(['claims']);
      const columns = (db.prepare("SELECT name FROM pragma_table_info('claims')").all() as { name: string }[]).map(c => c.name);
      expect(columns).toEqual(['layer', 'raw_subject', 'cleaned', 'entity', 'predicate', 'object', 'rule', 'source_file', 'ordinal', 'vintage']);
    } finally {
      db.close();
    }
  });

  it('FileLevelManifest_WhenBuilt_RidesTheFileClaimSatelliteAndSurfacesThroughTheView', () => {
    // The file-level manifest (issue #434/#455) is NOT an observation: it is
    // carried in file_claim and re-presented by the VIEW as raw claims on the
    // sentinel ordinal with an empty subject. The subset is the open-data lane,
    // which always carries a header, so the manifest must be non-empty and every
    // manifest row must surface through the claims VIEW - so the compact multiset
    // stays identical to the fat build's (proved wholesale by the parity test).
    const db = openDb(compactPath);
    try {
      const fileClaims = Number((db.prepare('SELECT COUNT(*) c FROM file_claim').get() as { c: number | bigint }).c);
      expect(fileClaims).toBeGreaterThan(0);
      expect(compact.fileClaims).toBe(fileClaims);
      // Every file_claim row is a raw claim on the sentinel ordinal in the VIEW.
      const viewFileLevel = Number((db.prepare("SELECT COUNT(*) c FROM claims WHERE ordinal = -1 AND raw_subject = '' AND layer = 'raw'").get() as { c: number | bigint }).c);
      expect(viewFileLevel).toBe(fileClaims);
      // The header manifest is genuinely present: a @subject claim and at least
      // one @column/<index> claim, exactly as emitted.
      const subjects = Number((db.prepare("SELECT COUNT(*) c FROM claims WHERE predicate = '@subject' AND ordinal = -1").get() as { c: number | bigint }).c);
      expect(subjects).toBeGreaterThan(0);
      const columns = Number((db.prepare("SELECT COUNT(*) c FROM claims WHERE predicate LIKE '@column/%' AND ordinal = -1").get() as { c: number | bigint }).c);
      expect(columns).toBeGreaterThan(0);
    } finally {
      db.close();
    }
  });

  it('ProvenanceTables_WhenBuilt_CollapseHighRepetitionColumnsToSmallDictionaries', () => {
    const db = openDb(compactPath);
    try {
      // The subset resolves to nine sources (two register snapshots, one
      // forbidden-suffix list, one statistics table, three available-pool
      // sheets, two pre-war annex sheets), a handful of distinct predicates,
      // and far fewer observations than reconstructed claims - the repetition
      // the fat schema paid for on every row.
      const sources = Number((db.prepare('SELECT COUNT(*) c FROM source').get() as { c: number | bigint }).c);
      expect(sources).toBe(9);
      const observations = Number((db.prepare('SELECT COUNT(*) c FROM observation').get() as { c: number | bigint }).c);
      const claims = Number((db.prepare('SELECT COUNT(*) c FROM claims').get() as { c: number | bigint }).c);
      expect(observations).toBeLessThan(claims / 3);
      expect(compact.observations).toBe(observations);
    } finally {
      db.close();
    }
  });
});

describe('source position is stored on the observation and round-trips (issue #431)', { tags: ['data-validity'] }, () => {
  it('ObservationAndSource_WhenBuilt_GainOnlyThePositionColumns', () => {
    // The golden delta: the observation table gains exactly pos_kind + pos_line
    // beside its original seven columns, and source gains exactly repo_path
    // plus the emits_edges gate (issue #824) - nothing else moves, and the
    // claims VIEW (asserted unchanged above) keeps its ten columns, so the
    // enrichments never disturb a query.
    const db = openDb(compactPath);
    try {
      const obsColumns = (db.prepare("SELECT name FROM pragma_table_info('observation')").all() as { name: string }[]).map(c => c.name);
      expect(obsColumns).toEqual(['obs_id', 'source_id', 'ordinal', 'raw_subject', 'cleaned', 'entity', 'parses', 'pos_kind', 'pos_line']);
      const sourceColumns = (db.prepare("SELECT name FROM pragma_table_info('source')").all() as { name: string }[]).map(c => c.name);
      expect(sourceColumns).toEqual(['source_id', 'source_file', 'vintage', 'repo_path', 'emits_edges']);
    } finally {
      db.close();
    }
  });

  it('EveryObservation_WhenBuiltFromCsvLane_CarriesACsvLinePositionAndRepoPath', () => {
    const db = openDb(compactPath);
    try {
      // Every CSV lane attests positions - the register, available-pool and
      // (since issue #813 Stage D's lossless emit) forbidden-suffix loaders -
      // so none of their observations may be left without one: a NULL there
      // would be a silently dropped attestation. Only a markdown-table source
      // attests no per-row line (the canonical table render needs none), so
      // EXACTLY the statistics extract carries a NULL repo_path - pinned by
      // name so a CSV loader that stopped attesting would fail here rather
      // than silently joining the NULL set.
      const missing = Number((db.prepare(`
        SELECT COUNT(*) c FROM observation o JOIN source s ON s.source_id = o.source_id
        WHERE s.repo_path IS NOT NULL AND (o.pos_kind IS NOT 'csv-line' OR o.pos_line IS NULL)
      `).get() as { c: number | bigint }).c);
      expect(missing).toBe(0);
      const unpositioned = (db.prepare('SELECT source_file FROM source WHERE repo_path IS NULL ORDER BY source_file').all() as { source_file: string }[]).map(r => r.source_file);
      expect(unpositioned).toEqual([
        'foi/wdtk-184767--annual-licence-counts/raw-extract-number-of-licences-coleman.md',
      ]);
    } finally {
      db.close();
    }
  });

  it('StoredPosition_WhenReadBackFromTheDb_LandsOnTheRowThatProducedTheRawSubject', () => {
    // The DB-level round-trip: join observation to source, read the real file at
    // the stored line, and confirm the raw subject appears on it. Sampled evenly
    // so a large source is covered without re-reading the file per row.
    const db = openDb(compactPath);
    try {
      // Scoped to the position-attesting sources (repo_path present); the
      // forbidden/statistics lanes attest none, pinned by the test above.
      const rows = db.prepare(`
        SELECT o.raw_subject AS raw, o.pos_line AS line, s.repo_path AS repoPath
        FROM observation o JOIN source s ON s.source_id = o.source_id
        WHERE o.raw_subject <> '' AND s.repo_path IS NOT NULL ORDER BY o.obs_id
      `).all() as { raw: string; line: number; repoPath: string }[];
      expect(rows.length).toBeGreaterThan(0);
      const linesByPath = new Map<string, string[]>();
      const step = Math.max(1, Math.floor(rows.length / 300));
      let checked = 0;
      for (let i = 0; i < rows.length; i += step) {
        const { raw, line, repoPath } = rows[i];
        let lines = linesByPath.get(repoPath);
        if (lines === undefined) {
          lines = physicalLines(fs.readFileSync(path.join(REPO_ROOT, repoPath), 'utf8'));
          linesByPath.set(repoPath, lines);
        }
        const record = (parse(`${lines[0]}\n${lines[line - 1]}\n`, { columns: true, bom: true, relax_column_count: true }) as Record<string, string>[])[0] ?? {};
        // The raw subject must be one of the cells of the attested line.
        expect(Object.values(record)).toContain(raw);
        checked += 1;
      }
      expect(checked).toBeGreaterThan(0);
    } finally {
      db.close();
    }
  });
});

describe('parity with the fat one-row-per-claim schema', { tags: ['data-validity'] }, () => {
  it('ClaimsView_WhenComparedToFatTable_ReturnsIdenticalMultiset', () => {
    // The strongest oracle: the compact VIEW must be a row-for-row multiset
    // match of the fat table across all ten columns. Computed entirely in SQL
    // (ATTACH + EXCEPT + a multiplicity join) so it stays memory-safe on the
    // multi-million-row corpus rather than materialising both streams in JS.
    const db = openDb(fatPath);
    try {
      db.exec(`ATTACH '${compactPath.replace(/'/g, "''")}' AS c`);
      const scalar = (sql: string): number => Number((db.prepare(sql).get() as { n: number | bigint }).n);
      const grouped = (rel: string): string => `SELECT ${CLAIM_COLUMNS}, COUNT(*) AS multiplicity FROM ${rel} GROUP BY layer, raw_subject, cleaned, entity, predicate, object, IFNULL(rule, ''), source_file, ordinal, vintage`;

      // Same total row count.
      expect(scalar('SELECT COUNT(*) AS n FROM main.claims')).toBe(scalar('SELECT COUNT(*) AS n FROM c.claims'));
      // Identical DISTINCT row sets, both directions.
      expect(scalar(`SELECT COUNT(*) AS n FROM (SELECT ${CLAIM_COLUMNS} FROM main.claims EXCEPT SELECT ${CLAIM_COLUMNS} FROM c.claims)`)).toBe(0);
      expect(scalar(`SELECT COUNT(*) AS n FROM (SELECT ${CLAIM_COLUMNS} FROM c.claims EXCEPT SELECT ${CLAIM_COLUMNS} FROM main.claims)`)).toBe(0);
      // Identical multiplicities: no group where the two schemas disagree on how
      // many times a row occurs. Set equality plus this closes multiset parity.
      expect(scalar(`SELECT COUNT(*) AS n FROM (${grouped('main.claims')}) f JOIN (${grouped('c.claims')}) g
        USING (layer, raw_subject, cleaned, entity, predicate, object, rule, source_file, ordinal, vintage)
        WHERE f.multiplicity <> g.multiplicity`)).toBe(0);
    } finally {
      db.close();
    }
  }, 180_000);

  it('PlaceholderObjectDivergence_WhenTwoRawTokensShareACleanedForm_IsPreservedViaOverride', () => {
    // The rare case the override table exists for: the same cleaned token parses
    // to two different placeholder forms, so an observation's own edge object
    // differs from its resolved (last-writer) entity. The compact build must
    // keep the edge's true object, not paper over it with the entity.
    expect(compact.overrides).toBeGreaterThan(0);
    const fat = openDb(fatPath);
    const cmp = openDb(compactPath);
    try {
      const sql = "SELECT DISTINCT object FROM claims WHERE rule = 'placeholder-form' AND raw_subject = 'M/EI8DJ' ORDER BY object";
      const fatObjects = (fat.prepare(sql).all() as { object: string }[]).map(r => r.object);
      const cmpObjects = (cmp.prepare(sql).all() as { object: string }[]).map(r => r.object);
      expect(cmpObjects).toEqual(fatObjects);
      // The divergence is real: the edge kept a distinct object from the entity.
      const both = (cmp.prepare("SELECT DISTINCT object, entity FROM claims WHERE rule = 'placeholder-form' AND raw_subject = 'M/EI8DJ'").all() as { object: string; entity: string }[]);
      expect(both.some(r => r.object !== r.entity)).toBe(true);
    } finally {
      fat.close();
      cmp.close();
    }
  });
});

describe('the emits_edges gate re-presents exactly what the ledger emitted (issue #824)', { tags: ['data-validity'] }, () => {
  it('EmitsEdgesFlag_WhenBuiltAcrossSubjectKinds_RecordsWhichSourcesCarryEdgesInTheLedger', () => {
    // The per-source flag is read from the persisted JSONL, never re-derived
    // from subject kinds: the two callsign register snapshots carry a cleaned
    // edge per observation (flag 1); the forbidden-suffix, statistics,
    // available-pool and pre-war annex sources carry none (flag 0) - the fat
    // side's stated invariant, "a non-callsign token is never mis-normalised AS
    // a callsign". The annex family (issue #813 Stage B) lands with
    // emits_edges = 0 from its first registered build.
    const db = openDb(compactPath);
    try {
      const flags = db.prepare('SELECT source_file, emits_edges FROM source ORDER BY source_file').all() as { source_file: string; emits_edges: number }[];
      const edgeless = flags.filter(f => f.emits_edges === 0).map(f => f.source_file);
      const edgeful = flags.filter(f => f.emits_edges === 1).map(f => f.source_file);
      expect(edgeful).toHaveLength(2);
      expect(edgeful.every(f => f.includes('all-callsigns') || f.includes('allocated-reserved'))).toBe(true);
      expect(edgeless).toHaveLength(7);
      expect(edgeless.some(f => f.includes('forbidden'))).toBe(true);
      expect(edgeless.some(f => f.includes('annual-licence-counts'))).toBe(true);
      expect(edgeless.filter(f => f.includes('available-callsigns-list'))).toHaveLength(3);
      expect(edgeless.filter(f => f.includes('out-of-sequence-callsigns'))).toHaveLength(2);
    } finally {
      db.close();
    }
  });

  it('ClaimsView_WhenSourceEmittedNoEdges_SynthesisesNoNormalisationEdges', () => {
    // The defect the issue reports: the old VIEW synthesised a cleaned-callsign
    // edge for EVERY observation with a non-empty raw subject, presenting a
    // forbidden suffix (ADS), a pool slot or a statistics period as if it were
    // a normalised callsign - rows that exist in no persisted ledger and in no
    // fat build. Gated, the VIEW returns zero edges for edge-less sources.
    const db = openDb(compactPath);
    try {
      const fabricated = Number((db.prepare(`
        SELECT COUNT(*) c FROM claims WHERE predicate = 'normalises_to'
        AND source_file IN (SELECT source_file FROM source WHERE emits_edges = 0)
      `).get() as { c: number | bigint }).c);
      expect(fabricated).toBe(0);
      // The suffix ADS is present as a raw observation but never as a
      // normalisation subject - the issue's own example.
      const adsRaw = Number((db.prepare("SELECT COUNT(*) c FROM claims WHERE raw_subject = 'ADS' AND layer = 'raw' AND predicate = '@listed'").get() as { c: number | bigint }).c);
      expect(adsRaw).toBeGreaterThan(0);
      const adsEdges = Number((db.prepare("SELECT COUNT(*) c FROM claims WHERE raw_subject = 'ADS' AND predicate = 'normalises_to'").get() as { c: number | bigint }).c);
      expect(adsEdges).toBe(0);
    } finally {
      db.close();
    }
  });

  it('ClaimsView_WhenSourceEmittedEdges_KeepsTheUniformEdgePerCallsignIncludingIdentity', () => {
    // The deliberate design the gate must NOT disturb: every callsign
    // observation gets its cleaned-callsign edge - identity edges (raw ==
    // cleaned) included - so callsign queries need no conditionals. One edge
    // per subject-bearing observation of an edge-emitting source, exactly.
    const db = openDb(compactPath);
    try {
      const subjectBearing = Number((db.prepare(`
        SELECT COUNT(*) c FROM observation o JOIN source s ON s.source_id = o.source_id
        WHERE s.emits_edges = 1 AND o.raw_subject <> ''
      `).get() as { c: number | bigint }).c);
      const cleanedEdges = Number((db.prepare("SELECT COUNT(*) c FROM claims WHERE predicate = 'normalises_to' AND rule = 'cleaned-callsign'").get() as { c: number | bigint }).c);
      expect(subjectBearing).toBeGreaterThan(0);
      expect(cleanedEdges).toBe(subjectBearing);
      // Identity edges survive: an already-clean token still carries its edge.
      const identity = Number((db.prepare("SELECT COUNT(*) c FROM claims WHERE predicate = 'normalises_to' AND rule = 'cleaned-callsign' AND raw_subject = object").get() as { c: number | bigint }).c);
      expect(identity).toBeGreaterThan(0);
      const g0tqk = Number((db.prepare("SELECT COUNT(*) c FROM claims WHERE predicate = 'normalises_to' AND rule = 'cleaned-callsign' AND raw_subject = 'G0TQK' AND object = 'G0TQK'").get() as { c: number | bigint }).c);
      expect(g0tqk).toBeGreaterThan(0);
    } finally {
      db.close();
    }
  });

  it('CompactBuild_WhenForbiddenSuffixOnlyLedger_FabricatesNoDerivedRows', () => {
    // The issue's verified reproduction: a forbidden-suffix-only build. The fat
    // claims table holds raw claims and ZERO derived rows; the compact VIEW
    // must agree instead of inventing an `ADS normalises_to ADS` per suffix.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compact-forbidden-only-'));
    try {
      buildLedger(dir, undefined, undefined, entry => entry === 'ofcom-2024-12--forbidden-suffixes');
      const onlyLedger = path.join(dir, 'ledger');
      const fatOnly = path.join(dir, 'fat.sqlite');
      const compactOnly = path.join(dir, 'compact.sqlite');
      buildLedgerSqlite(onlyLedger, fatOnly);
      buildCompactLedgerSqlite(onlyLedger, compactOnly);
      const fat = openDb(fatOnly);
      const cmp = openDb(compactOnly);
      try {
        const count = (db: DatabaseSync, layer: string): number =>
          Number((db.prepare('SELECT COUNT(*) c FROM claims WHERE layer = ?').get(layer) as { c: number | bigint }).c);
        expect(count(fat, 'derived')).toBe(0);
        expect(count(cmp, 'derived')).toBe(0);
        expect(count(cmp, 'raw')).toBe(count(fat, 'raw'));
        expect(count(fat, 'raw')).toBeGreaterThan(0);
      } finally {
        fat.close();
        cmp.close();
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it('CompactBuild_WhenLedgerHoldsPartialEdgeCoverage_FailsLoudRatherThanFabricateOrDrop', () => {
    // The per-source flag is exact for every ledger the emit path can produce
    // (edge emission is a per-source fact: a collector declares its subjectKind
    // once). A ledger with edges for only SOME observations of a source is one
    // this schema cannot faithfully re-present - integrity doubt, so the build
    // must fail loud, never fabricate the missing edges or drop the present ones.
    const observationSet: SourceObservationSet = {
      sourceFile: 'synthetic/partial-edges.csv',
      vintage: '2020-01-01',
      columns: ['callsign'],
      subjectColumn: 'callsign',
      rows: [{ callsign: 'M0AAA' }, { callsign: 'M0BBB' }],
    };
    const full = emitLedger(observationSet, REF);
    // Remove exactly one cleaned-callsign edge, leaving partial coverage.
    const dropIndex = full.findIndex(claim => claim.predicate === 'normalises_to' && claim.rule === 'cleaned-callsign');
    expect(dropIndex).toBeGreaterThanOrEqual(0);
    const partial = full.filter((claim, index) => index !== dropIndex);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compact-partial-edges-'));
    try {
      fs.writeFileSync(path.join(dir, 'partial.jsonl'), serialiseClaimsJsonl(partial));
      expect(() => buildCompactLedgerSqlite(dir, path.join(dir, 'out.sqlite'))).toThrow(/partial edge coverage/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('BuildInfo_WhenBuilt_StampsTheCompactSchemaVersion', () => {
    // The source table gained a column and the VIEW a gate: a reader of the
    // deployed artefact can tell the post-gate schema ('2') from an unstamped
    // pre-gate database whose VIEW fabricated edges.
    const db = openDb(compactPath);
    try {
      const version = (db.prepare("SELECT value FROM build_info WHERE key = 'schema_version'").get() as { value: string } | undefined)?.value;
      expect(version).toBe('2');
    } finally {
      db.close();
    }
  });
});

describe('the four representative queries answer identically on both schemas', { tags: ['data-validity'] }, () => {
  // Each representative query is run against the fat table and the compact VIEW
  // and the result sets must match exactly - the contract that lets the compact
  // schema drop in for the fat one without touching the query layer.
  function bothAgree(sql: string, ...params: (string | number)[]): void {
    const fat = openDb(fatPath);
    const cmp = openDb(compactPath);
    try {
      expect(cmp.prepare(sql).all(...params)).toEqual(fat.prepare(sql).all(...params));
    } finally {
      fat.close();
      cmp.close();
    }
  }

  it('PerEntityDossier_WhenQueriedByEntity_AgreesAcrossVintagesAndLayers', () => {
    bothAgree(
      "SELECT vintage, raw_subject, object FROM claims WHERE entity = ? AND predicate = 'Status' ORDER BY vintage, object",
      G0TQK_ENTITY,
    );
    bothAgree('SELECT layer, raw_subject, cleaned, entity, predicate, object, rule, source_file, ordinal, vintage FROM claims WHERE entity = ? ORDER BY vintage, source_file, ordinal, predicate', G0TQK_ENTITY);
  });

  it('VariantsOfEntity_WhenEntityHasNbspTwin_AgreesOnBothRawTokens', () => {
    bothAgree('SELECT DISTINCT raw_subject FROM claims WHERE entity = ? ORDER BY raw_subject', G0TQK_ENTITY);
  });

  it('DirectCallsignLookup_WhenUserTypesLiteralCallsign_AgreesViaCleanedKey', () => {
    bothAgree("SELECT DISTINCT raw_subject, vintage FROM claims WHERE cleaned = 'G0TQK' AND predicate = '@listed' ORDER BY vintage, raw_subject");
    bothAgree("SELECT DISTINCT entity FROM claims WHERE cleaned = 'G0TQK'");
  });

  it('TemporalFold_WhenFoldedByWindowFunction_AgreesOnFirstAndLastVintage', () => {
    bothAgree(`
      SELECT DISTINCT entity,
        FIRST_VALUE(vintage) OVER w AS first_seen,
        LAST_VALUE(vintage) OVER w AS last_seen
      FROM claims WHERE predicate = '@listed' AND entity = ?
      WINDOW w AS (PARTITION BY entity ORDER BY vintage ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING)
    `, G0TQK_ENTITY);
  });

  it('CorpusAggregate_WhenGroupedByPredicate_AgreesOnEveryPredicateCount', () => {
    bothAgree('SELECT predicate, COUNT(*) AS n FROM claims GROUP BY predicate ORDER BY predicate');
  });
});

describe('point lookups still plan onto their indexes after ANALYZE', { tags: ['data-validity'] }, () => {
  it('QueryPlanner_AfterAnalyze_PlansPointLookupsOntoObservationIndexes', () => {
    const db = openDb(compactPath);
    try {
      expect(compact.analyzed).toBe(true);
      const statRows = Number((db.prepare('SELECT COUNT(*) AS c FROM sqlite_stat1').get() as { c: number | bigint }).c);
      expect(statRows).toBeGreaterThan(0);
      // Every branch of the reconstruction VIEW must seek the relevant
      // observation index rather than scanning the observation table.
      for (const [column, index] of [['entity', 'idx_obs_entity'], ['cleaned', 'idx_obs_cleaned'], ['raw_subject', 'idx_obs_raw']] as const) {
        const plan = (db.prepare(`EXPLAIN QUERY PLAN SELECT * FROM claims WHERE ${column} = ?`).all('G0TQK') as { detail: string }[]).map(r => r.detail);
        expect(plan.some(d => d.includes(`USING INDEX ${index}`) || (column === 'raw_subject' && d.includes('USING INDEX idx_obs_cleaned')))).toBe(true);
        expect(plan.some(d => /\bSCAN observation\b/.test(d))).toBe(false);
      }
    } finally {
      db.close();
    }
  });
});

describe('the gzip download twin is deploy-optional (issue #533)', { tags: ['data-validity'] }, () => {
  // Chunked serving (issue #475) replaced the download twin on the deploy
  // path, which then deleted the twin it had just spent a level-9 gzip of the
  // full database producing. The orchestrator therefore accepts gzTwin: false
  // so the deploy never builds it, while every other caller keeps the twin by
  // default. Built from a single small disclosure so the full orchestrator
  // (Stage-1 emit included) stays fast; the database CONTENT is covered by
  // the parity suites above.
  const selectSmall = (entry: string): boolean => entry === 'ofcom-498906--reciprocal-licences-since-2010';

  it('BuildOrchestrator_WhenGzTwinNotDisabled_ProducesTwinThatGunzipsToTheDatabase', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compact-gz-twin-on-'));
    try {
      const dbPath = path.join(dir, 'claim-ledger.sqlite.png');
      const result = await buildCompactLedgerDb(dbPath, { selectEntry: selectSmall });
      expect(result.gzPath).not.toBeNull();
      if (result.gzPath === null) throw new Error('unreachable - asserted non-null above');
      expect(result.gzPath.endsWith('.sqlite.gz')).toBe(true);
      // The twin must gunzip byte-identical to the served database - content
      // equivalence via the decompressed stream, never .gz bytes.
      const gunzipped = zlib.gunzipSync(fs.readFileSync(result.gzPath));
      expect(gunzipped.equals(fs.readFileSync(dbPath))).toBe(true);
      expect(result.sizes.gz).toBe(fs.statSync(result.gzPath).size);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it('BuildOrchestrator_WhenGzTwinDisabled_SkipsTheTwinEntirely', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compact-gz-twin-off-'));
    try {
      const dbPath = path.join(dir, 'claim-ledger.sqlite.png');
      const result = await buildCompactLedgerDb(dbPath, { selectEntry: selectSmall, gzTwin: false });
      // Skipped means never produced - not produced then deleted.
      expect(result.gzPath).toBeNull();
      expect(result.sizes.gz).toBeNull();
      expect(fs.readdirSync(dir).some(name => name.endsWith('.gz'))).toBe(false);
      // The database itself is untouched by the skip: present and openable.
      const db = openDb(dbPath);
      try {
        const claims = Number((db.prepare('SELECT COUNT(*) c FROM claims').get() as { c: number | bigint }).c);
        expect(claims).toBeGreaterThan(0);
      } finally {
        db.close();
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});

describe('the compact build is smaller and answers stably', { tags: ['data-validity'] }, () => {
  it('OnDiskSize_WhenBuiltOnSameLedger_IsFarSmallerThanFat', () => {
    // The whole point: the same ledger, the same answers, a fraction of the
    // bytes. On the subset the fat schema is a well-documented ~230 bytes/claim;
    // the compact schema is under a third of that.
    const fatSize = fs.statSync(fatPath).size;
    const compactSize = fs.statSync(compactPath).size;
    expect(compactSize).toBeLessThan(fatSize / 3);
    expect(compactSize / compact.claims).toBeLessThan(80);
  });

  it('Sqlite_WhenRebuiltFromSameLedger_AnswersIdentically', () => {
    // SQLite files are not byte-deterministic, so the oracle is answer-identity:
    // a rebuild loads the same counts and answers the variants query identically.
    const rebuiltPath = path.join(workDir, 'rebuilt-compact.sqlite');
    const rebuilt = buildCompactLedgerSqlite(ledgerDir, rebuiltPath);
    expect(rebuilt.claims).toBe(compact.claims);
    expect(rebuilt.observations).toBe(compact.observations);
    expect(rebuilt.entities).toBe(compact.entities);
    const rebuiltDb = openDb(rebuiltPath);
    const firstDb = openDb(compactPath);
    try {
      const variantsSql = 'SELECT DISTINCT raw_subject FROM claims WHERE entity = ? ORDER BY raw_subject';
      const rebuiltVariants = (rebuiltDb.prepare(variantsSql).all(G0TQK_ENTITY) as { raw_subject: string }[]).map(r => r.raw_subject);
      const firstVariants = (firstDb.prepare(variantsSql).all(G0TQK_ENTITY) as { raw_subject: string }[]).map(r => r.raw_subject);
      // The clean token plus one distinct raw twin - identical across rebuilds,
      // asserted against the first build rather than hard-coded bytes so the
      // twin's exact whitespace artefact is not baked into the test.
      expect(rebuiltVariants).toEqual(firstVariants);
      expect(rebuiltVariants.length).toBe(2);
      expect(rebuiltVariants).toContain('G0TQK');
      expect(rebuiltVariants.some(v => v !== 'G0TQK' && v.startsWith('G0TQK'))).toBe(true);
    } finally {
      rebuiltDb.close();
      firstDb.close();
    }
  }, 180_000);
});
