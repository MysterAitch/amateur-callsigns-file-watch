// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  cleanQuery, readRecents, pushRecent, nextSurpriseIndex, readoutText,
  attachSearch, renderRecents, wireTabs, SURPRISES,
} from './home.js';

// Test names follow Subject_Scenario_Outcome. These exercise the front-door
// enhancement (issue #712) as a user experiences it: the type-ahead's
// fill-then-submit, the returning-visitor chips, the surprise rotation, the
// holdings readout and the accessible tabs — the behaviours that layer over the
// static, JavaScript-off baseline app.js and the deploy-time build already
// provide.

// This jsdom configuration ships no Storage, so an in-memory stand-in is
// installed per test — the recents affordance's contract (dedupe, cap, resume)
// is what matters here, not the browser's own Storage implementation.
beforeEach(() => {
  document.body.innerHTML = '';
  const store = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => (store.has(k) ? store.get(k) : null),
      setItem: (k: string, v: string) => { store.set(k, String(v)); },
      removeItem: (k: string) => { store.delete(k); },
      clear: () => { store.clear(); },
    },
  });
});

describe('cleanQuery (issue #712)', { tags: ['unit'] }, () => {
  it('CleanQuery_MixedInput_UpperCasesAndKeepsOnlyCallsignCharacters', () => {
    expect(cleanQuery(' m7tee ')).toBe('M7TEE');
    expect(cleanQuery('m#7tee')).toBe('M#7TEE');
    expect(cleanQuery('*tee')).toBe('*TEE');
    expect(cleanQuery('m7-tee!')).toBe('M7TEE');
    expect(cleanQuery(null)).toBe('');
  });
});

describe('Returning-visitor recents (issue #712)', { tags: ['ui'] }, () => {
  it('PushRecent_RepeatedAndWildcardLookups_DedupesNewestFirstAndSkipsWildcards', () => {
    pushRecent('m7tee');
    pushRecent('2e0aaa');
    pushRecent('M7TEE'); // same callsign again — moves to front, not duplicated
    expect(readRecents()).toEqual(['M7TEE', '2E0AAA']);
    // A wildcard/filter expression is not a callsign to resume.
    pushRecent('*TEE');
    expect(readRecents()).toEqual(['M7TEE', '2E0AAA']);
  });

  it('PushRecent_ManyLookups_IsCappedAtEight', () => {
    for (const c of ['A1AA', 'A2AA', 'A3AA', 'A4AA', 'A5AA', 'A6AA', 'A7AA', 'A8AA', 'A9AA']) pushRecent(c);
    expect(readRecents()).toHaveLength(8);
    expect(readRecents()[0]).toBe('A9AA'); // newest first
  });

  it('RenderRecents_BeforeAnyLookup_ShowsAnExampleStateWithResumeLinks', () => {
    const container = document.createElement('div');
    renderRecents(container);
    expect(container.hidden).toBe(false);
    expect(container.textContent).toContain('example');
    // The example chips resume via the ?c= deep-link the lookup reads.
    const chip = container.querySelector('a.jb-chip');
    expect(chip?.getAttribute('href')).toMatch(/^\?c=/);
  });

  it('RenderRecents_AfterLookups_ListsThemAsResumeLinksWithoutTheExampleNote', () => {
    pushRecent('M7TEE');
    const container = document.createElement('div');
    renderRecents(container);
    expect(container.textContent).not.toContain('example');
    expect(container.querySelector('a.jb-chip')?.getAttribute('href')).toBe('?c=M7TEE');
  });
});

describe('Surprise rotation (issue #712)', { tags: ['unit'] }, () => {
  it('NextSurpriseIndex_AtTheEndOfTheDeck_WrapsToTheStart', () => {
    expect(nextSurpriseIndex(0, SURPRISES.length)).toBe(1);
    expect(nextSurpriseIndex(SURPRISES.length - 1, SURPRISES.length)).toBe(0);
    expect(nextSurpriseIndex(0, 0)).toBe(0);
  });
});

