import { describe, it, expect, beforeAll } from 'vitest';
import {
  buildForbiddenSuffixHistory,
  renderForbiddenSuffixHistory,
  type ForbiddenSuffixHistory,
} from './forbidden-suffix-history.ts';

// Issues #289 / #291 phase 1: the forbidden-suffix observation/diff layer over
// the disclosures the archive holds. These assert the real-corpus figures the
// PR cites, against the committed FOI entries. Test names follow
// Subject_Scenario_Outcome.

describe('forbidden-suffix history — real archive', () => {
  let h: ForbiddenSuffixHistory;
  beforeAll(() => { h = buildForbiddenSuffixHistory(); });

  const disclosure = (entry: string) => h.disclosures.find(d => d.entry === entry);

  it('ForbiddenList_2016And2019Disclosures_CarryTheIdenticalSuffixSet', () => {
    const d2016 = disclosure('wdtk-356636--all-callsigns-plus-forbidden');
    const d2019aug = disclosure('wdtk-596532--allocated-reserved-forbidden');
    const d2019sep = disclosure('ofcom-756622--published-register-csv');
    // All three hold the same 1,465-suffix vocabulary.
    expect(d2016?.distinctCount).toBe(1465);
    expect(d2019aug?.distinctCount).toBe(1465);
    expect(d2019sep?.distinctCount).toBe(1465);
    // The 2016 sheet duplicated ZIT: 1,466 rows for 1,465 distinct suffixes -
    // a data-quality artefact, not a vocabulary change.
    expect(d2016?.rowCount).toBe(1466);
    expect(d2016?.duplicates).toEqual(['ZIT']);
    // Zero set difference either direction 2016 -> 2019 -> 2019.
    expect(d2019aug?.added).toEqual([]);
    expect(d2019aug?.removed).toEqual([]);
    expect(d2019sep?.added).toEqual([]);
    expect(d2019sep?.removed).toEqual([]);
  });

  it('ForbiddenList_2024Disclosure_DiffsFromThe2019SetByAddingJizRemovingQnfAndZfj', () => {
    const d2024 = disclosure('ofcom-2024-12--forbidden-suffixes');
    expect(d2024?.distinctCount).toBe(1464);
    expect(d2024?.rowCount).toBe(1464);
    expect(d2024?.added).toEqual(['JIZ']);
    expect(d2024?.removed).toEqual(['QNF', 'ZFJ']);
    // 1,465 - 2 + 1 = 1,464 confirms the arithmetic end to end.
    expect(1465 - (d2024?.removed.length ?? 0) + (d2024?.added.length ?? 0)).toBe(1464);
  });

  it('ForbiddenList_2024LastModifiedDates_AreAnOriginBulkWithASingleOutlier', () => {
    const lm = disclosure('ofcom-2024-12--forbidden-suffixes')?.lastModified;
    // The distribution is the finding: not one date, but 1,463 at the 2016
    // origin timestamp and one (JIZ) touched in 2020 - a one-outlier histogram.
    expect(lm?.map(b => ({ value: b.value, count: b.count }))).toEqual([
      { value: '2016-07-29 17:19', count: 1463 },
      { value: '2020-12-10 09:10', count: 1 },
    ]);
    expect(lm?.[0].suffixes).toHaveLength(1463);
    expect(lm?.[1].suffixes).toEqual(['JIZ']);
    // The earlier lists carry no per-suffix provenance.
    expect(disclosure('wdtk-356636--all-callsigns-plus-forbidden')?.lastModified).toEqual([]);
  });

  it('ForbiddenList_EverForbiddenUnion_IncludesQnfAndZfjDespiteThe2024Delisting', () => {
    // 1,465 shared 2016/2019 suffixes plus JIZ (added 2024) = 1,466; QNF and
    // ZFJ remain because they were forbidden in 2016/2019.
    expect(h.everForbiddenUnion.length).toBe(1466);
    for (const suffix of ['JIZ', 'QNF', 'ZFJ']) {
      expect(h.everForbiddenUnion).toContain(suffix);
    }
  });

  it('ForbiddenList_FirstKnownForbidden_UsesTheFinestDatedProvenanceAvailable', () => {
    // JIZ first appears only in the 2024 disclosure, but its LastModifiedDate
    // dates its forbidding to 2020-12-10 - finer than the 2024 vintage.
    expect(h.firstKnownForbidden['JIZ'].dateKey).toBe('2020-12-10');
    // QNF/ZFJ have no per-suffix date (absent from the 2024 export), so their
    // first-known falls back to the earliest disclosure vintage, 2016-09.
    expect(h.firstKnownForbidden['QNF'].dateKey).toBe('2016-09');
    expect(h.firstKnownForbidden['ZFJ'].dateKey).toBe('2016-09');
    // A shared suffix's LastModifiedDate (2016-07-29) beats the 2016-09
    // disclosure vintage, so the origin bulk anchors to July 2016.
    expect(h.firstKnownForbidden['ADS'].dateKey).toBe('2016-07-29');
  });

  it('ForbiddenList_ChangedSet_IsExactlyTheDriftingSuffixes', () => {
    expect(h.changedSuffixes).toEqual(['JIZ', 'QNF', 'ZFJ']);
  });
});

