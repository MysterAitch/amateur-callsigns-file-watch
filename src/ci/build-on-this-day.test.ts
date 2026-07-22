import { describe, it, expect } from 'vitest';
import { computeOnThisDayEntries, renderOnThisDayPage, dayAnchor } from './build-on-this-day.ts';
import { foldEventTimeProjection, type EventTimeProjection } from './event-time-projection.ts';
import type { ResolvedLedgerSource } from '../v2/collectors/types.ts';
import type { SourceObservationSet } from '../v2/claim.ts';

// The on-this-day surface (issue #726 surface 2): per prefix series, the
// earliest held start and cancellation evidence, arranged by calendar day —
// every entry carrying the citation shape ("dated <event day>, per <dataset>
// (vintage <assertion time>)") and its caveats. Test names follow
// Subject_Scenario_Outcome.

function fixtureSource(spec: {
  sourceFile: string;
  vintage: string;
  rows: { callsign: string; start?: string; cancel?: string }[];
}): ResolvedLedgerSource {
  const set: SourceObservationSet = {
    sourceFile: spec.sourceFile,
    vintage: spec.vintage,
    columns: ['Call Sign', 'Original Start Date', 'Licence Cancel Date'],
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

function fixtureProjection(): EventTimeProjection {
  return foldEventTimeProjection({
    sources: [
      fixtureSource({
        sourceFile: 'foi/entry-a/reg.csv',
        vintage: '2020-05-01',
        rows: [
          // G3 series: the earliest start is pre-1977 (both caveats fire).
          { callsign: 'G3ATI', start: '10/10/1952' },
          { callsign: 'G3SDS', start: '09/07/1977' },
          // M7 series: two callsigns TIE on the series' earliest day.
          { callsign: 'M7AAA', start: '20/12/2018' },
          { callsign: 'M7AAB', start: '20/12/2018' },
          { callsign: 'M7AAC', start: '05/01/2019' },
          // A cancellation for the G2 series.
          { callsign: 'G2XYZ', cancel: '05/03/1938' },
          // A visitor form the parser reads no prefix series from.
          { callsign: 'M/F1ABC', start: '01/01/2000' },
        ],
      }),
    ],
  });
}

describe('on-this-day entries (issue #726)', { tags: ['unit'] }, () => {
  it('OnThisDay_PerSeries_PicksTheEarliestHeldStartDay', () => {
    const entries = computeOnThisDayEntries(fixtureProjection());
    const g3 = entries.find(e => e.series === 'G3' && e.event === 'first-start');
    expect(g3).toMatchObject({ day: '1952-10-10', monthDay: '10-10', year: '1952', callsigns: ['G3ATI'] });
  });

  it('OnThisDay_TieOnTheEarliestDay_ListsEveryTiedCallsign', () => {
    const entries = computeOnThisDayEntries(fixtureProjection());
    const m7 = entries.find(e => e.series === 'M7' && e.event === 'first-start');
    expect(m7?.callsigns).toEqual(['M7AAA', 'M7AAB']);
  });

  it('OnThisDay_Pre1977VersionScopedStart_CarriesBothDateCaveats', () => {
    const entries = computeOnThisDayEntries(fixtureProjection());
    const g3 = entries.find(e => e.series === 'G3' && e.event === 'first-start');
    expect(g3?.caveats).toEqual(['earliest-surviving', 'pre-1977']);
    const m7 = entries.find(e => e.series === 'M7' && e.event === 'first-start');
    expect(m7?.caveats).toEqual(['earliest-surviving']);
  });

  it('OnThisDay_CancellationEvidence_IsItsOwnEntryKindAndCarriesTheSparsityCaveat', () => {
    const entries = computeOnThisDayEntries(fixtureProjection());
    const g2 = entries.find(e => e.series === 'G2');
    expect(g2).toMatchObject({ event: 'first-cancellation', day: '1938-03-05', callsigns: ['G2XYZ'] });
    // Cross-surface caveat parity (#861): the strip's cancellation reasoning
    // carries cancellation-sparsity, so the calendar entry over the same
    // evidence must too - and a cancellation is not a version-scoped start,
    // so it carries neither date-derived start caveat.
    expect(g2?.caveats).toEqual(['cancellation-sparsity']);
  });

  it('OnThisDay_MonthKeyedAssertingVintage_CarriesTheMonthPrecisionCaveat', () => {
    const projection = foldEventTimeProjection({
      sources: [
        fixtureSource({
          sourceFile: 'foi/entry-m/reg.csv',
          vintage: '2016-09',
          rows: [{ callsign: '2E0AAA', start: '01/02/2003' }],
        }),
      ],
    });
    const entries = computeOnThisDayEntries(projection);
    const entry = entries.find(e => e.event === 'first-start');
    // The engine's own vintage-grammar reading (isMonthPrecisionVintage): a
    // month-keyed citation is only proven to somewhere inside its month.
    expect(entry?.caveats).toEqual(['earliest-surviving', 'month-precision-vintage']);
  });

  it('OnThisDay_EarliestStartPredatingTheSeriesIntroduction_IsFlaggedAsCarriedHistory', () => {
    // An M9-series callsign (series introduced October 2025) whose earliest
    // held start is dated 1991 — the M9KUR case (#915): the date is the
    // licence chain's carried origin, not the callsign's issuance.
    const projection = foldEventTimeProjection({
      sources: [
        fixtureSource({
          sourceFile: 'foi/entry-b/reg.csv',
          vintage: '2026-06-23',
          rows: [{ callsign: 'M9KUR', start: '26/07/1991' }],
        }),
      ],
    });
    const entry = computeOnThisDayEntries(projection).find(e => e.series === 'M9' && e.event === 'first-start');
    expect(entry?.predatesSeriesIntroduction).toBe(true);
    expect(entry?.seriesIntroduced).toBe('2025-10');
  });

  it('OnThisDay_EarliestStartAfterTheSeriesIntroduction_IsNotFlaggedAsCarriedHistory', () => {
    // A fresh post-introduction M9 issuance: origin on or after the series'
    // introduction month is the callsign's own history, not carried.
    const projection = foldEventTimeProjection({
      sources: [
        fixtureSource({
          sourceFile: 'foi/entry-c/reg.csv',
          vintage: '2026-06-23',
          rows: [{ callsign: 'M9ZZZ', start: '20/11/2025' }],
        }),
      ],
    });
    const entry = computeOnThisDayEntries(projection).find(e => e.series === 'M9' && e.event === 'first-start');
    expect(entry?.predatesSeriesIntroduction).toBe(false);
    expect(entry?.seriesIntroduced).toBe('2025-10');
  });

  it('OnThisDay_SeriesWithNoRecordedIntroduction_IsNeverFlaggedAsCarried', () => {
    // G3 carries no introduction month in the reference data, so its earliest
    // held start is never asserted to predate an introduction (no false flag).
    const entries = computeOnThisDayEntries(fixtureProjection());
    const g3 = entries.find(e => e.series === 'G3' && e.event === 'first-start');
    expect(g3?.seriesIntroduced).toBe('');
    expect(g3?.predatesSeriesIntroduction).toBe(false);
  });

  it('OnThisDay_SubjectWithoutAPrefixSeries_HasNoSlotRatherThanAGuessedOne', () => {
    const entries = computeOnThisDayEntries(fixtureProjection());
    expect(entries.every(e => e.series !== '')).toBe(true);
    expect(entries.flatMap(e => e.callsigns)).not.toContain('M/F1ABC');
  });

  it('OnThisDay_Entries_AreSortedByCalendarDay', () => {
    const entries = computeOnThisDayEntries(fixtureProjection());
    const monthDays = entries.map(e => e.monthDay);
    expect([...monthDays].sort()).toEqual(monthDays);
  });
});

describe('on-this-day page render (issue #726)', { tags: ['unit'] }, () => {
  it('OnThisDayPage_Entry_CarriesTheCanonicalCitationShape', () => {
    const projection = fixtureProjection();
    const html = renderOnThisDayPage(computeOnThisDayEntries(projection), projection);
    // Event time (the dated day) AND assertion time (the vintage) both named,
    // never merged: the entry cites "dated <day> ... per <dataset> (vintage ...)".
    expect(html).toContain('dated');
    expect(html).toContain('per <a href="datasets/foi/entry-a/index.html">entry-a</a>');
    expect(html).toMatch(/vintage/);
    // Deep links into the evidence: the per-callsign page and the ledger.
    expect(html).toContain('callsign.html?c=G3ATI');
    expect(html).toContain('ledger.html?c=G3ATI');
    expect(html).toContain('series/G3.html');
  });

  it('OnThisDayPage_Pre1977Entry_NamesItsCaveatsInline', () => {
    const projection = fixtureProjection();
    const html = renderOnThisDayPage(computeOnThisDayEntries(projection), projection);
    expect(html).toMatch(/pre-1977 start dates are attested-unreliable/);
    expect(html).toMatch(/earliest surviving date, not “the true original”/);
  });

  it('OnThisDayPage_CarriedHistoryEntry_NamesTheSeriesIntroductionInline', () => {
    const projection = foldEventTimeProjection({
      sources: [
        fixtureSource({
          sourceFile: 'foi/entry-b/reg.csv',
          vintage: '2026-06-23',
          rows: [{ callsign: 'M9KUR', start: '26/07/1991' }],
        }),
      ],
    });
    const html = renderOnThisDayPage(computeOnThisDayEntries(projection), projection);
    // The carried-history reading is rendered inline as the interesting fact,
    // naming the series introduction month and the licence-chain scope.
    expect(html).toContain('carried licence history');
    expect(html).toMatch(/predates the M9-series’ own introduction \(October 2025\)/);
    expect(html).toMatch(/not the callsign’s own issuance/);
  });

  it('OnThisDayPage_MechanismExplainer_IsPresentButFolded', () => {
    const projection = fixtureProjection();
    const html = renderOnThisDayPage(computeOnThisDayEntries(projection), projection);
    // The conditional-prominence pattern: the mechanism is always
    // discoverable (a details fold), and on this page it stays folded - it is
    // uniformly applicable background, so opening it everywhere would be noise.
    expect(html).toContain('<details id="reading-these-dates">');
    expect(html).not.toContain('<details id="reading-these-dates" open>');
    expect(html).toMatch(/surviving in the asserting vintage/);
  });

  it('OnThisDayPage_DaySections_CarryStableAnchorsTheEnhancementResolves', () => {
    const projection = fixtureProjection();
    const html = renderOnThisDayPage(computeOnThisDayEntries(projection), projection);
    expect(dayAnchor('10-10')).toBe('d-10-10');
    expect(html).toContain('id="d-10-10"');
    expect(html).toContain('id="d-12-20"');
    expect(html).toContain('id="today-slot"');
    expect(html).toContain('src="on-this-day.js"');
  });

  it('OnThisDayPage_EmptyProjection_StatesTheAbsenceHonestly', () => {
    const projection = foldEventTimeProjection({ sources: [] });
    const html = renderOnThisDayPage([], projection);
    expect(html).toContain('No entries.');
    expect(html).toMatch(/statement about these holdings, not about history/);
  });

  it('OnThisDayPage_AbsenceOfADay_IsNamedNonObservation', () => {
    const projection = fixtureProjection();
    const html = renderOnThisDayPage(computeOnThisDayEntries(projection), projection);
    expect(html).toMatch(/non-observation, never “nothing happened”/);
  });
});
