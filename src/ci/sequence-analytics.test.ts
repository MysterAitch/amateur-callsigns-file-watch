import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  allocationRoleOf,
  suffixOrdinal,
  ordinalToSuffix,
  spearman,
  analyseSeries,
  slotsBySeriesFrom,
  foldSubjectAllocations,
  computeSequenceAnalytics,
  renderSequenceAnalytics,
  CORRELATION_MIN_DATED,
  type SeriesSlot,
  type SubjectAllocationRow,
} from './sequence-analytics.ts';
import { EVENT_DATE_KINDS, EVENT_DATE_RULE, eventDatePredicate, type Claim } from '../v2/claim.ts';
import { serialiseClaimsJsonl } from '../v2/serialise.ts';
import { loadReferenceData } from '../sources/ofcom-amateur/components.ts';
import { duckDbAvailable } from '../v2/report-fold.ts';

// Issue #864: the namespace sequence-analytics engine, unit-tested on fixtures.
// The pure derivations (suffix ordinal, rank correlation, per-series analysis)
// carry no data dependency and always run; the DuckDB-backed fold skips honestly
// where the pinned CLI is absent. Test names follow Subject_Scenario_Outcome.

const ref = loadReferenceData();

// --- The allocation-role registry -------------------------------------------

describe('allocationRoleOf', { tags: ['unit'] }, () => {
  it('AllocationRole_LicenceIssued_IsAFirmIssuedDate', () => {
    expect(allocationRoleOf('licence-issued')).toBe('issued');
  });

  it('AllocationRole_OriginalStartKinds_AreEarliestSurviving', () => {
    expect(allocationRoleOf('licence-version-original-start')).toBe('earliest-surviving-start');
    expect(allocationRoleOf('licence-original-start')).toBe('earliest-surviving-start');
  });

  it('AllocationRole_BookkeepingAndReservationKinds_AreNonAllocation', () => {
    for (const kind of ['record-created', 'record-last-modified', 'licence-version-last-modified', 'licence-cancelled', 'reserved-until', 'licence-created', 'licence-last-modified']) {
      expect(allocationRoleOf(kind)).toBe('non-allocation');
    }
  });

  it('AllocationRole_EveryS1Kind_IsClassified', () => {
    // The drift guard: the registry is total over the S1 vocabulary, so a new
    // event kind cannot silently join or skip the sequence analysis.
    for (const kind of EVENT_DATE_KINDS) expect(() => allocationRoleOf(kind)).not.toThrow();
  });

  it('AllocationRole_UnclassifiedKind_ThrowsRatherThanGuessing', () => {
    expect(() => allocationRoleOf('not-a-real-kind')).toThrow(/no authored allocation role/);
  });
});

// --- Suffix sequence ordinal -------------------------------------------------

describe('suffixOrdinal', { tags: ['unit'] }, () => {
  it('SuffixOrdinal_ShorterSuffixes_SortStrictlyBeforeLongerOnes', () => {
    // The issuance-era order: every 2-letter suffix precedes every 3-letter one.
    expect(suffixOrdinal('ZZ')).toBeLessThan(suffixOrdinal('AAA'));
    expect(suffixOrdinal('A')).toBeLessThan(suffixOrdinal('AA'));
  });

  it('SuffixOrdinal_WithinALength_IsAlphabetical', () => {
    expect(suffixOrdinal('AAA')).toBeLessThan(suffixOrdinal('AAB'));
    expect(suffixOrdinal('AAB')).toBeLessThan(suffixOrdinal('ABA'));
    expect(suffixOrdinal('ABA')).toBeLessThan(suffixOrdinal('BAA'));
  });

  it('SuffixOrdinal_AtBlockBoundaries_IsContiguous', () => {
    // AA is the first length-2 suffix at offset 26 (after the 26 length-1
    // suffixes); AAA the first length-3 at offset 26 + 676 = 702, one past ZZ.
    expect(suffixOrdinal('AA')).toBe(26);
    expect(suffixOrdinal('ZZ')).toBe(701);
    expect(suffixOrdinal('AAA')).toBe(702);
    expect(suffixOrdinal('ZZZ')).toBe(702 + 26 ** 3 - 1);
  });

  it('SuffixOrdinal_RoundTripsThroughOrdinalToSuffix', () => {
    for (const suffix of ['A', 'Z', 'AA', 'TEE', 'ZZZ', 'ABC', 'HON']) {
      expect(ordinalToSuffix(suffixOrdinal(suffix))).toBe(suffix);
    }
  });

  it('SuffixOrdinal_NonAlphabeticInput_ThrowsRatherThanMisplacing', () => {
    expect(() => suffixOrdinal('7E')).toThrow(/not an A-Z suffix/);
    expect(() => suffixOrdinal('')).toThrow(/not an A-Z suffix/);
  });
});

