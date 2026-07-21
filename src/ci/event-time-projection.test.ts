import { describe, it, expect } from 'vitest';
import { foldEventTimeProjection, datasetIndexOf } from './event-time-projection.ts';
import type { ResolvedLedgerSource } from '../v2/collectors/types.ts';
import type { SourceObservationSet } from '../v2/claim.ts';

// The in-process event-time projection (issue #726): the S1 emit path run over
// synthetic sources through the SAME emitEventDateClaims the ledger uses, so
// these fixtures exercise the real extraction, aggregation and ordering rules.
// Test names follow Subject_Scenario_Outcome.

interface FixtureSourceSpec {
  sourceFile: string; // '<lane>/<dataset>/<file>'
  vintage: string;
  rows: { callsign: string; start?: string; cancel?: string }[];
}

// A synthetic register-shaped source: a callsign column plus two attested
// day-first date columns bound to the version-start and cancellation kinds.
function fixtureSource(spec: FixtureSourceSpec): ResolvedLedgerSource {
  const columns = ['Call Sign', 'Original Start Date', 'Licence Cancel Date'];
  const set: SourceObservationSet = {
    sourceFile: spec.sourceFile,
    vintage: spec.vintage,
    columns,
    subjectColumn: 'Call Sign',
    rows: spec.rows.map(row => ({
      'Call Sign': row.callsign,
      'Original Start Date': row.start ?? '',
      'Licence Cancel Date': row.cancel ?? '',
    })),
    columnInterpretations: [
      { type: 'callsign-token' },
      { type: 'date', format: 'DD/MM/YYYY' },
      { type: 'date', format: 'DD/MM/YYYY' },
    ],
    eventDateColumns: [
      { source: 'Original Start Date', kind: 'licence-version-original-start' },
      { source: 'Licence Cancel Date', kind: 'licence-cancelled' },
    ],
  };
  const [lane, dataset] = spec.sourceFile.split('/');
  return {
    family: 'foi-register',
    subjectKind: 'callsign',
    entry: dataset,
    sourceFile: spec.sourceFile,
    jsonlStem: `${lane}-${dataset}`,
    load: () => set,
  };
}

