import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { DatabaseSync } from 'node:sqlite';
import { buildSqlite, buildPublishedTiers } from '../ci/build-sqlite.ts';
import { buildProjectionDbs } from './build-projection-db.ts';
import { placeholderOf, buildPredicate, matchingCountSql, setDiffSql, COLUMNS } from '../../site/browser-query.js';

// Test names follow Subject_Scenario_Outcome per project convention.
//
// PARITY GATE for the ledger projection databases (issue #572): the interactive
// surfaces (site/app.js, compare.js, entry-browser.js, explore.js) move off the
// legacy build-sqlite.ts databases onto the ledger-derived projection ONLY
// because this suite proves, over the REAL corpus, that the projection exposes
// equivalent data - table-for-table row counts, identical row multisets for the
// register-shaped tables, and identical result sets for the exact queries the
// surfaces run (callsign lookup incl. RSL/placeholder-form normalisation, the
// visitor home-country card's series data, suffix availability, per-dataset
// scoping, cross-publication counts and set-diffs, FOI history). The legacy
// build keeps running beside the projection until #445 retires it; a failure
// here blocks that retirement chain.
//
// Heavy by design (two full deploy-database builds + a ledger emit); it runs in
// the isolated heavy pool (src/testing/heavy-tests.json). PROJECTION_PARITY_DIR
// reuses a prebuilt scratch directory across local runs, mirroring the tiers
// test's TIERS_CACHE_DIR discipline.

let scratch: string;
let ownsScratch = false;
let legacyLookup: DatabaseSync;
let legacyHistory: DatabaseSync;
let projectionLookup: DatabaseSync;
let projectionHistory: DatabaseSync;

const LEGACY_DIR = 'legacy';
const PROJECTION_DIR = 'projection';
const LEDGER_DIR = 'ledger-emit';

beforeAll(async () => {
  const reuse = process.env.PROJECTION_PARITY_DIR?.trim() || undefined;
  scratch = reuse ?? fs.mkdtempSync(path.join(os.tmpdir(), 'projection-parity-'));
  ownsScratch = reuse === undefined;
  const legacyDir = path.join(scratch, LEGACY_DIR);
  const projectionDir = path.join(scratch, PROJECTION_DIR);

  if (!fs.existsSync(path.join(legacyDir, 'callsigns.sqlite.png'))) {
    fs.mkdirSync(legacyDir, { recursive: true });
    buildSqlite(path.join(legacyDir, 'callsigns.sqlite.png'));
    await buildPublishedTiers(legacyDir, { compress: false });
  }
  if (!fs.existsSync(path.join(projectionDir, 'ledger-lookup.sqlite.png'))) {
    buildProjectionDbs(
      path.join(projectionDir, 'ledger-lookup.sqlite.png'),
      path.join(projectionDir, 'ledger-history.sqlite.png'),
      { ledgerDir: path.join(scratch, LEDGER_DIR) },
    );
  }

  legacyLookup = new DatabaseSync(path.join(legacyDir, 'callsigns.sqlite.png'), { readOnly: true });
  legacyHistory = new DatabaseSync(path.join(legacyDir, 'combined.sqlite.png'), { readOnly: true });
  projectionLookup = new DatabaseSync(path.join(projectionDir, 'ledger-lookup.sqlite.png'), { readOnly: true });
  projectionHistory = new DatabaseSync(path.join(projectionDir, 'ledger-history.sqlite.png'), { readOnly: true });
}, 3_600_000);

afterAll(() => {
  for (const db of [legacyLookup, legacyHistory, projectionLookup, projectionHistory]) {
    try { db?.close(); } catch { /* already closed or never opened */ }
  }
  if (ownsScratch) fs.rmSync(scratch, { recursive: true, force: true });
});

type Row = Record<string, string | number | bigint | null>;

function all(db: DatabaseSync, sql: string, params: (string | number)[] = []): Row[] {
  return db.prepare(sql).all(...params) as Row[];
}

