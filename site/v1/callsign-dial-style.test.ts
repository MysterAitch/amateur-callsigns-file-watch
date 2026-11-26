import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

// The callsign page's presentation rules that live in the shared stylesheet.
// jsdom does no layout, so these hold shell.css to the rule at stylesheet level;
// each one was also measured in a browser (the pull request that added this
// file carries the figures). Test names follow Subject_Scenario_Outcome.

const CSS = fs.readFileSync(path.join('site', 'v1', 'shell.css'), 'utf8').replace(/\/\*[^]*?\*\//g, '');

interface Rule { selectors: string[], body: string }

// Every style rule, at top level or inside a media block, with its selector
// list split and normalised. A media block's own header never matches: its body
// holds braces.
const RULES: Rule[] = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
  selectors: (m[1] ?? '').split(',').map((s) => s.replace(/\s+/g, ' ').trim()),
  body: (m[2] ?? '').replace(/\s+/g, ''),
}));

/** The declarations of every rule naming `selector` exactly, joined. */
const declarationsFor = (selector: string): string =>
  RULES.filter((r) => r.selectors.includes(selector)).map((r) => r.body).join(';');

// A length declaration in CSS pixels; rem is taken at the browser default of 16px.
const px = (decls: string, prop: string): number | null => {
  const m = new RegExp(`(?:^|;)${prop}:(-?[\\d.]+)(px|rem)`).exec(decls);
  return m === null ? null : Number(m[1]) * (m[2] === 'rem' ? 16 : 1);
};

/**
 * The shape and fill an element matching ALL of `cascade` (listed from least to
 * most specific) is drawn with, taking the last declaration of each property in
 * that order: a diamond is a square turned 45 degrees, a circle has a 50%
 * radius, and a mark with a --panel fill is hollow.
 */
function markShape(cascade: string[]): string {
  const decls = cascade.map(declarationsFor).join(';').split(';');
  const last = (prop: string): string => decls.filter((d) => d.startsWith(`${prop}:`)).pop()?.slice(prop.length + 1) ?? '';
  const form = last('transform').includes('rotate(45deg)') ? 'diamond' : last('border-radius') === '50%' ? 'circle' : 'square';
  return `${last('background') === 'var(--panel)' ? 'hollow' : 'filled'} ${form}`;
}

describe('rules (the stylesheet reader itself)', { tags: ['unit'] }, () => {
  it('MarkShape_TheEventMarkAndItsLegendSample_ReadAsFilledDiamonds', () => {
    expect(markShape(['.scale .ev .dot'])).toBe('filled diamond');
    expect(markShape(['.dial-legend .dl-mk', '.dial-legend .dl-mk.ev'])).toBe('filled diamond');
    expect(markShape(['.dial-legend .dl-mk', '.dial-legend .dl-mk.si'])).toBe('filled circle');
  });

  it('Rules_ARuleInsideAMediaBlockAndASelectorList_AreBothFound', () => {
    expect(declarationsFor('.status-row')).toContain('grid-template-columns:1fr');
    expect(declarationsFor('.tl .track::before')).not.toBe('');
  });

  it('DeclarationsFor_ASelectorTheSheetDoesNotName_IsEmpty', () => {
    expect(declarationsFor('.no-such-rule')).toBe('');
  });
});

