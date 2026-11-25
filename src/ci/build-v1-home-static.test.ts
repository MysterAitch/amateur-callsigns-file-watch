import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { JSDOM } from 'jsdom';
import {
  buildV1HomeStatic,
  homeSectionHtml,
  HOME_REGION_START,
  HOME_REGION_END,
  STAMPED_HOME_SECTIONS,
} from './build-v1-home-static.ts';
import { homeHoldings } from './build-home-holdings.ts';
import { stampMarkedRegion } from './static-region.ts';
import {
  defaultHomeModel,
  enhanceHomeModel,
  parseHoldings,
  renderHomeSections,
  remountManifestSections,
} from '../../site/v1/home-sections.js';
import { renderDocument } from '../../site/v1/el.js';

// The home page's no-script baseline, stamped at deploy from the holdings
// manifest the page's script reads. Before this step existed the baseline was
// hand-written: after the 22 September 2026 publication the page served with no
// script went on saying 158,318 callsigns and naming 23 June 2026 as the newest
// publication, two months after both had stopped being true.
//
// The fixtures are invented figures (a 2027 vintage, 4,323 records) that appear
// nowhere in the source, so a pass cannot come from a hand-written constant. The
// expected values are written beside each fixture before any run.
//
// Test names follow Subject_Scenario_Outcome.

type Dataset = { lane: 'open-data' | 'foi'; vintage: string | null; title: string; classes: string[]; rows: number; unkeyable?: number };

// Three publications 2013 to 2027; the newest register snapshot holds
// 4,321 keyable rows and 2 unkeyable ones, so 4,323 records.
// Known answers: publications 3; "folded, 2013–2027"; callsigns 4,323;
// span held 14y; latest snapshot 2027-03-16 / March 2027; read as of
// 16 March 2027. The seed 2027-03-16 rotates the from-the-record pool to its
// first fact (character codes sum to 495, and 495 mod 3 is 0), so the
// newest-publication sentence leads.
const MARCH_2027: Dataset[] = [
  { lane: 'foi', vintage: '2013-09-06', title: 'available pool', classes: ['available-pool'], rows: 100 },
  { lane: 'open-data', vintage: '2019-05-01', title: 'Ofcom open data, 2019-05-01', classes: ['register-snapshot'], rows: 5000 },
  { lane: 'open-data', vintage: '2027-03-16', title: 'Ofcom open data, 2027-03-16', classes: ['register-snapshot'], rows: 4321, unkeyable: 2 },
];

// A newer register arriving after MARCH_2027. Known answers: publications 4;
// callsigns 5,000; latest snapshot 2027-09-19; read as of 19 September 2027.
// Its seed sums to 504, also 0 mod 3, so the newest-publication sentence leads.
const SEPTEMBER_2027: Dataset[] = [
  ...MARCH_2027,
  { lane: 'open-data', vintage: '2027-09-19', title: 'Ofcom open data, 2027-09-19', classes: ['register-snapshot'], rows: 5000 },
];

// The figures the committed page and the page's script defaults carry. None of
// them may survive a stamp from a manifest that says otherwise.
const HAND_WRITTEN_DEFAULTS = ['158,318', '2026-06-23', '23 June 2026', 'June 2026', '65 held', '65 publications'];

function holdingsJson(datasets: Dataset[]): string {
  return JSON.stringify(homeHoldings(datasets, [{ prefix: 'M9', introduced: '2026-01', notes: 'Introduced January 2026.' }]));
}

function committedPage(): string {
  return fs.readFileSync(path.join('site', 'v1', 'index.html'), 'utf8');
}

function scaffold(manifest: string | null, page: string = committedPage()): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v1-home-static-'));
  if (manifest !== null) fs.writeFileSync(path.join(dir, 'holdings.json'), manifest);
  fs.writeFileSync(path.join(dir, 'index.html'), page);
  return dir;
}

/** The stamped home page as a reader with no script receives it. */
function served(dir: string): Document {
  return new JSDOM(fs.readFileSync(path.join(dir, 'index.html'), 'utf8')).window.document;
}

const norm = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();

function glanceCells(scope: ParentNode): string[] {
  return [...scope.querySelectorAll('section[data-section="at-a-glance"] .readout .cell')]
    .map(c => `${norm(c.querySelector('.k')?.textContent)} | ${norm(c.querySelector('.v')?.textContent)} | ${norm(c.querySelector('.u')?.textContent)}`);
}

function fromTheRecord(scope: ParentNode): string {
  return norm(scope.querySelector('section[data-section="from-the-record"] .body')?.textContent);
}

