import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildDatasetPages, dayGap, signedDelta, type DatasetPagesSummary } from './build-dataset-pages.ts';
import { externalLink } from './site-render.ts';
import {
  extractLinks,
  classifyLink,
  resolveInternalLink,
  resolveEmittedFile,
  anchorIds,
  listFilesRelative,
} from './internal-link-crawl.ts';

// Test names follow Subject_Scenario_Outcome per project convention.
//
// The dataset index (issue #149 item 3) is a deploy artefact: entry pages
// that publish the archived files verbatim at stable URLs, a Frictionless
// descriptor per entry, and a sitemap for Wayback crawlability. These tests
// build the real archive into a scratch directory - the same thing the
// Pages workflow does.

let outputDir: string;
let summary: DatasetPagesSummary;

// Generous hook timeout: this builds the whole deploy artefact by parsing the
// entire real archive (seven ~158k-row publications plus every FOI snapshot),
// which grows with each ingested dataset. The ceiling is deliberately large so
// a congested CI runner has headroom; the durable fix is the #336 efficiency
// work that shares the archive parse instead of rebuilding it per test file.
beforeAll(() => {
  outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dataset-pages-'));
  summary = buildDatasetPages(outputDir, 'https://example.test/site');
}, 600_000);

afterAll(() => {
  fs.rmSync(outputDir, { recursive: true, force: true });
});

describe('Dataset navigation sidebar helpers', () => {
  it('DayGap_EarlierPublication_IsNegative', () => {
    expect(dayGap('2026-04-08', '2026-04-12')).toBe(-4);
    expect(dayGap('2026-04-12', '2026-04-08')).toBe(4);
    expect(dayGap('2026-06-23', '2026-06-23')).toBe(0);
  });
  it('SignedDelta_AgainstReference_CarriesSignAmountAndPercent', () => {
    expect(signedDelta(102000, 103000)).toBe(' (−1,000; −1.0%)');
    expect(signedDelta(103000, 102000)).toBe(' (+1,000; +1.0%)');
  });
  it('SignedDelta_NoChange_IsEmpty', () => {
    // Identical figures (e.g. the current page vs itself) emit nothing.
    expect(signedDelta(158318, 158318)).toBe('');
  });
  it('SignedDelta_ZeroReference_OmitsPercent', () => {
    // Avoid a divide-by-zero producing Infinity% in the caption.
    expect(signedDelta(5, 0)).toBe(' (+5)');
  });
});

describe('Explore deep-link on the dataset browse section (issue #333)', { tags: ['data-validity'] }, () => {
  it('DatasetPage_BrowseHandOff_DeepLinksToTheExploreConsolePreFilteredToThisPublication', () => {
    const page = fs.readFileSync(path.join(outputDir, 'datasets', 'open-data', '2026-06-23', 'index.html'), 'utf8');
    // The "query it" hand-off now points at the Explore console rather than the
    // empty tool — carrying the ?db=/?sql= deep-link params the console reads.
    const m = /<a href="(\.\.\/\.\.\/\.\.\/explore\.html\?[^"]+)">query this publication on the Explore console<\/a>/.exec(page);
    if (m === null) throw new Error('browse hand-off does not deep-link to the Explore console');
    // Decoding the href the way the browser (and explore.js) does must recover
    // the combined database and a query scoped to EXACTLY this publication's
    // rows — the "lands on the RIGHT set" contract for the referenced cohort.
    const params = new URLSearchParams(m[1].split('?')[1].replace(/&amp;/g, '&'));
    expect(params.get('db')).toBe('combined');
    expect(params.get('sql')).toBe("SELECT * FROM register_history WHERE dataset = '2026-06-23' ORDER BY callsign");
    // The generic, un-filtered browse hand-off the section used before is gone
    // (the site-nav Explore link is a separate, legitimately generic entry).
    expect(page).not.toContain('query it on the <a href="../../../explore.html">Explore</a> page');
  });
});

