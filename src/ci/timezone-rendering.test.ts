import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  ukBstWindows,
  seasonOf,
  classifyPair,
  resolveSourceLabels,
  computeTimezoneRendering,
  renderTimezoneRendering,
  DEFAULT_CLASSIFIER_PARAMS,
  type PairEvidence,
  type ClassifiedPair,
  type TimedColumnBinding,
} from './timezone-rendering.ts';
import { duckDbAvailable } from '../v2/report-fold.ts';
import { serialiseClaimsJsonl } from '../v2/serialise.ts';
import { EVENT_DATE_RULE, type Claim } from '../v2/claim.ts';

// Issue #858: per-source timezone-rendering classification via chained
// natural experiments. Test names follow Subject_Scenario_Outcome. The
// scenarios are the issue's binding requirements: the boundary experiment
// orients a pair, winter-only overlap is honestly undeterminable (never
// collapsed into "same convention"), a pair with no time-of-day anywhere
// yields no experiment at all, conflicting evidence is a loud finding rather
// than an average, and every propagated label records its evidence chain.

// --- The UK BST window table (pure) ----------------------------------------

describe('UK BST windows', { tags: ['unit'] }, () => {
  it('BstWindows_ModernRuleYears_LandOnTheKnownLastSundays', () => {
    const windows = new Map(ukBstWindows().map(w => [w.year, w]));
    // Known transition dates under the harmonised rule.
    expect(windows.get(2024)).toEqual({ year: 2024, start: '2024-03-31', end: '2024-10-27' });
    expect(windows.get(2025)).toEqual({ year: 2025, start: '2025-03-30', end: '2025-10-26' });
    expect(windows.get(2016)).toEqual({ year: 2016, start: '2016-03-27', end: '2016-10-30' });
    expect(windows.get(1996)).toEqual({ year: 1996, start: '1996-03-31', end: '1996-10-27' });
  });

  it('SeasonOf_MidSummerAndMidWinterDays_ClassifyAsSummerAndWinter', () => {
    expect(seasonOf('2024-07-15')).toBe('summer');
    expect(seasonOf('2024-01-15')).toBe('winter');
    expect(seasonOf('2024-12-25')).toBe('winter');
  });

  it('SeasonOf_TransitionAdjacentDays_AreExcludedAsMargin', () => {
    // The clocks change at 01:00 on the transition days; day precision
    // cannot split them, so the day either side is excluded too.
    for (const day of ['2024-03-30', '2024-03-31', '2024-04-01', '2024-10-26', '2024-10-27', '2024-10-28']) {
      expect(seasonOf(day), day).toBe('margin');
    }
  });

  it('SeasonOf_DatesBeforeTheTableFirstYear_AreExcludedNotGuessed', () => {
    // Pre-1996 the end-of-BST rule differed (and 1968-71 ran BST all year),
    // so a pre-table date is never classified under the modern rule.
    expect(seasonOf('1995-06-01')).toBe('pre-table');
    expect(seasonOf('1970-01-01')).toBe('pre-table');
  });
});

// --- The pairwise classifier (pure) -----------------------------------------

function evidence(partial: Partial<PairEvidence>): PairEvidence {
  return {
    timedLane: 'foi', timedDataset: 'timed-source',
    partnerLane: 'foi', partnerDataset: 'partner-source',
    kind: 'record-last-modified',
    utcShift: 0, localShift: 0, h23Agree: 0, h0Agree: 0,
    agreeNoSignal: 0, unexplained: 0, notComparable: 0, excluded: 0,
    ...partial,
  };
}