describe('build-v1-home-static - the home page served with no script', { tags: ['unit'] }, () => {
  it('HomePage_WhenServedWithNoScript_StatesTheFiguresOfTheManifestItWasBuiltFrom', () => {
    const dir = scaffold(holdingsJson(MARCH_2027));
    buildV1HomeStatic(dir);
    const doc = served(dir);
    expect(glanceCells(doc)).toEqual([
      'publications | 3 | folded, 2013–2027',
      'callsigns | 4,323 | latest register',
      'span held | 14y | 2013 → 2027',
      'latest snapshot | 2027-03-16 | March 2027',
    ]);
    expect(norm(doc.querySelector('.spandial .sd-foot')?.textContent)).toContain('read as of 16 March 2027');
    expect(fromTheRecord(doc)).toContain('The newest publication held (2027-03-16) records 4,323 callsigns');
  });

  it('HomePage_WhenServedWithNoScript_CarriesNoHandWrittenFigure', () => {
    const dir = scaffold(holdingsJson(MARCH_2027));
    buildV1HomeStatic(dir);
    const doc = served(dir);
    for (const id of STAMPED_HOME_SECTIONS) {
      const section = doc.querySelector(`section[data-section="${id}"]`);
      expect(section, id).not.toBeNull();
      const text = `${norm(section?.textContent)} ${section?.querySelector('.spandial')?.getAttribute('aria-label') ?? ''}`;
      for (const stale of HAND_WRITTEN_DEFAULTS) expect(text, `${id} still says ${stale}`).not.toContain(stale);
    }
  });

  it('HomePage_WhenServedWithNoScript_MatchesTheFiguresTheScriptDrawsFromTheSameManifest', () => {
    // The script's path: parse the very manifest bytes the stamp read, enhance
    // the default model, re-mount the manifest-derived sections.
    const manifest = holdingsJson(MARCH_2027);
    const dir = scaffold(manifest);
    buildV1HomeStatic(dir);
    const holdings = parseHoldings(JSON.parse(manifest));
    if (holdings === null) throw new Error('fixture manifest does not parse');
    const scripted = renderDocument().createElement('div');
    renderHomeSections(scripted, defaultHomeModel());
    remountManifestSections(scripted, enhanceHomeModel(defaultHomeModel(), holdings));

    const doc = served(dir);
    expect(glanceCells(doc)).toEqual(glanceCells(scripted));
    expect(fromTheRecord(doc)).toBe(fromTheRecord(scripted));
    // The milestone count is the one foot item the baseline does not carry,
    // because it does not draw the milestones.
    const foot = (scope: ParentNode): string[] => [...scope.querySelectorAll('.spandial .sd-foot > span')]
      .map(s => norm(s.textContent))
      .filter(t => !t.endsWith('register milestones'));
    expect(foot(doc)).toEqual(foot(scripted));
    expect(foot(doc)).toContain('read as of 16 March 2027');
  });

  it('HomePage_WhenServedWithNoScript_DrawsNoMarksAndSaysTheyComeWithTheScript', () => {
    // The marks carry pagination controls that do nothing without a script, so
    // the baseline keeps the axis and the figures and says the marks follow.
    const dir = scaffold(holdingsJson(MARCH_2027));
    buildV1HomeStatic(dir);
    const doc = served(dir);
    expect(doc.querySelectorAll('.sd-pip')).toHaveLength(0);
    expect(doc.querySelectorAll('section[data-section="at-a-glance"] button')).toHaveLength(0);
    expect(norm(doc.querySelector('.spandial .sd-note')?.textContent)).toContain('appear when the page’s script runs');
  });

  it('HomePage_WhenStamped_KeepsEverySectionTheManifestDoesNotChange', () => {
    const dir = scaffold(holdingsJson(MARCH_2027));
    buildV1HomeStatic(dir);
    const doc = served(dir);
    expect([...doc.querySelectorAll('#sections > section[data-section]')].map(s => s.getAttribute('data-section')))
      .toEqual(['lookup-hero', 'at-a-glance', 'ways-in', 'from-the-record', 'scope-disclaimer']);
    expect(doc.querySelector('form.lookup[action="callsign.html"]')).not.toBeNull();
  });
});

