// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import {
  HOME_SECTION_ORDER,
  HOME_SECTION_REGISTRY,
  renderHomeSections,
  defaultHomeModel,
  spanDialGeometry,
} from './home-sections.js';
import {
  CALLSIGN_SECTION_ORDER,
  CALLSIGN_SECTION_REGISTRY,
  renderCallsignSections,
  buildCallsignModel,
  dialGeometry,
  groupEventsByDay,
  currentStateNode,
  fractionalYear,
  isAgreeingOriginGroup,
  NEAR_DATED_SEPARATION_THRESHOLD_PERCENT,
} from './callsign-sections.js';
import { renderSiteBar, datedFactChipParts } from './shell.js';
import { EVENT_TIME_GLOSS, ASSERTION_TIME_GLOSS } from './copy.js';
// The shared pure data functions, reused by injection (the exact functions the
// deployed v1 orchestrator loads at runtime from the site root). Importing them
// here proves the reuse contract end to end over a fixture shard.
import { latestSummary, seenSummary, anatomyFigureParts, twinConflict } from '../callsign.js';
import { stripModel } from '../callsign-events.js';

// The shared data-shape types, for annotating the fixtures so their compact-array
// literals are checked against the real builder shapes.
type CallsignRecord = import('../callsign.js').CallsignRecord;
type ShardManifest = import('../callsign.js').ShardManifest;
type EventRecord = import('../callsign-events.js').EventRecord;
type EventsMeta = import('../callsign-events.js').EventsMeta;
type CallsignModel = import('./callsign-sections.js').CallsignModel;

// A complete CallsignModel from partial overrides, so a test states only the
// fields it exercises and every required field still has an honest default.
function cm(over: Partial<Omit<CallsignModel, 'dial'>> & { dial?: Partial<CallsignModel['dial']> } = {}): CallsignModel {
  const dialDefaults = { events: [], sightings: [], findings: [], bookkeeping: [], disagreements: [], hasEvents: false, hasBookkeeping: false };
  const { dial, ...rest } = over;
  return {
    key: 'M7TEE', cleaned: 'M7TEE', found: true, viaRendering: false,
    latest: null, seen: null, anatomy: null, twin: null,
    carriedOrigin: 'neutral', series: null, seriesIntro: null,
    ...rest,
    dial: { ...dialDefaults, ...(dial ?? {}) },
  };
}

// Test names follow Subject_Scenario_Outcome. These exercise the config-array
// section registries as a reader meets them, including the non-happy paths: an
// unregistered id fails loudly, a bookkeeping-only record keeps the event/
// bookkeeping distinction, a regional rendering is named, and a twin-row
// conflict is classified but adjudicated nowhere.

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('v1 home sections', { tags: ['ui'] }, () => {
  it('HomeSectionOrder_EveryId_HasARegistryEntryAndViceVersa', () => {
    expect(Object.keys(HOME_SECTION_REGISTRY).sort()).toEqual([...HOME_SECTION_ORDER].sort());
  });

  it('RenderHomeSections_InOrder_MountsOneDataSectionPerEntry', () => {
    const root = document.createElement('div');
    renderHomeSections(root, defaultHomeModel());
    const sections = [...root.querySelectorAll('section[data-section]')];
    expect(sections.map(s => s.getAttribute('data-section'))).toEqual([...HOME_SECTION_ORDER]);
    // The lookup hero carries a working GET form to the callsign page.
    const form = root.querySelector('section[data-section="lookup-hero"] form');
    expect(form?.getAttribute('action')).toBe('callsign.html');
  });

  it('RenderHomeSections_UnregisteredId_ThrowsRatherThanEmitAGap', () => {
    const root = document.createElement('div');
    expect(() => renderHomeSections(root, defaultHomeModel(), ['not-a-section'])).toThrow(/no registered section/);
  });

  it('HomeWaysIn_LinksOnlyToPagesTheSurfaceServes_NeverOffTheSurface', () => {
    const root = document.createElement('div');
    renderHomeSections(root, defaultHomeModel());
    const hrefs = [...root.querySelectorAll('section[data-section="ways-in"] a')].map(a => a.getAttribute('href') ?? '');
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) expect(href).not.toMatch(/v0/);
  });

  it('RenderHomeSections_EveryBodySection_SitsOnALegibilityPanel', () => {
    // The round-3 backing-surface rule: no body content sits bare on the page
    // ground — every rendered section carries a legibility panel (.surface, or
    // the .head/.fold panel components that share the same border+shadow+radius
    // tokens). Only the header/footer bars and the ground itself are uncarded.
    const root = document.createElement('div');
    renderHomeSections(root, defaultHomeModel());
    const sections = [...root.querySelectorAll('section[data-section]')];
    expect(sections.length).toBeGreaterThan(0);
    for (const section of sections) {
      const id = section.getAttribute('data-section');
      expect(
        section.querySelector('.surface, .head, .fold'),
        `home body section "${id}" must render on a legibility panel, not bare on the ground`,
      ).not.toBeNull();
    }
  });

  it('HomeAtAGlance_HappyPath_RendersTheSpanDialFromModelData', () => {
    // The span dial's figures are build-derived from the same home model that
    // feeds the readout row — the count, the held run and the deeper history
    // horizon all appear, and derive (never a view literal).
    const root = document.createElement('div');
    const model = defaultHomeModel();
    renderHomeSections(root, model);
    const dial = root.querySelector('section[data-section="at-a-glance"] .spandial');
    expect(dial).not.toBeNull();
    // Held-run count and endpoints, plus the deeper history horizon, all present.
    const foot = dial?.querySelector('.sd-foot')?.textContent ?? '';
    expect(foot).toContain(String(model.span.count));
    expect(foot).toContain(String(model.span.heldStartYear));
    expect(foot).toContain(String(model.span.latestYear));
    expect(foot).toContain(String(model.span.historyStartYear));
    // A distinct history segment and its scale break are drawn for a real span.
    expect(dial?.querySelector('.sd-seg.history')).not.toBeNull();
    expect(dial?.querySelector('.sd-break')).not.toBeNull();
    // The needle count divisions across the held run derive from the year span.
    const geo = spanDialGeometry(model.span);
    expect(dial?.querySelectorAll('.sd-ticks span').length).toBe(geo.heldDivisions);
  });

  it('HomeAtAGlance_AriaAndTextParity_LabelsTheReadingAndHidesTheScale', () => {
    // Decorative-plus-informative: the dial is role="img" with an aria-label
    // summarising the reading; its scale is hidden from assistive technology;
    // and the same facts remain as text in the readout row above and the dial's
    // own text foot — nothing is conveyed by colour or position alone.
    const root = document.createElement('div');
    const model = defaultHomeModel();
    renderHomeSections(root, model);
    const glance = root.querySelector('section[data-section="at-a-glance"]');
    const dial = glance?.querySelector('.spandial');
    expect(dial?.getAttribute('role')).toBe('img');
    const label = dial?.getAttribute('aria-label') ?? '';
    expect(label).toContain(String(model.span.count));
    expect(label).toContain(String(model.span.latestYear));
    expect(label).toContain(model.span.latestLabel);
    // The scale is hidden from AT; the facts live in the label + text foot.
    expect(dial?.querySelector('.sd-scale')?.getAttribute('aria-hidden')).toBe('true');
    // Text parity: the readout row still carries the figures as text.
    expect(glance?.querySelector('.readout')?.textContent).toContain(String(model.span.count));
    expect(dial?.querySelector('.sd-foot')?.textContent).toContain(String(model.span.count));
  });

  it('HomeAtAGlance_DegenerateSpan_OmitsTheDialButKeepsTheReadout', () => {
    // An empty archive (no publications held) has no reading to draw: the dial
    // is omitted gracefully rather than rendered empty, and the readout row —
    // the text-parity source — still mounts without crashing.
    const root = document.createElement('div');
    const model = defaultHomeModel();
    model.span = { historyStartYear: 1903, heldStartYear: 2013, latestYear: 2026, latestLabel: '23 June 2026', count: 0 };
    model.glance = [{ k: 'publications', v: '0', u: 'none held' }];
    expect(() => renderHomeSections(root, model)).not.toThrow();
    const glance = root.querySelector('section[data-section="at-a-glance"]');
    expect(glance?.querySelector('.spandial')).toBeNull();
    expect(glance?.querySelector('.readout')).not.toBeNull();
  });

  it('HomeAtAGlance_TheReading_IsAlwaysPresentInTheFootText', () => {
    // The in-scale needle label carrying "as of <date>" is hidden at narrow
    // widths, so the reading must also live in the width-independent text foot —
    // otherwise mobile would lose the reading entirely (the text-parity break
    // the review flagged). The foot is DOM-present regardless of viewport.
    const root = document.createElement('div');
    const model = defaultHomeModel();
    renderHomeSections(root, model);
    const foot = root.querySelector('.spandial .sd-foot')?.textContent ?? '';
    expect(foot).toContain(model.span.latestLabel);
  });

  it('HomeAtAGlance_Needle_RendersAtTheCurrentReadingEndOfTheRun', () => {
    // The needle is the current-reading indicator; a wiring regression that
    // detached its position from the geometry would otherwise be invisible.
    const root = document.createElement('div');
    renderHomeSections(root, defaultHomeModel());
    const needle = root.querySelector<HTMLElement>('.spandial .sd-needle');
    expect(needle?.style.left).toBe('100%');
  });
});

