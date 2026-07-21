import { describe, it, expect } from 'vitest';
import {
  scoreCuriosity,
  renderCuriosityIndex,
  dateBehaviour,
  CURIOSITY_COMPONENTS,
  type CuriosityRecord,
} from './curiosity-index.ts';

// Issue #866 (build side): the per-record curiosity index scores every record
// by how unusual its attributes are AMONG the records in the same publication
// (Shannon surprisal, −log2(frequency), summed over the named components), and
// renders the most-unusual records with each score's component breakdown.
//
// These are the component fixtures: the pure scoring function over a small,
// hand-controlled corpus where every frequency — and therefore every bit — is
// computable by hand. Test names follow Subject_Scenario_Outcome.

// A "normal" record: the common shape, the common status/product, no flags, the
// common modified-after-start date behaviour. Overridable per field so a fixture
// can introduce exactly one rarity at a time.
function record(callsign: string, over: Partial<CuriosityRecord> = {}): CuriosityRecord {
  return {
    callsign,
    parseStatus: 'parsed',
    flags: '',
    status: 'Allocated',
    product: 'Amateur Full Radio Licence',
    originalStart: '2019-01-01',
    lastModified: '2020-01-01',
    ...over,
  };
}

// Eight records so every frequency is a clean power-of-two fraction: a value
// carried by all 8 costs 0 bits, by 1 of 8 costs exactly 3 bits. Six plain
// records, one with a one-of-a-kind SHAPE, and one carrying three independent
// one-of-a-kind rarities (status/product, flag combination, date behaviour).
function eightRecordCorpus(): CuriosityRecord[] {
  return [
    record('M0AAA'),
    record('M0AAB'),
    record('M0AAC'),
    record('M0AAD'),
    record('M0AAE'),
    record('M0AAF'),
    // Unique all-letters shape (AAAAA), everything else common.
    record('GOOUC'),
    // Three independent rarities, common shape (ANAAA, shared with the M0 six).
    record('M0ZZZ', {
      status: 'Available',
      product: '',
      flags: 'malformed-home-callsign',
      originalStart: '',
      lastModified: '',
    }),
  ];
}

