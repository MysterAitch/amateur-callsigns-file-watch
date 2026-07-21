import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  contributionOf,
  vintageDaySpan,
  vintageOnOrBefore,
  deriveStateAtT,
  stateAtT,
  foldSubjectEvents,
  foldKindCoverage,
  foldSubjectUniverse,
  renderStateAnswer,
  renderStateAtTReport,
  RULE_GLOSSES,
  CAVEAT_GLOSSES,
  EMPTY_STATE_CONTEXT,
  type SubjectEventRow,
  type StateContext,
  type StateAtTReport,
} from './state-at-t.ts';
import { DEFAULT_EPISODE_PARAMS } from './event-time-coherency.ts';
import { duckDbAvailable } from '../v2/report-fold.ts';
import { serialiseClaimsJsonl } from '../v2/serialise.ts';
import { EVENT_DATE_KINDS, EVENT_DATE_RULE, eventDatePredicate, type Claim } from '../v2/claim.ts';

// Issue #725 S3: the state-at-t inference engine. Test names follow
// Subject_Scenario_Outcome. The scenarios are the engine's user-facing
// guarantees: every answer is inferred and names its asserting vintages,
// absence of evidence NEVER reads as availability or non-existence, vintages
// that disagree are surfaced not resolved, bookkeeping never masquerades as a
// licensing event, and both temporal axes (event time t, assertion-time
// ceiling) genuinely change the answer.

// --- Fixture helpers ---------------------------------------------------------

function row(kind: string, day: string, options: Partial<Omit<SubjectEventRow, 'kind' | 'day'>> = {}): SubjectEventRow {
  const dataset = options.dataset ?? options.vintage ?? '2026-01-01';
  return {
    kind,
    day,
    lane: options.lane ?? 'opendata',
    dataset,
    vintage: options.vintage ?? '2026-01-01',
    nrows: options.nrows ?? 1,
  };
}

function rulesOf(answer: ReturnType<typeof deriveStateAtT>): string[] {
  return answer.findings.map(f => f.rule);
}

// --- The authored contribution registry --------------------------------------

describe('state contributions are total over the S1 vocabulary', { tags: ['unit'] }, () => {
  it('EveryAuthoredEventKind_HasAnAuthoredStateContribution_SoNoKindEscapesTheStateReading', () => {
    for (const kind of EVENT_DATE_KINDS) {
      expect(['licence-start', 'licence-end', 'reservation-end', 'system-presence']).toContain(contributionOf(kind));
    }
  });

  it('ContributionRegistry_WhenAskedForAnUnknownKind_FailsLoudRatherThanGuessing', () => {
    expect(() => contributionOf('some-new-kind')).toThrow(/no authored state contribution/);
  });

  it('BookkeepingKinds_IncludingTheSalesforceLicenceCreatedStamp_ReadOnlyAsSystemPresence', () => {
    // The mass-episode masquerade guard starts here: no bookkeeping stamp can
    // reach a licensing inference because the registry never routes one there.
    for (const kind of ['record-created', 'record-last-modified', 'licence-version-last-modified', 'licence-last-modified', 'licence-created']) {
      expect(contributionOf(kind)).toBe('system-presence');
    }
  });
});

// --- Vintage precision -------------------------------------------------------

describe('assertion-time vintage precision', { tags: ['unit'] }, () => {
  it('DayKeyedVintage_ComparedAgainstADay_UsesItsOwnDay', () => {
    expect(vintageDaySpan('2024-09-10')).toEqual({ earliest: '2024-09-10', latest: '2024-09-10' });
    expect(vintageOnOrBefore('2024-09-10', '2024-09-10')).toBe(true);
    expect(vintageOnOrBefore('2024-09-10', '2024-09-09')).toBe(false);
  });

  it('MonthKeyedVintage_CountsOnOrBeforeOnlyWhenItsWholeMonthIs', () => {
    // A month-keyed vintage ('vintage keyed by month' in the source register)
    // is only PROVEN on or before a day when its whole month is — the
    // conservative reading of declared-not-proven precision.
    expect(vintageDaySpan('2024-09')).toEqual({ earliest: '2024-09-01', latest: '2024-09-30' });
    expect(vintageOnOrBefore('2024-09', '2024-09-15')).toBe(false);
    expect(vintageOnOrBefore('2024-09', '2024-09-30')).toBe(true);
    expect(vintageOnOrBefore('2024-02', '2024-02-29')).toBe(true);
  });

  it('UnknownVintageGrammar_FailsLoudRatherThanGuessing', () => {
    expect(() => vintageDaySpan('2024')).toThrow(/neither day-keyed/);
    expect(() => vintageDaySpan('sometime in 2024')).toThrow(/neither day-keyed/);
  });
});

