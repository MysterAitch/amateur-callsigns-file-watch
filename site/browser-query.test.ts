import { describe, it, expect } from 'vitest';
import {
  quote,
  parseColumnFilter,
  buildPredicate,
  isDefaultSort,
  serializeFilterState,
  parseFilterState,
  matchingCountSql,
  setDiffSql,
  callsignCharMarker,
  TOGGLES,
} from './browser-query.js';

// The shared query core turns a data-browser's filter state into SQL and
// round-trips it through the ?view= share link. These are the pure pieces
// both the single-publication browser and the cross-publication comparison
// surface (issue #199) rely on, so they are worth pinning independently of
// any DOM. Test names follow Subject_Scenario_Outcome per project convention.

// A minimal filter-state shape matching what the front-ends hold.
function state({ facets = new Map(), toggles = new Set<string>(), columnFilters = new Map<string, string>(), sort = [{ col: 'callsign', dir: 'ASC' }], pageSize = 25, customSql = null as string | null } = {}) {
  return { facets, toggles, columnFilters, sort, pageSize, customSql };
}
function facet(key: string, values: string[], extra: Record<string, unknown> = {}) {
  return { key, field: key, isExpr: false, label: key, values: new Set(values), exclude: false, ...extra };
}

describe('quote', () => {
  it('Quote_WhenPlainValue_WrapsInSingleQuotes', () => {
    expect(quote('Reserved')).toBe("'Reserved'");
  });
  it('Quote_WhenValueContainsSingleQuote_DoublesIt', () => {
    // The defence that lets literal values be interpolated into displayed SQL.
    expect(quote("O'Brien")).toBe("'O''Brien'");
  });
});

describe('parseColumnFilter', () => {
  it('ColumnFilter_WhenEmpty_ReturnsNull', () => {
    expect(parseColumnFilter('callsign', '   ')).toBeNull();
  });
  it('ColumnFilter_WhenComparisonOperator_EmitsOperatorFragment', () => {
    expect(parseColumnFilter('licence_version_original_start_date', '>= 2019-08-01'))
      .toBe(`"licence_version_original_start_date" >= '2019-08-01'`);
  });
  it('ColumnFilter_WhenWildcard_EmitsGlob', () => {
    expect(parseColumnFilter('callsign', '2*T*E')).toBe(`"callsign" GLOB '2*T*E'`);
  });
  it('ColumnFilter_WhenBareText_EmitsContainsLike', () => {
    expect(parseColumnFilter('product', 'Foundation')).toBe(`"product" LIKE '%Foundation%'`);
  });
  it('ColumnFilter_WhenNegated_EmitsNotLike', () => {
    expect(parseColumnFilter('status', '!Reserved')).toBe(`"status" NOT LIKE '%Reserved%'`);
  });
  it('ColumnFilter_WhenNegatedWildcard_EmitsNotGlob', () => {
    expect(parseColumnFilter('callsign', '!G?ABC')).toBe(`"callsign" NOT GLOB 'G?ABC'`);
  });
});

describe('buildPredicate', () => {
  it('Predicate_WhenNoFiltersAndNoDataset_IsAlwaysTrue', () => {
    // The comparison surface builds a dataset-agnostic predicate; an empty
    // one must still be a valid, droppable WHERE clause.
    expect(buildPredicate(state())).toBe('1=1');
  });
  it('Predicate_WhenDatasetScoped_LeadsWithDatasetClause', () => {
    expect(buildPredicate(state(), { dataset: '2026-06-23' })).toBe(`dataset = '2026-06-23'`);
  });
  it('Predicate_WhenFacetSelected_EmitsInClause', () => {
    const s = state({ facets: new Map([['status', facet('status', ['Reserved', 'Allocated'])]]) });
    expect(buildPredicate(s)).toBe(`"status" IN ('Reserved', 'Allocated')`);
  });
  it('Predicate_WhenFacetExcluded_EmitsNotInClause', () => {
    const s = state({ facets: new Map([['status', facet('status', ['Reserved'], { exclude: true })]]) });
    expect(buildPredicate(s)).toBe(`"status" NOT IN ('Reserved')`);
  });
  it('Predicate_WhenExpressionFacet_UsesRawFieldExpression', () => {
    // Chart bars can facet on an expression rather than a bare column.
    const s = state({ facets: new Map([['len', { key: 'len', field: 'LENGTH(callsign)', isExpr: true, label: 'length', values: new Set(['5']), exclude: false }]]) });
    expect(buildPredicate(s)).toBe(`LENGTH(callsign) IN ('5')`);
  });
  it('Predicate_WhenToggleActive_IncludesToggleSql', () => {
    const s = state({ toggles: new Set(['unparseable']) });
    expect(buildPredicate(s)).toBe(`(${TOGGLES.unparseable.sql})`);
  });
  it('Predicate_WhenUnknownToggle_IsIgnored', () => {
    const s = state({ toggles: new Set(['made-up']) });
    expect(buildPredicate(s)).toBe('1=1');
  });
  it('Predicate_WhenDatasetAndFacetsAndFilters_JoinsWithAndDatasetFirst', () => {
    const s = state({
      facets: new Map([['status', facet('status', ['Reserved'])]]),
      toggles: new Set(['forbidden']),
      columnFilters: new Map([['callsign', '2*']]),
    });
    expect(buildPredicate(s, { dataset: 'D' })).toBe(
      `dataset = 'D' AND "status" IN ('Reserved') AND (${TOGGLES.forbidden.sql}) AND ("callsign" GLOB '2*')`,
    );
  });
  it('Predicate_WhenFacetHasNoValues_SkipsIt', () => {
    const s = state({ facets: new Map([['status', facet('status', [])]]) });
    expect(buildPredicate(s, { dataset: 'D' })).toBe(`dataset = 'D'`);
  });
});

