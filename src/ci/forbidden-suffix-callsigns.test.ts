import { describe, it, expect, beforeAll } from 'vitest';
import { buildForbiddenSuffixHistory } from './forbidden-suffix-history.ts';
import { buildSuffixCallsignIndex, type SuffixCallsignIndex } from './forbidden-suffix-callsigns.ts';
import { assertNonEmpty } from '../testing/non-vacuity.ts';

// Issue #291 phase 3: the suffix -> callsigns index over the ever-forbidden
// union, joining the open-data publications and the callsign-bearing FOI
// observations. These assert the real-corpus figures the per-suffix pages
// render, so a data drift surfaces here too. Test names follow
// Subject_Scenario_Outcome.

describe('forbidden-suffix callsign index — real archive', { tags: ['data-validity'] }, () => {
  let index: SuffixCallsignIndex;
  beforeAll(() => {
    index = buildSuffixCallsignIndex(buildForbiddenSuffixHistory().everForbiddenUnion);
  }, 600_000);

  const info = (suffix: string) => {
    const i = index.get(suffix);
    if (i === undefined) throw new Error(`no index entry for ${suffix}`);
    return i;
  };
  const bucket = (suffix: string, status: string) =>
    info(suffix).byStatus.find(b => b.status === status);

  it('SuffixIndex_EveryUnionSuffix_HasAnEntry', () => {
    const union = assertNonEmpty(buildForbiddenSuffixHistory().everForbiddenUnion, 'ever-forbidden union');
    expect(index.size).toBe(union.length);
    for (const suffix of union) expect(index.has(suffix)).toBe(true);
  });

  it('SuffixIndex_QNF_DecomposesIntoTwoAllocatedAndThreeForbidden', () => {
    // The QNF showcase: 5 distinct callsigns, but broken down by latest-known
    // status they are 2 Allocated (the issued pair) and 3 Forbidden (the 2016
    // all-callsigns snapshot's prohibition rows) — never conflated.
    expect(info('QNF').total).toBe(5);
    expect(bucket('QNF', 'Allocated')?.callsigns).toEqual(['M3QNF', 'M7QNF']);
    expect(bucket('QNF', 'Forbidden')?.callsigns).toEqual(['20QNF', 'M0QNF', 'M6QNF']);
  });

  it('SuffixIndex_QNF_LatestStatusWinsSoM3qnfIsAllocatedNotForbidden', () => {
    // M3QNF is Forbidden in the 2016 FOI snapshot but Allocated in the current
    // register: the latest-known status is what it counts under, and the trail
    // still records the transition.
    const m3 = info('QNF').callsigns.find(c => c.callsign === 'M3QNF');
    expect(m3?.latestStatus).toBe('Allocated');
    expect(m3?.inCurrentRegister).toBe(true);
    expect(m3?.startDate).toBe('2025-11-20');
    expect(m3?.observations.some(o => o.status === 'Forbidden')).toBe(true);
    expect(m3?.lanes).toEqual(['foi', 'open-data']);
  });

  it('SuffixIndex_Jiz_CarriesOnlyIssuedCallsignsPredatingItsForbidding', () => {
    // JIZ was added to the forbidden list in 2020, so it has NO Forbidden
    // prohibition rows — only genuinely issued callsigns (Allocated / Reserved),
    // all predating the 2020 forbidding.
    expect(bucket('JIZ', 'Forbidden')).toBeUndefined();
    expect((bucket('JIZ', 'Allocated')?.count ?? 0)).toBeGreaterThan(0);
    expect((bucket('JIZ', 'Reserved')?.count ?? 0)).toBeGreaterThan(0);
  });
});
