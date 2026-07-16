// @vitest-environment jsdom
import { describe, it, expect, beforeAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { runLookup } from './callsign.js';

// The per-callsign page's "Components" section (renderAnatomy in callsign.js)
// adopts the shared callsign-PART field wrappers (issue #658, mirroring
// src/ci/render/prefix-series.ts and suffix.ts, issue #644): a stable
// `.cs .cs-pfx`/`.cs .cs-sfx` class pairing, the prefix series' bare-vs-
// displayed `#` RSL-slot convention, and the suffix's odd-character
// transparency plus its opt-in per-suffix-detail-page crosslink. Kept in its
// own file (not appended to callsign-field-wrappers.test.ts): callsign.js
// caches the manifest/shard fetch at module scope, so a fresh module instance
// (one per test file) is needed to exercise fixtures distinct from that
// file's own. Test names follow the Subject_Scenario_Outcome convention.

const CALLSIGN_HTML = fs.readFileSync(path.join('site', 'callsign.html'), 'utf8');
const MAIN = CALLSIGN_HTML.slice(CALLSIGN_HTML.indexOf('<main'), CALLSIGN_HTML.indexOf('</main>') + '</main>'.length);

const MANIFEST = {
  schemaVersion: 1,
  counts: { datasets: 1, callsigns: 3, shards: 1, unkeyableRows: 0 },
  legend: { statuses: { A: 'Allocated' }, markers: { '.': '', '?': '', '-': '', '!': '' } },
  vocab: { product: ['Amateur Foundation Radio Licence'], type: [], impliedClass: ['Foundation'] },
  shards: ['M7'],
  datasets: [{
    key: 'open-data--2026-01-01', lane: 'open-data', entry: '2026-01-01', file: null,
    vintage: '2026-01-01', title: 'Ofcom open data, 2026-01-01', classes: ['register-snapshot'],
    href: 'datasets/open-data/2026-01-01/index.html', rows: 1, unkeyable: 0,
    intendedComplete: true, scopeNotes: '', coverageNote: '',
  }],
};

const SHARDS: Record<string, Record<string, unknown>> = {
  M7: {
    // An ordinary suffix: not on the forbidden list, so no per-suffix page
    // exists for it - the wrapper must not fabricate a link.
    M7TEE: { h: 'A', l: { d: 0, s: ['A'], p: [0] }, a: { pre: 'M7', sfx: 'TEE', ic: 0 } },
    // A forbidden suffix (the flag mirrors renderLinks' own existing guard),
    // so the wrapper's per-suffix-page crosslink applies.
    M7QNF: { h: 'A', l: { d: 0, s: ['A'], p: [0] }, a: { pre: 'M7', sfx: 'QNF', ic: 0 }, f: ['forbidden-suffix'] },
    // A blank-suffix record: parsed a series but no suffix at all (a.sfx
    // omitted), so that row must not render.
    M70000: { h: 'A', l: { d: 0, s: ['A'], p: [0] }, a: { pre: 'M7', ic: 0 } },
  },
};

beforeAll(() => {
  vi.stubGlobal('fetch', (url: string) => {
    const name = (url.split('/').pop() ?? '').replace('.json', '');
    const body = name === 'datasets' ? MANIFEST : { shard: name, callsigns: SHARDS[name] ?? {} };
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  });
});

describe('Callsign page callsign-part field-wrapper adoption (#658)', { tags: ['ui'] }, () => {
  it('Anatomy_PrefixSeriesRow_RendersTheSharedCsPfxFieldWithTheHashDisplayConvention', async () => {
    document.body.innerHTML = MAIN;
    await runLookup('M7TEE');
    const rows = [...document.querySelectorAll('.drow')];
    const seriesRow = rows.find(r => r.querySelector('.lab')?.textContent === 'prefix series');
    const field = seriesRow?.querySelector('.val .cs.cs-pfx');
    // The bare stored value (M7) must gain the `#` RSL-slot marker (M#7) -
    // the genuine display-convention divergence #658 fixed on this row.
    expect(field?.textContent).toBe('M#7');
    expect(field?.tagName).toBe('A');
    expect(field?.getAttribute('href')).toBe('series/M7.html');
  });

  it('Anatomy_SuffixRowForAnOrdinarySuffix_RendersTheSharedCsSfxFieldWithNoFabricatedLink', async () => {
    document.body.innerHTML = MAIN;
    await runLookup('M7TEE');
    const rows = [...document.querySelectorAll('.drow')];
    const suffixRow = rows.find(r => r.querySelector('.lab')?.textContent === 'suffix');
    const field = suffixRow?.querySelector('.val .cs.cs-sfx');
    expect(field?.textContent).toBe('TEE');
    // Not on the forbidden list: no per-suffix detail page exists for it, so
    // the wrapper renders a plain chip, not a link.
    expect(field?.tagName).toBe('CODE');
  });

  it('Anatomy_SuffixRowForAForbiddenSuffix_LinksToItsPerSuffixDetailPage', async () => {
    document.body.innerHTML = MAIN;
    await runLookup('M7QNF');
    const rows = [...document.querySelectorAll('.drow')];
    const suffixRow = rows.find(r => r.querySelector('.lab')?.textContent === 'suffix');
    const field = suffixRow?.querySelector('.val .cs.cs-sfx');
    expect(field?.tagName).toBe('A');
    expect(field?.getAttribute('href')).toBe('forbidden/suffix/QNF/index.html');
    expect(field?.textContent).toBe('QNF');
  });

  it('Anatomy_RecordWithNoSuffixComponent_RendersNoSuffixRowAtAll', async () => {
    // Non-happy path: a.sfx is entirely absent (not blank) - the row itself
    // must not appear, matching every other optional component row's guard.
    document.body.innerHTML = MAIN;
    await runLookup('M70000');
    const rows = [...document.querySelectorAll('.drow')];
    expect(rows.some(r => r.querySelector('.lab')?.textContent === 'suffix')).toBe(false);
    // The series row is still present for this same record.
    const seriesRow = rows.find(r => r.querySelector('.lab')?.textContent === 'prefix series');
    expect(seriesRow?.querySelector('.val .cs.cs-pfx')?.textContent).toBe('M#7');
  });
});
