// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderReadout, buildScrubber, enhanceTimeline } from './timeline.js';

// The timeline scrubber enhancement (issue #726): an input[type=range] laid over
// the pre-aggregated per-bucket JSON, whose linked readout states the per-instant
// figures (starts to date, active reservation windows, leading series) with their
// asserting vintages and caveats. Built ON TOP of the complete static page. Test
// names follow Subject_Scenario_Outcome.

interface Bucket {
  year: string;
  perKind: Record<string, number>;
  startsToDate: number;
  activeReservations: number;
  topSeries: [string, number][];
  datasetIdxs: number[];
  caveats: string[];
}

function fixtureData(): {
  schemaVersion: number;
  asAt: string;
  kinds: { id: string; label: string; contribution: string }[];
  caveats: { id: string; label: string; gloss: string }[];
  datasets: { lane: string; key: string; vintage: string; title: string; href: string }[];
  buckets: Bucket[];
} {
  return {
    schemaVersion: 1,
    asAt: '2020-05-01',
    kinds: [{ id: 'licence-version-original-start', label: 'licence-version start', contribution: 'licence-start' }],
    caveats: [
      { id: 'earliest-surviving', label: 'earliest surviving date, not “the true original”', gloss: 'issue #800 — earliest surviving only' },
      { id: 'reserved-cohort-ambiguity', label: 'this column carries three cohort meanings', gloss: 'issue #725 — three cohort meanings' },
      { id: 'availability-trap', label: 'absence of evidence is non-observation', gloss: 'non-observation, never “was available”' },
    ],
    datasets: [{ lane: 'foi', key: 'entry-a', vintage: '2020-05-01', title: 'entry-a', href: 'datasets/foi/entry-a/index.html' }],
    buckets: [
      { year: '2018', perKind: { 'licence-version-original-start': 2 }, startsToDate: 2, activeReservations: 0, topSeries: [['M7', 2]], datasetIdxs: [0], caveats: ['earliest-surviving', 'availability-trap'] },
      { year: '2019', perKind: { 'licence-version-original-start': 1 }, startsToDate: 3, activeReservations: 1, topSeries: [['M7', 3]], datasetIdxs: [0], caveats: ['earliest-surviving', 'reserved-cohort-ambiguity', 'availability-trap'] },
      { year: '2020', perKind: {}, startsToDate: 3, activeReservations: 1, topSeries: [['M7', 3]], datasetIdxs: [], caveats: ['earliest-surviving', 'reserved-cohort-ambiguity', 'availability-trap'] },
      // A bucket beyond the proven "as at" (2020-05-01): a future-dated
      // reservation still stretches the event-time span past today.
      { year: '2021', perKind: {}, startsToDate: 3, activeReservations: 1, topSeries: [['M7', 3]], datasetIdxs: [], caveats: ['earliest-surviving', 'reserved-cohort-ambiguity', 'availability-trap'] },
    ],
  };
}

function timelinePage(): Document {
  document.body.innerHTML = `
    <main>
      <div data-page="timeline">
        <div id="timeline-scrubber" data-timeline-src="timeline/data.json"></div>
      </div>
    </main>`;
  return document;
}

describe('timeline readout', { tags: ['ui'] }, () => {
  it('Readout_ForABucket_StatesStartsToDateReservationsSeriesAndGlossedCaveats', () => {
    const host = document.createElement('div');
    renderReadout(host, fixtureData().buckets[1], fixtureData());
    expect(host.textContent).toMatch(/As at end of 2019/);
    expect(host.textContent).toMatch(/3 callsigns have a surviving licence-start/);
    expect(host.textContent).toMatch(/1 reservation window is stated to still be open/);
    // The leading series links to its series page.
    expect(host.querySelector('a[href^="series/"]')?.textContent).toBe('M7');
    // A caveat renders labelled and glossed (never a bare id), linking to the
    // page's own explainer.
    const caveat = host.querySelector('.tl-caveats a');
    expect(caveat?.getAttribute('href')).toBe('#reading-this-timeline');
    expect(caveat?.getAttribute('title')).toBeTruthy();
  });

  it('Readout_YearWithNoNewEvents_NamesTheAssertionGapNotSilence', () => {
    const host = document.createElement('div');
    renderReadout(host, fixtureData().buckets[2], fixtureData());
    // 2020 has no new dated event: the readout says the figures carry forward,
    // rather than silently dropping the assertion-time citation.
    expect(host.textContent).toMatch(/No new dated event is asserted in 2020/);
  });
});

