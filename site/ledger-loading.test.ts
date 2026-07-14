// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { makeLedgerLookup } from './ledger.js';

// The Ledger callsign lookup routes its database open + lookup through the shared
// loading affordance (issues #499/#506), so the first-use wait is communicated
// exactly as it is on Explore and the Playground. These tests drive the real page
// host markup (from ledger.html) against an injected opener and a stub lookup
// runner, so they assert the affordance's observable behaviour - what a user (and
// assistive tech) perceive - without a database worker. Test names follow
// Subject_Scenario_Outcome.

const SITE_DIR = 'site';
const LEDGER_HTML = fs.readFileSync(path.join(SITE_DIR, 'ledger.html'), 'utf8');
const MAIN = LEDGER_HTML.slice(LEDGER_HTML.indexOf('<main'), LEDGER_HTML.indexOf('</main>') + '</main>'.length);

// Seed the document with the page's real search markup (form, button, status,
// alert, result host and sample chips), then narrow the elements the affordance
// drives - failing loudly if any is missing, so a renamed element never silently
// slips the affordance.
function hostFromPage(): {
  button: HTMLButtonElement; statusEl: HTMLElement; alertEl: HTMLElement; resultEl: HTMLElement;
} {
  document.body.innerHTML = MAIN;
  const button = document.querySelector('#lookup-form button');
  const statusEl = document.getElementById('lookup-status');
  const alertEl = document.getElementById('lookup-alert');
  const resultEl = document.getElementById('entity');
  if (!(button instanceof HTMLButtonElement) || statusEl === null || alertEl === null || resultEl === null) {
    throw new Error('ledger lookup host elements missing from ledger.html');
  }
  return { button, statusEl, alertEl, resultEl };
}

describe('Ledger lookup loading affordance (issues #499/#506)', { tags: ['ui'] }, () => {
  it('LedgerLookup_WhenFirstSearch_DisablesTheButtonInAWaitingStateWithAriaBusy', async () => {
    const { button, statusEl, alertEl, resultEl } = hostFromPage();
    // Hold the database open shut, so the interval between the search and the open
    // is observable: the user must already see that something is happening.
    let release: (() => void) | undefined;
    const opened = new Promise<void>(resolve => { release = resolve; });
    const performLookup = vi.fn(async () => ({ entity: 'G#0TQK' }));
    const { lookup } = makeLedgerLookup({
      button, statusEl, alertEl, resultEl, doc: document, performLookup,
      openDatabase: () => opened.then(() => ({})),
    });

    const pending = lookup('G0TQK');

    // Immediately - before the database has opened - the shared affordance shows
    // progress, disables the button and gives it the waiting label, and marks the
    // result region busy for assistive tech.
    expect(button.disabled).toBe(true);
    expect(button.dataset.state).toBe('loading');
    expect(button.textContent).toMatch(/waiting/i);
    expect(resultEl.getAttribute('aria-busy')).toBe('true');
    expect(statusEl.textContent).toMatch(/loading/i);

    // Let the open finish; the lookup then runs and the button frees up, aria-busy
    // clears, and the surface's resolved-status line is left showing.
    release?.();
    await pending;
    expect(performLookup).toHaveBeenCalledWith(expect.anything(), 'G0TQK');
    expect(button.disabled).toBe(false);
    expect(button.dataset.state).toBe('ready');
    expect(button.textContent).toBe('Look up');
    expect(resultEl.hasAttribute('aria-busy')).toBe(false);
    expect(statusEl.textContent).toContain('Resolved G0TQK → G#0TQK');
  });

  it('LedgerLookup_WhenTheDatabaseOpenFails_RaisesTheAssertiveAlertAndFreesTheButton', async () => {
    const { button, statusEl, alertEl, resultEl } = hostFromPage();
    const performLookup = vi.fn();
    const { lookup } = makeLedgerLookup({
      button, statusEl, alertEl, resultEl, doc: document, performLookup,
      openDatabase: () => Promise.reject(new Error('offline')),
    });

    await lookup('G0TQK');

    // A failed open never reaches the lookup runner; the affordance raises the
    // assertive alert (transient - retryable) and returns the button to ready so
    // the search can be retried.
    expect(performLookup).not.toHaveBeenCalled();
    expect(alertEl.hidden).toBe(false);
    expect(alertEl.dataset.severity).toBe('transient');
    expect(alertEl.textContent).toMatch(/check your connection and try again/i);
    expect(button.disabled).toBe(false);
    expect(button.dataset.state).toBe('ready');
  });

  it('LedgerLookup_WhenSearchedAgain_ReusesTheWarmOpenWithoutReopening', async () => {
    const { button, statusEl, alertEl, resultEl } = hostFromPage();
    let opens = 0;
    const performLookup = vi.fn(async (_query: unknown, value: string) =>
      ({ entity: value === 'G0TQK' ? 'G#0TQK' : null }));
    const { lookup } = makeLedgerLookup({
      button, statusEl, alertEl, resultEl, doc: document, performLookup,
      openDatabase: () => { opens += 1; return Promise.resolve({}); },
    });

    await lookup('G0TQK');
    await lookup('M7TEE');

    // The memoised open is paid once; the second search reuses the warm database.
    expect(opens).toBe(1);
    expect(performLookup).toHaveBeenCalledTimes(2);
    // A miss leaves the honest resolved-status message (the miss callout itself is
    // rendered into #miss by the lookup runner, exercised in ledger.test.ts).
    expect(statusEl.textContent).toContain('No observation for M7TEE');
  });
});
