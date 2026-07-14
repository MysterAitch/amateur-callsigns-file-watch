// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { JSDOM } from 'jsdom';
import { parseLedgerParams, ledgerSearchUrl, wireLedgerSearch } from './ledger.js';

// The Ledger lookup is deep-linkable (issues #440/#333/#397): a search writes
// ?c=<callsign> to the URL so it is shareable/copyable, and back/forward step
// between searches. These tests pin the user-facing contract without a database
// worker (mirroring the Explore/Compare deep-link tests, #420): a search puts
// the resolved callsign in ?c=; a load with ?c=/?callsign= pre-runs the lookup;
// popstate re-runs for the URL's callsign; and a malformed/blank param degrades
// to the sample chip without throwing and never reaches the DOM as markup. Test
// names follow Subject_Scenario_Outcome.

// A fresh JSDOM carrying the page's real search markup (form, chips, status),
// so the wiring runs against the actual #lookup-form / #resolver / #callsign-input.
const LEDGER_HTML = fs.readFileSync(path.join('site', 'ledger.html'), 'utf8');
const MAIN = LEDGER_HTML.slice(LEDGER_HTML.indexOf('<main'), LEDGER_HTML.indexOf('</main>') + '</main>'.length);

function makeDom(search = '') {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${MAIN}</body></html>`, {
    url: `https://example.test/ledger.html${search}`,
  });
  return { win: dom.window, doc: dom.window.document };
}

describe('parseLedgerParams', { tags: ['ui'] }, () => {
  it('LedgerParams_WhenC_IsReturnedUpperCased', () => {
    expect(parseLedgerParams(new URLSearchParams('c=g0tqk'))).toEqual({ callsign: 'G0TQK' });
  });
  it('LedgerParams_WhenLegacyCallsignAlias_IsHonoured', () => {
    // Align with the Lookup page's `params.get('c') ?? params.get('callsign')`,
    // so an older ?callsign= link still opens the lookup.
    expect(parseLedgerParams(new URLSearchParams('callsign=M7TEE'))).toEqual({ callsign: 'M7TEE' });
  });
  it('LedgerParams_WhenBothPresent_PrefersC', () => {
    expect(parseLedgerParams(new URLSearchParams('c=G0TQK&callsign=M7TEE'))).toEqual({ callsign: 'G0TQK' });
  });
  it('LedgerParams_WhenBlankOrAbsent_IsNull', () => {
    expect(parseLedgerParams(new URLSearchParams('c=%20%20')).callsign).toBeNull();
    expect(parseLedgerParams(new URLSearchParams('')).callsign).toBeNull();
  });
});

describe('ledgerSearchUrl', { tags: ['ui'] }, () => {
  it('LedgerSearchUrl_WhenGivenCallsign_ReducesQueryToC', () => {
    expect(ledgerSearchUrl('https://example.test/ledger.html', 'M7TEE'))
      .toBe('https://example.test/ledger.html?c=M7TEE');
  });
  it('LedgerSearchUrl_WhenUrlAlreadyHasQueryAndHash_ReplacesQueryKeepsHash', () => {
    expect(ledgerSearchUrl('https://example.test/ledger.html?c=OLD#anatomy', 'G0TQK'))
      .toBe('https://example.test/ledger.html?c=G0TQK#anatomy');
  });
});

