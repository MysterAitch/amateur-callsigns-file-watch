// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DatabaseSync } from 'node:sqlite';
import {
  cleanCallsign, resolveEntity, entityClaims, observationsOf,
  foldObservations, anatomyOf, flagsOf, bytesHex, groupByYear,
  coTemporalDivergenceNote, segmentsText,
} from './ledger-query.js';
import { runLookup } from './ledger.js';
import { buildCompactLedgerSqlite } from '../src/v2/build-ledger-db-compact.ts';
import { serialiseClaimsJsonl } from '../src/v2/serialise.ts';
import {
  LISTED_PREDICATE, NORMALISES_TO_PREDICATE, CLEANED_CALLSIGN_RULE, PLACEHOLDER_FORM_RULE,
  type Claim,
} from '../src/v2/claim.ts';
import { placeholderOf } from './browser-query.js';

// The Ledger page (issue #361, Stage 3a) serves LIVE data end-to-end: raw bytes
// -> claim ledger -> claim-ledger SQLite -> in-browser query -> page. These
// tests exercise the whole chain against a REAL, freshly-built claim-ledger
// SQLite - built by the COMPACT builder the deploy ships (its `claims` VIEW, not
// a fat table), from a tiny hand-authored ledger that carries the documented
// G0TQK trailing-space twin AND snapshots that name the status column under
// three different schemas - then the deploy/SW/nav guards that keep the page
// reachable and offline-cached.

const SITE_DIR = 'site';
const PAGES_WORKFLOW = path.join('.github', 'workflows', 'cicd.yaml');

function siteFile(name: string): string {
  return fs.readFileSync(path.join(SITE_DIR, name), 'utf8');
}

// One register observation as its claims: the existence assertion, its
// attribute claims (under Ofcom's own column names), and the derived
// normalises_to edges (raw -> cleaned, cleaned -> placeholder), exactly the
// shape build-ledger.ts emits and build-ledger-db.ts loads.
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
// Three vintages whose real-world schemas name the status column differently:
// 2016-09 uses "Final Status", 2022 uses "Status", 2024-04-30 uses "Status__c".
const V_2016 = '2016-09';
const V_2022 = '2022-03-07';
const V_2024 = '2024-04-30';