// The hand-maintained-duplicate structural-fragility class this repo hunts: the
// static no-JS baseline in index.html carries an independent copy of every home
// figure. This parity guard renders the model and parses the committed static
// markup, asserting the two agree — so a future edit to the centralised figures
// cannot silently split the JS and static renders.
function extractGlanceFigures(scope: ParentNode) {
  const glance = scope.querySelector('section[data-section="at-a-glance"]');
  if (glance === null) throw new Error('at-a-glance section not found');
  const norm = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();
  const cells = [...glance.querySelectorAll('.readout .cell')].map(c => ({
    k: norm(c.querySelector('.k')?.textContent),
    v: norm(c.querySelector('.v')?.textContent),
    u: norm(c.querySelector('.u')?.textContent),
  }));
  const dial = glance.querySelector('.spandial');
  return {
    cells,
    aria: norm(dial?.getAttribute('aria-label')),
    range: norm(dial?.querySelector('.sd-range')?.textContent),
    heldCap: norm(dial?.querySelector('.sd-cap.on')?.textContent),
    years: [...(dial?.querySelectorAll('.sd-yr') ?? [])].map(y => norm(y.textContent)),
    needle: norm(dial?.querySelector('.nlbl')?.textContent),
    ticks: dial?.querySelectorAll('.sd-ticks span').length ?? 0,
    foot: [...(dial?.querySelectorAll('.sd-foot span') ?? [])].map(s => norm(s.textContent)),
  };
}

describe('v1 home static/JS parity', { tags: ['unit'] }, () => {
  it('StaticBaseline_AtAGlanceFigures_MatchTheModelRenderedFigures', () => {
    const jsRoot = document.createElement('div');
    renderHomeSections(jsRoot, defaultHomeModel());
    const staticDoc = new DOMParser().parseFromString(fs.readFileSync('site/v1/index.html', 'utf8'), 'text/html');
    expect(extractGlanceFigures(staticDoc)).toEqual(extractGlanceFigures(jsRoot));
  });

  it('StaticBaseline_DatedFactChip_MatchesTheModelRenderedChip', () => {
    const model = defaultHomeModel();
    const bar = renderSiteBar('home', model.facts);
    const norm = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();
    const jsChip = norm(bar.querySelector('.chip.asof')?.textContent);
    const staticDoc = new DOMParser().parseFromString(fs.readFileSync('site/v1/index.html', 'utf8'), 'text/html');
    const staticChip = norm(staticDoc.querySelector('.chip.asof')?.textContent);
    expect(staticChip).toBe(jsChip);
  });
});

describe('v1 home span-dial geometry (pure)', { tags: ['unit'] }, () => {
  it('SpanDialGeometry_FullSpan_DrawsHistoryBreakAndDerivesHeldDivisions', () => {
    const geo = spanDialGeometry({ historyStartYear: 1903, heldStartYear: 2013, latestYear: 2026, latestLabel: '23 June 2026', count: 65 });
    expect(geo.render).toBe(true);
    expect(geo.showHistory).toBe(true);
    // Held divisions derive from the year span (2013→2026 = 13), never hardcoded.
    expect(geo.heldDivisions).toBe(13);
    expect(geo.needleLeft).toBe(100);
  });

  it('SpanDialGeometry_SingleDateRun_CollapsesWithoutDividingByZero', () => {
    // A held run of a single point (start === latest) and no earlier history:
    // the scale collapses to one cell, the history segment is dropped, and
    // nothing divides by zero.
    const geo = spanDialGeometry({ historyStartYear: 2026, heldStartYear: 2026, latestYear: 2026, latestLabel: '23 June 2026', count: 1 });
    expect(geo.render).toBe(true);
    expect(geo.showHistory).toBe(false);
    expect(geo.heldDivisions).toBe(1);
  });

  it('SpanDialGeometry_EmptyArchive_DoesNotRender', () => {
    // No publications held: nothing to draw. The caller omits the dial; the
    // readout row still carries the figures as text.
    const geo = spanDialGeometry({ historyStartYear: 1903, heldStartYear: 2013, latestYear: 2026, latestLabel: '23 June 2026', count: 0 });
    expect(geo.render).toBe(false);
  });

  it('SpanDialGeometry_HistoryNotBeforeHeldRun_DrawsNoBreak', () => {
    // When the earliest dated material does not predate the held run, there is
    // no gap to break across — the dense run is drawn on its own.
    const geo = spanDialGeometry({ historyStartYear: 2013, heldStartYear: 2013, latestYear: 2026, latestLabel: '23 June 2026', count: 65 });
    expect(geo.render).toBe(true);
    expect(geo.showHistory).toBe(false);
  });

  it('SpanDialGeometry_ReversedHeldRun_ThrowsRatherThanReadAsEmpty', () => {
    // Dated but reversed dates are a corruption, not the legitimate empty-
    // archive state — fail loud rather than collapse to an indistinguishable
    // render:false that would silently read as "nothing held".
    expect(() => spanDialGeometry({ historyStartYear: 1903, heldStartYear: 2026, latestYear: 2013, latestLabel: '23 June 2026', count: 65 }))
      .toThrow(/corrupt span dates/);
  });

  it('SpanDialGeometry_SingleDatePlusEarlierHistory_CollapsesRunButKeepsTheBreak', () => {
    // A single-point held run (start === latest) that STILL reaches back to
    // earlier history: the run collapses to one cell, but the history segment
    // and its scale break are kept, since 1903 genuinely predates the run.
    const geo = spanDialGeometry({ historyStartYear: 1903, heldStartYear: 2026, latestYear: 2026, latestLabel: '23 June 2026', count: 1 });
    expect(geo.render).toBe(true);
    expect(geo.showHistory).toBe(true);
    expect(geo.heldDivisions).toBe(1);
  });
});

