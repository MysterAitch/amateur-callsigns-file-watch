// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  licenceField, licenceDisplay, LICENCE_CLASS, statusField, statusDisplay, STATUS_CLASS,
  prefixSeriesField, prefixSeriesDisplay, prefixSeriesSlug, PREFIX_SERIES_CLASS,
  suffixField, SUFFIX_CLASS,
} from './field-wrappers.js';
import { CALLSIGN_CLASS } from './callsign-pill.js';

// The browser-side licence/status field wrappers (issue #625) mirror the
// generated-page wrappers (src/ci/render/licence.ts, status.ts, issue #553/
// #623) so a value reads the same on the hand-authored surfaces (lookup,
// entry browser, compare, ledger dossier) as on the generated pages: a stable
// class, humanised blanks and, for a recognised status, a glossary crosslink.
// Test names follow the Subject_Scenario_Outcome convention.
//
// Also here (issue #658): the browser-side prefix-series/suffix field
// wrappers, mirroring src/ci/render/prefix-series.ts and suffix.ts (#644) -
// see the describe blocks below the status ones.

// The element factory the front-ends hold (app.js / entry-browser.js /
// compare.js / explore.js), mirrored so the wrappers are exercised exactly as
// they are in the browser.
function el(tag: string, attrs: Record<string, string> = {}): HTMLElement {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  return node;
}

describe('browser licenceField wrapper', { tags: ['ui'] }, () => {
  it('LicenceField_WhenFormOmitted_RendersAsDeclaredWithNoTitle', () => {
    const span = licenceField(el, 'Foundation');
    expect(span.tagName).toBe('SPAN');
    expect(span.className).toBe(LICENCE_CLASS);
    expect(span.textContent).toBe('Foundation');
    expect(span.getAttribute('title')).toBeNull();
  });

  it('LicenceField_WhenShortenedFormRequested_StripsTheBoilerplateButKeepsTheRawValueInTheTitle', () => {
    const span = licenceField(el, 'Amateur Full Radio Licence', { form: 'shortened' });
    expect(span.textContent).toBe('Full');
    expect(span.getAttribute('title')).toBe('Amateur Full Radio Licence');
  });

  it('LicenceField_ShortenedFormOnAValueWithNoBoilerplate_RendersUnchangedWithNoTitle', () => {
    const span = licenceField(el, 'Foundation', { form: 'shortened' });
    expect(span.textContent).toBe('Foundation');
    expect(span.getAttribute('title')).toBeNull();
  });

  it('LicenceField_WhenBlank_HumanisesToBlankRatherThanAnEmptyElement', () => {
    const em = licenceField(el, '');
    expect(em.tagName).toBe('EM');
    expect(em.className).toBe(`${LICENCE_CLASS} lic-blank`);
    expect(em.textContent).toBe('(blank)');
  });

  it('LicenceField_WhenBlankLabelPinned_UsesTheStatedWording', () => {
    const em = licenceField(el, '', { blankLabel: '(none stated)' });
    expect(em.textContent).toBe('(none stated)');
  });

  it('LicenceField_WhenExtraClassGiven_AppendsAfterTheStableClass', () => {
    const span = licenceField(el, 'Foundation', { extraClass: 'hero' });
    expect(span.className).toBe(`${LICENCE_CLASS} hero`);
    const em = licenceField(el, '', { extraClass: 'hero' });
    expect(em.className).toBe(`${LICENCE_CLASS} lic-blank hero`);
  });

  it('LicenceField_MixedCaseOrWhitespaceVariant_IsShownVerbatimNotNormalised', () => {
    expect(licenceField(el, 'foundation').textContent).toBe('foundation');
    expect(licenceField(el, ' Full ').textContent).toBe(' Full ');
  });
});

describe('browser licenceDisplay', { tags: ['ui'] }, () => {
  it('LicenceDisplay_AsDeclaredForm_PassesThroughUnchanged', () => {
    expect(licenceDisplay('Amateur Full Radio Licence')).toBe('Amateur Full Radio Licence');
  });

  it('LicenceDisplay_ShortenedForm_StripsBothTheLeadingAmateurAndTrailingRadioLicence', () => {
    expect(licenceDisplay('Amateur Foundation Radio Licence', 'shortened')).toBe('Foundation');
  });

  it('LicenceDisplay_ShortenedFormOnABlankValue_StaysBlank', () => {
    expect(licenceDisplay('', 'shortened')).toBe('');
  });
});

