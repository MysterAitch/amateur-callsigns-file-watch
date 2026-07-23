import { describe, it, expect } from 'vitest';
import {
  onThisDayManifest,
  timelineManifest,
  historyDatasets,
  historyCaveatLegend,
} from './build-v1-history.ts';
import type { OnThisDayEntry } from './build-on-this-day.ts';
import type { Timeline } from './build-timeline.ts';
import type { EventDatasetRef } from './event-time-projection.ts';
import { CAVEAT_GLOSSES } from './state-at-t.ts';

// The v1 history manifests (issue #932): the root-served, self-contained JSON
// the on-this-day calendar and the timeline scrubber fetch. These tests cover
// the pure shaping functions with fixtures — the fold functions they wrap are
// tested by their own suites (build-on-this-day / build-timeline). Test names
// follow Subject_Scenario_Outcome.

// A minimal projection stand-in: the shaping functions read only the dataset
// table and the derived as-at instant.
const DATASETS: EventDatasetRef[] = [
  { lane: 'opendata', dataset: 'ofcom-2024-06-23', vintage: '2024-06-23', title: 'Amateur register — 23 June 2024', href: 'datasets/open-data/ofcom-2024-06-23/index.html' },
  { lane: 'foi', dataset: 'wdtk-498906', vintage: '2018-10', title: 'FOI 498906 — reciprocal licences', href: 'datasets/foi/wdtk-498906/index.html' },
];
const PROJECTION = { datasets: DATASETS, asAt: '2024-06-23' };

const ENTRY_START: OnThisDayEntry = {
  monthDay: '10-18',
  year: '2018',
  day: '2018-10-18',
  series: 'M7',
  event: 'first-start',
  callsigns: ['M7ABC', 'M7XYZ'],
  kinds: ['licence-version-original-start'],
  datasetIdxs: [0],
  caveats: ['earliest-surviving', 'availability-trap'],
  seriesIntroduced: '2018-10',
  predatesSeriesIntroduction: false,
};

const ENTRY_CANCEL: OnThisDayEntry = {
  monthDay: '04-16',
  year: '2021',
  day: '2021-04-16',
  series: 'M0',
  event: 'first-cancellation',
  callsigns: ['M0ZZZ'],
  kinds: ['licence-cancelled'],
  datasetIdxs: [1],
  caveats: ['cancellation-sparsity', 'month-precision-vintage'],
  seriesIntroduced: '',
  predatesSeriesIntroduction: false,
};

describe('build-v1-history — dataset table + caveat legend', { tags: ['unit'] }, () => {
  it('HistoryDatasets_EachSource_LeadsWithTheFriendlyTitleAndDropsTheOffSurfaceHref', () => {
    const table = historyDatasets(DATASETS);
    expect(table).toEqual([
      { key: 'ofcom-2024-06-23', vintage: '2024-06-23', title: 'Amateur register — 23 June 2024' },
      { key: 'wdtk-498906', vintage: '2018-10', title: 'FOI 498906 — reciprocal licences' },
    ]);
    // The v1 surface links only to itself: no dataset href is carried.
    for (const d of table) expect(d).not.toHaveProperty('href');
  });

  it('HistoryCaveatLegend_EveryReferencedCaveat_CarriesALabelAndAGloss', () => {
    const legend = historyCaveatLegend(['month-precision-vintage', 'earliest-surviving']);
    for (const c of legend) {
      expect(c.label.length).toBeGreaterThan(0);
      expect(c.gloss.trim().length).toBeGreaterThan(0);
      expect(c.gloss).toBe(CAVEAT_GLOSSES.get(c.id));
    }
  });

  it('HistoryCaveatLegend_OnlyReferencedCaveats_AreListedInTheAuthoredOrder', () => {
    // Passed out of order and with a repeat; the legend lists each once, in the
    // engine's authored gloss order — never a bare, unglossed id.
    const legend = historyCaveatLegend(['availability-trap', 'earliest-surviving', 'earliest-surviving']);
    const ids = legend.map(c => c.id);
    expect(ids).toContain('earliest-surviving');
    expect(ids).toContain('availability-trap');
    expect(new Set(ids).size).toBe(ids.length);
    const order = [...CAVEAT_GLOSSES.keys()];
    expect(order.indexOf('earliest-surviving')).toBeLessThan(order.indexOf('availability-trap'));
    expect(ids).toEqual([...order].filter(id => ids.includes(id)));
  });
});

