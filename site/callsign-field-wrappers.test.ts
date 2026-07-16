// @vitest-environment jsdom
import { describe, it, expect, beforeAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { runLookup } from './callsign.js';

// The per-callsign page's "at a glance" card and its status/product detail
// rows (issue #625) adopt the shared field wrappers, mirroring how the ledger
// dossier and the database lookup do: a stable `.stat`/`.lic` class, and - for
// a recognised status shown just once on the page - a glossary crosslink.
// Test names follow the Subject_Scenario_Outcome convention.

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
  M7: { M7TEE: { h: 'A', l: { d: 0, s: ['A'], p: [0] }, a: { pre: 'M7', sfx: 'TEE', ic: 0 } } },
};

beforeAll(() => {
  vi.stubGlobal('fetch', (url: string) => {
    const name = (url.split('/').pop() ?? '').replace('.json', '');
    const body = name === 'datasets' ? MANIFEST : { shard: name, callsigns: SHARDS[name] ?? {} };
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  });
});

describe('Callsign page field-wrapper adoption (#625)', { tags: ['ui'] }, () => {
  it('Glance_LatestStatus_RendersTheSharedStatFieldLinkedToItsGlossaryDefinition', async () => {
    document.body.innerHTML = MAIN;
    await runLookup('M7TEE');
    // The default 'linked' crosslink: the glance card shows the status once,
    // not down a repeated per-row column, so this - unlike the entry
    // browser/compare tables - links a recognised value.
    const statField = document.querySelector('.entity-head .stat .stat');
    expect(statField?.textContent).toContain('Allocated');
    expect(statField?.querySelector('a.gloss-term')?.getAttribute('href')).toBe('glossary.html#allocated');
  });

  it('Glance_LatestProduct_RendersTheSharedLicField', async () => {
    document.body.innerHTML = MAIN;
    await runLookup('M7TEE');
    const licField = document.querySelector('.entity-head .stat .lic');
    expect(licField?.textContent).toBe('Amateur Foundation Radio Licence');
  });

  it('Details_StatusAndProductRows_AlsoRenderTheSharedFields', async () => {
    document.body.innerHTML = MAIN;
    await runLookup('M7TEE');
    const rows = [...document.querySelectorAll('.drow')];
    const statusRow = rows.find(r => r.querySelector('.lab')?.textContent === 'status');
    const productRow = rows.find(r => r.querySelector('.lab')?.textContent === 'product');
    expect(statusRow?.querySelector('.val .stat')?.textContent).toContain('Allocated');
    expect(productRow?.querySelector('.val .lic')?.textContent).toBe('Amateur Foundation Radio Licence');
  });

  it('Details_ImpliedClassRow_CarriesTheSharedLicClassAlongsideItsOwnAxisLink', async () => {
    document.body.innerHTML = MAIN;
    await runLookup('M7TEE');
    const rows = [...document.querySelectorAll('.drow')];
    const impliedRow = rows.find(r => r.querySelector('.lab')?.textContent === 'implied class');
    const wrap = impliedRow?.querySelector('.val .lic');
    expect(wrap?.querySelector('a')?.getAttribute('href')).toBe('glossary.html#licence-class');
    expect(wrap?.textContent).toBe('Foundation');
  });
});

