// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { sanitiseComparePredicate, partitionSelectedDatasets, datasetPickerLabel } from './compare.js';
import { viewParamToState, applyViewToState, buildPredicate, TOGGLES } from './browser-query.js';

// The Compare surface reads the shareable ?view= filter, ?datasets= selection
// and ?pred= override on load, so a report or a hand-authored page can link a
// pre-filtered comparison (issues #333/#397). The state<->URL round-trip itself
// is pinned in browser-query.test.ts; these tests cover the compare-side
// validation the deep link goes through - an unsafe ?pred= is rejected, an
// unknown ?datasets= key is dropped - and that the exemplar links parse to the
// intended filter. Test names follow Subject_Scenario_Outcome.

describe('sanitiseComparePredicate', { tags: ['ui'] }, () => {
  it('ComparePred_WhenSingleCondition_IsUsedVerbatim', () => {
    expect(sanitiseComparePredicate("status = 'Reserved'"))
      .toEqual({ predicate: "status = 'Reserved'", rejected: null });
  });
  it('ComparePred_WhenContainsStatementSeparator_IsRejected', () => {
    // The same guard the hand-edit apply button enforces: a link must not smuggle
    // a second statement past the read-only WHERE-condition contract.
    const hostile = "status = 'x'; DROP TABLE register_history";
    expect(sanitiseComparePredicate(hostile)).toEqual({ predicate: null, rejected: hostile });
  });
  it('ComparePred_WhenAbsentOrBlank_IsNull', () => {
    expect(sanitiseComparePredicate(null)).toEqual({ predicate: null, rejected: null });
    expect(sanitiseComparePredicate('')).toEqual({ predicate: null, rejected: null });
  });
});

describe('partitionSelectedDatasets', { tags: ['ui'] }, () => {
  const known = ['2026-06-23', '2025-06-04', '2024-04-30'];
  it('DatasetSelection_WhenAllKnown_AreChosen', () => {
    expect(partitionSelectedDatasets('2026-06-23,2025-06-04', known))
      .toEqual({ chosen: ['2026-06-23', '2025-06-04'], unknown: [] });
  });
  it('DatasetSelection_WhenSomeUnknown_AreSeparatedNotApplied', () => {
    // A stale link naming a since-removed publication drops it (and reports it),
    // rather than carrying a dead key into the selection.
    expect(partitionSelectedDatasets('2026-06-23,1999-01-01', known))
      .toEqual({ chosen: ['2026-06-23'], unknown: ['1999-01-01'] });
  });
  it('DatasetSelection_WhenBlankOrDuplicate_IsCleaned', () => {
    expect(partitionSelectedDatasets(',2026-06-23,,2026-06-23,', known))
      .toEqual({ chosen: ['2026-06-23'], unknown: [] });
  });
  it('DatasetSelection_WhenAbsent_IsEmpty', () => {
    expect(partitionSelectedDatasets(null, known)).toEqual({ chosen: [], unknown: [] });
  });
});

describe('datasetPickerLabel — full date, not month, on the picker (#551)', { tags: ['ui'] }, () => {
  it('DatasetPickerLabel_ForAnArchivedPublication_IsTheFullHumanisedDate', () => {
    expect(datasetPickerLabel('2024-04-30')).toBe('30 April 2024');
  });
  it('DatasetPickerLabel_WhenTwoPublicationsShareAMonth_AreDistinguishableByDay', () => {
    // 2025-06-04 and 2025-06-08 are both real archived publications (the
    // picker lists every one side by side); month-only precision would render
    // both as the indistinguishable "June 2025" - the disambiguation case
    // #551 calls out by name.
    expect(datasetPickerLabel('2025-06-04')).toBe('4 June 2025');
    expect(datasetPickerLabel('2025-06-08')).toBe('8 June 2025');
  });
});

describe('compare deep-link filter resolution', { tags: ['ui'] }, () => {
  function freshState() {
    return {
      facets: new Map(), toggles: new Set<string>(), columnFilters: new Map<string, string>(),
      sort: [{ col: 'callsign', dir: 'ASC' }], pageSize: 25, customSql: null as string | null,
    };
  }

  it('CompareDeepLink_WhenForbiddenToggleView_ResolvesToForbiddenPredicate', () => {
    // The forbidden-suffix exemplar link ?view={"t":["forbidden"]} must apply to
    // the forbidden-suffix predicate every publication is then diffed on.
    const state = freshState();
    applyViewToState(state, viewParamToState('{"t":["forbidden"]}'));
    expect(buildPredicate(state)).toBe(`(${TOGGLES.forbidden.sql})`);
  });

  it('CompareDeepLink_WhenViewMalformed_DegradesToAllRows', () => {
    // A hand-mangled ?view= must not throw; it falls back to the pristine
    // (all-rows) filter rather than breaking the page.
    const state = freshState();
    expect(() => applyViewToState(state, viewParamToState('{not json'))).not.toThrow();
    expect(buildPredicate(state)).toBe('1=1');
  });
});

describe('compare exemplar deep-links (end-to-end wiring)', { tags: ['ui'] }, () => {
  it('CompareExemplars_InHandAuthoredPages_ParseToASafeFilter', () => {
    const links = ['index.html', 'statistics.html'].flatMap((file) => {
      const html = fs.readFileSync(path.join('site', file), 'utf8');
      return [...html.matchAll(/compare\.html\?([^"'#\s]+)/g)].map(m => m[1]);
    });
    expect(links.length).toBeGreaterThan(0);
    for (const qs of links) {
      const params = new URLSearchParams(qs.replace(/&amp;/g, '&'));
      // A ?view= must parse to a real state without throwing.
      expect(() => viewParamToState(params.get('view')), qs).not.toThrow();
      // Any ?pred= an exemplar ships must be safe (a single condition).
      expect(sanitiseComparePredicate(params.get('pred')).rejected, qs).toBeNull();
    }
  });
});
