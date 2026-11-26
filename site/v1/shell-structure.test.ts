// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { assertNonEmpty } from '../../src/testing/non-vacuity.ts';
import { renderHomeSections, defaultHomeModel } from './home-sections.js';
import { renderStatic as renderTimelineStatic } from './timeline-sections.js';

// The shared shell's structure, held on every page the v1 surface serves at
// the site root (the deploy copies site/v1/*.html there, so that glob IS the
// set). Three things a visitor meets before any page-specific content:
// - a skip link, first in tab order, so a keyboard user is not made to walk
//   the seven-link journey nav on every page;
// - section titles that are headings, so a heading list gives an outline of
//   the page rather than its title alone;
// - a description of the page for anything that previews a link to it.
// Test names follow Subject_Scenario_Outcome per project convention.

const V1 = path.join('site', 'v1');
const PAGES = fs.readdirSync(V1).filter((f) => f.endsWith('.html')).sort();
const read = (file: string): string => fs.readFileSync(path.join(V1, file), 'utf8');
const parse = (html: string): Document => new DOMParser().parseFromString(html, 'text/html');

// The not-found page is served at whatever path was missed, so it carries a
// <base href> to resolve its assets and nav from any depth. A fragment-only
// link resolves against that base too: "#main" there means the home page's
// main, so a skip link would navigate away from the page it sits on.
const BASE_HREF_PAGES = new Set(['404.html']);

// ---------------------------------------------------------------------------
// Skip link

const FOCUSABLE = 'a[href], button, input, select, textarea, summary, [tabindex]';

/** Why a page's skip link does not work, or [] when it does. */
function skipLinkFaults(doc: Document): string[] {
  const faults: string[] = [];
  const first = doc.body.querySelector(FOCUSABLE);
  if (first === null || !first.matches('a.skip')) {
    faults.push(`first focusable is ${first === null ? 'nothing' : first.outerHTML.slice(0, 60)}, not a.skip`);
    return faults;
  }
  if (first.parentElement !== doc.body) faults.push('skip link is not a direct child of body, so a shell re-mount can remove it');
  const href = first.getAttribute('href') ?? '';
  if (!href.startsWith('#') || href.length === 1) {
    faults.push(`skip link href ${href} is not an in-page fragment`);
    return faults;
  }
  const target = doc.getElementById(href.slice(1));
  if (target === null) faults.push(`skip link target ${href} does not exist`);
  else if (target.tagName !== 'MAIN') faults.push(`skip link target ${href} is a ${target.tagName}, not the main landmark`);
  // Focus must move to the target, not only the viewport: without tabindex a
  // landmark is not focusable, focus stays on the body, and where the next Tab
  // lands is left to each browser's sequential-navigation starting point.
  else if (target.getAttribute('tabindex') !== '-1') faults.push(`skip link target ${href} is not programmatically focusable (tabindex="-1")`);
  if (doc.querySelectorAll('main').length !== 1) faults.push(`page has ${doc.querySelectorAll('main').length} main elements`);
  if ((first.textContent ?? '').trim() === '') faults.push('skip link has no text');
  return faults;
}

describe('skipLinkFaults (the checker itself, on constructed pages)', { tags: ['unit'] }, () => {
  it('SkipLinkFaults_WhenTheSkipLinkIsFirstAndLandsOnMain_ReportsNothing', () => {
    expect(skipLinkFaults(parse('<a class="skip" href="#main">Skip to content</a><nav><a href="x">X</a></nav><main id="main" tabindex="-1"></main>'))).toEqual([]);
  });

  it('SkipLinkFaults_WhenTheMainLandmarkCannotTakeFocus_ReportsIt', () => {
    expect(skipLinkFaults(parse('<a class="skip" href="#main">Skip</a><main id="main"></main>'))).toEqual(['skip link target #main is not programmatically focusable (tabindex="-1")']);
  });

  it('SkipLinkFaults_WhenANavLinkPrecedesIt_ReportsTheFirstFocusable', () => {
    expect(skipLinkFaults(parse('<nav><a href="x">X</a></nav><a class="skip" href="#main">Skip</a><main id="main"></main>'))).toHaveLength(1);
  });

  it('SkipLinkFaults_WhenItSitsInsideTheRemountedHeaderHost_ReportsIt', () => {
    expect(skipLinkFaults(parse('<div id="sitebar"><a class="skip" href="#main">Skip</a></div><main id="main" tabindex="-1"></main>'))).toEqual(['skip link is not a direct child of body, so a shell re-mount can remove it']);
  });

  it('SkipLinkFaults_WhenTheTargetIsMissingOrNotMain_ReportsEach', () => {
    expect(skipLinkFaults(parse('<a class="skip" href="#main">Skip</a><main></main>'))).toEqual(['skip link target #main does not exist']);
    expect(skipLinkFaults(parse('<a class="skip" href="#main">Skip</a><div id="main"></div><main></main>'))).toEqual(['skip link target #main is a DIV, not the main landmark']);
  });

  it('SkipLinkFaults_WhenThePageHasNoFocusableAtAll_ReportsIt', () => {
    expect(skipLinkFaults(parse('<main id="main"><p>Text</p></main>'))).toEqual(['first focusable is nothing, not a.skip']);
  });
});