describe('Dataset pages build', () => {
  it('DatasetPages_OpenDataEntryPage_CarriesNavigationSidebarWithDeltasAndAllocatedCounts', () => {
    const page = fs.readFileSync(path.join(outputDir, 'datasets', 'open-data', '2026-06-23', 'index.html'), 'utf8');
    // The left navigation sidebar lists publications with allocated-callsign
    // counts and links to the others (lane-uniform ../../open-data/ paths).
    expect(page).toContain('class="nav-side"');
    expect(page).toContain('allocated callsigns');
    expect(page).toContain('href="../../open-data/2025-04-08/index.html"');
    // The page's own entry is marked current, not linked.
    expect(page).toContain('aria-current="page"');
    // A neighbour carries a signed delta relative to this publication.
    expect(page).toMatch(/\((?:\+|−)[\d,]+; (?:\+|−)[\d.]+%\)/);
    // The cross-lane section links data-bearing FOI disclosures, each with its
    // approximate record count and a delta to the register baseline (so a
    // narrow request reads far below the register, a full snapshot near it).
    expect(page).toContain('FOI dataset');
    expect(page).toMatch(/href="\.\.\/\.\.\/foi\/[^"]+\/index\.html"/);
    expect(page).toMatch(/~[\d,]+ records \((?:\+|−)[\d,]+; (?:\+|−)[\d.]+%\)/);
    // The At-a-glance headline and the browse lead both carry the allocated
    // count alongside the bare row count.
    expect(page).toMatch(/register rows · [\d,]+ allocated/);
    expect(page).toMatch(/first rows of [\d,]+ \([\d,]+ allocated callsigns\)/);
  });

  it('DatasetPages_FoiEntryPage_CarriesSameNavigationSidebar', () => {
    // Parity: FOI entry pages get the same left navigation, linking back to
    // the open-data timeline, with deltas measured against the latest complete
    // publication as the register baseline.
    const page = fs.readFileSync(path.join(outputDir, 'datasets', 'foi', 'wdtk-1180568--licence-breakdown-duration-age', 'index.html'), 'utf8');
    expect(page).toContain('class="nav-side"');
    expect(page).toContain('href="../../open-data/2026-06-23/index.html"');
    // The current FOI entry is marked, not linked.
    expect(page).toContain('aria-current="page"');
    // Earlier publications carry a delta to that baseline.
    expect(page).toMatch(/\((?:\+|−)[\d,]+; (?:\+|−)[\d.]+%\)/);
  });

  it('DatasetPages_RealArchive_BuildsIndexAndOnePagePerEntry', () => {
    expect(summary.entryCount).toBeGreaterThanOrEqual(35); // 7 open-data + 28 FOI
    expect(fs.existsSync(path.join(outputDir, 'datasets', 'index.html'))).toBe(true);
    const index = fs.readFileSync(path.join(outputDir, 'datasets', 'index.html'), 'utf8');
    expect(index).toContain('open-data/2026-06-23/index.html');
    expect(index).toContain('foi/wdtk-1180568--licence-breakdown-duration-age/index.html');
    // Navigation anchors are human-readable - not bare keys that look
    // like file downloads.
    expect(index).toContain('Publication of 23 June 2026');
    expect(index).toContain('>Radio amateur licence breakdown by duration held and age</a>');
  });

  it('DatasetPages_OpenDataEntryPage_CarriesGlanceBreakdownsAnomaliesAndMatrixLinkout', () => {
    const page = fs.readFileSync(path.join(outputDir, 'datasets', 'open-data', '2026-06-23', 'index.html'), 'utf8');
    // At-a-glance headline + status breakdown, computed from the files.
    expect(page).toContain('158,318');
    expect(page).toContain('105,332'); // Allocated status count
    // The RSL matrix has LEFT entry pages for the statistics home; the
    // page carries a link-out to it, not the matrix itself.
    expect(page).not.toContain('Prefix series × Regional Secondary Locator');
    expect(page).toContain('statistics.html">Register structure');
    // Anomalies surface (Notable coda + the stats.json inspect panel). The
    // withheld-suffix cohort joins against the ever-forbidden union (1,466
    // suffixes incl. JIZ), so 2,826 on the shared 2016/2019 set becomes 2,830.
    expect(page).toContain('<code>forbidden-suffix</code>');
    expect(page).toContain('2,830');
    // The re-fetch check points at the most recent INTENDED-COMPLETE
    // earlier publication - 2025-06-08 is a declared-partial 1,074-row
    // truncation and must NOT be the changes-since baseline. Since the two
    // web-archive-recovered vintages landed, the newest entry's chronological
    // comparison baseline is the 2026-01-14 recovered workbook publication.
    expect(page).toContain('byte-identical to the earlier fetch');
    expect(page).toContain('Compare with <a href="../2026-01-14/index.html">');
    // The partial 2025-06-08 snapshot is reachable only from the collapsed
    // "partial exports" section of the navigation, never as the diff baseline.
    expect(page).toMatch(/partial exports?<\/summary>[\s\S]*?href="\.\.\/\.\.\/open-data\/2025-06-08\/index\.html"/);
  });

  it('DatasetPages_EntryWithCuratedIgnoredLines_ShowsSetAsideRowsWithTintAndTextBadge', () => {
    // 2022-05-30 carries five curated ignoredLines (the salesforce export
    // footer). Each is displayed as a set-aside row: the amber-tint class PLUS
    // a visible "set aside" badge, so a reader sees they were intentionally
    // excluded, not lost — and colour is never the sole indicator (issue #331).
    const page = fs.readFileSync(path.join(outputDir, 'datasets', 'open-data', '2022-05-30', 'index.html'), 'utf8');
    expect(page).toContain('<tr class="set-aside">');
    expect(page).toContain('<span class="tb setaside">set aside</span>');
    // The verbatim furniture line is shown, escaped and monospace.
    expect(page).toContain('<code>Call Sign List for Open Data,,</code>');
    // The count reads in the always-visible summary; the term links to the glossary.
    expect(page).toMatch(/5 raw lines set aside as non-data/);
    expect(page).toContain('glossary.html#ignored-line');
  });

  it('DatasetPages_EntryWithoutIgnoredLines_HasNoSetAsideAffordance', () => {
    // A live publication with no curated ignores carries no set-aside markup —
    // the affordance is strictly opt-in on the presence of ignoredLines.
    const page = fs.readFileSync(path.join(outputDir, 'datasets', 'open-data', '2026-06-23', 'index.html'), 'utf8');
    expect(page).not.toContain('class="set-aside"');
    expect(page).not.toContain('set aside as non-data');
  });

  it('DatasetPages_OpenDataEntryPage_CarriesAccessibleDistributionCharts', () => {
    const page = fs.readFileSync(path.join(outputDir, 'datasets', 'open-data', '2026-06-23', 'index.html'), 'utf8');
    expect(page).toContain('<h2>Distributions</h2>');
    expect(page).toContain('Callsign length');
    expect(page).toContain('Issue year');
    // The chart is an accessible figure: role="img" with a spoken summary,
    // and the data table IS the content (crawlable, no-SVG fallback).
    expect(page).toContain('<figure class="chart">');
    expect(page).toContain('role="img"');
    expect(page).toMatch(/<desc id="dist-length-d">/);
    expect(page).toContain('<details><summary>Data table');
    // Recent issuance split by licence level, anchored on the publication.
    expect(page).toContain('New in the 12 months to 23 June 2026, by licence level');
    // Long tails are explorable: chart bars/rows carry a facet trigger
    // that toggles the value into the coordinated browser.
    expect(page).toContain('data-filter-expr="CAST(LENGTH(callsign) AS TEXT)"');
    expect(page).toContain('data-filter-val="12"'); // the length-12 tail
    // Blank category values are humanised, never shown as an empty label.
    expect(page).not.toMatch(/<td><\/td><td class="n">/);
  });

  it('DatasetPages_SkewedDistributionChart_AxisLabelCarriesSameFilterTriggerAsBar', () => {
    // A tiny bar in a skewed distribution is a near-single-pixel click
    // target; the axis tick label under it carries the identical facet
    // trigger so the category stays clickable, while the bar keeps its own.
    const page = fs.readFileSync(path.join(outputDir, 'datasets', 'open-data', '2026-06-23', 'index.html'), 'utf8');
    expect(page).toMatch(/<text[^>]*class="tickfilter"[^>]*data-filter-expr="CAST\(LENGTH\(callsign\) AS TEXT\)"[^>]*data-filter-val="/);
    expect(page).toMatch(/<rect[^>]*class="barfilter"[^>]*data-filter-expr="CAST\(LENGTH\(callsign\) AS TEXT\)"/);
  });

  it('DatasetPages_ReconstructedEntry_DisclosesProvenanceNotesInline', () => {
    // A reconstructed publication shows its reconstruction provenance in a
    // collapsible disclosure on the page - the honest "not first-hand"
    // caveat stays visible, the supporting notes are one click away rather
    // than a meta.json fetch.
    const page = fs.readFileSync(path.join(outputDir, 'datasets', 'open-data', '2025-04-08', 'index.html'), 'utf8');
    expect(page).toContain('<details class="notice provenance">');
    expect(page).toContain('reconstructed from git history — not fetched first-hand by the mirror.');
    // The reconstructionNotes and the recovered-from commit are rendered
    // inline, not merely pointed at.
    expect(page).toContain('Reconstructed from git commit 9c6103e (path at commit: amateur-callsigns.csv).');
    expect(page).toContain('<code>9c6103e11b8887548b49814ee017dcc5a9a8cae4</code>');
    // The old "go and read meta.json's reconstructionNotes" redirect is gone.
    expect(page).not.toContain("meta.json</a>'s <code>reconstructionNotes</code>");
  });

  it('DatasetPages_LiveEntry_HasNoReconstructionProvenanceNotice', () => {
    // Live-fetched publications were obtained first-hand, so they carry no
    // reconstruction disclosure at all.
    const page = fs.readFileSync(path.join(outputDir, 'datasets', 'open-data', '2026-06-23', 'index.html'), 'utf8');
    expect(page).not.toContain('class="notice provenance"');
  });

  it('DatasetPages_OpenDataEntryPage_CarriesScopedBrowserEnhancement', () => {
    const page = fs.readFileSync(path.join(outputDir, 'datasets', 'open-data', '2026-06-23', 'index.html'), 'utf8');
    // The browse section is marked with its dataset key and the browser
    // scripts are loaded, so entry-browser.js can query the combined database scoped to it.
    expect(page).toContain('class="browser" data-dataset="2026-06-23"');
    expect(page).toContain('src="../../../vendor/index.js"');
    expect(page).toContain('src="../../../entry-browser.js"');
    // The static preview remains as the no-JS/crawlable fallback.
    expect(page).toContain('class="browser-static"');
    // The eager browser opens the combined database with no trigger button, so a
    // slow-load failure surfaces through the shared affordance's assertive
    // alert (issue #499). These pages do NOT link site/style.css, so its
    // .db-alert styling and the --waiting-* status tokens must be inlined here.
    expect(page).toContain('.db-alert{');
    expect(page).toContain('--waiting-');
    // Breakdown rows are click-to-filter targets feeding the browser facets.
    expect(page).toContain('data-filter-col="status" data-filter-val="Allocated"');
    expect(page).toContain('data-filter-col="implied_class" data-filter-val="Full"');
    expect(page).toContain('data-filter-col="prefix_series" data-filter-val="M3"');
    // The prefix label filters on click; only the small ↗ navigates to the
    // series page (so the row is a filter, not a surprise navigation).
    expect(page).toContain('class="seriesnav" href="../../../series/M3.html"');
    // The Notable forbidden-suffix line is a cohort with two filter links: the
    // whole withheld set, and the subset carrying the per-suffix
    // forbidden-suffix-issued-after-first-known-list flag (not a flat 2019 date).
    expect(page).toMatch(/data-browser-sql="SELECT[^"]*suffix IN \(SELECT suffix FROM ref_forbidden_suffixes\)[^"]*ORDER BY callsign"/);
    expect(page).toContain('issued after the suffix was first withheld');
    expect(page).toContain('forbidden-suffix-issued-after-first-known-list');
    // The stale flat-2019 basis must not resurface on a live page.
    expect(page).not.toContain('issued since the 2019 list');
  });

  it('DatasetPages_OpenDataRegisterPreview_RendersCallsignsAsPillsLinkingToRegisterLookup', () => {
    const page = fs.readFileSync(path.join(outputDir, 'datasets', 'open-data', '2026-06-23', 'index.html'), 'utf8');
    const preview = page.slice(page.indexOf('class="browser-static"'));
    // Every callsign in the crawlable register preview is the shared pill,
    // linking to the register lookup at the entry page's depth (three up).
    expect(preview).toContain('<a class="cs callsign-pill" href="../../../index.html?c=');
    // The pill's accessible name is the bare callsign: the link text and the
    // ?c= lookup target decode to the same callsign.
    const m = /<a class="cs callsign-pill" href="\.\.\/\.\.\/\.\.\/index\.html\?c=([^"]+)"[^>]*>([^<]+)<\/a>/.exec(preview);
    if (m === null) throw new Error('expected a callsign pill in the register preview');
    expect(decodeURIComponent(m[1])).toBe(m[2]);
  });

  it('DatasetPages_RegisterPreviewPill_KeepsCallsignAsAccessibleNameWithComponentsAsTitle', () => {
    const page = fs.readFileSync(path.join(outputDir, 'datasets', 'open-data', '2026-06-23', 'index.html'), 'utf8');
    const preview = page.slice(page.indexOf('class="browser-static"'));
    // A parseable callsign carries a supplementary title (prefix series ·
    // suffix · implied class) that opens with the callsign itself; the link
    // text — the accessible name — stays the bare callsign, never the title.
    const m = /<a class="cs callsign-pill" href="[^"]*\?c=([^"]+)" title="([^"]*)">([^<]+)<\/a>/.exec(preview);
    if (m === null) throw new Error('expected a titled callsign pill in the register preview');
    const callsign = m[3];
    expect(decodeURIComponent(m[1])).toBe(callsign);
    expect(m[2].startsWith(`${callsign} — `)).toBe(true);
    expect(m[2]).not.toContain('<');
  });

  it('DatasetPages_FoiObservationPreview_RendersCallsignColumnAsPills', () => {
    // A callsign-bearing FOI extract (reciprocal licences: callsign · event ·
    // date) presents its callsign column with the same pill as the register.
    const page = fs.readFileSync(path.join(outputDir, 'datasets', 'foi', 'ofcom-498906--reciprocal-licences-since-2010', 'index.html'), 'utf8');
    const preview = page.slice(page.indexOf('Browse the data'));
    expect(preview).toContain('<a class="cs callsign-pill" href="../../../index.html?c=');
  });

  it('DatasetPages_PreviewWithoutCallsignColumn_RendersNoCallsignPills', () => {
    // This FOI preview is annual licence counts (period + counts) — no
    // callsign column, so the column-targeted pill treatment emits no pill
    // markup and the preview is unchanged.
    const page = fs.readFileSync(path.join(outputDir, 'datasets', 'foi', 'wdtk-184767--annual-licence-counts', 'index.html'), 'utf8');
    expect(page).toContain('Browse the data');
    expect(page).not.toContain('class="cs callsign-pill" href');
  });

  it('DatasetPages_FoiEntryPage_HasNoScopedBrowser', () => {
    // The scoped browser reads register_history (open-data publications);
    // FOI entries keep the static preview only, for now.
    const page = fs.readFileSync(path.join(outputDir, 'datasets', 'foi', 'wdtk-596532--allocated-reserved-forbidden', 'index.html'), 'utf8');
    expect(page).not.toContain('entry-browser.js');
    expect(page).not.toContain('data-dataset=');
  });

  it('DatasetPages_DeclaredPartialPublication_CarriesScopeWarningUnderH1', () => {
    const page = fs.readFileSync(path.join(outputDir, 'datasets', 'open-data', '2025-06-08', 'index.html'), 'utf8');
    expect(page).toContain('Declared-partial publication');
    expect(page).toContain('truncated dataset');
    expect(page).toContain('not evidence of anything');
  });

  it('DatasetPages_FoiEntryPage_ShowsDatasetClassesAndSheetShapes', () => {
    const page = fs.readFileSync(path.join(outputDir, 'datasets', 'foi', 'wdtk-596532--allocated-reserved-forbidden', 'index.html'), 'utf8');
    // Dataset classes surface in At-a-glance.
    expect(page).toContain('<code>register-snapshot</code>');
    expect(page).toContain('<code>forbidden-list</code>');
    // Workbook sheet shapes surface from the meta's sheetsIndicative in
    // the file's inspect panel.
    expect(page).toContain('All CallSigns on Record');
    expect(page).toContain('~141,295');
  });

  it('DatasetPages_FoiEntryPage_LinksWitnessCapturesAndOwnMeta', () => {
    const page = fs.readFileSync(path.join(outputDir, 'datasets', 'foi', 'ofcom-756622--published-register-csv', 'index.html'), 'utf8');
    // Recovered-from provenance is clickable, derived from meta witnesses.
    expect(page).toContain('recovered from <a href="https://webarchive.nationalarchives.gov.uk/ukgwa/20211213223006id_/');
    expect(page).toContain('UK Government Web Archive, capture 2021-12-13');
    // The footer's meta.json mention links to this entry's own meta.
    expect(page).toContain('<a href="meta.json"><code>meta.json</code></a>');
  });

  it('DatasetPages_ArchivedFiles_CopiedByteForByte', () => {
    const source = path.join('archive', 'foi', 'ofcom-498906--reciprocal-licences-since-2010', 'normalised--sheet-1-sheet1.csv');
    const published = path.join(outputDir, 'datasets', 'foi', 'ofcom-498906--reciprocal-licences-since-2010', 'normalised--sheet-1-sheet1.csv');
    expect(fs.readFileSync(published).equals(fs.readFileSync(source))).toBe(true);
  });

  it('DatasetPages_FoiEntryDescriptor_CarriesResourcesHashesAndCsvSchemas', () => {
    const descriptorPath = path.join(outputDir, 'datasets', 'foi', 'ofcom-498906--reciprocal-licences-since-2010', 'datapackage.json');
    const descriptor = JSON.parse(fs.readFileSync(descriptorPath, 'utf8')) as {
      resources: { name: string; hash?: string; schema?: { fields: { name: string }[] } }[];
    };
    const byName = new Map(descriptor.resources.map(r => [r.name, r]));
    expect(byName.get('list-reciprocal-licences-since-2010.xlsx')?.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    // Schemas come from each CSV's own header row - no second source of truth.
    expect(byName.get('normalised--sheet-1-sheet1.csv')?.schema?.fields.map(f => f.name)).toEqual(['callsign', 'event', 'event_date']);
  });

  it('DatasetPages_FoiEntryPage_RecordsOutcomeAndUnrecoveredState', () => {
    const page = fs.readFileSync(path.join(outputDir, 'datasets', 'foi', 'ofcom-285990--available-list-jun-2016', 'index.html'), 'utf8');
    expect(page).toContain('Dataset unrecovered');
    expect(page).toContain('285990-amateur-call-signs.pdf');
  });

  it('DatasetPages_MarkdownFiles_RenderedByDefaultWithRawOneClickAway', () => {
    const entryDir = path.join(outputDir, 'datasets', 'foi', 'wdtk-251507--reissue-policy');
    // The rendered sibling exists and carries the correspondence content
    // as HTML (table cells, not pipe syntax).
    const rendered = fs.readFileSync(path.join(entryDir, 'correspondence.md.html'), 'utf8');
    expect(rendered).toContain('<td>');
    expect(rendered).not.toContain('| **Ofcom reference** |');
    expect(rendered).toContain('href="correspondence.md"'); // the raw record, linked
    // The verbatim .md is still published byte-for-byte.
    const raw = path.join('archive', 'foi', 'wdtk-251507--reissue-policy', 'correspondence.md');
    expect(fs.readFileSync(path.join(entryDir, 'correspondence.md')).equals(fs.readFileSync(raw))).toBe(true);
    // The entry page's file table defaults to the rendered view.
    const page = fs.readFileSync(path.join(entryDir, 'index.html'), 'utf8');
    expect(page).toContain('href="correspondence.md.html"');
    expect(page).toContain('href="raw-extract-applicants-old-call-signs.md.html"');
  });

  it('DatasetPages_EntryZip_CarriesEveryArchivedFilePlusDescriptor', () => {
    const key = 'ofcom-498906--reciprocal-licences-since-2010';
    const zipPath = path.join(outputDir, 'datasets', 'foi', key, `${key}.zip`);
    expect(fs.existsSync(zipPath)).toBe(true);
    // Central directory names every archived file, the descriptor, and
    // the lane's data dictionary.
    const zip = fs.readFileSync(zipPath);
    for (const name of [...fs.readdirSync(path.join('archive', 'foi', key)), 'datapackage.json', 'docs/foi-schemas.md']) {
      expect(zip.includes(Buffer.from(name, 'utf8'))).toBe(true);
    }
    // The entry page offers it as a download slot with its size.
    const page = fs.readFileSync(path.join(outputDir, 'datasets', 'foi', key, 'index.html'), 'utf8');
    expect(page).toContain(`<a href="${key}.zip">${key}.zip</a>`);
    expect(page).toMatch(/ZIP [\d.]+ [KM]B/);
  });

  it('DatasetPages_DataDictionary_RendersSchemaDocsAndLinksFromIndex', () => {
    const schema = fs.readFileSync(path.join(outputDir, 'datasets', 'docs', 'foi-schemas.html'), 'utf8');
    expect(schema).toContain('register-snapshot'); // class glossary present
    expect(schema).toContain('docs/foi-schemas.md'); // authoritative-source pointer
    const flags = fs.readFileSync(path.join(outputDir, 'datasets', 'docs', 'flags.html'), 'utf8');
    expect(flags).toContain('forbidden-suffix');
    const index = fs.readFileSync(path.join(outputDir, 'datasets', 'index.html'), 'utf8');
    expect(index).toContain('<h2>Data dictionary</h2>');
    expect(index).toContain('docs/normalised-schema.html');
    expect(summary.pageUrls.some(url => url.endsWith('/datasets/docs/flags.html'))).toBe(true);
  });

  it('ReportPages_StandingReports_RenderedAndIndexedOnHub', () => {
    // The reports hub lists every standing report and the register-status doc,
    // and cross-references (does not move) the data-dictionary pages.
    const hub = fs.readFileSync(path.join(outputDir, 'reports', 'index.html'), 'utf8');
    expect(hub).toContain('href="value-catalogue.html"');
    expect(hub).toContain('href="data-quality.html"');
    expect(hub).toContain('href="dataset-status.html"');
    expect(hub).toContain('href="../datasets/docs/flags.html"');
    // The value catalogue is a real rendered page carrying its table content
    // (cells, not raw pipe syntax) and the Reports nav marked current.
    const vc = fs.readFileSync(path.join(outputDir, 'reports', 'value-catalogue.html'), 'utf8');
    expect(vc).toContain('<td>');
    expect(vc).toContain('Allocated');
    expect(vc).not.toContain('| value | count |');
    expect(vc).toContain('<strong>Reports</strong>');
    expect(vc).toContain('href="index.html">All reports');
    // Every report page joins the sitemap (Wayback crawl seed).
    expect(summary.pageUrls.some(u => u.endsWith('/reports/value-catalogue.html'))).toBe(true);
    expect(summary.pageUrls.some(u => u.endsWith('/reports/index.html'))).toBe(true);
  });

  it('ReportPages_KnownEntities_AreCrossLinkedToTheirPages', () => {
    // The value catalogue names prefix series and data-quality flags; each
    // becomes a link to its canonical page, so the report is a jumping-off
    // point rather than a dead end (issue #234).
    const vc = fs.readFileSync(path.join(outputDir, 'reports', 'value-catalogue.html'), 'utf8');
    // A prefix series links to its series page (M7 is a Foundation series with
    // a page and a large prefix_series row).
    expect(vc).toContain('<a href="../series/M7.html"><code>M7</code></a>');
    // The observed-but-unreferenced M2 series, called out in Notable, links too.
    expect(vc).toContain('<a href="../series/M2.html"><code>M2</code></a>');
    // A data-quality flag links to the flag registry.
    expect(vc).toContain('<a href="../datasets/docs/flags.html"><code>forbidden-suffix</code></a>');
    // Links are not double-wrapped (the token appears inside exactly one anchor).
    expect(vc).not.toContain('<a href="../series/M7.html"><a');
  });

  it('ReportPages_PerEntryDrillDown_RenderedAndLinkedFromDatasetPageNotHub', () => {
    // The per-publication drill-down is a real rendered page, cross-linked from
    // two levels deep (../../), and reached from the publication's dataset page
    // rather than flooding the reports hub.
    const drill = fs.readFileSync(path.join(outputDir, 'reports', 'entries', '2026-06-23.html'), 'utf8');
    expect(drill).toContain('Data-quality report: 2026-06-23');
    expect(drill).toContain('href="../../datasets/open-data/2026-06-23/index.html"'); // back to its dataset
    expect(drill).toMatch(/href="\.\.\/\.\.\/series\/[^"]+\.html"/);                  // a series token, depth-2 rel
    // The dataset page links out to the drill-down.
    const entry = fs.readFileSync(path.join(outputDir, 'datasets', 'open-data', '2026-06-23', 'index.html'), 'utf8');
    expect(entry).toContain('href="../../../reports/entries/2026-06-23.html"');
    // The hub points at them contextually but does not list each one.
    const hub = fs.readFileSync(path.join(outputDir, 'reports', 'index.html'), 'utf8');
    expect(hub).toContain('drill-downs');
    expect(hub).not.toContain('entries/2026-06-23.html');
    // They still join the sitemap for crawlability.
    expect(summary.pageUrls.some(u => u.endsWith('/reports/entries/2026-06-23.html'))).toBe(true);
  });

  it('StaticStatistics_LinksToTheReportsThatExpandItsFigures', () => {
    // The statistics page points at the standing reports that expand its
    // deploy-time aggregates - a two-way weave, not a one-way nav link.
    const stats = fs.readFileSync(path.join('site', 'statistics.html'), 'utf8');
    expect(stats).toContain('href="reports/data-quality.html"');
    expect(stats).toContain('href="reports/value-catalogue.html"');
  });

  it('ReportPages_DatasetStatusRelativeLink_RewrittenToRepoNot404', () => {
    // dataset-status.md links a sibling doc (source-register.md) that has no
    // rendered page on the site; the link resolves to the authoritative repo
    // copy rather than a dead relative .md.
    const status = fs.readFileSync(path.join(outputDir, 'reports', 'dataset-status.html'), 'utf8');
    expect(status).not.toContain('href="source-register.md"');
    expect(status).toContain('/blob/main/docs/source-register.md');
  });

  it('GeneratedPages_Nav_CarryReportsAndCompareLinks', () => {
    // The Reports hub (and the previously-missing Compare page) are reachable
    // from every generated page's nav strip.
    const datasetIndex = fs.readFileSync(path.join(outputDir, 'datasets', 'index.html'), 'utf8');
    expect(datasetIndex).toContain('reports/index.html');
    expect(datasetIndex).toContain('compare.html');
  });

  it('GeneratedPages_Nav_CarrySeriesGlossaryAndAboutLinks', () => {
    // The global nav also reaches the Series index and the Glossary/About
    // pages, so no page is a dead end for sideways navigation (issue #256).
    const datasetIndex = fs.readFileSync(path.join(outputDir, 'datasets', 'index.html'), 'utf8');
    expect(datasetIndex).toContain('href="../series/index.html">Series</a>');
    expect(datasetIndex).toContain('href="../glossary.html">Glossary</a>');
    expect(datasetIndex).toContain('href="../about.html">About</a>');
  });

  it('SeriesPages_Nav_MarkSeriesSectionCurrent', () => {
    // A series page marks its own section active, so a visitor knows they are
    // within "Series" (issue #256).
    const seriesIndex = fs.readFileSync(path.join(outputDir, 'series', 'index.html'), 'utf8');
    expect(seriesIndex).toContain('<strong>Series</strong>');
    const m7 = fs.readFileSync(path.join(outputDir, 'series', 'M7.html'), 'utf8');
    expect(m7).toContain('<strong>Series</strong>');
  });

  it('OpenDataEntryPage_BreadcrumbAboveH1_LinksAncestorsAndMarksDatasetIndex', () => {
    // A deep open-data entry page gets a breadcrumb above the H1 naming its
    // ancestry, and marks "Dataset index" active in the global nav (issue #256).
    const page = fs.readFileSync(path.join(outputDir, 'datasets', 'open-data', '2026-06-23', 'index.html'), 'utf8');
    expect(page).toContain('class="breadcrumb"');
    expect(page).toContain('<a href="../../index.html">Datasets</a>');
    expect(page).toContain('<a href="../../index.html#open-data">Ofcom open data</a>');
    expect(page).toContain('<span aria-current="page">2026-06-23</span>');
    // The breadcrumb precedes the H1.
    expect(page.indexOf('class="breadcrumb"')).toBeLessThan(page.indexOf('<h1'));
    // The owning global-nav section is now marked active (was unmarked before).
    expect(page).toContain('<strong>Dataset index</strong>');
  });

  it('FoiEntryPage_BreadcrumbAboveH1_LinksAncestorsAndMarksDatasetIndex', () => {
    const page = fs.readFileSync(path.join(outputDir, 'datasets', 'foi', 'wdtk-596532--allocated-reserved-forbidden', 'index.html'), 'utf8');
    expect(page).toContain('class="breadcrumb"');
    expect(page).toContain('<a href="../../index.html">Datasets</a>');
    expect(page).toContain('<a href="../../index.html#foi">FOI requests</a>');
    expect(page).toContain('<span aria-current="page">wdtk-596532--allocated-reserved-forbidden</span>');
    expect(page).toContain('<strong>Dataset index</strong>');
  });

  it('AggregateIndexPages_Footer_DropPerEntryMetaBoilerplateAndCiteGeneratingSource', () => {
    // Aggregate index pages are not archive entries, so the "provenance lives
    // in this entry's meta.json / Browse this entry's directory" boilerplate is
    // wrong there; they carry a plain generated-from line instead (issue #258).
    const reportsIndex = fs.readFileSync(path.join(outputDir, 'reports', 'index.html'), 'utf8');
    const seriesIndex = fs.readFileSync(path.join(outputDir, 'series', 'index.html'), 'utf8');
    for (const page of [reportsIndex, seriesIndex]) {
      expect(page).not.toContain('Browse this entry’s directory');
      expect(page).not.toContain("live in this entry's");
      expect(page).not.toContain("each entry's");
      expect(page).toContain('Generated from the committed archive.');
    }
    // The reports hub (a directory source) links out to browse that source —
    // an external GitHub link, so it carries the shared leave-the-site
    // affordance (↗ + rel=noopener + a text alternative), issue #310.
    expect(reportsIndex).toContain('/tree/main/reports" target="_blank" rel="noopener">Browse the source on GitHub <span class="ext-marker" aria-hidden="true">↗</span><span class="visually-hidden"> (opens in a new tab)</span></a>');
  });

  it('EntryPage_Footer_KeepsPerEntryMetaWording', () => {
    // Real archive entries still carry the per-entry provenance wording,
    // linking that entry's own meta.json (issue #258).
    const entry = fs.readFileSync(path.join(outputDir, 'datasets', 'open-data', '2026-06-23', 'index.html'), 'utf8');
    expect(entry).toContain('live in this entry\'s <a href="meta.json"><code>meta.json</code></a>');
  });

  it('ExternalLinkAffordance_RepositoryNavLink_CarriesArrowNoopenerAndTextAlternative', () => {
    // The Repository nav item leaves the site (to GitHub), so it carries the
    // shared leave-the-site affordance on every generated page (issue #310):
    // a decorative ↗, a visually-hidden "(opens in a new tab)", and
    // rel=noopener + target=_blank.
    const page = fs.readFileSync(path.join(outputDir, 'datasets', 'index.html'), 'utf8');
    expect(page).toContain('<a href="https://github.com/MysterAitch/amateur-callsigns-file-watch" target="_blank" rel="noopener">Repository <span class="ext-marker" aria-hidden="true">↗</span><span class="visually-hidden"> (opens in a new tab)</span></a>');
  });

  it('ExternalLinkAffordance_InternalNavLinks_StayPlainWithoutArrowOrNewTab', () => {
    // Internal navigation is visually and behaviourally distinct: no ↗, no
    // new-tab, no rel — a plain relative link, unchanged by the affordance work.
    const page = fs.readFileSync(path.join(outputDir, 'datasets', 'index.html'), 'utf8');
    expect(page).toContain('<a href="../index.html">Lookup</a>');
    expect(page).toContain('<a href="../statistics.html">Statistics</a>');
    // The internal links carry neither the marker nor the new-tab behaviour.
    expect(page).not.toContain('<a href="../index.html" target="_blank"');
    expect(page).not.toContain('Lookup <span class="ext-marker"');
  });

  it('ExternalLink_Helper_EscapesLabelAndEmitsMarkerNoopenerAndTextAlternative', () => {
    // The shared helper (generalising the series-nav ↗) escapes its label by
    // default, marks the arrow aria-hidden, provides the visually-hidden text
    // alternative, and sets rel=noopener + target=_blank.
    expect(externalLink('https://example.test/a', 'Docs & specs')).toBe(
      '<a href="https://example.test/a" target="_blank" rel="noopener">Docs &amp; specs <span class="ext-marker" aria-hidden="true">↗</span><span class="visually-hidden"> (opens in a new tab)</span></a>',
    );
  });

  it('StaticPages_Nav_CarryReportsLink', () => {
    // The four hand-authored pages carry the Reports link too, so navigation
    // is uniform across the whole site (≤2 clicks to any report).
    for (const page of ['index', 'statistics', 'explore', 'compare']) {
      const html = fs.readFileSync(path.join('site', `${page}.html`), 'utf8');
      expect(html).toContain('href="reports/index.html">Reports</a>');
    }
  });

  it('StaticInteractivePages_HaveNoscriptFallbackAndLabelledControls', () => {
    // The JS-dependent pages degrade with a no-JS fallback pointing at the
    // crawlable data, and every SQL/lookup control has a programmatic label.
    const index = fs.readFileSync(path.join('site', 'index.html'), 'utf8');
    const explore = fs.readFileSync(path.join('site', 'explore.html'), 'utf8');
    expect(index).toContain('<noscript>');
    expect(explore).toContain('<noscript>');
    // The Explore SQL textarea gains a real label (was placeholder-only).
    expect(explore).toContain('<label for="sql-input">');
    // The status line announces politely to assistive tech.
    expect(explore).toContain('id="sql-status" class="muted" role="status"');
    // Every static page also carries the skip link + main landmark. The
    // landmark may carry a page-scoping class, so it is matched by its id (the
    // skip-link target that satisfies the a11y requirement) rather than an
    // attribute-exact substring that a styling class would break.
    for (const page of ['index', 'statistics', 'explore', 'compare']) {
      const html = fs.readFileSync(path.join('site', `${page}.html`), 'utf8');
      expect(html).toContain('<a class="skip" href="#main">Skip to content</a>');
      expect(html).toMatch(/<main id="main"[^>]*>/);
    }
  });

  it('GeneratedPages_HaveMainLandmarkAndSkipLink', () => {
    // Every generated page (index + entry templates) wraps its content in a
    // <main id="main"> landmark reachable by a first-focusable skip link.
    for (const rel of [['datasets', 'index.html'], ['reports', 'index.html'], ['series', 'M7.html'], ['datasets', 'open-data', '2026-06-23', 'index.html']]) {
      const html = fs.readFileSync(path.join(outputDir, ...rel), 'utf8');
      expect(html).toContain('<a class="skip" href="#main">Skip to content</a>');
      expect(html).toMatch(/<main id="main"[^>]*>/);
      expect(html).toContain('</main>');
    }
  });

  it('EntryPageSeriesNav_HasUniqueAccessibleNamePerSeries', () => {
    // The ↗ series-nav link names its own series (was the identical "series
    // page" for every row, useless to a screen reader).
    const page = fs.readFileSync(path.join(outputDir, 'datasets', 'open-data', '2026-06-23', 'index.html'), 'utf8');
    expect(page).toMatch(/aria-label="M#7 series page"/);
    expect(page).not.toContain('aria-label="series page"');
  });

  it('SeriesPages_RealArchive_OnePagePerSeriesWithFactsAndCounts', () => {
    const index = fs.readFileSync(path.join(outputDir, 'series', 'index.html'), 'utf8');
    // Reference-known and observed-only series both get pages; the slug
    // drops the # (a URL fragment delimiter), the display keeps it.
    expect(index).toContain('<a href="20.html"><code>2#0</code></a>');
    expect(index).toContain('<a href="M7.html"><code>M#7</code></a>');
    const m7 = fs.readFileSync(path.join(outputDir, 'series', 'M7.html'), 'utf8');
    expect(m7).toContain('Foundation'); // reference facts
    expect(m7).toContain('Status breakdown');
    expect(m7).toMatch(/index\.html\?c=[A-Z0-9]/); // examples deep-link into the lookup
    // Status-breakdown counts link to the filtered lookup ("which N?").
    expect(m7).toContain('../index.html?series=M7&status=Allocated');
    // Observed-but-unreferenced series are flagged, not passed off as
    // established (M2 exists in the register, not in reference data).
    const m2 = fs.readFileSync(path.join(outputDir, 'series', 'M2.html'), 'utf8');
    expect(m2).toContain('absent from');
    // All series pages join the sitemap.
    expect(summary.pageUrls.some(url => url.endsWith('/series/index.html'))).toBe(true);
    expect(summary.pageUrls.some(url => url.endsWith('/series/M7.html'))).toBe(true);
  });

  it('SeriesPage_ExampleCallsigns_RenderAsPillsLinkingToRegisterLookup', () => {
    // The series-page "Examples" list presents each callsign with the shared
    // pill (issue #310), linking to the register lookup at the series depth
    // (../index.html?c=…), so it looks and behaves like callsigns elsewhere.
    const m7 = fs.readFileSync(path.join(outputDir, 'series', 'M7.html'), 'utf8');
    expect(m7).toMatch(/<a class="cs callsign-pill" href="\.\.\/index\.html\?c=M7[A-Z0-9]+"/);
    // The examples are no longer bare <code> anchors.
    expect(m7).not.toMatch(/<a href="\.\.\/index\.html\?c=[^"]+"><code>/);
  });

  it('SeriesPage_ExampleCallsignPill_KeepsCallsignAsAccessibleNameWithComponentsAsTitle', () => {
    // The pill's accessible name stays the bare callsign (the link text); the
    // parsed components (prefix series · suffix · implied class) are a
    // supplementary title only, built from the same fields used site-wide.
    const m7 = fs.readFileSync(path.join(outputDir, 'series', 'M7.html'), 'utf8');
    const m = /<a class="cs callsign-pill" href="\.\.\/index\.html\?c=([^"]+)" title="([^"]*)">([^<]+)<\/a>/.exec(m7);
    expect(m).not.toBeNull();
    const [, hrefCall, title, text] = m as RegExpExecArray;
    // The link text (accessible name) equals the callsign in the href.
    expect(text).toBe(decodeURIComponent(hrefCall));
    // M7 is a Foundation series; the title carries the parsed components.
    expect(title).toContain('prefix series M7');
    expect(title).toContain('Foundation');
    expect(title.startsWith(`${text} —`)).toBe(true);
  });

  it('PageStyleShell_SeriesPage_CarriesCallsignPillStyleToken', () => {
    // The plainer page shell (PAGE_STYLE) now carries the pill CSS token (and
    // its --slot tint) so callsigns rendered on htmlPage surfaces are styled,
    // not bare - mirroring how the token reached the entry shell in #313.
    const m7 = fs.readFileSync(path.join(outputDir, 'series', 'M7.html'), 'utf8');
    expect(m7).toContain('.callsign-pill{');
    expect(m7).toMatch(/--slot:/);
  });

  it('PageStyleShell_PageWithoutCallsigns_CarriesInertPillTokenButEmitsNoPillMarkup', () => {
    // Adding the pill token to PAGE_STYLE changes callsign-free htmlPage pages
    // only by that inert CSS: the dataset index presents no callsigns, so it
    // gains the style token but renders no pill markup.
    const index = fs.readFileSync(path.join(outputDir, 'datasets', 'index.html'), 'utf8');
    expect(index).toContain('.callsign-pill{');
    expect(index).not.toContain('class="cs callsign-pill"');
  });

  it('DatasetPages_Sitemap_ListsEveryEntryPageUnderTheBaseUrl', () => {
    const sitemap = fs.readFileSync(path.join(outputDir, 'sitemap.xml'), 'utf8');
    expect(sitemap).toContain('<loc>https://example.test/site/datasets/index.html</loc>');
    expect(sitemap).toContain('<loc>https://example.test/site/explore.html</loc>');
    for (const url of summary.pageUrls) {
      expect(sitemap).toContain(`<loc>${url}</loc>`);
    }
  });

  it('DatasetPages_Rebuild_IsDeterministic', { timeout: 600_000 }, () => {
    // No timestamps or ordering instability: a rebuild over unchanged data
    // must produce identical bytes (Wayback re-crawls then see no change).
    const second = fs.mkdtempSync(path.join(os.tmpdir(), 'dataset-pages-2-'));
    try {
      buildDatasetPages(second, 'https://example.test/site');
      const rel = path.join('datasets', 'index.html');
      expect(fs.readFileSync(path.join(second, rel), 'utf8')).toBe(fs.readFileSync(path.join(outputDir, rel), 'utf8'));
      expect(fs.readFileSync(path.join(second, 'sitemap.xml'), 'utf8')).toBe(fs.readFileSync(path.join(outputDir, 'sitemap.xml'), 'utf8'));
    } finally {
      fs.rmSync(second, { recursive: true, force: true });
    }
  });
});