describe('curiosity index — component scoring', { tags: ['unit'] }, () => {
  it('CuriosityIndex_UniqueAttributeValue_ScoresFullSurprisalBits', () => {
    // A value carried by exactly 1 of 8 records is −log2(1/8) = 3 bits; a value
    // carried by 7 of 8 is −log2(7/8) ≈ 0.193 bits. The record with a
    // one-of-a-kind shape earns its bits from that shape alone.
    const scored = scoreCuriosity(eightRecordCorpus());
    const goouc = scored.find(r => r.callsign === 'GOOUC');
    expect(goouc).toBeDefined();
    const shape = goouc?.components.find(c => c.id === 'shape');
    expect(shape?.value).toBe('AAAAA');
    expect(shape?.sharedCount).toBe(1);
    expect(shape?.total).toBe(8);
    expect(shape?.bits).toBe(3);
    // Its other three signals are the common values, ~0.193 bits each.
    const common = -Math.log2(7 / 8);
    for (const id of ['status-product', 'flags', 'date-behaviour'] as const) {
      expect(goouc?.components.find(c => c.id === id)?.bits).toBeCloseTo(common, 10);
    }
  });

  it('CuriosityIndex_MultipleIndependentRarities_AccumulateAcrossNamedComponents', () => {
    // The record with three independent one-of-a-kind attributes scores the
    // most: 3 + 3 + 3 bits from status/product, flags and date behaviour, plus
    // the common ~0.193 from its (shared) shape — and lands first.
    const scored = scoreCuriosity(eightRecordCorpus());
    expect(scored[0].callsign).toBe('M0ZZZ');
    const common = -Math.log2(7 / 8);
    expect(scored[0].totalBits).toBeCloseTo(9 + common, 10);
    // The one-of-a-kind flag combination is scored against its own frequency.
    const flags = scored[0].components.find(c => c.id === 'flags');
    expect(flags?.value).toBe('malformed-home-callsign');
    expect(flags?.sharedCount).toBe(1);
    expect(flags?.bits).toBe(3);
  });

  it('CuriosityIndex_CommonRecord_ScoresNearZero', () => {
    // A wholly ordinary record carries only the residual bits of the majority
    // values it shares — four × ~0.193 bits, well below the rare records.
    const scored = scoreCuriosity(eightRecordCorpus());
    const plain = scored.find(r => r.callsign === 'M0AAA');
    expect(plain?.totalBits).toBeCloseTo(4 * -Math.log2(7 / 8), 10);
  });

  it('CuriosityIndex_ScoredRecords_SortedMostCuriousFirstThenDeterministically', () => {
    // Descending by index; the six identical plain records tie and break by
    // callsign ascending — a stable, reproducible order.
    const scored = scoreCuriosity(eightRecordCorpus());
    expect(scored.map(r => r.callsign)).toEqual([
      'M0ZZZ', 'GOOUC', 'M0AAA', 'M0AAB', 'M0AAC', 'M0AAD', 'M0AAE', 'M0AAF',
    ]);
    for (let i = 1; i < scored.length; i++) {
      expect(scored[i - 1].totalBits).toBeGreaterThanOrEqual(scored[i].totalBits);
    }
  });

  it('CuriosityIndex_EveryRecordTotal_EqualsSumOfItsComponentBits', () => {
    // The index is exactly the sum of its explainable parts — the
    // show-the-working invariant, per record.
    for (const r of scoreCuriosity(eightRecordCorpus())) {
      const sum = r.components.reduce((acc, c) => acc + c.bits, 0);
      expect(r.totalBits).toBeCloseTo(sum, 10);
      expect(r.components).toHaveLength(CURIOSITY_COMPONENTS.length);
    }
  });

  it('CuriosityIndex_RecordBreakdown_ListsStrongestSignalFirst', () => {
    const scored = scoreCuriosity(eightRecordCorpus());
    for (const r of scored) {
      for (let i = 1; i < r.components.length; i++) {
        expect(r.components[i - 1].bits).toBeGreaterThanOrEqual(r.components[i].bits);
      }
    }
  });

  it('CuriosityIndex_ScoringAndRendering_AreDeterministic', () => {
    const a = scoreCuriosity(eightRecordCorpus());
    const b = scoreCuriosity(eightRecordCorpus());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(renderCuriosityIndex('2099-01-01', a)).toBe(renderCuriosityIndex('2099-01-01', b));
  });
});

describe('curiosity index — date behaviour', { tags: ['unit'] }, () => {
  it('DateBehaviour_EachDatePattern_MapsToItsNamedCategory', () => {
    expect(dateBehaviour('', '')).toBe('no-version-dates');
    expect(dateBehaviour('2019-01-01', '')).toBe('original-start-only');
    expect(dateBehaviour('', '2019-01-01')).toBe('last-modified-only');
    expect(dateBehaviour('2019-01-01', '2019-01-01')).toBe('unmodified-since-start');
    expect(dateBehaviour('2019-01-01', '2018-01-01')).toBe('modified-before-start');
    expect(dateBehaviour('2019-01-01', '2020-01-01')).toBe('modified-after-start');
  });

  it('CuriosityIndex_LoneOrBackwardsDates_AreScoredAsRareDateBehaviour', () => {
    // In a corpus where the norm is modified-after-start, a version modified
    // BEFORE its start is a one-of-a-kind date behaviour and scores fully.
    const corpus = [
      record('M0AAA'),
      record('M0AAB'),
      record('M0AAC'),
      record('M0AAD'),
      record('M0AAE'),
      record('M0AAF'),
      record('M0AAG'),
      record('M0BAD', { originalStart: '2019-01-01', lastModified: '2018-01-01' }),
    ];
    const scored = scoreCuriosity(corpus);
    const bad = scored.find(r => r.callsign === 'M0BAD');
    const date = bad?.components.find(c => c.id === 'date-behaviour');
    expect(date?.value).toBe('modified-before-start');
    expect(date?.sharedCount).toBe(1);
    expect(date?.bits).toBe(3);
  });
});
