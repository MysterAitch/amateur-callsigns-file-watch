// @vitest-environment jsdom
import { describe, it, expect, beforeAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { runLookup } from './callsign.js';

// The examine trail on the per-callsign page (issue #439): from the notes —
// the page's displayed observations — one shared, low-friction walk to the
// evidence behind them: the ledger's working reconstruction (where the record
// genuinely has one), the recording dataset entry's provenance, and the
// fidelity deep-dive. The vocabulary matches the server-rendered surfaces
// (src/ci/render/show-working.ts examineTrail): same classes, same lead, so a
// reader meets ONE affordance everywhere. Test names follow
// Subject_Scenario_Outcome per project convention.

const CALLSIGN_HTML = fs.readFileSync(path.join('site', 'callsign.html'), 'utf8');
const MAIN = CALLSIGN_HTML.slice(CALLSIGN_HTML.indexOf('<main'), CALLSIGN_HTML.indexOf('</main>') + '</main>'.length);

// Two datasets: a register snapshot (folded by the ledger) and an
// availability list (NOT folded by the ledger) — the split the trail's honest
// degradation turns on.
const MANIFEST = {
  schemaVersion: 1,
  counts: { datasets: 2, callsigns: 4, shards: 2, unkeyableRows: 0 },
  legend: { statuses: { A: 'Allocated', R: 'Reserved' }, markers: { '.': '', '?': '', '-': '', '!': '' } },
  vocab: { product: ['Amateur Foundation Radio Licence'], type: [], impliedClass: ['Foundation'] },
  shards: ['M7', 'M5'],
  datasets: [
    {
      key: 'open-data--2026-01-01', lane: 'open-data', entry: '2026-01-01', file: null,
      vintage: '2026-01-01', title: 'Ofcom open data, 2026-01-01', classes: ['register-snapshot'],
      href: 'datasets/open-data/2026-01-01/index.html', rows: 4, unkeyable: 0,
      intendedComplete: true, scopeNotes: '', coverageNote: '',
    },
    {
      key: 'foi--pool', lane: 'foi', entry: 'pool', file: null,
      vintage: '2018-05-01', title: 'FOI availability list, 2018', classes: ['available-pool'],
      href: 'datasets/foi/pool/index.html', rows: 4, unkeyable: 0,
      intendedComplete: null, scopeNotes: '', coverageNote: '',
    },
  ],
};

const SHARDS: Record<string, Record<string, unknown>> = {
  M7: {
    // Register-seen and flagged: the notes render, and the ledger genuinely
    // reconstructs this record's workings.
    M7AAA: { h: 'A.', l: { d: 0, s: ['A'], p: [0] }, a: { pre: 'M7', sfx: 'AAA', ic: 0 }, f: ['lowercase'] },
    // Register-seen with a within-snapshot twin conflict (issue #633).
    M7BBB: {
      h: 'A.', l: { d: 0, s: ['A'] }, a: { pre: 'M7', sfx: 'BBB', ic: 0 },
      tw: [{ r: 'M7BBB', s: 'A', m: '2025-01-01' }, { r: 'M7BBB ', s: 'R', m: '2024-01-01' }],
    },
    // Register-seen, clean, no notes at all.
    M7CCC: { h: 'A.', l: { d: 0, s: ['A'] }, a: { pre: 'M7', sfx: 'CCC', ic: 0 } },
  },
  M5: {
    // NEVER register-seen: only the availability list carries it, yet a flag
    // note renders — the ledger folds register snapshots only, so a working
    // link would over-promise.
    M5ASS: { h: '.?', a: { pre: 'M5', sfx: 'ASS', ic: 0 }, f: ['forbidden-suffix'] },
  },
};

function notesHost(): HTMLElement {
  const host = document.getElementById('notes');
  if (host === null) throw new Error('notes host missing from callsign.html');
  return host;
}

describe('the examine trail on the per-callsign notes (issue #439)', { tags: ['ui'] }, () => {
  beforeAll(() => {
    vi.stubGlobal('fetch', (url: string) => {
      const name = (url.split('/').pop() ?? '').replace('.json', '');
      const body = name === 'datasets'
        ? MANIFEST
        : { shard: name, callsigns: SHARDS[name] ?? {} };
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    });
  });

  it('NotesExamineTrail_RegisterSeenRecord_WalksToLedgerWorkingEntryProvenanceAndFidelity', async () => {
    document.body.innerHTML = MAIN;
    await runLookup('M7AAA');
    const trail = notesHost().querySelector('p.examine-under .examine-trail');
    expect(trail).not.toBeNull();
    // The shared vocabulary: the visible lead, then the hops in walk order.
    expect(trail?.querySelector('.examine-lead')?.textContent).toBe('Examine:');
    const hrefs = [...(trail?.querySelectorAll('a') ?? [])].map(a => a.getAttribute('href'));
    expect(hrefs).toEqual([
      'ledger.html?c=M7AAA',
      'datasets/open-data/2026-01-01/index.html',
      'fidelity.html#show-working',
    ]);
    // The working hop says what it opens; the entry hop names provenance.
    expect(trail?.textContent).toContain('the working behind each derived value (ledger)');
    expect(trail?.textContent).toContain('the 2026-01-01 dataset entry (provenance)');
  });

  it('NotesExamineTrail_RecordNeverInARegisterSnapshot_DegradesToProvenanceWithoutALedgerHop', async () => {
    // Honest degradation: the ledger folds register-snapshot publications
    // only, so a record seen only in an availability list gets NO working hop
    // — the trail leads to the recording entry's provenance instead of
    // manufacturing a working.
    document.body.innerHTML = MAIN;
    await runLookup('M5ASS');
    const trail = notesHost().querySelector('p.examine-under .examine-trail');
    expect(trail).not.toBeNull();
    const hrefs = [...(trail?.querySelectorAll('a') ?? [])].map(a => a.getAttribute('href'));
    expect(hrefs).toEqual([
      'datasets/foi/pool/index.html',
      'fidelity.html#show-working',
    ]);
    expect(trail?.textContent).not.toContain('ledger');
  });

  it('NotesExamineTrail_RecordWithNoNotes_RendersNoTrailBecauseThereIsNothingToExamineFrom', async () => {
    // Selective disclosure carries over: a clean record surfaces no notes
    // panel, so no examine trail is manufactured beside nothing.
    document.body.innerHTML = MAIN;
    await runLookup('M7CCC');
    expect(notesHost().querySelector('.examine-trail')).toBeNull();
    const panel = document.getElementById('notes-panel');
    expect(panel?.hidden).toBe(true);
  });

  it('TwinConflictCard_ExamineRow_UsesTheSameSharedTrailVocabulary', async () => {
    // The #633 card's evidence row converges on the shared affordance: an
    // "examine" working row whose value is the same examine-trail component,
    // walking to the snapshot entry (provenance) and the ledger.
    document.body.innerHTML = MAIN;
    await runLookup('M7BBB');
    const rows = [...notesHost().querySelectorAll('.fid-work-row')];
    const examineRow = rows.find(r => r.querySelector('.k')?.textContent === 'examine');
    expect(examineRow).toBeDefined();
    const trail = examineRow?.querySelector('.examine-trail');
    expect(trail).not.toBeNull();
    // Inside a row already labelled "examine", the trail carries no second lead.
    expect(trail?.querySelector('.examine-lead')).toBeNull();
    const hrefs = [...(trail?.querySelectorAll('a') ?? [])].map(a => a.getAttribute('href'));
    expect(hrefs).toEqual([
      'datasets/open-data/2026-01-01/index.html',
      'ledger.html?c=M7BBB',
    ]);
  });
});