describe('Dataset class pages', () => {
  // Issue #178: dataset classes become clickable tags with a per-class listing
  // page each, headed by the class's registry prose and listing every entry
  // across BOTH collections that carries the class.

  it('ClassPage_RegisterSnapshot_ListsEntriesAcrossBothLanes', () => {
    const page = fs.readFileSync(path.join(outputDir, 'datasets', 'classes', 'register-snapshot.html'), 'utf8');
    // An open-data publication (register state at a vintage) is listed...
    expect(page).toContain('href="../open-data/2026-06-23/index.html"');
    // ...alongside a FOI register-snapshot disclosure.
    expect(page).toContain('href="../foi/wdtk-596532--allocated-reserved-forbidden/index.html"');
    // The cross-lane split is stated, so "both collections" is visible, not implied.
    expect(page).toMatch(/\d+ open-data, \d+ FOI/);
    // The "other classes" column links sibling class pages directly (same
    // directory) — not via a classes/ prefix that would resolve wrongly.
    expect(page).toContain('<a href="forbidden-list.html"><code>forbidden-list</code></a>');
    expect(page).not.toContain('classes/forbidden-list.html');
  });

  it('ClassPage_Header_ShowsClassRegistryProse', () => {
    // The header is the class's own authored definition (FOI_DATASET_CLASSES),
    // not an invented meaning — the same object the FOI validator enforces.
    const page = fs.readFileSync(path.join(outputDir, 'datasets', 'classes', 'forbidden-list.html'), 'utf8');
    expect(page).toContain('three-letter suffixes withheld from issue');
    // A forbidden-list FOI entry is listed on its class page.
    expect(page).toContain('href="../foi/wdtk-596532--allocated-reserved-forbidden/index.html"');
  });

  it('ClassPage_NavSkipLinkAndMainLandmark_Present', () => {
    const page = fs.readFileSync(path.join(outputDir, 'datasets', 'classes', 'register-snapshot.html'), 'utf8');
    expect(page).toContain('<a class="skip" href="#main">Skip to content</a>');
    // The landmark carries the ledger visual-language class (issue #394), so it
    // is matched by its id (the skip-link target) rather than an attribute-exact
    // substring a styling class would break.
    expect(page).toMatch(/<main id="main"[^>]*>/);
    expect(page).toContain('<strong>Dataset index</strong>'); // owning nav section marked
    // Tabular listing carries scoped column headers.
    expect(page).toContain('<th scope="col">entry</th>');
  });

  it('ClassChips_OnFoiEntryPage_RenderAsLinksToClassPages', () => {
    const page = fs.readFileSync(path.join(outputDir, 'datasets', 'foi', 'wdtk-596532--allocated-reserved-forbidden', 'index.html'), 'utf8');
    // The At-a-glance chips are links now, not bare <code> spans.
    expect(page).toContain('<a href="../../classes/register-snapshot.html"><code>register-snapshot</code></a>');
    expect(page).toContain('<a href="../../classes/forbidden-list.html"><code>forbidden-list</code></a>');
  });

  it('ClassChips_OnOpenDataEntryPage_RenderRegisterSnapshotAsLink', () => {
    const page = fs.readFileSync(path.join(outputDir, 'datasets', 'open-data', '2026-06-23', 'index.html'), 'utf8');
    expect(page).toContain('<a href="../../classes/register-snapshot.html"><code>register-snapshot</code></a>');
  });

  it('ClassChips_OnDatasetIndex_RenderAsLinksToClassPages', () => {
    const index = fs.readFileSync(path.join(outputDir, 'datasets', 'index.html'), 'utf8');
    expect(index).toContain('<a href="classes/forbidden-list.html"><code>forbidden-list</code></a>');
    // The index also points at the class index for browse-by-kind.
    expect(index).toContain('href="classes/index.html"');
  });

  it('ClassIndex_ListsEveryPresentClassWithDefinition', () => {
    const index = fs.readFileSync(path.join(outputDir, 'datasets', 'classes', 'index.html'), 'utf8');
    for (const cls of ['register-snapshot', 'available-pool', 'issuance-events', 'forbidden-list', 'statistics-aggregate', 'attribute-addendum', 'reference-context']) {
      expect(index).toContain(`<a href="${cls}.html"><code>${cls}</code></a>`);
    }
    expect(index).toContain('the register state at a vintage'); // a definition is shown
  });

  it('ClassPages_JoinSitemap', () => {
    expect(summary.pageUrls.some(u => u.endsWith('/datasets/classes/index.html'))).toBe(true);
    expect(summary.pageUrls.some(u => u.endsWith('/datasets/classes/register-snapshot.html'))).toBe(true);
    const sitemap = fs.readFileSync(path.join(outputDir, 'sitemap.xml'), 'utf8');
    expect(sitemap).toContain('<loc>https://example.test/site/datasets/classes/register-snapshot.html</loc>');
  });

  it('DatasetIndex_PointsAtTheTypeOverviews', () => {
    // The dataset index routes browse-by-kind to the type index, now described
    // as full overviews (issue #470).
    const index = fs.readFileSync(path.join(outputDir, 'datasets', 'index.html'), 'utf8');
    expect(index).toContain('href="classes/index.html">dataset types</a>');
    expect(index).toContain('full overview page');
  });
});

