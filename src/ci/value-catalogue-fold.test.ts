import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  buildLicenceCategoryFold,
  buildValueCatalogueFold,
  foldLicenceCategories,
  foldFieldDistribution,
  recognisedProducts,
  FOLDED_PARSE_FIELDS,
  type FoldedCategory,
} from './value-catalogue-fold.ts';
import {
  buildFieldTallies,
  catalogueField,
  computeLegacyLicenceCategories,
  VALUE_CATALOGUE_PATH,
  PRODUCT_FIELD,
  type FieldCatalogue,
  type LicenceCategoryFigures,
} from './value-catalogue.ts';
import { loadReferenceData } from '../sources/ofcom-amateur/components.ts';
import { serialiseClaimsJsonl } from '../v2/serialise.ts';
import {
  LICENCE_CATEGORY_PREDICATE,
  LICENCE_CATEGORY_RULE,
  LISTED_PREDICATE,
  PARSE_STATUS_PREDICATE,
  PARSE_CALLSIGN_RULE,
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

describe('licence-category fold — reference products', { tags: ['unit'] }, () => {
  it('RecognisedProducts_ReferenceMap_EnumeratesEveryMappedSpelling', () => {
    const products = recognisedProducts(ref);
    // Every spelling the section can fold in is a key of the reference map.
    expect(products).toContain('Amateur Full Radio Licence');
    expect(products).toContain('Full');
    expect(products).toContain('Special Event Station');
    expect(products.length).toBe(ref.licenceCategory.size);
  });
});

describe.skipIf(!duckDbAvailable())('licence-category fold — fixture ledger', { tags: ['unit'] }, () => {
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
    legacy: { records: 1_479_200, callsigns: 98_748, allocated: 59_514 },
    folded: { records: 1_413_493, callsigns: 94_766, allocated: 59_511 },
    variants: ['Amateur Full Radio Licence', 'Full'],
    reason: AVAILABLE_POOL_CLASS,
  },
  Foundation: {
    legacy: { records: 851_486, callsigns: 47_349, allocated: 37_980 },
    folded: { records: 788_370, callsigns: 45_338, allocated: 37_979 },
    variants: ['Amateur Foundation Radio Licence', 'Foundation'],
    reason: AVAILABLE_POOL_CLASS,
  },
  Intermediate: {
    legacy: { records: 402_637, callsigns: 24_110, allocated: 15_351 },
    folded: { records: 323_674, callsigns: 21_190, allocated: 15_338 },
    variants: ['Amateur Intermediate Radio Licence', 'Intermediate'],
    reason: AVAILABLE_POOL_CLASS,
  },
  Club: {
    legacy: { records: 40_095, callsigns: 2_459, allocated: 2_146 },
    folded: { records: 40_078, callsigns: 2_460, allocated: 2_146 },
    variants: ['Amateur Club Radio Licence'],
    reason: CLEANED_KEY,
  },
  'Temporary Reciprocal': {
    legacy: { records: 1_520, callsigns: 127, allocated: 84 },
    folded: { records: 1_520, callsigns: 123, allocated: 83 },
    variants: ['Amateur Temporary Reciprocal Radio Licence'],
    reason: CLEANED_KEY,
  },
  'Special Event': {
    legacy: { records: 1_341, callsigns: 1_316, allocated: 54 },
    folded: { records: 1_341, callsigns: 1_316, allocated: 54 },
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

// Thousands-underscored integer literal (1417346 -> "1_417_346") so the emitted
// figures paste straight into the numeric-separator style above.
function underscored(n: number | undefined): string {
  return (n ?? 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '_');
}

// When a new dataset shifts the corpus, the committed EXPECTED_CATEGORIES figures
// go stale and the assertions below fail. To make the (deliberate, human-reviewed)
// allow-list update a copy rather than a hand-count, emit a paste-ready block of
// the freshly-computed legacy + committed-folded figures whenever any category
// drifts. Variants and reasons are structural, not counts, so they carry over
// unchanged and are echoed for convenience.
function emitRegeneratedAllowListOnDrift(
  legacyByCategory: Map<string, LicenceCategoryFigures>,
  committedFolded: Map<string, LicenceCategoryFigures>,
): void {
  const drifted = Object.entries(EXPECTED_CATEGORIES).some(([cat, exp]) => {
    const l = legacyByCategory.get(cat);
    const f = committedFolded.get(cat);
    return l === undefined || f === undefined
      || l.records !== exp.legacy.records || l.callsigns !== exp.legacy.callsigns || l.allocated !== exp.legacy.allocated
      || f.records !== exp.folded.records || f.callsigns !== exp.folded.callsigns || f.allocated !== exp.folded.allocated;
  });
  if (!drifted) return;
  const out = ['', 'EXPECTED_CATEGORIES drift — paste-ready regenerated figures (verify before committing):'];
  for (const [cat, exp] of Object.entries(EXPECTED_CATEGORIES)) {
    const l = legacyByCategory.get(cat);
    const f = committedFolded.get(cat);
    out.push(`  '${cat}': {`);
    out.push(`    legacy: { records: ${underscored(l?.records)}, callsigns: ${underscored(l?.callsigns)}, allocated: ${underscored(l?.allocated)} },`);
    out.push(`    folded: { records: ${underscored(f?.records)}, callsigns: ${underscored(f?.callsigns)}, allocated: ${underscored(f?.allocated)} },`);
    out.push(`    variants: ${JSON.stringify(exp.variants)},`);
    out.push(`    reason: ${JSON.stringify(exp.reason)},`);
    out.push('  },');
  }
  console.log(out.join('\n'));
}

describe('licence-category — ledger vs legacy equivalence oracle', { tags: ['data-validity'] }, () => {
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
    emitRegeneratedAllowListOnDrift(legacyByCategory, committedFolded);
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
describe.skipIf(!duckDbAvailable())('licence-category fold — real-archive retirement gate', { tags: ['data-validity'] }, () => {
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

// --- The parse-derived field distributions (issue #361, migration step 5) -----
//
// The T1 parse-attribute tier (claim.ts, issue #406) lets the value catalogue's
// per-field value tables for the parse-DERIVED attributes fold from the ledger's
// own derived claims rather than re-deriving parseCallsign over the normalised
// CSVs. Three fields migrate here — `implied_class`, `parse_status`,
// `prefix_series`; `flags` deliberately stays on the legacy path because the
// legacy flags UNION carries two higher-tier signals the T1 tier does not compute
// (see FOLDED_PARSE_FIELDS), and `status` / `product` await their own emit steps.
//
// The classification, in one sentence: a raw-keyed T1 fold reports a value only
// where the parse actually YIELDED it on a converter-bound callsign observation,
// so (a) it never carries the synthesised "no value" bucket the legacy tally adds
// (a blank prefix/class, or parse_status `empty` for a blank token) — the ledger
// does not invent an attribute of a non-token — and (b) it counts fewer
// records/callsigns/sources than the legacy tally, which also folds the
// available-pool "available callsigns" lists (modelled as pool-slots, never parsed
// AS callsigns) and the out-of-sequence list. The fold is therefore <= legacy on
// every retained value, and the only values it omits are the classified
// synthesised buckets. Any OTHER divergence — a folded value absent from legacy, a
// folded figure exceeding legacy, or an unexpected omission — trips CI.
interface FieldFigures { records: number; callsigns: number; allocated: number; sources: number; lanes: string[] }

// The legacy-only values each folded field legitimately omits, with the reason.
// A blank/absent bucket is the ledger declining to invent a value; nothing else
// may be missing.
const PARSE_FIELD_CLASSIFICATION: Record<string, { legacyOnly: string[]; reason: string }> = {
  implied_class: {
    legacyOnly: ['(blank)'],
    reason: 'implied_class rides only where the parse resolved a prefix series; a token with no series yields no claim, so the fold carries no blank bucket (the legacy tally synthesises one from the empty cell)',
  },
  parse_status: {
    legacyOnly: ['empty'],
    reason: 'the parse tier skips an empty token (nothing to parse), so parse_status `empty` never rides; the legacy tally synthesises it for blank subjects',
  },
  prefix_series: {
    legacyOnly: ['(blank)'],
    reason: 'prefix_series rides only where the parse resolved a series; an unresolved token yields no claim, so the fold carries no blank bucket the legacy tally synthesises',
  },
};

const PARSE_FIELD_DIRECTION_REASON = 'a T1 fold counts only converter-bound callsign observations and distinct cleaned keys, whereas the legacy tally also folds the available-pool "available callsigns" lists (pool-slots, never parsed as callsigns) and the out-of-sequence list, and unions raw-trimmed spellings — so the fold is never larger';

// Parse one committed field table ("## `<field>` — N distinct") back into
// figures per value, reading the same folded golden the freshness gate
// regenerates and diffs, so the equivalence check runs on every CI run whether or
// not DuckDB is present.
function parseCommittedFieldTable(field: string): Map<string, FieldFigures> {
  const markdown = fs.readFileSync(path.resolve(process.cwd(), VALUE_CATALOGUE_PATH), 'utf8');
  const lines = markdown.split('\n');
  const start = lines.findIndex(l => l.startsWith(`## \`${field}\` — `));
  expect(start, `section for ${field}`).toBeGreaterThanOrEqual(0);
  const byValue = new Map<string, FieldFigures>();
  const num = (cell: string): number => Number(cell.trim().replace(/,/g, ''));
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.startsWith('## ')) break;
    // value | records | callsigns | allocated | sources | timeline | lanes
    const m = /^\| `([^`]+)` \| ([\d,]+) \| ([\d,]+) \| ([\d,]+) \| (\d+) \| [^|]* \| (.+) \|$/.exec(line);
    if (m === null) continue;
    byValue.set(m[1], {
      records: num(m[2]), callsigns: num(m[3]), allocated: num(m[4]), sources: num(m[5]),
      lanes: m[6].split(',').map(s => s.trim()).sort(),
    });
  }
  return byValue;
}

describe('parse-derived fields — ledger vs legacy equivalence oracle', { tags: ['data-validity'] }, () => {
  // Always-on: reads the committed folded golden and recomputes the legacy field
  // catalogues live over the real archive (no DuckDB needed for this side).
  let legacyByField: Map<string, FieldCatalogue>;
  beforeAll(() => {
    const tallies = buildFieldTallies();
    legacyByField = new Map();
    for (const field of FOLDED_PARSE_FIELDS.keys()) {
      const cells = tallies.get(field);
      if (cells !== undefined) legacyByField.set(field, catalogueField(field, cells));
    }
  }, 600_000);

  it('ParseFields_FoldedValues_AreAllPresentInLegacyNeverInvented', () => {
    // Never-invents: a raw-keyed fold reports only values a source's parse
    // actually produced, so every folded value is one the legacy tally also has.
    for (const field of FOLDED_PARSE_FIELDS.keys()) {
      const folded = parseCommittedFieldTable(field);
      const legacyValues = new Set((legacyByField.get(field)?.values ?? []).map(v => v.value));
      for (const value of folded.keys()) {
        expect(legacyValues.has(value), `${field} folds a value legacy lacks: ${value}`).toBe(true);
      }
    }
  });

  it('ParseFields_LegacyOnlyValues_AreExactlyTheClassifiedBlankBuckets', () => {
    // The only values the fold omits are the classified synthesised buckets; a
    // NEW omission (a real value the fold silently drops) trips here.
    for (const field of FOLDED_PARSE_FIELDS.keys()) {
      const folded = parseCommittedFieldTable(field);
      const legacyValues = (legacyByField.get(field)?.values ?? []).map(v => v.value);
      const omitted = legacyValues.filter(v => !folded.has(v)).sort();
      const classified = [...PARSE_FIELD_CLASSIFICATION[field].legacyOnly].sort();
      expect(omitted, `${field} omissions (${PARSE_FIELD_CLASSIFICATION[field].reason})`).toEqual(classified);
    }
  });

  it('ParseFields_FoldedFigures_NeverExceedLegacy', () => {
    // The load-bearing direction: a converter-bound, distinct-cleaned-key fold can
    // never report MORE records/callsigns/allocated/sources than the legacy tally.
    // An inversion means the fold gained observations the legacy path lacks — a
    // genuine divergence to investigate, not a routine regeneration.
    for (const field of FOLDED_PARSE_FIELDS.keys()) {
      const folded = parseCommittedFieldTable(field);
      const legacy = new Map((legacyByField.get(field)?.values ?? []).map(v => [v.value, v]));
      for (const [value, f] of folded) {
        const l = legacy.get(value);
        expect(l, `legacy ${field}/${value}`).toBeDefined();
        expect(f.records, `${field}/${value} records (${PARSE_FIELD_DIRECTION_REASON})`).toBeLessThanOrEqual(l?.count ?? 0);
        expect(f.callsigns, `${field}/${value} callsigns`).toBeLessThanOrEqual(l?.distinctCallsigns ?? 0);
        expect(f.allocated, `${field}/${value} allocated`).toBeLessThanOrEqual(l?.allocated ?? 0);
        expect(f.sources, `${field}/${value} sources`).toBeLessThanOrEqual(l?.sources ?? 0);
      }
    }
  });

  it('ParseFields_FoldedLanes_NeverExceedLegacy', () => {
    // Lanes are preserved: the fold surfaces a value in no lane the legacy tally
    // did not already carry it in (the fold reads the same two lanes).
    for (const field of FOLDED_PARSE_FIELDS.keys()) {
      const folded = parseCommittedFieldTable(field);
      const legacy = new Map((legacyByField.get(field)?.values ?? []).map(v => [v.value, new Set(v.lanes)]));
      for (const [value, f] of folded) {
        const legacyLanes = legacy.get(value) ?? new Set<string>();
        for (const lane of f.lanes) {
          expect(legacyLanes.has(lane), `${field}/${value} folds lane ${lane} legacy lacks`).toBe(true);
        }
      }
    }
  });
});

// A hand-built ledger over two sources — an open-data publication and an FOI
// entry — for one parse-status value across a shared cleaned callsign, verifying
// the fold's user-facing figures without the whole corpus: record count (rows),
// distinct callsigns (cleaned-key), the allocated slice (observations carrying a
// verbatim Allocated status), and the per-source breadth/lane split.
function writeParseFixtureLedger(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parse-field-fold-fixture-'));
  const parse = (rawSubject: string, sourceFile: string, ordinal: number, vintage: string): Claim =>
    ({ layer: 'derived', rawSubject, predicate: PARSE_STATUS_PREDICATE, object: 'parsed', provenance: { sourceFile, ordinal, vintage }, rule: PARSE_CALLSIGN_RULE });
  const status = (rawSubject: string, sourceFile: string, ordinal: number, vintage: string, object: string): Claim =>
    ({ layer: 'raw', rawSubject, predicate: 'Status', object, provenance: { sourceFile, ordinal, vintage } });
  const claims: Claim[] = [
    // Open-data publication 2025-01-01: G0AAA (Allocated) and G0BBB (Reserved).
    parse('G0AAA', 'opendata/2025-01-01/raw.csv', 0, '2025-01-01'),
    status('G0AAA', 'opendata/2025-01-01/raw.csv', 0, '2025-01-01', 'Allocated'),
    parse('G0BBB', 'opendata/2025-01-01/raw.csv', 1, '2025-01-01'),
    status('G0BBB', 'opendata/2025-01-01/raw.csv', 1, '2025-01-01', 'Reserved'),
    // FOI entry e1: the SAME cleaned callsign (lower case), Allocated.
    parse('g0aaa', 'foi/e1/f.csv', 0, '2024-01-01'),
    status('g0aaa', 'foi/e1/f.csv', 0, '2024-01-01', 'Allocated'),
  ];
  fs.writeFileSync(path.join(dir, 'fixture.jsonl'), serialiseClaimsJsonl(claims));
  return dir;
}

describe.skipIf(!duckDbAvailable())('parse-derived field fold — fixture ledger', { tags: ['unit'] }, () => {
  it('FieldFold_SyntheticLedger_CountsRecordsDistinctCallsignsAllocatedAndBreadth', () => {
    const dir = writeParseFixtureLedger();
    try {
      const cat = foldFieldDistribution(dir, 'parse_status', PARSE_STATUS_PREDICATE);
      expect(cat.values).toHaveLength(1);
      const parsed = cat.values[0];
      expect(parsed.value).toBe('parsed');
      // Three rows, two distinct cleaned callsigns (G0AAA / g0aaa collapse), one
      // of which is Allocated somewhere.
      expect(parsed.count).toBe(3);
      expect(parsed.distinctCallsigns).toBe(2);
      expect(parsed.allocated).toBe(1);
      // Breadth is the two distinct source keys; the timeline map carries each
      // source's record count; both lanes are represented.
      expect(parsed.sources).toBe(2);
      expect(parsed.bySource.get('2025-01-01')).toBe(2);
      expect(parsed.bySource.get('e1')).toBe(1);
      expect(parsed.lanes).toEqual(['foi', 'open-data']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// The real-archive retirement gate: with the pinned DuckDB CLI present, folding
// the parse-derived fields must reproduce the committed golden's figures — the
// proof the fold (not a parse of the golden) produces the numbers, so the section
// can retire the legacy computation once every value-catalogue field has migrated.
describe.skipIf(!duckDbAvailable())('parse-derived fields fold — real-archive retirement gate', { tags: ['data-validity'] }, () => {
  let foldedFields: Map<string, FieldCatalogue>;
  beforeAll(() => {
    foldedFields = buildValueCatalogueFold(undefined, ref).fields;
  }, 600_000);

  it('ParseFieldsFold_RealArchive_ReproducesCommittedGoldenFigures', () => {
    for (const field of FOLDED_PARSE_FIELDS.keys()) {
      const committed = parseCommittedFieldTable(field);
      const folded = new Map((foldedFields.get(field)?.values ?? []).map(v => [v.value, v]));
      expect([...folded.keys()].sort(), `${field} value set`).toEqual([...committed.keys()].sort());
      for (const [value, c] of committed) {
        const f = folded.get(value);
        expect(f, `folded ${field}/${value}`).toBeDefined();
        expect({ records: f?.count, callsigns: f?.distinctCallsigns, allocated: f?.allocated, sources: f?.sources }, `${field}/${value}`)
          .toEqual({ records: c.records, callsigns: c.callsigns, allocated: c.allocated, sources: c.sources });
      }
    }
  });
});
