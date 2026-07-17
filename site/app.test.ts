// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { makeRunLookup, registerHistoryHeader, seriesLink, suffixLink,
  LIST_SORT_COLUMNS, listOrderBy, nextSort, sortToParam, sortFromParam, renderTable } from './app.js';

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

describe('lookup component links adopt the shared callsign-part wrappers (#658)', { tags: ['ui'] }, () => {
  it('SeriesLink_WhenRenderingASeries_RendersTheSharedCsPfxFieldLinkedToTheSeriesPage', () => {
    // Retiring app.js's own pre-#658 displaySeries/seriesLink duplicate in
    // favour of field-wrappers.js's prefixSeriesField: the `cs cs-pfx` classes
    // and the `#` RSL-slot display convention now come from the ONE shared
    // implementation rather than a second copy of the same logic.
    const link = seriesLink('M7');
    expect(link.tagName).toBe('A');
    expect(link.className).toBe('cs cs-pfx');
    expect(link.getAttribute('href')).toBe('series/M7.html');
    expect(link.textContent).toBe('M#7');
  });

  it('SeriesLink_WhenSeriesIsASingleCharacter_IsShownUnchanged', () => {
    // Non-happy path: prefixSeriesDisplay's own guard - nothing to insert the
    // `#` marker before.
    expect(seriesLink('M').textContent).toBe('M');
  });

  it('SuffixLink_WhenRenderingASuffix_RendersTheSharedCsSfxFieldLinkedToTheAvailabilityMatrixSearch', () => {
    // Deliberate divergence from suffixField's own `link` option (#658): this
    // row already has a resolved component VALUE, so it links to the
    // availability-matrix search across every series, not the per-suffix
    // detail page - while still sharing the family's classes.
    const link = suffixLink('TEE');
    expect(link.tagName).toBe('A');
    expect(link.className).toBe('cs cs-sfx');
    expect(link.getAttribute('href')).toBe('?c=*TEE');
    expect(link.getAttribute('title')).toBe('availability matrix for *TEE');
    expect(link.textContent).toBe('TEE');
  });

  it('SuffixLink_WhenSuffixCarriesAnOddCharacter_MarksItRatherThanHidingIt', () => {
    // Non-happy path: a suffix is raw text lifted verbatim from a
    // publication/register row - the same transparency guarantee a whole
    // callsign carries, now shared via appendMarkedChars.
    const link = suffixLink('TE E');
    const markers = [...link.querySelectorAll('.marker')];
    expect(markers.length).toBe(1);
    expect(markers[0].textContent).toBe('{NBSP}');
    expect(link.textContent).toBe('TE{NBSP}E');
  });
});

// The index lookup's filtered result list gains the per-dataset browser's
// multi-column sort (issue #213): whole-register searches were always ordered
// by callsign; now every result column can be sorted, ascending or descending,
// with a stable tiebreak, and the choice rides in a shareable ?sort= deep link.
// These exercise the pure sort core the header clicks and the deep-link
// round-trip are built on; the interactive header wiring is covered end-to-end
// by the served-site evidence.
describe('lookup filtered-list sort ordering (#213)', { tags: ['unit'] }, () => {
  it('ListOrderBy_WhenNoColumnChosen_OrdersByCallsignAscending', () => {
    // The prior behaviour is the default: an untouched list still reads A→Z by
    // callsign, so nothing regresses for a reader who never sorts.
    expect(listOrderBy([])).toBe('c.callsign ASC');
  });

  it('ListOrderBy_WhenSortingByAnotherColumn_AppendsCallsignAsAStableTiebreak', () => {
    // Equal statuses must page deterministically, so callsign backs every sort.
    expect(listOrderBy([{ key: 'status', dir: 'ASC' }])).toBe('n.status ASC, c.callsign ASC');
  });

  it('ListOrderBy_WhenSortingByCallsignDescending_DoesNotDuplicateTheTiebreak', () => {
    expect(listOrderBy([{ key: 'callsign', dir: 'DESC' }])).toBe('c.callsign DESC');
  });

  it('ListOrderBy_WhenMultipleColumnsChosen_PreservesTheirOrder', () => {
    expect(listOrderBy([{ key: 'status', dir: 'DESC' }, { key: 'product', dir: 'ASC' }]))
      .toBe('n.status DESC, n.product ASC, c.callsign ASC');
  });

  it('ListOrderBy_WhenGivenAnUnknownColumnKey_DropsItRatherThanEmittingIt', () => {
    // Deep-link drift safety: a stale/hand-mangled key can never widen the SQL.
    expect(listOrderBy([{ key: 'DROP TABLE', dir: 'ASC' }])).toBe('c.callsign ASC');
  });

  it('ListOrderBy_WhenGivenAnUnknownDirection_FallsBackToAscending', () => {
    expect(listOrderBy([{ key: 'status', dir: 'sideways' }])).toBe('n.status ASC, c.callsign ASC');
  });

  it('ListSortColumns_CoverEveryColumnTheResultTableShows', () => {
    // The header wiring lines row cells up with LIST_SORT_COLUMNS by position;
    // this pins the contract so a column added to one is added to the other.
    expect(LIST_SORT_COLUMNS.map(c => c.key)).toEqual(['callsign', 'status', 'product', 'parse', 'flags']);
  });
});

