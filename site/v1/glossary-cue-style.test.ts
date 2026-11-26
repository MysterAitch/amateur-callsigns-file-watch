import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

// The "?" glossary cue (glossary.js termCue) as the shared stylesheet draws it.
// jsdom does no layout, so this holds shell.css to the rule; the pull request
// that added this file measured the result in a browser on every page that
// shows a cue. Test names follow Subject_Scenario_Outcome.

const CSS = fs.readFileSync(path.join('site', 'v1', 'shell.css'), 'utf8').replace(/\/\*[^]*?\*\//g, '');

/** The declarations of every rule naming `selector` exactly, joined, whitespace removed. */
function declarationsFor(selector: string): string {
  return [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((m) => (m[1] ?? '').split(',').map((s) => s.replace(/\s+/g, ' ').trim()).includes(selector))
    .map((m) => (m[2] ?? '').replace(/\s+/g, ''))
    .join(';');
}

const px = (decls: string, prop: string): number | null => {
  const m = new RegExp(`(?:^|;)${prop}:(-?[\\d.]+)px`).exec(decls);
  return m === null ? null : Number(m[1]);
};

describe('declarationsFor (the stylesheet reader itself)', { tags: ['unit'] }, () => {
  it('DeclarationsFor_ASelectorInAList_IsFound_AndAnAbsentOneIsEmpty', () => {
    expect(declarationsFor('.term>summary')).toContain('cursor:help');
    expect(declarationsFor('.no-such-rule')).toBe('');
  });
});

describe('Glossary "?" cue stylesheet', { tags: ['ui'] }, () => {
  const SUMMARY = '.term.cue>summary';

  it('GlossaryCue_QuestionMark_IsATargetOfAtLeastTwentyFourPixelsEachWay', () => {
    // WCAG 2.2 target size (minimum); the ringed "?" alone measured 9.5 by 9.5.
    const decls = declarationsFor(SUMMARY);
    expect(px(decls, 'width') ?? 0).toBeGreaterThanOrEqual(24);
    expect(px(decls, 'height') ?? 0).toBeGreaterThanOrEqual(24);
  });

  it('GlossaryCue_LargerTarget_KeepsTheSmallRingAndTakesNoMoreRoomInItsLine', () => {
    // The ring is drawn at its old size, and negative margins give back the
    // extra room, so no line around a cue deepens or rewraps.
    expect(declarationsFor(`${SUMMARY}::before`)).toMatch(/width:1\.05em;height:1\.05em/);
    expect(declarationsFor(`${SUMMARY}::before`)).toContain('border-radius:50%');
    expect(declarationsFor(SUMMARY)).toContain('margin:calc((1.05em-24px)/2)');
  });
});