describe('wireLedgerSearch (state <-> URL round-trip)', { tags: ['ui'] }, () => {
  it('LedgerSearch_WhenFormSubmitted_PutsResolvedCallsignInUrlQuery', () => {
    const { win, doc } = makeDom();
    const runSearch = vi.fn(() => Promise.resolve());
    const push = vi.spyOn(win.history, 'pushState');
    wireLedgerSearch({ doc, win, runSearch });
    runSearch.mockClear();
    push.mockClear();

    const input = doc.getElementById('callsign-input') as HTMLInputElement;
    input.value = 'm7tee'; // typed lower-case; canonicalised to upper-case
    const form = doc.getElementById('lookup-form') as HTMLFormElement;
    form.dispatchEvent(new win.Event('submit', { cancelable: true, bubbles: true }));

    expect(runSearch).toHaveBeenCalledWith('M7TEE');
    expect(win.location.search).toBe('?c=M7TEE');
    expect(push).toHaveBeenCalledOnce(); // a user search adds a Back-able entry
  });

  it('LedgerSearch_WhenSampleChipClicked_PutsThatCallsignInUrlQuery', () => {
    const { win, doc } = makeDom();
    const runSearch = vi.fn(() => Promise.resolve());
    wireLedgerSearch({ doc, win, runSearch });
    runSearch.mockClear();

    const chip = doc.querySelector('#resolver .chip[data-cs="M7TEE"]') as HTMLButtonElement;
    chip.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));

    expect(runSearch).toHaveBeenCalledWith('M7TEE');
    expect(win.location.search).toBe('?c=M7TEE');
  });

  it('LedgerSearch_WhenLoadedWithCParam_PreRunsTheLookup', () => {
    const { win, doc } = makeDom('?c=g0tqk');
    const runSearch = vi.fn(() => Promise.resolve());
    const replace = vi.spyOn(win.history, 'replaceState');
    const push = vi.spyOn(win.history, 'pushState');
    wireLedgerSearch({ doc, win, runSearch });

    expect(runSearch).toHaveBeenCalledWith('G0TQK');
    expect((doc.getElementById('callsign-input') as HTMLInputElement).value).toBe('G0TQK');
    // The initial deep link normalises the URL with replaceState, so it adds no
    // spurious history entry.
    expect(replace).toHaveBeenCalledOnce();
    expect(push).not.toHaveBeenCalled();
  });

  it('LedgerSearch_WhenLoadedWithLegacyCallsignParam_PreRunsTheLookup', () => {
    const { win, doc } = makeDom('?callsign=M7TEE');
    const runSearch = vi.fn(() => Promise.resolve());
    wireLedgerSearch({ doc, win, runSearch });

    expect(runSearch).toHaveBeenCalledWith('M7TEE');
    expect(win.location.search).toBe('?c=M7TEE'); // normalised onto the canonical key
  });

  it('LedgerSearch_WhenNoParam_FallsBackToFirstSampleChip', () => {
    const { win, doc } = makeDom();
    const runSearch = vi.fn(() => Promise.resolve());
    wireLedgerSearch({ doc, win, runSearch });

    expect(runSearch).toHaveBeenCalledWith('G0TQK'); // the first sample chip
  });

  it('LedgerSearch_WhenBackForwardNavigates_ReRunsForTheUrlsCallsign', () => {
    const { win, doc } = makeDom('?c=G0TQK');
    const runSearch = vi.fn(() => Promise.resolve());
    wireLedgerSearch({ doc, win, runSearch });

    // Simulate the browser restoring an earlier entry: the URL is already the
    // target when popstate fires.
    win.history.replaceState(null, '', 'https://example.test/ledger.html?c=M7TEE');
    runSearch.mockClear();
    const push = vi.spyOn(win.history, 'pushState');
    win.dispatchEvent(new win.PopStateEvent('popstate'));

    expect(runSearch).toHaveBeenCalledWith('M7TEE');
    expect(push).not.toHaveBeenCalled(); // a restore must not add a new entry
  });

  it('LedgerSearch_WhenBackReachesBareUrl_FallsBackToFirstSampleChip', () => {
    const { win, doc } = makeDom('?c=M7TEE');
    const runSearch = vi.fn(() => Promise.resolve());
    wireLedgerSearch({ doc, win, runSearch });

    win.history.replaceState(null, '', 'https://example.test/ledger.html');
    runSearch.mockClear();
    win.dispatchEvent(new win.PopStateEvent('popstate'));

    expect(runSearch).toHaveBeenCalledWith('G0TQK');
  });

  it('LedgerSearch_WhenParamIsBlank_DegradesToSampleChipWithoutThrowing', () => {
    const { win, doc } = makeDom('?c=%20%20');
    const runSearch = vi.fn(() => Promise.resolve());
    expect(() => wireLedgerSearch({ doc, win, runSearch })).not.toThrow();
    expect(runSearch).toHaveBeenCalledWith('G0TQK'); // the sample-chip fallback
  });

  it('LedgerSearch_WhenParamCarriesHtml_SetsItAsInputValueNeverMarkup', () => {
    // A hostile ?c= is written to the input's value (and percent-encoded back
    // into the URL), so a '<' in a shared link is shown literally and can never
    // inject a node into the page.
    const hostile = "<img src=x onerror=alert(1)>";
    const { win, doc } = makeDom(`?c=${encodeURIComponent(hostile)}`);
    const runSearch = vi.fn(() => Promise.resolve());
    expect(() => wireLedgerSearch({ doc, win, runSearch })).not.toThrow();

    expect((doc.getElementById('callsign-input') as HTMLInputElement).value).toBe(hostile.toUpperCase());
    expect(doc.querySelector('img')).toBeNull();
    expect(runSearch).toHaveBeenCalledWith(hostile.toUpperCase());
  });
});
