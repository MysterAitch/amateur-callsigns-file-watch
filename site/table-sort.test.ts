import { describe, it, expect } from 'vitest';
import {
  isBlankSortValue,
  inferSortType,
  compareSortValues,
  sortedRowOrder,
  sortedRowOrderMulti,
  nextSort,
  sortToParam,
  sortFromParam,
  ariaSortValue,
} from './table-sort.js';
import type { SortEntry } from './table-sort.js';

// The shared table-sort core (issue #771): one framework-free definition of sort
// semantics — the state model, the type-aware comparator, the multi-column row
// ordering, and the ?sort= deep link — that both the static-table DOM backend
// and the interactive SQL lists apply. These are the pure pieces; the DOM wiring
// that consumes them is exercised in table-controls.test.ts. Test names follow
// the Subject_Scenario_Outcome convention.

describe('table-sort blank awareness', { tags: ['unit'] }, () => {
  it('IsBlankSortValue_WhenValueIsAnEmptyOrHumanisedBlank_ReportsItAsBlank', () => {
    for (const blank of ['', '   ', '(blank)', '(none)', 'N/A', '—', '–']) {
      expect(isBlankSortValue(blank)).toBe(true);
    }
  });

  it('IsBlankSortValue_WhenValueCarriesData_ReportsItAsNotBlank', () => {
    for (const value of ['0', 'England', '2016-01-01', '-3']) {
      expect(isBlankSortValue(value)).toBe(false);
    }
  });
});

describe('table-sort type inference', { tags: ['unit'] }, () => {
  it('InferSortType_WhenEveryValueIsANumber_ReportsNumeric', () => {
    expect(inferSortType(['9', '10', '100', '22'])).toBe('numeric');
  });

  it('InferSortType_WhenNumbersArePunctuatedByBlanks_StillReportsNumeric', () => {
    expect(inferSortType(['9', '(blank)', '22', '—'])).toBe('numeric');
  });

  it('InferSortType_WhenEveryValueIsAnIsoDate_ReportsDate', () => {
    expect(inferSortType(['2016-01-01', '2020-12-31', '2019-06-30'])).toBe('date');
  });

  it('InferSortType_WhenValuesAreMixedText_ReportsText', () => {
    expect(inferSortType(['M3, M6, M7', 'G2', '9'])).toBe('text');
  });
});

describe('table-sort comparator', { tags: ['unit'] }, () => {
  it('CompareSortValues_WhenNumeric_OrdersByMagnitudeNotLexically', () => {
    expect(compareSortValues('9', '100', 'numeric')).toBeLessThan(0);
    expect(compareSortValues('22', '9', 'numeric')).toBeGreaterThan(0);
  });

  it('CompareSortValues_WhenDate_OrdersChronologically', () => {
    expect(compareSortValues('2016-01-01', '2020-12-31', 'date')).toBeLessThan(0);
  });

  it('CompareSortValues_WhenText_OrdersByLocale', () => {
    expect(compareSortValues('England', 'Wales', 'text')).toBeLessThan(0);
  });
});

describe('table-sort single-column order', { tags: ['unit'] }, () => {
  it('SortedRowOrder_WhenNumericAscending_ReturnsIndicesInMagnitudeOrder', () => {
    expect(sortedRowOrder(['9', '10', '100', '22'], 'numeric', 'ascending')).toEqual([0, 1, 3, 2]);
  });

  it('SortedRowOrder_WhenDescending_ReversesTheMeaningfulValuesButKeepsBlanksLast', () => {
    expect(sortedRowOrder(['5', '(blank)', '2', '—'], 'numeric', 'descending')).toEqual([0, 2, 1, 3]);
  });

  it('SortedRowOrder_WhenValuesAreEqual_KeepsTheirAuthoredOrder', () => {
    expect(sortedRowOrder(['b', 'a', 'b', 'a'], 'text', 'ascending')).toEqual([1, 3, 0, 2]);
  });
});