describe('lookup filtered-list sort interaction semantics (#213)', { tags: ['unit'] }, () => {
  it('NextSort_WhenAPlainHeaderIsActivated_SortsByThatColumnAloneAscending', () => {
    expect(nextSort([], 'status', false)).toEqual([{ key: 'status', dir: 'ASC' }]);
  });

  it('NextSort_WhenTheSoleAscendingColumnIsReactivated_TogglesToDescending', () => {
    expect(nextSort([{ key: 'status', dir: 'ASC' }], 'status', false)).toEqual([{ key: 'status', dir: 'DESC' }]);
  });

  it('NextSort_WhenADescendingColumnIsPlainActivated_ReturnsToAscending', () => {
    expect(nextSort([{ key: 'status', dir: 'DESC' }], 'status', false)).toEqual([{ key: 'status', dir: 'ASC' }]);
  });

  it('NextSort_WhenAPlainHeaderIsActivated_ReplacesAnyExistingMultiColumnSort', () => {
    expect(nextSort([{ key: 'callsign', dir: 'ASC' }, { key: 'status', dir: 'DESC' }], 'product', false))
      .toEqual([{ key: 'product', dir: 'ASC' }]);
  });

  it('NextSort_WhenShiftActivated_AppendsTheColumnAsASecondarySort', () => {
    expect(nextSort([{ key: 'callsign', dir: 'ASC' }], 'status', true))
      .toEqual([{ key: 'callsign', dir: 'ASC' }, { key: 'status', dir: 'ASC' }]);
  });

  it('NextSort_WhenShiftActivatingAnAlreadySortedColumn_TogglesOnlyThatColumn', () => {
    expect(nextSort([{ key: 'callsign', dir: 'ASC' }, { key: 'status', dir: 'ASC' }], 'status', true))
      .toEqual([{ key: 'callsign', dir: 'ASC' }, { key: 'status', dir: 'DESC' }]);
  });

  it('NextSort_WhenTheColumnKeyIsUnknown_LeavesTheSortUntouched', () => {
    const sort = [{ key: 'callsign', dir: 'ASC' }];
    expect(nextSort(sort, 'nonsense', false)).toBe(sort);
  });

  it('NextSort_WhenComputingANewSort_DoesNotMutateTheInput', () => {
    const sort = [{ key: 'status', dir: 'ASC' }];
    nextSort(sort, 'status', false);
    expect(sort).toEqual([{ key: 'status', dir: 'ASC' }]);
  });
});

describe('lookup filtered-list sort deep link (#213)', { tags: ['unit'] }, () => {
  it('SortToParam_WhenTheSortIsPristine_ProducesNoParam', () => {
    // A default view carries no ?sort=, so shared links stay clean.
    expect(sortToParam([])).toBe('');
    expect(sortToParam([{ key: 'callsign', dir: 'ASC' }])).toBe('');
  });

  it('SortToParam_WhenColumnsAreSorted_EncodesKeyAndDirection', () => {
    expect(sortToParam([{ key: 'status', dir: 'DESC' }, { key: 'callsign', dir: 'ASC' }]))
      .toBe('status:desc,callsign:asc');
  });

  it('SortFromParam_WhenGivenAnEncodedSort_RoundTripsBackToTheSameSpec', () => {
    const sort = [{ key: 'status', dir: 'DESC' }, { key: 'product', dir: 'ASC' }];
    expect(sortFromParam(sortToParam(sort))).toEqual(sort);
  });

  it('SortFromParam_WhenTheParamIsAbsent_YieldsTheDefaultEmptySort', () => {
    expect(sortFromParam(null)).toEqual([]);
    expect(sortFromParam('')).toEqual([]);
  });

  it('SortFromParam_WhenGivenAnUnknownColumnOrMalformedToken_DropsIt', () => {
    // A stale or hand-edited link degrades to what it can honour, never throws.
    expect(sortFromParam('bogus:asc,status:desc')).toEqual([{ key: 'status', dir: 'DESC' }]);
    expect(sortFromParam('status')).toEqual([{ key: 'status', dir: 'ASC' }]);
  });
});

describe('lookup result table zero de-emphasis (issue #731)', { tags: ['ui'] }, () => {
  it('RenderTable_NumericCellIsExactlyZero_CarriesTheSharedZeroClass', () => {
    const wrap = renderTable(['label', 'count'], [['Allocated', 3], ['Suspended', 0]], 1);
    const cells = wrap.querySelectorAll('td.num');
    expect(cells[0].className).toBe('num');
    expect(cells[0].textContent).toBe('3');
    expect(cells[1].className).toBe('num zero');
    expect(cells[1].textContent).toBe('0');
  });

  it('RenderTable_NonNumericColumn_NeverCarriesTheZeroClassEvenWhenTextIsZero', () => {
    // numericFrom scopes the de-emphasis to columns meant to hold figures - a
    // label column that happens to read "0" (e.g. a raw code) is untouched.
    const wrap = renderTable(['code', 'count'], [['0', 5]], 1);
    const labelCell = wrap.querySelectorAll('td')[0];
    expect(labelCell.className).toBe('');
    expect(labelCell.textContent).toBe('0');
  });

  it('RenderTable_NumericCellContainsZeroWithinLongerText_DoesNotMatch', () => {
    const wrap = renderTable(['label', 'count'], [['x', '10'], ['y', '0.5']], 1);
    const cells = wrap.querySelectorAll('td.num');
    expect(cells[0].className).toBe('num');
    expect(cells[1].className).toBe('num');
  });

  it('RenderTable_DomNodeCell_IsNeverCheckedForZero', () => {
    // A cell carrying a link/pill DOM node (not plain text) is rendered as-is,
    // regardless of what its own text content happens to be.
    const link = document.createElement('a');
    link.textContent = '0';
    const wrap = renderTable(['label', 'count'], [['x', link]], 1);
    const cell = wrap.querySelectorAll('td.num')[0];
    expect(cell.className).toBe('num');
  });
});
