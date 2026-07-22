/**
 * Reprocessing-touch series stratification (issue #871).
 *
 * Ofcom periodically bulk-reprocesses the register, and each reprocessing run
 * leaves a fingerprint: a cohort of records whose `record-last-modified`
 * bookkeeping date lands in the window between two consecutive register
 * snapshots. The #867 co-occurrence spike surfaced — and a second, independent
 * derivation confirmed — that these touch cohorts are NOT a uniform sample of
 * the register: they are stratified by callsign series. The 2024-07 cohort is
 * enriched in the newer Foundation-era series (M7/M6/M0); the 2024-10 cohort
 * largely EXCLUDES M7 (~2% of the cohort against ~7% of the same export's
 * records) while the older G-series are enriched — and M7 records were present
 * and touchable in that export, so this is a stratified touch, not a coverage
 * gap.
 *
 * This module turns that one-off observation into standing, re-runnable
 * machinery: for EVERY inter-snapshot window across the corpus (not only the two
 * named), it folds the touch cohort's per-series composition and compares it
 * against the asserting snapshot's own series composition, so a future
 * reprocessing wave shifting the picture shows up as a committed-report diff.
 *
 * Posture (issue #467, binding): this FLAGS, it never adjudicates. Candidate
 * explanations for a stratified touch — a run scoped to a licence class or
 * renewal cohort, a phased migration touching record eras in turn, a
 * data-quality campaign confined to particular series — are offered beside the
 * numbers and NONE is chosen. Nothing in the held correspondence names these
 * runs; that absence is stated, not filled with a guess.
 *
 * FOLD, not re-parse (issue #361): everything here is DuckDB SQL over the claim
 * ledger (the shared deploy-time claims.parquet where present, else the
 * per-source JSONL). The touch signal is the S1 `record-last-modified` event
 * claim (src/v2/event-time-emit.ts); the series key is the canonical
 * `prefix_series` parse claim the same ledger already carries — so the grouping
 * is exactly parseCallsign's, never a bespoke SQL re-derivation of it. Committed
 * as reports/reprocessing-stratification.md, byte-deterministic (every query
 * carries a total ORDER BY; the report is dated at the corpus assertion ceiling,
 * never at build time), so a new snapshot is a PR diff.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  foldQuery,
  claimsRelation,
  claimsSourcePresent,
  toClaimsSource,
  cleanedKeyExpr,
  type ClaimsSource,
} from '../v2/report-fold.ts';
import {
  EVENT_DATE_RULE,
  EVENT_DATE_PREDICATE_PREFIX,
  PARSE_CALLSIGN_RULE,
  PREFIX_SERIES_PREDICATE,
} from '../v2/claim.ts';
import {
  acquireClaimsSource,
  foldDaySignals,
  detectEpisodeSignals,
  mergeEpisodes,
  DEFAULT_EPISODE_PARAMS,
  type Episode,
} from './event-time-coherency.ts';
import { time, perfReport } from '../shared/perf.ts';

// The bookkeeping event kind whose forward movement marks a record as touched.
// `record-last-modified` is the register export's own "this row was last
// changed" date — the column a reprocessing run stamps — and carries the same
// mass-update caveats the coherency fold documents. A single kind by design: the
// stratification question is about record touches, and mixing in the
// licence-scoped or original-start kinds would conflate distinct facts.
export const TOUCH_KIND = 'record-last-modified';

export const TOUCH_PREDICATE = `${EVENT_DATE_PREDICATE_PREFIX}${TOUCH_KIND}`;

// The bucket a subject with no series (a visitor, special-event or unparseable
// callsign — `prefix_series` empty) lands in. Kept in the totals so shares are
// honest fractions of the whole export, but never itself classified enriched or
// depleted (it is an absence of a series, not a series).
export const UNCLASSIFIED_SERIES = '(unclassified)';

export interface StratParams {
  // A vintage must assert `record-last-modified` for at least this many distinct
  // cleaned subjects to serve as a cohort-bearing snapshot or a predecessor
  // boundary. A partial or trial publication (the 1,074-row 2025 open-data
  // trials) is not a register snapshot against which "touched since" is
  // meaningful; this floor drops them. The full fold stays re-derivable
  // regardless — this bounds only which vintages are ANALYSED.
  minVintageSubjects: number;
  // A series needs at least this many base subjects in a vintage before its
  // enrichment ratio earns an enriched/depleted verdict: a ratio over a handful
  // of subjects is noise dressed as signal.
  minSeriesBase: number;
  // …and at least this many cohort subjects, for the same reason from the
  // cohort side (a series can be well-populated in the export yet contribute a
  // handful to a small window).
  minCohortSubjects: number;
  // The cohort-share / base-share ratio at (or beyond) which a reportable series
  // is called enriched; its reciprocal is the depletion threshold. 1.5 keeps the
  // verdict off the proportionate middle where a few per cent of sampling noise
  // would otherwise flip it.
  enrichedRatio: number;
}

export const DEFAULT_STRAT_PARAMS: StratParams = {
  minVintageSubjects: 10_000,
  minSeriesBase: 500,
  minCohortSubjects: 50,
  enrichedRatio: 1.5,
};

// One (vintage, series) cell: how many of the asserting vintage's
// record-last-modified subjects the series holds (base), and how many of those
// fall in the vintage's inter-snapshot touch window (cohort).
export interface StratRow {
  vintage: string;
  // The vintage's ISO anchor date: the vintage string as-is for a dated
  // snapshot, or its first day for a month-only vintage ('2024-07' → '2024-07-01').
  vintageDate: string;
  // The immediately-preceding substantial vintage (the window's lower edge), and
  // its anchor date. Never null in a returned row — the fold restricts to
  // vintages that HAVE a predecessor (the earliest snapshot has no window).
  predVintage: string;
  predDate: string;
  series: string;
  baseSubjects: number;
  cohortSubjects: number;
}

// A per-vintage inter-snapshot window: its edges, its cohort/base totals, and
// whether the window coincides with a mass-update episode the S2 detector flags.
export interface VintageWindow {
  vintage: string;
  vintageDate: string;
  predVintage: string;
  predDate: string;
  baseSubjects: number;
  cohortSubjects: number;
  overlapsEpisode: boolean;
}

// A series' enrichment within one vintage's touch cohort — every figure the
// verdict rests on, so a bare ratio never stands alone.
export type Enrichment = 'enriched' | 'depleted' | 'proportionate' | 'small-n';

export interface SeriesEnrichment {
  series: string;
  baseSubjects: number;
  cohortSubjects: number;
  baseShare: number;
  cohortShare: number;
  // cohortShare / baseShare. null only when baseShare is zero (a series present
  // in the cohort but not the base — impossible, since cohort ⊆ base — kept
  // total for safety).
  ratio: number | null;
  enrichment: Enrichment;
}

export interface ReprocessingStratification {
  params: StratParams;
  touchKind: string;
  // The latest vintage date analysed — the report's date line (canonical at
  // rest: the corpus's assertion ceiling, never the build clock).
  assertionCeiling: string;
  windows: VintageWindow[];
  rows: StratRow[];
  episodes: Episode[];
}

function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

// The single fold: one row per (analysed vintage, series). The touch signal is
// the S1 record-last-modified claim; the series is the canonical prefix_series
// parse claim (empty → UNCLASSIFIED_SERIES). A vintage's anchor date is its
// string as-is, or first-of-month for a month-only vintage; its predecessor is
// the previous substantial vintage in anchor-date order, and the touch window is
// the half-open interval (predDate, vintageDate] on the record-last-modified
// VALUE (predecessor-exclusive, snapshot-inclusive — the pinned convention). A
// subject asserting several record-last-modified rows in a vintage takes its
// latest, matching the coherency fold's bookkeeping statistic.
export function foldStratification(source: string | ClaimsSource, params: StratParams = DEFAULT_STRAT_PARAMS): StratRow[] {
  const claims = toClaimsSource(source);
  if (!claimsSourcePresent(claims)) return [];
  const relation = claimsRelation(claims);
  const key = cleanedKeyExpr('rawSubject');
  return foldQuery<StratRow>(`WITH events AS (
  SELECT ${key} AS subject, vintage, object AS "day"
  FROM ${relation}
  WHERE rule = '${EVENT_DATE_RULE}' AND predicate = ${sqlLiteral(TOUCH_PREDICATE)} AND ${key} <> ''
),
series AS (
  SELECT ${key} AS subject, vintage, max(object) AS series
  FROM ${relation}
  WHERE rule = '${PARSE_CALLSIGN_RULE}' AND predicate = ${sqlLiteral(PREFIX_SERIES_PREDICATE)} AND ${key} <> ''
  GROUP BY 1, 2
),
per AS (
  SELECT vintage, subject, max("day") AS mx FROM events GROUP BY 1, 2
),
vcount AS (
  SELECT vintage, count(*) AS n FROM per GROUP BY 1
),
anchored AS (
  SELECT vintage, CASE WHEN length(vintage) = 7 THEN vintage || '-01' ELSE vintage END AS vd
  FROM vcount WHERE n >= ${Math.trunc(params.minVintageSubjects)}
),
win AS (
  SELECT vintage, vd,
         lag(vd) OVER (ORDER BY vd, vintage) AS predDate,
         lag(vintage) OVER (ORDER BY vd, vintage) AS predVintage
  FROM anchored
),
joined AS (
  SELECT p.vintage, w.vd AS vintageDate, w.predVintage, w.predDate,
         coalesce(nullif(s.series, ''), '${UNCLASSIFIED_SERIES}') AS series,
         (p.mx > w.predDate AND p.mx <= w.vd) AS inCohort
  FROM per p
  JOIN win w USING (vintage)
  LEFT JOIN series s ON s.vintage = p.vintage AND s.subject = p.subject
  WHERE w.predDate IS NOT NULL
)
SELECT vintage, vintageDate, predVintage, predDate, series,
       count(*)::BIGINT AS baseSubjects,
       count(*) FILTER (WHERE inCohort)::BIGINT AS cohortSubjects
FROM joined
GROUP BY vintage, vintageDate, predVintage, predDate, series
ORDER BY vintageDate, vintage, series`);
}

// A window's touch interval (predDate, vintageDate] intersects an episode's
// clustered span [start, end] — both live in record-date-value space.
export function windowOverlapsEpisode(predDate: string, vintageDate: string, episodes: readonly Episode[]): boolean {
  return episodes.some(e => predDate <= e.end && vintageDate >= e.start);
}

// Assemble the whole stratification picture: the per-series fold, the per-vintage
// windows (with mass-episode overlap flagged from the SAME S2 detector the
// coherency report runs), and the assertion ceiling.
export function computeReprocessingStratification(
  source: string | ClaimsSource,
  params: StratParams = DEFAULT_STRAT_PARAMS,
): ReprocessingStratification {
  const claims = toClaimsSource(source);
  const rows = time('stratification:fold', () => foldStratification(claims, params));
  const days = time('stratification:day-signals', () => foldDaySignals(claims));
  const episodes = mergeEpisodes(detectEpisodeSignals(days, DEFAULT_EPISODE_PARAMS), DEFAULT_EPISODE_PARAMS);

  const byVintage = new Map<string, VintageWindow>();
  for (const row of rows) {
    let window = byVintage.get(row.vintage);
    if (window === undefined) {
      window = {
        vintage: row.vintage,
        vintageDate: row.vintageDate,
        predVintage: row.predVintage,
        predDate: row.predDate,
        baseSubjects: 0,
        cohortSubjects: 0,
        overlapsEpisode: windowOverlapsEpisode(row.predDate, row.vintageDate, episodes),
      };
      byVintage.set(row.vintage, window);
    }
    window.baseSubjects += row.baseSubjects;
    window.cohortSubjects += row.cohortSubjects;
  }
  const windows = [...byVintage.values()].sort((a, b) => a.vintageDate.localeCompare(b.vintageDate) || a.vintage.localeCompare(b.vintage));
  const assertionCeiling = windows.reduce((max, w) => (w.vintageDate > max ? w.vintageDate : max), '');

  return { params, touchKind: TOUCH_KIND, assertionCeiling, windows, rows, episodes };
}

// Classify one series' enrichment within a vintage's cohort. Small-n first: a
// series below either floor keeps its counts and ratio in the table but never
// earns an enriched/depleted verdict.
export function classifyEnrichment(
  series: string,
  baseSubjects: number,
  cohortSubjects: number,
  vintageBase: number,
  vintageCohort: number,
  params: StratParams = DEFAULT_STRAT_PARAMS,
): SeriesEnrichment {
  const baseShare = vintageBase === 0 ? 0 : baseSubjects / vintageBase;
  const cohortShare = vintageCohort === 0 ? 0 : cohortSubjects / vintageCohort;
  const ratio = baseShare === 0 ? null : cohortShare / baseShare;
  let enrichment: Enrichment;
  if (series === UNCLASSIFIED_SERIES || baseSubjects < params.minSeriesBase || cohortSubjects < params.minCohortSubjects || ratio === null) {
    enrichment = 'small-n';
  } else if (ratio >= params.enrichedRatio) {
    enrichment = 'enriched';
  } else if (ratio <= 1 / params.enrichedRatio) {
    enrichment = 'depleted';
  } else {
    enrichment = 'proportionate';
  }
  return { series, baseSubjects, cohortSubjects, baseShare, cohortShare, ratio, enrichment };
}

// Every series' enrichment for one vintage, richest base first then by name —
// the per-window table's rows, re-derivable for any vintage from the fold.
export function seriesEnrichmentFor(
  strat: ReprocessingStratification,
  vintage: string,
): SeriesEnrichment[] {
  const window = strat.windows.find(w => w.vintage === vintage);
  if (window === undefined) return [];
  const rows = strat.rows.filter(r => r.vintage === vintage);
  return rows
    .map(r => classifyEnrichment(r.series, r.baseSubjects, r.cohortSubjects, window.baseSubjects, window.cohortSubjects, strat.params))
    .sort((a, b) => b.baseSubjects - a.baseSubjects || a.series.localeCompare(b.series));
}

// The base/cohort totals and shares for a NAMED SET of series in one vintage —
// the durable way to state an aggregate finding (e.g. "the G-series" as a bloc)
// re-derivably rather than by hand.
export interface GroupShare {
  baseSubjects: number;
  cohortSubjects: number;
  baseShare: number;
  cohortShare: number;
}

export function seriesGroupShare(strat: ReprocessingStratification, vintage: string, seriesPredicate: (series: string) => boolean): GroupShare {
  const window = strat.windows.find(w => w.vintage === vintage);
  if (window === undefined) return { baseSubjects: 0, cohortSubjects: 0, baseShare: 0, cohortShare: 0 };
  let baseSubjects = 0;
  let cohortSubjects = 0;
  for (const row of strat.rows) {
    if (row.vintage !== vintage || !seriesPredicate(row.series)) continue;
    baseSubjects += row.baseSubjects;
    cohortSubjects += row.cohortSubjects;
  }
  return {
    baseSubjects,
    cohortSubjects,
    baseShare: window.baseSubjects === 0 ? 0 : baseSubjects / window.baseSubjects,
    cohortShare: window.cohortSubjects === 0 ? 0 : cohortSubjects / window.cohortSubjects,
  };
}

export function buildReprocessingStratification(ledgerDir?: string, params: StratParams = DEFAULT_STRAT_PARAMS): ReprocessingStratification {
  const { source, dispose } = acquireClaimsSource(ledgerDir);
  try {
    return computeReprocessingStratification(source, params);
  } finally {
    dispose();
  }
}

// --- Rendering --------------------------------------------------------------

function num(n: number): string {
  return n.toLocaleString('en-GB');
}

function pct(share: number): string {
  return `${(share * 100).toFixed(1)}%`;
}

function ratioText(ratio: number | null): string {
  return ratio === null ? '—' : `${ratio.toFixed(2)}×`;
}

function mdCode(value: string): string {
  return `\`${value}\``;
}

const ENRICHMENT_GLOSSES: ReadonlyMap<Enrichment, string> = new Map([
  ['enriched', 'the cohort holds a LARGER share of this series than the export does — the run touched it disproportionately'],
  ['depleted', 'the cohort holds a SMALLER share of this series than the export does — the run largely passed it over'],
  ['proportionate', 'the cohort’s share of this series is close to the export’s — touched roughly in line with its presence'],
  ['small-n', 'too few base or cohort subjects (or no series at all) for an enrichment verdict — the counts are shown, the ratio is not read as signal'],
]);

// A vintage's most enriched / most depleted reportable series (small-n and
// proportionate excluded), for the per-window headline.
function headline(enrichments: readonly SeriesEnrichment[]): { enriched: SeriesEnrichment[]; depleted: SeriesEnrichment[] } {
  const enriched = enrichments.filter(e => e.enrichment === 'enriched').sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0) || a.series.localeCompare(b.series));
  const depleted = enrichments.filter(e => e.enrichment === 'depleted').sort((a, b) => (a.ratio ?? 0) - (b.ratio ?? 0) || a.series.localeCompare(b.series));
  return { enriched, depleted };
}

function isGSeries(series: string): boolean {
  return /^G[0-9]/.test(series);
}

// One series' enrichment line for the reconciliation prose, or a fallback when
// the named vintage is not in the corpus (it always is — the FOI snapshots are
// immutable — but the fold never assumes a row exists).
function seriesLine(strat: ReprocessingStratification, vintage: string, series: string): string {
  const e = seriesEnrichmentFor(strat, vintage).find(x => x.series === series);
  if (e === undefined) return `${mdCode(series)} not present`;
  return `${mdCode(series)} ${pct(e.cohortShare)} of the cohort vs ${pct(e.baseShare)} of the export (${num(e.cohortSubjects)}/${num(e.baseSubjects)}, ${ratioText(e.ratio)})`;
}

// The two named cohorts (issue #871) reconciled against the two prior
// derivations, under THIS report's single pinned convention. The prior figures
// are cited verbatim; the deltas are explained, never smoothed over.
function renderReconciliation(strat: ReprocessingStratification): string[] {
  const has2407 = strat.windows.some(w => w.vintage === '2024-07');
  const has2410 = strat.windows.some(w => w.vintage === '2024-10-21');
  if (!has2407 && !has2410) return [];
  const lines: string[] = [
    '## Named cohorts and reconciliation with the #867 spike',
    '',
    'The stratification was first seen in the #867 co-occurrence spike and',
    'confirmed by a second, independent derivation before #871 was filed. The',
    'two derivations used slightly different window conventions; this report',
    'pins ONE (predecessor-exclusive, snapshot-inclusive) and reconciles both.',
    '',
  ];
  if (has2407) {
    lines.push(
      '### 2024-07 — enriched in the newer Foundation series',
      '',
      '_Spike derivation:_ `M7` 18.8% vs 9.4% base; `M6` 17.8% vs 10.1%; `M0` 14.8% vs 8.9%.',
      '',
      '_This report (window `2024-01-01 → 2024-07-01`):_',
      '',
      `- ${seriesLine(strat, '2024-07', 'M7')} — enriched.`,
      `- ${seriesLine(strat, '2024-07', 'M6')}.`,
      `- ${seriesLine(strat, '2024-07', 'M0')}.`,
      '',
      'The direction and the identity of the enriched series match the spike',
      'exactly. The base shares differ (this report’s `M7` base is ~6.6%, the',
      'spike’s 9.4%): the spike measured against a smaller, issued-only',
      'denominator, whereas the pinned base here is every record-last-modified-',
      'bearing subject in the asserting snapshot. The enrichment survives either',
      'denominator — the finding is the disproportion, not its exact multiple.',
      '',
    );
  }
  if (has2410) {
    const g = seriesGroupShare(strat, '2024-10-21', isGSeries);
    const m7 = seriesEnrichmentFor(strat, '2024-10-21').find(x => x.series === 'M7');
    lines.push(
      '### 2024-10-21 — the run that largely excludes M7',
      '',
      '_Verification derivation:_ `M7` ~1.3–2.0% of the cohort vs 6.9% base;',
      'older G-series enriched (52.7% vs 48.6%); `M7` present in the export',
      '(10,854 records) with prior observations available — not a coverage gap.',
      '',
      '_This report (window `2024-07-22 → 2024-10-21`):_',
      '',
      `- ${seriesLine(strat, '2024-10-21', 'M7')} — depleted.`,
      `- the G-series as a bloc: ${pct(g.cohortShare)} of the cohort vs ${pct(g.baseShare)} of the export (${num(g.cohortSubjects)}/${num(g.baseSubjects)}).`,
      `- \`M7\` base ${m7 === undefined ? '—' : num(m7.baseSubjects)} records — present and touchable, simply not touched.`,
      '',
      'The pinned window lands `M7` at the top of the verification derivation’s',
      '1.3–2.0% range (the narrower end corresponds to excluding the July tail of',
      'the window); the base share (6.9%), the G-series bloc (52.7% vs 48.6%) and',
      'the M7 record count (10,854) reproduce it. This is the one analysed window',
      'in which `M7` is DEPLETED rather than enriched — the observation that',
      'prompted #871.',
      '',
    );
  }
  return lines;
}

export function renderReprocessingStratification(strat: ReprocessingStratification): string {
  const p = strat.params;
  const lines: string[] = [
    '# Reprocessing-touch series stratification',
    '',
    'Ofcom periodically bulk-reprocesses the register. Each run leaves a',
    'fingerprint: a cohort of records whose `record-last-modified` date lands in',
    'the window between two consecutive register snapshots. This report folds,',
    'for every such inter-snapshot window, how that touch cohort is distributed',
    'across callsign series — and compares it against the asserting snapshot’s',
    'own series composition. The finding (issue #871): the touches are **not a',
    'uniform sample** of the register; they are stratified by series, and the',
    'stratification’s direction changes from run to run.',
    '',
    '**Flags, never verdicts** (issue #467): a stratified touch is reported with',
    'candidate explanations and NONE is chosen. Nothing in the held',
    'correspondence names these runs — that absence is stated, not filled in.',
    '',
    `_Corpus assertion ceiling: ${strat.assertionCeiling || '—'} (the latest snapshot analysed; this report carries no build-time date)._`,
    '',
    '## Method and pinned conventions',
    '',
    `- **Touch signal.** The S1 \`${strat.touchKind}\` event claim — the register`,
    '  export’s own "this row last changed" date, the column a reprocessing run',
    '  stamps. One kind by design; mixing licence-scoped or original-start dates',
    '  would conflate distinct facts.',
    '- **Series key.** The canonical `prefix_series` parse claim the ledger',
    '  already carries (exactly parseCallsign’s grouping — `M7`, `G0`, `20` for',
    '  the 2E0 intermediates, …), never a bespoke SQL re-derivation. A visitor,',
    `  special-event or unparseable callsign has no series and lands in`,
    `  \`${UNCLASSIFIED_SERIES}\` — kept in the totals, never given a verdict.`,
    '- **Vintage sequence.** Register snapshots asserting the touch kind for at',
    `  least ${num(p.minVintageSubjects)} distinct subjects, ordered by ISO anchor date. A`,
    '  month-only vintage anchors to its first day (`2024-07` → `2024-07-01`).',
    '  A partial or trial publication below the floor is not a snapshot "touched',
    '  since" is meaningful against, and is excluded.',
    '- **Touch window (the pinned convention).** For a vintage `V` with',
    '  predecessor `P`, the cohort is every subject whose latest `record-last-',
    'modified` value `d` satisfies `P.date < d ≤ V.date` — predecessor-EXCLUSIVE,',
    '  snapshot-INCLUSIVE. The earliest snapshot has no predecessor and no window.',
    '- **Enrichment measure.** Per (vintage, series): the cohort’s share of the',
    '  series against the export’s base share, shown as BOTH the absolute counts',
    '  and the ratio `cohort-share / base-share` — never a bare ratio. Cohort ⊆',
    '  base, so shares are honest fractions of the whole snapshot (the',
    `  \`${UNCLASSIFIED_SERIES}\` bucket included in the denominators).`,
    `- **Small-n guard.** A series needs ≥ ${num(p.minSeriesBase)} base and ≥ ${num(p.minCohortSubjects)} cohort`,
    '  subjects before its ratio earns an enriched/depleted verdict; below',
    '  either floor the counts are shown but the ratio is not read as signal.',
    `  A ratio ≥ ${p.enrichedRatio.toFixed(2)}× reads as enriched, ≤ ${(1 / p.enrichedRatio).toFixed(2)}× as depleted.`,
    '- **Mass-episode overlap.** Each window is checked against the S2 detector’s',
    '  flagged mass-update episodes (src/ci/event-time-coherency.ts, default',
    '  parameters). An overlap would mean the cohort coincides with a detected',
    '  episode; the spread-out reprocessing runs studied here deliberately do',
    '  NOT (they are exactly the mass touches the 21-day S2 window cannot see —',
    '  issue #872) — a coincidence, not a contradiction.',
    '',
    'Vocabulary:',
    '',
    ...[...ENRICHMENT_GLOSSES.entries()].map(([term, gloss]) => `- **${term}** — ${gloss}`),
    '',
    '## Candidate explanations (offered, adjudicated as none)',
    '',
    'A stratified touch is consistent with several mechanisms, and this report',
    'chooses between none of them:',
    '',
    '- a reprocessing run scoped to a **licence class or renewal cohort** (the',
    '  series map onto licence classes — M7/M6/M3 Foundation, M0/M1/M5 and the',
    '  G-series Full, 20/21 Intermediate — so a class-scoped run would look',
    '  exactly like a series-stratified one);',
    '- a **phased migration** touching record eras in turn (older G-series',
    '  records in one wave, newer Foundation issues in another);',
    '- a **data-quality campaign** confined to particular series or vintages.',
    '',
    'Nothing in the held correspondence names or dates these runs. The',
    'stratification is an observation about the data; the mechanism behind it is',
    'not settled here.',
    '',
  ];

  // --- Windows overview ------------------------------------------------------
  lines.push(
    '## Inter-snapshot windows',
    '',
    'Every analysed vintage, its touch window, and the cohort it carries. "Touch',
    'rate" is the cohort as a share of the snapshot’s record-bearing subjects.',
    '',
    '| snapshot | window (touched since) | base subjects | cohort subjects | touch rate | overlaps S2 episode |',
    '|---|---|---:|---:|---:|---|',
  );
  if (strat.windows.length === 0) {
    lines.push('| _(no snapshot met the analysis floor — this is "no data", not "no stratification")_ |  |  |  |  |  |', '');
  } else {
    for (const w of strat.windows) {
      const rate = w.baseSubjects === 0 ? '—' : pct(w.cohortSubjects / w.baseSubjects);
      lines.push(
        `| ${mdCode(w.vintage)} (${w.vintageDate}) | ${w.predDate} → ${w.vintageDate} | ${num(w.baseSubjects)} | ${num(w.cohortSubjects)} | ${rate} | ${w.overlapsEpisode ? 'yes' : 'no'} |`,
      );
    }
    lines.push('');
  }

  // --- Named cohorts: reconciliation with the two prior derivations ---------
  lines.push(...renderReconciliation(strat));

  // --- Per-window stratification --------------------------------------------
  lines.push(
    '## Per-window series stratification',
    '',
    'One table per analysed window with a non-empty cohort, every series ordered',
    'by base population. A window whose cohort is empty (a republication of the',
    'previous snapshot with nothing touched since) is listed above but has no',
    'stratification to show.',
    '',
  );
  for (const w of strat.windows) {
    if (w.cohortSubjects === 0) {
      lines.push(
        `### ${w.vintage} — no cohort`,
        '',
        `No record’s \`${strat.touchKind}\` falls in \`${w.predDate} → ${w.vintageDate}\`: this snapshot`,
        'repeats its predecessor’s dates (a republication, or a genuinely quiet',
        'window). Nothing touched, so nothing to stratify.',
        '',
      );
      continue;
    }
    const enrichments = seriesEnrichmentFor(strat, w.vintage);
    const { enriched, depleted } = headline(enrichments);
    const enrichedText = enriched.length === 0 ? 'none above the floor' : enriched.map(e => `${mdCode(e.series)} (${ratioText(e.ratio)})`).join(', ');
    const depletedText = depleted.length === 0 ? 'none above the floor' : depleted.map(e => `${mdCode(e.series)} (${ratioText(e.ratio)})`).join(', ');
    lines.push(
      `### ${w.vintage} — window ${w.predDate} → ${w.vintageDate}`,
      '',
      `Cohort ${num(w.cohortSubjects)} of ${num(w.baseSubjects)} subjects (${pct(w.cohortSubjects / w.baseSubjects)} touch rate).`,
      `**Enriched:** ${enrichedText}. **Depleted:** ${depletedText}.`,
      '',
      '| series | base | base share | cohort | cohort share | ratio | enrichment |',
      '|---|---:|---:|---:|---:|---:|---|',
      ...enrichments.map(e =>
        `| ${mdCode(e.series)} | ${num(e.baseSubjects)} | ${pct(e.baseShare)} | ${num(e.cohortSubjects)} | ${pct(e.cohortShare)} | ${ratioText(e.ratio)} | ${e.enrichment} |`),
      '',
    );
  }

  return lines.join('\n');
}

export const REPROCESSING_STRATIFICATION_PATH = 'reports/reprocessing-stratification.md';

export function writeReprocessingStratification(): { path: string; changed: boolean } {
  const markdown = renderReprocessingStratification(buildReprocessingStratification());
  const target = path.resolve(process.cwd(), REPROCESSING_STRATIFICATION_PATH);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const existing = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : undefined;
  const changed = existing !== markdown;
  if (changed) fs.writeFileSync(target, markdown);
  return { path: REPROCESSING_STRATIFICATION_PATH, changed };
}

if (import.meta.main) {
  const { path: written, changed } = writeReprocessingStratification();
  console.log(`${changed ? 'wrote' : 'up to date'}: ${written}`);
  perfReport({ entrypoint: 'reprocessing-stratification' });
}