// A small fixture: two columns keyed 'letter' (text) and 'count' (numeric),
// wired the way the DOM backend calls the multi-column ordering.
const ROWS: Record<string, string>[] = [
  { letter: 'b', count: '2' },
  { letter: 'a', count: '2' },
  { letter: 'b', count: '1' },
  { letter: 'a', count: '9' },
];
const valueAt = (row: number, key: string): string => ROWS[row][key] ?? '';
const typeOf = (key: string): 'numeric' | 'date' | 'text' => (key === 'count' ? 'numeric' : 'text');

describe('table-sort multi-column order', { tags: ['unit'] }, () => {
  it('SortedRowOrderMulti_WhenPrimaryTies_BreaksTiesByTheSecondaryColumn', () => {
    // Primary letter ascending groups a-rows then b-rows; within each, count
    // ascending: a/9 vs a/2 → a/2 first (row 1), then a/9 (row 3); b/2 (row 0)
    // then b/1 (row 2) → but count ascending puts b/1 (row 2) before b/2 (row 0).
    const sort: SortEntry[] = [{ key: 'letter', dir: 'asc' }, { key: 'count', dir: 'asc' }];
    expect(sortedRowOrderMulti(sort, ROWS.length, valueAt, typeOf)).toEqual([1, 3, 2, 0]);
  });

  it('SortedRowOrderMulti_WhenSecondaryDescends_OnlyThatColumnReverses', () => {
    const sort: SortEntry[] = [{ key: 'letter', dir: 'asc' }, { key: 'count', dir: 'desc' }];
    // a-rows: 9 then 2 → rows 3,1; b-rows: 2 then 1 → rows 0,2.
    expect(sortedRowOrderMulti(sort, ROWS.length, valueAt, typeOf)).toEqual([3, 1, 0, 2]);
  });

  it('SortedRowOrderMulti_WhenRowsAreEqualOnEverySortedColumn_KeepsTheirAuthoredOrder', () => {
    const rows: Record<string, string>[] = [{ x: 'same' }, { x: 'same' }, { x: 'same' }];
    const sort: SortEntry[] = [{ key: 'x', dir: 'desc' }];
    expect(sortedRowOrderMulti(sort, rows.length, (r, k) => rows[r][k] ?? '', () => 'text'))
      .toEqual([0, 1, 2]);
  });

  it('SortedRowOrderMulti_WhenAColumnHasBlanks_SinksThemLastRegardlessOfDirection', () => {
    const rows: Record<string, string>[] = [{ v: '5' }, { v: '(blank)' }, { v: '2' }, { v: '—' }];
    const asc: SortEntry[] = [{ key: 'v', dir: 'asc' }];
    const desc: SortEntry[] = [{ key: 'v', dir: 'desc' }];
    const getter = (r: number, k: string): string => rows[r][k] ?? '';
    expect(sortedRowOrderMulti(asc, rows.length, getter, () => 'numeric')).toEqual([2, 0, 1, 3]);
    expect(sortedRowOrderMulti(desc, rows.length, getter, () => 'numeric')).toEqual([0, 2, 1, 3]);
  });
});

