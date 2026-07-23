// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  renderOnThisDay,
  enhanceToday,
  parseOnThisDay,
  dayHeading,
  dayAnchor,
  todayMonthDay,
} from './on-this-day-sections.js';

// The v1 on-this-day calendar (issue #932): the event-time calendar of dated
// licensing callouts, rendered from the root-served manifest, with the viewer's
// "today" signpost layered on top. Event time leads; each entry's assertion-time
// provenance rides one affordance beneath. Test names follow
// Subject_Scenario_Outcome and cover the non-happy paths: an empty calendar
// renders honestly, a wrong-shaped manifest is rejected, a dataset index with no
// row degrades rather than throwing, and a day with no held entry states
// non-observation.

const norm = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();

function makeData(overrides = {}) {
  return {
    schemaVersion: 1,
    asAt: '2024-06-23',
    datasets: [
      { key: 'ofcom-2024-06-23', vintage: '2024-06-23', title: 'Amateur register — 23 June 2024' },
      { key: 'wdtk-498906', vintage: '2018-10', title: 'FOI 498906 — reciprocal licences' },
    ],
    caveats: [
      { id: 'earliest-surviving', label: 'earliest surviving date, not “the true original”', gloss: 'A version-scoped start date is the earliest start surviving in the asserting vintage.' },
      { id: 'availability-trap', label: 'absence of evidence is non-observation', gloss: 'A day with no entry means the held sources attest nothing for it.' },
    ],
    entries: [
      { monthDay: '10-18', year: '2018', day: '2018-10-18', series: 'M7', event: 'first-start', callsigns: ['M7ABC', 'M7XYZ'], kindLabels: ['licence-version start — the earliest surviving in the asserting vintage'], datasetIdxs: [0], caveatIds: ['earliest-surviving', 'availability-trap'], seriesIntroduced: '2018-10', predatesSeriesIntroduction: false },
      { monthDay: '04-16', year: '1991', day: '1991-04-16', series: 'M0', event: 'first-start', callsigns: ['M0ZZZ'], kindLabels: ['licence original start — the earliest surviving in the asserting vintage'], datasetIdxs: [1], caveatIds: ['earliest-surviving'], seriesIntroduced: '2018-10', predatesSeriesIntroduction: true },
    ],
    count: 2,
    days: 2,
    ...overrides,
  };
}

function renderInto(data: ReturnType<typeof makeData>): HTMLElement {
  const root = document.createElement('div');
  root.id = 'sections';
  document.body.replaceChildren(root);
  renderOnThisDay(root, data as never);
  return root;
}

describe('v1 on-this-day — pure helpers', { tags: ['unit'] }, () => {
  it('DayHeading_FromAMonthDay_ReadsAsAHumanDate', () => {
    expect(dayHeading('01-15')).toBe('15 January');
    expect(dayHeading('10-18')).toBe('18 October');
  });

  it('DayAnchor_FromAMonthDay_IsTheStableCalendarAnchor', () => {
    expect(dayAnchor('10-18')).toBe('d-10-18');
  });

  it('TodayMonthDay_FromADate_IsZeroPaddedLocalMonthDay', () => {
    expect(todayMonthDay(new Date(2024, 0, 5))).toBe('01-05');
  });

  it('ParseOnThisDay_WhenTheManifestIsTheWrongShape_ReturnsNull', () => {
    expect(parseOnThisDay(null)).toBeNull();
    expect(parseOnThisDay(42)).toBeNull();
    expect(parseOnThisDay({ entries: 'nope' })).toBeNull();
  });

  it('ParseOnThisDay_WhenTheManifestIsWellShaped_ReturnsIt', () => {
    const data = makeData();
    expect(parseOnThisDay(data)).not.toBeNull();
  });
});