describe('pairwise boundary-experiment classifier', { tags: ['unit'] }, () => {
  it('Pair_SummerHour23StampsOneDayLaterInThePartner_OrientsTimedSideToUtc', () => {
    // The anchor pair's shape (issue #857/#858): a mass of hour-23 stamps
    // one day later in the partner, mid-afternoon controls agreeing, noise
    // within tolerance.
    const verdict = classifyPair(evidence({ utcShift: 629, h23Agree: 1, h0Agree: 9, agreeNoSignal: 80195, unexplained: 4 }));
    expect(verdict).toEqual({ verdict: 'differs-by-local-offset', utcSide: 'timed', evidence: 629 });
  });

  it('Pair_SummerHour0StampsOneDayEarlierInThePartner_OrientsPartnerSideToUtc', () => {
    // The converse orientation: the timed side renders local, so its
    // non-midnight 00:xx summer stamps fall a day earlier in a UTC partner.
    const verdict = classifyPair(evidence({ localShift: 40, agreeNoSignal: 500 }));
    expect(verdict).toEqual({ verdict: 'differs-by-local-offset', utcSide: 'partner', evidence: 40 });
  });

  it('Pair_BothMidnightOffsetWindowsAgreeing_IsSameConvention', () => {
    const verdict = classifyPair(evidence({ h23Agree: 693, h0Agree: 13, agreeNoSignal: 49209 }));
    expect(verdict).toEqual({ verdict: 'same-convention', evidence: 706 });
  });

  it('Pair_OnlyOneWindowCovered_IsAPartialConstraintNeverSameConvention', () => {
    // Agreement in the hour-23 window alone excludes (timed=UTC ∧
    // partner=local) but leaves the reverse orientation untested — the
    // wdtk-596532 / ofcom-756622 shape.
    const verdict = classifyPair(evidence({ h23Agree: 223, agreeNoSignal: 100000 }));
    expect(verdict).toEqual({ verdict: 'agreement-only-h23', evidence: 223 });
    const verdict0 = classifyPair(evidence({ h0Agree: 17, agreeNoSignal: 100 }));
    expect(verdict0).toEqual({ verdict: 'agreement-only-h0', evidence: 17 });
  });

  it('Pair_WinterOnlyOrMiddayOnlyOverlap_IsNoBoundarySignalNeverSame', () => {
    // The degeneracy the issue makes binding: GMT = UTC in winter, so
    // agreement everywhere with no summer boundary-window stamp must read
    // as undeterminable, never as "same convention".
    const verdict = classifyPair(evidence({ agreeNoSignal: 50000, notComparable: 1000 }));
    expect(verdict).toEqual({ verdict: 'no-boundary-signal' });
  });

  it('Pair_BoundaryCellsBelowTheEvidenceFloor_IsInsufficientEvidence', () => {
    const verdict = classifyPair(evidence({ utcShift: 2, agreeNoSignal: 50343, h0Agree: 1 }));
    expect(verdict).toEqual({ verdict: 'insufficient-evidence' });
  });

  it('Pair_BothOrientationsFiring_IsConflictingEvidenceNeverAnAverage', () => {
    const verdict = classifyPair(evidence({ utcShift: 20, localShift: 20 }));
    expect(verdict.verdict).toBe('conflicting-evidence');
  });

  it('Pair_OrientedShiftsRivalledByInWindowAgreement_IsConflictingEvidence', () => {
    // Half the hour-23 stamps shifted and half agreed: no single convention
    // pair explains that — loud, not averaged.
    const verdict = classifyPair(evidence({ utcShift: 50, h23Agree: 50 }));
    expect(verdict.verdict).toBe('conflicting-evidence');
  });

  it('Pair_UnexplainedDisagreementBeyondTolerance_IsConflictingEvidence', () => {
    const verdict = classifyPair(evidence({ utcShift: 20, unexplained: 15 }));
    expect(verdict.verdict).toBe('conflicting-evidence');
  });

  it('Pair_Hour0AgreementUnderTimedUtcOrientation_DoesNotContradictTheVerdict', () => {
    // A UTC 00:xx stamp stays on the same local day, so h0 agreement is
    // expected under a timed-side-UTC orientation and must not be read as
    // contradiction.
    const verdict = classifyPair(evidence({ utcShift: 100, h0Agree: 50 }));
    expect(verdict).toEqual({ verdict: 'differs-by-local-offset', utcSide: 'timed', evidence: 100 });
  });
});

// --- Chained label resolution (pure) ----------------------------------------

function classified(partial: Partial<PairEvidence>, verdict: ClassifiedPair['verdict']): ClassifiedPair {
  return { ...evidence(partial), verdict };
}

const UNIVERSE = [
  { lane: 'foi', dataset: 'a' },
  { lane: 'foi', dataset: 'b' },
  { lane: 'foi', dataset: 'c' },
  { lane: 'foi', dataset: 'd' },
  { lane: 'foi', dataset: 'e' },
];

function pairAB(verdict: ClassifiedPair['verdict']): ClassifiedPair {
  return classified({ timedDataset: 'a', partnerDataset: 'b' }, verdict);
}

