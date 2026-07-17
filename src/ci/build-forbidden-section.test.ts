import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildForbiddenSection, suffixPage, forbiddenSuffixReferenceLine } from './build-forbidden-section.ts';
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
const D2019A = 'wdtk-596532--allocated-reserved-forbidden';
const D2019B = 'ofcom-756622--published-register-csv';

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
    expect(index).toMatch(/added <a class="cs cs-sfx" href="suffix\/JIZ\/index.html">JIZ<\/a>; removed <a class="cs cs-sfx" href="suffix\/QNF\/index.html">QNF<\/a>, <a class="cs cs-sfx" href="suffix\/ZFJ\/index.html">ZFJ<\/a> → <b>1,464<\/b>/);
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
    expect(index).toContain('<a class="cs cs-sfx" href="suffix/QNF/index.html">QNF</a>');
    // The A–Z browse block makes every union suffix reachable by a crawler.
    expect(index).toContain('Browse every forbidden suffix (A–Z)');
    // The surprise the index surfaces: forbidden suffixes that nonetheless
    // carry Allocated callsigns — QNF is called out by name.
    expect(index).toContain('Forbidden, yet carrying Allocated callsigns');
    // That section carries an anchor (issue #769) so the fidelity page's
    // "show the working" example can link straight through to this analysis
    // rather than restating it as a bare, unlinked assertion.
    expect(index).toContain('<h3 id="with-allocated">Forbidden, yet carrying Allocated callsigns</h3>');
  });
});

describe('ITU-R M.1172 citation is a real link, not prose claiming to be one (issue #768)', { tags: ['data-validity'] }, () => {
  const ITU_HREF = 'href="https://www.itu.int/rec/R-REC-M.1172/en"';

  it('ForbiddenSectionIndex_ItuM1172Mention_IsARealLinkNotBareText', () => {
    const index = read('forbidden', 'index.html');
    expect(index).toContain(`the ${'<a ' + ITU_HREF + '>ITU-R M.1172 operating abbreviations</a>'} it links to`);
  });

  it('SuffixDetailPage_ItuM1172Corroboration_IsARealLinkNotBareText', () => {
    // A per-suffix page with a SOURCED rationale (QNF is on the itu-q-code
    // family) carries the same real link in its "corroborated by" sentence.
    const page = read('forbidden', 'suffix', 'QNF', 'index.html');
    expect(page).toContain(`corroborated by the linked ${'<a ' + ITU_HREF + '>ITU-R M.1172</a>'} document`);
  });
});

describe('Forbidden-suffix section — disclosures-over-time deltas (issue #749)', { tags: ['data-validity'] }, () => {
  it('DisclosuresTimeline_OldestRow_HasNoPredecessorSoNoDeltaIsShown', () => {
    // 2016-09 (1,465 distinct / 1,466 rows) is the baseline: no earlier
    // disclosure to diff against, so neither cell carries a delta span - a
    // bare, plain count, exactly as it rendered before this feature.
    const index = read('forbidden', 'index.html');
    expect(index).toContain(`<code>${D2016}</code></td><td>1,465</td><td>1,466</td><td>`);
  });

  it('DisclosuresTimeline_DistinctUnchangedButRowsDropped_EachColumnGetsItsOwnIndependentDelta', () => {
    // The 12 Aug 2019 disclosure (wdtk-596532) carries the same 1,465
    // distinct suffixes as 2016 (the ZIT duplicate is gone, so rows drops
    // from 1,466 to 1,465): distinct reads a muted zero-change, rows reads a
    // visible real decrease - proving the two columns diff independently.
    const index = read('forbidden', 'index.html');
    expect(index).toContain(`<code>${D2019A}</code></td><td>1,465 <span class="zero">(±0)</span></td><td>1,465 <span class="delta-decrease">(−1)</span></td>`);
  });

  it('DisclosuresTimeline_BothCountsIdenticalToThePredecessor_BothColumnsShowAMutedZeroChange', () => {
    // The 12 Sep 2019 disclosure (ofcom-756622) repeats the prior 1,465
    // distinct / 1,465 rows exactly - equal counts, muted on both columns,
    // never blank (there IS a predecessor; it is just unchanged).
    const index = read('forbidden', 'index.html');
    expect(index).toContain(`<code>${D2019B}</code></td><td>1,465 <span class="zero">(±0)</span></td><td>1,465 <span class="zero">(±0)</span></td>`);
  });

  it('DisclosuresTimeline_2024Disclosure_ShowsAVisibleNegativeDeltaOnBothColumns', () => {
    // 2024-12 drops from 1,465 to 1,464 on both distinct and rows (net of
    // +JIZ, −QNF, −ZFJ) - a real, visible movement on both columns.
    const index = read('forbidden', 'index.html');
    expect(index).toContain(`<code>${D2024}</code></td><td>1,464 <span class="delta-decrease">(−1)</span></td><td>1,464 <span class="delta-decrease">(−1)</span></td>`);
  });
});

