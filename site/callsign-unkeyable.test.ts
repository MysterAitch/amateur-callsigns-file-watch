// @vitest-environment jsdom
import { describe, it, expect, beforeAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { unkeyableRowInfo, runLookup } from './callsign.js';

// Issue #632: the callsign-shard build already counts, per dataset, rows
// whose callsign cell is blank or punctuation-only (ShardDataset.unkeyable),
// but nothing rendered it anywhere a reader could see. These tests cover the
// pure shaping helper and then the real per-callsign page markup, so the
// count reaches the sightings table wherever a dataset carries one. Test
// names follow Subject_Scenario_Outcome per project convention.

function dataset(overrides: Record<string, unknown> = {}) {
  return {
    key: 'open-data--2026-01-01',
    lane: 'open-data' as const,
    entry: '2026-01-01',
    file: null,
    vintage: '2026-01-01',
    title: 'Ofcom open data, 2026-01-01',
    classes: ['register-snapshot'],
    href: 'datasets/open-data/2026-01-01/index.html',
    rows: 10,
    unkeyable: 0,
    intendedComplete: null,
    scopeNotes: '',
    coverageNote: '',
    ...overrides,
  };
}

describe('unkeyableRowInfo (pure dataset-level shaping)', { tags: ['ui'] }, () => {
  it('UnkeyableRowInfo_ZeroCount_IsNull', () => {
    expect(unkeyableRowInfo(dataset({ unkeyable: 0 }))).toBeNull();
  });

  it('UnkeyableRowInfo_SingleRow_UsesSingularNoun', () => {
    expect(unkeyableRowInfo(dataset({ unkeyable: 1 }))).toEqual({ count: 1, noun: 'row' });
  });

  it('UnkeyableRowInfo_MultipleRows_UsesPluralNoun', () => {
    expect(unkeyableRowInfo(dataset({ unkeyable: 5 }))).toEqual({ count: 5, noun: 'rows' });
  });
});

// ---------------------------------------------------------------------------
// End-to-end page state: the real callsign.html markup, stubbed shard data.
// callsign.js memoises its fetched manifest/shards at module scope (by
// design, for the real page), so ONE manifest and ONE runLookup call serve
// every assertion below rather than one stub per test.

const CALLSIGN_HTML = fs.readFileSync(path.join('site', 'callsign.html'), 'utf8');
const MAIN = CALLSIGN_HTML.slice(CALLSIGN_HTML.indexOf('<main'), CALLSIGN_HTML.indexOf('</main>') + '</main>'.length);

// Three datasets covering the three cases a reader can meet: a plural count,
// a singular count, and none at all. M7TEE is present ONLY in the middle
// dataset (h: '.A.') - deliberately, so the FIRST and THIRD rows' notes are
// proven to be dataset-level accounting, not a fact about the searched
// callsign (an absent sighting still names its own dataset's unkeyable count).
const MANIFEST = {
  schemaVersion: 1,
  counts: { datasets: 3, callsigns: 1, shards: 1, unkeyableRows: 6 },
  legend: { statuses: { A: 'Allocated' }, markers: { '.': '', '?': '', '-': '', '!': '' } },
  vocab: { product: ['Amateur Foundation Radio Licence'], type: [], impliedClass: ['Foundation'] },
  shards: ['M7', 'irregular'],
  datasets: [
    dataset({ key: 'open-data--2020-01-01', vintage: '2020-01-01', unkeyable: 5 }),
    dataset({ key: 'open-data--2021-01-01', vintage: '2021-01-01', unkeyable: 1 }),
    dataset({ key: 'open-data--2022-01-01', vintage: '2022-01-01', unkeyable: 0 }),
  ],
};

const RECORD = { h: '.A.', l: { d: 1, s: ['A'], p: [0] }, a: { pre: 'M7', sfx: 'TEE', ic: 0 } };

describe('Unkeyable-row note on the per-callsign sightings table', { tags: ['ui'] }, () => {
  beforeAll(async () => {
    vi.stubGlobal('fetch', (url: string) => {
      const name = (url.split('/').pop() ?? '').replace('.json', '');
      const body = name === 'datasets' ? MANIFEST : { shard: name, callsigns: { M7TEE: RECORD } };
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    });
    document.body.innerHTML = MAIN;
    await runLookup('M7TEE');
  });

  function rows(): HTMLTableRowElement[] {
    const history = document.getElementById('history');
    return [...(history?.querySelectorAll('tbody tr') ?? [])] as HTMLTableRowElement[];
  }

  it('SightingsTable_DatasetWithSeveralUnkeyableRows_StatesTheCountAndLinksTheGlossary', () => {
    const row = rows()[0];
    expect(row.textContent).toContain('5 unkeyable rows');
    expect(row.textContent).toMatch(/blank or punctuation-only callsign cell/);
    const link = row.querySelector('a[href="glossary.html#unkeyable-row"]');
    expect(link?.textContent).toBe('5 unkeyable rows');
    // This is also the callsign's own absent row (M7TEE was never seen in the
    // 2020-01-01 dataset) — proving the note is dataset accounting, not a
    // property of the searched callsign.
    expect(row.className).toContain('muted');
  });

  it('SightingsTable_DatasetWithOneUnkeyableRow_UsesSingularNoun', () => {
    const row = rows()[1];
    expect(row.textContent).toContain('1 unkeyable row');
    expect(row.textContent).not.toContain('1 unkeyable rows');
  });

  it('SightingsTable_DatasetWithNoUnkeyableRows_OmitsTheNoteEntirely', () => {
    const row = rows()[2];
    expect(row.textContent).not.toMatch(/unkeyable/i);
    expect(row.querySelector('a[href="glossary.html#unkeyable-row"]')).toBeNull();
  });
});