describe('chained per-source label resolution', { tags: ['unit'] }, () => {
  it('OrientedPair_LabelsBothEndsAbsolutely_WithThePairAsTheChain', () => {
    const result = resolveSourceLabels([pairAB({ verdict: 'differs-by-local-offset', utcSide: 'timed', evidence: 629 })], UNIVERSE);
    const a = result.find(s => s.dataset === 'a');
    const b = result.find(s => s.dataset === 'b');
    expect(a?.label).toBe('utc');
    expect(b?.label).toBe('local');
    expect(a?.chain).toHaveLength(1);
    expect(a?.chain[0]?.pair).toContain('foi/a vs foi/b');
  });

  it('SameConventionEdge_PropagatesALabel_RecordingTheTwoHopChain', () => {
    const result = resolveSourceLabels([
      pairAB({ verdict: 'differs-by-local-offset', utcSide: 'timed', evidence: 629 }),
      classified({ timedDataset: 'a', partnerDataset: 'c' }, { verdict: 'same-convention', evidence: 700 }),
    ], UNIVERSE);
    const c = result.find(s => s.dataset === 'c');
    expect(c?.label).toBe('utc');
    expect(c?.chain.map(h => h.pair)).toEqual([
      'foi/a vs foi/b [record-last-modified]',
      'foi/a vs foi/c [record-last-modified]',
    ]);
  });

  it('OneWindowConstraint_CombinesWithAKnownPartnerLabel_ToPinTheOtherEnd', () => {
    // h23 agreement excludes (timed=UTC ∧ partner=local): with the partner
    // known local, the timed side must be local too.
    const result = resolveSourceLabels([
      pairAB({ verdict: 'differs-by-local-offset', utcSide: 'timed', evidence: 629 }), // a=utc, b=local
      classified({ timedDataset: 'd', partnerDataset: 'b' }, { verdict: 'agreement-only-h23', evidence: 223 }),
    ], UNIVERSE);
    const d = result.find(s => s.dataset === 'd');
    expect(d?.label).toBe('local');
    expect(d?.chain.map(h => h.pair)).toEqual([
      'foi/a vs foi/b [record-last-modified]',
      'foi/d vs foi/b [record-last-modified]',
    ]);
  });

  it('OneWindowConstraint_WithNoLabelledPartner_LeavesBothEndsUnclassified', () => {
    // The wdtk-596532 / ofcom-756622 shape: a partial constraint alone
    // classifies nothing.
    const result = resolveSourceLabels([
      classified({ timedDataset: 'd', partnerDataset: 'e' }, { verdict: 'agreement-only-h23', evidence: 223 }),
    ], UNIVERSE);
    expect(result.find(s => s.dataset === 'd')?.status).toBe('unclassified');
    expect(result.find(s => s.dataset === 'e')?.status).toBe('unclassified');
    expect(result.find(s => s.dataset === 'd')?.reason).toContain('one-window agreement');
  });

  it('ConflictingRoutes_DerivingBothLabelsForOneSource_AreALoudFindingNotAnAverage', () => {
    const result = resolveSourceLabels([
      pairAB({ verdict: 'differs-by-local-offset', utcSide: 'timed', evidence: 629 }), // b=local
      classified({ timedDataset: 'c', partnerDataset: 'b' }, { verdict: 'differs-by-local-offset', utcSide: 'partner', evidence: 50 }), // says b=utc
    ], UNIVERSE);
    const b = result.find(s => s.dataset === 'b');
    expect(b?.status).toBe('conflicting-evidence');
    expect(b?.reason).toContain("'local'");
    expect(b?.reason).toContain("'utc'");
  });

  it('SourceWithNoUsablePair_StaysHonestlyUnclassified_NamingTheReason', () => {
    const result = resolveSourceLabels([pairAB({ verdict: 'differs-by-local-offset', utcSide: 'timed', evidence: 629 })], UNIVERSE);
    const e = result.find(s => s.dataset === 'e');
    expect(e?.status).toBe('unclassified');
    expect(e?.label).toBeNull();
    expect(e?.reason).toContain('no pairwise experiment');
  });

  it('IndependentAgreeingRoutes_AreCountedAsCorroboration_NotDuplicateChains', () => {
    const result = resolveSourceLabels([
      pairAB({ verdict: 'differs-by-local-offset', utcSide: 'timed', evidence: 629 }),
      classified({ timedDataset: 'a', partnerDataset: 'c' }, { verdict: 'differs-by-local-offset', utcSide: 'timed', evidence: 100 }),
    ], UNIVERSE);
    const a = result.find(s => s.dataset === 'a');
    expect(a?.label).toBe('utc');
    expect(a?.corroboratingRoutes).toBe(1);
  });
});

// --- The fold over a fixture ledger (DuckDB) ---------------------------------

