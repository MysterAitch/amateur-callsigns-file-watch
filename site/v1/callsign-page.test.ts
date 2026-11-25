// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

// The page's entry point, driven end to end: the real callsign.html, the real
// orchestrator, and the real shared modules, over stubbed data files. These
// are the only tests that reach initCallsignPageV1, so they hold the promises
// that live there - that the tab title, the breadcrumb, the heading, and the
// status line name the same key, that the status line names the shard that
// answered, and what the page says when its data cannot be fetched.

import { initCallsignPageV1 } from './callsign-page.js';
import * as sharedCallsign from '../callsign.js';
import * as sharedEvents from '../callsign-events.js';
import * as sharedQuery from '../browser-query.js';
import * as sharedLedger from '../ledger-query.js';

// The same shared modules the deployed page imports from beside itself, handed
// in by static import (see initCallsignPageV1).
const loadShared = () => Promise.resolve({ sharedCallsign, sharedEvents, sharedQuery, sharedLedger });

const PAGE = fs.readFileSync(path.join('site', 'v1', 'callsign.html'), 'utf8');
const BASE_TITLE = 'Look up a callsign · callsign-record';

function ds(i: number, vintage: string, rows: number, unkeyable = 0) {
  return { key: `k${i}`, lane: 'open-data', entry: `e${i}`, file: null, vintage, title: `Ofcom open data, ${vintage}`, classes: ['register-snapshot'], href: '#', rows, unkeyable, intendedComplete: true, scopeNotes: '', coverageNote: '' };
}

const DATA: Record<string, unknown> = {
  'callsign/data/datasets.json': {
    schemaVersion: 1,
    counts: { datasets: 2, callsigns: 1, shards: 2, unkeyableRows: 1 },
    legend: { statuses: { O: 'Allocated' }, markers: {} },
    vocab: { product: [], type: [], impliedClass: [] },
    shards: ['M7T', 'G3U'],
    datasets: [ds(0, '2016-09-20', 139758), ds(1, '2026-09-22', 163341, 1)],
  },
  'callsign/data/M7T.json': { callsigns: { M7TEE: { h: '.O', l: { d: 1, s: ['O'] }, a: { pre: 'M7', sfx: 'TEE', ph: 'M#7TEE' } } } },
  'callsign/data/G3U.json': { callsigns: { G3UO: { h: 'O.', l: { d: 0, s: ['O'] }, a: { pre: 'G3', sfx: 'UO', ph: 'G#3UO' } } } },
  'callsign/data/irregular.json': { callsigns: {} },
  'holdings.json': { latestRegister: { vintage: '2026-09-22', records: 163342 } },
};

let failing: string[] = [];
const requested: string[] = [];

function stubFetch(): void {
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    const pathname = new URL(url).pathname;
    requested.push(pathname);
    const key = Object.keys(DATA).find((k) => pathname.endsWith(`/${k}`));
    if (key === undefined || failing.some((f) => pathname.endsWith(f))) return Promise.resolve(new Response('not found', { status: 404 }));
    return Promise.resolve(new Response(JSON.stringify(DATA[key]), { status: 200, headers: { 'content-type': 'application/json' } }));
  }));
}

async function openPage(query: string): Promise<void> {
  const doc = new DOMParser().parseFromString(PAGE, 'text/html');
  document.head.innerHTML = doc.head.innerHTML;
  document.body.innerHTML = doc.body.innerHTML;
  window.history.replaceState(null, '', `/callsign.html${query}`);
  await initCallsignPageV1(loadShared);
}

const page = () => ({
  title: document.title,
  crumb: [...document.querySelectorAll('.crumbs > *')].filter((n) => !n.classList.contains('arw')).map((n) => n.textContent),
  h1s: [...document.querySelectorAll('h1')].map((h) => h.textContent),
  status: document.getElementById('lookup-status')?.textContent ?? '',
  alert: document.getElementById('lookup-alert')?.hidden === false ? (document.getElementById('lookup-alert')?.textContent ?? '') : null,
});

