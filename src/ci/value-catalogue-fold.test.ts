import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  buildLicenceCategoryFold,
  foldLicenceCategories,
  recognisedProducts,
  type FoldedCategory,
} from './value-catalogue-fold.ts';
import {
  buildFieldTallies,
  catalogueField,
  computeLegacyLicenceCategories,
  VALUE_CATALOGUE_PATH,
  PRODUCT_FIELD,
  type LicenceCategoryFigures,
} from './value-catalogue.ts';
import { loadReferenceData } from '../sources/ofcom-amateur/components.ts';
import { serialiseClaimsJsonl } from '../v2/serialise.ts';
import {
  LICENCE_CATEGORY_PREDICATE,
  LICENCE_CATEGORY_RULE,
  LISTED_PREDICATE,
  type Claim,
} from '../v2/claim.ts';
import { duckDbAvailable } from '../v2/report-fold.ts';

// Issue #361: the value catalogue's "Normalised licence category" table is the
// first analytical DATA generator to fold its numbers from the raw-keyed claim
// ledger (value-catalogue-fold.ts) rather than the legacy normalised pipeline.
// Test names follow Subject_Scenario_Outcome.

const ref = loadReferenceData();

// --- Fold logic on a controlled fixture -------------------------------------
//
// A hand-built ledger for two observations of one source: a Full licence that is
// Allocated, and a second Full spelling for the same cleaned callsign that is
// not. The fold must count both rows, one distinct callsign, one allocated, and
// fold the two spellings in — the user-facing behaviour the real report relies
// on, verified without the whole corpus.
function claim(over: Partial<Claim> & Pick<Claim, 'predicate' | 'object' | 'rawSubject'>): Claim {
  return {
    layer: over.layer ?? 'raw',
    rawSubject: over.rawSubject,
    predicate: over.predicate,
    object: over.object,
    provenance: over.provenance ?? { sourceFile: 'fixture/raw.csv', ordinal: 0, vintage: '2024-01-01' },
    rule: over.rule,
  };
}

function writeFixtureLedger(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'value-catalogue-fold-fixture-'));
  const at = (ordinal: number): Claim['provenance'] => ({ sourceFile: 'fixture/raw.csv', ordinal, vintage: '2024-01-01' });
  const claims: Claim[] = [
    // Observation 0: G0AAA, product "Full", status Allocated.
    claim({ predicate: LISTED_PREDICATE, object: '', rawSubject: 'G0AAA', provenance: at(0) }),
    claim({ predicate: 'Product', object: 'Full', rawSubject: 'G0AAA', provenance: at(0) }),
    claim({ predicate: 'Status', object: 'Allocated', rawSubject: 'G0AAA', provenance: at(0) }),
    claim({ layer: 'derived', predicate: LICENCE_CATEGORY_PREDICATE, object: 'Full', rawSubject: 'G0AAA', provenance: at(0), rule: LICENCE_CATEGORY_RULE }),
    // Observation 1: the SAME cleaned callsign (lower case), product spelled
    // "Amateur Full Radio Licence", status Reserved (not allocated).
    claim({ predicate: LISTED_PREDICATE, object: '', rawSubject: 'g0aaa', provenance: at(1) }),
    claim({ predicate: 'Product', object: 'Amateur Full Radio Licence', rawSubject: 'g0aaa', provenance: at(1) }),
    claim({ predicate: 'Status', object: 'Reserved', rawSubject: 'g0aaa', provenance: at(1) }),
    claim({ layer: 'derived', predicate: LICENCE_CATEGORY_PREDICATE, object: 'Full', rawSubject: 'g0aaa', provenance: at(1), rule: LICENCE_CATEGORY_RULE }),
  ];
  fs.writeFileSync(path.join(dir, 'fixture.jsonl'), serialiseClaimsJsonl(claims));
  return dir;
}