describe('v1 callsign sections', { tags: ['ui'] }, () => {
  it('CallsignSectionOrder_EveryId_HasARegistryEntryAndViceVersa', () => {
    expect(Object.keys(CALLSIGN_SECTION_REGISTRY).sort()).toEqual([...CALLSIGN_SECTION_ORDER].sort());
  });

  it('RenderCallsignSections_UnregisteredId_ThrowsRatherThanEmitAGap', () => {
    const root = document.createElement('div');
    expect(() => renderCallsignSections(root, cm({ found: false }), ['not-a-section'])).toThrow(/no registered section/);
  });

  it('RenderCallsignSections_NotFoundModel_RendersTheNoRecordCallout', () => {
    // The whole default order mounts for a miss too; the fast-answer callout
    // states the non-observation without claiming anything about the register.
    const root = document.createElement('div');
    renderCallsignSections(root, cm({ found: false, key: 'ZZ9ZZZ' }));
    expect(root.querySelector('.callout')?.textContent).toContain('No record for ZZ9ZZZ');
  });

  it('RenderCallsignSections_FoundButNoDatedEvidence_ShowsNonObservationInDialAndTimeline', () => {
    // A resolved record with no event-time claim: both the dial and the
    // event-timeline must read the non-observation copy, never "no evidence".
    const root = document.createElement('div');
    renderCallsignSections(root, cm({ found: true }));
    const dial = root.querySelector('section[data-section="the-evidence-dial"]')?.textContent ?? '';
    const timeline = root.querySelector('section[data-section="event-timeline"]')?.textContent ?? '';
    expect(dial).toContain('No dated event-time evidence is held');
    expect(timeline).toContain('No dated event-time evidence is held');
  });

  it('EvidenceDial_WhenMounted_RendersBothBitemporalGlossesVerbatim', () => {
    const root = document.createElement('div');
    const model = cm({
      series: 'M7',
      dial: {
        events: [{ day: '2021-04-16', label: 'licence issued', state: false, assertedBy: [] }],
        sightings: [{ vintage: '2021-06-15' }, { vintage: '2026-06-23' }],
        findings: [{ statement: 'One licence: originated 2021-04-16, still allocated', caveats: ['earliest surviving date, not “the true original”'] }],
        hasEvents: true,
      },
    });
    CALLSIGN_SECTION_REGISTRY['the-evidence-dial'].mount(root, model);
    const text = root.textContent ?? '';
    expect(text).toContain(EVENT_TIME_GLOSS);
    expect(text).toContain(ASSERTION_TIME_GLOSS);
  });

  it('EvidenceDial_WhenSeriesIntroPresent_RendersTheSeriesIntroductionContextMarker', () => {
    const root = document.createElement('div');
    const model = cm({
      series: 'M7', seriesIntro: '2018-10',
      dial: { events: [{ day: '2021-04-16', label: 'licence issued', state: false, assertedBy: [] }], sightings: [{ vintage: '2026-06-23' }], hasEvents: true },
    });
    CALLSIGN_SECTION_REGISTRY['the-evidence-dial'].mount(root, model);
    // Record-scoped, series-level wording: names when the SERIES opened, with
    // the month rendered for readers — never a claim about this record.
    expect(root.querySelector('.dial-context')?.textContent).toContain('M7 series opened October 2018');
  });

  it('EvidenceDial_WhenSeriesIntroAbsent_OmitsTheContextMarker', () => {
    const root = document.createElement('div');
    const model = cm({
      series: 'M7', seriesIntro: null,
      dial: { events: [{ day: '2021-04-16', label: 'licence issued', state: false, assertedBy: [] }], sightings: [{ vintage: '2026-06-23' }], hasEvents: true },
    });
    CALLSIGN_SECTION_REGISTRY['the-evidence-dial'].mount(root, model);
    expect(root.querySelector('.dial-context')).toBeNull();
  });

  it('EvidenceDial_Findings_RenderTheEngineStatementVerbatim', () => {
    const root = document.createElement('div');
    const statement = 'One licence: originated 2021-04-16, still allocated';
    const model = cm({
      series: 'M7',
      dial: { events: [{ day: '2021-04-16', label: 'licence issued', state: false, assertedBy: [] }], findings: [{ statement, caveats: [] }], hasEvents: true },
    });
    CALLSIGN_SECTION_REGISTRY['the-evidence-dial'].mount(root, model);
    expect(root.textContent).toContain(statement);
    // Never a bare rule badge: the statement text is present, not just a tag.
    expect(root.querySelector('.dial-finding')?.textContent).toContain(statement);
  });

  it('EvidenceDial_BookkeepingOnlyRecord_ReadsAsSystemPresenceNotNoEvidence', () => {
    const root = document.createElement('div');
    const model = cm({ dial: { hasEvents: false, hasBookkeeping: true } });
    CALLSIGN_SECTION_REGISTRY['the-evidence-dial'].mount(root, model);
    const text = root.textContent ?? '';
    expect(text).toContain('record-bookkeeping');
    expect(text).not.toContain('No dated event-time evidence is held');
  });

  it('EvidenceDial_CrossVintageDisagreement_ShowsBothCampsAndAdjudicatesNeither', () => {
    const root = document.createElement('div');
    const model = cm({
      dial: {
        hasEvents: true,
        events: [{ day: '2021-02-23', label: 'licence-version start', state: false, assertedBy: [] }],
        disagreements: [{
          kindLabel: 'licence-version start',
          camps: [
            { day: '1977-07-09', datasets: [{ title: 'entry-a register', href: '#', vintage: '2020-05-01' }] },
            { day: '2021-02-23', datasets: [{ title: 'entry-b register', href: '#', vintage: '2021-06-01' }] },
          ],
        }],
      },
    });
    CALLSIGN_SECTION_REGISTRY['the-evidence-dial'].mount(root, model);
    const text = root.querySelector('.dial-disagree')?.textContent ?? '';
    expect(text).toContain('1977-07-09');
    expect(text).toContain('2021-02-23');
    expect(text).toContain('entry-a register');
    expect(text).toContain('entry-b register');
  });

  it('EvidenceDial_HighlightControl_DimsTheOtherClock', () => {
    const root = document.createElement('div');
    const model = cm({
      dial: { events: [{ day: '2021-04-16', label: 'issued', state: false, assertedBy: [] }], sightings: [{ vintage: '2026-06-23' }], hasEvents: true },
    });
    CALLSIGN_SECTION_REGISTRY['the-evidence-dial'].mount(root, model);
    const buttons = [...root.querySelectorAll('.dial-ctl button')];
    expect(buttons).toHaveLength(3);
    const scale = root.querySelector('.scale');
    (buttons[1] as HTMLButtonElement).click(); // Event only
    expect(scale?.classList.contains('dim-assert')).toBe(true);
    (buttons[2] as HTMLButtonElement).click(); // Assertion only
    expect(scale?.classList.contains('dim-event')).toBe(true);
  });

  it('EvidenceDial_WhenMultipleEventsShareADay_RendersACentredStackNamingEachEventNotACount', () => {
    // The M7TEE case: three events all dated 2018-10-18 must not overprint at an
    // identical x. Behaviour change (issue #921): the rejected "3 events · date"
    // count teaser is replaced by a centred vertical stack — every event named
    // on its own row in record order, the shared day shown once, nothing to
    // hunt for.
    const root = document.createElement('div');
    const model = cm({
      dial: {
        hasEvents: true,
        events: [
          { day: '2018-10-18', label: 'licence issued', state: false, assertedBy: [] },
          { day: '2018-10-18', label: 'licence-version start', state: false, assertedBy: [] },
          { day: '2018-10-18', label: 'callsign first recorded', state: false, assertedBy: [] },
        ],
        sightings: [{ vintage: '2026-06-23' }],
      },
    });
    CALLSIGN_SECTION_REGISTRY['the-evidence-dial'].mount(root, model);
    const eventMarkers = [...root.querySelectorAll('.scale .ev:not(.state)')];
    expect(eventMarkers).toHaveLength(1);
    // Each event is named on its own stack row, in record order.
    const rows = [...eventMarkers[0].querySelectorAll('.vstack .r')].map((r) => r.textContent);
    expect(rows).toEqual(['licence issued', 'licence-version start', 'callsign first recorded']);
    // The shared day is shown once, and there is no count teaser.
    expect(eventMarkers[0].querySelector('.vstack .d')?.textContent).toBe('2018-10-18');
    expect(eventMarkers[0].textContent ?? '').not.toContain('3 events');
    // No plain single-line caption is emitted when the day stacks.
    expect(eventMarkers[0].querySelector('.cap')).toBeNull();
  });

  it('EvidenceDial_WhenFourEventsShareADay_RendersAllFourStackRows', () => {
    // Tall stacks are accepted (the observed visible maximum is four).
    const root = document.createElement('div');
    const model = cm({
      dial: {
        hasEvents: true,
        events: [
          { day: '2019-06-05', label: 'licence issued', state: false, assertedBy: [] },
          { day: '2019-06-05', label: 'licence original start', state: false, assertedBy: [] },
          { day: '2019-06-05', label: 'licence-version start', state: false, assertedBy: [] },
          { day: '2019-06-05', label: 'record created', state: false, assertedBy: [] },
        ],
        sightings: [{ vintage: '2026-06-23' }],
      },
    });
    CALLSIGN_SECTION_REGISTRY['the-evidence-dial'].mount(root, model);
    const rows = [...root.querySelectorAll('.scale .ev:not(.state) .vstack .r')].map((r) => r.textContent);
    expect(rows).toHaveLength(4);
  });

  it('EvidenceDial_WhenSingleEventOnADay_RendersTheEventLabelNotAClusterCount', () => {
    const root = document.createElement('div');
    const model = cm({
      dial: { hasEvents: true, events: [{ day: '2021-04-16', label: 'licence issued — foundation', state: false, assertedBy: [] }], sightings: [{ vintage: '2026-06-23' }] },
    });
    CALLSIGN_SECTION_REGISTRY['the-evidence-dial'].mount(root, model);
    const eventMarkers = [...root.querySelectorAll('.scale .ev:not(.state)')];
    expect(eventMarkers).toHaveLength(1);
    const cap = eventMarkers[0].querySelector('.cap')?.textContent ?? '';
    expect(cap).toContain('licence issued');
    expect(cap).not.toContain('1 events');
  });

  it('EvidenceDial_WhenRecordHasCurrentStatus_EmitsStateNode', () => {
    const root = document.createElement('div');
    const model = cm({
      latest: { statuses: ['Allocated'], products: [], types: [], dataset: { title: 't', vintage: '2026-06-23', href: '#' } },
      dial: { hasEvents: true, events: [{ day: '2018-10-18', label: 'licence issued', state: false, assertedBy: [] }], sightings: [{ vintage: '2026-06-23' }] },
    });
    CALLSIGN_SECTION_REGISTRY['the-evidence-dial'].mount(root, model);
    const stateMarker = root.querySelector('.scale .ev.state');
    expect(stateMarker).not.toBeNull();
    const cap = stateMarker?.querySelector('.cap')?.textContent ?? '';
    expect(cap).toContain('Allocated');
    expect(cap).toContain('current state');
  });

  it('EvidenceDial_WhenRecordHasNoStatus_OmitsTheStateNode', () => {
    // A resolved record whose latest snapshot carries no status: no terminus,
    // and no crash.
    const root = document.createElement('div');
    const model = cm({
      latest: null,
      dial: { hasEvents: true, events: [{ day: '2018-10-18', label: 'licence issued', state: false, assertedBy: [] }], sightings: [{ vintage: '2026-06-23' }] },
    });
    CALLSIGN_SECTION_REGISTRY['the-evidence-dial'].mount(root, model);
    expect(root.querySelector('.scale .ev.state')).toBeNull();
  });

  it('EventTimeline_WhenMultipleEventsShareADay_GroupsThemUnderOneDatedNode', () => {
    const root = document.createElement('div');
    const model = cm({
      dial: {
        hasEvents: true,
        events: [
          { day: '2018-10-18', label: 'licence issued', state: false, assertedBy: [] },
          { day: '2018-10-18', label: 'licence-version start', state: false, assertedBy: [] },
          { day: '2018-10-18', label: 'callsign first recorded', state: false, assertedBy: [] },
        ],
      },
    });
    CALLSIGN_SECTION_REGISTRY['event-timeline'].mount(root, model);
    const dayNodes = [...root.querySelectorAll('.timeline .tl:not(.state)')];
    expect(dayNodes).toHaveLength(1);
    expect(dayNodes[0].querySelector('.when')?.textContent).toContain('2018-10-18');
    const titles = [...dayNodes[0].querySelectorAll('.ttl')].map((t) => t.textContent);
    expect(titles).toEqual(['licence issued', 'licence-version start', 'callsign first recorded']);
  });

  it('EventTimeline_WhenRecordHasCurrentStatus_EmitsAStateTerminusNode', () => {
    const root = document.createElement('div');
    const model = cm({
      latest: { statuses: ['Allocated'], products: [], types: [], dataset: { title: 't', vintage: '2026-06-23', href: '#' } },
      dial: { hasEvents: true, events: [{ day: '2018-10-18', label: 'licence issued', state: false, assertedBy: [] }], sightings: [{ vintage: '2026-06-23' }] },
    });
    CALLSIGN_SECTION_REGISTRY['event-timeline'].mount(root, model);
    const stateNode = root.querySelector('.timeline .tl.state');
    expect(stateNode).not.toBeNull();
    expect(stateNode?.querySelector('.ttl')?.textContent).toContain('Allocated');
    expect(stateNode?.textContent).toContain('current state');
  });

  it('EventTimeline_WhenRecordHasNoStatus_OmitsTheStateTerminus', () => {
    const root = document.createElement('div');
    const model = cm({
      latest: null,
      dial: { hasEvents: true, events: [{ day: '2018-10-18', label: 'licence issued', state: false, assertedBy: [] }] },
    });
    CALLSIGN_SECTION_REGISTRY['event-timeline'].mount(root, model);
    expect(root.querySelector('.timeline .tl.state')).toBeNull();
  });

  it('EventTimeline_WhenBookkeepingOnlyRecordHasStatus_StillEmitsTheStateTerminus', () => {
    // A record with a held status but no parsed licensing events (only
    // bookkeeping stamps) must still close the rail with the terminus — the dial
    // shows it, so the rail cannot omit it.
    const root = document.createElement('div');
    const model = cm({
      latest: { statuses: ['Allocated'], products: [], types: [], dataset: { title: 'Ofcom register snapshot', vintage: '2026-06-23', href: '#' } },
      dial: {
        hasEvents: false, hasBookkeeping: true,
        bookkeeping: [{ day: '2019-01-01', label: 'record created', assertedBy: [] }],
        sightings: [{ vintage: '2026-06-23' }],
      },
    });
    CALLSIGN_SECTION_REGISTRY['event-timeline'].mount(root, model);
    const stateNode = root.querySelector('.timeline .tl.state');
    expect(stateNode).not.toBeNull();
    expect(stateNode?.querySelector('.ttl')?.textContent).toContain('Allocated');
  });

  it('EventTimeline_WhenSightingsOnlyRecordHasStatus_EmitsTerminusWithoutContradictingTheEventCopy', () => {
    // A sightings-only record with a held status: the non-observation copy still
    // holds (no event evidence), and the terminus renders beside it as a STATE
    // node — never as an event row — so the sibling sections cannot contradict.
    const root = document.createElement('div');
    const model = cm({
      latest: { statuses: ['Allocated'], products: [], types: [], dataset: { title: 'Ofcom register snapshot', vintage: '2026-06-23', href: '#' } },
      dial: { hasEvents: false, hasBookkeeping: false, sightings: [{ vintage: '2026-06-23' }] },
    });
    CALLSIGN_SECTION_REGISTRY['event-timeline'].mount(root, model);
    const surface = root.querySelector('section[data-section]') ?? root;
    // The non-observation copy is present (it speaks to event evidence).
    expect(root.textContent).toContain('No dated event-time evidence is held');
    // The terminus is present, anchored to the newest sighting.
    const stateNode = root.querySelector('.timeline .tl.state');
    expect(stateNode).not.toBeNull();
    expect(stateNode?.querySelector('.when')?.textContent).toContain('2026-06-23');
    // No event row masquerades on the rail — the terminus is the only .tl.
    expect(surface.querySelectorAll('.tl:not(.state)')).toHaveLength(0);
  });

  it('EventTimeline_StateTerminus_CarriesItsAssertionProvenanceFold', () => {
    // The terminus is a rail node like any other: its asserting publication must
    // be expandable, exactly as licensing events and bookkeeping lines are.
    const root = document.createElement('div');
    const model = cm({
      latest: { statuses: ['Allocated'], products: [], types: [], dataset: { title: 'Ofcom register snapshot', vintage: '2026-06-23', href: '#' } },
      dial: { hasEvents: true, events: [{ day: '2018-10-18', label: 'licence issued', state: false, assertedBy: [] }], sightings: [{ vintage: '2026-06-23' }] },
    });
    CALLSIGN_SECTION_REGISTRY['event-timeline'].mount(root, model);
    const fold = root.querySelector('.tl.state .evt-assert');
    expect(fold).not.toBeNull();
    expect(fold?.querySelector('summary')?.textContent).toContain('asserted by 1 publication');
    expect(fold?.textContent).toContain('Ofcom register snapshot');
  });

  it('EvidenceDial_StateTerminus_CarriesAssertionProvenanceInItsTitle', () => {
    // The dial marker cannot host a disclosure fold, so its provenance rides the
    // title (the rail terminus carries the expandable fold).
    const root = document.createElement('div');
    const model = cm({
      latest: { statuses: ['Allocated'], products: [], types: [], dataset: { title: 'Ofcom register snapshot', vintage: '2026-06-23', href: '#' } },
      dial: { hasEvents: true, events: [{ day: '2018-10-18', label: 'licence issued', state: false, assertedBy: [] }], sightings: [{ vintage: '2026-06-23' }] },
    });
    CALLSIGN_SECTION_REGISTRY['the-evidence-dial'].mount(root, model);
    const title = root.querySelector('.scale .ev.state')?.getAttribute('title') ?? '';
    expect(title).toContain('Ofcom register snapshot');
  });

  it('EventTimeline_EachEvent_CarriesItsAssertionTimeProvenanceExpandable', () => {
    const root = document.createElement('div');
    const model = cm({
      dial: {
        hasEvents: true,
        events: [{ day: '2021-04-16', label: 'licence issued', state: false, assertedBy: [{ title: 'Ofcom register snapshot', href: '#', vintage: '2026-06-23', nrows: 1 }] }],
      },
    });
    CALLSIGN_SECTION_REGISTRY['event-timeline'].mount(root, model);
    const fold = root.querySelector('.evt-assert');
    expect(fold?.querySelector('summary')?.textContent).toContain('asserted by 1 publication');
    expect(fold?.textContent).toContain('Ofcom register snapshot');
  });

  it('EventTimeline_WhenMultipleEventsShareADay_DistinguishesThemWithinOneCard', () => {
    // The day-group is one dated card (issue #921): its events sit in one .track
    // as distinct .evt lines, each keeping its own provenance fold — never split
    // into separate dated nodes.
    const root = document.createElement('div');
    const model = cm({
      dial: {
        hasEvents: true,
        events: [
          { day: '2018-10-18', label: 'licence issued', kindId: 'licence-issued', state: false, assertedBy: [{ title: 'Ofcom register snapshot', href: '#', vintage: '2026-06-23', nrows: 1 }] },
          { day: '2018-10-18', label: 'licence cancelled', kindId: 'licence-cancelled', state: false, assertedBy: [{ title: 'Ofcom register snapshot', href: '#', vintage: '2026-06-23', nrows: 1 }] },
        ],
      },
    });
    CALLSIGN_SECTION_REGISTRY['event-timeline'].mount(root, model);
    const dayNodes = [...root.querySelectorAll('.timeline .tl:not(.state)')];
    expect(dayNodes).toHaveLength(1);
    const events = [...dayNodes[0].querySelectorAll('.track .evt')];
    expect(events).toHaveLength(2);
    // Each distinguished event carries its own provenance fold.
    expect(events[0].querySelector('.evt-assert')).not.toBeNull();
    expect(events[1].querySelector('.evt-assert')).not.toBeNull();
  });

  it('EventTimeline_WhenOriginTripleCoincides_RendersTheLicenceOriginSemanticRow', () => {
    // The 87.6k agreeing-origin case: issued + original-start + version-start all
    // on one day, no held vintage disagreeing. The rail tells the coalesced
    // "Licence origin = issuance" story with the three constituents beneath, each
    // still provenance-folded, in record-scoped no-verdict wording.
    const root = document.createElement('div');
    const asserted = [{ title: 'Ofcom register snapshot', href: '#', vintage: '2026-06-23', nrows: 1 }];
    const model = cm({
      dial: {
        hasEvents: true,
        events: [
          { day: '2018-10-18', label: 'licence issued', kindId: 'licence-issued', state: false, assertedBy: asserted },
          { day: '2018-10-18', label: 'licence original start — the earliest surviving in the asserting vintage', kindId: 'licence-original-start', state: false, assertedBy: asserted },
          { day: '2018-10-18', label: 'licence-version start — the earliest surviving in the asserting vintage', kindId: 'licence-version-original-start', state: false, assertedBy: asserted },
        ],
      },
    });
    CALLSIGN_SECTION_REGISTRY['event-timeline'].mount(root, model);
    const originRow = root.querySelector('.timeline .tl.origin');
    expect(originRow).not.toBeNull();
    expect(originRow?.querySelector('.ttl')?.textContent).toContain('Licence origin');
    expect(originRow?.querySelector('.eqmark')?.textContent).toContain('= issuance');
    // Record-scoped coincidence wording, no verdict words.
    expect(originRow?.textContent).toContain('coincide');
    expect(originRow?.textContent ?? '').not.toContain('this is one event');
    // The three constituents are each present with their own provenance fold.
    expect(originRow?.querySelectorAll('.evt')).toHaveLength(3);
    expect(originRow?.querySelectorAll('.evt .evt-assert')).toHaveLength(3);
  });

  it('EventTimeline_WhenOriginKindsDisagreeAcrossVintages_FallsBackToTheDistinctGroupedRows', () => {
    // G8NNZ-shape divergence: the origin kinds land together in the latest
    // vintage but a held vintage disagrees about the version start. The semantic
    // row must not coalesce it; the plain grouped card renders instead, and the
    // disagreement surfaces remain intact on the dial.
    const root = document.createElement('div');
    const disagreements = [{
      kindLabel: 'licence-version start — the earliest surviving in the asserting vintage',
      camps: [
        { day: '1991-07-26', datasets: [{ title: 'earlier vintage', href: '#', vintage: '2020-05-01' }] },
        { day: '2018-10-18', datasets: [{ title: 'later vintage', href: '#', vintage: '2026-06-23' }] },
      ],
    }];
    const dial = {
      hasEvents: true,
      events: [
        { day: '2018-10-18', label: 'licence issued', kindId: 'licence-issued', state: false, assertedBy: [] },
        { day: '2018-10-18', label: 'licence original start — the earliest surviving in the asserting vintage', kindId: 'licence-original-start', state: false, assertedBy: [] },
        { day: '2018-10-18', label: 'licence-version start — the earliest surviving in the asserting vintage', kindId: 'licence-version-original-start', state: false, assertedBy: [] },
      ],
      disagreements,
    };
    // Rail: no semantic row, a plain grouped card with distinct rows instead.
    CALLSIGN_SECTION_REGISTRY['event-timeline'].mount(root, cm({ dial }));
    expect(root.querySelector('.timeline .tl.origin')).toBeNull();
    const grouped = root.querySelector('.timeline .tl:not(.state)');
    expect(grouped?.querySelectorAll('.track .evt')).toHaveLength(3);
    // Dial: the disagreement surfaces remain intact (both camps kept, #467).
    const dialRoot = document.createElement('div');
    CALLSIGN_SECTION_REGISTRY['the-evidence-dial'].mount(dialRoot, cm({ dial }));
    const disagree = dialRoot.querySelector('.dial-disagree')?.textContent ?? '';
    expect(disagree).toContain('1991-07-26');
    expect(disagree).toContain('earlier vintage');
  });

  it('FastAnswer_ViaRenderingResolution_NamesTheCoreRecordAndAbsentSeriesUsesTheMarker', () => {
    const root = document.createElement('div');
    const model = cm({ key: 'M7TEE', cleaned: 'MW7TEE', viaRendering: true, series: null, latest: { statuses: [], products: [], types: [], dataset: { title: 't', vintage: null, href: '#' } } });
    CALLSIGN_SECTION_REGISTRY['fast-answer'].mount(root, model);
    // The regional-rendering note names both the typed form and the core record.
    expect(root.textContent).toContain('MW7TEE');
    expect(root.textContent).toContain('M7TEE');
    // A blank product and an absent series are humanised, never a bare em dash.
    expect(root.textContent).toContain('no product recorded');
    expect(root.querySelector('.absent')?.getAttribute('aria-label')).toBe('not recorded');
  });

  it('RecordFidelity_TwinRowConflict_IsClassifiedButAdjudicatesNothing', () => {
    const root = document.createElement('div');
    const model = cm({
      twin: {
        label: 'The written forms differ in format and status',
        snapshotVintage: '2026-06-23',
        normalitySplit: true,
        variants: [{ raw: 'M7TEE', normal: true, status: 'Allocated', modified: '2026-01-01' }, { raw: 'MW7TEE', normal: false, status: 'Revoked', modified: '2025-01-01' }],
        recency: { kind: 'ordered', newestRaw: 'M7TEE', newestModified: '2026-01-01' },
      },
    });
    CALLSIGN_SECTION_REGISTRY['record-fidelity'].mount(root, model);
    const text = root.querySelector('.fid-note')?.textContent ?? '';
    expect(text).toContain('The written forms differ in format and status');
    expect(text).toContain('M7TEE');
    expect(text).toContain('MW7TEE');
    // Recency is shown as recency, never as a ruling.
    expect(text).toContain('recency, not a ruling');
  });

  it('Extras_CarriedOriginNeutral_ShowsTheNeutralExplainerNotADeclarativeClaim', () => {
    const rootFresh = document.createElement('div');
    CALLSIGN_SECTION_REGISTRY.extras.mount(rootFresh, cm({ carriedOrigin: 'fresh' }));
    expect(rootFresh.textContent).toContain('consistent with a fresh issuance');

    const rootNeutral = document.createElement('div');
    CALLSIGN_SECTION_REGISTRY.extras.mount(rootNeutral, cm({ carriedOrigin: 'neutral' }));
    expect(rootNeutral.textContent).toContain('the series introduction month is not recorded');
    expect(rootNeutral.textContent).not.toContain('consistent with a fresh issuance');
  });
});

