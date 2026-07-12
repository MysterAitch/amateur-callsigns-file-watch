/**
 * Fold the data-quality rollup (reports/data-quality.md, issue #51) from the
 * raw-keyed claim ledger (issue #361, migration-map: the LAST Phase-B report to
 * gain a ledger fold). The rollup has four parts, and the mapping audit that
 * precedes this fold found EVERY part reconstructible from the ledger's T1
 * parse-attribute tier (claim.ts, #406/#422) plus the whole-source
 * stripped-collision tier (#361) — no part needs the legacy stats.json
 * callsignQuality block the writeQualityRollup comment feared was irreducible:
 *
 *  1. The defect-detector matrix. Its six rows are NOT an independent signal —
 *     each is a RELABELLING of a flag/parse-status the ledger already carries,
 *     which the mapping audit confirmed against components.ts's flag predicates:
 *       - Excel-date-shaped callsigns   = flag `excel-date-shape`
 *       - encoding-failure characters   = flag `encoding-failure`
 *       - whitespace/invisible-bearing  = flag `whitespace`
 *       - post-normalisation duplicates = flag `stripped-collision`
 *       - empty callsigns               = parse-status `empty`
 *       - lowercase-bearing             = flag `lowercase`
 *     Five of the six are GUARANTEED-equal: the detector predicate in
 *     shared/stats.ts and the flag predicate in components.ts are the SAME test
 *     over the SAME verbatim token (the ofcom-amateur normaliser copies the
 *     callsign column verbatim, so the ledger's rawSubject is the token the
 *     detector saw). The ONE exception is `lowercase`: the detector tests ASCII
 *     `/[a-z]/` while the flag fires on ANY case-difference (`upper !== callsign`),
 *     so the flag is a strict SUPERSET. They coincide on the whole current corpus
 *     (every lowercase-bearing token is ASCII), so the fold reproduces the golden
 *     byte-for-byte; the equivalence oracle pins that, and any future non-ASCII
 *     case-bearing token would trip it rather than drift silently. This is the
 *     single classified subtlety, recorded here rather than faked to zero.
 *  2. The component-parse flags registry — one row per `flag` object seen in the
 *     open-data lane, counted per publication.
 *  3. The parse statuses — one row per `parse_status` object, plus the `empty`
 *     bucket RECOVERED from the @listed anchors that carry no parse_status claim
 *     (the T1 tier emits parse_status iff the token is non-empty, so "an @listed
 *     observation with no parse_status claim" is EXACTLY an empty token — the same
 *     recovery the prefix distribution fold makes for its `_(empty)_` row).
 *  4. The per-detector example tables — the raw offender tokens, rendered with
 *     {U+FFFD}/{nbsp}/{space} escapes. They fold from the rawSubject of the SAME
 *     flagged observations: the offender tokens are the flag claims' subjects, and
 *     the empty detector's sole token is the blank subject of a recovered anchor.
 *
 * WHY it folds to ZERO residual byte divergence (unlike the value catalogue). The
 * legacy rollup reads stats.json, derived from the NORMALISED callsign column, but
 * the ofcom-amateur normaliser copies the callsign VERBATIM and is row-preserving
 * (normalise.ts), so the ledger parses the SAME raw token over the SAME rows. The
 * rollup is OPEN-DATA only (one column per published register snapshot) and counts
 * RECORDS, so the fold reads the identical parse over the identical rows and the
 * committed golden reproduces byte-for-byte. The one non-trivial move is the
 * `empty` recovery in parts 1, 3 and 4, classified above.
 *
 * Posture (ADR 0002): the fold runs through report-fold.ts, so DuckDB enters CI as
 * the pinned, checksum-verified static CLI, never a native-build npm dependency.
 * The fold hard-fails without the engine rather than emitting a silently-different
 * report. The legacy generator (normalise-sweep.ts) stays current-best; this fold
 * ADDS the equivalence oracle (Phase C retirement of the generator is separately
 * gated).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildLedger } from '../v2/build-ledger.ts';
import { LISTED_PREDICATE, FLAG_PREDICATE, PARSE_STATUS_PREDICATE } from '../v2/claim.ts';
import {
  foldQuery,
  claimsRelation,
  claimsSourcePresent,
  toClaimsSource,
  deployClaimsSource,
  type ClaimsSource,
} from '../v2/report-fold.ts';
import { markUnprintables } from '../shared/stats.ts';
import { loadReferenceData, type ReferenceData } from '../sources/ofcom-amateur/components.ts';

// One defect detector's folded figures, shaped exactly as the legacy
// DetectorResult the renderer consumes: how many rows it flagged, plus up to
// EXAMPLE_CAP offending tokens with their unprintables already exploded to
// {U+XXXX} markers, deduplicated and lexicographically sorted (the detect()
// contract in shared/stats.ts).
export interface DetectorResult {
  count: number;
  examples: string[];
}

// The folded data-quality rollup: the dated open-data columns (newest first, the
// legacy column order) and the per-part figures the renderer turns into the four
// tables plus the example sections. Every map keys by a rendered ROW name (the
// detector key, the flag object, the parse-status name) to a per-date count (or,
// for detectors, a per-date DetectorResult), matching the legacy stats-derived
// shape so the one renderer draws either source identically.
export interface DataQualityFold {
  dates: string[];
  recordCounts: Map<string, number>;
  detectors: Map<string, Map<string, DetectorResult>>;
  flags: Map<string, Map<string, number>>;
  parseStatuses: Map<string, Map<string, number>>;
}

// The example cap, matching shared/stats.ts's EXAMPLE_CAP (not exported there):
// the legacy detect() lists at most this many distinct offending tokens.
const EXAMPLE_CAP = 5;

// The parse-status name recovered for a blank token (components.ts's ParseStatus
// for an empty callsign) — the bucket the T1 tier emits no claim for, recovered
// from the @listed anchor.
const EMPTY_STATUS = 'empty';

// The defect-detector matrix rows whose count and offender tokens fold from a
// single T1 `flag` object, keyed by the legacy detector key (shared/stats.ts's
// CallsignQuality field names, the renderer's row keys) -> the flag object. The
// `lowercaseBearing` -> `lowercase` mapping is the classified superset subtlety
// documented in the module header. The sixth detector, `emptyCallsign`, folds
// from the recovered `empty` parse-status instead (its sole token is the blank
// subject), so it is handled separately rather than listed here.
export const DETECTOR_FLAG_SOURCES: ReadonlyMap<string, string> = new Map([
  ['excelDateShaped', 'excel-date-shape'],
  ['encodingFailure', 'encoding-failure'],
  ['whitespaceBearing', 'whitespace'],
  ['postNormalisationDuplicates', 'stripped-collision'],
  ['lowercaseBearing', 'lowercase'],
]);

// The detector key whose figures fold from the recovered `empty` parse-status.
export const EMPTY_DETECTOR_KEY = 'emptyCallsign';

// Every detector key the matrix renders, in the legacy row order — the five
// flag-backed rows interleaved with the recovered empty row, matching
// writeQualityRollup's detector list so the folded and legacy matrices are
// row-for-row identical.
export const DETECTOR_KEYS: readonly string[] = [
  'excelDateShaped',
  'encodingFailure',
  'whitespaceBearing',
  'postNormalisationDuplicates',
  'emptyCallsign',
  'lowercaseBearing',
];

// A DuckDB comma-separated list of single-quoted string literals.
function sqlStringList(values: readonly string[]): string {
  return values.map(value => `'${value.replace(/'/g, "''")}'`).join(', ');
}

// The open-data lane and its date key: the rollup is open-data only (one column
// per publication date), matching the legacy generator, so both restrict to
// `opendata/<date>/…` and read the date from the second path segment — the same
// contract as quality-report-fold.
const OPEN_DATA_LANE = `sourceFile LIKE 'opendata/%'`;
const DATE_EXPR = `split_part(sourceFile, '/', 2)`;

// --- Fold SQL ---------------------------------------------------------------

// Per open-data publication: the record count (every @listed anchor, one per
// published row) and the empty-token count (anchors carrying no parse_status
// claim — the recovered `empty` bucket). The parse_status set is DISTINCT-keyed
// so a stray duplicate could never split the LEFT JOIN; the total ORDER BY keeps
// DuckDB's output deterministic (report-fold's contract).
interface RecordsRow {
  date: string;
  records: number;
  empties: number;
}

function recordsSql(source: ClaimsSource): string {
  return `WITH claims AS (
  SELECT * FROM ${claimsRelation(source)}
),
obs AS (
  SELECT sourceFile, ordinal, ${DATE_EXPR} AS date
  FROM claims WHERE layer='raw' AND predicate='${LISTED_PREDICATE}' AND ${OPEN_DATA_LANE}
),
ps AS (
  SELECT DISTINCT sourceFile, ordinal
  FROM claims WHERE layer='derived' AND predicate='${PARSE_STATUS_PREDICATE}'
)
SELECT o.date AS date, count(*) AS records, count(*) FILTER (WHERE p.ordinal IS NULL) AS empties
FROM obs o
LEFT JOIN ps p USING (sourceFile, ordinal)
GROUP BY o.date
ORDER BY o.date`;
}

// Per (date, object) count of one derived predicate over the open-data lane — the
// flag registry (predicate `flag`) and the parse-status table (predicate
// `parse_status`) fold identically, one claim per observation per object, so
// count(*) per group is the record count. Total ORDER BY for determinism.
interface AggregateRow {
  date: string;
  object: string;
  records: number;
}

function aggregateSql(source: ClaimsSource, predicate: string): string {
  return `WITH claims AS (
  SELECT * FROM ${claimsRelation(source)}
)
SELECT ${DATE_EXPR} AS date, object AS object, count(*) AS records
FROM claims
WHERE layer='derived' AND predicate='${predicate}' AND ${OPEN_DATA_LANE}
GROUP BY date, object
ORDER BY date, object`;
}

// Per (date, flag) the raw offender tokens for the five flag-backed detectors —
// the subjects of the flag claims, verbatim. The detector populations are small
// (tens of rows at most), so enumerating every offender token is cheap; the
// distinct-mark-sort-cap that mirrors detect() runs in TypeScript so the sort
// order is byte-identical to stats.ts's. Total ORDER BY for determinism.
interface OffenderRow {
  date: string;
  flag: string;
  rawSubject: string;
}

function offendersSql(source: ClaimsSource, flags: readonly string[]): string {
  return `WITH claims AS (
  SELECT * FROM ${claimsRelation(source)}
)
SELECT ${DATE_EXPR} AS date, object AS flag, rawSubject AS rawSubject
FROM claims
WHERE layer='derived' AND predicate='${FLAG_PREDICATE}' AND ${OPEN_DATA_LANE} AND object IN (${sqlStringList(flags)})
ORDER BY date, object, rawSubject`;
}

// --- Assembly ---------------------------------------------------------------

// The examples for a detector on one date: the distinct offender tokens with
// their unprintables exploded, lexicographically sorted and capped — EXACTLY
// detect()'s `[...new Set(offenders.map(markUnprintables))].sort().slice(0, cap)`,
// so the fold's example list matches the legacy stored one byte-for-byte.
function examplesFrom(rawSubjects: readonly string[]): string[] {
  return [...new Set(rawSubjects.map(markUnprintables))].sort().slice(0, EXAMPLE_CAP);
}

// Assemble the four folded parts into the report's shape: dates newest-first (the
// legacy column order), the per-detector matrix (five flag-backed rows plus the
// recovered empty row, every date populated so a zero renders `0` not `—`), the
// flag registry and the parse-status table (empty recovered from the anchors).
function assemble(
  recordsRows: readonly RecordsRow[],
  flagRows: readonly AggregateRow[],
  statusRows: readonly AggregateRow[],
  offenderRows: readonly OffenderRow[],
): DataQualityFold {
  const dates = [...new Set(recordsRows.map(r => r.date))].sort().reverse();
  const recordCounts = new Map<string, number>();
  const empties = new Map<string, number>();
  for (const r of recordsRows) {
    recordCounts.set(r.date, r.records);
    empties.set(r.date, r.empties);
  }

  const bumpMap = (map: Map<string, Map<string, number>>, key: string, date: string, count: number): void => {
    const byDate = map.get(key) ?? new Map<string, number>();
    byDate.set(date, count);
    map.set(key, byDate);
  };

  const flags = new Map<string, Map<string, number>>();
  for (const r of flagRows) bumpMap(flags, r.object, r.date, r.records);

  const parseStatuses = new Map<string, Map<string, number>>();
  for (const r of statusRows) bumpMap(parseStatuses, r.object, r.date, r.records);
  // The empty parse-status is recovered from the anchors (the tier emits no
  // parse_status for a blank token), so it never appears in statusRows. Add it
  // wherever a date carried at least one empty token, exactly as the legacy
  // parseStatuses map holds `empty` only for datasets that saw one.
  for (const [date, count] of empties) {
    if (count > 0) bumpMap(parseStatuses, EMPTY_STATUS, date, count);
  }

  // The offender tokens per (date, flag), for the five flag-backed detectors.
  const offendersByDateFlag = new Map<string, string[]>();
  const offenderKey = (date: string, flag: string): string => `${date} ${flag}`;
  for (const r of offenderRows) {
    const key = offenderKey(r.date, r.flag);
    const list = offendersByDateFlag.get(key) ?? [];
    list.push(r.rawSubject);
    offendersByDateFlag.set(key, list);
  }

  const detectors = new Map<string, Map<string, DetectorResult>>();
  for (const detectorKey of DETECTOR_KEYS) detectors.set(detectorKey, new Map());
  for (const date of dates) {
    for (const [detectorKey, flag] of DETECTOR_FLAG_SOURCES) {
      const count = flags.get(flag)?.get(date) ?? 0;
      const offenders = offendersByDateFlag.get(offenderKey(date, flag)) ?? [];
      detectors.get(detectorKey)?.set(date, { count, examples: examplesFrom(offenders) });
    }
    // The empty detector: its count is the recovered empty-token count and its
    // sole offending token is the blank subject (markUnprintables('') === '').
    const emptyCount = empties.get(date) ?? 0;
    detectors.get(EMPTY_DETECTOR_KEY)?.set(date, {
      count: emptyCount,
      examples: emptyCount > 0 ? examplesFrom(['']) : [],
    });
  }

  return { dates, recordCounts, detectors, flags, parseStatuses };
}

// Fold the data-quality rollup from a directory of per-source ledger JSONL files.
export function foldDataQuality(source: string | ClaimsSource): DataQualityFold {
  const claims = toClaimsSource(source);
  if (!claimsSourcePresent(claims)) {
    return { dates: [], recordCounts: new Map(), detectors: new Map(), flags: new Map(), parseStatuses: new Map() };
  }
  const detectorFlags = [...DETECTOR_FLAG_SOURCES.values()];
  const recordsRows = foldQuery<RecordsRow>(recordsSql(claims));
  const flagRows = foldQuery<AggregateRow>(aggregateSql(claims, FLAG_PREDICATE));
  const statusRows = foldQuery<AggregateRow>(aggregateSql(claims, PARSE_STATUS_PREDICATE));
  const offenderRows = foldQuery<OffenderRow>(offendersSql(claims, detectorFlags));
  return assemble(recordsRows, flagRows, statusRows, offenderRows);
}

// Build the data-quality fold from ONE claims source. A caller holding a ledger
// passes its directory (a test fixture); otherwise the shared deploy-time
// claims.parquet is read when the workflow built one (issue #403), and only in
// its absence (local dev, tests) is the full-corpus ledger materialised once to a
// scratch directory. skipFailedSources matches the normalise sweep's per-entry
// independence — a malformed entry the sweep already reports is skipped, not a
// reason to crash the whole report.
export function buildDataQualityFold(ledgerDir?: string, ref: ReferenceData = loadReferenceData()): DataQualityFold {
  if (ledgerDir !== undefined) return foldDataQuality(ledgerDir);
  const shared = deployClaimsSource();
  if (shared !== null) return foldDataQuality(shared);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'data-quality-ledger-'));
  try {
    buildLedger(scratch, undefined, ref, undefined, true);
    return foldDataQuality(path.join(scratch, 'ledger'));
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}
