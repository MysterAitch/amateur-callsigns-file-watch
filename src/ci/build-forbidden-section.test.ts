import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildForbiddenSection, suffixPage } from './build-forbidden-section.ts';
import { buildForbiddenSuffixHistory, type ForbiddenSuffixHistory } from './forbidden-suffix-history.ts';
import { type SuffixCallsignInfo } from './forbidden-suffix-callsigns.ts';
import { callsignPill } from './site-render.ts';

// Issue #291 phases 2 + 3: the STATIC forbidden-suffix site section (index +
// per-disclosure pages + per-suffix detail pages), built from the committed
// phase-1 data foundation and the phase-3 suffix -> callsigns index. These
// build the real archive into a scratch directory and assert the rendered
// markup carries the figures the PR cites. Test names follow
// Subject_Scenario_Outcome.

const D2024 = 'ofcom-2024-12--forbidden-suffixes';
const D2016 = 'wdtk-356636--all-callsigns-plus-forbidden';

let outputDir: string;
let urls: string[];
let history: ForbiddenSuffixHistory;

const read = (...rel: string[]): string => fs.readFileSync(path.join(outputDir, ...rel), 'utf8');

beforeAll(() => {
  outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forbidden-section-'));
  urls = buildForbiddenSection(outputDir, 'https://example.test/site');
  history = buildForbiddenSuffixHistory();
}, 480_000);

afterAll(() => {
  fs.rmSync(outputDir, { recursive: true, force: true });
});

