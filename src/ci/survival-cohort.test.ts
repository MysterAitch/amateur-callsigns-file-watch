import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  computeSurvivalCohort,
  renderSurvivalCohort,
  foldLivingAge,
  foldOutcomes,
  foldObservedEnds,
  foldEraCohort,
  foldClassRetention,
  foldReservation,
  START_KINDS,
  END_KINDS,
  RESERVATION_KINDS,
  type SurvivalCohort,
} from './survival-cohort.ts';
import { EVENT_DATE_RULE, EVENT_DATE_PREDICATE_PREFIX, LISTED_PREDICATE, IMPLIED_CLASS_PREDICATE } from '../v2/claim.ts';
import { duckDbAvailable } from '../v2/report-fold.ts';

// Issue #865: the survival/cohort fold, exercised on a hand-built claim ledger
// so each curve's censoring semantics are pinned without the whole corpus. The
// corpus test (survival-cohort-corpus.test.ts) is the byte-identity golden gate
// over the real archive; this suite is the controlled-scenario logic gate. Test
// names follow Subject_Scenario_Outcome.

// One ledger claim row, in the LEDGER_COLUMNS shape the fold reads.
interface Row {
  layer: string;
  rawSubject: string;
  predicate: string;
  object: string;
  sourceFile: string;
  ordinal: number;
  vintage: string;
  rule: string | null;
}

// A declared-complete open-data @listed anchor for a subject in a vintage. The
// (sourceFile, ordinal) pair is the observation key the implied_class claim
// joins on.
function listed(subject: string, vintage: string, ordinal: number): Row {
  return { layer: 'raw', rawSubject: subject, predicate: LISTED_PREDICATE, object: '', sourceFile: `opendata/${vintage}/raw.csv`, ordinal, vintage, rule: null };
}

// The prefix-implied licence class for one open-data observation.
function impliedClass(vintage: string, ordinal: number, cls: string): Row {
  return { layer: 'derived', rawSubject: '', predicate: IMPLIED_CLASS_PREDICATE, object: cls, sourceFile: `opendata/${vintage}/raw.csv`, ordinal, vintage, rule: null };
}

// One S1 event-date claim (any lane): the kind rides in the predicate, the ISO
// day in the object.
function event(subject: string, kind: string, day: string, dataset: string, vintage: string): Row {
  return { layer: 'derived', rawSubject: subject, predicate: `${EVENT_DATE_PREDICATE_PREFIX}${kind}`, object: day, sourceFile: `foi/${dataset}/x.csv`, ordinal: 0, vintage, rule: EVENT_DATE_RULE };
}