beforeEach(() => {
  failing = [];
  requested.length = 0;
  stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Callsign page entry point', { tags: ['ui'] }, () => {
  it('CallsignPage_RegionalRenderingResolvedThroughItsCore_TitleBreadcrumbHeadingAndStatusAllNameTheCoreRecord', async () => {
    await openPage('?c=MW7TEE');
    const p = page();
    expect(p.alert).toBeNull();
    expect(p.title).toBe(`M7TEE · ${BASE_TITLE}`);
    expect(p.crumb).toEqual(['Home', 'Look up', 'M7TEE']);
    expect(p.h1s).toEqual(['M7TEE']);
    expect(p.status).toBe('Answered M7TEE from one shard (M7T.json) – no database involved.');
  });

  it('CallsignPage_LowerCaseWithAnInnerSpace_NamesTheLookedUpKeyEverywhereNotTheRawInput', async () => {
    await openPage('?c=m7%20tee');
    const p = page();
    expect(p.title).toBe(`M7TEE · ${BASE_TITLE}`);
    expect(p.crumb).toEqual(['Home', 'Look up', 'M7TEE']);
    expect(p.h1s).toEqual(['M7TEE']);
    expect(p.status).toContain('M7TEE');
    expect(document.querySelector('.lookup-input')?.textContent).toContain('You entered "m7 tee". This page looked up M7TEE.');
  });

  it('CallsignPage_AbsentCallsign_NamesTheLookedUpKeyAndTheShardAsked', async () => {
    await openPage('?c=g3%20zz');
    const p = page();
    expect(p.title).toBe(`G3ZZ · ${BASE_TITLE}`);
    expect(p.crumb).toEqual(['Home', 'Look up', 'G3ZZ']);
    expect(p.h1s).toEqual(['G3ZZ']);
    expect(p.status).toBe('No record found for G3ZZ – checked shard irregular.json.');
  });

  it('CallsignPage_StatusFromTheNewestRegisterHoldingsNames_DrawsTheDot', async () => {
    await openPage('?c=M7TEE');
    expect(document.querySelector('.status-row .led')).not.toBeNull();
    expect(requested.some((p) => p.endsWith('/holdings.json'))).toBe(true);
  });

  it('CallsignPage_HoldingsCannotBeFetched_StillAnswersAndSaysTheCurrencyWasNotChecked', async () => {
    failing = ['holdings.json'];
    await openPage('?c=M7TEE');
    expect(page().h1s).toEqual(['M7TEE']);
    expect(document.querySelector('.status-row .led')).toBeNull();
    expect(document.querySelector('[data-section="fast-answer"]')?.textContent).toContain('could not be checked');
  });

  it('CallsignPage_NothingToLookUp_SaysSoInTheLiveStatusRegionAndAsksNoShard', async () => {
    await openPage('?c=%21%3F%21');
    const p = page();
    expect(p.status).toBe('Nothing to look up: no letters A to Z or digits 0 to 9 were entered.');
    expect(document.getElementById('lookup-status')?.getAttribute('role')).toBe('status');
    expect(p.h1s).toEqual(['!?!']);
    expect(requested.filter((r) => /\/callsign\/data\/(?!datasets)/.test(r))).toEqual([]);
  });

  for (const file of ['datasets.json', 'M7T.json']) {
    it(`CallsignPage_${file.replace('.json', '')}CannotBeFetched_KeepsOneHeadingAndNamesNoCallsignItDidNotResolve`, async () => {
      failing = [file];
      await openPage('?c=M7TEE');
      const p = page();
      expect(p.h1s).toEqual(['callsign-record / look up']);
      expect(p.title).toBe(BASE_TITLE);
      expect(p.crumb).toEqual(['Home', 'Look up']);
      expect(p.status).toBe('Could not look this up.');
      expect(p.alert).toContain('Could not resolve this callsign');
      // The entered callsign is still there to retry.
      expect((document.getElementById('csq') as HTMLInputElement).value).toBe('M7TEE');
    });
  }
});
