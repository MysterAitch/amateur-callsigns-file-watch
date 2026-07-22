import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  foldStratification,
  computeReprocessingStratification,
  renderReprocessingStratification,
  classifyEnrichment,
  seriesEnrichmentFor,
  windowOverlapsEpisode,
  assertMonthAnchorSound,
  UNCLASSIFIED_SERIES,
  type StratParams,
  type VintageExtent,
} from './reprocessing-stratification.ts';
import type { Episode } from './event-time-coherency.ts';
import { duckDbAvailable } from '../v2/report-fold.ts';

// Test names follow Subject_Scenario_Outcome. The fold cases stage a SYNTHETIC
// claim ledger (a handful of record-last-modified + prefix_series claims) so the
// window convention, the vintage floor and the enrichment measure are exercised
// on data whose every expected count is obvious by hand — the corpus golden
// (reprocessing-stratification-corpus.test.ts) pins the real figures.

// A ledger row in the LEDGER_COLUMNS shape the fold reads.
interface Row { rawSubject: string; predicate: string; object: string; vintage: string; rule: string; }

function touch(subject: string, day: string, vintage: string): Row {
  return { rawSubject: subject, predicate: 'event-date/record-last-modified', object: day, vintage, rule: 'event-date-extraction' };
}

function series(subject: string, prefixSeries: string, vintage: string): Row {
  return { rawSubject: subject, predicate: 'prefix_series', object: prefixSeries, vintage, rule: 'parse-callsign' };
}

// A subject present in a vintage: a series claim plus (optionally) a touch date.
function subjectRows(subject: string, prefixSeries: string, vintage: string, day?: string): Row[] {
  const rows = [series(subject, prefixSeries, vintage)];
  if (day !== undefined) rows.push(touch(subject, day, vintage));
  return rows;
}

let tmp: string;