describe('v1 shell - skip link on every page', { tags: ['ui'] }, () => {
  it('V1Pages_TheSetChecked_IsEveryRootServedPage', () => {
    assertNonEmpty(PAGES, 'site/v1/*.html');
    expect(PAGES).toEqual(expect.arrayContaining(['index.html', 'callsign.html', 'on-this-day.html', 'timeline.html', 'how-to-get-the-raw-data.html', 'glossary.html', 'anatomy.html', '404.html']));
  });

  it('V1Pages_WhenFirstTabbedInto_OfferASkipLinkThatLandsOnTheMainLandmark', () => {
    const checked = PAGES.filter((p) => !BASE_HREF_PAGES.has(p));
    assertNonEmpty(checked, 'pages with a skip link');
    // Every page's faults at once, so one failing page does not hide the next.
    expect(Object.fromEntries(checked.map((page) => [page, skipLinkFaults(parse(read(page)))]).filter(([, f]) => f.length > 0))).toEqual({});
  });

  it('NotFoundPage_BecauseItResolvesFragmentsAgainstItsBaseHref_CarriesNoSkipLinkThatWouldLeaveThePage', () => {
    for (const page of BASE_HREF_PAGES) {
      const doc = parse(read(page));
      // If the base goes, this page should gain the skip link like the rest.
      expect(doc.querySelector('base[href]'), page).not.toBeNull();
      expect(doc.querySelector('a.skip'), page).toBeNull();
    }
  });

  it('ShellStylesheet_SkipLink_IsHiddenUntilFocusedAndThenShown', () => {
    const css = read('shell.css');
    const rule = (selector: RegExp): string => {
      const m = new RegExp(`(?:^|\\})\\s*${selector.source}\\s*\\{([^}]*)\\}`, 'm').exec(css);
      return m?.[1] ?? '';
    };
    const top = (decls: string): number | null => {
      const m = /(?:^|;)\s*top:(-?[\d.]+)(px|rem)/.exec(decls);
      return m === null ? null : Number(m[1]) * (m[2] === 'rem' ? 16 : 1);
    };
    // At rest it sits above the top of the page, wholly off-screen.
    expect(rule(/\.skip/)).toMatch(/position:absolute/);
    expect(top(rule(/\.skip/)) ?? 0).toBeLessThan(-40);
    // Shown on any focus, not only :focus-visible, so a pointer user who tabs
    // after clicking still sees where focus is: focused, it comes back on screen.
    expect(top(rule(/\.skip:focus/)) ?? -1).toBeGreaterThanOrEqual(0);
  });

  it('ShellStylesheet_MainLandmarkFocusedBySkipLink_DrawsNoOutlineRoundThePage', () => {
    // Focus lands on main so the next Tab starts there; it is not a control, so
    // it is not outlined.
    expect(read('shell.css')).toMatch(/(?:^|\})\s*main\[tabindex="-1"\]:focus\s*\{[^}]*outline:none/m);
  });
});

// ---------------------------------------------------------------------------
// Headings

// Content an HTML heading may not hold (a heading takes phrasing content
// only): a disclosure or a form control inside one also lands in the
// heading's accessible name.
const NOT_IN_A_HEADING = 'details, summary, button, input, select, textarea';

