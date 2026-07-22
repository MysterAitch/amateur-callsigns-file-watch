import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  computeTimezoneRendering,
  renderTimezoneRendering,
  TIMEZONE_RENDERING_PATH,
  type TimezoneRendering,
} from './timezone-rendering.ts';
import { acquireClaimsSource, type ClaimsSourceHandle } from './event-time-coherency.ts';
import { duckDbAvailable } from '../v2/report-fold.ts';

// Issue #858: the timezone-rendering classification validated against the
// corpus's recorded ground truth — the #857 review's proven anchor pair
// (wdtk-1141667 renders UTC datetimes; the 2024-07 register copy renders
// local dates, established by the 632/632 one-day-later natural experiment)
// — plus the classification structure the generalised experiment derives
// from the whole corpus. Test names follow Subject_Scenario_Outcome.
//
// Figures asserted exactly are figures of the COMMITTED archive (immutable
// entries): they change only when a new dataset is ingested, which is exactly
// when this suite should demand a deliberate re-read.

describe.skipIf(!duckDbAvailable())('timezone rendering — real-corpus ground truth', { tags: ['data-validity'] }, () => {
  let handle: ClaimsSourceHandle;
  let t: TimezoneRendering;
  beforeAll(() => {
    handle = acquireClaimsSource();
    t = computeTimezoneRendering(handle.source);
  }, 600_000);
  afterAll(() => { handle.dispose(); });

  function label(lane: string, dataset: string): string {
    const row = t.sources.find(s => s.lane === lane && s.dataset === dataset);
    expect(row, `${lane}/${dataset} missing from the classification universe`).toBeDefined();
    return row?.status === 'classified' ? row.label ?? '' : row?.status ?? '';
  }

  // --- The committed report is exactly this fold ---------------------------

  it('TimezoneReport_FoldedFromTheClaimLedger_MatchesTheCommittedGoldenByteForByte', () => {
    const golden = fs.readFileSync(path.resolve(process.cwd(), TIMEZONE_RENDERING_PATH), 'utf8');
    expect(renderTimezoneRendering(t)).toBe(golden);
  });

  it('TimezoneFold_RunTwiceOverTheSameClaims_IsByteDeterministic', () => {
    expect(renderTimezoneRendering(computeTimezoneRendering(handle.source))).toBe(renderTimezoneRendering(t));
  });

  // --- Ground truth (a): the #857 anchor pair ------------------------------

  it('AnchorPair_Wdtk1141667AgainstThe2024JulyRegister_FiresTheOrientedBoundaryExperiment', () => {
    // The #857 review's natural experiment: 632 shared records stamped 23:xx
    // in the wdtk workbook carry a one-day-later date in the 2024-07
    // register. This fold reproduces the same signal at 629 subjects — the
    // three dropped records are all BST-transition-margin exclusions,
    // verified individually: 20CLB (stamped 2020-10-24 23:00:03, within a
    // day of the 2020 BST end on 2020-10-25) and M6NNX + 20KPU (stamped
    // 2024-04-01 23:00:04/23:00:11, within a day of the 2024 BST start on
    // 2024-03-31). Same phenomenon, tighter controls — no other exclusion
    // class contributes to the 632→629 difference.
    const pair = t.pairs.find(p =>
      p.timedDataset.startsWith('wdtk-1141667')
      && p.partnerDataset.startsWith('ofcom-2024-07')
      && p.kind === 'record-last-modified');
    expect(pair).toBeDefined();
    expect(pair?.utcShift).toBe(629);
    expect(pair?.localShift).toBe(0);
    expect(pair?.verdict).toMatchObject({ verdict: 'differs-by-local-offset', utcSide: 'timed' });
    // The mid-afternoon controls: tens of thousands of agreeing subjects,
    // noise (in-window agreement + unexplained) in single figures.
    expect(pair?.agreeNoSignal ?? 0).toBeGreaterThan(90_000);
    expect((pair?.h23Agree ?? 0) + (pair?.unexplained ?? 0)).toBeLessThanOrEqual(5);
  });

  it('AnchorSources_UnderTheChainedResolution_CarryTheProvenLabels', () => {
    expect(label('foi', 'wdtk-1141667--issued-callsigns')).toBe('utc');
    expect(label('foi', 'ofcom-2024-07--call-signs--all-callsigns')).toBe('local');
  });

  // --- Ground truth (b): the rendering-convention flip across export eras --

  it('RegisterCopies_UpTo2024July_AllRenderLocalTime', () => {
    // Every register copy from the 2020 reserved disclosure through the
    // 2024-07 copy shifts by one day against the UTC-rendered timed sources
    // in the summer hour-23 window: local-time day rendering.
    for (const dataset of [
      'ofcom-2020-10-23--reserved-callsigns',
      'ofcom-2023-01-25--call-sign-list-with-status--all-callsigns',
      'ofcom-2023-08-18--call-sign-list--all-callsigns',
      'ofcom-2023-11-24--call-sign-list--all-callsigns',
      'ofcom-2023-12-07--open-data-call-sign-list--all-callsigns',
      'ofcom-2024-01--foi-1734722--all-callsigns',
      'ofcom-2024-07--call-signs--all-callsigns',
    ]) {
      expect(label('foi', dataset), dataset).toBe('local');
    }
    expect(label('opendata', '2023-02-20')).toBe('local');
  });

  it('DateOnlyRegisterCopies_From2024OctoberOnwards_AllRenderUtc', () => {
    // The flip this classification surfaced (a finding in its own right,
    // recorded as hypothesis-register H3a): from the 2024-10-21 copy onwards
    // the date-only register copies' boundary-window days AGREE with the
    // UTC-rendered workbook in both windows — the date lane's export
    // rendering switched to UTC between the 2024-07 and 2024-10-21 copies.
    for (const dataset of ['ofcom-2024-10-21--callsigns--all-callsigns', 'ofcom-2025-03-13--callsigns--all-callsigns']) {
      expect(label('foi', dataset), dataset).toBe('utc');
    }
    expect(label('opendata', '2025-04-08')).toBe('utc');
  });

  it('DatetimeBearingExports_OnBothSidesOfTheDateLaneFlip_AllRenderUtc', () => {
    // A DISTINCT claim from the date-lane flip above: every datetime-bearing
    // export renders UTC, including ofcom-2024-09 (September 2024 — between
    // the 2024-07 copy, the last date-only export observed rendering local,
    // and the 2024-10-21 copy, the first observed rendering UTC) and the
    // proven wdtk-1141667 workbook from July 2024 (covered by the anchor
    // tests above). The datetime lane shows no flip anywhere; only the
    // date-only rendering is observed changing convention.
    expect(label('foi', 'ofcom-2024-09--every-radio-callsign--all-callsigns')).toBe('utc');
    for (const dataset of ['2025-05-27', '2025-06-04', '2025-06-08']) {
      expect(label('opendata', dataset), dataset).toBe('utc');
    }
  });

  it('ChainedConclusion_ForThe2024OctoberCopy_RecordsItsMultiHopWorking', () => {
    // 2024-10-21 is date-only: its label arrives via an equality edge from a
    // source with its own oriented experiment. The chain must show both hops
    // (error-locability: the conclusion is locatable to its exact evidence).
    const row = t.sources.find(s => s.dataset === 'ofcom-2024-10-21--callsigns--all-callsigns');
    expect(row?.status).toBe('classified');
    expect(row?.chain.length).toBeGreaterThanOrEqual(2);
    expect(row?.chain.some(h => h.rule.startsWith('same-convention'))).toBe(true);
  });

  // --- Ground truth (c): honest unclassified outcomes ----------------------

  it('SourcesWithoutAUsableExperiment_StayHonestlyUnclassified_ExactSet', () => {
    const unclassified = t.sources.filter(s => s.status === 'unclassified').map(s => `${s.lane}/${s.dataset}`);
    expect(unclassified).toEqual([
      // Original-start / reserved-until only — no time-of-day partner.
      'foi/ofcom-2021-01--all-callsigns',
      'foi/ofcom-2021-04--all-callsigns',
      // Licence-scoped kinds with no timed partner on a shared kind.
      'foi/ofcom-2025-09-11--callsigns--all-callsigns',
      // The 2019 register-and-forbidden twins: only a one-window agreement
      // constraint between them (the 228 hour-23 workbook stamps agree with
      // the day-first copy), which excludes one orientation but pins nothing
      // without a labelled partner.
      'foi/ofcom-756622--published-register-csv',
      // Timed licence-created column, but no other source asserts the kind.
      'foi/wdtk-1180568--licence-breakdown-duration-age',
      'foi/wdtk-596532--allocated-reserved-forbidden',
      // The licence-version vintages: date-only, and their kinds have no
      // timed source at all.
      'opendata/2025-11-11',
      'opendata/2026-01-14',
      'opendata/2026-06-23',
    ]);
  });

  it('TwinDisclosurePair_596532Against756622_IsAPartialConstraintNotAClassification', () => {
    const pair = t.pairs.find(p => p.timedDataset.startsWith('wdtk-596532') && p.partnerDataset.startsWith('ofcom-756622'));
    expect(pair?.verdict).toEqual({ verdict: 'agreement-only-h23', evidence: 223 });
  });

  // --- Coherence: no conflicts, and the corroboration says the same thing --

  it('WholeCorpus_UnderTheCurrentArchive_YieldsNoConflictingEvidence', () => {
    // A conflicting source or pair appearing here is a genuine finding (a
    // re-stamping pipeline, or a detector regression) — examine the pair's
    // cells and the source's routes before touching this pin.
    expect(t.sources.filter(s => s.status === 'conflicting-evidence')).toEqual([]);
    expect(t.pairs.filter(p => p.verdict.verdict === 'conflicting-evidence')).toEqual([]);
  });

  it('MinuteLevelCorroboration_AcrossEveryTimedPair_ShowsIdenticalInstants', () => {
    // Every pair with time-of-day on both sides agrees to the minute —
    // summer and winter alike — corroborating that ALL the timed sources
    // render one convention (UTC, via the boundary experiments). A ±60
    // bucket appearing would be a timed pair differing by the local offset.
    expect(t.minuteDeltas.length).toBeGreaterThan(0);
    expect(t.minuteDeltas.every(d => d.bucket === '0')).toBe(true);
    const wdtkVs0604 = t.minuteDeltas.find(d =>
      d.dataset1.startsWith('wdtk-1141667') && d.dataset2 === '2025-06-04' && d.season === 'summer');
    expect(wdtkVs0604?.subjects ?? 0).toBeGreaterThan(45_000);
  });

  it('BatchFingerprint_WdtkWorkbookHour23Cluster_CorroboratesItsUtcLabel', () => {
    // The documented local-midnight-batch prior (#857): the UTC-labelled
    // workbook's summer stamps cluster at 23:xx far above 00:xx.
    const row = t.sourceKinds.find(s => s.dataset.startsWith('wdtk-1141667') && s.kind === 'record-last-modified');
    expect(row?.summerH23 ?? 0).toBeGreaterThan(700);
    expect(row?.summerH0 ?? 0).toBeLessThan(50);
  });
});
