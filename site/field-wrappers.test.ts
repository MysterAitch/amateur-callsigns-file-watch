// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { licenceField, licenceDisplay, LICENCE_CLASS, statusField, statusDisplay, STATUS_CLASS } from './field-wrappers.js';

// The browser-side licence/status field wrappers (issue #625) mirror the
// generated-page wrappers (src/ci/render/licence.ts, status.ts, issue #553/
// #623) so a value reads the same on the hand-authored surfaces (lookup,
// entry browser, compare, ledger dossier) as on the generated pages: a stable
// class, humanised blanks and, for a recognised status, a glossary crosslink.
// Test names follow the Subject_Scenario_Outcome convention.

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