// --- The pure derivation engine: outside coverage ----------------------------

describe('state-at-t outside coverage', { tags: ['unit'] }, () => {
  it('StateQuery_SubjectWithNoEvidenceAtAll_ReturnsExplicitCannotInferNeverAvailability', () => {
    const answer = deriveStateAtT([], { subject: 'Q1ZZZ', t: '2020-01-01' });
    expect(answer.addressable).toBe(false);
    expect(answer.epistemics).toBe('inferred');
    expect(rulesOf(answer)).toEqual(['no-evidence-for-subject']);
    expect(answer.findings[0].caveats).toContain('availability-trap');
    expect(answer.findings[0].statement).toContain('never "did not exist" or "was available"');
    expect(answer.vintagesConsulted).toEqual([]);
  });

  it('StateQuery_AllEvidenceDatedAfterT_YieldsNoLicensingEvidenceNotANegativeClaim', () => {
    // Non-observation before the earliest evidence is never "did not exist".
    const answer = deriveStateAtT(
      [row('licence-issued', '2019-09-12', { vintage: '2019-09-12' })],
      { subject: 'M7TEE', t: '2015-01-01' },
    );
    expect(answer.addressable).toBe(true);
    expect(rulesOf(answer)).toEqual(['no-licensing-evidence-on-or-before-t']);
    expect(answer.findings[0].statement).toContain('after 2015-01-01');
    expect(answer.findings[0].caveats).toContain('availability-trap');
    expect(answer.bounds.latestOnOrBeforeT).toEqual([]);
    expect(answer.bounds.earliestAfterT.map(l => l.day)).toEqual(['2019-09-12']);
  });

  it('StateQuery_MalformedEventTimeOrCeiling_FailsLoud', () => {
    expect(() => deriveStateAtT([], { subject: 'X', t: '2020' })).toThrow(/not an ISO day/);
    expect(() => deriveStateAtT([], { subject: 'X', t: '2020-01-01', assertionCeiling: 'latest' })).toThrow(/not an ISO day/);
  });
});

// --- Licence starts, cancellations, in-force ---------------------------------

