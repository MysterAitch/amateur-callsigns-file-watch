// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  renderTimeline,
  renderReadout,
  buildScrubber,
  renderHistogram,
  parseTimeline,
  anchorIndex,
} from './timeline-sections.js';

// The v1 timeline (issue #932): the event-time histogram + scrubber, rendered
// from the root-served manifest. Event time leads — each bar counts dated events
// the record states fell in a year — and every figure names the publications and
// vintages that assert it (assertion time). Test names follow
// Subject_Scenario_Outcome and cover the non-happy paths: an empty corpus, a
// wrong-shaped manifest, the anchor rule when as-at sits outside the span, and a
// year with no new assertion.

const norm = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();

function makeData(overrides = {}) {
  return {
    schemaVersion: 1,
    asAt: '2020-06-23',
    datasets: [
      { key: 'ofcom-2020-06-23', vintage: '2020-06-23', title: 'Amateur register — 23 June 2020' },
      { key: 'wdtk-498906', vintage: '2019-04', title: 'FOI 498906 — reciprocal licences' },
    ],
    kinds: [
      { id: 'licence-version-original-start', label: 'licence-version start — the earliest surviving in the asserting vintage' },
      { id: 'licence-cancelled', label: 'licence cancelled' },
    ],
    caveats: [
      { id: 'earliest-surviving', label: 'earliest surviving date, not “the true original”', gloss: 'The earliest start surviving in the asserting vintage.' },
      { id: 'availability-trap', label: 'absence of evidence is non-observation', gloss: 'A quiet year is non-observation.' },
    ],
    histograms: {
      'licence-version-original-start': [['2018', 2], ['2019', 0], ['2020', 5]],
      'licence-cancelled': [['2018', 0], ['2019', 1], ['2020', 0]],
    },
    totals: { 'licence-version-original-start': 7, 'licence-cancelled': 1 },
    buckets: [
      { year: '2018', perKind: { 'licence-version-original-start': 2 }, startsToDate: 2, activeReservations: 0, topSeries: [['M7', 2]], datasetIdxs: [0], caveatIds: ['earliest-surviving', 'availability-trap'] },
      { year: '2019', perKind: { 'licence-cancelled': 1 }, startsToDate: 2, activeReservations: 1, topSeries: [['M7', 2]], datasetIdxs: [1], caveatIds: ['availability-trap'] },
      { year: '2020', perKind: { 'licence-version-original-start': 5 }, startsToDate: 7, activeReservations: 1, topSeries: [['M7', 7]], datasetIdxs: [], caveatIds: ['earliest-surviving', 'availability-trap'] },
    ],
    ...overrides,
  };
}

function renderInto(data: ReturnType<typeof makeData>): HTMLElement {
  const root = document.createElement('div');
  root.id = 'sections';
  document.body.replaceChildren(root);
  renderTimeline(root, data as never);
  return root;
}

describe('v1 timeline — pure helpers', { tags: ['unit'] }, () => {
  it('ParseTimeline_WhenTheManifestIsTheWrongShape_ReturnsNull', () => {
    expect(parseTimeline(null)).toBeNull();
    expect(parseTimeline({ buckets: 'nope' })).toBeNull();
    expect(parseTimeline({ buckets: [], kinds: [], datasets: [] })).toBeNull();
  });

  it('AnchorIndex_WhenAsAtFallsInsideTheSpan_OpensOnThatYear', () => {
    expect(anchorIndex(makeData() as never)).toBe(2); // 2020
  });

  it('AnchorIndex_WhenAsAtRunsPastTheSpan_OpensOnTheLastBucket', () => {
    expect(anchorIndex(makeData({ asAt: '2099-01-01' }) as never)).toBe(2);
  });

  it('AnchorIndex_WhenAsAtPredatesTheSpan_OpensOnTheFirstBucket', () => {
    expect(anchorIndex(makeData({ asAt: '1900-01-01' }) as never)).toBe(0);
  });
});