describe('timeline scrubber', { tags: ['ui'] }, () => {
  it('Scrubber_BuiltFromData_OpensOnTheProvenAsAtInstantNotTheLastBucket', () => {
    const slot = document.createElement('div');
    const { input } = buildScrubber(slot, fixtureData());
    expect(input.type).toBe('range');
    // The span reaches 2021 (index 3), but the proven "as at" is 2020 (index 2).
    expect(input.max).toBe('3');
    expect(input.value).toBe('2');
    expect(slot.querySelector('.tl-readout')?.textContent).toMatch(/As at end of 2020/);
  });

  it('Scrubber_DraggedToAnEarlierYear_UpdatesTheReadoutInstantly', () => {
    const slot = document.createElement('div');
    const { input, readout } = buildScrubber(slot, fixtureData());
    input.value = '0';
    input.dispatchEvent(new Event('input'));
    expect(readout.textContent).toMatch(/As at end of 2018/);
    expect(readout.textContent).toMatch(/2 callsigns have a surviving licence-start/);
    // 2018 has no active reservation window yet.
    expect(readout.textContent).toMatch(/0 reservation windows are stated to still be open/);
  });
});

// The fetch/error orchestration for enhanceTimeline. The stubs are non-async
// functions returning a Promise (the shared jsdom idiom), so the global fetch
// the enhancement calls is replaced without an unsafe cast.
type FetchStub = (url: string) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

function okJson(payload: unknown) {
  return { ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(payload)) };
}

function stubFetch(fn: FetchStub) {
  vi.stubGlobal('fetch', fn);
}

describe('timeline enhancement', { tags: ['ui'] }, () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('Enhance_FetchSucceeds_BuildsTheScrubberOverTheData', async () => {
    const doc = timelinePage();
    stubFetch(() => Promise.resolve(okJson(fixtureData())));
    const result = await enhanceTimeline(doc);
    expect(result).toEqual({ buckets: 4 });
    expect(doc.querySelector('#timeline-scrubber input[type=range]')).not.toBeNull();
  });

  it('Enhance_FetchFails_RendersACalmNoteAndDoesNotThrow', async () => {
    const doc = timelinePage();
    stubFetch(() => Promise.resolve({ ok: false, status: 503, text: () => Promise.resolve('') }));
    const result = await enhanceTimeline(doc);
    expect(result).toHaveProperty('error');
    if (result !== null && 'error' in result) expect(result.error).toContain('503');
    const slot = doc.getElementById('timeline-scrubber');
    expect(slot?.textContent).toMatch(/Could not load the timeline data/);
    // The calm note points at the still-complete surfaces; no dead control.
    expect(slot?.querySelector('a[href="on-this-day.html"]')).not.toBeNull();
    expect(slot?.querySelector('input')).toBeNull();
  });

  it('Enhance_FetchRejects_IsCaughtAndReportedNotThrown', async () => {
    const doc = timelinePage();
    stubFetch(() => Promise.reject(new Error('network down')));
    const result = await enhanceTimeline(doc);
    expect(result).toHaveProperty('error');
    if (result !== null && 'error' in result) expect(result.error).toContain('network down');
    expect(doc.getElementById('timeline-scrubber')?.textContent).toMatch(/Could not load/);
  });

  it('Enhance_OnAnUnrelatedPage_DoesNothing', async () => {
    document.body.innerHTML = '<main><div data-page="other"></div></main>';
    expect(await enhanceTimeline(document)).toBeNull();
  });
});