function tableNames(db: DatabaseSync): string[] {
  return all(db, "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .map(r => String(r.name));
}

function count(db: DatabaseSync, table: string): number {
  return Number((db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get() as { n: number | bigint }).n);
}

function columnsOf(db: DatabaseSync, table: string): string[] {
  return all(db, `SELECT name FROM pragma_table_info('${table}') ORDER BY cid`).map(r => String(r.name));
}

// A whole-table content digest, order-normalised: every row is rendered as a
// unit-separated string (NULL distinguished from '' by a sentinel), streamed in
// a deterministic ORDER BY over every column, and folded into one SHA-256. Two
// tables digest equal iff their row multisets are equal - the streaming keeps
// the million-row register history out of memory.
function tableDigest(db: DatabaseSync, table: string, columns: readonly string[]): string {
  const nullSentinel = String.fromCharCode(30);
  const rendered = columns.map(c => `COALESCE(CAST("${c}" AS TEXT), '${nullSentinel}')`);
  const orderBy = columns.map(c => `"${c}"`).join(', ');
  const sql = `SELECT ${rendered.map((r, i) => `${r} AS c${i}`).join(', ')} FROM "${table}" ORDER BY ${orderBy}`;
  const hash = crypto.createHash('sha256');
  const unit = String.fromCharCode(31);
  for (const row of db.prepare(sql).iterate()) {
    const cells = columns.map((_, i) => String((row as Row)[`c${i}`]));
    hash.update(cells.join(unit));
    hash.update('\n');
  }
  return hash.digest('hex');
}

// Assert two databases return the identical result set for a query - the exact
// SQL a surface runs, row order included (surfaces render rows in query order).
function expectSameResults(sql: string, params: (string | number)[] = []): void {
  const legacyDb = sql.includes('register_history') || sql.includes('observations') || sql.includes('history_datasets')
    ? legacyHistory : legacyLookup;
  const projectionDb = legacyDb === legacyHistory ? projectionHistory : projectionLookup;
  const legacyRows = all(legacyDb, sql, params);
  const projectionRows = all(projectionDb, sql, params);
  expect(projectionRows).toEqual(legacyRows);
}

// The exact row-select the lookup runs (site/app.js ROW_SELECT).
const ROW_SELECT =
  `SELECT n.*, c.parse_status, c.prefix_series, c.rsl, c.suffix AS cs_suffix,
          c.placeholder_form, c.home_callsign, c.implied_class, c.flags
   FROM components c JOIN normalised n ON n.callsign = c.callsign`;

describe('Ledger projection parity - lookup database', { tags: ['data-validity'] }, () => {
  it('LookupProjection_TableInventory_CarriesEveryLegacyTable', () => {
    const legacy = tableNames(legacyLookup);
    const projection = tableNames(projectionLookup);
    expect(projection).toEqual(legacy);
    for (const table of legacy) {
      expect(columnsOf(projectionLookup, table)).toEqual(columnsOf(legacyLookup, table));
    }
  });

  it('LookupProjection_EveryTable_RowCountMatchesLegacy', () => {
    for (const table of tableNames(legacyLookup)) {
      if (table === 'build_info') continue; // timestamps differ by construction
      expect(count(projectionLookup, table), table).toBe(count(legacyLookup, table));
    }
  });

  it('LookupProjection_NormalisedTable_IdenticalRowMultiset', () => {
    const columns = columnsOf(legacyLookup, 'normalised');
    expect(tableDigest(projectionLookup, 'normalised', columns)).toBe(tableDigest(legacyLookup, 'normalised', columns));
  });

  it('LookupProjection_ComponentsTable_IdenticalRowMultiset', () => {
    const columns = columnsOf(legacyLookup, 'components');
    expect(tableDigest(projectionLookup, 'components', columns)).toBe(tableDigest(legacyLookup, 'components', columns));
  });

  it('LookupProjection_ReferenceTables_IdenticalRowMultisets', () => {
    for (const table of ['ref_rsl', 'ref_prefix_formats', 'ref_forbidden_suffixes', 'itu_series', 'flag_registry', 'rsl_matrix']) {
      const columns = columnsOf(legacyLookup, table);
      expect(tableDigest(projectionLookup, table, columns), table).toBe(tableDigest(legacyLookup, table, columns));
    }
  });

  it('Lookup_CallsignRowSelect_SampledCallsignsReturnIdenticalRows', () => {
    // The exact lookup query, over a deliberately interesting sample: ordinary
    // rows, artefact-damaged rows (callsign != cleaned), flagged rows, and
    // visitor rows (the home-country card's input).
    const sample = new Set<string>();
    for (const r of all(legacyLookup, 'SELECT callsign FROM components ORDER BY callsign LIMIT 5')) sample.add(String(r.callsign));
    for (const r of all(legacyLookup, "SELECT callsign FROM components WHERE callsign != cleaned LIMIT 5")) sample.add(String(r.callsign));
    for (const r of all(legacyLookup, "SELECT callsign FROM components WHERE flags != '' LIMIT 5")) sample.add(String(r.callsign));
    for (const r of all(legacyLookup, "SELECT callsign FROM components WHERE home_callsign != '' LIMIT 5")) sample.add(String(r.callsign));
    for (const r of all(legacyLookup, "SELECT callsign FROM components WHERE parse_status = 'unparseable' LIMIT 5")) sample.add(String(r.callsign));
    expect(sample.size).toBeGreaterThan(10);
    for (const callsign of sample) {
      const legacyRows = all(legacyLookup, `${ROW_SELECT} WHERE c.callsign = ? LIMIT 1`, [callsign]);
      const projectionRows = all(projectionLookup, `${ROW_SELECT} WHERE c.callsign = ? LIMIT 1`, [callsign]);
      expect(projectionRows, callsign).toEqual(legacyRows);
      expect(legacyRows).toHaveLength(1);
    }
  });

  it('Lookup_RslPlaceholderNormalisation_RegionalRenderingResolvesIdentically', () => {
    // A regional rendering (MW7...) is resolved by the browser-side
    // placeholderOf, then matched against components.placeholder_form - run the
    // exact fallback query the lookup runs and require identical results.
    const core = all(legacyLookup, "SELECT callsign, placeholder_form FROM components WHERE parse_status = 'parsed' AND placeholder_form LIKE 'M#7%' ORDER BY callsign LIMIT 1")[0];
    expect(core).toBeDefined();
    const rendering = String(core.placeholder_form).replace('#', 'W');
    const placeholder = placeholderOf(rendering);
    expect(placeholder).toBe(String(core.placeholder_form));
    const sql = `${ROW_SELECT} WHERE c.placeholder_form = ? ORDER BY n.callsign LIMIT 5`;
    const legacyRows = all(legacyLookup, sql, [String(placeholder)]);
    const projectionRows = all(projectionLookup, sql, [String(placeholder)]);
    expect(projectionRows).toEqual(legacyRows);
    expect(legacyRows.length).toBeGreaterThan(0);
  });

  it('Lookup_ArtefactRecoveryByCleanedKey_ReturnsIdenticalRows', () => {
    const damaged = all(legacyLookup, "SELECT cleaned FROM components WHERE callsign != cleaned AND cleaned != '' LIMIT 3");
    expect(damaged.length).toBeGreaterThan(0);
    for (const row of damaged) {
      const sql = `${ROW_SELECT} WHERE c.cleaned = ? ORDER BY n.callsign LIMIT 5`;
      expect(all(projectionLookup, sql, [String(row.cleaned)])).toEqual(all(legacyLookup, sql, [String(row.cleaned)]));
    }
  });

  it('Lookup_SuffixAvailabilityMatrix_ReturnsIdenticalRows', () => {
    // The suffix matrix's register-state query (site/app.js suffixMatrix), for
    // a real suffix and a withheld one.
    const suffixes = [
      String(all(legacyLookup, "SELECT suffix FROM components WHERE parse_status = 'parsed' AND suffix != '' GROUP BY suffix ORDER BY COUNT(*) DESC LIMIT 1")[0].suffix),
      String(all(legacyLookup, 'SELECT suffix FROM ref_forbidden_suffixes ORDER BY suffix LIMIT 1')[0].suffix),
    ];
    for (const suffix of suffixes) {
      const sql = `SELECT c.prefix_series, c.placeholder_form, c.flags, n.callsign, n.status, n.product,
              COALESCE(NULLIF(n.last_modified_date, ''), n.licence_version_last_modified_date) AS modified
       FROM components c JOIN normalised n ON n.callsign = c.callsign
       WHERE c.suffix = ? AND c.parse_status = 'parsed' ORDER BY n.callsign`;
      expect(all(projectionLookup, sql, [suffix]), suffix).toEqual(all(legacyLookup, sql, [suffix]));
    }
  });

  it('Lookup_VisitorHomeCountryCardData_ItuSeriesQueriesIdentical', () => {
    // The visitor card queries itu_series by the home call's first character.
    for (const first of ['F', 'D', 'W', '2', 'S']) {
      const sql = 'SELECT series, allocated_to FROM itu_series WHERE series LIKE ? ORDER BY series';
      expect(all(projectionLookup, sql, [`${first}%`]), first).toEqual(all(legacyLookup, sql, [`${first}%`]));
    }
  });

  it('Lookup_FacetPopulationQueries_ReturnIdenticalVocabularies', () => {
    for (const sql of [
      'SELECT flag, meaning FROM flag_registry ORDER BY flag',
      'SELECT DISTINCT status FROM normalised ORDER BY status',
      'SELECT DISTINCT parse_status FROM components ORDER BY parse_status',
      `SELECT DISTINCT prefix_series FROM components WHERE prefix_series != '' ORDER BY prefix_series`,
    ]) {
      expect(all(projectionLookup, sql), sql).toEqual(all(legacyLookup, sql));
    }
  });

  it('Lookup_FilteredFacetList_CountAndFirstPageIdentical', () => {
    // The filtered-list path (site/app.js buildConds/filteredList): a flag
    // facet AND a status facet, count + first page.
    const where = `WHERE (';' || c.flags || ';') LIKE ? AND n.status IN (?)`;
    const params = ['%;forbidden-suffix;%', 'Allocated'];
    const countSql = `SELECT COUNT(*) AS n FROM components c JOIN normalised n ON n.callsign = c.callsign ${where}`;
    expect(all(projectionLookup, countSql, params)).toEqual(all(legacyLookup, countSql, params));
    const pageSql = `SELECT c.callsign, n.status, n.product, c.parse_status, c.flags
     FROM components c JOIN normalised n ON n.callsign = c.callsign
     ${where} ORDER BY c.callsign LIMIT 50 OFFSET 0`;
    const legacyPage = all(legacyLookup, pageSql, params);
    expect(all(projectionLookup, pageSql, params)).toEqual(legacyPage);
    expect(legacyPage.length).toBeGreaterThan(0);
  });

  it('Lookup_BuildInfo_DeclaresTheSameDataset', () => {
    const key = (db: DatabaseSync): string =>
      String((db.prepare("SELECT value FROM build_info WHERE key = 'dataset'").get() as { value: string }).value);
    expect(key(projectionLookup)).toBe(key(legacyLookup));
  });
});

describe('Ledger projection parity - history database', { tags: ['data-validity'] }, () => {
  it('HistoryProjection_TableInventory_CarriesEveryLegacyTable', () => {
    const legacy = tableNames(legacyHistory);
    const projection = tableNames(projectionHistory);
    // The projection adds build_info (provenance); every legacy table must be
    // present with the identical column set and order.
    expect(projection.filter(t => t !== 'build_info')).toEqual(legacy);
    for (const table of legacy) {
      expect(columnsOf(projectionHistory, table), table).toEqual(columnsOf(legacyHistory, table));
    }
  });

  it('HistoryProjection_EveryTable_RowCountMatchesLegacy', () => {
    for (const table of tableNames(legacyHistory)) {
      expect(count(projectionHistory, table), table).toBe(count(legacyHistory, table));
    }
  });

  it('HistoryProjection_HistoryDatasets_IdenticalRows', () => {
    const sql = 'SELECT * FROM history_datasets ORDER BY dataset';
    expect(all(projectionHistory, sql)).toEqual(all(legacyHistory, sql));
  });

  it('HistoryProjection_RegisterHistory_PerDatasetCountsMatch', () => {
    const sql = 'SELECT dataset, COUNT(*) AS n FROM register_history GROUP BY dataset ORDER BY dataset';
    expect(all(projectionHistory, sql)).toEqual(all(legacyHistory, sql));
  });

  it('HistoryProjection_RegisterHistory_IdenticalRowMultiset', () => {
    const columns = columnsOf(legacyHistory, 'register_history');
    expect(tableDigest(projectionHistory, 'register_history', columns))
      .toBe(tableDigest(legacyHistory, 'register_history', columns));
  });

  it('HistoryProjection_Observations_IdenticalRowMultiset', () => {
    const columns = columnsOf(legacyHistory, 'observations');
    expect(tableDigest(projectionHistory, 'observations', columns))
      .toBe(tableDigest(legacyHistory, 'observations', columns));
  });

  it('History_CompareSurface_PublicationListQueryIdentical', () => {
    // The exact eager boot query compare.js runs (loadDatasets).
    expectSameResults('SELECT dataset, record_count, intended_complete, scope_notes, coverage_affecting FROM history_datasets ORDER BY dataset DESC');
  });

  it('History_CompareSurface_FilteredCountsAndSetDiffsIdentical', () => {
    // The comparison surface's canonical queries, built by the SAME shared
    // query core the page uses (site/browser-query.js): a real predicate over
    // the two newest publications - counts per publication, then the
    // appeared/disappeared/status-changed set-diffs on the cleaned key.
    const datasets = all(legacyHistory, 'SELECT dataset FROM history_datasets ORDER BY dataset DESC LIMIT 2').map(r => String(r.dataset));
    expect(datasets).toHaveLength(2);
    const [later, earlier] = datasets;
    const predicate = "suffix IN (SELECT suffix FROM ref_forbidden_suffixes) AND status = 'Allocated'";
    for (const dataset of datasets) {
      expectSameResults(matchingCountSql(dataset, predicate));
    }
    const diff = setDiffSql(earlier, later, predicate);
    expectSameResults(diff.appeared);
    expectSameResults(diff.disappeared);
    expectSameResults(diff.changed);
  });

  it('History_EntryBrowser_ScopedFilterQueryIdentical', () => {
    // The single-publication browser's composed query (entry-browser.js
    // filtersSql over the shared buildPredicate), dataset-scoped with a toggle
    // and a column filter - count + first page.
    const dataset = String(all(legacyHistory, 'SELECT dataset FROM history_datasets ORDER BY dataset DESC LIMIT 1')[0].dataset);
    const state = {
      facets: new Map([['status', { key: 'status', field: 'status', isExpr: false, label: 'status', values: new Set(['Allocated']), exclude: false }]]),
      toggles: new Set(['raw-cleaned']),
      columnFilters: new Map(),
      sort: [{ col: 'callsign', dir: 'ASC' }],
      pageSize: 25,
      customSql: null,
    };
    const where = buildPredicate(state, { dataset });
    const cols = COLUMNS.map((c: string) => `"${c}"`).join(', ');
    expectSameResults(`SELECT COUNT(*) AS n FROM register_history WHERE ${where}`);
    expectSameResults(`SELECT * FROM (SELECT ${cols} FROM register_history WHERE ${where} ORDER BY "callsign" ASC) LIMIT 25 OFFSET 0`);
  });

  it('History_EntryBrowser_StatusByClassExampleIdentical', () => {
    const dataset = String(all(legacyHistory, 'SELECT dataset FROM history_datasets ORDER BY dataset DESC LIMIT 1')[0].dataset);
    expectSameResults(`SELECT status, implied_class, COUNT(*) AS n,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) AS pct
FROM register_history WHERE dataset = '${dataset}'
GROUP BY status, implied_class ORDER BY n DESC, status, implied_class`);
  });

  it('History_LookupRegisterHistoryCard_SampledCallsignsIdentical', () => {
    // The lookup's register-history card query, over callsigns that exist in
    // several publications plus one that left the register.
    const sample = all(legacyHistory,
      'SELECT callsign FROM register_history GROUP BY callsign HAVING COUNT(DISTINCT dataset) > 3 ORDER BY callsign LIMIT 5')
      .map(r => String(r.callsign));
    expect(sample.length).toBeGreaterThan(0);
    for (const callsign of sample) {
      expectSameResults(
        `SELECT dataset, callsign, status, product FROM register_history
         WHERE callsign IN (?) ORDER BY dataset, callsign`.replace('IN (?)', `IN ('${callsign.replace(/'/g, "''")}')`));
    }
  });

  it('History_LookupFoiHistoryCard_SampledCallsignsIdentical', () => {
    const sample = all(legacyHistory,
      "SELECT callsign FROM observations WHERE callsign != '' GROUP BY callsign HAVING COUNT(*) > 2 ORDER BY callsign LIMIT 5")
      .map(r => String(r.callsign));
    expect(sample.length).toBeGreaterThan(0);
    for (const callsign of sample) {
      const sql = `SELECT callsign, entry, dataset_classes, vintage, status, licence_class, event, event_date
       FROM observations WHERE callsign IN (?)
       ORDER BY vintage IS NULL, vintage, entry`;
      expect(all(projectionHistory, sql, [callsign]), callsign).toEqual(all(legacyHistory, sql, [callsign]));
    }
  });

  it('History_Observations_NullVersusAssertedBlankPreserved', () => {
    // The NULL-vs-blank semantics the combined form exists to carry: counts of
    // asserted-blank ('') vs not-asserted (NULL) statuses must agree per entry.
    const sql = `SELECT entry,
        SUM(CASE WHEN status IS NULL THEN 1 ELSE 0 END) AS not_asserted,
        SUM(CASE WHEN status = '' THEN 1 ELSE 0 END) AS asserted_blank
      FROM observations GROUP BY entry ORDER BY entry`;
    expect(all(projectionHistory, sql)).toEqual(all(legacyHistory, sql));
  });
});
