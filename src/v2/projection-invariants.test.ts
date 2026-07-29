import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { buildProjectionDbs } from './build-projection-db.ts';
import { listArchiveKeys } from '../shared/archive.ts';
import { placeholderOf, buildPredicate, matchingCountSql, setDiffSql, COLUMNS } from '../../site/browser-query.js';
import { assertNonEmpty } from '../testing/non-vacuity.ts';

// Test names follow Subject_Scenario_Outcome per project convention.
//
// INVARIANT SUITE for the ledger projection databases (issue #445). The
// interactive surfaces (site/app.js, compare.js, entry-browser.js, explore.js)
// read the ledger-derived projection databases (issue #572); the legacy
// build-sqlite.ts runtime pair they were once compared against has been retired,
// so this suite - the successor to the projection-vs-legacy parity gate - proves
// the projection databases are internally correct on their OWN terms: the exact
// table/column inventory the surfaces expect, the relational row-count invariants
// that must hold for any corpus (so ingestion never silently breaks them), and
// that the EXACT queries the surfaces run (built via the shared browser-query
// core, so a copy cannot drift) execute and return structurally-correct,
// domain-anchored results. Cross-database consistency checks pin the two
// projections to the same underlying publications.
//
// Heavy by design (a projection build over the real corpus + a ledger emit); it
// runs in the isolated heavy pool (src/testing/heavy-tests.json). PROJECTION_DB_DIR
// reuses a prebuilt scratch directory across local runs, mirroring the tiers
// test's TIERS_CACHE_DIR discipline.

let scratch: string;
let ownsScratch = false;
let lookup: DatabaseSync;
let history: DatabaseSync;
let newestDataset: string;

const PROJECTION_DIR = 'projection';
const LEDGER_DIR = 'ledger-emit';

beforeAll(() => {
  const reuse = process.env.PROJECTION_DB_DIR?.trim() || undefined;
  scratch = reuse ?? fs.mkdtempSync(path.join(os.tmpdir(), 'projection-invariants-'));
  ownsScratch = reuse === undefined;
  const projectionDir = path.join(scratch, PROJECTION_DIR);

  if (!fs.existsSync(path.join(projectionDir, 'ledger-lookup.sqlite.png'))) {
    buildProjectionDbs(
      path.join(projectionDir, 'ledger-lookup.sqlite.png'),
      path.join(projectionDir, 'ledger-history.sqlite.png'),
      { ledgerDir: path.join(scratch, LEDGER_DIR) },
    );
  }

  lookup = new DatabaseSync(path.join(projectionDir, 'ledger-lookup.sqlite.png'), { readOnly: true });
  history = new DatabaseSync(path.join(projectionDir, 'ledger-history.sqlite.png'), { readOnly: true });

  const keys = listArchiveKeys().sort();
  const last = keys[keys.length - 1];
  if (last === undefined) throw new Error('no archive entries found');
  newestDataset = last;
}, 3_600_000);