function ledgerFrom(rows: readonly Row[]): string {
  const dir = path.join(tmp, `led-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  const lines = rows.map((r, i) =>
    JSON.stringify({ layer: 'derived', rawSubject: r.rawSubject, predicate: r.predicate, object: r.object, sourceFile: `opendata/${r.vintage}/raw.csv`, ordinal: i, vintage: r.vintage, rule: r.rule }),
  );
  fs.writeFileSync(path.join(dir, 'claims.jsonl'), lines.join('\n') + '\n');
  return dir;
}

// N filler subjects carrying a touch, so a vintage clears the subject floor.
function filler(prefix: string, prefixSeries: string, vintage: string, day: string, n: number): Row[] {
  return Array.from({ length: n }, (_, i) => subjectRows(`${prefix}${i}`, prefixSeries, vintage, day)).flat();
}

const SMALL: StratParams = { minVintageSubjects: 3, minSeriesBase: 3, minCohortSubjects: 2, enrichedRatio: 1.5 };

beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reproc-strat-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

// --- Pure classification and overlap (no DuckDB) ----------------------------

describe('reprocessing stratification — enrichment classification', { tags: ['unit'] }, () => {
  it('Enrichment_WhenCohortShareFarExceedsBaseShare_ClassifiedEnriched', () => {
    // series holds 10% of the base but 30% of the cohort → 3× → enriched.
    const e = classifyEnrichment('M7', 1_000, 300, 10_000, 1_000, SMALL);
    expect(e.ratio).toBeCloseTo(3, 5);
    expect(e.enrichment).toBe('enriched');
  });

  it('Enrichment_WhenCohortShareFarBelowBaseShare_ClassifiedDepleted', () => {
    // 10% of base, 2% of cohort → 0.2× → depleted.
    const e = classifyEnrichment('M7', 1_000, 20, 10_000, 1_000, SMALL);
    expect(e.enrichment).toBe('depleted');
  });

  it('Enrichment_WhenCohortShareTracksBaseShare_ClassifiedProportionate', () => {
    const e = classifyEnrichment('M6', 1_000, 100, 10_000, 1_000, SMALL);
    expect(e.ratio).toBeCloseTo(1, 5);
    expect(e.enrichment).toBe('proportionate');
  });

  it('Enrichment_WhenSeriesBelowBaseFloor_SuppressedAsSmallNDespiteExtremeRatio', () => {
    // A two-subject series that is 100% cohort would read as wildly enriched on
    // the ratio alone; the small-n guard refuses the verdict.
    const e = classifyEnrichment('G5', 2, 2, 10_000, 1_000, { ...SMALL, minSeriesBase: 500, minCohortSubjects: 50 });
    expect(e.enrichment).toBe('small-n');
  });

  it('Enrichment_WhenSeriesUnclassified_NeverGivenAVerdict', () => {
    // The visitor/special/unparseable bucket is an absence of a series, never
    // enriched or depleted however its counts fall.
    const e = classifyEnrichment(UNCLASSIFIED_SERIES, 5_000, 4_000, 10_000, 5_000, SMALL);
    expect(e.enrichment).toBe('small-n');
  });

  it('MassEpisodeOverlap_WhenWindowIntersectsDetectedEpisode_FlaggedTrue', () => {
    const episodes: Episode[] = [{ start: '2024-08-01', end: '2024-08-20', signals: [] }];
    // window (2024-07-22, 2024-10-21] straddles the episode span.
    expect(windowOverlapsEpisode('2024-07-22', '2024-10-21', episodes)).toBe(true);
  });

  it('MassEpisodeOverlap_WhenWindowDisjointFromEveryEpisode_FlaggedFalse', () => {
    const episodes: Episode[] = [{ start: '2016-07-23', end: '2016-08-12', signals: [] }];
    expect(windowOverlapsEpisode('2024-07-22', '2024-10-21', episodes)).toBe(false);
  });

  it('MassEpisodeOverlap_WhenEpisodeEndsExactlyOnTheExcludedPredecessorDate_FlaggedFalse', () => {
    // The window's lower edge is OPEN (predDate excluded), so an episode ending
    // exactly on predDate does not intersect the touch interval.
    const episodes: Episode[] = [{ start: '2024-07-01', end: '2024-07-22', signals: [] }];
    expect(windowOverlapsEpisode('2024-07-22', '2024-10-21', episodes)).toBe(false);
  });

  it('MassEpisodeOverlap_WhenEpisodeStartsExactlyOnTheIncludedSnapshotDate_FlaggedTrue', () => {
    // The upper edge is CLOSED (snapshot date included), so an episode starting
    // on it does intersect.
    const episodes: Episode[] = [{ start: '2024-10-21', end: '2024-11-01', signals: [] }];
    expect(windowOverlapsEpisode('2024-07-22', '2024-10-21', episodes)).toBe(true);
  });

  it('MonthAnchor_WhenMonthOnlyVintageCarriesTouchLaterThanItsFirstOfMonth_FailsLoud', () => {
    // A 2024-07 export anchored to 2024-07-01 but holding a 2024-07-15 touch
    // would silently push that record out of its own window — the guard refuses.
    const extents: VintageExtent[] = [{ vintage: '2024-07', vintageDate: '2024-07-01', maxModified: '2024-07-15' }];
    expect(() => assertMonthAnchorSound(extents)).toThrow(/month-only vintage/);
  });

  it('MonthAnchor_WhenEveryTouchIsWithinTheAnchorMonth_Passes', () => {
    // Dated vintages are exempt (they anchor to themselves); a month-only
    // vintage whose latest touch precedes its first-of-month anchor is sound.
    const extents: VintageExtent[] = [
      { vintage: '2024-07', vintageDate: '2024-07-01', maxModified: '2024-06-14' },
      { vintage: '2024-10-21', vintageDate: '2024-10-21', maxModified: '2024-10-21' },
    ];
    expect(() => assertMonthAnchorSound(extents)).not.toThrow();
  });
});

// --- The fold over synthetic ledgers (DuckDB) -------------------------------

describe.skipIf(!duckDbAvailable())('reprocessing stratification — fold over a synthetic ledger', { tags: ['unit'] }, () => {
  it('Fold_WhenClaimsSourceEmpty_ReturnsNoRowsRatherThanReachingDuckDb', () => {
    const empty = fs.mkdtempSync(path.join(tmp, 'empty-'));
    expect(foldStratification(empty, SMALL)).toEqual([]);
  });

  it('TouchWindow_WhenRecordModifiedOnPredecessorDate_ExcludedAsPredecessorExclusive', () => {
    const rows: Row[] = [
      ...filler('p', 'M7', '2024-01-01', '2024-01-01', 3), // predecessor snapshot
      // the snapshot under test: four M7 subjects, one per window position.
      ...subjectRows('ON_PRED', 'M7', '2024-02-01', '2024-01-01'), // == predDate → excluded
      ...subjectRows('INSIDE', 'M7', '2024-02-01', '2024-01-15'), // inside → included
      ...subjectRows('ON_SNAP', 'M7', '2024-02-01', '2024-02-01'), // == snapshot date → included
      ...subjectRows('BEFORE', 'M7', '2024-02-01', '2023-12-01'), // before window → excluded
    ];
    const strat = computeReprocessingStratification(ledgerFrom(rows), SMALL);
    const v2 = strat.windows.find(w => w.vintage === '2024-02-01');
    expect(v2?.predVintage).toBe('2024-01-01');
    // Only INSIDE and ON_SNAP fall in (2024-01-01, 2024-02-01].
    expect(v2?.cohortSubjects).toBe(2);
    const m7 = strat.rows.find(r => r.vintage === '2024-02-01' && r.series === 'M7');
    expect(m7?.baseSubjects).toBe(4);
    expect(m7?.cohortSubjects).toBe(2);
  });

  it('Stratification_WhenTouchesFallProportionallyAcrossSeries_ShowsNoEnrichment', () => {
    // Two series, equal base, equal cohort share → every ratio is 1, so the
    // window is genuinely uniform: nothing enriched, nothing depleted.
    const inside = '2024-01-15';
    const outside = '2023-11-01';
    const rows: Row[] = [
      ...filler('p', 'M7', '2024-01-01', '2024-01-01', 3),
      // M7: 4 base, 2 in-window. G0: 4 base, 2 in-window. Same shares.
      ...subjectRows('m7a', 'M7', '2024-02-01', inside), ...subjectRows('m7b', 'M7', '2024-02-01', inside),
      ...subjectRows('m7c', 'M7', '2024-02-01', outside), ...subjectRows('m7d', 'M7', '2024-02-01', outside),
      ...subjectRows('g0a', 'G0', '2024-02-01', inside), ...subjectRows('g0b', 'G0', '2024-02-01', inside),
      ...subjectRows('g0c', 'G0', '2024-02-01', outside), ...subjectRows('g0d', 'G0', '2024-02-01', outside),
    ];
    const strat = computeReprocessingStratification(ledgerFrom(rows), SMALL);
    const enrichments = seriesEnrichmentFor(strat, '2024-02-01');
    const verdicts = enrichments.filter(e => e.series === 'M7' || e.series === 'G0');
    expect(verdicts.every(e => e.enrichment === 'proportionate')).toBe(true);
  });

  it('Stratification_WhenSnapshotRepeatsPredecessorDates_YieldsAnEmptyCohort', () => {
    // Every record's last-modified sits on or before the predecessor's date:
    // nothing was touched in the window (a republication), so the cohort is
    // empty and the report says so rather than inventing a stratification.
    const rows: Row[] = [
      ...filler('p', 'M7', '2024-01-01', '2024-01-01', 3),
      ...filler('q', 'M7', '2024-02-01', '2024-01-01', 3), // all == predDate → excluded
    ];
    const strat = computeReprocessingStratification(ledgerFrom(rows), SMALL);
    const v2 = strat.windows.find(w => w.vintage === '2024-02-01');
    expect(v2?.cohortSubjects).toBe(0);
    expect(renderReprocessingStratification(strat)).toContain('2024-02-01 — no cohort');
  });

  it('VintageSequence_WhenSnapshotBelowSubjectFloor_ExcludedAndNotUsedAsPredecessor', () => {
    // A trial publication below the subject floor is neither analysed nor
    // allowed to become a real snapshot's predecessor boundary.
    const rows: Row[] = [
      ...filler('a', 'M7', '2024-01-01', '2024-01-01', 3), // substantial
      ...filler('t', 'M7', '2024-01-15', '2024-01-10', 2), // trial: 2 < floor 3
      ...filler('b', 'M7', '2024-02-01', '2024-01-20', 3), // substantial
    ];
    const strat = computeReprocessingStratification(ledgerFrom(rows), SMALL);
    expect(strat.windows.some(w => w.vintage === '2024-01-15')).toBe(false);
    const v2 = strat.windows.find(w => w.vintage === '2024-02-01');
    // Predecessor skips the trial back to the substantial 2024-01-01 snapshot.
    expect(v2?.predVintage).toBe('2024-01-01');
  });

  it('MonthOnlyVintage_AnchoredToFirstOfMonth_DefinesTheWindowEdge', () => {
    // A month-only vintage ('2024-07') anchors to its first day, so as a
    // predecessor its date is 2024-07-01.
    const rows: Row[] = [
      ...filler('a', 'M7', '2024-07', '2024-06-01', 3),
      ...subjectRows('after', 'M7', '2024-08-01', '2024-07-15'),
      ...subjectRows('onedge', 'M7', '2024-08-01', '2024-07-01'), // == anchored predDate → excluded
      ...filler('b', 'M7', '2024-08-01', '2024-07-20', 2),
    ];
    const strat = computeReprocessingStratification(ledgerFrom(rows), SMALL);
    const v2 = strat.windows.find(w => w.vintage === '2024-08-01');
    expect(v2?.predDate).toBe('2024-07-01');
    // 'onedge' on the anchored predecessor date is excluded; the three later
    // touches are in-window.
    expect(v2?.cohortSubjects).toBe(3);
  });

  it('MassEpisodeOverlap_WhenACohortWindowContainsADetectedEpisode_FlaggedTrue', () => {
    // A non-vacuous overlap: a snapshot whose record-last-modified dates cluster
    // hard enough to trip the S2 mass-episode detector, inside a touch window —
    // the corpus's real cohorts never do this (they are the spread-out mass
    // touches S2 misses), so the overlap machinery is exercised here instead.
    const spike = '2024-08-03'; // > 50% of the snapshot's dates land on one day
    const rows: Row[] = [
      ...filler('p', 'M7', '2024-07-01', '2024-06-15', 5), // predecessor boundary
      // 1,200 touched subjects, 700 spiked on one day (clears minPopulated=1000
      // and the >50% share the detector needs); all inside (2024-07-01, 2024-09-01].
      ...Array.from({ length: 700 }, (_, i) => subjectRows(`s${i}`, 'M7', '2024-09-01', spike)).flat(),
      ...Array.from({ length: 500 }, (_, i) => subjectRows(`t${i}`, 'M7', '2024-09-01', '2024-08-28')).flat(),
    ];
    const strat = computeReprocessingStratification(ledgerFrom(rows), SMALL);
    expect(strat.episodes.length).toBeGreaterThan(0);
    const v2 = strat.windows.find(w => w.vintage === '2024-09-01');
    expect(v2?.overlapsEpisode).toBe(true);
  });

  it('MonthAnchor_WhenAMonthOnlyVintageAssertsATouchAfterItsAnchor_FoldFailsLoud', () => {
    // The invariant bites end-to-end through the fold, not only as a pure check:
    // a 2024-07 snapshot carrying a mid-July touch aborts rather than miscounts.
    const rows: Row[] = [
      ...filler('a', 'M7', '2024-01-01', '2023-12-15', 3),
      ...filler('b', 'M7', '2024-07', '2024-07-20', 3), // 2024-07 anchors to 07-01 < 07-20
    ];
    expect(() => computeReprocessingStratification(ledgerFrom(rows), SMALL)).toThrow(/month-only vintage "2024-07"/);
  });

  it('Report_RunTwiceOverTheSameClaims_IsByteDeterministic', () => {
    const rows: Row[] = [
      ...filler('p', 'M7', '2024-01-01', '2024-01-01', 3),
      ...filler('m', 'M7', '2024-02-01', '2024-01-15', 3),
      ...filler('g', 'G0', '2024-02-01', '2024-01-20', 3),
    ];
    const dir = ledgerFrom(rows);
    const first = renderReprocessingStratification(computeReprocessingStratification(dir, SMALL));
    const second = renderReprocessingStratification(computeReprocessingStratification(dir, SMALL));
    expect(second).toBe(first);
  });
});
