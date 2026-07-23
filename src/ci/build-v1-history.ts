#!/usr/bin/env node

/**
 * Root-served v1 HISTORY manifests (issue #932).
 *
 * The v1 history journey is two event-first surfaces — the on-this-day calendar
 * of dated event-time callouts and the event-time timeline histogram/scrubber.
 * Both embody the settled temporal hierarchy: EVENT TIME LEADS (what the record
 * states happened), with ASSERTION TIME beneath as the evidence layer (which
 * publication vintages state it).
 *
 * The v1 surface is self-contained (issue #921): its pages fetch data the deploy
 * serves at the ROOT, never reaching into the preserved /v0 tree. The v0 tree
 * already renders these surfaces (build-on-this-day.ts writes HTML only;
 * build-timeline.ts writes HTML + a /v0-served timeline/data.json whose dataset
 * citations point at /v0 dataset pages). So this step DERIVES two small,
 * root-served, v1-shaped manifests from the SAME source of truth those builders
 * fold — reusing their pure fold functions (computeOnThisDayEntries,
 * computeTimeline) rather than forking the derivation — and drops the off-surface
 * hrefs: the v1 surface renders dataset names as plain text (the raw archive key
 * rides as a tooltip), exactly as the callsign page's assertedByFold does.
 *
 * Neither manifest hand-authors anything the fold can derive: entries, buckets,
 * counts, caveats and citations are all a pure projection of the archived
 * publications.
 *
 * DETERMINISM. The output is a pure function of the projection (itself a pure
 * function of the archive bytes): the fold functions sort every list, the
 * legends are emitted in the authored caveat/kind order, and no timestamps or
 * environment values are written. The self-check test builds the manifests twice
 * and asserts byte-identity.
 *
 * Usage: node src/ci/build-v1-history.ts <site-root>
 *   writes <site-root>/on-this-day.json
 *   writes <site-root>/timeline.json
 */

import * as fs from 'fs';
import * as path from 'path';
import { computeOnThisDayEntries, type OnThisDayEntry } from './build-on-this-day.ts';
import { computeTimeline, type Timeline } from './build-timeline.ts';
import { caveatLabelOf, kindLabelOf } from './build-callsign-event-shards.ts';
import { CAVEAT_GLOSSES, type StateCaveat } from './state-at-t.ts';
import { foldEventTimeProjection, type EventDatasetRef, type EventTimeProjection } from './event-time-projection.ts';
import { loadReferenceData, type ReferenceData } from '../sources/ofcom-amateur/components.ts';

const GENERATOR = 'src/ci/build-v1-history.ts (issue #932)';

// The authored caveat order (the engine's own gloss-listing order), so a caveat
// legend reads in the same sequence wherever it renders.
const CAVEAT_ORDER: readonly StateCaveat[] = [...CAVEAT_GLOSSES.keys()];

// ---------------------------------------------------------------------------
// Shared shapes.

// One assertion-time source in the manifest's dataset table, indexed by the
// entries' and buckets' datasetIdxs. The friendly title leads and the raw
// archive key rides as the tooltip (post-#956 conventions); the off-surface
// href the v0 builders carry is deliberately dropped — the v1 surface renders
// dataset names as plain text and links only to itself.
export interface HistoryDataset {
  key: string;
  vintage: string;
  title: string;
}

// One caveat, labelled AND glossed — a caveat id never renders bare (issue #861).
export interface HistoryCaveat {
  id: StateCaveat;
  label: string;
  gloss: string;
}

// The manifest's dataset table, in the projection's own dataset order (so the
// datasetIdxs the fold emits resolve to the right row).
export function historyDatasets(datasets: readonly EventDatasetRef[]): HistoryDataset[] {
  return datasets.map(d => ({ key: d.dataset, vintage: d.vintage, title: d.title }));
}

// A caveat legend for the ids referenced, in the authored order. Each carries
// its full gloss (issue #861: a caveat must never ship bare); a missing gloss is
// a hard failure rather than a bare shipped id.
export function historyCaveatLegend(ids: Iterable<StateCaveat>): HistoryCaveat[] {
  const present = new Set(ids);
  return CAVEAT_ORDER.filter(id => present.has(id)).map((id) => {
    const gloss = CAVEAT_GLOSSES.get(id);
    if (gloss === undefined || gloss.trim() === '') {
      throw new Error(`build-v1-history: caveat "${id}" has no gloss — a caveat must never ship bare`);
    }
    return { id, label: caveatLabelOf(id), gloss };
  });
}

// ---------------------------------------------------------------------------
// The on-this-day manifest.

export interface HistoryOnThisDayEntry {
  monthDay: string;
  year: string;
  day: string;
  series: string;
  event: 'first-start' | 'first-cancellation';
  callsigns: string[];
  // The event kinds asserted at that day, as reader-facing labels (the engine's
  // own vocabulary, resolved at build so the client never re-words a claim).
  kindLabels: string[];
  datasetIdxs: number[];
  caveatIds: StateCaveat[];
  seriesIntroduced: string;
  predatesSeriesIntroduction: boolean;
}

