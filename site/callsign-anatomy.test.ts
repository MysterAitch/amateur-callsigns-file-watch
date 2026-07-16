// @vitest-environment jsdom
import { describe, it, expect, beforeAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { anatomyFigureParts, runLookup } from './callsign.js';

// The live anatomy figure on the per-callsign page (issue #595): the viewed
// record's PRECOMPUTED components drawn as the same labelled, colour-grouped
// diagram the structure page explains - and, just as importantly, the states
// where no diagram is drawn. Segmentation is never derived in the browser, so
// the tests cover the mapping from shard-record components to diagram parts
// (including the refusals) and then drive the real page markup end to end with
// stubbed shard fetches. Test names follow Subject_Scenario_Outcome.

describe('Anatomy figure parts from precomputed components', { tags: ['ui'] }, () => {
  it('FigureParts_PlainParsedCallsign_SplitsIntoPrefixDigitSuffix', () => {
    const parts = anatomyFigureParts('M7TEE', { pre: 'M7', sfx: 'TEE' });
    expect(parts?.map(p => [p.shortLabel, p.chars])).toEqual([
      ['Prefix', 'M'], ['Digit', '7'], ['Suffix', 'TEE'],
    ]);
  });

  it('FigureParts_RegisterFormCarryingAnRsl_ShowsTheRslInItsRealPosition', () => {
    const parts = anatomyFigureParts('2E0ADR', { pre: '20', rsl: 'E', sfx: 'ADR' });
    expect(parts?.map(p => [p.shortLabel, p.chars])).toEqual([
      ['Prefix', '2'], ['RSL', 'E'], ['Digit', '0'], ['Suffix', 'ADR'],
    ]);
    // Reading the tiles left to right spells the callsign exactly.
    expect(parts?.map(p => p.chars).join('')).toBe('2E0ADR');
  });

  it('FigureParts_MonthShapedCallsign20APR_DrawsItsRealIntermediateShape', () => {
    // 20APR looks like a spreadsheet date but parses as a standard 20-series
    // callsign; the diagram shows that real decomposition, not the oddity.
    const parts = anatomyFigureParts('20APR', { pre: '20', sfx: 'APR' });
    expect(parts?.map(p => [p.shortLabel, p.chars])).toEqual([
      ['Prefix', '2'], ['Digit', '0'], ['Suffix', 'APR'],
    ]);
  });

  it('FigureParts_VisitorForm_HasNoStandardDecompositionToDraw', () => {
    expect(anatomyFigureParts('M/F1ABC', { ps: 'visitor', hc: 'F1ABC', ph: 'M#/F1ABC' })).toBeNull();
  });

  it('FigureParts_SpecialEventAndUnparseableForms_AreNeverGuessed', () => {
    expect(anatomyFigureParts('GB1ABC', { ps: 'special-event', pre: 'GB', sfx: '1ABC' })).toBeNull();
    expect(anatomyFigureParts('QQQQQ', { ps: 'unparseable' })).toBeNull();
  });

  it('FigureParts_MissingComponents_YieldNoFigureRatherThanAPartialGuess', () => {
    expect(anatomyFigureParts('M7TEE', {})).toBeNull();
    expect(anatomyFigureParts('M7TEE', { pre: 'M7' })).toBeNull();
    expect(anatomyFigureParts('M7TEE', { sfx: 'TEE' })).toBeNull();
  });

  it('FigureParts_ComponentsThatDoNotReassembleTheKey_AreRefusedAsAGuess', () => {
    // Defence in depth: a figure that does not spell the resolved callsign is
    // a fabrication, whatever the components claim.
    expect(anatomyFigureParts('M7TEE', { pre: 'G0', sfx: 'TEE' })).toBeNull();
    expect(anatomyFigureParts('M7TEE', { pre: 'M7', rsl: 'W', sfx: 'TEE' })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// End-to-end page states: the real callsign.html markup, stubbed shard data.

const CALLSIGN_HTML = fs.readFileSync(path.join('site', 'callsign.html'), 'utf8');
const MAIN = CALLSIGN_HTML.slice(CALLSIGN_HTML.indexOf('<main'), CALLSIGN_HTML.indexOf('</main>') + '</main>'.length);

const MANIFEST = {
  schemaVersion: 1,
  counts: { datasets: 1, callsigns: 5, shards: 5, unkeyableRows: 0 },
  legend: { statuses: { A: 'Allocated' }, markers: { '.': '', '?': '', '-': '', '!': '' } },
  vocab: { product: ['Amateur Foundation Radio Licence'], type: [], impliedClass: ['Foundation', 'Intermediate'] },
  shards: ['M7', '2E', '20', 'GB', 'irregular'],
  datasets: [{
    key: 'open-data--2026-01-01', lane: 'open-data', entry: '2026-01-01', file: null,
    vintage: '2026-01-01', title: 'Ofcom open data, 2026-01-01', classes: ['register-snapshot'],
    href: 'datasets/open-data/2026-01-01/index.html', rows: 5, unkeyable: 0,
    intendedComplete: true, scopeNotes: '', coverageNote: '',
  }],
};

const SHARDS: Record<string, Record<string, unknown>> = {
  M7: { M7TEE: { h: 'A', l: { d: 0, s: ['A'], p: [0] }, a: { pre: 'M7', sfx: 'TEE', ic: 0 } } },
  '2E': { '2E0ADR': { h: 'A', l: { d: 0, s: ['A'] }, a: { pre: '20', rsl: 'E', sfx: 'ADR', ic: 1 }, f: ['rsl-in-register'] } },
  '20': { '20APR': { h: 'A', l: { d: 0, s: ['A'] }, a: { pre: '20', sfx: 'APR', ic: 1 } } },
  GB: { GB1ABC: { h: 'A', l: { d: 0, s: ['A'] }, a: { ps: 'special-event', pre: 'GB', sfx: '1ABC' } } },
  irregular: { 'M/F1ABC': { h: 'A', l: { d: 0, s: ['A'] }, a: { ps: 'visitor', hc: 'F1ABC', ph: 'M#/F1ABC' } } },
};

function figureHost(): HTMLElement {
  const host = document.getElementById('anatomy-figure');
  if (host === null) throw new Error('anatomy figure slot missing from callsign.html');
  return host;
}

describe('Anatomy figure on the per-callsign page', { tags: ['ui'] }, () => {
  beforeAll(() => {
    vi.stubGlobal('fetch', (url: string) => {
      const name = (url.split('/').pop() ?? '').replace('.json', '');
      const body = name === 'datasets'
        ? MANIFEST
        : { shard: name, callsigns: SHARDS[name] ?? {} };
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    });
  });

  it('AnatomyFigure_ParseableCallsign_RendersItsOwnLabelledDiagramInTheSlot', async () => {
    document.body.innerHTML = MAIN;
    await runLookup('M7TEE');
    const host = figureHost();
    expect(host.hidden).toBe(false);
    const svg = host.querySelector('svg[role="img"]');
    expect(svg).not.toBeNull();
    // The spoken summary names THIS callsign, not the structure-page example.
    expect(svg?.querySelector('title')?.textContent).toBe('Anatomy of the callsign M7TEE');
    // One glyph tile per character of the key.
    expect(host.querySelectorAll('svg rect[rx="8"]').length).toBe(5);
    // The always-visible table fallback names every part in words.
    expect(host.querySelector('table caption')?.textContent).toContain('The parts of M7TEE');
    expect(host.textContent).toContain('Suffix');
  });

  it('AnatomyFigure_RegisterFormWithRsl_DrawsTheRslGroupBetweenPrefixAndDigit', async () => {
    document.body.innerHTML = MAIN;
    await runLookup('2E0ADR');
    const host = figureHost();
    const labels = [...host.querySelectorAll('svg tspan[font-weight="600"]')].map(t => t.textContent);
    expect(labels).toEqual(['Prefix', 'RSL', 'Digit', 'Suffix']);
    const glyphs = [...host.querySelectorAll('svg text')].filter(t => t.getAttribute('font-size') === '30').map(t => t.textContent);
    expect(glyphs.join('')).toBe('2E0ADR');
  });

  it('AnatomyFigure_MonthShapedCallsign_StillDrawsItsRealDecomposition', async () => {
    document.body.innerHTML = MAIN;
    await runLookup('20APR');
    const host = figureHost();
    expect(host.querySelector('svg')).not.toBeNull();
    const glyphs = [...host.querySelectorAll('svg text')].filter(t => t.getAttribute('font-size') === '30').map(t => t.textContent);
    expect(glyphs.join('')).toBe('20APR');
  });

  it('AnatomyFigure_VisitorForm_StatesTheShapeInsteadOfGuessingADiagram', async () => {
    document.body.innerHTML = MAIN;
    await runLookup('M/F1ABC');
    const host = figureHost();
    expect(host.hidden).toBe(false);
    expect(host.querySelector('svg')).toBeNull();
    expect(host.textContent).toMatch(/visitor\/reciprocal form/);
    expect(host.textContent).toMatch(/No diagram/);
  });

  it('AnatomyFigure_SpecialEventForm_StatesTheShapeInsteadOfGuessingADiagram', async () => {
    document.body.innerHTML = MAIN;
    await runLookup('GB1ABC');
    const host = figureHost();
    expect(host.querySelector('svg')).toBeNull();
    expect(host.textContent).toMatch(/special-event GB form/);
  });

  it('AnatomyFigure_UnknownCallsign_LeavesTheSlotHiddenAndEmpty', async () => {
    document.body.innerHTML = MAIN;
    await runLookup('M7ZZZZZ');
    const host = figureHost();
    expect(host.hidden).toBe(true);
    expect(host.textContent).toBe('');
  });

  it('CallsignPage_WithoutJavaScript_FigureSlotStaysHiddenSoTheStaticPageStands', () => {
    // The slot ships hidden and empty in the committed markup: with scripts
    // off the figure simply never appears, and the textual components list
    // (issue #594) remains the baseline.
    expect(CALLSIGN_HTML).toMatch(/<div id="anatomy-figure" data-slot="anatomy-svg" hidden><\/div>/);
  });
});