describe('v1 dial geometry (pure)', { tags: ['unit'] }, () => {
  it('FractionalYear_MonthAndDay_MoveTheValueWithinTheYear', () => {
    expect(fractionalYear('2020')).toBe(2020);
    expect(fractionalYear('2020-07')).toBeCloseTo(2020.5, 1);
    expect(fractionalYear('bad')).toBeNaN();
  });

  it('GroupEventsByDay_WhenEventsShareADay_CollapseIntoOneGroupPreservingOrder', () => {
    const groups = groupEventsByDay([
      { day: '2018-10-18', label: 'a' },
      { day: '2018-10-18', label: 'b' },
      { day: '2021-04-16', label: 'c' },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].day).toBe('2018-10-18');
    expect(groups[0].events.map((e) => e.label)).toEqual(['a', 'b']);
    expect(groups[1].events.map((e) => e.label)).toEqual(['c']);
  });

  it('GroupEventsByDay_WhenAllDaysDistinct_KeepsOneGroupPerEvent', () => {
    const groups = groupEventsByDay([
      { day: '2018-10-18', label: 'a' },
      { day: '2021-04-16', label: 'b' },
    ]);
    expect(groups).toHaveLength(2);
  });

  it('DialGeometry_WhenEventsShareADay_EmitsOneClusterMarkerForThatDay', () => {
    const geo = dialGeometry(
      [
        { day: '2018-10-18', label: 'a', state: false, assertedBy: [] },
        { day: '2018-10-18', label: 'b', state: false, assertedBy: [] },
      ],
      [{ vintage: '2026-06-23' }],
    );
    expect(geo.events).toHaveLength(1);
    expect(geo.events[0].count).toBe(2);
    expect(geo.events[0].labels).toEqual(['a', 'b']);
  });

  it('DialGeometry_WhenCurrentStatePassed_PositionsAStateNodeWithinTheAxis', () => {
    const geo = dialGeometry(
      [{ day: '2018-10-18', label: 'a', state: false, assertedBy: [] }],
      [{ vintage: '2026-06-23' }],
      { label: 'Allocated — current state', day: '2026-06-23' },
    );
    expect(geo.state).not.toBeNull();
    expect(geo.state?.left).toBeGreaterThanOrEqual(0);
    expect(geo.state?.left).toBeLessThanOrEqual(100);
    expect(geo.state?.label).toContain('Allocated');
  });

  it('DialGeometry_WhenNoCurrentStatePassed_EmitsNoStateNode', () => {
    const geo = dialGeometry(
      [{ day: '2018-10-18', label: 'a', state: false, assertedBy: [] }],
      [{ vintage: '2026-06-23' }],
    );
    expect(geo.state).toBeNull();
  });

  it('CurrentStateNode_WhenNewestEventPostdatesNewestSighting_AnchorsToTheNewestSighting', () => {
    // The terminus is an assertion-anchored claim — "as of the newest publication
    // that asserts it" — so a later event day must not drag it past the sightings.
    const model = cm({
      latest: { statuses: ['Allocated'], products: [], types: [], dataset: { title: 'Ofcom register snapshot', vintage: '2026-06-23', href: '#' } },
      dial: {
        events: [{ day: '2027-05-01', label: 'future-dated event', state: false, assertedBy: [] }],
        sightings: [{ vintage: '2026-06-23' }],
      },
    });
    const node = currentStateNode(model);
    expect(node?.day).toBe('2026-06-23');
    expect(node?.assertedBy[0].title).toBe('Ofcom register snapshot');
  });

  it('DialGeometry_MarkerPositions_StayWithinTheAxis', () => {
    const geo = dialGeometry(
      [{ day: '2018-10-01', label: 'series', state: false, assertedBy: [] }, { day: '2021-04-16', label: 'origin', state: false, assertedBy: [] }],
      [{ vintage: '2021-06-15' }, { vintage: '2026-06-23' }],
    );
    for (const e of geo.events) expect(e.left).toBeGreaterThanOrEqual(0);
    for (const e of geo.events) expect(e.left).toBeLessThanOrEqual(100);
    for (const s of geo.sightings) expect(s.left).toBeGreaterThanOrEqual(0);
    for (const s of geo.sightings) expect(s.left).toBeLessThanOrEqual(100);
    expect(geo.years.length).toBeGreaterThan(0);
    expect(geo.minYear).toBeLessThanOrEqual(2018);
    expect(geo.maxYear).toBeGreaterThanOrEqual(2026);
  });

  it('DialGeometry_WhenAdjacentMarkersNearerThanACaptionWidth_TakeSteppedSeparationTiers', () => {
    // The near-dated tail (issue #921): two distinct calendar days one day apart
    // on a decades-wide axis sit far closer than a caption width, so the later
    // marker steps up a separation tier while the earlier stays flat. The x
    // positions stay true — only the caption height disambiguates.
    const geo = dialGeometry(
      [
        { day: '2001-06-01', label: 'licence issued', state: false, assertedBy: [] },
        { day: '2001-06-02', label: 'licence-version start', state: false, assertedBy: [] },
      ],
      [{ vintage: '2026-06-23' }],
    );
    expect(geo.events).toHaveLength(2);
    const gap = Math.abs(geo.events[0].left - geo.events[1].left);
    expect(gap).toBeLessThan(NEAR_DATED_SEPARATION_THRESHOLD_PERCENT);
    expect(geo.events.map((e) => e.tier).sort()).toEqual([0, 1]);
  });

  it('DialGeometry_WhenMarkersAreWellSeparated_AllStayAtTierZero', () => {
    // Events years apart on a modest axis clear the caption-width threshold, so
    // no separation is applied — the common multi-event case stays flat.
    const geo = dialGeometry(
      [
        { day: '2016-01-01', label: 'licence issued', state: false, assertedBy: [] },
        { day: '2024-01-01', label: 'licence cancelled', state: false, assertedBy: [] },
      ],
      [{ vintage: '2026-06-23' }],
    );
    const gap = Math.abs(geo.events[0].left - geo.events[1].left);
    expect(gap).toBeGreaterThanOrEqual(NEAR_DATED_SEPARATION_THRESHOLD_PERCENT);
    expect(geo.events.every((e) => e.tier === 0)).toBe(true);
  });
});