describe('Holdings-map readout (issue #712)', { tags: ['unit'] }, () => {
  it('ReadoutText_ADatasetCell_ReadsKindTitleVintageAndRowCount', () => {
    expect(readoutText({ kindLabel: 'Register snapshot', title: 'Publication of 23 June 2026', vintage: '23 June 2026', rows: '158,318' }))
      .toBe('Register snapshot · Publication of 23 June 2026 · 23 June 2026 · 158,318 rows');
  });
  it('ReadoutText_ADatasetWithNoTabularData_OmitsTheRowCount', () => {
    expect(readoutText({ kindLabel: 'Context', title: 'A not-held response', vintage: 'March 2022', rows: '' }))
      .toBe('Context · A not-held response · March 2022');
  });
});

// A stub type-ahead source standing in for the app.js database hook.
function stubSuggest(map: Record<string, string[]>): (p: string) => Promise<string[]> {
  return (prefix: string) => Promise.resolve(map[cleanQuery(prefix)] ?? []);
}

function searchHost(): { form: HTMLFormElement; input: HTMLInputElement; list: HTMLElement } {
  document.body.innerHTML = `
    <form id="lookup-form">
      <input id="callsign" role="combobox" aria-expanded="false" aria-controls="suggest">
      <button type="submit">Look up</button>
      <ul id="suggest" role="listbox" hidden></ul>
    </form>`;
  return {
    form: document.getElementById('lookup-form') as HTMLFormElement,
    input: document.getElementById('callsign') as HTMLInputElement,
    list: document.getElementById('suggest') as HTMLElement,
  };
}

async function flush(): Promise<void> { await Promise.resolve(); await Promise.resolve(); }

