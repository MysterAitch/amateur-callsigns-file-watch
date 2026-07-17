import { describe, it, expect } from 'vitest';
import { flagEmoji, allocationHeadline, ALLOCATION_ATTRIBUTION } from './country-flag.js';

// The edge presentation of an ITU call-sign-series allocation: the flag glyph
// is composed from a stored ISO 3166-1 alpha-2 code at render time (canonical
// data stays the two plain letters), and the wording is strictly
// issuer-attributed - it names who HOLDS the call-sign series, never the
// operator's nationality. Test names follow Subject_Scenario_Outcome.

describe('flagEmoji — ISO alpha-2 to Regional Indicator glyph', { tags: ['unit'] }, () => {
  it('FlagEmoji_WhenGivenAValidAlpha2Code_ComposesTheTwoRegionalIndicators', () => {
    // IE -> U+1F1EE U+1F1EA. Assert by codepoint so the test does not depend on
    // the terminal rendering the emoji.
    const flag = flagEmoji('IE');
    expect([...flag].map(c => c.codePointAt(0))).toEqual([0x1f1ee, 0x1f1ea]);
    expect(flag).toBe('\u{1F1EE}\u{1F1EA}');
  });

  it('FlagEmoji_WhenGivenLowercaseOrPaddedCode_NormalisesBeforeComposing', () => {
    expect(flagEmoji(' ie ')).toBe(flagEmoji('IE'));
    expect(flagEmoji('gb')).toBe('\u{1F1EC}\u{1F1E7}');
  });

  it('FlagEmoji_WhenCodeIsBlank_ReturnsEmptyStringForOrganisationsWithNoFlag', () => {
    // International Civil Aviation Organization / United Nations / WMO hold
    // call-sign series but have no national flag: surfaced by name, never with
    // a placeholder glyph.
    expect(flagEmoji('')).toBe('');
    expect(flagEmoji(null)).toBe('');
    expect(flagEmoji(undefined)).toBe('');
  });

  it('FlagEmoji_WhenCodeIsMalformed_ReturnsEmptyStringRatherThanGuess', () => {
    expect(flagEmoji('X')).toBe('');
    expect(flagEmoji('USA')).toBe('');
    expect(flagEmoji('G1')).toBe('');
    expect(flagEmoji(42)).toBe('');
  });
});

describe('allocationHeadline — issuer-attributed wording', { tags: ['ui'] }, () => {
  it('AllocationHeadline_WhenSeriesResolved_AttributesTheSeriesToItsHolderNeverTheOperator', () => {
    const line = allocationHeadline({ cleaned: 'EI8DJ', country: 'Ireland', series: 'EIA - EJZ' }, flagEmoji('IE'));
    // Names the allocation holder with the neutral "allocated to" verb...
    expect(line).toContain('allocated to Ireland');
    expect(line).toContain('EI8DJ');
    expect(line).toContain('EIA - EJZ');
    expect(line).toContain(flagEmoji('IE'));
    // ...and never implies the operator's nationality or origin.
    expect(line.toLowerCase()).not.toMatch(/\b(irish|nationality|origin|from ireland|citizen)\b/);
  });

  it('AllocationHeadline_WhenSeriesUnknownButBlockResolved_StillNamesOnlyTheAllocationHolder', () => {
    const line = allocationHeadline({ cleaned: 'W1AW', country: 'United States of America', series: null }, flagEmoji('US'));
    expect(line).toContain('allocated to United States of America');
    expect(line).toContain('W1AW');
    expect(line).toContain(flagEmoji('US'));
  });

  it('AllocationHeadline_WhenHolderIsAnOrganisationWithoutAFlag_ReadsCleanlyWithNoGlyph', () => {
    // A blank flag must not leave a stray leading space or a broken glyph.
    const line = allocationHeadline({ cleaned: 'ABC', country: 'United Nations', series: 'ABC - ABC' }, flagEmoji(''));
    expect(line.startsWith(' ')).toBe(false);
    expect(line).toContain('allocated to United Nations');
    expect(line).not.toContain('undefined');
  });

  it('AllocationAttribution_Always_StatesSeriesHolderNotOperatorNationality', () => {
    // The standing epistemic line that accompanies every allocation surface.
    expect(ALLOCATION_ATTRIBUTION.toLowerCase()).toContain('holder of the call sign series');
    expect(ALLOCATION_ATTRIBUTION.toLowerCase()).toContain('not');
    expect(ALLOCATION_ATTRIBUTION).toContain('ITU');
  });
});