describe('v1 agreeing-origin semantic row (pure)', { tags: ['unit'] }, () => {
  const originTriple = [
    { day: '2018-10-18', label: 'licence issued', kindId: 'licence-issued', state: false, assertedBy: [] },
    { day: '2018-10-18', label: 'licence original start — the earliest surviving in the asserting vintage', kindId: 'licence-original-start', state: false, assertedBy: [] },
    { day: '2018-10-18', label: 'licence-version start — the earliest surviving in the asserting vintage', kindId: 'licence-version-original-start', state: false, assertedBy: [] },
  ];

  it('IsAgreeingOriginGroup_WhenTheOriginTripleCoincidesWithNoDisagreement_IsTrue', () => {
    const groups = groupEventsByDay(originTriple);
    expect(isAgreeingOriginGroup(groups[0], groups, [])).toBe(true);
  });

  it('IsAgreeingOriginGroup_WhenAnOriginKindLandsOnADifferentDay_FallsBackToFalse', () => {
    // G8NNZ-shape divergence by spread date: the version start is stated on a
    // different day, so the three origin dates do not coincide.
    const spread = [
      { day: '2018-10-18', label: 'licence issued', kindId: 'licence-issued', state: false, assertedBy: [] },
      { day: '2018-10-18', label: 'licence original start', kindId: 'licence-original-start', state: false, assertedBy: [] },
      { day: '1991-07-26', label: 'licence-version start', kindId: 'licence-version-original-start', state: false, assertedBy: [] },
    ];
    const groups = groupEventsByDay(spread);
    const originDay = groups.find((g) => g.day === '2018-10-18');
    expect(originDay).toBeDefined();
    expect(isAgreeingOriginGroup(originDay!, groups, [])).toBe(false);
  });

  it('IsAgreeingOriginGroup_WhenAHeldVintageDisagreesAboutAnOriginKind_FallsBackToFalse', () => {
    // G8NNZ-shape divergence by disagreement: the dates land together in the
    // latest vintage, but a held vintage disagrees about the version start, so
    // the coincidence is not clean and the semantic row must not coalesce it.
    const groups = groupEventsByDay(originTriple);
    const disagreements = [{
      kindLabel: 'licence-version start — the earliest surviving in the asserting vintage',
      camps: [
        { day: '1991-07-26', datasets: [{ title: 'earlier vintage', href: '#', vintage: '2020-05-01' }] },
        { day: '2018-10-18', datasets: [{ title: 'later vintage', href: '#', vintage: '2026-06-23' }] },
      ],
    }];
    expect(isAgreeingOriginGroup(groups[0], groups, disagreements)).toBe(false);
  });

  it('IsAgreeingOriginGroup_WhenAKindIsMissing_IsFalse', () => {
    const pair = [
      { day: '2018-10-18', label: 'licence issued', kindId: 'licence-issued', state: false, assertedBy: [] },
      { day: '2018-10-18', label: 'licence original start', kindId: 'licence-original-start', state: false, assertedBy: [] },
    ];
    const groups = groupEventsByDay(pair);
    expect(isAgreeingOriginGroup(groups[0], groups, [])).toBe(false);
  });
});

