import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildForbiddenSection } from './build-forbidden-section.ts';

// Issue #291 phase 2: the STATIC forbidden-suffix site section (index +
// per-disclosure pages), built from the committed phase-1 data foundation.
// These build the real archive into a scratch directory and assert the
// rendered markup carries the figures the PR cites. Test names follow
// Subject_Scenario_Outcome.

const D2024 = 'ofcom-2024-12--forbidden-suffixes';
const D2016 = 'wdtk-356636--all-callsigns-plus-forbidden';

let outputDir: string;
let urls: string[];

const read = (...rel: string[]): string => fs.readFileSync(path.join(outputDir, ...rel), 'utf8');

beforeAll(() => {
  outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forbidden-section-'));
  urls = buildForbiddenSection(outputDir, 'https://example.test/site');
}, 120_000);

afterAll(() => {
  fs.rmSync(outputDir, { recursive: true, force: true });
});

describe('Forbidden-suffix section — index', () => {
  it('ForbiddenSectionIndex_RealArchive_RendersTimelineUnionAndHeadlineDiff', () => {
    const index = read('forbidden', 'index.html');
    // The disclosures timeline lists every disclosure and links to its page.
    expect(index).toContain(`<a href="${D2016}/index.html">September 2016</a>`);
    expect(index).toContain(`<a href="${D2024}/index.html">December 2024</a>`);
    // The headline diff: steady 1,465 across the early disclosures, then the
    // 2024 change (+JIZ, −QNF, −ZFJ) → 1,464.
    expect(index).toContain('held steady at <b>1,465</b> suffixes');
    expect(index).toMatch(/added <code>JIZ<\/code>; removed <code>QNF<\/code>, <code>ZFJ<\/code> → <b>1,464<\/b>/);
    // The ever-forbidden union headline figure.
    expect(index).toContain('<b>1,466</b> distinct suffixes have been forbidden');
    // The ~2020 currency caveat is surfaced on the index too.
    expect(index).toContain("last-modified dates top out at <b>2020-12-10 09:10</b>");
  });

  it('ForbiddenSectionIndex_DataTable_HasScopedColumnHeaders', () => {
    const index = read('forbidden', 'index.html');
    expect(index).toContain('<th scope="col">distinct</th>');
    expect(index).toContain('<th scope="col">first known forbidden</th>');
  });

  it('ForbiddenSectionIndex_Phase3Note_CommitsToStatusBreakdownAndAvoidsDeadLinks', () => {
    const index = read('forbidden', 'index.html');
    // The phase-3 status-decomposition commitment appears in the page copy.
    expect(index).toContain('decompose by status (Allocated / Reserved / Available)');
    // No per-suffix drill-down links exist yet (phase 3), so none are rendered.
    expect(index).not.toMatch(/href="[^"]*\/forbidden\/[A-Z]{3}"/);
    expect(index).not.toContain('index.html?');
  });
});