describe('build-v1-home-static - publications arriving and edge cases', { tags: ['unit'] }, () => {
  it('HomePage_WhenANewerPublicationArrives_RestampingLeavesNothingOfTheOlderOne', () => {
    const dir = scaffold(holdingsJson(MARCH_2027));
    buildV1HomeStatic(dir);
    fs.writeFileSync(path.join(dir, 'holdings.json'), holdingsJson(SEPTEMBER_2027));
    buildV1HomeStatic(dir);
    const doc = served(dir);
    expect(glanceCells(doc)).toEqual([
      'publications | 4 | folded, 2013–2027',
      'callsigns | 5,000 | latest register',
      'span held | 14y | 2013 → 2027',
      'latest snapshot | 2027-09-19 | September 2027',
    ]);
    expect(fromTheRecord(doc)).toContain('The newest publication held (2027-09-19) records 5,000 callsigns');
    const text = norm(doc.body.textContent);
    expect(text).not.toContain('4,323');
    expect(text).not.toContain('2027-03-16');
  });

  // The from-the-record lead rotates with the newest date. Known answers: the
  // seed 2027-03-14 sums to 493 (493 mod 3 is 1, the withheld-suffixes fact);
  // 2027-03-15 sums to 494 (mod 3 is 2, the M2 fact with its callsign link).
  // The 2026-09-22 publication lands on the M2 position.
  it.each([
    ['2027-03-14', '1,465 withheld suffixes', null],
    ['2027-03-15', 'M2 – reserved-only', 'callsign.html?c=M7TEE'],
  ])('HomePage_WhenTheNewestDateRotatesTo_%s_StampsThatFactAsTheScriptWould', (vintage, headline, href) => {
    const datasets = MARCH_2027.map(d => (d.vintage === '2027-03-16' ? { ...d, vintage, title: `Ofcom open data, ${vintage}` } : d));
    const dir = scaffold(holdingsJson(datasets));
    buildV1HomeStatic(dir);
    const doc = served(dir);
    expect(norm(doc.querySelector('section[data-section="from-the-record"] .big')?.textContent)).toBe(headline);
    expect(doc.querySelector('section[data-section="from-the-record"] a')?.getAttribute('href') ?? null).toBe(href);
    expect(fromTheRecord(doc)).not.toContain('158,318');
  });

  it('StampMarkedRegion_TwoRegionsAndAnUnclosedMarker_ReplacesEachClosedRegionAndNothingBetween', () => {
    const a = HOME_REGION_START('at-a-glance');
    const page = `head ${a} one ${HOME_REGION_END} middle ${a} two ${HOME_REGION_END} tail ${a} unclosed`;
    const { html, replaced } = stampMarkedRegion(page, a, HOME_REGION_END, 'NEW');
    expect(replaced).toBe(2);
    expect(html).toBe(`head ${a}\nNEW\n${HOME_REGION_END} middle ${a}\nNEW\n${HOME_REGION_END} tail ${a} unclosed`);
  });

  it('HomePage_StampedTwiceFromOneManifest_IsByteIdentical', () => {
    const dir = scaffold(holdingsJson(MARCH_2027));
    buildV1HomeStatic(dir);
    const first = fs.readFileSync(path.join(dir, 'index.html'));
    buildV1HomeStatic(dir);
    expect(fs.readFileSync(path.join(dir, 'index.html')).equals(first)).toBe(true);
  });

  it('HomePage_WhenTheNewestRegisterHoldsZeroRecords_StatesZeroAsTheScriptWould', () => {
    // The stamp's question is whether the page agrees with the manifest, so it
    // states what the manifest says. Whether an empty register should have
    // landed at all is a question for the data's own gates, before deploy.
    const empty = MARCH_2027.map(d => (d.vintage === '2027-03-16' ? { ...d, rows: 0, unkeyable: 0 } : d));
    const dir = scaffold(holdingsJson(empty));
    buildV1HomeStatic(dir);
    const doc = served(dir);
    expect(glanceCells(doc)).toContain('callsigns | 0 | latest register');
    expect(fromTheRecord(doc)).toContain('records 0 callsigns');
  });

  it('HomeSectionHtml_ForEveryStampedSection_ReparsesToTheTreeTheRenderBuilt', () => {
    const holdings = parseHoldings(JSON.parse(holdingsJson(MARCH_2027)));
    if (holdings === null) throw new Error('fixture manifest does not parse');
    const model = enhanceHomeModel(defaultHomeModel(), { ...holdings, publications: [], milestones: [] });
    for (const id of STAMPED_HOME_SECTIONS) expect(() => homeSectionHtml(model, id), id).not.toThrow();
  });
});