describe('Search type-ahead (issue #712)', { tags: ['ui'] }, () => {
  it('TypeAhead_TypingAPrefix_OffersRealCallsignSuggestionsAndOpensTheListbox', async () => {
    const { form, input, list } = searchHost();
    attachSearch(form, input, list, stubSuggest({ M7T: ['M7TEE', 'M7TXY'] }));
    input.value = 'M7T';
    input.dispatchEvent(new Event('input'));
    await flush();
    expect(list.hidden).toBe(false);
    expect(input.getAttribute('aria-expanded')).toBe('true');
    expect([...list.querySelectorAll('.sug')].map(o => o.textContent)).toEqual(['M7TEE', 'M7TXY']);
  });

  it('TypeAhead_AWildcardExpression_OffersNoSuggestions', async () => {
    const { form, input, list } = searchHost();
    attachSearch(form, input, list, stubSuggest({ '*TEE': ['should-not-appear'] }));
    input.value = '*TEE';
    input.dispatchEvent(new Event('input'));
    await flush();
    expect(list.hidden).toBe(true);
  });

  it('TypeAhead_ArrowThenEnter_FillsTheBoxAndSubmitsTheLookupInPlace', async () => {
    const { form, input, list } = searchHost();
    let submitted = 0;
    form.addEventListener('submit', (e) => { e.preventDefault(); submitted += 1; });
    attachSearch(form, input, list, stubSuggest({ M7T: ['M7TEE', 'M7TXY'] }));
    input.value = 'M7T';
    input.dispatchEvent(new Event('input'));
    await flush();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(input.getAttribute('aria-activedescendant')).toBe('sug-0');
    // Enter adopts the highlighted suggestion, then the native submit runs the
    // existing in-page lookup (fill-then-submit — never a navigation).
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const submitEvent = new Event('submit', { bubbles: true, cancelable: true });
    form.dispatchEvent(submitEvent);
    expect(input.value).toBe('M7TEE');
    expect(list.hidden).toBe(true);
    expect(submitted).toBe(1);
  });

  it('TypeAhead_SelectingASuggestion_FillsTheBoxAndRequestsSubmit', async () => {
    const { form, input, list } = searchHost();
    const requestSubmit = vi.fn();
    // jsdom does not implement requestSubmit; the module guards on its presence.
    (form as unknown as { requestSubmit: () => void }).requestSubmit = requestSubmit;
    attachSearch(form, input, list, stubSuggest({ M7T: ['M7TEE'] }));
    input.value = 'M7T';
    input.dispatchEvent(new Event('input'));
    await flush();
    const option = list.querySelector('.sug') as HTMLElement;
    option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(input.value).toBe('M7TEE');
    expect(requestSubmit).toHaveBeenCalledOnce();
    expect(list.hidden).toBe(true);
  });

  it('TypeAhead_Escape_ClosesTheListboxWithoutSubmitting', async () => {
    const { form, input, list } = searchHost();
    attachSearch(form, input, list, stubSuggest({ M7T: ['M7TEE'] }));
    input.value = 'M7T';
    input.dispatchEvent(new Event('input'));
    await flush();
    expect(list.hidden).toBe(false);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(list.hidden).toBe(true);
    expect(input.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('Role tabs (issue #712)', { tags: ['ui'] }, () => {
  function tabsHost(): HTMLElement[] {
    document.body.innerHTML = `
      <div class="home-tabs">
        <button class="tab" id="t1" role="tab" aria-controls="p1" aria-selected="true">Reader</button>
        <button class="tab" id="t2" role="tab" aria-controls="p2" aria-selected="false" tabindex="-1">Researcher</button>
      </div>
      <div id="p1"></div>
      <div id="p2" hidden></div>`;
    return [...document.querySelectorAll('.home-tabs .tab')].map(t => t as HTMLElement);
  }

  it('Tabs_SelectingASecondTab_ShowsItsPanelAndHidesTheOthers', () => {
    const tabs = tabsHost();
    wireTabs(tabs);
    tabs[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    expect(tabs[0].getAttribute('aria-selected')).toBe('false');
    expect(document.getElementById('p2')?.hidden).toBe(false);
    expect(document.getElementById('p1')?.hidden).toBe(true);
    // Roving tabindex: only the selected tab is in the tab order.
    expect(tabs[1].tabIndex).toBe(0);
    expect(tabs[0].tabIndex).toBe(-1);
  });

  it('Tabs_ArrowKey_MovesSelectionAndFocusToTheNeighbouringTab', () => {
    const tabs = tabsHost();
    wireTabs(tabs);
    tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tabs[1]);
  });
});

// Narrow-viewport overflow guard (issue #753): a visitor on a phone-width
// screen should never see the front door scroll sideways. jsdom does not lay
// out CSS, so the true "does the page overflow" scenario is verified with a
// real browser at build time; this guard instead pins the CSS contract that
// keeps a headline figure or a derived-build stamp from forcing the page
// wider than its viewport, so a future edit that re-widens the unbreakable
// span fails here rather than shipping a regression silently.
const HOME_CSS = fs.readFileSync(path.join('site', 'home.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

// Matches a bare rule body for the given selector, ignoring any longer
// selector this one is a prefix of (so `.fig` does not also match `.fig b`).
function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.[\]]/g, '\\$&');
  const m = new RegExp(`(?:^|[,}])\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  if (!m) throw new Error(`home.css: no rule found for selector "${selector}"`);
  return m[1] ?? '';
}

describe('Narrow-viewport overflow guards (issue #753)', { tags: ['unit'] }, () => {
  it('HeadlineFigures_TheWholeStatPhrase_IsNotForcedOntoOneUnbreakableLine', () => {
    // Only the numeral may carry the nowrap that keeps a figure like
    // "158,318" from breaking mid-number — its trailing label (e.g.
    // "callsigns in the latest register") must stay free to wrap, or a
    // single long stat overflows a phone-width viewport.
    expect(ruleBody(HOME_CSS, '.home-stats .fig')).not.toMatch(/white-space:\s*nowrap/);
    expect(ruleBody(HOME_CSS, '.home-stats .fig b')).toMatch(/white-space:\s*nowrap/);
    expect(ruleBody(HOME_CSS, '.home .viz-shape .fig')).not.toMatch(/white-space:\s*nowrap/);
    expect(ruleBody(HOME_CSS, '.home .viz-shape .fig b')).toMatch(/white-space:\s*nowrap/);
  });

  it('DerivedStamp_AtPhoneWidths_MayWrapInsteadOfOverflowing', () => {
    // The "derived · at the … build" badge stays on one line everywhere it
    // fits (the padded holdings-map card leaves too little room at the
    // narrowest phone widths), so the narrow media query alone relaxes it.
    const mq = /@media \(max-width:\s*460px\)\s*\{([\s\S]*)\}\s*$/.exec(HOME_CSS);
    expect(mq, 'home.css should carry a max-width: 460px media query').not.toBeNull();
    expect(mq?.[1]).toMatch(/\.home \.derived-stamp\s*\{[^}]*white-space:\s*normal/);
  });
});
