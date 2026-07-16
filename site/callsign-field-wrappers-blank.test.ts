// @vitest-environment jsdom
import { describe, it, expect, beforeAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { runLookup } from './callsign.js';

// A register-snapshot row present in the dataset but carrying no status
// letter at all is an ASSERTED BLANK, not "never seen in a register
// snapshot" - the shared field wrapper's established "(no status recorded)"
// wording (issue #625) must read differently from both the generic '(blank)'
// default and the "never seen" case. Kept in its own file: callsign.js caches
// the manifest/shard fetch at module scope, so a fresh module instance (one
// per test file) is needed to exercise a shard payload distinct from the
// other callsign-field-wrappers.test.ts fixtures.

const CALLSIGN_HTML = fs.readFileSync(path.join('site', 'callsign.html'), 'utf8');
const MAIN = CALLSIGN_HTML.slice(CALLSIGN_HTML.indexOf('<main'), CALLSIGN_HTML.indexOf('</main>') + '</main>'.length);

const MANIFEST = {
  schemaVersion: 1,
  counts: { datasets: 1, callsigns: 1, shards: 1, unkeyableRows: 0 },
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
  // Present in the register-snapshot dataset (l.d resolves), but this
  // vintage's row carries no status letter at all.
  M7: { M7ZZZ: { h: '.', l: { d: 0 }, a: { pre: 'M7', sfx: 'ZZZ' } } },
};

beforeAll(() => {
  vi.stubGlobal('fetch', (url: string) => {
    const name = (url.split('/').pop() ?? '').replace('.json', '');
    const body = name === 'datasets' ? MANIFEST : { shard: name, callsigns: SHARDS[name] ?? {} };
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  });
});

describe('Callsign page field-wrapper adoption — no-status callsign (#625)', { tags: ['ui'] }, () => {
  it('Glance_RegisterSnapshotRowWithNoStatusLetter_UsesTheEstablishedBlankWordingNotTheGenericDefault', async () => {
    document.body.innerHTML = MAIN;
    await runLookup('M7ZZZ');
    const statField = document.querySelector('.entity-head .stat .stat-blank');
    expect(statField?.textContent).toBe('(no status recorded)');
  });
});