describe('licence-category fold — reference products', () => {
  it('RecognisedProducts_ReferenceMap_EnumeratesEveryMappedSpelling', () => {
    const products = recognisedProducts(ref);
    // Every spelling the section can fold in is a key of the reference map.
    expect(products).toContain('Amateur Full Radio Licence');
    expect(products).toContain('Full');
    expect(products).toContain('Special Event Station');
    expect(products.length).toBe(ref.licenceCategory.size);
  });
});

describe.skipIf(!duckDbAvailable())('licence-category fold — fixture ledger', () => {
  it('LicenceCategoryFold_SyntheticLedger_CountsRecordsDistinctCallsignsAllocatedAndFoldsIn', () => {
    const dir = writeFixtureLedger();
    try {
      const folded = foldLicenceCategories(dir, ref);
      expect(folded).toHaveLength(1);
      const full = folded[0];
      expect(full.category).toBe('Full');
      // Two rows, one distinct cleaned callsign (G0AAA / g0aaa collapse), one of
      // which is Allocated.
      expect(full.records).toBe(2);
      expect(full.callsigns).toBe(1);
      expect(full.allocated).toBe(1);
      // Both spellings fold in, ordered by record count then spelling.
      expect(full.variants).toEqual([
        { product: 'Amateur Full Radio Licence', records: 1 },
        { product: 'Full', records: 1 },
      ]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// --- The durable equivalence oracle -----------------------------------------
//
// The retirement gate for this section (issue #361): the ledger fold is
// SEMANTICALLY equivalent to the legacy computation, and every place they differ
// is a CLASSIFIED, explained raw-vs-normalised artefact — never an accident.
// This constant is the committed allow-list: the exact legacy and folded figures
// per category, with the reason they differ. The oracle asserts the LIVE legacy
// computation and the committed folded golden both reproduce it, so a NEW
// divergence — a drift in the ledger emit, the legacy generator, or the archive
// beyond a regenerated golden — trips CI rather than being noticed by eye.
//
// The classified difference, in one sentence: the ledger derives
// `licence_category` ONLY from a per-row product/licence_class column a source
// actually declares, whereas the legacy report also folds the FOI available-pool
// sheets' sheet-level licence_class (a class Ofcom attached to an availability
// list, not a licensed product). So the ledger reports fewer records/callsigns
// for the three classes the availability lists carry (Full / Foundation /
// Intermediate) — the ledger being MORE faithful — while the small categories
// match to within cleaned-key keying (the fold counts distinct cleaned keys; the
// legacy unions raw-trimmed spellings, so a handful of format variants collapse).
interface CategoryExpectation {
  legacy: { records: number; callsigns: number; allocated: number };
  folded: { records: number; callsigns: number; allocated: number };
  variants: string[];
  reason: string;
}

const AVAILABLE_POOL_CLASS = 'available-pool sheet-level licence_class folded by the legacy path but carrying no per-row product, so no ledger licence_category claim';
const CLEANED_KEY = 'small delta from counting distinct cleaned keys (fold) vs unioned raw-trimmed spellings (legacy)';
const EXACT_MATCH = 'no availability-list class for this category; equal but for cleaned-key keying';

const EXPECTED_CATEGORIES: Record<string, CategoryExpectation> = {
  Full: {
    legacy: { records: 1_361_439, callsigns: 98_747, allocated: 59_495 },
    folded: { records: 1_295_732, callsigns: 94_764, allocated: 59_492 },
    variants: ['Amateur Full Radio Licence', 'Full'],
    reason: AVAILABLE_POOL_CLASS,
  },
  Foundation: {
    legacy: { records: 778_772, callsigns: 47_342, allocated: 37_936 },
    folded: { records: 715_656, callsigns: 45_331, allocated: 37_935 },
    variants: ['Amateur Foundation Radio Licence', 'Foundation'],
    reason: AVAILABLE_POOL_CLASS,
  },
  Intermediate: {
    legacy: { records: 374_176, callsigns: 24_056, allocated: 15_286 },
    folded: { records: 295_213, callsigns: 21_136, allocated: 15_273 },
    variants: ['Amateur Intermediate Radio Licence', 'Intermediate'],
    reason: AVAILABLE_POOL_CLASS,
  },
  Club: {
    legacy: { records: 35_754, callsigns: 2_459, allocated: 2_143 },
    folded: { records: 35_737, callsigns: 2_460, allocated: 2_143 },
    variants: ['Amateur Club Radio Licence'],
    reason: CLEANED_KEY,
  },
  'Temporary Reciprocal': {
    legacy: { records: 1_436, callsigns: 126, allocated: 83 },
    folded: { records: 1_436, callsigns: 122, allocated: 82 },
    variants: ['Amateur Temporary Reciprocal Radio Licence'],
    reason: CLEANED_KEY,
  },
  'Special Event': {
    legacy: { records: 1_333, callsigns: 1_316, allocated: 54 },
    folded: { records: 1_333, callsigns: 1_316, allocated: 54 },
    variants: ['Special Event Station'],
    reason: EXACT_MATCH,
  },
  'Full Reciprocal': {
    legacy: { records: 15, callsigns: 15, allocated: 0 },
    folded: { records: 15, callsigns: 15, allocated: 0 },
    variants: ['Amateur Full (Reciprocal) Radio Licence'],
    reason: EXACT_MATCH,
  },
};

// Parse the committed report's "Normalised licence category" table back into
// figures. The committed golden IS the ledger fold's output (the freshness gate
// regenerates and diffs it), so this reads the folded side without re-folding —
// letting the equivalence check run on every CI run, DuckDB present or not.
function parseCommittedFolded(): Map<string, LicenceCategoryFigures> {
  const markdown = fs.readFileSync(path.resolve(process.cwd(), VALUE_CATALOGUE_PATH), 'utf8');
  const lines = markdown.split('\n');
  const start = lines.indexOf('## Normalised licence category');
  expect(start).toBeGreaterThanOrEqual(0);
  const byCategory = new Map<string, LicenceCategoryFigures>();
  const num = (cell: string): number => Number(cell.trim().replace(/,/g, ''));
  for (let i = start; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.startsWith('## ') && i !== start) break;
    const m = /^\| `([^`]+)` \| ([\d,]+) \| ([\d,]+) \| ([\d,]+) \| (.+) \|$/.exec(line);
    if (m === null) continue;
    const variants = [...m[5].matchAll(/`([^`]+)` \(([\d,]+)\)/g)].map(v => ({ product: v[1], records: num(v[2]) }));
    byCategory.set(m[1], { category: m[1], records: num(m[2]), callsigns: num(m[3]), allocated: num(m[4]), variants });
  }
  return byCategory;
}

describe('licence-category — ledger vs legacy equivalence oracle', () => {
  // Always-on: reads the committed folded golden and recomputes the legacy
  // figures live over the real archive (no DuckDB needed for this side). Any
  // drift in either path — beyond a regenerated golden — trips the allow-list.
  let legacyByCategory: Map<string, LicenceCategoryFigures>;
  let committedFolded: Map<string, LicenceCategoryFigures>;
  beforeAll(() => {
    const tallies = buildFieldTallies();
    const productCells = tallies.get(PRODUCT_FIELD);
    const productCatalogue = productCells === undefined ? undefined : catalogueField(PRODUCT_FIELD, productCells);
    const legacy = computeLegacyLicenceCategories(productCatalogue, ref, productCells);
    legacyByCategory = new Map(legacy.categories.map(c => [c.category, c]));
    committedFolded = parseCommittedFolded();
  }, 600_000);

  it('LicenceCategories_LegacyAndFolded_ShareTheSameCategoryAndVariantSets', () => {
    // Structure is preserved exactly: the fold surfaces the same categories and
    // the same raw spellings folded into each — only the counts differ.
    expect([...committedFolded.keys()].sort()).toEqual(Object.keys(EXPECTED_CATEGORIES).sort());
    expect([...legacyByCategory.keys()].sort()).toEqual(Object.keys(EXPECTED_CATEGORIES).sort());
    for (const [category, expectation] of Object.entries(EXPECTED_CATEGORIES)) {
      const foldedVariants = (committedFolded.get(category)?.variants ?? []).map(v => v.product).sort();
      const legacyVariants = (legacyByCategory.get(category)?.variants ?? []).map(v => v.product).sort();
      expect(foldedVariants, `folded variants for ${category}`).toEqual([...expectation.variants].sort());
      expect(legacyVariants, `legacy variants for ${category}`).toEqual([...expectation.variants].sort());
    }
  });

  it('LicenceCategories_LiveLegacy_MatchesClassifiedAllowList', () => {
    // The legacy generator still produces the figures the allow-list records; a
    // drift here means the legacy path changed and the classification is stale.
    for (const [category, expectation] of Object.entries(EXPECTED_CATEGORIES)) {
      const actual = legacyByCategory.get(category);
      expect(actual, `legacy category ${category}`).toBeDefined();
      expect({ records: actual?.records, callsigns: actual?.callsigns, allocated: actual?.allocated }, `legacy ${category} (${expectation.reason})`)
        .toEqual(expectation.legacy);
    }
  });

  it('LicenceCategories_CommittedFold_MatchesClassifiedAllowList', () => {
    // The committed golden (the ledger fold's output, guarded by the freshness
    // gate) still matches the allow-list; a drift means the ledger emit or fold
    // changed the numbers without the classification being revisited.
    for (const [category, expectation] of Object.entries(EXPECTED_CATEGORIES)) {
      const actual = committedFolded.get(category);
      expect(actual, `folded category ${category}`).toBeDefined();
      expect({ records: actual?.records, callsigns: actual?.callsigns, allocated: actual?.allocated }, `folded ${category} (${expectation.reason})`)
        .toEqual(expectation.folded);
    }
  });

  it('LicenceCategories_LedgerNeverInvents_FoldedRecordsNeverExceedLegacy', () => {
    // The load-bearing direction of the classification: a raw-keyed fold reports
    // only what a source declared, so its record counts can never EXCEED the
    // legacy path's (which folds in the extra availability-list class). If this
    // ever inverts, the ledger has gained rows the legacy path lacks — a genuine
    // divergence to investigate, not a routine regeneration.
    for (const category of Object.keys(EXPECTED_CATEGORIES)) {
      const folded = committedFolded.get(category);
      const legacy = legacyByCategory.get(category);
      expect(folded?.records ?? 0, `folded records for ${category}`).toBeLessThanOrEqual(legacy?.records ?? 0);
    }
  });
});

// The real-archive fold retirement gate: with the pinned DuckDB CLI present
// (CI always; a bare local checkout skips), building the ledger and folding it
// must reproduce the committed golden's figures. This is the proof the fold —
// not a parse of the golden — produces the numbers, so the section can retire
// the legacy computation once every value-catalogue field has migrated.
describe.skipIf(!duckDbAvailable())('licence-category fold — real-archive retirement gate', () => {
  let folded: Map<string, FoldedCategory>;
  beforeAll(() => {
    folded = new Map(buildLicenceCategoryFold(undefined, ref).map(c => [c.category, c]));
  }, 600_000);

  it('LicenceCategoryFold_RealArchive_ReproducesCommittedGoldenFigures', () => {
    for (const [category, expectation] of Object.entries(EXPECTED_CATEGORIES)) {
      const actual = folded.get(category);
      expect(actual, `folded category ${category}`).toBeDefined();
      expect({ records: actual?.records, callsigns: actual?.callsigns, allocated: actual?.allocated }, category)
        .toEqual(expectation.folded);
      expect((actual?.variants ?? []).map(v => v.product).sort()).toEqual([...expectation.variants].sort());
    }
  });
});