describe.skipIf(!duckDbAvailable())('timezone-rendering fold over a fixture ledger', { tags: ['unit'] }, () => {
  const BINDINGS: TimedColumnBinding[] = [
    { lane: 'foi', dataset: 'synth-timed', header: 'LastModifiedDate', kind: 'record-last-modified', grammar: 'YYYY-MM-DD' },
    { lane: 'foi', dataset: 'synth-w1', header: 'LastModifiedDate', kind: 'record-created', grammar: 'YYYY-MM-DD' },
    { lane: 'foi', dataset: 'synth-w2', header: 'Last Modified Date', kind: 'record-created', grammar: 'DD/MM/YYYY' },
  ];

  function claim(sourceFile: string, ordinal: number, rawSubject: string, predicate: string, object: string, rule?: string): Claim {
    const c: Claim = {
      layer: rule === undefined ? 'raw' : 'derived',
      rawSubject,
      predicate,
      object,
      provenance: { sourceFile, ordinal, vintage: '2024-07' },
    };
    if (rule !== undefined) c.rule = rule;
    return c;
  }

  // One timed observation (raw datetime cell + its S1 day claim) and the
  // partner's S1 day claim for the same subject.
  function observation(claims: Claim[], ordinal: number, subject: string, kind: string, timedValue: string, timedDay: string, partnerDay: string): void {
    claims.push(claim('foi/synth-timed/x.csv', ordinal, subject, 'LastModifiedDate', timedValue));
    claims.push(claim('foi/synth-timed/x.csv', ordinal, subject, `event-date/${kind}`, timedDay, EVENT_DATE_RULE));
    claims.push(claim('foi/synth-partner/y.csv', ordinal, subject, `event-date/${kind}`, partnerDay, EVENT_DATE_RULE));
  }

  function writeFixtureLedger(): string {
    const claims: Claim[] = [];
    // Eight summer hour-23 subjects one day later in the partner: the
    // oriented boundary signal (timed = UTC, partner = local).
    for (let i = 0; i < 8; i++) {
      observation(claims, i, `M7AA${i}`, 'record-last-modified', '2024-07-10 23:0' + String(i % 10) + ':00', '2024-07-10', '2024-07-11');
    }
    // Six mid-afternoon summer controls agreeing on both sides.
    for (let i = 0; i < 6; i++) {
      observation(claims, 10 + i, `M7BB${i}`, 'record-last-modified', '2024-07-09 15:30:00', '2024-07-09', '2024-07-09');
    }
    // Four winter stamps agreeing (no signal either way).
    for (let i = 0; i < 4; i++) {
      observation(claims, 20 + i, `M7CC${i}`, 'record-last-modified', '2024-01-15 23:15:00', '2024-01-15', '2024-01-15');
    }
    // One revised-between-exports record (beyond one day): excluded.
    observation(claims, 30, 'M7DD0', 'record-last-modified', '2024-07-01 12:00:00', '2024-07-01', '2023-05-05');
    // A multi-valued subject on the timed side: two distinct datetimes.
    claims.push(claim('foi/synth-timed/x.csv', 31, 'M7EE0', 'LastModifiedDate', '2024-07-02 10:00:00'));
    claims.push(claim('foi/synth-timed/x.csv', 32, 'M7EE0', 'LastModifiedDate', '2024-07-03 11:00:00'));
    claims.push(claim('foi/synth-timed/x.csv', 31, 'M7EE0', 'event-date/record-last-modified', '2024-07-02', EVENT_DATE_RULE));
    claims.push(claim('foi/synth-timed/x.csv', 32, 'M7EE0', 'event-date/record-last-modified', '2024-07-03', EVENT_DATE_RULE));
    claims.push(claim('foi/synth-partner/y.csv', 33, 'M7EE0', 'event-date/record-last-modified', '2024-07-02', EVENT_DATE_RULE));

    // The winter-only pair (synth-w1 timed, synth-w2 partner): agreement
    // everywhere, every stamp winter-dated — the degeneracy scenario.
    for (let i = 0; i < 7; i++) {
      claims.push(claim('foi/synth-w1/w.csv', i, `G0WW${i}`, 'LastModifiedDate', '2023-12-0' + String(1 + i) + ' 23:30:00'));
      claims.push(claim('foi/synth-w1/w.csv', i, `G0WW${i}`, 'event-date/record-created', '2023-12-0' + String(1 + i), EVENT_DATE_RULE));
      claims.push(claim('foi/synth-w2/w.csv', i, `G0WW${i}`, 'event-date/record-created', '2023-12-0' + String(1 + i), EVENT_DATE_RULE));
    }

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'timezone-rendering-fixture-'));
    fs.writeFileSync(path.join(dir, 'fixture.jsonl'), serialiseClaimsJsonl(claims));
    return dir;
  }

  it('BoundaryExperiment_OverAFixtureLedger_OrientsTheTimedSideToUtcAndLabelsBothSources', () => {
    const dir = writeFixtureLedger();
    try {
      const t = computeTimezoneRendering(dir, DEFAULT_CLASSIFIER_PARAMS, BINDINGS);
      const pair = t.pairs.find(p => p.timedDataset === 'synth-timed' && p.partnerDataset === 'synth-partner');
      expect(pair).toBeDefined();
      expect(pair?.utcShift).toBe(8);
      expect(pair?.agreeNoSignal).toBe(6 + 4); // controls + winter
      expect(pair?.notComparable).toBe(1);
      expect(pair?.verdict).toEqual({ verdict: 'differs-by-local-offset', utcSide: 'timed', evidence: 8 });
      expect(t.sources.find(s => s.dataset === 'synth-timed')?.label).toBe('utc');
      expect(t.sources.find(s => s.dataset === 'synth-partner')?.label).toBe('local');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('MultiValuedSubjects_OnEitherSide_AreExcludedFromTheExperimentAndCounted', () => {
    const dir = writeFixtureLedger();
    try {
      const t = computeTimezoneRendering(dir, DEFAULT_CLASSIFIER_PARAMS, BINDINGS);
      // M7EE0 carries two distinct timed values, so it anchors nothing: the
      // pair's cells cover exactly the 8+6+4+1 single-valued subjects.
      const pair = t.pairs.find(p => p.timedDataset === 'synth-timed' && p.partnerDataset === 'synth-partner');
      expect((pair?.utcShift ?? 0) + (pair?.agreeNoSignal ?? 0) + (pair?.notComparable ?? 0)).toBe(19);
      const kindRow = t.sourceKinds.find(s => s.dataset === 'synth-timed' && s.kind === 'record-last-modified');
      expect(kindRow?.multiValuedSubjects).toBe(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('WinterOnlyOverlap_EvenWithHour23Stamps_IsNoBoundarySignalAndBothSourcesStayUnclassified', () => {
    const dir = writeFixtureLedger();
    try {
      const t = computeTimezoneRendering(dir, DEFAULT_CLASSIFIER_PARAMS, BINDINGS);
      const pair = t.pairs.find(p => p.timedDataset === 'synth-w1' && p.partnerDataset === 'synth-w2');
      expect(pair?.verdict).toEqual({ verdict: 'no-boundary-signal' });
      expect(t.sources.find(s => s.dataset === 'synth-w1')?.status).toBe('unclassified');
      expect(t.sources.find(s => s.dataset === 'synth-w2')?.status).toBe('unclassified');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('PairWithNoTimeOfDayOnEitherSide_YieldsNoExperimentAtAll', () => {
    const dir = writeFixtureLedger();
    try {
      const t = computeTimezoneRendering(dir, DEFAULT_CLASSIFIER_PARAMS, BINDINGS);
      // synth-w2 binds a day-first grammar but its ledger carries only day
      // claims (no raw datetime cells), so it never appears as a timed side.
      expect(t.pairs.some(p => p.timedDataset === 'synth-w2')).toBe(false);
      // And synth-partner (date-only, no binding at all) likewise.
      expect(t.pairs.some(p => p.timedDataset === 'synth-partner')).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('Render_OverTheFixtureFold_IsByteDeterministicAndNamesTheChains', () => {
    const dir = writeFixtureLedger();
    try {
      const first = renderTimezoneRendering(computeTimezoneRendering(dir, DEFAULT_CLASSIFIER_PARAMS, BINDINGS));
      const second = renderTimezoneRendering(computeTimezoneRendering(dir, DEFAULT_CLASSIFIER_PARAMS, BINDINGS));
      expect(second).toBe(first);
      expect(first).toContain('renders UTC');
      expect(first).toContain('renders Europe/London local time');
      expect(first).toContain('foi/synth-timed vs foi/synth-partner [record-last-modified]');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('EmptyClaimsSource_AsInTheReportSweepFixtureContext_FoldsToTheHonestEmptyPicture', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'timezone-rendering-empty-'));
    try {
      const t = computeTimezoneRendering(dir, DEFAULT_CLASSIFIER_PARAMS, BINDINGS);
      expect(t.sources).toEqual([]);
      expect(t.pairs).toEqual([]);
      // The render still produces the (honestly empty) report shape.
      expect(renderTimezoneRendering(t)).toContain('# Timezone-rendering classification');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