describe('isDefaultSort', () => {
  it('DefaultSort_WhenCallsignAsc_IsTrue', () => {
    expect(isDefaultSort([{ col: 'callsign', dir: 'ASC' }])).toBe(true);
  });
  it('DefaultSort_WhenAnythingElse_IsFalse', () => {
    expect(isDefaultSort([{ col: 'status', dir: 'ASC' }])).toBe(false);
    expect(isDefaultSort([{ col: 'callsign', dir: 'DESC' }])).toBe(false);
    expect(isDefaultSort([{ col: 'callsign', dir: 'ASC' }, { col: 'status', dir: 'ASC' }])).toBe(false);
  });
});

describe('callsignCharMarker', () => {
  it('CharMarker_PlainGlyph_PassesThrough', () => {
    // Ordinary callsign characters render as themselves (null = no marker).
    for (const ch of 'M7TEE/2E0ABC') expect(callsignCharMarker(ch)).toBeNull();
  });
  it('CharMarker_Whitespace_UsesFriendlyName', () => {
    expect(callsignCharMarker(' ')).toBe('{SP}');       // U+0020 plain space
    expect(callsignCharMarker(' ')).toBe('{NBSP}'); // non-breaking space
    expect(callsignCharMarker('\t')).toBe('{TAB}');
  });
  it('CharMarker_ReplacementAndControl_AreMarked', () => {
    expect(callsignCharMarker('�')).toBe('{U+FFFD}');   // encoding damage
    expect(callsignCharMarker('​')).toBe('{U+200B}');   // zero-width space (whitespace, no friendly name)
    expect(callsignCharMarker('')).toBe('{U+0007}');   // control char
  });
});

describe('callsignCharMarker — unicode edge cases', () => {
  it('CharMarker_LowercaseAndHash_PassThrough', () => {
    for (const ch of 'abc#') expect(callsignCharMarker(ch)).toBeNull();
  });
  it('CharMarker_VisibleStray_ShownAsGlyphToHighlight', () => {
    // Visible-but-invalid characters stay readable (returned as-is) so the
    // caller highlights them in place rather than hiding them behind a code.
    expect(callsignCharMarker('-')).toBe('-');
    expect(callsignCharMarker('.')).toBe('.');
    expect(callsignCharMarker('é')).toBe('é');   // precomposed accented letter
    expect(callsignCharMarker('😀')).toBe('😀');  // single-codepoint emoji (for..of yields one unit)
  });
  it('CharMarker_CombiningMark_ShowsCodepointNotFloatingAccent', () => {
    // A lone combining accent has no glyph of its own; label it rather than
    // let it float onto the marker span.
    expect(callsignCharMarker(String.fromCodePoint(0x301))).toBe('{U+0301}');
  });
});

describe('matchingCountSql', () => {
  it('CountSql_ScopesToDatasetAndPredicate', () => {
    expect(matchingCountSql('2026-06-23', `"status" IN ('Reserved')`))
      .toBe(`SELECT COUNT(*) AS n FROM register_history WHERE dataset = '2026-06-23' AND ("status" IN ('Reserved'))`);
  });
  it('CountSql_QuotesDatasetKey', () => {
    // Defensive: the dataset key is interpolated as a literal, quote-escaped.
    expect(matchingCountSql("o'dd", '1=1')).toContain(`dataset = 'o''dd'`);
  });
});

