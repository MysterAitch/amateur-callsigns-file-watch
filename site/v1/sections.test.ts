// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import {
  HOME_SECTION_ORDER,
  HOME_SECTION_REGISTRY,
  renderHomeSections,
  defaultHomeModel,
  spanDialGeometry,
  enhanceHomeModel,
  parseHoldings,
  fractionalYearOf,
  milestoneRotationStart,
  humaniseIsoDate,
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
  expandDisputedEvents,
  disputedClaimCount,
  captionEdge,
  estimateCaptionWidthPx,
} from './callsign-sections.js';
import { renderSiteBar, datedFactChipParts } from './shell.js';
import { preserveLookupInput } from './callsign-page.js';
import { provenanceChip, inlineTerm, termCue, wireTermPopovers } from './glossary.js';
import { EVENT_TIME_GLOSS, ASSERTION_TIME_GLOSS, V1_COPY } from './copy.js';
// The same content-scan the build stamp uses to decide which pages carry the
// dated-fact chip (issue #965 follow-up) — shared so the parity test's page set
// can never drift from a hand-maintained list.
import { htmlPagesWithChip } from '../../src/ci/build-v1-chip.ts';
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
    carriedOrigin: 'neutral', series: null, seriesIntro: null, seriesIntroSource: null,
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

// A build-derived holdings manifest in the shape home.js fetches from
// holdings.json: mixed kinds, a month-only vintage, the newest register snapshot
// flagged latest, and three cited milestones (one a loosely-dated range). Used
// to exercise the enhanced (marks-drawn) render.
type HomeHoldings = import('./home-sections.js').HomeHoldings;
function holdingsFixture(): HomeHoldings {
  return {
    count: 4,
    heldStartYear: 2013,
    latestYear: 2026,
    latestDateIso: '2026-06-23',
    publications: [
      { vintage: '2013-09-06', kind: 'available-pool', letter: 'A', title: 'wdtk-174341--available-callsigns-list', rows: 9099, latest: false },
      { vintage: '2017-07-03', kind: 'register-snapshot', letter: 'R', title: 'Ofcom open data, 2017-07-03', rows: 120000, latest: false },
      { vintage: '2021-04', kind: 'issuance-events', letter: 'I', title: 'wdtk-issuance-events', rows: 42, latest: false },
      { vintage: '2026-06-23', kind: 'register-snapshot', letter: 'R', title: 'Ofcom open data, 2026-06-23', rows: 158318, latest: true },
    ],
    milestones: [
      { start: '2016', end: '2017', range: true, label: 'Licensing system changed, c. 2016–2017', citation: 'Cited to docs/narratives and docs/hypothesis-register.' },
      { start: '2018-10', end: '2018-10', range: false, label: 'M7 series opened October 2018', citation: 'Introduced October 2018 — cited to FOI reservation data.', series: 'M7' },
      { start: '2025-10', end: '2025-10', range: false, label: 'M8 series opened October 2025', citation: 'Introduced October 2025.', series: 'M8' },
    ],
  };
}