describe('Forbidden-suffix section — 2024 disclosure page', () => {
  it('ForbiddenSection2024Page_RealArchive_RendersAddedRemovedNotable', () => {
    const page = read('forbidden', D2024, 'index.html');
    // The notable diff versus the previous (September 2019) disclosure.
    expect(page).toContain('vs 12 September 2019:');
    expect(page).toContain('added <code>JIZ</code>');
    expect(page).toContain('removed <code>QNF</code>, <code>ZFJ</code>');
    // The de-listing is called out as the standout.
    expect(page).toContain('The de-listing is the standout.');
  });

  it('ForbiddenSection2024Page_RealArchive_RendersLastModifiedHistogramNotASingleFigure', () => {
    const page = read('forbidden', D2024, 'index.html');
    // Both buckets of the last-modified distribution render as breakdown rows —
    // the origin bulk and the single 2020 outlier (JIZ), named.
    expect(page).toContain('Last modified');
    expect(page).toContain('distribution, not one date');
    expect(page).toContain('2016-07-29 17:19');
    expect(page).toContain('2020-12-10 09:10 (JIZ)');
    // It is a proportion breakdown (bars), not one number: the big bucket count
    // and the outlier count both appear as breakdown values.
    expect(page).toMatch(/<b>1,463<\/b>/);
    expect(page).toMatch(/<b>1<\/b>/);
  });

  it('ForbiddenSection2024Page_RealArchive_CarriesTheCurrencyCaveat', () => {
    const page = read('forbidden', D2024, 'index.html');
    // The source's own vintage note (which states the ~2020 currency) is shown.
    expect(page).toContain('Vintage note:');
    expect(page).toContain("data's currency predates the December 2024 listing");
  });

  it('ForbiddenSection2024Page_NotableChanges_AreTextNotDeadPerSuffixLinks', () => {
    const page = read('forbidden', D2024, 'index.html');
    // Changed suffixes are named as <code>, never linked to phase-3 pages.
    expect(page).toContain('<code>QNF</code>');
    expect(page).not.toMatch(/href="[^"]*QNF[^"]*"/);
    expect(page).not.toMatch(/href="[^"]*JIZ[^"]*"/);
    // No progressive-enhancement browser scripts (static-only, phase-2 boundary).
    expect(page).not.toContain('entry-browser.js');
    expect(page).not.toContain('data-browser-sql');
  });

  it('ForbiddenSection2024Page_GetTheData_OffersSourceDownloadWithSizeAndNavigateToFullEntry', () => {
    const page = read('forbidden', D2024, 'index.html');
    // The committed normalised suffix file is a download slot with a size, and
    // it points at the FOI entry's published copy.
    expect(page).toContain(`<a href="../../datasets/foi/${D2024}/normalised--forbidden-amateur-radio-callsigns.csv">normalised--forbidden-amateur-radio-callsigns.csv</a>`);
    expect(page).toMatch(/CSV \([\d.]+ [KM]B\)/);
    // The navigate link to the full entry carries no size (download-vs-navigate).
    expect(page).toContain(`<a class="linkout" href="../../datasets/foi/${D2024}/index.html">Browse the full disclosure`);
  });

  it('ForbiddenSection2024Page_Sidebar_MarksCurrentDisclosureAndLinksOthers', () => {
    const page = read('forbidden', D2024, 'index.html');
    expect(page).toContain('class="nav-side"');
    // The current disclosure is marked, not linked; the others link across the
    // section.
    expect(page).toContain('aria-current="page"');
    expect(page).toContain(`<a href="../${D2016}/index.html">`);
  });
});

describe('Forbidden-suffix section — 2016 disclosure page', () => {
  it('ForbiddenSection2016Page_RealArchive_SurfacesTheZitDuplicateHonestly', () => {
    const page = read('forbidden', D2016, 'index.html');
    // 1,466 rows for 1,465 distinct suffixes: the ZIT duplicate is surfaced.
    expect(page).toContain('1,466 rows — <code>ZIT</code> listed twice');
    expect(page).toContain('never silently deduplicated');
    // As the baseline it has no prior disclosure to diff against.
    expect(page).toContain('Baseline');
  });
});

describe('Forbidden-suffix section — cross-cutting', () => {
  it('ForbiddenSectionPages_Accessibility_CarrySkipLinkAndMainLandmark', () => {
    for (const rel of [['forbidden', 'index.html'], ['forbidden', D2024, 'index.html']]) {
      const html = read(...rel);
      expect(html).toContain('<a class="skip" href="#main">Skip to content</a>');
      expect(html).toContain('<main id="main">');
      expect(html).toContain('</main>');
    }
  });

  it('ForbiddenSectionPages_Nav_CarryTheForbiddenSectionEntry', () => {
    // The section is reachable from the nav of its own pages; the current
    // section is marked (not self-linked) on section pages.
    const index = read('forbidden', 'index.html');
    expect(index).toContain('<strong>Forbidden suffixes</strong>');
    // A disclosure page (depth 2) reaches the section index via the nav.
    const page = read('forbidden', D2024, 'index.html');
    expect(page).toContain('<strong>Forbidden suffixes</strong>');
  });

  it('ForbiddenSectionBuild_ReturnsOneUrlPerPageForTheSitemap', () => {
    // One index + one page per disclosure (four disclosures in the archive).
    expect(urls).toContain('https://example.test/site/forbidden/index.html');
    expect(urls).toContain(`https://example.test/site/forbidden/${D2024}/index.html`);
    expect(urls.length).toBe(5);
  });

  it('ForbiddenSectionBuild_Rebuild_IsDeterministic', () => {
    const second = fs.mkdtempSync(path.join(os.tmpdir(), 'forbidden-section-2-'));
    try {
      buildForbiddenSection(second, 'https://example.test/site');
      for (const rel of [['forbidden', 'index.html'], ['forbidden', D2024, 'index.html'], ['forbidden', D2016, 'index.html']]) {
        expect(fs.readFileSync(path.join(second, ...rel), 'utf8')).toBe(read(...rel));
      }
    } finally {
      fs.rmSync(second, { recursive: true, force: true });
    }
  });
});
