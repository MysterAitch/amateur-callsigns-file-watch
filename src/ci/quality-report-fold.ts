/**
 * Fold the parse-attribute quality reports from the raw-keyed claim ledger
 * (issue #361, migration-map step 5): the open-data prefix-series distribution
 * (reports/prefixes.md), the class-product-mismatch standing table
 * (reports/class-product-mismatches.md), the regional-identifier distribution
 * (reports/regional-identifiers.md) and the callsign-pattern time-series
 * (reports/callsign-patterns.md). All are computable ENTIRELY from the T1
 * parse-attribute tier (claim.ts / issues #406, #422): prefix_series,
 * implied_class, parse_status, rsl and the per-flag `flag` claim, plus the
 * callsign-pattern derived claim, joined to the raw @listed anchor and the raw
 * product cell.
 *
 * The regional-identifier and callsign-pattern folds join #422's rsl and
 * callsign-pattern derived claims (#424 emitted them). They are the same open-
 * data-only, record-counting class as the prefix distribution: the ofcom-amateur
 * normaliser copies the callsign VERBATIM and is row-preserving, so the ledger
 * parses the same token over the same rows the legacy generators tally from
 * components.csv / stats.json. Both recover a "no value" bucket from the @listed
 * anchor rather than inventing or dropping it — the regional table has no such
 * bucket (it counts PARSED records only), but the callsign-pattern series does:
 * a blank callsign carries an @listed anchor but no callsign-pattern claim (the
 * tier emits none for an empty token), so the fold recovers the legacy
 * `_(empty)_` bucket from the anchor, exactly as the prefix fold recovers its own.
 *
 * WHY these two, and why they fold to ZERO residual divergence (unlike the
 * value catalogue). The legacy generators read the NORMALISED components.csv /
 * normalised.csv, but the ofcom-amateur normaliser copies the callsign column
 * VERBATIM (it renames/reorders columns and parses dates only — normalise.ts)
 * and is row-preserving, so components.csv parses the SAME raw token the ledger
 * stores as its rawSubject. The reports are also OPEN-DATA only (one row per
 * archive publication) and count RECORDS, not distinct cleaned callsigns. So the
 * fold reads the identical parse over the identical rows: the committed golden
 * reproduces byte-for-byte, and the equivalence oracle
 * (quality-report-fold.test.ts) pins that as a durable retirement gate.
 *
 * The one subtlety, classified there: the T1 tier emits parse_status for every
 * NON-EMPTY token and skips the empty one (there is nothing to parse), so a
 * blank-callsign observation carries an @listed anchor but no parse_status claim.
 * The prefix fold recovers the legacy `_(empty)_` bucket from that anchor —
 * parse_status is emitted iff the token is non-empty (the tier's contract), so
 * "an @listed observation with no parse_status claim" is EXACTLY an empty token.
 * No finding is dropped and nothing is invented: every observation still lands in
 * exactly one row, the legacy invariant.
 *
 * Posture (ADR 0002): the fold runs through report-fold.ts, so DuckDB enters CI
 * as the pinned, checksum-verified static CLI, never a native-build npm
 * dependency. The fold hard-fails without the engine rather than emitting a
 * silently-different report.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildLedger } from '../v2/build-ledger.ts';
import {
  LISTED_PREDICATE,
  PARSE_STATUS_PREDICATE,
  PREFIX_SERIES_PREDICATE,
  IMPLIED_CLASS_PREDICATE,
  FLAG_PREDICATE,
  RSL_PREDICATE,
  CALLSIGN_PATTERN_PREDICATE,
} from '../v2/claim.ts';
import {
  foldQuery,
  claimsRelation,
  claimsSourcePresent,
  toClaimsSource,
  deployClaimsSource,
  type ClaimsSource,
} from '../v2/report-fold.ts';
import { PRODUCT_COLUMN_NAMES } from '../sources/ofcom-amateur/normalise.ts';
import { loadReferenceData, type ReferenceData } from '../sources/ofcom-amateur/components.ts';

// The flag object the class-product-mismatch table folds on — the same closed
// vocabulary token components.ts raises when a prefix-implied class disagrees
// with the declared product (reference-data/flags.md).
const CLASS_PRODUCT_MISMATCH_FLAG = 'class-product-mismatch';

// A DuckDB comma-separated list of single-quoted string literals.
function sqlStringList(values: readonly string[]): string {
  return values.map(value => `'${value.replace(/'/g, "''")}'`).join(', ');
}

// The open-data lane's source key: the second path segment of the corpus-unique
// sourceFile the open-data collector stamps (`opendata/<date>/raw.csv`), which is
// the archive publication date — the column key both reports draw against. The
// FOI lane (`foi/<entry>/…`) carries no components.csv report, so both folds
// restrict to `opendata/%`, matching the open-data-only legacy generators.
const OPEN_DATA_LANE = `sourceFile LIKE 'opendata/%'`;
const DATE_EXPR = `split_part(sourceFile, '/', 2)`;

// --- reports/prefixes.md ----------------------------------------------------

// The prefix distribution as the report renders it: the dated open-data columns
// (newest first) and, per rendered row LABEL, the record count in each date. The
// label is the backtick-wrapped prefix series where the parse resolved one, else
// the parenthesised parse status (`_(visitor)_`, `_(empty)_`, …) — exactly the
// legacy row key, so the table renders shape-for-shape the same.
export interface PrefixDistributionFold {
  dates: string[];
  rows: Map<string, Map<string, number>>;
}

// One folded prefix-distribution row as DuckDB returns it: a (date, label-parts,
// count) triple. `series` is the resolved prefix series or NULL; `status` is the
// parse status, COALESCEd to `empty` for the blank-token anchor that carries no
// parse_status claim (the tier's parse_status-iff-non-empty contract).
interface PrefixFoldRow {
  date: string;
  series: string | null;
  status: string;
  records: number;
}

// The fold SQL for the prefix distribution. One pass over the open-data lane:
//   - obs : every @listed anchor (one per published row — the full record set,
//           so every record lands in exactly one row).
//   - ps  : each observation's parse_status derived claim (absent for a blank
//           token).
//   - pfx : each observation's prefix_series derived claim (absent unless the
//           parse resolved a series).
// The joins are one-to-one on the observation key, so count(*) per group is the
// record count. The total ORDER BY keeps DuckDB's output deterministic; the row
// label and final sort are assembled in TypeScript to match the legacy key sort.
function prefixFoldSql(source: ClaimsSource): string {
  return `WITH claims AS (
  SELECT * FROM ${claimsRelation(source)}
),
obs AS (
  SELECT sourceFile, ordinal, ${DATE_EXPR} AS date
  FROM claims WHERE layer='raw' AND predicate='${LISTED_PREDICATE}' AND ${OPEN_DATA_LANE}
),
ps AS (
  SELECT sourceFile, ordinal, object AS status
  FROM claims WHERE layer='derived' AND predicate='${PARSE_STATUS_PREDICATE}'
),
pfx AS (
  SELECT sourceFile, ordinal, object AS series
  FROM claims WHERE layer='derived' AND predicate='${PREFIX_SERIES_PREDICATE}'
)
SELECT o.date, p.series AS series, COALESCE(s.status, 'empty') AS status, count(*) AS records
FROM obs o
LEFT JOIN ps s USING (sourceFile, ordinal)
LEFT JOIN pfx p USING (sourceFile, ordinal)
GROUP BY o.date, p.series, COALESCE(s.status, 'empty')
ORDER BY o.date, series, status`;
}

// The rendered row label for a folded row: the backtick-wrapped series where the
// parse resolved one, else the parenthesised parse status — the identical key
// the legacy writeComponentDistributions bumps.
function prefixRowLabel(row: PrefixFoldRow): string {
  return row.series !== null ? `\`${row.series}\`` : `_(${row.status})_`;
}

// Assemble the folded rows into the report's shape: dates newest-first (the
// legacy column order) and a per-label per-date count map. The row set is left
// unsorted here — the renderer sorts labels the same way the legacy does.
function assemblePrefixDistribution(foldRows: readonly PrefixFoldRow[]): PrefixDistributionFold {
  const dates = [...new Set(foldRows.map(r => r.date))].sort().reverse();
  const rows = new Map<string, Map<string, number>>();
  for (const row of foldRows) {
    const label = prefixRowLabel(row);
    const byDate = rows.get(label) ?? new Map<string, number>();
    byDate.set(row.date, (byDate.get(row.date) ?? 0) + row.records);
    rows.set(label, byDate);
  }
  return { dates, rows };
}

// Fold the prefix distribution from a directory of per-source ledger JSONL files.
export function foldPrefixDistribution(source: string | ClaimsSource): PrefixDistributionFold {
  const claims = toClaimsSource(source);
  if (!claimsSourcePresent(claims)) return { dates: [], rows: new Map() };
  return assemblePrefixDistribution(foldQuery<PrefixFoldRow>(prefixFoldSql(claims)));
}

// --- reports/class-product-mismatches.md ------------------------------------

// One folded mismatch row as the report renders it: the raw callsign token, the
// prefix series and implied class the parse resolved, and the raw product string
// the row declared. The shape is common to the legacy computation and the fold,
// so the renderer draws each per-dataset section the same way.
export interface MismatchRow {
  callsign: string;
  prefixSeries: string;
  impliedClass: string;
  product: string;
}

// A folded mismatch distribution: EVERY dated open-data column (newest first —
// the report shows a per-dataset section even where none are affected, rendered
// `(none)`) and the affected rows per date, callsign-sorted within each date.
export interface MismatchFold {
  dates: string[];
  byDate: Map<string, MismatchRow[]>;
}

// One folded mismatch row as DuckDB returns it.
interface MismatchFoldRow {
  date: string;
  callsign: string;
  series: string;
  implied: string;
  product: string;
}

// The fold SQL for the class-product-mismatch table. One pass over the open-data
// lane restricted to observations carrying the class-product-mismatch flag:
//   - mm   : the observations whose parse raised the flag.
//   - subj : the raw @listed anchor (the callsign token, verbatim).
//   - pfx  : the resolved prefix series (present for a flagged observation).
//   - cls  : the resolved implied class (present for a flagged observation).
//   - prod : the raw product cell, read under whichever header the vintage used
//            (PRODUCT_COLUMN_NAMES, from the variant registry).
// A flagged observation always has a series, an implied class and a declared
// product (the flag is raised only when the implied class contradicts a declared
// product), so the joins resolve; the report shows all four verbatim.
function mismatchFoldSql(source: ClaimsSource, productHeaders: readonly string[]): string {
  return `WITH claims AS (
  SELECT * FROM ${claimsRelation(source)}
),
mm AS (
  SELECT DISTINCT sourceFile, ordinal, ${DATE_EXPR} AS date
  FROM claims
  WHERE layer='derived' AND predicate='${FLAG_PREDICATE}' AND object='${CLASS_PRODUCT_MISMATCH_FLAG}' AND ${OPEN_DATA_LANE}
),
subj AS (
  SELECT sourceFile, ordinal, rawSubject FROM claims WHERE predicate='${LISTED_PREDICATE}'
),
pfx AS (
  SELECT sourceFile, ordinal, object AS series FROM claims WHERE layer='derived' AND predicate='${PREFIX_SERIES_PREDICATE}'
),
cls AS (
  SELECT sourceFile, ordinal, object AS implied FROM claims WHERE layer='derived' AND predicate='${IMPLIED_CLASS_PREDICATE}'
),
prod AS (
  SELECT sourceFile, ordinal, object AS product FROM claims WHERE layer='raw' AND predicate IN (${sqlStringList(productHeaders)})
)
SELECT m.date, s.rawSubject AS callsign, p.series AS series, c.implied AS implied, COALESCE(r.product, '') AS product
FROM mm m
JOIN subj s USING (sourceFile, ordinal)
LEFT JOIN pfx p USING (sourceFile, ordinal)
LEFT JOIN cls c USING (sourceFile, ordinal)
LEFT JOIN prod r USING (sourceFile, ordinal)
ORDER BY m.date, s.rawSubject`;
}

// Codepoint order (UTF-16 code units), matching normalise.ts's codepointCompare —
// the order components.csv rows (and so the legacy mismatch rows) already sit in.
function codepointCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// The SQL for every open-data publication date the ledger carries — the full
// column set the mismatch report enumerates, so a dataset with no affected rows
// still gets its `(none)` section (an absence the report deliberately shows).
function openDataDatesSql(source: ClaimsSource): string {
  return `SELECT DISTINCT ${DATE_EXPR} AS date
FROM ${claimsRelation(source)}
WHERE layer='raw' AND predicate='${LISTED_PREDICATE}' AND ${OPEN_DATA_LANE}
ORDER BY date`;
}

// Assemble the folded rows into the report's shape: every open-data date
// newest-first (so zero-mismatch datasets still render), the affected rows per
// date callsign-sorted (codepoint order, the components.csv sort the legacy
// table inherits).
function assembleMismatches(dates: readonly string[], foldRows: readonly MismatchFoldRow[]): MismatchFold {
  const orderedDates = [...dates].sort().reverse();
  const byDate = new Map<string, MismatchRow[]>();
  for (const date of orderedDates) byDate.set(date, []);
  for (const row of foldRows) {
    const rows = byDate.get(row.date);
    if (rows !== undefined) rows.push({ callsign: row.callsign, prefixSeries: row.series, impliedClass: row.implied, product: row.product });
  }
  for (const rows of byDate.values()) rows.sort((a, b) => codepointCompare(a.callsign, b.callsign));
  return { dates: orderedDates, byDate };
}

// Fold the class-product-mismatch rows from a directory of per-source ledger
// JSONL files. Two passes: the full open-data date set (the report's columns)
// and the affected rows.
export function foldClassProductMismatches(source: string | ClaimsSource): MismatchFold {
  const claims = toClaimsSource(source);
  if (!claimsSourcePresent(claims)) return { dates: [], byDate: new Map() };
  const productHeaders = [...PRODUCT_COLUMN_NAMES].sort();
  const dates = foldQuery<{ date: string }>(openDataDatesSql(claims)).map(r => r.date);
  return assembleMismatches(dates, foldQuery<MismatchFoldRow>(mismatchFoldSql(claims, productHeaders)));
}

// --- reports/regional-identifiers.md ----------------------------------------

// The regional-identifier distribution as the report renders it: the dated
// open-data columns (newest first) and, per rendered identifier LABEL, the
// PARSED record count in each date. The label is the rendered prefix+RSL
// combination the legacy writeComponentDistributions bumps — exactly the same
// row key, so the table renders shape-for-shape the same.
export interface RegionalIdentifierFold {
  dates: string[];
  rows: Map<string, Map<string, number>>;
}

// One folded regional-identifier row as DuckDB returns it: a (date, series, rsl,
// count) quad over PARSED observations only. `series` is the resolved prefix
// series; `rsl` is the Regional Secondary Locator letter, COALESCEd to '' where
// the parse resolved none (an RSL-less core call carries no rsl claim).
interface RegionalFoldRow {
  date: string;
  series: string | null;
  rsl: string;
  records: number;
}

// The fold SQL for the regional-identifier distribution. One pass over the
// open-data lane restricted to PARSED observations (the legacy table counts
// parsed records only — non-parsed rows are excluded, not bucketed):
//   - obs  : every @listed anchor (one per published row).
//   - ps   : the parse_status claim (INNER JOIN + status='parsed' is the parsed
//            restriction — every parsed token carries the claim).
//   - pfx  : the resolved prefix series (present for a parsed token).
//   - rslc : the resolved RSL letter (absent for an RSL-less core call).
// The joins are one-to-one on the observation key, so count(*) per group is the
// record count. The rendered label and final sort are assembled in TypeScript to
// match the legacy key sort.
function regionalFoldSql(source: ClaimsSource): string {
  return `WITH claims AS (
  SELECT * FROM ${claimsRelation(source)}
),
obs AS (
  SELECT sourceFile, ordinal, ${DATE_EXPR} AS date
  FROM claims WHERE layer='raw' AND predicate='${LISTED_PREDICATE}' AND ${OPEN_DATA_LANE}
),
ps AS (
  SELECT sourceFile, ordinal, object AS status
  FROM claims WHERE layer='derived' AND predicate='${PARSE_STATUS_PREDICATE}'
),
pfx AS (
  SELECT sourceFile, ordinal, object AS series
  FROM claims WHERE layer='derived' AND predicate='${PREFIX_SERIES_PREDICATE}'
),
rslc AS (
  SELECT sourceFile, ordinal, object AS rsl
  FROM claims WHERE layer='derived' AND predicate='${RSL_PREDICATE}'
)
SELECT o.date, p.series AS series, COALESCE(r.rsl, '') AS rsl, count(*) AS records
FROM obs o
JOIN ps s USING (sourceFile, ordinal)
LEFT JOIN pfx p USING (sourceFile, ordinal)
LEFT JOIN rslc r USING (sourceFile, ordinal)
WHERE s.status = 'parsed'
GROUP BY o.date, p.series, COALESCE(r.rsl, '')
ORDER BY o.date, series, rsl`;
}

// The rendered identifier label for a folded row — the identical branching the
// legacy writeComponentDistributions applies to a parsed components.csv row:
// series-2 intermediates render as their digit-led combo (`2E`) or bare
// (`20`/`21`) where the RSL is absent; other series render their first-letter+RSL
// combo (`MW`); an RSL-less G/M core collapses into one aggregate bucket.
function regionalRowLabel(row: RegionalFoldRow): string {
  const series = row.series ?? '';
  if (series.startsWith('2')) {
    return row.rsl !== '' ? `\`2${row.rsl}\`` : `\`${series}\` _(bare)_`;
  }
  if (row.rsl !== '') {
    return `\`${series[0]}${row.rsl}\``;
  }
  return '_(G/M core, no RSL)_';
}

// Assemble the folded rows into the report's shape: every open-data date
// newest-first (so a dataset with no parsed records still gets its column, an
// all-zero absence the legacy table also shows) and a per-label per-date count
// map. The row set is left unsorted here — the renderer sorts labels the same
// way the legacy does (distributionTable's lexicographic sort).
function assembleRegionalIdentifiers(dates: readonly string[], foldRows: readonly RegionalFoldRow[]): RegionalIdentifierFold {
  const orderedDates = [...dates].sort().reverse();
  const rows = new Map<string, Map<string, number>>();
  for (const row of foldRows) {
    const label = regionalRowLabel(row);
    const byDate = rows.get(label) ?? new Map<string, number>();
    byDate.set(row.date, (byDate.get(row.date) ?? 0) + row.records);
    rows.set(label, byDate);
  }
  return { dates: orderedDates, rows };
}

// Fold the regional-identifier distribution from a directory of per-source ledger
// JSONL files. Two passes: the full open-data date set (the report's columns, so
// a zero-parsed dataset still renders) and the parsed-record rows.
export function foldRegionalIdentifiers(source: string | ClaimsSource): RegionalIdentifierFold {
  const claims = toClaimsSource(source);
  if (!claimsSourcePresent(claims)) return { dates: [], rows: new Map() };
  const dates = foldQuery<{ date: string }>(openDataDatesSql(claims)).map(r => r.date);
  return assembleRegionalIdentifiers(dates, foldQuery<RegionalFoldRow>(regionalFoldSql(claims)));
}

// --- reports/callsign-patterns.md -------------------------------------------

// The callsign-pattern time-series as the report renders it. The report keys on
// the character-shape taxonomy (callsignPattern in shared/stats.ts) per dataset,
// so the fold supplies, per open-data date: the total record count and the per-
// pattern counts. `keys` are the dated columns in CHRONOLOGICAL (oldest-first)
// order — the order the sweep passes keysWithStats and the renderer reverses to
// newest-first, matching the legacy path.
export interface CallsignPatternSeriesFold {
  keys: string[];
  recordCounts: Map<string, number>;
  patterns: Map<string, Map<string, number>>;
}

// One folded callsign-pattern row as DuckDB returns it: a (date, pattern, count)
// triple. `pattern` is the character-shape claim's object, COALESCEd to '' for
// the blank-token anchor that carries no callsign-pattern claim (the tier's
// pattern-iff-non-empty contract) — the renderer labels '' as `_(empty)_`,
// recovering the legacy blank-callsign bucket rather than dropping it.
interface PatternFoldRow {
  date: string;
  pattern: string;
  records: number;
}

// The fold SQL for the callsign-pattern series. One pass over the open-data lane:
//   - obs : every @listed anchor (one per published row — the full record set).
//   - cp  : each observation's callsign-pattern derived claim (absent for a blank
//           token).
// The LEFT JOIN is one-to-one on the observation key (one pattern claim per non-
// empty token), so count(*) per (date, pattern) group is the record count and the
// per-date sum is the record count. Every record lands in exactly one pattern
// bucket — the legacy invariant — the blank ones under the recovered '' bucket.
function callsignPatternSeriesSql(source: ClaimsSource): string {
  return `WITH claims AS (
  SELECT * FROM ${claimsRelation(source)}
),
obs AS (
  SELECT sourceFile, ordinal, ${DATE_EXPR} AS date
  FROM claims WHERE layer='raw' AND predicate='${LISTED_PREDICATE}' AND ${OPEN_DATA_LANE}
),
cp AS (
  SELECT sourceFile, ordinal, object AS pattern
  FROM claims WHERE layer='derived' AND predicate='${CALLSIGN_PATTERN_PREDICATE}'
)
SELECT o.date, COALESCE(c.pattern, '') AS pattern, count(*) AS records
FROM obs o
LEFT JOIN cp c USING (sourceFile, ordinal)
GROUP BY o.date, COALESCE(c.pattern, '')
ORDER BY o.date, pattern`;
}

// Assemble the folded rows into the report's shape: dates chronological (the
// renderer reverses to newest-first), a per-date pattern->count map, and a per-
// date record count summed from the pattern buckets (every observation lands in
// exactly one bucket, so the sum is the @listed count — the legacy recordCount).
function assembleCallsignPatternSeries(foldRows: readonly PatternFoldRow[]): CallsignPatternSeriesFold {
  const keys = [...new Set(foldRows.map(r => r.date))].sort();
  const recordCounts = new Map<string, number>();
  const patterns = new Map<string, Map<string, number>>();
  for (const row of foldRows) {
    const byPattern = patterns.get(row.date) ?? new Map<string, number>();
    byPattern.set(row.pattern, (byPattern.get(row.pattern) ?? 0) + row.records);
    patterns.set(row.date, byPattern);
    recordCounts.set(row.date, (recordCounts.get(row.date) ?? 0) + row.records);
  }
  return { keys, recordCounts, patterns };
}

// Fold the callsign-pattern time-series from a directory of per-source ledger
// JSONL files.
export function foldCallsignPatternSeries(source: string | ClaimsSource): CallsignPatternSeriesFold {
  const claims = toClaimsSource(source);
  if (!claimsSourcePresent(claims)) return { keys: [], recordCounts: new Map(), patterns: new Map() };
  return assembleCallsignPatternSeries(foldQuery<PatternFoldRow>(callsignPatternSeriesSql(claims)));
}

// --- The whole quality-report fold ------------------------------------------

export interface QualityReportFold {
  prefixes: PrefixDistributionFold;
  mismatches: MismatchFold;
  regionalIdentifiers: RegionalIdentifierFold;
  callsignPatterns: CallsignPatternSeriesFold;
}

// Fold all four reports from ONE claims source, so the corpus is read a single
// time. A caller holding a ledger passes its directory (a test fixture);
// otherwise the shared deploy-time claims.parquet is read when the workflow built
// one (issue #403), and only in its absence (local dev, tests) is the full-corpus
// ledger materialised once to a scratch directory. skipFailedSources matches the
// normalise sweep's per-entry independence — a malformed entry the sweep already
// reports is skipped, not a reason to crash the whole report.
export function buildQualityReportFold(ledgerDir?: string, ref: ReferenceData = loadReferenceData()): QualityReportFold {
  const foldAll = (source: string | ClaimsSource): QualityReportFold => ({
    prefixes: foldPrefixDistribution(source),
    mismatches: foldClassProductMismatches(source),
    regionalIdentifiers: foldRegionalIdentifiers(source),
    callsignPatterns: foldCallsignPatternSeries(source),
  });
  if (ledgerDir !== undefined) {
    return foldAll(ledgerDir);
  }
  const shared = deployClaimsSource();
  if (shared !== null) {
    return foldAll(shared);
  }
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'quality-report-ledger-'));
  try {
    buildLedger(scratch, undefined, ref, undefined, true);
    return foldAll(path.join(scratch, 'ledger'));
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}