describe('forbidden-suffix history — rendering', () => {
  it('Render_AllSections_ShowDisclosuresUnionDiffAndDistributions', () => {
    const md = renderForbiddenSuffixHistory({
      disclosures: [
        {
          entry: 'wdtk-356636--all-callsigns-plus-forbidden', vintage: '2016-09',
          sourceFile: 'normalised--sheet-2-forbidden-suffixes.csv',
          rowCount: 1466, distinctCount: 1465, distinctSuffixes: ['QNF', 'ZFJ', 'ZIT'],
          duplicates: ['ZIT'], added: [], removed: [], lastModified: [],
        },
        {
          entry: 'ofcom-2024-12--forbidden-suffixes', vintage: '2024-12',
          sourceFile: 'normalised--forbidden-amateur-radio-callsigns.csv',
          rowCount: 1464, distinctCount: 1464, distinctSuffixes: ['JIZ', 'ZIT'],
          duplicates: [], added: ['JIZ'], removed: ['QNF', 'ZFJ'],
          lastModified: [
            { value: '2016-07-29 17:19', count: 1463, suffixes: [] },
            { value: '2020-12-10 09:10', count: 1, suffixes: ['JIZ'] },
          ],
        },
      ],
      everForbiddenUnion: ['JIZ', 'QNF', 'ZFJ', 'ZIT'],
      changedSuffixes: ['JIZ', 'QNF', 'ZFJ'],
      firstKnownForbidden: {
        JIZ: { dateKey: '2020-12-10', displayValue: '2020-12-10 09:10', basis: 'ofcom-2024-12--forbidden-suffixes (LastModifiedDate)' },
        QNF: { dateKey: '2016-09', displayValue: '2016-09', basis: 'wdtk-356636--all-callsigns-plus-forbidden (vintage)' },
        ZFJ: { dateKey: '2016-09', displayValue: '2016-09', basis: 'wdtk-356636--all-callsigns-plus-forbidden (vintage)' },
        ZIT: { dateKey: '2016-09', displayValue: '2016-09', basis: 'wdtk-356636--all-callsigns-plus-forbidden (vintage)' },
      },
    });
    expect(md).toContain('# Forbidden-suffix history');
    expect(md).toContain('## Ever-forbidden union');
    expect(md).toContain('| 2024-12 | `ofcom-2024-12--forbidden-suffixes` | 1,464 | 1,464 | — | `JIZ` | `QNF`, `ZFJ` |');
    expect(md).toContain('| 2020-12-10 09:10 | 1 | `JIZ` |');
    // First-known-forbidden distribution over this fixture's 4-suffix union.
    expect(md).toContain('| 2016-09 | 3 | `QNF`, `ZFJ`, `ZIT` |');
    expect(md).toContain('| 2020-12-10 | 1 | `JIZ` |');
    expect(md).toContain('| `JIZ` | · | ✓ | 2020-12-10 09:10 — ofcom-2024-12--forbidden-suffixes (LastModifiedDate) |');
  });
});
