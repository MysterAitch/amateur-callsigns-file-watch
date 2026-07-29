// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  COMPONENT,
  renderStatic,
  renderOnThisDay,
  enhance,
  enhanceToday,
  renderedEntriesOnDay,
  parseOnThisDay,
  dayHeading,
  dayAnchor,
  todayMonthDay,
} from './on-this-day-sections.js';
import { V1_COPY } from './copy.js';

// The v1 on-this-day calendar (issues #932, #965): the event-time calendar of
// dated licensing callouts, stamped into the served HTML at build time, with
// the viewer's "today" signpost layered on top. Event time leads; each entry's
// assertion-time provenance rides one affordance beneath.
//
// The bar these tests hold the surface to is the no-JS baseline: with no script
// the served page must carry the dated entries themselves. Test names follow
// Subject_Scenario_Outcome and cover the non-happy paths: an empty calendar, a
// wrong-shaped manifest, entries with no caveats, a dataset index with no row,
// and a day with no held entry.

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

/** The page as SERVED: the static render alone, with no enhancement run over it. */
function serveStatic(data: ReturnType<typeof makeData>): HTMLElement {
  const root = document.createElement('div');
  root.id = 'history-host';
  document.body.replaceChildren(root);
  renderOnThisDay(root, data as never);
  const surface = root.querySelector<HTMLElement>('[data-component]');
  if (surface === null) throw new Error('the static render emitted no component root');
  return surface;
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

describe('v1 on-this-day — the no-JS baseline', { tags: ['ui'] }, () => {
  it('OnThisDayCalendar_WhenScriptDoesNotRun_DatedEntriesAreStillPresent', () => {
    // The gate: the page AS SERVED, with no enhancement run over it, carries the
    // dated entries themselves — not a shell and not a promise.
    const surface = serveStatic(makeData());
    expect(surface.querySelectorAll('.evt')).toHaveLength(2);
    const text = norm(surface.textContent);
    expect(text).toContain('M7ABC');
    expect(text).toContain('18 October');
    expect(text).toContain('16 April');
  });

  it('OnThisDayCalendar_WhenScriptDoesNotRun_MakesNoPromiseThatEntriesAwaitTheScript', () => {
    const text = norm(serveStatic(makeData()).textContent);
    expect(text).toContain('in this page as served');
    expect(text).not.toContain('renders when the page’s script runs');
  });

  it('OnThisDayCalendar_WhenScriptDoesNotRun_LeavesTheTodaySlotEmptyRatherThanGuessingTheReadersDay', () => {
    // "Today" is the READER's day, so the build must not bake one in.
    const slot = serveStatic(makeData()).querySelector('#today-slot');
    expect(slot).not.toBeNull();
    expect(norm(slot?.textContent)).toBe('');
  });
});

describe('v1 on-this-day — calendar render', { tags: ['unit'] }, () => {
  it('Calendar_WhenEntriesFold_GroupsByCalendarDayWithStableAnchors', () => {
    const surface = serveStatic(makeData());
    // Two months, each with a dated rail row carrying its stable day anchor.
    expect(surface.querySelector('#d-10-18')).not.toBeNull();
    expect(surface.querySelector('#d-04-16')).not.toBeNull();
    // April sorts before October in the calendar.
    const months = [...surface.querySelectorAll('.otd-month')].map(m => norm(m.textContent));
    expect(months).toEqual(['April', 'October']);
  });

  it('Entry_ForADatedEvent_LeadsWithEventTimeAndFoldsItsAssertionProvenanceBeneath', () => {
    const oct = serveStatic(makeData()).querySelector('#d-10-18')?.closest('.tl');
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
    const carried = serveStatic(makeData()).querySelector('#d-04-16')?.closest('.tl')?.querySelector('.hx-carried');
    expect(carried).not.toBeNull();
    expect(norm(carried?.textContent)).toContain('carried licence history');
    expect(norm(carried?.textContent)).toContain('October 2018');
  });

  it('Caveats_ForAnEntry_LinkToTheFoldedExplainerAndCarryTheirGlossAsATitle', () => {
    const surface = serveStatic(makeData());
    expect(surface.querySelector('#reading-these-dates')).not.toBeNull();
    const caveatLink = surface.querySelector('.hx-caveats a');
    expect(caveatLink?.getAttribute('href')).toBe('#reading-these-dates');
    expect((caveatLink?.getAttribute('title') ?? '').length).toBeGreaterThan(0);
    // The explainer's bullet ids match the caveat ids, so the links resolve.
    expect(surface.querySelector('#reading-these-dates-earliest-surviving')).not.toBeNull();
  });

  it('Caveats_ForAnEntry_LeadWithTheRegistryLabelNotAHardcodedString', () => {
    const caveats = serveStatic(makeData()).querySelector('.hx-caveats');
    expect(norm(caveats?.textContent)).toContain(V1_COPY.history.timeline.readoutCaveats.trim());
  });

  it('Entry_WhenItCarriesNoCaveats_RendersTheEntryWithNoCaveatLineAtAll', () => {
    // Unhappy path: an entry the fold qualifies with nothing must not render an
    // empty "Caveats:" lead.
    const data = makeData({
      entries: [{ monthDay: '02-01', year: '2020', day: '2020-02-01', series: 'M7', event: 'first-start', callsigns: ['M7QQQ'], kindLabels: [], datasetIdxs: [0], caveatIds: [], seriesIntroduced: '', predatesSeriesIntroduction: false }],
      count: 1, days: 1, caveats: [],
    });
    const surface = serveStatic(data);
    expect(surface.querySelectorAll('.evt')).toHaveLength(1);
    expect(surface.querySelector('.hx-caveats')).toBeNull();
  });

  it('Explainer_Always_CarriesTheCarriedLicenceHistoryBackgroundWithItsSourcing', () => {
    // Content parity with v0 (src/ci/build-on-this-day.ts): the carried-licence-
    // history background bullet, with its evidentiary sourcing, must not be
    // silently dropped from the v1 explainer.
    const text = norm(serveStatic(makeData()).querySelector('#reading-these-dates')?.textContent);
    expect(text).toContain('Licence-View field dictionary');
    expect(text).toContain('FOI');
    expect(text).toContain('October 2018');
    expect(text).toContain('October 2025');
  });

  it('Explainer_Always_NamesTheUnparsedSeriesFormsWithNoSlot', () => {
    const text = norm(serveStatic(makeData()).querySelector('#reading-these-dates')?.textContent);
    expect(text).toContain('have no slot here');
  });

  it('Explainer_Always_CarriesTheFullWorkingSubstanceWithoutLinkingOffSurface', () => {
    // The v0 explainer linked out to the committed reports; those are not a v1
    // surface, so the substance is carried inline and the explainer links only
    // to itself (issue #921 self-containment).
    const explainer = serveStatic(makeData()).querySelector('#reading-these-dates');
    const text = norm(explainer?.textContent);
    expect(text).toContain('committed reports');
    expect([...(explainer?.querySelectorAll('a') ?? [])].every((a) => !(a.getAttribute('href') ?? '').startsWith('http'))).toBe(true);
  });

  it('Calendar_WhenNoEntriesFold_RendersAnHonestEmptyStateNotAFabricatedDay', () => {
    const surface = serveStatic(makeData({ entries: [], count: 0, days: 0, caveats: [] }));
    expect(surface.querySelector('.otd-calendar')).toBeNull();
    expect(norm(surface.textContent)).toContain('No entries');
  });

  it('Entry_WhenADatasetIndexHasNoRow_DegradesToNoFoldRatherThanThrowing', () => {
    // A missing manifest row must render honestly (no fold), never crash.
    const data = makeData({
      entries: [{ monthDay: '02-01', year: '2020', day: '2020-02-01', series: 'M7', event: 'first-cancellation', callsigns: ['M7QQQ'], kindLabels: ['licence cancelled'], datasetIdxs: [99], caveatIds: [], seriesIntroduced: '', predatesSeriesIntroduction: false }],
      count: 1, days: 1,
    });
    const row = serveStatic(data).querySelector('#d-02-01')?.closest('.tl');
    expect(row).not.toBeNull();
    expect(row?.querySelector('.evt-assert')).toBeNull();
    expect(norm(row?.textContent)).toContain('earliest held cancellation evidence');
  });
});

describe('v1 on-this-day — today signpost', { tags: ['ui'] }, () => {
  it('Today_WhenTheHeldRecordCarriesEntries_SurfacesACalloutLinkingToTheDay', () => {
    const surface = serveStatic(makeData());
    const decided = enhanceToday(surface, new Date(2024, 9, 18)); // 18 October
    expect(decided).toEqual({ monthDay: '10-18', found: true, entries: 1 });
    const slot = surface.querySelector('#today-slot');
    expect(norm(slot?.textContent)).toContain('Today is 18 October');
    expect(slot?.querySelector('a')?.getAttribute('href')).toBe('#d-10-18');
  });

  it('Today_WhenNoEntryFallsOnIt_StatesNonObservationNotThatNothingHappened', () => {
    const surface = serveStatic(makeData());
    const decided = enhanceToday(surface, new Date(2024, 6, 1)); // 1 July — no entry
    expect(decided).toEqual({ monthDay: '07-01', found: false, entries: 0 });
    const slot = surface.querySelector('#today-slot');
    expect(norm(slot?.textContent)).toContain('non-observation');
    expect(slot?.querySelector('a')).toBeNull();
  });

  it('Today_ForItsCount_ReadsTheRenderedCalendarNotASecondCopyOfTheData', () => {
    // The property the design rests on: the signpost counts the entries
    // STANDING ON THE PAGE, so it cannot state a figure the served page does
    // not show. Removing an entry from the DOM moves the count with it.
    const surface = serveStatic(makeData({
      entries: [
        { monthDay: '10-18', year: '2018', day: '2018-10-18', series: 'M7', event: 'first-start', callsigns: ['M7ABC'], kindLabels: [], datasetIdxs: [0], caveatIds: [], seriesIntroduced: '', predatesSeriesIntroduction: false },
        { monthDay: '10-18', year: '2019', day: '2019-10-18', series: 'M0', event: 'first-start', callsigns: ['M0ABC'], kindLabels: [], datasetIdxs: [0], caveatIds: [], seriesIntroduced: '', predatesSeriesIntroduction: false },
      ],
      count: 2, days: 1,
    }));
    expect(renderedEntriesOnDay(surface, '10-18')).toBe(2);
    surface.querySelector('.evt')?.remove();
    expect(renderedEntriesOnDay(surface, '10-18')).toBe(1);
    expect(enhanceToday(surface, new Date(2024, 9, 18))?.entries).toBe(1);
  });

  it('Enhance_OverTheServedCalendar_AddsTheSignpostWithoutDisturbingTheEntries', () => {
    // Enhancement is additive: the signpost appears and the entries read exactly
    // as they were served (the popovers gain an idempotence marker and nothing
    // else — no re-render, no re-worded claim).
    const surface = serveStatic(makeData());
    const calendar = surface.querySelector('.otd-calendar');
    const textBefore = norm(calendar?.textContent);
    const countBefore = surface.querySelectorAll('.evt').length;
    enhance(surface);
    expect(surface.querySelector('.otd-today-note')).not.toBeNull();
    expect(surface.querySelector('.otd-calendar')).toBe(calendar);
    expect(norm(calendar?.textContent)).toBe(textBefore);
    expect(surface.querySelectorAll('.evt')).toHaveLength(countBefore);
  });
});

describe('v1 on-this-day — component contract', { tags: ['unit'] }, () => {
  it('OnThisDay_AsAComponent_MarksItsRootForTheEnhanceWalk', () => {
    expect(renderStatic(makeData() as never).getAttribute('data-component')).toBe(COMPONENT);
  });

  it('OnThisDay_RenderedTwiceFromOneManifest_IsIdenticalMarkup', () => {
    // Determinism: no clock, environment value or random source enters the
    // render, so the build-time HTML is reproducible.
    expect(renderStatic(makeData() as never).outerHTML).toBe(renderStatic(makeData() as never).outerHTML);
  });
});