describe('browser statusField wrapper', { tags: ['ui'] }, () => {
  it('StatusField_WhenValueUnrecognised_RendersPlainTextWithTheStableClass', () => {
    // A value the glossary does not define (a typo, a future status not yet
    // catalogued) is never linked to a guess - it renders as plain text.
    const span = statusField(el, 'Suspended', { depthToRoot: 0 });
    expect(span.tagName).toBe('SPAN');
    expect(span.className).toBe(STATUS_CLASS);
    expect(span.textContent).toBe('Suspended');
    expect(span.querySelector('a')).toBeNull();
  });

  it('StatusField_WhenRecognisedButNoDepthGiven_RendersPlainTextRatherThanABrokenLink', () => {
    // Without a depth-to-root there is nowhere to resolve glossary.html from,
    // so even a recognised value stays plain rather than emitting a dangling href.
    const span = statusField(el, 'Allocated');
    expect(span.outerHTML).toBe(`<span class="${STATUS_CLASS}">Allocated</span>`);
  });

  it('StatusField_WhenRecognisedWithDepth_LinksToItsGlossaryDefinition', () => {
    const span = statusField(el, 'Allocated', { depthToRoot: 3 });
    const a = span.querySelector('a');
    expect(a?.className).toBe('gloss-term');
    expect(a?.getAttribute('href')).toBe('../../../glossary.html#allocated');
    expect(a?.textContent).toBe('Allocated? (definition of the Allocated status in the glossary)');
    expect(span.textContent).toBe('Allocated? (definition of the Allocated status in the glossary)');
  });

  it('StatusField_ForEveryEstablishedStatusValue_LinksToItsOwnAnchor', () => {
    // Reserved and Available (the ordinary three), plus the honestly-undefined
    // trio the glossary still names (Live, Forbidden, Quarantine) - all six
    // resolve to a real anchor, never a fabricated one.
    const cases: [string, string][] = [
      ['Reserved', 'reserved'],
      ['Available', 'available'],
      ['Live', 'status-live'],
      ['Forbidden', 'status-forbidden'],
      ['Quarantine', 'status-quarantine'],
    ];
    for (const [value, anchor] of cases) {
      const a = statusField(el, value, { depthToRoot: 1 }).querySelector('a');
      expect(a?.getAttribute('href')).toBe(`../glossary.html#${anchor}`);
    }
  });

  it('StatusField_EveryRecognisedAnchor_ResolvesToARealIdInTheShippedGlossary', () => {
    // The durable cross-check glossary-links.test.ts cannot run for this
    // module (it scans anchors written STATICALLY into *.html, not one this
    // module assembles at runtime from a template string), so this table's
    // anchors are verified directly against the shipped glossary here.
    const html = fs.readFileSync(path.join('site', 'glossary.html'), 'utf8');
    const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
    for (const value of ['Allocated', 'Reserved', 'Available', 'Live', 'Forbidden', 'Quarantine']) {
      const a = statusField(el, value, { depthToRoot: 0 }).querySelector('a');
      const anchor = a?.getAttribute('href')?.replace('glossary.html#', '');
      expect(ids.has(anchor ?? ''), `#${anchor} for "${value}" has no matching id in glossary.html`).toBe(true);
    }
  });

  it('StatusField_WhenPlainPinnedExplicitly_RendersUnlinkedEvenWhenRecognisedAndDepthGiven', () => {
    // The drift-guard rule (#553): a usage that requires no linking (a
    // per-record row repeating the same handful of values many times, or a
    // value nested inside a click-to-filter role="button" row where a nested
    // <a> would be an accessibility anti-pattern) states it explicitly.
    const span = statusField(el, 'Allocated', { depthToRoot: 3, glossaryLinking: 'plain' });
    expect(span.outerHTML).toBe(`<span class="${STATUS_CLASS}">Allocated</span>`);
  });

  it('StatusField_WhenBlank_HumanisesToBlankLabelRatherThanAnEmptyElement', () => {
    const em = statusField(el, '');
    expect(em.outerHTML).toBe(`<em class="${STATUS_CLASS} stat-blank">(blank)</em>`);
  });

  it('StatusField_WhenBlankLabelPinned_UsesTheStatedWording', () => {
    // A surface with an established synthetic placeholder (e.g. "(no status
    // recorded)" for a callsign never seen with a status row) pins it.
    const em = statusField(el, '', { blankLabel: '(no status recorded)' });
    expect(em.textContent).toBe('(no status recorded)');
  });

  it('StatusField_WhenExtraClassGiven_AppendsAfterTheStableClass', () => {
    expect(statusField(el, 'Allocated', { extraClass: 'hero' }).className).toBe(`${STATUS_CLASS} hero`);
    expect(statusField(el, '', { extraClass: 'hero' }).className).toBe(`${STATUS_CLASS} stat-blank hero`);
  });

  it('StatusField_WhenValueIsMixedCaseOrWhitespaceVariant_IsTreatedAsUnrecognisedNotFuzzyMatched', () => {
    // The register vocabulary is exact-match: 'allocated' (lowercase) or
    // ' Allocated' (leading space) is NOT silently coerced to the recognised
    // 'Allocated' - the raw value is shown faithfully, unlinked.
    expect(statusField(el, 'allocated', { depthToRoot: 1 }).querySelector('a')).toBeNull();
    expect(statusField(el, ' Allocated', { depthToRoot: 1 }).querySelector('a')).toBeNull();
  });
});

