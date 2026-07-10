// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// The inline timer script embedded in compare.html, extracted so the behaviour
// is tested against the shipped markup rather than a copy of it. Only the inline
// <script> (no src attribute) matches; the module/vendor tags are <script src>.
function inlineTimerScript(): string {
  const html = fs.readFileSync(path.join('site', 'compare.html'), 'utf8');
  const m = html.match(/<script>([\s\S]*?__compareReadyTimer[\s\S]*?)<\/script>/);
  if (m === null) throw new Error('startup-warning timer script not found in compare.html');
  return m[1];
}

interface CompareWindow { __compareReadyTimer?: ReturnType<typeof setTimeout>; }
function readyWindow(): CompareWindow { return window as unknown as CompareWindow; }
const warning = (): HTMLElement | null => document.getElementById('startup-warning');

describe('compare startup warning behaviour', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="startup-warning" hidden></div>';
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    delete readyWindow().__compareReadyTimer;
  });

  it('StartupWarning_WhenModuleNeverSignalsReady_IsRevealedAfterTimeout', () => {
    // JavaScript is on (this inline script runs) but no module cleared the timer.
    new Function(inlineTimerScript())();
    const before = warning();
    expect(before !== null && before.hidden).toBe(true);
    vi.advanceTimersByTime(6000);
    const after = warning();
    expect(after !== null && after.hidden).toBe(false);
  });

  it('StartupWarning_WhenReadyTimerClearedByModule_StaysHidden', () => {
    // compare.js clears the timer on successful init, so a normal load never flashes.
    new Function(inlineTimerScript())();
    clearTimeout(readyWindow().__compareReadyTimer);
    vi.advanceTimersByTime(10000);
    const after = warning();
    expect(after !== null && after.hidden).toBe(true);
  });
});

describe('compare startup warning wiring', () => {
  const compareHtml = fs.readFileSync(path.join('site', 'compare.html'), 'utf8');
  const compareJs = fs.readFileSync(path.join('site', 'compare.js'), 'utf8');

  it('ComparePage_HasHiddenStartupWarningAndKeepsNoscript', () => {
    // Hidden by default (no flash); the <noscript> still covers JS being off.
    expect(compareHtml).toMatch(/id="startup-warning"[^>]*hidden/);
    expect(compareHtml).toContain('<noscript>');
  });

  it('CompareModule_OnSuccessfulInit_ClearsTheStartupWarningTimer', () => {
    expect(compareJs).toContain('clearTimeout(window.__compareReadyTimer)');
  });
});