describe('table-sort state transitions', { tags: ['unit'] }, () => {
  it('NextSort_WhenAPlainHeaderIsActivated_SortsByThatColumnAloneAscending', () => {
    expect(nextSort([], 'status')).toEqual([{ key: 'status', dir: 'asc' }]);
  });

  it('NextSort_WhenTheSoleAscendingColumnIsReactivated_TogglesToDescending', () => {
    expect(nextSort([{ key: 'status', dir: 'asc' }], 'status')).toEqual([{ key: 'status', dir: 'desc' }]);
  });

  it('NextSort_WhenADescendingColumnIsPlainActivated_ReturnsToAscending', () => {
    expect(nextSort([{ key: 'status', dir: 'desc' }], 'status')).toEqual([{ key: 'status', dir: 'asc' }]);
  });

  it('NextSort_WhenAPlainHeaderIsActivated_ReplacesAnyExistingMultiColumnSort', () => {
    expect(nextSort([{ key: 'callsign', dir: 'asc' }, { key: 'status', dir: 'desc' }], 'product'))
      .toEqual([{ key: 'product', dir: 'asc' }]);
  });

  it('NextSort_WhenModifierActivated_AppendsTheColumnAsASecondarySort', () => {
    expect(nextSort([{ key: 'callsign', dir: 'asc' }], 'status', { multi: true }))
      .toEqual([{ key: 'callsign', dir: 'asc' }, { key: 'status', dir: 'asc' }]);
  });

  it('NextSort_WhenModifierActivatingAnAlreadySortedColumn_TogglesOnlyThatColumn', () => {
    expect(nextSort([{ key: 'callsign', dir: 'asc' }, { key: 'status', dir: 'asc' }], 'status', { multi: true }))
      .toEqual([{ key: 'callsign', dir: 'asc' }, { key: 'status', dir: 'desc' }]);
  });

  it('NextSort_WhenComputingANewSort_DoesNotMutateTheInput', () => {
    const sort: SortEntry[] = [{ key: 'status', dir: 'asc' }];
    nextSort(sort, 'status');
    expect(sort).toEqual([{ key: 'status', dir: 'asc' }]);
  });
});

describe('table-sort deep link', { tags: ['unit'] }, () => {
  it('SortToParam_WhenTheSortIsEmpty_ProducesNoParam', () => {
    expect(sortToParam([])).toBe('');
  });

  it('SortToParam_WhenColumnsAreSorted_EncodesKeyAndDirection', () => {
    expect(sortToParam([{ key: 'count', dir: 'desc' }, { key: 'suffix', dir: 'asc' }]))
      .toBe('count:desc,suffix:asc');
  });

  it('SortFromParam_WhenGivenAnEncodedSort_RoundTripsBackToTheSameSpec', () => {
    const sort: SortEntry[] = [{ key: 'count', dir: 'desc' }, { key: 'suffix', dir: 'asc' }];
    expect(sortFromParam(sortToParam(sort))).toEqual(sort);
  });

  it('SortFromParam_WhenTheParamIsAbsent_YieldsTheEmptySort', () => {
    expect(sortFromParam(null)).toEqual([]);
    expect(sortFromParam('')).toEqual([]);
  });

  it('SortFromParam_WhenATokenHasNoDirection_DefaultsToAscending', () => {
    expect(sortFromParam('status')).toEqual([{ key: 'status', dir: 'asc' }]);
  });

  it('SortFromParam_WhenGivenAnUnknownKeyPredicate_DropsColumnsTheTargetNoLongerOffers', () => {
    // A stale or hand-edited link degrades to what the current table can honour.
    const known = new Set(['status']);
    expect(sortFromParam('gone:asc,status:desc', k => known.has(k)))
      .toEqual([{ key: 'status', dir: 'desc' }]);
  });

  it('SortFromParam_WhenALinkHasStraySpacesOrRepeatsAKey_TrimsAndKeepsTheFirstOccurrence', () => {
    // A stale or hand-edited link should degrade to a coherent spec, not a
    // confusing one with duplicate columns and conflicting directions.
    expect(sortFromParam(' count : asc , status:desc '))
      .toEqual([{ key: 'count', dir: 'asc' }, { key: 'status', dir: 'desc' }]);
    expect(sortFromParam('count:asc,count:desc'))
      .toEqual([{ key: 'count', dir: 'asc' }]);
  });
});

describe('table-sort aria mapping', { tags: ['unit'] }, () => {
  it('AriaSortValue_WhenGivenADirection_MapsToTheVerboseAttributeValue', () => {
    expect(ariaSortValue('asc')).toBe('ascending');
    expect(ariaSortValue('desc')).toBe('descending');
    expect(ariaSortValue(null)).toBe('none');
  });
});
