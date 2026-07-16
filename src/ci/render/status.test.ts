import { describe, it, expect } from 'vitest';
import { statusField, statusDisplay, STATUS_CLASS } from './status.ts';
import { GLOSSARY_ANCHORS } from './glossary.ts';

// The shared register-status field wrapper (issue #553). Every status value
// displayed on a generated page routes through `statusField`, which renders
// one stable class and, for a value the glossary defines, a crosslink to its
// definition. Test names follow the Subject_Scenario_Outcome convention.

describe('statusField wrapper', { tags: ['unit'] }, () => {
  it('StatusField_WhenValueUnrecognised_RendersPlainTextWithTheStableClass', () => {
    // A value the glossary does not define (a typo, a future status not yet
    // catalogued) is never linked to a guess - it renders as plain text.
    expect(statusField('Suspended')).toBe(`<span class="${STATUS_CLASS}">Suspended</span>`);
  });

  it('StatusField_WhenRecognisedButNoDepthGiven_RendersPlainTextRatherThanABrokenLink', () => {
    // Without a depth-to-root there is nowhere to resolve glossary.html from,
    // so even a recognised value stays plain rather than emitting a dangling href.
    expect(statusField('Allocated')).toBe(`<span class="${STATUS_CLASS}">Allocated</span>`);
  });

  it('StatusField_WhenRecognisedWithDepth_LinksToItsGlossaryDefinition', () => {
    const html = statusField('Allocated', { depthToRoot: 3 });
    expect(html).toBe(`<span class="${STATUS_CLASS}"><a class="gloss-term" href="../../../glossary.html#allocated">Allocated<span class="gloss-cue" aria-hidden="true">?</span><span class="visually-hidden"> (definition of ${GLOSSARY_ANCHORS.allocated} in the glossary)</span></a></span>`);
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
      expect(statusField(value, { depthToRoot: 1 })).toContain(`href="../glossary.html#${anchor}"`);
    }
  });

  it('StatusField_WhenPlainPinnedExplicitly_RendersUnlinkedEvenWhenRecognisedAndDepthGiven', () => {
    // The drift-guard rule (#553): a usage that requires no linking (a
    // per-record row repeating the same handful of values many times, or a
    // value nested inside a click-to-filter role="button" row where a nested
    // <a> would be an accessibility anti-pattern) states it explicitly.
    expect(statusField('Allocated', { depthToRoot: 3, glossaryLinking: 'plain' }))
      .toBe(`<span class="${STATUS_CLASS}">Allocated</span>`);
  });

  it('StatusField_WhenBlank_HumanisesToBlankLabelRatherThanAnEmptyElement', () => {
    expect(statusField('')).toBe(`<em class="${STATUS_CLASS} stat-blank">(blank)</em>`);
  });

  it('StatusField_WhenBlankLabelPinned_UsesTheStatedWording', () => {
    // A surface with an established synthetic placeholder (e.g. "(unknown)"
    // for a callsign this vintage never carried any status row for) pins it.
    expect(statusField('', { blankLabel: '(unknown)' })).toBe(`<em class="${STATUS_CLASS} stat-blank">(unknown)</em>`);
  });

  it('StatusField_WhenExtraClassGiven_AppendsAfterTheStableClass', () => {
    expect(statusField('Allocated', { extraClass: 'hero' })).toBe(`<span class="${STATUS_CLASS} hero">Allocated</span>`);
    expect(statusField('', { extraClass: 'hero' })).toBe(`<em class="${STATUS_CLASS} stat-blank hero">(blank)</em>`);
  });

  it('StatusField_WhenValueIsMixedCaseOrWhitespaceVariant_IsTreatedAsUnrecognisedNotFuzzyMatched', () => {
    // The register vocabulary is exact-match: 'allocated' (lowercase) or
    // ' Allocated' (leading space) is NOT silently coerced to the recognised
    // 'Allocated' - the raw value is shown faithfully, unlinked, never
    // normalised in display without saying so.
    expect(statusField('allocated', { depthToRoot: 1 })).toBe(`<span class="${STATUS_CLASS}">allocated</span>`);
    expect(statusField(' Allocated', { depthToRoot: 1 })).toBe(`<span class="${STATUS_CLASS}"> Allocated</span>`);
  });

  it('StatusField_WhenValueContainsMarkupCharacters_EscapesThem', () => {
    expect(statusField('<b>&"')).toBe(`<span class="${STATUS_CLASS}">&lt;b&gt;&amp;&quot;</span>`);
  });
});

describe('statusDisplay', { tags: ['unit'] }, () => {
  it('StatusDisplay_PlainValue_PassesThroughUnchanged', () => {
    expect(statusDisplay('Allocated')).toBe('Allocated');
  });

  it('StatusDisplay_BlankValue_HumanisesToTheDefaultOrGivenLabel', () => {
    expect(statusDisplay('')).toBe('(blank)');
    expect(statusDisplay('', '(unknown)')).toBe('(unknown)');
  });
});
