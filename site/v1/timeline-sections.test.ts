// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  COMPONENT,
  renderStatic,
  renderTimeline,
  renderReadout,
  fillReadout,
  renderHistogram,
  parseTimeline,
  anchorIndex,
  encodeReadoutData,
  decodeReadoutData,
  enhance,
} from './timeline-sections.js';
import { V1_COPY } from './copy.js';

// The v1 timeline (issues #932, #965): the event-time histograms, cumulative
// table and year scrubber. Event time leads — each bar counts dated events the
// record states fell in a year — and every figure names the publications and
// vintages that assert it (assertion time).
//
// The bar these tests hold the surface to is the no-JS baseline: with no script
// the served page must state the substance itself, and with script the enhanced
// view must never be able to state a figure the served page would not have.
// Test names follow Subject_Scenario_Outcome and cover the non-happy paths: an
// empty corpus, a wrong-shaped manifest, a corrupt embedded payload, a single
// bucket, a bucket with no caveats, and the anchor rule when as-at sits outside
// the span.

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

/** The page as SERVED: the static render alone, with no enhancement run over it. */
function serveStatic(data: ReturnType<typeof makeData>): HTMLElement {
  const root = document.createElement('div');
  root.id = 'history-host';
  document.body.replaceChildren(root);
  renderTimeline(root, data as never);
  const surface = root.querySelector<HTMLElement>('[data-component]');
  if (surface === null) throw new Error('the static render emitted no component root');
  return surface;
}

/** The same page after its script has run. */
function serveEnhanced(data: ReturnType<typeof makeData>): HTMLElement {
  const surface = serveStatic(data);
  enhance(surface);
  return surface;
}

/** A readout host built the way the static render builds it. */
function readoutHost(data: ReturnType<typeof makeData>, bucketIndex: number): HTMLElement {
  const host = document.createElement('div');
  renderReadout(host, data.buckets[bucketIndex] as never, data as never);
  return host;
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

  it('Explainer_Always_CarriesTheCarriedLicenceHistoryBackgroundWithItsSourcing', () => {
    // Content parity with v0 (src/ci/build-timeline.ts): the carried-licence-
    // history background, with its evidentiary sourcing, must not be silently
    // dropped from the v1 explainer.
    const text = norm(serveStatic(makeData()).querySelector('#reading-this-timeline')?.textContent);
    expect(text).toContain('Licence-View field dictionary');
    expect(text).toContain('FOI');
    expect(text).toContain('October 2018');
    expect(text).toContain('October 2025');
  });

  it('Explainer_Always_NamesTheUnparsedSeriesFormsWithNoSlot', () => {
    const text = norm(serveStatic(makeData()).querySelector('#reading-this-timeline')?.textContent);
    expect(text).toContain('have no slot');
  });

  it('Explainer_Always_CarriesTheFullWorkingSubstanceWithoutLinkingOffSurface', () => {
    const explainer = serveStatic(makeData()).querySelector('#reading-this-timeline');
    expect(norm(explainer?.textContent)).toContain('committed reports');
    expect([...(explainer?.querySelectorAll('a') ?? [])].every((a) => !(a.getAttribute('href') ?? '').startsWith('http'))).toBe(true);
  });

  it('Surface_WhenTheCorpusCarriesNoLicensingEvidence_StatesNonObservationNotEmptiness', () => {
    const surface = serveStatic(makeData({ kinds: [], buckets: [], histograms: {}, totals: {}, caveats: [] }));
    expect(surface.querySelector('#timeline-scrubber')).toBeNull();
    expect(surface.querySelectorAll('.hx-chart')).toHaveLength(0);
    expect(norm(surface.textContent)).toContain('No entries');
  });

  it('Surface_WhenTheCorpusIsEmpty_CarriesNoEmbeddedPayloadToScrub', () => {
    // Unhappy path: nothing to scrub means nothing embedded, and enhancing the
    // empty surface must be a quiet no-op rather than a throw.
    const surface = serveStatic(makeData({ kinds: [], buckets: [], histograms: {}, totals: {}, caveats: [] }));
    expect(surface.getAttribute('data-readout')).toBeNull();
    expect(() => enhance(surface)).not.toThrow();
    expect(surface.querySelector('input[type=range]')).toBeNull();
  });
});

