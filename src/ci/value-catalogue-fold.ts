/**
 * Fold the value catalogue's "Normalised licence category" table from the
 * raw-keyed claim ledger (issue #361), the first analytical DATA generator to
 * take its numbers from the ledger rather than the legacy normalised pipeline.
 *
 * WHY this section led the cutover. The normalised licence category is a
 * FIRST-CLASS DERIVED claim in the ledger (`licence_category`, emitted by
 * claim.ts via the same normaliseLicenceCategory rule the legacy report calls),
 * so the fold reads the ledger's own derived tier rather than re-deriving the
 * mapping. EVERY value-catalogue field now folds (issues #444 / #707): the
 * parse-derived fields (prefix_series / implied_class / parse_status / flags) from
 * the T1 tier; and the raw `status` and `product / licence_class` fields from the
 * raw observation layer, scoped to the register lane (field-source-roles.ts). The
 * `status` fold keeps the values a source never asserted — availability and
 * forbiddenness, which the ledger models as FAMILY MEMBERSHIP, not a status claim
 * — as labelled membership-derived projections rather than pretending they are
 * attested statuses. The legacy tally is retired from production and survives only
 * as the equivalence oracle's witness.
 *
 * EQUIVALENCE IS SEMANTIC, not byte-identity (issue #361). The ledger is raw-
 * keyed and derives `licence_category` ONLY from a per-row product/licence_class
 * column a source actually declares (the emit's categoryColumn). The legacy
 * report folds the SAME categories out of the whole product tally, which also
 * includes the FOI available-pool sheets' sheet-level licence_class — a class
 * Ofcom attached to an availability list, not a licensed product. So a faithful
 * ledger fold legitimately reports FEWER records/callsigns for Full / Foundation
 * / Intermediate: the ledger does not treat "listed as available under the
 * Foundation sheet" as "holds a Foundation product". That is the ledger being
 * MORE faithful, and value-catalogue-fold.test.ts pins the exact, explained
 * divergence as a durable equivalence oracle so any NEW drift trips CI.
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
  LICENCE_CATEGORY_PREDICATE,
  IMPLIED_CLASS_PREDICATE,
  PARSE_STATUS_PREDICATE,
  PREFIX_SERIES_PREDICATE,
  FLAG_PREDICATE,
} from '../v2/claim.ts';
import {
  foldQuery,
  cleanedKeyExpr,
  claimsRelation,
  claimsSourcePresent,
  toClaimsSource,
  deployClaimsSource,
  type ClaimsSource,
} from '../v2/report-fold.ts';
import { loadReferenceData, type ReferenceData } from '../sources/ofcom-amateur/components.ts';
import { PRODUCT_COLUMN_NAMES, STATUS_COLUMN_NAMES } from '../sources/ofcom-amateur/normalise.ts';
import { foiVerbatimSourceHeaders } from '../shared/foi-normalise.ts';
import { resolveFieldSources, type FieldSources } from './field-source-roles.ts';
import type { FieldCatalogue, ValueTally } from './value-catalogue.ts';

// The register status that means "issued / in use", matching the value
// catalogue's own ALLOCATED_STATUS. A category's allocated slice counts the
// distinct callsigns whose observation also carries this status verbatim — a
// real asserted status (unlike the synthesised Available / Forbidden), so it
// folds cleanly from the raw layer regardless of which raw header carried it.
const ALLOCATED_STATUS = 'Allocated';

// One raw product/licence_class spelling that folds into a category, with its
// record count — the "folds in" cell of the committed table.
export interface FoldedVariant {
  product: string;
  records: number;
}

// One normalised licence category as folded from the ledger: the same figures
// the committed section shows — records (rows), callsigns (distinct cleaned
// keys), allocated (the live-register slice) — plus the raw spellings it folds
// in. Shaped to render identically to the legacy computation.
export interface FoldedCategory {
  category: string;
  records: number;
  callsigns: number;
  allocated: number;
  variants: FoldedVariant[];
}

// A DuckDB comma-separated list of single-quoted string literals.
function sqlStringList(values: readonly string[]): string {
  return values.map(value => `'${value.replace(/'/g, "''")}'`).join(', ');
}

// One folded row as DuckDB returns it. GROUPING SETS emits two grains in one
// pass: a per-category total row (product NULL, isTotal = 1) and a per-variant
// row (product set, isTotal = 0). Splitting them in TypeScript keeps the query
// a single scan.
interface FoldRow {
  category: string;
  product: string | null;
  records: number;
  callsigns: number;
  allocated: number;
  isTotal: number;
}

// The raw product/licence_class spellings the reference map recognises: exactly
// the keys of normaliseLicenceCategory's map. Passing them as the fold's product
// filter means the "folds in" cell enumerates the same variants the reference
// data maps, never a value the report has no category for.
export function recognisedProducts(ref: ReferenceData): string[] {
  return [...ref.licenceCategory.keys()];
}

// The fold SQL for the licence-category table. One pass over the ledger:
//   - `cat`   — every `licence_category` derived claim (its category + cleaned key).
//   - `alloc` — the observations carrying an `Allocated` status verbatim.
//   - `prod`  — the raw product claim on each observation (the spelling that
//               produced the category), restricted to the recognised products so
//               a stray non-product cell can never masquerade as one.
// cat JOIN prod is one-to-one (a category is derived from exactly that product
// cell), so the per-variant records sum back to the category total. GROUPING SETS
// yields both grains; the total ORDER BY (report-fold's determinism contract)
// runs category, then totals before variants, then records, then product.
function foldSql(source: ClaimsSource, products: readonly string[]): string {
  const key = cleanedKeyExpr('rawSubject');
  return `WITH claims AS (
  SELECT * FROM ${claimsRelation(source)}
),
cat AS (
  SELECT sourceFile, ordinal, object AS category, ${key} AS ck
  FROM claims WHERE predicate='${LICENCE_CATEGORY_PREDICATE}'
),
alloc AS (
  SELECT DISTINCT sourceFile, ordinal FROM claims WHERE layer='raw' AND object='${ALLOCATED_STATUS}'
),
prod AS (
  SELECT sourceFile, ordinal, trim(object) AS product
  FROM claims WHERE layer='raw' AND trim(object) IN (${sqlStringList(products)})
),
joined AS (
  SELECT c.category, p.product, c.ck, (a.ordinal IS NOT NULL) AS is_alloc
  FROM cat c
  JOIN prod p USING (sourceFile, ordinal)
  LEFT JOIN alloc a USING (sourceFile, ordinal)
)
SELECT
  category,
  product,
  count(*) AS records,
  count(DISTINCT ck) AS callsigns,
  count(DISTINCT CASE WHEN is_alloc THEN ck END) AS allocated,
  grouping(product) AS isTotal
FROM joined
GROUP BY GROUPING SETS ((category), (category, product))
ORDER BY category, isTotal DESC, records DESC, product`;
}

// Assemble the folded rows into ordered categories. Categories sort by records
// desc then name, and variants by records desc then spelling — the identical
// ordering the legacy licenceCategorySection applies, so the rendered table is
// shape-for-shape the same.
function assembleCategories(rows: readonly FoldRow[]): FoldedCategory[] {
  const byCategory = new Map<string, FoldedCategory>();
  for (const row of rows) {
    if (row.isTotal === 1) {
      byCategory.set(row.category, {
        category: row.category,
        records: row.records,
        callsigns: row.callsigns,
        allocated: row.allocated,
        variants: [],
      });
    }
  }
  for (const row of rows) {
    if (row.isTotal === 1 || row.product === null) continue;
    const category = byCategory.get(row.category);
    if (category !== undefined) category.variants.push({ product: row.product, records: row.records });
  }
  const categories = [...byCategory.values()];
  for (const category of categories) {
    category.variants.sort((a, b) => b.records - a.records || a.product.localeCompare(b.product));
  }
  categories.sort((a, b) => b.records - a.records || a.category.localeCompare(b.category));
  return categories;
}

// Fold the licence-category table from a directory of per-source ledger JSONL
// files (the shape build-ledger writes into <outputDir>/ledger/). A ledger with
// no JSONL files (an archive with no register-bearing entries, or one whose only
// entries were skipped as malformed) yields no categories — returned as the
// empty table rather than handed to DuckDB, whose read_json errors on a glob
// that matches nothing.
export function foldLicenceCategories(source: string | ClaimsSource, ref: ReferenceData = loadReferenceData()): FoldedCategory[] {
  const claims = toClaimsSource(source);
  if (!claimsSourcePresent(claims)) return [];
  const rows = foldQuery<FoldRow>(foldSql(claims, recognisedProducts(ref)));
  return assembleCategories(rows);
}

// Build the licence-category fold. A caller that already holds a ledger (a test
// with a fixture) passes its directory to fold that directly. Otherwise the fold
// consumes the shared deploy-time claims.parquet when the workflow has built one
// (issue #403: materialised ONCE across every report, read here via read_parquet),
// and falls back to materialising the full-corpus ledger to a temp directory only
// when no pre-built Parquet is present (local dev, tests).
export function buildLicenceCategoryFold(ledgerDir?: string, ref: ReferenceData = loadReferenceData()): FoldedCategory[] {
  if (ledgerDir !== undefined) return foldLicenceCategories(ledgerDir, ref);
  const shared = deployClaimsSource();
  if (shared !== null) return foldLicenceCategories(shared, ref);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'value-catalogue-ledger-'));
  try {
    // skipFailedSources: the fold consumes the archive the same way the
    // report lane does — an entry that cannot be parsed is skipped, not a
    // reason to crash the whole report (the sweep already reports it). The real
    // archive parses cleanly, so nothing is skipped there and the fold is
    // unchanged; only a malformed/synthetic entry degrades gracefully.
    buildLedger(scratch, undefined, ref, undefined, true);
    return foldLicenceCategories(path.join(scratch, 'ledger'), ref);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

// --- The parse-attribute value distributions (issue #361, migration step 5) ---
//
// Beside the licence-category table, the value catalogue's per-field value
// tables for the T1 PARSE-DERIVED attributes fold from the ledger's own derived
// tier (claim.ts, issue #406) rather than re-deriving parseCallsign over the
// normalised CSVs. Each folds by its clean derived predicate, so the fold reads
// exactly what the parse tier emitted — never a second parse.
//
// FIELD -> derived predicate. Each folds by its clean derived predicate, so the
// fold reads exactly what the parse tier emitted. The three fields below are
// fully T1-derivable, so folding them loses no real signal — only the synthesised
// blank/empty buckets a raw-keyed fold does not invent (classified in
// value-catalogue-fold.test.ts).
export const FOLDED_PARSE_FIELDS: ReadonlyMap<string, string> = new Map([
  ['implied_class', IMPLIED_CLASS_PREDICATE],
  ['parse_status', PARSE_STATUS_PREDICATE],
  ['prefix_series', PREFIX_SERIES_PREDICATE],
]);

// The report field carrying the data-quality flag distribution.
export const FLAGS_FIELD = 'flags';

// The `flags` field folds the shared FLAG_PREDICATE by object, UNIONING every
// signal that rides it: the per-token parse flags (parse-attribute-emit.ts) AND
// the two higher-tier signals the T1 parse tier does not itself compute —
// `stripped-collision` (a within-source cross-row cleaned-key collision, needing
// the whole register in view) and `forbidden-suffix-issued-after-first-known-list`
// (a temporal finding, needing the suffix history). Both now emit as their own
// derived claims on FLAG_PREDICATE (stripped-collision-emit.ts and the wired
// original-start-date on parse-attribute-emit.ts), so one fold-by-object carries
// the whole flag vocabulary — the earlier refusal to fold `flags` (which would
// have dropped those two findings) no longer applies. Like the parse fields, a
// raw-keyed flag fold reports a flag only where a register callsign observation
// actually raised it: it never carries the legacy tally's flags on available-pool
// / forbidden tokens (emitted raw-only, never parsed AS callsigns), and it
// additionally runs the cross-row collision pass over EVERY register source (the
// legacy path ran it on the open-data lane alone). Both directions are classified
// in value-catalogue-fold.test.ts.
export const FLAGS_FIELD_PREDICATE = FLAG_PREDICATE;

// A folded set of per-field value catalogues, keyed by the report field name —
// the shape renderValueCatalogue folds into place of the legacy tally for the
// fields that have migrated.
export type FoldedFields = Map<string, FieldCatalogue>;

// The lane a ledger observation belongs to, derived from its sourceFile prefix.
// Every collector stamps a corpus-unique, self-locating sourceFile of the form
// `opendata/<date>/…` (the open-data register lane) or `foi/<entry>/…` (every
// FOI-sourced family), so the two lanes the value catalogue reports — matching
// the legacy `open-data` / `foi` split — fall straight out of the first path
// segment.
const LANE_EXPR = `CASE WHEN sourceFile LIKE 'opendata/%' THEN 'open-data' ELSE 'foi' END`;

// The source KEY a value's breadth and timeline count against: the dated
// publication for the open-data lane, the FOI entry for the FOI lane — the
// second path segment of the sourceFile, matching the legacy tally's per-source
// key (the archive date, or the FOI entry key).
const SOURCE_KEY_EXPR = `split_part(sourceFile, '/', 2)`;

// One row of the field-distribution fold. GROUPING SETS emits two grains: a
// per-value total (src NULL, isTotal 1) carrying the records/callsigns/allocated
// figures and the lane union, and a per-value-per-source row (src set, isTotal 0)
// carrying that source's record count — the material for the breadth count and
// the timeline sparkline.
interface FieldFoldRow {
  value: string;
  src: string | null;
  records: number;
  callsigns: number;
  allocated: number;
  lanes: string;
  isTotal: number;
}

// The fold SQL for one parse-derived field's value distribution. One pass over
// the ledger's derived claims for the field's predicate:
//   - each claim's object is the value; the cleaned key of its raw subject is the
//     distinct-callsign unit (the same cleanedCallsign the legacy tally keys on,
//     modulo raw-vs-trimmed spelling); its lane and source key come from the
//     sourceFile; and it is `allocated` when its observation also carries a raw
//     `Allocated` status verbatim (joined by the observation key, exactly as the
//     licence-category fold counts allocation).
// GROUPING SETS yields the per-value total and per-source grains in one scan; the
// total ORDER BY keeps the byte output deterministic (report-fold's contract).
function fieldFoldSql(source: ClaimsSource, predicate: string): string {
  const key = cleanedKeyExpr('rawSubject');
  return `WITH claims AS (
  SELECT * FROM ${claimsRelation(source)}
),
alloc AS (
  SELECT DISTINCT sourceFile, ordinal FROM claims WHERE layer='raw' AND object='${ALLOCATED_STATUS}'
),
v AS (
  SELECT c.object AS value, ${key} AS ck, ${LANE_EXPR} AS lane, ${SOURCE_KEY_EXPR} AS src,
    (a.ordinal IS NOT NULL) AS is_alloc
  FROM claims c
  LEFT JOIN alloc a USING (sourceFile, ordinal)
  WHERE c.layer='derived' AND c.predicate='${predicate}'
)
SELECT
  value,
  src,
  count(*) AS records,
  count(DISTINCT ck) AS callsigns,
  count(DISTINCT CASE WHEN is_alloc THEN ck END) AS allocated,
  string_agg(DISTINCT lane, ',' ORDER BY lane) AS lanes,
  grouping(src) AS isTotal
FROM v
GROUP BY GROUPING SETS ((value), (value, src))
ORDER BY value, isTotal DESC, src`;
}

// Assemble the folded rows into a FieldCatalogue shaped exactly as
// catalogueField produces: values ordered by record count desc then value, each
// with its per-source counts (breadth + timeline) and lane set. Records is the
// per-source sum, so it equals the total-grain count; the distinct-callsign and
// allocated figures come from the total grain (a plain sum would double-count a
// callsign recurring across sources).
function assembleFieldCatalogue(field: string, rows: readonly FieldFoldRow[]): FieldCatalogue {
  const byValue = new Map<string, ValueTally>();
  for (const row of rows) {
    if (row.isTotal !== 1) continue;
    byValue.set(row.value, {
      value: row.value,
      count: row.records,
      lanes: row.lanes === '' ? [] : row.lanes.split(','),
      sources: 0,
      bySource: new Map(),
      distinctCallsigns: row.callsigns,
      allocated: row.allocated,
    });
  }
  for (const row of rows) {
    if (row.isTotal === 1 || row.src === null) continue;
    const tally = byValue.get(row.value);
    if (tally !== undefined) tally.bySource.set(row.src, row.records);
  }
  const values = [...byValue.values()];
  for (const tally of values) tally.sources = tally.bySource.size;
  values.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  return { field, distinct: values.length, total: values.reduce((s, v) => s + v.count, 0), values };
}

// Fold one parse-derived field's value distribution from a ledger directory. An
// empty ledger (no JSONL) yields an empty catalogue rather than reaching DuckDB,
// mirroring foldLicenceCategories.
export function foldFieldDistribution(source: string | ClaimsSource, field: string, predicate: string): FieldCatalogue {
  const claims = toClaimsSource(source);
  if (!claimsSourcePresent(claims)) return { field, distinct: 0, total: 0, values: [] };
  return assembleFieldCatalogue(field, foldQuery<FieldFoldRow>(fieldFoldSql(claims, predicate)));
}

// Fold every migrated field from a claims source: the T1 parse-derived fields
// plus the `flags` distribution (the shared FLAG_PREDICATE folded by object, so
// every signal riding it — the parse flags and the two higher-tier tiers — is
// unioned in one pass). The field-fold SQL groups by the claim's object, so a
// per-token predicate and the flag predicate fold through the identical query.
export function foldParseFields(source: string | ClaimsSource, fieldSources: FieldSources = resolveFieldSources()): FoldedFields {
  const claims = toClaimsSource(source);
  const folded: FoldedFields = new Map();
  // The raw `status` and `product / licence_class` field distributions fold from
  // the raw observation layer, scoped to the register lane that bears each field
  // (issues #444 / #707); status additionally projects its membership buckets.
  folded.set(STATUS_FIELD, foldStatusDistribution(claims, fieldSources));
  folded.set(RAW_PRODUCT_FIELD, foldProductDistribution(claims, fieldSources));
  for (const [field, predicate] of FOLDED_PARSE_FIELDS) {
    folded.set(field, foldFieldDistribution(claims, field, predicate));
  }
  folded.set(FLAGS_FIELD, foldFieldDistribution(claims, FLAGS_FIELD, FLAGS_FIELD_PREDICATE));
  return folded;
}

// --- The raw `status` and `product / licence_class` field folds (issues #444 / #707) ---
//
// These two fields fold from the raw observation layer rather than a derived
// tier: the fold reads exactly what a source asserted under its OWN column header
// (raw-emit keys each attribute claim by the publisher's header), scoped to the
// register callsign lane that bears the field (field-source-roles.ts). Neither
// field emits a derived claim — the ledger's canonical surface is unchanged —
// which is #707's determination: these distributions are read-time projections of
// the observation layer, not per-record claims.
//
// The classified divergence from the legacy tally (value-catalogue-fold.test.ts):
//   - `status` — the attested statuses (Allocated / Reserved / Live / …) fold
//     EXACTLY from the raw status claims. Two buckets differ: the legacy tally's
//     single `Available` MERGES the small attested open-data/FOI `Status=Available`
//     with the availability the FOI available-pool lists carry, which the ledger
//     models as FAMILY MEMBERSHIP (no status claim); the fold keeps the attested
//     `Available` and PROJECTS a separate membership `Available` from available-pool
//     @listed. It likewise projects a membership `Forbidden` from forbidden-list
//     @listed (suffixes the legacy callsign-keyed tally never surfaced as a status).
//     Both projections are labelled in the rendered table, never shown as attested.
//   - `product` — a register-lane census: the fold reads product claims on
//     CALLSIGN observations only, so (like the licence-category fold) it drops the
//     available-pool sheets' pool-slot licence class — a class attached to an
//     availability list, not a licensed register product. So the fold is <= legacy
//     on the availability-list classes (Full / Foundation / Intermediate and their
//     Amateur … spellings) and equal elsewhere, the ledger being MORE faithful.

// The raw column headers a status / product value rides under, unioned across
// every authored binding (the open-data variant registry and the FOI conversion
// registry) plus the available-pool role vocabulary. Derived from the registries
// so a new header keeps the fold in sync; the fold filters raw claims by these
// predicates to read the field's value without a queryable role marker in the
// ledger. Frozen once at module load — the registries are static.
export const STATUS_PREDICATES: readonly string[] = [...new Set([
  ...STATUS_COLUMN_NAMES,
  ...foiVerbatimSourceHeaders('status'),
])].sort();

// The available-pool family emits its licence class under the unified role
// predicate `licence_class` (available-pool.ts), not a raw header, so it joins
// the product-header set — though the register-lane product fold scopes it out
// anyway (available-pool is not a product source).
export const PRODUCT_PREDICATES: readonly string[] = [...new Set([
  ...PRODUCT_COLUMN_NAMES,
  ...foiVerbatimSourceHeaders('licence_class'),
  'licence_class',
])].sort();

// The report field names these two folds populate (matching value-catalogue.ts).
export const STATUS_FIELD = 'status';
export const RAW_PRODUCT_FIELD = 'product / licence_class';

// The value the `status` fold projects from available-pool / forbidden-list family
// membership, and the family tag it carries so the renderer labels the projection.
const AVAILABLE_MEMBERSHIP = { value: 'Available', family: 'available-pool' };
const FORBIDDEN_MEMBERSHIP = { value: 'Forbidden', family: 'forbidden-list' };

// One folded field-distribution row, extended with the membership tag so an
// attested value and a same-named membership projection stay DISTINCT rows.
interface FieldMembershipRow {
  value: string;
  membership: string | null;
  src: string | null;
  records: number;
  callsigns: number;
  allocated: number;
  lanes: string;
  isTotal: number;
}

// A DuckDB IN-list of the field's raw predicate headers.
function predicateList(predicates: readonly string[]): string {
  return sqlStringList(predicates);
}

// A DuckDB IN-list of source-file keys, or a never-matching literal when empty
// (an empty ledger fixture) so `sourceFile IN (…)` stays valid SQL.
function sourceFileList(sources: readonly string[]): string {
  return sources.length === 0 ? `''` : sqlStringList(sources);
}

// The fold SQL for the `product / licence_class` census. One pass over the claims:
//   - attested: each raw product claim (predicate in the header set) on a product-
//     bearing register source; its object trimmed is the value.
//   - blank: each @listed anchor on a product-bearing source that carries NO
//     product claim — the empty-cell bucket the raw layer emits no claim for,
//     reconstructed positionally (register @listed minus product observations).
// allocated joins the Allocated-status observations exactly as the other folds do.
// GROUPING SETS yields the per-value total and per-source grains in one scan.
function productFoldSql(source: ClaimsSource, sources: FieldSources): string {
  const key = cleanedKeyExpr('rawSubject');
  const preds = predicateList(PRODUCT_PREDICATES);
  const productSrc = sourceFileList(sources.productSources);
  return `WITH claims AS (
  SELECT * FROM ${claimsRelation(source)}
),
alloc AS (
  SELECT DISTINCT sourceFile, ordinal FROM claims WHERE layer='raw' AND object='${ALLOCATED_STATUS}'
),
attested AS (
  SELECT trim(object) AS value, ${key} AS ck, ${LANE_EXPR} AS lane, ${SOURCE_KEY_EXPR} AS src, (a.ordinal IS NOT NULL) AS is_alloc
  FROM claims c LEFT JOIN alloc a USING (sourceFile, ordinal)
  WHERE c.layer='raw' AND c.predicate IN (${preds}) AND c.sourceFile IN (${productSrc})
),
blank AS (
  SELECT '(blank)' AS value, ${key} AS ck, ${LANE_EXPR} AS lane, ${SOURCE_KEY_EXPR} AS src, (a.ordinal IS NOT NULL) AS is_alloc
  FROM claims c LEFT JOIN alloc a USING (sourceFile, ordinal)
  WHERE c.predicate='@listed' AND c.sourceFile IN (${productSrc})
    AND NOT EXISTS (SELECT 1 FROM claims s WHERE s.sourceFile=c.sourceFile AND s.ordinal=c.ordinal AND s.layer='raw' AND s.predicate IN (${preds}))
),
v AS (SELECT value, NULL AS membership, ck, lane, src, is_alloc FROM attested UNION ALL SELECT value, NULL, ck, lane, src, is_alloc FROM blank)
SELECT
  value,
  membership,
  src,
  count(*) AS records,
  count(DISTINCT CASE WHEN ck <> '' THEN ck END) AS callsigns,
  count(DISTINCT CASE WHEN is_alloc AND ck <> '' THEN ck END) AS allocated,
  string_agg(DISTINCT lane, ',' ORDER BY lane) AS lanes,
  grouping(src) AS isTotal
FROM v
GROUP BY GROUPING SETS ((value, membership), (value, membership, src))
ORDER BY value, isTotal DESC, src`;
}

// The fold SQL for the `status` field. Attested statuses and the reconstructed
// `(blank)` bucket fold over the status-bearing register sources exactly as the
// product fold does; two further UNION arms PROJECT the membership buckets —
// available-pool @listed as `Available`, forbidden-list @listed as `Forbidden` —
// each tagged with its family so the assembly keeps it a DISTINCT row from any
// attested value of the same name. `allocated` is not meaningful for the status
// field (the value already IS the status), so it is not computed here.
function statusFoldSql(source: ClaimsSource, sources: FieldSources): string {
  const key = cleanedKeyExpr('rawSubject');
  const preds = predicateList(STATUS_PREDICATES);
  const statusSrc = sourceFileList(sources.statusSources);
  const availSrc = sourceFileList(sources.availablePoolSources);
  const forbidSrc = sourceFileList(sources.forbiddenSources);
  return `WITH claims AS (
  SELECT * FROM ${claimsRelation(source)}
),
attested AS (
  SELECT object AS value, NULL AS membership, ${key} AS ck, ${LANE_EXPR} AS lane, ${SOURCE_KEY_EXPR} AS src
  FROM claims WHERE layer='raw' AND predicate IN (${preds}) AND sourceFile IN (${statusSrc})
),
blank AS (
  SELECT '(blank)' AS value, NULL AS membership, ${key} AS ck, ${LANE_EXPR} AS lane, ${SOURCE_KEY_EXPR} AS src
  FROM claims c WHERE c.predicate='@listed' AND c.sourceFile IN (${statusSrc})
    AND NOT EXISTS (SELECT 1 FROM claims s WHERE s.sourceFile=c.sourceFile AND s.ordinal=c.ordinal AND s.layer='raw' AND s.predicate IN (${preds}))
),
available AS (
  SELECT '${AVAILABLE_MEMBERSHIP.value}' AS value, '${AVAILABLE_MEMBERSHIP.family}' AS membership, ${key} AS ck, ${LANE_EXPR} AS lane, ${SOURCE_KEY_EXPR} AS src
  FROM claims WHERE predicate='@listed' AND sourceFile IN (${availSrc})
),
forbidden AS (
  SELECT '${FORBIDDEN_MEMBERSHIP.value}' AS value, '${FORBIDDEN_MEMBERSHIP.family}' AS membership, ${key} AS ck, ${LANE_EXPR} AS lane, ${SOURCE_KEY_EXPR} AS src
  FROM claims WHERE predicate='@listed' AND sourceFile IN (${forbidSrc})
),
v AS (SELECT * FROM attested UNION ALL SELECT * FROM blank UNION ALL SELECT * FROM available UNION ALL SELECT * FROM forbidden)
SELECT
  value,
  membership,
  src,
  count(*) AS records,
  count(DISTINCT CASE WHEN ck <> '' THEN ck END) AS callsigns,
  0 AS allocated,
  string_agg(DISTINCT lane, ',' ORDER BY lane) AS lanes,
  grouping(src) AS isTotal
FROM v
GROUP BY GROUPING SETS ((value, membership), (value, membership, src))
ORDER BY value, membership NULLS FIRST, isTotal DESC, src`;
}

// Assemble the membership-tagged rows into a FieldCatalogue. Values key by
// (value, membership) so an attested `Available` and a projected `Available` stay
// two rows; the projection carries its `membership` family tag for the renderer.
// Ordered by record count desc then value (the same order every field table uses),
// with the membership tag breaking a tie so the ordering is total and byte-stable.
function assembleMembershipCatalogue(field: string, rows: readonly FieldMembershipRow[]): FieldCatalogue {
  const composite = (value: string, membership: string | null): string => `${membership ?? ''} ${value}`;
  const byKey = new Map<string, ValueTally>();
  for (const row of rows) {
    if (row.isTotal !== 1) continue;
    byKey.set(composite(row.value, row.membership), {
      value: row.value,
      count: row.records,
      lanes: row.lanes === '' ? [] : row.lanes.split(','),
      sources: 0,
      bySource: new Map(),
      distinctCallsigns: row.callsigns,
      allocated: row.allocated,
      membership: row.membership ?? undefined,
    });
  }
  for (const row of rows) {
    if (row.isTotal === 1 || row.src === null) continue;
    byKey.get(composite(row.value, row.membership))?.bySource.set(row.src, row.records);
  }
  const values = [...byKey.values()];
  for (const tally of values) tally.sources = tally.bySource.size;
  values.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value) || (a.membership ?? '').localeCompare(b.membership ?? ''));
  return { field, distinct: values.length, total: values.reduce((s, v) => s + v.count, 0), values };
}

// Fold the `status` field distribution from a claims source: attested statuses,
// the reconstructed blank bucket, and the two membership projections.
export function foldStatusDistribution(source: string | ClaimsSource, sources: FieldSources): FieldCatalogue {
  const claims = toClaimsSource(source);
  if (!claimsSourcePresent(claims)) return { field: STATUS_FIELD, distinct: 0, total: 0, values: [] };
  return assembleMembershipCatalogue(STATUS_FIELD, foldQuery<FieldMembershipRow>(statusFoldSql(claims, sources)));
}

// Fold the raw `product / licence_class` field distribution (the register-lane
// census) from a claims source: attested products plus the reconstructed blank.
export function foldProductDistribution(source: string | ClaimsSource, sources: FieldSources): FieldCatalogue {
  const claims = toClaimsSource(source);
  if (!claimsSourcePresent(claims)) return { field: RAW_PRODUCT_FIELD, distinct: 0, total: 0, values: [] };
  return assembleMembershipCatalogue(RAW_PRODUCT_FIELD, foldQuery<FieldMembershipRow>(productFoldSql(claims, sources)));
}

// The whole value-catalogue fold: the licence-category table plus the migrated
// parse-derived field distributions. Both sections read ONE claims source — the
// shared deploy-time claims.parquet when the workflow built one (issue #403), a
// caller-supplied ledger directory (a test fixture), or a full-corpus ledger
// materialised once to a temp directory as the fallback — so the corpus is read a
// single time and every section folds from the same claims.
export interface ValueCatalogueFold {
  categories: FoldedCategory[];
  fields: FoldedFields;
}

export function buildValueCatalogueFold(ledgerDir?: string, ref: ReferenceData = loadReferenceData()): ValueCatalogueFold {
  if (ledgerDir !== undefined) {
    return { categories: foldLicenceCategories(ledgerDir, ref), fields: foldParseFields(ledgerDir) };
  }
  const shared = deployClaimsSource();
  if (shared !== null) {
    return { categories: foldLicenceCategories(shared, ref), fields: foldParseFields(shared) };
  }
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'value-catalogue-ledger-'));
  try {
    buildLedger(scratch, undefined, ref, undefined, true);
    const dir = path.join(scratch, 'ledger');
    return { categories: foldLicenceCategories(dir, ref), fields: foldParseFields(dir) };
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}