describe('v1 dated-fact chip (pure)', { tags: ['unit'] }, () => {
  it('DatedFactChipParts_WhenCountAlsoAppearsInTheDate_SplitsOnThePlaceholderNotTheValue', () => {
    // "23 June 2026" with 23 publications held: splitting the rendered string on
    // the count would break the chip; splitting the template on {count} cannot.
    const parts = datedFactChipParts({ date: '23 June 2026', count: 23 });
    expect(parts.before).toBe('Record as of 23 June 2026 · ');
    expect(parts.count).toBe('23');
    expect(parts.after).toBe(' publications held');
  });

  it('RenderSiteBar_DatedFactChip_BoldsTheCountAndIsNotALink', () => {
    const bar = renderSiteBar('home', { date: '23 June 2026', count: 23 });
    const chip = bar.querySelector('.chip.asof');
    expect(chip?.tagName).toBe('SPAN'); // a stated fact, not a link off the surface
    expect(chip?.querySelector('b')?.textContent).toBe('23');
    expect(chip?.textContent).toBe('Record as of 23 June 2026 · 23 publications held');
  });
});

describe('v1 callsign model (reusing the shared pure functions)', { tags: ['ui'] }, () => {
  // A minimal instant-shard manifest + record and event meta + record, in the
  // builders' shapes, so buildCallsignModel runs the real shared functions.
  const manifest: ShardManifest = {
    schemaVersion: 1,
    counts: { datasets: 1, callsigns: 1, shards: 1, unkeyableRows: 0 },
    legend: { statuses: { A: 'Allocated', R: 'Revoked' }, markers: {} },
    vocab: { product: ['Amateur Foundation Radio Licence'], type: [], impliedClass: [] },
    shards: ['M7'],
    datasets: [{ key: '2026-06-23', lane: 'open-data', entry: '2026-06-23', file: null, vintage: '2026-06-23', title: 'Ofcom register snapshot', classes: ['register-snapshot'], href: 'datasets/open-data/2026-06-23/index.html', rows: 1, unkeyable: 0, intendedComplete: true, scopeNotes: '', coverageNote: '' }],
  };
  const record: CallsignRecord = { h: 'A', l: { d: 0, s: ['A'], p: [0], t: [] }, a: { pre: 'M7', sfx: 'TEE' }, d: { o: '2021-04-16' } };
  const eventMeta: EventsMeta = {
    schemaVersion: 1,
    asAt: '2026-06-23',
    counts: { datasets: 1, subjects: 1, shards: 1, unkeyableEventClaims: 0 },
    datasets: [{ lane: 'opendata', key: '2026-06-23', vintage: '2026-06-23', title: 'Ofcom register snapshot', href: 'datasets/open-data/2026-06-23/index.html' }],
    kinds: [{ id: 'licence-version-original-start', label: 'licence-version start', contribution: 'earliest-surviving-start' }],
    rules: [{ id: 'still-allocated', gloss: 'a gloss' }],
    caveats: [{ id: 'earliest-surviving', label: 'earliest surviving date, not “the true original”', gloss: 'a caveat gloss' }],
    episodes: [],
    seriesIntro: { M7: '2018-10' },
    shards: ['M7'],
  };
  const eventRecord: EventRecord = { e: [[0, '2021-04-16', [[0, 1]]]], f: [[0, 'One licence: originated 2021-04-16, still allocated', [0], [0]]] };

  it('BuildCallsignModel_ResolvedRecord_ProjectsLatestSeenAnatomyFindingsAndFreshOrigin', () => {
    const model = buildCallsignModel({
      res: { key: 'M7TEE', record, cleaned: 'M7TEE', typed: 'M7TEE', viaRendering: false },
      manifest, eventRecord, eventMeta,
      latestSummary, seenSummary, anatomyFigureParts, twinConflict, stripModel,
    });
    expect(model.found).toBe(true);
    expect(model.key).toBe('M7TEE');
    expect(model.latest?.statuses).toContain('Allocated');
    expect(model.seen?.present).toBe(1);
    expect(model.anatomy?.length).toBeGreaterThan(0);
    expect(model.dial.sightings).toEqual([{ vintage: '2026-06-23' }]);
    // The finding statement is carried verbatim from the event shard.
    expect(model.dial.findings[0].statement).toBe('One licence: originated 2021-04-16, still allocated');
    // Each event carries its assertion-time provenance.
    expect(model.dial.events[0].assertedBy[0].title).toBe('Ofcom register snapshot');
    // The series-introduction month is resolved from meta.json's seriesIntro map.
    expect(model.series).toBe('M7');
    expect(model.seriesIntro).toBe('2018-10');
    // Origin (2021-04) post-dates the series (2018-10): a fresh-issuance reading.
    expect(model.carriedOrigin).toBe('fresh');
  });

  it('BuildCallsignModel_OriginPredatingTheSeries_ReadsAsCarried', () => {
    const carriedRecord: CallsignRecord = { ...record, d: { o: '2015-01-01' } };
    const model = buildCallsignModel({
      res: { key: 'M7TEE', record: carriedRecord, cleaned: 'M7TEE', typed: 'M7TEE', viaRendering: false },
      manifest, eventRecord, eventMeta,
      latestSummary, seenSummary, anatomyFigureParts, twinConflict, stripModel,
    });
    expect(model.carriedOrigin).toBe('carried');
  });

  it('BuildCallsignModel_NoSeriesIntroRecorded_ReadsAsNeutral', () => {
    const noIntroMeta: EventsMeta = { ...eventMeta, seriesIntro: {} };
    const model = buildCallsignModel({
      res: { key: 'M7TEE', record, cleaned: 'M7TEE', typed: 'M7TEE', viaRendering: false },
      manifest, eventRecord, eventMeta: noIntroMeta,
      latestSummary, seenSummary, anatomyFigureParts, twinConflict, stripModel,
    });
    expect(model.seriesIntro).toBeNull();
    expect(model.carriedOrigin).toBe('neutral');
  });

  it('BuildCallsignModel_TwinRowConflict_IsClassifiedFromTheInjectedSharedFunction', () => {
    const twinRecord: CallsignRecord = {
      h: 'A', l: { d: 0, s: ['A'] }, a: { pre: 'M7', sfx: 'TEE' },
      tw: [{ r: 'M7TEE', s: 'A', m: '2026-01-01' }, { r: 'MW7TEE', s: 'R', m: '2025-01-01' }],
    };
    const model = buildCallsignModel({
      res: { key: 'M7TEE', record: twinRecord, cleaned: 'M7TEE', typed: 'M7TEE', viaRendering: false },
      manifest, eventRecord: null, eventMeta: null,
      latestSummary, seenSummary, anatomyFigureParts, twinConflict, stripModel,
    });
    expect(model.twin).not.toBeNull();
    expect(model.twin?.normalitySplit).toBe(true);
    expect(model.twin?.recency.kind).toBe('ordered');
  });

  it('BuildCallsignModel_ViaRenderingResolution_CarriesTheFlagAndTypedForm', () => {
    const model = buildCallsignModel({
      res: { key: 'M7TEE', record, cleaned: 'MW7TEE', typed: 'MW7TEE', viaRendering: true },
      manifest, eventRecord: null, eventMeta: null,
      latestSummary, seenSummary, anatomyFigureParts, twinConflict, stripModel,
    });
    expect(model.viaRendering).toBe(true);
    expect(model.cleaned).toBe('MW7TEE');
  });

  it('BuildCallsignModel_UnresolvedRecord_ReportsNotFound', () => {
    const model = buildCallsignModel({
      res: { key: null, record: null, cleaned: 'ZZ9ZZZ', typed: 'zz9zzz', viaRendering: false },
      manifest, eventRecord: null, eventMeta: null,
      latestSummary, seenSummary, anatomyFigureParts, twinConflict, stripModel,
    });
    expect(model.found).toBe(false);
    expect(model.key).toBe('ZZ9ZZZ');
    expect(model.carriedOrigin).toBe('neutral');
  });
});