describe('licence lifecycle inferences', { tags: ['unit'] }, () => {
  it('LicenceStart_StartAssertedOnOrBeforeT_YieldsStartFindingNamingItsVintages', () => {
    const answer = deriveStateAtT(
      [row('licence-issued', '1998-07-14', { vintage: '2019-09-12', dataset: 'ofcom-756622' })],
      { subject: 'M0ABC', t: '2005-06-01' },
    );
    const start = answer.findings.find(f => f.rule === 'licence-start-on-or-before-t');
    expect(start).toBeDefined();
    expect(start?.epistemics).toBe('inferred');
    expect(start?.assertingVintages).toEqual(['2019-09-12']);
    // licence-issued is not a version-scoped earliest-surviving kind and the
    // date is post-1977, so neither caveat attaches.
    expect(start?.caveats).not.toContain('earliest-surviving');
    expect(start?.caveats).not.toContain('pre-1977');
  });

  it('LicenceInForce_StartBeforeTWithNoCancellationEvidence_IsConsistentWithNeverProof', () => {
    const answer = deriveStateAtT(
      [row('licence-issued', '1998-07-14', { vintage: '2019-09-12' })],
      { subject: 'M0ABC', t: '2005-06-01' },
    );
    const inForce = answer.findings.find(f => f.rule === 'consistent-with-licence-in-force-at-t');
    expect(inForce).toBeDefined();
    expect(inForce?.statement).toContain('never proof');
    // The absence clause is honestly weak: cancellation evidence is sparse.
    expect(inForce?.caveats).toEqual(expect.arrayContaining(['cancellation-sparsity', 'availability-trap']));
  });

  it('LicenceCancelled_CancellationBetweenStartAndT_SuppressesInForceAndSaysNotAvailable', () => {
    const answer = deriveStateAtT(
      [
        row('licence-issued', '1990-05-05', { vintage: '2020-10-23', dataset: 'r1' }),
        row('licence-cancelled', '1995-03-03', { vintage: '2020-10-23', dataset: 'r1' }),
      ],
      { subject: 'G0XYZ', t: '2000-01-01' },
    );
    expect(rulesOf(answer)).toEqual([
      'licence-start-on-or-before-t',
      'licence-cancelled-on-or-before-t',
      'cancelled-with-no-later-start-evidence-by-t',
    ]);
    const cancelled = answer.findings.find(f => f.rule === 'cancelled-with-no-later-start-evidence-by-t');
    expect(cancelled?.statement).toContain('NOT evidence the callsign was available');
    expect(cancelled?.caveats).toContain('availability-trap');
  });

  it('LicenceCancelled_FollowedByALaterStartOnOrBeforeT_ReadsConsistentWithInForceAgain', () => {
    const answer = deriveStateAtT(
      [
        row('licence-issued', '1990-05-05', { vintage: '2020-10-23', dataset: 'r1' }),
        row('licence-cancelled', '1995-03-03', { vintage: '2020-10-23', dataset: 'r1' }),
        row('licence-version-original-start', '2001-01-01', { vintage: '2025-11-11', dataset: '2025-11-11' }),
      ],
      { subject: 'G0XYZ', t: '2010-01-01' },
    );
    expect(rulesOf(answer)).toContain('consistent-with-licence-in-force-at-t');
    expect(rulesOf(answer)).toContain('licence-cancelled-on-or-before-t');
    expect(rulesOf(answer)).not.toContain('cancelled-with-no-later-start-evidence-by-t');
  });

  it('CancellationOnly_NoStartEvidenceAtAll_StillNeverReadsAsAvailability', () => {
    const answer = deriveStateAtT(
      [row('licence-cancelled', '1938-06-30', { vintage: '2020-10-23' })],
      { subject: 'G2OLD', t: '1950-01-01' },
    );
    expect(rulesOf(answer)).toEqual([
      'licence-cancelled-on-or-before-t',
      'cancelled-with-no-later-start-evidence-by-t',
    ]);
    const finding = answer.findings.find(f => f.rule === 'cancelled-with-no-later-start-evidence-by-t');
    expect(finding?.statement).toContain('NOT evidence the callsign was available');
  });

  it('VersionScopedStartEvidence_CarriesTheEarliestSurvivingCaveat_AndPre1977WhereItApplies', () => {
    const answer = deriveStateAtT(
      [row('licence-version-original-start', '1952-10-10', { vintage: '2025-11-11' })],
      { subject: 'G3ATI', t: '1960-06-01' },
    );
    const start = answer.findings.find(f => f.rule === 'licence-start-on-or-before-t');
    expect(start?.caveats).toEqual(expect.arrayContaining(['earliest-surviving', 'pre-1977']));
  });
});

// --- Reservation windows -----------------------------------------------------

