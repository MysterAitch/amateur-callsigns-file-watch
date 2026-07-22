// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  cleanQuery, readRecents, pushRecent, nextSurpriseIndex, readoutText,
  attachSearch, renderRecents, wireTabs, SURPRISES,
  coverageLabel, qualityFlagLine, popoverLines, buildPopover, wireHoldingsPopovers,
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

describe('Surprise-card wording — evidence-window honesty (issue #907)', { tags: ['unit'] }, () => {
  const cardText = SURPRISES.map((s) => `${s.kicker} ${s.title} ${s.body}`).join(' | ');

  it('M2Card_StatesReservedOnlyInEverySnapshotHeld_NotTheUniversalNeverIssued', () => {
    // The held record only reaches back to 2016; "has never been issued" is a
    // universal over all history the snapshots cannot attest, and "a whole
    // prefix series held back" reads one reserved row as series-wide reservation
    // (the availability trap). The card is scoped to what the record shows and
    // points at the M2 series page that carries the one-row basis.
    const m2 = SURPRISES.find((s) => s.title.includes('M2'));
    expect(m2).toBeDefined();
    expect(m2?.title).toContain('reserved-only in every snapshot held');
    expect(m2?.href).toBe('series/M2.html');
    expect(cardText).not.toContain('has never been issued');
    expect(cardText).not.toContain('a whole prefix series held back');
  });

  it('ForbiddenCard_StatesWithholdsFromIssue_NotTheFutureAbsoluteWillNotAllocate', () => {
    // QNF was de-listed and issued after withholding, so "will not allocate" is
    // a future-tense absolute the record itself counterexamples.
    const forbidden = SURPRISES.find((s) => s.title.includes('suffixes'));
    expect(forbidden?.title).toContain('withholds from issue');
    expect(cardText).not.toContain('will not allocate');
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

// The richer per-cell popover (issue #741): a fuller summary than the readout
// line, plus a tap-to-preview-then-navigate touch interaction. These tests
// exercise it as a user experiences it — hover/focus/tap/Escape — against a
// small stand-in for build-front-door.ts's rendered cells; hash-only hrefs so
// a jsdom-dispatched click's native anchor activation never attempts a real
// page navigation (jsdom implements hash changes only), while the exact same
// interception logic under test still runs.
describe('Popover summary content (issue #741)', { tags: ['unit'] }, () => {
  it('CoverageLabel_DeclaredComplete_ReadsDeclaredComplete', () => {
    expect(coverageLabel('complete')).toBe('Declared complete');
  });
  it('CoverageLabel_DeclaredPartial_ReadsDeclaredPartial', () => {
    expect(coverageLabel('partial')).toBe('Declared partial');
  });
  it('CoverageLabel_FieldNotDeclaredOrUnrecognised_ReadsNotDeclared', () => {
    expect(coverageLabel('none')).toBe('Coverage not declared');
    expect(coverageLabel(undefined)).toBe('Coverage not declared');
  });

  it('QualityFlagLine_NoFlags_IsBlank', () => {
    expect(qualityFlagLine('0', 'false')).toBe('');
    expect(qualityFlagLine(undefined, undefined)).toBe('');
  });
  it('QualityFlagLine_OneFlag_ReadsSingular', () => {
    expect(qualityFlagLine('1', 'false')).toBe('1 data-quality flag');
  });
  it('QualityFlagLine_SeveralCoverageAffectingFlags_ReadsPluralWithTheCaveat', () => {
    expect(qualityFlagLine('2', 'true')).toBe('2 data-quality flags · coverage-affecting');
  });

  it('PopoverLines_ADeclaredCompleteDatasetWithNoFlags_ListsTheReadoutThenCoverageOnly', () => {
    expect(popoverLines({
      kindLabel: 'Register snapshot', title: 'Publication of 23 June 2026', vintage: '23 June 2026', rows: '158,318',
      coverage: 'complete', qualityCount: '0', coverageAffecting: 'false',
    })).toEqual([
      'Register snapshot · Publication of 23 June 2026 · 23 June 2026 · 158,318 rows',
      'Declared complete',
    ]);
  });
  it('PopoverLines_ADeclaredPartialDatasetWithCoverageAffectingFlags_AddsTheFlagLine', () => {
    expect(popoverLines({
      kindLabel: 'Register snapshot', title: 'Publication of 14 January 2025', vintage: '14 January 2025', rows: '150,000',
      coverage: 'partial', qualityCount: '2', coverageAffecting: 'true',
    })).toEqual([
      'Register snapshot · Publication of 14 January 2025 · 14 January 2025 · 150,000 rows',
      'Declared partial',
      '2 data-quality flags · coverage-affecting',
    ]);
  });
});

// A minimal stand-in for build-front-door.ts's rendered map cells, carrying
// exactly the data-attributes the popover reads, plus an element outside the
// grid to exercise the outside-click dismissal.
function holdingsMapHost(): { grid: HTMLElement; cellA: HTMLElement; cellB: HTMLElement } {
  document.body.innerHTML = `
    <p id="hold-readout"></p>
    <ol id="hold-grid">
      <li><a class="hold-cell" href="#dataset-a"
        data-key="2026-06-23" data-kind="register-snapshot" data-kind-label="Register snapshot"
        data-title="Publication of 23 June 2026" data-vintage="23 June 2026" data-rows="158,318"
        data-coverage="complete" data-quality="0" data-coverage-affecting="false"><span aria-hidden="true">R</span></a></li>
      <li><a class="hold-cell" href="#dataset-b"
        data-key="2025-01-14" data-kind="register-snapshot" data-kind-label="Register snapshot"
        data-title="Publication of 14 January 2025" data-vintage="14 January 2025" data-rows="150,000"
        data-coverage="partial" data-quality="2" data-coverage-affecting="true"><span aria-hidden="true">R</span></a></li>
    </ol>
    <button id="elsewhere">elsewhere on the page</button>`;
  const grid = document.getElementById('hold-grid') as HTMLElement;
  const [cellA, cellB] = [...grid.querySelectorAll('.hold-cell')] as HTMLElement[];
  return { grid, cellA, cellB };
}

// A pointerdown carrying the given pointer type, mirroring the tap/click
// sequence a real touch or mouse interaction produces (jsdom does not expose a
// PointerEvent constructor with a settable pointerType, so it is defined
// directly on a plain Event — the code under test only ever reads the
// property).
function pointerDown(target: EventTarget, pointerType: string): void {
  const e = new Event('pointerdown', { bubbles: true });
  Object.defineProperty(e, 'pointerType', { value: pointerType, configurable: true });
  target.dispatchEvent(e);
}

// A real pointer-driven click (mouse or touch) — these always carry a
// non-zero `detail` (the native click count), which is exactly what
// distinguishes them from a keyboard activation below.
function fireClick(target: EventTarget): MouseEvent {
  const e = new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 });
  target.dispatchEvent(e);
  return e;
}

// A keyboard-triggered activation (Enter/Space on a focused element): the
// browser dispatches this with `detail: 0`, never a real pointer count, which
// is the signal the click handler uses to let keyboard navigation through
// unconditionally.
function fireKeyboardClick(target: EventTarget): MouseEvent {
  const e = new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 });
  target.dispatchEvent(e);
  return e;
}

