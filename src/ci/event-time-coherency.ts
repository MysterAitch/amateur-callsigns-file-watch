/**
 * Cross-vintage event-time coherency: the retroactive-revision detector
 * (issue #725, stage S2).
 *
 * The S1 event-time tier (src/v2/event-time-emit.ts) promotes every attested
 * record-embedded date to a derived claim — per observation, one claim per
 * dated cell, the event kind in the predicate and the ISO day in the object,
 * wearing its asserting source and vintage. This module folds the INVARIANT
 * those claims imply across vintages: multiple vintages asserting the same
 * (subject, event-kind) fact about the past should agree on the date. A later
 * vintage contradicting an earlier one about a past event is a RETROACTIVE
 * REVISION.
 *
 * Posture (issue #467, binding): the detector FLAGS, it never adjudicates.
 * Every classification below carries candidate explanations (an upstream
 * correction, an IT-migration artefact, a retention-window drop, a genuine
 * licensing event) and chooses none of them; agreement across vintages is
 * recorded as corroboration (the publisher-entities identical-copies logic
 * applied through time), never as proof — corroborated vintages may share one
 * upstream defect.
 *
 * Mass-update awareness (issue #801, binding): Ofcom has mass-updated the
 * register at several points, clustering a majority of records' bookkeeping
 * dates onto single days (the Jul–Aug 2016 migration; the 2025-10-11/-30
 * touch). Such an episode is ONE system event, not tens of thousands of
 * per-record events, so this module runs a mass-episode detector FIRST (the
 * issue's deliberately naive v1 rule: flag any short window holding more than
 * a threshold share of a dataset's dates — window and threshold are named,
 * tunable parameters) and classifies a per-record bookkeeping movement INTO a
 * detected episode window as EPISODE-MEMBER rather than as an individual
 * finding. That is how ~87k records touched in one episode stay one finding,
 * not ~87k. The recorded 2024 rolling reprocessing (docs/source-register.md
 * episode survey on issue #725) spreads over ~14 weeks with no single-day
 * spike, so it is invisible at the default window by design — the "window is
 * a parameter to tune" note on the issue, kept honest here rather than
 * stretched to fit.
 *
 * The classification vocabulary (authored, closed — see
 * CLASSIFICATION_GLOSSES for the reader-facing glosses):
 *
 *  - corroborated         — this vintage repeats the previous vintage's date.
 *  - expected-progression — a bookkeeping date moved FORWARD outside any
 *                           detected episode: the column doing its stated job
 *                           (a later touch overwrote the earlier date), not a
 *                           revision of a past fact.
 *  - episode-member       — a bookkeeping date moved forward INTO a detected
 *                           mass-episode window: evidence of the episode, not
 *                           an individual per-record event.
 *  - revised-forward      — a past-event date moved forward: the later
 *                           vintage contradicts the earlier one (issue #800's
 *                           established direction of event-time creep).
 *  - revised-backward     — a date moved backward: the later vintage asserts
 *                           an EARLIER date than its predecessor. Issue #800
 *                           found creep forward-only, so anything here is a
 *                           new observation in its own right.
 *  - window-restated      — a forward-looking date (a reservation window's
 *                           stated end) changed: renewal and termination
 *                           bookkeeping are routine for this kind, so a change
 *                           is recorded but is not a revision of a past event.
 *  - same-vintage-divergence — two datasets sharing one vintage assert
 *                           DIFFERENT dates for the same fact: a divergence
 *                           within a vintage with no direction in time, kept
 *                           distinct rather than forced into an arbitrary
 *                           revised-forward/revised-backward ordering (issue
 *                           #859 — the alphabetical dataset tiebreak would
 *                           otherwise flip the direction of the same disagreement).
 *
 * Revision mechanism (issue #800's two mechanisms, distinguishable exactly
 * when the earlier vintage's row multiplicity distinguishes them — a CANDIDATE
 * mechanism, never a verdict):
 *
 *  - version-window-drop      — the earlier vintage held MULTIPLE dated rows
 *                               for the subject, so a rolling retention window
 *                               dropping the older rows can explain the
 *                               movement (issue #800's G3ATI shape).
 *  - version-window-extension — the mirror of the drop, seen on backward
 *                               movement: the later vintage carries an OLDER
 *                               dated row the earlier export did not, while
 *                               the earlier assertion survives among its rows
 *                               — a wider retention window, not a
 *                               replacement.
 *  - rendering-difference     — the two observations' columns attest
 *                               DIFFERENT date renderings (day-first CSV vs
 *                               ISO workbook extract) AND the movement is
 *                               exactly one day — the only shift a
 *                               day-truncation collision can produce (a
 *                               UTC-rendered 23:00 timestamp truncates to the
 *                               previous day against a local date-only
 *                               rendering). Preferred over
 *                               sole-row-replacement wherever it applies; a
 *                               movement larger than a day cannot be the
 *                               collision, so it keeps its multiplicity-based
 *                               candidate (labelling a 49-year reissue jump
 *                               "rendering" would itself be the misleading
 *                               processing this module polices).
 *  - sole-row-replacement     — the earlier vintage held a single dated row
 *                               whose value was replaced wholesale (issue
 *                               #800's G3SDS shape: a reissue/variation
 *                               rewriting the date). Never applied to a
 *                               one-day movement across a rendering boundary.
 *
 * Comparison semantics: subjects join across vintages on the cleaned callsign
 * key (a JOIN KEY, not an identity — the same rule every cross-publication
 * fold uses); rows whose subject cleans to nothing cannot be tracked across
 * vintages and are excluded here (they remain in the ledger). Per (subject,
 * kind, dataset) the tracked statistic is authored per kind's temporality:
 * past-event kinds compare the EARLIEST surviving date (issue #800's "earliest
 * surviving in this vintage" semantics), bookkeeping and forward-looking kinds
 * compare the LATEST. Consecutive means consecutive OBSERVATIONS of that
 * (subject, kind) — a vintage that does not carry the subject or the kind is a
 * non-observation and is skipped, never read as "nothing happened".
 *
 * FOLD, not re-parse (issue #361): everything here is DuckDB SQL over the
 * claim ledger (the shared deploy-time claims.parquet where present, else the
 * per-source JSONL), restricted to the S1 tier's named rule. Committed as
 * reports/event-time-coherency.md, byte-deterministic (every query carries a
 * total ORDER BY), so a new vintage shifting the coherency picture shows up as
 * a PR diff. Reader-facing SURFACES are issue #726, deliberately not built
 * here; this report is the drift signal and the working record.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  foldQuery,
  claimsRelation,
  claimsSourcePresent,
  toClaimsSource,
  deployClaimsSource,
  cleanedKeyExpr,
  type ClaimsSource,
} from '../v2/report-fold.ts';
import {
  EVENT_DATE_RULE,
  EVENT_DATE_PREDICATE_PREFIX,
  EVENT_DATE_KINDS,
  eventKindForFoiDateColumn,
} from '../v2/claim.ts';
import { buildLedger } from '../v2/build-ledger.ts';
import { registerSourcesFor } from '../v2/collectors/foi-register.ts';
import { listFoiEntryKeys, readFoiEntryMeta, defaultFoiDir } from '../shared/foi-archive.ts';
import { listArchiveKeys } from '../shared/archive.ts';
import { openDataDateFormat } from '../sources/ofcom-amateur/normalise.ts';
import { DIRS } from '../shared/constants.ts';
import { parseJsonObject } from '../shared/json-shape.ts';
import { time, perfReport } from '../shared/perf.ts';

// --- Tunable parameters (issue #725: "the threshold and window are
// parameters to tune against the data") ------------------------------------

export interface EpisodeParams {
  // The sliding window width, in days (inclusive of both ends), a cluster
  // must fit inside. 21 days spans both empirically recorded single-spike
  // episodes (2016-07-23..2016-08-12 and 2025-10-11..2025-10-30 are each 20
  // or 21 days end to end); the months-long 2024 rolling reprocessing needs a
  // window sized in months and is deliberately out of this default's reach.
  windowDays: number;
  // The share of a dataset's populated dates (for one kind) a window must
  // exceed to be flagged — the issue's naive v1 rule: strictly more than 50%.
  shareThreshold: number;
  // Days at a flagged window's edges holding less than this share are trimmed
  // from the reported span, so an episode's dates are the cluster's own days,
  // not whatever routine activity happened to sit inside the window.
  edgeTrimShare: number;
  // Days inside a flagged window holding at least this share are reported as
  // the episode's peak days (the single-day spikes a histogram would show).
  peakDayShare: number;
  // A dataset must hold at least this many populated dates for a kind before
  // its clusters count as episode evidence: a mass-update episode is a
  // REGISTER-WIDE phenomenon, and in a sparse column (a 93-row reservation
  // window, a 1,074-row partial publication) a "majority" is a handful of
  // rows, not evidence of a mass touch. The full day histogram stays
  // re-derivable regardless — this bounds only what is FLAGGED.
  minPopulated: number;
  // A ceiling on how wide a merged corpus-level episode may grow, as a
  // multiple of windowDays: mergeEpisodes unions overlapping per-dataset
  // windows into one episode, but staggered windows (each ≤ windowDays wide,
  // each overlapping the next by a day) could chain transitively into a span
  // covering two genuinely distinct clusters weeks apart. Witnesses of ONE
  // mass touch cluster on the same days (the two recorded episodes each span
  // ~20 days, inside a single windowDays), so a merge whose span would exceed
  // this multiple of windowDays is refused and the far signal opens a new
  // episode instead. Years-apart episodes never approach this bound; it only
  // bites a staggered chain that would otherwise fuse distinct clusters.
  mergeSpanCapMultiple: number;
}

export const DEFAULT_EPISODE_PARAMS: EpisodeParams = {
  windowDays: 21,
  shareThreshold: 0.5,
  edgeTrimShare: 0.01,
  peakDayShare: 0.05,
  minPopulated: 1000,
  mergeSpanCapMultiple: 2,
};

// A pair summary row must reach this many subjects to appear in the report's
// notable-pairs table (the full distribution is always re-derivable from the
// fold; the committed table shows the pairs a reader would call marked).
export const NOTABLE_PAIR_MIN = 100;

// Per (kind, classification) cap on the individual exemplar rows committed in
// the report — the report shows the working's shape; the fold (and
// subjectKindSequence below) always yields the full detail for any subject.
export const EXEMPLAR_LIMIT = 10;

// --- Authored kind temporality --------------------------------------------
//
// Which statistic a kind is compared on, and what a movement of that statistic
// means. Total over the S1 tier's authored kinds — temporalityOf throws on an
// unclassified kind, so adding an S1 kind forces an authored decision here
// (the same drift-guard shape as EVENT_KIND_BY_DATE_OUTPUT).
//
//  - past-event:      the column states when something HAPPENED. Compared on
//                     the earliest surviving date (issue #800 semantics);
//                     any cross-vintage movement is a retroactive revision.
//  - bookkeeping:     the column states when the export's record was last
//                     touched. Forward movement is the column's job;
//                     clustered forward movement is a mass episode; backward
//                     movement is a revision.
//  - forward-looking: the column states when a window is due to END. Renewal
//                     is routine, so changes are recorded as restatements,
//                     never as revisions of a past event.
export type KindTemporality = 'past-event' | 'bookkeeping' | 'forward-looking';

const KIND_TEMPORALITY: ReadonlyMap<string, KindTemporality> = new Map([
  ['record-created', 'past-event'],
  ['record-last-modified', 'bookkeeping'],
  ['licence-version-last-modified', 'bookkeeping'],
  ['licence-version-original-start', 'past-event'],
  ['licence-issued', 'past-event'],
  ['licence-cancelled', 'past-event'],
  ['reserved-until', 'forward-looking'],
  // The LICENCE-scoped kinds (issue #725 S2): distinct kinds precisely so the
  // detector never compares a licence-lifecycle date against a
  // register-record date as if they were one fact.
  ['licence-created', 'past-event'],
  ['licence-last-modified', 'bookkeeping'],
  ['licence-original-start', 'past-event'],
]);

export function temporalityOf(kind: string): KindTemporality {
  const temporality = KIND_TEMPORALITY.get(kind);
  if (temporality === undefined) {
    throw new Error(`temporalityOf: event kind "${kind}" has no authored temporality - classify it in KIND_TEMPORALITY before the coherency fold can compare it across vintages`);
  }
  return temporality;
}

function kindsWith(temporality: KindTemporality): string[] {
  return EVENT_DATE_KINDS.filter(kind => temporalityOf(kind) === temporality);
}

// --- Classification vocabulary --------------------------------------------

export type RevisionClassification =
  | 'corroborated'
  | 'expected-progression'
  | 'episode-member'
  | 'revised-forward'
  | 'revised-backward'
  | 'window-restated'
  | 'same-vintage-divergence';

export type RevisionMechanism = 'version-window-drop' | 'version-window-extension' | 'rendering-difference' | 'sole-row-replacement';

// Reader-facing glosses, rendered beside every use in the committed report so
// the vocabulary never appears bare. Candidate explanations, no verdicts.
export const CLASSIFICATION_GLOSSES: ReadonlyMap<RevisionClassification, string> = new Map([
  ['corroborated', 'this vintage repeats the previous vintage’s date — corroboration, not proof (vintages can share one upstream defect)'],
  ['expected-progression', 'a bookkeeping date moved forward outside any detected episode — the column doing its stated job, not a revision'],
  ['episode-member', 'a bookkeeping date moved forward into a detected mass-update episode — evidence of one system episode, not an individual per-record event'],
  ['revised-forward', 'a later vintage asserts a LATER date for a past event than an earlier vintage did — a retroactive revision; candidate explanations include a retention-window drop, a reissue/variation, an upstream correction, or an export artefact'],
  ['revised-backward', 'a later vintage asserts an EARLIER date than an earlier vintage did — issue #800 found event-time creep forward-only, so this direction is a finding in its own right; candidate explanations include a republished stale extract or an upstream correction'],
  ['window-restated', 'a forward-looking window end changed — renewal/termination bookkeeping is routine for this kind, recorded but not read as a revision of a past event'],
  ['same-vintage-divergence', 'two datasets sharing ONE vintage assert different dates for the same (subject, event-kind) fact — a divergence WITHIN a vintage, not a revision across vintages. With no time between the two observations the disagreement has no direction, so it is kept distinct rather than forced into an arbitrary revised-forward/revised-backward ordering (which the alphabetical dataset tiebreak would decide either way); candidate explanations include one copy transcribing or re-rendering the other, a mid-vintage upstream correction, or two genuinely independent sources — adjudicated as none'],
]);

export const MECHANISM_GLOSSES: ReadonlyMap<RevisionMechanism, string> = new Map([
  ['version-window-drop', 'the earlier vintage held multiple dated rows for this subject, so a rolling retention window dropping the older rows can explain the movement (issue #800 mechanism A) — candidate, not adjudicated'],
  ['version-window-extension', 'the later vintage carries an older dated row the earlier export did not, while the earlier assertion survives among its rows — a wider retention window rather than a replacement; candidate, not adjudicated'],
  ['rendering-difference', 'the two observations\' columns attest DIFFERENT date renderings (day-first CSV vs ISO workbook extract) and the movement is EXACTLY one day — the only shift a day-truncation collision can produce (a 23:00Z timestamp truncates to the previous day against a BST date-only rendering), so the movement may be a rendering artefact rather than any event. Preferred over sole-row-replacement wherever it applies; a movement larger than a day cannot be produced by the collision and keeps its multiplicity-based candidate. Candidate, not adjudicated'],
  ['sole-row-replacement', 'the earlier vintage held a single dated row whose value was replaced wholesale (issue #800 mechanism B, the reissue shape) — candidate, not adjudicated. Never applied to a one-day movement across differing attested renderings: rendering-difference is preferred there'],
]);

// --- Mass-episode detection (pure, unit-testable) --------------------------

// One (dataset, kind, day) frequency — the fold's day histogram row.
export interface DaySignal {
  lane: string;
  dataset: string;
  vintage: string;
  kind: string;
  day: string;
  n: number;
}

// One dataset+kind's flagged cluster: the trimmed window, its share of that
// dataset's populated dates for the kind, and the peak days inside it.
export interface EpisodeSignal {
  lane: string;
  dataset: string;
  vintage: string;
  kind: string;
  windowStart: string;
  windowEnd: string;
  rows: number;
  populated: number;
  share: number;
  peakDays: { day: string; share: number }[];
}

// A corpus-level episode: overlapping per-dataset signals merged into one
// dated window, so the same underlying system event asserted by several
// vintages (and several bookkeeping columns) reads as ONE episode.
export interface Episode {
  start: string;
  end: string;
  signals: EpisodeSignal[];
}

// Days since the epoch for an ISO day — the window arithmetic's unit.
function dayNumber(isoDay: string): number {
  const [y, m, d] = isoDay.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

interface DayCount { day: string; num: number; n: number }

// Detect flagged windows in ONE dataset+kind's day histogram. Iterative
// best-window-first: find the window (at most windowDays wide) holding the
// largest share; if it exceeds the threshold, record it (edges trimmed of
// sub-noise-floor days), remove its days, and look again — so two genuinely
// separate clusters under a tuned-down threshold each surface, while the
// default >50% threshold can only ever yield one.
function detectInGroup(group: readonly DaySignal[], params: EpisodeParams): EpisodeSignal[] {
  const populated = group.reduce((sum, r) => sum + r.n, 0);
  if (populated < Math.max(params.minPopulated, 1)) return [];
  let days: DayCount[] = group
    .map(r => ({ day: r.day, num: dayNumber(r.day), n: r.n }))
    .sort((a, b) => a.num - b.num);
  const signals: EpisodeSignal[] = [];
  for (;;) {
    // Two-pointer maximal-sum window over the (sorted, distinct) days.
    let best = { sum: 0, from: 0, to: -1 };
    let from = 0;
    let running = 0;
    for (let to = 0; to < days.length; to++) {
      running += days[to].n;
      while (days[to].num - days[from].num >= params.windowDays) {
        running -= days[from].n;
        from++;
      }
      if (running > best.sum) best = { sum: running, from, to };
    }
    if (best.sum / populated <= params.shareThreshold) break;
    // Trim edge days below the noise floor, so the reported span is the
    // cluster's own days. The threshold decision above was taken on the whole
    // window; the reported rows/share are the trimmed cluster's.
    let lo = best.from;
    let hi = best.to;
    while (lo < hi && days[lo].n / populated < params.edgeTrimShare) lo++;
    while (hi > lo && days[hi].n / populated < params.edgeTrimShare) hi--;
    const window = days.slice(lo, hi + 1);
    const rows = window.reduce((sum, d) => sum + d.n, 0);
    const sample = group[0];
    signals.push({
      lane: sample.lane,
      dataset: sample.dataset,
      vintage: sample.vintage,
      kind: sample.kind,
      windowStart: window[0].day,
      windowEnd: window[window.length - 1].day,
      rows,
      populated,
      share: rows / populated,
      peakDays: window
        .filter(d => d.n / populated >= params.peakDayShare)
        .map(d => ({ day: d.day, share: d.n / populated })),
    });
    days = [...days.slice(0, best.from), ...days.slice(best.to + 1)];
  }
  // Deterministic order: by window start, then end.
  return signals.sort((a, b) => a.windowStart.localeCompare(b.windowStart) || a.windowEnd.localeCompare(b.windowEnd));
}

// Detect every dataset+kind's flagged windows from the corpus day histogram.
export function detectEpisodeSignals(days: readonly DaySignal[], params: EpisodeParams = DEFAULT_EPISODE_PARAMS): EpisodeSignal[] {
  const groups = new Map<string, DaySignal[]>();
  for (const row of days) {
    // lane/dataset/kind never contain "\n" (dataset keys and authored kinds),
    // so the composite key is collision-free.
    const key = `${row.lane}\n${row.dataset}\n${row.kind}`;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [row]);
    else group.push(row);
  }
  const signals: EpisodeSignal[] = [];
  for (const key of [...groups.keys()].sort()) {
    signals.push(...detectInGroup(groups.get(key) ?? [], params));
  }
  return signals;
}

// Merge per-dataset signals whose date windows overlap into corpus-level
// episodes: several vintages (and several bookkeeping columns) each showing
// the same clustered window are treated as witnesses of ONE episode. A merge
// is refused — the overlapping signal opens a new episode — when it would
// stretch the episode's span past mergeSpanCapMultiple × windowDays, so a
// staggered chain of overlapping windows can never fuse two genuinely distinct
// clusters weeks apart into one episode (issue #859). params is required so a
// caller can never silently merge under a different window than it detected on.
export function mergeEpisodes(signals: readonly EpisodeSignal[], params: EpisodeParams): Episode[] {
  const capDays = Math.max(params.windowDays, 1) * Math.max(params.mergeSpanCapMultiple, 1);
  const sorted = [...signals].sort((a, b) => a.windowStart.localeCompare(b.windowStart) || a.windowEnd.localeCompare(b.windowEnd));
  const episodes: Episode[] = [];
  for (const signal of sorted) {
    const current = episodes[episodes.length - 1];
    const mergedEnd = current !== undefined && signal.windowEnd > current.end ? signal.windowEnd : current?.end;
    const withinCap = current !== undefined && mergedEnd !== undefined
      && dayNumber(mergedEnd) - dayNumber(current.start) <= capDays;
    if (current !== undefined && signal.windowStart <= current.end && withinCap) {
      current.signals.push(signal);
      if (signal.windowEnd > current.end) current.end = signal.windowEnd;
    } else {
      episodes.push({ start: signal.windowStart, end: signal.windowEnd, signals: [signal] });
    }
  }
  for (const episode of episodes) {
    episode.signals.sort((a, b) =>
      a.kind.localeCompare(b.kind) || a.lane.localeCompare(b.lane) || a.dataset.localeCompare(b.dataset) || a.windowStart.localeCompare(b.windowStart));
  }
  return episodes;
}

// --- Attested date grammars -------------------------------------------------
//
// The rendering each (dataset, kind)'s date column is ATTESTED under — the
// same authored facts the @interpretation tier states (the FOI conversion
// specs' date kinds; the open-data variant registry's date format), lifted
// from those registries directly (the ledger stores no interpretation claims,
// so the fold reads the registries the interpretation itself is derived
// from). Feeds the rendering-difference candidate mechanism: two vintages
// whose columns attest DIFFERENT renderings (day-first CSV vs ISO workbook
// extract) can disagree by a day without any event having happened — the
// UTC-vs-local day-truncation collision — so a movement across a rendering
// boundary must never fall through to sole-row-replacement.

export interface AttestedGrammarRow {
  lane: string;
  // The dataset key ('*' for the whole-lane open-data rows, where a variant
  // attests one grammar for every date column the dataset carries).
  dataset: string;
  kind: string;
  grammar: string;
}

// A dataset+kind binding two columns under conflicting grammars is recorded
// as 'mixed': it compares as differing against any single grammar (at least
// one of its columns differs) and as unknown against another 'mixed'.
const MIXED_GRAMMAR = 'mixed';

export function attestedDateGrammars(foiDir: string = defaultFoiDir()): AttestedGrammarRow[] {
  const byKey = new Map<string, AttestedGrammarRow>();
  const add = (lane: string, dataset: string, kind: string, grammar: string): void => {
    const key = `${lane}\n${dataset}\n${kind}`;
    const existing = byKey.get(key);
    if (existing === undefined) byKey.set(key, { lane, dataset, kind, grammar });
    else if (existing.grammar !== grammar) existing.grammar = MIXED_GRAMMAR;
  };
  // FOI lane: per entry, the register conversions' date columns — kind 'date'
  // is the day-first CSV rendering, 'iso-date' the workbook-extract ISO
  // rendering (interpretationForFoiKind's exact mapping).
  for (const entry of listFoiEntryKeys(foiDir)) {
    const meta = readFoiEntryMeta(foiDir, entry);
    for (const source of registerSourcesFor(meta)) {
      for (const column of source.conversion.columns) {
        if ((column.kind !== 'date' && column.kind !== 'iso-date') || column.source === null) continue;
        const kind = eventKindForFoiDateColumn(column);
        if (kind === null) continue;
        add('foi', entry, kind, column.kind === 'date' ? 'DD/MM/YYYY' : 'YYYY-MM-DD');
      }
    }
  }
  // Open-data lane: the variant attests ONE grammar for every date column the
  // dataset carries, so a single '*' row covers all its kinds. The variant is
  // the declared converter variant where the meta pins one, else the detected
  // header variant the normalisation recorded (the same fallback
  // build-data-status.ts reads) — the v2026 family genuinely mixes renderings
  // across vintages (…-padded and the bare variant are day-first, …-iso is
  // the workbook ISO rendering), so this must read the per-entry fact.
  for (const key of listArchiveKeys()) {
    const metaPath = path.join(DIRS.archive, key, 'meta.json');
    if (!fs.existsSync(metaPath)) continue;
    const meta = parseJsonObject(fs.readFileSync(metaPath, 'utf8'), metaPath) as { converter?: { variant?: string }; normalised?: { headerVariant?: string } };
    add('opendata', key, '*', openDataDateFormat(meta.converter?.variant ?? meta.normalised?.headerVariant));
  }
  return [...byKey.values()].sort((a, b) =>
    a.lane.localeCompare(b.lane) || a.dataset.localeCompare(b.dataset) || a.kind.localeCompare(b.kind));
}

// --- The SQL folds ----------------------------------------------------------

function sqlList(values: readonly string[]): string {
  return values.map(v => `'${v.replace(/'/g, "''")}'`).join(', ');
}

function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

// The event-claim relation every query below folds: one row per S1 event
// claim, the kind lifted out of the predicate, the dataset key out of the
// sourceFile's lane-rooted path, the subject cleaned to the cross-publication
// join key. Unkeyable subjects (cleaning to nothing) cannot be tracked across
// vintages and are excluded from THIS fold only — they stay in the ledger.
function eventsCte(source: ClaimsSource): string {
  return `events AS (
  SELECT ${cleanedKeyExpr('rawSubject')} AS subject,
         substr(predicate, ${EVENT_DATE_PREDICATE_PREFIX.length + 1}) AS kind,
         split_part(sourceFile, '/', 1) AS lane,
         split_part(sourceFile, '/', 2) AS dataset,
         vintage,
         object AS "day"
  FROM ${claimsRelation(source)}
  WHERE rule = '${EVENT_DATE_RULE}'
    AND predicate LIKE '${EVENT_DATE_PREDICATE_PREFIX}%'
    AND ${cleanedKeyExpr('rawSubject')} <> ''
)`;
}

// Per (subject, kind, dataset): the earliest/latest asserted day, the row
// multiplicity (the mechanism discriminator), and the kind's tracked
// statistic. min(vintage) is a determinism guard only — a dataset's files all
// carry one vintage.
function aggCte(): string {
  return `agg AS (
  SELECT subject, kind, lane, dataset, min(vintage) AS vintage,
         min("day") AS earliest, max("day") AS latest, count(*) AS nrows,
         CASE WHEN kind IN (${sqlList(kindsWith('past-event'))}) THEN min("day") ELSE max("day") END AS stat
  FROM events
  GROUP BY subject, kind, lane, dataset
)`;
}

// TRUE when a compared statistic lands inside a detected episode's window.
function episodeMembershipExpr(column: string, episodes: readonly Episode[]): string {
  if (episodes.length === 0) return 'FALSE';
  return episodes.map(e => `(${column} >= '${e.start}' AND ${column} <= '${e.end}')`).join(' OR ');
}

// The consecutive-observation classification: per (subject, kind), each
// observation against the previous one in vintage order. The full vocabulary
// rationale is the module doc-comment; 'first-observation' marks a subject's
// first appearance for the kind (nothing to compare) and is excluded from
// every report surface. A step whose two sides share one vintage (two datasets
// of the same vintage disagreeing) has no direction in time, so it classifies
// as 'same-vintage-divergence' ahead of any forward/backward branch (issue
// #859) — the alphabetical dataset tiebreak in the window order must never
// decide a revised-forward-vs-revised-backward verdict. Each observation
// carries its dataset+kind's attested date grammar (the '*' rows cover a whole
// open-data dataset), so a step whose two sides attest DIFFERENT renderings
// prefers the rendering-difference candidate over sole-row-replacement.
function classifiedSql(source: ClaimsSource, episodes: readonly Episode[], grammars: readonly AttestedGrammarRow[]): string {
  const bookkeeping = sqlList(kindsWith('bookkeeping'));
  const forwardLooking = sqlList(kindsWith('forward-looking'));
  const grammarValues = grammars.length === 0
    ? `SELECT NULL::VARCHAR AS lane, NULL::VARCHAR AS dataset, NULL::VARCHAR AS kind, NULL::VARCHAR AS grammar WHERE FALSE`
    : `SELECT * FROM (VALUES ${grammars.map(g => `(${sqlLiteral(g.lane)}, ${sqlLiteral(g.dataset)}, ${sqlLiteral(g.kind)}, ${sqlLiteral(g.grammar)})`).join(', ')}) AS g(lane, dataset, kind, grammar)`;
  return `WITH ${eventsCte(source)},
${aggCte()},
grammars AS (
  ${grammarValues}
),
agg_g AS (
  SELECT agg.*, g.grammar
  FROM agg
  LEFT JOIN grammars g
    ON g.lane = agg.lane AND g.dataset = agg.dataset AND (g.kind = agg.kind OR g.kind = '*')
),
seq AS (
  SELECT subject, kind, lane, dataset, vintage, earliest, latest, nrows, stat, grammar,
         lag(lane) OVER w AS prevLane,
         lag(dataset) OVER w AS prevDataset,
         lag(vintage) OVER w AS prevVintage,
         lag(nrows) OVER w AS prevRows,
         lag(stat) OVER w AS prevStat,
         lag(grammar) OVER w AS prevGrammar
  FROM agg_g
  WINDOW w AS (PARTITION BY subject, kind ORDER BY vintage, dataset)
),
classified AS (
  SELECT *,
    CASE
      WHEN prevStat IS NULL THEN 'first-observation'
      WHEN stat = prevStat THEN 'corroborated'
      WHEN vintage = prevVintage THEN 'same-vintage-divergence'
      WHEN kind IN (${forwardLooking}) THEN 'window-restated'
      WHEN kind IN (${bookkeeping}) AND stat > prevStat AND (${episodeMembershipExpr('stat', episodes)}) THEN 'episode-member'
      WHEN kind IN (${bookkeeping}) AND stat > prevStat THEN 'expected-progression'
      WHEN stat > prevStat THEN 'revised-forward'
      ELSE 'revised-backward'
    END AS classification,
    CASE
      WHEN prevStat IS NULL OR stat = prevStat THEN NULL
      WHEN vintage = prevVintage THEN NULL
      WHEN kind IN (${forwardLooking}) THEN NULL
      WHEN kind IN (${bookkeeping}) AND stat > prevStat THEN NULL
      WHEN stat < prevStat AND nrows > 1 AND prevStat <= latest THEN 'version-window-extension'
      WHEN prevRows > 1 THEN 'version-window-drop'
      WHEN grammar IS NOT NULL AND prevGrammar IS NOT NULL AND grammar <> prevGrammar
           AND abs(date_diff('day', CAST(prevStat AS DATE), CAST(stat AS DATE))) = 1 THEN 'rendering-difference'
      ELSE 'sole-row-replacement'
    END AS mechanism
  FROM seq
)`;
}

export interface PairSummaryRow {
  kind: string;
  prevLane: string;
  prevDataset: string;
  prevVintage: string;
  lane: string;
  dataset: string;
  vintage: string;
  classification: RevisionClassification;
  mechanism: RevisionMechanism | null;
  subjects: number;
}

export interface ExemplarRow {
  kind: string;
  subject: string;
  classification: RevisionClassification;
  mechanism: RevisionMechanism | null;
  prevDataset: string;
  prevVintage: string;
  prevStat: string;
  prevRows: number;
  dataset: string;
  vintage: string;
  stat: string;
  nrows: number;
}

export interface CorroborationRow {
  kind: string;
  // How many datasets asserted the (subject, kind) fact.
  depth: number;
  // Subjects whose every assertion at this depth carries the same statistic.
  agreeing: number;
  // Subjects asserted at this depth with more than one distinct statistic.
  diverging: number;
}

// One dataset's aggregate for one subject+kind, with its classification
// against the previous observation — the per-subject working behind every
// figure in the report, re-derivable for any subject (the "show the working"
// affordance tests and readers use).
export interface SubjectSequenceRow {
  kind: string;
  lane: string;
  dataset: string;
  vintage: string;
  earliest: string;
  latest: string;
  nrows: number;
  stat: string;
  prevDataset: string | null;
  prevStat: string | null;
  prevRows: number | null;
  classification: RevisionClassification | 'first-observation';
  mechanism: RevisionMechanism | null;
}

// Every fold below guards on claimsSourcePresent (the report-fold convention):
// an absent or empty claims source yields the empty result rather than
// reaching DuckDB, whose read_json errors on a glob matching nothing — the
// report-sweep fixture context (a synthetic archive materialising no ledger
// sources) folds to the honest empty report, exactly like the other
// fold-backed reports.
export function foldDaySignals(source: string | ClaimsSource): DaySignal[] {
  const claims = toClaimsSource(source);
  if (!claimsSourcePresent(claims)) return [];
  return foldQuery<DaySignal>(`WITH ${eventsCte(claims)}
SELECT kind, lane, dataset, min(vintage) AS vintage, "day", count(*)::BIGINT AS n
FROM events
GROUP BY kind, lane, dataset, "day"
ORDER BY kind, lane, dataset, "day"`);
}

export function foldPairSummary(source: string | ClaimsSource, episodes: readonly Episode[], grammars: readonly AttestedGrammarRow[] = attestedDateGrammars()): PairSummaryRow[] {
  const claims = toClaimsSource(source);
  if (!claimsSourcePresent(claims)) return [];
  return foldQuery<PairSummaryRow>(`${classifiedSql(claims, episodes, grammars)}
SELECT kind, prevLane, prevDataset, prevVintage, lane, dataset, vintage, classification, mechanism, count(*)::BIGINT AS subjects
FROM classified
WHERE classification <> 'first-observation'
GROUP BY ALL
ORDER BY kind, vintage, lane, dataset, prevVintage, prevLane, prevDataset, classification, mechanism NULLS FIRST`);
}

export function foldExemplars(source: string | ClaimsSource, episodes: readonly Episode[], grammars: readonly AttestedGrammarRow[] = attestedDateGrammars(), limit: number = EXEMPLAR_LIMIT): ExemplarRow[] {
  const claims = toClaimsSource(source);
  if (!claimsSourcePresent(claims)) return [];
  return foldQuery<ExemplarRow>(`${classifiedSql(claims, episodes, grammars)}
SELECT kind, subject, classification, mechanism, prevDataset, prevVintage, prevStat, prevRows, dataset, vintage, stat, nrows
FROM classified
WHERE classification IN ('revised-forward', 'revised-backward')
QUALIFY row_number() OVER (PARTITION BY kind, classification ORDER BY subject, vintage, lane, dataset) <= ${limit}
ORDER BY kind, classification, subject, vintage, lane, dataset`);
}

export function foldCorroboration(source: string | ClaimsSource): CorroborationRow[] {
  const claims = toClaimsSource(source);
  if (!claimsSourcePresent(claims)) return [];
  return foldQuery<CorroborationRow>(`WITH ${eventsCte(claims)},
${aggCte()}
SELECT kind, depth,
       count(*) FILTER (WHERE variants = 1)::BIGINT AS agreeing,
       count(*) FILTER (WHERE variants > 1)::BIGINT AS diverging
FROM (
  SELECT subject, kind, count(*) AS depth, count(DISTINCT stat) AS variants
  FROM agg
  GROUP BY subject, kind
)
WHERE depth >= 2
GROUP BY kind, depth
ORDER BY kind, depth`);
}

// The full per-dataset sequence (with classifications) for ONE cleaned
// subject — the re-runnable working behind any per-record figure.
export function subjectKindSequence(source: string | ClaimsSource, subject: string, episodes: readonly Episode[], grammars: readonly AttestedGrammarRow[] = attestedDateGrammars()): SubjectSequenceRow[] {
  const claims = toClaimsSource(source);
  if (!claimsSourcePresent(claims)) return [];
  return foldQuery<SubjectSequenceRow>(`${classifiedSql(claims, episodes, grammars)}
SELECT kind, lane, dataset, vintage, earliest, latest, nrows, stat, prevDataset, prevStat, prevRows, classification, mechanism
FROM classified
WHERE subject = ${sqlLiteral(subject)}
ORDER BY kind, vintage, lane, dataset`);
}

// --- The assembled coherency picture ---------------------------------------

export interface ClassificationTotal {
  kind: string;
  classification: RevisionClassification;
  subjects: number;
}

export interface EventTimeCoherency {
  params: EpisodeParams;
  episodes: Episode[];
  totals: ClassificationTotal[];
  pairs: PairSummaryRow[];
  exemplars: ExemplarRow[];
  corroboration: CorroborationRow[];
}

// Fold the whole coherency picture from a claims source: episodes first (the
// classification consults their windows), then the pairwise classification,
// exemplars and corroboration.
export function computeEventTimeCoherency(source: string | ClaimsSource, params: EpisodeParams = DEFAULT_EPISODE_PARAMS, grammars: readonly AttestedGrammarRow[] = attestedDateGrammars()): EventTimeCoherency {
  const claims = toClaimsSource(source);
  const days = time('coherency:day-signals', () => foldDaySignals(claims));
  const episodes = mergeEpisodes(detectEpisodeSignals(days, params), params);
  const pairs = time('coherency:pair-summary', () => foldPairSummary(claims, episodes, grammars));
  const exemplars = time('coherency:exemplars', () => foldExemplars(claims, episodes, grammars));
  const corroboration = time('coherency:corroboration', () => foldCorroboration(claims));

  const totalByKey = new Map<string, ClassificationTotal>();
  for (const pair of pairs) {
    const key = `${pair.kind}\n${pair.classification}`;
    const total = totalByKey.get(key);
    if (total === undefined) totalByKey.set(key, { kind: pair.kind, classification: pair.classification, subjects: pair.subjects });
    else total.subjects += pair.subjects;
  }
  const totals = [...totalByKey.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.classification.localeCompare(b.classification));

  return { params, episodes, totals, pairs, exemplars, corroboration };
}

// Like the other ledger folds (buildLicenceCategoryFold's convention): an
// explicit ledger directory folds directly (tests, fixtures); otherwise the
// shared deploy-time claims.parquet where the workflow built one; otherwise
// materialise the full-corpus ledger to a temp directory on demand. Exposed
// as an acquire/dispose pair (rather than baked into the build function) so
// the corpus tests can hold ONE source across the whole-picture fold and the
// per-subject sequence queries without re-materialising anything.
export interface ClaimsSourceHandle {
  source: ClaimsSource;
  dispose: () => void;
}

export function acquireClaimsSource(ledgerDir?: string): ClaimsSourceHandle {
  if (ledgerDir !== undefined) return { source: { kind: 'ledger', dir: ledgerDir }, dispose: () => undefined };
  const shared = deployClaimsSource();
  if (shared !== null) return { source: shared, dispose: () => undefined };
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'event-time-coherency-ledger-'));
  // skipFailedSources mirrors the report lane's posture: an unparseable
  // entry is skipped (the sweep already reports it), never a crash.
  buildLedger(scratch, undefined, undefined, undefined, true);
  return {
    source: { kind: 'ledger', dir: path.join(scratch, 'ledger') },
    dispose: () => fs.rmSync(scratch, { recursive: true, force: true }),
  };
}

export function buildEventTimeCoherency(ledgerDir?: string, params: EpisodeParams = DEFAULT_EPISODE_PARAMS): EventTimeCoherency {
  const { source, dispose } = acquireClaimsSource(ledgerDir);
  try {
    return computeEventTimeCoherency(source, params);
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

function mdCode(value: string): string {
  return `\`${value}\``;
}

// The revision classes a notable-pair row is reported for: the routine bulk
// (corroborated, expected-progression) stays in the totals; the pairs table
// exists to locate WHERE the register's story changed.
const NOTABLE_CLASSES: ReadonlySet<string> = new Set(['revised-forward', 'revised-backward', 'episode-member', 'window-restated', 'same-vintage-divergence']);

export function renderEventTimeCoherency(c: EventTimeCoherency): string {
  const lines: string[] = [
    '# Event-time coherency (cross-vintage)',
    '',
    'The retroactive-revision detector (issue #725, S2): multiple vintages',
    'asserting the same (subject, event-kind) fact about the past should agree',
    'on the date; a later vintage contradicting an earlier one is flagged as a',
    'retroactive revision, and agreement is recorded as corroboration.',
    'Subjects join on the `cleaned` callsign key (a join key, not an',
    'identity). Regenerated and committed, so a new vintage shifting this',
    'picture shows up as a PR diff. **Flags, never verdicts** (issue #467):',
    'every classification carries candidate explanations and adjudicates',
    'none; corroboration is repetition, not proof.',
    '',
    'Vocabulary (each term below is used only with these meanings):',
    '',
    ...[...CLASSIFICATION_GLOSSES.entries()].map(([term, gloss]) => `- **${term}** — ${gloss}`),
    ...[...MECHANISM_GLOSSES.entries()].map(([term, gloss]) => `- **${term}** (mechanism) — ${gloss}`),
    '',
    '## Mass-update episodes',
    '',
    'The deliberately naive v1 spike rule (issue #725): flag any window of at',
    `most ${c.params.windowDays} days holding more than ${pct(c.params.shareThreshold)} of a dataset’s`,
    'populated dates for one event kind; overlapping windows across datasets',
    'and kinds merge into one episode — but only while the merged span stays',
    `within ${num(c.params.mergeSpanCapMultiple * c.params.windowDays)} days (${num(c.params.mergeSpanCapMultiple)}× the window): a wider staggered chain of`,
    'overlapping windows is refused and splits into separate episodes rather',
    `than fusing two distinct clusters. A dataset needs at least ${num(c.params.minPopulated)}`,
    'populated dates for a kind to count as episode evidence — a majority of a',
    'sparse column is a handful of rows, not a mass touch. Window and',
    'threshold are tuning parameters — a spread-out episode (the recorded 2024 rolling',
    'reprocessing spans ~14 weeks with no single-day spike) is invisible at',
    'this window by design and is NOT disproved by its absence here. An',
    'episode fingerprint also erodes: later vintages overwrite the clustered',
    'dates, so a later vintage’s missing spike never disproves an earlier',
    'vintage’s episode.',
    '',
  ];

  if (c.episodes.length === 0) {
    lines.push('No window exceeded the threshold in any dataset. This is "no flag", not a clean bill of health.', '');
  }
  c.episodes.forEach((episode, index) => {
    lines.push(
      `### Episode ${index + 1}: ${episode.start} → ${episode.end}`,
      '',
      'Witnessed by (one row per dataset × event kind whose dates cluster in this window):',
      '',
      '| event kind | lane | dataset | vintage | clustered span | rows in span | populated | share | peak days |',
      '|---|---|---|---|---|---:|---:|---:|---|',
      ...episode.signals.map(s =>
        `| ${mdCode(s.kind)} | ${s.lane} | ${mdCode(s.dataset)} | ${s.vintage} | ${s.windowStart} → ${s.windowEnd} | ${num(s.rows)} | ${num(s.populated)} | ${pct(s.share)} | ${s.peakDays.map(p => `${p.day} (${pct(p.share)})`).join(', ')} |`),
      '',
    );
  });

  lines.push(
    '## Cross-vintage classification totals',
    '',
    'Each consecutive pair of observations of the same (subject, event kind),',
    'classified. A subject’s first observation for a kind has nothing to',
    'compare and is not counted; a vintage that does not carry a subject or a',
    'kind is a non-observation, never "nothing happened".',
    '',
    '| event kind | classification | subject-steps |',
    '|---|---|---:|',
    ...c.totals.map(t => `| ${mdCode(t.kind)} | ${t.classification} | ${num(t.subjects)} |`),
    '',
    '## Notable vintage pairs',
    '',
    `Pairs of consecutive observations where at least ${num(NOTABLE_PAIR_MIN)} subjects`,
    'were classified as revised, episode-member, window-restated or',
    'same-vintage-divergence — where the register’s account of a fact changed',
    'across vintages, or two datasets of one vintage disagreed. The full distribution',
    '(every pair, every classification) is re-derivable from the fold',
    '(src/ci/event-time-coherency.ts).',
    '',
  );

  const notable = c.pairs.filter(p => NOTABLE_CLASSES.has(p.classification) && p.subjects >= NOTABLE_PAIR_MIN);
  if (notable.length === 0) {
    lines.push('No pair reached the reporting floor.', '');
  } else {
    lines.push(
      '| event kind | from (vintage) | to (vintage) | classification | mechanism (candidate) | subjects |',
      '|---|---|---|---|---|---:|',
      ...notable.map(p =>
        `| ${mdCode(p.kind)} | ${mdCode(p.prevDataset)} (${p.prevVintage}) | ${mdCode(p.dataset)} (${p.vintage}) | ${p.classification} | ${p.mechanism ?? '—'} | ${num(p.subjects)} |`),
      '',
    );
  }

  lines.push(
    '## Revision exemplars',
    '',
    `Up to ${EXEMPLAR_LIMIT} per kind and direction, ordered by subject — the shape of the`,
    'working, not a ranking. Any subject’s full sequence is re-derivable with',
    '`subjectKindSequence` (src/ci/event-time-coherency.ts). Mechanisms are',
    'candidates (read off row multiplicity either side of the step, and the',
    'two sides’ attested date renderings), never verdicts.',
    '',
  );
  if (c.exemplars.length === 0) {
    lines.push('No individual revisions were flagged.', '');
  } else {
    lines.push(
      '| event kind | subject | from (vintage) | asserted | rows | to (vintage) | now asserts | classification | mechanism (candidate) |',
      '|---|---|---|---|---:|---|---|---|---|',
      ...c.exemplars.map(e =>
        `| ${mdCode(e.kind)} | ${mdCode(e.subject)} | ${mdCode(e.prevDataset)} (${e.prevVintage}) | ${e.prevStat} | ${num(e.prevRows)} | ${mdCode(e.dataset)} (${e.vintage}) | ${e.stat} | ${e.classification} | ${e.mechanism ?? '—'} |`),
      '',
    );
  }

  lines.push(
    '## Corroboration depth',
    '',
    'How many datasets assert each (subject, event kind) fact, and whether',
    'they agree on the compared statistic. Agreement is corroboration in the',
    'publisher-entities sense — identical copies strengthen the record — but',
    'is never proof: vintages can inherit one upstream defect. Divergence is',
    'exactly the revision material classified above.',
    '',
    '| event kind | datasets asserting | subjects agreeing | subjects diverging |',
    '|---|---:|---:|---:|',
    ...c.corroboration.map(r => `| ${mdCode(r.kind)} | ${num(r.depth)} | ${num(r.agreeing)} | ${num(r.diverging)} |`),
    '',
  );

  return lines.join('\n');
}

export const EVENT_TIME_COHERENCY_PATH = 'reports/event-time-coherency.md';

export function writeEventTimeCoherency(): { path: string; changed: boolean } {
  const markdown = renderEventTimeCoherency(buildEventTimeCoherency());
  const target = path.resolve(process.cwd(), EVENT_TIME_COHERENCY_PATH);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const existing = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : undefined;
  const changed = existing !== markdown;
  if (changed) fs.writeFileSync(target, markdown);
  return { path: EVENT_TIME_COHERENCY_PATH, changed };
}

if (import.meta.main) {
  const { path: written, changed } = writeEventTimeCoherency();
  console.log(`${changed ? 'wrote' : 'up to date'}: ${written}`);
  perfReport({ entrypoint: 'event-time-coherency' });
}
