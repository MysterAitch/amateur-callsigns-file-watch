// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { prepareSql, runQuery, EXAMPLES, ROW_CAP } from './playground.js';
import { cleanCallsign } from './ledger-query.js';
import { buildCompactLedgerSqlite } from '../src/v2/build-ledger-db-compact.ts';
import { serialiseClaimsJsonl } from '../src/v2/serialise.ts';
import {
  LISTED_PREDICATE, NORMALISES_TO_PREDICATE, CLEANED_CALLSIGN_RULE, PLACEHOLDER_FORM_RULE,
  type Claim,
} from '../src/v2/claim.ts';
import { placeholderOf } from './browser-query.js';

// The Playground page (issue #361, Stage 3b) is the read-only SQL console over
// the SAME claim-ledger SQLite the Ledger page serves. These tests cover the
// three things the stage must prove: the read-only guard actually refuses a
// non-query; a worked example runs end-to-end against a REAL, freshly-built
// claim-ledger SQLite (built by the COMPACT builder the deploy ships) and
// renders rows into the page's result table; and the page is nav/precache/
// deploy-wired so it is reachable and offline-cached.

const SITE_DIR = 'site';
const PAGES_WORKFLOW = path.join('.github', 'workflows', 'pages.yml');

function siteFile(name: string): string {
  return fs.readFileSync(path.join(SITE_DIR, name), 'utf8');
}

// One register observation as its claims - the existence anchor, its attribute
// claims (under Ofcom's own column names), and the derived normalises_to edges -
// exactly the shape build-ledger.ts emits and the compact builder loads.
function observationClaims(
  sourceFile: string, ordinal: number, vintage: string, rawToken: string,
  attrs: Record<string, string>,
): Claim[] {
  const provenance = { sourceFile, ordinal, vintage };
  const cleaned = cleanCallsign(rawToken);
  const claims: Claim[] = [
    { layer: 'raw', rawSubject: rawToken, predicate: LISTED_PREDICATE, object: '', provenance },
  ];
  for (const [predicate, object] of Object.entries(attrs)) {
    claims.push({ layer: 'raw', rawSubject: rawToken, predicate, object, provenance });
  }
  claims.push({ layer: 'derived', rawSubject: rawToken, predicate: NORMALISES_TO_PREDICATE, object: cleaned, rule: CLEANED_CALLSIGN_RULE, provenance });
  const placeholder = placeholderOf(cleaned);
  if (placeholder !== null) {
    claims.push({ layer: 'derived', rawSubject: cleaned, predicate: NORMALISES_TO_PREDICATE, object: placeholder, rule: PLACEHOLDER_FORM_RULE, provenance });
  }
  return claims;
}

const SRC_2016 = 'foi/ofcom-2016--callsign-database/raw-extract.csv';
const SRC_2022 = 'foi/ofcom-2022--allocated-reserved/raw-extract.csv';
const SRC_2024 = 'foi/ofcom-2024--data-download/raw-extract.csv';
const V_2016 = '2016-09';
const V_2022 = '2022-03-07';
const V_2024 = '2024-04-30';

let dbPath: string;
let tmpDir: string;
let db: InstanceType<typeof DatabaseSync>;
// A synchronous node:sqlite executor with the same (sql) -> rows shape the
// browser httpvfs worker exposes, so the DOM console runs unchanged against a
// real database in Node.
const query = (sql: string): Record<string, unknown>[] =>
  db.prepare(sql).all() as Record<string, unknown>[];

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'playground-test-'));
  const ledgerDir = path.join(tmpDir, 'ledger');
  fs.mkdirSync(ledgerDir, { recursive: true });
  const bySource = new Map<string, Claim[]>([
    [SRC_2016, observationClaims(SRC_2016, 1, V_2016, 'G0TQK', { 'Final Status': 'Reserved' })],
    [SRC_2022, [
      ...observationClaims(SRC_2022, 10, V_2022, 'G0TQK', { Status: 'Reserved', Type: 'Call Sign - Amateur' }),
      ...observationClaims(SRC_2022, 20, V_2022, 'G0TQK ', { Status: 'Allocated', Type: 'Call Sign - Amateur' }),
      ...observationClaims(SRC_2022, 30, V_2022, 'M7TEE', { Status: 'Allocated', Type: 'Call Sign - Amateur' }),
    ]],
    [SRC_2024, observationClaims(SRC_2024, 40, V_2024, 'G0TQK', { 'Status__c': 'Allocated', 'Type__c': 'Call Sign - Amateur' })],
  ]);
  let n = 0;
  for (const [, claims] of bySource) {
    fs.writeFileSync(path.join(ledgerDir, `source-${n}.jsonl`), serialiseClaimsJsonl(claims));
    n += 1;
  }
  dbPath = path.join(tmpDir, 'claim-ledger.sqlite.png');
  buildCompactLedgerSqlite(ledgerDir, dbPath);
  db = new DatabaseSync(dbPath);
});

