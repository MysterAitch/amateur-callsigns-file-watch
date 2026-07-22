// Differential parity test (issue #726): the timeline's one-pass aggregates vs
// deriveStateAtT called per subject at EVERY bucket instant, over a fixture
// stressing reissues, revised-backward dates, same-day start+cancel,
// month-precision vintages, restated reservation windows, Dec-31 window ends and
// a 2099 future-dated outlier. This pins the "one pass yields the engine's
// figures" claim against future engine drift (the narrow-parity-fixture
// fragility class): a change to deriveStateAtT that silently diverged the
// surfaces would fail here. Probes 3-4 double as regression pins for the
// cumulative caveat-scoping fix. Fixture-only (no acquireClaimsSource), so it
// runs in the fast pool. Test names follow Subject_Scenario_Outcome.
import { describe, it, expect } from 'vitest';
import { computeTimeline } from './build-timeline.ts';
import { foldEventTimeProjection, type EventTimeProjection } from './event-time-projection.ts';
import { deriveStateAtT } from './state-at-t.ts';
import type { ResolvedLedgerSource } from '../v2/collectors/types.ts';
import type { SourceObservationSet } from '../v2/claim.ts';

function src(spec: {
  sourceFile: string;
  vintage: string;
  rows: { callsign: string; start?: string; issued?: string; cancel?: string; reserved?: string; created?: string }[];
}): ResolvedLedgerSource {
  const set: SourceObservationSet = {
    sourceFile: spec.sourceFile,
    vintage: spec.vintage,
    columns: ['Call Sign', 'Original Start Date', 'Issue Date', 'Licence Cancel Date', 'Reserved Until', 'Record Created'],
    subjectColumn: 'Call Sign',
    rows: spec.rows.map(row => ({
      'Call Sign': row.callsign,
      'Original Start Date': row.start ?? '',
      'Issue Date': row.issued ?? '',
      'Licence Cancel Date': row.cancel ?? '',
      'Reserved Until': row.reserved ?? '',
      'Record Created': row.created ?? '',
    })),
    columnInterpretations: [
      { type: 'callsign-token' },
      { type: 'date', format: 'DD/MM/YYYY' },
      { type: 'date', format: 'DD/MM/YYYY' },
      { type: 'date', format: 'DD/MM/YYYY' },
      { type: 'date', format: 'DD/MM/YYYY' },
      { type: 'date', format: 'DD/MM/YYYY' },
    ],
    eventDateColumns: [
      { source: 'Original Start Date', kind: 'licence-version-original-start' },
      { source: 'Issue Date', kind: 'licence-issued' },
      { source: 'Licence Cancel Date', kind: 'licence-cancelled' },
      { source: 'Reserved Until', kind: 'reserved-until' },
      { source: 'Record Created', kind: 'record-created' },
    ],
  };
  const [, dataset] = spec.sourceFile.split('/');
  return {
    family: 'foi-register',
    subjectKind: 'callsign',
    entry: dataset,
    sourceFile: spec.sourceFile,
    jsonlStem: dataset,
    load: () => set,
  };
}

function adversarialProjection(): EventTimeProjection {
  return foldEventTimeProjection({
    sources: [
      src({
        sourceFile: 'foi/entry-2016m/reg.csv',
        vintage: '2016-09', // month-keyed
        rows: [
          { callsign: 'G3AAA', start: '10/10/1952' },       // version-scoped, pre-1977
          { callsign: 'G3BBB', start: '05/06/1980' },
          { callsign: 'M0MMM', reserved: '15/03/2018' },     // reservation asserted by a month vintage
          { callsign: 'G4SDC', start: '01/07/1990', cancel: '01/07/1990' }, // same-day start+cancel
          { callsign: 'G8ISS', issued: '01/01/1948' },       // non-version-scoped start kind
          { callsign: 'M9SYS', created: '01/01/2010' },      // bookkeeping only
        ],
      }),
      src({
        sourceFile: 'foi/entry-2020/reg.csv',
        vintage: '2020-05-01',
        rows: [
          { callsign: 'G3AAA', start: '07/02/2015' },        // reissue: later vintage, later date
          { callsign: 'G3BBB', start: '05/06/1979' },        // revised backward
          { callsign: 'GB0SNB', reserved: '09/08/2026' },
          { callsign: 'GB0SNB', reserved: '31/12/2022' },    // restated window; Dec-31 end
          { callsign: 'M7ZZZ', start: '20/12/2018', cancel: '01/01/2019' },
          { callsign: 'Q9QQQ', reserved: '01/01/2099' },     // future-dated outlier
          { callsign: 'G2XYZ', cancel: '05/03/1938' },       // cancel with no start
        ],
      }),
      src({
        sourceFile: 'foi/entry-2026/reg.csv',
        vintage: '2026-06-23',
        rows: [
          { callsign: 'G3AAA', start: '07/02/2015' },
          { callsign: 'M7YYY', start: '01/01/2026' },
          { callsign: 'M7YYY', start: '01/01/2026' },        // duplicate row (nrows > 1)
        ],
      }),
    ],
  });
}

