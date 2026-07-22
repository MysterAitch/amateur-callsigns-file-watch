import { describe, it, expect } from 'vitest';
import {
  computeTimeline,
  renderTimelinePage,
  timelineJson,
  buildTimeline,
  LICENSING_KINDS,
  TIMELINE_CAVEATS,
} from './build-timeline.ts';
import { foldEventTimeProjection, type EventTimeProjection } from './event-time-projection.ts';
import { CAVEAT_LABELS } from './build-callsign-event-shards.ts';
import type { ResolvedLedgerSource } from '../v2/collectors/types.ts';
import type { SourceObservationSet } from '../v2/claim.ts';
import { parseJsonObject } from '../shared/json-shape.ts';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

interface TimelineJsonShape {
  asAt: string;
  kinds: { id: string; label: string; contribution: string }[];
  caveats: { id: string; label: string; gloss: string }[];
  datasets: { lane: string; key: string; vintage: string; title: string; href: string }[];
  buckets: { year: string; datasetIdxs: number[] }[];
}

// The event-time timeline surface (issue #726, remainder item 1): per licensing
// kind, a static histogram of dated activity by year; per instant, the
// pre-aggregated cumulative figures the scrubber reads (starts to date, active
// reservation windows, leading series) — each carrying its caveats and citing
// its asserting vintages. Test names follow Subject_Scenario_Outcome.

function fixtureSource(spec: {
  sourceFile: string;
  vintage: string;
  rows: { callsign: string; start?: string; issued?: string; cancel?: string; reserved?: string }[];
}): ResolvedLedgerSource {
  const set: SourceObservationSet = {
    sourceFile: spec.sourceFile,
    vintage: spec.vintage,
    columns: ['Call Sign', 'Original Start Date', 'Issue Date', 'Licence Cancel Date', 'Reserved Until'],
    subjectColumn: 'Call Sign',
    rows: spec.rows.map(row => ({
      'Call Sign': row.callsign,
      'Original Start Date': row.start ?? '',
      'Issue Date': row.issued ?? '',
      'Licence Cancel Date': row.cancel ?? '',
      'Reserved Until': row.reserved ?? '',
    })),
    columnInterpretations: [
      { type: 'callsign-token' },
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
          // G3 series: an earliest surviving start pre-1977.
          { callsign: 'G3ATI', start: '10/10/1952' },
          { callsign: 'G3SDS', start: '09/07/1977' },
          // M7 series: two callsigns start on the same day, one later.
          { callsign: 'M7AAA', start: '20/12/2018' },
          { callsign: 'M7AAB', start: '20/12/2018' },
          { callsign: 'M7AAC', start: '05/01/2019' },
          // A cancellation for the G2 series.
          { callsign: 'G2XYZ', cancel: '05/03/1938' },
          // A reservation window stated to run to 2026, asserted in 2020.
          { callsign: 'GB0SNB', reserved: '09/08/2026' },
        ],
      }),
    ],
  });
}

