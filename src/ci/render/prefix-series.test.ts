import { describe, it, expect } from 'vitest';
import { prefixSeriesField, prefixSeriesDisplay, prefixSeriesSlug, PREFIX_SERIES_CLASS } from './prefix-series.ts';
import { CALLSIGN_CLASS } from './callsign.ts';

// The shared prefix-series field wrapper (issue #644). Every prefix series
// displayed on a generated page routes through `prefixSeriesField`, which
// carries the SAME stable base class as a callsign (CALLSIGN_CLASS), applies
// the site-wide bare-vs-displayed convention, and offers the series-page
// crosslink where the context opts in. Test names follow the
// Subject_Scenario_Outcome convention.

describe('prefixSeriesField wrapper', { tags: ['unit'] }, () => {
  it('PrefixSeriesField_WhenPlainSeries_RendersTheDisplayedFormWithTheSharedCallsignClass', () => {
    // The default form inserts the # RSL-slot marker after the leading
    // character - the uniform display convention - and carries BOTH the
    // shared callsign base class and the series-specific modifier.
    expect(prefixSeriesField('M7')).toBe(`<span class="${CALLSIGN_CLASS} ${PREFIX_SERIES_CLASS}">M#7</span>`);
  });

  it('PrefixSeriesField_WhenBareFormPinned_ShowsTheStoredKeyWithNoHashInserted', () => {
    // The drift-guard rule (#644, following #553): a usage that genuinely
    // needs the raw stored identity states it explicitly.
    expect(prefixSeriesField('M7', { form: 'bare' })).toBe(`<span class="${CALLSIGN_CLASS} ${PREFIX_SERIES_CLASS}">M7</span>`);
  });

  it('PrefixSeriesField_WhenValueAlreadyDisplayedWithAHash_LeavesItUnchanged', () => {
    // A value that already carries the display-form hash (e.g. re-rendering
    // an already-displayed string) is not double-marked.
    expect(prefixSeriesDisplay('M#7')).toBe('M#7');
  });

  it('PrefixSeriesField_WhenLinkRequested_RendersAnAnchorToTheSeriesPageAtTheGivenDepth', () => {
    const html = prefixSeriesField('M7', { link: { depthToRoot: 3 } });
    expect(html).toBe(`<a class="${CALLSIGN_CLASS} ${PREFIX_SERIES_CLASS}" href="../../../series/M7.html">M#7</a>`);
  });

  it('PrefixSeriesField_WhenNoLinkRequested_RendersPlainContentNotANavigationTarget', () => {
    expect(prefixSeriesField('M7')).not.toContain('<a');
  });

  it('PrefixSeriesField_WhenBlank_HumanisesToBlankLabelRatherThanAnEmptyElement', () => {
    // An unparseable callsign has no series - a blank is itself information,
    // never silently absent.
    expect(prefixSeriesField('')).toBe(`<em class="${CALLSIGN_CLASS} ${PREFIX_SERIES_CLASS}-blank">(blank)</em>`);
  });

  it('PrefixSeriesField_WhenBlankAndLinkRequested_StillCarriesNoLinkSinceThereIsNoSeriesToPointAt', () => {
    const html = prefixSeriesField('', { link: { depthToRoot: 1 } });
    expect(html).toBe(`<em class="${CALLSIGN_CLASS} ${PREFIX_SERIES_CLASS}-blank">(blank)</em>`);
  });

  it('PrefixSeriesField_WhenBlankLabelPinned_UsesTheStatedWording', () => {
    expect(prefixSeriesField('', { blankLabel: '(no series)' })).toBe(`<em class="${CALLSIGN_CLASS} ${PREFIX_SERIES_CLASS}-blank">(no series)</em>`);
  });

  it('PrefixSeriesField_WhenExtraClassGiven_AppendsAfterTheStableClasses', () => {
    expect(prefixSeriesField('M7', { extraClass: 'hero' })).toBe(`<span class="${CALLSIGN_CLASS} ${PREFIX_SERIES_CLASS} hero">M#7</span>`);
  });

  it('PrefixSeriesField_WhenValueContainsUnusualCharacters_RendersThemAsPlainEscapedTextNotMarked', () => {
    // Deliberately no odd-character marking (unlike ./suffix.ts): a prefix
    // series is a bounded, already-validated vocabulary by the time this
    // wrapper ever sees it, not raw free text - so a stray character is
    // escaped for safety but never exploded into a {marker} span. A single
    // character has no second character to insert the display-form hash
    // after, so it passes straight through to escaping.
    const html = prefixSeriesField('<');
    expect(html).not.toContain('marker');
    expect(html).toBe(`<span class="${CALLSIGN_CLASS} ${PREFIX_SERIES_CLASS}">&lt;</span>`);
  });

  it('PrefixSeriesField_WhenExtraClassContainsMarkupCharacters_EscapesThemInTheLinkFormToo', () => {
    const html = prefixSeriesField('M7', { link: { depthToRoot: 0 }, extraClass: '<x>' });
    expect(html).toContain('&lt;x&gt;');
  });
});

describe('prefixSeriesDisplay (bare vs displayed forms)', { tags: ['unit'] }, () => {
  it('PrefixSeriesDisplay_DefaultForm_InsertsTheHashAfterTheLeadingCharacter', () => {
    expect(prefixSeriesDisplay('M7')).toBe('M#7');
    expect(prefixSeriesDisplay('20')).toBe('2#0');
    expect(prefixSeriesDisplay('G0')).toBe('G#0');
  });

  it('PrefixSeriesDisplay_BareForm_ReturnsTheStoredValueUnchanged', () => {
    expect(prefixSeriesDisplay('M7', 'bare')).toBe('M7');
  });

  it('PrefixSeriesDisplay_BlankValue_StaysBlankInEitherForm', () => {
    expect(prefixSeriesDisplay('')).toBe('');
    expect(prefixSeriesDisplay('', 'bare')).toBe('');
  });

  it('PrefixSeriesDisplay_SingleCharacterSeries_HasNoSecondCharacterToInsertAfter', () => {
    // Length < 2 is left untouched rather than throwing on an out-of-range slice.
    expect(prefixSeriesDisplay('M')).toBe('M');
  });
});

describe('prefixSeriesSlug', { tags: ['unit'] }, () => {
  it('PrefixSeriesSlug_BareStoredName_IsTheIdentity', () => {
    expect(prefixSeriesSlug('M7')).toBe('M7');
  });

  it('PrefixSeriesSlug_DisplayFormInput_StripsTheHashGuardingAgainstAMisusedCaller', () => {
    expect(prefixSeriesSlug('M#7')).toBe('M7');
  });

  it('PrefixSeriesSlug_BlankValue_IsBlank', () => {
    expect(prefixSeriesSlug('')).toBe('');
  });
});