afterAll(() => {
  db?.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('Playground read-only guard', () => {
  it('Guard_WhenSelectQuery_IsAcceptedAndBoundedByRowCap', () => {
    const prepared = prepareSql('SELECT 1');
    expect(prepared).toContain('SELECT 1');
    expect(prepared).toContain(`LIMIT ${ROW_CAP + 1}`);
  });

  it('Guard_WhenWithQuery_IsAccepted', () => {
    expect(() => prepareSql('WITH x AS (SELECT 1 AS n) SELECT n FROM x')).not.toThrow();
  });

  it('Guard_WhenQueryOpensWithAComment_LooksPastItToTheSelect', () => {
    // Every worked example opens with an explanatory comment; the guard must not
    // mistake that for a non-query.
    expect(() => prepareSql('-- a note\nSELECT 1')).not.toThrow();
    expect(() => prepareSql('/* a block note */ WITH x AS (SELECT 1 AS n) SELECT n FROM x')).not.toThrow();
  });

  it('Guard_WhenNonSelectStatement_IsRejected', () => {
    for (const hostile of ['DROP TABLE observation', 'DELETE FROM attr', 'UPDATE observation SET entity = 1', 'INSERT INTO source VALUES (9, 9, 9)', 'PRAGMA table_info(observation)']) {
      expect(() => prepareSql(hostile), hostile).toThrow(/must start with SELECT or WITH/);
    }
  });

  it('Guard_WhenEmpty_IsRejectedWithAnHonestMessage', () => {
    expect(() => prepareSql('   ')).toThrow(/enter a query/);
  });

  it('Examples_AllStartFromASelectOrWith', () => {
    // Every one-click starter must pass the very guard the console applies, or a
    // starter would greet the user with a rejection.
    for (const example of EXAMPLES) {
      expect(() => prepareSql(example.sql), example.title).not.toThrow();
    }
  });
});

describe('Playground console (live, against a built SQLite)', () => {
  function hostFromPage(): { statusEl: HTMLElement; resultEl: HTMLElement } {
    const html = siteFile('playground.html');
    const main = html.slice(html.indexOf('<main'), html.indexOf('</main>') + '</main>'.length);
    document.body.innerHTML = main;
    const statusEl = document.getElementById('sql-status');
    const resultEl = document.getElementById('sql-result');
    if (statusEl === null || resultEl === null) throw new Error('console host elements missing from playground.html');
    return { statusEl, resultEl };
  }

  // Look a worked example up by its title prefix, failing loudly if it has been
  // renamed - so a test never silently runs against `undefined.sql`.
  function example(prefix: string): { title: string; note: string; sql: string } {
    const found = EXAMPLES.find(e => e.title.startsWith(prefix));
    if (found === undefined) throw new Error(`no worked example titled like "${prefix}"`);
    return found;
  }

  it('Console_WhenPerEntityDossierExampleRun_RendersRowsIntoTheResultTable', async () => {
    const { statusEl, resultEl } = hostFromPage();
    const rows = await runQuery(query, example('Per-entity dossier').sql, { statusEl, resultEl });
    // The fixture folds G0TQK (+ its trailing-space twin) into entity G#0TQK, so
    // the dossier returns its claims across all three vintages.
    expect(rows.length).toBeGreaterThan(0);
    const table = resultEl.querySelector('table.pg-table');
    if (table === null) throw new Error('result table not rendered');
    expect(table.querySelectorAll('tbody tr').length).toBe(rows.length);
    // The header names the flat contract's columns, and a real value is rendered.
    expect(resultEl.textContent).toContain('predicate');
    expect(resultEl.textContent).toContain(V_2016);
    expect(statusEl.textContent).toMatch(/row/);
  });

  it('Console_WhenCorpusAggregateExampleRun_FoldsOverTheBaseTables', async () => {
    const { statusEl, resultEl } = hostFromPage();
    const rows = await runQuery(query, example('Corpus aggregate').sql, { statusEl, resultEl });
    // One row per snapshot vintage, so the base-table join and GROUP BY run.
    expect(rows.map(r => r.vintage).sort()).toEqual([V_2016, V_2022, V_2024]);
  });

  it('Console_WhenStatusFoldWindowExampleRun_EvaluatesTheWindowFunction', async () => {
    const { statusEl, resultEl } = hostFromPage();
    const rows = await runQuery(query, example('Status fold').sql, { statusEl, resultEl });
    // The LAG() window and IS NOT transition flag evaluate to a real result set.
    expect(rows.length).toBeGreaterThan(0);
    expect(Object.keys(rows[0])).toContain('transition');
  });

  it('Console_WhenNonSelectSubmitted_RefusesAndRendersNothing', async () => {
    const { statusEl, resultEl } = hostFromPage();
    const rows = await runQuery(query, 'DROP TABLE observation', { statusEl, resultEl });
    expect(rows.length).toBe(0);
    expect(statusEl.textContent).toMatch(/must start with SELECT or WITH/);
    expect(resultEl.querySelector('table')).toBeNull();
  });
});

describe('Playground page deploy integrity', () => {
  it('PlaygroundPage_Assets_AllExistInSite', () => {
    const present = new Set(fs.readdirSync(SITE_DIR));
    for (const asset of ['playground.html', 'playground.js']) {
      expect(present.has(asset), `${asset} is missing from site/`).toBe(true);
    }
  });

  it('PlaygroundPage_LinksItsScriptStylesheetsAndHttpvfsLoader', () => {
    const html = siteFile('playground.html');
    expect(html).toContain('href="style.css"');
    expect(html).toContain('href="ledger.css"');
    expect(html).toMatch(/<script[^>]*\bsrc="playground\.js"/);
    // The httpvfs UMD loader must be present (it attaches createDbWorker), or the
    // console can never open the database.
    expect(html).toMatch(/<script[^>]*\bsrc="vendor\/index\.js"/);
  });

  it('PlaygroundPage_IsPrecachedForTheOfflineShell', () => {
    const src = siteFile('sw.js');
    const block = src.match(/const SHELL_ASSETS = \[([\s\S]*?)\];/);
    if (block === null) throw new Error('SHELL_ASSETS array not found in sw.js');
    const listed = new Set([...block[1].matchAll(/'([^']+)'/g)].map(m => m[1]));
    for (const asset of ['playground.html', 'playground.js']) {
      expect(listed.has(asset), `sw.js SHELL_ASSETS omits ${asset} (offline shell incomplete)`).toBe(true);
    }
  });

  it('PlaygroundPage_ShipsToTheDeployWithCanonicalNav', () => {
    const wf = fs.readFileSync(PAGES_WORKFLOW, 'utf8');
    // The asset globs already carry every site .html/.js; the nav injector must
    // be handed the page too, or its deployed copy keeps a stale hand-written nav.
    expect(wf).toMatch(/build-nav\.ts[^\n]*\b_site\/playground\.html\b/);
  });

  it('PlaygroundPage_CarriesNavMarkersAndHonestScopeFraming', () => {
    const html = siteFile('playground.html');
    expect(html).toContain('<!-- nav:start (canonical strip stamped in at deploy by src/ci/build-nav.ts) -->');
    expect(html).toContain('<!-- nav:end -->');
    expect(html).toContain('<strong>Playground</strong>');
    // Honest framing: read-only, tied to issue #361, register snapshots only, and
    // the DuckDB lane is named as planned-not-built.
    expect(html).toContain('issues/361');
    expect(html).toContain('Read-only');
    expect(html).toContain('Register snapshots only');
    expect(html).toContain('DuckDB-WASM');
    expect(html).toContain('planned');
  });

  it('PlaygroundPage_IsInTheSingleSourceNav', () => {
    const nav = fs.readFileSync(path.join('src', 'ci', 'site-render.ts'), 'utf8');
    expect(nav).toMatch(/\['Playground', `\$\{rootPath\}playground\.html`\]/);
    const buildNav = fs.readFileSync(path.join('src', 'ci', 'build-nav.ts'), 'utf8');
    expect(buildNav).toContain("'playground.html': 'Playground'");
  });
});