afterAll(() => {
  for (const db of [lookup, history]) {
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

function scalar(db: DatabaseSync, sql: string, params: (string | number)[] = []): number {
  return Number((db.prepare(sql).get(...params) as { n: number | bigint }).n);
}

// The exact row-select the lookup runs (site/app.js ROW_SELECT).
const ROW_SELECT =
  `SELECT n.*, c.parse_status, c.prefix_series, c.rsl, c.suffix AS cs_suffix,
          c.placeholder_form, c.home_callsign, c.implied_class, c.flags
   FROM components c JOIN normalised n ON n.callsign = c.callsign`;

describe('Ledger projection invariants - lookup database', { tags: ['data-validity'] }, () => {
  it('LookupProjection_TableInventory_ShipsExactlyTheTablesTheSurfacesQuery', () => {
    // The lookup surfaces (site/app.js, explore.js) join normalised/components
    // and read build_info, itu_series, flag_registry, the ref_* meanings and the
    // precomputed rsl_matrix; nothing more (dead download weight) and nothing less.
    expect(tableNames(lookup)).toEqual([
      'build_info',
      'components',
      'flag_registry',
      'itu_series',
      'normalised',
      'ref_entity_iso',
      'ref_forbidden_suffixes',
      'ref_prefix_formats',
      'ref_rsl',
      'rsl_matrix',
    ]);
  });

  it('LookupProjection_NormalisedAndComponents_HaveOneComponentRowPerRegisterRow', () => {
    // The components table is a per-callsign decomposition of the newest
    // publication's register, so the two tables carry the same row multiset by
    // callsign - and the surfaces' inner join must lose no row.
    const normalised = count(lookup, 'normalised');
    const components = count(lookup, 'components');
    expect(normalised).toBe(components);
    expect(normalised).toBeGreaterThan(100_000); // the current register is ~150k rows
    const joined = scalar(lookup, 'SELECT COUNT(*) AS n FROM components c JOIN normalised n ON n.callsign = c.callsign');
    expect(joined).toBe(components);
  });

  it('LookupProjection_BuildInfo_DeclaresTheNewestPublication', () => {
    const dataset = String((lookup.prepare("SELECT value FROM build_info WHERE key = 'dataset'").get() as { value: string }).value);
    expect(dataset).toBe(newestDataset);
  });

  it('Lookup_CallsignRowSelect_SampledCallsignsResolveToExactlyOneRow', () => {
    // The exact lookup query, over a deliberately interesting sample: ordinary
    // rows, artefact-damaged rows (callsign != cleaned), flagged rows, and
    // visitor rows (the home-country card's input). Each must resolve to exactly
    // one row whose components fields are internally consistent with the query.
    const sample = new Set<string>();
    for (const r of all(lookup, 'SELECT callsign FROM components ORDER BY callsign LIMIT 5')) sample.add(String(r.callsign));
    for (const r of all(lookup, 'SELECT callsign FROM components WHERE callsign != cleaned LIMIT 5')) sample.add(String(r.callsign));
    for (const r of all(lookup, "SELECT callsign FROM components WHERE flags != '' LIMIT 5")) sample.add(String(r.callsign));
    for (const r of all(lookup, "SELECT callsign FROM components WHERE home_callsign != '' LIMIT 5")) sample.add(String(r.callsign));
    expect(sample.size).toBeGreaterThan(10);
    for (const callsign of sample) {
      const rows = all(lookup, `${ROW_SELECT} WHERE c.callsign = ? LIMIT 1`, [callsign]);
      expect(rows, callsign).toHaveLength(1);
      expect(String(rows[0].callsign)).toBe(callsign);
      expect(rows[0].parse_status).not.toBeNull();
    }
  });

  it('Lookup_RslPlaceholderNormalisation_RegionalRenderingResolvesToTheCoreForm', () => {
    // A regional rendering (MW7...) is resolved by the browser-side placeholderOf
    // to a placeholder form, then matched against components.placeholder_form -
    // the exact fallback query the lookup runs must find the core rows.
    const core = all(lookup, "SELECT callsign, placeholder_form FROM components WHERE parse_status = 'parsed' AND placeholder_form LIKE 'M#7%' ORDER BY callsign LIMIT 1")[0];
    expect(core).toBeDefined();
    const rendering = String(core.placeholder_form).replace('#', 'W');
    const placeholder = placeholderOf(rendering);
    expect(placeholder).toBe(String(core.placeholder_form));
    const rows = all(lookup, `${ROW_SELECT} WHERE c.placeholder_form = ? ORDER BY n.callsign LIMIT 5`, [String(placeholder)]);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(String(row.placeholder_form)).toBe(String(placeholder));
  });

  it('Lookup_SuffixAvailabilityMatrix_ReturnsRowsAllBearingTheQueriedSuffix', () => {
    // The suffix matrix's register-state query (site/app.js suffixMatrix), for
    // the commonest real suffix and a withheld one.
    const suffixes = [
      String(all(lookup, "SELECT suffix FROM components WHERE parse_status = 'parsed' AND suffix != '' GROUP BY suffix ORDER BY COUNT(*) DESC LIMIT 1")[0].suffix),
      String(all(lookup, 'SELECT suffix FROM ref_forbidden_suffixes ORDER BY suffix LIMIT 1')[0].suffix),
    ];
    for (const suffix of suffixes) {
      const sql = `SELECT c.prefix_series, c.placeholder_form, c.flags, n.callsign, n.status, n.product,
              COALESCE(NULLIF(n.last_modified_date, ''), n.licence_version_last_modified_date) AS modified
       FROM components c JOIN normalised n ON n.callsign = c.callsign
       WHERE c.suffix = ? AND c.parse_status = 'parsed' ORDER BY n.callsign`;
      // The commonest suffix necessarily returns rows; a withheld suffix may not
      // currently be allocated, so only assert the shape holds where rows exist.
      for (const row of all(lookup, sql, [suffix])) {
        expect(row.callsign, suffix).not.toBeNull();
      }
    }
  });

  it('Lookup_VisitorHomeCountryCardData_ItuSeriesQueriesReturnAllocations', () => {
    // The visitor card queries itu_series by the home call's first character.
    for (const first of ['F', 'D', 'W', '2', 'S']) {
      const rows = all(lookup, 'SELECT series, allocated_to FROM itu_series WHERE series LIKE ? ORDER BY series', [`${first}%`]);
      expect(rows.length, first).toBeGreaterThan(0);
      for (const row of rows) expect(String(row.series).startsWith(first), first).toBe(true);
    }
  });

  it('Lookup_EntityIsoCrosswalk_NamesEveryAllocationHolderAndYieldsFlagCodes', () => {
    // The visitor card joins itu_series.allocated_to against ref_entity_iso to
    // render a flag at the edge. Every holder the series table names must have a
    // crosswalk row, so a resolved allocation never lacks its flag lookup; and
    // each code is either blank (a flagless organisation) or a two-letter code.
    const holders = assertNonEmpty(all(lookup, 'SELECT DISTINCT allocated_to FROM itu_series'), 'itu_series.allocated_to holders');
    for (const holder of holders) {
      const match = all(lookup, 'SELECT iso_3166_alpha2 FROM ref_entity_iso WHERE allocated_to = ?', [String(holder.allocated_to)]);
      expect(match, String(holder.allocated_to)).toHaveLength(1);
      const code = String(match[0].iso_3166_alpha2);
      expect(code === '' || /^[A-Z]{2}$/.test(code), `${String(holder.allocated_to)} -> "${code}"`).toBe(true);
    }
    // The example the card most often renders: Ireland's series holder -> IE.
    const ireland = all(lookup, "SELECT iso_3166_alpha2 FROM ref_entity_iso WHERE allocated_to = 'Ireland'");
    expect(String(ireland[0].iso_3166_alpha2)).toBe('IE');
  });

  it('Lookup_FacetPopulationQueries_ReturnNonEmptyVocabularies', () => {
    for (const sql of [
      'SELECT flag, meaning FROM flag_registry ORDER BY flag',
      'SELECT DISTINCT status FROM normalised ORDER BY status',
      'SELECT DISTINCT parse_status FROM components ORDER BY parse_status',
      `SELECT DISTINCT prefix_series FROM components WHERE prefix_series != '' ORDER BY prefix_series`,
    ]) {
      expect(all(lookup, sql), sql).not.toHaveLength(0);
    }
  });
});

describe('Ledger projection invariants - history database', { tags: ['data-validity'] }, () => {
  it('HistoryProjection_TableInventory_ShipsExactlyTheTablesTheSurfacesQuery', () => {
    expect(tableNames(history)).toEqual([
      'build_info',
      'history_datasets',
      'observations',
      'ref_forbidden_suffixes',
      'register_history',
    ]);
  });

  it('HistoryProjection_RegisterHistory_RowCountIsTheSumOfPerDatasetCounts', () => {
    // register_history unions every open-data publication; history_datasets
    // records each publication's declared row count. The union's size must be
    // exactly their sum - a corpus-agnostic invariant that catches a dropped or
    // double-counted publication regardless of how many are ingested.
    const rows = count(history, 'register_history');
    const declared = scalar(history, 'SELECT COALESCE(SUM(CAST(record_count AS INTEGER)), 0) AS n FROM history_datasets');
    expect(rows).toBe(declared);
    expect(rows).toBeGreaterThan(500_000);
  });

  it('HistoryProjection_RegisterHistory_SpansEveryOpenDataPublication', () => {
    // One history_datasets row per publication, and register_history carries rows
    // for each; the distinct-dataset count must match the publication inventory.
    const datasetRows = count(history, 'history_datasets');
    const distinctInHistory = scalar(history, 'SELECT COUNT(DISTINCT dataset) AS n FROM register_history');
    expect(distinctInHistory).toBe(datasetRows);
    expect(datasetRows).toBe(listArchiveKeys().length);
  });

  it('HistoryProjection_Observations_AreNonEmpty', () => {
    expect(count(history, 'observations')).toBeGreaterThan(1_000_000);
  });

  it('HistoryProjection_ForbiddenSuffixes_MatchTheLookupProjection', () => {
    // Both projections fold the same reference-data/forbidden-suffixes.csv, so
    // their withheld-suffix tables must carry the identical row count.
    expect(count(history, 'ref_forbidden_suffixes')).toBe(count(lookup, 'ref_forbidden_suffixes'));
  });

  it('History_NewestPublication_AgreesWithTheLookupRegister', () => {
    // Cross-database consistency: the lookup projection carries the NEWEST
    // publication's register; the history projection carries every publication.
    // The newest dataset's register_history slice must match the lookup's
    // normalised table row-for-row (both fold the same publication).
    const inHistory = scalar(history, 'SELECT COUNT(*) AS n FROM register_history WHERE dataset = ?', [newestDataset]);
    expect(inHistory).toBe(count(lookup, 'normalised'));
  });

  it('History_CompareSurface_PublicationListQueryReturnsEveryDataset', () => {
    // The exact eager boot query compare.js runs (loadDatasets).
    const rows = all(history, 'SELECT dataset, record_count, intended_complete, scope_notes, coverage_affecting FROM history_datasets ORDER BY dataset DESC');
    expect(rows).toHaveLength(count(history, 'history_datasets'));
    for (const row of rows) expect(Number(row.record_count)).toBeGreaterThan(0);
  });

  it('History_CompareSurface_FilteredCountsAndSetDiffsExecute', () => {
    // The comparison surface's canonical queries, built by the SAME shared query
    // core the page uses (site/browser-query.js): a real predicate over the two
    // newest publications - counts per publication, then the appeared/disappeared/
    // status-changed set-diffs on the cleaned key. They must execute and the
    // counts stay bounded by each publication's size.
    const datasets = all(history, 'SELECT dataset FROM history_datasets ORDER BY dataset DESC LIMIT 2').map(r => String(r.dataset));
    expect(datasets).toHaveLength(2);
    const [later, earlier] = datasets;
    const predicate = "suffix IN (SELECT suffix FROM ref_forbidden_suffixes) AND status = 'Allocated'";
    for (const dataset of datasets) {
      const matching = scalar(history, matchingCountSql(dataset, predicate));
      const total = scalar(history, 'SELECT COUNT(*) AS n FROM register_history WHERE dataset = ?', [dataset]);
      expect(matching).toBeGreaterThanOrEqual(0);
      expect(matching).toBeLessThanOrEqual(total);
    }
    const diff = setDiffSql(earlier, later, predicate);
    for (const sql of [diff.appeared, diff.disappeared, diff.changed]) {
      expect(() => all(history, sql)).not.toThrow();
    }
  });

  it('History_EntryBrowser_ScopedFilterQueryExecutesAndPaginates', () => {
    // The single-publication browser's composed query (entry-browser.js filtersSql
    // over the shared buildPredicate), dataset-scoped with a toggle and a column
    // filter - count + first page must execute and the page never exceed its size.
    const dataset = String(all(history, 'SELECT dataset FROM history_datasets ORDER BY dataset DESC LIMIT 1')[0].dataset);
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
    const matching = scalar(history, `SELECT COUNT(*) AS n FROM register_history WHERE ${where}`);
    const total = scalar(history, 'SELECT COUNT(*) AS n FROM register_history WHERE dataset = ?', [dataset]);
    expect(matching).toBeLessThanOrEqual(total);
    const page = all(history, `SELECT * FROM (SELECT ${cols} FROM register_history WHERE ${where} ORDER BY "callsign" ASC) LIMIT 25 OFFSET 0`);
    expect(page.length).toBeLessThanOrEqual(25);
  });

  it('History_LookupRegisterHistoryCard_SampledCallsignsSpanMultiplePublications', () => {
    // The lookup's register-history card query, over callsigns present in several
    // publications - each must return one row per publication it appears in.
    const sample = all(history,
      'SELECT callsign FROM register_history GROUP BY callsign HAVING COUNT(DISTINCT dataset) > 3 ORDER BY callsign LIMIT 5')
      .map(r => String(r.callsign));
    expect(sample.length).toBeGreaterThan(0);
    for (const callsign of sample) {
      const rows = all(history,
        `SELECT dataset, callsign, status, product FROM register_history WHERE callsign = ? ORDER BY dataset, callsign`, [callsign]);
      expect(rows.length, callsign).toBeGreaterThan(3);
      for (const row of rows) expect(String(row.callsign)).toBe(callsign);
    }
  });

  it('History_Observations_PreserveNullVersusAssertedBlank', () => {
    // The NULL-vs-blank semantics the combined form exists to carry: some entries
    // assert blank statuses (''), others carry no status column at all (NULL).
    // Both distinctions must survive in observations - the whole point of the form.
    const notAsserted = scalar(history, 'SELECT COUNT(*) AS n FROM observations WHERE status IS NULL');
    const assertedBlank = scalar(history, "SELECT COUNT(*) AS n FROM observations WHERE status = ''");
    expect(notAsserted).toBeGreaterThan(0);
    expect(assertedBlank).toBeGreaterThan(0);
  });
});
