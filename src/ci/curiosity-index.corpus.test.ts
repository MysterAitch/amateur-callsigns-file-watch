import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { DIRS } from '../shared/constants.ts';
import {
  scoreCuriosity,
  renderCuriosityIndex,
  readPublicationRecords,
  newestCuriosityKey,
  CURIOSITY_INDEX_PATH,
  type CuriosityRecord,
} from './curiosity-index.ts';

// Issue #866 (build side), over the REAL archive: the committed golden
// (reports/curiosity-index.md) must reproduce byte-for-byte from the newest
// publication's derived views, and the scoring — with the rules documented
// FIRST and then observed — must surface the records the design expected to be
// unusual (GOOUC, the unparseable cohort) high in the ranking, without the
// scoring being fitted to them. Test names follow Subject_Scenario_Outcome.

// A stable historical vintage that still carries an unparseable cohort,
// including the two plain-English-word tokens (see #802).
const LATEST_KEY = '2026-06-23';
// An earlier vintage that still contains GOOUC (it vanished from LATEST_KEY
// with the rest of the blank-status cohort — see #803).
const GOOUC_KEY = '2025-04-08';

function entryPresent(key: string): boolean {
  return fs.existsSync(path.join(DIRS.archive, key, 'components.csv'))
    && fs.existsSync(path.join(DIRS.archive, key, 'normalised.csv'));
}

function rankByCallsign(records: readonly CuriosityRecord[]): { total: number; rankOf: (callsign: string) => number } {
  const scored = scoreCuriosity(records);
  const ranks = new Map<string, number>();
  scored.forEach((r, i) => {
    // Duplicate callsigns (stripped collisions) keep their BEST rank.
    if (!ranks.has(r.callsign)) ranks.set(r.callsign, i + 1);
  });
  return { total: scored.length, rankOf: callsign => ranks.get(callsign) ?? Number.POSITIVE_INFINITY };
}

describe.skipIf(!entryPresent(LATEST_KEY))('curiosity index — golden report', { tags: ['data-validity'] }, () => {
  it('CuriosityReport_RenderedFromNewestPublication_MatchesCommittedGoldenByteForByte', () => {
    // The standing report is a derived golden like every other under reports/:
    // rendering it afresh from the newest publication's derived views must
    // reproduce the committed file exactly, or the drift gate would misfire.
    const key = newestCuriosityKey();
    if (key === undefined) throw new Error('no publication carries derived views to score');
    const rendered = renderCuriosityIndex(key, scoreCuriosity(readPublicationRecords(key)));
    const committed = fs.readFileSync(CURIOSITY_INDEX_PATH, 'utf8');
    expect(rendered).toBe(committed);
  });

  it('CuriosityReport_RegeneratedTwice_IsByteIdentical', () => {
    const key = newestCuriosityKey();
    if (key === undefined) throw new Error('no publication carries derived views to score');
    const records = readPublicationRecords(key);
    const first = renderCuriosityIndex(key, scoreCuriosity(records));
    const second = renderCuriosityIndex(key, scoreCuriosity(readPublicationRecords(key)));
    expect(second).toBe(first);
  });
});

describe.skipIf(!entryPresent(LATEST_KEY))('curiosity index — expected high-rankers (latest)', { tags: ['data-validity'] }, () => {
  it('CuriosityIndex_JoinOfDerivedViews_ReadsEveryRegisterRecordCoherently', () => {
    // The components/normalised join is exact (row-aligned, callsign-verified):
    // it neither throws nor drops rows, and reads the whole register.
    const records = readPublicationRecords(LATEST_KEY);
    expect(records.length).toBeGreaterThan(150000);
    expect(records.every(r => r.callsign.length > 0 || r.parseStatus === 'empty')).toBe(true);
  });

  it('CuriosityIndex_UnparseableCohort_RanksInTheMostUnusualOnePercent', () => {
    // The unparseable records carry no known callsign shape at all, so — with
    // shape a scored signal — every one of them lands in the most-unusual 1%,
    // surfacing itself without the parse status ever being a scoring input.
    const records = readPublicationRecords(LATEST_KEY);
    const unparseable = records.filter(r => r.parseStatus === 'unparseable').map(r => r.callsign);
    expect(unparseable.length).toBeGreaterThan(0);
    const { total, rankOf } = rankByCallsign(records);
    const onePercent = Math.ceil(total * 0.01);
    for (const callsign of unparseable) {
      expect(rankOf(callsign)).toBeLessThanOrEqual(onePercent);
    }
  });

  it('CuriosityIndex_PlainEnglishWordCallsigns_SurfaceNearTheTop', () => {
    // The two plain-English-word unparseable tokens (#802) are among the most
    // unusual records — well inside the top 0.2% — a concrete load-bearing pair.
    const records = readPublicationRecords(LATEST_KEY);
    const { total, rankOf } = rankByCallsign(records);
    const topFifth = Math.ceil(total * 0.002);
    expect(rankOf('EDUCATIONAL')).toBeLessThanOrEqual(topFifth);
    expect(rankOf('ENVIRONMENTS')).toBeLessThanOrEqual(topFifth);
  });
});

describe.skipIf(!entryPresent(GOOUC_KEY))('curiosity index — GOOUC exemplar', { tags: ['data-validity'] }, () => {
  it('CuriosityIndex_GOOUC_SurfacesItselfAmongTheMostUnusualRecords', () => {
    // The motivating example: GOOUC is an unparseable all-letters token (a
    // likely mis-keyed G0OUC). Its shape alone — never the register norm — is
    // rare enough to place it in the most-unusual 1% of its publication.
    const records = readPublicationRecords(GOOUC_KEY);
    expect(records.find(r => r.callsign === 'GOOUC')?.parseStatus).toBe('unparseable');
    const { total, rankOf } = rankByCallsign(records);
    expect(rankOf('GOOUC')).toBeLessThanOrEqual(Math.ceil(total * 0.01));
  });
});