describe('build-v1-home-static - refusing to ship a stale baseline', { tags: ['unit'] }, () => {
  it('BuildV1HomeStatic_WhenTheManifestIsMissing_FailsTheBuild', () => {
    expect(() => buildV1HomeStatic(scaffold(null))).toThrow(/holdings\.json/);
  });

  it('BuildV1HomeStatic_WhenTheManifestIsNotJson_FailsTheBuild', () => {
    expect(() => buildV1HomeStatic(scaffold('{"count": 3,'))).toThrow(/holdings\.json/);
  });

  it('BuildV1HomeStatic_WhenTheManifestIsTheWrongShape_FailsTheBuild', () => {
    const wrong = JSON.stringify({ ...JSON.parse(holdingsJson(MARCH_2027)), count: 'three' });
    expect(() => buildV1HomeStatic(scaffold(wrong))).toThrow(/not the shape the home page reads/);
  });

  it('BuildV1HomeStatic_WhenNoRegisterSnapshotIsHeld_FailsRatherThanKeepTheHandWrittenTotal', () => {
    // Without a register the script keeps its hand-written callsign total; the
    // stamp must not put that figure into the page as if it were current.
    const noRegister = MARCH_2027.filter(d => !d.classes.includes('register-snapshot'));
    expect(() => buildV1HomeStatic(scaffold(holdingsJson(noRegister)))).toThrow(/register snapshot/);
  });

  it('BuildV1HomeStatic_WhenTheNewestPublicationHasNoFullDate_FailsRatherThanKeepTheHandWrittenDate', () => {
    const monthOnly = [...MARCH_2027, { lane: 'foi' as const, vintage: '2027-11', title: 'issuance events', classes: ['issuance-events'], rows: 12 }];
    expect(() => buildV1HomeStatic(scaffold(holdingsJson(monthOnly)))).toThrow(/full date/);
  });

  it('BuildV1HomeStatic_WhenThePageHasLostItsMarkers_FailsTheBuild', () => {
    const page = committedPage().split(HOME_REGION_START('from-the-record')).join('');
    expect(() => buildV1HomeStatic(scaffold(holdingsJson(MARCH_2027), page))).toThrow(/exactly one "from-the-record" region/);
  });

  it('BuildV1HomeStatic_WhenThePageCarriesARegionTwice_FailsTheBuild', () => {
    const page = committedPage().replace('</main>', `${HOME_REGION_START('at-a-glance')}\n${HOME_REGION_END}\n</main>`);
    expect(() => buildV1HomeStatic(scaffold(holdingsJson(MARCH_2027), page))).toThrow(/exactly one "at-a-glance" region/);
  });

  it('StampMarkedRegion_WhenTheRenderSpellsTheClosingMarker_RefusesRatherThanCorruptTheNextStamp', () => {
    // An attribute value is serialised with its angle brackets raw, so data in
    // a title could spell the closing marker and end the region early next time.
    const page = `${HOME_REGION_START('at-a-glance')}\nold\n${HOME_REGION_END}`;
    const hostile = `<section title="${HOME_REGION_END}"></section>`;
    expect(() => stampMarkedRegion(page, HOME_REGION_START('at-a-glance'), HOME_REGION_END, hostile)).toThrow(/closing marker/);
    expect(stampMarkedRegion(page, HOME_REGION_START('at-a-glance'), HOME_REGION_END, '<section></section>').replaced).toBe(1);
  });

  it('BuildV1HomeStatic_WhenTheHomePageIsNotDeployedYet_FailsTheBuild', () => {
    const dir = scaffold(holdingsJson(MARCH_2027));
    fs.rmSync(path.join(dir, 'index.html'));
    expect(() => buildV1HomeStatic(dir)).toThrow(/not found/);
  });
});

describe('build-v1-home-static - the committed page', { tags: ['unit'] }, () => {
  it('CommittedHomePage_EachStampedSection_SitsInExactlyOneRegion', () => {
    const html = committedPage();
    for (const id of STAMPED_HOME_SECTIONS) {
      expect(html.split(HOME_REGION_START(id)).length - 1, id).toBe(1);
    }
    expect(html.split(HOME_REGION_END).length - 1).toBe(STAMPED_HOME_SECTIONS.length);
  });

  it('CommittedHomePage_StampedRegions_AreTheRenderOfTheScriptDefaults', () => {
    // The committed regions are what the stamp writes from the script's own
    // defaults, so a page viewed straight from the repository says the same as
    // the script before its manifest arrives, and an edit to either shows here.
    const committed = new JSDOM(committedPage()).window.document;
    for (const id of STAMPED_HOME_SECTIONS) {
      const expected = new JSDOM(`<!DOCTYPE html><body>${homeSectionHtml(defaultHomeModel(), id)}</body>`).window.document.body.firstElementChild;
      const actual = committed.querySelector(`section[data-section="${id}"]`);
      expect(actual?.outerHTML, id).toBe(expected?.outerHTML);
    }
  });
});
