import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  renderFlagsTableHtml,
  renderRslMatrixHtml,
  renderLatestProfileHtml,
  renderColumnProfilesHtml,
  renderCallsignTaxonomyHtml,
  renderCallsignQualityHtml,
  injectHomeAggregates,
} from './build-home-aggregates.ts';

// Test names follow Subject_Scenario_Outcome per project convention.
//
// The home page's aggregate blocks are deterministic per deploy, so they
// are pre-rendered into index.html at build time; app.js skips its dynamic
// render when it finds the injected content. These tests run against the
// real archive - the same inputs the deploy uses.

describe('Home-page aggregate pre-rendering', { tags: ['unit'] }, () => {
  it('FlagsTable_RealArchive_PivotsEveryPublicationWithRecordsRow', () => {
    const html = renderFlagsTableHtml();
    // Dataset column headers link to their entry pages.
    expect(html).toContain('<th scope="col" class="num"><a href="datasets/open-data/2026-06-23/index.html">2026-06-23</a></th>');
    expect(html).toContain('<td>records</td>');
    expect(html).toContain('<td>forbidden-suffix</td>');
    // Newest-first column order: 2026 keys precede the 2023 import.
    expect(html.indexOf('2026-06-23')).toBeLessThan(html.indexOf('2023-02-20'));
  });

  it('RslMatrix_RealArchive_CarriesReferenceDrivenRowsTotalsAndExclusions', () => {
    const html = renderRslMatrixHtml();
    // Series stored bare (20), displayed with the # slot marker, linked
    // to the series entity page.
    expect(html).toContain('<a href="series/20.html">2#0</a>');
    expect(html).toContain('·'); // zero-marker convention preserved
    expect(html).toContain('Excluded from this table:');
    expect(html).toContain('unparseable');
    // Accessible 2-D table: column headers scoped, and each series row label
    // (and the total row) is a scoped ROW header so a screen reader can resolve
    // which series a data cell belongs to.
    expect(html).toContain('<th scope="col"');
    expect(html).toContain('<th scope="row">total</th>');
    expect(html).toMatch(/<th scope="row"[^>]*><a href="series\/20\.html">/);
    // The observed-but-unreferenced warning carries a text alternative, not a
    // bare glyph that reads as "warning sign".
    expect(html).toContain('<abbr title="observed in the register but absent from reference data">⚠</abbr>');
  });

  it('LatestProfile_RealArchive_CarriesHeadlineFiguresAndParseStatusDistribution', () => {
    const html = renderLatestProfileHtml();
    // The newest publication is named and linked to its entry page, with a
    // humanised date beside the archive key.
    expect(html).toContain('<a href="datasets/open-data/2026-06-23/index.html">2026-06-23</a> (23 June 2026)');
    // Coverage is surfaced as DECLARED, never as an independent guarantee.
    expect(html).toContain('declared by the publisher, not independently verified');
    // Parse status is a distribution (records + share), not a bare total, and
    // each status row is a scoped row header for screen readers.
    expect(html).toContain('<h3>Parse-status breakdown</h3>');
    expect(html).toContain('<th scope="row">parsed</th>');
    expect(html).toContain('<th scope="row">visitor</th>');
    expect(html).toContain('<th scope="row">unparseable</th>');
    // The proportion bar is decorative - the count and share carry the value -
    // so it is hidden from assistive technology.
    expect(html).toMatch(/<span class="mono" aria-hidden="true">[█░]+<\/span>/);
  });

  it('LatestProfile_EmptyRecordCount_HumanisedRatherThanBareZero', () => {
    // The newest publication has no all-empty rows; a blank/absent quantity is
    // named ("none"), never left as a bare 0 the reader must interpret.
    const html = renderLatestProfileHtml();
    expect(html).toContain('<th scope="row">Empty records</th><td>none</td>');
  });

  it('ColumnProfiles_RealArchive_ExposesPerColumnEmptinessAndRanges', () => {
    const html = renderColumnProfilesHtml();
    // Every column is a scoped row header, with distinct/populated/empty columns.
    expect(html).toContain('<th scope="row">product</th>');
    expect(html).toContain('<th scope="col" class="num">empty</th>');
    // The product column's blank-value emptiness is surfaced with its share.
    expect(html).toContain('40,160 (25%)');
    // A column empty on every row is humanised, not shown as a spurious range.
    expect(html).toContain('<th scope="row">created_date</th>');
    expect(html).toContain('(never populated)');
    // Date columns render a humanised span, not raw ISO strings.
    expect(html).toContain('3 May 1903 – 11 June 2026');
  });

  it('CallsignTaxonomy_RealArchive_RanksShapesAndKeepsFullTailInDetails', () => {
    const html = renderCallsignTaxonomyHtml();
    // The pattern alphabet is explained so a shape like ANAAA is readable.
    expect(html).toContain('upper-case letter');
    // The dominant shape leads, rendered monospace as a scoped row header.
    expect(html).toContain('<th scope="row"><span class="mono">ANAAA</span></th>');
    // Only the top shapes are in the lead table; the full taxonomy is folded
    // into a details block so an archived capture keeps the long tail.
    expect(html).toContain('<details><summary>Full taxonomy');
    // A rare anomaly shape lives in the full list but not the top table.
    expect(html).toContain('AAAAAAAAAAA');
  });

  it('CallsignQuality_RealArchive_ShowsDetectorHitsAndExamplesDeclaredNotVerified', () => {
    const html = renderCallsignQualityHtml();
    // Each detector is a scoped row header with a count and example values.
    expect(html).toContain('<th scope="row">Whitespace or invisible character present</th>');
    expect(html).toContain('G6{U+0020}FMU');
    // Counts are framed as detected, not verified.
    expect(html).toContain('declared but not independently verified against Ofcom');
    // A zero-hit detector still appears, with its examples humanised to an em dash.
    expect(html).toContain('<th scope="row">Empty callsign</th>');
    expect(html).toContain('<span class="muted">—</span>');
  });

  it('InjectHomeAggregates_StatisticsPage_ReplacesEveryPlaceholder', () => {
    const scratch = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'home-agg-')), 'statistics.html');
    fs.copyFileSync(path.join('site', 'statistics.html'), scratch);
    injectHomeAggregates(scratch);
    const html = fs.readFileSync(scratch, 'utf8');
    expect(html).toContain('<div id="latest-profile-table" data-prerendered>');
    expect(html).toContain('<div id="rsl-matrix-table" data-prerendered>');
    expect(html).toContain('<div id="column-profiles-table" data-prerendered>');
    expect(html).toContain('<div id="callsign-taxonomy-table" data-prerendered>');
    expect(html).toContain('<div id="callsign-quality-table" data-prerendered>');
    expect(html).toContain('<div id="flags-table" data-prerendered>');
    expect(html).not.toContain('generated at deploy time — build the site to populate');
    // Fully static by design: archived captures must be complete, so the
    // statistics page ships without any script.
    expect(html).not.toContain('<script');
    fs.rmSync(path.dirname(scratch), { recursive: true, force: true });
  });

  it('HomePage_CarriesNoAggregatePlaceholders_TheStatisticsPageOwnsThem', () => {
    // The split: index.html is the interactive lookup only. A placeholder
    // reappearing there would mean the injection targets have drifted.
    const home = fs.readFileSync(path.join('site', 'index.html'), 'utf8');
    expect(home).not.toContain('rsl-matrix-table');
    expect(home).not.toContain('flags-table');
    expect(home).toContain('statistics.html');
  });

  it('InjectHomeAggregates_PlaceholderMissing_FailsLoudly', () => {
    const scratch = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'home-agg-bad-')), 'index.html');
    fs.writeFileSync(scratch, '<html><body>no placeholders here</body></html>');
    expect(() => injectHomeAggregates(scratch)).toThrow(/placeholder not found/);
    fs.rmSync(path.dirname(scratch), { recursive: true, force: true });
  });
});