describe('timeline aggregation (issue #726)', { tags: ['unit'] }, () => {
  it('Timeline_LicensingKinds_ExcludeBookkeepingStamps', () => {
    // The histograms are drawn per LICENSING kind; system-presence bookkeeping
    // stamps (record-created and friends) are never a timeline figure.
    expect(LICENSING_KINDS).toContain('licence-version-original-start');
    expect(LICENSING_KINDS).toContain('licence-cancelled');
    expect(LICENSING_KINDS).toContain('reserved-until');
    expect(LICENSING_KINDS).not.toContain('record-created');
    expect(LICENSING_KINDS).not.toContain('licence-created');
  });

  it('Timeline_HistogramPerKind_CountsDatedEventsInEachYear', () => {
    const timeline = computeTimeline(fixtureProjection());
    const starts = timeline.histograms['licence-version-original-start'];
    const byYear = new Map(starts);
    expect(byYear.get('1952')).toBe(1);
    expect(byYear.get('2018')).toBe(2);
    expect(byYear.get('2019')).toBe(1);
    // A year in the span with no start is a zero bar, not a gap.
    expect(byYear.get('2000')).toBe(0);
    // The axis spans the earliest event (a 1938 cancellation) to the latest
    // (the 2026 reservation end).
    expect(starts[0][0]).toBe('1938');
    expect(starts[starts.length - 1][0]).toBe('2026');
  });

  it('Timeline_StartsToDate_AccumulateMonotonicallyOverTheYears', () => {
    const timeline = computeTimeline(fixtureProjection());
    const at = (year: string) => timeline.buckets.find(b => b.year === year)?.startsToDate;
    expect(at('1951')).toBe(0);
    expect(at('1952')).toBe(1);
    expect(at('1977')).toBe(2);
    expect(at('2018')).toBe(4);
    expect(at('2019')).toBe(5);
    expect(at('2026')).toBe(5);
    // Never decreases.
    const series = timeline.buckets.map(b => b.startsToDate);
    expect([...series].sort((a, b) => a - b)).toEqual(series);
  });

  it('Timeline_ActiveReservationWindow_CoversOnlyYearsBetweenItsVintageAndItsStatedEnd', () => {
    const timeline = computeTimeline(fixtureProjection());
    const at = (year: string) => timeline.buckets.find(b => b.year === year)?.activeReservations;
    // Stated end 2026-08-09, asserted by the 2020-05-01 vintage: covering only
    // from 2020 (known) to 2025 (last year end on or before the stated end) —
    // never "active in 1938", and no longer covering by end of 2026.
    expect(at('1938')).toBe(0);
    expect(at('2019')).toBe(0);
    expect(at('2020')).toBe(1);
    expect(at('2025')).toBe(1);
    expect(at('2026')).toBe(0);
  });

  it('Timeline_LeadingSeries_RankByCumulativeStartsAtTheInstant', () => {
    const timeline = computeTimeline(fixtureProjection());
    const at2026 = timeline.buckets.find(b => b.year === '2026');
    const leader = at2026?.topSeries[0];
    // By 2026 the M7 series leads with three starts; G3 has two.
    expect(leader).toEqual({ series: 'M7', startsToDate: 3 });
    const g3 = at2026?.topSeries.find(s => s.series === 'G3');
    expect(g3?.startsToDate).toBe(2);
    // GB special-event forms carry no prefix series, so none appears here.
    expect(at2026?.topSeries.every(s => s.series !== '')).toBe(true);
  });

  it('Timeline_CumulativeStartFigure_CarriesEarliestSurvivingAndPre1977Caveats', () => {
    const timeline = computeTimeline(fixtureProjection());
    // The 1952 surviving version-scoped start pins both date-derived caveats on
    // every bucket from then on — cross-surface caveat parity (#861).
    const at2000 = timeline.buckets.find(b => b.year === '2000');
    expect(at2000?.caveats).toContain('earliest-surviving');
    expect(at2000?.caveats).toContain('pre-1977');
    // Every bucket reads under the availability trap.
    expect(at2000?.caveats).toContain('availability-trap');
  });

  it('Timeline_CancellationYear_CarriesTheSparsityCaveat', () => {
    const timeline = computeTimeline(fixtureProjection());
    const at1938 = timeline.buckets.find(b => b.year === '1938');
    expect(at1938?.perKind['licence-cancelled']).toBe(1);
    expect(at1938?.caveats).toContain('cancellation-sparsity');
  });

  it('Timeline_MonthKeyedAssertingVintage_CarriesTheMonthPrecisionCaveat', () => {
    const projection = foldEventTimeProjection({
      sources: [
        fixtureSource({
          sourceFile: 'foi/entry-m/reg.csv',
          vintage: '2016-09',
          rows: [{ callsign: '2E0AAA', start: '01/02/2003' }],
        }),
      ],
    });
    const timeline = computeTimeline(projection);
    const at2003 = timeline.buckets.find(b => b.year === '2003');
    expect(at2003?.caveats).toContain('month-precision-vintage');
  });

  it('Timeline_LaterBucketWhoseCumulativeRestsOnAMonthKeyedStart_StillCarriesMonthPrecision', () => {
    // Issue #870 inheritance drop: a month-keyed vintage asserts a 2003 start;
    // a later day-keyed vintage adds a 2019 start. The 2019 bucket's OWN
    // asserting dataset is day-keyed, but its cumulative starts-to-date still
    // rests on the 2003 month-keyed start — so month-precision must NOT be
    // dropped forward off it (the engine attaches it at every such t).
    const projection = foldEventTimeProjection({
      sources: [
        fixtureSource({ sourceFile: 'foi/entry-m/reg.csv', vintage: '2016-09', rows: [{ callsign: '2E0AAA', start: '01/02/2003' }] }),
        fixtureSource({ sourceFile: 'foi/entry-d/reg.csv', vintage: '2020-05-01', rows: [{ callsign: 'M7XXX', start: '01/01/2019' }] }),
      ],
    });
    const timeline = computeTimeline(projection);
    const at2019 = timeline.buckets.find(b => b.year === '2019');
    expect(at2019?.startsToDate).toBe(2);
    expect(at2019?.caveats).toContain('month-precision-vintage');
    // And a bucket BEFORE the month-keyed start does not carry it via the
    // cumulative arm (there is no counted start yet).
    const at2002 = timeline.buckets.find(b => b.year === '2002');
    expect(at2002?.caveats ?? []).not.toContain('month-precision-vintage');
  });

  it('Timeline_BucketWhoseCumulativeIsAllNonVersionScopedStarts_DoesNotCarryEarliestSurviving', () => {
    // earliest-surviving must scope to the event-dated version-scoped start, not
    // a global "version-scoped exists somewhere" flag: a 1950 licence-issued
    // start (non-version-scoped) precedes a 1980 version-scoped start, so the
    // 1950 bucket must not inherit earliest-surviving from the later start.
    const projection = foldEventTimeProjection({
      sources: [
        fixtureSource({ sourceFile: 'foi/entry-a/reg.csv', vintage: '2020-05-01', rows: [
          { callsign: 'G8OLD', issued: '01/01/1950' },
          { callsign: 'G3NEW', start: '01/01/1980' },
        ] }),
      ],
    });
    const timeline = computeTimeline(projection);
    const at1950 = timeline.buckets.find(b => b.year === '1950');
    expect(at1950?.startsToDate).toBe(1);
    expect(at1950?.caveats ?? []).not.toContain('earliest-surviving');
    const at1980 = timeline.buckets.find(b => b.year === '1980');
    expect(at1980?.caveats).toContain('earliest-surviving');
  });

  it('Timeline_EveryBucketCaveat_HasAnAuthoredReaderFacingLabel', () => {
    // Drift guard: a caveat the timeline can attach without a label would render
    // bare (issue #861). Both surfaces read the one CAVEAT_LABELS vocabulary.
    const timeline = computeTimeline(fixtureProjection());
    for (const bucket of timeline.buckets) {
      for (const caveat of bucket.caveats) {
        expect(TIMELINE_CAVEATS).toContain(caveat);
        expect(CAVEAT_LABELS.get(caveat)).toBeTruthy();
      }
    }
  });

  it('Timeline_EmptyProjection_YieldsNoKindsAndNoBuckets', () => {
    const timeline = computeTimeline(foldEventTimeProjection({ sources: [] }));
    expect(timeline.kinds).toEqual([]);
    expect(timeline.buckets).toEqual([]);
  });

  it('Timeline_RebuiltFromTheSameProjection_IsByteIdenticalJson', () => {
    const projection = fixtureProjection();
    const a = timelineJson(computeTimeline(projection), projection.datasets);
    const b = timelineJson(computeTimeline(projection), projection.datasets);
    expect(a).toBe(b);
  });
});