describe('v1 timeline — the no-JS baseline', { tags: ['ui'] }, () => {
  it('Timeline_WhenScriptDoesNotRun_HistogramsAndPerYearFiguresAreStillPresent', () => {
    // The gate: the page AS SERVED, with no enhancement run over it, states the
    // substance — not a shell and not a promise that something will render.
    const surface = serveStatic(makeData());
    expect(surface.querySelectorAll('.hx-chart')).toHaveLength(2);
    expect(surface.querySelectorAll('.hx-bar')).toHaveLength(6);
    // The cumulative table carries a row per year, complete without interaction.
    const cumulative = [...surface.querySelectorAll('details.hx-data')].pop();
    expect(cumulative?.querySelectorAll('tbody tr')).toHaveLength(3);
    const text = norm(surface.textContent);
    expect(text).toContain('As at end of 2020');
    expect(text).toContain('surviving licence-start');
    expect(text).toContain('Leading prefix series');
  });

  it('Timeline_WhenScriptDoesNotRun_MakesNoPromiseThatFiguresAwaitTheScript', () => {
    const text = norm(serveStatic(makeData()).textContent);
    expect(text).toContain('in this page as served');
    expect(text).not.toContain('render when the page’s script runs');
  });

  it('Timeline_WhenScriptDoesNotRun_OffersNoDeadControl', () => {
    // A slider with no script behind it would be a control that does nothing.
    const surface = serveStatic(makeData());
    expect(surface.querySelector('input')).toBeNull();
    expect(surface.querySelector('button')).toBeNull();
  });

  it('Timeline_WhenScriptRuns_AddsTheSliderWithoutMovingTheServedReadout', () => {
    // The popovers gain an idempotence marker when they are wired; nothing else
    // about the served readout may change.
    const unwired = (html: string | undefined): string => (html ?? '').replaceAll(' data-wired="1"', '');
    const servedReadout = unwired(serveStatic(makeData()).querySelector('#tl-readout')?.innerHTML);
    const enhanced = serveEnhanced(makeData());
    expect(enhanced.querySelector('#timeline-scrubber input[type=range]')).not.toBeNull();
    expect(unwired(enhanced.querySelector('#tl-readout')?.innerHTML)).toBe(servedReadout);
  });
});

describe('v1 timeline — embedded readout data', { tags: ['unit'] }, () => {
  it('EmbeddedReadoutData_AfterARoundTrip_CarriesEveryFigureTheReadoutStates', () => {
    const data = makeData();
    const decoded = decodeReadoutData(encodeReadoutData(data as never));
    expect(decoded).not.toBeNull();
    expect(decoded?.asAt).toBe('2020-06-23');
    expect(decoded?.buckets.map((b) => b.year)).toEqual(['2018', '2019', '2020']);
    expect(decoded?.buckets[0]?.perKind).toEqual({ 'licence-version-original-start': 2 });
    expect(decoded?.buckets[0]?.topSeries).toEqual([['M7', 2]]);
    expect(decoded?.buckets[1]?.caveatIds).toEqual(['availability-trap']);
    expect(decoded?.datasets[1]?.title).toBe('FOI 498906 — reciprocal licences');
  });

  it('EmbeddedReadoutData_ComparedWithTheManifestItStandsInFor_IsMateriallySmaller', () => {
    // The index-encoded form is why embedding is affordable at all: it must stay
    // materially smaller than the manifest, or re-fetching would win on size.
    const data = makeData();
    expect(encodeReadoutData(data as never).length).toBeLessThan(JSON.stringify(data).length);
  });

  it('EmbeddedReadoutData_WhenAFigureIsNotANumber_RejectsThePayloadRatherThanReadingItAsZero', () => {
    // A count coerced to zero would state a WRONG FIGURE, and a citation index
    // coerced to zero would name the WRONG PUBLICATION. Both are worse than no
    // scrubber, because the served readout beneath is intact and correct.
    const data = makeData();
    const corrupt = (mutate: (buckets: unknown[][]) => void): string => {
      const decoded = JSON.parse(encodeReadoutData(data as never)) as unknown[];
      mutate(decoded[4] as unknown[][]);
      return JSON.stringify(decoded);
    };
    expect(decodeReadoutData(corrupt((b) => { b[0][1] = 'lots'; })), 'starts-to-date').toBeNull();
    expect(decodeReadoutData(corrupt((b) => { b[0][2] = null; })), 'reservations').toBeNull();
    expect(decodeReadoutData(corrupt((b) => { b[0][5] = ['nope']; })), 'citation index').toBeNull();
    expect(decodeReadoutData(corrupt((b) => { b[0][0] = ''; })), 'year').toBeNull();
  });

  it('EmbeddedReadoutData_WhenACitationIndexNamesNoPublication_DropsItRatherThanGuessing', () => {
    const data = makeData();
    const decoded = JSON.parse(encodeReadoutData(data as never)) as unknown[];
    (decoded[4] as unknown[][])[0][5] = [0, 99];
    const out = decodeReadoutData(JSON.stringify(decoded));
    expect(out?.buckets[0]?.datasetIdxs).toEqual([0]);
  });

  it('EmbeddedReadoutData_WhenTheAttributeIsCorrupt_DegradesToTheStaticReadout', () => {
    // Unhappy path: a truncated or replaced payload must leave the served
    // figures standing rather than throwing or showing a wrong number.
    expect(decodeReadoutData('not json')).toBeNull();
    expect(decodeReadoutData('[]')).toBeNull();
    expect(decodeReadoutData('["2020-06-23",[],[],[],[]]')).toBeNull();
    const surface = serveStatic(makeData());
    const servedReadout = surface.querySelector('#tl-readout')?.innerHTML;
    surface.setAttribute('data-readout', 'not json');
    enhance(surface);
    expect(surface.querySelector('input[type=range]')).toBeNull();
    expect(surface.querySelector('#tl-readout')?.innerHTML).toBe(servedReadout);
  });
});

