import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { renderFlagsTableHtml, renderRslMatrixHtml, injectHomeAggregates } from './build-home-aggregates.ts';

// Test names follow Subject_Scenario_Outcome per project convention.
//
// The home page's aggregate blocks are deterministic per deploy, so they
// are pre-rendered into index.html at build time; app.js skips its dynamic
// render when it finds the injected content. These tests run against the
// real archive - the same inputs the deploy uses.

describe('Home-page aggregate pre-rendering', () => {
  it('FlagsTable_RealArchive_PivotsEveryPublicationWithRecordsRow', () => {
    const html = renderFlagsTableHtml();
    expect(html).toContain('<th class="num">2026-06-23</th>');
    expect(html).toContain('<td>records</td>');
    expect(html).toContain('<td>forbidden-suffix</td>');
    // Newest-first column order: 2026 keys precede the 2023 import.
    expect(html.indexOf('2026-06-23')).toBeLessThan(html.indexOf('2023-02-20'));
  });

  it('RslMatrix_RealArchive_CarriesReferenceDrivenRowsTotalsAndExclusions', () => {
    const html = renderRslMatrixHtml();
    expect(html).toContain('<td>2#0</td>'); // Intermediate placeholder series
    expect(html).toContain('<td>total</td>');
    expect(html).toContain('·'); // zero-marker convention preserved
    expect(html).toContain('Excluded from this table:');
    expect(html).toContain('unparseable');
  });

  it('InjectHomeAggregates_StatisticsPage_ReplacesBothPlaceholders', () => {
    const scratch = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'home-agg-')), 'statistics.html');
    fs.copyFileSync(path.join('site', 'statistics.html'), scratch);
    injectHomeAggregates(scratch);
    const html = fs.readFileSync(scratch, 'utf8');
    expect(html).toContain('<div id="rsl-matrix-table" data-prerendered>');
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