describe('Forbidden-suffix section — index', { tags: ['data-validity'] }, () => {
  it('ForbiddenSectionIndex_RealArchive_RendersTimelineUnionAndHeadlineDiff', () => {
    const index = read('forbidden', 'index.html');
    // The disclosures timeline lists every disclosure and links to its page.
    expect(index).toContain(`<a href="${D2016}/index.html">September 2016</a>`);
    expect(index).toContain(`<a href="${D2024}/index.html">December 2024</a>`);
    // The headline diff: steady 1,465 across the early disclosures, then the
    // 2024 change (+JIZ, −QNF, −ZFJ) → 1,464. The changed suffixes are now
    // links to their per-suffix pages (phase 3).
    expect(index).toContain('held steady at <b>1,465</b> suffixes');
    expect(index).toMatch(/added <a href="suffix\/JIZ\/index.html"><code>JIZ<\/code><\/a>; removed <a href="suffix\/QNF\/index.html"><code>QNF<\/code><\/a>, <a href="suffix\/ZFJ\/index.html"><code>ZFJ<\/code><\/a> → <b>1,464<\/b>/);
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

  it('ForbiddenSectionIndex_StatusBreakdownCommitment_IsStatedInCopy', () => {
    const index = read('forbidden', 'index.html');
    // The status-decomposition commitment appears in the page copy — never a
    // bare total. "status" carries the shared glossary affordance (issue #329),
    // so the word is a glossary link within the bolded commitment.
    expect(index).toContain('broken down by <a class="gloss-term" href="../glossary.html#status-values">status');
    expect(index).toContain('(Allocated / Reserved / Available / Forbidden)');
  });

  it('ForbiddenSectionIndex_PerSuffixPages_AreLinkedAndCrawlable', () => {
    const index = read('forbidden', 'index.html');
    // The per-suffix drill-downs now exist and are linked (phase 3).
    expect(index).toContain('<a href="suffix/QNF/index.html"><code>QNF</code></a>');
    // The A–Z browse block makes every union suffix reachable by a crawler.
    expect(index).toContain('Browse every forbidden suffix (A–Z)');
    // The surprise the index surfaces: forbidden suffixes that nonetheless
    // carry Allocated callsigns — QNF is called out by name.
    expect(index).toContain('Forbidden, yet carrying Allocated callsigns');
  });
});

describe('Forbidden-suffix section — 2024 disclosure page', { tags: ['data-validity'] }, () => {
  it('ForbiddenSection2024Page_RealArchive_RendersAddedRemovedNotable', () => {
    const page = read('forbidden', D2024, 'index.html');
    // The notable diff versus the previous (September 2019) disclosure.
    expect(page).toContain('vs 12 September 2019:');
    expect(page).toContain('added <a href="../suffix/JIZ/index.html"><code>JIZ</code></a>');
    expect(page).toContain('removed <a href="../suffix/QNF/index.html"><code>QNF</code></a>, <a href="../suffix/ZFJ/index.html"><code>ZFJ</code></a>');
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

  it('ForbiddenSection2024Page_NotableChanges_DrillDownIntoPerSuffixPages', () => {
    const page = read('forbidden', D2024, 'index.html');
    // The changed suffixes are now drill-down links to their per-suffix pages
    // (phase 3), relative to the disclosure page's depth.
    expect(page).toMatch(/href="..\/suffix\/QNF\/index.html"/);
    expect(page).toMatch(/href="..\/suffix\/JIZ\/index.html"/);
    // Still static: no progressive-enhancement browser scripts.
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

describe('Forbidden-suffix section — 2016 disclosure page', { tags: ['data-validity'] }, () => {
  it('ForbiddenSection2016Page_RealArchive_SurfacesTheZitDuplicateHonestly', () => {
    const page = read('forbidden', D2016, 'index.html');
    // 1,466 rows for 1,465 distinct suffixes: the ZIT duplicate is surfaced.
    expect(page).toContain('1,466 rows — <code>ZIT</code> listed twice');
    expect(page).toContain('never silently deduplicated');
    // As the baseline it has no prior disclosure to diff against.
    expect(page).toContain('Baseline');
  });
});

describe('Forbidden-suffix section — cross-cutting', { tags: ['data-validity'] }, () => {
  it('ForbiddenSectionPages_Accessibility_CarrySkipLinkAndMainLandmark', () => {
    for (const rel of [['forbidden', 'index.html'], ['forbidden', D2024, 'index.html']]) {
      const html = read(...rel);
      expect(html).toContain('<a class="skip" href="#main">Skip to content</a>');
      // Class-tolerant: the landmark now carries the ledger class (issue #394).
      expect(html).toMatch(/<main id="main"[^>]*>/);
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
    // One index + one page per disclosure (four disclosures) + one page per
    // ever-forbidden union suffix (1,466) = 1,471.
    expect(urls).toContain('https://example.test/site/forbidden/index.html');
    expect(urls).toContain(`https://example.test/site/forbidden/${D2024}/index.html`);
    expect(urls).toContain('https://example.test/site/forbidden/suffix/QNF/index.html');
    expect(urls.length).toBe(1 + 4 + 1466);
  });

  it('ForbiddenSectionBuild_Rebuild_IsDeterministic', () => {
    const second = fs.mkdtempSync(path.join(os.tmpdir(), 'forbidden-section-2-'));
    try {
      buildForbiddenSection(second, 'https://example.test/site');
      for (const rel of [['forbidden', 'index.html'], ['forbidden', D2024, 'index.html'], ['forbidden', D2016, 'index.html'], ['forbidden', 'suffix', 'QNF', 'index.html']]) {
        expect(fs.readFileSync(path.join(second, ...rel), 'utf8')).toBe(read(...rel));
      }
    } finally {
      fs.rmSync(second, { recursive: true, force: true });
    }
  });
});

describe('Forbidden-suffix section — per-suffix detail pages (phase 3)', { tags: ['data-validity'] }, () => {
  it('SuffixPage_QNF_TellsTheForbiddenThenDelistedThenIssuedArc', () => {
    const page = read('forbidden', 'suffix', 'QNF', 'index.html');
    // The forbidden-list history: first known forbidden and the de-listing.
    expect(page).toContain('First known forbidden <b>2016-09</b>');
    expect(page).toContain('<b>De-listed</b> by the December 2024 disclosure');
    // The arc callout names both post-de-listing callsigns with their 2025
    // original-start dates, and frames it as a reconciliation candidate. The
    // callsigns render through the shared pill (issue #310), not an ad-hoc
    // anchor, so the callout reads like the section's tables.
    expect(page).toContain('Forbidden, then de-listed, then issued.');
    expect(page).toContain('<a class="cs callsign-pill" href="../../../index.html?c=M3QNF" title="M3QNF — prefix series M3 · suffix QNF · Foundation">M3QNF</a> (original start 20 November 2025)');
    expect(page).toContain('<a class="cs callsign-pill" href="../../../index.html?c=M7QNF" title="M7QNF — prefix series M7 · suffix QNF · Foundation">M7QNF</a> (original start 7 February 2025)');
    expect(page).toContain('A reconciliation candidate');
    // The flag rationale is accurate post phase-4 refit: the row-level
    // forbidden-suffix flag keys off the ever-forbidden union (NOT the old 2019
    // reference list), and a post-first-known-forbidden issuance additionally
    // carries the per-suffix temporal flag.
    expect(page).toContain('still fires because the suffix is on the ever-forbidden union');
    expect(page).toContain('forbidden-suffix-issued-after-first-known-list');
    expect(page).not.toContain('keys off the 2019 reference list');
  });

  it('SuffixPage_QNF_BreaksCallsignsDownByStatusNotABareTotal', () => {
    const page = read('forbidden', 'suffix', 'QNF', 'index.html');
    // The status breakdown: 2 Allocated (the issued pair) and 3 Forbidden (the
    // 2016 prohibition rows) — never conflated into a bare "5 callsigns".
    // "status" in the lead carries the shared glossary affordance (issue #329).
    expect(page).toContain('broken down by latest-known <a class="gloss-term" href="../../../glossary.html#status-values">status');
    expect(page).toMatch(/By latest-known status/);
    // Both status buckets render as breakdown rows with their counts, their
    // labels routed through the shared status field wrapper (issue #553) - a
    // bounded distinct-value list, so 'Allocated' and 'Forbidden' are linked
    // to their glossary definitions (Forbidden's being the honestly-undefined
    // one, #status-forbidden).
    expect(page).toMatch(/<span class="lab"><span class="stat"><a class="gloss-term" href="\.\.\/\.\.\/\.\.\/glossary\.html#allocated">Allocated.*?<\/a><\/span><\/span><span class="pct">[^<]*<\/span><b>2<\/b>/);
    expect(page).toMatch(/<span class="lab"><span class="stat"><a class="gloss-term" href="\.\.\/\.\.\/\.\.\/glossary\.html#status-forbidden">Forbidden.*?<\/a><\/span><\/span><span class="pct">[^<]*<\/span><b>3<\/b>/);
    // M3QNF's status transition (Forbidden in 2016, Allocated now) is surfaced,
    // not flattened away. This per-callsign cell is pinned to the wrapper's
    // 'plain' treatment (no glossary link): the table can list many rows
    // repeating the same handful of status values.
    expect(page).toContain('<span class="stat">Allocated</span> <small class="gap">(was <span class="stat">Forbidden</span>)</small>');
    // Every callsign deep-links into the register lookup, through the shared pill.
    expect(page).toContain('<a class="cs callsign-pill" href="../../../index.html?c=M3QNF"');
  });

  it('SuffixPage_QNF_CrossLinksToDisclosuresAndFoiObservations', () => {
    const page = read('forbidden', 'suffix', 'QNF', 'index.html');
    // The history table links back to each disclosure page.
    expect(page).toContain(`../../${D2024}/index.html`);
    // The FOI witnesses are cross-linked to their dataset entries.
    expect(page).toContain(`../../../datasets/foi/${D2016}/index.html`);
  });

  it('SuffixPage_QNF_OffersALocatablePreFilledReportAffordance', () => {
    // Issue #439: the report-this invite names this exact suffix and its page,
    // so a report arrives located to its hop; it also links through to the
    // reporting section of the fidelity deep-dive.
    const page = read('forbidden', 'suffix', 'QNF', 'index.html');
    expect(page).toContain('class="report-affordance"');
    expect(page).toContain('Report or examine this suffix');
    // The pre-filled issue URL carries the suffix as its subject (percent-
    // encoded: spaces become +, the QNF token survives literally).
    expect(page).toContain('/issues/new?title=Data+report');
    expect(page).toContain('suffix+QNF');
    // The reporting deep-dive link is depth-resolved to the site root.
    expect(page).toContain('../../../fidelity.html#reporting');
    // Calm framing: an observation, not a verdict.
    expect(page).toContain('observation for investigation, not a verdict');
  });

  it('SuffixPage_NoCallsignSuffix_SaysSoRatherThanFabricating', () => {
    // A suffix with no callsign is informative in itself. No real union suffix
    // is callsign-free (the 2016 all-callsigns snapshot lists them as
    // Forbidden), so the no-callsign branch is exercised directly.
    const empty: SuffixCallsignInfo = { suffix: 'ZZZ', callsigns: [], byStatus: [], total: 0 };
    const html = suffixPage('ZZZ', history, empty);
    expect(html).toContain('No callsign carries this suffix in any snapshot the mirror holds');
    expect(html).toContain('withheld, and so far as the mirror can see, unused');
    // No fabricated table rows.
    expect(html).not.toContain('<th scope="col">callsign</th>');
  });

  it('SuffixPage_CallsignsCarryingSuffix_RenderAsPillsLinkingToRegisterLookup', () => {
    // The shared callsign pill (issue #310) is applied to the "callsigns
    // carrying this suffix" list: a monospace chip whose accessible name is the
    // bare callsign, with a supplementary title built from the parsed
    // components, deep-linking into the register lookup (?c=).
    const page = read('forbidden', 'suffix', 'QNF', 'index.html');
    expect(page).toContain('<a class="cs callsign-pill" href="../../../index.html?c=M3QNF" title="M3QNF — prefix series M3 · suffix QNF · Foundation">M3QNF</a>');
    // The accessible name is the callsign itself (the link text), not the
    // title — the pill carries no aria-label that would override it.
    expect(page).not.toMatch(/class="cs callsign-pill"[^>]*aria-label=/);
    // The pill styling is present in the (entry) stylesheet the page uses.
    expect(page).toContain('.callsign-pill{');
  });

  it('CallsignPill_WithNoParsedComponents_DegradesToBareCallsignLinkWithNoTitle', () => {
    // With no component data, the pill is just the callsign linking to the
    // lookup at the given relative depth — no supplementary title is fabricated.
    const pill = callsignPill('M7TEE', 3);
    expect(pill).toBe('<a class="cs callsign-pill" href="../../../index.html?c=M7TEE">M7TEE</a>');
  });

  it('CallsignPill_WithParsedComponents_AddsSupplementaryTitleButKeepsCallsignAsAccessibleName', () => {
    // The accessible name stays the callsign (link text); the components only
    // enrich the supplementary title, and absent fields are omitted rather than
    // rendered blank.
    const pill = callsignPill('M7TEE', 1, { prefixSeries: 'M7', suffix: 'TEE', licenceClass: 'Foundation' });
    expect(pill).toBe('<a class="cs callsign-pill" href="../index.html?c=M7TEE" title="M7TEE — prefix series M7 · suffix TEE · Foundation">M7TEE</a>');
    expect(pill).not.toContain('aria-label');
  });

  it('SuffixPage_Accessibility_CarriesSkipLinkMainAndScopedHeaders', () => {
    const page = read('forbidden', 'suffix', 'QNF', 'index.html');
    expect(page).toContain('<a class="skip" href="#main">Skip to content</a>');
    // Class-tolerant: the landmark now carries the ledger class (issue #394).
    expect(page).toMatch(/<main id="main"[^>]*>/);
    expect(page).toContain('</main>');
    // Data tables carry scoped column headers.
    expect(page).toContain('<th scope="col">callsign</th>');
    expect(page).toContain('<th scope="col">latest status</th>');
  });
});

describe('Forbidden-suffix section — inline fidelity nudge (issue #438)', { tags: ['data-validity'] }, () => {
  it('SuffixPage_CallsignsList_NudgesInlineToTheForbiddenSuffixFlagRow', () => {
    // Every callsign on a per-suffix page carries the row-level
    // forbidden-suffix flag; the lead says so in calm, non-accusatory terms and
    // deep-links the flag's own row on the fidelity deep-dive page.
    const page = read('forbidden', 'suffix', 'QNF', 'index.html');
    expect(page).toContain('an observation locating the suffix on the ever-forbidden union, not a verdict');
    expect(page).toContain('<a class="fid-nudge" href="../../../fidelity.html#flag-forbidden-suffix">');
  });
});
