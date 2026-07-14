import { describe, it, expect } from 'vitest';
import {
  quote,
  parseColumnFilter,
  placeholderOf,
  canonicalCallsign,
  resolvedCallsignCore,
  buildPredicate,
  isDefaultSort,
  serializeFilterState,
  parseFilterState,
  matchingCountSql,
  setDiffSql,
  callsignCharMarker,
  TOGGLES,
  stateToViewParam,
  viewParamToState,
  applyViewToState,
  historySyncAction,
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

describe('quote', { tags: ['ui'] }, () => {
  it('Quote_WhenPlainValue_WrapsInSingleQuotes', () => {
    expect(quote('Reserved')).toBe("'Reserved'");
  });
  it('Quote_WhenValueContainsSingleQuote_DoublesIt', () => {
    // The defence that lets literal values be interpolated into displayed SQL.
    expect(quote("O'Brien")).toBe("'O''Brien'");
  });
});

describe('parseColumnFilter', { tags: ['ui'] }, () => {
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
  it('ColumnFilter_WhenRegionalVariantCallsign_AlsoMatchesCanonicalCore', () => {
    // The shared normalisation the index lookup applies, now reaching the
    // per-dataset browser: a regional-variant search widens to also match the
    // RSL-less core the register actually stores.
    expect(parseColumnFilter('callsign', 'MW7TEE'))
      .toBe(`("callsign" LIKE '%MW7TEE%' OR "callsign" = 'M7TEE')`);
  });
  it('ColumnFilter_WhenCanonicalCallsign_StaysAPlainContainsMatch', () => {
    // An already-canonical callsign has nothing to resolve, so no spurious OR.
    expect(parseColumnFilter('callsign', 'M7TEE')).toBe(`"callsign" LIKE '%M7TEE%'`);
  });
  it('ColumnFilter_WhenNonCallsignColumn_IsNotWidened', () => {
    // Normalisation is callsign-specific; other columns keep the plain match.
    expect(parseColumnFilter('product', 'MW7TEE')).toBe(`"product" LIKE '%MW7TEE%'`);
  });
});

// The callsign RSL-normalisation shared with the index lookup (issue #213):
// the pure core both the lookup (app.js) and the per-dataset browser
// (entry-browser.js) resolve regional variants through.
describe('placeholderOf', { tags: ['ui'] }, () => {
  it('Placeholder_WhenRegionalVariant_NormalisesToRslSlotForm', () => {
    expect(placeholderOf('MW7TEE')).toBe('M#7TEE');
    expect(placeholderOf('M7TEE')).toBe('M#7TEE');
    expect(placeholderOf('2E0ABC')).toBe('2#0ABC');
  });
  it('Placeholder_WhenVisitorPrefix_NormalisesToMSlashForm', () => {
    expect(placeholderOf('MM/1CNB')).toBe('M#/1CNB');
  });
  it('Placeholder_WhenNotACallsign_IsNull', () => {
    expect(placeholderOf('HELLO')).toBeNull();
  });
});

describe('canonicalCallsign', { tags: ['ui'] }, () => {
  it('Canonical_WhenRegionalVariant_ResolvesToRslLessCore', () => {
    // MW7TEE (Welsh regional rendering) resolves to the M7TEE core the
    // register stores.
    expect(canonicalCallsign('MW7TEE')).toBe('M7TEE');
  });
  it('Canonical_WhenVisitorRegionalForm_ResolvesToMSlashCore', () => {
    // An MM/-style visitor/reciprocal rendering resolves to the canonical M/ row.
    expect(canonicalCallsign('MM/1CNB')).toBe('M/1CNB');
  });
  it('Canonical_WhenAlreadyCore_IsUnchanged', () => {
    expect(canonicalCallsign('M7TEE')).toBe('M7TEE');
  });
  it('Canonical_WhenNotACallsign_IsNull', () => {
    expect(canonicalCallsign('12345')).toBeNull();
  });
});

describe('resolvedCallsignCore', { tags: ['ui'] }, () => {
  it('ResolvedCore_WhenRegionalVariant_ReturnsCanonicalCore', () => {
    expect(resolvedCallsignCore('callsign', 'MW7TEE')).toBe('M7TEE');
  });
  it('ResolvedCore_WhenLowercaseRegionalVariant_ResolvesCaseInsensitively', () => {
    // The browser column filter is not upper-cased for the user, so the core
    // resolution upper-cases first - matching the lookup's own input handling.
    expect(resolvedCallsignCore('callsign', 'mw7tee')).toBe('M7TEE');
  });
  it('ResolvedCore_WhenAlreadyCanonical_IsNull', () => {
    expect(resolvedCallsignCore('callsign', 'M7TEE')).toBeNull();
  });
  it('ResolvedCore_WhenWildcardOrNegationOrOperator_IsNotResolved', () => {
    // Power-query forms are matched literally, never silently widened.
    expect(resolvedCallsignCore('callsign', 'MW*')).toBeNull();
    expect(resolvedCallsignCore('callsign', '!MW7TEE')).toBeNull();
    expect(resolvedCallsignCore('callsign', '= MW7TEE')).toBeNull();
  });
  it('ResolvedCore_WhenNonCallsignColumn_IsNull', () => {
    expect(resolvedCallsignCore('product', 'MW7TEE')).toBeNull();
  });
});

describe('buildPredicate', { tags: ['ui'] }, () => {
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

describe('isDefaultSort', { tags: ['ui'] }, () => {
  it('DefaultSort_WhenCallsignAsc_IsTrue', () => {
    expect(isDefaultSort([{ col: 'callsign', dir: 'ASC' }])).toBe(true);
  });
  it('DefaultSort_WhenAnythingElse_IsFalse', () => {
    expect(isDefaultSort([{ col: 'status', dir: 'ASC' }])).toBe(false);
    expect(isDefaultSort([{ col: 'callsign', dir: 'DESC' }])).toBe(false);
    expect(isDefaultSort([{ col: 'callsign', dir: 'ASC' }, { col: 'status', dir: 'ASC' }])).toBe(false);
  });
});

describe('callsignCharMarker', { tags: ['ui'] }, () => {
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

describe('callsignCharMarker — unicode edge cases', { tags: ['ui'] }, () => {
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

describe('matchingCountSql', { tags: ['ui'] }, () => {
  it('CountSql_ScopesToDatasetAndPredicate', () => {
    expect(matchingCountSql('2026-06-23', `"status" IN ('Reserved')`))
      .toBe(`SELECT COUNT(*) AS n FROM register_history WHERE dataset = '2026-06-23' AND ("status" IN ('Reserved'))`);
  });
  it('CountSql_QuotesDatasetKey', () => {
    // Defensive: the dataset key is interpolated as a literal, quote-escaped.
    expect(matchingCountSql("o'dd", '1=1')).toContain(`dataset = 'o''dd'`);
  });
});

describe('setDiffSql', { tags: ['ui'] }, () => {
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

describe('serialize/parse round-trip', { tags: ['ui'] }, () => {
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

// The shared ?view= round-trip (issue #214): both browsers turn state into the
// query-param value, restore state FROM the param on first load and on
// back/forward, and decide whether a sync should touch the History API.
describe('stateToViewParam / viewParamToState round-trip', { tags: ['ui'] }, () => {
  it('ViewParam_WhenPristineState_IsNull', () => {
    // A pristine view emits no param, so the caller deletes ?view= entirely.
    expect(stateToViewParam(state())).toBeNull();
  });
  it('ViewParam_WhenFiltered_RoundTripsToSamePredicateAndState', () => {
    // The user-facing contract: a ?view= link reproduces the same query. We
    // serialise, re-parse via the URL string, apply to a fresh state, and
    // confirm the SQL predicate and the visible state match the original.
    const original = state({
      facets: new Map([['status', facet('status', ['Reserved', 'Allocated'], { exclude: true })]]),
      toggles: new Set(['forbidden']),
      columnFilters: new Map([['callsign', '2*T']]),
      sort: [{ col: 'status', dir: 'DESC' }],
      pageSize: 100,
    });
    const param = stateToViewParam(original);
    expect(param).not.toBeNull();
    const restored = state();
    applyViewToState(restored, viewParamToState(param));
    expect(buildPredicate(restored, { dataset: 'D' })).toBe(buildPredicate(original, { dataset: 'D' }));
    expect([...(restored.facets.get('status')?.values ?? [])]).toEqual(['Reserved', 'Allocated']);
    expect(restored.facets.get('status')?.exclude).toBe(true);
    expect([...restored.toggles]).toEqual(['forbidden']);
    expect([...restored.columnFilters]).toEqual([['callsign', '2*T']]);
    expect(restored.sort).toEqual([{ col: 'status', dir: 'DESC' }]);
    expect(restored.pageSize).toBe(100);
  });
  it('ViewParamToState_WhenNullParam_YieldsPristinePieces', () => {
    // No ?view= at all (a bare page load) parses to nothing to apply.
    expect(viewParamToState(null)).toEqual({});
  });
  it('ViewParamToState_WhenMalformedLink_DegradesToPristine', () => {
    // A hand-mangled or truncated share link must not throw; it falls back to
    // the pristine view rather than breaking the page.
    expect(viewParamToState('{not json')).toEqual({});
    expect(viewParamToState('"a string, not an object"')).toEqual({});
  });
});

describe('applyViewToState', { tags: ['ui'] }, () => {
  it('ApplyView_WhenPieceAbsentFromLink_ResetsItToDefault', () => {
    // Back/forward must restore each state exactly: navigating to a link that
    // omits a facet has to CLEAR a facet left over from a later state, not keep
    // it. This is the difference between a total restore and an accumulating one.
    const live = state({
      facets: new Map([['status', facet('status', ['Reserved'])]]),
      toggles: new Set(['forbidden']),
      pageSize: 500,
      sort: [{ col: 'status', dir: 'DESC' }],
      customSql: 'SELECT 1',
    });
    applyViewToState(live, viewParamToState(null)); // an empty (pristine) link
    expect(live.facets.size).toBe(0);
    expect(live.toggles.size).toBe(0);
    expect(live.columnFilters.size).toBe(0);
    expect(live.pageSize).toBe(25);
    expect(live.sort).toEqual([{ col: 'callsign', dir: 'ASC' }]);
    expect(live.customSql).toBeNull();
  });
});

describe('historySyncAction', { tags: ['ui'] }, () => {
  it('HistorySync_WhenUrlUnchanged_WritesNothing', () => {
    // A no-op / programmatic sync (paginating, first load, an idempotent
    // refresh) leaves history alone rather than duplicating an entry.
    expect(historySyncAction('/p?view=x', '/p?view=x', false)).toBe('none');
    expect(historySyncAction('/p?view=x', '/p?view=x', true)).toBe('none');
  });
  it('HistorySync_WhenDiscreteChangeStartsBurst_PushesNewEntry', () => {
    // The leading edge of a burst pushes, preserving the previous state for Back.
    expect(historySyncAction('/p?view=a', '/p?view=b', false)).toBe('push');
  });
  it('HistorySync_WhenChangeDuringBurst_ReplacesToCoalesce', () => {
    // A rapid follow-up within the debounce window replaces the just-pushed
    // entry, so a burst collapses to one history step.
    expect(historySyncAction('/p?view=b', '/p?view=c', true)).toBe('replace');
  });
});
