import { describe, it, expect } from 'vitest';
import { suffixField, SUFFIX_CLASS } from './suffix.ts';
import { CALLSIGN_CLASS } from './callsign.ts';

// The shared callsign-suffix field wrapper (issue #644). Every forbidden
// suffix displayed on a generated page routes through `suffixField`, which
// carries the SAME stable base class as a callsign (CALLSIGN_CLASS), marks
// odd characters visibly by the shared #553/#610 convention (this is raw
// published FOI data, not a validated vocabulary), and offers the
// per-suffix-page crosslink where the context both wants one and knows the
// page exists. Test names follow the Subject_Scenario_Outcome convention.

describe('suffixField wrapper', { tags: ['unit'] }, () => {
  it('SuffixField_WhenPlainSuffix_RendersAMonospaceChipWithTheSharedCallsignClass', () => {
    expect(suffixField('ABC')).toBe(`<code class="${CALLSIGN_CLASS} ${SUFFIX_CLASS}">ABC</code>`);
  });

  it('SuffixField_WhenLinkRequestedFromTheSectionIndex_RendersTheSuffixPageAnchor', () => {
    expect(suffixField('QNF', { link: { from: 'index' } }))
      .toBe(`<a class="${CALLSIGN_CLASS} ${SUFFIX_CLASS}" href="suffix/QNF/index.html">QNF</a>`);
  });

  it('SuffixField_WhenLinkRequestedFromADisclosurePage_ResolvesTheRelativeSuffixHref', () => {
    expect(suffixField('ZFJ', { link: { from: 'disclosure' } }))
      .toBe(`<a class="${CALLSIGN_CLASS} ${SUFFIX_CLASS}" href="../suffix/ZFJ/index.html">ZFJ</a>`);
  });

  it('SuffixField_WhenLinkRequestedFromAnotherSuffixPage_ResolvesTheSiblingSuffixHref', () => {
    expect(suffixField('ABC', { link: { from: 'suffix' } }))
      .toBe(`<a class="${CALLSIGN_CLASS} ${SUFFIX_CLASS}" href="../ABC/index.html">ABC</a>`);
  });

  it('SuffixField_WhenUnknownSuffixWithNoLinkRequested_RendersPlainContentNotAFabricatedLink', () => {
    // The "unknown suffix" case: a suffix with no known per-suffix page (or a
    // caller that simply has not established one) never gets a manufactured
    // navigation target - link is opt-in, and omitting it is always safe.
    const html = suffixField('XYZ');
    expect(html).not.toContain('<a');
    expect(html).toBe(`<code class="${CALLSIGN_CLASS} ${SUFFIX_CLASS}">XYZ</code>`);
  });

  it('SuffixField_WhenValueCarriesInvisibleCharacters_MarksThemVisiblyByDefault', () => {
    // Unlike ./prefix-series.ts, a suffix is raw declared text straight from
    // an FOI disclosure - the transparency rule applies exactly as it does
    // for a callsign: damage must never hide.
    expect(suffixField('A C')).toBe(`<code class="${CALLSIGN_CLASS} ${SUFFIX_CLASS}">A<span class="marker">{SP}</span>C</code>`);
  });

  it('SuffixField_WhenOddCharactersPinnedVerbatim_RendersUnmarked', () => {
    // The drift-guard rule (#644, following #553): a usage that requires no
    // marking (a value known clean by construction) states it explicitly.
    expect(suffixField('A C', { oddCharacters: 'verbatim' })).toBe(`<code class="${CALLSIGN_CLASS} ${SUFFIX_CLASS}">A C</code>`);
  });

  it('SuffixField_WhenMarkedValueIsAlsoLinked_CarriesTheMarkerInsideTheAnchor', () => {
    const html = suffixField('A C', { link: { from: 'index' } });
    expect(html).toBe(`<a class="${CALLSIGN_CLASS} ${SUFFIX_CLASS}" href="suffix/A%20C/index.html">A<span class="marker">{SP}</span>C</a>`);
  });

  it('SuffixField_WhenBlank_HumanisesToBlankLabelRatherThanAnEmptyElement', () => {
    expect(suffixField('')).toBe(`<em class="${CALLSIGN_CLASS} ${SUFFIX_CLASS}-blank">(blank)</em>`);
  });

  it('SuffixField_WhenBlankLabelPinned_UsesTheStatedWording', () => {
    expect(suffixField('', { blankLabel: '(no suffix)' })).toBe(`<em class="${CALLSIGN_CLASS} ${SUFFIX_CLASS}-blank">(no suffix)</em>`);
  });

  it('SuffixField_WhenExtraClassGiven_AppendsAfterTheStableClasses', () => {
    expect(suffixField('ABC', { extraClass: 'hero' })).toBe(`<code class="${CALLSIGN_CLASS} ${SUFFIX_CLASS} hero">ABC</code>`);
  });

  it('SuffixField_WhenValueContainsMarkupCharacters_EscapesThemEverywhere', () => {
    const html = suffixField('<b>&"');
    expect(html).not.toContain('<b>');
    expect(html).toContain('<span class="marker">&lt;</span>');
    expect(html).toContain('<span class="marker">&amp;</span>');
    expect(html).toContain('<span class="marker">&quot;</span>');
  });
});