describe('build-v1-history — on-this-day manifest', { tags: ['unit'] }, () => {
  it('OnThisDayManifest_WhenEntriesFold_ResolvesKindLabelsAndKeepsDatasetIndices', () => {
    const m = onThisDayManifest([ENTRY_START, ENTRY_CANCEL], PROJECTION);
    expect(m.schemaVersion).toBe(1);
    expect(m.asAt).toBe('2024-06-23');
    expect(m.count).toBe(2);
    expect(m.days).toBe(2);
    const start = m.entries[0];
    // The engine's own reader-facing label is resolved at build, never a bare kind id.
    expect(start.kindLabels[0]).toContain('licence-version start');
    expect(start.datasetIdxs).toEqual([0]);
    expect(start.callsigns).toEqual(['M7ABC', 'M7XYZ']);
    // Every referenced caveat resolves in the legend.
    const legendIds = new Set(m.caveats.map(c => c.id));
    for (const e of m.entries) for (const id of e.caveatIds) expect(legendIds.has(id)).toBe(true);
  });

  it('OnThisDayManifest_WhenNoEntriesFold_ReportsAnHonestEmptyCalendarNotAFabricatedDay', () => {
    // The availability trap is binding: no held evidence means an empty calendar,
    // never an invented entry.
    const m = onThisDayManifest([], PROJECTION);
    expect(m.entries).toEqual([]);
    expect(m.count).toBe(0);
    expect(m.days).toBe(0);
    expect(m.caveats).toEqual([]);
    // The dataset table still ships so the (empty) page can still cite honestly.
    expect(m.datasets.length).toBe(2);
  });

  it('OnThisDayManifest_WhenAnEntryCarriesAnUnlabelledKind_FailsLoudRatherThanShippingABareId', () => {
    const bad = { ...ENTRY_START, kinds: ['not-a-real-kind'] };
    expect(() => onThisDayManifest([bad], PROJECTION)).toThrow(/no authored reader-facing label|has no authored/);
  });

  it('OnThisDayManifest_BuiltTwice_IsByteIdentical', () => {
    const a = JSON.stringify(onThisDayManifest([ENTRY_START, ENTRY_CANCEL], PROJECTION));
    const b = JSON.stringify(onThisDayManifest([ENTRY_START, ENTRY_CANCEL], PROJECTION));
    expect(a).toBe(b);
  });
});

const TIMELINE: Timeline = {
  asAt: '2024-06-23',
  kinds: ['licence-version-original-start', 'licence-cancelled'],
  histograms: {
    'licence-version-original-start': [['2018', 2], ['2019', 0], ['2020', 5]],
    'licence-cancelled': [['2018', 0], ['2019', 1], ['2020', 0]],
  },
  totals: { 'licence-version-original-start': 7, 'licence-cancelled': 1 },
  buckets: [
    { year: '2018', perKind: { 'licence-version-original-start': 2 }, startsToDate: 2, activeReservations: 0, topSeries: [{ series: 'M7', startsToDate: 2 }], datasetIdxs: [0], caveats: ['earliest-surviving', 'availability-trap'] },
    { year: '2019', perKind: { 'licence-cancelled': 1 }, startsToDate: 2, activeReservations: 1, topSeries: [{ series: 'M7', startsToDate: 2 }], datasetIdxs: [1], caveats: ['cancellation-sparsity', 'availability-trap'] },
    { year: '2020', perKind: { 'licence-version-original-start': 5 }, startsToDate: 7, activeReservations: 1, topSeries: [{ series: 'M7', startsToDate: 7 }], datasetIdxs: [0], caveats: ['earliest-surviving', 'availability-trap'] },
  ],
};

describe('build-v1-history — timeline manifest', { tags: ['unit'] }, () => {
  it('TimelineManifest_WhenBucketsFold_ReshapesTopSeriesAndKeepsHistograms', () => {
    const m = timelineManifest(TIMELINE, PROJECTION);
    expect(m.schemaVersion).toBe(1);
    expect(m.asAt).toBe('2024-06-23');
    expect(m.kinds.map(k => k.id)).toEqual(['licence-version-original-start', 'licence-cancelled']);
    expect(m.kinds[0].label).toContain('licence-version start');
    expect(m.buckets).toHaveLength(3);
    // topSeries is re-serialised as [series, count] pairs.
    expect(m.buckets[0].topSeries).toEqual([['M7', 2]]);
    expect(m.histograms['licence-version-original-start']).toEqual([['2018', 2], ['2019', 0], ['2020', 5]]);
    // Every bucket caveat resolves in the legend, labelled and glossed (#861).
    const legendIds = new Set(m.caveats.map(c => c.id));
    for (const b of m.buckets) for (const id of b.caveatIds) expect(legendIds.has(id)).toBe(true);
    for (const c of m.caveats) expect(c.gloss.trim().length).toBeGreaterThan(0);
  });

  it('TimelineManifest_DatasetTable_DropsTheOffSurfaceHref', () => {
    const m = timelineManifest(TIMELINE, PROJECTION);
    expect(m.datasets.length).toBe(2);
    for (const d of m.datasets) expect(d).not.toHaveProperty('href');
  });

  it('TimelineManifest_WhenTheCorpusCarriesNoLicensingEvidence_ReportsEmptyKindsAndBuckets', () => {
    const empty: Timeline = { asAt: '2024-06-23', kinds: [], histograms: {}, totals: {}, buckets: [] };
    const m = timelineManifest(empty, PROJECTION);
    expect(m.kinds).toEqual([]);
    expect(m.buckets).toEqual([]);
    expect(m.caveats).toEqual([]);
  });

  it('TimelineManifest_BuiltTwice_IsByteIdentical', () => {
    const a = JSON.stringify(timelineManifest(TIMELINE, PROJECTION));
    const b = JSON.stringify(timelineManifest(TIMELINE, PROJECTION));
    expect(a).toBe(b);
  });
});
