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
  // The browser writes its live filter state (including the sort) into the
  // ?view= query param via the History API, which the test environment persists
  // across tests in a file. Reset the URL between tests so one test's pushed view
  // cannot restore into the next test's initial state.
  window.history.replaceState(null, '', '/');
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
    expect(licCells.map(c => c.textContent)).toEqual(['Amateur Full Radio Licence', 'Full (derived — computed by the mirror, not a value recorded in the register)']);
  });

  it('EntryBrowserRow_DerivedImpliedClassColumn_IsCuedAsDerivedWhileThePublishedProductIsNot', async () => {
    // Issue #836: in the results grid the DERIVED implied_class and the PUBLISHED
    // product share the .lic chrome. The derived one must carry the provenance
    // cue (the lic-derived modifier + a visually-hidden note) so it does not read
    // as a register fact; the published one must NOT - the cue is a genuine
    // distinction, present on the derived value and absent on the published one.
    const section = buildScaffold();
    const row = { callsign: 'M7TEE', cleaned: 'M7TEE', status: 'Allocated', product: 'Amateur Full Radio Licence', implied_class: 'Full', prefix_series: 'M7' };
    enhance(section, { openCombined: () => Promise.resolve(rowWorker(row)) });
    await flush();

    const derived = section.querySelector('td .lic.lic-derived');
    expect(derived?.textContent).toContain('Full');
    expect(derived?.getAttribute('title')).toContain('derived');
    expect(derived?.querySelector('.visually-hidden')?.textContent).toContain('derived');

    // The published product cell wears .lic but never the derived modifier.
    const licCells = [...section.querySelectorAll('td .lic')];
    const published = licCells.find(c => (c.textContent ?? '').startsWith('Amateur Full'));
    expect(published?.classList.contains('lic-derived')).toBe(false);
    expect(published?.querySelector('.visually-hidden')).toBeNull();
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

// The per-dataset browser reorders via SQL: a header activation rewrites the
// ORDER BY, so the emitted ORDER BY clause is the observable proof of the sort
// state. These tests pin the transition semantics the browser has always had —
// now supplied by the shared table-sort core (issue #787) rather than a
// hand-rolled, in-place-mutating closure — through the SQL a user's clicks emit.
describe('entry-browser header sort transitions (issue #787)', { tags: ['ui'] }, () => {
  // A worker that records every SQL it is asked to run (and returns an empty
  // page), so a test can read back the ORDER BY the current sort state produced.
  function recordingWorker(): { db: { query: (sql: string) => Promise<unknown[]> }, queries: string[] } {
    const queries: string[] = [];
    return {
      queries,
      db: {
        query: async (sql: string) => {
          queries.push(sql);
          await Promise.resolve();
          return /^SELECT COUNT/i.test(sql) ? [{ n: 0 }] : [];
        },
      },
    };
  }

  // The ORDER BY clause of the most recent page query (the count probe carries
  // no ORDER BY), i.e. the sort the latest render actually applied.
  function lastOrderBy(queries: string[]): string | undefined {
    const withOrder = queries.filter(q => /ORDER BY/i.test(q));
    const match = withOrder[withOrder.length - 1]?.match(/ORDER BY (.+?)\)\s*LIMIT/i);
    return match?.[1]?.trim();
  }

  // The sortable header cell for a given register column, by its (arrow-stripped)
  // label. Throws rather than returning null so a scaffold drift fails loudly.
  function headerFor(section: HTMLElement, col: string): HTMLElement {
    const th = [...section.querySelectorAll('th.sortable')]
      .find(t => (t.textContent ?? '').startsWith(col));
    if (!(th instanceof HTMLElement)) throw new Error(`no sortable header for column "${col}"`);
    return th;
  }

  // Optionally seed the ?view= link the browser restores from on first render,
  // so a test can start it from a specific (or deliberately malformed) sort.
  async function boot(view?: unknown): Promise<{ section: HTMLElement, queries: string[] }> {
    if (view !== undefined) window.history.replaceState(null, '', '/?view=' + encodeURIComponent(JSON.stringify(view)));
    const section = buildScaffold();
    const worker = recordingWorker();
    enhance(section, { openCombined: () => Promise.resolve(worker) });
    await flush();
    return { section, queries: worker.queries };
  }

  it('EntryBrowser_OnFirstRender_SortsByCallsignAscendingByDefault', async () => {
    const { queries } = await boot();
    expect(lastOrderBy(queries)).toBe('"callsign" ASC');
  });

  it('EntryBrowser_WhenAColumnHeaderIsActivated_SortsByThatColumnAloneAscending', async () => {
    const { section, queries } = await boot();
    headerFor(section, 'status').click();
    await flush();
    // A plain activation of a different column replaces the sort with that one
    // column, ascending — the default callsign sort is dropped, not appended.
    expect(lastOrderBy(queries)).toBe('"status" ASC');
  });

  it('EntryBrowser_WhenTheSoleAscendingColumnIsReactivated_TogglesItToDescending', async () => {
    const { section, queries } = await boot();
    // Callsign is the sole ascending sort on first render; re-activating it flips
    // just that column to descending rather than restarting it ascending.
    headerFor(section, 'callsign').click();
    await flush();
    expect(lastOrderBy(queries)).toBe('"callsign" DESC');
  });

  it('EntryBrowser_WhenAColumnIsActivatedTwice_TogglesAscendingThenDescending', async () => {
    const { section, queries } = await boot();
    const status = headerFor(section, 'status');
    status.click();
    await flush();
    expect(lastOrderBy(queries)).toBe('"status" ASC');
    // A second plain activation of the now-sole ascending column toggles it.
    headerFor(section, 'status').click();
    await flush();
    expect(lastOrderBy(queries)).toBe('"status" DESC');
  });

  it('EntryBrowser_WhenAHeaderIsModifierActivated_AppendsASecondarySort', async () => {
    const { section, queries } = await boot();
    headerFor(section, 'status').click();
    await flush();
    // A modified (Shift) activation appends the column as a secondary sort rather
    // than replacing the primary one, so both columns order the result in turn.
    headerFor(section, 'product').dispatchEvent(new MouseEvent('click', { shiftKey: true, bubbles: true }));
    await flush();
    expect(lastOrderBy(queries)).toBe('"status" ASC, "product" ASC');
  });

  it('EntryBrowser_WhenAnExistingSecondaryColumnIsModifierActivated_TogglesOnlyItsDirection', async () => {
    const { section, queries } = await boot();
    headerFor(section, 'status').click();
    await flush();
    const product = headerFor(section, 'product');
    product.dispatchEvent(new MouseEvent('click', { shiftKey: true, bubbles: true }));
    await flush();
    expect(lastOrderBy(queries)).toBe('"status" ASC, "product" ASC');
    // Toggling an already-present secondary column flips its direction alone,
    // leaving the primary column and the column order untouched.
    headerFor(section, 'product').dispatchEvent(new MouseEvent('click', { shiftKey: true, bubbles: true }));
    await flush();
    expect(lastOrderBy(queries)).toBe('"status" ASC, "product" DESC');
  });

  it('EntryBrowser_WhenAViewLinkCarriesANonCanonicalDirection_FirstTogglePreservesTheStrictAscendingRule', async () => {
    // The ?view= link is untrusted: browser-query parses sort.dir from its JSON
    // without normalising it, so a stale or hand-edited link can carry a
    // non-canonical direction (here lowercase 'desc'). The transition rule this
    // browser has always applied treats a direction as ascending ONLY when it is
    // exactly 'ASC', so a value that is not 'ASC' — canonical 'DESC' or this
    // garbage 'desc' alike — is descending, and the first single toggle off it
    // yields 'ASC'. This guards that exact predicate against a mapping that would
    // instead read only 'DESC' as descending (treating 'desc' as ascending, so
    // the first toggle would wrongly produce DESC).
    const { section, queries } = await boot({ s: [{ col: 'callsign', dir: 'desc' }] });
    headerFor(section, 'callsign').click();
    await flush();
    expect(lastOrderBy(queries)).toBe('"callsign" ASC');
  });
});

// The "Interesting queries" starting points are reader-facing SQL. One of them
// probes withheld-suffix callsigns against their suffix's first-known-forbidden
// date. That comparison reads the licence-version ORIGINAL START — the licence
// chain's origin, NOT the callsign's issuance (#915/#918): for a recently-
// introduced series it can be carried licence history (the real case M9RAF,
// carried origin 2024-12-21), so the query must stay licence-scoped. This guard
// pins the corrected wording so the issuance framing cannot silently return.
describe('entry-browser interesting-query licence-chain wording (#918)', { tags: ['ui'] }, () => {
  it('EntryBrowser_WithheldSuffixExampleQuery_IsLicenceScopedNotIssuanceScoped', async () => {
    const section = buildScaffold();
    enhance(section, { openCombined: () => Promise.resolve(fakeWorker()) });
    await flush();

    const button = [...section.querySelectorAll('button.exq')]
      .find(b => (b.textContent ?? '').includes('licence-version start before or after first known forbidden'));
    expect(button, 'the withheld-suffix example query button must be present').toBeInstanceOf(HTMLElement);
    (button as HTMLElement).click();
    await flush();

    const textarea = section.querySelector('textarea[aria-label="SQL query"]');
    const sql = (textarea as HTMLTextAreaElement).value;
    // Licence-scoped: the column is aliased and ordered as the licence start,
    // and the relation label speaks of the licence-version start, not issuance.
    expect(sql).toContain('licence_version_original_start_date AS licence_start');
    expect(sql).toContain('ORDER BY licence_start');
    expect(sql).toContain("'starts after'");
    // The retired issuance framing must not resurface anywhere in the query.
    expect(sql).not.toContain('AS issued');
    expect(sql).not.toContain('issued after');
  });
});
