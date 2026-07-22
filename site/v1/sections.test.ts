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
import { EVENT_TIME_GLOSS, ASSERTION_TIME_GLOSS } from './copy.js';
// The v0 pure data functions, reused by injection (the exact functions the
// deployed v1 orchestrator loads at runtime from /v0/). Importing them here
// proves the reuse contract end to end over a fixture shard.
import { latestSummary, seenSummary, anatomyFigureParts } from '../callsign.js';
import { stripModel } from '../callsign-events.js';

// The v0 data-shape types, for annotating the fixtures so their compact-array
// literals are checked against the real builder shapes.
type CallsignRecord = import('../callsign.js').CallsignRecord;
type ShardManifest = import('../callsign.js').ShardManifest;
type EventRecord = import('../callsign-events.js').EventRecord;
type EventsMeta = import('../callsign-events.js').EventsMeta;

// Test names follow Subject_Scenario_Outcome. These exercise the config-array
// section registries as a reader meets them: the home and callsign sections
// mount in order, an unregistered id fails loudly rather than leaving a gap,
// and the signature dial renders the bitemporal glosses and the engine's
// findings verbatim.

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
});

describe('v1 callsign sections', { tags: ['ui'] }, () => {
  it('CallsignSectionOrder_EveryId_HasARegistryEntryAndViceVersa', () => {
    expect(Object.keys(CALLSIGN_SECTION_REGISTRY).sort()).toEqual([...CALLSIGN_SECTION_ORDER].sort());
  });

  it('RenderCallsignSections_UnregisteredId_ThrowsRatherThanEmitAGap', () => {
    const root = document.createElement('div');
    const model = { key: 'M7TEE', found: false, latest: null, seen: null, anatomy: null, dial: { events: [], sightings: [], findings: [], hasEvents: false }, series: null };
    expect(() => renderCallsignSections(root, model, ['not-a-section'])).toThrow(/no registered section/);
  });

  it('EvidenceDial_WhenMounted_RendersBothBitemporalGlossesVerbatim', () => {
    const root = document.createElement('div');
    const model = {
      key: 'M7TEE',
      found: true,
      latest: { statuses: ['Allocated'], products: ['Amateur Foundation Radio Licence'], types: [], dataset: { title: 'Ofcom register snapshot', vintage: '2026-06-23', href: '#' } },
      seen: { first: { vintage: '2021-06-15' }, last: { vintage: '2026-06-23' }, present: 7, registerPresent: 7 },
      anatomy: [{ chars: 'M', name: 'Prefix', meaning: 'The UK country block.' }],
      dial: {
        events: [{ day: '2021-04-16', label: 'licence issued', state: false }],
        sightings: [{ vintage: '2021-06-15' }, { vintage: '2026-06-23' }],
        findings: [{ statement: 'One licence: originated 2021-04-16, still allocated', caveats: ['earliest surviving date, not “the true original”'] }],
        hasEvents: true,
      },
      series: 'M7',
    };
    CALLSIGN_SECTION_REGISTRY['the-evidence-dial'].mount(root, model);
    const text = root.textContent ?? '';
    expect(text).toContain(EVENT_TIME_GLOSS);
    expect(text).toContain(ASSERTION_TIME_GLOSS);
  });

  it('EvidenceDial_Findings_RenderTheEngineStatementVerbatim', () => {
    const root = document.createElement('div');
    const statement = 'One licence: originated 2021-04-16, still allocated';
    const model = {
      key: 'M7TEE', found: true, latest: null, seen: null, anatomy: null, series: 'M7',
      dial: { events: [{ day: '2021-04-16', label: 'licence issued', state: false }], sightings: [], findings: [{ statement, caveats: [] }], hasEvents: true },
    };
    CALLSIGN_SECTION_REGISTRY['the-evidence-dial'].mount(root, model);
    expect(root.textContent).toContain(statement);
    // Never a bare rule badge: the statement text is present, not just a tag.
    expect(root.querySelector('.dial-finding')?.textContent).toContain(statement);
  });

  it('EvidenceDial_HighlightControl_DimsTheOtherClock', () => {
    const root = document.createElement('div');
    const model = {
      key: 'M7TEE', found: true, latest: null, seen: null, anatomy: null, series: null,
      dial: { events: [{ day: '2021-04-16', label: 'issued', state: false }], sightings: [{ vintage: '2026-06-23' }], findings: [], hasEvents: true },
    };
    CALLSIGN_SECTION_REGISTRY['the-evidence-dial'].mount(root, model);
    const buttons = [...root.querySelectorAll('.dial-ctl button')];
    expect(buttons).toHaveLength(3);
    const scale = root.querySelector('.scale');
    (buttons[1] as HTMLButtonElement).click(); // Event only
    expect(scale?.classList.contains('dim-assert')).toBe(true);
    (buttons[2] as HTMLButtonElement).click(); // Assertion only
    expect(scale?.classList.contains('dim-event')).toBe(true);
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
      [{ day: '2018-10-01', label: 'series', state: false }, { day: '2021-04-16', label: 'origin', state: false }],
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

describe('v1 callsign model (reusing the v0 pure functions)', { tags: ['ui'] }, () => {
  // A minimal instant-shard manifest + record and event meta + record, in the
  // builders' shapes, so buildCallsignModel runs the real v0 functions.
  const manifest: ShardManifest = {
    schemaVersion: 1,
    counts: { datasets: 1, callsigns: 1, shards: 1, unkeyableRows: 0 },
    legend: { statuses: { A: 'Allocated' }, markers: {} },
    vocab: { product: ['Amateur Foundation Radio Licence'], type: [], impliedClass: [] },
    shards: ['M7'],
    datasets: [{ key: '2026-06-23', lane: 'open-data', entry: '2026-06-23', file: null, vintage: '2026-06-23', title: 'Ofcom register snapshot', classes: ['register-snapshot'], href: 'v0/datasets/open-data/2026-06-23/index.html', rows: 1, unkeyable: 0, intendedComplete: true, scopeNotes: '', coverageNote: '' }],
  };
  const record: CallsignRecord = { h: 'A', l: { d: 0, s: ['A'], p: [0], t: [] }, a: { pre: 'M7', sfx: 'TEE' }, d: { o: '2021-04-16' } };
  const eventMeta: EventsMeta = {
    schemaVersion: 1,
    asAt: '2026-06-23',
    counts: { datasets: 1, subjects: 1, shards: 1, unkeyableEventClaims: 0 },
    datasets: [{ lane: 'opendata', key: '2026-06-23', vintage: '2026-06-23', title: 'Ofcom register snapshot', href: 'v0/datasets/open-data/2026-06-23/index.html' }],
    kinds: [{ id: 'licence-version-original-start', label: 'licence-version start', contribution: 'earliest-surviving-start' }],
    rules: [{ id: 'still-allocated', gloss: 'a gloss' }],
    caveats: [{ id: 'earliest-surviving', label: 'earliest surviving date, not “the true original”', gloss: 'a caveat gloss' }],
    episodes: [],
    shards: ['M7'],
  };
  const eventRecord: EventRecord = { e: [[0, '2021-04-16', [[0, 1]]]], f: [[0, 'One licence: originated 2021-04-16, still allocated', [0], [0]]] };

  it('BuildCallsignModel_ResolvedRecord_ProjectsLatestSeenAnatomyAndFindings', () => {
    const model = buildCallsignModel({
      res: { key: 'M7TEE', record, cleaned: 'M7TEE', typed: 'M7TEE' },
      manifest, eventRecord, eventMeta,
      latestSummary, seenSummary, anatomyFigureParts, stripModel,
    });
    expect(model.found).toBe(true);
    expect(model.key).toBe('M7TEE');
    expect(model.latest?.statuses).toContain('Allocated');
    expect(model.seen?.present).toBe(1);
    expect(model.anatomy?.length).toBeGreaterThan(0);
    expect(model.dial.sightings).toEqual([{ vintage: '2026-06-23' }]);
    // The finding statement is carried verbatim from the event shard.
    expect(model.dial.findings[0].statement).toBe('One licence: originated 2021-04-16, still allocated');
  });

  it('BuildCallsignModel_UnresolvedRecord_ReportsNotFound', () => {
    const model = buildCallsignModel({
      res: { key: null, record: null, cleaned: 'ZZ9ZZZ', typed: 'zz9zzz' },
      manifest, eventRecord: null, eventMeta: null,
      latestSummary, seenSummary, anatomyFigureParts, stripModel,
    });
    expect(model.found).toBe(false);
    expect(model.key).toBe('ZZ9ZZZ');
  });
});