export interface HistoryOnThisDay {
  schemaVersion: 1;
  generator: string;
  asAt: string;
  datasets: HistoryDataset[];
  caveats: HistoryCaveat[];
  entries: HistoryOnThisDayEntry[];
  count: number;
  days: number;
}

export function onThisDayManifest(entries: readonly OnThisDayEntry[], projection: Pick<EventTimeProjection, 'datasets' | 'asAt'>): HistoryOnThisDay {
  const usedCaveats = new Set<StateCaveat>();
  for (const e of entries) for (const c of e.caveats) usedCaveats.add(c);
  const shaped: HistoryOnThisDayEntry[] = entries.map(e => ({
    monthDay: e.monthDay,
    year: e.year,
    day: e.day,
    series: e.series,
    event: e.event,
    callsigns: e.callsigns,
    kindLabels: e.kinds.map(kindLabelOf),
    datasetIdxs: e.datasetIdxs,
    caveatIds: e.caveats,
    seriesIntroduced: e.seriesIntroduced,
    predatesSeriesIntroduction: e.predatesSeriesIntroduction,
  }));
  return {
    schemaVersion: 1,
    generator: GENERATOR,
    asAt: projection.asAt,
    datasets: historyDatasets(projection.datasets),
    caveats: historyCaveatLegend(usedCaveats),
    entries: shaped,
    count: shaped.length,
    days: new Set(shaped.map(e => e.monthDay)).size,
  };
}

// ---------------------------------------------------------------------------
// The timeline manifest (a v1-shaped, self-contained re-serialisation of the
// computeTimeline output — the same buckets the v0 scrubber reads, minus the
// off-surface dataset hrefs).

export interface HistoryTimelineBucket {
  year: string;
  perKind: Record<string, number>;
  startsToDate: number;
  activeReservations: number;
  topSeries: [string, number][];
  datasetIdxs: number[];
  caveatIds: StateCaveat[];
}

export interface HistoryTimeline {
  schemaVersion: 1;
  generator: string;
  asAt: string;
  datasets: HistoryDataset[];
  kinds: { id: string; label: string }[];
  caveats: HistoryCaveat[];
  histograms: Record<string, [string, number][]>;
  totals: Record<string, number>;
  buckets: HistoryTimelineBucket[];
}

export function timelineManifest(timeline: Timeline, projection: Pick<EventTimeProjection, 'datasets' | 'asAt'>): HistoryTimeline {
  const usedCaveats = new Set<StateCaveat>();
  for (const b of timeline.buckets) for (const c of b.caveats) usedCaveats.add(c);
  return {
    schemaVersion: 1,
    generator: GENERATOR,
    asAt: timeline.asAt,
    datasets: historyDatasets(projection.datasets),
    kinds: timeline.kinds.map(id => ({ id, label: kindLabelOf(id) })),
    caveats: historyCaveatLegend(usedCaveats),
    histograms: timeline.histograms,
    totals: timeline.totals,
    buckets: timeline.buckets.map(b => ({
      year: b.year,
      perKind: b.perKind,
      startsToDate: b.startsToDate,
      activeReservations: b.activeReservations,
      topSeries: b.topSeries.map(s => [s.series, s.startsToDate] as [string, number]),
      datasetIdxs: b.datasetIdxs,
      caveatIds: b.caveats,
    })),
  };
}

// ---------------------------------------------------------------------------
// Assembly.

export interface HistoryBuildSummary {
  onThisDayPath: string;
  timelinePath: string;
  entries: number;
  days: number;
  buckets: number;
  kinds: number;
}

export function buildV1History(siteRoot: string, projection: EventTimeProjection, ref: ReferenceData = loadReferenceData()): HistoryBuildSummary {
  const entries = computeOnThisDayEntries(projection, ref);
  const timeline = computeTimeline(projection, ref);
  const onThisDay = onThisDayManifest(entries, projection);
  const tl = timelineManifest(timeline, projection);

  fs.mkdirSync(siteRoot, { recursive: true });
  const onThisDayPath = path.join(siteRoot, 'on-this-day.json');
  const timelinePath = path.join(siteRoot, 'timeline.json');
  fs.writeFileSync(onThisDayPath, JSON.stringify(onThisDay));
  fs.writeFileSync(timelinePath, JSON.stringify(tl));

  return {
    onThisDayPath,
    timelinePath,
    entries: onThisDay.count,
    days: onThisDay.days,
    buckets: tl.buckets.length,
    kinds: tl.kinds.length,
  };
}

if (import.meta.main) {
  const siteRoot = process.argv.slice(2).filter(a => a.trim().length > 0)[0] ?? '_site';
  const projection = foldEventTimeProjection();
  const summary = buildV1History(siteRoot, projection);
  console.log(`built v1 history manifests in ${siteRoot} (as at ${projection.asAt})`);
  console.log(`  on-this-day: ${summary.entries} entries across ${summary.days} days -> ${summary.onThisDayPath}`);
  console.log(`  timeline: ${summary.kinds} kinds, ${summary.buckets} year buckets -> ${summary.timelinePath}`);
}
