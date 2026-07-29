/**
 * State-at-t reconstruction: the bi-temporal inference engine
 * (issue #725, stage S3 — the final foundation stage).
 *
 * Given the S1 event-time claims (src/v2/event-time-emit.ts), derive what the
 * mirror can honestly say about a callsign's state at an arbitrary event-time
 * date t. The answer is INFERRED in the issue #723 trichotomy, and the words
 * carry the epistemic ceiling:
 *
 *  - ACTUAL state — Ofcom's own reality, per internal systems: in principle
 *    unknowable from outside. Named so the other tiers stay honest about not
 *    being it.
 *  - DECLARED state — what each held vintage's dated cells literally assert:
 *    the S1 event claims themselves, each wearing its asserting source and
 *    vintage.
 *  - INFERRED state — this module's derivations over those declarations:
 *    always dated, always naming the asserting vintages, always conservative.
 *
 * Bi-temporal honesty (the crux): a state answer is parameterised by BOTH
 * axes — "state at event-time t, as asserted by vintages up to assertion-time
 * ceiling v" (or by the whole corpus, with the vintages named either way). A
 * 2026 vintage's claim about 1952 is evidence FROM 2026; and issue #800's
 * forward-only event-time creep means a LATER vintage can carry LESS early
 * history than an earlier one, so widening the ceiling can surface evidence a
 * narrow ceiling honestly lacked. Where vintages disagree about the same fact
 * (S2's revised-* material), the answer SURFACES the disagreement beside the
 * finding and resolves nothing (issue #467, flag-don't-adjudicate).
 *
 * The availability trap (binding at every step): absence of an event claim is
 * NON-OBSERVATION. It never reads as "the callsign was available", "nothing
 * happened", or "the callsign did not exist" — event-time coverage is only as
 * complete as what sources attested, and the per-kind coverage figures this
 * module folds show how partial that is. A query outside coverage returns an
 * explicit cannot-infer, never a guess.
 *
 * Mass-episode awareness (issue #801): bookkeeping stamps inside a detected
 * mass-update episode window (the S2 detector's windows) record ONE system
 * episode, not per-record licensing events. The authored contribution
 * registry below therefore routes every bookkeeping kind to a
 * SYSTEM-PRESENCE reading only — "the record existed in the publisher's
 * system by this date" — and never lets one feed a licensing inference; an
 * evidence line whose date falls inside an episode window is annotated so a
 * reader sees the episode, not a per-record happening.
 *
 * Mechanism form: a pure, unit-testable derivation engine (deriveStateAtT)
 * over per-subject evidence rows the SQL fold extracts, plus a committed,
 * golden-gated report (reports/state-at-t.md) demonstrating the engine over
 * the real corpus — the S2 precedent: the report makes the semantics
 * reviewable and drift-guarded, and the engine is what the issue #726
 * reader-facing surfaces will call. No new ledger claims are emitted: state
 * answers are read-time derivations, generated on demand, never stored as if
 * they were source assertions.
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
  DEFAULT_EPISODE_PARAMS,
  foldDaySignals,
  detectEpisodeSignals,
  mergeEpisodes,
  acquireClaimsSource,
  type Episode,
  type EpisodeParams,
} from './event-time-coherency.ts';
import { time, perfReport } from '../shared/perf.ts';

// --- Authored state contributions ------------------------------------------
//
// What each S1 event kind is allowed to say about a callsign's STATE — the
// registry is total over the authored kind vocabulary (contributionOf throws
// on an unclassified kind, the same drift-guard shape as KIND_TEMPORALITY),
// so adding an S1 kind forces an authored decision about its state reading:
//
//  - licence-start:    evidence a licence (or licence version) had been
//                      issued/started on or before its date. For the
//                      version-scoped kinds the date is only the earliest
//                      start SURVIVING in the asserting vintage (issue #800),
//                      never "the true original".
//  - licence-end:      evidence a licence had been cancelled on its date (the
//                      2020 reserved-callsigns disclosure's cancel column).
//  - reservation-end:  the STATED end of a reservation window — deliberately
//                      only a window bound: the permanent-SES finding (issue
//                      #725) shows the column carrying three meanings by
//                      cohort, so no status is ever read off it.
//  - system-presence:  the publisher's record bookkeeping (created /
 //                     last-modified stamps): evidence the RECORD existed in
//                      the export system by that date and NOTHING about
//                      licensing history. This includes `licence-created`:
//                      the Salesforce Licence object's creation stamp carries
//                      2024-era system dates against licences granted decades
//                      earlier, so it attests the licence RECORD's presence
//                      in the system, not the grant. Bookkeeping never feeds
//                      a licensing inference — inside a detected mass-update
//                      episode (issue #801) the stamp largely records the
//                      system episode itself (for pre-2016 records, the
//                      migration into the current system).
export type StateContribution = 'licence-start' | 'licence-end' | 'reservation-end' | 'system-presence';

const STATE_CONTRIBUTION: ReadonlyMap<string, StateContribution> = new Map([
  ['record-created', 'system-presence'],
  ['record-last-modified', 'system-presence'],
  ['licence-version-last-modified', 'system-presence'],
  ['licence-last-modified', 'system-presence'],
  ['licence-created', 'system-presence'],
  ['licence-version-original-start', 'licence-start'],
  ['licence-original-start', 'licence-start'],
  ['licence-issued', 'licence-start'],
  ['licence-cancelled', 'licence-end'],
  ['reserved-until', 'reservation-end'],
]);

export function contributionOf(kind: string): StateContribution {
  const contribution = STATE_CONTRIBUTION.get(kind);
  if (contribution === undefined) {
    throw new Error(`contributionOf: event kind "${kind}" has no authored state contribution - classify it in STATE_CONTRIBUTION before the state engine can read it`);
  }
  return contribution;
}

// The kinds whose dates are version-scoped "earliest surviving" readings
// (issue #800) — their licence-start findings carry the earliest-surviving
// caveat explicitly. Exported for the issue #726 surfaces, whose multi-row
// version-window signal reads the same authored set.
export const EARLIEST_SURVIVING_KINDS: ReadonlySet<string> = new Set([
  'licence-version-original-start',
  'licence-original-start',
]);

function kindsWithContribution(contribution: StateContribution): string[] {
  return EVENT_DATE_KINDS.filter(kind => contributionOf(kind) === contribution);
}

// --- The inference-rule vocabulary ------------------------------------------
//
// Authored, closed, glossed. Every finding a state answer carries names
// exactly one of these rules, so a reader (and issue #726's surfaces) can
// cite the rule a statement was derived under and re-run it.
export type StateRule =
  | 'no-evidence-for-subject'
  | 'licence-start-on-or-before-t'
  | 'consistent-with-licence-in-force-at-t'
  | 'licence-cancelled-on-or-before-t'
  | 'cancelled-with-no-later-start-evidence-by-t'
  | 'reservation-window-consistent-with-covering-t'
  | 'reservation-window-start-unattested'
  | 'reservation-window-stated-ended-by-t'
  | 'record-in-system-on-or-before-t'
  | 'no-licensing-evidence-on-or-before-t';

// The order findings appear in an answer — an authored reading order
// (licensing evidence first, bookkeeping after, gaps last), not a ranking.
const RULE_ORDER: readonly StateRule[] = [
  'no-evidence-for-subject',
  'licence-start-on-or-before-t',
  'consistent-with-licence-in-force-at-t',
  'licence-cancelled-on-or-before-t',
  'cancelled-with-no-later-start-evidence-by-t',
  'reservation-window-consistent-with-covering-t',
  'reservation-window-start-unattested',
  'reservation-window-stated-ended-by-t',
  'record-in-system-on-or-before-t',
  'no-licensing-evidence-on-or-before-t',
];

export const RULE_GLOSSES: ReadonlyMap<StateRule, string> = new Map([
  ['no-evidence-for-subject', 'no event-time claim for this subject exists in the consulted corpus at all — outside coverage: an explicit cannot-infer, never "did not exist" or "was available"'],
  ['licence-start-on-or-before-t', 'at least one consulted vintage asserts a licence(-version) start or issue date on or before t — evidence a licence had started by t, as asserted by the named vintages; for the version-scoped kinds the date is only the earliest start SURVIVING in the asserting vintage, so the true first start may be earlier still'],
  ['consistent-with-licence-in-force-at-t', 'start evidence on or before t, with no cancellation evidence dated on or after that start and on or before t (a cancellation dated on the start day itself is treated as addressing that start) — CONSISTENT WITH a licence being in force at t, never proof: absence of a cancellation claim is non-observation (cancellation dates are sparsely attested in the held corpus), and a licence can end without any held dataset recording a dated end; the finding inherits the earliest-surviving/pre-1977 unreliability of the start it rests on, so it stays honest rendered alone'],
  ['licence-cancelled-on-or-before-t', 'a consulted vintage asserts a licence cancellation date on or before t — evidence a licence had been cancelled by then'],
  ['cancelled-with-no-later-start-evidence-by-t', 'the latest cancellation evidence on or before t post-dates every consulted start assertion on or before t — evidence the then-licence had been cancelled by t with no surviving evidence of a later start by t; NOT evidence the callsign was available at t (non-observation of a later grant is not absence of one)'],
  ['reservation-window-consistent-with-covering-t', 'a reservation window whose stated end is on or after t was asserted by a vintage collected on or before t — consistent with a reservation covering t; the source column carries three cohort meanings (planned close / retrospective termination / anomaly), so this is a conservative reading of the stated window bound, never a status claim'],
  ['reservation-window-start-unattested', 'a reservation window end on or after t is asserted, but only by vintages not proven to precede t — the window’s START is nowhere attested, so whether the reservation had begun by t cannot be inferred'],
  ['reservation-window-stated-ended-by-t', 'every asserted reservation window end precedes t — the stated window had ended by t on the asserting vintage’s reading; on the Available-status cohort the same cell records a retrospective termination, and neither reading says what the callsign’s state at t was'],
  ['record-in-system-on-or-before-t', 'the publisher’s record bookkeeping (created / last-modified stamps) dates on or before t — a statement about the record’s presence in the export system by t, never a licensing event; a stamp inside a detected mass-update episode largely records the system episode (for pre-2016 records, the migration into the current system), not a per-record happening'],
  ['no-licensing-evidence-on-or-before-t', 'no consulted vintage asserts any licensing event (start, cancellation, reservation bound) dated on or before t — non-observation: the corpus cannot say what the callsign’s state at t was, and this NEVER reads as "the callsign did not exist" or "was available"'],
]);

// --- The caveat vocabulary ---------------------------------------------------
//
// Authored caveats findings carry by id; the glosses render once per report so
// a caveat never appears bare.
export type StateCaveat =
  | 'earliest-surviving'
  | 'pre-1977'
  | 'availability-trap'
  | 'cancellation-sparsity'
  | 'reserved-cohort-ambiguity'
  | 'window-restated'
  | 'mass-episode-window'
  | 'month-precision-vintage'
  | 'vintages-disagree';

// These glosses are READER-FACING copy: they ship in the event-shard and history
// manifests and render verbatim on the launch surface. A gloss therefore carries
// its own explanation and never a tracker reference or a repository path in place
// of one — a reader who needs more is routed to a published explainer (the
// glossary term each caveat is mapped to in the v1 copy registry), never off the
// site. The reader-copy reference guard (src/ci/reader-copy-references.test.ts)
// holds this for the whole vocabulary; issue traceability belongs in the comments
// and commit history, where it costs a reader nothing.
export const CAVEAT_GLOSSES: ReadonlyMap<StateCaveat, string> = new Map([
  ['earliest-surviving', 'a version-scoped start date is the earliest start SURVIVING in the asserting vintage, not "the true original": rolling retention and reissues drop or replace older rows, so earlier starts may have existed and left no surviving trace'],
  ['pre-1977', 'original start dates before 1977 are attested-unreliable (OARC, citing an administrative glitch by the then regulator)'],
  ['availability-trap', 'absence of evidence is non-observation, never "was available" or "did not exist": event-time coverage is only as complete as what sources attested'],
  ['cancellation-sparsity', 'cancellation dates are attested by very few held vintages (see the per-kind coverage table), so "no cancellation evidence" is weak: a cancellation may simply be unrecorded in what is held'],
  ['reserved-cohort-ambiguity', 'the reserved-until column carries three meanings by cohort (a planned close on Reserved rows, a retrospective termination record on Available rows, and an undecidable anomaly) — the engine reads only the stated window bound, never a status'],
  ['window-restated', 'the consulted vintages state more than one reservation window end — renewal/termination bookkeeping is routine for this column; every stated end appears in the evidence table'],
  ['mass-episode-window', 'at least one supporting date falls inside a detected mass-update episode window: tens of thousands of identical stamps record ONE system episode, not per-record events'],
  ['month-precision-vintage', 'at least one asserting vintage is keyed by month, not day — its assertion time carries month precision, and every comparison against it treats the whole month conservatively'],
  ['vintages-disagree', 'the consulted vintages disagree on this fact — the disagreement is surfaced in the answer’s disagreements list and resolved nowhere'],
]);

// --- Vintage precision -------------------------------------------------------
//
// Assertion-time values in the ledger are day-keyed (yyyy-mm-dd) or month-keyed
// (yyyy-mm — the source-register's "vintage keyed by month" entries). A month
// vintage's assertion time is only proven to lie somewhere inside its month, so
// every comparison uses the whole month conservatively: it counts as "on or
// before X" only when its LAST day is, and as day span for reporting. Any other
// shape fails loud — a new vintage grammar must be classified here, not guessed.
const VINTAGE_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const VINTAGE_MONTH_RE = /^\d{4}-\d{2}$/;

export function vintageDaySpan(vintage: string): { earliest: string; latest: string } {
  if (VINTAGE_DAY_RE.test(vintage)) return { earliest: vintage, latest: vintage };
  if (VINTAGE_MONTH_RE.test(vintage)) {
    const [y, m] = vintage.split('-').map(Number);
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return { earliest: `${vintage}-01`, latest: `${vintage}-${String(lastDay).padStart(2, '0')}` };
  }
  throw new Error(`vintageDaySpan: vintage "${vintage}" is neither day-keyed (yyyy-mm-dd) nor month-keyed (yyyy-mm) - classify the new vintage grammar before the state engine can compare it`);
}

// Whether an assertion at this vintage is PROVEN to be on or before the given
// day — a month-keyed vintage qualifies only when its whole month is.
export function vintageOnOrBefore(vintage: string, day: string): boolean {
  return vintageDaySpan(vintage).latest <= day;
}

// Whether a vintage is month-keyed — its assertion time carries month, not
// day, precision, so every consumer treats the whole month conservatively.
// Exported for the issue #726 surfaces, so their month-precision caveat
// attaches under exactly the engine's own reading of the vintage grammar.
export function isMonthPrecisionVintage(vintage: string): boolean {
  return VINTAGE_MONTH_RE.test(vintage);
}

function isMonthPrecision(vintage: string): boolean {
  return isMonthPrecisionVintage(vintage);
}

// --- Evidence and answer shapes ---------------------------------------------

// One aggregated evidence row for a subject: what one dataset asserts for one
// (event kind, event day) — the SQL fold's output and the pure engine's input.
export interface SubjectEventRow {
  kind: string;
  lane: string;
  dataset: string;
  vintage: string;
  day: string;
  nrows: number;
}

export interface EvidenceAssertion {
  lane: string;
  dataset: string;
  vintage: string;
  nrows: number;
}

// One evidence line: one (kind, event day) with every dataset asserting it,
// its relation to t, and a mass-episode annotation where the day falls inside
// a detected episode window.
export interface StateEvidenceLine {
  kind: string;
  contribution: StateContribution;
  day: string;
  relation: 'on-or-before-t' | 'after-t';
  assertedBy: EvidenceAssertion[];
  withinEpisode: { start: string; end: string } | null;
}

export interface StateFinding {
  rule: StateRule;
  // Constant by construction: every state answer is an inference (issue #723).
  epistemics: 'inferred';
  statement: string;
  assertingVintages: string[];
  evidence: StateEvidenceLine[];
  caveats: StateCaveat[];
}

// A cross-vintage disagreement about one licensing fact, surfaced beside the
// findings and resolved nowhere: per kind, the per-dataset earliest asserted
// day (issue #800's comparison statistic) where datasets differ.
export interface KindDisagreement {
  kind: string;
  statistic: 'earliest-asserted';
  values: { day: string; assertedBy: { lane: string; dataset: string; vintage: string }[] }[];
}

export interface StateAtTQuery {
  // The cleaned callsign key (the cross-publication join key, not an identity).
  subject: string;
  // Event time: the day the state question is about.
  t: string;
  // Assertion time: consult only vintages proven on or before this day.
  // Omitted = the whole corpus (with the consulted vintages still named).
  assertionCeiling?: string;
}

export interface StateAtT {
  subject: string;
  t: string;
  assertionCeiling: string | null;
  epistemics: 'inferred';
  // Every distinct vintage whose evidence was consulted / excluded by the
  // ceiling — the assertion-time axis, always named.
  vintagesConsulted: string[];
  vintagesExcluded: string[];
  // Whether ANY consulted evidence exists for the subject. false = outside
  // coverage: the answer is an explicit cannot-infer.
  addressable: boolean;
  // The dated assertions bounding t: every evidence line at the latest
  // asserted day on or before t, and at the earliest asserted day after t.
  bounds: {
    latestOnOrBeforeT: StateEvidenceLine[];
    earliestAfterT: StateEvidenceLine[];
  };
  findings: StateFinding[];
  disagreements: KindDisagreement[];
  // The full consulted evidence, sorted by day then kind.
  evidence: StateEvidenceLine[];
}

// --- The pure derivation engine ---------------------------------------------

const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function assertIsoDay(value: string, label: string): void {
  if (!ISO_DAY_RE.test(value)) {
    throw new Error(`deriveStateAtT: ${label} "${value}" is not an ISO day (yyyy-mm-dd)`);
  }
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function episodeContaining(day: string, episodes: readonly Episode[]): { start: string; end: string } | null {
  for (const episode of episodes) {
    if (day >= episode.start && day <= episode.end) return { start: episode.start, end: episode.end };
  }
  return null;
}

function buildLines(rows: readonly SubjectEventRow[], t: string, episodes: readonly Episode[]): StateEvidenceLine[] {
  const byKey = new Map<string, StateEvidenceLine>();
  for (const row of rows) {
    const key = `${row.kind}\n${row.day}`;
    let line = byKey.get(key);
    if (line === undefined) {
      line = {
        kind: row.kind,
        contribution: contributionOf(row.kind),
        day: row.day,
        relation: row.day <= t ? 'on-or-before-t' : 'after-t',
        assertedBy: [],
        withinEpisode: episodeContaining(row.day, episodes),
      };
      byKey.set(key, line);
    }
    line.assertedBy.push({ lane: row.lane, dataset: row.dataset, vintage: row.vintage, nrows: row.nrows });
  }
  const lines = [...byKey.values()];
  for (const line of lines) {
    line.assertedBy.sort((a, b) => a.vintage.localeCompare(b.vintage) || a.lane.localeCompare(b.lane) || a.dataset.localeCompare(b.dataset));
  }
  return lines.sort((a, b) => a.day.localeCompare(b.day) || a.kind.localeCompare(b.kind));
}

function vintagesOf(lines: readonly StateEvidenceLine[]): string[] {
  return sortedUnique(lines.flatMap(line => line.assertedBy.map(a => a.vintage)));
}

function commonCaveats(lines: readonly StateEvidenceLine[]): StateCaveat[] {
  const caveats: StateCaveat[] = [];
  if (lines.some(line => line.withinEpisode !== null)) caveats.push('mass-episode-window');
  if (lines.some(line => line.assertedBy.some(a => isMonthPrecision(a.vintage)))) caveats.push('month-precision-vintage');
  return caveats;
}

// Cross-vintage disagreements on the licensing past-event facts: per kind, the
// per-dataset EARLIEST asserted day (the issue #800 comparison statistic);
// more than one distinct value across datasets is a disagreement. Bookkeeping
// movement and reservation-window restatement are routine for their columns
// (S2's expected-progression / window-restated) and are deliberately not
// counted here.
function findDisagreements(rows: readonly SubjectEventRow[]): KindDisagreement[] {
  const disagreements: KindDisagreement[] = [];
  const licensingKinds = new Set([...kindsWithContribution('licence-start'), ...kindsWithContribution('licence-end')]);
  for (const kind of EVENT_DATE_KINDS) {
    if (!licensingKinds.has(kind)) continue;
    const perDataset = new Map<string, { earliest: string; lane: string; dataset: string; vintage: string }>();
    for (const row of rows) {
      if (row.kind !== kind) continue;
      const key = `${row.lane}\n${row.dataset}`;
      const existing = perDataset.get(key);
      if (existing === undefined || row.day < existing.earliest) {
        perDataset.set(key, { earliest: row.day, lane: row.lane, dataset: row.dataset, vintage: row.vintage });
      }
    }
    const byDay = new Map<string, { lane: string; dataset: string; vintage: string }[]>();
    for (const entry of perDataset.values()) {
      const list = byDay.get(entry.earliest);
      if (list === undefined) byDay.set(entry.earliest, [{ lane: entry.lane, dataset: entry.dataset, vintage: entry.vintage }]);
      else list.push({ lane: entry.lane, dataset: entry.dataset, vintage: entry.vintage });
    }
    if (byDay.size <= 1) continue;
    disagreements.push({
      kind,
      statistic: 'earliest-asserted',
      values: [...byDay.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([day, assertedBy]) => ({
          day,
          assertedBy: assertedBy.sort((a, b) => a.vintage.localeCompare(b.vintage) || a.lane.localeCompare(b.lane) || a.dataset.localeCompare(b.dataset)),
        })),
    });
  }
  return disagreements.sort((a, b) => a.kind.localeCompare(b.kind));
}

export interface StateContext {
  // The S2 detector's mass-update episode windows — evidence lines whose day
  // falls inside one are annotated (issue #801).
  episodes: readonly Episode[];
}

export const EMPTY_STATE_CONTEXT: StateContext = { episodes: [] };

// Derive the inferred state of one subject at event-time t from its evidence
// rows, under an optional assertion-time ceiling. Pure: everything the answer
// carries is computed from the given rows, the query, and the episode
// windows, so every figure is re-runnable from the ledger alone.
export function deriveStateAtT(rows: readonly SubjectEventRow[], query: StateAtTQuery, context: StateContext = EMPTY_STATE_CONTEXT): StateAtT {
  assertIsoDay(query.t, 'event-time t');
  if (query.assertionCeiling !== undefined) assertIsoDay(query.assertionCeiling, 'assertion ceiling');
  const ceiling = query.assertionCeiling ?? null;

  const consultedRows = ceiling === null ? [...rows] : rows.filter(row => vintageOnOrBefore(row.vintage, ceiling));
  const excludedRows = ceiling === null ? [] : rows.filter(row => !vintageOnOrBefore(row.vintage, ceiling));
  const vintagesConsulted = sortedUnique(consultedRows.map(row => row.vintage));
  const vintagesExcluded = sortedUnique(excludedRows.map(row => row.vintage)).filter(v => !vintagesConsulted.includes(v));

  const base: Omit<StateAtT, 'addressable' | 'bounds' | 'findings' | 'disagreements' | 'evidence'> = {
    subject: query.subject,
    t: query.t,
    assertionCeiling: ceiling,
    epistemics: 'inferred',
    vintagesConsulted,
    vintagesExcluded,
  };

  if (consultedRows.length === 0) {
    return {
      ...base,
      addressable: false,
      bounds: { latestOnOrBeforeT: [], earliestAfterT: [] },
      findings: [{
        rule: 'no-evidence-for-subject',
        epistemics: 'inferred',
        statement: `no event-time claim for this subject exists in the consulted corpus — the state at ${query.t} cannot be inferred; this is non-observation, never "did not exist" or "was available"`,
        assertingVintages: [],
        evidence: [],
        caveats: ['availability-trap'],
      }],
      disagreements: [],
      evidence: [],
    };
  }

  const t = query.t;
  const lines = buildLines(consultedRows, t, context.episodes);
  const onOrBefore = lines.filter(line => line.relation === 'on-or-before-t');
  const after = lines.filter(line => line.relation === 'after-t');

  const boundDayBefore = onOrBefore.length === 0 ? null : onOrBefore[onOrBefore.length - 1].day;
  const boundDayAfter = after.length === 0 ? null : after[0].day;
  const bounds = {
    latestOnOrBeforeT: boundDayBefore === null ? [] : onOrBefore.filter(line => line.day === boundDayBefore),
    earliestAfterT: boundDayAfter === null ? [] : after.filter(line => line.day === boundDayAfter),
  };

  const findings: StateFinding[] = [];
  const disagreements = findDisagreements(consultedRows);
  const disagreeingKinds = new Set(disagreements.map(d => d.kind));

  // --- Licence starts -------------------------------------------------------
  const startLines = onOrBefore.filter(line => line.contribution === 'licence-start');
  const cancelLines = onOrBefore.filter(line => line.contribution === 'licence-end');
  const latestStart = startLines.length === 0 ? null : startLines[startLines.length - 1].day;
  const latestCancel = cancelLines.length === 0 ? null : cancelLines[cancelLines.length - 1].day;

  if (startLines.length > 0 && latestStart !== null) {
    // The caveats a start finding carries about its OWN date's reliability:
    // the date-derived ones (issue #800 earliest-surviving, issue #565
    // pre-1977) are separated out because the in-force finding rests on this
    // same start and inherits them (issue #861 item 1) — a #726 surface
    // rendering the in-force finding ALONE must not shed the unreliability of
    // the date it depends on just because the start finding was adjacent.
    const startDateCaveats: StateCaveat[] = [];
    if (startLines.some(line => EARLIEST_SURVIVING_KINDS.has(line.kind))) startDateCaveats.push('earliest-surviving');
    if (startLines.some(line => line.day < '1977-01-01')) startDateCaveats.push('pre-1977');
    const startCaveats: StateCaveat[] = [...startDateCaveats];
    if (startLines.some(line => disagreeingKinds.has(line.kind))) startCaveats.push('vintages-disagree');
    startCaveats.push(...commonCaveats(startLines));
    const earliestStart = startLines[0].day;
    findings.push({
      rule: 'licence-start-on-or-before-t',
      epistemics: 'inferred',
      statement: earliestStart === latestStart
        ? `a licence(-version) start dated ${latestStart} is asserted on or before ${t}`
        : `licence(-version) starts dated between ${earliestStart} and ${latestStart} are asserted on or before ${t}`,
      assertingVintages: vintagesOf(startLines),
      evidence: startLines,
      caveats: startCaveats,
    });

    // Closed-interval boundary (issue #861 item 2): a cancellation dated ON
    // the latest start day is treated as addressing that start, so a licence
    // issued and cancelled the same day does NOT read consistent-with-in-force.
    // The strict-`>` open interval let a same-day issue+cancel read as
    // in-force — literally true under the stated interval but semantically
    // dubious; the closed reading is the more honest one, and the cancellation
    // findings then carry the story instead of a misleading in-force claim.
    const cancelsOnOrAfterStart = cancelLines.filter(line => line.day >= latestStart);
    if (cancelsOnOrAfterStart.length === 0) {
      findings.push({
        rule: 'consistent-with-licence-in-force-at-t',
        epistemics: 'inferred',
        statement: `start evidence dated ${latestStart} with no cancellation evidence dated in [${latestStart}, ${t}] among the consulted claims — consistent with a licence being in force at ${t}, never proof`,
        assertingVintages: vintagesOf(startLines),
        evidence: startLines,
        caveats: [...startDateCaveats, 'cancellation-sparsity', 'availability-trap', ...commonCaveats(startLines)],
      });
    }
  }

  // --- Cancellations --------------------------------------------------------
  if (cancelLines.length > 0 && latestCancel !== null) {
    findings.push({
      rule: 'licence-cancelled-on-or-before-t',
      epistemics: 'inferred',
      statement: `a licence cancellation dated ${latestCancel} is asserted on or before ${t}`,
      assertingVintages: vintagesOf(cancelLines),
      evidence: cancelLines,
      caveats: commonCaveats(cancelLines),
    });
    if (latestStart === null || latestCancel > latestStart) {
      findings.push({
        rule: 'cancelled-with-no-later-start-evidence-by-t',
        epistemics: 'inferred',
        statement: `the latest cancellation (${latestCancel}) post-dates every consulted start assertion on or before ${t}${latestStart === null ? ' (of which there are none)' : ` (latest ${latestStart})`} — no surviving evidence of a licence starting after it by ${t}; NOT evidence the callsign was available at ${t}`,
        assertingVintages: vintagesOf(cancelLines),
        evidence: cancelLines,
        caveats: ['availability-trap', ...commonCaveats(cancelLines)],
      });
    }
  }

  // --- Reservation windows --------------------------------------------------
  const reservationLines = lines.filter(line => line.contribution === 'reservation-end');
  if (reservationLines.length > 0) {
    const distinctEnds = sortedUnique(reservationLines.map(line => line.day));
    const restated: StateCaveat[] = distinctEnds.length > 1 ? ['window-restated'] : [];
    const coveringLines = reservationLines.filter(line =>
      line.day >= t && line.assertedBy.some(a => vintageOnOrBefore(a.vintage, t)));
    const unattestedLines = reservationLines.filter(line =>
      line.day >= t && !line.assertedBy.some(a => vintageOnOrBefore(a.vintage, t)));
    const endedLines = reservationLines.filter(line => line.day < t);
    if (coveringLines.length > 0) {
      findings.push({
        rule: 'reservation-window-consistent-with-covering-t',
        epistemics: 'inferred',
        statement: `a reservation window with stated end ${coveringLines.map(l => l.day).join(', ')} (on or after ${t}) was asserted by a vintage collected on or before ${t} — consistent with a reservation covering ${t}`,
        assertingVintages: vintagesOf(coveringLines),
        evidence: coveringLines,
        caveats: ['reserved-cohort-ambiguity', ...restated, ...commonCaveats(coveringLines)],
      });
    } else if (unattestedLines.length > 0) {
      findings.push({
        rule: 'reservation-window-start-unattested',
        epistemics: 'inferred',
        statement: `a reservation window end on or after ${t} is asserted (${unattestedLines.map(l => l.day).join(', ')}), but no asserting vintage is proven to precede ${t} — the window’s start is unattested, so coverage of ${t} cannot be inferred`,
        assertingVintages: vintagesOf(unattestedLines),
        evidence: unattestedLines,
        caveats: ['reserved-cohort-ambiguity', 'availability-trap', ...restated, ...commonCaveats(unattestedLines)],
      });
    } else if (endedLines.length > 0) {
      findings.push({
        rule: 'reservation-window-stated-ended-by-t',
        epistemics: 'inferred',
        statement: `every asserted reservation window end (${endedLines.map(l => l.day).join(', ')}) precedes ${t} — the stated window had ended by ${t}; what the callsign’s state at ${t} then was is not inferable from this bound`,
        assertingVintages: vintagesOf(endedLines),
        evidence: endedLines,
        caveats: ['reserved-cohort-ambiguity', 'availability-trap', ...restated, ...commonCaveats(endedLines)],
      });
    }
  }

  // --- System presence ------------------------------------------------------
  const presenceLines = onOrBefore.filter(line => line.contribution === 'system-presence');
  if (presenceLines.length > 0) {
    findings.push({
      rule: 'record-in-system-on-or-before-t',
      epistemics: 'inferred',
      statement: `record bookkeeping stamps dated on or before ${t} (earliest ${presenceLines[0].day}) — the record existed in the publisher’s system by ${t}; a statement about the system, never a licensing event`,
      assertingVintages: vintagesOf(presenceLines),
      evidence: presenceLines,
      caveats: commonCaveats(presenceLines),
    });
  }

  // --- The honest gap -------------------------------------------------------
  // Any reservation-window finding — covering, ended, OR start-unattested —
  // addresses the reservation aspect of the licensing question, so the honest
  // gap arm must not ALSO fire (issue #861 item 3): start-unattested already
  // says a future-dated window bound exists but its start is unattested;
  // co-firing no-licensing-evidence on top read self-contradictory at a glance
  // (a window bound exists AND no licensing evidence exists). Excluding
  // start-unattested here — the same way covering and ended were already
  // excluded — removes the asymmetry that produced the double-fire.
  const licensingAddressed =
    startLines.length > 0
    || cancelLines.length > 0
    || findings.some(f =>
      f.rule === 'reservation-window-consistent-with-covering-t'
      || f.rule === 'reservation-window-stated-ended-by-t'
      || f.rule === 'reservation-window-start-unattested');
  if (!licensingAddressed) {
    findings.push({
      rule: 'no-licensing-evidence-on-or-before-t',
      epistemics: 'inferred',
      statement: `no licensing-evidence claim (start, cancellation, reservation bound) is dated on or before ${t}${boundDayAfter === null ? '' : ` — the subject’s earliest dated evidence is ${boundDayAfter}, after ${t}`}; the state at ${t} cannot be inferred, and this never reads as "did not exist" or "was available"`,
      assertingVintages: vintagesOf(lines),
      evidence: [],
      caveats: ['availability-trap'],
    });
  }

  findings.sort((a, b) => RULE_ORDER.indexOf(a.rule) - RULE_ORDER.indexOf(b.rule));
  return { ...base, addressable: true, bounds, findings, disagreements, evidence: lines };
}

// --- SQL folds ---------------------------------------------------------------

function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function sqlList(values: readonly string[]): string {
  return values.map(sqlLiteral).join(', ');
}

// The S1 event-claim relation (the same shape the S2 coherency fold reads):
// one row per event claim, the kind lifted out of the predicate, the dataset
// key out of the lane-rooted sourceFile path, the subject cleaned to the
// cross-publication join key. Unkeyable subjects cannot be queried by cleaned
// key and are excluded here (they remain in the ledger).
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

// Every dated assertion the corpus holds for ONE cleaned subject — the
// evidence rows deriveStateAtT consumes.
export function foldSubjectEvents(source: string | ClaimsSource, subject: string): SubjectEventRow[] {
  const claims = toClaimsSource(source);
  if (!claimsSourcePresent(claims)) return [];
  return foldQuery<SubjectEventRow>(`WITH ${eventsCte(claims)}
SELECT kind, lane, dataset, vintage, "day", count(*)::BIGINT AS nrows
FROM events
WHERE subject = ${sqlLiteral(subject)}
GROUP BY kind, lane, dataset, vintage, "day"
ORDER BY kind, "day", lane, dataset, vintage`);
}

// Per-kind corpus coverage: how many datasets and subjects even carry each
// event kind, over what asserted-day span, from which vintages — the numbers
// behind every "the corpus can only address…" statement.
export interface KindCoverageRow {
  kind: string;
  contribution: StateContribution;
  datasets: number;
  vintages: string[];
  subjects: number;
  claims: number;
  earliestDay: string;
  latestDay: string;
}

export function foldKindCoverage(source: string | ClaimsSource): KindCoverageRow[] {
  const claims = toClaimsSource(source);
  if (!claimsSourcePresent(claims)) return [];
  const rows = foldQuery<Omit<KindCoverageRow, 'contribution'>>(`WITH ${eventsCte(claims)}
SELECT kind,
       count(DISTINCT lane || '/' || dataset)::BIGINT AS datasets,
       list(DISTINCT vintage ORDER BY vintage) AS vintages,
       count(DISTINCT subject)::BIGINT AS subjects,
       count(*)::BIGINT AS claims,
       min("day") AS earliestDay,
       max("day") AS latestDay
FROM events
GROUP BY kind
ORDER BY kind`);
  return rows.map(row => ({ ...row, contribution: contributionOf(row.kind) }));
}

// The addressability headline: how much of the ledger's cleaned-subject
// universe carries state-addressable evidence at all. The denominator is the
// DISTINCT cleaned subjects across EVERY claim in the ledger — deliberately
// broad (it includes non-callsign subject families such as forbidden
// suffixes), and captioned as such wherever rendered: an honest over-count of
// the universe beats an invented classifier.
export interface SubjectUniverse {
  totalSubjects: number;
  eventSubjects: number;
  licensingSubjects: number;
}

export function foldSubjectUniverse(source: string | ClaimsSource): SubjectUniverse {
  const claims = toClaimsSource(source);
  if (!claimsSourcePresent(claims)) return { totalSubjects: 0, eventSubjects: 0, licensingSubjects: 0 };
  const licensingKinds = sqlList([
    ...kindsWithContribution('licence-start'),
    ...kindsWithContribution('licence-end'),
    ...kindsWithContribution('reservation-end'),
  ]);
  const rows = foldQuery<SubjectUniverse>(`WITH ${eventsCte(claims)}
SELECT
  (SELECT count(DISTINCT ${cleanedKeyExpr('rawSubject')})
     FROM ${claimsRelation(claims)}
    WHERE ${cleanedKeyExpr('rawSubject')} <> '')::BIGINT AS totalSubjects,
  (SELECT count(DISTINCT subject) FROM events)::BIGINT AS eventSubjects,
  (SELECT count(DISTINCT subject) FROM events WHERE kind IN (${licensingKinds}))::BIGINT AS licensingSubjects`);
  return rows[0] ?? { totalSubjects: 0, eventSubjects: 0, licensingSubjects: 0 };
}

// --- The engine over a claims source ----------------------------------------

// Detect the mass-update episode windows from the claims source (the S2
// detector, identical parameters) — the context evidence-line annotation
// consults. Exposed so callers folding several answers detect once.
export function detectStateContext(source: string | ClaimsSource, params: EpisodeParams = DEFAULT_EPISODE_PARAMS): StateContext {
  return { episodes: mergeEpisodes(detectEpisodeSignals(foldDaySignals(source), params), params) };
}

// One subject's inferred state at t, folded straight from a claims source —
// the entry point issue #726's surfaces call.
export function stateAtT(source: string | ClaimsSource, query: StateAtTQuery, context?: StateContext): StateAtT {
  const resolved = context ?? detectStateContext(source);
  return deriveStateAtT(foldSubjectEvents(source, query.subject), query, resolved);
}

// --- The committed report ----------------------------------------------------

// Authored worked examples: each is a recorded ground-truth scenario (issue
// #800's mechanism exemplars, the reservation cohort finding, an
// outside-coverage subject), run live through the engine over the real corpus
// at report-build time so the committed answers are the engine's actual
// output, golden-gated against drift.
export interface WorkedExample {
  title: string;
  query: StateAtTQuery;
  commentary: string[];
}

export const WORKED_EXAMPLES: readonly WorkedExample[] = [
  {
    title: 'A rich event history, whole corpus: G3ATI at 1960-06-01',
    query: { subject: 'G3ATI', t: '1960-06-01' },
    commentary: [
      'G3ATI is issue #800’s mechanism-A exemplar: a 1952-10-10 licence-version row',
      'survives in the 2025-11-11 open-data vintage but is absent from the 2021',
      'register annexes and from 2026-06-23. Consulting the whole corpus, the 1952',
      'start is on the record, so a start on or before 1960-06-01 is asserted —',
      'and the per-dataset earliest starts disagree, which the answer surfaces',
      'without resolving.',
    ],
  },
  {
    title: 'The same question under a 2021 assertion ceiling: G3ATI at 1960-06-01, as asserted by 2021',
    query: { subject: 'G3ATI', t: '1960-06-01', assertionCeiling: '2021-12-31' },
    commentary: [
      'The bi-temporal crux: restricted to vintages proven on or before 2021-12-31,',
      'the earliest surviving start assertion is 2015-02-07 — AFTER t — so the same',
      'event-time question honestly cannot be answered. Issue #800’s forward-only',
      'creep means later vintages can carry LESS early history than earlier ones;',
      'here the 1952 evidence only enters the record with the 2025-11-11 vintage,',
      'so widening the ceiling surfaces evidence the narrow ceiling lacked.',
    ],
  },
  {
    title: 'A vintage disagreement, surfaced not resolved: G3SDS at 2000-01-01',
    query: { subject: 'G3SDS', t: '2000-01-01' },
    commentary: [
      'G3SDS is issue #800’s mechanism-B exemplar: four version-scoped vintages',
      'assert an original start of 1977-07-09, and the 2026-06-23 vintage asserts',
      '2026-02-23 — a wholesale sole-row replacement. At t = 2000-01-01 the 1977',
      'assertions support a start on or before t while the 2026 assertion does',
      'not; the answer lists both camps by vintage and adjudicates neither.',
    ],
  },
  {
    title: 'A reservation window bound: GB0SNB at 2025-06-01',
    query: { subject: 'GB0SNB', t: '2025-06-01' },
    commentary: [
      'GB0SNB (the Kelvedon Hatch bunker’s permanent special-event station) carries',
      'a stated reservation window end of 2026-08-09 in the 2024-09 disclosure —',
      'the permanent-SES cohort whose column carries three meanings (issue #725).',
      'The engine reads only the window bound: the assertion precedes t and the',
      'stated end follows it, so the answer is consistent-with-covering, never a',
      'status claim.',
    ],
  },
  {
    title: 'Outside coverage, the explicit cannot-infer: Q1ZZZ at 2020-01-01',
    query: { subject: 'Q1ZZZ', t: '2020-01-01' },
    commentary: [
      'No held dataset carries any event-time claim for this subject. The answer',
      'is an explicit cannot-infer — and, per the availability-trap convention,',
      'it is NEVER read as "the callsign did not exist" or "was available":',
      'non-observation is not an observation of absence.',
    ],
  },
];

export interface StateAtTReport {
  params: EpisodeParams;
  episodes: Episode[];
  coverage: KindCoverageRow[];
  universe: SubjectUniverse;
  examples: { example: WorkedExample; answer: StateAtT }[];
}

export function computeStateAtTReport(source: string | ClaimsSource, params: EpisodeParams = DEFAULT_EPISODE_PARAMS): StateAtTReport {
  const claims = toClaimsSource(source);
  const episodes = time('state-at-t:episodes', () => detectStateContext(claims, params).episodes);
  const context: StateContext = { episodes: [...episodes] };
  const coverage = time('state-at-t:coverage', () => foldKindCoverage(claims));
  const universe = time('state-at-t:universe', () => foldSubjectUniverse(claims));
  const examples = time('state-at-t:examples', () => WORKED_EXAMPLES.map(example => ({
    example,
    answer: deriveStateAtT(foldSubjectEvents(claims, example.query.subject), example.query, context),
  })));
  return { params, episodes: [...episodes], coverage, universe, examples };
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

function renderAssertion(a: EvidenceAssertion): string {
  return `${mdCode(a.dataset)} (${a.vintage}${a.nrows > 1 ? `, ${num(a.nrows)} rows` : ''})`;
}

function renderEvidenceTable(lines: readonly StateEvidenceLine[]): string[] {
  if (lines.length === 0) return ['(no evidence lines)', ''];
  return [
    '| event kind | contribution | event day | relation to t | asserted by | episode window |',
    '|---|---|---|---|---|---|',
    ...lines.map(line =>
      `| ${mdCode(line.kind)} | ${line.contribution} | ${line.day} | ${line.relation} | ${line.assertedBy.map(renderAssertion).join('; ')} | ${line.withinEpisode === null ? '—' : `${line.withinEpisode.start} → ${line.withinEpisode.end}`} |`),
    '',
  ];
}

export function renderStateAnswer(answer: StateAtT): string[] {
  const lines: string[] = [
    `Query: state of ${mdCode(answer.subject)} at t = ${answer.t}, `
    + (answer.assertionCeiling === null
      ? 'consulting the whole corpus.'
      : `consulting only vintages proven on or before ${answer.assertionCeiling}.`),
    '',
    `Vintages consulted: ${answer.vintagesConsulted.length === 0 ? '(none)' : answer.vintagesConsulted.join(', ')}.`
    + (answer.vintagesExcluded.length === 0 ? '' : ` Excluded by the ceiling: ${answer.vintagesExcluded.join(', ')}.`),
    '',
  ];
  if (!answer.addressable) {
    lines.push('**Outside coverage — cannot infer.**', '');
  }
  if (answer.bounds.latestOnOrBeforeT.length > 0 || answer.bounds.earliestAfterT.length > 0) {
    const before = answer.bounds.latestOnOrBeforeT;
    const afterB = answer.bounds.earliestAfterT;
    lines.push(
      'Bounding assertions: '
      + (before.length === 0 ? 'none on or before t' : `latest on or before t: ${before.map(l => `${mdCode(l.kind)} ${l.day}`).join(', ')}`)
      + '; '
      + (afterB.length === 0 ? 'none after t' : `earliest after t: ${afterB.map(l => `${mdCode(l.kind)} ${l.day}`).join(', ')}`)
      + '.',
      '',
    );
  }
  lines.push('Findings (every finding is **[inferred]** — issue #723):', '');
  for (const finding of answer.findings) {
    lines.push(
      `- **${finding.rule}** — ${finding.statement}.`
      + (finding.assertingVintages.length === 0 ? '' : ` Asserting vintages: ${finding.assertingVintages.join(', ')}.`)
      + (finding.caveats.length === 0 ? '' : ` Caveats: ${finding.caveats.join(', ')}.`),
    );
  }
  lines.push('');
  if (answer.disagreements.length > 0) {
    lines.push('Vintage disagreements (surfaced, never resolved — issue #467):', '');
    for (const d of answer.disagreements) {
      lines.push(`- ${mdCode(d.kind)} (${d.statistic}): ${d.values.map(v => `${v.day} per ${v.assertedBy.map(a => `${mdCode(a.dataset)} (${a.vintage})`).join(', ')}`).join(' vs ')}`);
    }
    lines.push('');
  }
  if (answer.evidence.length > 0) {
    lines.push('Evidence:', '');
    lines.push(...renderEvidenceTable(answer.evidence));
  }
  return lines;
}

export function renderStateAtTReport(report: StateAtTReport): string {
  const lines: string[] = [
    '# State-at-t reconstruction (bi-temporal)',
    '',
    'The state-at-t inference engine (issue #725, S3): given the event-time',
    'claims (S1) and the coherency picture over them (S2), what can the mirror',
    'honestly say about a callsign at an arbitrary date t? Every answer is',
    '**inferred** in the issue #723 trichotomy — the ACTUAL state is Ofcom’s',
    'own, in principle unknowable from outside; the DECLARED evidence is each',
    'vintage’s dated cells (the S1 claims, each wearing its asserting source',
    'and vintage); an INFERRED answer is a derivation of ours, always naming',
    'the asserting vintages and always conservative. Answers are parameterised',
    'by BOTH temporal axes: event-time t, and an optional assertion-time',
    'ceiling ("as asserted by vintages up to v") — a 2026 vintage’s claim',
    'about 1952 is evidence FROM 2026, and issue #800’s forward-only creep',
    'means a later vintage can carry LESS early history than an earlier one.',
    'Where vintages disagree, the answer surfaces the disagreement and',
    'resolves nothing (issue #467). Absence of evidence is NON-OBSERVATION:',
    'it never reads as "was available", "nothing happened", or "did not',
    'exist", and a query outside coverage returns an explicit cannot-infer.',
    '',
    'The engine is `deriveStateAtT` / `stateAtT` (src/ci/state-at-t.ts) — the',
    'mechanism the issue #726 reader-facing surfaces will call. This report is',
    'the engine demonstrated over the real corpus: regenerated and committed,',
    'so a new vintage shifting any answer shows up as a PR diff. No state',
    'answer is ever stored as a ledger claim — answers are read-time',
    'derivations, re-runnable from the ledger alone.',
    '',
    '## Inference rules',
    '',
    'Every finding names exactly one rule (used only with these meanings):',
    '',
    ...[...RULE_GLOSSES.entries()].map(([rule, gloss]) => `- **${rule}** — ${gloss}`),
    '',
    '## Caveats',
    '',
    'Findings carry caveats by id (each used only with this meaning):',
    '',
    ...[...CAVEAT_GLOSSES.entries()].map(([caveat, gloss]) => `- **${caveat}** — ${gloss}`),
    '',
    '## How each event kind contributes',
    '',
    'The authored contribution registry — total over the S1 kind vocabulary,',
    'so a new kind cannot silently join (or silently skip) the state reading.',
    'Bookkeeping kinds NEVER feed a licensing inference: inside a detected',
    'mass-update episode (the **mass-episode-window** caveat above) their',
    'stamps record one system episode, not per-record licensing events, and',
    'even outside an episode they attest only the record’s presence in the',
    'publisher’s system.',
    '',
    '| event kind | contribution | reading |',
    '|---|---|---|',
    ...EVENT_DATE_KINDS.map((kind) => {
      const contribution = contributionOf(kind);
      const reading = contribution === 'licence-start'
        ? (EARLIEST_SURVIVING_KINDS.has(kind)
          ? 'licence-start evidence; earliest SURVIVING start only, pre-1977 unreliability (the **earliest-surviving** and **pre-1977** caveats above)'
          : 'licence-start evidence')
        : contribution === 'licence-end'
          ? 'cancellation evidence (sparsely attested — see coverage)'
          : contribution === 'reservation-end'
            ? 'stated window bound only; three cohort meanings, never a status'
            : kind === 'licence-created'
              ? 'system presence of the licence RECORD (Salesforce-era stamp), never the grant'
              : 'system presence of the register record, never a licensing event';
      return `| ${mdCode(kind)} | ${contribution} | ${reading} |`;
    }),
    '',
    '## Coverage honesty',
    '',
    'What fraction of the corpus a state query can even address. The subject',
    'universe below counts DISTINCT cleaned subjects across EVERY claim in the',
    'ledger — deliberately broad (it includes non-callsign subject families',
    'such as forbidden suffixes), an honest over-count preferred to an',
    'invented classifier — so the addressable shares are, if anything,',
    'understated.',
    '',
    `- Cleaned subjects in the ledger: ${num(report.universe.totalSubjects)}`,
    `- …with at least one event-time claim: ${num(report.universe.eventSubjects)} (${pct(report.universe.totalSubjects === 0 ? 0 : report.universe.eventSubjects / report.universe.totalSubjects)})`,
    `- …with at least one LICENSING-evidence claim (start / cancellation / reservation bound): ${num(report.universe.licensingSubjects)} (${pct(report.universe.totalSubjects === 0 ? 0 : report.universe.licensingSubjects / report.universe.totalSubjects)})`,
    '',
    'Per-kind coverage — the vintages that attest each kind at all, and the',
    'asserted-day span they cover. A kind absent from a period cannot support',
    'any inference there: in particular, cancellation evidence is confined to',
    'the vintages below, which is why "no cancellation evidence" is always a',
    'weak, caveated absence.',
    '',
    '| event kind | contribution | datasets | subjects | claims | asserted-day span | asserting vintages |',
    '|---|---|---:|---:|---:|---|---|',
    ...report.coverage.map(row =>
      `| ${mdCode(row.kind)} | ${row.contribution} | ${num(row.datasets)} | ${num(row.subjects)} | ${num(row.claims)} | ${row.earliestDay} → ${row.latestDay} | ${row.vintages.join(', ')} |`),
    '',
    '## Mass-update episode windows consulted',
    '',
    'The S2 detector’s episode windows (parameters: window ≤',
    `${report.params.windowDays} days, share > ${pct(report.params.shareThreshold)}, minimum ${num(report.params.minPopulated)} populated dates`,
    '— see reports/event-time-coherency.md for the full witness tables).',
    'Evidence lines whose day falls inside a window are annotated in every',
    'answer, so a bookkeeping stamp never masquerades as a per-record event.',
    '',
    ...(report.episodes.length === 0
      ? ['No episode window was detected. This is "no flag", not a clean bill of health.', '']
      : [...report.episodes.map((e, i) => `- Episode ${i + 1}: ${e.start} → ${e.end} (${num(e.signals.length)} witness signals)`), '']),
    '## Worked examples',
    '',
    'Authored ground-truth scenarios, run live through the engine over the',
    'real corpus at report-build time — the committed answers ARE the',
    'engine’s output, so any drift in the corpus or the rules shows here.',
    '',
  ];
  report.examples.forEach(({ example, answer }) => {
    lines.push(`### ${example.title}`, '', ...example.commentary, '', ...renderStateAnswer(answer));
  });
  return lines.join('\n');
}

export const STATE_AT_T_PATH = 'reports/state-at-t.md';

export function buildStateAtTReport(ledgerDir?: string, params: EpisodeParams = DEFAULT_EPISODE_PARAMS): StateAtTReport {
  const { source, dispose } = acquireClaimsSource(ledgerDir);
  try {
    return computeStateAtTReport(source, params);
  } finally {
    dispose();
  }
}

export function writeStateAtTReport(): { path: string; changed: boolean } {
  const markdown = renderStateAtTReport(buildStateAtTReport());
  const target = path.resolve(process.cwd(), STATE_AT_T_PATH);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const existing = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : undefined;
  const changed = existing !== markdown;
  if (changed) fs.writeFileSync(target, markdown);
  return { path: STATE_AT_T_PATH, changed };
}

if (import.meta.main) {
  const { path: written, changed } = writeStateAtTReport();
  console.log(`${changed ? 'wrote' : 'up to date'}: ${written}`);
  perfReport({ entrypoint: 'state-at-t' });
}