describe('event-time projection (issue #726)', { tags: ['unit'] }, () => {
  it('Projection_TwoVintagesAssertTheSameStart_YieldsOneRowPerVintageOnTheSharedDay', () => {
    const projection = foldEventTimeProjection({
      sources: [
        fixtureSource({ sourceFile: 'foi/entry-a/reg.csv', vintage: '2020-05-01', rows: [{ callsign: 'M7TEE', start: '20/12/2018' }] }),
        fixtureSource({ sourceFile: 'foi/entry-b/reg.csv', vintage: '2021-06-01', rows: [{ callsign: 'M7TEE', start: '20/12/2018' }] }),
      ],
    });
    const rows = projection.rows.get('M7TEE');
    expect(rows).toEqual([
      { kind: 'licence-version-original-start', lane: 'foi', dataset: 'entry-a', vintage: '2020-05-01', day: '2018-12-20', nrows: 1 },
      { kind: 'licence-version-original-start', lane: 'foi', dataset: 'entry-b', vintage: '2021-06-01', day: '2018-12-20', nrows: 1 },
    ]);
    expect(projection.datasets.map(d => d.dataset)).toEqual(['entry-a', 'entry-b']);
    expect(projection.asAt).toBe('2021-06-01');
  });

  it('Projection_MultipleRowsOfOneSubjectOnOneDay_AggregatesNrowsInsteadOfDuplicating', () => {
    const projection = foldEventTimeProjection({
      sources: [
        fixtureSource({
          sourceFile: 'foi/entry-a/reg.csv',
          vintage: '2020-05-01',
          rows: [
            { callsign: 'G3ATI', start: '10/10/1952' },
            { callsign: 'G3ATI', start: '10/10/1952' },
          ],
        }),
      ],
    });
    expect(projection.rows.get('G3ATI')).toEqual([
      { kind: 'licence-version-original-start', lane: 'foi', dataset: 'entry-a', vintage: '2020-05-01', day: '1952-10-10', nrows: 2 },
    ]);
  });

  it('Projection_SubjectCellCleansToNothing_IsCountedUnkeyableNeverSilentlyDropped', () => {
    const projection = foldEventTimeProjection({
      sources: [
        fixtureSource({ sourceFile: 'foi/entry-a/reg.csv', vintage: '2020-05-01', rows: [{ callsign: ',,', start: '01/02/2003' }] }),
      ],
    });
    expect(projection.unkeyableEventClaims).toBe(1);
    expect(projection.rows.size).toBe(0);
  });

  it('Projection_MonthKeyedVintage_IsAcceptedAndBoundsAsAtByItsMonthEnd', () => {
    const projection = foldEventTimeProjection({
      sources: [
        fixtureSource({ sourceFile: 'foi/entry-a/reg.csv', vintage: '2016-09', rows: [{ callsign: 'G0AAA', start: '01/02/2003' }] }),
      ],
    });
    expect(projection.asAt).toBe('2016-09-30');
  });

  it('Projection_SourceWithVintageOutsideTheAuthoredGrammar_FailsLoud', () => {
    expect(() => foldEventTimeProjection({
      sources: [
        fixtureSource({ sourceFile: 'foi/entry-a/reg.csv', vintage: 'unknown', rows: [{ callsign: 'M7TEE', start: '20/12/2018' }] }),
      ],
    })).toThrow(/neither day-keyed .* nor month-keyed/);
  });

  it('Projection_SourceWithNoDatedCells_ContributesNoDatasetReference', () => {
    const projection = foldEventTimeProjection({
      sources: [
        fixtureSource({ sourceFile: 'foi/entry-a/reg.csv', vintage: '2020-05-01', rows: [{ callsign: 'M7TEE' }] }),
      ],
    });
    expect(projection.datasets).toEqual([]);
    expect(projection.rows.size).toBe(0);
    expect(projection.asAt).toBe('');
  });

  it('Projection_DaySignals_TallyEveryClaimPerDatasetKindAndDay', () => {
    const projection = foldEventTimeProjection({
      sources: [
        fixtureSource({
          sourceFile: 'foi/entry-a/reg.csv',
          vintage: '2020-05-01',
          rows: [
            { callsign: 'M7AAA', start: '20/12/2018' },
            { callsign: 'M7AAB', start: '20/12/2018', cancel: '01/01/2019' },
          ],
        }),
      ],
    });
    expect(projection.daySignals).toEqual([
      { lane: 'foi', dataset: 'entry-a', vintage: '2020-05-01', kind: 'licence-cancelled', day: '2019-01-01', n: 1 },
      { lane: 'foi', dataset: 'entry-a', vintage: '2020-05-01', kind: 'licence-version-original-start', day: '2018-12-20', n: 2 },
    ]);
  });

  it('Projection_SubjectRows_AreOrderedLikeTheLedgerFold', () => {
    // foldSubjectEvents orders by (kind, day, lane, dataset, vintage); the
    // in-process projection must agree so the engine sees identical input.
    const projection = foldEventTimeProjection({
      sources: [
        fixtureSource({ sourceFile: 'foi/entry-b/reg.csv', vintage: '2021-06-01', rows: [{ callsign: 'M7TEE', start: '05/05/2019', cancel: '06/06/2020' }] }),
        fixtureSource({ sourceFile: 'foi/entry-a/reg.csv', vintage: '2020-05-01', rows: [{ callsign: 'M7TEE', start: '20/12/2018' }] }),
      ],
    });
    const rows = projection.rows.get('M7TEE');
    expect(rows?.map(r => `${r.kind}|${r.day}|${r.dataset}`)).toEqual([
      'licence-cancelled|2020-06-06|entry-b',
      'licence-version-original-start|2018-12-20|entry-a',
      'licence-version-original-start|2019-05-05|entry-b',
    ]);
  });

  it('DatasetIndex_AssertionCitingAnUnlistedDataset_FailsLoud', () => {
    expect(() => datasetIndexOf([], 'foi', 'entry-a')).toThrow(/no dataset reference/);
  });
});
