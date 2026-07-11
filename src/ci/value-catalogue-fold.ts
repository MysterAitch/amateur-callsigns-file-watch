/**
 * Fold the value catalogue's "Normalised licence category" table from the
 * raw-keyed claim ledger (issue #361), the first analytical DATA generator to
 * take its numbers from the ledger rather than the legacy normalised pipeline.
 *
 * WHY this section leads the cutover. The normalised licence category is a
 * FIRST-CLASS DERIVED claim in the ledger (`licence_category`, emitted by
 * claim.ts via the same normaliseLicenceCategory rule the legacy report calls),
 * so the fold reads the ledger's own derived tier rather than re-deriving the
 * mapping. The other value-catalogue fields stay on the legacy path for now:
 * status carries values a source never asserted (available-pool → "Available",
 * forbidden lists → "Forbidden") that the ledger models as family membership,
 * not a status claim; and prefix_series / implied_class / parse_status / flags
 * are the T1 parse-attribute tier the ledger does not yet emit. The migration
 * map (docs/design) sequences those.
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
import { LICENCE_CATEGORY_PREDICATE } from '../v2/claim.ts';
import { foldQuery, cleanedKeyExpr } from '../v2/report-fold.ts';
import { loadReferenceData, type ReferenceData } from '../sources/ofcom-amateur/components.ts';

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

// The claim-ledger JSONL column schema, declared rather than sniffed for the
// same reason build-ledger-db.writeParquetScript declares it: raw claims omit
// the optional `rule`, so a sampled inference would miss it. Pinning the columns
// makes `rule` NULL wherever a claim asserts none.
const LEDGER_COLUMNS = "{layer: 'VARCHAR', rawSubject: 'VARCHAR', predicate: 'VARCHAR', object: 'VARCHAR', sourceFile: 'VARCHAR', ordinal: 'BIGINT', vintage: 'VARCHAR', rule: 'VARCHAR'}";

// A DuckDB glob over one ledger directory's per-source JSONL files, forward-
// slashed and single-quote escaped (DuckDB accepts forward slashes on every
// platform).
function ledgerGlob(ledgerDir: string): string {
  return `'${path.join(ledgerDir, '*.jsonl').replace(/\\/g, '/').replace(/'/g, "''")}'`;
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
function foldSql(ledgerDir: string, products: readonly string[]): string {
  const glob = ledgerGlob(ledgerDir);
  const key = cleanedKeyExpr('rawSubject');
  return `WITH claims AS (
  SELECT * FROM read_json(${glob}, format='newline_delimited', columns=${LEDGER_COLUMNS})
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
// files (the shape build-ledger writes into <outputDir>/ledger/).
export function foldLicenceCategories(ledgerDir: string, ref: ReferenceData = loadReferenceData()): FoldedCategory[] {
  const rows = foldQuery<FoldRow>(foldSql(ledgerDir, recognisedProducts(ref)));
  return assembleCategories(rows);
}

// Build the licence-category fold, materialising the ledger first when no
// pre-built directory is supplied. A caller that already holds a ledger (the
// normalise sweep, once it emits one upstream; a test with a fixture) passes its
// directory to avoid the rebuild; the standalone path builds the full corpus to
// a temp directory and cleans it up.
//
// The interim rebuild is the honest cost of the strangler's first step: the
// ledger is not yet a committed/cached artefact, so a self-contained run emits
// it on demand. The eventual path consumes the deploy-time claims artefact
// (build-ledger-db) rather than re-emitting JSONL — noted in the migration map.
export function buildLicenceCategoryFold(ledgerDir?: string, ref: ReferenceData = loadReferenceData()): FoldedCategory[] {
  if (ledgerDir !== undefined) return foldLicenceCategories(ledgerDir, ref);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'value-catalogue-ledger-'));
  try {
    buildLedger(scratch);
    return foldLicenceCategories(path.join(scratch, 'ledger'), ref);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}
