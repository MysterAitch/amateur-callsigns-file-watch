// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { enhance } from './entry-browser.js';

// The coordinated entry-page browser (entry-browser.js) opens the combined
// database eagerly on first render - there is no trigger button. issue #499
// requires that slow cold open to be COMMUNICATED, not hidden, so it routes the
// open + query through the shared loading affordance (withDatabaseLoading). These
// tests build the real `.browser[data-dataset]` scaffold, run enhance with a
// controlled combined opener, and assert what a user (and assistive tech) would
// perceive: the polite loading status, the escalation, aria-busy on the result
// region, and the assertive alert when the cold open fails. The opener is
// injected so no real range-request worker is touched.

function buildScaffold(dataset = '2026-06-23'): HTMLElement {
  const section = document.createElement('section');
  section.className = 'browser';
  section.setAttribute('data-dataset', dataset);
  const staticView = document.createElement('div');
  staticView.className = 'browser-static';
  staticView.textContent = 'static preview';
  section.append(staticView);
  document.body.append(section);
  return section;
}

// A worker whose db.query answers the browser's two queries: the COUNT(*) probe
// and the row page. An empty result set is enough - renderRows then draws the
// "no matching rows" table without needing real register data.
function fakeWorker(): { db: { query: (sql: string) => Promise<unknown[]> } } {
  return { db: { query: async (sql: string) => { await Promise.resolve(); return /^SELECT COUNT/i.test(sql) ? [{ n: 0 }] : []; } } };
}

const flush = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

beforeEach(() => {
  document.body.replaceChildren();
});

describe('entry-browser eager load affordance', { tags: ['ui'] }, () => {
  it('EntryBrowser_OnEagerFirstLoad_AnnouncesLoadingAndMarksTheResultBusy', async () => {
    const section = buildScaffold();
    let release = (): void => undefined;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const openCombined = (): Promise<ReturnType<typeof fakeWorker>> => gate.then(() => fakeWorker());

    enhance(section, { openCombined });

    // enhance restores eagerly (restore -> refresh); the combined open is gated, so
    // the affordance's synchronous head has already run: the polite status names
    // the load and the result region is marked busy, before any data arrives.
    const statusLine = section.querySelector('[role="status"]');
    const result = section.querySelector('.browser-result');
    expect(statusLine?.textContent).toContain('Loading the combined database');
    expect(result?.getAttribute('aria-busy')).toBe('true');

    release();
    await flush();

    // Once the open + count + rows complete, the busy flag clears and the polite
    // status reports the (empty) result rather than staying stuck on "Loading…".
    expect(result?.hasAttribute('aria-busy')).toBe(false);
    expect(statusLine?.textContent).toContain('matching row');
  });

  it('EntryBrowser_WhenTheColdOpenRunsLong_EscalatesTheStatusToAFirstUseReassurance', async () => {
    vi.useFakeTimers();
    try {
      const section = buildScaffold();
      let release = (): void => undefined;
      const gate = new Promise<void>(resolve => { release = resolve; });
      const openCombined = (): Promise<ReturnType<typeof fakeWorker>> => gate.then(() => fakeWorker());

      enhance(section, { openCombined });
      const statusLine = section.querySelector('[role="status"]');

      // Past the slow-open threshold the polite status escalates to the first-use
      // reassurance, so a long cold open reads as progressing, not hung.
      await vi.advanceTimersByTimeAsync(1200);
      expect(statusLine?.textContent).toMatch(/first use/i);

      release();
      await vi.runAllTimersAsync();
    } finally {
      vi.useRealTimers();
    }
  });

  it('EntryBrowser_WhenTheCombinedDatabaseFailsToOpen_RaisesTheAssertiveLoadAlert', async () => {
    const section = buildScaffold();
    const openCombined = (): Promise<never> => Promise.reject(new Error('offline'));

    enhance(section, { openCombined });
    await flush();

    // A failed cold open raises the assertive alert (role="alert") with the
    // retryable transient message; the polite status is not mislabelled as a
    // query failure (the database never opened, so no query ran).
    const alertEl = section.querySelector('.db-alert');
    const statusLine = section.querySelector('[role="status"]');
    expect(alertEl?.hasAttribute('hidden')).toBe(false);
    expect((alertEl as HTMLElement).dataset.severity).toBe('transient');
    expect(alertEl?.textContent).toMatch(/couldn.t load the combined database/i);
    expect(statusLine?.textContent ?? '').not.toMatch(/query failed/i);
  });
});

// A worker whose page query answers with one real register-history row, so the
// filters-mode table actually draws 'status'/'product'/'implied_class' cells.
function rowWorker(row: Record<string, string>): { db: { query: (sql: string) => Promise<unknown[]> } } {
  return {
    db: {
      query: async (sql: string) => {
        await Promise.resolve();
        return /^SELECT COUNT/i.test(sql) ? [{ n: 1 }] : [row];
      },
    },
  };
}