describe('timeline JSON for the scrubber (issue #726)', { tags: ['unit'] }, () => {
  it('TimelineJson_CarriesTheMetaLegendSoNoFigureRendersBare', () => {
    const projection = fixtureProjection();
    const json = parseJsonObject(timelineJson(computeTimeline(projection), projection.datasets), 'timeline') as TimelineJsonShape;
    // The assertion-time axis (datasets + vintages) and the caveat legend both
    // ship, so the client names vintages and glosses caveats with no 2nd fetch.
    expect(json.datasets.length).toBeGreaterThan(0);
    expect(json.datasets[0]).toHaveProperty('vintage');
    expect(json.caveats.every(c => c.label !== '' && c.gloss !== '')).toBe(true);
    expect(json.kinds.every(k => k.label !== '')).toBe(true);
    // A bucket cites its asserting datasets by index into that legend.
    const at2018 = json.buckets.find(b => b.year === '2018');
    expect(at2018).toBeDefined();
    expect(at2018?.datasetIdxs.length).toBeGreaterThan(0);
    expect(at2018?.datasetIdxs.every(i => json.datasets[i] !== undefined)).toBe(true);
  });

  it('TimelineJson_AsAt_IsTheCorpusInstantNeverTheBuildClock', () => {
    const projection = fixtureProjection();
    const json = parseJsonObject(timelineJson(computeTimeline(projection), projection.datasets), 'timeline') as TimelineJsonShape;
    expect(json.asAt).toBe(projection.asAt);
    expect(json.asAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('timeline page render (issue #726)', { tags: ['unit'] }, () => {
  it('TimelinePage_PerLicensingKind_RendersAStaticSvgHistogramWithADataTable', () => {
    const projection = fixtureProjection();
    const html = renderTimelinePage(computeTimeline(projection), projection);
    // The no-JS baseline: an accessible inline SVG (role="img" + title/desc)
    // over a crawlable data table, one figure per licensing kind present.
    expect(html).toContain('<figure class="chart">');
    expect(html).toContain('role="img"');
    expect(html).toMatch(/<svg viewBox="0 0 600 /);
    expect(html).toContain('licence-version start');
    expect(html).toContain('licence cancelled');
    expect(html).toContain('Data table');
  });

  it('TimelinePage_CumulativeHeadline_AnchorsOnTheProvenAssertionYearNotTheMaxEventYear', () => {
    const projection = fixtureProjection();
    const html = renderTimelinePage(computeTimeline(projection), projection);
    // The 2020 vintage is the corpus's proven "as at"; the span reaches 2026
    // (a reservation end), but the headline anchors on 2020, not 2026 — event
    // dates run past the proven assertion day.
    expect(html).toMatch(/As at end of 2020/);
    expect(html).not.toMatch(/As at end of 2026/);
    expect(html).toMatch(/latest proven assertion day/);
    expect(html).toContain('Cumulative figures by year');
  });

  it('TimelinePage_ScrubberSlot_IsAProgressiveEnhancementPlaceholder', () => {
    const projection = fixtureProjection();
    const html = renderTimelinePage(computeTimeline(projection), projection);
    // The slider is injected by the enhancement into this slot, so no-JS
    // readers never see a dead control; the script and data source are named.
    expect(html).toContain('id="timeline-scrubber"');
    expect(html).toContain('data-timeline-src="timeline/data.json"');
    expect(html).toContain('src="timeline.js"');
  });

  it('TimelinePage_MechanismExplainer_IsPresentButFolded', () => {
    const projection = fixtureProjection();
    const html = renderTimelinePage(computeTimeline(projection), projection);
    // Conditional prominence: the explainer is always discoverable and stays
    // folded here (uniformly applicable background).
    expect(html).toContain('<details id="reading-this-timeline">');
    expect(html).not.toContain('<details id="reading-this-timeline" open>');
    expect(html).toMatch(/earliest <em>surviving<\/em>/);
  });

  it('TimelinePage_TwoTimeAxes_AreNamedNeverMerged', () => {
    const projection = fixtureProjection();
    const html = renderTimelinePage(computeTimeline(projection), projection);
    expect(html).toMatch(/event time/);
    expect(html).toMatch(/assertion time/);
    expect(html).toMatch(/never merged/);
  });

  it('TimelinePage_EmptyProjection_StatesTheAbsenceHonestly', () => {
    const projection = foldEventTimeProjection({ sources: [] });
    const html = renderTimelinePage(computeTimeline(projection), projection);
    expect(html).toContain('No entries.');
    expect(html).toMatch(/statement about these holdings, not about history/);
  });
});

describe('timeline build artefacts (issue #726)', { tags: ['unit'] }, () => {
  it('BuildTimeline_WritesTheHtmlPageAndTheScrubberJson', () => {
    const projection = fixtureProjection();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'timeline-build-'));
    const htmlPath = path.join(dir, 'timeline.html');
    const dataPath = path.join(dir, 'timeline', 'data.json');
    const summary = buildTimeline(projection, htmlPath, dataPath);
    expect(fs.existsSync(htmlPath)).toBe(true);
    expect(fs.existsSync(dataPath)).toBe(true);
    expect(summary.kinds).toBeGreaterThan(0);
    expect(summary.buckets).toBe(2026 - 1938 + 1);
    // Byte-deterministic: a second build over the same projection matches.
    const firstHtml = fs.readFileSync(htmlPath);
    const firstJson = fs.readFileSync(dataPath);
    buildTimeline(projection, htmlPath, dataPath);
    expect(fs.readFileSync(htmlPath).equals(firstHtml)).toBe(true);
    expect(fs.readFileSync(dataPath).equals(firstJson)).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
