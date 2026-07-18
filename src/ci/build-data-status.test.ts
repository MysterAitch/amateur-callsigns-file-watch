import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  STAGES,
  type DatasetRow,
  type StageCell,
  type StageKey,
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
  renderAnomalyObservations,
  injectDataStatus,
  CLASS_BLURBS,
} from './build-data-status.ts';
import { RATIONALE_SOURCE_LABEL } from './build-forbidden-section.ts';
import { computeDatasetAnomalyFlags, anomalyMetricsChecked, type DatasetAnomalyFlag, type AnomalyMetricsChecked } from './dataset-anomaly-flags.ts';

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
    // FOI register snapshots are enriched collectively in the full-history
    // database, not as a per-entry file - honestly partial, never claimed complete.
    expect(snapshot.stages.enriched.state).toBe('partial');
    expect(snapshot.stages.enriched.detail).toContain('full-history database');
    // Pin the projection-accurate wording (#608): the interactive surfaces now
    // read the ledger-history projection, not a "combined" database.
    expect(snapshot.stages.enriched.detail).not.toContain('combined');
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

// These tests drive the pure render functions with small fabricated rows (no
// real archive), so they classify as `unit`: fixture in, assert the transform.
// They pin the issue #469 behaviour — a per-type blurb under each group heading,
// and every vintage rendered at one consistent granularity.
// The published statistical-observations affordance (issue #467's residual):
// data-status.ts reuses dataset-anomaly-flags.ts's own computation and
// rendering, so these tests guard the ONE thing that module cannot itself
// verify — that promoting the detector's output to a reader-facing page never
// drops the observation-not-verdict framing, and that it links out to the
// plain-English method note rather than asking a reader to trust a bare
// number.
describe('data-status: statistical observations (issue #467)', { tags: ['data-validity'] }, () => {
  it('RenderAnomalyObservations_RealArchive_SurfacesTheCalibratedRecordCountFlag', () => {
    // The 2025-11-11 -> 2026-01-14 pair is this detector's own calibration
    // case (dataset-anomaly-flags.ts): a documented net change that fires the
    // record-count signal at modified z ≈ -6.3, independent of whether DuckDB
    // is installed (the record-count metric reads stats.json alone).
    const flags = computeDatasetAnomalyFlags();
    const flag = flags.find(f => f.key === '2026-01-14');
    expect(flag).toBeDefined();
    expect(flag?.deviations.some(d => d.metric === 'record count')).toBe(true);

    const html = renderAnomalyObservations(buildOpenDataRows(), flags, anomalyMetricsChecked());
    expect(html).toContain('2026-01-14');
    expect(html).toContain('146,417');
    expect(html).toContain('modified z = -6.3');
    // The exact non-adjudicating framing the issue requires, verbatim.
    expect(html).toContain('This is an observation, not a judgement — the cause is not adjudicated here');
  });

  it('RenderAnomalyObservations_RealArchive_LinksTheFlaggedEntryToItsPageAndTheMethodNote', () => {
    const rows = buildOpenDataRows();
    const flags = computeDatasetAnomalyFlags();
    const html = renderAnomalyObservations(rows, flags, anomalyMetricsChecked());
    const entry = rows.find(r => r.key === '2026-01-14');
    expect(entry).toBeDefined();
    expect(html).toContain(`href="${entry?.entryHref}"`);
    expect(html).toContain('href="fidelity.html#anomalies"');
  });

  it('RenderAnomalyObservations_EveryFlaggedDataset_NeverAssertsAVerdictErrorOrLoweredTrust', () => {
    // Non-adjudication guard, mirroring dataset-anomaly-flags.test.ts's own
    // render-level guard: the published surface must carry the SAME
    // discipline, since this is the one place a reader (not a developer) sees
    // the wording.
    const html = renderAnomalyObservations(buildOpenDataRows(), computeDatasetAnomalyFlags(), anomalyMetricsChecked()).toLowerCase();
    expect(html).not.toMatch(/\bwrong\b|\berror\b|\bincorrect\b|\bfault\b|\btrustworthy\b|\buntrustworthy\b|\bverified\b|\bsafe to use\b/);
  });

  it('RenderAnomalyObservations_NoDatasetDeviates_StatesConformanceIsNotACertificateRatherThanSayingNothing', () => {
    // A fabricated all-conforming set (no real archive dependency): the
    // asymmetry principle from issue #467 must hold even in the empty case —
    // "nothing flagged" is never presented as "everything verified good".
    const conforming: DatasetAnomalyFlag = {
      key: '2026-06-23',
      window: { key: '2026-06-23', before: ['2025-11-11'], after: [], excludedPartial: [] },
      deviations: [],
      insufficientNeighbours: false,
    };
    const html = renderAnomalyObservations([], [conforming], anomalyMetricsChecked());
    expect(html).toContain('not a certificate');
    expect(html).not.toContain('anomaly-list');
  });

  // The intro copy must state exactly which metrics THIS build checked, never
  // more: a review finding on the original PR (issue #467's residual) was that
  // the published copy claimed the per-status-mix check unconditionally, even
  // though it degrades to "not checked" when the DuckDB-backed fold is
  // unavailable. These two fixtures pin both branches so the claim can never
  // silently drift back to an unconditional one.
  describe('RenderAnomalyObservations_MetricsCheckedCopy_MatchesWhatThisBuildActuallyRan', () => {
    const fullyChecked: AnomalyMetricsChecked = { recordCount: true, statusShare: true, productEmptyShare: true };
    const degraded: AnomalyMetricsChecked = { recordCount: true, statusShare: false, productEmptyShare: true };

    it('AllThreeMetricsAvailable_StatesAllThreeWereChecked', () => {
      const html = renderAnomalyObservations([], [], fullyChecked);
      expect(html).toContain('record count, per-status mix, and product-column emptiness');
    });

    it('StatusShareUnavailable_StatesOnlyTheTwoChecksThatRanAndNamesTheGap', () => {
      const html = renderAnomalyObservations([], [], degraded);
      expect(html).toContain('record count and product-column emptiness');
      // Must NOT claim the per-status check ran, in any phrasing.
      expect(html).not.toContain('record count, per-status mix, and product-column emptiness');
      expect(html).not.toMatch(/per-status mix.*(was checked|were checked|is compared|are compared)/);
      // The gap is named honestly - a build-coverage fact, not a data finding.
      expect(html).toContain('was not run here');
      expect(html).toContain('not a finding about the data');
    });
  });
});