function writeLedger(rows: Row[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'survival-fixture-'));
  const ledger = path.join(dir, 'ledger');
  fs.mkdirSync(ledger, { recursive: true });
  fs.writeFileSync(path.join(ledger, 'fixture.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  return dir;
}

// The declared-complete vintages the fixtures use: three publications, latest
// last. The fold judges presence and censoring against exactly this list.
const VINTAGES = ['2016-01-01', '2020-01-01', '2026-01-01'];
const START_KIND = START_KINDS[0]; // a licence-start contribution kind
const END_KIND = END_KINDS[0];     // licence-cancelled
const RESERVATION_KIND = RESERVATION_KINDS[0]; // reserved-until

describe.skipIf(!duckDbAvailable())('survival/cohort fold — controlled ledger', { tags: ['unit'] }, () => {
  it('OutcomeTaxonomy_PresenceAndCancellationScenarios_ClassifiedIntoTheFourOutcomes', () => {
    const rows: Row[] = [
      // ALIVE: present in every vintage incl. latest, no cancellation.
      listed('G1AAA', '2016-01-01', 1), listed('G1AAA', '2020-01-01', 1), listed('G1AAA', '2026-01-01', 1),
      // CANCELLED-STILL-LISTED: present in latest AND carries a cancellation date.
      listed('G1BBB', '2020-01-01', 2), listed('G1BBB', '2026-01-01', 2),
      event('G1BBB', END_KIND, '2019-06-01', 'reserved', '2020-01-01'),
      // CANCELLED-AND-DEPARTED: cancellation date, absent from latest.
      listed('G1CCC', '2016-01-01', 3), listed('G1CCC', '2020-01-01', 3),
      event('G1CCC', END_KIND, '2018-03-03', 'reserved', '2020-01-01'),
      // VANISHED: present earlier, absent from latest, no cancellation.
      listed('G1DDD', '2016-01-01', 4), listed('G1DDD', '2020-01-01', 4),
    ];
    const dir = writeLedger(rows);
    try {
      const outcomes = foldOutcomes(path.join(dir, 'ledger'), VINTAGES, '2026-01-01');
      const byOutcome = new Map(outcomes.map(o => [o.outcome, o.subjects]));
      expect(byOutcome.get('still-listed')).toBe(1);
      expect(byOutcome.get('cancelled-still-listed')).toBe(1);
      expect(byOutcome.get('cancelled-and-departed')).toBe(1);
      expect(byOutcome.get('vanished')).toBe(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('LivingAge_StartDatedSubjectsPresentInLatest_AreRightCensoredAndBucketedByEraSinceStart', () => {
    const rows: Row[] = [
      // from-1977 start, ~26 years to the 2026 horizon -> 20-39y band.
      listed('G2AAA', '2026-01-01', 1), event('G2AAA', START_KIND, '2000-01-01', 'reg', '2026-01-01'),
      // pre-1977 start, ~66 years -> 60y+ band, pre-1977 column.
      listed('G2BBB', '2026-01-01', 2), event('G2BBB', START_KIND, '1960-01-01', 'reg', '2026-01-01'),
      // start-dated but NOT present in latest -> excluded from the living curve.
      listed('G2CCC', '2020-01-01', 3), event('G2CCC', START_KIND, '2001-01-01', 'reg', '2020-01-01'),
    ];
    const dir = writeLedger(rows);
    try {
      const living = foldLivingAge(path.join(dir, 'ledger'), VINTAGES, '2026-01-01');
      // Exactly the two present-in-latest start-dated subjects, each in its era.
      expect(living.find(r => r.era === 'from-1977' && r.bucketId === 'd')?.subjects).toBe(1);
      expect(living.find(r => r.era === 'pre-1977' && r.bucketId === 'f')?.subjects).toBe(1);
      expect(living.reduce((sum, r) => sum + r.subjects, 0)).toBe(2);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ObservedEnds_SameDayVersusGenuineSpan_CountsOnlyStrictlyEarlierStartsAsLifespans', () => {
    const rows: Row[] = [
      // Same-day: start == cancellation -> paired + sameDay, never a span.
      event('G3AAA', START_KIND, '2016-07-24', 'reg', '2020-01-01'),
      event('G3AAA', END_KIND, '2016-07-24', 'reserved', '2020-01-01'),
      // Genuine multi-year span: start 20 years before cancellation.
      event('G3BBB', START_KIND, '1990-01-01', 'reg', '2020-01-01'),
      event('G3BBB', END_KIND, '2010-01-01', 'reserved', '2020-01-01'),
      // Cancellation with NO start on or before it -> counted only as a cancel subject.
      event('G3CCC', END_KIND, '1970-01-01', 'reserved', '2020-01-01'),
      event('G3CCC', START_KIND, '1999-01-01', 'reg', '2020-01-01'),
    ];
    const dir = writeLedger(rows);
    try {
      const oe = foldObservedEnds(path.join(dir, 'ledger'));
      expect(oe.cancelSubjects).toBe(3);
      expect(oe.pairedWithStart).toBe(2); // G3AAA and G3BBB; G3CCC's only start post-dates the cancellation
      expect(oe.sameDay).toBe(1);         // G3AAA
      expect(oe.positiveSpan).toBe(1);    // G3BBB
      expect(oe.spanAtLeastOneYear).toBe(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('EraCohort_ByEarliestStartDecade_SplitsRetentionIntoStillListedCancelledAndVanished', () => {
    const rows: Row[] = [
      // 1980s cohort: still listed.
      listed('G4AAA', '2026-01-01', 1), event('G4AAA', START_KIND, '1985-01-01', 'reg', '2026-01-01'),
      // 1980s cohort: cancelled AND departed.
      listed('G4BBB', '2020-01-01', 2), event('G4BBB', START_KIND, '1986-01-01', 'reg', '2020-01-01'),
      event('G4BBB', END_KIND, '2015-01-01', 'reserved', '2020-01-01'),
      // 1980s cohort: vanished (absent from latest, no cancellation).
      listed('G4CCC', '2020-01-01', 3), event('G4CCC', START_KIND, '1987-01-01', 'reg', '2020-01-01'),
    ];
    const dir = writeLedger(rows);
    try {
      const era = foldEraCohort(path.join(dir, 'ledger'), VINTAGES, '2026-01-01');
      const eighties = era.find(r => r.decade === '1980s');
      expect(eighties).toMatchObject({ subjects: 3, stillListed: 1, cancelledDeparted: 1, vanished: 1 });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ClassRetention_BaseVintagePresenceUnderImpliedClass_MeasuresSurvivalIntoLatest', () => {
    const rows: Row[] = [
      // Full, present in base and latest -> retained.
      listed('G5AAA', '2016-01-01', 1), impliedClass('2016-01-01', 1, 'Full'), listed('G5AAA', '2026-01-01', 9),
      // Full, present in base only -> not retained.
      listed('G5BBB', '2016-01-01', 2), impliedClass('2016-01-01', 2, 'Full'),
      // Foundation, present in base and latest -> retained.
      listed('G5CCC', '2016-01-01', 3), impliedClass('2016-01-01', 3, 'Foundation'), listed('G5CCC', '2026-01-01', 8),
      // Base observation with no implied_class claim -> (unresolved), never dropped.
      listed('20XYZ', '2016-01-01', 4),
    ];
    const dir = writeLedger(rows);
    try {
      const cls = foldClassRetention(path.join(dir, 'ledger'), '2016-01-01', '2026-01-01');
      const byClass = new Map(cls.map(r => [r.licenceClass, r]));
      expect(byClass.get('Full')).toMatchObject({ base: 2, stillListed: 1 });
      expect(byClass.get('Foundation')).toMatchObject({ base: 1, stillListed: 1 });
      expect(byClass.get('(unresolved)')).toMatchObject({ base: 1, stillListed: 0 });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('Reservation_WindowsRelativeToAssertion_FlagPolicyExceptionsRetrospectionAndReallocation', () => {
    const rows: Row[] = [
      // Window ~4 years beyond a 2020 assertion -> over two years (not five).
      event('G6AAA', RESERVATION_KIND, '2024-06-01', 'reserved', '2020-01-01'),
      // Retrospective: stated end BEFORE the asserting vintage.
      event('G6BBB', RESERVATION_KIND, '2015-01-01', 'reserved', '2020-01-01'),
      // Indefinite sentinel.
      event('G6CCC', RESERVATION_KIND, '2099-12-31', 'reserved', '2020-01-01'),
      // Reallocation signal: reserved (a short sub-two-year window), then a later start.
      event('G6DDD', RESERVATION_KIND, '2017-06-01', 'reserved', '2016-01-01'),
      event('G6DDD', START_KIND, '2019-01-01', 'reg', '2020-01-01'),
    ];
    const dir = writeLedger(rows);
    try {
      const r = foldReservation(path.join(dir, 'ledger'));
      expect(r.subjects).toBe(4);
      expect(r.overTwoYears).toBe(1);
      expect(r.overFiveYears).toBe(0);
      expect(r.retrospective).toBe(1);
      expect(r.indefinite).toBe(1);
      expect(r.withLaterStart).toBe(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('SurvivalCohort_FoldedTwiceOverTheSameLedger_IsByteDeterministic', () => {
    const rows: Row[] = [
      listed('G7AAA', '2016-01-01', 1), listed('G7AAA', '2026-01-01', 1),
      event('G7AAA', START_KIND, '1995-01-01', 'reg', '2026-01-01'),
      impliedClass('2016-01-01', 1, 'Full'),
      event('G7BBB', RESERVATION_KIND, '2024-01-01', 'reserved', '2020-01-01'),
    ];
    const dir = writeLedger(rows);
    try {
      const first = computeSurvivalCohort(path.join(dir, 'ledger'), VINTAGES);
      const second = computeSurvivalCohort(path.join(dir, 'ledger'), VINTAGES);
      expect(renderSurvivalCohort(first)).toBe(renderSurvivalCohort(second));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('SurvivalCohort_NoDeclaredCompleteVintages_FoldsToTheHonestEmptyReport', () => {
    // The report-sweep fixture / a bare corpus: no declared-complete vintage,
    // so no cohort can form — the report says "no data", never an empty register.
    const empty: SurvivalCohort = computeSurvivalCohort(path.join(writeLedger([]), 'ledger'), []);
    expect(empty.latestVintage).toBeNull();
    expect(renderSurvivalCohort(empty)).toContain('no cohort can be formed');
  });
});