function mountEnhancedDial(holdings: HomeHoldings): HTMLElement {
  const root = document.createElement('div');
  const model = enhanceHomeModel(defaultHomeModel(), holdings);
  HOME_SECTION_REGISTRY['at-a-glance'].mount(root, model);
  const dial = root.querySelector('.spandial');
  if (dial === null) throw new Error('no dial rendered');
  return dial as HTMLElement;
}

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

  it('HomeAtAGlance_GroundedNoJsBaseline_ShowsTheHonestNoteAndDrawsNoMarks', () => {
    // With no holdings manifest consumed (the grounded model), the dial keeps the
    // axis, count and needle but draws NO individual marks — and states so
    // honestly, so the baseline never implies marks that are absent.
    const root = document.createElement('div');
    renderHomeSections(root, defaultHomeModel());
    const dial = root.querySelector('.spandial');
    expect(dial?.classList.contains('enhanced')).toBe(false);
    expect(dial?.querySelectorAll('.sd-pip')).toHaveLength(0);
    expect(dial?.querySelectorAll('.sd-up')).toHaveLength(0);
    expect(dial?.querySelector('.sd-note')?.textContent).toContain('appear when the page');
  });

  it('HomeAtAGlance_WithHoldingsManifest_DrawsKindTintedLetteredPublicationMarks', () => {
    // The build-derived manifest, consumed: one down-marker per held publication,
    // each carrying its kind (the tint) AND its letter (never colour alone), with
    // the newest register snapshot ringed.
    const dial = mountEnhancedDial(holdingsFixture());
    const pips = [...dial.querySelectorAll('.sd-pip')];
    expect(pips).toHaveLength(4);
    // Kind rides a data attribute AND the letter text — colour is never the only cue.
    const reg = pips.find(p => p.getAttribute('data-kind') === 'register-snapshot');
    expect(reg?.textContent).toBe('R');
    const avail = pips.find(p => p.getAttribute('data-kind') === 'available-pool');
    expect(avail?.textContent).toBe('A');
    // Exactly one ringed "latest" mark, the newest register snapshot.
    const ringed = pips.filter(p => p.classList.contains('latest'));
    expect(ringed).toHaveLength(1);
    expect(ringed[0].getAttribute('title')).toContain('2026-06-23');
    expect(ringed[0].getAttribute('title')).toContain('newest register snapshot');
    // The dial is marked enhanced (taller axis, mark bands).
    expect(dial.classList.contains('enhanced')).toBe(true);
  });

  it('HomeAtAGlance_WithMilestones_DrawsCitedUpMarkersAndAPaginatedCaption', () => {
    // Up-markers point up from the axis; the caption names the focused milestone
    // and carries ITS citation behind a "source" fold — never an uncited claim.
    const dial = mountEnhancedDial(holdingsFixture());
    expect([...dial.querySelectorAll('.sd-up')]).toHaveLength(3);
    const caption = dial.querySelector('.sd-milecap');
    expect(caption).not.toBeNull();
    expect(caption?.querySelector('.sd-mile-pos')?.textContent).toMatch(/of 3$/);
    // The focused milestone's citation is present (a milestone is never uncited).
    const source = caption?.querySelector('.sd-mile-src');
    expect(source?.querySelector('summary')?.textContent).toBe('source');
    expect((source?.querySelector('p')?.textContent ?? '').length).toBeGreaterThan(0);
    // Overwhelm control: exactly one milestone is focused at a time.
    expect([...dial.querySelectorAll('.sd-up.focus')]).toHaveLength(1);
  });

  it('HomeAtAGlance_MilestonePagination_CyclesTheFocusStateOnlyWithNoNavigation', () => {
    // Prev/next cycle the focused milestone in place — state-only, buttons not
    // links (no viewport movement), and the focus follows to the marks.
    const dial = mountEnhancedDial(holdingsFixture());
    const buttons = [...dial.querySelectorAll('.sd-mile-nav button')];
    expect(buttons).toHaveLength(2);
    for (const b of buttons) expect((b as HTMLButtonElement).type).toBe('button');
    const focusedLabel = () => dial.querySelector('.sd-mile-what')?.textContent ?? '';
    const before = focusedLabel();
    (buttons[1] as HTMLButtonElement).click(); // next
    const afterNext = focusedLabel();
    expect(afterNext).not.toBe(before);
    (buttons[0] as HTMLButtonElement).click(); // prev — returns to the start
    expect(focusedLabel()).toBe(before);
    // Still exactly one focused mark after cycling.
    expect([...dial.querySelectorAll('.sd-up.focus')]).toHaveLength(1);
  });

  it('HomeAtAGlance_EnhancedAriaAndText_NameTheMarksAndMilestonesNotByPositionAlone', () => {
    // Text parity for the marks: the aria-label names the held-publication count
    // over the run and lists the milestones; the foot carries the milestone
    // count; and the fold lists every publication in words.
    const dial = mountEnhancedDial(holdingsFixture());
    const aria = dial.getAttribute('aria-label') ?? '';
    expect(aria).toContain('4 held publications are marked');
    expect(aria).toContain('M7 series opened October 2018');
    // The foot carries the milestone count as text.
    expect(dial.querySelector('.sd-foot')?.textContent).toContain('register milestones');
    // The text-parity fold names every held publication (kind + title + vintage).
    const fold = dial.querySelector('.sd-holdlist');
    expect(fold?.querySelector('summary')?.textContent).toContain('all 4 held publications');
    expect([...(fold?.querySelectorAll('li') ?? [])]).toHaveLength(4);
    expect(fold?.textContent).toContain('register snapshot');
    expect(fold?.textContent).toContain('2026-06-23');
  });

  it('HomeAtAGlance_HoldingsWithNoMilestones_DrawsThePipsButOmitsTheCaption', () => {
    // Degenerate: publications but no cited milestones — the down-markers draw,
    // the up-marker caption is simply absent (never an empty control).
    const h = holdingsFixture();
    h.milestones = [];
    const dial = mountEnhancedDial(h);
    expect([...dial.querySelectorAll('.sd-pip')].length).toBeGreaterThan(0);
    expect(dial.querySelector('.sd-milecap')).toBeNull();
    expect([...dial.querySelectorAll('.sd-up')]).toHaveLength(0);
  });

  it('HomeAtAGlance_CoDatedPublications_StackAllVisiblyRatherThanOverprint', () => {
    // The real archive holds a six-way same-date collision (2015-10-13). Every
    // co-dated publication must render as its own mark, stacked downward at
    // distinct offsets — none may overprint (the invisible-mark finding).
    const h = holdingsFixture();
    const sixWay = Array.from({ length: 6 }, (_v, i) => ({
      vintage: '2015-10-13', kind: 'available-pool', letter: 'A',
      title: `wdtk-collision-${i}`, rows: 100 + i, latest: false,
    }));
    h.publications = [...sixWay, h.publications[3]]; // six colliding + the latest R
    h.count = h.publications.length;
    const dial = mountEnhancedDial(h);
    const pips = [...dial.querySelectorAll<HTMLElement>('.sd-pip')];
    // Every publication is visibly present.
    expect(pips).toHaveLength(7);
    // The six co-dated marks share one x but stack at distinct vertical offsets.
    const colliding = pips.filter(p => (p.getAttribute('title') ?? '').includes('2015-10-13'));
    expect(colliding).toHaveLength(6);
    const tops = new Set(colliding.map(p => p.style.top));
    expect(tops.size, 'co-dated pips must not overprint at the same offset').toBe(6);
    const lefts = new Set(colliding.map(p => p.style.left));
    expect(lefts.size, 'co-dated pips share the same x position').toBe(1);
  });

  it('HomeAtAGlance_SinglePublication_DrawsOnePipWithoutCrashing', () => {
    // Degenerate: one held publication — one down-marker, the collapsed run, no
    // divide-by-zero.
    const h = holdingsFixture();
    h.count = 1;
    h.heldStartYear = 2026;
    h.latestYear = 2026;
    h.publications = [h.publications[3]]; // the 2026-06-23 register snapshot
    const dial = mountEnhancedDial(h);
    expect([...dial.querySelectorAll('.sd-pip')]).toHaveLength(1);
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
    // The honest no-JS note: the baseline states plainly that the individual
    // marks appear with the script, so the static render can never imply marks
    // it does not draw. Parity holds it identical to the grounded render.
    note: norm(dial?.querySelector('.sd-note')?.textContent),
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

// The dated-fact chip is a define-once primitive (issues #965, #966): the date +
// count are authored in ONE build-injected source (record-facts.js) and consumed
// by the single shared site-bar component, so no page re-authors the value. The
// static-HTML no-JS baselines mirror that source for crawler visibility; this is
// their backstop — every v1 page's static chip (text AND tooltip) must equal the
// single-source render, so a page drifting, or the source changing without a page
// restamped, fails loud. renderSiteBar with no facts reads the single source.
describe('v1 dated-fact chip — cross-page parity (single source)', { tags: ['unit'] }, () => {
  // Content-scanned, not hand-authored (issue #965 follow-up): the same test
  // helper the build stamp uses to decide which pages carry a chip, so a future
  // page that gains one is covered automatically rather than escaping the guard
  // because nobody remembered to add it to a list. 404.html carries no chip and
  // is correctly absent from the result.
  const V1_PAGES_WITH_CHIP = htmlPagesWithChip('site/v1');
  const norm = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();

  it('EveryV1Page_StaticChipTextAndTooltip_MatchTheSingleBuildSource', () => {
    const bar = renderSiteBar('home'); // no facts passed: reads the single source
    const sourceChip = bar.querySelector('.chip.asof');
    const sourceText = norm(sourceChip?.textContent);
    const sourceTitle = norm(sourceChip?.getAttribute('title'));
    expect(sourceText, 'the single-source chip renders text').not.toBe('');
    expect(sourceTitle, 'the single-source chip renders a tooltip').not.toBe('');
    for (const page of V1_PAGES_WITH_CHIP) {
      const doc = new DOMParser().parseFromString(fs.readFileSync(`site/v1/${page}`, 'utf8'), 'text/html');
      const chip = doc.querySelector('.chip.asof');
      expect(chip, `${page} carries a static dated-fact chip`).not.toBeNull();
      expect(norm(chip?.textContent), `${page} chip text drifted from the single source`).toBe(sourceText);
      expect(norm(chip?.getAttribute('title')), `${page} chip tooltip drifted from the single source`).toBe(sourceTitle);
    }
  });

  it('DatedFactChipTooltip_IsHonest_AndDropsTheFalseGeneratedFromThatSetClaim', () => {
    // The old tooltip falsely told every page it "was generated from that set"
    // (issue #965). The honest tooltip states the record's currency only.
    const title = renderSiteBar('home').querySelector('.chip.asof')?.getAttribute('title') ?? '';
    expect(title.toLowerCase()).not.toContain('generated from that set');
    expect(title).toContain('newest publication held');
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

  it('SpanDialGeometry_WithPublications_PositionsEachPipWithinTheHeldRunAndFlagsLatest', () => {
    const geo = spanDialGeometry({
      historyStartYear: 1903, heldStartYear: 2013, latestYear: 2026, latestLabel: '23 June 2026', count: 3,
      publications: [
        { vintage: '2013-09-06', kind: 'available-pool', letter: 'A', title: 't1', rows: 1, latest: false },
        { vintage: '2019-01-14', kind: 'register-snapshot', letter: 'R', title: 't2', rows: 1, latest: false },
        { vintage: '2026-06-23', kind: 'register-snapshot', letter: 'R', title: 't3', rows: 1, latest: true },
      ],
    });
    expect(geo.pips).toHaveLength(3);
    for (const p of geo.pips) {
      expect(p.leftPct).toBeGreaterThanOrEqual(0);
      expect(p.leftPct).toBeLessThanOrEqual(100);
    }
    // Position monotonic with vintage; the newest reads at (or near) the run end.
    expect(geo.pips[0].leftPct).toBeLessThan(geo.pips[2].leftPct);
    expect(geo.pips[2].latest).toBe(true);
  });

  it('SpanDialGeometry_WithMilestones_PlacesEachUpMarkerInItsSegment', () => {
    const geo = spanDialGeometry({
      historyStartYear: 1903, heldStartYear: 2013, latestYear: 2026, latestLabel: '23 June 2026', count: 1,
      publications: [{ vintage: '2026-06-23', kind: 'register-snapshot', letter: 'R', title: 't', rows: 1, latest: true }],
      milestones: [
        { start: '2018-10', end: '2018-10', range: false, label: 'M7 series opened October 2018', citation: 'c' },
        { start: '2016', end: '2017', range: true, label: 'system change', citation: 'c' },
      ],
    });
    expect(geo.milestones).toHaveLength(2);
    // Both fall in the held run (>= 2013), positioned within the axis.
    for (const m of geo.milestones) {
      expect(m.seg).toBe('held');
      expect(m.leftPct).toBeGreaterThanOrEqual(0);
      expect(m.leftPct).toBeLessThanOrEqual(100);
    }
    // The range milestone carries a non-zero span; the point one does not.
    const range = geo.milestones.find(m => m.range);
    expect((range?.endLeft ?? 0) - (range?.startLeft ?? 0)).toBeGreaterThan(0);
  });

  it('SpanDialGeometry_EmptyArchive_DrawsNoMarks', () => {
    // Nothing held: no reading, and so no marks — never marks on an absent axis.
    const geo = spanDialGeometry({
      historyStartYear: 1903, heldStartYear: 2013, latestYear: 2026, latestLabel: '23 June 2026', count: 0,
      publications: [{ vintage: '2020-01-01', kind: 'register-snapshot', letter: 'R', title: 't', rows: 1, latest: true }],
      milestones: [{ start: '2018-10', end: '2018-10', range: false, label: 'm', citation: 'c' }],
    });
    expect(geo.render).toBe(false);
    expect(geo.pips).toHaveLength(0);
    expect(geo.milestones).toHaveLength(0);
  });
});

describe('v1 home span-dial marks (pure helpers)', { tags: ['unit'] }, () => {
  it('FractionalYearOf_MonthAndDay_MoveTheValueWithinTheYear', () => {
    expect(fractionalYearOf('2018')).toBe(2018);
    expect(fractionalYearOf('2018-10')).toBeCloseTo(2018 + 9 / 12, 3);
    expect(fractionalYearOf('bad')).toBeNaN();
  });

  it('MilestoneRotationStart_SameSeed_IsDeterministicAndAlwaysInRange', () => {
    // The rotation is build-seeded, never Math.random: the same seed yields the
    // same start, and the index is always valid.
    expect(milestoneRotationStart(3, '2026-06-23')).toBe(milestoneRotationStart(3, '2026-06-23'));
    for (const seed of ['2026-06-23', '2013', 'x', '']) {
      const idx = milestoneRotationStart(3, seed);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(3);
    }
    // No milestones: a safe zero rather than a modulo-by-zero.
    expect(milestoneRotationStart(0, 'seed')).toBe(0);
  });

  it('HumaniseIsoDate_FullDateOnly_ElseNull', () => {
    expect(humaniseIsoDate('2026-06-23')).toBe('23 June 2026');
    // Month-only or null never implies a day.
    expect(humaniseIsoDate('2021-04')).toBeNull();
    expect(humaniseIsoDate(null)).toBeNull();
  });

  it('SpanDialGeometry_CoDatedPublications_AssignDistinctStackDepthsAndSetMaxStack', () => {
    const geo = spanDialGeometry({
      historyStartYear: 1903, heldStartYear: 2013, latestYear: 2026, latestLabel: '23 June 2026', count: 4,
      publications: [
        { vintage: '2015-10-13', kind: 'available-pool', letter: 'A', title: 'a', rows: 1, latest: false },
        { vintage: '2015-10-13', kind: 'available-pool', letter: 'A', title: 'b', rows: 1, latest: false },
        { vintage: '2015-10-13', kind: 'available-pool', letter: 'A', title: 'c', rows: 1, latest: false },
        { vintage: '2026-06-23', kind: 'register-snapshot', letter: 'R', title: 'd', rows: 1, latest: true },
      ],
    });
    // The three co-dated pips take stacks 0,1,2 at one x; the lone one is stack 0.
    const collided = geo.pips.filter(p => p.vintage === '2015-10-13');
    expect(collided.map(p => p.stack).sort()).toEqual([0, 1, 2]);
    expect(geo.pips.find(p => p.vintage === '2026-06-23')?.stack).toBe(0);
    expect(geo.maxStack).toBe(3);
  });
});

describe('v1 home holdings manifest validation (untrusted input)', { tags: ['unit'] }, () => {
  it('ParseHoldings_WellFormedManifest_ReturnsATypedValue', () => {
    const h = parseHoldings(holdingsFixture());
    expect(h).not.toBeNull();
    expect(h?.count).toBe(4);
    expect(h?.publications).toHaveLength(4);
    expect(h?.milestones).toHaveLength(3);
  });

  it('ParseHoldings_JunkOrNonObject_ReturnsNull', () => {
    expect(parseHoldings(null)).toBeNull();
    expect(parseHoldings('not json')).toBeNull();
    expect(parseHoldings(42)).toBeNull();
    expect(parseHoldings([])).toBeNull(); // an array is not the manifest object
  });

  it('ParseHoldings_MissingOrWrongTypedKeys_ReturnsNull', () => {
    const base = holdingsFixture();
    // Missing count.
    const noCount: Record<string, unknown> = { ...base };
    delete noCount.count;
    expect(parseHoldings(noCount)).toBeNull();
    // Wrong-typed count.
    expect(parseHoldings({ ...base, count: '4' })).toBeNull();
    // publications not an array.
    expect(parseHoldings({ ...base, publications: {} })).toBeNull();
    // milestones not an array.
    expect(parseHoldings({ ...base, milestones: null })).toBeNull();
  });

  it('ParseHoldings_MalformedPublicationOrMilestone_ReturnsNull', () => {
    const base = holdingsFixture();
    // A publication whose rows is a string (the kind of shape a schema drift
    // would produce) fails the whole parse rather than mis-rendering.
    const badPub = { ...base, publications: [{ ...base.publications[0], rows: 'lots' }] };
    expect(parseHoldings(badPub)).toBeNull();
    // A milestone missing its citation.
    const badMile = { ...base, milestones: [{ start: '2018-10', end: '2018-10', range: false, label: 'x' }] };
    expect(parseHoldings(badMile)).toBeNull();
  });

  it('EnhanceHomeModel_FromManifest_DerivesCountSpanAndCarriesTheMarks', () => {
    const base = defaultHomeModel();
    const enhanced = enhanceHomeModel(base, holdingsFixture());
    // The count / span / newest-date become derived; the 1903 history horizon
    // stays the base constant the manifest does not carry.
    expect(enhanced.span.count).toBe(4);
    expect(enhanced.span.heldStartYear).toBe(2013);
    expect(enhanced.span.latestYear).toBe(2026);
    expect(enhanced.span.latestLabel).toBe('23 June 2026');
    expect(enhanced.span.historyStartYear).toBe(base.span.historyStartYear);
    expect(enhanced.span.publications).toHaveLength(4);
    expect(enhanced.span.milestones).toHaveLength(3);
    // The dated-fact chip's facts are derived too, so the surface stays coherent.
    expect(enhanced.facts.count).toBe(4);
    expect(enhanced.facts.date).toBe('23 June 2026');
  });

  it('EnhanceHomeModel_FromManifest_ProjectsTheAtAGlanceReadoutSoItCannotDesyncFromTheDial', () => {
    // Issue #965: the readout must read the SAME manifest the span dial uses, so
    // the two figures beside each other can never contradict.
    const enhanced = enhanceHomeModel(defaultHomeModel(), holdingsFixture());
    const cell = (k: string): { v: string; u: string } | undefined => enhanced.glance.find(c => c.k === k);
    expect(cell('publications')?.v).toBe('4'); // the manifest count, not the hand-authored 65
    expect(cell('publications')?.u).toBe('folded, 2013–2026');
    expect(cell('span held')?.v).toBe('13y');
    expect(cell('latest snapshot')?.v).toBe('2026-06-23');
    expect(cell('latest snapshot')?.u).toBe('June 2026');
    // The callsign total is not carried by the manifest, so its cell stays the
    // grounded, report-cited constant rather than being invented.
    expect(cell('callsigns')?.v).toBe(defaultHomeModel().glance.find(c => c.k === 'callsigns')?.v);
  });

  it('EnhanceHomeModel_ManifestMissingTheNewestFullDate_FallsBackHonestlyNotToAStaleConfidentNumber', () => {
    // Unhappy path: a manifest with no full newest date and no span years. The
    // readout falls back to the grounded base cells rather than emitting a
    // fabricated ISO or a NaN span.
    const base = defaultHomeModel();
    const thin = { ...holdingsFixture(), count: 2, heldStartYear: null, latestYear: null, latestDateIso: null };
    const enhanced = enhanceHomeModel(base, thin);
    const cell = (k: string): { v: string; u: string } | undefined => enhanced.glance.find(c => c.k === k);
    // The count still updates (the manifest carries it)…
    expect(cell('publications')?.v).toBe('2');
    // …but the span and snapshot fall back to the base, never NaN or "null".
    expect(cell('span held')?.v).not.toContain('NaN');
    expect(cell('latest snapshot')).toEqual(base.glance.find(c => c.k === 'latest snapshot'));
    expect(enhanced.facts.date).toBe(base.span.latestLabel);
  });
});

describe('v1 home "from the record" rotation (issue #965)', { tags: ['ui'] }, () => {
  const lead = (seed: string): string => {
    const model = { ...defaultHomeModel(), rotationSeed: seed };
    const host = document.createElement('section');
    HOME_SECTION_REGISTRY['from-the-record'].mount(host, model);
    return host.querySelector('.big')?.textContent ?? '';
  };

  it('FromTheRecord_BuildSeed_SelectsADeterministicLeadThatVariesWithTheSeed', () => {
    // The footer promises the lead changes as the record grows, when the
    // newest publication changes — never merely "on each rebuild" (an ordinary
    // rebuild with the same newest date must show the same lead). The seeded
    // rotation makes that claim true: deterministic for a given seed, and
    // moving only when the seed (the holdings date) itself changes. Three
    // distinct seeds map to the three distinct notable details.
    expect(lead('x')).toBe(lead('x'));
    const leads = new Set([lead('x'), lead('y'), lead('z')]);
    expect(leads.size).toBe(3);
  });

  it('FromTheRecordFooter_RenderedCopy_MatchesTheRegistryAndNeverClaimsPerRebuildRotation', () => {
    // The footer copy (issue #965 follow-up) must be true to the actual
    // mechanism: the rotation seed is the newest held publication date, which
    // only changes when a new publication lands — not on every rebuild.
    const model = defaultHomeModel();
    const host = document.createElement('section');
    HOME_SECTION_REGISTRY['from-the-record'].mount(host, model);
    const footer = host.querySelector('.rot-foot')?.textContent ?? '';
    expect(footer).toBe(V1_COPY.home.fromTheRecordFoot);
    expect(footer).toContain('newest publication changes');
    expect(footer).toContain('not on every rebuild');
    expect(footer.toLowerCase()).not.toBe('selection rotates at build time – a different notable detail leads on each rebuild.');
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
    // The fast-answer callout states the non-observation without claiming anything
    // about the register.
    const root = document.createElement('div');
    renderCallsignSections(root, cm({ found: false, key: 'ZZ9ZZZ' }));
    expect(root.querySelector('.callout')?.textContent).toContain('No record for ZZ9ZZZ');
  });

  it('RenderCallsignSections_NoRecordLookup_SuppressesTheRecordDependentSections', () => {
    // A no-record lookup (e.g. ZZ9ZZZ) must NOT render the evidence instrument,
    // the event timeline or the anatomy beneath the no-record card — an empty
    // axis reads as broken and undercuts the clean message (issue #921, A4). The
    // no-record card stands alone.
    const root = document.createElement('div');
    renderCallsignSections(root, cm({ found: false, key: 'ZZ9ZZZ' }));
    expect(root.querySelector('section[data-section="fast-answer"]')).not.toBeNull();
    expect(root.querySelector('section[data-section="the-evidence-dial"]')).toBeNull();
    expect(root.querySelector('section[data-section="event-timeline"]')).toBeNull();
    expect(root.querySelector('section[data-section="anatomy"]')).toBeNull();
    // No dangling axis, dial or non-observation copy for a callsign with no record.
    expect(root.querySelector('.scale')).toBeNull();
    expect(root.textContent ?? '').not.toContain('No dated event-time evidence is held');
  });

  it('RenderCallsignSections_ResolvedRecord_StillShowsTheEvidenceTimelineAndAnatomy', () => {
    // The counterpart to the suppression: a resolved record renders the full set,
    // so the suppression only ever fires on a genuine miss (issue #921, A4).
    const root = document.createElement('div');
    renderCallsignSections(root, cm({
      found: true, key: 'M7TEE',
      anatomy: [{ chars: 'M7', name: 'prefix', meaning: 'a prefix' }],
      dial: { hasEvents: true, events: [{ day: '2018-10-18', label: 'licence issued', state: false, assertedBy: [] }], sightings: [{ vintage: '2026-06-23' }] },
    }));
    expect(root.querySelector('section[data-section="the-evidence-dial"]')).not.toBeNull();
    expect(root.querySelector('section[data-section="event-timeline"]')).not.toBeNull();
    expect(root.querySelector('section[data-section="anatomy"]')).not.toBeNull();
    expect(root.querySelector('.scale')).not.toBeNull();
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

  it('EvidenceDial_WhenSeriesIntroCitationPresent_RendersItAsAnAssertedByFoldLikeEveryOtherRailRow', () => {
    // Issue #954: the series-opened row must not state its fact without a
    // source, once meta.json carries the citation. nrows is per-claim (this
    // series' own introduction is asserted by exactly its own CSV row), like
    // every other AssertedBy entry — never the file's total row count, which
    // would overstate every series' citation alike.
    const root = document.createElement('div');
    const model = cm({
      series: 'M7', seriesIntro: '2018-10',
      seriesIntroSource: { title: 'reference-data/prefix-formats.csv', href: '', vintage: null, nrows: 1 },
      dial: { events: [{ day: '2021-04-16', label: 'licence issued', state: false, assertedBy: [] }], sightings: [{ vintage: '2026-06-23' }], hasEvents: true },
    });
    CALLSIGN_SECTION_REGISTRY['the-evidence-dial'].mount(root, model);
    const context = root.querySelector('.dial-context');
    const fold = context?.querySelector('details.evt-assert');
    expect(fold).not.toBeNull();
    expect(fold?.textContent).toContain('reference-data/prefix-formats.csv');
    // A single asserting row renders the file title alone, with no row-count
    // suffix (the count would only earn its place past one row).
    expect(fold?.textContent).not.toContain('rows');
  });

  it('EvidenceDial_WhenSeriesIntroCitationMissing_RendersTheRowHonestlyWithNoFoldRatherThanFabricateASource', () => {
    // Issue #954, unhappy path: an older cached meta.json (or the event axis
    // not loaded) carries seriesIntro without seriesIntroSource. The context
    // row must still render its plain-text fact, but with no asserted-by fold
    // rather than inventing a citation.
    const root = document.createElement('div');
    const model = cm({
      series: 'M7', seriesIntro: '2018-10', seriesIntroSource: null,
      dial: { events: [{ day: '2021-04-16', label: 'licence issued', state: false, assertedBy: [] }], sightings: [{ vintage: '2026-06-23' }], hasEvents: true },
    });
    CALLSIGN_SECTION_REGISTRY['the-evidence-dial'].mount(root, model);
    const context = root.querySelector('.dial-context');
    expect(context?.textContent).toContain('M7 series opened October 2018');
    expect(context?.querySelector('details.evt-assert')).toBeNull();
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

  it('EvidenceDial_Legend_NamesEachMarkerTypeThatIsDrawn', () => {
    // A2 (issue #921): the instrument is conceptually opaque without a legend.
    // Every marker type actually drawn is named in plain English, so a first-time
    // reader can decode the dial without inferring the vocabulary from prose.
    const root = document.createElement('div');
    const model = cm({
      latest: { statuses: ['Allocated'], products: [], types: [], dataset: { title: 'Ofcom register snapshot', vintage: '2026-06-23', href: '#' } },
      dial: {
        hasEvents: true,
        events: [{ day: '2018-10-18', label: 'licence issued', state: false, assertedBy: [] }],
        sightings: [{ vintage: '2026-06-23', title: 'Ofcom register snapshot' }],
      },
    });
    CALLSIGN_SECTION_REGISTRY['the-evidence-dial'].mount(root, model);
    const legend = root.querySelector('.dial-legend');
    expect(legend).not.toBeNull();
    const text = legend?.textContent ?? '';
    expect(text).toContain('an event');
    expect(text).toContain('a sighting');
    expect(text).toContain('current state');
  });

  it('EvidenceDial_Legend_NamesTheTintedKindsPresentBesideASwatch', () => {
    // The legend is the home for the stable kind-tint scheme (A2): each tinted
    // kind present is named beside a swatch keyed to its hue, so the colour scheme
    // becomes learnable and colour is never the sole cue.
    const root = document.createElement('div');
    const model = cm({
      dial: {
        hasEvents: true,
        events: [{ day: '2018-10-18', label: 'licence issued', kindId: 'licence-issued', state: false, assertedBy: [] }],
        sightings: [{ vintage: '2026-06-23' }],
      },
    });
    CALLSIGN_SECTION_REGISTRY['the-evidence-dial'].mount(root, model);
    const swatch = root.querySelector('.dial-legend .dl-sw[data-kind="licence-issued"]');
    expect(swatch).not.toBeNull();
    expect(root.querySelector('.dial-legend')?.textContent ?? '').toContain('licence issued');
  });

  it('EvidenceDial_LegendDisputedEntry_AppearsOnlyWhenClaimsAreDisputed', () => {
    // The disputed (hollow) marker is decoded only when the record actually holds
    // a disputed claim, so the legend never names a marker type that is not drawn.
    const undisputed = document.createElement('div');
    CALLSIGN_SECTION_REGISTRY['the-evidence-dial'].mount(undisputed, cm({
      dial: { hasEvents: true, events: [{ day: '2018-10-18', label: 'licence issued', state: false, assertedBy: [] }], sightings: [{ vintage: '2026-06-23' }] },
    }));
    expect(undisputed.querySelector('.dial-legend')?.textContent ?? '').not.toContain('disputed');

    const disputed = document.createElement('div');
    CALLSIGN_SECTION_REGISTRY['the-evidence-dial'].mount(disputed, cm({
      dial: {
        hasEvents: true,
        events: [{ day: '2021-02-23', label: 'licence-version start', kindId: 'licence-version-original-start', state: false, assertedBy: [] }],
        sightings: [{ vintage: '2026-06-23' }],
        disagreements: [{
          kindLabel: 'licence-version start',
          camps: [
            { day: '1977-07-09', datasets: [{ title: 'entry-a register', href: '#', vintage: '2020-05-01' }] },
            { day: '2021-02-23', datasets: [{ title: 'entry-b register', href: '#', vintage: '2021-06-01' }] },
          ],
        }],
      },
    }));
    expect(disputed.querySelector('.dial-legend')?.textContent ?? '').toContain('disputed');
  });

  it('EvidenceDial_MicroExample_AppearsInTheFramingCopy', () => {
    const root = document.createElement('div');
    CALLSIGN_SECTION_REGISTRY['the-evidence-dial'].mount(root, cm({
      dial: { hasEvents: true, events: [{ day: '2018-10-18', label: 'licence issued', state: false, assertedBy: [] }], sightings: [{ vintage: '2026-06-23' }] },
    }));
    const example = root.querySelector('.dial-example');
    expect(example).not.toBeNull();
    // The worked example reads one diamond and one pip so the two clocks are
    // concrete, not abstract.
    expect(example?.textContent ?? '').toContain('a diamond above the axis');
    expect(example?.textContent ?? '').toContain('a pip below');
  });

  it('EvidenceDial_SingleEventMarker_CarriesATooltipNamingKindAndDate', () => {
    // Every marker carries a tooltip and its accessible equivalent (A2): a bare
    // unlabelled dot yields nothing on hover and nothing to assistive tech.
    const root = document.createElement('div');
    CALLSIGN_SECTION_REGISTRY['the-evidence-dial'].mount(root, cm({
      dial: { hasEvents: true, events: [{ day: '2021-04-16', label: 'licence issued — foundation', state: false, assertedBy: [] }], sightings: [{ vintage: '2026-06-23' }] },
    }));
    const marker = root.querySelector('.scale .ev:not(.state)');
    expect(marker?.getAttribute('title')).toBe('licence issued — foundation · 2021-04-16');
    expect(marker?.getAttribute('aria-label')).toBe('licence issued — foundation · 2021-04-16');
  });

  it('EvidenceDial_SightingMarker_CarriesATooltipNamingThePublicationAndVintage', () => {
    const root = document.createElement('div');
    CALLSIGN_SECTION_REGISTRY['the-evidence-dial'].mount(root, cm({
      dial: { hasEvents: true, events: [{ day: '2021-04-16', label: 'licence issued', state: false, assertedBy: [] }], sightings: [{ vintage: '2026-06-23', title: 'Ofcom register snapshot' }] },
    }));
    const pip = root.querySelector('.scale .si');
    const title = pip?.getAttribute('title') ?? '';
    expect(title).toContain('Ofcom register snapshot');
    expect(title).toContain('2026-06-23');
    expect(pip?.getAttribute('aria-label')).toBe(title);
  });

  it('EvidenceDial_SightingMarkerWithoutAPublicationTitle_FallsBackToTheVintageAlone', () => {
    const root = document.createElement('div');
    CALLSIGN_SECTION_REGISTRY['the-evidence-dial'].mount(root, cm({
      dial: { hasEvents: true, events: [{ day: '2021-04-16', label: 'licence issued', state: false, assertedBy: [] }], sightings: [{ vintage: '2026-06-23' }] },
    }));
    const title = root.querySelector('.scale .si')?.getAttribute('title') ?? '';
    expect(title).toContain('2026-06-23');
  });

  it('EvidenceDial_MarkersAtTheAxisExtremes_AnchorTheirCaptionInwardToAvoidOverflow', () => {
    // On a wide axis the leftmost event and the rightmost state terminus fall in
    // the edge bands, so their captions anchor inward (data-edge) rather than
    // overflow the scale (issue #921 polish).
    const root = document.createElement('div');
    CALLSIGN_SECTION_REGISTRY['the-evidence-dial'].mount(root, cm({
      latest: { statuses: ['Allocated'], products: [], types: [], dataset: { title: 'Ofcom register snapshot', vintage: '2026-06-23', href: '#' } },
      dial: {
        hasEvents: true,
        sightings: [{ vintage: '2026-06-23' }],
        events: [
          { day: '1977-07-09', label: 'old event', state: false, assertedBy: [] },
          { day: '2026-01-01', label: 'recent event', state: false, assertedBy: [] },
        ],
      },
    }));
    expect(root.querySelector('.scale .ev:not(.state)')?.getAttribute('data-edge')).toBe('l');
    expect(root.querySelector('.scale .ev.state')?.getAttribute('data-edge')).toBe('r');
  });

  it('EvidenceDial_StateNode_CarriesATooltipNamingTheStatusAndDate', () => {
    const root = document.createElement('div');
    CALLSIGN_SECTION_REGISTRY['the-evidence-dial'].mount(root, cm({
      latest: { statuses: ['Allocated'], products: [], types: [], dataset: { title: 'Ofcom register snapshot', vintage: '2026-06-23', href: '#' } },
      dial: { hasEvents: true, events: [{ day: '2018-10-18', label: 'licence issued', state: false, assertedBy: [] }], sightings: [{ vintage: '2026-06-23' }] },
    }));
    const state = root.querySelector('.scale .ev.state');
    const title = state?.getAttribute('title') ?? '';
    expect(title).toContain('Allocated');
    expect(title).toContain('2026-06-23');
    expect(state?.getAttribute('aria-label')).toBe(title);
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

  it('EventTimeline_AssertedByEntry_CarriesTheRawArchiveKeyAsASecondaryTooltipNeverAsThePrimaryLabel', () => {
    // Issue #954: the friendly title leads the visible text; the raw archive
    // key rides only as a native tooltip (title attribute), never in the
    // primary label.
    const root = document.createElement('div');
    const model = cm({
      dial: {
        hasEvents: true,
        events: [{
          day: '2024-10-01', label: 'attribute addendum', state: false,
          assertedBy: [{ title: 'Radio amateur licence breakdown by duration held and age', href: '#', vintage: '2024-10', nrows: 1, key: 'wdtk-1180568--licence-breakdown-duration-age' }],
        }],
      },
    });
    CALLSIGN_SECTION_REGISTRY['event-timeline'].mount(root, model);
    const li = root.querySelector('.evt-assert li');
    expect(li?.textContent).toContain('Radio amateur licence breakdown by duration held and age');
    expect(li?.textContent).not.toContain('wdtk-1180568');
    expect(li?.getAttribute('title')).toBe('wdtk-1180568--licence-breakdown-duration-age');
  });

  it('EventTimeline_AssertedByEntryWithNoRawKeyCarried_RendersTheFriendlyTitleWithNoTooltipRatherThanFabricatingOne', () => {
    // Unhappy path: an older fixture/manifest that carries no raw key must
    // still render honestly (no tooltip), never a made-up identifier.
    const root = document.createElement('div');
    const model = cm({
      dial: {
        hasEvents: true,
        events: [{ day: '2021-04-16', label: 'licence issued', state: false, assertedBy: [{ title: 'Ofcom register snapshot', href: '#', vintage: '2026-06-23', nrows: 1 }] }],
      },
    });
    CALLSIGN_SECTION_REGISTRY['event-timeline'].mount(root, model);
    const li = root.querySelector('.evt-assert li');
    expect(li?.hasAttribute('title')).toBe(false);
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

  it('EventTimeline_WhenOriginKindsDisagreeAcrossVintages_FallsBackAndShowsEveryCampsRow', () => {
    // G8NNZ-shape divergence: the origin kinds land together in the latest
    // vintage but a held vintage disagrees about the version start. The semantic
    // row must not coalesce it; the plain grouped card renders instead — and now
    // EVERY camp is shown (issue #921 item 7), so the competing 1991-07-26 value
    // gets its own dated card, not just the earliest-surviving one.
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
    CALLSIGN_SECTION_REGISTRY['event-timeline'].mount(root, cm({ dial }));
    expect(root.querySelector('.timeline .tl.origin')).toBeNull();
    // Two dated cards now: the competing 1991-07-26 camp and the 2018-10-18 group.
    const cards = [...root.querySelectorAll('.timeline .tl:not(.state)')];
    expect(cards).toHaveLength(2);
    const days = cards.map((c) => c.querySelector('.when')?.textContent ?? '');
    expect(days.some((d) => d.includes('1991-07-26'))).toBe(true);
    expect(days.some((d) => d.includes('2018-10-18'))).toBe(true);
    // Both the added camp and the earliest-surviving value read as disputed and
    // link to the narrative — two disputed rail entries in all.
    expect(root.querySelectorAll('.timeline .track .evt.disputed')).toHaveLength(2);
    expect(root.querySelector('.timeline .evt.disputed .dispute-link')?.getAttribute('href')).toBe('#record-disagreements');
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

  it('Extras_CarriedOrigin_ShowsTheStateExplainerAttestedAsInferenceNotADeclarativeClaim', () => {
    const rootFresh = document.createElement('div');
    CALLSIGN_SECTION_REGISTRY.extras.mount(rootFresh, cm({ carriedOrigin: 'fresh' }));
    // The 'fresh' reading names itself an inference (issue #965), never a fact.
    expect(rootFresh.textContent).toContain('read here as a fresh issuance');
    expect(rootFresh.textContent).toContain('inferred');

    // The equal-month case gets its own honest explainer, not the 'fresh' claim.
    const rootCoincident = document.createElement('div');
    CALLSIGN_SECTION_REGISTRY.extras.mount(rootCoincident, cm({ carriedOrigin: 'coincident' }));
    expect(rootCoincident.textContent).toContain('same month');
    expect(rootCoincident.textContent).not.toContain('read here as a fresh issuance');

    const rootNeutral = document.createElement('div');
    CALLSIGN_SECTION_REGISTRY.extras.mount(rootNeutral, cm({ carriedOrigin: 'neutral' }));
    expect(rootNeutral.textContent).toContain('the series introduction month is not recorded');
    expect(rootNeutral.textContent).not.toContain('read here as a fresh issuance');
  });
});

describe('v1 odd-count grids (issue #921, C1)', { tags: ['ui'] }, () => {
  const shellCss = fs.readFileSync('site/v1/shell.css', 'utf8');

  it('AnatomyGrid_OddPartCount_RendersEveryPartWithNoBlankCell', () => {
    // A three-part callsign (prefix/digit/suffix) filled a two-column grid with a
    // conspicuous blank fourth cell. Every rendered cell must carry a part — no
    // empty placeholder tile at any part count (issue #921, C1).
    const root = document.createElement('div');
    CALLSIGN_SECTION_REGISTRY.anatomy.mount(root, cm({
      found: true,
      anatomy: [
        { chars: 'M', name: 'prefix', meaning: 'UK amateur prefix' },
        { chars: '7', name: 'digit', meaning: 'the allocation digit' },
        { chars: 'TEE', name: 'suffix', meaning: 'the personal suffix' },
      ],
    }));
    const cells = [...root.querySelectorAll('.anat .p')];
    expect(cells).toHaveLength(3);
    for (const c of cells) expect((c.textContent ?? '').trim().length).toBeGreaterThan(0);
  });

  it('AnatomySection_ResolvedRecord_LinksOutToTheFullStructureReferencePage', () => {
    // The terse per-callsign grid gains a link-out to the full anatomy page
    // (issue #931), so the section is a route to the sourced explanation rather
    // than standing alone. The link-out carries the registry copy and stays on
    // the v1 surface (anatomy.html), never a /v0/ deep link.
    const root = document.createElement('div');
    CALLSIGN_SECTION_REGISTRY.anatomy.mount(root, cm({
      found: true,
      anatomy: [
        { chars: 'M', name: 'prefix', meaning: 'UK amateur prefix' },
        { chars: '7', name: 'digit', meaning: 'the allocation digit' },
        { chars: 'TEE', name: 'suffix', meaning: 'the personal suffix' },
      ],
    }));
    const out = root.querySelector('.anat-more a');
    expect(out?.getAttribute('href')).toBe('anatomy.html');
    expect(out?.textContent).toBe(V1_COPY.callsign.anatomyLinkOut);
    // The grid is untouched — the link-out is a sibling, not a phantom part cell.
    expect(root.querySelectorAll('.anat .p')).toHaveLength(3);
  });

  it('AnatomySection_UnparsedRecord_StillLinksOutToTheStructureReferencePage', () => {
    // Even where no diagram is drawn (no confident decomposition), the explainer
    // is reachable — the link-out appears in that branch too.
    const root = document.createElement('div');
    CALLSIGN_SECTION_REGISTRY.anatomy.mount(root, cm({ found: true, anatomy: null }));
    expect(root.querySelector('.anat-more a')?.getAttribute('href')).toBe('anatomy.html');
    expect(root.querySelector('.anat')).toBeNull();
  });

  it('AnatomyGrid_Stylesheet_UsesAnAutoFitTrackSoOddCountsLeaveNoBlankTile', () => {
    // The single grid rule that fixes both surfaces: an auto-fit track fills the
    // row at any item count rather than a fixed two-column track.
    expect(shellCss).toMatch(/\.anat\{[^}]*grid-template-columns:repeat\(auto-fit,minmax\([^)]*\)\)/);
  });

  it('NotFoundRouteCards_Markup_MatchesTheNavJourneysInAnAutoFitGrid', () => {
    // The 404 repeats the anatomy defect: route cards in a fixed-column grid
    // left a blank cell at some counts. Same one grid rule fixes it at any
    // count (issue #921, C1) — asserted here without pinning a literal number,
    // because a hard-coded card count is exactly what let the card set drift
    // from the nav once already (a fourth nav journey landed with only three
    // cards). Instead the card set is derived from the page's own nav: every
    // journey link's href must have a matching route card, and vice versa, so
    // the next journey added to the nav fails this test until its card exists.
    const doc = new DOMParser().parseFromString(fs.readFileSync('site/v1/404.html', 'utf8'), 'text/html');
    const navHrefs = [...doc.querySelectorAll('nav.journeys a')].map(a => a.getAttribute('href'));
    const cardHrefs = [...doc.querySelectorAll('.modules .mod a')].map(a => a.getAttribute('href'));
    expect(navHrefs.length).toBeGreaterThan(0);
    expect([...cardHrefs].sort()).toEqual([...navHrefs].sort());
    expect(shellCss).toMatch(/\.modules\{[^}]*grid-template-columns:repeat\(auto-fit,minmax\([^)]*\)\)/);
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

  it('CaptionEdge_WhenACentredCaptionWouldOverflow_AnchorsInwardOtherwiseCentres', () => {
    // A centred caption near the axis extreme overflows the scale, so it anchors
    // inward; mid-axis it stays centred (issue #921 polish). Width-aware.
    const w = estimateCaptionWidthPx('licence original start');
    expect(captionEdge(2, w)).toBe('l');
    expect(captionEdge(98, w)).toBe('r');
    expect(captionEdge(50, w)).toBeNull();
  });

  it('CaptionEdge_WiderCaption_AnchorsFurtherFromTheEdgeThanANarrowOne', () => {
    // The decision tracks the caption's OWN width: a wide caption needs anchoring
    // where a narrow one at the same position still fits centred.
    const wide = estimateCaptionWidthPx('Allocated / Revoked — current state');
    const narrow = estimateCaptionWidthPx('issued');
    expect(captionEdge(15, wide)).toBe('l');
    expect(captionEdge(15, narrow)).toBeNull();
  });

  it('EstimateCaptionWidth_LongLabels_ClampToTheCaptionMaxWidth', () => {
    // The estimate is bounded by the .cap max-width (14rem ≈ 224px) plus chrome,
    // matching the ellipsis clamp, so an unbounded label cannot claim unbounded
    // space in the geometry.
    const huge = estimateCaptionWidthPx('x'.repeat(500));
    expect(huge).toBeLessThanOrEqual(224 + 20);
    expect(estimateCaptionWidthPx('a')).toBeLessThan(huge);
  });

  it('DialGeometry_WhenTheStateNodeSitsNearTheNewestEvent_LiftsItClearOfThatEventsTier', () => {
    // The current-state terminus joins the near-dated tiering pass (issue #921
    // polish): an event and the terminus close together on a wide axis would
    // otherwise overprint at tier 0. On a 1977→2027 axis the 2021 event and the
    // 2026 terminus sit within a caption width, so the terminus lifts clear.
    const geo = dialGeometry(
      [
        { day: '1977-07-09', label: 'old', state: false, assertedBy: [] },
        { day: '2021-02-23', label: 'recent', state: false, assertedBy: [] },
      ],
      [{ vintage: '2026-06-23' }],
      { label: 'Allocated — current state', day: '2026-06-23' },
    );
    expect(geo.state?.tier).toBeGreaterThanOrEqual(1);
  });

  it('DialGeometry_WhenTheStateNodeIsWellClearOfEvents_StaysAtTierZero', () => {
    // The common case: the terminus is far from every event, so it stays flat.
    const geo = dialGeometry(
      [{ day: '2016-01-01', label: 'issued', state: false, assertedBy: [] }],
      [{ vintage: '2026-06-23' }],
      { label: 'Allocated — current state', day: '2026-06-23' },
    );
    expect(geo.state?.tier).toBe(0);
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
    if (originDay === undefined) throw new Error('fixture: expected a 2018-10-18 day-group');
    expect(isAgreeingOriginGroup(originDay, groups, [])).toBe(false);
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

  it('IsAgreeingOriginGroup_WhenTheCoincidingOriginsPredateTheSeries_FallsBackToFalse', () => {
    // Issue #965: the "licence origin = issuance" story asserts an issuance, so it
    // must not fire when the coinciding origins predate the callsign's own series
    // — that would present an issuance of a callsign that did not yet exist. The
    // origins coincide on 2018-10-18; a series introduced 2019-01 post-dates them.
    const groups = groupEventsByDay(originTriple);
    expect(isAgreeingOriginGroup(groups[0], groups, [], '2019-01')).toBe(false);
    // And when the series opened in or before the origins' own month, the story
    // still fires (an issuance in the series' opening month is coherent).
    expect(isAgreeingOriginGroup(groups[0], groups, [], '2018-10')).toBe(true);
    // The guard is opt-in: with no series month known, prior behaviour holds.
    expect(isAgreeingOriginGroup(groups[0], groups, [])).toBe(true);
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
    seriesIntroSource: { title: 'reference-data/prefix-formats.csv', href: '', vintage: null, nrows: 1 },
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
    // Each sighting carries the publication that recorded it, so its dial pip can
    // name it in a tooltip (issue #921, A2).
    expect(model.dial.sightings).toEqual([{ vintage: '2026-06-23', title: 'Ofcom register snapshot' }]);
    // The finding statement is carried verbatim from the event shard.
    expect(model.dial.findings[0].statement).toBe('One licence: originated 2021-04-16, still allocated');
    // Each event carries its assertion-time provenance.
    expect(model.dial.events[0].assertedBy[0].title).toBe('Ofcom register snapshot');
    // ...including the raw archive key, carried as secondary-detail-only data
    // (issue #954): never the primary label, but traceable on request.
    expect(model.dial.events[0].assertedBy[0].key).toBe('2026-06-23');
    // The series-introduction month is resolved from meta.json's seriesIntro map.
    expect(model.series).toBe('M7');
    expect(model.seriesIntro).toBe('2018-10');
    // Its citation is resolved from meta.json's seriesIntroSource (issue #954).
    expect(model.seriesIntroSource).toEqual({ title: 'reference-data/prefix-formats.csv', href: '', vintage: null, nrows: 1 });
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

  it('BuildCallsignModel_OriginInTheSameMonthAsTheSeriesIntro_ReadsAsCoincidentNotFresh', () => {
    // Issue #965: M7TEE's origin month (2018-10) EQUALS the M7 introduction month
    // (2018-10). Equal is not "post-dates", so it must not read 'fresh' — the
    // boundary resolves to 'coincident' (no confident fresh/carried claim).
    const sameMonthRecord: CallsignRecord = { ...record, d: { o: '2018-10-18' } };
    const model = buildCallsignModel({
      res: { key: 'M7TEE', record: sameMonthRecord, cleaned: 'M7TEE', typed: 'M7TEE', viaRendering: false },
      manifest, eventRecord, eventMeta,
      latestSummary, seenSummary, anatomyFigureParts, twinConflict, stripModel,
    });
    expect(model.carriedOrigin).toBe('coincident');
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

  it('BuildCallsignModel_MetaWithNoSeriesIntroSource_ResolvesSeriesIntroSourceAsNullRatherThanFabricatingOne', () => {
    // Issue #954, unhappy path: an older cached meta.json can carry seriesIntro
    // without the citation field.
    const metaWithoutSource: EventsMeta = { ...eventMeta };
    delete metaWithoutSource.seriesIntroSource;
    const model = buildCallsignModel({
      res: { key: 'M7TEE', record, cleaned: 'M7TEE', typed: 'M7TEE', viaRendering: false },
      manifest, eventRecord, eventMeta: metaWithoutSource,
      latestSummary, seenSummary, anatomyFigureParts, twinConflict, stripModel,
    });
    expect(model.seriesIntro).toBe('2018-10');
    expect(model.seriesIntroSource).toBeNull();
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

describe('v1 dial height budget (pure, issue #921)', { tags: ['unit'] }, () => {
  const sighting = [{ vintage: '2026-06-23' }];
  const stack = (day: string, n: number) =>
    Array.from({ length: n }, (_, i) => ({ day, label: 'kind ' + i, state: false, assertedBy: [] }));

  it('DialGeometry_WhenAStackedClusterIsTiered_GrowsTheComposedScaleHeight', () => {
    // A four-row stack pushed onto a separation tier by a near-dated single lifts
    // clear of that single's caption (the tier steps by enough to clear it: prev
    // top 78, stack base 34, ceil(44/34) = 2 steps) and grows the panel to contain
    // it (extent 34 + 68 + 4*15 + 15 = 177; axis 177 + 14 = 191; height 265) —
    // no spill, no scrollbar, no caption overlap.
    const geo = dialGeometry(
      [
        { day: '2001-06-01', label: 'lone', state: false, assertedBy: [] },
        ...stack('2001-06-02', 4),
      ],
      sighting,
    );
    const fourStack = geo.events.find((e) => e.count === 4);
    expect(fourStack?.tier).toBe(2);
    expect(geo.axisTop).toBe(191);
    expect(geo.scaleHeight).toBe(265);
  });

  it('DialGeometry_WhenAFiveEventDay_GrowsThePanelRatherThanClippingOrScrolling', () => {
    // Tall stacks are the ACCEPTED design: a five-event day grows the panel
    // (extent 34 + 5*15 + 15 = 124; axis 124 + 14 = 138; height 212) instead of
    // clipping the top row or opening an internal scrollbar.
    const geo = dialGeometry(stack('2019-06-05', 5), sighting);
    expect(geo.events[0].count).toBe(5);
    expect(geo.scaleHeight).toBe(212);
    expect(geo.scaleHeight).toBeGreaterThan(210);
  });

  it('DialGeometry_WhenNothingNeedsExtraRoom_KeepsTheCompactDefault', () => {
    // A lone four-row stack still fits the compact default (extent 109 + 14 < 136),
    // so the panel does not grow needlessly.
    const geo = dialGeometry(stack('2019-06-05', 4), sighting);
    expect(geo.axisTop).toBe(136);
    expect(geo.scaleHeight).toBe(210);
  });

  it('DialGeometry_WhenANearDatedRunsMiddleMemberIsAStack_ComposesHeightAcrossTheRun', () => {
    // Three near-dated day-groups, the middle a stack: each caption lifts clear of
    // the previous one's full painted top, so the tiers step by more than one
    // where a stack intervenes (0, then 2 to clear the first single, then 4 to
    // clear the stack) and the tallest composed caption drives the height (the
    // last single reaches 46 + 136 + 32 = 214; axis 214 + 14 = 228; height 302).
    const geo = dialGeometry(
      [
        { day: '2001-06-01', label: 'first', state: false, assertedBy: [] },
        ...stack('2001-06-02', 3),
        { day: '2001-06-03', label: 'third', state: false, assertedBy: [] },
      ],
      sighting,
    );
    expect([...geo.events].map((e) => e.tier).sort((a, b) => a - b)).toEqual([0, 2, 4]);
    const midStack = geo.events.find((e) => e.count === 3);
    expect(midStack?.tier).toBe(2);
    expect(geo.scaleHeight).toBe(302);
  });
});

describe('v1 dial/rail round-2 collision treatments (ui, issue #921)', { tags: ['ui'] }, () => {
  const codated = [
    { day: '2020-01-01', label: 'licence issued', kindId: 'licence-issued', state: false, assertedBy: [] },
    { day: '2020-01-01', label: 'licence cancelled', kindId: 'licence-cancelled', state: false, assertedBy: [] },
  ];

  it('DialAndRail_KindTints_UseTheSameKindKeyOnBothSurfaces', () => {
    // A reader must be able to match an event on the dial to its rail entry by
    // tint: both surfaces key the tint off the same data-kind, and the event name
    // is always present so the tint is never the sole discriminator.
    const dialRoot = document.createElement('div');
    CALLSIGN_SECTION_REGISTRY['the-evidence-dial'].mount(dialRoot, cm({ dial: { hasEvents: true, events: codated } }));
    const dialKinds = [...dialRoot.querySelectorAll('.scale .ev .vstack .r')].map((r) => r.getAttribute('data-kind'));
    expect(dialKinds).toEqual(['licence-issued', 'licence-cancelled']);

    const railRoot = document.createElement('div');
    CALLSIGN_SECTION_REGISTRY['event-timeline'].mount(railRoot, cm({ dial: { hasEvents: true, events: codated } }));
    const railKinds = [...railRoot.querySelectorAll('.timeline .track .evt')].map((e) => e.getAttribute('data-kind'));
    expect(railKinds).toEqual(['licence-issued', 'licence-cancelled']);
    // The names remain present on both surfaces.
    expect(dialRoot.textContent ?? '').toContain('licence issued');
    expect(railRoot.textContent ?? '').toContain('licence cancelled');
  });

  const g8nnz = () => ({
    hasEvents: true,
    events: [
      { day: '2018-10-18', label: 'licence issued', kindId: 'licence-issued', state: false, assertedBy: [] },
      { day: '2018-10-18', label: 'licence original start', kindId: 'licence-original-start', state: false, assertedBy: [] },
      { day: '2018-10-18', label: 'licence-version start', kindId: 'licence-version-original-start', state: false, assertedBy: [] },
    ],
    disagreements: [{
      kindLabel: 'licence-version start',
      camps: [
        { day: '1991-07-26', datasets: [{ title: '2020 register', href: '#', vintage: '2020-05-01' }] },
        { day: '2018-10-18', datasets: [{ title: '2024 register', href: '#', vintage: '2024-10-01' }] },
      ],
    }],
  });

  it('EvidenceDial_DisagreementNarrative_NamesBothDatesAndAPublicationPerSide', () => {
    // A fresh reader must be able to reconstruct the conflict: each side names its
    // publication, its asserted date, and the record adjudicates neither.
    const root = document.createElement('div');
    CALLSIGN_SECTION_REGISTRY['the-evidence-dial'].mount(root, cm({ dial: g8nnz() }));
    const text = root.querySelector('.dial-disagree')?.textContent ?? '';
    expect(text).toContain('1991-07-26');
    expect(text).toContain('2018-10-18');
    expect(text).toContain('2020 register');
    expect(text).toContain('2024 register');
    expect(text).toContain('disagree');
    expect(text).toContain('neither is adjudicated');
  });

  it('EvidenceDial_DisagreementHead_CarriesAStyledDerivedTag', () => {
    // The provenance tag renders as the shared chip (item 6): it is present and
    // labelled, no longer a bare unstyled word.
    const root = document.createElement('div');
    CALLSIGN_SECTION_REGISTRY['the-evidence-dial'].mount(root, cm({ dial: g8nnz() }));
    expect(root.querySelector('.dial-disagree .dd-head .tb')?.textContent).toBe('derived');
  });

  it('EvidenceDial_WithinKindDisagreement_RendersADisputedMarkerPerCamp', () => {
    // Every distinct claim gets a marker (item 7): the competing 1991-07-26 value
    // is its own hollow disputed marker, and the version-start row inside the
    // 2018 stack reads disputed too — composing with the same-day stack.
    const root = document.createElement('div');
    CALLSIGN_SECTION_REGISTRY['the-evidence-dial'].mount(root, cm({ dial: g8nnz() }));
    expect(root.querySelectorAll('.scale .ev.disputed')).toHaveLength(1);
    expect(root.querySelectorAll('.scale .ev.stacked .vstack .r.disputed')).toHaveLength(1);
    // Two competing dated claims are visible on the instrument in total.
    const disputedRows = root.querySelectorAll('.scale .ev.disputed, .scale .ev .vstack .r.disputed');
    expect(disputedRows).toHaveLength(2);
  });

  it('EvidenceDial_TwoCampDisagreement_KeepsBothMarkersAtTheirTrueYears', () => {
    // The camps sit at their true x on the axis — a 1991 marker and a 2018 marker,
    // not one collapsed to the earliest-surviving value.
    const root = document.createElement('div');
    CALLSIGN_SECTION_REGISTRY['the-evidence-dial'].mount(root, cm({ dial: g8nnz() }));
    const markers = [...root.querySelectorAll('.scale .ev:not(.state)')];
    expect(markers).toHaveLength(2);
  });

  it('ExpandDisputedEvents_WhenAKindHasTwoCamps_YieldsAClaimPerCampInDayOrder', () => {
    const events = [{ day: '2018-10-18', label: 'licence-version start', kindId: 'licence-version-original-start', state: false, assertedBy: [] }];
    const disagreements = [{
      kindLabel: 'licence-version start',
      camps: [
        { day: '1991-07-26', datasets: [{ title: '2020 register', href: '#', vintage: '2020-05-01' }] },
        { day: '2018-10-18', datasets: [{ title: '2024 register', href: '#', vintage: '2024-10-01' }] },
      ],
    }];
    const out = expandDisputedEvents(events, disagreements);
    expect(out.map((e) => e.day)).toEqual(['1991-07-26', '2018-10-18']);
    expect(out.every((e) => e.disputed === true)).toBe(true);
  });

  it('ExpandDisputedEvents_WhenAKindHasThreeCamps_YieldsThreeDistinctClaims', () => {
    const events = [{ day: '2018-10-18', label: 'licence-version start', kindId: 'licence-version-original-start', state: false, assertedBy: [] }];
    const disagreements = [{
      kindLabel: 'licence-version start',
      camps: [
        { day: '1991-07-26', datasets: [{ title: 'a', href: '#', vintage: '2020-05-01' }] },
        { day: '2005-03-03', datasets: [{ title: 'b', href: '#', vintage: '2022-05-01' }] },
        { day: '2018-10-18', datasets: [{ title: 'c', href: '#', vintage: '2024-10-01' }] },
      ],
    }];
    const out = expandDisputedEvents(events, disagreements);
    expect(out).toHaveLength(3);
    expect(out.map((e) => e.day)).toEqual(['1991-07-26', '2005-03-03', '2018-10-18']);
  });

  it('EventTimeline_WithinKindDisagreement_RendersARailEntryPerCamp', () => {
    const root = document.createElement('div');
    CALLSIGN_SECTION_REGISTRY['event-timeline'].mount(root, cm({ dial: g8nnz() }));
    expect(root.querySelectorAll('.timeline .track .evt.disputed')).toHaveLength(2);
  });

  it('EvidenceDial_HeavyDisagreement_RendersEveryCampGrowsThePanelAndNudges', () => {
    // Heavy disagreement is designed behaviour (issue #921): no cap, the layout
    // machinery absorbs the density (five near-dated disputed markers take tiers
    // 0-4 and grow the panel past the compact default), and a high-density nudge
    // invites the reader into the narrative.
    const camps = ['2018-06-01', '2018-06-02', '2018-06-03', '2018-06-04', '2018-06-05']
      .map((day, i) => ({ day, datasets: [{ title: 'vintage ' + i, href: '#', vintage: '20' + (20 + i) + '-01-01' }] }));
    const dial = {
      hasEvents: true,
      events: [{ day: '2018-06-05', label: 'licence-version start', kindId: 'licence-version-original-start', state: false, assertedBy: [] }],
      sightings: [{ vintage: '2026-06-23' }],
      disagreements: [{ kindLabel: 'licence-version start', camps }],
    };
    expect(disputedClaimCount(dial.disagreements)).toBe(5);
    const root = document.createElement('div');
    CALLSIGN_SECTION_REGISTRY['the-evidence-dial'].mount(root, cm({ dial }));
    // All five distinct claims render as disputed markers — none summarised away.
    expect(root.querySelectorAll('.scale .ev.disputed')).toHaveLength(5);
    // The panel grew to absorb the near-dated density (composed height > default).
    const scaleH = parseInt(root.querySelector<HTMLElement>('.scale')?.style.getPropertyValue('--scale-h') ?? '0', 10);
    expect(scaleH).toBeGreaterThan(210);
    // The high-density "examine" nudge appears and routes into the narrative.
    const nudge = root.querySelector('.dial-dispute-nudge');
    expect(nudge?.textContent).toContain('5');
    expect(nudge?.querySelector('.nudge-cta')?.getAttribute('href')).toBe('#record-disagreements');
  });

  it('EventTimeline_OriginSemanticRow_CarriesTheSourcedOriginalStartInterpretation', () => {
    // The origin narrative carries the held, cited interpretation of the
    // original-start field (item 5), hedged where the reading is not confirmed
    // for every record.
    const root = document.createElement('div');
    const asserted = [{ title: 'Ofcom register snapshot', href: '#', vintage: '2026-06-23', nrows: 1 }];
    const dial = {
      hasEvents: true,
      events: [
        { day: '2018-10-18', label: 'licence issued', kindId: 'licence-issued', state: false, assertedBy: asserted },
        { day: '2018-10-18', label: 'licence original start — the earliest surviving in the asserting vintage', kindId: 'licence-original-start', state: false, assertedBy: asserted },
        { day: '2018-10-18', label: 'licence-version start — the earliest surviving in the asserting vintage', kindId: 'licence-version-original-start', state: false, assertedBy: asserted },
      ],
    };
    CALLSIGN_SECTION_REGISTRY['event-timeline'].mount(root, cm({ dial }));
    const originRow = root.querySelector('.timeline .tl.origin');
    expect(originRow?.textContent).toContain('how the original-start date is read');
    expect(originRow?.textContent).toContain('Licence-View field dictionary');
    expect(originRow?.textContent).toContain('not confirmed');
  });
});

// The owner-reported round-4 defects and the batch minors (issue #921). The dial
// pip/axis alignment and the anatomy spacing are layout relations the stylesheet
// binds, so they are asserted against shell.css (the same approach the C1 grid
// tests use); the input-retention rule is asserted through its own seam.
describe('v1 round-4 fixes and minors (issue #921)', { tags: ['ui'] }, () => {
  const shellCss = fs.readFileSync('site/v1/shell.css', 'utf8');
  const tokensCss = fs.readFileSync('site/v1/tokens.css', 'utf8');

  it('EvidenceDial_WhenGrownHeadroom_SightingPipsHangFromTheComposedAxisOffset', () => {
    // Round-4 regression: near-dated captions grow the panel headroom and slide
    // the axis DOWN (a larger --axis-top), but the downward sighting pips stayed
    // pinned to the old compact 136px and detached from the axis line. Every
    // axis-anchored element — baseline, event stems, year ticks, state terminus
    // AND the sighting track — must read the one composed --axis-top offset.
    const camps = ['2018-06-01', '2018-06-02', '2018-06-03', '2018-06-04', '2018-06-05']
      .map((day, i) => ({ day, datasets: [{ title: 'vintage ' + i, href: '#', vintage: '20' + (20 + i) + '-01-01' }] }));
    const dial = {
      hasEvents: true,
      events: [{ day: '2018-06-05', label: 'licence-version start', kindId: 'licence-version-original-start', state: false, assertedBy: [] }],
      sightings: [{ vintage: '2026-06-23' }, { vintage: '2024-01-01' }],
      disagreements: [{ kindLabel: 'licence-version start', camps }],
    };
    const root = document.createElement('div');
    CALLSIGN_SECTION_REGISTRY['the-evidence-dial'].mount(root, cm({ dial }));
    const scale = root.querySelector<HTMLElement>('.scale');
    const axisTop = parseInt(scale?.style.getPropertyValue('--axis-top') ?? '0', 10);
    // The headroom grew, so the axis is pushed below the compact default.
    expect(axisTop).toBeGreaterThan(136);
    // The downward sighting pips are drawn on this grown composition …
    expect(root.querySelectorAll('.scale .si').length).toBeGreaterThan(0);
    // … and the stylesheet anchors that sighting track to the SAME composed
    // --axis-top the axis and event track use, so the pips follow the shift.
    expect(shellCss).toMatch(/\.scale \.si\{position:absolute;top:var\(--axis-top,136px\)\}/);
  });

  it('Anatomy_RoleEyebrow_IsSeparatedFromTheDescriptionByAStackedGap', () => {
    // The eyebrow ran straight into the description ("PREFIXThe UK country
    // block"). The meaning block now stacks vertically with a gap, so the role
    // label and the description are visibly separated rows, not run-together
    // inline text.
    expect(shellCss).toMatch(/\.anat \.m\{[^}]*flex-direction:column[^}]*\}/);
    expect(shellCss).toMatch(/\.anat \.m\{[^}]*gap:[^}]*\}/);
    // The role remains a block so it never abuts the description inline.
    expect(shellCss).toMatch(/\.anat \.m \.role\{[^}]*display:block[^}]*\}/);
  });

  it('SurfaceElevation_Token_IsBumpedForVisibleLiftOnThePlainGround', () => {
    // C2: the near-flat original shadow lost the floating-card intent on the
    // plain ground; the elevation token now carries more alpha and a wider,
    // softer second layer.
    expect(tokensCss).toMatch(/--elevation:0 1px 2px rgba\(17,24,35,\.16\),0 4px 12px rgba\(17,24,35,\.11\)/);
  });

  it('PrimaryNav_Stylesheet_SitsAtA14pxReadingAboveTheLegibilityFloor', () => {
    // C3: the top-level journey nav was at the ~12px floor; it now reads at 14px.
    expect(shellCss).toMatch(/nav\.journeys a\{[^}]*font-size:14px/);
  });

  it('MobileDial_Stylesheet_SignalsHorizontalScrollAndGivesControls44pxTouchTargets', () => {
    // A5: the instrument scrolls horizontally on a narrow viewport. Edge shadows
    // (background-attachment:local) make that scroll discoverable, and the
    // highlight controls become ≥44px touch targets on small screens.
    expect(shellCss).toMatch(/\.dial\{[^}]*background-attachment:local,local,scroll,scroll[^}]*\}/);
    expect(shellCss).toMatch(/\.dial-ctl button\{min-height:44px/);
  });
});

// The lookup box must never discard the reader's entered callsign, whatever the
// resolution concludes: after a not-found, an invalid format or a shard-fetch
// failure the typed callsign stays put so a typo is fixed in place, not retyped
// (issue #921). Preservation happens once at entry — before any resolution — so
// it structurally covers every downstream path.
describe('v1 lookup input retention (issue #921)', { tags: ['ui'] }, () => {
  function lookupBox(): HTMLInputElement {
    document.body.innerHTML = '<input id="csq" class="lk-in" placeholder="e.g. M7TEE">';
    return document.getElementById('csq') as HTMLInputElement;
  }

  it('LookupInput_AfterNotFoundLookup_RetainsTheEnteredCallsign', () => {
    const input = lookupBox();
    preserveLookupInput(document, 'M7ZZZ');
    expect(input.value).toBe('M7ZZZ');
  });

  it('LookupInput_AfterInvalidFormat_RetainsTheEnteredCallsign', () => {
    const input = lookupBox();
    preserveLookupInput(document, '!!bad!!');
    expect(input.value).toBe('!!bad!!');
  });

  it('LookupInput_AfterShardFetchFailure_RetainsTheEnteredCallsign', () => {
    // Set at entry, before any fetch, so a later fetch failure cannot empty it.
    const input = lookupBox();
    preserveLookupInput(document, 'G4ABC');
    expect(input.value).toBe('G4ABC');
  });

  it('LookupInput_WhenNoCallsignEntered_LeavesThePlaceholderShowing', () => {
    const input = lookupBox();
    preserveLookupInput(document, '   ');
    expect(input.value).toBe('');
  });
});

// Coined vocabulary and provenance chips become click-toggled popovers with the
// definition inline — the interaction grammar for jargon (issue #921, B1). The
// popover is a plain <details> so it works with no script; the enhancement makes
// the set well-mannered (one open at a time, Escape-dismissable).
describe('v1 glossary popovers (issue #921, B1)', { tags: ['ui'] }, () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('ProvenanceChip_Rendered_KeepsItsChipTextAndCarriesTheMechanismDefinition', () => {
    // The chip still reads "derived"; clicking it now explains what that means,
    // naming the mechanism (computed by the mirror) — never a verdict.
    const chip = provenanceChip('derived');
    expect(chip.matches('details.term.prov-term')).toBe(true);
    expect(chip.querySelector('.tb')?.textContent).toBe('derived');
    expect(chip.querySelector('.pop')?.textContent).toContain('computed by the mirror');
  });

  it('InlineTerm_WithNoScript_RevealsItsDefinitionOnTheOpenState', () => {
    // The no-JS baseline: a plain <details> whose definition shows when open, so
    // the affordance never depends on the enhancement script.
    const term = inlineTerm('sighting');
    document.body.appendChild(term);
    expect(term.querySelector('summary')?.textContent).toBe('sighting');
    term.open = true;
    expect(term.querySelector('.pop')?.textContent).toContain('archived publication');
  });

  it('TermPopovers_WhenOneOpens_TheOthersClose', () => {
    const a = inlineTerm('vintage');
    const b = inlineTerm('publication');
    document.body.append(a, b);
    wireTermPopovers(document);
    a.open = true; a.dispatchEvent(new Event('toggle'));
    b.open = true; b.dispatchEvent(new Event('toggle'));
    expect(a.open).toBe(false);
    expect(b.open).toBe(true);
  });

  it('TermPopovers_OnEscape_AllClose', () => {
    const a = termCue('eventTime');
    document.body.appendChild(a);
    wireTermPopovers(document);
    a.open = true; a.dispatchEvent(new Event('toggle'));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(a.open).toBe(false);
  });

  it('EvidenceDial_InferredFinding_IsAClickTogglePopoverNotBarePlainText', () => {
    const root = document.createElement('div');
    CALLSIGN_SECTION_REGISTRY['the-evidence-dial'].mount(root, cm({
      dial: {
        hasEvents: true,
        events: [{ day: '2021-04-16', label: 'licence issued', state: false, assertedBy: [] }],
        sightings: [{ vintage: '2026-06-23' }],
        findings: [{ statement: 'One licence: originated 2021-04-16', caveats: [] }],
      },
    }));
    const finding = root.querySelector('.dial-finding');
    expect(finding?.querySelector('details.term.prov-term .tb')?.textContent).toBe('inferred');
    expect(finding?.querySelector('.pop')?.textContent).toContain('interprets from the held values');
  });

  it('RawDataPage_FoldAndProjection_AreGlossedAtFirstUse', () => {
    // D1: the raw-data guide introduces its internal "fold" metaphor and
    // "projection" with plain-English first-use glosses so a non-specialist can
    // decode them.
    const html = fs.readFileSync('site/v1/how-to-get-the-raw-data.html', 'utf8');
    expect(html).toContain('the build step that assembles each database from the raw files');
    expect(html).toContain('a rebuild from the raw files, never a re-interpretation');
  });

  it('EvidenceDial_TrackLabels_KeepTheirVerbatimGlossAndGainAPopoverCue', () => {
    // The one-line gloss stays verbatim in the prose (the cue is a trailing
    // sibling), and a "?" cue opens the fuller definition as a popover.
    const root = document.createElement('div');
    CALLSIGN_SECTION_REGISTRY['the-evidence-dial'].mount(root, cm({
      dial: { hasEvents: true, events: [{ day: '2021-04-16', label: 'licence issued', state: false, assertedBy: [] }], sightings: [{ vintage: '2026-06-23' }] },
    }));
    const evLab = root.querySelector('.tracklab.event');
    expect(evLab?.querySelector('details.term.cue')).not.toBeNull();
    // The verbatim gloss is still contiguous within the label text.
    expect(evLab?.textContent).toContain(EVENT_TIME_GLOSS);
  });
});