/** Why a rendered page or region does not give a sane outline, or [] when it does. */
function outlineFaults(root: ParentNode, opts: { h1: number | null }): string[] {
  const faults: string[] = [];
  const headings = [...root.querySelectorAll('h1, h2, h3, h4, h5, h6')];
  const h1s = headings.filter((h) => h.tagName === 'H1');
  if (opts.h1 !== null && h1s.length !== opts.h1) faults.push(`${h1s.length} h1 elements, expected ${opts.h1}`);
  for (const lbl of root.querySelectorAll('.lbl')) {
    const isHeading = lbl.tagName === 'H2' || [...lbl.children].some((c) => c.tagName === 'H2');
    if (!isHeading) faults.push(`section label "${(lbl.textContent ?? '').trim()}" is a ${lbl.tagName} with no heading`);
  }
  for (const h of root.querySelectorAll('[role="heading"]')) faults.push(`"${(h.textContent ?? '').trim()}" is a heading by role, not by element`);
  let previous = 0;
  for (const h of headings) {
    const level = Number(h.tagName[1]);
    if (previous > 0 && level > previous + 1) faults.push(`"${(h.textContent ?? '').trim()}" jumps from h${previous} to h${level}`);
    previous = level;
    if ((h.textContent ?? '').trim() === '') faults.push(`an empty h${level}`);
    const inside = h.querySelector(NOT_IN_A_HEADING);
    if (inside !== null) faults.push(`h${level} "${(h.textContent ?? '').trim()}" holds a ${inside.tagName}`);
  }
  return faults;
}

describe('outlineFaults (the checker itself, on constructed pages)', { tags: ['unit'] }, () => {
  const body = (html: string): HTMLElement => parse(html).body;

  it('OutlineFaults_WhenEveryLabelIsAHeadingUnderOneTitle_ReportsNothing', () => {
    expect(outlineFaults(body('<h1>T</h1><h2 class="lbl">a</h2><h3>x</h3><div class="lbl"><h2>b</h2><span class="ax">c<details><summary>?</summary></details></span></div>'), { h1: 1 })).toEqual([]);
  });

  it('OutlineFaults_WhenALabelIsAStyledDiv_ReportsThatLabel', () => {
    expect(outlineFaults(body('<h1>T</h1><div class="lbl">the evidence</div>'), { h1: 1 })).toEqual(['section label "the evidence" is a DIV with no heading']);
  });

  it('OutlineFaults_WhenALabelIsAHeadingOnlyByRole_ReportsIt', () => {
    expect(outlineFaults(body('<h1>T</h1><div class="lbl" role="heading" aria-level="2">x</div>'), { h1: 1 })).toEqual([
      'section label "x" is a DIV with no heading',
      '"x" is a heading by role, not by element',
    ]);
  });

  it('OutlineFaults_WhenTheTitleIsMissingOrDoubled_ReportsTheCount', () => {
    expect(outlineFaults(body('<h2>a</h2>'), { h1: 1 })).toEqual(['0 h1 elements, expected 1']);
    expect(outlineFaults(body('<h1>a</h1><h1>b</h1>'), { h1: 1 })).toEqual(['2 h1 elements, expected 1']);
  });

  it('OutlineFaults_WhenALevelIsSkippedOrAHeadingHoldsADisclosure_ReportsEach', () => {
    expect(outlineFaults(body('<h1>T</h1><h3>deep</h3>'), { h1: 1 })).toEqual(['"deep" jumps from h1 to h3']);
    expect(outlineFaults(body('<h1>T</h1><h2>a<details><summary>?</summary></details></h2>'), { h1: 1 })).toEqual(['h2 "a?" holds a DETAILS']);
  });
});