describe('Forbidden-suffix section — 2024 disclosure page', { tags: ['data-validity'] }, () => {
  it('ForbiddenSection2024Page_RealArchive_RendersAddedRemovedNotable', () => {
    const page = read('forbidden', D2024, 'index.html');
    // The notable diff versus the previous (September 2019) disclosure.
    expect(page).toContain('vs 12 September 2019:');
    expect(page).toContain('added <a class="cs cs-sfx" href="../suffix/JIZ/index.html">JIZ</a>');
    expect(page).toContain('removed <a class="cs cs-sfx" href="../suffix/QNF/index.html">QNF</a>, <a class="cs cs-sfx" href="../suffix/ZFJ/index.html">ZFJ</a>');
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
    expect(page).toContain('1,466 rows — <code class="cs cs-sfx">ZIT</code> listed twice');
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

describe('Forbidden-suffix section — examine trail (issue #439)', { tags: ['data-validity'] }, () => {
  it('SuffixPage_ExamineTrail_WalksToThePinnedUnionRowTheDerivationCodeAndTheDisclosures', () => {
    const page = read('forbidden', 'suffix', 'QNF', 'index.html');
    // The shared vocabulary: the visible lead and the trail component.
    expect(page).toContain('<span class="examine-lead">Examine:</span>');
    // (a) the pinned source line of this suffix's row on the ever-forbidden
    // union — a full 40-hex commit and an exact line, never a moving branch.
    expect(page).toMatch(/blob\/[0-9a-f]{40}\/reference-data\/forbidden-suffixes\.csv#L\d+/);
    // (b) the code the history is computed by, pinned at the same commit.
    expect(page).toMatch(/blob\/[0-9a-f]{40}\/src\/ci\/forbidden-suffix-history\.ts/);
    expect(page).toContain('the derivation code');
    // (c) the provenance context: the witnessing disclosures on this page.
    expect(page).toContain('href="#history"');
    expect(page).toContain('<section id="history">');
  });

  it('ForbiddenSuffixReferenceLine_KnownSuffix_PointsAtItsExactRow', () => {
    // Self-verifying: the returned line, read back from the committed file,
    // must be the row that starts with the suffix itself.
    const line = forbiddenSuffixReferenceLine('QNF');
    expect(line).toBeDefined();
    if (line === undefined) return;
    const raw = fs.readFileSync(path.join('reference-data', 'forbidden-suffixes.csv'), 'utf8').split(/\r?\n/);
    expect(raw[line - 1].startsWith('QNF,')).toBe(true);
  });

  it('ForbiddenSuffixReferenceLine_UnknownSuffix_IsUndefinedNeverFabricated', () => {
    expect(forbiddenSuffixReferenceLine('NOT-A-SUFFIX')).toBeUndefined();
  });
});

describe('Forbidden-suffix section — rationale (issue #196)', { tags: ['data-validity'] }, () => {
  it('SuffixPage_QCodeSuffix_NamesTheSourcedItuQCodeRationaleWithItsSource', () => {
    // QNF is itself a Q-code (QAA-QZZ block member), so its own detail page
    // carries the sourced rationale, not an "unclassified" note.
    const page = read('forbidden', 'suffix', 'QNF', 'index.html');
    expect(page).toContain('Why is this suffix withheld?');
    expect(page).toContain('<b>ITU Q-code series</b>');
    expect(page).toContain("sourced, not this project's inference");
    expect(page).toContain('QAA–QZZ block');
    expect(page).toContain('href="../../../datasets/foi/wdtk-356636--all-callsigns-plus-forbidden/raw-extract-all-call-sign-list-nan-smith.md.html">Ofcom\'s FOI response of 29 September 2016 (Ofcom reference 337399)</a>');
    expect(page).toContain('href="../../index.html#rationale">rationale breakdown</a>');
  });

  it('SuffixPage_UnclassifiedSuffix_SaysSoRatherThanInventingACategory', () => {
    // ZZZ matches no sourced rule (not a Q-code, not an ITU-R M.1172
    // abbreviation, not SOS) - the honest "no rationale established" branch.
    const empty: SuffixCallsignInfo = { suffix: 'ZZZ', callsigns: [], byStatus: [], total: 0 };
    const html = suffixPage('ZZZ', history, empty);
    expect(html).toContain('No rationale is established for this specific suffix');
    expect(html).toContain('this project does not infer one where it cannot cite a source');
    expect(html).toContain('href="../../index.html#rationale">general account</a>');
    expect(html).not.toContain("sourced, not this project's inference");
  });

  it('SuffixPage_OperationalAbbreviationSuffix_NamesTheItuOperationalAbbreviationCategory', () => {
    const page = read('forbidden', 'suffix', 'ETA', 'index.html');
    expect(page).toContain('<b>ITU-R M.1172 operating abbreviation</b>');
    expect(page).toContain('an internationally accepted signal a callsign suffix must not be confused with');
  });

  it('SuffixPage_Sos_NamesTheSignalConfusionCategory', () => {
    const page = read('forbidden', 'suffix', 'SOS', 'index.html');
    expect(page).toContain('<b>Internationally accepted signal</b>');
    expect(page).toContain('the worked example');
  });

  it('ForbiddenSectionIndex_RationaleSection_QuotesOfcomsOwnWordingAndBreaksDownByCategory', () => {
    const index = read('forbidden', 'index.html');
    expect(index).toContain('<section id="rationale"><h2>Why are these suffixes withheld?');
    expect(index).toContain('href="../glossary.html#forbidden-suffix-rationale"');
    // The verbatim Ofcom quote, cited to the FOI entry.
    expect(index).toContain('conventional practice we do not issue call signs');
    expect(index).toContain('Art 19.46 et seq of the Radio Regulations');
    expect(index).toContain('href="../datasets/foi/wdtk-356636--all-callsigns-plus-forbidden/raw-extract-all-call-sign-list-nan-smith.md.html">Ofcom\'s FOI response of 29 September 2016 (Ofcom reference 337399)</a>');
    // The category breakdown: exact figures pinned against the real corpus.
    expect(index).toContain('<td>ITU Q-code series<br>');
    expect(index).toMatch(/ITU Q-code series[\s\S]{0,400}676/);
    expect(index).toMatch(/ITU-R M\.1172 operating abbreviation[\s\S]{0,400}22/);
    expect(index).toMatch(/Internationally accepted signal[\s\S]{0,400}\b1\b/);
    // The residual is named as a count, never individually attributed.
    expect(index).toContain('Unclassified <span class="gap">(no citable rationale established for the specific suffix)</span>');
    expect(index).toMatch(/Unclassified[\s\S]{0,200}767/);
    expect(index).toContain('not itself a claim about any specific suffix');
  });

  it('RationaleCitation_OnTheSectionIndexAndAPerSuffixPage_IsAnIdentifiedClickableLinkToTheBrowsableFoiResponse', () => {
    // Issue #750: "Ofcom's own FOI response" must not be bare, uncited prose —
    // a reader should be able to tell WHICH disclosure is meant (date +
    // Ofcom's own reference) without following the link, and the link itself
    // must resolve to the browsable rendered copy of the actual letter (the
    // FOI entry's `raw-extract-*.md.html` sibling), not merely the entry's
    // bare index page. (The link's live resolution against the built site is
    // covered by the internal-link crawl, which exercises the real archive
    // path this href targets: archive/foi/wdtk-356636--all-callsigns-plus-forbidden/raw-extract-all-call-sign-list-nan-smith.md.)
    const target = 'datasets/foi/wdtk-356636--all-callsigns-plus-forbidden/raw-extract-all-call-sign-list-nan-smith.md.html';
    const citation = "Ofcom's FOI response of 29 September 2016 (Ofcom reference 337399)";

    const index = read('forbidden', 'index.html');
    expect(index).toContain(`href="../${target}">${citation}</a>`);
    expect(index).not.toContain(">Ofcom's own FOI response<");

    const suffixPage = read('forbidden', 'suffix', 'QNF', 'index.html');
    expect(suffixPage).toContain(`href="../../../${target}">${citation}</a>`);
    expect(suffixPage).not.toContain(">Ofcom's own FOI response<");
  });

  it('ForbiddenSectionIndex_RationaleBreakdown_NeverNamesAnUnclassifiedSuffixAsOffensive', () => {
    // The residual row must not enumerate suffixes or use a judgement word
    // like "offensive" as a per-suffix label — only Ofcom's own quoted words
    // may use it, in the block-quoted prose, never as this project's own
    // category name attached to a specific suffix link.
    const index = read('forbidden', 'index.html');
    expect(index).not.toMatch(/<td>[^<]*offensive[^<]*<\/td>/i);
  });
});