// --- Rank correlation --------------------------------------------------------

describe('spearman', { tags: ['unit'] }, () => {
  it('Spearman_PerfectlySequentialIssuance_IsPlusOne', () => {
    const pairs = [1, 2, 3, 4, 5].map((n, i) => ({ ordinal: n, day: i }));
    expect(spearman(pairs)).toBe(1);
  });

  it('Spearman_ReverseOrderedIssuance_IsMinusOne', () => {
    const pairs = [{ ordinal: 1, day: 5 }, { ordinal: 2, day: 4 }, { ordinal: 3, day: 3 }, { ordinal: 4, day: 2 }, { ordinal: 5, day: 1 }];
    expect(spearman(pairs)).toBe(-1);
  });

  it('Spearman_TiedAllocationDays_UsesAverageRanksNotInputOrder', () => {
    // Two suffixes issued on the same day sit either side of a later pair — the
    // tie must resolve to a shared average rank, independent of input order.
    const a = spearman([{ ordinal: 1, day: 0 }, { ordinal: 2, day: 0 }, { ordinal: 3, day: 1 }, { ordinal: 4, day: 2 }]);
    const b = spearman([{ ordinal: 4, day: 2 }, { ordinal: 3, day: 1 }, { ordinal: 2, day: 0 }, { ordinal: 1, day: 0 }]);
    expect(a).toBe(b);
    expect(a).not.toBeNull();
  });

  it('Spearman_FewerThanTwoPoints_IsNull', () => {
    expect(spearman([])).toBeNull();
    expect(spearman([{ ordinal: 1, day: 1 }])).toBeNull();
  });

  it('Spearman_AllAllocationsOnOneDay_IsNullNoOrderToDetect', () => {
    expect(spearman([{ ordinal: 1, day: 5 }, { ordinal: 2, day: 5 }, { ordinal: 3, day: 5 }])).toBeNull();
  });
});

// --- Per-series analysis -----------------------------------------------------

function slot(suffix: string, allocDay: string | null, role: SeriesSlot['allocRole'] = allocDay === null ? null : 'issued'): SeriesSlot {
  return { suffix, ordinal: suffixOrdinal(suffix), allocDay, allocRole: role };
}

describe('analyseSeries', { tags: ['unit'] }, () => {
  it('AnalyseSeries_SequentialDatedSlots_ReportsStrongPositiveCorrelation', () => {
    const slots = [slot('AAA', '2019-01-01'), slot('AAB', '2019-02-01'), slot('AAC', '2019-03-01'), slot('AAD', '2019-04-01')];
    const a = analyseSeries('M7', slots, ref);
    expect(a.population).toBe(4);
    expect(a.dated).toBe(4);
    expect(a.coverage).toBe(1);
    expect(a.correlation).toBe(1);
    expect(a.adjacentMonotonic).toBe(1);
    expect(a.firstSuffix).toBe('AAA');
    expect(a.lastSuffix).toBe('AAD');
  });

  it('AnalyseSeries_UndatedSlots_CountInPopulationButNotCoverageOrCorrelation', () => {
    const slots = [slot('AAA', '2019-01-01'), slot('AAB', null), slot('AAC', '2019-03-01')];
    const a = analyseSeries('M7', slots, ref);
    expect(a.population).toBe(3);
    expect(a.dated).toBe(2);
    expect(a.coverage).toBeCloseTo(2 / 3);
    // Two dated points, both ascending — a perfect (if tiny) correlation.
    expect(a.correlation).toBe(1);
  });

  it('AnalyseSeries_GapInObservedRange_IsMeasuredAsTheLargestUnallocatedRun', () => {
    // AAA (702) and AAE (706) observed with AAB..AAD absent: a run of 3.
    const slots = [slot('AAA', null), slot('AAE', null)];
    const a = analyseSeries('M7', slots, ref);
    expect(a.span).toBe(5);
    expect(a.largestGap).toBe(3);
    expect(a.fillRatio).toBeCloseTo(2 / 5);
  });

  it('AnalyseSeries_CurrentlyIssuingSeries_ProjectsExhaustionWithFlooredRemainder', () => {
    const slots = [slot('AAA', '2020-01-01'), slot('AAB', '2021-01-01'), slot('AAC', '2022-01-01')];
    const a = analyseSeries('M7', slots, ref);
    expect(a.projection).not.toBeNull();
    expect(a.projection?.currentLength).toBe(3);
    expect(a.projection?.capacity).toBe(26 ** 3);
    expect(a.projection?.used).toBe(3);
    expect(a.projection?.remaining).toBe(26 ** 3 - 3);
    expect(a.projection?.yearsRemaining).not.toBeNull();
  });

  it('AnalyseSeries_FormerlyIssuedSeries_MakesNoExhaustionProjection', () => {
    // "20" is a formerly-issued intermediate series in reference-data.
    const slots = [slot('AAA', '2005-01-01'), slot('AAB', '2006-01-01')];
    const a = analyseSeries('20', slots, ref);
    expect(a.projection).toBeNull();
    expect(a.issuingStatus).toBe('formerly-issued');
  });

  it('AnalyseSeries_SeriesAbsentFromReferenceData_IsMarkedUnknown', () => {
    const a = analyseSeries('M2', [slot('IBX', null)], ref);
    expect(a.known).toBe(false);
    expect(a.stationLevel).toBe('');
  });

  it('AnalyseSeries_PerYearCurve_CountsDatedAllocationsByCalendarYear', () => {
    const slots = [slot('AAA', '2019-05-01'), slot('AAB', '2019-06-01'), slot('AAC', '2020-01-01')];
    const a = analyseSeries('M7', slots, ref);
    expect(a.perYear).toEqual([{ year: 2019, count: 2 }, { year: 2020, count: 1 }]);
  });
});