describe('Value-level check examples wear the shared callsign wrapper (issue #553)', { tags: ['data-validity'] }, () => {
  it('EntryPage_QualityCheckExamples_HighlightTheirDerivationTimeMarkersViaTheWrapper', () => {
    // The entry page's value-level check examples come from stats.json with
    // {U+XXXX} markers already applied; the shared callsign field wrapper
    // (pinned 'pre-marked') renders them as highlighted, non-link chips so an
    // invisible character in a published callsign is visible at a glance.
    const page = fs.readFileSync(path.join(outputDir, 'datasets', 'open-data', '2026-06-23', 'index.html'), 'utf8');
    expect(page).toContain('<code class="cs">G6<span class="marker">{U+0020}</span>FMU</code>');
  });
});

describe('Internal link integrity across the built site (issue #561)', { tags: ['data-validity'] }, () => {
  // A site-wide net for dead internal crosslinks. The generated pages are densely
  // cross-linked - reports → per-suffix / per-dataset / per-class pages,
  // breadcrumbs, series nav, glossary cues - and a renamed page, a dropped
  // generator output, or a hand-authored typo would ship a dead link silently,
  // degrading the very cross-linking the site is built around (issues #234, #310,
  // #333, #334). This crawls the whole generated tree (reusing the beforeAll
  // build) and asserts every internal href/src resolves to an emitted file, and
  // every in-page #anchor to a real id on its target.

  // Asset trees populated by other deploy steps, out of scope for the
  // generated-page crosslink guard: the databases (build-sqlite → _site/data) and
  // the vendored sql.js runtime (npm → _site/vendor). A link under these prefixes
  // is treated as satisfied rather than crawled.
  const ASSET_PREFIXES = ['data/', 'vendor/'];

  let unresolvedFiles: string[];
  let unresolvedAnchors: string[];
  let internalLinksChecked: number;

  beforeAll(() => {
    // The emitted set is the generated tree PLUS the hand-authored root assets the
    // deploy copies from site/ verbatim (index, glossary, the browser modules and
    // stylesheets). Generated pages link to both, so both count as emitted.
    const emitted = new Set<string>(listFilesRelative(outputDir));
    for (const f of fs.readdirSync('site')) {
      if (/\.(html|js|css|webmanifest)$/.test(f)) emitted.add(f);
    }
    const htmlOnDisk = (rel: string): string | null => {
      if (!rel.endsWith('.html') || !emitted.has(rel)) return null;
      const generated = path.join(outputDir, rel);
      return fs.existsSync(generated) ? generated : path.join('site', rel);
    };
    const anchorCache = new Map<string, Set<string> | null>();
    const anchorsFor = (rel: string): Set<string> | null => {
      const cached = anchorCache.get(rel);
      if (cached !== undefined) return cached;
      const disk = htmlOnDisk(rel);
      const ids = disk === null ? null : anchorIds(fs.readFileSync(disk, 'utf8'));
      anchorCache.set(rel, ids);
      return ids;
    };

    unresolvedFiles = [];
    unresolvedAnchors = [];
    internalLinksChecked = 0;
    // Sources are the GENERATED pages (the high-fan-out crosslinks this guards).
    // The hand-authored site/*.html pages are excluded as sources: their static
    // links come from one shared nav strip and their glossary deep-links are
    // already guarded (site/glossary-links.test.ts), while they also carry
    // app-driven hrefs built at runtime that a static crawl cannot resolve.
    for (const rel of listFilesRelative(outputDir).filter(r => r.endsWith('.html'))) {
      const html = fs.readFileSync(path.join(outputDir, rel), 'utf8');
      for (const { raw } of extractLinks(html)) {
        if (classifyLink(raw) !== 'internal') continue;
        internalLinksChecked += 1;
        const { path: target, fragment } = resolveInternalLink(rel, raw);
        if (ASSET_PREFIXES.some(p => target.startsWith(p))) continue;
        const key = resolveEmittedFile(target, emitted);
        if (key === null) {
          unresolvedFiles.push(`${rel} -> ${raw}`);
          continue;
        }
        if (fragment !== null && fragment !== '') {
          const ids = anchorsFor(key);
          // Only assert when the target reads as HTML on disk; a fragment on a
          // non-HTML target is out of scope here.
          if (ids !== null && !ids.has(fragment)) {
            unresolvedAnchors.push(`${rel} -> ${raw} (#${fragment} absent on ${key})`);
          }
        }
      }
    }
  }, 60_000);

  it('BuiltSite_EveryInternalLinkOnAGeneratedPage_ResolvesToAnEmittedFile', () => {
    // Guard against a silent no-op crawl (a broken extractor passing vacuously).
    expect(internalLinksChecked).toBeGreaterThan(1000);
    expect(
      unresolvedFiles,
      `dead internal links (${unresolvedFiles.length}):\n${unresolvedFiles.join('\n')}`,
    ).toEqual([]);
  });

  it('BuiltSite_EveryInPageAnchorLink_ResolvesToAnAnchorOnItsTargetPage', () => {
    expect(
      unresolvedAnchors,
      `dangling #fragment links (${unresolvedAnchors.length}):\n${unresolvedAnchors.join('\n')}`,
    ).toEqual([]);
  });
});