let dbPath: string;
let tmpDir: string;
let db: InstanceType<typeof DatabaseSync>;
// A synchronous node:sqlite executor with the same (sql, params) -> rows shape
// the browser httpvfs worker exposes, so the DOM-free query layer runs
// unchanged against a real database in Node.
const query = (sql: string, params: unknown[] = []): Record<string, unknown>[] =>
  db.prepare(sql).all(...(params as (string | number)[]));

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-page-test-'));
  const ledgerDir = path.join(tmpDir, 'ledger');
  fs.mkdirSync(ledgerDir, { recursive: true });
  // One JSONL file per source, so the compact builder's per-source obs_id and
  // dictionary passes run exactly as they do over the real corpus.
  const bySource = new Map<string, Claim[]>([
    // 2016-09 names the status column "Final Status".
    [SRC_2016, observationClaims(SRC_2016, 1, V_2016, 'G0TQK', { 'Final Status': 'Reserved' })],
    // 2022: the clean token is Reserved while a trailing-SPACE twin is Allocated
    // - two raw tokens, one entity, co-temporal. Plus M7TEE (resolves by the
    // cleaned index; its placeholder key M#7TEE also resolves a regional MW7TEE).
    [SRC_2022, [
      ...observationClaims(SRC_2022, 10, V_2022, 'G0TQK', { Status: 'Reserved', Type: 'Call Sign - Amateur' }),
      ...observationClaims(SRC_2022, 20, V_2022, 'G0TQK ', { Status: 'Allocated', Type: 'Call Sign - Amateur' }),
      ...observationClaims(SRC_2022, 30, V_2022, 'M7TEE', { Status: 'Allocated', Type: 'Call Sign - Amateur' }),
    ]],
    // 2024-04-30 names the status column "Status__c".
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

describe('claim-ledger query layer (live, against a built SQLite)', { tags: ['ui'] }, () => {
  it('Lookup_WhenTypedLiteralCallsign_ResolvesToEntityViaCleanedIndex', async () => {
    const resolved = await resolveEntity(query, 'G0TQK');
    expect(resolved.entity).toBe('G#0TQK');
    expect(resolved.cleaned).toBe('G0TQK');
    expect(resolved.matched).toBe('cleaned');
  });

  it('Lookup_WhenRegionalRendering_ResolvesToSameEntityViaPlaceholderKey', async () => {
    // MW7TEE is not itself a stored cleaned callsign (the register keeps the
    // RSL-less core), so it must resolve through the placeholder/entity index.
    const resolved = await resolveEntity(query, 'MW7TEE');
    expect(resolved.entity).toBe('M#7TEE');
    expect(resolved.matched).toBe('placeholder');
  });

  it('Lookup_WhenCallsignAbsentFromCorpus_ReturnsHonestMiss', async () => {
    const resolved = await resolveEntity(query, 'ZZ9ZZZ');
    expect(resolved.entity).toBeNull();
    expect(resolved.matched).toBe('none');
  });

  it('EntityClaims_WhenNbspTwinExists_KeepsBothRawTokensUnderOneEntity', async () => {
    const claims = await entityClaims(query, 'G#0TQK');
    const rawTokens = new Set(claims.map((c: Record<string, unknown>) => c.raw_subject));
    expect(rawTokens.has('G0TQK')).toBe(true);
    expect(rawTokens.has('G0TQK ')).toBe(true); // the trailing-space twin, verbatim
    const vintages = [...new Set(claims.map((c: Record<string, unknown>) => c.vintage))].sort();
    expect(vintages).toEqual([V_2016, V_2022, V_2024]);
  });

  it('TemporalFold_WhenFoldedAcrossVintages_ReportsBirthsAndPerVariantStreams', async () => {
    const claims = await entityClaims(query, 'G#0TQK');
    const fold = foldObservations(observationsOf(claims), 'G0TQK');
    expect(fold.vints).toEqual([V_2016, V_2022, V_2024]);
    expect(fold.variants.size).toBe(2); // clean token + trailing-space twin
    // Both statuses observed at 2022 (Reserved clean, Allocated twin).
    const at2022 = fold.byV.get(V_2022) ?? [];
    const statuses = at2022.map((o: { status: string }) => o.status).sort();
    expect(statuses).toEqual(['Allocated', 'Reserved']);
  });

  it('StatusTimeline_WhenSnapshotsNameStatusColumnDifferently_ReadsItFromEachSchema', async () => {
    // The status column is "Final Status" in 2016-09, "Status" in 2022 and
    // "Status__c" in 2024-04-30. Reading whichever is present (a faithful, not
    // lossy, normalisation) is what keeps the timeline correct across schemas -
    // a naive "Status"-only read would blank the 2016 and 2024 vintages.
    const obs = observationsOf(await entityClaims(query, 'G#0TQK'));
    const statusesAt = (v: string): string[] =>
      [...new Set(obs.filter(o => o.vintage === v).map(o => o.status))].sort();
    expect(statusesAt(V_2016)).toEqual(['Reserved']); // via "Final Status"
    expect(statusesAt(V_2024)).toEqual(['Allocated']); // via "Status__c"
  });

  it('Anatomy_WhenTokenIsDamaged_ExposesTheDifferingBytesAndNormalisesToEdges', async () => {
    const claims = await entityClaims(query, 'G#0TQK');
    const anatomy = anatomyOf(claims);
    const twin = anatomy.find(a => a.raw === 'G0TQK ');
    expect(twin).toBeDefined();
    expect(twin?.damaged).toBe(true);
    // The trailing space is a real byte: 0x20 at the end of the hex signature.
    expect(twin?.bytes.endsWith('20')).toBe(true);
    expect(bytesHex('G0TQK ')).toBe(twin?.bytes);
    // It carries the cleaned-callsign edge back to the clean form.
    expect(twin?.edges.some(e => e.rule === CLEANED_CALLSIGN_RULE && e.object === 'G0TQK')).toBe(true);
  });

  it('Flags_WhenRawTokensDivergeFromCleaned_SurfaceDerivedNotableObservations', async () => {
    const claims = await entityClaims(query, 'G#0TQK');
    const flags = flagsOf(claims, 'G0TQK').map(f => f.flag);
    expect(flags).toContain('raw-differs-from-cleaned');
    expect(flags).toContain('multiple-raw-variants');
    expect(flags).toContain('co-temporal-status-divergence');
  });

  it('CoTemporalDivergence_WhenAbnormalTwinDisagrees_LeadsWithFormNormalityAndCarriesLinkableWorking', async () => {
    // Issue #633: the enriched note leads with the user-meaningful fact - the
    // non-standard 'G0TQK ' spelling is Allocated while the canonical form is
    // Reserved within the 2022 snapshot - and carries a working with the
    // per-form statuses and the source rows behind them (linkable evidence).
    const claims = await entityClaims(query, 'G#0TQK');
    const note = coTemporalDivergenceNote(claims, 'G0TQK');
    expect(note).not.toBeNull();
    if (note === null) return;
    expect(note.label).toBe('A non-standard spelling carries a different status');
    const prose = segmentsText(note.gloss);
    expect(prose).toContain('G0TQK '); // the abnormal spelling, verbatim
    expect(prose).toContain('canonical form');
    expect(prose).toMatch(/Allocated/);
    expect(prose).toMatch(/Reserved/);
    // The working reproduces the per-form statuses and cites where they were seen.
    const inputs = note.working.inputs;
    expect(inputs).toContainEqual({ role: 'Allocated', value: 'G0TQK ' });
    expect(inputs).toContainEqual({ role: 'Reserved', value: 'G0TQK' });
    expect(note.working.sources.length).toBeGreaterThan(0);
  });

  it('CoTemporalDivergence_WhenNoSnapshotDisagrees_ReturnsNull', async () => {
    // M7TEE is listed once, with one status - there is no divergence to enrich.
    const claims = await entityClaims(query, 'M#7TEE');
    expect(coTemporalDivergenceNote(claims, 'M7TEE')).toBeNull();
  });
});

describe('groupByYear — the shared timeline grouping (issue #466)', { tags: ['unit'] }, () => {
  it('GroupByYear_WhenEntriesSpanYears_BucketsThemByYearInChronologicalOrder', () => {
    const groups = groupByYear([
      { vintage: '2022-03-07', tag: 'b' },
      { vintage: '2016-09', tag: 'a' },
      { vintage: '2022-11-01', tag: 'c' },
    ]);
    // Periods ascending, the four-digit year as the label.
    expect(groups.map(g => g.period)).toEqual(['2016', '2022']);
    // Input order is preserved WITHIN a year (b before c) and every entry is kept.
    expect(groups[1]?.entries.map((e: { tag: string }) => e.tag)).toEqual(['b', 'c']);
    expect(groups[0]?.entries.map((e: { tag: string }) => e.tag)).toEqual(['a']);
  });

  it('GroupByYear_WhenGivenNoEntries_ReturnsNoGroups', () => {
    expect(groupByYear([])).toEqual([]);
  });
});

describe('Ledger page render (JSDOM smoke test, live query)', { tags: ['ui'] }, () => {
  it('LedgerPage_WhenRealCallsignLookedUp_PopulatesTimelineAnatomyAndDossier', async () => {
    // Seed the document with the page's real host structure, then drive the
    // exported lookup against the node:sqlite-backed executor - the same code
    // path the browser runs, minus the httpvfs transport.
    const html = siteFile('ledger.html');
    const main = html.slice(html.indexOf('<main'), html.indexOf('</main>') + '</main>'.length);
    document.body.innerHTML = main;

    const resolved = await runLookup(query, 'G0TQK');
    expect(resolved.entity).toBe('G#0TQK');

    const entity = document.getElementById('entity');
    expect(entity?.textContent).toContain('G#0TQK');
    expect(entity?.textContent).toContain(V_2016);
    expect(entity?.textContent).toContain(V_2022);

    const anatomy = document.getElementById('anatomy');
    expect(anatomy?.textContent).toContain('normalises_to');
    // Both raw tokens surface; the damaged twin is shown, not hidden.
    expect(anatomy?.querySelectorAll('.obs').length).toBe(2);

    const dossier = document.getElementById('dossier');
    expect(dossier?.textContent).toContain('G#0TQK');
    // The trailing-space twin diverges from the canonical form, so the
    // selectively-disclosed record-fidelity affordance surfaces it (as a
    // non-accusatory canonical-form note, not the internal flag id).
    expect(dossier?.textContent).toContain('record fidelity');
    expect(dossier?.textContent).toContain('canonical form');
    expect(dossier?.querySelector('details.fid-why')).not.toBeNull();

    // A miss clears the views and states the register-snapshot scope honestly
    // rather than hanging.
    const miss = await runLookup(query, 'ZZ9ZZZ');
    expect(miss.entity).toBeNull();
    expect(document.getElementById('miss')?.textContent).toContain('register-snapshot publications only');
    expect(document.getElementById('entity')?.textContent).toBe('');
  });
});

describe('Ledger entity timeline — vertical activity-feed layout (issue #466)', { tags: ['ui'] }, () => {
  it('EntityTimeline_WhenRendered_IsASemanticYearGroupedListWithDatedEvents', async () => {
    const html = siteFile('ledger.html');
    const main = html.slice(html.indexOf('<main'), html.indexOf('</main>') + '</main>'.length);
    document.body.innerHTML = main;
    await runLookup(query, 'G0TQK');

    const entity = document.getElementById('entity');
    // Semantic markup: an ordered list of year groups, each an ordered list of
    // events - so order and dates survive with no JavaScript / to assistive tech.
    const timeline = entity?.querySelector('ol.tl');
    expect(timeline).not.toBeNull();
    const events = [...(entity?.querySelectorAll('ol.tl-events > li.tl-event') ?? [])];
    expect(events.length).toBeGreaterThan(0);

    // Grouped by year: the three vintages (2016, 2022, 2024) yield three period
    // labels, each a four-digit year, in chronological order.
    const periods = [...(entity?.querySelectorAll('.tl-period time') ?? [])].map(t => t.textContent);
    expect(periods).toEqual(['2016', '2022', '2024']);

    // Every event places its date on the right in a <time datetime=…>, and its
    // content (the event chips) on the left in a .tl-lead.
    const first = events[0];
    expect(first?.querySelector('.tl-lead .ev')).not.toBeNull();
    const when = first?.querySelector('time.tl-date');
    expect(when?.getAttribute('datetime')).toBe(V_2016);
    expect(when?.textContent).toBe(V_2016);

    // The spine dot is decorative: hidden from assistive tech, meaning carried by
    // the text chip beside it (not by colour alone).
    const dot = first?.querySelector('.tl-dot');
    expect(dot?.getAttribute('aria-hidden')).toBe('true');

    // The 2022 vintage carries the co-temporal twin: two events in that year, one
    // flagged as the de-emphasised parallel stream.
    const twenty22 = [...(entity?.querySelectorAll('.tl-group') ?? [])]
      .find(g => g.querySelector('.tl-period time')?.textContent === '2022');
    expect(twenty22?.querySelectorAll('li.tl-event').length).toBe(2);
    expect(twenty22?.querySelector('li.tl-event.parallel')).not.toBeNull();
  });
});

describe('Ledger page deploy integrity', { tags: ['ui'] }, () => {
  it('LedgerPage_Assets_AllExistInSite', () => {
    const present = new Set(fs.readdirSync(SITE_DIR));
    for (const asset of ['ledger.html', 'ledger.js', 'ledger.css', 'ledger-query.js']) {
      expect(present.has(asset), `${asset} is missing from site/`).toBe(true);
    }
  });

  it('LedgerPage_LinksItsScriptStylesheetAndHttpvfsLoader', () => {
    const html = siteFile('ledger.html');
    expect(html).toContain('href="style.css"');
    expect(html).toContain('href="ledger.css"');
    expect(html).toMatch(/<script[^>]*\bsrc="ledger\.js"/);
    // The httpvfs UMD loader must be present (it attaches createDbWorker), or the
    // page can never open the database.
    expect(html).toMatch(/<script[^>]*\bsrc="vendor\/index\.js"/);
    // No inline model logic: the only inline script is the SW registration.
    const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
    for (const body of inlineScripts) {
      expect(body).toContain('serviceWorker');
    }
  });

  it('LedgerPage_IsPrecachedForTheOfflineShell', () => {
    const src = siteFile('sw.js');
    const block = src.match(/const SHELL_ASSETS = \[([\s\S]*?)\];/);
    if (block === null) throw new Error('SHELL_ASSETS array not found in sw.js');
    const listed = new Set([...block[1].matchAll(/'([^']+)'/g)].map(m => m[1]));
    for (const asset of ['ledger.html', 'ledger.js', 'ledger.css', 'ledger-query.js']) {
      expect(listed.has(asset), `sw.js SHELL_ASSETS omits ${asset} (offline shell incomplete)`).toBe(true);
    }
  });

  it('LedgerPage_ShipsToTheDeployWithTheDatabaseAndCanonicalNav', () => {
    const wf = fs.readFileSync(PAGES_WORKFLOW, 'utf8');
    // The asset globs carry the page, its scripts and the bespoke stylesheet.
    expect(wf).toMatch(/cp\b[^\n]*\bsite\/\*\.html\b/);
    expect(wf).toMatch(/cp\b[^\n]*\bsite\/\*\.js\b/);
    expect(wf).toMatch(/cp\b[^\n]*\bsite\/\*\.css\b/);
    // The COMPACT claim-ledger database is built as a deploy artefact for the
    // page (the full corpus that fits the range-served Pages lane).
    expect(wf).toMatch(/build-ledger-db-compact\.ts[^\n]*claim-ledger\.sqlite\.png/);
    // Issue #475: the monolith is split into range-served chunk files with a
    // length manifest (so the browser never HEADs the whole object - a HEAD of a
    // large object on Pages is a ~30s compressed-variant CDN miss), then removed
    // so the deployed site carries the chunks only.
    expect(wf).toMatch(/split\b[^\n]*claim-ledger\.sqlite\.png\./);
    expect(wf).toMatch(/claim-ledger\.chunks\.json/);
    expect(wf).toMatch(/rm -f[^\n]*claim-ledger\.sqlite\.png\b/);
    // The nav injector must be handed the page, or its deployed copy carries a
    // stale hand-written nav.
    expect(wf).toMatch(/build-nav\.ts[^\n]*\b_site\/ledger\.html\b/);
  });

  it('LedgerPage_CarriesNavMarkersAndIsWayfindableAsLive', () => {
    const html = siteFile('ledger.html');
    expect(html).toContain('<!-- nav:start (canonical strip stamped in at deploy by src/ci/build-nav.ts) -->');
    expect(html).toContain('<!-- nav:end -->');
    // Renamed off "(preview)": the page now serves real data.
    expect(html).toContain('<strong>Ledger</strong>');
    expect(html).not.toContain('Ledger (preview)');
    // Honest framing: tied to issue #361, and scoped to register snapshots only
    // (no overclaim of covering Ofcom's other disclosures).
    expect(html).toContain('issues/361');
    expect(html).toContain('Register snapshots only');
  });

  it('LedgerPage_IsInTheSingleSourceNav', () => {
    const nav = fs.readFileSync(path.join('src', 'ci', 'render', 'page.ts'), 'utf8');
    expect(nav).toMatch(/\['Ledger', `\$\{rootPath\}ledger\.html`\]/);
    const buildNav = fs.readFileSync(path.join('src', 'ci', 'build-nav.ts'), 'utf8');
    expect(buildNav).toContain("'ledger.html': 'Ledger'");
  });
});