// The popover is inserted as the cell's next sibling by wireHoldingsPopovers.
function popoverOf(cell: HTMLElement): HTMLElement {
  const pop = cell.nextElementSibling;
  if (!(pop instanceof HTMLElement) || !pop.classList.contains('hold-pop')) throw new Error('expected a popover sibling');
  return pop;
}

describe('Popover DOM shape (issue #741)', { tags: ['ui'] }, () => {
  it('BuildPopover_ADeclaredPartialCellWithFlags_ProducesAnAccessibleGroupWithAnOpenDatasetLink', () => {
    const { cellB } = holdingsMapHost();
    const pop = buildPopover(cellB);
    expect(pop.getAttribute('role')).toBe('group');
    expect(pop.hidden).toBe(true); // hidden until wireHoldingsPopovers opens it
    const head = pop.querySelector('.hold-pop-head');
    expect(head?.id).toBe(pop.getAttribute('aria-labelledby'));
    expect(head?.textContent).toContain('Publication of 14 January 2025');
    expect(pop.textContent).toContain('Declared partial');
    expect(pop.textContent).toContain('2 data-quality flags · coverage-affecting');
    const link = pop.querySelector('a.hold-pop-link') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('#dataset-b'); // the same destination as the cell itself
    expect(link.textContent).toBe('Open dataset →');
  });
});