describe('browser statusDisplay', { tags: ['ui'] }, () => {
  it('StatusDisplay_PlainValue_PassesThroughUnchanged', () => {
    expect(statusDisplay('Allocated')).toBe('Allocated');
  });

  it('StatusDisplay_BlankValue_HumanisesToTheDefaultOrGivenLabel', () => {
    expect(statusDisplay('')).toBe('(blank)');
    expect(statusDisplay('', '(unknown)')).toBe('(unknown)');
  });
});

describe('browser prefixSeriesField wrapper', { tags: ['ui'] }, () => {
  it('PrefixSeriesField_WhenFormOmitted_InsertsTheHashRslSlotMarker', () => {
    // The default 'displayed' form: the bare stored value (M7) gains the `#`
    // RSL-slot marker after the leading character, matching every other
    // surface's "M#7" convention.
    const span = prefixSeriesField(el, 'M7');
    expect(span.tagName).toBe('SPAN');
    expect(span.className).toBe(`${CALLSIGN_CLASS} ${PREFIX_SERIES_CLASS}`);
    expect(span.textContent).toBe('M#7');
  });

  it('PrefixSeriesField_WhenBareFormRequested_ShowsTheStoredValueUnchanged', () => {
    const span = prefixSeriesField(el, 'M7', { form: 'bare' });
    expect(span.textContent).toBe('M7');
  });

  it('PrefixSeriesField_WhenValueAlreadyCarriesTheHash_IsShownUnchanged', () => {
    // Non-happy path: a caller that already passed a displayed-form value
    // through (M#7) is not double-marked.
    expect(prefixSeriesField(el, 'M#7').textContent).toBe('M#7');
  });

  it('PrefixSeriesField_WhenValueIsASingleCharacter_IsShownUnchanged', () => {
    // Non-happy path: there is no character after the leading one to insert
    // the marker before, so a one-character series (however unlikely) is left
    // exactly as stored rather than throwing or mangling it.
    expect(prefixSeriesField(el, 'M').textContent).toBe('M');
  });

  it('PrefixSeriesField_WhenLinkRequested_ProducesALinkToTheSeriesEntityPage', () => {
    const a = prefixSeriesField(el, 'M7', { link: { depthToRoot: 2 } });
    expect(a.tagName).toBe('A');
    expect(a.className).toBe(`${CALLSIGN_CLASS} ${PREFIX_SERIES_CLASS}`);
    expect(a.getAttribute('href')).toBe('../../series/M7.html');
    expect(a.textContent).toBe('M#7');
  });

  it('PrefixSeriesField_WhenValueAlreadyCarriesTheHashAndLinkRequested_StripsItFromTheHrefButNotTheLabel', () => {
    // Non-happy path: a caller that already holds a displayed-form value (the
    // hash guard above means it is shown unchanged) must still get a working
    // href - there is no series/2#0.html on disk, only series/20.html.
    const a = prefixSeriesField(el, '2#0', { link: { depthToRoot: 0 } });
    expect(a.getAttribute('href')).toBe('series/20.html');
    expect(a.textContent).toBe('2#0');
  });

  it('PrefixSeriesField_WhenBlank_HumanisesToBlankRatherThanAnEmptyElement', () => {
    const em = prefixSeriesField(el, '');
    expect(em.outerHTML).toBe(`<em class="${CALLSIGN_CLASS} ${PREFIX_SERIES_CLASS}-blank">(blank)</em>`);
  });

  it('PrefixSeriesField_WhenBlankLabelPinned_UsesTheStatedWording', () => {
    expect(prefixSeriesField(el, '', { blankLabel: '(unparseable — no series)' }).textContent).toBe('(unparseable — no series)');
  });

  it('PrefixSeriesField_WhenExtraClassGiven_AppendsAfterTheStableClasses', () => {
    expect(prefixSeriesField(el, 'M7', { extraClass: 'hero' }).className).toBe(`${CALLSIGN_CLASS} ${PREFIX_SERIES_CLASS} hero`);
  });

  it('PrefixSeriesField_NeverMarksOddCharacters_UnlikeTheCallsignAndSuffixWrappers', () => {
    // Deliberate divergence (mirroring prefix-series.ts): a series is a
    // controlled vocabulary by construction, so a stray odd character (were
    // one ever to reach here) is shown as plain text, never wrapped in a
    // `.marker` span. 'bare' form isolates this from the hash-insertion
    // transform above so the assertion is about marking alone.
    const span = prefixSeriesField(el, 'M7 ', { form: 'bare' });
    expect(span.querySelectorAll('.marker').length).toBe(0);
    expect(span.textContent).toBe('M7 ');
  });
});

