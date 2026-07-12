/**
 * Fold the parse-attribute quality reports from the raw-keyed claim ledger
 * (issue #361, migration-map step 5): the open-data prefix-series distribution
 * (reports/prefixes.md) and the class-product-mismatch standing table
 * (reports/class-product-mismatches.md). Both are computable ENTIRELY from the
 * T1 parse-attribute tier (claim.ts / issue #406): prefix_series, implied_class,
 * parse_status and the per-flag `flag` claim, joined to the raw @listed anchor
 * and the raw product cell.
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
} from '../v2/claim.ts';
import { foldQuery } from '../v2/report-fold.ts';
import { PRODUCT_COLUMN_NAMES } from '../sources/ofcom-amateur/normalise.ts';
import { loadReferenceData, type ReferenceData } from '../sources/ofcom-amateur/components.ts';

// The flag object the class-product-mismatch table folds on — the same closed
// vocabulary token components.ts raises when a prefix-implied class disagrees
// with the declared product (reference-data/flags.md).
const CLASS_PRODUCT_MISMATCH_FLAG = 'class-product-mismatch';

// The claim-ledger JSONL column schema, declared rather than sniffed (raw claims
// omit the optional `rule`, so a sampled inference would miss it), matching
// value-catalogue-fold's declaration and build-ledger-db.writeParquetScript.
const LEDGER_COLUMNS = "{layer: 'VARCHAR', rawSubject: 'VARCHAR', predicate: 'VARCHAR', object: 'VARCHAR', sourceFile: 'VARCHAR', ordinal: 'BIGINT', vintage: 'VARCHAR', rule: 'VARCHAR'}";

// A DuckDB glob over one ledger directory's per-source JSONL files, forward-
// slashed and single-quote escaped (DuckDB accepts forward slashes everywhere).
function ledgerGlob(ledgerDir: string): string {
  return `'${path.join(ledgerDir, '*.jsonl').replace(/\\/g, '/').replace(/'/g, "''")}'`;
}

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

// Whether a ledger directory holds any per-source JSONL to fold. An empty ledger
// (an archive with no register-bearing entries) yields empty reports rather than
// reaching DuckDB, whose read_json errors on a glob that matches nothing —
// mirroring value-catalogue-fold.
function hasClaims(ledgerDir: string): boolean {
  return fs.existsSync(ledgerDir) && fs.readdirSync(ledgerDir).some(name => name.endsWith('.jsonl'));
}

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
function prefixFoldSql(ledgerDir: string): string {
  const glob = ledgerGlob(ledgerDir);
  return `WITH claims AS (
  SELECT * FROM read_json(${glob}, format='newline_delimited', columns=${LEDGER_COLUMNS})
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
export function foldPrefixDistribution(ledgerDir: string): PrefixDistributionFold {
  if (!hasClaims(ledgerDir)) return { dates: [], rows: new Map() };
  return assemblePrefixDistribution(foldQuery<PrefixFoldRow>(prefixFoldSql(ledgerDir)));
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
function mismatchFoldSql(ledgerDir: string, productHeaders: readonly string[]): string {
  const glob = ledgerGlob(ledgerDir);
  return `WITH claims AS (
  SELECT * FROM read_json(${glob}, format='newline_delimited', columns=${LEDGER_COLUMNS})
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
function openDataDatesSql(ledgerDir: string): string {
  return `SELECT DISTINCT ${DATE_EXPR} AS date
FROM read_json(${ledgerGlob(ledgerDir)}, format='newline_delimited', columns=${LEDGER_COLUMNS})
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
export function foldClassProductMismatches(ledgerDir: string): MismatchFold {
  if (!hasClaims(ledgerDir)) return { dates: [], byDate: new Map() };
  const productHeaders = [...PRODUCT_COLUMN_NAMES].sort();
  const dates = foldQuery<{ date: string }>(openDataDatesSql(ledgerDir)).map(r => r.date);
  return assembleMismatches(dates, foldQuery<MismatchFoldRow>(mismatchFoldSql(ledgerDir, productHeaders)));
}

// --- The whole quality-report fold ------------------------------------------

export interface QualityReportFold {
  prefixes: PrefixDistributionFold;
  mismatches: MismatchFold;
}

// Fold both reports from a ledger directory (a caller holding a pre-built ledger
// passes its directory), or materialise the corpus ledger ONCE to a scratch
// directory and fold both from it (the standalone / sweep path). One ledger is
// emitted and both folds read it, so the corpus is parsed a single time.
//
// The interim rebuild is the strangler's honest cost, exactly as
// value-catalogue-fold documents: the ledger is not yet a committed/cached
// artefact, so a self-contained run emits it on demand; the eventual path
// consumes the deploy-time claims artefact (build-ledger-db). skipFailedSources
// matches the normalise sweep's per-entry independence — a malformed entry the
// sweep already reports is skipped, not a reason to crash the whole report.
export function buildQualityReportFold(ledgerDir?: string, ref: ReferenceData = loadReferenceData()): QualityReportFold {
  if (ledgerDir !== undefined) {
    return { prefixes: foldPrefixDistribution(ledgerDir), mismatches: foldClassProductMismatches(ledgerDir) };
  }
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'quality-report-ledger-'));
  try {
    buildLedger(scratch, undefined, ref, undefined, true);
    const dir = path.join(scratch, 'ledger');
    return { prefixes: foldPrefixDistribution(dir), mismatches: foldClassProductMismatches(dir) };
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}
