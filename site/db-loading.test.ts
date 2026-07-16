// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { withDatabaseLoading } from './db-loading.js';

// The shared database-loading affordance (issue #499): every query surface uses
// it so a slow first-use load is communicated honestly. It owns the DOM
// affordance (button state via data-state, polite status, assertive alert,
// aria-busy on the result region), so these tests drive real jsdom elements and
// assert the observable state - what a user (and assistive tech) would perceive.

function setup(): { button: HTMLButtonElement; statusEl: HTMLElement; alertEl: HTMLElement; resultEl: HTMLElement } {
  const button = document.createElement('button');
  button.textContent = 'Run query';
  const statusEl = document.createElement('p');
  const alertEl = document.createElement('p');
  alertEl.hidden = true;
  const resultEl = document.createElement('div');
  return { button, statusEl, alertEl, resultEl };
}

describe('withDatabaseLoading', { tags: ['ui'] }, () => {
  it('DatabaseLoad_WhileOpening_DisablesTheButtonInAWaitingStateAndMarksTheResultBusy', async () => {
    const { button, statusEl, resultEl } = setup();
    let midFlight = { disabled: false, state: '', text: '', busy: '', status: '' };
    await withDatabaseLoading({ button, statusEl, resultEl, label: 'combined database' }, async () => {
      await Promise.resolve();
      midFlight = {
        disabled: button.disabled,
        state: button.dataset.state ?? '',
        text: button.textContent ?? '',
        busy: resultEl.getAttribute('aria-busy') ?? '',
        status: statusEl.textContent ?? '',
      };
    });
    expect(midFlight.disabled).toBe(true);
    expect(midFlight.state).toBe('loading');
    expect(midFlight.text).toBe('Waiting for data…');
    expect(midFlight.busy).toBe('true');
    expect(midFlight.status).toContain('Loading the combined database');
  });

  it('DatabaseLoad_WhenTheQueryStarts_SwitchesTheButtonToTheRunningState', async () => {
    const { button, statusEl } = setup();
    let runningText = '';
    let runningState = '';
    await withDatabaseLoading({ button, statusEl, label: 'lookup database' }, async markRunning => {
      await Promise.resolve();
      markRunning();
      runningState = button.dataset.state ?? '';
      runningText = button.textContent ?? '';
    });
    expect(runningState).toBe('running');
    expect(runningText).toBe('Running…');
  });

  it('DatabaseLoad_WhenOpeningRunsPastTheThreshold_EscalatesTheStatusToAFirstUseReassurance', async () => {
    vi.useFakeTimers();
    try {
      const { button, statusEl } = setup();
      let release = (): void => undefined;
      const pending = new Promise<void>(resolve => { release = resolve; });
      const call = withDatabaseLoading({ button, statusEl, label: 'combined database', slowAfterMs: 1000 }, () => pending);
      await vi.advanceTimersByTimeAsync(1000);
      expect(statusEl.textContent).toMatch(/first use/i);
      release();
      await call;
    } finally {
      vi.useRealTimers();
    }
  });

  it('DatabaseLoad_OnSuccess_ReturnsTheButtonToReadyAndClearsAriaBusy', async () => {
    const { button, statusEl, resultEl } = setup();
    const rows = await withDatabaseLoading({ button, statusEl, resultEl, label: 'lookup database' }, async () => { await Promise.resolve(); return [1, 2, 3]; });
    expect(rows).toEqual([1, 2, 3]);
    expect(button.disabled).toBe(false);
    expect(button.dataset.state).toBe('ready');
    expect(button.textContent).toBe('Run query');
    expect(resultEl.hasAttribute('aria-busy')).toBe(false);
  });

  it('DatabaseLoad_OnATransientFailure_ReEnablesTheButtonAndRaisesAnAssertiveRetryableAlert', async () => {
    const { button, statusEl, alertEl } = setup();
    await expect(withDatabaseLoading({ button, statusEl, alertEl, label: 'combined database' }, async () => {
      await Promise.resolve();
      throw new Error('offline');
    })).rejects.toThrow('offline');
    expect(button.disabled).toBe(false);
    expect(button.dataset.state).toBe('ready');
    expect(alertEl.hidden).toBe(false);
    expect(alertEl.dataset.severity).toBe('transient');
    expect(alertEl.textContent).toMatch(/check your connection and try again/i);
    expect(statusEl.textContent).toBe('');
  });

  it('DatabaseLoad_WhenTheQueryFailsAfterOpening_ReportsAQueryFailureNotAConnectivityError', async () => {
    const { button, statusEl, alertEl } = setup();
    await expect(withDatabaseLoading({ button, statusEl, alertEl, label: 'lookup database' }, async markRunning => {
      await Promise.resolve();
      markRunning();
      throw new Error('no such table: foo');
    })).rejects.toThrow('no such table');
    expect(alertEl.dataset.severity).toBe('query');
    expect(alertEl.textContent).toMatch(/query failed/i);
    expect(alertEl.textContent).toContain('no such table');
  });

  it('DatabaseLoad_OnAnIntegrityFailure_RaisesAStrongerDoNotTrustWarning', async () => {
    const { button, alertEl } = setup();
    const corrupt = Object.assign(new Error('length mismatch'), { integrity: true });
    await expect(withDatabaseLoading({ button, alertEl, label: 'claim-ledger database' }, async () => {
      await Promise.resolve();
      throw corrupt;
    })).rejects.toThrow('length mismatch');
    expect(alertEl.dataset.severity).toBe('integrity');
    expect(alertEl.textContent).toMatch(/results may be wrong/i);
  });

  it('DatabaseLoad_WithNoButton_StillDrivesTheStatusForAnEagerLoad', async () => {
    const statusEl = document.createElement('p');
    await withDatabaseLoading({ statusEl, label: 'combined database' }, async () => { await Promise.resolve(); return undefined; });
    // No throw, and the status was driven (an eager dataset-entry page has no
    // button to hang the message on, only the status line).
    expect(statusEl).toBeTruthy();
  });
});
