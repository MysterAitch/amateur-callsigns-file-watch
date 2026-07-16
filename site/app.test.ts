// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { makeRunLookup, registerHistoryHeader } from './app.js';

// The lookup page routes its PRIMARY database open + query through the shared
// loading affordance (issues #499/#506), exactly as Explore and the Playground
// console do. app.js is otherwise a side-effect bootstrap module, so it exports
// makeRunLookup - the affordance-wrapped runner, dependency-injected - and these
// tests drive it against the page's REAL markup with a controlled opener,
// asserting what a user (and assistive tech) would perceive the instant Look up
// is pressed, and when a load or query fails. Importing app.js opens no worker:
// its browser bootstrap is guarded on createDbWorker, absent under jsdom.

// The lookup section straight from the shipped index.html, so the test drives the
// actual #lookup-form button, #lookup-status, #lookup-alert and #result the page
// renders - not a hand-copied stand-in that could drift from what deploys.
function lookupHost(): {
  button: HTMLButtonElement;
  statusEl: HTMLElement;
  alertEl: HTMLElement;
  resultEl: HTMLElement;
} {
  const html = fs.readFileSync(path.join('site', 'index.html'), 'utf8');
  const start = html.indexOf('<section class="panel" id="lookup">');
  const end = html.indexOf('</section>', start) + '</section>'.length;
  if (start === -1) throw new Error('lookup section not found in index.html');
  document.body.innerHTML = html.slice(start, end);
  const form = document.getElementById('lookup-form');
  const button = form?.querySelector('button[type="submit"]') ?? null;
  const statusEl = document.getElementById('lookup-status');
  const alertEl = document.getElementById('lookup-alert');
  const resultEl = document.getElementById('result');
  if (!(button instanceof HTMLButtonElement) || statusEl === null || alertEl === null || resultEl === null) {
    throw new Error('lookup affordance elements missing from index.html');
  }
  return { button, statusEl, alertEl, resultEl };
}

describe('lookup loading affordance', { tags: ['ui'] }, () => {
  it('Lookup_WhileTheDatabaseOpens_DisablesLookUpInAWaitingStateAndMarksResultBusy', async () => {
    const { button, statusEl, alertEl, resultEl } = lookupHost();
    // An opener held shut, so the interval between pressing Look up and the open
    // completing is observable: the user must already see the wait.
    let release: (() => void) | undefined;
    const opened = new Promise<void>(resolve => { release = resolve; });
    const runLookup = makeRunLookup({
      button, statusEl, alertEl, resultEl,
      open: () => opened,
      lookup: async () => { await Promise.resolve(); return undefined; },
    });

    const pending = runLookup({});
    // Synchronously after the press - before the database has opened - Look up is
    // disabled and shows the waiting label, and the result region reads busy.
    expect(button.disabled).toBe(true);
    expect(button.dataset.state).toBe('loading');
    expect(button.textContent).toBe('Waiting for data…');
    expect(resultEl.getAttribute('aria-busy')).toBe('true');
    expect(statusEl.textContent).toContain('Loading the lookup database');

    release?.();
    await pending;
    // On success the button returns to its ready label and the busy flag clears.
    expect(button.disabled).toBe(false);
    expect(button.dataset.state).toBe('ready');
    expect(button.textContent).toBe('Look up');
    expect(resultEl.hasAttribute('aria-busy')).toBe(false);
    expect(alertEl.hidden).toBe(true);
  });

  it('Lookup_WhenTheQueryStartsAfterOpening_SwitchesLookUpToTheRunningState', async () => {
    const { button, statusEl, alertEl, resultEl } = lookupHost();
    let runningState = '';
    let runningText = '';
    const runLookup = makeRunLookup({
      button, statusEl, alertEl, resultEl,
      open: () => Promise.resolve(),
      // lookup runs only after markRunning(), so the button is in its running
      // state by the time the query renders.
      lookup: async () => {
        await Promise.resolve();
        runningState = button.dataset.state ?? '';
        runningText = button.textContent ?? '';
      },
    });
    await runLookup({});
    expect(runningState).toBe('running');
    expect(runningText).toBe('Running…');
  });

  it('Lookup_WhenTheDatabaseCannotBeLoaded_RaisesTheAssertiveAlertAndOffersTheDatasets', async () => {
    const { button, statusEl, alertEl, resultEl } = lookupHost();
    const runLookup = makeRunLookup({
      button, statusEl, alertEl, resultEl,
      open: () => Promise.reject(new Error('offline')),
      lookup: async () => { await Promise.resolve(); return undefined; },
    });
    // makeRunLookup swallows the rethrow (fail-loud is delegated to the alert), so
    // the runner resolves rather than rejecting.
    await runLookup({});
    expect(alertEl.hidden).toBe(false);
    expect(alertEl.dataset.severity).toBe('transient');
    expect(alertEl.textContent).toMatch(/check your connection and try again/i);
    // Look up is retryable again, and the result region carries the datasets escape
    // hatch - but no SECOND role="alert", so the failure is announced once only.
    expect(button.disabled).toBe(false);
    expect(button.dataset.state).toBe('ready');
    expect(resultEl.querySelector('[role="alert"]')).toBeNull();
    expect(resultEl.textContent).toMatch(/browse the datasets/i);
  });

  it('Lookup_WhenTheQueryFailsAfterOpening_ReportsAQueryFailureNotAConnectivityError', async () => {
    const { button, statusEl, alertEl, resultEl } = lookupHost();
    const runLookup = makeRunLookup({
      button, statusEl, alertEl, resultEl,
      open: () => Promise.resolve(),
      // The database opened, so a thrown query error is reported as such, not as a
      // connectivity failure.
      lookup: async () => { await Promise.resolve(); throw new Error('no such table: normalised'); },
    });
    await runLookup({});
    expect(alertEl.hidden).toBe(false);
    expect(alertEl.dataset.severity).toBe('query');
    expect(alertEl.textContent).toMatch(/query failed/i);
    expect(alertEl.textContent).toContain('no such table');
  });
});

describe('register-history multi-callsign header (#594)', { tags: ['ui'] }, () => {
  it('RegisterHistoryHeader_WhenRenderingACallsign_LinksToTheCanonicalPerCallsignPage', () => {
    // The register-history card shows this bolded header row above each
    // callsign's own block of publications only when more than one callsign is
    // in play (e.g. an as-typed value alongside its resolved register row) -
    // it must link to that callsign's own canonical page, not just repeat it
    // as inert text.
    const header = registerHistoryHeader('M7TEE');
    expect(header.tagName).toBe('STRONG');
    const link = header.querySelector('a');
    expect(link?.getAttribute('href')).toBe('callsign.html?c=M7TEE');
    expect(link?.textContent).toBe('M7TEE');
  });

  it('RegisterHistoryHeader_AccessibleName_IsTheBareCallsign', () => {
    // Non-happy-path guard: an unusual (lowercase, over-long) callsign must
    // still surface as the link's own visible/accessible text, unaltered.
    const header = registerHistoryHeader('gb100abcde');
    expect(header.querySelector('a')?.textContent).toBe('gb100abcde');
  });
});
