import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import * as fs from 'fs';
import * as path from 'path';

const SRC = fs.readFileSync(path.join('site', 'debug.js'), 'utf8');

// Load debug.js into a fresh JSDOM at the given URL, with any pre-seeded
// localStorage, and return the window so tests can inspect the DOM it builds.
// runScripts: 'outside-only' gives a working window.eval without executing page
// <script> tags — we inject the source the same way the browser loads it,
// before the ES modules. Each call is fully isolated (its own window/console/
// localStorage), so the console patching cannot leak between tests.
function load(url: string, storage: Record<string, string> = {}): Window & typeof globalThis {
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', {
    url,
    runScripts: 'outside-only',
  });
  const win = dom.window as unknown as Window & typeof globalThis;
  for (const [k, v] of Object.entries(storage)) win.localStorage.setItem(k, v);
  win.eval(SRC);
  return win;
}

function toggleButton(win: Window): Element | null {
  return win.document.querySelector('button[aria-label="Toggle debug console"]');
}

describe('on-screen debug console', () => {
  it('DebugConsole_WhenDebugParamEnabled_ShowsToggleAndPersistsFlag', () => {
    const win = load('https://example.org/?debug=1');
    expect(toggleButton(win)).not.toBeNull();
    // Persisted so it survives the next navigation without the query string.
    expect(win.localStorage.getItem('callsign-debug')).toBe('1');
  });

  it('DebugConsole_WhenNoParamAndNoStoredFlag_StaysHidden', () => {
    const win = load('https://example.org/');
    expect(toggleButton(win)).toBeNull();
  });

  it('DebugConsole_WhenStoredFlagFromEarlierPage_ActivatesWithoutParam', () => {
    // The deep-link case: enabled once, then a bare URL keeps it on.
    const win = load('https://example.org/', { 'callsign-debug': '1' });
    expect(toggleButton(win)).not.toBeNull();
  });

  it('DebugConsole_WhenDebugParamZero_ClearsStoredFlagAndStaysHidden', () => {
    const win = load('https://example.org/?debug=0', { 'callsign-debug': '1' });
    expect(toggleButton(win)).toBeNull();
    expect(win.localStorage.getItem('callsign-debug')).toBeNull();
  });

  it('DebugConsole_WhenActive_CapturesConsoleErrorsOnScreen', () => {
    const win = load('https://example.org/?debug=1');
    (win.console.error as (...a: unknown[]) => void)('BOOM_DIAGNOSTIC');
    expect(win.document.body.textContent).toContain('BOOM_DIAGNOSTIC');
  });

  it('DebugConsole_WhenActive_CapturesFailedResourceLoads', () => {
    const win = load('https://example.org/?debug=1');
    // The exact failure that took the lookup down: an error event whose target
    // is an element with a src, which does not bubble and carries no message.
    const el = win.document.createElement('script');
    (el as HTMLScriptElement).src = 'https://example.org/prefix-country.js';
    const ev = new win.Event('error');
    Object.defineProperty(ev, 'target', { value: el });
    win.dispatchEvent(ev);
    expect(win.document.body.textContent).toContain('prefix-country.js');
  });
});