describe('v1 timeline — scrubber readout', { tags: ['ui'] }, () => {
  it('Scrubber_OnOpen_ReadsTheAsAtBucketWithItsAssertionTimeProvenance', () => {
    const surface = serveEnhanced(makeData());
    const input = surface.querySelector<HTMLInputElement>('input[type=range]');
    expect(input?.value).toBe('2'); // opens on 2020, the as-at year
    const text = norm(surface.querySelector('#tl-readout')?.textContent);
    expect(text).toContain('As at end of 2020');
    expect(text).toContain('surviving licence-start');
    expect(text).toContain('Leading prefix series');
    expect(text).toContain('M7');
  });

  it('Scrubber_WhenDraggedToAnEarlierYear_UpdatesTheLinkedReadoutInPlace', () => {
    const surface = serveEnhanced(makeData());
    const input = surface.querySelector<HTMLInputElement>('input[type=range]');
    const readout = surface.querySelector('#tl-readout');
    if (input === null || readout === null) throw new Error('the enhanced surface carries no scrubber');
    input.value = '0';
    input.dispatchEvent(new Event('input'));
    expect(norm(readout.textContent)).toContain('As at end of 2018');
    // The readout element itself is the one the page was served with — the
    // scrubber refills value nodes rather than replacing the host.
    expect(surface.querySelector('#tl-readout')).toBe(readout);
  });

  it('Scrubber_ForEveryYear_ShowsExactlyWhatTheServedPageWouldHaveShownForThatYear', () => {
    // The property the whole design rests on: an enhanced view cannot state a
    // figure the static view would not. Both go through one fillReadout over one
    // body of data, so this is checked exhaustively rather than sampled.
    const data = makeData();
    const surface = serveEnhanced(data);
    const input = surface.querySelector<HTMLInputElement>('input[type=range]');
    const readout = surface.querySelector('#tl-readout');
    if (input === null || readout === null) throw new Error('the enhanced surface carries no scrubber');
    const decoded = decodeReadoutData(encodeReadoutData(data as never));
    if (decoded === null) throw new Error('the embedded payload did not decode');
    decoded.buckets.forEach((bucket, i) => {
      input.value = String(i);
      input.dispatchEvent(new Event('input'));
      const reference = document.createElement('div');
      renderReadout(reference, bucket, decoded);
      expect(readout.innerHTML, `year ${bucket.year}`).toBe(reference.innerHTML);
    });
  });

  it('Scrubber_ForAccessibility_CarriesTheYearInAriaValuetextAndAnnouncesTheAggregateOnce', () => {
    // WAI-ARIA slider pattern: the bucket INDEX is meaningless spoken alone, so
    // aria-valuetext carries the year. The aggregate announcement is owned by a
    // single status region, never by the value nodes themselves.
    const surface = serveEnhanced(makeData());
    const input = surface.querySelector<HTMLInputElement>('input[type=range]');
    expect(input?.getAttribute('aria-valuetext')).toContain('2020');
    const status = surface.querySelector('.tl-status');
    expect(status?.getAttribute('role')).toBe('status');
    expect(surface.querySelector('#tl-readout')?.getAttribute('aria-live')).toBeNull();
    expect([...surface.querySelectorAll('[data-slot]')].every((n) => n.getAttribute('aria-live') === null)).toBe(true);
  });
});