describe('Inline fidelity nudges + the deep-dive page (issue #438)', { tags: ['data-validity'] }, () => {
  it('BuiltSite_FidelityDeepDive_IsEmittedAndInTheSitemap', () => {
    expect(fs.existsSync(path.join(outputDir, 'fidelity.html'))).toBe(true);
    const sitemap = fs.readFileSync(path.join(outputDir, 'sitemap.xml'), 'utf8');
    expect(sitemap).toContain('<loc>https://example.test/site/fidelity.html</loc>');
    // The reports hub lists it, so the page is discoverable without a nudge.
    const hub = fs.readFileSync(path.join(outputDir, 'reports', 'index.html'), 'utf8');
    expect(hub).toContain('href="../fidelity.html"');
  });

  it('OpenDataEntryPage_AtAGlanceFlagCount_NudgesInlineToTheFlagsSection', () => {
    const page = fs.readFileSync(path.join(outputDir, 'datasets', 'open-data', '2026-06-23', 'index.html'), 'utf8');
    // The standing "N rows carry a quality flag" figure now links, in situ, to
    // the deep-dive's flags section rather than leaving the reader to hunt.
    expect(page).toMatch(/rows carry a quality flag · <a class="fid-nudge" href="\.\.\/\.\.\/\.\.\/fidelity\.html#flags">/);
  });

  it('OpenDataEntryPage_FlaggedRecordInThePreview_CarriesPerRecordFlagNudges', () => {
    // The 2025-04-08 publication's first preview rows include the committed
    // excel-date-shape artefacts ("20-Apr" et al), so its preview must carry
    // the per-record badge beside the pill, deep-linked to that flag's row.
    const page = fs.readFileSync(path.join(outputDir, 'datasets', 'open-data', '2025-04-08', 'index.html'), 'utf8');
    expect(page).toContain('<span class="tb fid">excel-date-shape</span>');
    expect(page).toContain('href="../../../fidelity.html#flag-excel-date-shape"');
    // The badge is a supplement to the shared pill, never a replacement.
    expect(page).toMatch(/class="callsign-pill"[^>]*>20-Apr<\/a> <a class="fid-nudge"/);
  });

  it('OpenDataEntryPage_UnflaggedRecords_CarryNoFidelityNudge', () => {
    // Selective disclosure: the latest publication's first preview rows carry
    // no flags, so its preview renders pills alone — the affordance never
    // manufactures doubt where no observation exists.
    const page = fs.readFileSync(path.join(outputDir, 'datasets', 'open-data', '2026-06-23', 'index.html'), 'utf8');
    const preview = /<div class="browser-static">([\s\S]*?)<\/div>/.exec(page);
    expect(preview).not.toBeNull();
    expect(preview?.[1] ?? '').not.toContain('tb fid');
  });

  it('ReconstructedEntry_ProvenanceNotice_LinksTheCustodyExplanation', () => {
    // 2025-04-08 is a reconstructed-provenance entry; its notice's disclosure
    // offers the deep-dive's provenance section alongside meta.json.
    const page = fs.readFileSync(path.join(outputDir, 'datasets', 'open-data', '2025-04-08', 'index.html'), 'utf8');
    expect(page).toContain('href="../../../fidelity.html#provenance"');
  });
});
