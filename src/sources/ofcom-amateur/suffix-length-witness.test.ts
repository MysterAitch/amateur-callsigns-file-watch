import { readFileSync, readdirSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { loadReferenceData, parseCallsign } from './components.ts';

// Suffix-length witness (issue #959, review round). The v1 anatomy page states
// the register's observed suffix-length distribution as an in-repo witness. Those
// figures MUST be derived from the held data, never hand-typed: this test
// recomputes the distribution from the newest held snapshot with the SAME parser
// the site uses and asserts the page displays exactly those rounded figures, so
// any drift in the data (or a stale hand-edit) fails loud rather than shipping a
// wrong number. It also pins the scope the page states (parser-decomposed core
// forms) and the two outliers the page names honestly (the reciprocal slash form
// and the non-standard row), so the page cannot claim an absence the data denies.
//
// Tagged data-validity: it reads the real ~158k-row snapshot, so it runs in the
// full-data tier, not the fast leg.

const SNAPSHOT_DATE = '2026-06-23';
const SNAPSHOT = `archive/${SNAPSHOT_DATE}/normalised.csv`;
const ANATOMY = 'site/v1/anatomy.html';

interface Row { callsign: string; product: string; status: string; }

function readSnapshot(path: string): Row[] {
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  lines.shift(); // header
  const rows: Row[] = [];
  for (const line of lines) {
    if (line === '') continue;
    const f = line.split(',');
    rows.push({ callsign: f[0] ?? '', product: f[1] ?? '', status: f[2] ?? '' });
  }
  return rows;
}

function newestSnapshotDate(): string {
  return readdirSync('archive')
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort()
    .at(-1) ?? '';
}

describe('suffix-length witness on the anatomy page', { tags: ['data-validity'] }, () => {
  it('AnatomySuffixWitness_CitedSnapshot_IsStillTheNewestHeld', () => {
    // The page cites a specific dated snapshot as "the newest held". If a newer
    // one lands, the witness (and this test's figures) must be refreshed together
    // — fail loud rather than let the page's "newest" claim go stale silently.
    expect(newestSnapshotDate(), `${SNAPSHOT_DATE} is no longer the newest snapshot — refresh the anatomy suffix witness and this test`).toBe(SNAPSHOT_DATE);
  });

  it('AnatomySuffixWitness_DisplayedFigures_MatchTheRecomputedCoreDistribution', () => {
    const ref = loadReferenceData();
    const rows = readSnapshot(SNAPSHOT);
    const coreLen = new Map<number, number>();
    let coreTotal = 0;
    for (const r of rows) {
      const parsed = parseCallsign(r.callsign, r.product, ref);
      if (parsed.parseStatus !== 'parsed') continue; // scope: parser-decomposed core forms
      coreTotal++;
      coreLen.set(parsed.suffix.length, (coreLen.get(parsed.suffix.length) ?? 0) + 1);
    }
    expect(coreTotal).toBeGreaterThan(0);
    const pct = (n: number): string => ((n / coreTotal) * 100).toFixed(1);
    const pct3 = pct(coreLen.get(3) ?? 0);
    const pct2 = pct(coreLen.get(2) ?? 0);

    const html = readFileSync(ANATOMY, 'utf8');
    // The displayed percentages are exactly the recomputed ones — a hand-edit that
    // drifts from the data, or a data change, breaks this.
    expect(html, `page must display the recomputed three-letter share ${pct3}%`).toContain(`${pct3}%`);
    expect(html, `page must display the recomputed two-letter share ${pct2}%`).toContain(`${pct2}%`);
    // Sanity on the shape the prose asserts: three-letter dominates, two-letter is the small tail.
    expect(coreLen.get(3) ?? 0).toBeGreaterThan(coreLen.get(2) ?? 0);
  });

  it('AnatomySuffixWitness_SetAsideForms_AreCountedSeparatelyNotClaimedAbsent', () => {
    const ref = loadReferenceData();
    const rows = readSnapshot(SNAPSHOT);
    let visitor = 0;
    let unparseable = 0;
    const byCall = new Map<string, Row>();
    for (const r of rows) {
      byCall.set(r.callsign.toUpperCase(), r);
      const parsed = parseCallsign(r.callsign, r.product, ref);
      if (parsed.parseStatus === 'visitor') visitor++;
      if (parsed.parseStatus === 'unparseable') unparseable++;
    }
    // The page says these forms are set aside and counted separately — they exist.
    expect(visitor, 'the page describes visitor/reciprocal slash forms as set aside — they must be present').toBeGreaterThan(0);
    expect(unparseable, 'the page describes non-standard rows as set aside — they must be present').toBeGreaterThan(0);

    // The two outliers the page names honestly, with the statuses it states.
    const kq4u = byCall.get('M/KQ4U');
    expect(kq4u, 'the page names M/KQ4U as a set-aside reciprocal form — it must be in the snapshot').toBeDefined();
    expect(kq4u?.status).toBe('Reserved');
    const ifjg = byCall.get('2IFJG');
    expect(ifjg, 'the page names 2IFJG as a non-standard row — it must be in the snapshot').toBeDefined();
    expect(ifjg?.status).toBe('Allocated');

    const html = readFileSync(ANATOMY, 'utf8');
    expect(html).toContain('M/KQ4U');
    expect(html).toContain('2IFJG');
  });
});
