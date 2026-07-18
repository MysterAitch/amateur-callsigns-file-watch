import { describe, it, expect } from 'vitest';
import { DIRS } from '../shared/constants.ts';
import { defaultFoiDir, listFoiEntryKeys, readFoiEntryMeta } from '../shared/foi-archive.ts';
import {
  buildFormatEvolutionRows,
  buildAvailableListRows,
  renderFormatEvolutionTable,
  renderAvailableListEnumeration,
  applyChronologyTokens,
  resolveFoiTabularFile,
  FORMAT_EVOLUTION_TOKEN,
  AVAILABLE_LIST_TOKEN,
} from './chronology-tables.ts';

// Test names follow Subject_Scenario_Outcome per project convention. These
// exercise the two self-updating chronology tables (issue #821) against the
// REAL committed archive — the same metadata the build reads — so the
// expectations are derived from the archive itself wherever possible, with a
// small number of stable, concretely-pinned rows.

const foiDir = defaultFoiDir();
const archiveDir = DIRS.archive;

// The eight-column Siebel-era report header the 2015 typed available lists
// carry — quoted in the narrative prose and stable in the committed files.
const EIGHT_COLUMN_HEADER = 'Country,Current Series,Reference,Value,Type,Product,Status,Allocated Flag';

// Every FOI entry the archive classes `available-pool`, derived straight from
// the committed metadata so the enumeration test cannot silently drift from it.
function availablePoolKeysFromMetadata(): string[] {
  return listFoiEntryKeys(foiDir)
    .filter(key => readFoiEntryMeta(foiDir, key).datasetClasses.includes('available-pool'))
    .sort();
}

describe('FormatEvolutionTable', { tags: ['unit'] }, () => {
  it('FormatEvolutionRows_WhenBuiltFromArchive_PinsTheEightColumnTypedExportRow', () => {
    const rows = buildFormatEvolutionRows(foiDir, archiveDir);
    const typed = rows.find(r => r.key === 'wdtk-247308--available-callsigns-list');
    expect(typed).toBeDefined();
    expect(typed?.lane).toBe('foi');
    expect(typed?.vintage).toBe('2015-02-25');
    expect(typed?.datasetClasses).toContain('available-pool');
    expect(typed?.header).toBe(EIGHT_COLUMN_HEADER);
  });

  it('FormatEvolutionRows_WhenBuiltFromArchive_IncludeOpenDataSnapshotsWithVerbatimHeader', () => {
    const rows = buildFormatEvolutionRows(foiDir, archiveDir);
    const earliestOpenData = rows.find(r => r.key === '2022-05-30');
    expect(earliestOpenData).toBeDefined();
    expect(earliestOpenData?.lane).toBe('open-data');
    expect(earliestOpenData?.datasetClasses).toEqual(['register-snapshot']);
    // The 2022 friendly-label Salesforce header, read off the committed raw.csv.
    expect(earliestOpenData?.header).toBe('Value,Status,Type');
  });

  it('FormatEvolutionRows_WhenEntryHeldOnlyAsPdfOrZip_AreExcludedRatherThanFaked', () => {
    const rows = buildFormatEvolutionRows(foiDir, archiveDir);
    const keys = new Set(rows.map(r => r.key));
    // Both are register-snapshot-classed but held only as a PDF letter / a
    // verbatim zip — no committed tabular file, so no committed header shape.
    expect(keys.has('ofcom-337399--all-callsigns-published-copy')).toBe(false);
    expect(keys.has('ofcom-2017-07-03--all-callsigns-with-status')).toBe(false);
    expect(resolveFoiTabularFile(readFoiEntryMeta(foiDir, 'ofcom-337399--all-callsigns-published-copy').files)).toBeUndefined();
    expect(resolveFoiTabularFile(readFoiEntryMeta(foiDir, 'ofcom-2017-07-03--all-callsigns-with-status').files)).toBeUndefined();
  });

  it('FormatEvolutionRows_WhenBuiltFromArchive_AreOrderedByVintageAscending', () => {
    const rows = buildFormatEvolutionRows(foiDir, archiveDir);
    expect(rows.length).toBeGreaterThan(30);
    const vintages = rows.map(r => r.vintage ?? '￿');
    const sorted = [...vintages].sort((a, b) => a.localeCompare(b));
    expect(vintages).toEqual(sorted);
    // The oldest export is the 2013 available list.
    expect(rows[0].key).toBe('wdtk-174341--available-callsigns-list');
  });

  it('FormatEvolutionRows_EveryNonNullHeader_IsAColumnHeaderRow', () => {
    // A header cell is only populated when the export's first line is genuinely
    // a column-header row (carries a field separator); the early prefix/suffix
    // lists with no header row report null instead of a section marker.
    for (const row of buildFormatEvolutionRows(foiDir, archiveDir)) {
      if (row.header !== null) expect(row.header).toContain(',');
    }
  });

  it('FormatEvolutionTable_WhenRendered_LinksEveryRowToItsEntryPage', () => {
    const rows = buildFormatEvolutionRows(foiDir, archiveDir);
    const html = renderFormatEvolutionTable(rows);
    for (const row of rows) {
      const href = row.lane === 'foi'
        ? `../../datasets/foi/${encodeURIComponent(row.key)}/index.html`
        : `../../datasets/open-data/${encodeURIComponent(row.key)}/index.html`;
      expect(html).toContain(`href="${href}"`);
    }
    // The pinned 8-column header renders verbatim inside a <code> cell, and the
    // vintage renders through the shared #551 date wrapper.
    expect(html).toContain(`<code>${EIGHT_COLUMN_HEADER}</code>`);
    expect(html).toContain('class="ts"');
  });

  it('FormatEvolutionTable_WhenHeaderAbsent_RendersTheSharedAbsentMarkerNotAnEmDash', () => {
    // wdtk-174341's early sheet-list export has no column-header row.
    const rows = buildFormatEvolutionRows(foiDir, archiveDir);
    const noHeader = rows.find(r => r.header === null);
    expect(noHeader).toBeDefined();
    const html = renderFormatEvolutionTable(rows);
    expect(html).toContain('class="absent"');
    expect(html).not.toContain('—</td>');
  });
});

