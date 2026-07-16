import { describe, it, expect } from 'vitest';
import { callsignField, callsignDisplay, callsignCharMarker, callsignPill, CALLSIGN_CLASS } from './callsign.ts';
import { callsignCharMarker as browserCallsignCharMarker, translateMarkerToken, CALLSIGN_CHAR_NAMES } from '../../../site/browser-query.js';

// The shared callsign field wrapper (issue #553). Every callsign displayed on
// a generated page routes through `callsignField`, which renders one stable
// class, marks odd characters visibly by the shared convention (the server
// twin of site/browser-query.js's callsignCharMarker), and offers the
// register-lookup crosslink where the context opts in. Test names follow the
// Subject_Scenario_Outcome convention.

describe('callsignField wrapper', { tags: ['unit'] }, () => {
  it('CallsignField_WhenPlainCallsign_RendersAMonospaceChipWithTheStableClass', () => {
    // The default form: a non-link <code> chip carrying the one stable class,
    // the callsign as its own accessible text, and no fabricated title.
    expect(callsignField('M7TEE')).toBe(`<code class="${CALLSIGN_CLASS}">M7TEE</code>`);
  });

  it('CallsignField_WhenLookupRequested_RendersThePillLinkAtTheGivenDepth', () => {
    // The crosslink affordance is opt-in and explicit: the context states
    // where the register lookup lives relative to the page.
    expect(callsignField('M7TEE', { lookup: { depthToRoot: 3 } }))
      .toBe(`<a class="${CALLSIGN_CLASS} callsign-pill" href="../../../index.html?c=M7TEE">M7TEE</a>`);
  });

  it('CallsignField_VisitorCallsignWithSlash_EncodesTheLookupHrefButShowsTheSlashPlain', () => {
    // A slash is meaningful callsign notation (a visitor form): plain in the
    // display, URL-encoded in the href so the link stays well-formed.
    const html = callsignField('M/DL1ABC', { lookup: { depthToRoot: 1 } });
    expect(html).toContain('href="../index.html?c=M%2FDL1ABC"');
    expect(html).toContain('>M/DL1ABC</a>');
    expect(html).not.toContain('marker');
  });

  it('CallsignField_RslPlaceholderHash_IsPlainCallsignAlphabetNotAnOddCharacter', () => {
    // '#' is the RSL-slot convention (M#7TEE), part of the plain alphabet.
    expect(callsignField('M#7TEE')).toBe(`<code class="${CALLSIGN_CLASS}">M#7TEE</code>`);
  });

  it('CallsignField_WhenValueCarriesInvisibleCharacters_MarksThemVisibly', () => {
    // The transparency rule: whitespace and other invisibles in a published
    // callsign must never hide - they render as highlighted, named markers.
    expect(callsignField('G6 FMU')).toBe(`<code class="${CALLSIGN_CLASS}">G6<span class="marker">{SP}</span>FMU</code>`);
    expect(callsignField('M7 TEE')).toContain('<span class="marker">{NBSP}</span>');
    expect(callsignField('M7​TEE')).toContain('<span class="marker">{ZWSP}</span>');
  });

  it('CallsignField_WhenValueCarriesAVisibleStray_HighlightsItWithoutRenamingIt', () => {
    // A visible stray (a hyphen from a spreadsheet date rendering) stays
    // readable as itself but is highlighted so it cannot pass unnoticed.
    expect(callsignField('20-Apr')).toBe(`<code class="${CALLSIGN_CLASS}">20<span class="marker">-</span>Apr</code>`);
  });

  it('CallsignField_WhenOddCharactersPinnedVerbatim_RendersUnmarked', () => {
    // The drift-guard rule (#553): a usage that requires no marking states it
    // explicitly, and is then insulated from the movable default.
    expect(callsignField('G6 FMU', { oddCharacters: 'verbatim' })).toBe(`<code class="${CALLSIGN_CLASS}">G6 FMU</code>`);
  });

  it('CallsignField_WhenValueIsPreMarked_TranslatesCodepointTokensToFriendlyNamesKeepingTheCodepointInTitle', () => {
    // A stats.json example carries {U+XXXX} markers from derivation time: the
    // wrapper highlights those tokens, translating each to its friendly name at
    // the edge (#610) while keeping the exact code point in the title; it never
    // marks the braces.
    expect(callsignField('G6{U+0020}FMU', { oddCharacters: 'pre-marked' }))
      .toBe(`<code class="${CALLSIGN_CLASS}">G6<span class="marker" title="space (U+0020)">{SP}</span>FMU</code>`);
    expect(callsignField('2E1HON{U+00A0}', { oddCharacters: 'pre-marked' }))
      .toBe(`<code class="${CALLSIGN_CLASS}">2E1HON<span class="marker" title="non-breaking space (U+00A0)">{NBSP}</span></code>`);
  });

  it('CallsignField_WhenPreMarkedTokenHasNoFriendlyName_KeepsTheCodepointTokenUntranslated', () => {
    // A code point with no recognised name stays as its {U+XXXX} token with no
    // title - derivation already wrote the unambiguous form; there is nothing
    // friendlier to say. U+FFFD (the replacement character) is deliberately in
    // this class.
    expect(callsignField('G0ABC{U+FFFD}', { oddCharacters: 'pre-marked' }))
      .toBe(`<code class="${CALLSIGN_CLASS}">G0ABC<span class="marker">{U+FFFD}</span></code>`);
    expect(callsignField('X{U+1F600}', { oddCharacters: 'pre-marked' }))
      .toBe(`<code class="${CALLSIGN_CLASS}">X<span class="marker">{U+1F600}</span></code>`);
  });

  it('CallsignField_WhenPreMarkedTokenIsMalformedOrALiteralBrace_LeavesItUntouchedWithoutDoubleMarking', () => {
    // A malformed {U+} fragment and a literal {…} that is not a code-point
    // token are neither translated nor re-marked: the no-double-marking
    // guarantee holds.
    expect(callsignField('A{U+}B', { oddCharacters: 'pre-marked' }))
      .toBe(`<code class="${CALLSIGN_CLASS}">A<span class="marker">{U+}</span>B</code>`);
    expect(callsignField('A{FOO}B', { oddCharacters: 'pre-marked' }))
      .toBe(`<code class="${CALLSIGN_CLASS}">A<span class="marker">{FOO}</span>B</code>`);
  });

  it('CallsignField_WhenBlankCallsign_HumanisesToBlankAndCarriesNoLookupLink', () => {
    // A blank value is itself information: never an empty element, and never a
    // link to a lookup of nothing - even when the context asked for one.
    const html = callsignField('', { lookup: { depthToRoot: 2 } });
    expect(html).toBe(`<em class="${CALLSIGN_CLASS} cs-blank">(blank)</em>`);
  });

  it('CallsignField_WhenBlankLabelPinned_UsesTheStatedWording', () => {
    // A surface with an established blank wording pins it explicitly.
    expect(callsignField('', { blankLabel: '(empty value)' })).toBe(`<em class="${CALLSIGN_CLASS} cs-blank">(empty value)</em>`);
  });

  it('CallsignField_WhenComponentsSupplied_AddsSupplementaryTitleButKeepsCallsignAsAccessibleName', () => {
    const html = callsignField('M7TEE', {
      lookup: { depthToRoot: 1 },
      components: { prefixSeries: 'M7', suffix: 'TEE', licenceClass: 'Foundation' },
    });
    expect(html).toBe(`<a class="${CALLSIGN_CLASS} callsign-pill" href="../index.html?c=M7TEE" title="M7TEE — prefix series M7 · suffix TEE · Foundation">M7TEE</a>`);
    expect(html).not.toContain('aria-label');
  });

  it('CallsignField_WhenComponentFieldsAreEmpty_OmitsThemFromTheTitleRatherThanRenderingBlank', () => {
    // Empty component fields are absences, not facts: no title is fabricated.
    expect(callsignField('M7TEE', { components: { prefixSeries: '', rsl: '', suffix: '' } }))
      .toBe(`<code class="${CALLSIGN_CLASS}">M7TEE</code>`);
  });

  it('CallsignField_WhenExtraClassGiven_AppendsAfterTheStableClass', () => {
    expect(callsignField('M7TEE', { extraClass: 'hero' })).toBe(`<code class="${CALLSIGN_CLASS} hero">M7TEE</code>`);
  });

  it('CallsignField_WhenValueContainsMarkupCharacters_EscapesThemEverywhere', () => {
    // Register bytes are untrusted: markup characters are highlighted strays
    // AND escaped, in the display and in any title.
    const html = callsignField('<b>&"');
    expect(html).not.toContain('<b>');
    expect(html).toContain('<span class="marker">&lt;</span>');
    expect(html).toContain('<span class="marker">&amp;</span>');
    expect(html).toContain('<span class="marker">&quot;</span>');
  });
});

