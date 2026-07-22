/**
 * Survival and cohort analysis: the actuarial view of the register
 * (issue #865, building on S1 event claims + S2 episodes + S3 presence).
 *
 * The register, read as a life table. Over the S1 event-time claims
 * (src/v2/event-time-emit.ts) and the open-data snapshot-presence anchors
 * (the @listed claims), this fold derives: licence-lifetime distributions
 * (dated start/issue evidence → cancelled/vanished evidence), retention by
 * licence class and by era-cohort, and the reservation→reallocation picture
 * (which pairs with the two-year reservation policy test, issue #863).
 * It generalises the vanished-cohort narrative
 * (docs/narratives/the-vanished-cohort.md) from one story into a mechanism.
 *
 * Epistemics (binding, and the reason most of this module is caveat rather
 * than curve):
 *
 *  - RIGHT-CENSORING IS FIRST-CLASS. Most licences are still alive: they sit
 *    in the newest declared-complete export with no dated end. A survival
 *    curve built only from the observed ends would be catastrophically
 *    biased, so every curve states its censored count, and the age curve is
 *    explicitly the age of the LIVING (right-censored at the latest vintage),
 *    never a completed-lifespan distribution.
 *
 *  - "VANISHED" IS EVIDENCE-OF-ABSENCE-FROM-EXPORTS, NEVER DEATH. A subject
 *    absent from the newest declared-complete export is not "cancelled",
 *    "available", or "expired": absence of a row is non-observation (the
 *    availability trap, docs/narratives/the-vanished-cohort.md). It is
 *    counted on its OWN curve, apart from the dated-cancellation ends, and
 *    described only as "no longer published".
 *
 *  - THE DENOMINATORS ARE SPARSE AND KIND-DEPENDENT. Start dates, cancellation
 *    dates and reservation windows are each attested by a different, small set
 *    of disclosures — and the two ends of a lifespan (start, cancellation) are
 *    attested by STRUCTURALLY DIFFERENT disclosures (the allocated/issued
 *    register vs the reserved-callsigns disclosure), so a joined
 *    start→cancellation lifespan is near-absent by construction. Every curve
 *    names its asserting-vintage basis and its dated-evidence coverage.
 *
 *  - BOOKKEEPING NEVER READS AS A LIFECYCLE EVENT (issue #801, the S2 episode
 *    discipline). The created/last-modified/version-last-modified stamps
 *    cluster onto mass-update episode days (the Jul–Aug 2016 migration; the
 *    2025-10 touch): tens of thousands of identical stamps are ONE system
 *    episode, not per-record births or deaths. Those system-presence kinds are
 *    EXCLUDED from every lifecycle curve here (only the licence-start /
 *    licence-end / reservation-end contribution kinds feed a curve), so a
 *    bookkeeping stamp inside an episode can never be mistaken for a licence
 *    beginning or ending. The kind→contribution registry is imported from the
 *    S3 engine (contributionOf), total over the authored kind vocabulary, so a
 *    new S1 kind forces an authored decision before it can join a curve.
 *
 *  - FLAGS, NEVER VERDICTS (issue #467). A same-day start/cancellation
 *    coincidence, a reservation window that outlasts the stated two-year
 *    policy, a divergent retention rate — each is recorded with candidate
 *    explanations and adjudicated nowhere.
 *
 * FOLD, not re-parse (issue #361): everything is DuckDB SQL over the claim
 * ledger (the shared deploy-time claims.parquet where present, else the
 * per-source JSONL), restricted to the S1 tier's named rule and the @listed
 * anchor. Committed as reports/survival-cohort.md, byte-deterministic (every
 * query carries a total ORDER BY), so a new vintage shifting the actuarial
 * picture shows up as a PR diff. Narrative candidates feed issue #292.
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
  EVENT_DATE_KINDS,
  LISTED_PREDICATE,
  IMPLIED_CLASS_PREDICATE,
} from '../v2/claim.ts';
import { contributionOf } from './state-at-t.ts';
import { acquireClaimsSource, type ClaimsSourceHandle } from './event-time-coherency.ts';
import { listArchiveKeys } from '../shared/archive.ts';
import { DIRS } from '../shared/constants.ts';
import { parseJsonObject } from '../shared/json-shape.ts';
import { type ArchiveMeta } from '../shared/utils.ts';
import { time, perfReport } from '../shared/perf.ts';

// --- The lifecycle kind groupings (authored via the S3 contribution registry) -
//
// Only these three contributions feed a lifecycle curve. system-presence
// (record/licence created + last-modified, licence-version-last-modified) is
// DELIBERATELY excluded: those stamps are the mass-update episodes' material
// (issue #801), never a licence birth or death. Deriving the sets through
// contributionOf keeps them total over EVENT_DATE_KINDS — a newly-authored S1
// kind forces a contribution decision in state-at-t before it can appear here.
function kindsWithContribution(contribution: string): string[] {
  return EVENT_DATE_KINDS.filter(kind => contributionOf(kind) === contribution);
}

export const START_KINDS: readonly string[] = kindsWithContribution('licence-start');
export const END_KINDS: readonly string[] = kindsWithContribution('licence-end');
export const RESERVATION_KINDS: readonly string[] = kindsWithContribution('reservation-end');

// The pre-1977 reliability boundary (issue #565): original start dates before
// 1977 are attested-unreliable, so the age curve splits at it rather than
// silently mixing an unreliable tail into the reliable body.
const PRE_1977_BOUNDARY = '1977-01-01';

// The stated two-year reservation cooling window (issue #863's first policy
// case; FOI 756622's Allocated/Reserved definitions), in days — the threshold
// the reservation summary counts exceedances against. A window whose stated
// end sits more than this beyond its own asserting vintage is a candidate
// policy exception, never an adjudicated one.
const TWO_YEAR_DAYS = 730;
// Issue #568's reserved-over-five-years observation, the same shape one step out.
const FIVE_YEAR_DAYS = 1826;
// The far-future sentinel the reserved-until column uses for an open-ended
// (indefinite) reservation — reported on its own line, never averaged in.
const INDEFINITE_RESERVED_TO = '2099-12-31';

// --- Authored age buckets ---------------------------------------------------
//
// Whole-year spans, an authored partition so the curve regenerates
// byte-identically regardless of the counts. `[lo, hi)` in years; the last
// bucket is open-topped. Rendered in this order.
interface AgeBucket { id: string; label: string; lo: number; hi: number | null }
const AGE_BUCKETS: readonly AgeBucket[] = [
  { id: 'a', label: 'under 5 years', lo: 0, hi: 5 },
  { id: 'b', label: '5–9 years', lo: 5, hi: 10 },
  { id: 'c', label: '10–19 years', lo: 10, hi: 20 },
  { id: 'd', label: '20–39 years', lo: 20, hi: 40 },
  { id: 'e', label: '40–59 years', lo: 40, hi: 60 },
  { id: 'f', label: '60 years or more', lo: 60, hi: null },
];

// The SQL CASE mapping a year span to an authored bucket id (kept beside the
// bucket table so the two never drift).
function ageBucketCase(spanExpr: string): string {
  const arms = AGE_BUCKETS.map(b =>
    b.hi === null
      ? `ELSE '${b.id}'`
      : `WHEN ${spanExpr} < ${b.hi} THEN '${b.id}'`);
  return `CASE ${arms.join(' ')} END`;
}

// --- Declared-complete open-data vintages -----------------------------------
//
// The presence axis (which vintages a subject is @listed in) is judged ONLY
// against declared-complete open-data publications — the same discipline the
// vanished-cohort narrative applies: a truncated fetch (the 1,074-row
// 2025-05-27 / 2025-06-08 partials) is set aside so a subject absent from a
// broken export is never mistaken for one that vanished. A missing
// intendedCoverage defaults to complete (the frozen-baseline shape and the
// report-sweep fixtures carry none). Returns keys chronologically; the last is
// the latest declared-complete vintage — the censoring horizon and the
// retention endpoint.
export function declaredCompleteOpenDataVintages(): string[] {
  return listArchiveKeys().filter(key => {
    const metaPath = path.join(DIRS.archive, key, 'meta.json');
    if (!fs.existsSync(metaPath)) return false;
    try {
      const meta = parseJsonObject(fs.readFileSync(metaPath, 'utf8'), metaPath) as ArchiveMeta;
      return meta.intendedCoverage?.complete !== false;
    } catch {
      return false;
    }
  });
}

// --- Result shapes ----------------------------------------------------------

// Per lifecycle kind: how much dated evidence exists at all — the "coverage is
// sparse, here is how sparse" basis every curve rests on.
export interface KindCoverageRow {
  kind: string;
  contribution: string;
  subjects: number;
  datasets: number;
  earliest: string;
  latest: string;
}

// The outcome taxonomy over subjects present in ANY declared-complete open-data
// vintage. Four authored outcomes; the vanished one is the vanished-cohort
// narrative's mechanism, generalised.
export type Outcome = 'still-listed' | 'cancelled-still-listed' | 'cancelled-and-departed' | 'vanished';
export interface OutcomeRow { outcome: Outcome; subjects: number }

// One cell of the age-of-the-living curve (Curve A): a reliability era × an
// age bucket, and how many currently-listed licences fall in it.
export interface LivingAgeRow { era: 'from-1977' | 'pre-1977'; bucketId: string; subjects: number }

// The observed-ends summary (Curve A2): the near-absence of a joined
// start→cancellation lifespan, stated as figures rather than a manufactured
// curve.
export interface ObservedEndsSummary {
  cancelSubjects: number;      // subjects carrying any cancellation date
  pairedWithStart: number;     // …that also carry a start on or before it
  sameDay: number;             // …whose latest such start is the SAME day as the cancellation
  positiveSpan: number;        // …whose start is strictly before the cancellation
  spanAtLeastOneYear: number;  // …by at least a whole year (the only genuinely observed lifespans)
}

// One era-cohort row (Curve B): subjects by the decade of their earliest
// attested licence-start, and their outcome split.
export interface EraCohortRow {
  decade: string;
  subjects: number;
  stillListed: number;
  cancelledDeparted: number;
  vanished: number;
}

// One licence-class retention row (Curve C): subjects present in the base
// (earliest declared-complete) vintage under a resolved implied class, and how
// many are still present in the latest.
export interface ClassRetentionRow {
  licenceClass: string;
  base: number;
  stillListed: number;
}

// The reservation→reallocation summary (Curve D).
export interface ReservationSummary {
  claims: number;
  subjects: number;
  indefinite: number;          // reserved-until = the far-future sentinel
  overTwoYears: number;        // stated end > 2y beyond its asserting vintage (issue #863 candidate exception)
  overFiveYears: number;       // …> 5y (issue #568)
  retrospective: number;       // stated end BEFORE its asserting vintage (the reserved-cohort-ambiguity: a termination record, not a future window)
  withLaterStart: number;      // reserved subjects later carrying start evidence dated after the reservation — a reallocation signal
  endYears: { year: string; claims: number }[];
}

export interface SurvivalCohort {
  latestVintage: string | null;
  baseVintage: string | null;
  declaredCompleteVintages: string[];
  coverage: KindCoverageRow[];
  outcomes: OutcomeRow[];
  livingAge: LivingAgeRow[];
  observedEnds: ObservedEndsSummary;
  eraCohort: EraCohortRow[];
  classRetention: ClassRetentionRow[];
  reservation: ReservationSummary;
}

// --- SQL helpers ------------------------------------------------------------

function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function sqlList(values: readonly string[]): string {
  return values.map(sqlLiteral).join(', ');
}

// The subject model every curve folds: one row per cleaned subject, carrying
// its earliest attested licence-start, its cancellation date (the latest, so a
// re-cancellation is not lost), and its declared-complete open-data presence
// (first/last vintage, and whether it survives into the latest). Assembled as a
// reusable CTE prefix (no leading WITH) so each fold appends its own SELECT.
// Subjects that clean to nothing cannot be tracked and are excluded here (they
// stay in the ledger).
function subjectModelCtes(source: ClaimsSource, vintages: readonly string[], latest: string): string {
  const key = cleanedKeyExpr('rawSubject');
  return `claims AS (
  SELECT * FROM ${claimsRelation(source)}
),
ev AS (
  SELECT ${key} AS subject, substr(predicate, ${EVENT_DATE_PREDICATE_PREFIX.length + 1}) AS kind, object AS "day"
  FROM claims
  WHERE rule = '${EVENT_DATE_RULE}' AND predicate LIKE '${EVENT_DATE_PREDICATE_PREFIX}%' AND ${key} <> ''
),
start_days AS (SELECT subject, "day" FROM ev WHERE kind IN (${sqlList(START_KINDS)})),
starts AS (SELECT subject, min("day") AS start_min FROM start_days GROUP BY subject),
cancels AS (SELECT subject, max("day") AS cancel_day FROM ev WHERE kind IN (${sqlList(END_KINDS)}) GROUP BY subject),
od AS (
  SELECT DISTINCT ${key} AS subject, split_part(sourceFile, '/', 2) AS v
  FROM claims
  WHERE predicate = '${LISTED_PREDICATE}' AND sourceFile LIKE 'opendata/%'
    AND split_part(sourceFile, '/', 2) IN (${sqlList(vintages)}) AND ${key} <> ''
),
pres AS (
  SELECT subject, min(v) AS first_od, max(v) AS last_od, bool_or(v = ${sqlLiteral(latest)}) AS present_latest
  FROM od GROUP BY subject
),
subjects AS (
  SELECT subject FROM starts
  UNION SELECT subject FROM cancels
  UNION SELECT subject FROM pres
),
subj AS (
  SELECT s.subject,
         st.start_min,
         c.cancel_day,
         p.first_od, p.last_od,
         COALESCE(p.present_latest, FALSE) AS present_latest,
         (p.subject IS NOT NULL) AS has_od
  FROM subjects s
  LEFT JOIN starts st USING (subject)
  LEFT JOIN cancels c USING (subject)
  LEFT JOIN pres p USING (subject)
)`;
}

// Every fold guards on claimsSourcePresent (the report-fold convention): an
// absent or empty claims source folds to the empty result rather than reaching
// DuckDB, whose read_json errors on a glob matching nothing.

// Per-kind dated coverage across the whole corpus — the sparsity basis.
export function foldKindCoverage(source: string | ClaimsSource): KindCoverageRow[] {
  const claims = toClaimsSource(source);
  if (!claimsSourcePresent(claims)) return [];
  const key = cleanedKeyExpr('rawSubject');
  const rows = foldQuery<Omit<KindCoverageRow, 'contribution'>>(`WITH ev AS (
  SELECT ${key} AS subject, substr(predicate, ${EVENT_DATE_PREDICATE_PREFIX.length + 1}) AS kind,
         split_part(sourceFile, '/', 2) AS dataset, object AS "day"
  FROM ${claimsRelation(claims)}
  WHERE rule = '${EVENT_DATE_RULE}' AND predicate LIKE '${EVENT_DATE_PREDICATE_PREFIX}%' AND ${key} <> ''
)
SELECT kind, count(DISTINCT subject)::BIGINT AS subjects, count(DISTINCT dataset)::BIGINT AS datasets,
       min("day") AS earliest, max("day") AS latest
FROM ev
WHERE kind IN (${sqlList([...START_KINDS, ...END_KINDS, ...RESERVATION_KINDS])})
GROUP BY kind
ORDER BY kind`);
  return rows.map(r => ({ ...r, contribution: contributionOf(r.kind) }));
}

// The outcome taxonomy over declared-complete open-data presence.
export function foldOutcomes(source: string | ClaimsSource, vintages: readonly string[], latest: string): OutcomeRow[] {
  const claims = toClaimsSource(source);
  if (!claimsSourcePresent(claims)) return [];
  const rows = foldQuery<{ present_latest: boolean; has_cancel: boolean; subjects: number }>(`WITH ${subjectModelCtes(claims, vintages, latest)}
SELECT present_latest, (cancel_day IS NOT NULL) AS has_cancel, count(*)::BIGINT AS subjects
FROM subj WHERE has_od
GROUP BY present_latest, (cancel_day IS NOT NULL)
ORDER BY present_latest, has_cancel`);
  const outcomeFor = (presentLatest: boolean, hasCancel: boolean): Outcome =>
    presentLatest
      ? (hasCancel ? 'cancelled-still-listed' : 'still-listed')
      : (hasCancel ? 'cancelled-and-departed' : 'vanished');
  const totals = new Map<Outcome, number>();
  for (const r of rows) {
    const outcome = outcomeFor(r.present_latest, r.has_cancel);
    totals.set(outcome, (totals.get(outcome) ?? 0) + r.subjects);
  }
  const order: Outcome[] = ['still-listed', 'cancelled-still-listed', 'cancelled-and-departed', 'vanished'];
  return order.map(outcome => ({ outcome, subjects: totals.get(outcome) ?? 0 }));
}

// Curve A: the age of the LIVING (currently-listed licences with a start date),
// right-censored at the latest vintage. Split by the pre-1977 reliability era.
export function foldLivingAge(source: string | ClaimsSource, vintages: readonly string[], latest: string): LivingAgeRow[] {
  const claims = toClaimsSource(source);
  if (!claimsSourcePresent(claims)) return [];
  const span = `date_diff('year', CAST(start_min AS DATE), CAST(${sqlLiteral(latest)} AS DATE))`;
  return foldQuery<LivingAgeRow>(`WITH ${subjectModelCtes(claims, vintages, latest)}
SELECT CASE WHEN start_min < '${PRE_1977_BOUNDARY}' THEN 'pre-1977' ELSE 'from-1977' END AS era,
       ${ageBucketCase(span)} AS "bucketId",
       count(*)::BIGINT AS subjects
FROM subj
WHERE has_od AND present_latest AND start_min IS NOT NULL
GROUP BY era, "bucketId"
ORDER BY era, "bucketId"`);
}

// Curve A2: the observed-ends sparsity, as figures. A cancellation pairs with a
// start only when a start is dated on or before it (latest such start); a
// genuine observed lifespan needs that start strictly earlier still.
export function foldObservedEnds(source: string | ClaimsSource): ObservedEndsSummary {
  const empty: ObservedEndsSummary = { cancelSubjects: 0, pairedWithStart: 0, sameDay: 0, positiveSpan: 0, spanAtLeastOneYear: 0 };
  const claims = toClaimsSource(source);
  if (!claimsSourcePresent(claims)) return empty;
  const key = cleanedKeyExpr('rawSubject');
  const rows = foldQuery<ObservedEndsSummary>(`WITH ev AS (
  SELECT ${key} AS subject, substr(predicate, ${EVENT_DATE_PREDICATE_PREFIX.length + 1}) AS kind, object AS "day"
  FROM ${claimsRelation(claims)}
  WHERE rule = '${EVENT_DATE_RULE}' AND predicate LIKE '${EVENT_DATE_PREDICATE_PREFIX}%' AND ${key} <> ''
),
start_days AS (SELECT subject, "day" FROM ev WHERE kind IN (${sqlList(START_KINDS)})),
cancels AS (SELECT subject, max("day") AS cancel_day FROM ev WHERE kind IN (${sqlList(END_KINDS)}) GROUP BY subject),
paired AS (
  SELECT c.subject, c.cancel_day, max(s."day") AS start_le
  FROM cancels c JOIN start_days s ON s.subject = c.subject AND s."day" <= c.cancel_day
  GROUP BY c.subject, c.cancel_day
)
SELECT (SELECT count(*) FROM cancels)::BIGINT AS "cancelSubjects",
       (SELECT count(*) FROM paired)::BIGINT AS "pairedWithStart",
       (SELECT count(*) FROM paired WHERE start_le = cancel_day)::BIGINT AS "sameDay",
       (SELECT count(*) FROM paired WHERE start_le < cancel_day)::BIGINT AS "positiveSpan",
       (SELECT count(*) FROM paired WHERE date_diff('year', CAST(start_le AS DATE), CAST(cancel_day AS DATE)) >= 1)::BIGINT AS "spanAtLeastOneYear"`);
  return rows[0] ?? empty;
}

// Curve B: era-cohort by the decade of a subject's earliest attested start,
// with its outcome split. Over subjects that both carry a start and appear in a
// declared-complete open-data vintage (so retention is defined).
export function foldEraCohort(source: string | ClaimsSource, vintages: readonly string[], latest: string): EraCohortRow[] {
  const claims = toClaimsSource(source);
  if (!claimsSourcePresent(claims)) return [];
  return foldQuery<EraCohortRow>(`WITH ${subjectModelCtes(claims, vintages, latest)}
SELECT substr(start_min, 1, 3) || '0s' AS decade,
       count(*)::BIGINT AS subjects,
       count(*) FILTER (WHERE present_latest)::BIGINT AS "stillListed",
       count(*) FILTER (WHERE NOT present_latest AND cancel_day IS NOT NULL)::BIGINT AS "cancelledDeparted",
       count(*) FILTER (WHERE NOT present_latest AND cancel_day IS NULL)::BIGINT AS "vanished"
FROM subj
WHERE has_od AND start_min IS NOT NULL
GROUP BY decade
ORDER BY decade`);
}

// Curve C: licence-class retention across the mirror's own observation window —
// subjects present in the base (earliest declared-complete) vintage under a
// resolved prefix-implied class, and how many survive into the latest. The
// class is the S1/T1 implied_class derived claim, joined to the @listed anchor
// on the observation key (sourceFile, ordinal); an anchor with no such claim
// (an unparseable token) is bucketed '(unresolved)', never dropped.
export function foldClassRetention(source: string | ClaimsSource, base: string, latest: string): ClassRetentionRow[] {
  const claims = toClaimsSource(source);
  if (!claimsSourcePresent(claims)) return [];
  const key = cleanedKeyExpr('rawSubject');
  return foldQuery<ClassRetentionRow>(`WITH claims AS (
  SELECT * FROM ${claimsRelation(claims)}
),
listed AS (
  SELECT ${key} AS subject, sourceFile, ordinal, split_part(sourceFile, '/', 2) AS v
  FROM claims WHERE predicate = '${LISTED_PREDICATE}' AND sourceFile LIKE 'opendata/%' AND ${key} <> ''
),
impl AS (
  SELECT sourceFile, ordinal, object AS cls
  FROM claims WHERE layer = 'derived' AND predicate = '${IMPLIED_CLASS_PREDICATE}'
),
base_rows AS (
  SELECT DISTINCT l.subject, COALESCE(i.cls, '(unresolved)') AS cls
  FROM listed l LEFT JOIN impl i USING (sourceFile, ordinal)
  WHERE l.v = ${sqlLiteral(base)}
),
latest_subjects AS (SELECT DISTINCT subject FROM listed WHERE v = ${sqlLiteral(latest)})
SELECT b.cls AS "licenceClass",
       count(*)::BIGINT AS base,
       count(*) FILTER (WHERE ls.subject IS NOT NULL)::BIGINT AS "stillListed"
FROM base_rows b LEFT JOIN latest_subjects ls USING (subject)
GROUP BY b.cls
ORDER BY count(*) DESC, b.cls`);
}

// Curve D: the reservation→reallocation summary. reserved-until windows judged
// against the two-year policy (issue #863) and their assertion vintage, plus a
// coarse reallocation signal (a later start-evidence date). The window's START
// is nowhere attested (the S3 reservation-window-start-unattested rule), so the
// "window" measured is stated-end minus asserting-vintage, never a true length.
export function foldReservation(source: string | ClaimsSource): ReservationSummary {
  const empty: ReservationSummary = {
    claims: 0, subjects: 0, indefinite: 0, overTwoYears: 0, overFiveYears: 0,
    retrospective: 0, withLaterStart: 0, endYears: [],
  };
  const claims = toClaimsSource(source);
  if (!claimsSourcePresent(claims)) return empty;
  if (RESERVATION_KINDS.length === 0) return empty;
  const key = cleanedKeyExpr('rawSubject');
  // The assertion day: a day-keyed vintage is itself; a month-keyed vintage is
  // read at its first day (conservative — the window is at LEAST this long).
  const vday = `CASE WHEN length(vintage) = 7 THEN vintage || '-01' ELSE vintage END`;
  const common = `WITH ev AS (
  SELECT ${key} AS subject, substr(predicate, ${EVENT_DATE_PREDICATE_PREFIX.length + 1}) AS kind, vintage, object AS "day"
  FROM ${claimsRelation(claims)}
  WHERE rule = '${EVENT_DATE_RULE}' AND predicate LIKE '${EVENT_DATE_PREDICATE_PREFIX}%' AND ${key} <> ''
),
rv AS (SELECT subject, vintage, "day" AS rend, ${vday} AS vday FROM ev WHERE kind IN (${sqlList(RESERVATION_KINDS)})),
starts AS (SELECT subject, max("day") AS start_max FROM ev WHERE kind IN (${sqlList(START_KINDS)}) GROUP BY subject)`;
  const summary = foldQuery<Omit<ReservationSummary, 'endYears'>>(`${common}
SELECT count(*)::BIGINT AS claims,
       count(DISTINCT subject)::BIGINT AS subjects,
       count(*) FILTER (WHERE rend = '${INDEFINITE_RESERVED_TO}')::BIGINT AS indefinite,
       count(*) FILTER (WHERE rend <> '${INDEFINITE_RESERVED_TO}' AND date_diff('day', CAST(vday AS DATE), CAST(rend AS DATE)) > ${TWO_YEAR_DAYS})::BIGINT AS "overTwoYears",
       count(*) FILTER (WHERE rend <> '${INDEFINITE_RESERVED_TO}' AND date_diff('day', CAST(vday AS DATE), CAST(rend AS DATE)) > ${FIVE_YEAR_DAYS})::BIGINT AS "overFiveYears",
       count(*) FILTER (WHERE rend <> '${INDEFINITE_RESERVED_TO}' AND CAST(rend AS DATE) < CAST(vday AS DATE))::BIGINT AS retrospective,
       (SELECT count(DISTINCT r.subject) FROM rv r JOIN starts s ON s.subject = r.subject AND s.start_max > r.vday)::BIGINT AS "withLaterStart"
FROM rv`);
  const endYears = foldQuery<{ year: string; claims: number }>(`${common}
SELECT substr(rend, 1, 4) AS year, count(*)::BIGINT AS claims FROM rv GROUP BY year ORDER BY year`);
  const base = summary[0] ?? { ...empty };
  return { ...base, endYears };
}

// --- Assemble ---------------------------------------------------------------

export function computeSurvivalCohort(source: string | ClaimsSource, vintages: string[] = declaredCompleteOpenDataVintages()): SurvivalCohort {
  const claims = toClaimsSource(source);
  const latest = vintages.length > 0 ? vintages[vintages.length - 1] : null;
  const base = vintages.length > 0 ? vintages[0] : null;
  const emptyEnds: ObservedEndsSummary = { cancelSubjects: 0, pairedWithStart: 0, sameDay: 0, positiveSpan: 0, spanAtLeastOneYear: 0 };
  const emptyReservation: ReservationSummary = {
    claims: 0, subjects: 0, indefinite: 0, overTwoYears: 0, overFiveYears: 0, retrospective: 0, withLaterStart: 0, endYears: [],
  };
  if (latest === null || base === null) {
    return {
      latestVintage: latest, baseVintage: base, declaredCompleteVintages: vintages,
      coverage: [], outcomes: [], livingAge: [], observedEnds: emptyEnds, eraCohort: [], classRetention: [], reservation: emptyReservation,
    };
  }
  const coverage = time('survival:coverage', () => foldKindCoverage(claims));
  const outcomes = time('survival:outcomes', () => foldOutcomes(claims, vintages, latest));
  const livingAge = time('survival:living-age', () => foldLivingAge(claims, vintages, latest));
  const observedEnds = time('survival:observed-ends', () => foldObservedEnds(claims));
  const eraCohort = time('survival:era-cohort', () => foldEraCohort(claims, vintages, latest));
  const classRetention = time('survival:class-retention', () => foldClassRetention(claims, base, latest));
  const reservation = time('survival:reservation', () => foldReservation(claims));
  return {
    latestVintage: latest, baseVintage: base, declaredCompleteVintages: vintages,
    coverage, outcomes, livingAge, observedEnds, eraCohort, classRetention, reservation,
  };
}

// Like the other ledger folds: an explicit ledger directory folds directly
// (tests, fixtures); otherwise the shared deploy-time claims.parquet where the
// workflow built one; otherwise materialise the corpus ledger on demand.
export function buildSurvivalCohort(ledgerDir?: string): SurvivalCohort {
  const handle: ClaimsSourceHandle = acquireClaimsSource(ledgerDir);
  try {
    return computeSurvivalCohort(handle.source);
  } finally {
    handle.dispose();
  }
}

// --- Rendering --------------------------------------------------------------

function num(n: number): string {
  return n.toLocaleString('en-GB');
}

function pct(numerator: number, denominator: number): string {
  return denominator === 0 ? '—' : `${((numerator / denominator) * 100).toFixed(1)}%`;
}

function mdCode(value: string): string {
  return `\`${value}\``;
}

const OUTCOME_GLOSSES: ReadonlyMap<Outcome, string> = new Map([
  ['still-listed', 'present in the latest declared-complete open-data export with no dated cancellation — RIGHT-CENSORED (alive): no end has been observed, and this is the overwhelming majority'],
  ['cancelled-still-listed', 'carries a dated cancellation yet is STILL present in the latest export — the cancellation pre-dates the current listing (the reserved-callsigns cohort re-appearing as reserved); recorded, not adjudicated'],
  ['cancelled-and-departed', 'carries a dated cancellation AND is absent from the latest export — a dated end that coincides with departure from the exports'],
  ['vanished', 'absent from the latest declared-complete export with NO dated cancellation — evidence-of-absence-from-exports, NEVER death: absence of a row is non-observation (the availability trap), and this reads only as "no longer published"'],
]);

export function renderSurvivalCohort(c: SurvivalCohort): string {
  const lines: string[] = [
    '# Survival and cohort analysis (the register as a life table)',
    '',
    'The actuarial view of the register (issue #865), folded from the S1',
    'event-time claims and the open-data snapshot-presence anchors: licence',
    'lifetime distributions, retention by licence class and era-cohort, and the',
    'reservation→reallocation picture. It generalises the vanished-cohort',
    'narrative (`docs/narratives/the-vanished-cohort.md`) from one story into a',
    'mechanism. Regenerated and committed, so a new vintage shifting the picture',
    'shows up as a PR diff.',
    '',
    '**Right-censoring is first-class.** Most licences are still alive — present',
    'in the newest declared-complete export with no dated end — so every curve',
    'states its censored count, and the age curve below is explicitly the age of',
    'the LIVING (censored at the latest vintage), never a completed-lifespan',
    'distribution. **"Vanished" is evidence-of-absence-from-exports, never',
    'death** (the availability trap): a subject absent from the newest export is',
    'not cancelled, available, or expired — only "no longer published".',
    '**The denominators are sparse and kind-dependent**, stated per curve.',
    '**Bookkeeping never reads as a lifecycle event** (issue #801): the',
    'created / last-modified / version-last-modified stamps cluster onto',
    'mass-update episode days and are EXCLUDED from every curve here — only the',
    'licence-start, licence-end and reservation-end kinds feed a curve.',
    '**Flags, never verdicts** (issue #467).',
    '',
  ];

  if (c.latestVintage === null) {
    lines.push('No declared-complete open-data vintage is held, so no cohort can be formed. This is "no data", not an empty register.', '');
    return lines.join('\n');
  }

  lines.push(
    `Presence is judged against the **${num(c.declaredCompleteVintages.length)} declared-complete open-data`,
    `vintages** held (${mdCode(c.baseVintage ?? '')} … ${mdCode(c.latestVintage)}); the`,
    'truncated partial fetches are set aside, exactly as the vanished-cohort',
    `narrative sets them aside. The latest, ${mdCode(c.latestVintage)}, is the`,
    'censoring horizon and the retention endpoint. Subjects join across',
    'publications on the `cleaned` callsign key (a join key, not an identity).',
    '',
    '## Dated-evidence coverage (why the denominators are sparse)',
    '',
    'How much dated lifecycle evidence the whole corpus holds, per kind. Start',
    'and cancellation dates are attested by different, small sets of',
    'disclosures — and the two ends of a lifespan are attested by',
    'STRUCTURALLY DIFFERENT disclosures — so a joined start→cancellation',
    'lifespan is near-absent by construction (see the observed-ends section).',
    'Start-date kinds carry the earliest-surviving (#800) and pre-1977 (#565)',
    'unreliability caveats.',
    '',
    '| event kind | contribution | subjects | datasets | earliest | latest |',
    '|---|---|---:|---:|---|---|',
    ...c.coverage.map(r =>
      `| ${mdCode(r.kind)} | ${r.contribution} | ${num(r.subjects)} | ${num(r.datasets)} | ${r.earliest} | ${r.latest} |`),
    '',
    '## Outcome taxonomy',
    '',
    'Every subject present in any declared-complete open-data vintage, by',
    'outcome. Each term is used only with this meaning:',
    '',
    ...c.outcomes.map(o => `- **${o.outcome}** (${num(o.subjects)}) — ${OUTCOME_GLOSSES.get(o.outcome) ?? ''}`),
    '',
  );

  const outcomeTotal = c.outcomes.reduce((sum, o) => sum + o.subjects, 0);
  const stillListed = c.outcomes.find(o => o.outcome === 'still-listed')?.subjects ?? 0;
  const cancelledListed = c.outcomes.find(o => o.outcome === 'cancelled-still-listed')?.subjects ?? 0;
  lines.push(
    '| outcome | subjects | share |',
    '|---|---:|---:|',
    ...c.outcomes.map(o => `| ${o.outcome} | ${num(o.subjects)} | ${pct(o.subjects, outcomeTotal)} |`),
    `| **total** | **${num(outcomeTotal)}** | — |`,
    '',
    `The censored share is decisive: **${pct(stillListed + cancelledListed, outcomeTotal)}** of`,
    'subjects are still listed in the latest export (alive/right-censored). A',
    'survival curve read off the observed ends alone would be catastrophically',
    'biased, which is why the next section is the age of the living, not a',
    'completed-lifespan curve.',
    '',
    '## Curve A — age of currently-listed licences (right-censored)',
    '',
    'For every subject still listed in the latest declared-complete export that',
    'carries a start date, its age = whole years from its earliest attested',
    `licence-start to ${mdCode(c.latestVintage)}. These are ALL right-censored`,
    '(no observed end), split by the pre-1977 reliability boundary (#565): the',
    'pre-1977 body is attested-unreliable and shown apart rather than mixed in.',
    'The start date is the earliest SURVIVING one in the corpus (#800), so a',
    'true first start may be earlier and an age here is a lower bound.',
    '',
  );
  lines.push(...renderLivingAge(c.livingAge));

  const oe = c.observedEnds;
  lines.push(
    '',
    '## Curve A2 — observed complete lifespans are near-absent',
    '',
    'The honest complement to Curve A: a fully-observed lifespan needs a dated',
    'start AND a dated cancellation for the same licence. The corpus barely',
    'supports one.',
    '',
    `- **${num(oe.cancelSubjects)}** subjects carry a dated cancellation at all (a single disclosure attests them).`,
    `- **${num(oe.pairedWithStart)}** of those also carry a start dated on or before the cancellation.`,
    `- **${num(oe.sameDay)}** of THOSE have their latest such start on the SAME day as the cancellation — the two columns record one event, not a licence that began and ended (candidate: a reservation record carrying one date in both fields; not adjudicated).`,
    `- Only **${num(oe.positiveSpan)}** have a start strictly before the cancellation, and **${num(oe.spanAtLeastOneYear)}** by at least a whole year — the only genuinely observed lifespans in the whole corpus.`,
    '',
    'So there is no completed-lifespan distribution to draw: the two ends of a',
    'licence life are attested by structurally different disclosures (the',
    'allocated/issued register vs the reserved-callsigns disclosure), and where',
    'they meet they coincide. This is a coverage finding, stated rather than',
    'papered over.',
    '',
    '## Curve B — retention by era-cohort',
    '',
    'Cohort definition (authored): a subject belongs to the decade of its',
    '**earliest attested licence-start date**. Only subjects that both carry a',
    'start and appear in a declared-complete open-data vintage are counted, so',
    'retention is defined. `still-listed` is present in the latest export;',
    '`cancelled-departed` and `vanished` are the two ways of being absent from',
    'it (a dated cancellation, versus evidence-of-absence with no dated end).',
    'The cohort is bounded by start-date coverage: cancellation attestation',
    `stops in ${mdCode(cancellationCeiling(c))}, so a later cohort structurally`,
    'cannot show `cancelled-departed` — its absentees are `vanished` by',
    'construction, not by a change in behaviour.',
    '',
    '| start decade | subjects | still-listed | cancelled-departed | vanished | retention |',
    '|---|---:|---:|---:|---:|---:|',
    ...c.eraCohort.map(r =>
      `| ${r.decade} | ${num(r.subjects)} | ${num(r.stillListed)} | ${num(r.cancelledDeparted)} | ${num(r.vanished)} | ${pct(r.stillListed, r.subjects)} |`),
    '',
    '## Curve C — retention by licence class',
    '',
    'Cohort definition (authored): subjects present in the **base vintage**',
    `(${mdCode(c.baseVintage ?? '')}, the earliest declared-complete export) under a`,
    'resolved prefix-implied licence class, and how many survive into the',
    `latest (${mdCode(c.latestVintage)}). Retention is measured over the`,
    "mirror's own observation window — NOT licence age. The class is the",
    'prefix-implied class (`reference-data/prefix-formats.csv`); an unparseable',
    'token that resolves to none is bucketed `(unresolved)`, never dropped.',
    '',
    '| licence class | in base vintage | still listed in latest | retention |',
    '|---|---:|---:|---:|',
    ...c.classRetention.map(r =>
      `| ${r.licenceClass} | ${num(r.base)} | ${num(r.stillListed)} | ${pct(r.stillListed, r.base)} |`),
    '',
  );

  lines.push(...renderReservation(c.reservation));
  lines.push('');
  return lines.join('\n');
}

function renderLivingAge(rows: readonly LivingAgeRow[]): string[] {
  if (rows.length === 0) return ['(no subject carries both a start date and presence in the latest export)'];
  const eras: LivingAgeRow['era'][] = ['from-1977', 'pre-1977'];
  const byEra = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const forEra = byEra.get(r.era) ?? new Map<string, number>();
    forEra.set(r.bucketId, (forEra.get(r.bucketId) ?? 0) + r.subjects);
    byEra.set(r.era, forEra);
  }
  const eraLabel = (era: string): string => era === 'pre-1977' ? 'pre-1977 (attested-unreliable, #565)' : 'from 1977 onward';
  const out = [
    `| age band | ${eras.map(eraLabel).join(' | ')} |`,
    `|---|${eras.map(() => '---:').join('|')}|`,
  ];
  for (const bucket of AGE_BUCKETS) {
    const cells = eras.map(era => {
      const n = byEra.get(era)?.get(bucket.id);
      return n === undefined ? '—' : num(n);
    });
    out.push(`| ${bucket.label} | ${cells.join(' | ')} |`);
  }
  const total = (era: string): number => [...(byEra.get(era)?.values() ?? [])].reduce((a, b) => a + b, 0);
  out.push(`| **total (living)** | ${eras.map(era => `**${num(total(era))}**`).join(' | ')} |`);
  return out;
}

// The latest day any cancellation is attested — read off the coverage table so
// Curve B's "cancellation stops here" note stays tied to the folded figures.
function cancellationCeiling(c: SurvivalCohort): string {
  const end = c.coverage.filter(r => r.contribution === 'licence-end').map(r => r.latest).sort();
  return end.length > 0 ? end[end.length - 1] : 'the last cancellation disclosure';
}

function renderReservation(r: ReservationSummary): string[] {
  if (r.claims === 0) {
    return [
      '## Curve D — reservation → reallocation',
      '',
      'No reservation-window (`reserved-until`) evidence is held in this corpus.',
    ];
  }
  return [
    '## Curve D — reservation → reallocation cycle',
    '',
    'The `reserved-until` windows (the stated END of a reservation). The',
    "window's START is nowhere attested (the state-at-t",
    'reservation-window-start-unattested rule), so what is measured is the',
    "stated end minus the assertion's own vintage — never a true window length.",
    'This pairs with the two-year reservation policy test (**issue #863**), now',
    'folded as an executable invariant in `reports/policy-invariants.md` (the',
    'two-year reservation window): that report classifies these same',
    '`reserved-until` observations against the stated cooling policy',
    '(conformant / longer-than-stated / shorter-than-stated / undeterminable,',
    'honouring day- vs month-vintage precision). This section is the',
    'reservation-cycle side of the same evidence — the coarse counts below read',
    'the same signal that report classifies precisely.',
    '',
    `- **${num(r.claims)}** reservation-window assertions across **${num(r.subjects)}** subjects.`,
    `- **${num(r.retrospective)}** state an end BEFORE their own asserting vintage — a retrospective termination record, not a future window (the reserved-cohort-ambiguity: the same column carries a planned close on Reserved rows and a retrospective termination on Available rows; not adjudicated here).`,
    `- **${num(r.overTwoYears)}** state an end more than two years beyond their asserting vintage — candidate exceptions to the stated two-year cooling policy (issue #863); **${num(r.overFiveYears)}** exceed five years (the shape of issue #568's reserved-over-five-years observation).`,
    `- **${num(r.indefinite)}** carry the far-future indefinite sentinel (${mdCode(INDEFINITE_RESERVED_TO)}).`,
    `- **${num(r.withLaterStart)}** reserved subjects later carry start evidence dated after the reservation — a coarse reallocation signal (the callsign moving on from its reservation), not a completed cycle time: the reservation's own start is unattested.`,
    '',
    'Reservation-window end years (each assertion counted once):',
    '',
    '| reserved-until year | assertions |',
    '|---|---:|',
    ...r.endYears.map(e => `| ${e.year} | ${num(e.claims)} |`),
  ];
}

export const SURVIVAL_COHORT_PATH = 'reports/survival-cohort.md';

export function writeSurvivalCohort(): { path: string; changed: boolean } {
  const markdown = renderSurvivalCohort(buildSurvivalCohort());
  const target = path.resolve(process.cwd(), SURVIVAL_COHORT_PATH);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const existing = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : undefined;
  const changed = existing !== markdown;
  if (changed) fs.writeFileSync(target, markdown);
  return { path: SURVIVAL_COHORT_PATH, changed };
}

if (import.meta.main) {
  const { path: written, changed } = writeSurvivalCohort();
  console.log(`${changed ? 'wrote' : 'up to date'}: ${written}`);
  perfReport({ entrypoint: 'survival-cohort' });
}
