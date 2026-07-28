/**
 * Forbidden-suffix history (issues #289 / #291 phase 1): a committed,
 * byte-deterministic observation/diff layer over every forbidden-suffix
 * disclosure the archive holds, joined on the suffix key.
 *
 * The forbidden list is a first-class dataset category (#288), not only a
 * per-callsign flag. This report makes "has the disallowed vocabulary
 * evolved, and when?" answerable from committed data alone: it is traceable to
 * the committed FOI `forbidden-list` entries - never the gitignored `landing/`
 * drop zone - so a change in a PR diff is a drift signal, exactly like the
 * cross-dataset invariants (#241) it mirrors.
 *
 * FOLD FROM THE CLAIM LEDGER (issue #361, migration map step 3). The committed
 * report is FOLDED from the raw-keyed claim ledger via the DuckDB primitive in
 * src/v2/report-fold.ts (the pattern cross-dataset-invariants #373 and
 * value-catalogue-fold #402/#414 established): the `forbidden-list` family emits,
 * per (suffix, disclosure-vintage), a raw `@listed` existence claim plus - where
 * the source carries one - a raw LastModifiedDate attribute claim, and every
 * computed view here (per-disclosure distinct/rows/duplicate counts, the
 * cross-disclosure set diff, the LastModifiedDate distribution, the ever-
 * forbidden union, first-known-forbidden per suffix, and the changed-suffix
 * matrix) is a fold over those per-(suffix, vintage) claims.
 *
 * EQUIVALENCE IS SEMANTIC, not byte-forced (issue #361). The ledger stores the
 * suffix token and the LastModifiedDate VERBATIM, so the fold re-applies the two
 * transforms the normalised store baked in, each on its OWN authoritative rule
 * rather than re-derived: the verbatim column's edge-whitespace trim, and the
 * day-first date rule parseUkDateTime (shared/normalise.ts). With those, the
 * fold reproduces the committed report exactly; the durable oracle
 * (forbidden-suffix-history-fold.test.ts) pins the fold against the committed
 * golden byte-for-byte and an explained allow-list so any NEW drift trips CI.
 *
 * TWO READ MECHANISMS, ONE LEDGER (issue #444). The report the scheduled lane
 * commits folds through DuckDB (buildForbiddenSuffixHistoryFold, over the shared
 * deploy-time claims Parquet where present). The page renderer and the reference-
 * data guard need the same history WITHOUT a DuckDB dependency, so
 * buildForbiddenSuffixHistory folds the SAME per-(suffix, vintage) raw claims in
 * memory - emitting the forbidden family's claims through the ledger emit path and
 * joining each row's @listed existence claim to its LastModifiedDate attribute
 * claim on the observation ordinal. Both paths reduce through historyFromDisclosures
 * and apply the identical suffix edge trim + day-first date rule, so they differ
 * ONLY in how they source the rows; the golden gate pins them equivalent. The old
 * normalised-suffix-file collector this DuckDB-free path replaced is retired - the
 * report and every consumer now fold from the claim ledger, never the normalised
 * projection.
 *
 * Per disclosure it surfaces: the distinct-suffix count (with any duplicate
 * rows called out as a within-disclosure data-quality artefact, never
 * silently deduplicated); the set diff against the previous disclosure
 * (added / removed suffixes, listed in full); and the `LastModifiedDate`
 * DISTRIBUTION where the source carries one - shown as a histogram, never
 * reduced to a single date (the 2024 export is one outlier over a 2016
 * origin bulk, and that shape is the finding).
 *
 * Two derived observations ground later phases:
 *  - the EVER-FORBIDDEN UNION - the distinct union of suffixes across all
 *    disclosures. A future row-level `forbidden-suffix` flag will key off
 *    this rather than any single list: flagging against "ever forbidden" is
 *    robust to churn and to suspected omission ERRORS (working theory: the
 *    2024 de-listing of QNF/ZFJ is an artefact, not a deliberate policy
 *    change, so those suffixes must stay flagged).
 *  - each suffix's FIRST-KNOWN-FORBIDDEN date - the earliest disclosure or
 *    `LastModifiedDate` at which it appears. A future temporal flag
 *    (`forbidden-suffix-issued-after-first-known-list`) will key off this;
 *    the 2024 export's per-suffix dates make it finer than the disclosure
 *    vintages alone (JIZ is first known 2020-12-10, before its only
 *    appearance in the 2024 disclosure).
 *
 * The per-(suffix, disclosure) presence matrix is deliberately keyed so a
 * LATER phase can attach, per suffix, the count of matching callsigns BROKEN
 * DOWN BY STATUS (Allocated / Reserved / Available): a bare total would
 * mislead - a rise in matches could be a Reserved spike rather than new
 * issuance - so the shape is left ready for that decomposition even though
 * the callsign cross-link is out of scope here. Every figure is DECLARED,
 * not verified.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { defaultFoiDir } from '../shared/foi-archive.ts';
import { parseUkDateTime } from '../shared/normalise.ts';
import { normalisedFileNameFor } from '../shared/foi-normalise.ts';
import {
  foldQuery,
  claimsRelation,
  deployClaimsSource,
  type ClaimsSource,
} from '../v2/report-fold.ts';
import { emitClaims, LISTED_PREDICATE, type Claim } from '../v2/claim.ts';
import { serialiseClaimsJsonl } from '../v2/serialise.ts';
import { jsonlStem } from '../v2/collectors/util.ts';
import { forbiddenListEntries, forbiddenSourcesFor, loadForbiddenSource } from '../v2/collectors/forbidden-list.ts';

// One forbidden-suffix disclosure: a single FOI entry's suffix file, with the
// diff against its predecessor and the last-modified distribution where the
// source asserts one.
export interface ForbiddenDisclosure {
  entry: string;
  vintage: string;
  sourceFile: string;
  // Raw normalised rows vs distinct suffixes: equal unless the source
  // duplicated a row (2016's ZIT), which is a data-quality artefact of that
  // disclosure, not a vocabulary change.
  rowCount: number;
  distinctCount: number;
  distinctSuffixes: string[];
  duplicates: string[];
  // Set diff vs the previous disclosure (empty for the first).
  added: string[];
  removed: string[];
  // LastModifiedDate distribution: full disclosed value -> count, biggest
  // bucket first. Empty when the source carries no such column.
  lastModified: { value: string; count: number; suffixes: string[] }[];
}

// A suffix's earliest known forbidden point: an ISO-ordered date key (for
// comparison / bucketing), the fuller disclosed value for display, and the
// basis (which disclosure and whether from its vintage or its per-suffix
// LastModifiedDate).
export interface SuffixFirstKnown {
  dateKey: string;
  displayValue: string;
  basis: string;
}

export interface ForbiddenSuffixHistory {
  disclosures: ForbiddenDisclosure[];
  // The distinct union of every suffix ever forbidden, across all
  // disclosures - the churn-robust basis for the future row-level flag.
  everForbiddenUnion: string[];
  // The suffixes whose list membership changed at any point - the drift set
  // the observation matrix and the phase-3 per-suffix pages hang off.
  changedSuffixes: string[];
  // Per-union-suffix first-known-forbidden point (see SuffixFirstKnown).
  firstKnownForbidden: Record<string, SuffixFirstKnown>;
}

interface RawDisclosure {
  entry: string;
  vintage: string;
  sourceFile: string;
  rows: { suffix: string; lastModified: string | undefined }[];
}

// Buckets small enough to name every member (the outlier last-modified date,
// the handful of drifting suffixes); larger buckets are counted only.
const ENUMERATE_LIMIT = 25;

function num(n: number): string {
  return n.toLocaleString('en-GB');
}

// Chronological corpus order: (vintage, entry, sourceFile) so consecutive diffs
// read oldest-first and regeneration is stable. Applied by the shared reducer,
// so the DuckDB-free claim fold and the DuckDB fold order identically regardless
// of the order each discovers its disclosures in.
function sortRawDisclosures(raw: readonly RawDisclosure[]): RawDisclosure[] {
  return [...raw].sort((a, b) =>
    a.vintage.localeCompare(b.vintage) || a.entry.localeCompare(b.entry) || a.sourceFile.localeCompare(b.sourceFile));
}

function lastModifiedDistribution(rows: RawDisclosure['rows']): ForbiddenDisclosure['lastModified'] {
  const withDate = rows.filter(r => r.lastModified !== undefined && r.lastModified !== '');
  if (withDate.length === 0) return [];
  const buckets = new Map<string, string[]>();
  for (const r of withDate) {
    const value = r.lastModified as string;
    const suffixes = buckets.get(value) ?? [];
    suffixes.push(r.suffix);
    buckets.set(value, suffixes);
  }
  return [...buckets.entries()]
    .map(([value, suffixes]) => ({ value, count: suffixes.length, suffixes: [...suffixes].sort() }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

// The earliest known forbidden point for a suffix: the minimum, across every
// disclosure that lists it, of the disclosure vintage AND (where present) the
// suffix's own LastModifiedDate. All values are ISO-ordered, so string
// comparison is chronological; the per-suffix LastModifiedDate wins ties and
// is generally finer/earlier than the disclosure vintage.
function firstKnownFor(suffix: string, disclosures: ForbiddenDisclosure[]): SuffixFirstKnown {
  const candidates: SuffixFirstKnown[] = [];
  for (const d of disclosures) {
    if (!d.distinctSuffixes.includes(suffix)) continue;
    candidates.push({ dateKey: d.vintage, displayValue: d.vintage, basis: `${d.entry} (vintage)` });
    const bucket = d.lastModified.find(b => b.suffixes.includes(suffix));
    if (bucket !== undefined) {
      candidates.push({ dateKey: bucket.value.slice(0, 10), displayValue: bucket.value, basis: `${d.entry} (LastModifiedDate)` });
    }
  }
  candidates.sort((a, b) => a.dateKey.localeCompare(b.dateKey) || a.basis.localeCompare(b.basis));
  // Union membership guarantees at least one candidate.
  return candidates[0];
}

// The pure reducer: fold a set of per-disclosure suffix rows into every history
// view. Shared by BOTH ledger read mechanisms - the DuckDB-free in-memory claim
// fold and the DuckDB fold - so the two paths differ ONLY in how they source the
// rows: the distinct/duplicate/diff/union/first-known/matrix reductions are one
// implementation, which is exactly what makes the two provably equivalent. Input
// rows carry the already-normalised suffix and last-modified forms (edge-trimmed /
// day-first-normalised by the caller); this reducer never transforms a value,
// only counts and diffs them.
export function historyFromDisclosures(rawDisclosures: readonly RawDisclosure[]): ForbiddenSuffixHistory {
  const raw = sortRawDisclosures(rawDisclosures);
  const disclosures: ForbiddenDisclosure[] = [];
  const changed = new Set<string>();
  const union = new Set<string>();
  let previousSet: Set<string> | undefined;

  for (const d of raw) {
    const seen = new Set<string>();
    const duplicates = new Set<string>();
    for (const { suffix } of d.rows) {
      if (seen.has(suffix)) duplicates.add(suffix);
      else seen.add(suffix);
    }
    for (const s of seen) union.add(s);
    // Bind to a const so the closures narrow (previousSet is reassigned in the loop).
    const prev = previousSet;
    const added = prev === undefined ? [] : [...seen].filter(s => !prev.has(s)).sort();
    const removed = prev === undefined ? [] : [...prev].filter(s => !seen.has(s)).sort();
    for (const s of added) changed.add(s);
    for (const s of removed) changed.add(s);
    disclosures.push({
      entry: d.entry,
      vintage: d.vintage,
      sourceFile: d.sourceFile,
      rowCount: d.rows.length,
      distinctCount: seen.size,
      distinctSuffixes: [...seen].sort(),
      duplicates: [...duplicates].sort(),
      added,
      removed,
      lastModified: lastModifiedDistribution(d.rows),
    });
    previousSet = seen;
  }

  const everForbiddenUnion = [...union].sort();
  const firstKnownForbidden: Record<string, SuffixFirstKnown> = {};
  for (const suffix of everForbiddenUnion) {
    firstKnownForbidden[suffix] = firstKnownFor(suffix, disclosures);
  }

  return {
    disclosures,
    everForbiddenUnion,
    changedSuffixes: [...changed].sort(),
    firstKnownForbidden,
  };
}

// The DuckDB-FREE ledger fold (issue #444): fold the history from the forbidden
// family's raw claims IN MEMORY, so the forbidden-section page renderer
// (build-forbidden-section.ts) and the reference-data guard get the history
// without dragging a DuckDB dependency into their unit tier. Each source's claims
// are emitted through the same ledger emit path the DuckDB fold reads (emitClaims
// over loadForbiddenSource), and reprojectSourceClaims below performs the same
// @listed-to-LastModifiedDate join the DuckDB pass does. Output shape - including
// the normalised `sourceFile` name the page keys its download links off - matches
// the DuckDB fold field-for-field; the golden gate pins the two equivalent.
export function buildForbiddenSuffixHistory(foiDir: string = defaultFoiDir()): ForbiddenSuffixHistory {
  const sources = enumerateForbiddenLedgerSources(foiDir);
  return historyFromDisclosures(sources.map(source => reprojectSourceClaims(source, source.emit())));
}

// --- Ledger fold (issue #361, migration map step 3) ------------------------
//
// The committed report is folded from the raw-keyed claim ledger: the
// `forbidden-list` family's per-(suffix, vintage) `@listed` existence claims
// (one per source row, carrying the raw suffix token) plus the raw
// LastModifiedDate attribute claim where the disclosure supplies one. The heavy
// read - scanning the per-source JSONL and joining each row's existence claim to
// its last-modified claim on the observation key - runs in DuckDB via
// report-fold.ts; the small, per-corpus reduction (distinct/diff/union/matrix)
// stays in the shared reducer above, identical to the DuckDB-free claim fold.

// The declared claim-ledger JSONL column schema (as value-catalogue-fold pins
// it): raw claims omit the optional `rule`, so a sampled inference would miss
// it; pinning the columns makes `rule` NULL wherever a claim asserts none.
const LEDGER_COLUMNS = "{layer: 'VARCHAR', rawSubject: 'VARCHAR', predicate: 'VARCHAR', object: 'VARCHAR', sourceFile: 'VARCHAR', ordinal: 'BIGINT', vintage: 'VARCHAR', rule: 'VARCHAR'}";

// One forbidden-list disclosure resolved for the fold: its chronological
// identity (entry / vintage), the normalised file name the ForbiddenDisclosure
// shape reports (so both fold read mechanisms match field-for-field), the ledger
// JSONL stem the family's claims land under, and a thunk that emits those claims
// (folded in memory by the DuckDB-free path, or serialised to a ledger on demand
// for the DuckDB path).
export interface ForbiddenLedgerSource {
  entry: string;
  vintage: string;
  normalisedFileName: string;
  jsonlStem: string;
  // The corpus-unique sourceFile the family's claims carry in the ledger
  // (`foi/<entry>/<file>`, exactly as loadForbiddenSource stamps it). The
  // shared-Parquet fold (issue #403) selects this source's rows by it, since the
  // Parquet holds the whole corpus rather than one file per source. Optional so a
  // hand-built fixture folding the per-file JSONL directly need not supply it.
  sourceFile?: string;
  // The raw header the disclosure's authored binding maps to per-suffix dated
  // provenance (the 2024-12 export's 'LastModifiedDate'), or null/absent when
  // the disclosure carries none. The fold joins @listed to THIS predicate BY
  // NAME (issue #813 Stage D): the lossless forbidden emit carries every
  // physical column (the wdtk-356636 sheet's constant 'Type' included), so
  // "whatever raw attribute is present" would mistake a carried constant for a
  // date - the authored binding, not presence, names the date column.
  lastModifiedPredicate?: string | null;
  emit: () => ReturnType<typeof emitClaims>;
}

// The forbidden-list sources, discovered exactly as the ledger collector does
// (forbiddenListEntries + forbiddenSourcesFor), so a class-declaring entry with
// no authored suffix converter - the byte-identical as-published duplicate
// ofcom-337399 - yields no source here, so it contributes no disclosure to the
// fold (an entry with no forbidden-suffix source has nothing to fold).
function enumerateForbiddenLedgerSources(foiDir: string): ForbiddenLedgerSource[] {
  const sources: ForbiddenLedgerSource[] = [];
  for (const { entry, meta } of forbiddenListEntries(foiDir)) {
    for (const source of forbiddenSourcesFor(meta)) {
      sources.push({
        entry,
        vintage: meta.dataVintage ?? '—',
        normalisedFileName: normalisedFileNameFor(source.conversion.sourceFile),
        jsonlStem: jsonlStem('forbidden', entry, source.conversion.sourceFile),
        sourceFile: `foi/${entry}/${source.conversion.sourceFile}`,
        lastModifiedPredicate: source.lastModifiedColumn,
        emit: () => emitClaims(loadForbiddenSource(foiDir, entry, meta, source)),
      });
    }
  }
  return sources;
}

// One folded observation as DuckDB returns it: the disclosure index, its raw
// suffix token, and the raw last-modified value (NULL where the disclosure
// carries no last-modified column).
interface ForbiddenFoldRow {
  didx: number;
  rawSuffix: string;
  rawLastModified: string | null;
}

// The per-observation (suffix, last-modified) projection shared by both fold
// paths: join each `@listed` existence claim to its row's last-modified attribute
// claim on the observation key (didx, ordinal), selecting the date by its
// AUTHORED predicate name(s) (issue #813 Stage D) - the lossless forbidden emit
// carries every physical column verbatim, so a positional "the raw claim that is
// not @listed" would mistake a carried constant column for a date. The LEFT JOIN
// yields NULL for the lists that carry no dated provenance. The total ORDER BY
// satisfies report-fold's determinism contract (the reduction is set-based, but a
// stable fold output keeps the fold itself reproducible run to run). `claimsCte`
// supplies the `claims` relation carrying a `didx` disclosure index — from per-
// file JSONL branches (the ledger path) or a sourceFile→index tag over the shared
// Parquet — so the reduction below is identical whichever source fed it.
function foldSqlOver(claimsCte: string, lastModifiedPredicates: readonly string[]): string {
  const literal = (value: string): string => `'${value.replace(/'/g, "''")}'`;
  // A never-matching filter when no enumerated disclosure declares a dated
  // column, so the CTE stays valid SQL and every join yields NULL.
  const inList = lastModifiedPredicates.length === 0 ? "''" : lastModifiedPredicates.map(literal).join(', ');
  return `WITH claims AS NOT MATERIALIZED (
${claimsCte}
),
listed AS (SELECT didx, ordinal, rawSubject FROM claims WHERE predicate = '${LISTED_PREDICATE}'),
lastmod AS (SELECT didx, ordinal, object FROM claims WHERE layer = 'raw' AND predicate IN (${inList}))
SELECT l.didx AS didx, l.rawSubject AS rawSuffix, lm.object AS rawLastModified
FROM listed l
LEFT JOIN lastmod lm ON lm.didx = l.didx AND lm.ordinal = l.ordinal
ORDER BY l.didx, l.ordinal`;
}

// The authored last-modified predicates declared across the enumerated sources -
// the exact date headers the fold may join on. De-duplicated for a stable IN
// list; sources declaring none contribute nothing.
function lastModifiedPredicatesOf(sources: readonly ForbiddenLedgerSource[]): string[] {
  return [...new Set(sources.flatMap(source =>
    (source.lastModifiedPredicate === undefined || source.lastModifiedPredicate === null ? [] : [source.lastModifiedPredicate])))];
}

// One JSONL file's read branch, tagged with its disclosure index so a single
// query folds every disclosure at once. Each forbidden source writes exactly one
// JSONL file, so a file IS a disclosure.
function readBranch(file: string, didx: number): string {
  const escaped = file.replace(/\\/g, '/').replace(/'/g, "''");
  return `SELECT ${didx} AS didx, ordinal, layer, predicate, rawSubject, object `
    + `FROM read_json('${escaped}', format='newline_delimited', columns=${LEDGER_COLUMNS})`;
}

// The ledger-directory `claims` CTE: one UNION ALL read branch per source's JSONL
// file, tagged by array index — the didx a disclosure keys on.
function ledgerClaimsCte(files: readonly string[]): string {
  return files.map((file, index) => readBranch(file, index)).join('\nUNION ALL\n');
}

// The shared-Parquet `claims` CTE (issue #403): the Parquet holds the whole
// corpus, so this selects just the forbidden family's rows by their corpus-unique
// sourceFile and re-derives the SAME didx array-index tag via a sourceFile→index
// CASE. The projected columns and the didx numbering match the per-file branches
// exactly, so the reduction — and thus the folded report — is byte-identical to
// the ledger path.
function parquetClaimsCte(source: ClaimsSource, sourceFiles: readonly string[]): string {
  const literal = (value: string): string => `'${value.replace(/'/g, "''")}'`;
  const cases = sourceFiles.map((sf, index) => `WHEN ${literal(sf)} THEN ${index}`).join(' ');
  const inList = sourceFiles.map(literal).join(', ');
  return `SELECT CASE sourceFile ${cases} END AS didx, ordinal, layer, predicate, rawSubject, object
  FROM ${claimsRelation(source)}
  WHERE sourceFile IN (${inList})`;
}

// The corpus-unique sourceFile a forbidden source's claims carry in the Parquet.
// Required for the shared-Parquet fold (the whole corpus is in one file, so rows
// are selected by sourceFile); the enumerator sets it, so its absence is a
// programming error rather than a data condition.
function sourceFileOf(source: ForbiddenLedgerSource): string {
  if (source.sourceFile === undefined) {
    throw new Error(`forbidden source ${source.entry} has no sourceFile — cannot fold it from the shared claims Parquet`);
  }
  return source.sourceFile;
}

// The verbatim column's only transform, mirroring foi-normalise.ts's
// EDGE_WHITESPACE_RE (`\s` covers the NBSP the FOI trim also strips): the ledger
// stores the suffix token untrimmed, so the fold re-applies the same edge trim
// the normalised store baked in, keeping "  ZIT " and "ZIT" the one suffix the
// report counts.
const EDGE_WHITESPACE_RE = /^\s+|\s+$/g;

// Reproject the folded (didx, suffix, last-modified) rows into the per-disclosure
// RawDisclosure shape the reducer consumes, applying - each on its OWN
// authoritative rule, never re-derived - the two transforms the normalised store
// baked in: the suffix edge trim, and parseUkDateTime for the day-first raw
// last-modified value. A disclosure with no fold rows (defensive; every real
// forbidden source lists at least one suffix) reprojects to an empty row set.
function reprojectDisclosures(foldRows: readonly ForbiddenFoldRow[], sources: readonly ForbiddenLedgerSource[]): RawDisclosure[] {
  const rowsByDisclosure = new Map<number, RawDisclosure['rows']>();
  for (const row of foldRows) {
    const rows = rowsByDisclosure.get(row.didx) ?? [];
    rows.push({
      suffix: row.rawSuffix.replace(EDGE_WHITESPACE_RE, ''),
      lastModified: row.rawLastModified === null ? undefined : parseUkDateTime(row.rawLastModified),
    });
    rowsByDisclosure.set(row.didx, rows);
  }
  return sources.map((source, index) => ({
    entry: source.entry,
    vintage: source.vintage,
    sourceFile: source.normalisedFileName,
    rows: rowsByDisclosure.get(index) ?? [],
  }));
}

// Reproject one forbidden source's IN-MEMORY raw claims into its RawDisclosure,
// the DuckDB-free equivalent of foldSqlOver for a single disclosure. The source's
// @listed existence claims carry the raw suffix token (one per row, in ordinal
// order); each row's last-modified value rides the raw attribute claim under the
// binding's AUTHORED date predicate (issue #813 Stage D - never "whatever raw
// attribute is present", which would mistake a carried constant column for a
// date), keyed to the @listed anchor by the shared observation ordinal (the same
// (didx, ordinal) join the DuckDB pass performs). Applies the identical two
// transforms - the suffix edge trim and parseUkDateTime for the day-first date -
// so a source folded here matches the DuckDB fold field-for-field.
function reprojectSourceClaims(source: ForbiddenLedgerSource, claims: readonly Claim[]): RawDisclosure {
  const lastModifiedPredicate = source.lastModifiedPredicate ?? null;
  const lastModifiedByOrdinal = new Map<number, string>();
  for (const claim of claims) {
    if (claim.layer === 'raw' && lastModifiedPredicate !== null && claim.predicate === lastModifiedPredicate) {
      lastModifiedByOrdinal.set(claim.provenance.ordinal, claim.object);
    }
  }
  const rows = claims
    .filter(claim => claim.predicate === LISTED_PREDICATE)
    .map(claim => {
      const rawLastModified = lastModifiedByOrdinal.get(claim.provenance.ordinal);
      return {
        suffix: claim.rawSubject.replace(EDGE_WHITESPACE_RE, ''),
        lastModified: rawLastModified === undefined ? undefined : parseUkDateTime(rawLastModified),
      };
    });
  return { entry: source.entry, vintage: source.vintage, sourceFile: source.normalisedFileName, rows };
}

// Fold the disclosures from a directory of per-source JSONL ledgers (the shape
// build-ledger writes, and the fixture the oracle builds): one read branch per
// source file, reduced then reprojected.
export function collectRawDisclosuresFromLedger(ledgerDir: string, sources: readonly ForbiddenLedgerSource[]): RawDisclosure[] {
  if (sources.length === 0) return [];
  const files = sources.map(source => path.join(ledgerDir, `${source.jsonlStem}.jsonl`));
  return reprojectDisclosures(foldQuery<ForbiddenFoldRow>(foldSqlOver(ledgerClaimsCte(files), lastModifiedPredicatesOf(sources))), sources);
}

// Fold the disclosures from the shared deploy-time claims Parquet (issue #403),
// selecting the forbidden family's rows by sourceFile rather than materialising
// their JSONL. Byte-identical to the ledger path (same projection, same didx
// numbering, same reduction).
export function collectRawDisclosuresFromParquet(source: ClaimsSource, sources: readonly ForbiddenLedgerSource[]): RawDisclosure[] {
  if (sources.length === 0) return [];
  const cte = parquetClaimsCte(source, sources.map(sourceFileOf));
  return reprojectDisclosures(foldQuery<ForbiddenFoldRow>(foldSqlOver(cte, lastModifiedPredicatesOf(sources))), sources);
}

// Build the history by folding the claim data. A caller holding a ledger
// directory (a test fixture) passes it, and the fold reads that ledger's
// forbidden JSONL files directly. Otherwise the shared deploy-time claims.parquet
// is read when the workflow built one (issue #403), selecting just the forbidden
// family's rows. Only in the Parquet's absence (local dev, tests) are the
// forbidden family's claims emitted to a scratch ledger on demand — scoped to
// JUST the forbidden sources, so the register-and-forbidden container entries'
// large callsign sheets are never materialised to read four suffix lists.
export function buildForbiddenSuffixHistoryFold(ledgerDir?: string, foiDir: string = defaultFoiDir()): ForbiddenSuffixHistory {
  const sources = enumerateForbiddenLedgerSources(foiDir);
  if (ledgerDir !== undefined) {
    return historyFromDisclosures(collectRawDisclosuresFromLedger(ledgerDir, sources));
  }
  const shared = deployClaimsSource();
  if (shared !== null) {
    return historyFromDisclosures(collectRawDisclosuresFromParquet(shared, sources));
  }
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'forbidden-suffix-ledger-'));
  try {
    const dir = path.join(scratch, 'ledger');
    fs.mkdirSync(dir, { recursive: true });
    for (const source of sources) {
      fs.writeFileSync(path.join(dir, `${source.jsonlStem}.jsonl`), serialiseClaimsJsonl(source.emit()));
    }
    return historyFromDisclosures(collectRawDisclosuresFromLedger(dir, sources));
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

function suffixList(suffixes: string[]): string {
  return suffixes.length === 0 ? '—' : suffixes.map(s => `\`${s}\``).join(', ');
}

// Histogram of the union's first-known-forbidden dates, keyed by date part -
// showing the shape (an origin bulk plus a couple of later points), never a
// single figure. Small buckets are enumerated so the outliers are named.
function firstKnownDistribution(h: ForbiddenSuffixHistory): { dateKey: string; count: number; suffixes: string[] }[] {
  const buckets = new Map<string, string[]>();
  for (const suffix of h.everForbiddenUnion) {
    const key = h.firstKnownForbidden[suffix].dateKey;
    const suffixes = buckets.get(key) ?? [];
    suffixes.push(suffix);
    buckets.set(key, suffixes);
  }
  return [...buckets.entries()]
    .map(([dateKey, suffixes]) => ({ dateKey, count: suffixes.length, suffixes: [...suffixes].sort() }))
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey));
}

export function renderForbiddenSuffixHistory(h: ForbiddenSuffixHistory): string {
  const out: string[] = [];
  out.push('# Forbidden-suffix history');
  out.push('');
  out.push('The forbidden-suffix list — three-letter suffixes Ofcom withholds from');
  out.push('issue — tracked across every disclosure the archive holds, joined on the');
  out.push('suffix key. Built from the committed FOI `forbidden-list` entries (never');
  out.push('the `landing/` drop zone), regenerated and committed, so a change in a PR');
  out.push('diff is a drift signal. Every figure below is **declared, not verified**.');
  out.push('');
  out.push('The disallowed vocabulary is **not static**, and both invariance and drift');
  out.push('are findings: it is unchanged 2016 → 2019 (the two 2019 witnesses agree');
  out.push('exactly with the 2016 set), then changes by the December 2024 disclosure.');
  out.push('');

  out.push('## Disclosures');
  out.push('');
  out.push('One row per forbidden-list disclosure, oldest first. **Distinct** is the');
  out.push('suffix vocabulary; **rows** exceeds it only where the source duplicated a');
  out.push('row (surfaced, never silently deduplicated). **Added / removed** are the');
  out.push('set diff against the previous disclosure.');
  out.push('');
  out.push('| vintage | disclosure | distinct | rows | duplicated | added | removed |');
  out.push('|---|---|---:|---:|---|---|---|');
  for (const d of h.disclosures) {
    out.push(`| ${d.vintage} | \`${d.entry}\` | ${num(d.distinctCount)} | ${num(d.rowCount)} | ${suffixList(d.duplicates)} | ${suffixList(d.added)} | ${suffixList(d.removed)} |`);
  }
  out.push('');

  out.push('## Ever-forbidden union');
  out.push('');
  out.push(`Across every disclosure held, **${num(h.everForbiddenUnion.length)}** distinct`);
  out.push('suffixes have been forbidden at some point. This union — not any single');
  out.push('list — is the intended basis for the future row-level `forbidden-suffix`');
  out.push('flag: flagging against "ever forbidden" is robust to churn and to suspected');
  out.push('omission errors. A suffix on the 2016/2019 lists but absent from 2024 (the');
  out.push('working theory is that the `QNF`/`ZFJ` de-listing is an artefact, not a');
  out.push('deliberate policy change) stays in the union, and so would stay flagged.');
  out.push('');

  out.push('## Changes, disclosure by disclosure');
  out.push('');
  out.push('The set diff between each disclosure and the one before it. Each added or');
  out.push('removed suffix is a drill-down candidate for a per-suffix detail page');
  out.push('(phase 3): its list history plus every callsign carrying it.');
  out.push('');
  const [first, ...rest] = h.disclosures;
  if (first !== undefined) {
    out.push(`- **${first.vintage}** (\`${first.entry}\`): baseline — ${num(first.distinctCount)} suffixes, no prior disclosure to diff against.`);
  }
  for (const d of rest) {
    if (d.added.length === 0 && d.removed.length === 0) {
      out.push(`- **${d.vintage}** (\`${d.entry}\`): no change — the same ${num(d.distinctCount)}-suffix set as the previous disclosure.`);
    } else {
      const parts: string[] = [];
      if (d.added.length > 0) parts.push(`added ${suffixList(d.added)}`);
      if (d.removed.length > 0) parts.push(`removed ${suffixList(d.removed)}`);
      out.push(`- **${d.vintage}** (\`${d.entry}\`): ${parts.join('; ')} → ${num(d.distinctCount)} suffixes.`);
    }
  }
  out.push('');

  out.push('## Last-modified distribution');
  out.push('');
  out.push('Where a disclosure carries a per-suffix `LastModifiedDate` (the December');
  out.push('2024 export does; the earlier lists do not), the **distribution** of those');
  out.push('timestamps — not a single figure. A near-uniform bulk with one outlier is');
  out.push('itself the finding: it dates the list\'s origin and pins when a lone suffix');
  out.push('was touched.');
  out.push('');
  const withDates = h.disclosures.filter(d => d.lastModified.length > 0);
  if (withDates.length === 0) {
    out.push('_No disclosure held carries a last-modified column._');
    out.push('');
  }
  for (const d of withDates) {
    out.push(`### ${d.vintage} — \`${d.entry}\``);
    out.push('');
    out.push('| last modified | suffixes | which |');
    out.push('|---|---:|---|');
    for (const bucket of d.lastModified) {
      const which = bucket.count <= ENUMERATE_LIMIT ? suffixList(bucket.suffixes) : `_(${num(bucket.count)} suffixes — not enumerated)_`;
      out.push(`| ${bucket.value} | ${num(bucket.count)} | ${which} |`);
    }
    out.push('');
  }

  out.push('## First-known-forbidden distribution');
  out.push('');
  out.push('For every suffix in the union, the earliest disclosure or `LastModifiedDate`');
  out.push('at which it is known to have been forbidden — bucketed by date. This is the');
  out.push('per-suffix temporal anchor a future `forbidden-suffix-issued-after-first-known-list`');
  out.push('flag will key off; the 2024 export makes it finer than the disclosure');
  out.push('vintages alone.');
  out.push('');
  out.push('| first known forbidden | suffixes | which |');
  out.push('|---|---:|---|');
  for (const bucket of firstKnownDistribution(h)) {
    const which = bucket.count <= ENUMERATE_LIMIT ? suffixList(bucket.suffixes) : `_(${num(bucket.count)} suffixes — not enumerated)_`;
    out.push(`| ${bucket.dateKey} | ${num(bucket.count)} | ${which} |`);
  }
  out.push('');

  out.push('## Changed-suffix observations');
  out.push('');
  out.push('Only the suffixes whose list membership changed at some point — the drift');
  out.push('set. `✓` = on the list at that disclosure, `·` = absent. This per-(suffix,');
  out.push('disclosure) matrix is the seed for the phase-3 per-suffix pages; a later');
  out.push('phase will attach, per suffix, the count of callsigns carrying it **broken');
  out.push('down by status** (Allocated / Reserved / Available) — a bare total would');
  out.push('mislead, since a rise could be a Reserved spike rather than new issuance,');
  out.push('so the shape is left ready for that decomposition.');
  out.push('');
  if (h.changedSuffixes.length === 0) {
    out.push('_No suffix changed membership across the disclosures held._');
    out.push('');
  } else {
    const cols = h.disclosures.map(d => d.vintage);
    const presentSets = h.disclosures.map(d => new Set(d.distinctSuffixes));
    out.push(`| suffix | ${cols.join(' | ')} | first known forbidden |`);
    out.push(`|---|${h.disclosures.map(() => '---:').join('|')}|---|`);
    for (const suffix of h.changedSuffixes) {
      const cells = presentSets.map(set => (set.has(suffix) ? '✓' : '·'));
      const fk = h.firstKnownForbidden[suffix];
      out.push(`| \`${suffix}\` | ${cells.join(' | ')} | ${fk.displayValue} — ${fk.basis} |`);
    }
    out.push('');
  }

  return out.join('\n');
}

export const FORBIDDEN_SUFFIX_HISTORY_PATH = 'reports/forbidden-suffix-history.md';

// Regenerate and commit the report, FOLDED from the claim ledger (issue #361).
// A caller with a pre-built ledger directory passes it to avoid re-emitting the
// forbidden claims; otherwise the fold materialises the forbidden slice on
// demand. Written relative to the working directory - the same root the fold
// reads archive/foi from - so a sweep run against a fixture archive in a temp
// cwd writes ITS history there, never clobbering the committed real one.
export function writeForbiddenSuffixHistory(ledgerDir?: string): { path: string; changed: boolean } {
  const markdown = renderForbiddenSuffixHistory(buildForbiddenSuffixHistoryFold(ledgerDir));
  const target = path.resolve(process.cwd(), FORBIDDEN_SUFFIX_HISTORY_PATH);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const existing = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : undefined;
  const changed = existing !== markdown;
  if (changed) fs.writeFileSync(target, markdown);
  return { path: FORBIDDEN_SUFFIX_HISTORY_PATH, changed };
}

if (import.meta.main) {
  // An optional pre-built ledger directory (from `node src/v2/build-ledger.ts
  // <dir>`) lets a run fold without re-emitting the forbidden claims; omit it
  // and the fold materialises its own.
  const [ledgerDir] = process.argv.slice(2).filter(arg => arg.trim().length > 0);
  const { path: written, changed } = writeForbiddenSuffixHistory(ledgerDir);
  console.log(`${changed ? 'wrote' : 'up to date'}: ${written}`);
}
