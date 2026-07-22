#!/usr/bin/env node

/**
 * The event-time TIMELINE surface (issue #726, remainder item 1): the record's
 * licensing activity arranged along EVENT time, as a build-rendered static SVG
 * histogram per licensing kind (the complete no-JS baseline), plus a
 * pre-aggregated per-bucket JSON the enhancement (site/timeline.js) scrubs with
 * an input[type=range] to read per-instant summary statistics.
 *
 * The two time axes are never conflated (binding on every event-time surface):
 *  - each histogram bar is dated by EVENT time (the year an event is asserted
 *    to fall in), and every figure names the ASSERTION-time vintages that state
 *    it — inline in the readout, and in the shared dataset legend of the JSON;
 *  - the derived "as at" instant every per-instant figure is computed for is
 *    the corpus's latest proven assertion day (projection.asAt), never the
 *    build clock, so the artefact is a pure function of the corpus.
 *
 * Epistemic posture (binding, mirroring build-on-this-day.ts and the state
 * engine):
 *  - every bucket figure is DERIVED from what the held vintages assert; a count
 *    is a statement about THIS mirror's holdings, never "the whole truth";
 *  - the version-scoped start kinds mean "earliest start SURVIVING in the
 *    asserting vintage" (issue #800), so cumulative starts carry the
 *    earliest-surviving (and pre-1977) caveats; cancellation evidence is
 *    sparsely attested; the reserved-until column carries three cohort
 *    meanings, so an "active reservation window" reads only the stated bound;
 *  - absence of activity in a bucket is NON-OBSERVATION, never "nothing
 *    happened" — the page and the explainer say so.
 *
 * The per-instant aggregate figures reuse the state-at-t engine's authored
 * contribution registry (contributionOf) and caveat vocabulary over the SAME
 * EventTimeProjection the per-callsign strips fold — no new data path. They are
 * computed by one ordered pass over the projection rather than by running
 * deriveStateAtT once per subject at every bucket instant (which would be
 * O(subjects x buckets) and yield the same figures); the per-subject engine
 * answer remains the per-callsign strip's path, and both surfaces read the one
 * contribution/caveat vocabulary so they can never drift apart.
 *
 * DETERMINISM: a pure function of the projection (itself a pure function of the
 * archive bytes). Every bucket, list and object-key order is explicit and no
 * timestamps are written, so re-running over unchanged inputs re-derives byte
 * for byte. The corpus test builds twice and asserts byte-identity.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  contributionOf,
  EARLIEST_SURVIVING_KINDS,
  isMonthPrecisionVintage,
  vintageDaySpan,
  CAVEAT_GLOSSES,
  type StateCaveat,
  type StateContribution,
} from './state-at-t.ts';
import { CAVEAT_LABELS, caveatLabelOf, kindLabelOf } from './build-callsign-event-shards.ts';
import { datasetIndexOf, type EventDatasetRef, type EventTimeProjection } from './event-time-projection.ts';
import { EVENT_DATE_KINDS } from '../v2/claim.ts';
import { parseCallsign, loadReferenceData, type ReferenceData } from '../sources/ofcom-amateur/components.ts';
import {
  htmlPage, escapeHtml, dateTime, glossaryTerm, epistemicsPill,
  externalLink, REPO_URL, tableCaption, zeroCell,
} from './site-render.ts';

// The licensing kinds a timeline figure is drawn for — every event kind whose
// state contribution is a licensing one (a start, a cancellation, a reservation
// bound), in the authored vocabulary order. Bookkeeping stamps (system
// presence) are deliberately excluded: they are not licensing activity, and the
// per-callsign strip already folds them closed as such.
const LICENSING_CONTRIBUTIONS: ReadonlySet<StateContribution> = new Set(['licence-start', 'licence-end', 'reservation-end']);

export function isLicensingKind(kind: string): boolean {
  return LICENSING_CONTRIBUTIONS.has(contributionOf(kind));
}

export const LICENSING_KINDS: readonly string[] = EVENT_DATE_KINDS.filter(isLicensingKind);

// The authored order caveats appear in a bucket (the engine's own gloss-listing
// order, so a timeline caveat reads in the same sequence as everywhere else).
const CAVEAT_ORDER: readonly StateCaveat[] = [...CAVEAT_GLOSSES.keys()];

export interface TimelineSeriesCount {
  series: string;
  // Cumulative callsigns of this series with a surviving licence-start dated on
  // or before the bucket instant.
  startsToDate: number;
}

export interface TimelineBucket {
  // The calendar year the bucket covers; the instant its per-instant figures
  // are computed for is the year's last day.
  year: string;
  // Distinct dated events (one per subject, kind and day) of each licensing
  // kind asserted to fall in this year — the histogram heights, keyed by kind
  // id in the authored vocabulary order. Kinds with no event this year are
  // omitted from the object (a zero bar renders from the histogram arrays).
  perKind: Record<string, number>;
  // Callsigns with a surviving licence-start dated on or before the instant.
  startsToDate: number;
  // Reservation windows whose stated end is on or after the instant — a
  // conservative reading of the stated bound, never a status (issue #725).
  activeReservations: number;
  // The most-represented prefix series by cumulative starts at the instant.
  topSeries: TimelineSeriesCount[];
  // Indices into the projection's dataset list — the assertion-time citation
  // for the events this year carries (empty when the year carries no event).
  datasetIdxs: number[];
  // Caveats the bucket's figures carry, authored ids in gloss order.
  caveats: StateCaveat[];
}

export interface Timeline {
  // The corpus's latest proven assertion day — the derived instant every
  // cumulative figure at the final bucket is stated "as at".
  asAt: string;
  // The licensing kinds the corpus carries at least one event for, in the
  // authored vocabulary order — one static histogram figure each.
  kinds: string[];
  // Per kind, the [year, distinct-event count] series over the whole observed
  // span (including zero years, so every figure shares one continuous axis).
  histograms: Record<string, [string, number][]>;
  // Total distinct events per kind, for the figure captions.
  totals: Record<string, number>;
  // Per year, the pre-aggregated per-instant figures the scrubber reads.
  buckets: TimelineBucket[];
}

// How many prefix series a bucket names — the busiest few, enough to show the
// shape without turning the readout into a table.
export const TOP_SERIES_COUNT = 8;

// The bucket the scrubber and the static headline open on: the corpus's latest
// PROVEN assertion year (asAt), not the maximum event year — event dates run
// past today (future-dated reservations and the odd data-quality outlier), so
// opening on the last bucket would anchor on a year that has not happened. Falls
// back to the last bucket when asAt's year is outside the span. The client
// (site/timeline.js) applies the identical rule against the JSON's asAt.
export function anchorBucketIndex(timeline: Timeline): number {
  if (timeline.buckets.length === 0) return -1;
  const anchorYear = timeline.asAt.slice(0, 4);
  const idx = timeline.buckets.findIndex(b => b.year === anchorYear);
  if (idx !== -1) return idx;
  // asAt outside the event-time span: below it (unusually early asAt) opens on
  // the first bucket, above it (the usual case — event dates run past the proven
  // assertion day) on the last.
  return anchorYear < timeline.buckets[0].year ? 0 : timeline.buckets.length - 1;
}

interface ReservationWindow {
  // The stated window end (event time).
  end: string;
  // The last day the asserting vintage is proven to cover (assertion time) — a
  // month-keyed vintage counts only when its whole month is on or before the
  // instant, exactly as the state engine reads it.
  vintageLatest: string;
  // Whether the stating vintage is month-keyed — a covering finding then carries
  // the month-precision caveat, as the engine attaches it.
  monthKeyed: boolean;
}

interface SubjectFacts {
  series: string;
  // The earliest surviving licence-start day held for the subject (undefined
  // when the subject carries no licence-start evidence).
  startDay: string | undefined;
  // Every stated reservation window held for the subject, each with the
  // assertion-time bound of the vintage that stated it.
  reservations: ReservationWindow[];
}

function yearOf(day: string): string {
  return day.slice(0, 4);
}

function yearEnd(year: string): string {
  return `${year}-12-31`;
}

// Fold the projection into per-year histograms and the pre-aggregated
// per-instant buckets. Pure and deterministic: subjects and years are walked in
// sorted order and every output list is explicitly ordered.
export function computeTimeline(projection: EventTimeProjection, ref: ReferenceData = loadReferenceData()): Timeline {
  // Per kind, per year: the count of DISTINCT (subject, day) events — deduped
  // so a date asserted by several vintages is one dated event, not several.
  const histCounts = new Map<string, Map<string, number>>();
  for (const kind of LICENSING_KINDS) histCounts.set(kind, new Map());
  // Per year: the datasets asserting any licensing event that year.
  const yearDatasets = new Map<string, Set<number>>();
  // Per (series): per start-year, the count of subjects first surviving-started
  // that year — the prefix-sums the cumulative top-series read.
  const seriesStartYears = new Map<string, Map<string, number>>();
  // Per start-year: total subjects whose earliest surviving start falls there.
  const startsByYear = new Map<string, number>();
  // Per year: subjects with a reservation window whose stated end is on or
  // after the year's last day AND whose stating vintage is proven on or before
  // it — the covering reading the state engine uses, counted once per subject
  // per year even where several windows overlap.
  const activeReservationsByYear = new Map<string, number>();
  // Per year: whether a covering reservation counted that year was stated by a
  // month-keyed vintage (its finding then carries the month-precision caveat).
  const monthKeyedReservationYears = new Set<string>();

  let earliestStartDay: string | undefined;
  // The earliest EVENT DAY a version-scoped / month-keyed-asserted licence-start
  // is dated on. A caveat resting on such a start enters the cumulative figure
  // at the instant that start is dated on or before — mirroring the state engine,
  // which attaches the caveat to the start finding at every t once such a start
  // line is consulted (state-at-t.ts), not from the build-time global presence
  // of the vintage anywhere in the corpus.
  let earliestVersionScopedStartDay: string | undefined;
  let earliestMonthKeyedStartDay: string | undefined;
  let minYear: string | undefined;
  let maxYear: string | undefined;

  const noteYear = (year: string): void => {
    if (minYear === undefined || year < minYear) minYear = year;
    if (maxYear === undefined || year > maxYear) maxYear = year;
  };

  for (const [subject, rows] of projection.rows) {
    const facts: SubjectFacts = {
      series: parseCallsign(subject, '', ref, '').prefixSeries,
      startDay: undefined,
      reservations: [],
    };

    // Rows arrive sorted (kind, day, lane, dataset, vintage), so a repeated
    // (kind, day) across vintages is adjacent and deduped by comparison.
    let prevKind = '';
    let prevDay = '';
    for (const row of rows) {
      const contribution = contributionOf(row.kind);
      if (!LICENSING_CONTRIBUTIONS.has(contribution)) continue;
      const isNewEvent = row.kind !== prevKind || row.day !== prevDay;
      prevKind = row.kind;
      prevDay = row.day;

      const year = yearOf(row.day);
      noteYear(year);

      if (isNewEvent) {
        const byYear = histCounts.get(row.kind);
        if (byYear !== undefined) byYear.set(year, (byYear.get(year) ?? 0) + 1);
      }
      // Every asserting dataset for the year, deduped by index.
      let datasets = yearDatasets.get(year);
      if (datasets === undefined) { datasets = new Set(); yearDatasets.set(year, datasets); }
      datasets.add(datasetIndexOf(projection.datasets, row.lane, row.dataset));

      if (contribution === 'licence-start') {
        if (facts.startDay === undefined || row.day < facts.startDay) facts.startDay = row.day;
        if (EARLIEST_SURVIVING_KINDS.has(row.kind)) {
          if (earliestVersionScopedStartDay === undefined || row.day < earliestVersionScopedStartDay) earliestVersionScopedStartDay = row.day;
        }
        if (isMonthPrecisionVintage(row.vintage)) {
          if (earliestMonthKeyedStartDay === undefined || row.day < earliestMonthKeyedStartDay) earliestMonthKeyedStartDay = row.day;
        }
      } else if (contribution === 'reservation-end') {
        facts.reservations.push({ end: row.day, vintageLatest: vintageDaySpan(row.vintage).latest, monthKeyed: isMonthPrecisionVintage(row.vintage) });
      }
    }

    if (facts.startDay !== undefined) {
      const startYear = yearOf(facts.startDay);
      startsByYear.set(startYear, (startsByYear.get(startYear) ?? 0) + 1);
      if (earliestStartDay === undefined || facts.startDay < earliestStartDay) earliestStartDay = facts.startDay;
      if (facts.series !== '') {
        let byYear = seriesStartYears.get(facts.series);
        if (byYear === undefined) { byYear = new Map(); seriesStartYears.set(facts.series, byYear); }
        byYear.set(startYear, (byYear.get(startYear) ?? 0) + 1);
      }
    }
    // The years this subject holds a reservation window covering the year end:
    // stated end on or after it, stating vintage proven on or before it. A
    // subject is counted once per year even if several of its windows qualify.
    const activeYears = new Set<string>();
    const monthKeyedActiveYears = new Set<string>();
    for (const window of facts.reservations) {
      const lowYear = Number(yearOf(window.vintageLatest));
      // The greatest year whose last day is still on or before the stated end.
      const endYearNum = Number(yearOf(window.end));
      const highYear = window.end >= yearEnd(String(endYearNum)) ? endYearNum : endYearNum - 1;
      for (let y = lowYear; y <= highYear; y += 1) {
        activeYears.add(String(y));
        if (window.monthKeyed) monthKeyedActiveYears.add(String(y));
      }
    }
    for (const year of activeYears) activeReservationsByYear.set(year, (activeReservationsByYear.get(year) ?? 0) + 1);
    for (const year of monthKeyedActiveYears) monthKeyedReservationYears.add(year);
  }

  const kinds = LICENSING_KINDS.filter((kind) => {
    const byYear = histCounts.get(kind);
    return byYear !== undefined && byYear.size > 0;
  });

  if (minYear === undefined || maxYear === undefined) {
    return { asAt: projection.asAt, kinds: [], histograms: {}, totals: {}, buckets: [] };
  }

  const years: string[] = [];
  for (let y = Number(minYear); y <= Number(maxYear); y += 1) years.push(String(y));

  const histograms: Record<string, [string, number][]> = {};
  const totals: Record<string, number> = {};
  for (const kind of kinds) {
    const byYear = histCounts.get(kind) ?? new Map<string, number>();
    histograms[kind] = years.map(year => [year, byYear.get(year) ?? 0]);
    totals[kind] = [...byYear.values()].reduce((sum, n) => sum + n, 0);
  }

  // The earliest event day the corpus's earliest surviving start is dated on is
  // pre-1977, so once any start is counted (its earliest is always this one) the
  // cumulative starts figure rests on a pre-1977 date — pre-1977 attaches from
  // the first non-empty bucket, exactly the engine's reading.
  const pre1977Present = earliestStartDay !== undefined && earliestStartDay < '1977-01-01';
  const monthKeyedDatasets = new Set(
    projection.datasets.map((d, i) => (isMonthPrecisionVintage(d.vintage) ? i : -1)).filter(i => i >= 0));

  const runningSeries = new Map<string, number>();
  let startsToDate = 0;

  const buckets: TimelineBucket[] = years.map((year) => {
    startsToDate += startsByYear.get(year) ?? 0;
    for (const [series, byYear] of seriesStartYears) {
      const add = byYear.get(year) ?? 0;
      if (add > 0) runningSeries.set(series, (runningSeries.get(series) ?? 0) + add);
    }
    const activeReservations = activeReservationsByYear.get(year) ?? 0;

    const perKind: Record<string, number> = {};
    for (const kind of kinds) {
      const n = histograms[kind].find(([y]) => y === year)?.[1] ?? 0;
      if (n > 0) perKind[kind] = n;
    }
    const yearHasCancellation = LICENSING_KINDS.some(k => contributionOf(k) === 'licence-end' && (perKind[k] ?? 0) > 0);
    const yearHasReservation = LICENSING_KINDS.some(k => contributionOf(k) === 'reservation-end' && (perKind[k] ?? 0) > 0);

    const topSeries: TimelineSeriesCount[] = [...runningSeries.entries()]
      .map(([series, n]) => ({ series, startsToDate: n }))
      .sort((a, b) => b.startsToDate - a.startsToDate || a.series.localeCompare(b.series))
      .slice(0, TOP_SERIES_COUNT);

    const datasetIdxs = [...(yearDatasets.get(year) ?? new Set<number>())].sort((a, b) => a - b);

    const end = yearEnd(year);
    // A caveat resting on a version-scoped or month-keyed start enters the
    // cumulative figure at the instant that start is dated on or before —
    // matching the engine, which consults only start lines dated <= t. A global
    // presence flag would drop the caveat forward onto buckets whose cumulative
    // does rest on the start (under-attach, #870) or attach it before that start
    // is even dated (over-attach); the event-dated thresholds do neither.
    const caveats: StateCaveat[] = [];
    if (startsToDate > 0 && earliestVersionScopedStartDay !== undefined && earliestVersionScopedStartDay <= end) caveats.push('earliest-surviving');
    if (startsToDate > 0 && pre1977Present) caveats.push('pre-1977');
    if (yearHasCancellation) caveats.push('cancellation-sparsity');
    if (activeReservations > 0 || yearHasReservation) caveats.push('reserved-cohort-ambiguity');
    const monthKeyedCumulativeStart = earliestMonthKeyedStartDay !== undefined && earliestMonthKeyedStartDay <= end;
    const monthKeyedThisYear = datasetIdxs.some(i => monthKeyedDatasets.has(i));
    if (monthKeyedCumulativeStart || monthKeyedThisYear || monthKeyedReservationYears.has(year)) caveats.push('month-precision-vintage');
    // The whole timeline reads under the availability trap: a quiet year is
    // non-observation, so every bucket carries it (rendered once in the legend).
    caveats.push('availability-trap');

    return {
      year,
      perKind,
      startsToDate,
      activeReservations,
      topSeries,
      datasetIdxs,
      caveats: CAVEAT_ORDER.filter(c => caveats.includes(c)),
    };
  });

  return { asAt: projection.asAt, kinds, histograms, totals, buckets };
}

// --- The pre-aggregated JSON the scrubber reads ------------------------------

interface TimelineJsonCaveat { id: StateCaveat; label: string; gloss: string; }

function caveatLegend(): TimelineJsonCaveat[] {
  return CAVEAT_ORDER.map((id) => {
    const gloss = CAVEAT_GLOSSES.get(id);
    if (gloss === undefined || gloss.trim() === '') {
      throw new Error(`buildTimeline: caveat "${id}" has no gloss - a caveat must never ship bare`);
    }
    return { id, label: caveatLabelOf(id), gloss };
  });
}

// The compact artefact site/timeline.js fetches. Every figure it renders can
// name its asserting vintages (the dataset legend) and its caveats (the caveat
// legend) without a second request — the same meta-legend shape the event
// strip's meta.json ships (issue #861: a rule/caveat never renders bare).
export function timelineJson(timeline: Timeline, datasets: readonly EventDatasetRef[]): string {
  const payload = {
    schemaVersion: 1,
    generator: 'src/ci/build-timeline.ts (issue #726)',
    asAt: timeline.asAt,
    kinds: timeline.kinds.map(kind => ({ id: kind, label: kindLabelOf(kind), contribution: contributionOf(kind) })),
    caveats: caveatLegend(),
    datasets: datasets.map(d => ({ lane: d.lane, key: d.dataset, vintage: d.vintage, title: d.title, href: d.href })),
    buckets: timeline.buckets.map(b => ({
      year: b.year,
      perKind: b.perKind,
      startsToDate: b.startsToDate,
      activeReservations: b.activeReservations,
      topSeries: b.topSeries.map(s => [s.series, s.startsToDate] as [string, number]),
      datasetIdxs: b.datasetIdxs,
      caveats: b.caveats,
    })),
  };
  return JSON.stringify(payload);
}

// --- The static, build-rendered page (the complete no-JS baseline) -----------

const CHART_WIDTH = 600;
const CHART_HEIGHT = 150;
const PAD_TOP = 12;
const PAD_BOTTOM = 28;

// A build-rendered static SVG histogram over the same idiom as the dataset
// pages' svgBarChart: the data table beneath IS the content (crawlable,
// screen-reader-native, complete with no SVG), the inline SVG a visual layer
// with role="img" + title/desc and a per-bar hover title; theme-aware via the
// shared CSS custom properties, no client JS and no charting dependency.
function timelineHistogram(idBase: string, heading: string, summary: string, data: readonly [string, number][]): string {
  if (data.length === 0) return '';
  const max = Math.max(...data.map(d => d[1]));
  const gap = data.length > 40 ? 1 : 2;
  const barW = (CHART_WIDTH - (data.length - 1) * gap) / data.length;
  const labelEvery = data.length <= 14 ? 1 : Math.ceil(data.length / 12);
  const parts = data.map(([label, n], i) => {
    const shown = escapeHtml(label);
    const h = max > 0 ? (n / max) * CHART_HEIGHT : 0;
    const x = i * (barW + gap);
    const y = PAD_TOP + (CHART_HEIGHT - h);
    const cx = (x + barW / 2).toFixed(1);
    const tick = i % labelEvery === 0
      ? `<text x="${cx}" y="${(PAD_TOP + CHART_HEIGHT + 14).toFixed(1)}" text-anchor="middle" font-size="9" fill="var(--muted)">${shown}</text>`
      : '';
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(barW, 0.5).toFixed(1)}" height="${h.toFixed(1)}" fill="var(--accent)">`
      + `<title>${shown}: ${n.toLocaleString('en-GB')} dated ${n === 1 ? 'event' : 'events'}</title></rect>${tick}`;
  }).join('');
  const rows = data
    .filter(([, n]) => n > 0)
    .map(([label, n]) => `<tr><td>${escapeHtml(label)}</td><td class="n">${zeroCell(n, n.toLocaleString('en-GB'))}</td></tr>`)
    .join('');
  return `<figure class="chart"><figcaption>${escapeHtml(heading)}</figcaption>`
    + '<div class="overflow" style="overflow-x:auto">'
    + `<svg viewBox="0 0 ${CHART_WIDTH} ${PAD_TOP + CHART_HEIGHT + PAD_BOTTOM}" role="img" aria-labelledby="${idBase}-t ${idBase}-d" preserveAspectRatio="xMidYMid meet">`
    + `<title id="${idBase}-t">${escapeHtml(heading)}</title><desc id="${idBase}-d">${escapeHtml(summary)}</desc>${parts}</svg>`
    + '</div>'
    + `<details><summary>Data table (the years with events behind the chart)</summary><table>${tableCaption(`${heading} — the figures behind the chart`)}`
    + '<thead><tr><th scope="col">year (event time)</th><th scope="col" class="n">dated events</th></tr></thead>'
    + `<tbody>${rows}</tbody></table></details></figure>`;
}

// The chart and scrubber styling for this page. The plain page shell
// (htmlPage / PAGE_STYLE) carries the shared palette but not the entry shell's
// .chart rules, so the timeline ships its own bespoke block scoped to the page
// - the shared design tokens (var(--*)) keep it in the site's visual language.
const TIMELINE_STYLE = [
  '<style>',
  '.chart{margin:0 0 1.1rem}.chart figcaption{font-weight:600;font-size:.92rem;margin:0 0 .3rem}',
  '.chart svg{width:100%;min-width:600px;height:auto;max-height:190px;display:block}',
  '.chart details{margin-top:.3rem}.chart summary{cursor:pointer;color:var(--accent);font-size:.84rem}',
  '.chart details table{margin-top:.4rem;max-width:22rem}',
  '.tl-scrubber{margin:1rem 0;padding:.9rem 1.1rem;border:1px solid var(--line);border-radius:10px;background:var(--slot)}',
  '.tl-scrubber label{display:block;font-weight:600;margin-bottom:.4rem}',
  '.tl-scrubber input[type=range]{width:100%;accent-color:var(--accent)}',
  '.tl-year{font-variant-numeric:tabular-nums;font-weight:650}',
  '.tl-readout{margin-top:.7rem}.tl-readout ul{margin:.3rem 0}.tl-readout .tl-figure{margin:.35rem 0}',
  '.tl-caveats{color:var(--muted);font-size:.9rem}.tl-caveats a{color:var(--accent)}',
  '.tl-assert{color:var(--muted);font-size:.9rem}',
  '</style>',
].join('');

export function renderTimelinePage(timeline: Timeline, projection: EventTimeProjection): string {
  const { asAt } = projection;
  const body: string[] = [
    TIMELINE_STYLE,
    '<div data-page="timeline">',
    '<h1>The record over time</h1>',
    '<p>The held corpus’s licensing activity along <b>event time</b>: for each '
    + 'licensing kind, how many dated events the archived '
    + 'publications place in each year, and — as you scrub the timeline — what the mirror can say '
    + `<b>as at</b> any instant: how many callsigns had a surviving start by then, how many reservation `
    + `windows were stated to still be open, and which ${glossaryTerm('prefix-series', 0)} lead. Every figure is `
    + `${epistemicsPill('derived', 0)} from what the archived publications assert, and cites the datasets `
    + '(and their vintages — the assertion time) that state it — the two time axes are never merged. '
    + `Counts describe this mirror’s holdings${asAt === '' ? '' : ` (assertions up to ${dateTime(asAt, { precision: 'full-date' })})`}, never “the whole truth”.</p>`,
    // The scrubber slot: filled by the enhancement (site/timeline.js). Without
    // JavaScript the histograms and their data tables below are the complete
    // page, and the cumulative headline states the as-at end state.
    `<div id="timeline-scrubber" data-timeline-src="timeline/data.json"></div>`,
  ];

  // The mechanism explainer: always present, folded — the conditional-
  // prominence pattern. Uniformly applicable background here (every figure is a
  // derived "as held" reading), so it stays folded rather than shouting on each
  // bar; the readout's caveat labels link into it.
  body.push(
    '<details id="reading-this-timeline">',
    '<summary>How to read this timeline (derived counts, earliest-surviving semantics, non-observation)</summary>',
    '<ul>',
    `<li><b>${escapeHtml(caveatLabelOf('earliest-surviving'))}</b> — a cumulative “starts to date” counts callsigns `
    + 'whose earliest <em>surviving</em> licence-version start is dated by the instant. Rolling retention and '
    + 'reissues drop or replace older rows (issue #800), so earlier starts may have existed and left no trace.</li>',
    `<li><b>${escapeHtml(caveatLabelOf('pre-1977'))}</b> — original start dates before 1977 are attested-unreliable `
    + '(OARC, citing an administrative glitch by the then regulator).</li>',
    `<li><b>${escapeHtml(caveatLabelOf('cancellation-sparsity'))}</b> — cancellation dates are attested by very few `
    + 'held vintages, so a cancellation histogram is an especially weakly-bounded floor.</li>',
    `<li><b>${escapeHtml(caveatLabelOf('reserved-cohort-ambiguity'))}</b> — an “active reservation window” reads only `
    + 'the stated end bound; that column carries three cohort meanings (issue #725), never a status.</li>',
    `<li><b>${escapeHtml(caveatLabelOf('month-precision-vintage'))}</b> — a month-keyed vintage’s assertion time is `
    + 'only proven to lie somewhere inside its month, so its citations read the whole month conservatively.</li>',
    `<li><b>${escapeHtml(caveatLabelOf('availability-trap'))}</b> — a quiet year is non-observation: the held sources `
    + 'attest nothing for it, never “nothing happened”.</li>',
    `<li>The full working lives in the committed reports: ${externalLink(`${REPO_URL}/blob/main/reports/state-at-t.md`, 'state-at-t (the inference rules)')} and ${externalLink(`${REPO_URL}/blob/main/reports/event-time-coherency.md`, 'event-time coherency (cross-vintage revisions)')}. See also the <a href="on-this-day.html">on-this-day calendar</a>.</li>`,
    '</ul>',
    '</details>',
  );

  if (timeline.kinds.length === 0) {
    body.push('<p><b>No entries.</b> The held corpus carries no dated licensing-event evidence to place on a '
      + 'timeline — a statement about these holdings, not about history.</p>');
  } else {
    body.push('<h2>Activity by year, per licensing kind</h2>');
    body.push('<p class="obs-mini">Each bar is a count of <b>distinct dated events</b> (one per callsign, kind and '
      + 'day; a date asserted by several vintages is one event). A year with no bar carries no held evidence for that '
      + 'kind — non-observation, never “nothing happened”.</p>');
    timeline.kinds.forEach((kind, i) => {
      const total = timeline.totals[kind] ?? 0;
      const heading = kindLabelOf(kind);
      const summary = `Dated ${kindLabelOf(kind)} events per year, event time; ${total.toLocaleString('en-GB')} in total across the held corpus.`;
      body.push(timelineHistogram(`tl-k${i}`, heading, summary, timeline.histograms[kind] ?? []));
    });

    // The no-JS cumulative headline and the full per-year cumulative table: the
    // scrubber's substance, complete without JavaScript. The headline anchors on
    // the corpus's latest proven assertion year, the same instant the scrubber
    // opens on — not the maximum event year, which future-dated evidence pushes
    // past today.
    const anchor = timeline.buckets[anchorBucketIndex(timeline)];
    body.push('<h2>Cumulative figures</h2>');
    body.push(`<p class="tl-figure"><b>As at end of ${escapeHtml(anchor.year)}</b> ${epistemicsPill('derived', 0)} — `
      + `the corpus’s latest proven assertion day is ${dateTime(asAt, { precision: 'full-date' })}; by then `
      + `${anchor.startsToDate.toLocaleString('en-GB')} ${anchor.startsToDate === 1 ? 'callsign has' : 'callsigns have'} a `
      + 'surviving licence-start dated, and '
      + `${anchor.activeReservations.toLocaleString('en-GB')} reservation ${anchor.activeReservations === 1 ? 'window is' : 'windows are'} `
      + 'stated to still be open. These read “as held”, under the caveats above. Scrub the timeline, or read the '
      + 'full year-by-year figures below.</p>');
    body.push('<details><summary>Cumulative figures by year (the scrubber’s figures, complete without JavaScript)</summary>');
    body.push(`<table>${tableCaption('Cumulative starts to date and active reservation windows, by year end')}`
      + '<thead><tr><th scope="col">as at year end</th><th scope="col" class="n">starts to date</th>'
      + '<th scope="col" class="n">active reservation windows</th></tr></thead><tbody>');
    for (const b of timeline.buckets) {
      body.push(`<tr><td>${escapeHtml(b.year)}</td><td class="n">${zeroCell(b.startsToDate, b.startsToDate.toLocaleString('en-GB'))}</td>`
        + `<td class="n">${zeroCell(b.activeReservations, b.activeReservations.toLocaleString('en-GB'))}</td></tr>`);
    }
    body.push('</tbody></table></details>');
  }

  body.push('<script type="module" src="timeline.js"></script>', '</div>');

  return htmlPage('Timeline — UK amateur callsign data mirror', 0, body, {
    currentNav: 'Timeline',
    sourcePath: 'src/ci/build-timeline.ts',
  });
}

export interface TimelineBuildSummary {
  htmlPath: string;
  dataPath: string;
  kinds: number;
  buckets: number;
  years: string;
  dataBytes: number;
}

export function buildTimeline(projection: EventTimeProjection, htmlPath: string, dataPath: string, ref: ReferenceData = loadReferenceData()): TimelineBuildSummary {
  const timeline = computeTimeline(projection, ref);
  const html = renderTimelinePage(timeline, projection);
  const json = timelineJson(timeline, projection.datasets);
  fs.mkdirSync(path.dirname(htmlPath), { recursive: true });
  fs.writeFileSync(htmlPath, html);
  fs.mkdirSync(path.dirname(dataPath), { recursive: true });
  fs.writeFileSync(dataPath, json);
  const first = timeline.buckets[0]?.year ?? '';
  const last = timeline.buckets[timeline.buckets.length - 1]?.year ?? '';
  return {
    htmlPath,
    dataPath,
    kinds: timeline.kinds.length,
    buckets: timeline.buckets.length,
    years: first === '' ? '(none)' : `${first}–${last}`,
    dataBytes: Buffer.byteLength(json),
  };
}

// Drift guard used by the tests: every caveat the timeline can attach carries
// an authored label (the labels live with the shard builder so both surfaces
// speak one vocabulary).
export const TIMELINE_CAVEATS: readonly StateCaveat[] = [...CAVEAT_LABELS.keys()];