describe('AvailableListEnumeration', { tags: ['unit'] }, () => {
  it('AvailableListRows_WhenBuiltFromArchive_ListEveryAvailablePoolSnapshotInTheSeries', () => {
    const expected = availablePoolKeysFromMetadata();
    const actual = buildAvailableListRows(foiDir).map(r => r.key).sort();
    expect(actual).toEqual(expected);
    // Concretely pinned endpoints of the 2013 → 2016 series.
    expect(actual).toContain('wdtk-174341--available-callsigns-list');
    expect(actual).toContain('wdtk-247308--available-callsigns-list');
    expect(actual).toContain('wdtk-309076--available-callsigns-list');
  });

  it('AvailableListRows_WhenBuiltFromArchive_AreOrderedOldestFirstAcrossTheSeries', () => {
    const rows = buildAvailableListRows(foiDir);
    expect(rows[0].key).toBe('wdtk-174341--available-callsigns-list');
    expect(rows[0].vintage).toBe('2013-09-06');
    expect(rows[rows.length - 1].key).toBe('wdtk-309076--available-callsigns-list');
  });

  it('AvailableListEnumeration_WhenRendered_LinksEverySnapshotToItsPage', () => {
    const rows = buildAvailableListRows(foiDir);
    const html = renderAvailableListEnumeration(rows);
    for (const row of rows) {
      expect(html).toContain(`href="../../datasets/foi/${encodeURIComponent(row.key)}/index.html"`);
    }
  });
});

describe('ChronologyTokenReplacement', { tags: ['unit'] }, () => {
  it('ApplyChronologyTokens_WhenParagraphTokensPresent_ReplacesThemWithGeneratedTables', () => {
    const input = `<p>intro</p><p>${FORMAT_EVOLUTION_TOKEN}</p><p>mid</p><p>${AVAILABLE_LIST_TOKEN}</p>`;
    const out = applyChronologyTokens(input, { foiDir, archiveDir });
    expect(out).not.toContain(FORMAT_EVOLUTION_TOKEN);
    expect(out).not.toContain(AVAILABLE_LIST_TOKEN);
    // Both tables landed, and the surrounding prose paragraphs are untouched.
    expect(out).toContain('How the register/list export format evolved');
    expect(out).toContain('Every archived available-callsign snapshot in the series');
    expect(out).toContain('<p>intro</p>');
    expect(out).toContain('<p>mid</p>');
  });

  it('ApplyChronologyTokens_WhenNoTokenPresent_ReturnsInputUnchanged', () => {
    const input = '<p>a narrative with no generated tables</p>';
    expect(applyChronologyTokens(input, { foiDir, archiveDir })).toBe(input);
  });
});
