// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// The inline timer script embedded in index.html, extracted so the behaviour is
// tested against the shipped markup rather than a copy of it. Only the inline
// <script> (no src attribute) matches; the module/vendor tags are <script src>.
function inlineTimerScript(): string {
  const html = fs.readFileSync(path.join('site', 'index.html'), 'utf8');
  const m = html.match(/<script>([\s\S]*?__lookupReadyTimer[\s\S]*?)<\/script>/);
  if (m === null) throw new Error('startup-warning timer script not found in index.html');
  return m[1];
}

interface LookupWindow { __lookupReadyTimer?: ReturnType<typeof setTimeout>; }
function readyWindow(): LookupWindow { return window as unknown as LookupWindow; }
const warning = (): HTMLElement | null => document.getElementById('startup-warning');

describe('startup warning behaviour', { tags: ['ui'] }, () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="startup-warning" hidden></div>';
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    delete readyWindow().__lookupReadyTimer;
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
    // app.js clears the timer on successful init, so a normal load never flashes.
    new Function(inlineTimerScript())();
    clearTimeout(readyWindow().__lookupReadyTimer);
    vi.advanceTimersByTime(10000);
    const after = warning();
    expect(after !== null && after.hidden).toBe(true);
  });
});

describe('startup warning wiring', { tags: ['ui'] }, () => {
  const index = fs.readFileSync(path.join('site', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join('site', 'app.js'), 'utf8');

  it('IndexPage_HasHiddenStartupWarningAndKeepsNoscript', () => {
    // Hidden by default (no flash); the <noscript> still covers JS being off.
    expect(index).toMatch(/id="startup-warning"[^>]*hidden/);
    expect(index).toContain('<noscript>');
  });

  it('AppModule_OnSuccessfulInit_ClearsTheStartupWarningTimer', () => {
    expect(app).toContain('clearTimeout(window.__lookupReadyTimer)');
  });

  it('AppModule_HonoursCallsignParamAsAliasForC', () => {
    // A native form submit (module unavailable) produces ?callsign=; a reload
    // once scripts are back must recover the lookup, treating it like ?c=.
    expect(app).toMatch(/get\('c'\)\s*\?\?\s*initialParams\.get\('callsign'\)/);
    expect(app).toContain("k !== 'c' && k !== 'callsign'");
  });
});
