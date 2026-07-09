import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildDatasetPages, type DatasetPagesSummary } from './build-dataset-pages.ts';

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

describe('Dataset pages build', () => {
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
    expect(page).toContain('href="../2025-06-04/index.html"');
    expect(page).not.toContain('href="../2025-06-08/index.html"');
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
    // Long tails are explorable: chart rows carry a scoped-browser query.
    expect(page).toContain('data-browser-sql="SELECT');
    expect(page).toContain('LENGTH(callsign) = 12'); // the length-12 tail
    // Blank category values are humanised, never shown as an empty label.
    expect(page).not.toMatch(/<td><\/td><td class="n">/);
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
    // Status-breakdown rows are click-to-filter targets for the browser.
    expect(page).toContain('data-filter-status="Allocated"');
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
