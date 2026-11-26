// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { inlineTerm, termCue, wireTermPopovers } from './glossary.js';

// Glossary popovers dismissed from the keyboard must leave the reader where
// they were. A popover closed with Escape while focus was inside it hides the
// focused element, and the browser then drops focus to the document body, so
// the next Tab restarts from the top of the page. Test names follow
// Subject_Scenario_Outcome.

function mountParagraph(): { term: HTMLDetailsElement, other: HTMLDetailsElement, after: HTMLButtonElement } {
  const p = document.createElement('p');
  const term = termCue('eventTime');
  const other = inlineTerm('vintage');
  const after = document.createElement('button');
  after.textContent = 'next control';
  p.append('Event time', term, ' and a ', other, '.');
  document.body.replaceChildren(p, after);
  wireTermPopovers(document.body);
  return { term, other, after };
}

const pressEscape = (): void => {
  document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
};

describe('glossary popovers - dismissing from the keyboard', { tags: ['ui'] }, () => {
  beforeEach(() => { document.body.replaceChildren(); });

  it('GlossaryPopover_WhenEscapeIsPressedOnItsFullDefinitionLink_ClosesAndReturnsFocusToItsTrigger', () => {
    const { term } = mountParagraph();
    term.open = true;
    const more = term.querySelector<HTMLAnchorElement>('.pop-more');
    more?.focus();
    expect(document.activeElement).toBe(more);
    pressEscape();
    expect(term.open).toBe(false);
    expect(document.activeElement).toBe(term.querySelector('summary'));
  });

  it('GlossaryPopover_WhenEscapeIsPressedOnItsTrigger_ClosesAndKeepsFocusThere', () => {
    const { term } = mountParagraph();
    term.open = true;
    const summary = term.querySelector<HTMLElement>('summary');
    summary?.focus();
    pressEscape();
    expect(term.open).toBe(false);
    expect(document.activeElement).toBe(summary);
  });

  it('GlossaryPopover_WhenEscapeIsPressedWhileFocusIsElsewhere_ClosesWithoutMovingFocus', () => {
    // An open popover the reader has tabbed past: Escape tidies it away but must
    // not pull focus back from wherever the reader now is.
    const { term, after } = mountParagraph();
    term.open = true;
    after.focus();
    pressEscape();
    expect(term.open).toBe(false);
    expect(document.activeElement).toBe(after);
  });

  it('GlossaryPopover_WhenAnotherKeyIsPressed_StaysOpen', () => {
    const { term } = mountParagraph();
    term.open = true;
    term.querySelector<HTMLElement>('summary')?.focus();
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(term.open).toBe(true);
  });
});