describe('Callsign page stylesheet', { tags: ['ui'] }, () => {
  const LAST = '[data-currency="last-recorded"]';

  it('LastRecordedState_OnTheDialTheRailAndTheLegend_IsDrawnWithoutTheCurrentGreen', () => {
    // "Last recorded" is not "current"; the green is the site's mark for current.
    const parts: [string, string][] = [
      [`.scale .ev.state${LAST} .dot`, 'background'],
      [`.scale .ev.state${LAST} .stem`, 'background'],
      [`.scale .ev.state${LAST} .cap`, 'color'],
      [`.tl.state${LAST} .track::before`, 'background'],
      [`.dial-legend .dl-mk.state${LAST}`, 'background'],
    ];
    for (const [selector, prop] of parts) {
      const decls = declarationsFor(selector);
      expect(decls, selector).toMatch(new RegExp(`(?:^|;)${prop}:`));
      expect(decls, selector).not.toContain('--ok');
    }
  });

  it('DialLegend_EachSample_HasTheShapeAndFillOfTheMarkItDecodes', () => {
    // A legend that draws "last recorded" as a circle while the dial draws it as
    // a diamond teaches the wrong reading.
    const mark = (extra: string): string[] => ['.scale .ev .dot', `.scale .ev${extra} .dot`];
    const sample = (cls: string): string[] => ['.dial-legend .dl-mk', `.dial-legend .dl-mk${cls}`];
    const pairs: [string, string[], string[]][] = [
      ['event', ['.scale .ev .dot'], sample('.ev')],
      ['disputed', mark('.disputed'), sample('.disputed')],
      ['current state', mark('.state'), sample('.state')],
      ['last-recorded state', [...mark('.state'), `.scale .ev.state${LAST} .dot`], [...sample('.state'), `.dial-legend .dl-mk.state${LAST}`]],
    ];
    expect(Object.fromEntries(pairs.map(([name, m, s]) => [name, `${markShape(m)} / ${markShape(s)}`]))).toEqual({
      event: 'filled diamond / filled diamond',
      disputed: 'hollow diamond / hollow diamond',
      'current state': 'filled circle / filled circle',
      'last-recorded state': 'hollow circle / hollow circle',
    });
  });

  it('LastRecordedState_AgainstADisputedEvent_DiffersInShapeNotOnlyInColour', () => {
    // Both are hollow; outline colour alone told them apart, at 1.62:1 to each
    // other. The state terminus is a circle, as on the event rail.
    expect(markShape(['.scale .ev .dot', '.scale .ev.state .dot', `.scale .ev.state${LAST} .dot`])).toBe('hollow circle');
    expect(markShape(['.scale .ev .dot', '.scale .ev.disputed .dot'])).toBe('hollow diamond');
  });

  it('CurrentState_OnTheDialTheRailAndTheLegend_KeepsTheGreen', () => {
    for (const selector of ['.scale .ev.state .dot', '.scale .ev.state .cap', '.tl.state .track::before', '.dial-legend .dl-mk.state']) {
      expect(declarationsFor(selector), selector).toContain('var(--ok)');
    }
  });

  it('LongUnbrokenText_InTheStatusLineBreadcrumbHeadingAndNotes_WrapsRatherThanWidensThePage', () => {
    for (const selector of ['.status-line', '.crumbs', '.cshead h1', '.note']) {
      expect(declarationsFor(selector), selector).toContain('overflow-wrap:anywhere');
    }
  });

  it('EvidenceDial_ScrollBox_IsTheScaleWrapperNotTheWholeInstrument', () => {
    expect(declarationsFor('.dial')).not.toMatch(/overflow-x:(auto|scroll)/);
    expect(declarationsFor('.dial-scroll')).toContain('overflow-x:auto');
    // It takes focus when it scrolls, so it shows where focus is.
    expect(declarationsFor('.dial-scroll:focus-visible')).toMatch(/outline:/);
  });

  it('SightingPips_BeneathTheAxis_SitClearOfTheYearLabels', () => {
    // A year label starts 7px below the axis and is one 11px line (about 16px)
    // tall; a pip hung at 18px was drawn through "2024" and "2026" on M7TEE.
    const labelTop = 7;
    const labelLine = 16;
    expect(declarationsFor('.scale .yr')).toContain('calc(var(--axis-top,136px)+7px)');
    const pipTop = px(declarationsFor('.scale .si .pip'), 'top');
    expect(pipTop).not.toBeNull();
    expect(pipTop ?? 0).toBeGreaterThanOrEqual(labelTop + labelLine + 2);
    // A sighting's stem still passes the label band; the label paints over it.
    expect(declarationsFor('.scale .yr')).toMatch(/background:/);
    expect(declarationsFor('.scale .yr')).toMatch(/z-index:/);
  });

  it('SummaryCardNotes_BeneathTheStatusGrid_AreSpacedFromIt', () => {
    expect(px(declarationsFor('.cshead .note'), 'margin-top') ?? 0).toBeGreaterThan(0);
  });
});