// --- Grouping folded rows into slots ----------------------------------------

describe('slotsBySeriesFrom', { tags: ['unit'] }, () => {
  it('SlotsBySeries_RegionalRenderings_UnifyOntoOneSlotTakingTheEarliestAllocation', () => {
    // M7TEE and its Welsh rendering MW7TEE are one callsign slot; the earliest
    // allocation across the renderings stands.
    const rows: SubjectAllocationRow[] = [
      { subject: 'M7TEE', minIssued: null, minOriginalStart: '2020-05-01' },
      { subject: 'MW7TEE', minIssued: null, minOriginalStart: '2019-05-01' },
    ];
    const bySeries = slotsBySeriesFrom(rows, ref);
    const m7 = bySeries.get('M7') ?? [];
    expect(m7).toHaveLength(1);
    expect(m7[0].suffix).toBe('TEE');
    expect(m7[0].allocDay).toBe('2019-05-01');
    expect(m7[0].allocRole).toBe('earliest-surviving-start');
  });

  it('SlotsBySeries_FirmIssuedDate_IsPreferredAsTheAllocationDay', () => {
    const rows: SubjectAllocationRow[] = [{ subject: 'M0ABC', minIssued: '2010-01-01', minOriginalStart: '2005-01-01' }];
    const slot = (slotsBySeriesFrom(rows, ref).get('M0') ?? [])[0];
    expect(slot.allocDay).toBe('2010-01-01');
    expect(slot.allocRole).toBe('issued');
  });

  it('SlotsBySeries_UnparseableAndVisitorSubjects_HaveNoSequencePositionAndAreDropped', () => {
    const rows: SubjectAllocationRow[] = [
      { subject: 'GB2RHQ', minIssued: '2019-01-01', minOriginalStart: null }, // special-event
      { subject: 'M/F1ABC', minIssued: '2019-01-01', minOriginalStart: null }, // visitor
      { subject: 'NOTACALL', minIssued: '2019-01-01', minOriginalStart: null }, // unparseable
      { subject: 'M7ABC', minIssued: '2019-01-01', minOriginalStart: null }, // parsed
    ];
    const bySeries = slotsBySeriesFrom(rows, ref);
    expect([...bySeries.keys()]).toEqual(['M7']);
  });
});

// --- Rendering ---------------------------------------------------------------

