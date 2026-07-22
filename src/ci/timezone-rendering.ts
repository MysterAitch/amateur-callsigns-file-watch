/**
 * Per-source timezone-rendering classification via chained natural experiments
 * (issue #858, spun out of the #857 review).
 *
 * Ofcom states no timezone anywhere in any export, yet the corpus proves the
 * renderings differ: the #857 review's natural experiment found 632 shared
 * records stamped 23:xx in the wdtk-1141667 workbook all carrying a date one
 * day LATER in the 2024-07 register copy — the UTC-vs-BST day-truncation
 * signature (a local-midnight batch job seen through two clock conventions).
 * This module generalises that experiment into a per-source classification:
 *
 *  1. PAIRWISE NATURAL EXPERIMENTS — for any two sources sharing records on
 *     the same authored event kind where at least one side carries
 *     time-of-day: a date boundary disagreeing by EXACTLY one day, ONLY for
 *     timestamps in the midnight-offset window (23:xx, or non-midnight
 *     00:xx), and only for BST-dated records, is the signature of the two
 *     renderings differing by the local offset — and it ORIENTS the pair
 *     (under the two-candidate convention set below): an hour-23 stamp whose
 *     partner date is one day later says the timed side renders UTC and the
 *     partner renders local. Agreement of boundary-window summer stamps is
 *     the converse evidence (each window excludes one orientation; both
 *     windows agreeing pins the pair to the SAME convention).
 *  2. CHAINED CLASSIFICATION — each pair verdict is an edge; labels
 *     propagate from oriented pairs across same-convention edges to sources
 *     with no oriented pair of their own. Every propagated label records its
 *     full evidence CHAIN (error-locability: each conclusion is re-runnable
 *     and locatable to the exact pair, kind and hop that produced it).
 *  3. BATCH-SIGNATURE FINGERPRINTS — the 23:xx-vs-00:xx clustering of each
 *     timed column under the documented local-midnight-batch prior (#857's
 *     607-at-23:00 fast-decay cluster). CORROBORATING evidence only, never
 *     sole: a fingerprint alone classifies nothing here.
 *
 * THE TWO-CANDIDATE CONVENTION SET (a stated assumption, not a discovery):
 * every conclusion reads "UTC" and "local" against the candidate set
 * {UTC, Europe/London civil time}. These are the only conventions a UK
 * regulator's export plausibly renders, and the only two the one-day
 * boundary experiment can distinguish; a hypothetical third convention
 * offset by a different amount would land in the unexplained bucket and
 * surface loudly, not silently.
 *
 * Epistemics (binding):
 *
 *  - Every classification is [derived] — NEVER declared (Ofcom states no
 *    timezone anywhere). It is an offered conclusion with its evidence pairs
 *    named and re-runnable, not a verdict (issue #467: flag, don't
 *    adjudicate). A source with insufficient overlap is honestly
 *    UNCLASSIFIED, never guessed.
 *  - SEASON-LIMITED DETECTABILITY is first-class: GMT = UTC in winter, so
 *    only BST-dated boundary-crossing records discriminate. A pair whose
 *    overlap carries no summer boundary-window stamps is UNDETERMINABLE —
 *    'no-boundary-signal', a distinct outcome that is never collapsed into
 *    "same convention". Winter agreement is not evidence of anything.
 *  - SAME-UPSTREAM-INSTANT ASSUMPTION: the experiment assumes both renderings
 *    derive from the same stored instant. Records revised between the two
 *    exports break that assumption and are EXCLUDED as not-comparable
 *    (|day difference| > 1); a re-stamping pipeline would surface as
 *    unexplained disagreement, which the classifier treats as a loud
 *    conflicting-evidence finding, never an average.
 *  - PER-EXPORT SCOPE: this classifies the EXPORT's rendering, not the source
 *    system. The corpus itself proves conventions change across exports (the
 *    register's day rendering flips between the 2024-07 and 2024-10-21
 *    copies), so the annotation is per-export/per-vintage by construction.
 *
 * WHERE THE ANNOTATION LIVES (the issue's open placement question, decided
 * here with the rationale recorded): the per-source annotation is the FOLD's
 * OUTPUT — this module's typed result and the committed golden report — and
 * deliberately NOT (a) an @interpretation claim: that tier is authored
 * per-column {type, format} fact LIFTED from converter specs and emitted
 * per-source (Looked-up); a cross-source natural-experiment conclusion cannot
 * be reproduced from any single source's bytes, so storing it there would
 * break the ledger's per-source reproducibility contract and its confidence
 * readout; nor (b) a reference-data table: reference-data/ is the authored,
 * hand-curated tier, and a hand-maintained copy of a derived conclusion is
 * exactly the silent-drift fragility class #846 polices (the fold re-derives;
 * a curated copy would rot). Consumers read buildTimezoneRendering() (or the
 * committed report); the S2 detector's rendering-difference candidate can
 * graduate onto it in a follow-on.
 *
 * FOLD, not re-parse (issue #361): everything here is DuckDB SQL over the
 * claim ledger — the raw layer supplies the verbatim datetime cells (the S1
 * event tier deliberately truncates to the day; the time-of-day lives only in
 * the raw cells its provenance points back to), the S1 event-date claims
 * supply each partner's rendered day, and the authored timed-column bindings
 * are LIFTED from the same registries the S1 emit binds (never re-guessed).
 * Committed as reports/timezone-rendering.md, byte-deterministic (every query
 * carries a total ORDER BY), so a new vintage shifting the classification is
 * a PR diff.
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
import { EVENT_DATE_RULE, EVENT_DATE_PREDICATE_PREFIX, eventKindForFoiDateColumn, eventKindForDateOutput } from '../v2/claim.ts';
import { registerSourcesFor } from '../v2/collectors/foi-register.ts';
import { listFoiEntryKeys, readFoiEntryMeta, defaultFoiDir } from '../shared/foi-archive.ts';
import { listArchiveKeys } from '../shared/archive.ts';
import { mappingForVariant, openDataDateFormat, DATE_COLUMN_CANONICAL_BY_RAW_HEADER } from '../sources/ofcom-amateur/normalise.ts';
import { DIRS } from '../shared/constants.ts';
import { parseJsonObject } from '../shared/json-shape.ts';
import { acquireClaimsSource } from './event-time-coherency.ts';
import { time, perfReport } from '../shared/perf.ts';

// --- Tunable classifier parameters ------------------------------------------

export interface ClassifierParams {
  // Minimum subjects a boundary-window cell must hold before it counts as
  // pair evidence: below this, the outcome is honestly insufficient-signal
  // rather than a classification resting on a handful of rows.
  minEvidenceSubjects: number;
  // The contradiction tolerance, as a share of the supporting evidence: a
  // handful of contrary cells (a record genuinely touched on consecutive
  // days between the two exports can mimic either signature) is noise below
  // this share, a loud conflicting-evidence finding at or above it.
  noiseShare: number;
}

export const DEFAULT_CLASSIFIER_PARAMS: ClassifierParams = {
  minEvidenceSubjects: 5,
  noiseShare: 0.05,
};

// --- UK BST windows (pure, authored) ----------------------------------------
//
// British Summer Time under the modern rule (harmonised since 1996): from
// 01:00 UTC on the LAST SUNDAY OF MARCH to 01:00 UTC on the last Sunday of
// October. Earlier years used different end rules (and 1968–71 ran BST all
// year), so the table deliberately starts at 1996 and any timed cell dated
// before it is EXCLUDED and counted (pre-BST-table), never classified under
// a rule that did not govern its date. Computed arithmetically (no ICU/
// timezone library — the pinned DuckDB CLI and the supply-chain posture both
// forbid one), unit-tested against known transition dates.

export const BST_TABLE_FIRST_YEAR = 1996;
export const BST_TABLE_LAST_YEAR = 2035;

export interface BstWindow { year: number; start: string; end: string }

// Day-of-week for an ISO day via Zeller-free UTC arithmetic (0 = Sunday).
function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function lastSundayOf(year: number, month: number): string {
  // Day 0 of month+1 is the last day of `month` (1-based month here).
  const last = new Date(Date.UTC(year, month, 0));
  last.setUTCDate(last.getUTCDate() - last.getUTCDay());
  return isoDay(last);
}

export function ukBstWindows(firstYear: number = BST_TABLE_FIRST_YEAR, lastYear: number = BST_TABLE_LAST_YEAR): BstWindow[] {
  const windows: BstWindow[] = [];
  for (let year = firstYear; year <= lastYear; year++) {
    windows.push({ year, start: lastSundayOf(year, 3), end: lastSundayOf(year, 10) });
  }
  return windows;
}

// The season of an ISO day under the window table: 'summer' (strictly inside
// BST, clear of the transitions), 'winter', 'margin' (within a day of a
// transition — the clocks change at 01:00 and the experiment's precision is a
// day, so transition-adjacent days are excluded rather than misread), or
// 'pre-table' for dates before the table's first year. Exposed for the unit
// tests; the SQL fold encodes the identical rule.
export type Season = 'summer' | 'winter' | 'margin' | 'pre-table';

export function seasonOf(day: string, windows: readonly BstWindow[] = ukBstWindows()): Season {
  const year = Number(day.slice(0, 4));
  const window = windows.find(w => w.year === year);
  if (window === undefined) return year < (windows[0]?.year ?? BST_TABLE_FIRST_YEAR) ? 'pre-table' : 'winter';
  const near = (pivot: string): boolean => Math.abs(Date.parse(day) - Date.parse(pivot)) <= 86_400_000;
  if (near(window.start) || near(window.end)) return 'margin';
  return day > window.start && day < window.end ? 'summer' : 'winter';
}

// --- Authored timed-column bindings -----------------------------------------
//
// Which raw header of which source is a date-bearing column, its authored
// event kind, and its attested grammar — LIFTED from the same registries the
// S1 event tier binds (the FOI conversion specs; the open-data variant
// registry), never re-guessed, so the timed side of every experiment reads
// exactly the cells the event tier derived its day claims from. The raw
// layer's attribute predicates are the verbatim headers, which is what makes
// this join possible without storing anything new.

export interface TimedColumnBinding {
  lane: string;
  dataset: string;
  // The verbatim raw header — the raw layer's attribute predicate.
  header: string;
  kind: string;
  // The attested date grammar: 'DD/MM/YYYY' (day-first, optional hh:mm[:ss])
  // or 'YYYY-MM-DD' (workbook ISO extract, optional hh:mm:ss).
  grammar: string;
}

export function timedColumnBindings(foiDir: string = defaultFoiDir()): TimedColumnBinding[] {
  const bindings: TimedColumnBinding[] = [];
  for (const entry of listFoiEntryKeys(foiDir)) {
    const meta = readFoiEntryMeta(foiDir, entry);
    for (const source of registerSourcesFor(meta)) {
      for (const column of source.conversion.columns) {
        if ((column.kind !== 'date' && column.kind !== 'iso-date') || column.source === null) continue;
        const kind = eventKindForFoiDateColumn(column);
        if (kind === null) continue;
        bindings.push({ lane: 'foi', dataset: entry, header: column.source, kind, grammar: column.kind === 'date' ? 'DD/MM/YYYY' : 'YYYY-MM-DD' });
      }
    }
  }
  for (const key of listArchiveKeys()) {
    const metaPath = path.join(DIRS.archive, key, 'meta.json');
    if (!fs.existsSync(metaPath)) continue;
    const meta = parseJsonObject(fs.readFileSync(metaPath, 'utf8'), metaPath) as { converter?: { variant?: string }; normalised?: { headerVariant?: string } };
    // The per-entry variant fact, exactly as the coherency fold reads it
    // (declared converter variant, else the detected header variant the
    // normalisation recorded). An entry declaring neither has no authored
    // header→canonical binding to lift, so it contributes no timed columns —
    // its day claims still participate as a partner side.
    const variant = meta.converter?.variant ?? meta.normalised?.headerVariant;
    if (variant === undefined) continue;
    const mapping = mappingForVariant(variant);
    if (mapping === undefined) continue;
    for (const [header, canonical] of Object.entries(mapping)) {
      // A date column is one whose (header, canonical) pair the variant
      // registry classifies as dated — the same DATE_COLUMNS fact
      // interpretOpenDataColumns attests, read through its exported
      // by-raw-header projection.
      if (canonical === null || DATE_COLUMN_CANONICAL_BY_RAW_HEADER.get(header) !== canonical) continue;
      const kind = eventKindForDateOutput(canonical);
      if (kind === null) continue;
      bindings.push({ lane: 'opendata', dataset: key, header, kind, grammar: openDataDateFormat(variant) });
    }
  }
  return bindings.sort((a, b) =>
    a.lane.localeCompare(b.lane) || a.dataset.localeCompare(b.dataset) || a.kind.localeCompare(b.kind) || a.header.localeCompare(b.header));
}

// --- The SQL folds ----------------------------------------------------------

function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

// The bindings as a VALUES relation. An empty binding list yields an empty
// relation (the fixture/empty-corpus case) rather than invalid SQL.
function bindingsRelation(bindings: readonly TimedColumnBinding[]): string {
  if (bindings.length === 0) {
    return `SELECT NULL::VARCHAR AS lane, NULL::VARCHAR AS dataset, NULL::VARCHAR AS header, NULL::VARCHAR AS kind, NULL::VARCHAR AS grammar WHERE FALSE`;
  }
  return `SELECT * FROM (VALUES ${bindings
    .map(b => `(${sqlLiteral(b.lane)}, ${sqlLiteral(b.dataset)}, ${sqlLiteral(b.header)}, ${sqlLiteral(b.kind)}, ${sqlLiteral(b.grammar)})`)
    .join(', ')}) AS b(lane, dataset, header, kind, grammar)`;
}

// The BST window table as a VALUES relation.
function bstRelation(): string {
  return `SELECT * FROM (VALUES ${ukBstWindows()
    .map(w => `(${w.year}, DATE ${sqlLiteral(w.start)}, DATE ${sqlLiteral(w.end)})`)
    .join(', ')}) AS bst(yr, bstStart, bstEnd)`;
}

// The timed-cell CTEs: every raw date cell under an authored binding, parsed
// under its attested grammar into (day, hour, minute) — cells with no
// time-of-day component parse to NULL hour and drop out of the timed side
// (they still feed the partner side via their S1 day claims). `timed_agg`
// keeps subjects with exactly ONE distinct timed value per (source, kind):
// multi-valued subjects cannot anchor a same-instant comparison and are
// excluded (counted by the sources fold), mirroring the partner side's
// single-day rule. Exact-midnight stamps (00:00[:00]) are excluded here too:
// a rendered time FORMAT with no clock information anchors nothing — and at
// exact midnight a one-day partner disagreement is precisely what an unknown
// rendering offset COULD produce, so letting such rows through would mislabel
// them "unexplained" (whose definition is "no rendering offset can produce
// this").
function timedCtes(source: ClaimsSource, bindings: readonly TimedColumnBinding[]): string {
  return `bindings AS (
  ${bindingsRelation(bindings)}
),
bst AS (
  ${bstRelation()}
),
timed_cell AS (
  SELECT b.lane, b.dataset, b.kind,
         ${cleanedKeyExpr('c.rawSubject')} AS subject,
         CASE WHEN b.grammar = 'YYYY-MM-DD'
              THEN try_cast(regexp_extract(trim(c.object), '^(\\d{4}-\\d{2}-\\d{2}) \\d{2}:\\d{2}(?::\\d{2})?$', 1) AS DATE)
              ELSE try_cast(CASE WHEN regexp_matches(trim(c.object), '^\\d{2}/\\d{2}/\\d{4} \\d{1,2}:\\d{2}(?::\\d{2})?$')
                   THEN substr(trim(c.object), 7, 4) || '-' || substr(trim(c.object), 4, 2) || '-' || substr(trim(c.object), 1, 2)
                   ELSE NULL END AS DATE) END AS d,
         CASE WHEN b.grammar = 'YYYY-MM-DD'
              THEN try_cast(regexp_extract(trim(c.object), '^\\d{4}-\\d{2}-\\d{2} (\\d{2}):\\d{2}(?::\\d{2})?$', 1) AS INTEGER)
              ELSE try_cast(regexp_extract(trim(c.object), '^\\d{2}/\\d{2}/\\d{4} (\\d{1,2}):\\d{2}(?::\\d{2})?$', 1) AS INTEGER) END AS hh,
         CASE WHEN b.grammar = 'YYYY-MM-DD'
              THEN try_cast(regexp_extract(trim(c.object), '^\\d{4}-\\d{2}-\\d{2} \\d{2}:(\\d{2})(?::\\d{2})?$', 1) AS INTEGER)
              ELSE try_cast(regexp_extract(trim(c.object), '^\\d{2}/\\d{2}/\\d{4} \\d{1,2}:(\\d{2})(?::\\d{2})?$', 1) AS INTEGER) END AS mi
  FROM ${claimsRelation(source)} c
  JOIN bindings b
    ON b.lane = split_part(c.sourceFile, '/', 1)
   AND b.dataset = split_part(c.sourceFile, '/', 2)
   AND b.header = c.predicate
  WHERE c.layer = 'raw'
),
timed_agg AS (
  SELECT lane, dataset, kind, subject, any_value(d) AS d, any_value(hh) AS hh, any_value(mi) AS mi
  FROM timed_cell
  WHERE d IS NOT NULL AND subject <> '' AND NOT (hh = 0 AND mi = 0)
  GROUP BY lane, dataset, kind, subject
  HAVING count(DISTINCT (d, hh, mi)) = 1
),
partner_agg AS (
  SELECT split_part(sourceFile, '/', 1) AS lane, split_part(sourceFile, '/', 2) AS dataset,
         substr(predicate, ${EVENT_DATE_PREDICATE_PREFIX.length + 1}) AS kind,
         ${cleanedKeyExpr('rawSubject')} AS subject,
         min(object)::DATE AS d
  FROM ${claimsRelation(source)}
  WHERE rule = '${EVENT_DATE_RULE}'
    AND predicate LIKE '${EVENT_DATE_PREDICATE_PREFIX}%'
    AND ${cleanedKeyExpr('rawSubject')} <> ''
  GROUP BY 1, 2, 3, 4
  HAVING count(DISTINCT object) = 1
)`;
}

// The experiment-cell vocabulary. Each shared (subject, kind) between a timed
// source and a partner source lands in exactly one cell:
//
//  - utc-orientation-shift   — a summer hour-23 stamp whose partner day is one
//                              day LATER: the timed side renders UTC, the
//                              partner renders local (+1h crosses midnight).
//  - local-orientation-shift — a summer non-midnight hour-0 stamp whose
//                              partner day is one day EARLIER: the timed side
//                              renders local, the partner renders UTC.
//  - h23-window-agreement    — a summer hour-23 stamp agreeing on the day:
//                              excludes (timed=UTC ∧ partner=local).
//  - h0-window-agreement     — a summer non-midnight hour-0 stamp agreeing:
//                              excludes (timed=local ∧ partner=UTC).
//  - agreement-no-signal     — agreement outside any discriminating window
//                              (mid-day summer stamps, all winter stamps):
//                              consistency, but no orientation information.
//  - unexplained             — a one-day disagreement no rendering offset can
//                              produce (off-window, or winter where GMT=UTC):
//                              loud conflict material, never averaged away.
//  - not-comparable          — the two sides differ by MORE than one day: the
//                              record was revised between the exports, so the
//                              same-upstream-instant assumption fails and the
//                              row is excluded from the experiment.
//  - transition-margin       — the timed day sits within a day of a BST
//                              transition; excluded (the clocks change mid-
//                              night-adjacent and day precision cannot split
//                              it).
//  - pre-bst-table           — the timed day predates the authored BST table
//                              (1996); excluded rather than misclassified.
export type ExperimentCell =
  | 'utc-orientation-shift'
  | 'local-orientation-shift'
  | 'h23-window-agreement'
  | 'h0-window-agreement'
  | 'agreement-no-signal'
  | 'unexplained'
  | 'not-comparable'
  | 'transition-margin'
  | 'pre-bst-table';

export interface PairCellRow {
  timedLane: string;
  timedDataset: string;
  partnerLane: string;
  partnerDataset: string;
  kind: string;
  cell: ExperimentCell;
  subjects: number;
}

export function foldPairCells(source: string | ClaimsSource, bindings?: readonly TimedColumnBinding[]): PairCellRow[] {
  const claims = toClaimsSource(source);
  if (!claimsSourcePresent(claims)) return [];
  const bound = bindings ?? timedColumnBindings();
  if (bound.length === 0) return [];
  return foldQuery<PairCellRow>(`WITH ${timedCtes(claims, bound)},
cells AS (
  SELECT t.lane AS timedLane, t.dataset AS timedDataset,
         p.lane AS partnerLane, p.dataset AS partnerDataset, t.kind,
    CASE
      WHEN b.yr IS NULL AND year(t.d) < ${BST_TABLE_FIRST_YEAR} THEN 'pre-bst-table'
      WHEN t.d BETWEEN b.bstStart - 1 AND b.bstStart + 1 OR t.d BETWEEN b.bstEnd - 1 AND b.bstEnd + 1 THEN 'transition-margin'
      WHEN abs(date_diff('day', t.d, p.d)) > 1 THEN 'not-comparable'
      WHEN t.d > b.bstStart + 1 AND t.d < b.bstEnd - 1 THEN
        CASE
          WHEN t.hh = 23 AND date_diff('day', t.d, p.d) = 1 THEN 'utc-orientation-shift'
          WHEN t.hh = 0 AND t.mi > 0 AND date_diff('day', t.d, p.d) = -1 THEN 'local-orientation-shift'
          WHEN t.hh = 23 AND t.d = p.d THEN 'h23-window-agreement'
          WHEN t.hh = 0 AND t.mi > 0 AND t.d = p.d THEN 'h0-window-agreement'
          WHEN t.d = p.d THEN 'agreement-no-signal'
          ELSE 'unexplained'
        END
      WHEN t.d = p.d THEN 'agreement-no-signal'
      ELSE 'unexplained'
    END AS cell
  FROM timed_agg t
  JOIN partner_agg p
    ON p.kind = t.kind AND p.subject = t.subject
   AND NOT (p.lane = t.lane AND p.dataset = t.dataset)
  LEFT JOIN bst b ON b.yr = year(t.d)
)
SELECT timedLane, timedDataset, partnerLane, partnerDataset, kind, cell, count(*)::BIGINT AS subjects
FROM cells
GROUP BY ALL
ORDER BY timedLane, timedDataset, partnerLane, partnerDataset, kind, cell`);
}

// Minute-level corroboration for pairs where BOTH sides carry time-of-day:
// per shared single-valued subject, the exact minute difference between the
// two rendered instants (bounded to ±3 hours so a record revised between the
// exports never enters). Two renderings of the same instant under the SAME
// convention differ by exactly 0 minutes; under UTC-vs-BST by exactly ±60 for
// summer instants and 0 for winter ones. CORROBORATING evidence beside the
// day-boundary experiment, folded per (pair, season, bucket).
export interface MinuteDeltaRow {
  lane1: string;
  dataset1: string;
  lane2: string;
  dataset2: string;
  kind: string;
  season: string;
  // '-60' | '0' | '+60' | 'other' (bounded to ±180 minutes).
  bucket: string;
  subjects: number;
}

export function foldMinuteDeltas(source: string | ClaimsSource, bindings?: readonly TimedColumnBinding[]): MinuteDeltaRow[] {
  const claims = toClaimsSource(source);
  if (!claimsSourcePresent(claims)) return [];
  const bound = bindings ?? timedColumnBindings();
  if (bound.length === 0) return [];
  return foldQuery<MinuteDeltaRow>(`WITH ${timedCtes(claims, bound)},
deltas AS (
  SELECT a.lane AS lane1, a.dataset AS dataset1, b2.lane AS lane2, b2.dataset AS dataset2, a.kind,
    CASE
      WHEN year(a.d) < ${BST_TABLE_FIRST_YEAR} THEN 'pre-bst-table'
      WHEN a.d BETWEEN s.bstStart - 1 AND s.bstStart + 1 OR a.d BETWEEN s.bstEnd - 1 AND s.bstEnd + 1 THEN 'margin'
      WHEN a.d > s.bstStart + 1 AND a.d < s.bstEnd - 1 THEN 'summer'
      ELSE 'winter'
    END AS season,
    date_diff('minute', a.d + to_hours(a.hh) + to_minutes(a.mi), b2.d + to_hours(b2.hh) + to_minutes(b2.mi)) AS deltaMin
  FROM timed_agg a
  JOIN timed_agg b2
    ON b2.kind = a.kind AND b2.subject = a.subject
   AND (a.lane || '/' || a.dataset) < (b2.lane || '/' || b2.dataset)
  LEFT JOIN bst s ON s.yr = year(a.d)
  WHERE abs(date_diff('minute', a.d + to_hours(a.hh) + to_minutes(a.mi), b2.d + to_hours(b2.hh) + to_minutes(b2.mi))) <= 180
)
SELECT lane1, dataset1, lane2, dataset2, kind, season,
       CASE WHEN deltaMin = 0 THEN '0' WHEN deltaMin = 60 THEN '+60' WHEN deltaMin = -60 THEN '-60' ELSE 'other' END AS bucket,
       count(*)::BIGINT AS subjects
FROM deltas
GROUP BY ALL
ORDER BY lane1, dataset1, lane2, dataset2, kind, season, bucket`);
}

// The per-(source, kind) evidence base: how many subjects assert the kind at
// all, how many carry a genuine time-of-day (non-midnight — a column whose
// every time reads 00:00[:00] carries a rendered time FORMAT but no clock
// information, so it never anchors an experiment), the boundary-window
// clustering the batch-signature fingerprint reads, and the multi-valued
// subjects both sides exclude.
export interface SourceKindRow {
  lane: string;
  dataset: string;
  kind: string;
  vintage: string;
  // Subjects with at least one S1 day claim for the kind.
  subjects: number;
  // Subjects excluded from the partner side (more than one distinct day).
  multiValuedSubjects: number;
  // Single-valued timed subjects with a non-midnight time-of-day (timed_agg
  // itself excludes exact-midnight stamps — no clock information).
  timedSubjects: number;
  // Of those, summer-dated hour-23 and non-midnight hour-0 stamps (the
  // midnight-offset windows), and the modal hour with its count.
  summerH23: number;
  summerH0: number;
  topHour: number | null;
  topHourSubjects: number;
}

export function foldSourceKinds(source: string | ClaimsSource, bindings?: readonly TimedColumnBinding[]): SourceKindRow[] {
  const claims = toClaimsSource(source);
  if (!claimsSourcePresent(claims)) return [];
  const bound = bindings ?? timedColumnBindings();
  return foldQuery<SourceKindRow>(`WITH ${timedCtes(claims, bound)},
partner_all AS (
  SELECT split_part(sourceFile, '/', 1) AS lane, split_part(sourceFile, '/', 2) AS dataset,
         substr(predicate, ${EVENT_DATE_PREDICATE_PREFIX.length + 1}) AS kind,
         ${cleanedKeyExpr('rawSubject')} AS subject,
         min(vintage) AS vintage,
         count(DISTINCT object) AS days
  FROM ${claimsRelation(claims)}
  WHERE rule = '${EVENT_DATE_RULE}'
    AND predicate LIKE '${EVENT_DATE_PREDICATE_PREFIX}%'
    AND ${cleanedKeyExpr('rawSubject')} <> ''
  GROUP BY 1, 2, 3, 4
),
timed_seasoned AS (
  SELECT t.*,
    CASE WHEN b.yr IS NOT NULL AND t.d > b.bstStart + 1 AND t.d < b.bstEnd - 1
         AND NOT (t.d BETWEEN b.bstStart - 1 AND b.bstStart + 1 OR t.d BETWEEN b.bstEnd - 1 AND b.bstEnd + 1)
         THEN 'summer' ELSE 'other' END AS season
  FROM timed_agg t
  LEFT JOIN bst b ON b.yr = year(t.d)
),
hour_mode AS (
  SELECT lane, dataset, kind, hh, count(*) AS n,
         row_number() OVER (PARTITION BY lane, dataset, kind ORDER BY count(*) DESC, hh) AS rk
  FROM timed_seasoned
  GROUP BY lane, dataset, kind, hh
)
SELECT p.lane, p.dataset, p.kind, min(p.vintage) AS vintage,
       count(*)::BIGINT AS subjects,
       count(*) FILTER (WHERE p.days > 1)::BIGINT AS multiValuedSubjects,
       coalesce(any_value(ts.timed), 0)::BIGINT AS timedSubjects,
       coalesce(any_value(ts.sh23), 0)::BIGINT AS summerH23,
       coalesce(any_value(ts.sh0), 0)::BIGINT AS summerH0,
       any_value(hm.hh) AS topHour,
       coalesce(any_value(hm.n), 0)::BIGINT AS topHourSubjects
FROM partner_all p
LEFT JOIN (
  SELECT lane, dataset, kind, count(*) AS timed,
         count(*) FILTER (WHERE season = 'summer' AND hh = 23) AS sh23,
         count(*) FILTER (WHERE season = 'summer' AND hh = 0 AND mi > 0) AS sh0
  FROM timed_seasoned
  GROUP BY lane, dataset, kind
) ts ON ts.lane = p.lane AND ts.dataset = p.dataset AND ts.kind = p.kind
LEFT JOIN hour_mode hm ON hm.lane = p.lane AND hm.dataset = p.dataset AND hm.kind = p.kind AND hm.rk = 1
GROUP BY p.lane, p.dataset, p.kind
ORDER BY p.lane, p.dataset, p.kind`);
}

// --- Pair classification (pure, unit-testable) ------------------------------

// One pair+kind experiment's evidence, aggregated from the cells.
export interface PairEvidence {
  timedLane: string;
  timedDataset: string;
  partnerLane: string;
  partnerDataset: string;
  kind: string;
  utcShift: number;
  localShift: number;
  h23Agree: number;
  h0Agree: number;
  agreeNoSignal: number;
  unexplained: number;
  notComparable: number;
  excluded: number; // transition-margin + pre-bst-table
}

// The pair-verdict vocabulary (authored, closed):
//
//  - differs-by-local-offset — the boundary experiment fired: the two
//    renderings differ by the local offset, oriented (utcSide names which
//    side reads UTC under the two-candidate set). ABSOLUTE evidence.
//  - same-convention — summer stamps in BOTH midnight-offset windows agree,
//    excluding both orientations: the two sides render under one convention.
//    An EQUALITY edge (which convention comes from elsewhere in the chain).
//  - agreement-only-h23 / agreement-only-h0 — only one window has coverage:
//    a PARTIAL constraint (one orientation excluded, the other untested).
//    Combines with a partner's known label during chaining; alone it
//    classifies nothing.
//  - no-boundary-signal — comparable overlap exists but carries no summer
//    boundary-window stamps (winter-only overlap, or mid-day stamps only):
//    honestly undeterminable, NEVER collapsed into "same convention".
//  - insufficient-evidence — boundary-window cells exist but below the
//    evidence floor.
//  - conflicting-evidence — the cells contradict each other beyond the noise
//    tolerance (both orientations, or unexplained disagreement rivalling the
//    evidence): a loud finding to examine, never an average.
export type PairVerdict =
  | { verdict: 'differs-by-local-offset'; utcSide: 'timed' | 'partner'; evidence: number }
  | { verdict: 'same-convention'; evidence: number }
  | { verdict: 'agreement-only-h23'; evidence: number }
  | { verdict: 'agreement-only-h0'; evidence: number }
  | { verdict: 'no-boundary-signal' }
  | { verdict: 'insufficient-evidence' }
  | { verdict: 'conflicting-evidence'; detail: string };

export function classifyPair(e: PairEvidence, params: ClassifierParams = DEFAULT_CLASSIFIER_PARAMS): PairVerdict {
  const { minEvidenceSubjects: min, noiseShare } = params;
  const noise = (support: number): number => Math.max(1, Math.floor(support * noiseShare));
  const boundary = e.utcShift + e.localShift + e.h23Agree + e.h0Agree;

  // Both orientations at meaningful strength cannot both hold.
  if (e.utcShift >= min && e.localShift >= min) {
    return { verdict: 'conflicting-evidence', detail: `both orientations fired (${e.utcShift} utc-shift vs ${e.localShift} local-shift)` };
  }
  if (e.utcShift >= min) {
    // Contradictions of the utc orientation: the opposite shift, and
    // agreement inside its own window. (h0 agreement is EXPECTED under this
    // orientation — a UTC 00:xx stamp stays on the same local day.)
    const contra = e.localShift + e.h23Agree;
    if (contra <= noise(e.utcShift) && e.unexplained <= noise(e.utcShift)) {
      return { verdict: 'differs-by-local-offset', utcSide: 'timed', evidence: e.utcShift };
    }
    return { verdict: 'conflicting-evidence', detail: `utc-orientation evidence ${e.utcShift} against ${contra} in-window contradictions and ${e.unexplained} unexplained` };
  }
  if (e.localShift >= min) {
    const contra = e.utcShift + e.h0Agree;
    if (contra <= noise(e.localShift) && e.unexplained <= noise(e.localShift)) {
      return { verdict: 'differs-by-local-offset', utcSide: 'partner', evidence: e.localShift };
    }
    return { verdict: 'conflicting-evidence', detail: `local-orientation evidence ${e.localShift} against ${contra} in-window contradictions and ${e.unexplained} unexplained` };
  }
  // No oriented shift at strength. Window agreements?
  if (e.h23Agree >= min && e.h0Agree >= min) {
    const support = e.h23Agree + e.h0Agree;
    if (e.utcShift + e.localShift <= noise(support) && e.unexplained <= noise(support)) {
      return { verdict: 'same-convention', evidence: support };
    }
    return { verdict: 'conflicting-evidence', detail: `window agreements ${support} against ${e.utcShift + e.localShift} shifts and ${e.unexplained} unexplained` };
  }
  if (e.h23Agree >= min && e.utcShift <= noise(e.h23Agree) && e.unexplained <= noise(e.h23Agree)) {
    return { verdict: 'agreement-only-h23', evidence: e.h23Agree };
  }
  if (e.h0Agree >= min && e.localShift <= noise(e.h0Agree) && e.unexplained <= noise(e.h0Agree)) {
    return { verdict: 'agreement-only-h0', evidence: e.h0Agree };
  }
  // Mass unexplained disagreement is a loud finding REGARDLESS of how few
  // boundary-window cells sit beside it: a token below-floor boundary cell
  // must never demote a re-stamping-pipeline shape to "insufficient".
  if (e.unexplained >= min && e.unexplained > noise(boundary)) {
    return { verdict: 'conflicting-evidence', detail: `${e.unexplained} unexplained one-day disagreements against only ${boundary} boundary-window cells` };
  }
  if (boundary > 0) return { verdict: 'insufficient-evidence' };
  return { verdict: 'no-boundary-signal' };
}

// --- Chained per-source classification (pure) --------------------------------

export type RenderingLabel = 'utc' | 'local';

// One hop of an evidence chain: the pair (with its kind) and the rule that
// used it. Chains render as re-runnable working — every hop names the exact
// experiment behind it.
export interface ChainHop {
  pair: string; // "timedLane/timedDataset vs partnerLane/partnerDataset [kind]"
  rule: string;
}

export interface SourceClassification {
  lane: string;
  dataset: string;
  label: RenderingLabel | null;
  status: 'classified' | 'unclassified' | 'conflicting-evidence';
  // Why an unclassified source is unclassified, or the conflict detail.
  reason: string;
  chain: ChainHop[];
  // Extra corroborating routes reaching the same label (count only; each is
  // re-derivable from the pairs table). Routes are distinguished by their
  // ANCHORING experiment (the chain's first hop) — they are additional, not
  // fully independent, since routes may share downstream equality edges.
  corroboratingRoutes: number;
}

export interface ClassifiedPair extends PairEvidence {
  verdict: PairVerdict;
}

function pairId(p: PairEvidence): string {
  return `${p.timedLane}/${p.timedDataset} vs ${p.partnerLane}/${p.partnerDataset} [${p.kind}]`;
}

function sourceKey(lane: string, dataset: string): string {
  return `${lane}/${dataset}`;
}

// A node's pending label with its first-arrived chain and the set of distinct
// route keys (a route is identified by its chain's FIRST hop — the oriented
// pair the whole route rests on; chains sharing that anchor are one route
// extended). The set makes corroboration counting idempotent: the fixpoint
// loop re-proposes the same edges every round, and a re-proposal must never
// inflate the count.
interface PendingLabel { label: RenderingLabel; chain: ChainHop[]; routes: Set<string> }

// Resolve per-source labels from the classified pairs by fixpoint
// propagation, deterministically (pairs are processed in sorted order each
// round):
//  1. every differs-by-local-offset pair labels BOTH ends absolutely;
//  2. every same-convention pair copies a known label across (an equality
//     edge), extending the chain;
//  3. an agreement-only window combines with a KNOWN label where the excluded
//     orientation pins the other end: agreement-only-h23 excludes
//     (timed=utc ∧ partner=local), so a partner known local forces
//     timed=local, and a timed side known utc forces partner=utc (and
//     symmetrically for the h0 window).
// A source deriving BOTH labels through different routes is a loud
// conflicting-evidence finding; sources reached by no route stay unclassified.
export function resolveSourceLabels(pairs: readonly ClassifiedPair[], universe: readonly { lane: string; dataset: string }[]): SourceClassification[] {
  const sorted = [...pairs].sort((a, b) => pairId(a).localeCompare(pairId(b)));
  const labels = new Map<string, PendingLabel>();
  const conflicts = new Map<string, string>();

  const propose = (key: string, label: RenderingLabel, chain: ChainHop[]): boolean => {
    const route = chain[0]?.pair ?? '';
    const existing = labels.get(key);
    if (existing === undefined) {
      labels.set(key, { label, chain, routes: new Set([route]) });
      return true;
    }
    if (existing.label !== label) {
      conflicts.set(key, `derived both '${existing.label}' (via ${existing.chain.map(h => h.pair).join(' → ')}) and '${label}' (via ${chain.map(h => h.pair).join(' → ')})`);
      return false;
    }
    existing.routes.add(route);
    return false;
  };

  // Round 0: absolute labels from every oriented pair.
  for (const p of sorted) {
    if (p.verdict.verdict !== 'differs-by-local-offset') continue;
    const timedLabel: RenderingLabel = p.verdict.utcSide === 'timed' ? 'utc' : 'local';
    const partnerLabel: RenderingLabel = p.verdict.utcSide === 'timed' ? 'local' : 'utc';
    const hop = (rule: string): ChainHop[] => [{ pair: pairId(p), rule }];
    propose(sourceKey(p.timedLane, p.timedDataset), timedLabel, hop(`oriented shift: ${p.verdict.evidence} summer boundary subjects place the ${p.verdict.utcSide} side on UTC`));
    propose(sourceKey(p.partnerLane, p.partnerDataset), partnerLabel, hop(`oriented shift: ${p.verdict.evidence} summer boundary subjects place the ${p.verdict.utcSide} side on UTC`));
  }

  // Propagation rounds: equality edges and partial constraints, to fixpoint.
  for (;;) {
    let changed = false;
    for (const p of sorted) {
      const tKey = sourceKey(p.timedLane, p.timedDataset);
      const pKey = sourceKey(p.partnerLane, p.partnerDataset);
      const tLabel = labels.get(tKey);
      const pLabel = labels.get(pKey);
      if (p.verdict.verdict === 'same-convention') {
        if (tLabel !== undefined) {
          changed = propose(pKey, tLabel.label, [...tLabel.chain, { pair: pairId(p), rule: `same-convention (${p.verdict.evidence} agreeing boundary subjects)` }]) || changed;
        }
        if (pLabel !== undefined) {
          changed = propose(tKey, pLabel.label, [...pLabel.chain, { pair: pairId(p), rule: `same-convention (${p.verdict.evidence} agreeing boundary subjects)` }]) || changed;
        }
      }
      if (p.verdict.verdict === 'agreement-only-h23') {
        // Excludes (timed=utc ∧ partner=local).
        if (pLabel?.label === 'local') changed = propose(tKey, 'local', [...pLabel.chain, { pair: pairId(p), rule: 'h23 agreement excludes timed-UTC against a local partner' }]) || changed;
        if (tLabel?.label === 'utc') changed = propose(pKey, 'utc', [...tLabel.chain, { pair: pairId(p), rule: 'h23 agreement excludes partner-local against a UTC timed side' }]) || changed;
      }
      if (p.verdict.verdict === 'agreement-only-h0') {
        // Excludes (timed=local ∧ partner=utc).
        if (pLabel?.label === 'utc') changed = propose(tKey, 'utc', [...pLabel.chain, { pair: pairId(p), rule: 'h0 agreement excludes timed-local against a UTC partner' }]) || changed;
        if (tLabel?.label === 'local') changed = propose(pKey, 'local', [...tLabel.chain, { pair: pairId(p), rule: 'h0 agreement excludes partner-UTC against a local timed side' }]) || changed;
      }
    }
    if (!changed) break;
  }

  // Assemble over the whole universe (sources with event claims), so a source
  // with no usable pair is an explicit unclassified row, never a silent
  // omission.
  const conflictPairDetail = new Map<string, string>();
  for (const p of sorted) {
    if (p.verdict.verdict !== 'conflicting-evidence') continue;
    for (const key of [sourceKey(p.timedLane, p.timedDataset), sourceKey(p.partnerLane, p.partnerDataset)]) {
      if (!conflictPairDetail.has(key)) conflictPairDetail.set(key, `${pairId(p)}: ${p.verdict.detail}`);
    }
  }
  const pairKeys = new Set(sorted.flatMap(p => [sourceKey(p.timedLane, p.timedDataset), sourceKey(p.partnerLane, p.partnerDataset)]));
  const partialOnly = new Set(
    sorted
      .filter(p => p.verdict.verdict === 'agreement-only-h23' || p.verdict.verdict === 'agreement-only-h0')
      .flatMap(p => [sourceKey(p.timedLane, p.timedDataset), sourceKey(p.partnerLane, p.partnerDataset)]),
  );

  return [...universe]
    .sort((a, b) => a.lane.localeCompare(b.lane) || a.dataset.localeCompare(b.dataset))
    .map(({ lane, dataset }) => {
      const key = sourceKey(lane, dataset);
      const conflict = conflicts.get(key);
      if (conflict !== undefined) {
        return { lane, dataset, label: null, status: 'conflicting-evidence' as const, reason: conflict, chain: [], corroboratingRoutes: 0 };
      }
      const label = labels.get(key);
      if (label !== undefined) {
        return { lane, dataset, label: label.label, status: 'classified' as const, reason: '', chain: label.chain, corroboratingRoutes: label.routes.size - 1 };
      }
      let reason = 'no pairwise experiment reaches this source (no shared record overlap with a time-of-day-bearing source)';
      if (conflictPairDetail.has(key)) reason = `its only firing pair conflicts — ${conflictPairDetail.get(key) ?? ''}`;
      else if (partialOnly.has(key)) reason = 'only a one-window agreement constraint (excludes one orientation) with no labelled partner to combine with';
      else if (pairKeys.has(key)) reason = 'pairs exist but none reaches the evidence floor with a summer boundary-window signal';
      return { lane, dataset, label: null, status: 'unclassified' as const, reason, chain: [], corroboratingRoutes: 0 };
    });
}

// --- The assembled picture ---------------------------------------------------

export interface TimezoneRendering {
  params: ClassifierParams;
  sources: SourceClassification[];
  sourceKinds: SourceKindRow[];
  pairs: ClassifiedPair[];
  minuteDeltas: MinuteDeltaRow[];
}

export function computeTimezoneRendering(source: string | ClaimsSource, params: ClassifierParams = DEFAULT_CLASSIFIER_PARAMS, bindings?: readonly TimedColumnBinding[]): TimezoneRendering {
  const claims = toClaimsSource(source);
  const sourceKinds = time('tz:source-kinds', () => foldSourceKinds(claims, bindings));
  const cells = time('tz:pair-cells', () => foldPairCells(claims, bindings));
  const minuteDeltas = time('tz:minute-deltas', () => foldMinuteDeltas(claims, bindings));

  // Aggregate cells into per-pair evidence and classify each pair.
  const byPair = new Map<string, PairEvidence>();
  for (const row of cells) {
    const key = `${row.timedLane}\n${row.timedDataset}\n${row.partnerLane}\n${row.partnerDataset}\n${row.kind}`;
    let e = byPair.get(key);
    if (e === undefined) {
      e = {
        timedLane: row.timedLane, timedDataset: row.timedDataset,
        partnerLane: row.partnerLane, partnerDataset: row.partnerDataset,
        kind: row.kind,
        utcShift: 0, localShift: 0, h23Agree: 0, h0Agree: 0,
        agreeNoSignal: 0, unexplained: 0, notComparable: 0, excluded: 0,
      };
      byPair.set(key, e);
    }
    switch (row.cell) {
      case 'utc-orientation-shift': e.utcShift += row.subjects; break;
      case 'local-orientation-shift': e.localShift += row.subjects; break;
      case 'h23-window-agreement': e.h23Agree += row.subjects; break;
      case 'h0-window-agreement': e.h0Agree += row.subjects; break;
      case 'agreement-no-signal': e.agreeNoSignal += row.subjects; break;
      case 'unexplained': e.unexplained += row.subjects; break;
      case 'not-comparable': e.notComparable += row.subjects; break;
      case 'transition-margin':
      case 'pre-bst-table': e.excluded += row.subjects; break;
    }
  }
  const pairs: ClassifiedPair[] = [...byPair.values()]
    .map(e => ({ ...e, verdict: classifyPair(e, params) }))
    .sort((a, b) => pairId(a).localeCompare(pairId(b)));

  // The classification universe: every source asserting at least one S1
  // event-date claim (a source with no dated column has no rendering to
  // classify and is out of scope by construction).
  const universeKeys = new Map<string, { lane: string; dataset: string }>();
  for (const row of sourceKinds) {
    universeKeys.set(sourceKey(row.lane, row.dataset), { lane: row.lane, dataset: row.dataset });
  }
  const sources = resolveSourceLabels(pairs, [...universeKeys.values()]);

  return { params, sources, sourceKinds, pairs, minuteDeltas };
}

export function buildTimezoneRendering(ledgerDir?: string, params: ClassifierParams = DEFAULT_CLASSIFIER_PARAMS): TimezoneRendering {
  const { source, dispose } = acquireClaimsSource(ledgerDir);
  try {
    return computeTimezoneRendering(source, params);
  } finally {
    dispose();
  }
}

// --- Rendering ---------------------------------------------------------------

function num(n: number): string {
  return n.toLocaleString('en-GB');
}

function mdCode(value: string): string {
  return `\`${value}\``;
}

const LABEL_GLOSSES: Record<RenderingLabel, string> = {
  utc: 'renders UTC',
  local: 'renders Europe/London local time',
};

const VERDICT_GLOSSES: ReadonlyMap<string, string> = new Map([
  ['differs-by-local-offset', 'the boundary experiment fired: the two renderings differ by the local offset, oriented under the two-candidate convention set'],
  ['same-convention', 'summer stamps in BOTH midnight-offset windows agree on the day — both orientations excluded, the two sides render under one convention (an equality edge; which convention comes from elsewhere in the chain)'],
  ['agreement-only-h23', 'only the hour-23 window has coverage and it agrees — excludes (timed=UTC ∧ partner=local) but leaves the reverse orientation untested; a partial constraint, classifying nothing alone'],
  ['agreement-only-h0', 'only the non-midnight hour-0 window has coverage and it agrees — excludes (timed=local ∧ partner=UTC) but leaves the reverse orientation untested; a partial constraint, classifying nothing alone'],
  ['no-boundary-signal', 'comparable overlap exists but carries no summer boundary-window stamps (winter-only overlap, or mid-day stamps only) — honestly undeterminable: GMT = UTC in winter, so agreement here is NOT evidence of same convention'],
  ['insufficient-evidence', 'boundary-window cells exist but below the evidence floor — not classified on a handful of rows'],
  ['conflicting-evidence', 'the cells contradict each other beyond the noise tolerance — a loud finding to examine (a re-stamping pipeline, or genuine consecutive-day revisions), never an average'],
]);

function chainCell(c: SourceClassification): string {
  if (c.chain.length === 0) return '—';
  const hops = c.chain.map((h, i) => `${i + 1}. ${mdCode(h.pair)} — ${h.rule}`).join('<br>');
  const extra = c.corroboratingRoutes > 0 ? `<br>(+${num(c.corroboratingRoutes)} additional corroborating route${c.corroboratingRoutes === 1 ? '' : 's'})` : '';
  return hops + extra;
}

export function renderTimezoneRendering(t: TimezoneRendering): string {
  const lines: string[] = [
    '# Timezone-rendering classification (per source)',
    '',
    'Which clock convention each source\'s date/datetime columns are rendered',
    'under (issue #858), classified by chained NATURAL EXPERIMENTS: two',
    'sources sharing records on the same event kind, at least one side',
    'carrying time-of-day, disagreeing by exactly one day ONLY in the',
    'midnight-offset window of BST-dated stamps — the UTC-vs-local',
    'day-truncation signature the #857 review proved on the wdtk-1141667 /',
    '2024-07-register pair. Every conclusion is **[derived]** — Ofcom states',
    'no timezone anywhere in any export — and is offered with its evidence',
    'chain named and re-runnable (`node src/ci/timezone-rendering.ts`),',
    'never adjudicated (issue #467). Sources with insufficient overlap are',
    'honestly UNCLASSIFIED, never guessed.',
    '',
    'The candidate convention set is **{UTC, Europe/London civil time}** — a',
    'stated assumption: these are the only conventions a UK regulator\'s',
    'export plausibly renders and the only two the one-day boundary',
    'experiment distinguishes; any third convention would surface loudly in',
    'the unexplained bucket.',
    '',
    'Binding caveats (issue #858):',
    '',
    '- **Season-limited detectability**: GMT = UTC in winter, so only',
    '  BST-dated boundary-crossing stamps discriminate. A pair with no such',
    '  overlap is honestly undeterminable — winter agreement is NOT evidence',
    '  of same convention.',
    '- **Same-upstream-instant assumption**: records revised between the two',
    '  exports are excluded (|day difference| > 1); a re-stamping pipeline',
    '  would surface as conflicting evidence, which is a loud finding here,',
    '  never averaged away.',
    '- **Per-export scope**: this classifies each EXPORT\'s rendering, not the',
    '  source system — the corpus itself shows the register\'s rendering',
    '  changing between exports.',
    '- **Scope**: the universe is every source asserting at least one S1',
    '  event-date claim. A dated column outside the S1 tier (e.g. the',
    '  forbidden-list disclosures\' `LastModifiedDate`, a documented S1',
    '  exclusion) is out of scope until that tier covers it.',
    '',
    `Evidence floor: ${num(t.params.minEvidenceSubjects)} subjects; noise tolerance: ${(t.params.noiseShare * 100).toFixed(0)}% of the supporting evidence.`,
    '',
    '## Per-source classification',
    '',
    'The annotation this report exists to derive. `[derived]` throughout;',
    'the chain column is the working — each hop names the exact pairwise',
    'experiment (re-runnable from the pairs table below) that carries the',
    'conclusion to this source. "Additional corroborating routes" counts',
    'further chains reaching the same label from a different anchoring',
    'experiment (routes may still share downstream equality edges, so they',
    'are additional evidence, not fully independent derivations).',
    '',
    '| source | rendering | evidence chain |',
    '|---|---|---|',
    ...t.sources.map((c) => {
      const label = c.status === 'classified' && c.label !== null
        ? `**${LABEL_GLOSSES[c.label]}** [derived]`
        : c.status === 'conflicting-evidence'
          ? `**conflicting evidence** — ${c.reason}`
          : `unclassified — ${c.reason}`;
      return `| ${mdCode(`${c.lane}/${c.dataset}`)} | ${label} | ${chainCell(c)} |`;
    }),
    '',
    '## Pairwise natural experiments',
    '',
    'One row per (timed source, partner source, event kind) sharing',
    'single-valued subjects. Cells: oriented one-day shifts in the two',
    'midnight-offset windows (utc→ / ←local), window agreements (a23 / a0),',
    'agreement with no orientation signal, unexplained one-day disagreements,',
    'not-comparable (revised between exports, excluded), and',
    'margin/pre-1996 exclusions.',
    '',
    '| timed source | partner source | kind | utc→ | ←local | a23 | a0 | agree (no signal) | unexplained | not comparable | excluded | verdict |',
    '|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|',
    ...t.pairs.map(p =>
      `| ${mdCode(`${p.timedLane}/${p.timedDataset}`)} | ${mdCode(`${p.partnerLane}/${p.partnerDataset}`)} | ${mdCode(p.kind)} | ${num(p.utcShift)} | ${num(p.localShift)} | ${num(p.h23Agree)} | ${num(p.h0Agree)} | ${num(p.agreeNoSignal)} | ${num(p.unexplained)} | ${num(p.notComparable)} | ${num(p.excluded)} | ${p.verdict.verdict}${p.verdict.verdict === 'differs-by-local-offset' ? ` (${p.verdict.utcSide} side = UTC)` : ''} |`),
    '',
    'Verdict vocabulary:',
    '',
    ...[...VERDICT_GLOSSES.entries()].map(([term, gloss]) => `- **${term}** — ${gloss}`),
    '',
    '## Minute-level corroboration (both sides timed)',
    '',
    'Where BOTH sides render time-of-day, the exact minute difference between',
    'the two rendered instants for shared single-valued subjects (bounded to',
    '±3 hours). Same convention ⇒ 0; UTC-vs-BST ⇒ ±60 for summer instants.',
    'Corroborates the day-boundary verdicts above; decided by neither alone.',
    '',
  ];

  if (t.minuteDeltas.length === 0) {
    lines.push('No pair has time-of-day on both sides.', '');
  } else {
    lines.push(
      '| source 1 | source 2 | kind | season | Δ minutes | subjects |',
      '|---|---|---|---|---|---:|',
      ...t.minuteDeltas.map(d =>
        `| ${mdCode(`${d.lane1}/${d.dataset1}`)} | ${mdCode(`${d.lane2}/${d.dataset2}`)} | ${mdCode(d.kind)} | ${d.season} | ${d.bucket} | ${num(d.subjects)} |`),
      '',
    );
  }

  lines.push(
    '## Time-of-day evidence base and batch-signature fingerprints',
    '',
    'Per (source, kind): the subjects asserting the kind, the single-valued',
    'timed subjects anchoring experiments (a column whose every time reads',
    '00:00 carries a time FORMAT but no clock information and anchors',
    'nothing), the summer midnight-offset-window stamps, and the modal hour.',
    'Under the documented local-midnight-batch prior (issue #857: bulk',
    'register jobs completing within minutes of local midnight), a summer',
    '23:xx cluster CORROBORATES a UTC rendering and a 00:xx cluster a local',
    'one — corroborating evidence only, never sole: fingerprints classify',
    'nothing without a pairwise experiment.',
    '',
    '| source | kind | vintage | subjects | multi-valued (excluded) | timed | summer 23:xx | summer 00:xx | modal hour |',
    '|---|---|---|---:|---:|---:|---:|---:|---|',
    ...t.sourceKinds.map(s =>
      `| ${mdCode(`${s.lane}/${s.dataset}`)} | ${mdCode(s.kind)} | ${s.vintage} | ${num(s.subjects)} | ${num(s.multiValuedSubjects)} | ${num(s.timedSubjects)} | ${num(s.summerH23)} | ${num(s.summerH0)} | ${s.topHour === null ? '—' : `${String(s.topHour).padStart(2, '0')}:xx (${num(s.topHourSubjects)})`} |`),
    '',
  );

  return lines.join('\n');
}

export const TIMEZONE_RENDERING_PATH = 'reports/timezone-rendering.md';

export function writeTimezoneRendering(): { path: string; changed: boolean } {
  const markdown = renderTimezoneRendering(buildTimezoneRendering());
  const target = path.resolve(process.cwd(), TIMEZONE_RENDERING_PATH);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const existing = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : undefined;
  const changed = existing !== markdown;
  if (changed) fs.writeFileSync(target, markdown);
  return { path: TIMEZONE_RENDERING_PATH, changed };
}

if (import.meta.main) {
  const { path: written, changed } = writeTimezoneRendering();
  console.log(`${changed ? 'wrote' : 'up to date'}: ${written}`);
  perfReport({ entrypoint: 'timezone-rendering' });
}