describe('data-status: per-type blurbs & de-jarred vintages (issue #469)', { tags: ['unit'] }, () => {
  function stagesAllDone(): Record<StageKey, StageCell> {
    const cell: StageCell = { state: 'done', detail: 'test cell' };
    return { read: cell, understood: cell, validated: cell, normalised: cell, enriched: cell };
  }

  function makeRow(over: { key: string; vintage: string | null; primaryClass: string } & Partial<DatasetRow>): DatasetRow {
    return {
      key: over.key,
      lane: over.lane ?? 'open-data',
      title: over.title ?? 'Test dataset',
      datasetClasses: over.datasetClasses ?? [over.primaryClass],
      primaryClass: over.primaryClass,
      recordOnly: over.recordOnly ?? false,
      vintage: over.vintage,
      authority: over.authority ?? { label: 'Official', detail: 'test authority' },
      entryHref: over.entryHref ?? 'datasets/open-data/test/index.html',
      metaHref: over.metaHref ?? 'https://example.test/meta.json',
      stages: over.stages ?? stagesAllDone(),
    };
  }

  it('Grid_EachDatasetClassGroup_ShowsAPlainEnglishBlurbUnderItsHeading', () => {
    const rows = [
      makeRow({ key: 'reg-2016-09', vintage: '2016-09', primaryClass: 'register-snapshot' }),
      makeRow({ key: 'avail-2016-01', vintage: '2016-01', primaryClass: 'available-pool' }),
    ];
    const html = renderInventoryGrid(rows);
    // The blurb is its own row, attached under the group heading.
    expect(html).toContain('<tr class="groupblurb">');
    // The register-snapshot blurb explains the open-data vs FOI provenance split
    // and resolves the WDTK nuance the issue asks about.
    expect(html).toContain('hosted on that open-data page');
    expect(html).toContain('WhatDoTheyKnow (WDTK)');
    // The available-pool blurb states the series is closed, not merely stale.
    expect(html).toContain('no longer produced');
  });

  it('ForbiddenListBlurb_WithholdingRationale_NamesAndLinksTheSameFoiCitationAsTheForbiddenSection', () => {
    // Issue #769: the "offensive or otherwise reserved" withholding rationale
    // otherwise reads as a bare assertion here, even though the very same
    // claim is already cited and linked in the forbidden-suffix section
    // (build-forbidden-section.ts, per #750). This propagates the identical
    // label and target — the target itself is proven to resolve to an emitted
    // page by build-dataset-pages.test.ts's own citation guard — rather than
    // re-hardcoding a second copy that could drift from it.
    const blurb = CLASS_BLURBS['forbidden-list'];
    expect(blurb).toContain(RATIONALE_SOURCE_LABEL);
    expect(blurb).toContain('href="datasets/foi/wdtk-356636--all-callsigns-plus-forbidden/raw-extract-all-call-sign-list-nan-smith.md.html"');
  });

  it('Grid_GroupHeading_LinksTheDatasetClassTermToTheGlossary', () => {
    const rows = [makeRow({ key: 'reg-2016-09', vintage: '2016-09', primaryClass: 'register-snapshot' })];
    const html = renderInventoryGrid(rows);
    expect(html).toContain('glossary.html#dataset-class');
  });

  it('Grid_MixedPrecisionVintages_AllRenderAtConsistentMonthPrecision', () => {
    const rows = [
      makeRow({ key: 'reg-2016-09', vintage: '2016-09', primaryClass: 'register-snapshot' }),
      makeRow({ key: 'reg-2016-09-20', vintage: '2016-09-20', primaryClass: 'register-snapshot' }),
    ];
    const html = renderInventoryGrid(rows);
    // Both the month-only key and the full ISO date display as one format.
    expect(html).toContain('September 2016');
    // Neither the raw month key nor the day-precise humanisation appears as the
    // visible cell label (the day survives only in the cell's exact-date title).
    expect(html).not.toMatch(/>2016-09</);
    expect(html).not.toMatch(/>20 September 2016</);
    // The shared date/time wrapper (#553) carries the exact reported date as the
    // lossless ISO value in the title - transparency, machine-precise.
    expect(html).toContain('title="Exact reported date: 2016-09-20"');
  });

  it('SeriesTimeline_MixedPrecisionVintages_ReadAsOneConsistentFormat', () => {
    const rows = [
      makeRow({ key: 'reg-2016-09', vintage: '2016-09', primaryClass: 'register-snapshot' }),
      makeRow({ key: 'reg-2017-04-24', vintage: '2017-04-24', primaryClass: 'register-snapshot' }),
    ];
    const series = buildSeries(rows, []);
    const html = renderSeriesGaps(series);
    // Timeline pills are normalised to month precision, so a full ISO vintage no
    // longer sits jarringly beside a month-only one.
    expect(html).toContain('>September 2016<');
    expect(html).toContain('>April 2017<');
    expect(html).not.toMatch(/>24 April 2017</);
  });
});

describe('data-status: page injection', { tags: ['data-validity'] }, () => {
  it('InjectDataStatus_RealArchive_ReplacesEveryPlaceholderAndStaysScriptFree', () => {
    const scratch = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'data-status-')), 'data-status.html');
    fs.copyFileSync(path.join('site', 'data-status.html'), scratch);
    injectDataStatus(scratch);
    const html = fs.readFileSync(scratch, 'utf8');
    for (const id of ['ds-summary', 'ds-grid', 'ds-rollup', 'ds-known-absent', 'ds-series', 'ds-anomalies']) {
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
