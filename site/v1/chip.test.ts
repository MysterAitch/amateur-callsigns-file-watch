// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import * as chip from './chip.js';
import { serialise } from './el.js';
import { V1_COPY } from './copy.js';

// The dated-fact chip component (issues #965/#966, ADR 0022): the first
// exemplar on the el() foundation. ONE renderStatic serves the browser site
// bar and the build stamp, so these tests are the chip's render-output tests
// for BOTH contexts. Test names follow Subject_Scenario_Outcome.

describe('v1 dated-fact chip component', { tags: ['ui'] }, () => {
  it('ChipRenderStatic_FromFacts_StatesTheDatedFactWithBoldCountAndHonestTooltip', () => {
    const node = chip.renderStatic({ date: '23 June 2026', count: 65 });
    expect(node.matches('span.chip.asof')).toBe(true);
    expect(node.textContent).toBe('Record as of 23 June 2026 · 65 publications held');
    expect(node.querySelector('b')?.textContent).toBe('65');
    const expectedTitle = V1_COPY.chip.title.replaceAll('{date}', '23 June 2026').replaceAll('{count}', '65');
    expect(node.getAttribute('title')).toBe(expectedTitle);
    // A stated fact, not a link off the surface.
    expect(node.querySelector('a')).toBeNull();
  });

  it('ChipRenderStatic_CountValueAlsoAppearingInsideTheDate_BoldsOnlyTheTemplateCountSlot', () => {
    // 23 publications with a date containing "23": the split is on the
    // template's {count} placeholder, never on the rendered value.
    const node = chip.renderStatic({ date: '23 June 2026', count: 23 });
    expect(node.textContent).toBe('Record as of 23 June 2026 · 23 publications held');
    // Exactly one bolded run, and it is the COUNT slot rather than the "23"
    // inside the date: everything rendered before it is the whole date clause.
    // Comparing the bolded text alone cannot show this — both candidates read
    // "23" — so the assertion is on WHICH occurrence carries the emphasis.
    const children = [...node.childNodes];
    const boldIndex = children.findIndex(child => child.nodeName === 'B');
    expect(children.filter(child => child.nodeName === 'B')).toHaveLength(1);
    expect(children.slice(0, boldIndex).map(child => child.textContent).join(''))
      .toBe('Record as of 23 June 2026 · ');
    expect(children[boldIndex].textContent).toBe('23');
  });

  it('ChipRenderStatic_HostileFactValues_StayInertTextInBothTextAndTitleSinks', () => {
    // Unhappy path: a poisoned manifest value must render as text, never markup.
    const hostileDate = '<img src=x onerror=alert(1)>';
    const doc = new DOMParser().parseFromString(
      serialise(chip.renderStatic({ date: hostileDate, count: '"><script>alert(1)</script>' })),
      'text/html');
    expect(doc.querySelectorAll('script, img').length).toBe(0);
    expect(doc.querySelector('.chip.asof')?.textContent).toContain(hostileDate);
    for (const node of doc.querySelectorAll('*')) {
      for (const attr of [...node.attributes]) {
        expect(attr.name.toLowerCase().startsWith('on'), `handler attribute ${attr.name} survived`).toBe(false);
      }
    }
  });

  it('ChipRenderStatic_SerialisedThenReparsed_PreservesTextTitleAndStructure', () => {
    // Render-backend fidelity (ADR 0022): the serialised static baseline
    // re-parses to the same tree the browser renders — parsed-DOM comparison.
    const built = chip.renderStatic({ date: '23 June 2026', count: 65 });
    const reparsed = new DOMParser().parseFromString(serialise(built), 'text/html').body.firstElementChild;
    expect(reparsed?.tagName).toBe(built.tagName);
    expect(reparsed?.getAttribute('class')).toBe(built.getAttribute('class'));
    expect(reparsed?.getAttribute('title')).toBe(built.getAttribute('title'));
    expect(reparsed?.textContent).toBe(built.textContent);
    expect(reparsed?.querySelector('b')?.textContent).toBe('65');
  });

  it('ChipEnhance_NoBehaviourToAdd_IsAWrittenNoOpForTheUniformWalk', () => {
    // ADR 0022: every component exports enhance; "no enhancement" is stated
    // deliberately, so the load-time walk needs no presence check.
    expect(typeof chip.enhance).toBe('function');
    expect(chip.enhance()).toBeUndefined();
  });
});