describe('v1 timeline — readout content', { tags: ['unit'] }, () => {
  it('Readout_WhenAYearAssertsNoNewEvent_SaysTheFiguresCarryForward', () => {
    expect(norm(readoutHost(makeData(), 2).textContent)).toContain('No new dated event is asserted in 2020');
  });

  it('Readout_ForABucket_NamesItsCaveatsLinkedToTheExplainerNeverBare', () => {
    const caveatLink = readoutHost(makeData(), 0).querySelector('.tl-caveats a');
    expect(caveatLink?.getAttribute('href')).toBe('#reading-this-timeline');
    expect((caveatLink?.getAttribute('title') ?? '').length).toBeGreaterThan(0);
  });

  it('Readout_ForABucket_LeadsItsCaveatsWithTheRegistryLabelNotAHardcodedString', () => {
    const caveats = readoutHost(makeData(), 0).querySelector('.tl-caveats');
    expect(norm(caveats?.textContent)).toContain(V1_COPY.history.timeline.readoutCaveats.trim());
  });

  it('Readout_ForABucketWithAnOpenReservationWindow_StatesTheBitemporalTestParenthetically', () => {
    // The bi-temporal reading a reservation-window figure rests on must not be
    // silently dropped from the v1 wording.
    expect(norm(readoutHost(makeData(), 1).textContent)).toContain('stated end on or after then, stating vintage proven by then');
  });

  it('Readout_WhenABucketCarriesNoCaveats_HidesTheSlotReversiblyRatherThanRemovingIt', () => {
    // Unhappy path: a year with nothing to qualify. The slot stays in the DOM so
    // the next year can refill it, and is hidden from assistive technology
    // meanwhile.
    const data = makeData({
      buckets: [{ year: '2018', perKind: {}, startsToDate: 1, activeReservations: 0, topSeries: [], datasetIdxs: [], caveatIds: [] }],
      caveats: [],
    });
    const host = readoutHost(data, 0);
    const caveats = host.querySelector<HTMLElement>('[data-slot="caveats"]');
    expect(caveats).not.toBeNull();
    expect(caveats?.hidden).toBe(true);
    expect(host.querySelector<HTMLElement>('[data-slot="series"]')?.hidden).toBe(true);
    expect(host.querySelector<HTMLElement>('[data-slot="activity"]')?.hidden).toBe(true);
    // …and the slot un-hides again the moment a year has something to say.
    fillReadout(host, makeData().buckets[0] as never, makeData() as never);
    expect(host.querySelector<HTMLElement>('[data-slot="caveats"]')?.hidden).toBe(false);
  });

  it('Timeline_WhenTheCorpusHoldsASingleYear_RendersThatOneBucketWithoutADeadScrubber', () => {
    // Unhappy path: one bucket means the slider has a single position; the
    // figures must still read correctly and the surface must not throw.
    const data = makeData({
      asAt: '2018-06-23',
      histograms: { 'licence-version-original-start': [['2018', 2]], 'licence-cancelled': [['2018', 0]] },
      buckets: [{ year: '2018', perKind: { 'licence-version-original-start': 2 }, startsToDate: 2, activeReservations: 0, topSeries: [['M7', 2]], datasetIdxs: [0], caveatIds: ['earliest-surviving'] }],
    });
    const surface = serveEnhanced(data);
    const input = surface.querySelector<HTMLInputElement>('input[type=range]');
    expect(input?.min).toBe('0');
    expect(input?.max).toBe('0');
    expect(norm(surface.querySelector('#tl-readout')?.textContent)).toContain('As at end of 2018');
  });
});

describe('v1 timeline — component contract', { tags: ['unit'] }, () => {
  it('Timeline_AsAComponent_MarksItsRootForTheEnhanceWalk', () => {
    expect(renderStatic(makeData() as never).getAttribute('data-component')).toBe(COMPONENT);
  });

  it('Timeline_RenderedTwiceFromOneManifest_IsIdenticalMarkup', () => {
    // Determinism: no clock, environment value or random source enters the
    // render, so the build-time HTML is reproducible.
    expect(renderStatic(makeData() as never).outerHTML).toBe(renderStatic(makeData() as never).outerHTML);
  });
});
