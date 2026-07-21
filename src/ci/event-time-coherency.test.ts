import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  DEFAULT_EPISODE_PARAMS,
  CLASSIFICATION_GLOSSES,
  MECHANISM_GLOSSES,
  NOTABLE_PAIR_MIN,
  detectEpisodeSignals,
  mergeEpisodes,
  temporalityOf,
  computeEventTimeCoherency,
  subjectKindSequence,
  renderEventTimeCoherency,
  type DaySignal,
  type EpisodeParams,
  type EventTimeCoherency,
} from './event-time-coherency.ts';
import { duckDbAvailable } from '../v2/report-fold.ts';
import { serialiseClaimsJsonl } from '../v2/serialise.ts';
import { EVENT_DATE_KINDS, EVENT_DATE_RULE, eventDatePredicate, type Claim } from '../v2/claim.ts';

// Issue #725 S2: the cross-vintage retroactive-revision detector. Test names
// follow Subject_Scenario_Outcome. The scenarios below are the user-facing
// guarantees: a mass-update episode is one finding (never tens of thousands),
// a revised past-event date is flagged with a candidate mechanism and no
// verdict, agreement reads as corroboration, and a blank vintage is a
// non-observation.

// --- Episode detection (pure) ----------------------------------------------

function day(dataset: string, kind: string, isoDay: string, n: number): DaySignal {
  return { lane: 'opendata', dataset, vintage: dataset, kind, day: isoDay, n };
}

// Loosened floor for synthetic histograms: the default minPopulated guards
// the real corpus against sparse-column noise, which these small fixtures
// would otherwise trip.
const TEST_PARAMS: EpisodeParams = { ...DEFAULT_EPISODE_PARAMS, minPopulated: 10 };