describe('reservation-window inferences', { tags: ['unit'] }, () => {
  it('Reservation_AssertedBeforeTWithStatedEndAfterT_IsConsistentWithCoveringNeverAStatus', () => {
    const answer = deriveStateAtT(
      [row('reserved-until', '2026-08-09', { vintage: '2024-09-10', dataset: 'every-radio' })],
      { subject: 'GB0SNB', t: '2025-06-01' },
    );
    const covering = answer.findings.find(f => f.rule === 'reservation-window-consistent-with-covering-t');
    expect(covering).toBeDefined();
    expect(covering?.caveats).toContain('reserved-cohort-ambiguity');
    expect(rulesOf(answer)).not.toContain('no-licensing-evidence-on-or-before-t');
  });

  it('Reservation_TBeforeEveryAssertingVintage_CannotInferCoverageBecauseTheStartIsUnattested', () => {
    // The window's END is stated; its START is nowhere attested — so a t that
    // precedes every assertion is honestly unanswerable, not "covered".
    const answer = deriveStateAtT(
      [row('reserved-until', '2026-08-09', { vintage: '2024-09-10' })],
      { subject: 'GB0SNB', t: '2020-01-01' },
    );
    expect(rulesOf(answer)).toContain('reservation-window-start-unattested');
    expect(rulesOf(answer)).not.toContain('reservation-window-consistent-with-covering-t');
    const unattested = answer.findings.find(f => f.rule === 'reservation-window-start-unattested');
    expect(unattested?.statement).toContain('cannot be inferred');
  });

  it('Reservation_EveryStatedEndBeforeT_ReadsStatedEndedNeverAvailable', () => {
    // The Available-cohort shape (issue #725): a past stated end can be a
    // retrospective termination record, so nothing about t's state follows.
    const answer = deriveStateAtT(
      [row('reserved-until', '2017-06-30', { vintage: '2024-09-10' })],
      { subject: 'GB0MAC', t: '2020-01-01' },
    );
    expect(rulesOf(answer)).toContain('reservation-window-stated-ended-by-t');
    const ended = answer.findings.find(f => f.rule === 'reservation-window-stated-ended-by-t');
    expect(ended?.caveats).toEqual(expect.arrayContaining(['reserved-cohort-ambiguity', 'availability-trap']));
  });

  it('Reservation_VintagesStateTwoDifferentEnds_CarriesTheWindowRestatedCaveat', () => {
    const answer = deriveStateAtT(
      [
        row('reserved-until', '2024-06-30', { vintage: '2020-10-23', dataset: 'a' }),
        row('reserved-until', '2029-06-30', { vintage: '2024-09-10', dataset: 'b' }),
      ],
      { subject: 'GB0WIN', t: '2026-01-01' },
    );
    const covering = answer.findings.find(f => f.rule === 'reservation-window-consistent-with-covering-t');
    expect(covering?.caveats).toContain('window-restated');
    // Both stated ends stay visible in the evidence, restated or not.
    expect(answer.evidence.filter(l => l.kind === 'reserved-until').map(l => l.day)).toEqual(['2024-06-30', '2029-06-30']);
  });

  it('Reservation_MonthKeyedVintageStraddlingT_IsNotProvenToPrecedeTAndSaysSo', () => {
    // vintage '2024-09' against t = 2024-09-15: the assertion may have been
    // made after the 15th, so coverage is conservatively not inferred.
    const answer = deriveStateAtT(
      [row('reserved-until', '2026-08-09', { vintage: '2024-09' })],
      { subject: 'GB0SNB', t: '2024-09-15' },
    );
    expect(rulesOf(answer)).toContain('reservation-window-start-unattested');
  });
});

// --- Bookkeeping and mass episodes -------------------------------------------

describe('bookkeeping stays system presence', { tags: ['unit'] }, () => {
  const episodeContext: StateContext = {
    episodes: [{ start: '2016-07-23', end: '2016-08-12', signals: [] }],
  };

  it('BookkeepingStampInsideAnEpisodeWindow_IsAnnotatedAndNeverBecomesALicensingFinding', () => {
    // The 2016-migration shape: a created stamp inside the episode window is
    // evidence of the SYSTEM episode (migration-into-system), never of a
    // licence event — the mass-episode masquerade guard.
    const answer = deriveStateAtT(
      [row('record-created', '2016-08-12', { vintage: '2020-10-23' })],
      { subject: 'G3OLD', t: '2018-01-01' },
      episodeContext,
    );
    expect(rulesOf(answer)).toEqual(['record-in-system-on-or-before-t', 'no-licensing-evidence-on-or-before-t']);
    const presence = answer.findings.find(f => f.rule === 'record-in-system-on-or-before-t');
    expect(presence?.caveats).toContain('mass-episode-window');
    expect(presence?.statement).toContain('never a licensing event');
    expect(answer.evidence[0].withinEpisode).toEqual({ start: '2016-07-23', end: '2016-08-12' });
  });

  it('BookkeepingStampOutsideAnyEpisode_ReadsAsPlainSystemPresence', () => {
    const answer = deriveStateAtT(
      [row('record-last-modified', '2019-04-11', { vintage: '2023-01-25' })],
      { subject: 'G3NEW', t: '2020-01-01' },
      episodeContext,
    );
    const presence = answer.findings.find(f => f.rule === 'record-in-system-on-or-before-t');
    expect(presence?.caveats).not.toContain('mass-episode-window');
    expect(answer.evidence[0].withinEpisode).toBeNull();
  });

  it('MonthKeyedAssertingVintage_AttachesTheMonthPrecisionCaveat', () => {
    const answer = deriveStateAtT(
      [row('licence-issued', '2001-01-01', { vintage: '2024-09' })],
      { subject: 'M0ABC', t: '2010-01-01' },
    );
    const start = answer.findings.find(f => f.rule === 'licence-start-on-or-before-t');
    expect(start?.caveats).toContain('month-precision-vintage');
  });
});