describe('callsignDisplay marking conventions', { tags: ['unit'] }, () => {
  it('CallsignDisplay_PlainAlphabet_PassesThroughUnchanged', () => {
    expect(callsignDisplay('M7TEE')).toBe('M7TEE');
    expect(callsignDisplay('2E0ABC/P')).toBe('2E0ABC/P');
  });

  it('CallsignDisplay_LowercaseLetters_ArePlainAlphabetNotMarked', () => {
    // Lowercase is a data-quality signal handled by the detectors, but each
    // letter is a legible glyph - shown as-is, never exploded to a marker.
    expect(callsignDisplay('g0jrk')).toBe('g0jrk');
  });

  it('CallsignDisplay_ReplacementCharacter_CarriesItsNamedMarker', () => {
    // Encoding damage (U+FFFD) is named, matching the browser convention.
    expect(callsignDisplay('G0ABC�')).toBe('G0ABC<span class="marker">{U+FFFD}</span>');
  });

  it('CallsignDisplay_PreMarkedTextAroundMarkers_IsEscapedButNotReMarked', () => {
    // Only the {…} tokens are highlighted; surrounding text is escaped as-is
    // (a pre-marked value's spaces were already exploded upstream).
    expect(callsignDisplay('{SP}<x>{U+FFFD}', 'pre-marked'))
      .toBe('<span class="marker">{SP}</span>&lt;x&gt;<span class="marker">{U+FFFD}</span>');
  });
});