describe('browser prefixSeriesDisplay/prefixSeriesSlug', { tags: ['ui'] }, () => {
  it('PrefixSeriesDisplay_BareTwoCharacterSeries_InsertsHashAfterLeadingCharacter', () => {
    expect(prefixSeriesDisplay('M7')).toBe('M#7');
  });

  it('PrefixSeriesDisplay_BareFormRequested_ReturnsTheStoredValueUnchanged', () => {
    expect(prefixSeriesDisplay('M7', 'bare')).toBe('M7');
  });

  it('PrefixSeriesSlug_DisplayedFormWithHash_StripsItForTheUrl', () => {
    expect(prefixSeriesSlug('M#7')).toBe('M7');
  });

  it('PrefixSeriesSlug_BareValueWithNoHash_IsUnchanged', () => {
    expect(prefixSeriesSlug('M7')).toBe('M7');
  });
});

describe('browser suffixField wrapper', { tags: ['ui'] }, () => {
  it('SuffixField_WhenOddCharactersOmitted_ProducesACodeChipWithTheStableClasses', () => {
    const code = suffixField(el, 'TEE');
    expect(code.tagName).toBe('CODE');
    expect(code.className).toBe(`${CALLSIGN_CLASS} ${SUFFIX_CLASS}`);
    expect(code.textContent).toBe('TEE');
    expect(code.querySelectorAll('.marker').length).toBe(0);
  });

  it('SuffixField_WhenValueCarriesAnOddCharacter_MarksItByDefault', () => {
    // The default 'marked': a suffix is raw text lifted verbatim from a
    // publication - the same risk profile as a whole callsign - so a stray
    // odd character must not hide.
    const code = suffixField(el, 'TE ');
    const markers = [...code.querySelectorAll('.marker')];
    expect(markers.length).toBe(1);
    expect(markers[0].textContent).toBe('{SP}');
    expect(code.textContent).toBe('TE{SP}');
  });

  it('SuffixField_WhenVerbatimRequested_ShowsTheValueWithNoMarkingEvenWithOddCharacters', () => {
    // The drift-guard rule (#658/#553): a usage that genuinely knows the value
    // is clean by construction states this explicitly.
    const code = suffixField(el, 'TE ', { oddCharacters: 'verbatim' });
    expect(code.querySelectorAll('.marker').length).toBe(0);
    expect(code.textContent).toBe('TE ');
  });

  it('SuffixField_WhenLinkRequested_ProducesALinkToThePerSuffixDetailPage', () => {
    const a = suffixField(el, 'QNF', { link: { depthToRoot: 0 } });
    expect(a.tagName).toBe('A');
    expect(a.className).toBe(`${CALLSIGN_CLASS} ${SUFFIX_CLASS}`);
    expect(a.getAttribute('href')).toBe('forbidden/suffix/QNF/index.html');
    expect(a.textContent).toBe('QNF');
  });

  it('SuffixField_WhenLinkRequestedFromADeeperPage_ResolvesTheHrefRelativeToThatDepth', () => {
    const a = suffixField(el, 'QNF', { link: { depthToRoot: 1 } });
    expect(a.getAttribute('href')).toBe('../forbidden/suffix/QNF/index.html');
  });

  it('SuffixField_WhenBlank_HumanisesToBlankRatherThanAnEmptyElement', () => {
    const em = suffixField(el, '');
    expect(em.outerHTML).toBe(`<em class="${CALLSIGN_CLASS} ${SUFFIX_CLASS}-blank">(blank)</em>`);
  });

  it('SuffixField_WhenBlankLabelPinned_UsesTheStatedWording', () => {
    expect(suffixField(el, '', { blankLabel: '(no suffix parsed)' }).textContent).toBe('(no suffix parsed)');
  });

  it('SuffixField_WhenExtraClassGiven_AppendsAfterTheStableClasses', () => {
    expect(suffixField(el, 'TEE', { extraClass: 'hero' }).className).toBe(`${CALLSIGN_CLASS} ${SUFFIX_CLASS} hero`);
    expect(suffixField(el, '', { extraClass: 'hero' }).className).toBe(`${CALLSIGN_CLASS} ${SUFFIX_CLASS}-blank hero`);
  });

  it('SuffixField_ValueWithUnusualLength_IsShownVerbatimNotTruncatedOrPadded', () => {
    // Non-happy path: a two-letter (historic) or unusually long suffix passes
    // through exactly as given - this wrapper does not validate shape.
    expect(suffixField(el, 'AB').textContent).toBe('AB');
    expect(suffixField(el, 'ABCDE').textContent).toBe('ABCDE');
  });
});
