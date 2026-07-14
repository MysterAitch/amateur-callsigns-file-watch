// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { loadDatasets } from './compare.js';

// The Compare page opens the combined database EAGERLY on load - no trigger button,
// just boot() reaching for the publication list the instant the page appears. That
// first open is the cold one (the combined database is the large ~1 GB costume whose
// first HTTP-range open is a measured ~20s, issue #475), so it must be communicated
// exactly as every other query surface communicates a slow load (issue #499): the
// boot status shows an escalating loading message, the results region carries
// aria-busy while the open is in flight, and a failed open surfaces honestly in the
// assertive alert rather than a bare status line. These tests drive loadDatasets -
// the exact eager path boot() runs - against a controlled opener, so no real worker
// is spun up, and assert the observable state a user (and assistive tech) perceives.
// Test names follow Subject_Scenario_Outcome.

// Build the host from the SHIPPED compare.html markup, so the affordance is
// exercised against the real #boot-status / #boot-alert / #setup regions rather
// than a hand-made copy that could drift from what deploys.
function bootHost(): { statusEl: HTMLElement; alertEl: HTMLElement; resultEl: HTMLElement } {
  const html = fs.readFileSync(path.join('site', 'compare.html'), 'utf8');
  const main = html.slice(html.indexOf('<main'), html.indexOf('</main>') + '</main>'.length);
  document.body.innerHTML = main;
  const statusEl = document.getElementById('boot-status');
  const alertEl = document.getElementById('boot-alert');
  const resultEl = document.getElementById('setup');
  if (statusEl === null || alertEl === null || resultEl === null) {
    throw new Error('compare.html is missing the boot-status / boot-alert / setup regions the eager load drives');
  }
  return { statusEl, alertEl, resultEl };
}

// A worker whose db.query resolves to the publication rows, matching the shape the
// httpvfs worker exposes (worker.db.query(sql) -> rows).
function fakeWorker(rows: Record<string, unknown>[]): { db: { query: () => Promise<Record<string, unknown>[]> } } {
  return { db: { query: () => Promise.resolve(rows) } };
}

describe('compare eager combined-database load', { tags: ['ui'] }, () => {
  it('CompareBoot_WhileOpeningTheCombinedDatabase_ShowsTheLoadingAffordanceAndMarksTheResultsBusy', async () => {
    const { statusEl, alertEl, resultEl } = bootHost();
    // Hold the open shut so the interval before it completes is observable: the
    // user must already see that the combined database is loading.
    let release: (() => void) | undefined;
    const opened = new Promise<void>(resolve => { release = resolve; });
    const rows = [{ dataset: '2026-06-23', record_count: 1 }];
    const call = loadDatasets({
      statusEl, alertEl, resultEl,
      openDatabase: () => opened.then(() => fakeWorker(rows)),
    });

    // Immediately - before the database has opened - the eager, no-button
    // affordance drives the boot status and rides the results region's aria-busy.
    expect(statusEl.textContent).toMatch(/loading the combined database/i);
    expect(resultEl.getAttribute('aria-busy')).toBe('true');

    release?.();
    const loaded = await call;
    // The publication list is returned unchanged, and aria-busy clears on success.
    expect(loaded).toEqual(rows);
    expect(resultEl.hasAttribute('aria-busy')).toBe(false);
  });

  it('CompareBoot_WhenTheOpenRunsPastTheThreshold_EscalatesToAFirstUseReassurance', async () => {
    vi.useFakeTimers();
    try {
      const { statusEl, alertEl, resultEl } = bootHost();
      let release: (() => void) | undefined;
      const opened = new Promise<void>(resolve => { release = resolve; });
      const call = loadDatasets({
        statusEl, alertEl, resultEl,
        openDatabase: () => opened.then(() => fakeWorker([])),
      });
      // Once the open has run past the affordance's slow-load threshold, the status
      // escalates to the honest first-use reassurance rather than sitting silent.
      await vi.advanceTimersByTimeAsync(1200);
      expect(statusEl.textContent).toMatch(/first use/i);
      release?.();
      await call;
    } finally {
      vi.useRealTimers();
    }
  });

  it('CompareBoot_WhenTheCombinedDatabaseFailsToOpen_RaisesTheAssertiveTransientLoadAlert', async () => {
    const { statusEl, alertEl, resultEl } = bootHost();
    await expect(loadDatasets({
      statusEl, alertEl, resultEl,
      openDatabase: () => Promise.reject(new Error('offline')),
    })).rejects.toThrow('offline');

    // A failed cold open is a transient, retryable load failure: it surfaces in the
    // assertive #boot-alert (not the polite status), the status is cleared, and the
    // results region is no longer marked busy so nothing is left hanging.
    expect(alertEl.hidden).toBe(false);
    expect(alertEl.dataset.severity).toBe('transient');
    expect(alertEl.textContent).toMatch(/check your connection and try again/i);
    expect(statusEl.textContent).toBe('');
    expect(resultEl.hasAttribute('aria-busy')).toBe(false);
  });
});