describe('mass-episode detection — the naive v1 spike rule', { tags: ['unit'] }, () => {
  it('EpisodeDetector_MajorityClusteredOnTwoNearbyDays_FlagsOneSignalWithBothPeaks', () => {
    // 60% of the dataset's dates on two days 19 days apart (the #801 shape).
    const signals = detectEpisodeSignals([
      day('2025-11-11', 'licence-version-last-modified', '2025-10-11', 50),
      day('2025-11-11', 'licence-version-last-modified', '2025-10-30', 10),
      day('2025-11-11', 'licence-version-last-modified', '2024-01-01', 20),
      day('2025-11-11', 'licence-version-last-modified', '2023-06-15', 20),
    ], TEST_PARAMS);
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({ windowStart: '2025-10-11', windowEnd: '2025-10-30', rows: 60, populated: 100, share: 0.6 });
    expect(signals[0].peakDays.map(p => p.day)).toEqual(['2025-10-11', '2025-10-30']);
  });

  it('EpisodeDetector_ClusterAtExactlyTheThresholdShare_IsNotFlagged', () => {
    // The rule is STRICTLY more than the threshold ("flag any window where
    // >50% of records updated").
    const signals = detectEpisodeSignals([
      day('d', 'record-last-modified', '2020-01-01', 50),
      day('d', 'record-last-modified', '2010-01-01', 25),
      day('d', 'record-last-modified', '2005-01-01', 25),
    ], TEST_PARAMS);
    expect(signals).toHaveLength(0);
  });

  it('EpisodeDetector_MonthsLongRollingSpread_IsInvisibleAtTheDefaultWindowByDesign', () => {
    // The recorded 2024 rolling reprocessing: ~14 consecutive weeks at ~7%
    // each, no single-day spike. The default 21-day window must NOT flag it
    // (the issue's "window is a parameter to tune" note), and a months-scale
    // window MUST — the parameter is the honest boundary, not a blind spot.
    const weeks: DaySignal[] = [];
    for (let week = 0; week < 14; week++) {
      const date = new Date(Date.UTC(2024, 5, 3 + week * 7));
      weeks.push(day('d', 'record-last-modified', date.toISOString().slice(0, 10), 7));
    }
    weeks.push(day('d', 'record-last-modified', '2016-08-12', 2));
    expect(detectEpisodeSignals(weeks, TEST_PARAMS)).toHaveLength(0);
    const monthsScale = detectEpisodeSignals(weeks, { ...TEST_PARAMS, windowDays: 120 });
    expect(monthsScale).toHaveLength(1);
    expect(monthsScale[0].share).toBeGreaterThan(0.9);
  });

  it('EpisodeDetector_NoiseDaysAtTheWindowEdges_AreTrimmedFromTheReportedSpan', () => {
    // A sub-noise-floor day inside the window must not stretch the reported
    // episode span (populated 1000, so 5 rows = 0.5% < the 1% floor).
    const signals = detectEpisodeSignals([
      day('d', 'record-created', '2016-07-20', 5),
      day('d', 'record-created', '2016-07-23', 600),
      day('d', 'record-created', '2016-08-02', 100),
      day('d', 'record-created', '2010-05-05', 295),
    ], { ...TEST_PARAMS, minPopulated: 1000 });
    expect(signals).toHaveLength(1);
    expect(signals[0].windowStart).toBe('2016-07-23');
    expect(signals[0].windowEnd).toBe('2016-08-02');
    expect(signals[0].rows).toBe(700);
  });

  it('EpisodeDetector_SparseColumnBelowThePopulatedFloor_IsNeverEpisodeEvidence', () => {
    // 100% of a 9-row column on one day is a handful of rows, not a mass
    // touch — the minPopulated floor keeps it out of the flagged evidence.
    const sparse = [day('d', 'reserved-until', '2017-06-30', 9)];
    expect(detectEpisodeSignals(sparse, TEST_PARAMS)).toHaveLength(0);
    expect(detectEpisodeSignals(sparse, { ...TEST_PARAMS, minPopulated: 5 })).toHaveLength(1);
  });

  it('EpisodeDetector_TwoSeparateClustersUnderATunedDownThreshold_EachSurface', () => {
    const signals = detectEpisodeSignals([
      day('d', 'record-last-modified', '2016-07-23', 40),
      day('d', 'record-last-modified', '2020-12-10', 35),
      day('d', 'record-last-modified', '2005-01-01', 25),
    ], { ...TEST_PARAMS, shareThreshold: 0.3 });
    expect(signals.map(s => s.windowStart)).toEqual(['2016-07-23', '2020-12-10']);
  });

  it('MergeEpisodes_OverlappingWindowsAcrossDatasetsAndKinds_UnifyIntoOneEpisode', () => {
    // Several vintages (and two bookkeeping columns) each witnessing the same
    // clustered window are ONE episode — the #801 aggregation that keeps ~87k
    // touched records from becoming ~87k findings.
    const signals = detectEpisodeSignals([
      day('2023-01-25', 'record-last-modified', '2016-07-23', 30),
      day('2023-01-25', 'record-last-modified', '2016-08-12', 40),
      day('2023-01-25', 'record-last-modified', '2020-01-01', 30),
      day('2024-09', 'record-created', '2016-07-29', 80),
      day('2024-09', 'record-created', '2000-01-01', 20),
    ], TEST_PARAMS);
    expect(signals).toHaveLength(2);
    const episodes = mergeEpisodes(signals);
    expect(episodes).toHaveLength(1);
    expect(episodes[0].start).toBe('2016-07-23');
    expect(episodes[0].end).toBe('2016-08-12');
    expect(episodes[0].signals).toHaveLength(2);
  });

  it('MergeEpisodes_DisjointWindows_StaySeparateEpisodesInDateOrder', () => {
    const signals = detectEpisodeSignals([
      day('a', 'record-last-modified', '2025-10-11', 90),
      day('a', 'record-last-modified', '2020-01-01', 10),
      day('b', 'record-created', '2016-07-23', 90),
      day('b', 'record-created', '2020-01-01', 10),
    ], TEST_PARAMS);
    const episodes = mergeEpisodes(signals);
    expect(episodes.map(e => e.start)).toEqual(['2016-07-23', '2025-10-11']);
  });
});

// --- Authored kind temporality ---------------------------------------------

describe('kind temporality is total over the S1 vocabulary', { tags: ['unit'] }, () => {
  it('EveryAuthoredEventKind_HasAnAuthoredTemporality_SoNoKindEscapesComparisonSemantics', () => {
    for (const kind of EVENT_DATE_KINDS) {
      expect(['past-event', 'bookkeeping', 'forward-looking']).toContain(temporalityOf(kind));
    }
  });

  it('TemporalityRegistry_WhenAskedForAnUnknownKind_FailsLoudRatherThanGuessing', () => {
    expect(() => temporalityOf('some-new-kind')).toThrow(/no authored temporality/);
  });
});