describe('v1 timeline — histogram + surface render', { tags: ['unit'] }, () => {
  it('Histogram_ForAKind_DrawsOneBarPerYearAndACompleteDataTable', () => {
    const fig = renderHistogram('licence issued', [['2018', 2], ['2019', 0], ['2020', 5]], 7);
    document.body.replaceChildren(fig);
    expect(fig.querySelectorAll('.hx-bar')).toHaveLength(3);
    // The zero year is marked but the data table lists only the non-zero years.
    expect(fig.querySelectorAll('.hx-bar.zero')).toHaveLength(1);
    const rows = [...fig.querySelectorAll('tbody tr')];
    expect(rows).toHaveLength(2);
    expect(norm(fig.querySelector('figcaption')?.textContent)).toContain('7 dated events');
  });

  it('Surface_WhenBucketsFold_RendersTheScrubberChartsAndCumulativeTable', () => {
    const root = renderInto(makeData());
    expect(root.querySelector('#timeline-scrubber input[type=range]')).not.toBeNull();
    expect(root.querySelectorAll('.hx-chart')).toHaveLength(2);
    // The cumulative table carries a row per year (the scrubber's figures without interaction).
    const cumulative = [...root.querySelectorAll('details.hx-data')].pop();
    expect(cumulative?.querySelectorAll('tbody tr')).toHaveLength(3);
    // The folded explainer is present and its caveat bullets are id-addressable.
    expect(root.querySelector('#reading-this-timeline')).not.toBeNull();
    expect(root.querySelector('#reading-this-timeline-earliest-surviving')).not.toBeNull();
  });

  it('Surface_WhenTheCorpusCarriesNoLicensingEvidence_StatesNonObservationNotEmptiness', () => {
    const root = renderInto(makeData({ kinds: [], buckets: [], histograms: {}, totals: {}, caveats: [] }));
    expect(root.querySelector('#timeline-scrubber')).toBeNull();
    expect(root.querySelectorAll('.hx-chart')).toHaveLength(0);
    expect(norm(root.textContent)).toContain('No entries');
  });
});

describe('v1 timeline — scrubber readout', { tags: ['unit'] }, () => {
  it('Scrubber_OnOpen_ReadsTheAsAtBucketWithItsAssertionTimeProvenance', () => {
    const data = makeData();
    const slot = document.createElement('div');
    document.body.replaceChildren(slot);
    const { input, readout } = buildScrubber(slot, data as never);
    expect(input.value).toBe('2'); // opens on 2020, the as-at year
    const text = norm(readout.textContent);
    expect(text).toContain('As at end of 2020');
    expect(text).toContain('surviving licence-start');
    expect(text).toContain('Leading prefix series');
    expect(text).toContain('M7');
  });

  it('Readout_WhenAYearAssertsNoNewEvent_SaysTheFiguresCarryForward', () => {
    const data = makeData();
    const host = document.createElement('div');
    renderReadout(host, data.buckets[2] as never, data as never); // 2020 has empty datasetIdxs
    expect(norm(host.textContent)).toContain('No new dated event is asserted in 2020');
  });

  it('Readout_ForABucket_NamesItsCaveatsLinkedToTheExplainerNeverBare', () => {
    const data = makeData();
    const host = document.createElement('div');
    renderReadout(host, data.buckets[0] as never, data as never);
    const caveatLink = host.querySelector('.tl-caveats a');
    expect(caveatLink?.getAttribute('href')).toBe('#reading-this-timeline');
    expect((caveatLink?.getAttribute('title') ?? '').length).toBeGreaterThan(0);
  });

  it('Scrubber_WhenDraggedToAnEarlierYear_UpdatesTheLinkedReadout', () => {
    const data = makeData();
    const slot = document.createElement('div');
    document.body.replaceChildren(slot);
    const { input, readout } = buildScrubber(slot, data as never);
    input.value = '0';
    input.dispatchEvent(new Event('input'));
    expect(norm(readout.textContent)).toContain('As at end of 2018');
  });
});