describe('Popover interaction (issue #741)', { tags: ['ui'] }, () => {
  it('Popover_BeforeWiring_TheCellIsAPlainDeepLinkWithNoPopover', () => {
    // Progressive enhancement: with wireHoldingsPopovers never called (the
    // no-JS baseline), the cell carries no popover at all — just its href.
    const { cellA } = holdingsMapHost();
    expect(cellA.nextElementSibling).toBeNull();
    expect(cellA.getAttribute('href')).toBe('#dataset-a');
  });

  it('Popover_DesktopHover_ShowsTheRicherSummary', () => {
    const { cellA } = holdingsMapHost();
    wireHoldingsPopovers();
    cellA.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    expect(popoverOf(cellA).hidden).toBe(false);
  });

  it('Popover_DesktopMouseClick_StillNavigatesImmediately_NoRegressionToTheDeepLink', () => {
    const { cellA } = holdingsMapHost();
    wireHoldingsPopovers();
    cellA.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    const e = fireClick(cellA);
    expect(e.defaultPrevented).toBe(false);
  });

  it('Popover_KeyboardFocus_ShowsThePopoverAndEnterStillNavigatesDirectly', () => {
    const { cellA } = holdingsMapHost();
    wireHoldingsPopovers();
    cellA.focus();
    expect(document.activeElement).toBe(cellA);
    expect(popoverOf(cellA).hidden).toBe(false);
    // A keyboard Enter (detail 0 — no preceding pointerdown) is left entirely
    // alone — it navigates exactly as it always has.
    const e = fireKeyboardClick(cellA);
    expect(e.defaultPrevented).toBe(false);
  });

  it('Popover_FocusMovingToTheNextCell_ClosesThePreviousPopoverAndOpensTheNext', () => {
    const { cellA, cellB } = holdingsMapHost();
    wireHoldingsPopovers();
    cellA.focus();
    expect(popoverOf(cellA).hidden).toBe(false);
    cellB.focus();
    expect(popoverOf(cellA).hidden).toBe(true);
    expect(popoverOf(cellB).hidden).toBe(false);
  });

  it('Popover_TabbingIntoItsOwnOpenDatasetLink_StaysOpenRatherThanTrappingOrClosing', () => {
    const { cellA } = holdingsMapHost();
    wireHoldingsPopovers();
    cellA.focus();
    const link = popoverOf(cellA).querySelector('a.hold-pop-link') as HTMLAnchorElement;
    link.focus(); // the natural next Tab stop — no special focus trap involved
    expect(document.activeElement).toBe(link);
    expect(popoverOf(cellA).hidden).toBe(false); // moving focus within the pair does not close it
  });

  it('Popover_EscapeKey_DismissesAndReturnsFocusToTheCell', () => {
    const { cellA } = holdingsMapHost();
    wireHoldingsPopovers();
    cellA.focus();
    const link = popoverOf(cellA).querySelector('a.hold-pop-link') as HTMLAnchorElement;
    link.focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(popoverOf(cellA).hidden).toBe(true);
    expect(document.activeElement).toBe(cellA); // focus never lands on nothing
  });

  it('Popover_ClickOutsideTheGrid_DismissesAnOpenPopover', () => {
    const { cellA } = holdingsMapHost();
    wireHoldingsPopovers();
    cellA.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    expect(popoverOf(cellA).hidden).toBe(false);
    document.getElementById('elsewhere')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(popoverOf(cellA).hidden).toBe(true);
  });

  it('Popover_TouchFirstTap_PreviewsAndBlocksTheNavigation', () => {
    const { cellA } = holdingsMapHost();
    wireHoldingsPopovers();
    pointerDown(cellA, 'touch');
    const e = fireClick(cellA);
    expect(e.defaultPrevented).toBe(true); // the first tap previews, it does not navigate
    expect(popoverOf(cellA).hidden).toBe(false);
  });

  it('Popover_TouchSecondTapOnAnAlreadyPreviewedCell_LetsTheNavigationThrough', () => {
    const { cellA } = holdingsMapHost();
    wireHoldingsPopovers();
    pointerDown(cellA, 'touch');
    fireClick(cellA); // first tap: preview
    pointerDown(cellA, 'touch');
    const e2 = fireClick(cellA); // second tap: navigate
    expect(e2.defaultPrevented).toBe(false);
  });

  it('Popover_TouchTapOnADifferentCell_PreviewsTheNewOneRatherThanNavigating', () => {
    const { cellA, cellB } = holdingsMapHost();
    wireHoldingsPopovers();
    pointerDown(cellA, 'touch');
    fireClick(cellA); // preview A
    pointerDown(cellB, 'touch');
    const e = fireClick(cellB); // a fresh cell always previews first, even mid-preview elsewhere
    expect(e.defaultPrevented).toBe(true);
    expect(popoverOf(cellA).hidden).toBe(true);
    expect(popoverOf(cellB).hidden).toBe(false);
  });

  it('Popover_ClickInsideItsOwnOpenDatasetLink_IsNeverIntercepted', () => {
    const { cellA } = holdingsMapHost();
    wireHoldingsPopovers();
    // Touch-preview it open first, exactly as a touch user would.
    pointerDown(cellA, 'touch');
    fireClick(cellA);
    const link = popoverOf(cellA).querySelector('a.hold-pop-link') as HTMLAnchorElement;
    const e = fireClick(link);
    expect(e.defaultPrevented).toBe(false); // the explicit "go to dataset" action always navigates
  });

  // Hybrid touch+keyboard/mouse devices: a single touch tap must never leave
  // the grid permanently "thinking" every later interaction is also touch.
  it('Popover_KeyboardEnterOnAnotherCellAfterAnEarlierTouchTap_StillNavigates', () => {
    const { cellA, cellB } = holdingsMapHost();
    wireHoldingsPopovers();
    // A full touch tap-preview-then-navigate on cell A first.
    pointerDown(cellA, 'touch');
    fireClick(cellA); // preview
    pointerDown(cellA, 'touch');
    fireClick(cellA); // navigate
    // A keyboard Enter on a different cell must not be treated as a second
    // touch tap — it should navigate immediately, exactly as it always has.
    cellB.focus();
    const e = fireKeyboardClick(cellB);
    expect(e.defaultPrevented).toBe(false);
  });

  it('Popover_HoverAfterAnEarlierTouchTap_StillOpensThePopover', () => {
    const { cellA, cellB } = holdingsMapHost();
    wireHoldingsPopovers();
    pointerDown(cellA, 'touch');
    fireClick(cellA); // preview
    pointerDown(cellA, 'touch');
    fireClick(cellA); // navigate — the touch gesture is over
    // A genuine mouse hover on another cell afterwards (no pointerdown at
    // all — real hovering never fires one) must still open its popover.
    cellB.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    expect(popoverOf(cellB).hidden).toBe(false);
  });

  it('Popover_KeyboardTabAfterAnIncompleteTouchGesture_StillOpensThePopoverOnFocus', () => {
    // A touch pointerdown with no matching click (a long-press, or a finger
    // dragged away before lifting) leaves lastPointerType stuck at 'touch'
    // with no click ever firing to reset it — the click-driven reset alone
    // cannot save this case, so this isolates the keydown-driven reset as an
    // independent safety net.
    const { cellA, cellB } = holdingsMapHost();
    wireHoldingsPopovers();
    pointerDown(cellA, 'touch'); // no matching click follows
    // Tabbing dispatches a keydown before the resulting focusin; that keydown
    // alone must be enough to clear the stale touch state.
    cellB.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    cellB.focus();
    expect(popoverOf(cellB).hidden).toBe(false);
  });

  it('Popover_ShiftTabFromTheOpenDatasetLinkBackToTheCell_KeepsItOpen', () => {
    const { cellA } = holdingsMapHost();
    wireHoldingsPopovers();
    cellA.focus();
    const link = popoverOf(cellA).querySelector('a.hold-pop-link') as HTMLAnchorElement;
    link.focus();
    expect(popoverOf(cellA).hidden).toBe(false);
    // Shift+Tab back to the cell: the departing element (link.focusout's
    // target) is the popover's own link, not the cell — the popover must not
    // be treated as left behind.
    cellA.focus();
    expect(popoverOf(cellA).hidden).toBe(false);
    expect(document.activeElement).toBe(cellA);
  });

  it('Popover_MouseMovingBetweenThePopoversOwnChildren_KeepsItOpen', () => {
    const { cellA } = holdingsMapHost();
    wireHoldingsPopovers();
    cellA.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    const pop = popoverOf(cellA);
    const head = pop.querySelector('.hold-pop-head') as HTMLElement;
    const link = pop.querySelector('a.hold-pop-link') as HTMLAnchorElement;
    expect(pop.hidden).toBe(false);
    // The mouse moving from the popover's summary text to its own link is not
    // a departure from the cell/popover pair.
    head.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: link }));
    expect(pop.hidden).toBe(false);
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

  // Issue #795: the static markup must ship every panel visible (progressive
  // enhancement — a no-JS reader can never reach a panel that starts hidden,
  // since nothing but the removed script ever unhides it). These exercise
  // wireTabs() against that no-JS-shaped baseline directly, rather than
  // against fixtures that pre-hide the inactive panels for it.
  function visiblePanelsHost(): HTMLElement[] {
    document.body.innerHTML = `
      <div class="home-tabs">
        <button class="tab" id="t1" role="tab" aria-controls="p1" aria-selected="true">Reader</button>
        <button class="tab" id="t2" role="tab" aria-controls="p2" aria-selected="false" tabindex="-1">Researcher</button>
        <button class="tab" id="t3" role="tab" aria-controls="p3" aria-selected="false" tabindex="-1">Callsign-holder</button>
      </div>
      <div id="p1">Reader content</div>
      <div id="p2">Researcher content</div>
      <div id="p3">Callsign-holder content</div>`;
    return [...document.querySelectorAll('.home-tabs .tab')].map(t => t as HTMLElement);
  }

  it('Tabs_BeforeWiring_EveryPanelIsVisible_TheNoJsBaselineShowsAllRoleContent', () => {
    // With wireTabs never called (the no-JS case this issue is about), none of
    // the three panels carries a hidden attribute — a reader with JavaScript
    // off sees the Reader, Researcher and Callsign-holder content stacked.
    visiblePanelsHost();
    expect(document.getElementById('p1')?.hidden).toBe(false);
    expect(document.getElementById('p2')?.hidden).toBe(false);
    expect(document.getElementById('p3')?.hidden).toBe(false);
  });

  it('Tabs_OnInitialisation_HidesEveryPanelExceptTheSelectedOne', () => {
    // wireTabs() itself is what applies the hiding — starting from a markup
    // where every panel is visible, initialising the widget must reduce this
    // to a single visible panel without waiting for a click or keypress.
    const tabs = visiblePanelsHost();
    wireTabs(tabs);
    expect(document.getElementById('p1')?.hidden).toBe(false); // aria-selected="true" in the markup
    expect(document.getElementById('p2')?.hidden).toBe(true);
    expect(document.getElementById('p3')?.hidden).toBe(true);
  });

  it('Tabs_OnInitialisation_WithNoTabMarkedSelected_DefaultsToTheFirstTab', () => {
    document.body.innerHTML = `
      <div class="home-tabs">
        <button class="tab" id="t1" role="tab" aria-controls="p1" aria-selected="false">Reader</button>
        <button class="tab" id="t2" role="tab" aria-controls="p2" aria-selected="false">Researcher</button>
      </div>
      <div id="p1">Reader content</div>
      <div id="p2">Researcher content</div>`;
    const tabs = [...document.querySelectorAll('.home-tabs .tab')].map(t => t as HTMLElement);
    wireTabs(tabs);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(document.getElementById('p1')?.hidden).toBe(false);
    expect(document.getElementById('p2')?.hidden).toBe(true);
  });
});