// --- The classification vocabulary over a fixture ledger --------------------
//
// A three-vintage synthetic corpus staging every classification as a
// user-recognisable scenario, folded by the REAL pipeline (day histogram →
// episode detection → SQL classification), so the vocabulary is proven
// end-to-end without the real archive.

const V1 = 'opendata/2020-06-01/fixture.csv';
const V2 = 'opendata/2025-12-01/fixture.csv';
const V3 = 'opendata/2026-03-01/fixture.csv';

function eventClaim(sourceFile: string, subject: string, kind: string, isoDay: string, ordinal: number): Claim {
  return {
    layer: 'derived',
    rawSubject: subject,
    predicate: eventDatePredicate(kind),
    object: isoDay,
    provenance: { sourceFile, ordinal, vintage: sourceFile.split('/')[1] },
    rule: EVENT_DATE_RULE,
  };
}

function writeFixtureLedger(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'event-time-coherency-fixture-'));
  let ordinal = 0;
  const at = (sourceFile: string, subject: string, kind: string, isoDay: string): Claim =>
    eventClaim(sourceFile, subject, kind, isoDay, ordinal++);
  const claims: Claim[] = [
    // corroborated: the second vintage repeats the first's created date.
    at(V1, 'CORRO', 'record-created', '2010-05-05'),
    at(V2, 'CORRO', 'record-created', '2010-05-05'),
    // revised-backward on a past-event kind, single row each side.
    at(V1, 'BACK', 'record-created', '2000-05-05'),
    at(V2, 'BACK', 'record-created', '1999-01-01'),
    // Non-observation skip: absent from the middle vintage, agreeing across
    // the gap — the pair compares V1 against V3 directly.
    at(V1, 'SKIP', 'record-created', '2012-12-12'),
    at(V3, 'SKIP', 'record-created', '2012-12-12'),
    // A subject first observed in V2 has nothing to compare.
    at(V2, 'NEWCOMER', 'record-created', '2024-01-01'),
    // #800 mechanism A: the earlier vintage held TWO version rows; the later
    // vintage lost the older one, so the earliest surviving date moved
    // forward — version-window-drop.
    at(V1, 'FWDDROP', 'licence-version-original-start', '1950-01-01'),
    at(V1, 'FWDDROP', 'licence-version-original-start', '1980-01-01'),
    at(V2, 'FWDDROP', 'licence-version-original-start', '1980-01-01'),
    // #800 mechanism B: a sole row's date replaced wholesale.
    at(V1, 'FWDSOLE', 'licence-version-original-start', '1977-07-09'),
    at(V2, 'FWDSOLE', 'licence-version-original-start', '2025-11-23'),
    // The mirror: the later vintage carries an OLDER row the earlier export
    // did not, while the earlier assertion survives among its rows.
    at(V1, 'BACKEXT', 'licence-version-original-start', '2015-02-07'),
    at(V2, 'BACKEXT', 'licence-version-original-start', '1952-10-10'),
    at(V2, 'BACKEXT', 'licence-version-original-start', '2015-02-07'),
    // A reservation window's stated end moved — routine renewal bookkeeping.
    at(V1, 'WINDOW', 'reserved-until', '2024-06-30'),
    at(V2, 'WINDOW', 'reserved-until', '2029-06-30'),
  ];
  // Bookkeeping: eight of V2's ten last-modified dates land on one day (an
  // 80% single-day cluster — a detected episode), so those eight forward
  // movements read as episode-member; one moves forward outside the episode
  // (expected-progression); one moves backward (revised-backward). V1's
  // last-modified dates are spread across months so V1 shows no cluster.
  for (let i = 1; i <= 8; i++) {
    claims.push(at(V1, `EPI0${i}`, 'record-last-modified', `2020-0${i}-05`));
    claims.push(at(V2, `EPI0${i}`, 'record-last-modified', '2025-10-11'));
  }
  claims.push(at(V1, 'PROG', 'record-last-modified', '2020-09-09'));
  claims.push(at(V2, 'PROG', 'record-last-modified', '2025-12-01'));
  claims.push(at(V1, 'LMBACK', 'record-last-modified', '2024-03-03'));
  claims.push(at(V2, 'LMBACK', 'record-last-modified', '2024-03-02'));
  fs.writeFileSync(path.join(dir, 'fixture.jsonl'), serialiseClaimsJsonl(claims));
  return dir;
}

// The fixture's smallest kind population is what the floor must admit.
const FIXTURE_PARAMS: EpisodeParams = { ...DEFAULT_EPISODE_PARAMS, minPopulated: 10 };