describe('callsignCharMarker (re-exported from the single source site/browser-query.js)', { tags: ['unit'] }, () => {
  it('CallsignCharMarker_PlainAlphabet_ReturnsNull', () => {
    for (const ch of 'M7TEE/2E0abc#') expect(callsignCharMarker(ch)).toBeNull();
  });

  it('CallsignCharMarker_NamedInvisibles_ReturnFriendlyNames', () => {
    expect(callsignCharMarker(' ')).toBe('{SP}');
    expect(callsignCharMarker(' ')).toBe('{NBSP}');
    expect(callsignCharMarker('\t')).toBe('{TAB}');
    expect(callsignCharMarker(String.fromCodePoint(0x200b))).toBe('{ZWSP}'); // zero-width space (#610)
    expect(callsignCharMarker('�')).toBe('{U+FFFD}');
  });

  it('CallsignCharMarker_UnnamedInvisibles_ReturnCodepointMarkers', () => {
    expect(callsignCharMarker(String.fromCodePoint(0x200c))).toBe('{U+200C}'); // zero-width non-joiner: no friendly name
    expect(callsignCharMarker(String.fromCodePoint(0x07))).toBe('{U+0007}'); // bell control
    expect(callsignCharMarker(String.fromCodePoint(0x301))).toBe('{U+0301}'); // combining mark
  });

  it('CallsignCharMarker_VisibleStrays_ReturnTheCharacterItself', () => {
    expect(callsignCharMarker('-')).toBe('-');
    expect(callsignCharMarker('.')).toBe('.');
    expect(callsignCharMarker('é')).toBe('é');
  });
});

describe('callsignPill delegates to the field wrapper (#553 convergence)', { tags: ['unit'] }, () => {
  it('CallsignPill_AsTheLinkedInstanceOfTheWrapper_MatchesCallsignFieldWithLookup', () => {
    expect(callsignPill('M7TEE', 3)).toBe(callsignField('M7TEE', { lookup: { depthToRoot: 3 } }));
    expect(callsignPill('M7TEE', 1, { suffix: 'TEE' }))
      .toBe(callsignField('M7TEE', { lookup: { depthToRoot: 1 }, components: { suffix: 'TEE' } }));
  });
});

// The marker vocabulary is one shared table (#610): the render layer imports
// callsignCharMarker and the friendly-name translation from the single JS
// source, so a marker cannot drift between a generated page and the interactive
// browsers. These guards fail if the render module ever reintroduces a mirror.
describe('marker vocabulary single source of truth (#610 drift-guard)', { tags: ['unit'] }, () => {
  it('MarkerVocabulary_RenderTwinAndBrowserTwin_AreTheSameFunctionNotACopy', () => {
    // Identity, not mere equality: the render layer re-exports the browser's
    // marker rather than mirroring it, so the two can never diverge.
    expect(callsignCharMarker).toBe(browserCallsignCharMarker);
  });

  it('MarkerVocabulary_SharedNamingTable_CarriesTheFriendlyNamedInvisiblesIncludingZwsp', () => {
    // The one table both twins read: ZWSP joins the friendly set (#610).
    expect(CALLSIGN_CHAR_NAMES[0x20]).toBe('SP');
    expect(CALLSIGN_CHAR_NAMES[0xa0]).toBe('NBSP');
    expect(CALLSIGN_CHAR_NAMES[0x200b]).toBe('ZWSP');
  });

  it('MarkerVocabulary_PreMarkedTranslation_ReadsTheSharedTable', () => {
    // The pre-marked translation and the raw-marking twin agree, because both
    // resolve names through the one table: a {U+00A0} token becomes the same
    // {NBSP} the raw NBSP character marks, with the code point kept in the title.
    const { text, title } = translateMarkerToken('{U+00A0}');
    expect(text).toBe(`{${CALLSIGN_CHAR_NAMES[0xa0]}}`);
    expect(text).toBe(callsignCharMarker(String.fromCodePoint(0xa0)));
    expect(title).toBe('non-breaking space (U+00A0)');
  });

  it('MarkerVocabulary_PreMarkedTranslation_LeavesUnnamedAndMalformedTokensUntouched', () => {
    // A code point with no friendly name, U+FFFD (named as its own code point),
    // a malformed fragment and a non-token all pass through with no title.
    expect(translateMarkerToken('{U+200C}')).toEqual({ text: '{U+200C}', title: null });
    expect(translateMarkerToken('{U+FFFD}')).toEqual({ text: '{U+FFFD}', title: null });
    expect(translateMarkerToken('{U+}')).toEqual({ text: '{U+}', title: null });
    expect(translateMarkerToken('{SP}')).toEqual({ text: '{SP}', title: null });
  });
});
