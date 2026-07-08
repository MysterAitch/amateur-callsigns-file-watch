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

beforeAll(() => {
  outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dataset-pages-'));
  summary = buildDatasetPages(outputDir, 'https://example.test/site');
});

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
    expect(page).toContain('dataset unrecovered');
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

  it('DatasetPages_Sitemap_ListsEveryEntryPageUnderTheBaseUrl', () => {
    const sitemap = fs.readFileSync(path.join(outputDir, 'sitemap.xml'), 'utf8');
    expect(sitemap).toContain('<loc>https://example.test/site/datasets/index.html</loc>');
    for (const url of summary.pageUrls) {
      expect(sitemap).toContain(`<loc>${url}</loc>`);
    }
  });

  it('DatasetPages_Rebuild_IsDeterministic', () => {
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