describe.skipIf(!duckDbAvailable())('classification over a fixture ledger', { tags: ['unit'] }, () => {
  it('FixtureCorpus_WhenFolded_ClassifiesEveryScenarioAndAggregatesTheEpisode', () => {
    const dir = writeFixtureLedger();
    try {
      const c = computeEventTimeCoherency(dir, FIXTURE_PARAMS);

      // The 80% single-day cluster in V2's last-modified dates is an episode.
      expect(c.episodes).toHaveLength(1);
      expect(c.episodes[0]).toMatchObject({ start: '2025-10-11', end: '2025-10-11' });
      expect(c.episodes[0].signals[0]).toMatchObject({ dataset: '2025-12-01', kind: 'record-last-modified', rows: 8, populated: 10, share: 0.8 });

      // Every classification lands exactly where its scenario says.
      expect(c.totals).toEqual([
        { kind: 'licence-version-original-start', classification: 'revised-backward', subjects: 1 },
        { kind: 'licence-version-original-start', classification: 'revised-forward', subjects: 2 },
        { kind: 'record-created', classification: 'corroborated', subjects: 2 },
        { kind: 'record-created', classification: 'revised-backward', subjects: 1 },
        { kind: 'record-last-modified', classification: 'episode-member', subjects: 8 },
        { kind: 'record-last-modified', classification: 'expected-progression', subjects: 1 },
        { kind: 'record-last-modified', classification: 'revised-backward', subjects: 1 },
        { kind: 'reserved-until', classification: 'window-restated', subjects: 1 },
      ]);

      // The candidate mechanisms attach exactly per issue #800's two shapes
      // (and the extension mirror); episode members carry none.
      const mechanisms = new Map(c.exemplars.map(e => [e.subject, `${e.classification}/${e.mechanism}`]));
      expect(mechanisms.get('FWDDROP')).toBe('revised-forward/version-window-drop');
      expect(mechanisms.get('FWDSOLE')).toBe('revised-forward/sole-row-replacement');
      expect(mechanisms.get('BACKEXT')).toBe('revised-backward/version-window-extension');
      expect(mechanisms.get('BACK')).toBe('revised-backward/sole-row-replacement');
      expect(c.exemplars.some(e => e.subject.startsWith('EPI'))).toBe(false);

      // Corroboration depth: the record-created facts asserted twice split
      // into two agreeing (CORRO, SKIP — the skip across a non-observation
      // still compares) and one diverging (BACK).
      expect(c.corroboration).toContainEqual({ kind: 'record-created', depth: 2, agreeing: 2, diverging: 1 });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('SubjectSequence_ForTheExtensionScenario_ShowsTheWorkingStepByStep', () => {
    const dir = writeFixtureLedger();
    try {
      const c = computeEventTimeCoherency(dir, FIXTURE_PARAMS);
      const seq = subjectKindSequence(dir, 'BACKEXT', c.episodes);
      expect(seq).toEqual([
        expect.objectContaining({ dataset: '2020-06-01', stat: '2015-02-07', nrows: 1, classification: 'first-observation' }),
        expect.objectContaining({ dataset: '2025-12-01', stat: '1952-10-10', nrows: 2, prevStat: '2015-02-07', classification: 'revised-backward', mechanism: 'version-window-extension' }),
      ]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('FirstObservation_OfANewcomerSubject_IsNeverCountedAsAnyClassification', () => {
    const dir = writeFixtureLedger();
    try {
      const c = computeEventTimeCoherency(dir, FIXTURE_PARAMS);
      // NEWCOMER appears in no total, no pair and no exemplar: one
      // observation asserts nothing about change.
      expect(c.totals.reduce((sum, t) => sum + t.subjects, 0)).toBe(17);
      expect(c.exemplars.some(e => e.subject === 'NEWCOMER')).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// --- Rendering --------------------------------------------------------------

function syntheticCoherency(): EventTimeCoherency {
  return {
    params: DEFAULT_EPISODE_PARAMS,
    episodes: [{
      start: '2025-10-11',
      end: '2025-10-30',
      signals: [{
        lane: 'opendata', dataset: '2025-11-11', vintage: '2025-11-11', kind: 'licence-version-last-modified',
        windowStart: '2025-10-11', windowEnd: '2025-10-30', rows: 104221, populated: 105716, share: 0.9858,
        peakDays: [{ day: '2025-10-11', share: 0.8219 }, { day: '2025-10-30', share: 0.1111 }],
      }],
    }],
    totals: [
      { kind: 'record-created', classification: 'corroborated', subjects: 377936 },
      { kind: 'record-created', classification: 'revised-forward', subjects: 101875 },
    ],
    pairs: [
      { kind: 'record-created', prevLane: 'foi', prevDataset: 'a', prevVintage: '2024-09', lane: 'foi', dataset: 'b', vintage: '2024-10', classification: 'revised-forward', mechanism: 'sole-row-replacement', subjects: 101869 },
      { kind: 'record-created', prevLane: 'foi', prevDataset: 'a', prevVintage: '2024-09', lane: 'foi', dataset: 'c', vintage: '2025-03-13', classification: 'revised-backward', mechanism: 'sole-row-replacement', subjects: NOTABLE_PAIR_MIN - 1 },
    ],
    exemplars: [{
      kind: 'record-created', subject: 'M7TEE', classification: 'revised-forward', mechanism: 'sole-row-replacement',
      prevDataset: 'a', prevVintage: '2024-09', prevStat: '2016-07-29', prevRows: 1,
      dataset: 'b', vintage: '2024-10', stat: '2024-07-11', nrows: 1,
    }],
    corroboration: [{ kind: 'licence-issued', depth: 2, agreeing: 103901, diverging: 0 }],
  };
}

describe('event-time coherency report rendering', { tags: ['unit'] }, () => {
  it('Render_WholePicture_CarriesEpisodesTotalsPairsExemplarsAndCorroboration', () => {
    const md = renderEventTimeCoherency(syntheticCoherency());
    expect(md).toContain('# Event-time coherency (cross-vintage)');
    expect(md).toContain('### Episode 1: 2025-10-11 → 2025-10-30');
    expect(md).toContain('| `licence-version-last-modified` | opendata | `2025-11-11` | 2025-11-11 | 2025-10-11 → 2025-10-30 | 104,221 | 105,716 | 98.6% | 2025-10-11 (82.2%), 2025-10-30 (11.1%) |');
    expect(md).toContain('| `record-created` | corroborated | 377,936 |');
    // The notable-pairs floor: the 101,869-subject pair appears; the
    // just-below-floor pair does not.
    expect(md).toContain('| `record-created` | `a` (2024-09) | `b` (2024-10) | revised-forward | sole-row-replacement | 101,869 |');
    expect(md).not.toContain('| `c` (2025-03-13) |');
    expect(md).toContain('| `record-created` | `M7TEE` | `a` (2024-09) | 2016-07-29 | 1 | `b` (2024-10) | 2024-07-11 | revised-forward | sole-row-replacement |');
    expect(md).toContain('| `licence-issued` | 2 | 103,901 | 0 |');
  });

  it('Render_Vocabulary_GlossesEveryClassificationAndMechanismBesideItsUse', () => {
    // The #465 lesson generalised: an authored vocabulary never reaches a
    // reader bare — every term the tables can contain is glossed on the page.
    const md = renderEventTimeCoherency(syntheticCoherency());
    for (const [term, gloss] of CLASSIFICATION_GLOSSES) {
      expect(md).toContain(`- **${term}** — ${gloss}`);
    }
    for (const [term, gloss] of MECHANISM_GLOSSES) {
      expect(md).toContain(`- **${term}** (mechanism) — ${gloss}`);
    }
  });

  it('Render_Framing_FlagsWithoutVerdictsAndStatesTheNonObservationRule', () => {
    const md = renderEventTimeCoherency(syntheticCoherency());
    expect(md).toContain('**Flags, never verdicts**');
    expect(md).toContain('candidate explanations');
    expect(md).toContain('never "nothing happened"');
    // The eroding-fingerprint caveat: absence of a spike in a later vintage
    // never disproves an earlier vintage's episode.
    expect(md).toContain('never disproves an earlier');
  });

  it('Render_EmptyCorpus_StatesNoFlagIsNotACleanBillOfHealth', () => {
    const md = renderEventTimeCoherency({
      params: DEFAULT_EPISODE_PARAMS, episodes: [], totals: [], pairs: [], exemplars: [], corroboration: [],
    });
    expect(md).toContain('No window exceeded the threshold');
    expect(md).toContain('not a clean bill of health');
    expect(md).toContain('No pair reached the reporting floor.');
    expect(md).toContain('No individual revisions were flagged.');
  });
});