// --- The bi-temporal axes ----------------------------------------------------

describe('bi-temporal parameterisation', { tags: ['unit'] }, () => {
  // The G3ATI shape (issue #800): the 1952 start only enters the record with
  // the 2025-11-11 vintage; 2021 vintages carry 2015-02-07 as the earliest
  // SURVIVING start.
  const g3atiRows: SubjectEventRow[] = [
    row('licence-version-original-start', '2015-02-07', { vintage: '2021-04-21', dataset: 'ofcom-2021-04' }),
    row('licence-version-original-start', '1952-10-10', { vintage: '2025-11-11', dataset: '2025-11-11' }),
    row('licence-version-original-start', '2015-02-07', { vintage: '2025-11-11', dataset: '2025-11-11' }),
  ];

  it('AssertionCeiling_WholeCorpus_SurfacesTheEarlyStartALaterVintagePreserved', () => {
    const answer = deriveStateAtT(g3atiRows, { subject: 'G3ATI', t: '1960-06-01' });
    expect(rulesOf(answer)).toContain('licence-start-on-or-before-t');
    const start = answer.findings.find(f => f.rule === 'licence-start-on-or-before-t');
    expect(start?.assertingVintages).toEqual(['2025-11-11']);
    expect(answer.vintagesConsulted).toEqual(['2021-04-21', '2025-11-11']);
  });

  it('AssertionCeiling_RestrictedTo2021_HonestlyCannotAnswerTheSameEventTimeQuestion', () => {
    // The crux: a later vintage can carry MORE early history than an earlier
    // one (#800's creep in reverse) — so narrowing the assertion ceiling
    // changes the answer, and the exclusion is named.
    const answer = deriveStateAtT(g3atiRows, { subject: 'G3ATI', t: '1960-06-01', assertionCeiling: '2021-12-31' });
    expect(rulesOf(answer)).toEqual(['no-licensing-evidence-on-or-before-t']);
    expect(answer.vintagesConsulted).toEqual(['2021-04-21']);
    expect(answer.vintagesExcluded).toEqual(['2025-11-11']);
  });

  it('AssertionCeiling_MonthKeyedVintageStraddlingTheCeiling_IsExcludedConservatively', () => {
    const rows = [row('licence-issued', '2001-01-01', { vintage: '2024-09' })];
    const within = deriveStateAtT(rows, { subject: 'M0ABC', t: '2010-01-01', assertionCeiling: '2024-09-30' });
    expect(within.vintagesConsulted).toEqual(['2024-09']);
    const straddled = deriveStateAtT(rows, { subject: 'M0ABC', t: '2010-01-01', assertionCeiling: '2024-09-15' });
    expect(straddled.vintagesConsulted).toEqual([]);
    expect(straddled.addressable).toBe(false);
  });
});

// --- Disagreements -----------------------------------------------------------

describe('vintage disagreements are surfaced, never resolved', { tags: ['unit'] }, () => {
  it('TwoDatasetsAssertingDifferentEarliestStarts_AreListedSideBySideWithNoVerdict', () => {
    // The G3SDS shape (issue #800 mechanism B): four vintages say 1977, the
    // latest says 2026 — at t = 2000 the answer must show both camps.
    const rows: SubjectEventRow[] = [
      row('licence-version-original-start', '1977-07-09', { vintage: '2021-04-21', dataset: 'ofcom-2021-04' }),
      row('licence-version-original-start', '1977-07-09', { vintage: '2025-11-11', dataset: '2025-11-11' }),
      row('licence-version-original-start', '2026-02-23', { vintage: '2026-06-23', dataset: '2026-06-23' }),
    ];
    const answer = deriveStateAtT(rows, { subject: 'G3SDS', t: '2000-01-01' });
    expect(answer.disagreements).toHaveLength(1);
    expect(answer.disagreements[0].kind).toBe('licence-version-original-start');
    expect(answer.disagreements[0].values.map(v => v.day)).toEqual(['1977-07-09', '2026-02-23']);
    const start = answer.findings.find(f => f.rule === 'licence-start-on-or-before-t');
    expect(start?.caveats).toContain('vintages-disagree');
    // The finding rests only on the vintages whose assertion supports it.
    expect(start?.assertingVintages).toEqual(['2021-04-21', '2025-11-11']);
  });

  it('DatasetsAgreeingOnTheEarliestStart_ProduceNoDisagreement', () => {
    const rows: SubjectEventRow[] = [
      row('licence-version-original-start', '1977-07-09', { vintage: '2021-04-21', dataset: 'a' }),
      row('licence-version-original-start', '1977-07-09', { vintage: '2025-11-11', dataset: 'b' }),
    ];
    const answer = deriveStateAtT(rows, { subject: 'G3SDS', t: '2000-01-01' });
    expect(answer.disagreements).toEqual([]);
    const start = answer.findings.find(f => f.rule === 'licence-start-on-or-before-t');
    expect(start?.caveats).not.toContain('vintages-disagree');
  });

  it('BookkeepingMovement_IsRoutineProgressionNotADisagreement', () => {
    // Forward bookkeeping movement is the column's job (S2's
    // expected-progression) — the disagreement list is licensing facts only.
    const rows: SubjectEventRow[] = [
      row('record-last-modified', '2016-08-12', { vintage: '2023-01-25', dataset: 'a' }),
      row('record-last-modified', '2024-04-08', { vintage: '2024-07-22', dataset: 'b' }),
    ];
    const answer = deriveStateAtT(rows, { subject: 'G0PRG', t: '2025-01-01' });
    expect(answer.disagreements).toEqual([]);
  });
});

