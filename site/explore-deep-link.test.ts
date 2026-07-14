// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parseExploreParams, applyExploreParams, prepareSql } from './explore.js';

// The Explore console reads a shareable deep link (?db=/?sql=) on load and
// applies it, so a report or a hand-authored page can link a SPECIFIC query
// rather than only the generic tool (issues #333/#397). These tests pin the
// user-facing contract: a representative link pre-fills the controls and signals
// a run; a malformed link degrades gracefully (never throws, ignores the bad
// piece with a note) rather than breaking the page; and nothing from the link
// reaches the DOM as markup. Test names follow Subject_Scenario_Outcome.

// A minimal stand-in for the console controls the page owns.
function host(): { dbSelect: HTMLSelectElement; input: HTMLTextAreaElement; statusEl: HTMLElement } {
  document.body.innerHTML = `
    <select id="db-select"><option value="latest">latest</option><option value="combined">combined</option></select>
    <textarea id="sql-input"></textarea>
    <span id="sql-status" role="status"></span>`;
  return {
    dbSelect: document.getElementById('db-select') as HTMLSelectElement,
    input: document.getElementById('sql-input') as HTMLTextAreaElement,
    statusEl: document.getElementById('sql-status') as HTMLElement,
  };
}

describe('parseExploreParams', { tags: ['ui'] }, () => {
  it('ExploreParams_WhenKnownDbAndSql_AreReturned', () => {
    const p = parseExploreParams(new URLSearchParams('db=combined&sql=SELECT 1'));
    expect(p).toEqual({ db: 'combined', sql: 'SELECT 1', unknownDb: null });
  });
  it('ExploreParams_WhenLegacyMasterDb_ResolvesToCombined', () => {
    // The combined database was historically named "master". An old shared link
    // carrying ?db=master must still resolve to the combined database (not be
    // reported as an unknown database), so existing links keep working.
    const p = parseExploreParams(new URLSearchParams('db=master&sql=SELECT 1'));
    expect(p).toEqual({ db: 'combined', sql: 'SELECT 1', unknownDb: null });
  });
  it('ExploreParams_WhenUnknownDb_IsReportedNotApplied', () => {
    const p = parseExploreParams(new URLSearchParams('db=postgres&sql=SELECT 1'));
    expect(p.db).toBeNull();
    expect(p.unknownDb).toBe('postgres');
    expect(p.sql).toBe('SELECT 1');
  });
  it('ExploreParams_WhenBlankOrAbsentSql_IsNull', () => {
    expect(parseExploreParams(new URLSearchParams('sql=%20%20')).sql).toBeNull();
    expect(parseExploreParams(new URLSearchParams('')).sql).toBeNull();
  });
});

describe('applyExploreParams', { tags: ['ui'] }, () => {
  it('ExploreDeepLink_WhenDbAndSqlParams_PreFillsControlsAndSignalsRun', () => {
    const dom = host();
    const shouldRun = applyExploreParams(dom, new URLSearchParams('db=combined&sql=SELECT * FROM register_history LIMIT 5'));
    expect(dom.dbSelect.value).toBe('combined');
    expect(dom.input.value).toBe('SELECT * FROM register_history LIMIT 5');
    expect(dom.statusEl.textContent).toMatch(/running/i);
    expect(shouldRun).toBe(true);
  });

  it('ExploreDeepLink_WhenLegacyMasterDbInLink_SelectsTheCombinedDatabaseAndRuns', () => {
    // A shared link from before the rename (?db=master) selects the combined
    // database and auto-runs, exactly as a current ?db=combined link would.
    const dom = host();
    const shouldRun = applyExploreParams(dom, new URLSearchParams('db=master&sql=SELECT * FROM register_history LIMIT 5'));
    expect(dom.dbSelect.value).toBe('combined');
    expect(shouldRun).toBe(true);
  });

  it('ExploreDeepLink_WhenUnknownDatabase_DegradesAndDoesNotAutoRun', () => {
    // A stale/bad db must not break the page: the default database stays, the
    // query is still pre-filled, the status region says what was ignored, and it
    // does NOT auto-run a link it could not fully honour.
    const dom = host();
    const shouldRun = applyExploreParams(dom, new URLSearchParams("db=evil'; DROP&sql=SELECT 1"));
    expect(dom.dbSelect.value).toBe('latest');
    expect(dom.input.value).toBe('SELECT 1');
    expect(dom.statusEl.textContent).toMatch(/unknown database/i);
    expect(shouldRun).toBe(false);
  });

  it('ExploreDeepLink_WhenNoParams_LeavesControlsUntouched', () => {
    const dom = host();
    const shouldRun = applyExploreParams(dom, new URLSearchParams(''));
    expect(dom.input.value).toBe('');
    expect(dom.dbSelect.value).toBe('latest');
    expect(dom.statusEl.textContent).toBe('');
    expect(shouldRun).toBe(false);
  });

  it('ExploreDeepLink_WhenSqlCarriesHtml_SetsItAsTextNeverMarkup', () => {
    // The query is written to the textarea's value, so a '<' in a shared link is
    // shown literally and can never inject a node into the page.
    const dom = host();
    applyExploreParams(dom, new URLSearchParams({ db: 'latest', sql: "SELECT '<img src=x onerror=alert(1)>'" }));
    expect(dom.input.value).toBe("SELECT '<img src=x onerror=alert(1)>'");
    expect(document.querySelector('img')).toBeNull();
  });

  it('ExploreDeepLink_WhenMalformedParams_DegradesWithoutThrowing', () => {
    const dom = host();
    expect(() => applyExploreParams(dom, new URLSearchParams('db=&sql=   '))).not.toThrow();
    expect(applyExploreParams(dom, new URLSearchParams('db=&sql=   '))).toBe(false);
  });
});

describe('explore exemplar deep-links (end-to-end wiring)', { tags: ['ui'] }, () => {
  it('ExploreExemplars_InHandAuthoredPages_CarryQueriesTheConsoleGuardAccepts', () => {
    // Every explore.html?…sql= link a hand-authored page ships must name a valid
    // database and a query the console's own read-only guard accepts, or the
    // exemplar would greet the reader with a rejection.
    const links = ['index.html', 'statistics.html'].flatMap((file) => {
      const html = fs.readFileSync(path.join('site', file), 'utf8');
      return [...html.matchAll(/explore\.html\?([^"'#\s]+)/g)].map(m => m[1]);
    });
    expect(links.length).toBeGreaterThan(0);
    for (const qs of links) {
      const params = new URLSearchParams(qs.replace(/&amp;/g, '&'));
      const { db, sql, unknownDb } = parseExploreParams(params);
      expect(unknownDb, `${qs} names an unknown database`).toBeNull();
      expect(db === null || db === 'latest' || db === 'combined').toBe(true);
      if (sql !== null) expect(() => prepareSql(sql), qs).not.toThrow();
    }
  });
});
