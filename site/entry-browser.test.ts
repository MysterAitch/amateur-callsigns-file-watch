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
  return { db: { query: async (sql: string) => (/^SELECT COUNT/i.test(sql) ? [{ n: 0 }] : []) } };
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