// Issue #795: the shipped index.html markup itself must never hide a
// non-default role panel — that hiding is wireTabs()'s job, applied only once
// it actually runs. These read the real file (the same convention the CSS
// guards below use) so a future edit that reintroduces a static `hidden` on a
// role panel fails here rather than shipping the regression silently.
describe('Front-door role-tabs markup (issue #795)', { tags: ['unit'] }, () => {
  const INDEX_HTML = fs.readFileSync(path.join('site', 'index.html'), 'utf8');

  // The tablist-to-panel section only — isolates the assertions to the role
  // tabs, not every other `hidden` attribute the page legitimately ships
  // (the startup warning, the suggestion listbox, the jump-back chips, etc.,
  // all of which are deliberately hidden until script or a result exists).
  const waysInSection = /<div id="ways-in" class="home-tabs">[\s\S]*?<\/div>\s*<\/div>\s*<hr class="home-rule"/.exec(INDEX_HTML)?.[0] ?? '';

  it('WaysInSection_IsPresentInTheMarkup_SoTheFollowingAssertionsAreMeaningful', () => {
    expect(waysInSection).not.toBe('');
    expect(waysInSection).toContain('panel-holder');
  });

  it('RolePanels_InTheStaticMarkup_CarryNoHiddenAttribute', () => {
    for (const id of ['panel-reader', 'panel-researcher', 'panel-holder']) {
      const panelTag = new RegExp(`<div class="panel"[^>]*id="${id}"[^>]*>`).exec(waysInSection)?.[0] ?? '';
      expect(panelTag, `${id} should be present`).not.toBe('');
      // Match only a standalone boolean `hidden` attribute (whitespace before
      // it), so a future `aria-hidden`/`data-hidden` tweak — where `hidden`
      // follows a `-`, not whitespace — does not false-fail this guard.
      expect(panelTag, `${id} must not ship a static hidden attribute`).not.toMatch(/\shidden\b/);
    }
  });

  it('RolePanels_EachCarriesAHeading_SoTheStackedNoJsViewReadsAsCoherentSections', () => {
    for (const [id, label] of [['panel-reader', 'Reader'], ['panel-researcher', 'Researcher'], ['panel-holder', 'Callsign-holder']] as const) {
      const panelBody = new RegExp(`id="${id}"[^>]*>([\\s\\S]*?)<div class="paths">`).exec(waysInSection)?.[1] ?? '';
      expect(panelBody, `${id} should carry a heading naming its audience`).toMatch(new RegExp(`<h3[^>]*>${label}</h3>`));
    }
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
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
