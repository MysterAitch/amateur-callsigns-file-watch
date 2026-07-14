import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  STAGES,
  buildOpenDataRows,
  buildFoiRows,
  buildHeldRows,
  parseKnownAbsent,
  readKnownAbsent,
  buildSeries,
  renderInventoryGrid,
  renderRollup,
  renderKnownAbsent,
  renderSeriesGaps,
  injectDataStatus,
} from './build-data-status.ts';

// Test names follow Subject_Scenario_Outcome per project convention.
//
// The /data-status page (issue #376) is a build-time-DERIVED coverage tracker:
// every row and cell is computed from the committed archive and the source
// register, never hand-maintained. These tests run against the real archive -
// the same inputs the deploy uses - so a status that drifts from the artefacts
// on disk fails here.

describe('data-status: held-dataset inventory & processing grid', { tags: ['data-validity'] }, () => {
  it('OpenDataRows_RealArchive_AreFullyProcessedRegisterSnapshots', () => {
    const rows = buildOpenDataRows();
    expect(rows.length).toBeGreaterThan(0);
    // Every open-data publication is a register snapshot carrying raw +
    // normalised + components, so all five stages read as done.
    const newest = rows[rows.length - 1];
    expect(newest.primaryClass).toBe('register-snapshot');
    expect(newest.lane).toBe('open-data');
    expect(newest.authority.label).toBe('Official');
    for (const stage of STAGES) {
      expect(newest.stages[stage.key].state, `${stage.label} for ${newest.key}`).toBe('done');
    }
  });

  it('FoiRow_NormalisedRegisterSnapshot_ReadsThroughToPartialEnrichment', () => {
    const rows = buildFoiRows();
    const snapshot = rows.find(r => r.key === 'ofcom-2023-08-18--call-sign-list--all-callsigns');
    expect(snapshot).toBeDefined();
    if (snapshot === undefined) return;
    expect(snapshot.stages.read.state).toBe('done');
    expect(snapshot.stages.understood.state).toBe('done');
    expect(snapshot.stages.validated.state).toBe('done');
    expect(snapshot.stages.normalised.state).toBe('done');
    // FOI register snapshots are enriched collectively in the combined database,
    // not as a per-entry file - honestly partial, never claimed complete.
    expect(snapshot.stages.enriched.state).toBe('partial');
    expect(snapshot.stages.enriched.detail).toContain('combined database');
  });

  it('FoiRow_PdfOnlyHeldSnapshot_IsSurfacedAsHeldButUnprocessed', () => {
    // The 2017 full-list is held only as PDFs with a prose transcription and no
    // structured extract or converter: the standing "held but not yet
    // processable" case the tracker must surface, not hide.
    const rows = buildFoiRows();
    const pdfOnly = rows.find(r => r.key === 'ofcom-2017-07-03--all-callsigns-with-status');
    expect(pdfOnly).toBeDefined();
    if (pdfOnly === undefined) return;
    expect(pdfOnly.recordOnly).toBe(false);
    expect(pdfOnly.stages.read.state).toBe('partial'); // transcription only
    expect(pdfOnly.stages.normalised.state).toBe('none');
  });

  it('FoiRow_NotHeldResponse_IsARecordWithStagesNotApplicable', () => {
    const rows = buildFoiRows();
    const record = rows.find(r => r.key === 'ofcom-518689--suffix-availability-not-held');
    expect(record).toBeDefined();
    if (record === undefined) return;
    expect(record.recordOnly).toBe(true);
    for (const stage of STAGES) {
      expect(record.stages[stage.key].state, `${stage.label}`).toBe('na');
    }
  });

  it('Grid_RealArchive_GroupsByTypeAndLinksEntriesWithStagePills', () => {
    const html = renderInventoryGrid(buildHeldRows());
    // Every stage is a column header carrying its plain-English definition.
    for (const stage of STAGES) {
      expect(html).toContain(`>${stage.label}</th>`);
    }
    // Datasets are grouped by type, and each key links to its entry page.
    expect(html).toContain('Register snapshots');
    expect(html).toContain('Records &amp; context (not datasets)');
    expect(html).toContain('href="datasets/open-data/');
    expect(html).toContain('href="datasets/foi/');
    // A cell renders as an accessible pill: a glyph for sight plus a
    // visually-hidden state for assistive tech, and a title elaboration.
    expect(html).toContain('class="pill st-done"');
    expect(html).toMatch(/class="pill st-\w+" title="[^"]+"/);
    expect(html).toContain('class="visually-hidden"');
  });

  it('Rollup_RealArchive_CountsDatasetsAndDoneStagesPerType', () => {
    const html = renderRollup(buildHeldRows());
    expect(html).toContain('Register snapshots');
    expect(html).toContain('<th scope="col" class="num">Datasets</th>');
    // Every rollup cell reports a fully-done tally with the ✓ marker.
    expect(html).toMatch(/<td class="num">\d+✓/);
  });
});

