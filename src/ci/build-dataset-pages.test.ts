import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildDatasetPages, dayGap, signedDelta, type DatasetPagesSummary } from './build-dataset-pages.ts';

// Test names follow Subject_Scenario_Outcome per project convention.
//
// The dataset index (issue #149 item 3) is a deploy artefact: entry pages
// that publish the archived files verbatim at stable URLs, a Frictionless
// descriptor per entry, and a sitemap for Wayback crawlability. These tests
// build the real archive into a scratch directory - the same thing the
// Pages workflow does.

let outputDir: string;
let summary: DatasetPagesSummary;

// Generous hook timeout: the per-entry RSL matrices parse seven ~158k-row
// components.csv files, which exceeds the 10s default on CI runners.
beforeAll(() => {
  outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dataset-pages-'));
  summary = buildDatasetPages(outputDir, 'https://example.test/site');
}, 300_000);

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
    // Anomalies surface (Notable coda + the stats.json inspect panel).
    expect(page).toContain('<code>forbidden-suffix</code>');
    expect(page).toContain('2,826');
    // The re-fetch check points at the most recent INTENDED-COMPLETE
    // earlier publication - 2025-06-08 is a declared-partial 1,074-row
    // truncation and must NOT be the changes-since baseline.
    expect(page).toContain('byte-identical to the earlier fetch');
    expect(page).toContain('Compare with <a href="../2025-06-04/index.html">');
    // The partial 2025-06-08 snapshot is reachable only from the collapsed
    // "partial exports" section of the navigation, never as the diff baseline.
    expect(page).toMatch(/partial exports?<\/summary>[\s\S]*?href="\.\.\/\.\.\/open-data\/2025-06-08\/index\.html"/);
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
    // scripts are loaded, so entry-browser.js can query master scoped to it.
    expect(page).toContain('class="browser" data-dataset="2026-06-23"');
    expect(page).toContain('src="../../../vendor/index.js"');
    expect(page).toContain('src="../../../entry-browser.js"');
    // The static preview remains as the no-JS/crawlable fallback.
    expect(page).toContain('class="browser-static"');
    // Breakdown rows are click-to-filter targets feeding the browser facets.
    expect(page).toContain('data-filter-col="status" data-filter-val="Allocated"');
    expect(page).toContain('data-filter-col="implied_class" data-filter-val="Full"');
    expect(page).toContain('data-filter-col="prefix_series" data-filter-val="M3"');
    // The prefix label filters on click; only the small ↗ navigates to the
    // series page (so the row is a filter, not a surprise navigation).
    expect(page).toContain('class="seriesnav" href="../../../series/M3.html"');
    // The Notable forbidden-suffix line is a cohort with two filter links:
    // the whole set, and the "issued since the 2019 list" subset.
    expect(page).toMatch(/data-browser-sql="SELECT[^"]*suffix IN \(SELECT suffix FROM ref_forbidden_suffixes\)[^"]*ORDER BY callsign"/);
    expect(page).toContain('issued since the 2019 list');
    expect(page).toContain("licence_version_original_start_date &gt;= '2019-08-01'");
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
    // Every static page also carries the skip link + main landmark.
    for (const page of ['index', 'statistics', 'explore', 'compare']) {
      const html = fs.readFileSync(path.join('site', `${page}.html`), 'utf8');
      expect(html).toContain('<a class="skip" href="#main">Skip to content</a>');
      expect(html).toContain('<main id="main">');
    }
  });

  it('GeneratedPages_HaveMainLandmarkAndSkipLink', () => {
    // Every generated page (index + entry templates) wraps its content in a
    // <main id="main"> landmark reachable by a first-focusable skip link.
    for (const rel of [['datasets', 'index.html'], ['reports', 'index.html'], ['series', 'M7.html'], ['datasets', 'open-data', '2026-06-23', 'index.html']]) {
      const html = fs.readFileSync(path.join(outputDir, ...rel), 'utf8');
      expect(html).toContain('<a class="skip" href="#main">Skip to content</a>');
      expect(html).toContain('<main id="main">');
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

  it('DatasetPages_Sitemap_ListsEveryEntryPageUnderTheBaseUrl', () => {
    const sitemap = fs.readFileSync(path.join(outputDir, 'sitemap.xml'), 'utf8');
    expect(sitemap).toContain('<loc>https://example.test/site/datasets/index.html</loc>');
    expect(sitemap).toContain('<loc>https://example.test/site/explore.html</loc>');
    for (const url of summary.pageUrls) {
      expect(sitemap).toContain(`<loc>${url}</loc>`);
    }
  });

  it('DatasetPages_Rebuild_IsDeterministic', { timeout: 300_000 }, () => {
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