describe('v1 shell - headings on every page', { tags: ['ui'] }, () => {
  beforeEach(() => { document.body.replaceChildren(); });

  it('V1Pages_AsServed_GiveAnOutlineOfSectionHeadingsUnderOneTitle', () => {
    // Every page's faults at once, so one failing page does not hide the next.
    expect(Object.fromEntries(PAGES.map((page) => [page, outlineFaults(parse(read(page)).body, { h1: 1 })]).filter(([, f]) => f.length > 0))).toEqual({});
  });

  it('HomePage_WhenItsScriptRendersTheSections_EverySectionLabelIsAHeading', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    renderHomeSections(root, defaultHomeModel());
    assertNonEmpty([...root.querySelectorAll('.lbl')], 'home section labels');
    expect(outlineFaults(root, { h1: 1 })).toEqual([]);
  });

  it('TimelinePage_WhenRenderedFromItsManifest_EverySectionLabelIsAHeadingAndNoneHoldsTheGlossaryCue', () => {
    const surface = renderTimelineStatic({
      schemaVersion: 1,
      asAt: '2020-06-23',
      datasets: [{ key: 'a', vintage: '2020-06-23', title: 'A' }],
      kinds: [{ id: 'licence-cancelled', label: 'licence cancelled' }],
      caveats: [],
      histograms: { 'licence-cancelled': [['2019', 1], ['2020', 0]] },
      totals: { 'licence-cancelled': 1 },
      buckets: [
        { year: '2019', perKind: { 'licence-cancelled': 1 }, startsToDate: 0, activeReservations: 0, topSeries: [], datasetIdxs: [0], caveatIds: [] },
        { year: '2020', perKind: {}, startsToDate: 0, activeReservations: 0, topSeries: [], datasetIdxs: [], caveatIds: [] },
      ],
    } as never);
    const host = document.createElement('main');
    const title = document.createElement('h1');
    title.textContent = 'Timeline';
    host.append(title, surface);
    assertNonEmpty([...surface.querySelectorAll('.lbl')], 'timeline section labels');
    expect(outlineFaults(host, { h1: 1 })).toEqual([]);
    // The event-time cue stays beside its label rather than being dropped.
    expect(surface.querySelector('.lbl details.term.cue')).not.toBeNull();
  });

  it('ShellStylesheet_SectionLabel_CarriesNoHeadingWeightAndNoPageRestatesIt', () => {
    // One rule in the shell, so a label reads the same whether it is an h2 or a
    // div wrapping one, on every page. Page-local copies drift: the raw-data
    // page's labels rendered bold while the glossary's did not.
    const css = read('shell.css');
    const lbl = /(?:^|\})\s*\.lbl\s*\{([^}]*)\}/m.exec(css)?.[1] ?? '';
    expect(lbl).toMatch(/font-weight:400/);
    for (const page of PAGES) {
      const styles = [...parse(read(page)).querySelectorAll('style')]
        .map((s) => (s.textContent ?? '').replace(/\/\*[^]*?\*\//g, '')).join('\n');
      expect(styles, page).not.toMatch(/\.lbl\b/);
      expect(styles, page).not.toMatch(/\.hx-/);
    }
  });
});

// ---------------------------------------------------------------------------
// Descriptions

describe('v1 shell - a description on every page', { tags: ['ui'] }, () => {
  const descriptions = (): Map<string, string> => {
    const out = new Map<string, string>();
    for (const page of PAGES) {
      const metas = parse(read(page)).querySelectorAll('meta[name="description"]');
      expect(metas.length, page).toBe(1);
      out.set(page, (metas[0]?.getAttribute('content') ?? '').trim());
    }
    return out;
  };

  it('V1Pages_EachCarry_OneNonEmptyDescriptionOfTheirOwn', () => {
    const all = descriptions();
    assertNonEmpty([...all.keys()], 'pages with descriptions');
    for (const [page, text] of all) {
      expect(text.length, page).toBeGreaterThanOrEqual(50);
      // Search results and link previews cut text at about 155 to 160
      // characters, mid-sentence.
      expect(text.length, page).toBeLessThanOrEqual(155);
    }
    expect(new Set(all.values()).size).toBe(all.size);
  });

  it('V1Pages_Descriptions_StateNoFigureOrDateThatTheNextPublicationWouldMakeFalse', () => {
    // A description is written once and read for as long as the page stands;
    // the figures and dates the pages state are stamped from the data instead.
    for (const [page, text] of descriptions()) expect(text, page).not.toMatch(/\d/);
  });

  it('V1Pages_Descriptions_AreTypedInPlainKeyboardCharacters', () => {
    for (const [page, text] of descriptions()) expect(text, page).toMatch(/^[\x20-\x7e]+$/);
  });
});