describe('timeline aggregate parity vs deriveStateAtT (issue #726)', { tags: ['unit'] }, () => {
  it('Parity_EveryBucketInstant_StartsAndReservationsMatchTheEngine', () => {
    const projection = adversarialProjection();
    const timeline = computeTimeline(projection);
    expect(timeline.buckets.length).toBeGreaterThan(0);
    const mismatches: string[] = [];
    for (const bucket of timeline.buckets) {
      const t = `${bucket.year}-12-31`;
      let starts = 0;
      let resv = 0;
      for (const [subject, rows] of projection.rows) {
        const ans = deriveStateAtT(rows, { subject, t });
        if (ans.findings.some(f => f.rule === 'licence-start-on-or-before-t')) starts += 1;
        if (ans.findings.some(f => f.rule === 'reservation-window-consistent-with-covering-t')) resv += 1;
      }
      if (starts !== bucket.startsToDate) mismatches.push(`${bucket.year}: startsToDate ${bucket.startsToDate} vs engine ${starts}`);
      if (resv !== bucket.activeReservations) mismatches.push(`${bucket.year}: activeReservations ${bucket.activeReservations} vs engine ${resv}`);
    }
    expect(mismatches).toEqual([]);
  });

  it('Parity_Histograms_MatchDistinctSubjectKindDayRecount', () => {
    const projection = adversarialProjection();
    const timeline = computeTimeline(projection);
    const recount = new Map<string, Map<string, number>>();
    for (const [subject, rows] of projection.rows) {
      const seen = new Set<string>();
      for (const row of rows) {
        if (!timeline.kinds.includes(row.kind)) continue;
        const key = `${subject}\n${row.kind}\n${row.day}`;
        if (seen.has(key)) continue;
        seen.add(key);
        let byYear = recount.get(row.kind);
        if (byYear === undefined) { byYear = new Map(); recount.set(row.kind, byYear); }
        const year = row.day.slice(0, 4);
        byYear.set(year, (byYear.get(year) ?? 0) + 1);
      }
    }
    for (const kind of timeline.kinds) {
      const byYear = recount.get(kind) ?? new Map<string, number>();
      for (const [year, n] of timeline.histograms[kind]) {
        expect(`${kind} ${year}: ${n}`).toBe(`${kind} ${year}: ${byYear.get(year) ?? 0}`);
      }
    }
    expect(timeline.kinds).not.toContain('record-created');
  });

  // Regression pin for the cumulative caveat-scoping fix: the engine attaches
  // month-precision to a start finding at every t whose consulted starts include
  // a month-keyed-asserted line; the bucket must attach it at exactly those
  // instants — never dropping it forward onto later buckets whose cumulative
  // still rests on that start (the #870 inheritance drop).
  it('MonthPrecisionCaveat_OnEveryBucketWhoseCumulativeRestsOnAMonthKeyedStart_IsAttached', () => {
    const projection = adversarialProjection();
    const timeline = computeTimeline(projection);
    const dropped: string[] = [];
    for (const bucket of timeline.buckets) {
      if (bucket.startsToDate === 0) continue;
      const t = `${bucket.year}-12-31`;
      let engineWouldAttach = false;
      for (const [subject, rows] of projection.rows) {
        const ans = deriveStateAtT(rows, { subject, t });
        const startFinding = ans.findings.find(f => f.rule === 'licence-start-on-or-before-t');
        if (startFinding !== undefined && startFinding.caveats.includes('month-precision-vintage')) {
          engineWouldAttach = true;
          break;
        }
      }
      if (engineWouldAttach && !bucket.caveats.includes('month-precision-vintage')) dropped.push(bucket.year);
    }
    expect(dropped).toEqual([]);
  });

  // Regression pin: earliest-surviving must NOT attach on a bucket whose counted
  // subjects are all non-version-scoped (the engine attaches it only where a
  // consulted start is version-scoped). Scoping by the event-dated threshold,
  // not a global "version-scoped exists somewhere" flag, prevents the over-attach.
  it('EarliestSurvivingCaveat_OnBucketsWithOnlyNonVersionScopedStarts_IsNotAttached', () => {
    const projection = adversarialProjection();
    const timeline = computeTimeline(projection);
    const b1948 = timeline.buckets.find(b => b.year === '1948');
    expect(b1948?.startsToDate).toBe(1); // G8ISS (licence-issued) only; the version-scoped G3AAA starts in 1952
    const rows = projection.rows.get('G8ISS');
    expect(rows).toBeDefined();
    if (rows === undefined) return;
    const ans = deriveStateAtT(rows, { subject: 'G8ISS', t: '1948-12-31' });
    const startFinding = ans.findings.find(f => f.rule === 'licence-start-on-or-before-t');
    expect(startFinding?.caveats.includes('earliest-surviving')).toBe(false);
    expect(b1948?.caveats.includes('earliest-surviving')).toBe(false);
  });
});
