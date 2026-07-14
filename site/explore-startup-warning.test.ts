// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// The inline timer script embedded in explore.html, extracted so the behaviour
// is tested against the shipped markup rather than a copy of it. Only the inline
// <script> (no src attribute) matches; the module/vendor tags are <script src>.
function inlineTimerScript(): string {
  const html = fs.readFileSync(path.join('site', 'explore.html'), 'utf8');
  const m = html.match(/<script>([\s\S]*?__exploreReadyTimer[\s\S]*?)<\/script>/);
  if (m === null) throw new Error('startup-warning timer script not found in explore.html');
  return m[1];
}

interface ExploreWindow { __exploreReadyTimer?: ReturnType<typeof setTimeout>; }
function readyWindow(): ExploreWindow { return window as unknown as ExploreWindow; }
const warning = (): HTMLElement | null => document.getElementById('startup-warning');

describe('explore startup warning behaviour', { tags: ['ui'] }, () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="startup-warning" hidden></div>';
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    delete readyWindow().__exploreReadyTimer;
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
    // explore.js clears the timer on successful init, so a normal load never flashes.
    new Function(inlineTimerScript())();
    clearTimeout(readyWindow().__exploreReadyTimer);
    vi.advanceTimersByTime(10000);
    const after = warning();
    expect(after !== null && after.hidden).toBe(true);
  });
});

describe('explore startup warning wiring', { tags: ['ui'] }, () => {
  const exploreHtml = fs.readFileSync(path.join('site', 'explore.html'), 'utf8');
  const exploreJs = fs.readFileSync(path.join('site', 'explore.js'), 'utf8');

  it('ExplorePage_HasHiddenStartupWarningAndKeepsNoscript', () => {
    // Hidden by default (no flash); the <noscript> still covers JS being off.
    expect(exploreHtml).toMatch(/id="startup-warning"[^>]*hidden/);
    expect(exploreHtml).toContain('<noscript>');
  });

  it('ExploreModule_OnSuccessfulInit_ClearsTheStartupWarningTimer', () => {
    expect(exploreJs).toContain('clearTimeout(window.__exploreReadyTimer)');
  });
});