describe('renderSequenceAnalytics', { tags: ['unit'] }, () => {
  function analyticsFromRows(rows: SubjectAllocationRow[]) {
    const bySeries = slotsBySeriesFrom(rows, ref);
    const series = [...bySeries.entries()].map(([s, slots]) => analyseSeries(s, slots, ref)).sort((a, b) => b.population - a.population || a.series.localeCompare(b.series));
    return {
      series,
      totalSlots: series.reduce((n, s) => n + s.population, 0),
      datedSlots: series.reduce((n, s) => n + s.dated, 0),
      parsedSubjects: series.reduce((n, s) => n + s.population, 0),
      latestAllocDay: series.flatMap(s => s.latestAllocDay ? [s.latestAllocDay] : []).sort().at(-1) ?? null,
    };
  }

  it('Report_AllSections_ArePresentWithTheEpistemicsFraming', () => {
    const md = renderSequenceAnalytics(analyticsFromRows([{ subject: 'M7ABC', minIssued: '2019-01-01', minOriginalStart: null }]));
    expect(md).toContain('# Namespace sequence analytics');
    expect(md).toContain('## What counts as allocation-time evidence');
    expect(md).toContain('## Allocation order — is issuance sequential? (H5)');
    expect(md).toContain('NAIVE EXTRAPOLATION, not');
    expect(md).toContain('[derived]');
  });

  it('Report_SeriesAbsentFromReferenceData_IsFlaggedInTheSummary', () => {
    const md = renderSequenceAnalytics(analyticsFromRows([{ subject: 'M2IBX', minIssued: null, minOriginalStart: null }]));
    expect(md).toContain('`M2` ⚠');
    expect(md).toContain('absent from `reference-data/prefix-formats.csv`');
  });

  it('Report_SeriesBelowTheDatedFloor_ShowNoCorrelationFigure', () => {
    // A single dated M7 slot is far below the floor, so its ρ column is an em-dash.
    const md = renderSequenceAnalytics(analyticsFromRows([{ subject: 'M7ABC', minIssued: '2019-01-01', minOriginalStart: null }]));
    const m7Row = md.split('\n').find(l => l.startsWith('| `M7`')) ?? '';
    expect(m7Row).toMatch(/\|\s*—\s*\|\s*—\s*\|$/);
    expect(CORRELATION_MIN_DATED).toBeGreaterThan(1);
  });
});

// --- The DuckDB fold over a controlled ledger --------------------------------

// One event-date claim as the ledger stores it: subject, kind-in-predicate, ISO
// day in the object, under the S1 rule.
function eventClaim(subject: string, kind: string, day: string, ordinal: number): Claim {
  return {
    layer: 'derived',
    rawSubject: subject,
    predicate: eventDatePredicate(kind),
    object: day,
    provenance: { sourceFile: 'opendata/2025-01-01/raw.csv', ordinal, vintage: '2025-01-01' },
    rule: EVENT_DATE_RULE,
  };
}

describe.skipIf(!duckDbAvailable())('foldSubjectAllocations — controlled ledger', { tags: ['unit'] }, () => {
  it('Fold_PerSubject_LiftsTheEarliestIssuedAndOriginalStartAndIgnoresBookkeeping', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-analytics-fold-'));
    const ledgerDir = path.join(root, 'ledger');
    fs.mkdirSync(ledgerDir, { recursive: true });
    const claims: Claim[] = [
      // M7ABC: two issued dates (earliest wins) and a bookkeeping stamp (ignored).
      eventClaim('M7ABC', 'licence-issued', '2019-06-01', 0),
      eventClaim('M7ABC', 'licence-issued', '2019-03-01', 1),
      eventClaim('M7ABC', 'record-created', '2016-08-12', 2),
      // M0XYZ: only an original-start date.
      eventClaim('M0XYZ', 'licence-version-original-start', '2005-04-04', 3),
      // 20QRS: only bookkeeping — no allocation evidence, both columns NULL.
      eventClaim('20QRS', 'record-last-modified', '2020-01-01', 4),
    ];
    fs.writeFileSync(path.join(ledgerDir, 'fixture.jsonl'), serialiseClaimsJsonl(claims));
    try {
      const rows = foldSubjectAllocations(ledgerDir);
      const bySubject = new Map(rows.map(r => [r.subject, r]));
      expect(bySubject.get('M7ABC')).toEqual({ subject: 'M7ABC', minIssued: '2019-03-01', minOriginalStart: null });
      expect(bySubject.get('M0XYZ')).toEqual({ subject: 'M0XYZ', minIssued: null, minOriginalStart: '2005-04-04' });
      expect(bySubject.get('20QRS')).toEqual({ subject: '20QRS', minIssued: null, minOriginalStart: null });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('Fold_ToComputedAnalytics_ProducesASequentialFindingForOrderedFixtureData', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-analytics-fold-'));
    const ledgerDir = path.join(root, 'ledger');
    fs.mkdirSync(ledgerDir, { recursive: true });
    // A tiny, perfectly-sequential M7 fixture: later suffix, later issue date.
    const suffixes = ['AAA', 'AAB', 'AAC', 'AAD', 'AAE'];
    const claims = suffixes.map((s, i) => eventClaim(`M7${s}`, 'licence-issued', `2019-0${i + 1}-01`, i));
    fs.writeFileSync(path.join(ledgerDir, 'fixture.jsonl'), serialiseClaimsJsonl(claims));
    try {
      const a = computeSequenceAnalytics(ledgerDir, ref);
      const m7 = a.series.find(s => s.series === 'M7');
      expect(m7?.population).toBe(5);
      expect(m7?.dated).toBe(5);
      expect(m7?.correlation).toBe(1);
      expect(renderSequenceAnalytics(a)).toContain('# Namespace sequence analytics');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