describe('v1 on-this-day — calendar render', { tags: ['unit'] }, () => {
  it('Calendar_WhenEntriesFold_GroupsByCalendarDayWithStableAnchors', () => {
    const root = renderInto(makeData());
    // Two months, each with a dated rail row carrying its stable day anchor.
    expect(root.querySelector('#d-10-18')).not.toBeNull();
    expect(root.querySelector('#d-04-16')).not.toBeNull();
    // April sorts before October in the calendar.
    const months = [...root.querySelectorAll('.otd-month')].map(m => norm(m.textContent));
    expect(months).toEqual(['April', 'October']);
  });

  it('Entry_ForADatedEvent_LeadsWithEventTimeAndFoldsItsAssertionProvenanceBeneath', () => {
    const root = renderInto(makeData());
    const oct = root.querySelector('#d-10-18')?.closest('.tl');
    expect(oct).not.toBeNull();
    const text = norm(oct?.textContent);
    expect(text).toContain('earliest held start evidence');
    expect(text).toContain('M7ABC');
    expect(text).toContain('2 callsigns tie on this day');
    // The assertion-time fold names the publication and its vintage.
    const fold = oct?.querySelector('.evt-assert');
    expect(fold).not.toBeNull();
    expect(norm(fold?.textContent)).toContain('Amateur register — 23 June 2024');
    expect(norm(fold?.textContent)).toContain('vintage');
  });

  it('Entry_WhenTheStartPredatesTheSeries_NamesCarriedLicenceHistoryNotIssuance', () => {
    const root = renderInto(makeData());
    const apr = root.querySelector('#d-04-16')?.closest('.tl');
    const carried = apr?.querySelector('.hx-carried');
    expect(carried).not.toBeNull();
    expect(norm(carried?.textContent)).toContain('carried licence history');
    expect(norm(carried?.textContent)).toContain('October 2018');
  });

  it('Caveats_ForAnEntry_LinkToTheFoldedExplainerAndCarryTheirGlossAsATitle', () => {
    const root = renderInto(makeData());
    const explainer = root.querySelector('#reading-these-dates');
    expect(explainer).not.toBeNull();
    const caveatLink = root.querySelector('.hx-caveats a');
    expect(caveatLink?.getAttribute('href')).toBe('#reading-these-dates');
    expect((caveatLink?.getAttribute('title') ?? '').length).toBeGreaterThan(0);
    // The explainer's bullet ids match the caveat ids, so the links resolve.
    expect(root.querySelector('#reading-these-dates-earliest-surviving')).not.toBeNull();
  });

  it('Calendar_WhenNoEntriesFold_RendersAnHonestEmptyStateNotAFabricatedDay', () => {
    const root = renderInto(makeData({ entries: [], count: 0, days: 0, caveats: [] }));
    expect(root.querySelector('.otd-calendar')).toBeNull();
    expect(norm(root.textContent)).toContain('No entries');
  });

  it('Entry_WhenADatasetIndexHasNoRow_DegradesToNoFoldRatherThanThrowing', () => {
    // A missing manifest row must render honestly (no fold), never crash.
    const data = makeData({
      entries: [{ monthDay: '02-01', year: '2020', day: '2020-02-01', series: 'M7', event: 'first-cancellation', callsigns: ['M7QQQ'], kindLabels: ['licence cancelled'], datasetIdxs: [99], caveatIds: [], seriesIntroduced: '', predatesSeriesIntroduction: false }],
      count: 1, days: 1,
    });
    const root = renderInto(data);
    const row = root.querySelector('#d-02-01')?.closest('.tl');
    expect(row).not.toBeNull();
    expect(row?.querySelector('.evt-assert')).toBeNull();
    expect(norm(row?.textContent)).toContain('earliest held cancellation evidence');
  });
});

describe('v1 on-this-day — today signpost', { tags: ['unit'] }, () => {
  it('Today_WhenTheHeldRecordCarriesEntries_SurfacesACalloutLinkingToTheDay', () => {
    const data = makeData();
    renderInto(data);
    const decided = enhanceToday(document, data as never, new Date(2024, 9, 18)); // 18 October
    expect(decided).toEqual({ monthDay: '10-18', found: true, entries: 1 });
    const slot = document.getElementById('today-slot');
    expect(norm(slot?.textContent)).toContain('Today is 18 October');
    expect(slot?.querySelector('a')?.getAttribute('href')).toBe('#d-10-18');
  });

  it('Today_WhenNoEntryFallsOnIt_StatesNonObservationNotThatNothingHappened', () => {
    const data = makeData();
    renderInto(data);
    const decided = enhanceToday(document, data as never, new Date(2024, 6, 1)); // 1 July — no entry
    expect(decided).toEqual({ monthDay: '07-01', found: false, entries: 0 });
    const slot = document.getElementById('today-slot');
    expect(norm(slot?.textContent)).toContain('non-observation');
    expect(slot?.querySelector('a')).toBeNull();
  });
});
