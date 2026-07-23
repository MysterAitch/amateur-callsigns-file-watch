#!/usr/bin/env node

/**
 * Prefix-sharded static JSON for the per-callsign EVENT-TIME strip
 * (issue #726): what the corpus asserts HAPPENED to a callsign and when,
 * distinct from the assertion-time snapshot-presence census the instant page
 * already renders. Built at deploy beside the issue #594 shards, fetched
 * LAZILY by the callsign page after the instant answer has rendered — the
 * instant path is untouched.
 *
 * Everything here is precomputed by the state-at-t engine (issue #725 S3,
 * src/ci/state-at-t.ts): per subject, ONE deriveStateAtT run at t = the
 * corpus's latest proven assertion day ("as at"), whose output supplies
 *   - the evidence lines (every (event kind, event day) with the datasets
 *     asserting it, mass-episode annotated),
 *   - the findings, whose STATEMENTS ARE SHIPPED VERBATIM — issue #861 item 4
 *     is binding: a finding renders statement + caveats, never a bare
 *     rule-name badge, so the client never re-derives or re-words a claim,
 *   - the cross-vintage disagreements (both camps, resolved nowhere — #467).
 *
 * The two time axes are kept structurally separate: every evidence line's
 * `day` is EVENT time, and its asserted-by list is ASSERTION time (dataset +
 * vintage indices into the meta's dataset table), so the client can always put
 * the assertion-time provenance one affordance away from any event-time claim.
 *
 * Output, under <outputDir> (deploy path: _site/callsign/data/events/):
 *   meta.json    — the once-fetched legend: the dataset table (lane, key,
 *                  vintage, title, href), the event-kind vocabulary with
 *                  reader-facing labels, the rule and caveat glosses (the
 *                  engine's own, verbatim), the detected mass-episode windows,
 *                  the per-series introduction months (seriesIntro, issue #921),
 *                  the as-at day and the shard list.
 *   <SHARD>.json — { shard, callsigns: { <cleaned form>: EventRecord } }.
 *
 * PER-CALLSIGN RECORD (compact arrays; mirrored by the JSDoc typedefs in
 * site/callsign-events.js — the two must be kept in step):
 *   e  evidence lines, sorted (day, kind):
 *        [kindIndex, day, [[datasetIndex, nrows], ...], episodeIndex?]
 *      episodeIndex (into meta.episodes) present only when the day falls
 *      inside a detected mass-update episode window (issue #801).
 *   f  findings from deriveStateAtT at t = meta.asAt:
 *        [ruleIndex, statement, [caveatIndex, ...], [evidenceLineIndex, ...]]
 *      The statement is the engine's own sentence verbatim; the caveats are
 *      the engine's, by index into meta.caveats. Never rendered without both.
 *   g  cross-vintage disagreements (issue #467 — surfaced, never resolved):
 *        [kindIndex, [[day, [datasetIndex, ...]], ...]]
 *      every camp listed with its asserting datasets.
 *   w  1 when the record carries a multi-row version window on a version-scoped
 *      start kind (one dataset asserting several dated rows — issue #800's
 *      mechanism-A shape); omitted otherwise. One of the signals that
 *      auto-opens the reader-facing reissue explainer.
 *
 * Subjects with NO event-date claim have no record here at all: the client
 * renders the explicit non-observation state (never "was available" or
 * "did not exist" — the availability trap is binding).
 *
 * DETERMINISM: a pure function of the projection (itself a pure function of
 * the archive bytes) — subjects sorted, every list explicitly ordered, no
 * timestamps: the "as at" instant is the corpus's latest proven assertion day,
 * never the build clock. The corpus test builds twice and asserts
 * byte-identity.
 *
 * Usage: node src/ci/build-event-time-surfaces.ts (the one-pass CLI for both
 * issue #726 build artefacts; this module is its shard half).
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  deriveStateAtT,
  contributionOf,
  EARLIEST_SURVIVING_KINDS,
  RULE_GLOSSES,
  CAVEAT_GLOSSES,
  type StateCaveat,
  type StateContext,
  type StateRule,
} from './state-at-t.ts';
import {
  DEFAULT_EPISODE_PARAMS,
  detectEpisodeSignals,
  mergeEpisodes,
  type Episode,
  type EpisodeParams,
} from './event-time-coherency.ts';
import { EVENT_DATE_KINDS } from '../v2/claim.ts';
import { partitionShards } from './build-callsign-shards.ts';
import { datasetIndexOf, type EventTimeProjection } from './event-time-projection.ts';
import { loadReferenceData, type ReferenceData } from '../sources/ofcom-amateur/components.ts';

// Event shards carry more per record than the instant shards, so they split
// hot buckets sooner to keep each lazy fetch modest.
export const EVENT_SHARD_SPLIT_THRESHOLD = 1000;

// Reader-facing labels for the authored event kinds — total over the S1
// vocabulary (the drift-guard test walks EVENT_DATE_KINDS), each phrased to
// carry its epistemic ceiling inline: a bookkeeping stamp never reads as a
// licensing event, and a version-scoped start never reads as "the original".
export const KIND_LABELS: ReadonlyMap<string, string> = new Map([
  ['record-created', 'register record created (publisher bookkeeping)'],
  ['record-last-modified', 'register record last modified (publisher bookkeeping)'],
  ['licence-version-last-modified', 'licence version last modified (publisher bookkeeping)'],
  ['licence-version-original-start', 'licence-version start — the earliest surviving in the asserting vintage'],
  ['licence-issued', 'licence issued'],
  ['licence-cancelled', 'licence cancelled'],
  ['reserved-until', 'reservation window — stated end'],
  ['licence-created', 'licence record created (publisher bookkeeping)'],
  ['licence-last-modified', 'licence record last modified (publisher bookkeeping)'],
  ['licence-original-start', 'licence original start — the earliest surviving in the asserting vintage'],
]);

// Short reader-facing labels for the engine's caveat vocabulary — total over
// CAVEAT_GLOSSES (drift-guard tested). The label is the inline chip; the
// engine's full gloss ships beside it in meta.caveats and renders one
// affordance away, so a caveat id never appears bare (issue #861's rendering
// rules applied to caveats as well as rules).
export const CAVEAT_LABELS: ReadonlyMap<StateCaveat, string> = new Map([
  ['earliest-surviving', 'earliest surviving date, not “the true original”'],
  ['pre-1977', 'pre-1977 start dates are attested-unreliable'],
  ['availability-trap', 'absence of evidence is non-observation'],
  ['cancellation-sparsity', 'cancellation dates are sparsely attested'],
  ['reserved-cohort-ambiguity', 'this column carries three cohort meanings'],
  ['window-restated', 'more than one stated window end'],
  ['mass-episode-window', 'inside a mass-update episode window'],
  ['month-precision-vintage', 'an asserting vintage is month-keyed'],
  ['vintages-disagree', 'the consulted vintages disagree'],
]);

export function kindLabelOf(kind: string): string {
  const label = KIND_LABELS.get(kind);
  if (label === undefined) {
    throw new Error(`kindLabelOf: event kind "${kind}" has no authored reader-facing label - label it in KIND_LABELS before the event strip can render it`);
  }
  return label;
}

export function caveatLabelOf(caveat: StateCaveat): string {
  const label = CAVEAT_LABELS.get(caveat);
  if (label === undefined) {
    throw new Error(`caveatLabelOf: caveat "${caveat}" has no authored reader-facing label - label it in CAVEAT_LABELS before the event strip can render it`);
  }
  return label;
}

// The index spaces the compact records use. Rule and caveat order is the
// engines' own gloss-listing order (Map insertion order — stable, authored).
const RULE_IDS: readonly StateRule[] = [...RULE_GLOSSES.keys()];
const CAVEAT_IDS: readonly StateCaveat[] = [...CAVEAT_GLOSSES.keys()];

// A gloss for an id known to be in the map (the id spaces above ARE the maps'
// key sets); the throw keeps the read honest without a null-forgiving assert.
function mustGloss<K>(glosses: ReadonlyMap<K, string>, id: K): string {
  const gloss = glosses.get(id);
  if (gloss === undefined || gloss.trim() === '') {
    throw new Error(`buildCallsignEventShards: no gloss for "${String(id)}" - a rule/caveat must never ship bare`);
  }
  return gloss;
}

export interface EventShardBuildSummary {
  outputDir: string;
  datasets: number;
  subjects: number;
  shards: number;
  episodes: number;
  totalBytes: number;
  metaBytes: number;
  largestShard: { name: string; bytes: number; subjects: number };
}

// One subject's compact record. Arrays throughout (see the module header for
// the schema); typed loosely because the value is a serialisation format, not
// a domain model — the domain model is the engine's StateAtT.
type EventRecord = Record<string, unknown>;

// The prefix-series introduction months (issue #921), keyed by prefix series
// ('M7' -> '2018-10'). A pure projection of reference-data/prefix-formats.csv's
// `introduced` column via the shared reference-data loader: only series that
// record an introduction month appear, and the keys are sorted so the meta
// stays byte-deterministic. This is the callsign SERIES' own start, distinct
// from any licence chain's original-start date; the dial reads it to add a
// series-introduction context marker beside the event scale.
export function seriesIntroMonths(ref: ReferenceData): Record<string, string> {
  const entries = [...ref.prefixSeries]
    .filter(([, info]) => info.introduced.trim() !== '')
    .map(([prefix, info]): [string, string] => [prefix, info.introduced])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return Object.fromEntries(entries);
}

// The shared citation for the series-introduction reference data (issue
// #954): the dial's series-opened context marker names WHEN a series opened,
// but not source of that fact; every other rail row carries its
// assertion-time provenance as an asserted-by fold, and this row should too.
// `reference-data/prefix-formats.csv` is hand-curated, in-repo reference data
// rather than a dated archived publication, so it carries no publication
// vintage (honestly null, never guessed) and no site-served href (v1 renders
// dataset names as plain text). `nrows` is the count of series rows that
// actually carry an introduction month — the same rows seriesIntroMonths
// resolves from, never a hand-typed figure.
export function seriesIntroCitation(ref: ReferenceData): { title: string; href: string; vintage: string | null; nrows: number } {
  const nrows = [...ref.prefixSeries.values()].filter(info => info.introduced.trim() !== '').length;
  return { title: 'reference-data/prefix-formats.csv', href: '', vintage: null, nrows };
}

export function buildCallsignEventShards(projection: EventTimeProjection, outputDir: string, params: EpisodeParams = DEFAULT_EPISODE_PARAMS, ref: ReferenceData = loadReferenceData()): EventShardBuildSummary {
  const { datasets, rows, daySignals, asAt } = projection;

  // The S2 mass-episode detector over the projection's own day histogram —
  // identical parameters to the committed coherency report, so an evidence
  // line is annotated here exactly where the report flags the episode.
  const episodes: Episode[] = mergeEpisodes(detectEpisodeSignals(daySignals, params), params);
  const context: StateContext = { episodes };

  const episodeIndexOf = (window: { start: string; end: string }): number => {
    const index = episodes.findIndex(e => e.start === window.start && e.end === window.end);
    if (index === -1) {
      throw new Error(`buildCallsignEventShards: evidence annotated with episode ${window.start} -> ${window.end}, which is not in the detected episode list`);
    }
    return index;
  };

  const records = new Map<string, EventRecord>();
  for (const [subject, subjectRows] of rows) {
    const answer = deriveStateAtT(subjectRows, { subject, t: asAt }, context);
    if (!answer.addressable) continue; // unreachable: every subject here has rows

    // Evidence lines and the (kind, day) -> index map findings reference into.
    const lineIndex = new Map<string, number>();
    const e = answer.evidence.map((line, index) => {
      lineIndex.set(`${line.kind}\n${line.day}`, index);
      const kindIdx = EVENT_DATE_KINDS.indexOf(line.kind);
      if (kindIdx === -1) throw new Error(`buildCallsignEventShards: evidence line carries unclassified kind "${line.kind}"`);
      const assertedBy = line.assertedBy.map(a => [datasetIndexOf(datasets, a.lane, a.dataset), a.nrows]);
      const encoded: unknown[] = [kindIdx, line.day, assertedBy];
      if (line.withinEpisode !== null) encoded.push(episodeIndexOf(line.withinEpisode));
      return encoded;
    });

    // Findings: the engine's statements verbatim (issue #861 item 4 — a
    // finding is honest only WITH its statement and caveats, so both ship and
    // the client renders them together, never a bare rule name).
    const f = answer.findings.map(finding => {
      const ruleIdx = RULE_IDS.indexOf(finding.rule);
      if (ruleIdx === -1) throw new Error(`buildCallsignEventShards: finding carries unglossed rule "${finding.rule}"`);
      if (finding.statement.trim() === '') throw new Error(`buildCallsignEventShards: rule "${finding.rule}" produced an empty statement for ${subject}`);
      const caveatIdxs = finding.caveats.map(caveat => {
        const idx = CAVEAT_IDS.indexOf(caveat);
        if (idx === -1) throw new Error(`buildCallsignEventShards: finding carries unglossed caveat "${caveat}"`);
        return idx;
      });
      const evidenceIdxs = finding.evidence.map(line => {
        const idx = lineIndex.get(`${line.kind}\n${line.day}`);
        if (idx === undefined) throw new Error(`buildCallsignEventShards: finding evidence (${line.kind}, ${line.day}) missing from the answer's evidence list for ${subject}`);
        return idx;
      });
      return [ruleIdx, finding.statement, caveatIdxs, evidenceIdxs];
    });

    const record: EventRecord = { e, f };

    if (answer.disagreements.length > 0) {
      record.g = answer.disagreements.map(d => {
        const kindIdx = EVENT_DATE_KINDS.indexOf(d.kind);
        if (kindIdx === -1) throw new Error(`buildCallsignEventShards: disagreement carries unclassified kind "${d.kind}"`);
        return [kindIdx, d.values.map(v => [v.day, v.assertedBy.map(a => datasetIndexOf(datasets, a.lane, a.dataset))])];
      });
    }

    // The multi-row version-window signal (issue #800 mechanism A): a
    // version-scoped start kind where one dataset asserts more than one dated
    // row — either several rows on one day, or the same dataset appearing on
    // more than one distinct day for the kind.
    const versionDaysByDataset = new Map<string, number>();
    let multiRowWindow = false;
    for (const line of answer.evidence) {
      if (!EARLIEST_SURVIVING_KINDS.has(line.kind)) continue;
      for (const a of line.assertedBy) {
        if (a.nrows > 1) multiRowWindow = true;
        const key = `${line.kind}\n${a.lane}\n${a.dataset}`;
        const seen = (versionDaysByDataset.get(key) ?? 0) + 1;
        versionDaysByDataset.set(key, seen);
        if (seen > 1) multiRowWindow = true;
      }
    }
    if (multiRowWindow) record.w = 1;

    records.set(subject, record);
  }

  const sortedKeys = [...records.keys()].sort();
  const shards = partitionShards(sortedKeys, EVENT_SHARD_SPLIT_THRESHOLD);

  fs.mkdirSync(outputDir, { recursive: true });
  let totalBytes = 0;
  const largestShard = { name: '', bytes: 0, subjects: 0 };
  for (const [name, keys] of shards) {
    const callsigns: Record<string, EventRecord> = {};
    for (const key of keys) {
      const record = records.get(key);
      if (record === undefined) continue; // unreachable: keys come from the record map
      callsigns[key] = record;
    }
    const json = JSON.stringify({ shard: name, callsigns });
    fs.writeFileSync(path.join(outputDir, `${name}.json`), json);
    const bytes = Buffer.byteLength(json);
    totalBytes += bytes;
    if (bytes > largestShard.bytes) {
      largestShard.name = name;
      largestShard.bytes = bytes;
      largestShard.subjects = keys.length;
    }
  }

  const meta = {
    schemaVersion: 1,
    generator: 'src/ci/build-callsign-event-shards.ts (issue #726)',
    // Every figure is derived-and-dated (issue #723): the instant the state
    // findings are computed for is the corpus's latest proven assertion day.
    asAt,
    counts: { datasets: datasets.length, subjects: records.size, shards: shards.size, unkeyableEventClaims: projection.unkeyableEventClaims },
    datasets: datasets.map(d => ({ lane: d.lane, key: d.dataset, vintage: d.vintage, title: d.title, href: d.href })),
    kinds: EVENT_DATE_KINDS.map(kind => ({ id: kind, label: kindLabelOf(kind), contribution: contributionOf(kind) })),
    rules: RULE_IDS.map(rule => ({ id: rule, gloss: mustGloss(RULE_GLOSSES, rule) })),
    caveats: CAVEAT_IDS.map(caveat => ({ id: caveat, label: caveatLabelOf(caveat), gloss: mustGloss(CAVEAT_GLOSSES, caveat) })),
    episodes: episodes.map(e => ({ start: e.start, end: e.end })),
    episodeParams: { windowDays: params.windowDays, shareThreshold: params.shareThreshold, minPopulated: params.minPopulated },
    // Prefix-series introduction months (issue #921), so the dial can name when
    // a callsign's series was opened without re-loading reference data client-
    // side. A series' own start, never a per-record licence claim.
    seriesIntro: seriesIntroMonths(ref),
    // The citation for that reference data (issue #954), so the series-opened
    // context row can carry an asserted-by fold like every other rail row.
    seriesIntroSource: seriesIntroCitation(ref),
    shards: [...shards.keys()],
  };
  const metaJson = JSON.stringify(meta);
  fs.writeFileSync(path.join(outputDir, 'meta.json'), metaJson);

  return {
    outputDir,
    datasets: datasets.length,
    subjects: records.size,
    shards: shards.size,
    episodes: episodes.length,
    totalBytes,
    metaBytes: Buffer.byteLength(metaJson),
    largestShard,
  };
}