describe('data-status: known-but-absent (parsed from the source register)', { tags: ['data-validity'] }, () => {
  const REGISTER = `
## FOI datasets — register snapshots

| source | data vintage | status | notes |
|---|---|---|---|
| Held thing | 2020-01 | ingested | already in the archive |
| Missing snapshot 2026 | 2026-02 | pending-fetch | disclosure log lists response PDF only |

## FOI datasets — attribute addenda

| source | date | status | notes |
|---|---|---|---|
| Some bytes on disk | 2018-12 | pending-ingest | UKGWA copy, converter outstanding |

prose interruption that splits the table

| A range-dated addendum | 2017-2018 | pending-ingest | reissue policy/data |

## FOI responses that are records, not datasets

| source | date | status | notes |
|---|---|---|---|
| Not a dataset | 2016-10 | pending-fetch | a record, must NOT appear |

## Context documents (retained, not datasets)

| source | status | notes |
|---|---|---|
| Context doc | pending-fetch | must NOT appear |
`;

  it('ParseKnownAbsent_DatasetSections_KeepsOnlyPendingRows', () => {
    const items = parseKnownAbsent(REGISTER);
    const sources = items.map(i => i.source);
    expect(sources).toContain('Missing snapshot 2026');
    expect(sources).toContain('Some bytes on disk');
    // Ingested rows are excluded (they are held).
    expect(sources).not.toContain('Held thing');
  });

  it('ParseKnownAbsent_NonDatasetSections_AreExcluded', () => {
    const items = parseKnownAbsent(REGISTER);
    const sources = items.map(i => i.source);
    // Records and context documents are not datasets, so never listed here.
    expect(sources).not.toContain('Not a dataset');
    expect(sources).not.toContain('Context doc');
  });

  it('ParseKnownAbsent_TableSplitByProse_StillParsesLaterRows', () => {
    // The real attribute-addenda table is interrupted by a prose note; the
    // remembered header must carry across so rows after it still parse.
    const items = parseKnownAbsent(REGISTER);
    expect(items.map(i => i.source)).toContain('A range-dated addendum');
  });

  it('ParseKnownAbsent_YearRangeCell_YieldsNoFalseDate', () => {
    // "2017-2018" is a year range, not month 20 - it must not become a bogus
    // dated vintage.
    const item = parseKnownAbsent(REGISTER).find(i => i.source === 'A range-dated addendum');
    expect(item?.vintage).toBeNull();
  });

  it('ParseKnownAbsent_Status_DrivesAPlainNextStep', () => {
    const items = parseKnownAbsent(REGISTER);
    const fetch = items.find(i => i.source === 'Missing snapshot 2026');
    const ingest = items.find(i => i.source === 'Some bytes on disk');
    expect(fetch?.action).toMatch(/recover the authoritative copy/i);
    expect(ingest?.action).toMatch(/converter/i);
  });

  it('ReadKnownAbsent_RealRegister_FindsPendingDatasetsWithActions', () => {
    const items = readKnownAbsent();
    expect(items.length).toBeGreaterThan(0);
    // The February 2026 register snapshot is a known, not-yet-fetched dataset.
    expect(items.some(i => /February 2026/.test(i.source))).toBe(true);
    for (const item of items) {
      expect(['pending-fetch', 'pending-ingest'].some(s => item.status.includes(s))).toBe(true);
      expect(item.action.length).toBeGreaterThan(0);
    }
  });

  it('RenderKnownAbsent_Items_TableFramesThemAsReadNotDone', () => {
    const html = renderKnownAbsent(readKnownAbsent());
    expect(html).toContain('Suggested next step');
    expect(html).toContain('Read ✗');
    expect(html).toContain('source-register.md');
  });
});

describe('data-status: series coverage & gaps', { tags: ['data-validity'] }, () => {
  it('BuildSeries_RealArchive_OrdersVintagesAndFlagsLongGaps', () => {
    const rows = buildHeldRows();
    const series = buildSeries(rows, readKnownAbsent());
    const registerSeries = series.find(s => s.classKey === 'register-snapshot');
    expect(registerSeries).toBeDefined();
    if (registerSeries === undefined) return;
    // Vintages are chronological, earliest first.
    const vintages = registerSeries.vintages.map(v => v.vintage);
    expect([...vintages].sort()).toEqual(vintages);
    // The 2017→2019 silence in the register-snapshot series is a real, long gap.
    expect(registerSeries.gaps.some(g => g.months >= 12)).toBe(true);
  });

  it('RenderSeriesGaps_Gaps_SurfaceThemWithAPlainNextStep', () => {
    const rows = buildHeldRows();
    const series = buildSeries(rows, readKnownAbsent());
    const html = renderSeriesGaps(series);
    expect(html).toMatch(/Gap of \d+ months between/);
    expect(html).toContain('consider recovering an intervening snapshot');
  });
});

describe('data-status: page injection', { tags: ['data-validity'] }, () => {
  it('InjectDataStatus_RealArchive_ReplacesEveryPlaceholderAndStaysScriptFree', () => {
    const scratch = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'data-status-')), 'data-status.html');
    fs.copyFileSync(path.join('site', 'data-status.html'), scratch);
    injectDataStatus(scratch);
    const html = fs.readFileSync(scratch, 'utf8');
    for (const id of ['ds-summary', 'ds-grid', 'ds-rollup', 'ds-known-absent', 'ds-series']) {
      expect(html).toContain(`<div id="${id}" data-prerendered>`);
    }
    expect(html).not.toContain('generated at deploy time — build the site to populate');
    // Fully static by design so archived captures are complete.
    expect(html).not.toContain('<script');
    // The three-axis framing is present and names this the processing view.
    expect(html).toContain('This is axis 1 of three');
    fs.rmSync(path.dirname(scratch), { recursive: true, force: true });
  });

  it('InjectDataStatus_PlaceholderMissing_FailsLoudly', () => {
    const scratch = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'data-status-bad-')), 'data-status.html');
    fs.writeFileSync(scratch, '<html><body>no placeholders here</body></html>');
    expect(() => injectDataStatus(scratch)).toThrow(/placeholder not found/);
    fs.rmSync(path.dirname(scratch), { recursive: true, force: true });
  });
});
