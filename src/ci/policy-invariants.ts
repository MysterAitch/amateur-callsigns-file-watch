/**
 * Policy-as-tests: the regulator's ON-THE-RECORD statements encoded as
 * executable invariants over the held data (issue #863).
 *
 * The thesis: Ofcom has, at various points, stated in writing HOW the register
 * behaves — what 'Allocated' and 'Reserved' mean, how a callsign is generated,
 * which suffixes are excluded. Each such statement is a testable claim about
 * the data we mirror. This module turns each into an INVARIANT: an authored
 * entry that
 *   - CITES its source statement (the verbatim on-the-record words, with an
 *     archive path and a human citation — every policy invariant carries its
 *     provenance, per the citation conventions the rest of the estate uses);
 *   - carries an EXECUTABLE CHECK folded over the claim ledger (issue #361:
 *     every derived view is a fold, byte-deterministic, golden-gated); and
 *   - reports its findings in an AUTHORED, CLOSED vocabulary.
 *
 * Posture (issue #467, binding — the same flag-don't-adjudicate stance the S2
 * coherency detector and the S3 state engine take): a violation is NEVER a
 * verdict. A datum that does not satisfy a stated policy is evidence of one of
 * — a policy change since the statement, a documented exception (a permanent
 * reservation is not a cooling-down one), or a data artefact — and the report
 * offers those candidates and chooses none. The invariant LOCATES where the
 * data and the stated rule diverge; a human decides what the divergence means.
 *
 * Mechanism form (the S2/S3 precedent — event-time-coherency.ts,
 * state-at-t.ts): a pure, unit-testable classification engine over rows a
 * DuckDB fold extracts from the ledger, plus a committed, golden-gated report
 * (reports/policy-invariants.md) demonstrating every invariant over the real
 * corpus. No new ledger claims are emitted — the findings are read-time
 * derivations, re-runnable from the ledger alone.
 *
 * FRAMEWORK, then the FIRST invariant. The registry (POLICY_INVARIANTS) is
 * structured so the further invariants the issue names — the generator
 * rule-set from the 2017 Salesforce confirmation letter (format-per-licence-
 * class), the forbidden-suffix exclusions — slot in as sibling entries, each
 * with its own cited statement, check and vocabulary. The first entry, built
 * out here, is:
 *
 *   the two-year reservation window — FOI 756622's Allocated/Reserved
 *   definitions (the wdtk-596532 response letter, Ofcom, 6 September 2019):
 *   'Reserved' means a callsign USED WITHIN THE PAST TWO YEARS, no longer in
 *   use, "cooling down", re-appliable after the two-year period. The stated
 *   reservation window is therefore AT MOST two years long. The check folds
 *   every `reserved-until` S1 event claim (the stated end of a reservation
 *   window) and asks whether that end lies within two years of the vintage
 *   asserting it — classifying each observation conformant / longer-than-
 *   stated / shorter-than-stated / undeterminable. #568's community-tier
 *   "reserved over five years" observation is one known instance this
 *   generalises: it surfaces here as the beyond-five-years subset of
 *   longer-than-stated, cross-referenced but never adjudicated.
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
import { EVENT_DATE_RULE, eventDatePredicate } from '../v2/claim.ts';
import { vintageDaySpan } from './state-at-t.ts';
import { acquireClaimsSource } from './event-time-coherency.ts';
import { mdCell, mdCode } from '../shared/markdown.ts';
import { time, perfReport } from '../shared/perf.ts';

// --- The framework: a cited source statement + an invariant registry ---------

// One on-the-record statement an invariant encodes. Every policy invariant
// cites exactly one, carrying the verbatim words, the archive path they live
// at, and a human-readable citation — so a reader can re-verify the rule the
// data is being tested against, not just the test result.
export interface SourceStatement {
  // A stable id (referenced by the invariant and pinned by the freeze test).
  id: string;
  // The human citation: who said it, where, when.
  citation: string;
  // The repo-relative path to the archived source the quote is drawn from.
  archivePath: string;
  // The verbatim on-the-record words the invariant rests on.
  quote: string;
  // The tier of the source (Ofcom primary vs community), so a reader knows the
  // authority the invariant is grounded in.
  tier: 'ofcom-primary' | 'community';
}

// One executable policy invariant: a cited statement, what the invariant
// asserts should hold over the data, the prose form of the check that tests
// it, and the closed vocabulary its findings are reported in (each term
// glossed so it never reaches a reader bare).
export interface PolicyInvariant {
  id: string;
  title: string;
  source: SourceStatement;
  // What the invariant asserts should hold if the stated policy holds.
  asserts: string;
  // The executable check, in prose (the code that runs it lives in this
  // module; the fold and the pure classifier are named so a reader can re-run).
  check: string;
  // The finding vocabulary: term -> gloss. Authored and closed.
  findingVocabulary: ReadonlyMap<string, string>;
  // Whether the check is implemented (the first invariant) or a registered
  // placeholder the framework reserves a slot for (the further invariants).
  status: 'implemented' | 'planned';
}

// --- The two-year reservation window: the cited statement --------------------

export const RESERVED_DEFINITION_STATEMENT: SourceStatement = {
  id: 'foi-756622-reserved-definition',
  citation: 'FOI 756622 (WhatDoTheyKnow request 596532), Ofcom response letter (Jerin John, Information Rights Adviser), 6 September 2019',
  archivePath: 'archive/foi/wdtk-596532--allocated-reserved-forbidden/raw-extract-amateur-radio-callsigns-howell.md',
  quote:
    "'Reserved' means that the callsign has been used within the past two years, "
    + 'although it is no longer, and is in the process of ‘cooling down’. It is '
    + 'therefore not currently available for assignment to anyone else, but operators '
    + 'will be able to apply for it again after the two-year period has expired.',
  tier: 'ofcom-primary',
};

// --- The finding vocabulary (authored, closed, glossed) ----------------------

// Each reserved-until observation lands in exactly one class. The vocabulary is
// candidate-bearing where it flags divergence: longer/shorter carry the
// explanations a human would weigh, and choose none (issue #467).
export type ReservationWindowClass =
  | 'conformant'
  | 'longer-than-stated'
  | 'shorter-than-stated'
  | 'undeterminable';

export const CLASS_ORDER: readonly ReservationWindowClass[] = [
  'conformant',
  'longer-than-stated',
  'shorter-than-stated',
  'undeterminable',
];

export const CLASS_GLOSSES: ReadonlyMap<ReservationWindowClass, string> = new Map([
  ['conformant', 'the stated reservation end lies on or after the asserting vintage and within two years of it — consistent with the two-year cooling window under EVERY assertion instant the vintage’s precision admits (a day-keyed vintage is a single instant; a month-keyed vintage is judged conservatively across its whole month). Consistency is not proof: the window bound is all the cell states, and the reservation’s START (the last-use date) is nowhere attested, so this reads the stated end as compatible with the policy, never as confirmation the policy was applied'],
  ['longer-than-stated', 'the stated reservation end lies MORE than two years beyond the asserting vintage (beyond it under every assertion instant the vintage admits) — a window the two-year cooling cannot produce from a last use on or before the vintage. Candidate explanations, none chosen: a PERMANENT or planned multi-year reservation (special-event and broadcast callsigns are reserved indefinitely — a distinct arrangement from a cooling-down window), a policy that has changed since the 2019 statement, or an export/date artefact. #568’s community-tier "reserved beyond five years" observation is the extreme tail of this class'],
  ['shorter-than-stated', 'the stated reservation end PRECEDES the asserting vintage (before it under every assertion instant the vintage admits) — the stated window had already closed when the vintage asserted it. Candidate explanations, none chosen: a retrospective TERMINATION record (the Available-status cohort carries a past reserved-to date recording when a reservation ended, not a live window — see reports/state-at-t.md’s reserved-cohort ambiguity), a lapsed reservation not yet cleared, or an artefact'],
  ['undeterminable', 'the asserting vintage is keyed by month, not day, and the stated end falls in a band where the two-year test’s answer depends on the exact (unknown) assertion day within that month — conformant under some days of the month, longer or shorter under others. Reported honestly as undeterminable rather than guessed: month-precision is a declared-not-proven assertion time (the state-at-t vintage-precision convention)'],
]);

// --- The two-year window classifier (pure) -----------------------------------

const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

// Add whole years to an ISO day, deterministically (Feb 29 + n years rolls to
// Mar 1 in years without a leap day — a fixed, documented rounding, not a
// guess). Used for the +2-year policy bound and the +5-year #568 subset.
export function plusYears(isoDay: string, years: number): string {
  const [y, m, d] = isoDay.split('-').map(Number);
  return new Date(Date.UTC(y + years, m - 1, d)).toISOString().slice(0, 10);
}

// Classify one reservation observation (a stated end date, asserted by one
// vintage) against the two-year policy. The vintage's precision is honoured
// exactly as the state engine honours it: a day-keyed vintage is a single
// assertion instant; a month-keyed vintage is a span [S, L], and the classes
// are the bands that hold under EVERY instant in that span — the residual
// bands, where the answer would depend on the exact day, are undeterminable.
//
// Policy derivation: 'Reserved' means used within the past two years, cooling
// ends two years after last use U, and U <= the assertion instant A. So the
// stated end E must satisfy A <= E <= A + 2y. Across a month vintage A ranges
// over [S, L]; conformant-under-all is [L, S+2y], shorter-under-all is E < S,
// longer-under-all is E > L + 2y, and the rest is undeterminable.
export function classifyReservationWindow(reservedUntil: string, vintage: string): ReservationWindowClass {
  if (!ISO_DAY_RE.test(reservedUntil)) {
    throw new Error(`classifyReservationWindow: reservedUntil "${reservedUntil}" is not an ISO day (yyyy-mm-dd)`);
  }
  const { earliest: S, latest: L } = vintageDaySpan(vintage);
  const sPlus2 = plusYears(S, 2);
  const lPlus2 = plusYears(L, 2);
  if (reservedUntil < S) return 'shorter-than-stated';
  if (reservedUntil > lPlus2) return 'longer-than-stated';
  if (reservedUntil >= L && reservedUntil <= sPlus2) return 'conformant';
  return 'undeterminable';
}

// Whether a longer-than-stated observation is also BEYOND FIVE YEARS of the
// vintage (beyond it under every assertion instant) — #568's threshold, the
// extreme tail this invariant generalises. Only meaningful once the class is
// longer-than-stated.
export function isBeyondFiveYears(reservedUntil: string, vintage: string): boolean {
  const { latest: L } = vintageDaySpan(vintage);
  return reservedUntil > plusYears(L, 5);
}

// --- Fold rows and classified observations -----------------------------------

// One reserved-until observation the fold extracts: what one dataset asserts,
// at one vintage, for one cleaned subject — the stated end of a reservation
// window (the S1 `reserved-until` event kind).
export interface ReservationObservation {
  subject: string;
  reservedUntil: string;
  lane: string;
  dataset: string;
  vintage: string;
  nrows: number;
}

export interface ClassifiedObservation extends ReservationObservation {
  klass: ReservationWindowClass;
  beyondFiveYears: boolean;
}

export function classifyObservation(row: ReservationObservation): ClassifiedObservation {
  const klass = classifyReservationWindow(row.reservedUntil, row.vintage);
  return { ...row, klass, beyondFiveYears: klass === 'longer-than-stated' && isBeyondFiveYears(row.reservedUntil, row.vintage) };
}

// --- The SQL fold ------------------------------------------------------------

function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

// The `reserved-until` event-claim relation: one row per (cleaned subject,
// stated end day, dataset, vintage), the subject cleaned to the cross-
// publication join key, unkeyable subjects excluded from THIS fold only (they
// remain in the ledger), exactly the eventsCte shape the S2/S3 folds read but
// restricted to the reservation kind.
function reservationCte(source: ClaimsSource): string {
  return `reservations AS (
  SELECT ${cleanedKeyExpr('rawSubject')} AS subject,
         split_part(sourceFile, '/', 1) AS lane,
         split_part(sourceFile, '/', 2) AS dataset,
         vintage,
         object AS reservedUntil
  FROM ${claimsRelation(source)}
  WHERE rule = '${EVENT_DATE_RULE}'
    AND predicate = ${sqlLiteral(eventDatePredicate('reserved-until'))}
    AND ${cleanedKeyExpr('rawSubject')} <> ''
)`;
}

export function foldReservationObservations(source: string | ClaimsSource): ReservationObservation[] {
  const claims = toClaimsSource(source);
  if (!claimsSourcePresent(claims)) return [];
  return foldQuery<ReservationObservation>(`WITH ${reservationCte(claims)}
SELECT subject, reservedUntil, lane, dataset, vintage, count(*)::BIGINT AS nrows
FROM reservations
GROUP BY subject, reservedUntil, lane, dataset, vintage
ORDER BY vintage, lane, dataset, reservedUntil, subject`);
}

// --- The assembled findings --------------------------------------------------

// Per (class) totals: how many observations, and how many DISTINCT subjects
// (a subject can appear in more than one class across vintages).
export interface ClassTotal {
  klass: ReservationWindowClass;
  observations: number;
  subjects: number;
}

// Per (lane, dataset, vintage) breakdown: the class counts for one disclosure,
// so a reader sees which publication each cohort comes from — the day-keyed
// disclosures classify cleanly, the month-keyed one carries the undeterminable
// band.
export interface DatasetBreakdown {
  lane: string;
  dataset: string;
  vintage: string;
  conformant: number;
  longerThanStated: number;
  shorterThanStated: number;
  undeterminable: number;
  total: number;
}

// A capped exemplar set for one class — the shape of the working, not a
// ranking (the full detail is re-derivable from the fold for any subject).
export interface ClassExemplars {
  klass: ReservationWindowClass;
  rows: ClassifiedObservation[];
}

export interface TwoYearReservationFindings {
  totalObservations: number;
  totalSubjects: number;
  totals: ClassTotal[];
  breakdown: DatasetBreakdown[];
  exemplars: ClassExemplars[];
  // The #568 cross-reference: longer-than-stated observations beyond five
  // years of their vintage — the extreme tail #568 flagged, surfaced here.
  beyondFiveYears: ClassifiedObservation[];
}

// Per (class) cap on committed exemplar rows and on the beyond-five-years list
// — the report shows the working's shape; the fold yields the full detail.
export const EXEMPLAR_LIMIT = 10;

function sortObservations(rows: readonly ClassifiedObservation[]): ClassifiedObservation[] {
  return [...rows].sort((a, b) =>
    a.subject.localeCompare(b.subject)
    || a.vintage.localeCompare(b.vintage)
    || a.lane.localeCompare(b.lane)
    || a.dataset.localeCompare(b.dataset)
    || a.reservedUntil.localeCompare(b.reservedUntil));
}

export function computeTwoYearReservationFindings(source: string | ClaimsSource): TwoYearReservationFindings {
  const observations = foldReservationObservations(source).map(classifyObservation);

  const perClassSubjects = new Map<ReservationWindowClass, Set<string>>();
  const perClassCount = new Map<ReservationWindowClass, number>();
  const allSubjects = new Set<string>();
  const breakdownByKey = new Map<string, DatasetBreakdown>();
  for (const obs of observations) {
    allSubjects.add(obs.subject);
    perClassCount.set(obs.klass, (perClassCount.get(obs.klass) ?? 0) + 1);
    const subjects = perClassSubjects.get(obs.klass) ?? new Set<string>();
    subjects.add(obs.subject);
    perClassSubjects.set(obs.klass, subjects);

    const key = `${obs.lane}\n${obs.dataset}\n${obs.vintage}`;
    const breakdown = breakdownByKey.get(key) ?? {
      lane: obs.lane, dataset: obs.dataset, vintage: obs.vintage,
      conformant: 0, longerThanStated: 0, shorterThanStated: 0, undeterminable: 0, total: 0,
    };
    if (obs.klass === 'conformant') breakdown.conformant += 1;
    else if (obs.klass === 'longer-than-stated') breakdown.longerThanStated += 1;
    else if (obs.klass === 'shorter-than-stated') breakdown.shorterThanStated += 1;
    else breakdown.undeterminable += 1;
    breakdown.total += 1;
    breakdownByKey.set(key, breakdown);
  }

  const totals: ClassTotal[] = CLASS_ORDER.map(klass => ({
    klass,
    observations: perClassCount.get(klass) ?? 0,
    subjects: perClassSubjects.get(klass)?.size ?? 0,
  }));

  const breakdown = [...breakdownByKey.values()].sort((a, b) =>
    a.lane.localeCompare(b.lane) || a.dataset.localeCompare(b.dataset) || a.vintage.localeCompare(b.vintage));

  const exemplars: ClassExemplars[] = CLASS_ORDER.map(klass => ({
    klass,
    rows: sortObservations(observations.filter(o => o.klass === klass)).slice(0, EXEMPLAR_LIMIT),
  }));

  const beyondFiveYears = sortObservations(observations.filter(o => o.beyondFiveYears)).slice(0, EXEMPLAR_LIMIT);

  return {
    totalObservations: observations.length,
    totalSubjects: allSubjects.size,
    totals,
    breakdown,
    exemplars,
    beyondFiveYears,
  };
}

// --- The invariant registry (the framework) ----------------------------------

export const TWO_YEAR_RESERVATION_INVARIANT: PolicyInvariant = {
  id: 'two-year-reservation-window',
  title: 'The two-year reservation window',
  source: RESERVED_DEFINITION_STATEMENT,
  asserts:
    'A reservation is a two-year cooling-down window: a callsign is Reserved because it was used within the past two years and is no longer, re-appliable after the two-year period. The stated end of a reservation window (the `reserved-until` cell) should therefore lie on or after, and within two years of, the assertion that records it.',
  check:
    'Fold every `reserved-until` S1 event claim (foldReservationObservations) and classify each stated end against its asserting vintage with the pure classifier (classifyReservationWindow): conformant / longer-than-stated / shorter-than-stated / undeterminable, honouring day- vs month-vintage precision. Report counts, a per-disclosure breakdown, exemplars per class, and the beyond-five-years subset that generalises #568.',
  findingVocabulary: CLASS_GLOSSES as ReadonlyMap<string, string>,
  status: 'implemented',
};

// The further invariants the issue names — registered as framework slots so a
// reader sees the shape the estate is growing into, each cited, each planned.
// Building one out means promoting its status to 'implemented' with its own
// fold, classifier and exemplars, exactly as the reservation invariant is.
export const PLANNED_INVARIANTS: readonly PolicyInvariant[] = [
  {
    id: 'generator-format-per-class',
    title: 'The generator rule-set: format per licence class',
    source: {
      id: 'salesforce-2017-generator-letter',
      citation: 'Ofcom Salesforce callsign-generator confirmation letter, 2017 (held in the archive)',
      archivePath: 'archive/foi/',
      quote: 'The 2017 confirmation of the callsign generator rule-set: valid formats per licence class (Foundation / Intermediate / Full), ITU RR Article 19 + Appendix 42, and the recent-past-use check.',
      tier: 'ofcom-primary',
    },
    asserts: 'Every issued callsign’s format matches the format rules stated for its licence class.',
    check: 'PLANNED: fold each callsign’s parsed prefix/format against the stated per-class format rules; a mismatch is a candidate finding (issuance-time input, a legitimate arrangement not publicly stated, or an artefact).',
    findingVocabulary: new Map(),
    status: 'planned',
  },
  {
    id: 'forbidden-suffix-exclusions',
    title: 'The forbidden-suffix exclusions',
    source: {
      id: 'forbidden-suffix-disclosures',
      citation: 'Ofcom Forbidden Call Signs disclosures (FOI 756622 annex and later)',
      archivePath: 'archive/foi/wdtk-596532--allocated-reserved-forbidden/',
      quote: 'A callsign whose suffix is on the Forbidden Call Signs list is excluded from issue.',
      tier: 'ofcom-primary',
    },
    asserts: 'No issued callsign carries a forbidden suffix (modulo the dated-issue caveats already recorded).',
    check: 'PLANNED: the forbidden-suffix history (reports/forbidden-suffix-history.md) already tests part of this; promote its findings into this registry as an invariant with the same flag-don’t-adjudicate vocabulary.',
    findingVocabulary: new Map(),
    status: 'planned',
  },
];

export const POLICY_INVARIANTS: readonly PolicyInvariant[] = [
  TWO_YEAR_RESERVATION_INVARIANT,
  ...PLANNED_INVARIANTS,
];

// --- The assembled report ----------------------------------------------------

export interface PolicyInvariantsReport {
  invariants: readonly PolicyInvariant[];
  twoYearReservation: TwoYearReservationFindings;
}

export function computePolicyInvariantsReport(source: string | ClaimsSource): PolicyInvariantsReport {
  const twoYearReservation = time('policy-invariants:two-year-reservation', () => computeTwoYearReservationFindings(source));
  return { invariants: POLICY_INVARIANTS, twoYearReservation };
}

// --- Rendering ---------------------------------------------------------------

function num(n: number): string {
  return n.toLocaleString('en-GB');
}

function pct(share: number): string {
  return `${(share * 100).toFixed(1)}%`;
}

const CLASS_LABELS: ReadonlyMap<ReservationWindowClass, string> = new Map([
  ['conformant', 'conformant'],
  ['longer-than-stated', 'longer-than-stated'],
  ['shorter-than-stated', 'shorter-than-stated'],
  ['undeterminable', 'undeterminable'],
]);

function renderObservationRow(o: ClassifiedObservation): string {
  return `| ${mdCode(o.subject)} | ${o.reservedUntil} | ${mdCell(o.dataset, 64)} | ${o.vintage} | ${o.klass}${o.beyondFiveYears ? ' (beyond 5y)' : ''} |`;
}

function renderSourceCitation(s: SourceStatement): string[] {
  return [
    `> ${s.quote}`,
    '',
    `Source: ${mdCell(s.citation)} (${s.tier === 'ofcom-primary' ? 'Ofcom primary' : 'community tier'}). Held at \`${s.archivePath}\`.`,
    '',
  ];
}

export function renderPolicyInvariantsReport(report: PolicyInvariantsReport): string {
  const f = report.twoYearReservation;
  const implemented = report.invariants.filter(i => i.status === 'implemented');
  const planned = report.invariants.filter(i => i.status === 'planned');

  const lines: string[] = [
    '# Policy-as-tests: the regulator’s stated rules as executable invariants',
    '',
    'Ofcom has stated, on the record, how the register behaves — what its status',
    'words mean, how callsigns are generated, which suffixes are excluded. Each',
    'such statement is a testable claim about the data this repository mirrors.',
    'This report encodes each as an INVARIANT: an authored entry that cites its',
    'source statement, carries an executable check folded over the claim ledger',
    '(issue #361), and reports its findings in a closed, glossed vocabulary.',
    '',
    '**Flags, never verdicts** (issue #467): a datum that does not satisfy a',
    'stated policy is evidence of a policy change since the statement, a',
    'documented exception, or a data artefact — the report offers those',
    'candidates and chooses none. The invariant LOCATES where the data and the',
    'stated rule diverge; a human decides what the divergence means. The engine',
    'is `src/ci/policy-invariants.ts`; this report is it demonstrated over the',
    'real corpus, regenerated and committed so a new vintage shifting any figure',
    'shows up as a PR diff.',
    '',
    '## Invariant registry',
    '',
    `${num(implemented.length)} implemented, ${num(planned.length)} registered as framework slots (the further invariants the`,
    'issue #863 inventory names — each cited, each promoted to implemented with',
    'its own fold and vocabulary when built out).',
    '',
    '| invariant | status | source | tier |',
    '|---|---|---|---|',
    ...report.invariants.map(i =>
      `| ${mdCell(i.title)} | ${i.status} | ${mdCell(i.source.citation)} | ${i.source.tier === 'ofcom-primary' ? 'Ofcom primary' : 'community'} |`),
    '',
    `## Invariant: ${TWO_YEAR_RESERVATION_INVARIANT.title}`,
    '',
    '### Source statement (cited)',
    '',
    ...renderSourceCitation(citedStatementFor(report, TWO_YEAR_RESERVATION_INVARIANT.id)),
    '### What it asserts',
    '',
    TWO_YEAR_RESERVATION_INVARIANT.asserts,
    '',
    '### The check',
    '',
    TWO_YEAR_RESERVATION_INVARIANT.check,
    '',
    'The reservation’s START (the last-use date) is nowhere attested, so the',
    'check reads the STATED END against the assertion that records it: under the',
    'two-year policy the end must lie on or after the assertion (a live window)',
    'and within two years of it (the cooling cannot exceed two years from a use',
    'no later than the assertion). Vintage precision is honoured exactly as the',
    'state engine honours it (reports/state-at-t.md): a day-keyed vintage is one',
    'assertion instant and classifies cleanly; a month-keyed vintage is a span,',
    'and only the bands that hold under every day of the month are asserted —',
    'the residual is reported as undeterminable, never guessed.',
    '',
    '### An era boundary: the rest period changed in October 2025',
    '',
    'The two-year window is **era-scoped**. The cited 2019 FOI statement (reaffirmed',
    'by the December 2023 FOI response) describes a two-year cooling period; Ofcom’s',
    'October 2025 licensing guidance moved the callsign rest period to **five years**',
    '(“in all circumstances”), alongside the portal changes that introduced the',
    'M8/M9 corresponding-callsign scheme (issues #863, #915). So a `reserved-until`',
    'end asserted from a post-October-2025 vintage should be read against a',
    'five-year, not a two-year, expectation. This report does not silently re-scope',
    'the check: it still classifies every observation against the on-the-record',
    'two-year statement — the corpus’s reservation evidence predates the change —',
    'and flags this era boundary so that a future longer-than-stated observation',
    'from a 2025-10-or-later vintage is read as a candidate policy change (the named',
    'candidate under `longer-than-stated`), never as an anomaly. Flag, not verdict.',
    '',
    '### Finding vocabulary',
    '',
    'Each observation lands in exactly one class (used only with these meanings):',
    '',
    ...CLASS_ORDER.map(klass => `- **${klass}** — ${CLASS_GLOSSES.get(klass) ?? ''}`),
    '',
    '### Findings over the corpus',
    '',
  ];

  if (f.totalObservations === 0) {
    lines.push(
      'No `reserved-until` claim is held in the consulted corpus. This is "no',
      'data to test", not a clean bill of health.',
      '',
    );
  } else {
    lines.push(
      `Folded ${num(f.totalObservations)} \`reserved-until\` observations across`,
      `${num(f.totalSubjects)} distinct cleaned subjects.`,
      '',
      '| class | observations | share | distinct subjects |',
      '|---|---:|---:|---:|',
      ...f.totals.map(t =>
        `| ${CLASS_LABELS.get(t.klass) ?? t.klass} | ${num(t.observations)} | ${pct(f.totalObservations === 0 ? 0 : t.observations / f.totalObservations)} | ${num(t.subjects)} |`),
      '',
      '#### Per-disclosure breakdown',
      '',
      'Which publication each cohort comes from. Month-keyed disclosures carry',
      'the undeterminable band by construction (the assertion day is unknown',
      'within the month); day-keyed disclosures classify cleanly.',
      '',
      '| lane | dataset | vintage | conformant | longer | shorter | undeterminable | total |',
      '|---|---|---|---:|---:|---:|---:|---:|',
      ...f.breakdown.map(b =>
        `| ${b.lane} | ${mdCell(b.dataset, 64)} | ${b.vintage} | ${num(b.conformant)} | ${num(b.longerThanStated)} | ${num(b.shorterThanStated)} | ${num(b.undeterminable)} | ${num(b.total)} |`),
      '',
      '#### Exemplars per class',
      '',
      `Up to ${EXEMPLAR_LIMIT} per class, ordered by subject — the shape of the working,`,
      'not a ranking. Any subject’s observations are re-derivable from the fold.',
      '',
    );
    for (const klass of CLASS_ORDER) {
      const set = f.exemplars.find(e => e.klass === klass);
      lines.push(`**${klass}**`, '');
      if (set === undefined || set.rows.length === 0) {
        lines.push('(none)', '');
      } else {
        lines.push(
          '| callsign | reserved-until | dataset | vintage | class |',
          '|---|---|---|---|---|',
          ...set.rows.map(renderObservationRow),
          '',
        );
      }
    }
    lines.push(
      '#### Cross-reference: #568 (reserved beyond five years)',
      '',
      'Issue #568 records a community-tier (OARC wiki) observation that callsigns',
      'Reserved for more than five years are, in practice, available again — a',
      'specific instance of a reservation outliving the stated two-year window.',
      'This invariant generalises it: the beyond-five-years observations below are',
      'the extreme tail of the longer-than-stated class (their stated end lies',
      'more than five years beyond the asserting vintage). Surfaced, cross-',
      'referenced, and — like every finding here — adjudicated nowhere: a',
      'permanent special-event or broadcast reservation is a legitimate',
      'long-window arrangement, not a policy breach.',
      '',
    );
    if (f.beyondFiveYears.length === 0) {
      lines.push('No reservation states an end beyond five years of its vintage.', '');
    } else {
      lines.push(
        '| callsign | reserved-until | dataset | vintage | class |',
        '|---|---|---|---|---|',
        ...f.beyondFiveYears.map(renderObservationRow),
        '',
      );
    }
  }

  lines.push(
    '## Planned invariants',
    '',
    'Registered framework slots for the further rules the issue #863 inventory',
    'names. Each is cited; building one out promotes it to implemented with its',
    'own fold, classifier and exemplars.',
    '',
  );
  for (const inv of planned) {
    lines.push(
      `### ${inv.title}`,
      '',
      `- **Asserts**: ${inv.asserts}`,
      `- **Check**: ${inv.check}`,
      `- **Source**: ${mdCell(inv.source.citation)} (${inv.source.tier === 'ofcom-primary' ? 'Ofcom primary' : 'community'}).`,
      '',
    );
  }

  return lines.join('\n');
}

// The cited statement rendered under an invariant's heading — resolved from the
// registry (not hand-copied) so the golden test proves the report cites the
// authored source, and a change to the source shows up in the diff.
function citedStatementFor(report: PolicyInvariantsReport, invariantId: string): SourceStatement {
  const inv = report.invariants.find(i => i.id === invariantId);
  return inv?.source ?? RESERVED_DEFINITION_STATEMENT;
}

// --- The committed report ----------------------------------------------------

export const POLICY_INVARIANTS_PATH = 'reports/policy-invariants.md';

export function buildPolicyInvariantsReport(ledgerDir?: string): PolicyInvariantsReport {
  const { source, dispose } = acquireClaimsSource(ledgerDir);
  try {
    return computePolicyInvariantsReport(source);
  } finally {
    dispose();
  }
}

export function writePolicyInvariantsReport(): { path: string; changed: boolean } {
  const markdown = renderPolicyInvariantsReport(buildPolicyInvariantsReport());
  const target = path.resolve(process.cwd(), POLICY_INVARIANTS_PATH);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const existing = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : undefined;
  const changed = existing !== markdown;
  if (changed) fs.writeFileSync(target, markdown);
  return { path: POLICY_INVARIANTS_PATH, changed };
}

if (import.meta.main) {
  const { path: written, changed } = writePolicyInvariantsReport();
  console.log(`${changed ? 'wrote' : 'up to date'}: ${written}`);
  perfReport({ entrypoint: 'policy-invariants' });
}