describe('entry-browser field wrappers adoption (#625)', { tags: ['ui'] }, () => {
  it('EntryBrowserRow_StatusColumn_RendersTheSharedStatFieldUnlinked', async () => {
    const section = buildScaffold();
    const row = { callsign: 'M7TEE', cleaned: 'M7TEE', status: 'Allocated', product: 'Amateur Full Radio Licence', implied_class: 'Full', prefix_series: 'M7' };
    enhance(section, { openCombined: () => Promise.resolve(rowWorker(row)) });
    await flush();

    const statCell = section.querySelector('td .stat');
    // 'plain' linking (#553/#625 drift-guard): this table repeats the same
    // handful of status values down a page of rows, so - matching the
    // generated raw-preview convention - the value is never glossary-linked
    // here even though 'Allocated' is a recognised value.
    expect(statCell?.textContent).toBe('Allocated');
    expect(statCell?.querySelector('a')).toBeNull();
  });

  it('EntryBrowserRow_ProductAndImpliedClassColumns_RenderTheSharedLicField', async () => {
    const section = buildScaffold();
    const row = { callsign: 'M7TEE', cleaned: 'M7TEE', status: 'Allocated', product: 'Amateur Full Radio Licence', implied_class: 'Full', prefix_series: 'M7' };
    enhance(section, { openCombined: () => Promise.resolve(rowWorker(row)) });
    await flush();

    const licCells = [...section.querySelectorAll('td .lic')];
    expect(licCells.map(c => c.textContent)).toEqual(['Amateur Full Radio Licence', 'Full']);
  });

  it('EntryBrowserRow_BlankStatusOrProduct_HumanisesRatherThanRenderingAnEmptyCell', async () => {
    const section = buildScaffold();
    const row = { callsign: 'M7TEE', cleaned: 'M7TEE', status: '', product: '', implied_class: 'Full', prefix_series: 'M7' };
    enhance(section, { openCombined: () => Promise.resolve(rowWorker(row)) });
    await flush();

    expect(section.querySelector('td .stat-blank')?.textContent).toBe('(blank)');
    expect(section.querySelector('td .lic-blank')?.textContent).toBe('(blank)');
  });
});

describe('entry-browser inbound callsign links (#594)', { tags: ['ui'] }, () => {
  it('EntryBrowserRow_CleanedColumn_LinksToTheCanonicalPerCallsignPage', async () => {
    const section = buildScaffold();
    const row = { callsign: 'M7TEE', cleaned: 'M7TEE', status: 'Allocated', product: 'Amateur Full Radio Licence', implied_class: 'Full', prefix_series: 'M7' };
    enhance(section, { openCombined: () => Promise.resolve(rowWorker(row)) });
    await flush();

    // The cleaned column IS the register's own callsign (the artefact-stripped
    // join key), so it now links to its canonical per-callsign page.
    const cleanedLink = section.querySelector('td a.callsign-pill');
    expect(cleanedLink?.getAttribute('href')).toBe('callsign.html?c=M7TEE');
    expect(cleanedLink?.textContent).toBe('M7TEE');
  });

  it('EntryBrowserRow_RawCallsignColumn_RemainsANonLinkChip', async () => {
    const section = buildScaffold();
    const row = { callsign: 'M7TEE', cleaned: 'M7TEE', status: 'Allocated', product: 'Amateur Full Radio Licence', implied_class: 'Full', prefix_series: 'M7' };
    enhance(section, { openCombined: () => Promise.resolve(rowWorker(row)) });
    await flush();

    // The raw as-published callsign column stays a non-link chip (issue #310):
    // it is data to inspect, never a navigation target, so #594's new inbound
    // linking must not touch it.
    const rawChip = section.querySelector('td code.callsign-pill');
    expect(rawChip).not.toBeNull();
    expect(rawChip?.tagName).toBe('CODE');
  });
});

describe('entry-browser custom-query zero de-emphasis (issue #731)', { tags: ['ui'] }, () => {
  // A hand-written custom query (the SQL box, `custom SQL` mode) can select
  // arbitrary columns, unlike the fixed filters-mode COLUMNS - the generic
  // fallback cell is the hook point that must recognise a literal zero.
  function customQueryWorker(): { db: { query: (sql: string) => Promise<unknown[]> } } {
    return {
      db: {
        query: async (sql: string) => {
          await Promise.resolve();
          if (/dropped/i.test(sql)) return /COUNT\(\*\)/i.test(sql) ? [{ n: 1 }] : [{ label: 'x', dropped: 0 }];
          return /COUNT\(\*\)/i.test(sql) ? [{ n: 0 }] : [];
        },
      },
    };
  }

  it('EntryBrowserRow_CustomQueryNumericZeroColumn_CarriesTheSharedZeroClass', async () => {
    const section = buildScaffold();
    enhance(section, { openCombined: () => Promise.resolve(customQueryWorker()) });
    await flush();

    const textarea = section.querySelector('textarea[aria-label="SQL query"]');
    const runBtn = section.querySelector('button.run');
    if (!(textarea instanceof HTMLTextAreaElement) || !(runBtn instanceof HTMLButtonElement)) {
      throw new Error('SQL box controls missing from entry-browser scaffold');
    }
    textarea.value = 'SELECT \'x\' AS label, 0 AS dropped';
    runBtn.click();
    await flush();

    const cells = [...section.querySelectorAll('td')];
    const labelCell = cells.find(c => c.textContent === 'x');
    const zeroCell = cells.find(c => c.textContent === '0');
    expect(zeroCell?.className).toBe('zero');
    // A non-numeric-looking neighbour column is unaffected.
    expect(labelCell?.className).toBe('');
  });
});