describe('setDiffSql', () => {
  const pred = `"status" IN ('Reserved')`;
  const diff = setDiffSql('2025-06-04', '2026-06-23', pred);

  it('Appeared_SelectsFromComparisonExcludingBaselineCleaned', () => {
    // "Appeared" rows are in the later publication but their cleaned key is
    // absent from the earlier one's filtered cohort.
    expect(diff.appeared).toContain(`FROM register_history WHERE dataset = '2026-06-23' AND (${pred})`);
    expect(diff.appeared).toContain(`cleaned NOT IN (SELECT cleaned FROM register_history WHERE dataset = '2025-06-04' AND (${pred}))`);
  });
  it('Disappeared_IsTheMirrorOfAppeared', () => {
    expect(diff.disappeared).toContain(`FROM register_history WHERE dataset = '2025-06-04' AND (${pred})`);
    expect(diff.disappeared).toContain(`cleaned NOT IN (SELECT cleaned FROM register_history WHERE dataset = '2026-06-23' AND (${pred}))`);
  });
  it('Changed_JoinsBothCohortsOnCleanedWhereStatusDiffers', () => {
    expect(diff.changed).toContain(`ra.status AS status_before`);
    expect(diff.changed).toContain(`rb.status AS status_after`);
    expect(diff.changed).toContain(`ON ra.cleaned = rb.cleaned`);
    expect(diff.changed).toContain(`WHERE ra.status != rb.status`);
    // Each side carries the predicate so the comparison is view-scoped.
    expect(diff.changed).toContain(`dataset = '2025-06-04' AND (${pred})`);
    expect(diff.changed).toContain(`dataset = '2026-06-23' AND (${pred})`);
  });
  it('SetDiff_WithEmptyPredicate_ComparesWholePublications', () => {
    const whole = setDiffSql('A', 'B', '1=1');
    expect(whole.appeared).toBe(`SELECT callsign, cleaned, status FROM register_history WHERE dataset = 'B' AND (1=1) AND cleaned NOT IN (SELECT cleaned FROM register_history WHERE dataset = 'A' AND (1=1)) ORDER BY callsign`);
  });
});

describe('serialize/parse round-trip', () => {
  it('Serialize_WhenPristineState_ProducesEmptyObject', () => {
    // A pristine view must serialise to {} so the ?view= param is dropped.
    expect(serializeFilterState(state())).toEqual({});
  });
  it('RoundTrip_WhenFacetsTogglesFiltersSortSizeAndSql_ReconstructsEquivalentState', () => {
    const original = state({
      facets: new Map([['status', facet('status', ['Reserved', 'Allocated'], { exclude: true })]]),
      toggles: new Set(['forbidden']),
      columnFilters: new Map([['callsign', '2*T']]),
      sort: [{ col: 'status', dir: 'DESC' }, { col: 'callsign', dir: 'ASC' }],
      pageSize: 100,
      customSql: null,
    });
    const restored = parseFilterState(serializeFilterState(original));
    const statusFacet = restored.facets?.get('status');
    expect(statusFacet).toMatchObject({ key: 'status', field: 'status', isExpr: false, exclude: true });
    expect([...(statusFacet?.values ?? [])]).toEqual(['Reserved', 'Allocated']);
    expect([...(restored.toggles ?? [])]).toEqual(['forbidden']);
    expect([...(restored.columnFilters ?? [])]).toEqual([['callsign', '2*T']]);
    expect(restored.sort).toEqual([{ col: 'status', dir: 'DESC' }, { col: 'callsign', dir: 'ASC' }]);
    expect(restored.pageSize).toBe(100);
  });
  it('RoundTrip_WhenCustomSql_PreservesQuery', () => {
    const original = state({ customSql: 'SELECT * FROM register_history LIMIT 5' });
    const restored = parseFilterState(serializeFilterState(original));
    expect(restored.customSql).toBe('SELECT * FROM register_history LIMIT 5');
  });
  it('Parse_WhenUnknownToggleInLink_DropsIt', () => {
    // Schema-drift safety: a stale share link naming a removed toggle must
    // not resurrect it.
    const restored = parseFilterState({ t: ['forbidden', 'removed-toggle'] });
    expect([...(restored.toggles ?? [])]).toEqual(['forbidden']);
  });
});
