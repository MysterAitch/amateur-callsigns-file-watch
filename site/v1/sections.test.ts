// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  HOME_SECTION_ORDER,
  HOME_SECTION_REGISTRY,
  renderHomeSections,
  defaultHomeModel,
} from './home-sections.js';
import {
  CALLSIGN_SECTION_ORDER,
  CALLSIGN_SECTION_REGISTRY,
  renderCallsignSections,
  buildCallsignModel,
  dialGeometry,
  fractionalYear,
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
});

describe('v1 callsign sections', { tags: ['ui'] }, () => {
  it('CallsignSectionOrder_EveryId_HasARegistryEntryAndViceVersa', () => {
    expect(Object.keys(CALLSIGN_SECTION_REGISTRY).sort()).toEqual([...CALLSIGN_SECTION_ORDER].sort());
  });

  it('RenderCallsignSections_UnregisteredId_ThrowsRatherThanEmitAGap', () => {
    const root = document.createElement('div');
    expect(() => renderCallsignSections(root, cm({ found: false }), ['not-a-section'])).toThrow(/no registered section/);
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
