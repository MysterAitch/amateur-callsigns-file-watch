import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  computeStateAtTReport,
  renderStateAtTReport,
  deriveStateAtT,
  foldSubjectEvents,
  stateAtT,
  STATE_AT_T_PATH,
  type StateAtTReport,
  type StateContext,
} from './state-at-t.ts';
import { acquireClaimsSource, type ClaimsSourceHandle } from './event-time-coherency.ts';
import { duckDbAvailable } from '../v2/report-fold.ts';

// Issue #725 S3: the state-at-t engine validated against the corpus's
// RECORDED ground truth — issue #800's G3ATI/G3SDS worked examples
// (docs/source-register.md, known data-coherency episodes) and the
// permanent-SES reservation cohort finding on the issue. Test names follow
// Subject_Scenario_Outcome.
//
// Figures asserted exactly are figures of the COMMITTED archive (immutable
// entries): they change only when a new dataset is ingested, which is exactly
// when this suite should demand a deliberate re-read, like the other
// data-validity goldens.

describe.skipIf(!duckDbAvailable())('state-at-t — real-corpus ground truth', { tags: ['data-validity'] }, () => {
  let handle: ClaimsSourceHandle;
  let report: StateAtTReport;
  let context: StateContext;
  beforeAll(() => {
    // One claims source for the whole suite: the shared deploy-time Parquet
    // where the run provides one (CLAIMS_PARQUET), else a one-off full-corpus
    // materialisation.
    handle = acquireClaimsSource();
    report = computeStateAtTReport(handle.source);
    context = { episodes: report.episodes };
  }, 600_000);
  afterAll(() => { handle.dispose(); });

  // --- The committed report is exactly this fold -------------------------

  it('StateAtTReport_FoldedFromTheClaimLedger_MatchesTheCommittedGoldenByteForByte', () => {
    const golden = fs.readFileSync(path.resolve(process.cwd(), STATE_AT_T_PATH), 'utf8');
    expect(renderStateAtTReport(report)).toBe(golden);
  });

  it('StateAtTReport_RunTwiceOverTheSameClaims_IsByteDeterministic', () => {
    expect(renderStateAtTReport(computeStateAtTReport(handle.source))).toBe(renderStateAtTReport(report));
  });

  // --- The episode context matches S2's recorded windows -------------------

  it('EpisodeWindows_ConsultedByTheEngine_AreExactlyTheTwoRecordedEpisodes', () => {
    expect(report.episodes.map(e => `${e.start}..${e.end}`)).toEqual([
      '2016-07-23..2016-08-12',
      '2025-10-11..2025-10-30',
    ]);
  });

  // --- Coverage honesty ----------------------------------------------------

  it('SubjectUniverse_OverTheCommittedArchive_StatesTheAddressableFractionExactly', () => {
    expect(report.universe).toEqual({
      totalSubjects: 193_092,
      eventSubjects: 166_683,
      licensingSubjects: 129_875,
    });
  });

  it('CancellationEvidence_IsConfinedToTheSingle2020Disclosure_SoAbsenceStaysWeak', () => {
    // The coverage table is what makes the in-force rule's absence clause
    // honest: cancellation dates exist in ONE dataset, one vintage, and stop
    // in 2020 — "no cancellation evidence" after that can never firm up.
    const cancelled = report.coverage.find(row => row.kind === 'licence-cancelled');
    expect(cancelled).toMatchObject({ datasets: 1, subjects: 7_397, vintages: ['2020-10-23'] });
    expect((cancelled?.latestDay ?? '') <= '2020-10-23').toBe(true);
  });

  // --- Ground truth (a): G3ATI, the bi-temporal crux -----------------------

  it('G3ATI_At1960WholeCorpus_InfersAStartOnOrBeforeTFromTheLateSurfacing1952Row', () => {
    // docs/source-register.md (#800 mechanism A): G3ATI's 1952-10-10
    // licence-version row survives in 2025-11-11 (and 2026-01-14) but not in
    // the 2021 annexes or 2026-06-23; wdtk-1180568's licence-scoped sheet
    // carries the same 1952 date. Whole-corpus, a start on or before 1960 is
    // therefore asserted — by exactly those vintages.
    const answer = deriveStateAtT(foldSubjectEvents(handle.source, 'G3ATI'), { subject: 'G3ATI', t: '1960-06-01' }, context);
    const start = answer.findings.find(f => f.rule === 'licence-start-on-or-before-t');
    expect(start).toBeDefined();
    expect(start?.assertingVintages).toEqual(['2024-10', '2025-11-11', '2026-01-14']);
    expect(start?.caveats).toEqual(expect.arrayContaining(['earliest-surviving', 'pre-1977', 'vintages-disagree']));
    // The vintages that DON'T carry the 1952 row disagree — surfaced, never
    // resolved: both the version-scoped and the licence-scoped kind split.
    expect(answer.disagreements.map(d => d.kind)).toEqual(['licence-original-start', 'licence-version-original-start']);
    const versionScoped = answer.disagreements.find(d => d.kind === 'licence-version-original-start');
    expect(versionScoped?.values.map(v => v.day)).toEqual(['1952-10-10', '2015-02-07']);
  });

  it('G3ATI_At1960UnderA2021AssertionCeiling_HonestlyCannotAnswerTheSameQuestion', () => {
    // The bi-temporal crux: as asserted by 2021, the earliest surviving start
    // is 2015-02-07 — after t — so the identical event-time question yields
    // no licensing evidence on or before t, and the excluded vintages are
    // named. Issue #800's creep means the LATER corpus carries MORE early
    // history here, not less.
    const answer = deriveStateAtT(
      foldSubjectEvents(handle.source, 'G3ATI'),
      { subject: 'G3ATI', t: '1960-06-01', assertionCeiling: '2021-12-31' },
      context,
    );
    expect(answer.findings.map(f => f.rule)).toEqual(['no-licensing-evidence-on-or-before-t']);
    expect(answer.vintagesConsulted).toEqual(['2019-08-12', '2019-09-12', '2021-01-29', '2021-04-21']);
    expect(answer.vintagesExcluded).toContain('2025-11-11');
    expect(answer.bounds.latestOnOrBeforeT).toEqual([]);
    expect(answer.bounds.earliestAfterT.map(l => l.day)).toEqual(['2015-02-07', '2015-02-07']);
  });

  // --- Ground truth (b): G3SDS, the surfaced disagreement ------------------

  it('G3SDS_At2000WholeCorpus_SurfacesTheSoleRowReplacementDisagreementWithoutResolvingIt', () => {
    // docs/source-register.md (#800 mechanism B): four version-scoped
    // vintages assert 1977-07-09; 2026-06-23 asserts 2026-02-23 wholesale.
    // At t = 2000-01-01 the answer rests on the 1977 camp and lists both.
    const answer = deriveStateAtT(foldSubjectEvents(handle.source, 'G3SDS'), { subject: 'G3SDS', t: '2000-01-01' }, context);
    const start = answer.findings.find(f => f.rule === 'licence-start-on-or-before-t');
    expect(start?.caveats).toContain('vintages-disagree');
    expect(answer.disagreements).toHaveLength(1);
    const disagreement = answer.disagreements[0];
    expect(disagreement.kind).toBe('licence-version-original-start');
    expect(disagreement.values.map(v => v.day)).toEqual(['1977-07-09', '2026-02-23']);
    expect(disagreement.values[0].assertedBy.map(a => a.dataset)).toEqual([
      'ofcom-2021-01--all-callsigns',
      'ofcom-2021-04--all-callsigns',
      '2025-11-11',
      '2026-01-14',
    ]);
    expect(disagreement.values[1].assertedBy.map(a => a.dataset)).toEqual(['2026-06-23']);
    // The in-force reading still follows from the supported start, with its
    // honest absence caveats.
    const inForce = answer.findings.find(f => f.rule === 'consistent-with-licence-in-force-at-t');
    expect(inForce?.caveats).toEqual(expect.arrayContaining(['cancellation-sparsity', 'availability-trap']));
  });

  // --- Ground truth (c): the reservation cohort ----------------------------

  it('GB0SNB_At2025June_ReadsTheStatedWindowBoundAsConsistentWithCoveringNeverAStatus', () => {
    // The permanent-SES cohort-2 finding on issue #725: GB0SNB carries
    // reserved_to 2026-08-09 in the 2024-09 disclosure. The month-keyed
    // vintage is proven before t, the stated end is after it — covering,
    // with the cohort-ambiguity caveat, and the 2016-migration record-created
    // stamp stays annotated system presence.
    const answer = deriveStateAtT(foldSubjectEvents(handle.source, 'GB0SNB'), { subject: 'GB0SNB', t: '2025-06-01' }, context);
    expect(answer.findings.map(f => f.rule)).toEqual([
      'reservation-window-consistent-with-covering-t',
      'record-in-system-on-or-before-t',
    ]);
    const covering = answer.findings.find(f => f.rule === 'reservation-window-consistent-with-covering-t');
    expect(covering?.evidence.map(l => l.day)).toEqual(['2026-08-09']);
    expect(covering?.caveats).toEqual(expect.arrayContaining(['reserved-cohort-ambiguity', 'month-precision-vintage']));
    const presence = answer.findings.find(f => f.rule === 'record-in-system-on-or-before-t');
    expect(presence?.caveats).toContain('mass-episode-window');
  });

  // --- Ground truth (d): outside coverage ----------------------------------

  it('UnheldSubject_AnyQuery_IsAnExplicitCannotInferNeverAnAvailabilityClaim', () => {
    const answer = stateAtT(handle.source, { subject: 'Q1ZZZ', t: '2020-01-01' }, context);
    expect(answer.addressable).toBe(false);
    expect(answer.findings.map(f => f.rule)).toEqual(['no-evidence-for-subject']);
    expect(answer.findings[0].statement).toContain('never "did not exist" or "was available"');
  });

  // --- The mass-episode masquerade guard over the real corpus --------------

  it('MassEpisodeBookkeeping_AcrossTheWholeCorpus_NeverProducesALicensingFinding', () => {
    // A subject whose only evidence is 2016-migration-era bookkeeping must
    // read as episode-annotated system presence plus an honest licensing gap
    // — never as "a licence event happened in the episode week". 20AAT is a
    // reserved-pool subject carrying ONLY record-created/last-modified
    // stamps (created 2016-08-12, the episode's biggest day) and zero
    // licensing-evidence claims anywhere in the corpus.
    const answer = deriveStateAtT(foldSubjectEvents(handle.source, '20AAT'), { subject: '20AAT', t: '2017-01-01' }, context);
    expect(answer.findings.map(f => f.rule)).toEqual([
      'record-in-system-on-or-before-t',
      'no-licensing-evidence-on-or-before-t',
    ]);
    const presence = answer.findings.find(f => f.rule === 'record-in-system-on-or-before-t');
    expect(presence?.caveats).toContain('mass-episode-window');
    expect(presence?.evidence.some(l => l.withinEpisode?.start === '2016-07-23')).toBe(true);
  });
});