// --- Bounding assertions -----------------------------------------------------

describe('the dated assertions bounding t', { tags: ['unit'] }, () => {
  it('EvidenceEitherSideOfT_NamesTheNearestBoundingAssertions', () => {
    const answer = deriveStateAtT(
      [
        row('licence-issued', '1998-07-14', { vintage: '2019-09-12' }),
        row('record-last-modified', '2016-08-12', { vintage: '2023-01-25' }),
        row('reserved-until', '2026-08-09', { vintage: '2024-09-10' }),
      ],
      { subject: 'M0ABC', t: '2018-01-01' },
    );
    expect(answer.bounds.latestOnOrBeforeT.map(l => `${l.kind}:${l.day}`)).toEqual(['record-last-modified:2016-08-12']);
    expect(answer.bounds.earliestAfterT.map(l => `${l.kind}:${l.day}`)).toEqual(['reserved-until:2026-08-09']);
  });
});

// --- Folds over a fixture ledger ---------------------------------------------

const V1 = 'opendata/2021-04-21/fixture.csv';
const V2 = 'opendata/2025-11-11/fixture.csv';

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

describe.skipIf(!duckDbAvailable())('state folds over a fixture ledger', { tags: ['unit'] }, () => {
  function writeFixtureLedger(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'state-at-t-fixture-'));
    const claims: Claim[] = [
      eventClaim(V1, 'G3ATI', 'licence-version-original-start', '2015-02-07', 0),
      eventClaim(V2, 'G3ATI', 'licence-version-original-start', '1952-10-10', 1),
      eventClaim(V2, 'G3ATI', 'licence-version-original-start', '2015-02-07', 2),
      eventClaim(V1, 'G3ATI', 'record-last-modified', '2016-08-12', 3),
      // A subject that cleans to the same key from a decorated raw form: the
      // fold joins on the cleaned key, so both rows aggregate under M0ABC.
      eventClaim(V1, 'm0abc ', 'licence-issued', '1998-07-14', 4),
      eventClaim(V2, 'M0ABC', 'licence-issued', '1998-07-14', 5),
    ];
    fs.writeFileSync(path.join(dir, 'fixture.jsonl'), serialiseClaimsJsonl(claims));
    return dir;
  }

  it('StateAtT_OverAFixtureLedger_ReproducesThePureEngineAnswer', () => {
    const dir = writeFixtureLedger();
    try {
      const answer = stateAtT(dir, { subject: 'G3ATI', t: '1960-06-01' }, EMPTY_STATE_CONTEXT);
      expect(answer.addressable).toBe(true);
      const start = answer.findings.find(f => f.rule === 'licence-start-on-or-before-t');
      expect(start?.assertingVintages).toEqual(['2025-11-11']);
      // The fold's rows, run through the pure engine, give the same answer —
      // the fold is extraction only, the semantics live in one place.
      const rows = foldSubjectEvents(dir, 'G3ATI');
      expect(deriveStateAtT(rows, { subject: 'G3ATI', t: '1960-06-01' }, EMPTY_STATE_CONTEXT)).toEqual(answer);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('SubjectFold_CleanedKeyJoin_AggregatesDecoratedRawFormsUnderOneSubject', () => {
    const dir = writeFixtureLedger();
    try {
      const rows = foldSubjectEvents(dir, 'M0ABC');
      expect(rows).toHaveLength(2);
      expect(rows.every(r => r.kind === 'licence-issued' && r.day === '1998-07-14')).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('KindCoverageAndUniverse_OverAFixtureLedger_CountTheCorpusHonestly', () => {
    const dir = writeFixtureLedger();
    try {
      const coverage = foldKindCoverage(dir);
      expect(coverage.map(c => c.kind)).toEqual(['licence-issued', 'licence-version-original-start', 'record-last-modified']);
      const versionStart = coverage.find(c => c.kind === 'licence-version-original-start');
      expect(versionStart).toMatchObject({ contribution: 'licence-start', datasets: 2, subjects: 1, claims: 3, earliestDay: '1952-10-10', latestDay: '2015-02-07' });
      expect(versionStart?.vintages).toEqual(['2021-04-21', '2025-11-11']);
      const universe = foldSubjectUniverse(dir);
      expect(universe).toEqual({ totalSubjects: 2, eventSubjects: 2, licensingSubjects: 2 });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('EmptyClaimsSource_AsInTheReportSweepFixtureContext_YieldsTheHonestEmptyAnswer', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'state-at-t-empty-'));
    try {
      const answer = stateAtT(dir, { subject: 'M7TEE', t: '2020-01-01' }, EMPTY_STATE_CONTEXT);
      expect(answer.addressable).toBe(false);
      expect(rulesOf(answer)).toEqual(['no-evidence-for-subject']);
      expect(foldKindCoverage(dir)).toEqual([]);
      expect(foldSubjectUniverse(dir)).toEqual({ totalSubjects: 0, eventSubjects: 0, licensingSubjects: 0 });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// --- Rendering ---------------------------------------------------------------

describe('state-at-t rendering', { tags: ['unit'] }, () => {
  it('RenderStateAnswer_OutsideCoverage_SaysCannotInferAndNeverAvailability', () => {
    const answer = deriveStateAtT([], { subject: 'Q1ZZZ', t: '2020-01-01' });
    const text = renderStateAnswer(answer).join('\n');
    expect(text).toContain('Outside coverage — cannot infer.');
    expect(text).toContain('never "did not exist" or "was available"');
  });

  it('RenderReport_WholePicture_CarriesRulesCaveatsContributionsCoverageAndExamples', () => {
    const answer = deriveStateAtT(
      [row('licence-issued', '1998-07-14', { vintage: '2019-09-12', dataset: 'ofcom-756622' })],
      { subject: 'M0ABC', t: '2005-06-01' },
    );
    const report: StateAtTReport = {
      params: DEFAULT_EPISODE_PARAMS,
      episodes: [{ start: '2016-07-23', end: '2016-08-12', signals: [] }],
      coverage: [{
        kind: 'licence-issued', contribution: 'licence-start', datasets: 2, vintages: ['2019-08', '2019-09-12'],
        subjects: 103901, claims: 207802, earliestDay: '1920-01-01', latestDay: '2019-09-12',
      }],
      universe: { totalSubjects: 200000, eventSubjects: 180000, licensingSubjects: 150000 },
      examples: [{
        example: { title: 'Example', query: { subject: 'M0ABC', t: '2005-06-01' }, commentary: ['Commentary line.'] },
        answer,
      }],
    };
    const md = renderStateAtTReport(report);
    expect(md).toContain('# State-at-t reconstruction (bi-temporal)');
    for (const gloss of RULE_GLOSSES.keys()) expect(md).toContain(`**${gloss}**`);
    for (const caveat of CAVEAT_GLOSSES.keys()) expect(md).toContain(`**${caveat}**`);
    for (const kind of EVENT_DATE_KINDS) expect(md).toContain(`\`${kind}\``);
    expect(md).toContain('| `licence-issued` | licence-start | 2 | 103,901 | 207,802 | 1920-01-01 → 2019-09-12 | 2019-08, 2019-09-12 |');
    expect(md).toContain('- Cleaned subjects in the ledger: 200,000');
    expect(md).toContain('90.0%');
    expect(md).toContain('- Episode 1: 2016-07-23 → 2016-08-12');
    expect(md).toContain('### Example');
    expect(md).toContain('**licence-start-on-or-before-t**');
  });
});
