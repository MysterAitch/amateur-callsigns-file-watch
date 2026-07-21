/**
 * Namespace sequence analytics (issue #864): allocation order, gap structure,
 * issuance-rate curves and a naive series-exhaustion projection, per callsign
 * prefix series.
 *
 * The question the amateur community keeps asking — "is a series such as `M7xxx`
 * handed out in order, and when does it run out?" — turned into an accumulating,
 * re-runnable record. This is the hypothesis register's H5 ("callsigns within a
 * series are issued sequentially") moved off opinion and onto evidence.
 *
 * What the analysis reads (S1 allocation-time evidence): the event-time claims
 * (src/v2/event-time-emit.ts) whose kind carries allocation-time meaning —
 * `licence-issued` (a firm stated issue date) and the earliest-SURVIVING start
 * kinds `licence-version-original-start` / `licence-original-start`. The
 * earliest-surviving kinds carry the issue #800 caveat in every figure they
 * feed: the date is only the earliest start still present in the asserting
 * vintage, never "the true original", and pre-1977 dates are attested-unreliable
 * (issue #565). The bookkeeping and reservation kinds are DOCUMENTED EXCLUSIONS
 * (allocationRoleOf is total over the S1 vocabulary, so a new kind forces an
 * authored decision) — a created/last-modified stamp is when the export's record
 * was touched, not when the callsign was allocated.
 *
 * Snapshot presence (the honest denominator): a series' population is the
 * distinct cleaned callsigns that PARSE into it and appear anywhere in the
 * event-claim corpus (every held register row carries a created/last-modified
 * stamp, so this is "ever observed in a snapshot"). Dated allocation evidence is
 * far sparser than presence, and unevenly so between series — every figure below
 * states the dated-evidence coverage of the series it rests on, because a
 * correlation or a rate computed over a handful of dated callsigns is a weak
 * claim and must read as one.
 *
 * Epistemics (issue #723, binding): every rate and every projection is
 * **[derived]** or **[inferred]**, never observed. Projections are NAIVE
 * EXTRAPOLATION, not prediction — flat-rate arithmetic over a capacity the model
 * states, with the asserting vintages named and the dated-evidence ceiling
 * declared. Absence of dated evidence is non-observation: a series with sparse
 * dates is not a series that stopped being issued, and the report never reads it
 * as one.
 *
 * Mechanism form (the S2/S3 precedent): a pure, unit-testable derivation engine
 * (analyseSeries / computeSequenceAnalytics) over per-subject rows a DuckDB fold
 * extracts, plus a committed, golden-gated report (reports/sequence-analytics.md)
 * demonstrating the engine over the real corpus. No new ledger claims are
 * emitted — the analytics are read-time derivations, re-runnable from the ledger
 * alone. Reader-facing surfaces (issues #726/#292) are deliberately not built
 * here; this report is the drift signal and the working record.
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
} from '../v2/claim.ts';
import {
  parseCallsign,
  loadReferenceData,
  type ReferenceData,
  type PrefixSeriesInfo,
} from '../sources/ofcom-amateur/components.ts';
import { acquireClaimsSource } from './event-time-coherency.ts';
import { time, perfReport } from '../shared/perf.ts';

// --- Authored allocation-evidence classification ----------------------------
//
// Which S1 event kinds are allowed to date an ALLOCATION, and how firmly. Total
// over the S1 kind vocabulary (allocationRoleOf throws on an unclassified kind —
// the same drift-guard shape as state-at-t's contributionOf and the coherency
// fold's temporalityOf), so adding an S1 kind forces an authored decision here
// before it can silently join (or silently skip) the sequence analysis:
//
//  - 'issued':                  a firm stated licence issue date. `licence-issued`
//                               is the 2019 disclosures' 'Licence Issued Dat'
//                               column — the closest the corpus holds to a true
//                               allocation date.
//  - 'earliest-surviving-start': an ORIGINAL-start date that is only the earliest
//                               start SURVIVING in the asserting vintage (issue
//                               #800), with the pre-1977 unreliability caveat
//                               (issue #565). Firmer evidence than nothing, but a
//                               reissue or a dropped version row can move it, so
//                               it is a ceiling on how early the allocation was,
//                               not the allocation date itself.
//  - 'non-allocation':          bookkeeping (created / last-modified — when the
//                               export's record was touched, largely the 2016
//                               migration for old records), a cancellation, or a
//                               reservation window bound. None of these dates an
//                               allocation, and each is excluded with that reason.
export type AllocationRole = 'issued' | 'earliest-surviving-start' | 'non-allocation';

const ALLOCATION_ROLE: ReadonlyMap<string, AllocationRole> = new Map([
  ['record-created', 'non-allocation'],
  ['record-last-modified', 'non-allocation'],
  ['licence-version-last-modified', 'non-allocation'],
  ['licence-version-original-start', 'earliest-surviving-start'],
  ['licence-original-start', 'earliest-surviving-start'],
  ['licence-issued', 'issued'],
  ['licence-cancelled', 'non-allocation'],
  ['reserved-until', 'non-allocation'],
  ['licence-created', 'non-allocation'],
  ['licence-last-modified', 'non-allocation'],
]);

export function allocationRoleOf(kind: string): AllocationRole {
  const role = ALLOCATION_ROLE.get(kind);
  if (role === undefined) {
    throw new Error(`allocationRoleOf: event kind "${kind}" has no authored allocation role - classify it in ALLOCATION_ROLE before the sequence analytics can read it`);
  }
  return role;
}

function kindsWithRole(role: AllocationRole): string[] {
  return EVENT_DATE_KINDS.filter(kind => allocationRoleOf(kind) === role);
}

// The reader-facing gloss for each role, rendered once in the report so the
// vocabulary never appears bare.
export const ROLE_GLOSSES: ReadonlyMap<AllocationRole, string> = new Map([
  ['issued', 'a firm stated licence issue date (the 2019 disclosures’ `Licence Issued Dat` column) — the closest the corpus holds to a true allocation date'],
  ['earliest-surviving-start', 'an original-start date that is only the earliest start SURVIVING in the asserting vintage (issue #800), pre-1977 attested-unreliable (issue #565) — a ceiling on how early the allocation was, moved by a reissue or a dropped version row'],
  ['non-allocation', 'bookkeeping (created / last-modified), a cancellation, or a reservation window bound — none dates an allocation, so it feeds no sequence figure'],
]);

// --- Suffix sequence ordinal (pure) -----------------------------------------

const SUFFIX_RE = /^[A-Z]+$/;

// The position a suffix occupies in its series' issuance sequence space. Suffixes
// are ordered SHORTER-FIRST then alphabetically (AA < AB < ... < ZZ < AAA < AAB
// < ... < ZZZ) — the order Ofcom has historically issued them, moving to a longer
// suffix only once the shorter space filled. Each length's block sits above every
// shorter length's block (offset = the count of all shorter suffixes), so the
// ordinals are a single strictly increasing total order across the length
// boundary, and gap arithmetic over them stays contiguous.
export function suffixOrdinal(suffix: string): number {
  if (!SUFFIX_RE.test(suffix)) {
    throw new Error(`suffixOrdinal: "${suffix}" is not an A-Z suffix - only parsed core/2-format suffixes have a sequence position`);
  }
  let value = 0;
  for (let i = 0; i < suffix.length; i++) value = value * 26 + (suffix.charCodeAt(i) - 65);
  let offset = 0;
  let block = 26;
  for (let len = 1; len < suffix.length; len++) {
    offset += block;
    block *= 26;
  }
  return offset + value;
}

// The suffix a sequence ordinal denotes — the inverse of suffixOrdinal, so the
// report can name the first and last observed suffix of a series' span.
export function ordinalToSuffix(ordinal: number): string {
  let remaining = ordinal;
  let len = 1;
  let block = 26;
  while (remaining >= block) {
    remaining -= block;
    len += 1;
    block *= 26;
  }
  let out = '';
  for (let i = 0; i < len; i++) {
    out = String.fromCharCode(65 + (remaining % 26)) + out;
    remaining = Math.floor(remaining / 26);
  }
  return out;
}

// --- Rank correlation (pure, deterministic) ---------------------------------

// Average (fractional) ranks with ties resolved to the mean of the tied span —
// the tie-correction Spearman's rho needs when many callsigns share an
// allocation day. Deterministic: equal values receive an identical average rank
// regardless of input order.
function averageRanks(values: readonly number[]): number[] {
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v || a.i - b.i);
  const ranks = new Array<number>(values.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1].v === order[i].v) j++;
    const rank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[order[k].i] = rank;
    i = j + 1;
  }
  return ranks;
}

function pearson(xs: readonly number[], ys: readonly number[]): number | null {
  const n = xs.length;
  if (n < 2) return null;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; }
  const mx = sx / n;
  const my = sy / n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  if (sxx === 0 || syy === 0) return null;
  const r = sxy / Math.sqrt(sxx * syy);
  // Clamp tiny floating-point excursions past the mathematical [-1, 1] bound so
  // a perfect monotone relation renders as exactly 1, never 1.0000000002.
  return Math.max(-1, Math.min(1, r));
}

// Spearman's rank correlation between suffix ordinal and allocation day over the
// dated members of a series — +1 is perfectly sequential issuance (later suffix,
// later date), -1 the reverse, ~0 no ordering. null when fewer than two dated
// members exist, or when every allocation shares one day (no ordering to detect).
export function spearman(pairs: readonly { ordinal: number; day: number }[]): number | null {
  if (pairs.length < 2) return null;
  return pearson(averageRanks(pairs.map(p => p.ordinal)), averageRanks(pairs.map(p => p.day)));
}

// --- Per-series analysis (pure) ---------------------------------------------

// One callsign SLOT in a series: an RSL-agnostic placeholder form (M7TEE and its
// regional renderings MW7TEE/ME7TEE unify to one slot), its suffix and sequence
// ordinal, and the earliest attested allocation day with the role that dated it.
// allocDay is null for a slot observed in a snapshot but carrying no
// allocation-time evidence.
export interface SeriesSlot {
  ordinal: number;
  suffix: string;
  allocDay: string | null;
  allocRole: 'issued' | 'earliest-surviving-start' | null;
}

// Days since the epoch for an ISO day — the correlation's numeric axis. Callers
// pass a validated yyyy-mm-dd.
function dayNumber(isoDay: string): number {
  const [y, m, d] = isoDay.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

export interface YearCount { year: number; count: number }

export interface ExhaustionProjection {
  // The suffix length the series is currently issuing (its longest observed) —
  // the block the projection models filling.
  currentLength: number;
  // 26^currentLength — the full theoretical suffix space (a capacity the model
  // STATES, not an Ofcom-published figure). Forbidden suffixes are NOT subtracted:
  // most are long-standing allocations already in use (a populated series can
  // exceed the non-forbidden count), so forbiddenAtLength is carried as a caveat
  // on the remainder rather than removed from the capacity.
  capacity: number;
  forbiddenAtLength: number;
  fill: number;
  // Slots ever observed at the current length (snapshot presence) — the used
  // fraction of the modelled block.
  used: number;
  // Floored at zero: an observed population above the theoretical space (regional
  // or data artefacts) reads as "full", never as negative headroom.
  remaining: number;
  // The flat annual rate the extrapolation runs on: dated allocations at the
  // current length across the most recent dated-evidence years, and the window
  // those years span. Sparse and OLD where the allocation-dating disclosures are
  // old — stated, never smoothed over.
  ratePerYear: number;
  rateWindowFromYear: number;
  rateWindowToYear: number;
  rateDatedSlots: number;
  // remaining / ratePerYear, and the calendar year that lands on from the last
  // dated year. null when the rate is zero (no projection possible).
  yearsRemaining: number | null;
  projectedExhaustionYear: number | null;
}

export interface SeriesAnalysis {
  series: string;
  stationLevel: string;
  issuingStatus: string;
  known: boolean;
  // Distinct slots observed in a snapshot (the honest denominator).
  population: number;
  // Slots carrying allocation-time dated evidence, split by the firmest role.
  dated: number;
  datedIssued: number;
  datedEarliestSurvivingOnly: number;
  coverage: number;
  // The observed sequence span: first/last suffix by ordinal, the ordinal span,
  // the slots filling it, and the largest run of consecutive unallocated
  // ordinals inside the span.
  firstSuffix: string;
  lastSuffix: string;
  suffixLengths: number[];
  span: number;
  fillRatio: number;
  largestGap: number;
  // Allocation-order evidence over the dated slots: Spearman's rho and the
  // fraction of ordinal-adjacent dated pairs that are chronologically ordered.
  correlation: number | null;
  adjacentMonotonic: number | null;
  correlationDatedUsed: number;
  // The earliest and latest allocation day dating this series, and the dated
  // issuance-rate curve by calendar year.
  earliestAllocDay: string | null;
  latestAllocDay: string | null;
  perYear: YearCount[];
  projection: ExhaustionProjection | null;
}

// The dated-slots floor below which allocation-order correlation is not reported
// as a figure (it is computed, but a rho over a handful of points is noise). The
// full detail stays re-derivable for any series from the fold.
export const CORRELATION_MIN_DATED = 30;

// The forbidden-suffix count is confined to length 3 in every disclosure held
// (reference-data/forbidden-suffixes.csv), but the capacity model asks the
// reference data per length so a future shorter/longer forbidden suffix is
// honoured automatically.
function forbiddenOfLength(ref: ReferenceData, len: number): number {
  let count = 0;
  for (const suffix of ref.forbiddenSuffixes) if (suffix.length === len) count += 1;
  return count;
}

// How many of the most recent dated years the flat exhaustion rate averages
// over. Three years is a naive smoothing of year-to-year lumpiness, deliberately
// crude — the projection is illustrative arithmetic, and this parameter is named
// in the report so a reader can see exactly what "the observed rate" means.
export const RATE_WINDOW_YEARS = 3;

function projectExhaustion(slots: readonly SeriesSlot[], info: PrefixSeriesInfo | undefined, ref: ReferenceData): ExhaustionProjection | null {
  if (info === undefined || info.issuingStatus !== 'currently-issuing') return null;
  const currentLength = Math.max(...slots.map(s => s.suffix.length));
  const atLength = slots.filter(s => s.suffix.length === currentLength);
  const used = atLength.length;
  const capacity = 26 ** currentLength;
  const remaining = Math.max(0, capacity - used);

  const datedAtLength = atLength.filter((s): s is SeriesSlot & { allocDay: string } => s.allocDay !== null);
  if (datedAtLength.length === 0) return null;
  const years = [...new Set(datedAtLength.map(s => Number(s.allocDay.slice(0, 4))))].sort((a, b) => a - b);
  const windowYears = years.slice(-RATE_WINDOW_YEARS);
  const fromYear = windowYears[0];
  const toYear = windowYears[windowYears.length - 1];
  const rateDatedSlots = datedAtLength.filter((s) => {
    const y = Number(s.allocDay.slice(0, 4));
    return y >= fromYear && y <= toYear;
  }).length;
  const span = toYear - fromYear + 1;
  const ratePerYear = rateDatedSlots / span;
  const yearsRemaining = ratePerYear > 0 ? remaining / ratePerYear : null;
  const projectedExhaustionYear = yearsRemaining === null ? null : Math.round(toYear + yearsRemaining);

  return {
    currentLength,
    capacity,
    forbiddenAtLength: forbiddenOfLength(ref, currentLength),
    fill: capacity === 0 ? 0 : used / capacity,
    used,
    remaining,
    ratePerYear,
    rateWindowFromYear: fromYear,
    rateWindowToYear: toYear,
    rateDatedSlots,
    yearsRemaining,
    projectedExhaustionYear,
  };
}

// The largest run of consecutive UNALLOCATED ordinals inside the observed span —
// a big value means the series' used range is punctured by a long hole (a block
// held back, or simply not yet reached in a partially-filled range).
function largestGapRun(sortedOrdinals: readonly number[]): number {
  let largest = 0;
  for (let i = 1; i < sortedOrdinals.length; i++) {
    const gap = sortedOrdinals[i] - sortedOrdinals[i - 1] - 1;
    if (gap > largest) largest = gap;
  }
  return largest;
}

// Analyse one series from its observed slots. Pure: every figure is a function of
// the slots plus the reference data, so any series is re-derivable from the fold.
export function analyseSeries(series: string, slots: readonly SeriesSlot[], ref: ReferenceData): SeriesAnalysis {
  const info = ref.prefixSeries.get(series);
  const ordinals = slots.map(s => s.ordinal).sort((a, b) => a - b);
  const minOrd = ordinals[0];
  const maxOrd = ordinals[ordinals.length - 1];
  const span = maxOrd - minOrd + 1;

  const datedSlots = slots.filter((s): s is SeriesSlot & { allocDay: string } => s.allocDay !== null);
  const pairs = datedSlots.map(s => ({ ordinal: s.ordinal, day: dayNumber(s.allocDay) }));
  const correlation = spearman(pairs);

  // Adjacent-monotonic fraction: of consecutive dated slots by ordinal, how many
  // are in chronological order — the plainest reading of "later suffix, later
  // date". Computed over the dated slots sorted by ordinal.
  const datedByOrdinal = [...datedSlots].sort((a, b) => a.ordinal - b.ordinal);
  let ordered = 0;
  for (let i = 1; i < datedByOrdinal.length; i++) {
    if (datedByOrdinal[i].allocDay >= datedByOrdinal[i - 1].allocDay) ordered += 1;
  }
  const adjacentMonotonic = datedByOrdinal.length < 2 ? null : ordered / (datedByOrdinal.length - 1);

  const perYearMap = new Map<number, number>();
  for (const s of datedSlots) {
    const year = Number(s.allocDay.slice(0, 4));
    perYearMap.set(year, (perYearMap.get(year) ?? 0) + 1);
  }
  const perYear = [...perYearMap.entries()].sort((a, b) => a[0] - b[0]).map(([year, count]) => ({ year, count }));

  const allocDays = datedSlots.map(s => s.allocDay).sort();

  return {
    series,
    stationLevel: info?.stationLevel ?? '',
    issuingStatus: info?.issuingStatus ?? '',
    known: info !== undefined,
    population: slots.length,
    dated: datedSlots.length,
    datedIssued: datedSlots.filter(s => s.allocRole === 'issued').length,
    datedEarliestSurvivingOnly: datedSlots.filter(s => s.allocRole === 'earliest-surviving-start').length,
    coverage: slots.length === 0 ? 0 : datedSlots.length / slots.length,
    firstSuffix: ordinalToSuffix(minOrd),
    lastSuffix: ordinalToSuffix(maxOrd),
    suffixLengths: [...new Set(slots.map(s => s.suffix.length))].sort((a, b) => a - b),
    span,
    fillRatio: span === 0 ? 0 : slots.length / span,
    largestGap: largestGapRun(ordinals),
    correlation,
    adjacentMonotonic,
    correlationDatedUsed: datedSlots.length,
    earliestAllocDay: allocDays[0] ?? null,
    latestAllocDay: allocDays[allocDays.length - 1] ?? null,
    perYear,
    projection: projectExhaustion(slots, info, ref),
  };
}

// --- The SQL fold ------------------------------------------------------------

function sqlList(values: readonly string[]): string {
  return values.map(v => `'${v.replace(/'/g, "''")}'`).join(', ');
}

// The S1 allocation-evidence relation: one row per distinct cleaned subject
// carrying any event claim, with the earliest firm-issued day and the earliest
// original-start day it holds (either NULL). The subject is cleaned to the
// cross-publication join key; unkeyable subjects (cleaning to nothing) are
// excluded here (they remain in the ledger). Ordered by subject for determinism.
export interface SubjectAllocationRow {
  subject: string;
  minIssued: string | null;
  minOriginalStart: string | null;
}

export function foldSubjectAllocations(source: string | ClaimsSource): SubjectAllocationRow[] {
  const claims = toClaimsSource(source);
  if (!claimsSourcePresent(claims)) return [];
  const issued = sqlList(kindsWithRole('issued'));
  const original = sqlList(kindsWithRole('earliest-surviving-start'));
  return foldQuery<SubjectAllocationRow>(`WITH events AS (
  SELECT ${cleanedKeyExpr('rawSubject')} AS subject,
         substr(predicate, ${EVENT_DATE_PREDICATE_PREFIX.length + 1}) AS kind,
         object AS "day"
  FROM ${claimsRelation(claims)}
  WHERE rule = '${EVENT_DATE_RULE}'
    AND predicate LIKE '${EVENT_DATE_PREDICATE_PREFIX}%'
    AND ${cleanedKeyExpr('rawSubject')} <> ''
)
SELECT subject,
       min("day") FILTER (WHERE kind IN (${issued})) AS minIssued,
       min("day") FILTER (WHERE kind IN (${original})) AS minOriginalStart
FROM events
GROUP BY subject
ORDER BY subject`);
}

// --- The engine over a claims source ----------------------------------------

// The earliest attested allocation day for a subject and the firmest role that
// dated it: a firm licence-issued date is preferred as the allocation date even
// when an earlier original-start exists (the issue date is the firmer evidence);
// otherwise the earliest original-start stands, carrying the earliest-surviving
// caveat. null when the subject holds no allocation-time evidence.
function allocationOf(minIssued: string | null, minOriginalStart: string | null): { day: string; role: 'issued' | 'earliest-surviving-start' } | null {
  if (minIssued !== null) return { day: minIssued, role: 'issued' };
  if (minOriginalStart !== null) return { day: minOriginalStart, role: 'earliest-surviving-start' };
  return null;
}

const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

// Group the folded subject rows into per-series slots: parse each cleaned
// subject, keep the cleanly-parsed core/2-format callsigns (visitor,
// special-event and unparseable subjects have no sequence position), and unify
// regional renderings onto one slot per placeholder form (the RSL-agnostic key),
// taking the earliest allocation across the renderings.
export function slotsBySeriesFrom(rows: readonly SubjectAllocationRow[], ref: ReferenceData): Map<string, SeriesSlot[]> {
  interface SlotAccumulator { series: string; suffix: string; ordinal: number; issued: string | null; original: string | null }
  const byPlaceholder = new Map<string, SlotAccumulator>();
  for (const row of rows) {
    const parsed = parseCallsign(row.subject, '', ref);
    if (parsed.parseStatus !== 'parsed') continue;
    if (!SUFFIX_RE.test(parsed.suffix)) continue;
    const key = parsed.placeholderForm;
    let acc = byPlaceholder.get(key);
    if (acc === undefined) {
      acc = { series: parsed.prefixSeries, suffix: parsed.suffix, ordinal: suffixOrdinal(parsed.suffix), issued: null, original: null };
      byPlaceholder.set(key, acc);
    }
    // The earliest across regional renderings sharing this slot — verified ISO
    // days only, so a stray value never poisons the numeric axis.
    if (row.minIssued !== null && ISO_DAY_RE.test(row.minIssued) && (acc.issued === null || row.minIssued < acc.issued)) acc.issued = row.minIssued;
    if (row.minOriginalStart !== null && ISO_DAY_RE.test(row.minOriginalStart) && (acc.original === null || row.minOriginalStart < acc.original)) acc.original = row.minOriginalStart;
  }
  const bySeries = new Map<string, SeriesSlot[]>();
  for (const acc of byPlaceholder.values()) {
    const alloc = allocationOf(acc.issued, acc.original);
    const slot: SeriesSlot = {
      ordinal: acc.ordinal,
      suffix: acc.suffix,
      allocDay: alloc === null ? null : alloc.day,
      allocRole: alloc === null ? null : alloc.role,
    };
    const list = bySeries.get(acc.series);
    if (list === undefined) bySeries.set(acc.series, [slot]);
    else list.push(slot);
  }
  return bySeries;
}

export interface SequenceAnalytics {
  // Every series observed, richest (largest population) first, then by name.
  series: SeriesAnalysis[];
  // Corpus-wide coverage honesty.
  totalSlots: number;
  datedSlots: number;
  parsedSubjects: number;
  // The dated-evidence ceiling: the latest allocation day dating ANY series —
  // the boundary every rate and projection sits behind.
  latestAllocDay: string | null;
}

export function computeSequenceAnalytics(source: string | ClaimsSource, ref: ReferenceData = loadReferenceData()): SequenceAnalytics {
  const rows = time('sequence-analytics:fold', () => foldSubjectAllocations(source));
  const bySeries = time('sequence-analytics:group', () => slotsBySeriesFrom(rows, ref));
  const analyses = [...bySeries.entries()].map(([series, slots]) => analyseSeries(series, slots, ref));
  analyses.sort((a, b) => b.population - a.population || a.series.localeCompare(b.series));

  let totalSlots = 0;
  let datedSlots = 0;
  let latestAllocDay: string | null = null;
  for (const a of analyses) {
    totalSlots += a.population;
    datedSlots += a.dated;
    if (a.latestAllocDay !== null && (latestAllocDay === null || a.latestAllocDay > latestAllocDay)) latestAllocDay = a.latestAllocDay;
  }
  return {
    series: analyses,
    totalSlots,
    datedSlots,
    parsedSubjects: totalSlots,
    latestAllocDay,
  };
}

// --- Rendering ---------------------------------------------------------------

function num(n: number): string {
  return n.toLocaleString('en-GB');
}

function pct(share: number): string {
  return `${(share * 100).toFixed(1)}%`;
}

function mdCode(value: string): string {
  return `\`${value}\``;
}

function rho(value: number | null): string {
  if (value === null) return '—';
  // Normalise -0 and pin three decimals so the golden is byte-stable.
  const fixed = value.toFixed(3);
  return fixed === '-0.000' ? '0.000' : fixed;
}

function rate(value: number): string {
  return value.toFixed(1);
}

// The floor a series must reach to earn a detailed subsection (gap structure,
// rate curve, projection). Below it, the series still appears in the summary
// table with every figure — the detail sections just stay legible.
export const DETAIL_MIN_POPULATION = 1000;

function suffixRange(a: SeriesAnalysis): string {
  return a.firstSuffix === a.lastSuffix ? mdCode(a.firstSuffix) : `${mdCode(a.firstSuffix)}–${mdCode(a.lastSuffix)}`;
}

function renderPerYear(perYear: readonly YearCount[]): string[] {
  if (perYear.length === 0) return ['(no dated allocations)', ''];
  return [
    '| year | dated allocations |',
    '|---|---:|',
    ...perYear.map(y => `| ${y.year} | ${num(y.count)} |`),
    '',
  ];
}

function renderProjection(p: ExhaustionProjection): string[] {
  const lines = [
    `- Current issuing suffix length: ${p.currentLength} letters — theoretical capacity ${num(p.capacity)} (26^${p.currentLength}). Up to ${num(p.forbiddenAtLength)} suffixes of that length are forbidden for NEW issuance (many are long-standing allocations already counted in the population), further shrinking the usable remainder.`,
    `- Slots observed at that length (snapshot presence): ${num(p.used)} — ${pct(p.fill)} of the space full; remaining under the model: ${num(p.remaining)}.`,
    `- Flat rate: ${rate(p.ratePerYear)} dated allocations/year (${num(p.rateDatedSlots)} dated over ${p.rateWindowFromYear}–${p.rateWindowToYear}).`,
  ];
  if (p.remaining === 0) {
    lines.push('- **Naive projection: the observed population already fills the space — effectively exhausted at this suffix length.** Ofcom’s response to a full series is a new prefix (e.g. the M8/M9 intermediate series introduced October 2025).');
  } else if (p.fill >= 0.9) {
    lines.push(`- **Naive projection: ~${pct(p.fill)} full with only ${num(p.remaining)} slots left — effectively exhausted; the remainder (much of it forbidden or unpopular suffixes) trickles out at ${rate(p.ratePerYear)}/year.** Ofcom’s response to a full series is a new prefix (e.g. the M8/M9 intermediate series introduced October 2025).`);
  } else if (p.yearsRemaining === null || p.projectedExhaustionYear === null) {
    lines.push('- Naive projection: the rate is zero over the dated window, so no run-out year is projected.');
  } else {
    lines.push(`- **Naive projection: ~${rate(p.yearsRemaining)} years of capacity at that rate — a nominal run-out near ${p.projectedExhaustionYear}.** Extrapolation, not prediction: it holds the flat rate fixed, ignores forbidden-suffix scatter and non-sequential issuance, and runs off dated evidence ending ${p.rateWindowToYear} (the register has issued callsigns since, uncounted here).`);
  }
  return lines;
}

export function renderSequenceAnalytics(a: SequenceAnalytics): string {
  const lines: string[] = [
    '# Namespace sequence analytics',
    '',
    'Allocation order, gap structure, issuance-rate curves and a naive',
    'series-exhaustion projection per callsign prefix series (issue #864) — the',
    'hypothesis register’s H5 ("callsigns within a series are issued',
    'sequentially") moved off opinion and onto re-runnable evidence. Folded from',
    'the S1 allocation-time event claims and committed, so a new vintage shifting',
    'the picture shows up as a PR diff.',
    '',
    '**Epistemics (issue #723):** every rate and projection is **[derived]** or',
    '**[inferred]**, never observed. Projections are NAIVE EXTRAPOLATION, not',
    'prediction — flat-rate arithmetic over a stated capacity, behind the',
    'dated-evidence ceiling named below. Absence of dated evidence is',
    'non-observation: a sparsely-dated series is not one that stopped being',
    'issued, and nothing here reads it as such.',
    '',
    '## What counts as allocation-time evidence',
    '',
    'Each S1 event kind is classified for whether its date can time an allocation',
    '(the registry is total over the S1 vocabulary, so a new kind cannot silently',
    'join or skip the analysis). A slot’s allocation day is its earliest firm',
    '`licence-issued` date where one exists, else its earliest original-start date',
    'carrying the earliest-surviving caveat.',
    '',
    'Roles (each used only with this meaning):',
    '',
    ...[...ROLE_GLOSSES.entries()].map(([role, gloss]) => `- **${role}** — ${gloss}`),
    '',
    '| event kind | allocation role |',
    '|---|---|',
    ...EVENT_DATE_KINDS.map(kind => `| ${mdCode(kind)} | ${allocationRoleOf(kind)} |`),
    '',
    '## Coverage honesty',
    '',
    'A series’ population is the distinct cleaned callsigns that parse into it and',
    'appear anywhere in the event-claim corpus (every held register row carries a',
    'bookkeeping stamp, so this is "ever observed in a snapshot"). Dated',
    'allocation evidence is far sparser, and unevenly so — every figure states the',
    'dated coverage of the series it rests on.',
    '',
    `- Parsed core/2-format slots across all series: ${num(a.totalSlots)}`,
    `- …with allocation-time dated evidence: ${num(a.datedSlots)} (${pct(a.totalSlots === 0 ? 0 : a.datedSlots / a.totalSlots)})`,
    `- Dated-evidence ceiling (latest allocation day dating any series): ${a.latestAllocDay ?? '—'} — the boundary every rate and projection sits behind; allocation-dating columns are carried by disclosures of a bounded vintage range, so later issuance is largely undated here.`,
    '',
    '## Per-series summary',
    '',
    'Every observed series, richest first. `ρ` is Spearman’s rank correlation',
    'between suffix sequence position and allocation day over the dated slots (a',
    `figure is shown only where at least ${num(CORRELATION_MIN_DATED)} slots are dated — a ρ over a`,
    'handful of points is noise); adjacent-monotonic is the fraction of',
    'ordinal-adjacent dated slots in chronological order. Fill is the observed',
    'slots as a share of the span between the first and last suffix.',
    '',
    '| series | level | status | population | dated | coverage | suffix range | fill | ρ | adjacent-monotonic |',
    '|---|---|---|---:|---:|---:|---|---:|---:|---:|',
    ...a.series.map((s) => {
      const showRho = s.dated >= CORRELATION_MIN_DATED;
      return `| ${mdCode(s.series)}${s.known ? '' : ' ⚠'} | ${s.stationLevel || '—'} | ${s.issuingStatus || '—'} | ${num(s.population)} | ${num(s.dated)} | ${pct(s.coverage)} | ${suffixRange(s)} | ${pct(s.fillRatio)} | ${showRho ? rho(s.correlation) : '—'} | ${showRho && s.adjacentMonotonic !== null ? pct(s.adjacentMonotonic) : '—'} |`;
    }),
    '',
    ...(a.series.some(s => !s.known)
      ? ['⚠ series absent from `reference-data/prefix-formats.csv` — an unexpected primary locator is a finding in its own right.', '']
      : []),
  ];

  // --- Allocation order (H5) -------------------------------------------------
  const dated = a.series.filter(s => s.dated >= CORRELATION_MIN_DATED && s.correlation !== null);
  lines.push(
    '## Allocation order — is issuance sequential? (H5)',
    '',
    'The register’s H5 asks whether a series is handed out in suffix order. Read',
    'the Spearman `ρ` per series below over its dated slots: `ρ` near +1 is',
    'strongly sequential issuance (later suffix, later allocation day), near 0 no',
    'ordering, negative the reverse. The reading inherits the earliest-surviving',
    'caveat wherever a series leans on original-start rather than firm',
    '`licence-issued` dates, and is only as strong as the series’ dated coverage.',
    '',
  );
  if (dated.length === 0) {
    lines.push('No series reaches the dated-slots floor, so allocation order cannot be read from this corpus.', '');
  } else {
    lines.push(
      '| series | dated slots | ρ | adjacent-monotonic | firm-issued share | reading |',
      '|---|---:|---:|---:|---:|---|',
      ...dated.map((s) => {
        const firmShare = s.dated === 0 ? 0 : s.datedIssued / s.dated;
        const value = s.correlation ?? 0;
        const reading = value >= 0.9 ? 'strongly sequential'
          : value >= 0.7 ? 'broadly sequential'
            : value >= 0.4 ? 'weakly sequential'
              : value >= -0.4 ? 'no clear order'
                : 'reverse-ordered';
        return `| ${mdCode(s.series)} | ${num(s.dated)} | ${rho(s.correlation)} | ${s.adjacentMonotonic === null ? '—' : pct(s.adjacentMonotonic)} | ${pct(firmShare)} | ${reading} |`;
      }),
      '',
    );
  }

  // --- Detailed per-series sections ------------------------------------------
  const detailed = a.series.filter(s => s.population >= DETAIL_MIN_POPULATION);
  lines.push(
    '## Per-series detail',
    '',
    'Gap structure, the dated issuance-rate curve, and (for currently-issuing',
    `series) the naive exhaustion projection — for every series with at least`,
    `${num(DETAIL_MIN_POPULATION)} observed slots. Smaller series stay in the summary above; their`,
    'full detail is re-derivable from the fold (`analyseSeries`,',
    'src/ci/sequence-analytics.ts).',
    '',
  );
  for (const s of detailed) {
    lines.push(
      `### ${mdCode(s.series)} — ${s.stationLevel || 'unknown level'} (${s.issuingStatus || 'unknown status'})`,
      '',
      `Population ${num(s.population)} slots, ${num(s.dated)} dated (${pct(s.coverage)} coverage: `
      + `${num(s.datedIssued)} firm-issued, ${num(s.datedEarliestSurvivingOnly)} earliest-surviving only). `
      + `Suffix range ${suffixRange(s)} (${s.suffixLengths.join(', ')}-letter); span ${num(s.span)}, `
      + `fill ${pct(s.fillRatio)}, largest unallocated run ${num(s.largestGap)}.`
      + (s.earliestAllocDay === null ? '' : ` Dated allocations ${s.earliestAllocDay} → ${s.latestAllocDay}.`),
      '',
      'Dated issuance-rate curve (allocations per calendar year — [derived], sparse where the allocation-dating disclosures are sparse):',
      '',
      ...renderPerYear(s.perYear),
    );
    if (s.projection !== null) {
      lines.push('Naive exhaustion projection ([inferred], extrapolation not prediction):', '', ...renderProjection(s.projection), '');
    } else if (s.issuingStatus === 'currently-issuing') {
      lines.push('Naive exhaustion projection: not projected — no dated allocation evidence at the current issuing suffix length.', '');
    } else {
      lines.push('Naive exhaustion projection: not applicable — the series is not currently issuing.', '');
    }
  }

  return lines.join('\n');
}

export const SEQUENCE_ANALYTICS_PATH = 'reports/sequence-analytics.md';

export function buildSequenceAnalytics(ledgerDir?: string): SequenceAnalytics {
  const { source, dispose } = acquireClaimsSource(ledgerDir);
  try {
    return computeSequenceAnalytics(source);
  } finally {
    dispose();
  }
}

export function writeSequenceAnalytics(): { path: string; changed: boolean } {
  const markdown = renderSequenceAnalytics(buildSequenceAnalytics());
  const target = path.resolve(process.cwd(), SEQUENCE_ANALYTICS_PATH);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const existing = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : undefined;
  const changed = existing !== markdown;
  if (changed) fs.writeFileSync(target, markdown);
  return { path: SEQUENCE_ANALYTICS_PATH, changed };
}

if (import.meta.main) {
  const { path: written, changed } = writeSequenceAnalytics();
  console.log(`${changed ? 'wrote' : 'up to date'}: ${written}`);
  perfReport({ entrypoint: 'sequence-analytics' });
}
