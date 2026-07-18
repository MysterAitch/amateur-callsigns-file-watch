import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  buildLicenceCategoryFold,
  buildValueCatalogueFold,
  foldLicenceCategories,
  foldFieldDistribution,
  foldStatusDistribution,
  foldProductDistribution,
  recognisedProducts,
  FOLDED_PARSE_FIELDS,
  FLAGS_FIELD,
  FLAGS_FIELD_PREDICATE,
  STATUS_FIELD,
  RAW_PRODUCT_FIELD,
  STATUS_PREDICATES,
  PRODUCT_PREDICATES,
  type FoldedCategory,
} from './value-catalogue-fold.ts';
import { resolveFieldSources, type FieldSources } from './field-source-roles.ts';
import {
  buildFieldTallies,
  catalogueField,
  computeLegacyLicenceCategories,
  VALUE_CATALOGUE_PATH,
  PRODUCT_FIELD,
  type FieldCatalogue,
  type LicenceCategoryFigures,
  type ValueTally,
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
    legacy: { records: 1_538_212, callsigns: 98_748, allocated: 59_514 },
    folded: { records: 1_472_505, callsigns: 94_766, allocated: 59_511 },
    variants: ['Amateur Full Radio Licence', 'Full'],
    reason: AVAILABLE_POOL_CLASS,
  },
  Foundation: {
    legacy: { records: 887_008, callsigns: 47_349, allocated: 37_980 },
    folded: { records: 823_892, callsigns: 45_338, allocated: 37_979 },
    variants: ['Amateur Foundation Radio Licence', 'Foundation'],
    reason: AVAILABLE_POOL_CLASS,
  },
  Intermediate: {
    legacy: { records: 416_738, callsigns: 24_110, allocated: 15_351 },
    folded: { records: 337_775, callsigns: 21_190, allocated: 15_338 },
    variants: ['Amateur Intermediate Radio Licence', 'Intermediate'],
    reason: AVAILABLE_POOL_CLASS,
  },
  Club: {
    legacy: { records: 41_982, callsigns: 2_459, allocated: 2_146 },
    folded: { records: 41_965, callsigns: 2_460, allocated: 2_146 },
    variants: ['Amateur Club Radio Licence'],
    reason: CLEANED_KEY,
  },
  'Temporary Reciprocal': {
    legacy: { records: 1_620, callsigns: 127, allocated: 84 },
    folded: { records: 1_620, callsigns: 123, allocated: 83 },
    variants: ['Amateur Temporary Reciprocal Radio Licence'],
    reason: CLEANED_KEY,
  },
  'Special Event Station': {
    legacy: { records: 3_740, callsigns: 3_715, allocated: 184 },
    folded: { records: 3_740, callsigns: 3_714, allocated: 184 },
    variants: ['NoV Special Event Station', 'NoV Special Special Event Station', 'Special Event Station'],
    reason: CLEANED_KEY,
  },
  'Permanent Special Event Station': {
    legacy: { records: 53, callsigns: 53, allocated: 18 },
    folded: { records: 53, callsigns: 53, allocated: 18 },
    variants: ['NoV Permanent Special Event Station', 'Perm Special Event Station'],
    reason: CLEANED_KEY,
  },
  'Full Reciprocal': {
    legacy: { records: 15, callsigns: 15, allocated: 0 },
    folded: { records: 15, callsigns: 15, allocated: 0 },
    variants: ['Amateur Full (Reciprocal) Radio Licence'],
    reason: EXACT_MATCH,
  },
  'Special Research Permit': {
    legacy: { records: 1, callsigns: 1, allocated: 1 },
    folded: { records: 1, callsigns: 1, allocated: 1 },
    variants: ['Special Research Permit'],
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
// CSVs. Three fields fold here — `implied_class`, `parse_status`,
// `prefix_series`; `flags` (the FLAG_PREDICATE union, #707) and the raw `status`
// and `product` fields (#444) have their own classified-equivalence oracles below.
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

// --- The `flags` distribution fold (issue #707) -------------------------------
//
// The `flags` field folds the shared FLAG_PREDICATE by object, UNIONING every
// signal that rides it: the T1 per-token parse flags AND the two higher-tier
// tiers — `stripped-collision` (a within-source cross-row collision) and
// `forbidden-suffix-issued-after-first-known-list` (a temporal finding). Both now
// emit as their own derived claims, so folding by object loses none of the legacy
// UNION's signal — the flag VALUE SET is preserved exactly.
//
// Unlike the parse fields, the flags fold diverges from the legacy tally in BOTH
// directions, each a classified fidelity difference, never an accident:
//
//   - FOLD_LOWER — the legacy tally raised parse flags on the FOI available-pool
//     "available callsigns" tokens (parsed AS callsigns) and unioned raw-trimmed
//     spellings; the raw-keyed fold emits those families raw-only (pool-slots,
//     never parsed) and counts distinct cleaned keys, so it reports FEWER on the
//     flags those tokens carried (forbidden-suffix, rsl-in-register).
//
//   - FOLD_HIGHER — the fold reads the RAW token verbatim, whereas the legacy FOI
//     flag path re-parsed the already-CLEANED callsign (whitespace stripped, case
//     folded), so a raw-only distinction the cleaned form discarded fired no
//     legacy flag; and the fold runs the cross-row collision pass over EVERY
//     register source, where the legacy path ran it on the open-data lane alone.
//     So the fold catches MORE (whitespace, stripped-collision) and fires the
//     temporal flag on the FOI register snapshots that disclose an original-start
//     date, which the legacy FOI path never passed the parser
//     (forbidden-suffix-issued-after-first-known-list).
//
//   - UNCHANGED — the flag rides only register callsign observations both paths
//     count identically, so legacy and folded figures match to the digit.
//
// The classification below PARTITIONS the whole flag vocabulary: a new flag, or a
// flag drifting between classes, trips the partition or a direction assertion
// rather than passing unseen (the surprise-instrumentation discipline).
const FLAG_FOLD_LOWER: readonly string[] = ['forbidden-suffix', 'rsl-in-register'];
const FLAG_FOLD_HIGHER: readonly string[] = [
  'whitespace',
  'stripped-collision',
  'forbidden-suffix-issued-after-first-known-list',
];
const FLAG_FOLD_LOWER_REASON = 'the legacy tally raised this flag on FOI available-pool tokens parsed AS callsigns and unioned raw-trimmed spellings; the raw-keyed fold emits those pool-slots raw-only and counts distinct cleaned keys';
const FLAG_FOLD_HIGHER_REASON = 'the fold reads the RAW token verbatim (the legacy FOI path re-parsed the cleaned callsign) and runs the cross-row collision pass over every register source (the legacy path ran it on the open-data lane alone), so it catches raw distinctions the legacy path lost';

describe('flags distribution — ledger vs legacy classified-equivalence oracle', { tags: ['data-validity'] }, () => {
  // Always-on: reads the committed folded golden and recomputes the legacy flags
  // catalogue live over the real archive (no DuckDB needed for this side).
  let legacyFlags: Map<string, ValueTally>;
  let committedFlags: Map<string, FieldFigures>;
  beforeAll(() => {
    const cells = buildFieldTallies().get(FLAGS_FIELD);
    legacyFlags = new Map((cells === undefined ? [] : catalogueField(FLAGS_FIELD, cells).values).map(v => [v.value, v]));
    committedFlags = parseCommittedFieldTable(FLAGS_FIELD);
  }, 600_000);

  it('Flags_FoldedValueSet_EqualsLegacyValueSet_LosingNoSignal', () => {
    // The union that the emission of the two higher-tier signals makes safe: the
    // fold surfaces EXACTLY the legacy flag vocabulary — no flag invented, and
    // (the point of emitting the two signals first) none silently dropped.
    expect([...committedFlags.keys()].sort()).toEqual([...legacyFlags.keys()].sort());
  });

  it('Flags_Classification_PartitionsTheWholeFlagVocabulary', () => {
    // Every observed flag is classified exactly once; a new/unclassified flag or a
    // duplicate trips here rather than slipping past the direction checks.
    const classified = [...FLAG_FOLD_LOWER, ...FLAG_FOLD_HIGHER];
    expect(new Set(classified).size, 'classification lists overlap').toBe(classified.length);
    const unchanged = [...legacyFlags.keys()].filter(v => !classified.includes(v));
    const partition = [...classified, ...unchanged].sort();
    expect(partition).toEqual([...legacyFlags.keys()].sort());
  });

  it('Flags_FoldLowerClass_FoldedNeverExceedsLegacy', () => {
    // The pool-slot / cleaned-key direction: a raw-keyed fold can only report
    // FEWER on a flag the legacy tally also raised on available-pool callsign
    // tokens. An inversion means the fold gained observations to investigate.
    for (const flag of FLAG_FOLD_LOWER) {
      const f = committedFlags.get(flag);
      const l = legacyFlags.get(flag);
      expect(f, `folded ${flag}`).toBeDefined();
      expect(l, `legacy ${flag}`).toBeDefined();
      expect(f?.records ?? 0, `${flag} records (${FLAG_FOLD_LOWER_REASON})`).toBeLessThanOrEqual(l?.count ?? 0);
      expect(f?.callsigns ?? 0, `${flag} callsigns`).toBeLessThanOrEqual(l?.distinctCallsigns ?? 0);
      expect(f?.allocated ?? 0, `${flag} allocated`).toBeLessThanOrEqual(l?.allocated ?? 0);
    }
    // Non-vacuous: at least one lower-class flag genuinely shrinks, so the class
    // is not silently a no-op hiding a regression.
    const shrank = FLAG_FOLD_LOWER.some(flag => (committedFlags.get(flag)?.records ?? 0) < (legacyFlags.get(flag)?.count ?? 0));
    expect(shrank, 'no FOLD_LOWER flag actually shrank').toBe(true);
  });

  it('Flags_FoldHigherClass_FoldedNeverFallsBelowLegacy_TheRawVerbatimGain', () => {
    // The raw-verbatim / all-source-collision direction: reading the raw token and
    // running the collision pass everywhere can only find MORE, never fewer, of
    // these flags than the legacy path that re-parsed the cleaned callsign.
    for (const flag of FLAG_FOLD_HIGHER) {
      const f = committedFlags.get(flag);
      const l = legacyFlags.get(flag);
      expect(f, `folded ${flag}`).toBeDefined();
      expect(l, `legacy ${flag}`).toBeDefined();
      expect(f?.records ?? 0, `${flag} records (${FLAG_FOLD_HIGHER_REASON})`).toBeGreaterThanOrEqual(l?.count ?? 0);
    }
    // Non-vacuous: at least one higher-class flag genuinely grows.
    const grew = FLAG_FOLD_HIGHER.some(flag => (committedFlags.get(flag)?.records ?? 0) > (legacyFlags.get(flag)?.count ?? 0));
    expect(grew, 'no FOLD_HIGHER flag actually grew').toBe(true);
  });

  it('Flags_UnchangedClass_FoldedMatchesLegacyToTheDigit', () => {
    // A flag riding only register callsign observations both paths count the same
    // way: legacy and folded figures must be identical, so a drift here is a real
    // divergence, not a classified one.
    const classified = new Set([...FLAG_FOLD_LOWER, ...FLAG_FOLD_HIGHER]);
    for (const [flag, l] of legacyFlags) {
      if (classified.has(flag)) continue;
      const f = committedFlags.get(flag);
      expect(f, `folded ${flag}`).toBeDefined();
      expect({ records: f?.records, callsigns: f?.callsigns, allocated: f?.allocated, sources: f?.sources }, `unchanged ${flag}`)
        .toEqual({ records: l.count, callsigns: l.distinctCallsigns, allocated: l.allocated, sources: l.sources });
    }
  });
});

// A hand-built ledger over one register source raising the whole flag union: a
// per-token parse flag, a stripped-collision (a junk twin + its clean row), and a
// temporal forbidden-suffix flag. The fold must union all three under one pass —
// the user-facing behaviour the published `flags` table relies on — verified
// without the whole corpus.
function writeFlagsFixtureLedger(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flags-fold-fixture-'));
  const flag = (rawSubject: string, ordinal: number, object: string, rule: string): Claim =>
    ({ layer: 'derived', rawSubject, predicate: FLAGS_FIELD_PREDICATE, object, provenance: { sourceFile: 'opendata/2025-01-01/raw.csv', ordinal, vintage: '2025-01-01' }, rule });
  const claims: Claim[] = [
    flag('M7ASS', 0, 'forbidden-suffix', PARSE_CALLSIGN_RULE),
    flag('M7ASS', 0, 'forbidden-suffix-issued-after-first-known-list', PARSE_CALLSIGN_RULE),
    flag('G0TQK ', 1, 'stripped-collision', 'stripped-collision'),
  ];
  fs.writeFileSync(path.join(dir, 'fixture.jsonl'), serialiseClaimsJsonl(claims));
  return dir;
}

describe.skipIf(!duckDbAvailable())('flags distribution fold — fixture ledger', { tags: ['unit'] }, () => {
  it('FlagsFold_SyntheticLedger_UnionsParseFlagsStrippedCollisionAndTemporalByObject', () => {
    const dir = writeFlagsFixtureLedger();
    try {
      const cat = foldFieldDistribution(dir, FLAGS_FIELD, FLAGS_FIELD_PREDICATE);
      const byValue = new Map(cat.values.map(v => [v.value, v]));
      // Every signal riding FLAG_PREDICATE is folded by its object, so all three
      // tiers appear in the one distribution.
      expect([...byValue.keys()].sort()).toEqual([
        'forbidden-suffix',
        'forbidden-suffix-issued-after-first-known-list',
        'stripped-collision',
      ]);
      expect(byValue.get('stripped-collision')?.count).toBe(1);
      expect(byValue.get('forbidden-suffix')?.count).toBe(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('FlagsFold_EmptyLedger_YieldsNoFlags', () => {
    // The non-happy path: an empty ledger folds to an empty flag distribution
    // rather than reaching DuckDB with a glob that matches nothing.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flags-fold-empty-'));
    try {
      expect(foldFieldDistribution(dir, FLAGS_FIELD, FLAGS_FIELD_PREDICATE).values).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// The real-archive retirement gate for `flags`: with the pinned DuckDB CLI
// present, folding must reproduce the committed golden's flag figures — the proof
// the fold (not a parse of the golden) produces the numbers.
describe.skipIf(!duckDbAvailable())('flags distribution fold — real-archive retirement gate', { tags: ['data-validity'] }, () => {
  let foldedFlags: Map<string, ValueTally>;
  beforeAll(() => {
    foldedFlags = new Map((buildValueCatalogueFold(undefined, ref).fields.get(FLAGS_FIELD)?.values ?? []).map(v => [v.value, v]));
  }, 600_000);

  it('FlagsFold_RealArchive_ReproducesCommittedGoldenFigures', () => {
    const committed = parseCommittedFieldTable(FLAGS_FIELD);
    expect([...foldedFlags.keys()].sort(), 'flags value set').toEqual([...committed.keys()].sort());
    for (const [value, c] of committed) {
      const f = foldedFlags.get(value);
      expect(f, `folded flags/${value}`).toBeDefined();
      expect({ records: f?.count, callsigns: f?.distinctCallsigns, allocated: f?.allocated, sources: f?.sources }, `flags/${value}`)
        .toEqual({ records: c.records, callsigns: c.callsigns, allocated: c.allocated, sources: c.sources });
    }
  });
});

// --- The raw `status` and `product / licence_class` field folds (issues #444 / #707) ---
//
// These two fields fold from the raw observation layer (field-source-roles.ts +
// value-catalogue-fold.ts) rather than a derived tier, so they diverge from the
// legacy tally in classified, explained ways — never by accident.

// The status committed table now carries ATTESTED rows only (issue #722): the
// two membership-derived rows are demoted to the Cross-checks and curiosities
// section (parseCommittedMembershipCuriosities, below). Parse the table back
// into figures keyed by value.
interface StatusFigures { value: string; records: number; callsigns: number; sources: number; lanes: string[] }
function parseCommittedStatusTable(): Map<string, StatusFigures> {
  const markdown = fs.readFileSync(path.resolve(process.cwd(), VALUE_CATALOGUE_PATH), 'utf8');
  const lines = markdown.split('\n');
  const start = lines.findIndex(l => l.startsWith('## `status` — '));
  expect(start, 'status section').toBeGreaterThanOrEqual(0);
  const byKey = new Map<string, StatusFigures>();
  const num = (cell: string): number => Number(cell.trim().replace(/,/g, ''));
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.startsWith('## ')) break;
    // value | records | callsigns | allocated | sources | timeline | lanes
    const m = /^\| `([^`]+)` \| ([\d,]+) \| ([\d,]+) \| [—\d,]+ \| (\d+) \| [^|]* \| (.+) \|$/.exec(line);
    if (m === null) continue;
    byKey.set(m[1], {
      value: m[1], records: num(m[2]), callsigns: num(m[3]), sources: num(m[4]),
      lanes: m[5].split(',').map(s => s.trim()).sort(),
    });
  }
  return byKey;
}

// The raw text of the committed `## \`status\`` section — used to assert the
// membership rows are textually absent from it (issue #722), not merely
// unparsed by parseCommittedStatusTable's stricter regex.
function committedStatusSectionText(): string {
  const markdown = fs.readFileSync(path.resolve(process.cwd(), VALUE_CATALOGUE_PATH), 'utf8');
  const lines = markdown.split('\n');
  const start = lines.findIndex(l => l.startsWith('## `status` — '));
  expect(start, 'status section').toBeGreaterThanOrEqual(0);
  const end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
  return lines.slice(start, end === -1 ? undefined : end).join('\n');
}

// The Cross-checks and curiosities section's membership-derived rows (issue
// #722): the same two status-fold projections, published in their NEW demoted
// location rather than deleted. Parsed straight from the committed golden so
// the equivalence oracle covers the presentation move, not just the fold.
interface MembershipCuriosityFigures { value: string; membership: string; distinctCallsigns: number; latestSnapshotSize: number; records: number; sources: number }
function parseCommittedMembershipCuriosities(): Map<string, MembershipCuriosityFigures> {
  const markdown = fs.readFileSync(path.resolve(process.cwd(), VALUE_CATALOGUE_PATH), 'utf8');
  const lines = markdown.split('\n');
  const start = lines.findIndex(l => l.startsWith('### Membership-derived rows demoted from `status`'));
  expect(start, 'membership curiosities section').toBeGreaterThanOrEqual(0);
  const byKey = new Map<string, MembershipCuriosityFigures>();
  const num = (cell: string): number => Number(cell.trim().replace(/,/g, ''));
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.startsWith('## ')) break;
    // row (`value` — <family> membership) | vintage | distinct callsigns | latest snapshot (N (date)) | records (corpus coverage)
    const m = /^\| `([^`]+)` — (\S+) membership \| [^|]+ \| ([\d,]+) \| ([\d,]+) \([^)]+\) \| ([\d,]+) rows across (\d+) held snapshots/.exec(line);
    if (m === null) continue;
    byKey.set(`${m[2]}/${m[1]}`, {
      value: m[1], membership: m[2], distinctCallsigns: num(m[3]),
      latestSnapshotSize: num(m[4]), records: num(m[5]), sources: Number(m[6]),
    });
  }
  return byKey;
}

describe('status field — ledger vs legacy classified-equivalence oracle', { tags: ['data-validity'] }, () => {
  // Always-on: reads the committed folded golden and recomputes the legacy status
  // catalogue live over the real archive (no DuckDB needed for this side).
  let legacyStatus: Map<string, ValueTally>;
  let committed: Map<string, StatusFigures>;
  let membershipCuriosities: Map<string, MembershipCuriosityFigures>;
  beforeAll(() => {
    const cells = buildFieldTallies().get(STATUS_FIELD);
    legacyStatus = new Map((cells === undefined ? [] : catalogueField(STATUS_FIELD, cells).values).map(v => [v.value, v]));
    committed = parseCommittedStatusTable();
    membershipCuriosities = parseCommittedMembershipCuriosities();
  }, 600_000);

  it('StatusFold_AttestedStatuses_MatchLegacyRecordsExactly', () => {
    // Every attested status but `Available` folds its record count EXACTLY from
    // the raw status claims — the fold reads the same status cells the legacy
    // tally did, so a drift here is a real divergence, not a classified one.
    for (const [value, legacy] of legacyStatus) {
      if (value === 'Available') continue;
      const folded = committed.get(value);
      expect(folded, `attested ${value}`).toBeDefined();
      expect(folded?.records, `attested ${value} records`).toBe(legacy.count);
      // Distinct callsigns fold by cleaned key, so the fold never exceeds the
      // legacy trimmed-raw distinct count.
      expect(folded?.callsigns ?? 0, `attested ${value} callsigns`).toBeLessThanOrEqual(legacy.distinctCallsigns);
    }
  });

  it('StatusFold_Available_SplitsIntoAttestedPlusAvailablePoolMembership', () => {
    // The load-bearing #707 split: the legacy tally's single `Available` MERGES the
    // small attested register status with the available-pool availability the
    // ledger models as family membership. The fold keeps the attested `Available`
    // in the status table and PUBLISHES the availability as a separate, demoted
    // membership row (issue #722); the two sum back to the legacy figure, so no
    // availability is lost, only re-presented.
    const attested = committed.get('Available');
    const membership = membershipCuriosities.get('available-pool/Available');
    const legacy = legacyStatus.get('Available');
    expect(attested, 'attested Available').toBeDefined();
    expect(membership, 'membership Available').toBeDefined();
    expect(legacy, 'legacy Available').toBeDefined();
    expect((attested?.records ?? 0) + (membership?.records ?? 0)).toBe(legacy?.count);
    // The attested slice is genuinely the smaller part (the split is non-vacuous).
    expect(attested?.records ?? 0).toBeLessThan(legacy?.count ?? 0);
    expect(membership?.records ?? 0).toBeGreaterThan(0);
  });

  it('StatusFold_Forbidden_KeepsAttestedAndAddsForbiddenListMembership', () => {
    // `Forbidden` as a register STATUS is attested (a source's status column reads
    // it), and the fold reproduces the legacy figure exactly. The fold ADDS a
    // membership `Forbidden` projected from the forbidden-suffix lists — suffixes
    // the legacy callsign-keyed tally never surfaced as a status — published as
    // its own demoted curio row, not merged into the attested count.
    const attested = committed.get('Forbidden');
    const membership = membershipCuriosities.get('forbidden-list/Forbidden');
    expect(attested?.records, 'attested Forbidden').toBe(legacyStatus.get('Forbidden')?.count);
    expect(membership, 'membership Forbidden (fold-only)').toBeDefined();
    expect(membership?.records ?? 0).toBeGreaterThan(0);
  });

  it('StatusFold_AttestedValueSet_EqualsLegacyValueSet_NeitherInventedNorDropped', () => {
    // The status table (membership demoted away) folds EXACTLY the legacy status
    // vocabulary — no status invented, none silently dropped.
    const attestedValues = [...committed.keys()].sort();
    expect(attestedValues).toEqual([...legacyStatus.keys()].sort());
  });

  it('StatusFold_MembershipRows_AreDemotedToCuriosities_NeverInTheStatusTable', () => {
    // The #722 requirement: the two membership buckets are present in the
    // Cross-checks and curiosities section, labelled by family, and ABSENT from
    // the prominent status table — so a reader of the status table never mistakes
    // one for an attested status, and the fold's own output is not silently lost.
    expect([...membershipCuriosities.keys()].sort())
      .toEqual(['available-pool/Available', 'forbidden-list/Forbidden']);
    // The section's own explanatory prose names "membership" (why the rows are
    // absent); no TABLE ROW does — that is the thing under test.
    const tableRows = committedStatusSectionText().split('\n').filter(l => l.startsWith('| '));
    expect(tableRows.some(l => l.includes('membership'))).toBe(false);
  });

  it('MembershipCuriosities_LeadWithDistinctCallsignsAndLatestSnapshot_RecordsMarkedAsCorpusCoverage', () => {
    // Issue #722's core requirement: the demoted rows lead with the meaningful
    // quantities (distinct callsigns, latest snapshot size) and keep records only
    // as an explicitly-marked corpus-coverage figure, non-zero and sane relative
    // to the underlying fold.
    const pool = membershipCuriosities.get('available-pool/Available');
    expect(pool?.distinctCallsigns ?? 0).toBeGreaterThan(0);
    expect(pool?.latestSnapshotSize ?? 0).toBeGreaterThan(0);
    // The latest snapshot (the smallest, as the pool shrank) is smaller than the
    // distinct-ever-declared count and than the records corpus-coverage sum.
    expect(pool?.latestSnapshotSize ?? 0).toBeLessThan(pool?.distinctCallsigns ?? 0);
    expect(pool?.latestSnapshotSize ?? 0).toBeLessThan(pool?.records ?? 0);
    expect(pool?.sources).toBe(9);

    const forbidden = membershipCuriosities.get('forbidden-list/Forbidden');
    expect(forbidden?.distinctCallsigns ?? 0).toBeGreaterThan(0);
    expect(forbidden?.latestSnapshotSize ?? 0).toBeGreaterThan(0);
    expect(forbidden?.sources).toBe(4);
  });
});

// The load-bearing FOLD_LOWER product values: the availability-list licence
// classes the fold drops as pool-slot attributes (register-lane census), with the
// reason. Every other product value's records match the legacy tally to the digit.
const PRODUCT_FOLD_LOWER: readonly string[] = [
  'Amateur Full Radio Licence', 'Amateur Foundation Radio Licence', 'Amateur Intermediate Radio Licence',
  'Full', 'Foundation', 'Intermediate',
];
const PRODUCT_FOLD_LOWER_REASON = 'the register-lane census reads product claims on CALLSIGN observations only, so it drops the available-pool sheets pool-slot licence class (a class attached to an availability list, not a licensed register product) — the same faithfulness the licence-category fold applies';

describe('product field — ledger vs legacy classified-equivalence oracle', { tags: ['data-validity'] }, () => {
  // Always-on: the committed folded golden vs the live legacy catalogue.
  let legacyProduct: Map<string, ValueTally>;
  let committed: Map<string, FieldFigures>;
  beforeAll(() => {
    const cells = buildFieldTallies().get(PRODUCT_FIELD);
    legacyProduct = new Map((cells === undefined ? [] : catalogueField(PRODUCT_FIELD, cells).values).map(v => [v.value, v]));
    committed = parseCommittedFieldTable(PRODUCT_FIELD);
  }, 600_000);

  it('ProductFold_ValueSet_EqualsLegacyValueSet_NeitherInventedNorDropped', () => {
    // The fold surfaces the SAME product vocabulary as the legacy tally — the
    // availability-list classes still appear (register sources carry them too),
    // only their counts shrink.
    expect([...committed.keys()].sort()).toEqual([...legacyProduct.keys()].sort());
  });

  it('ProductFold_EveryValue_NeverExceedsLegacy', () => {
    // A register-lane census can only report FEWER records/callsigns than the
    // legacy tally, which also folds the available-pool pool-slot rows. An
    // inversion means the fold gained observations to investigate.
    for (const [value, f] of committed) {
      const l = legacyProduct.get(value);
      expect(l, `legacy product ${value}`).toBeDefined();
      expect(f.records, `${value} records (${PRODUCT_FOLD_LOWER_REASON})`).toBeLessThanOrEqual(l?.count ?? 0);
      expect(f.callsigns, `${value} callsigns`).toBeLessThanOrEqual(l?.distinctCallsigns ?? 0);
      expect(f.allocated, `${value} allocated`).toBeLessThanOrEqual(l?.allocated ?? 0);
      expect(f.sources, `${value} sources`).toBeLessThanOrEqual(l?.sources ?? 0);
    }
  });

  it('ProductFold_FoldLowerValues_GenuinelyShrink_NonVacuous', () => {
    // The availability-list classes each genuinely shrink, so the classification
    // is not silently a no-op hiding a regression.
    for (const value of PRODUCT_FOLD_LOWER) {
      const f = committed.get(value);
      const l = legacyProduct.get(value);
      expect(f?.records ?? 0, `${value} shrank`).toBeLessThan(l?.count ?? 0);
    }
  });

  it('ProductFold_UnchangedValues_MatchLegacyRecordsExactly', () => {
    // Every product value NOT borne by the available-pool lists folds its record
    // count exactly — a drift there is a real divergence, not a classified one.
    for (const [value, f] of committed) {
      if (PRODUCT_FOLD_LOWER.includes(value)) continue;
      expect(f.records, `unchanged product ${value} records`).toBe(legacyProduct.get(value)?.count);
    }
  });
});

// A hand-built ledger exercising the status fold's three arms over synthetic
// sources: an open-data register (one Allocated row, one blank-status row), an
// available-pool source (@listed only, no status) and a forbidden-list source
// (@listed only). The fold must fold the attested status, RECONSTRUCT the blank
// from the register @listed lacking a status claim, and PROJECT the two membership
// buckets — without the whole corpus.
function writeStatusFixtureLedger(): { dir: string; sources: FieldSources } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'status-fold-fixture-'));
  const at = (sourceFile: string, ordinal: number): Claim['provenance'] => ({ sourceFile, ordinal, vintage: '2025-01-01' });
  const REG = 'opendata/2025-01-01/raw.csv';
  const POOL = 'foi/pool-e/available.csv';
  const FORBID = 'foi/forbid-e/forbidden.csv';
  const claims: Claim[] = [
    // Register: G0AAA is Allocated; G0BBB is listed with no status cell (blank).
    claim({ predicate: LISTED_PREDICATE, object: '', rawSubject: 'G0AAA', provenance: at(REG, 0) }),
    claim({ predicate: 'Status', object: 'Allocated', rawSubject: 'G0AAA', provenance: at(REG, 0) }),
    claim({ predicate: LISTED_PREDICATE, object: '', rawSubject: 'G0BBB', provenance: at(REG, 1) }),
    // Available-pool: a bare suffix, listed only (no status claim by design).
    claim({ predicate: LISTED_PREDICATE, object: '', rawSubject: 'ABC', provenance: at(POOL, 0) }),
    // Forbidden-list: a bare suffix, listed only.
    claim({ predicate: LISTED_PREDICATE, object: '', rawSubject: 'XYZ', provenance: at(FORBID, 0) }),
  ];
  fs.writeFileSync(path.join(dir, 'fixture.jsonl'), serialiseClaimsJsonl(claims));
  return { dir, sources: { statusSources: [REG], productSources: [REG], availablePoolSources: [POOL], forbiddenSources: [FORBID] } };
}

describe.skipIf(!duckDbAvailable())('status field fold — fixture ledger', { tags: ['unit'] }, () => {
  it('StatusFold_SyntheticLedger_FoldsAttestedReconstructsBlankAndProjectsMembership', () => {
    const { dir, sources } = writeStatusFixtureLedger();
    try {
      const cat = foldStatusDistribution(dir, sources);
      const byKey = new Map(cat.values.map(v => [`${v.membership ?? ''} ${v.value}`, v]));
      expect([...byKey.keys()].sort()).toEqual([' (blank)', ' Allocated', 'available-pool Available', 'forbidden-list Forbidden']);
      expect(byKey.get(' Allocated')?.count).toBe(1);
      // The blank bucket is the register observation carrying no status claim.
      expect(byKey.get(' (blank)')?.count).toBe(1);
      // The membership buckets are the pool / forbidden @listed anchors, tagged.
      expect(byKey.get('available-pool Available')?.membership).toBe('available-pool');
      expect(byKey.get('forbidden-list Forbidden')?.membership).toBe('forbidden-list');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('StatusFold_EmptyLedger_YieldsNoValues', () => {
    // The non-happy path: an empty ledger folds to an empty status distribution
    // rather than reaching DuckDB with a glob that matches nothing.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'status-fold-empty-'));
    try {
      expect(foldStatusDistribution(dir, { statusSources: [], productSources: [], availablePoolSources: [], forbiddenSources: [] }).values).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// A hand-built ledger proving the product census reads CALLSIGN observations only:
// a register source (one Full row, one blank-product row) and an available-pool
// source that also carries a `licence_class = Full` claim. The fold must count the
// register product and its blank, and EXCLUDE the pool-slot product entirely.
function writeProductFixtureLedger(): { dir: string; sources: FieldSources } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'product-fold-fixture-'));
  const at = (sourceFile: string, ordinal: number): Claim['provenance'] => ({ sourceFile, ordinal, vintage: '2025-01-01' });
  const REG = 'opendata/2025-01-01/raw.csv';
  const POOL = 'foi/pool-e/available.csv';
  const claims: Claim[] = [
    claim({ predicate: LISTED_PREDICATE, object: '', rawSubject: 'G0AAA', provenance: at(REG, 0) }),
    claim({ predicate: 'Product', object: 'Full', rawSubject: 'G0AAA', provenance: at(REG, 0) }),
    claim({ predicate: LISTED_PREDICATE, object: '', rawSubject: 'G0BBB', provenance: at(REG, 1) }),
    // Available-pool: a pool-slot carrying a licence_class — NOT a register product.
    claim({ predicate: LISTED_PREDICATE, object: '', rawSubject: 'ABC', provenance: at(POOL, 0) }),
    claim({ predicate: 'licence_class', object: 'Full', rawSubject: 'ABC', provenance: at(POOL, 0) }),
  ];
  fs.writeFileSync(path.join(dir, 'fixture.jsonl'), serialiseClaimsJsonl(claims));
  // The pool source is deliberately NOT a product source (pool-slots are excluded).
  return { dir, sources: { statusSources: [REG], productSources: [REG], availablePoolSources: [POOL], forbiddenSources: [] } };
}

describe.skipIf(!duckDbAvailable())('product field fold — fixture ledger', { tags: ['unit'] }, () => {
  it('ProductFold_SyntheticLedger_CountsRegisterProductAndBlank_ExcludesPoolSlot', () => {
    const { dir, sources } = writeProductFixtureLedger();
    try {
      const cat = foldProductDistribution(dir, sources);
      const byValue = new Map(cat.values.map(v => [v.value, v]));
      // The register Full and its blank sibling — the pool-slot Full is excluded.
      expect([...byValue.keys()].sort()).toEqual(['(blank)', 'Full']);
      expect(byValue.get('Full')?.count).toBe(1);
      expect(byValue.get('(blank)')?.count).toBe(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('field-source-roles — register lane and membership families', { tags: ['unit'] }, () => {
  it('ResolveFieldSources_RealArchive_PartitionsRegisterLaneFromMembershipFamilies', () => {
    const sources = resolveFieldSources();
    // Every set is populated — a resolver that silently returned nothing would
    // scope every fold to empty and pass the equivalence oracles vacuously.
    expect(sources.statusSources.length, 'status sources').toBeGreaterThan(0);
    expect(sources.productSources.length, 'product sources').toBeGreaterThan(0);
    expect(sources.availablePoolSources.length, 'available-pool sources').toBeGreaterThan(0);
    expect(sources.forbiddenSources.length, 'forbidden sources').toBeGreaterThan(0);
    // The membership families are NEVER product sources — a pool-slot / suffix is
    // not a register product, so it must not fold into the product census (the
    // load-bearing scoping decision, #444 / #707).
    const productSet = new Set(sources.productSources);
    for (const pool of sources.availablePoolSources) expect(productSet.has(pool), `pool ${pool} leaked into product`).toBe(false);
    for (const forbid of sources.forbiddenSources) expect(productSet.has(forbid), `forbidden ${forbid} leaked into product`).toBe(false);
    // A forbidden suffix list is likewise never a status source (its Forbidden is
    // a membership projection, not an attested status column).
    const statusSet = new Set(sources.statusSources);
    for (const forbid of sources.forbiddenSources) expect(statusSet.has(forbid), `forbidden ${forbid} leaked into status`).toBe(false);
  });

  it('FieldPredicates_RealRegistries_CarryTheKnownStatusAndProductHeaders', () => {
    // The authored predicate sets stay in sync with the registries; a header the
    // corpus uses that fell out of the set would silently drop that column's
    // values from the fold.
    for (const header of ['Status', 'Status__c', 'Final Status', 'status']) {
      expect(STATUS_PREDICATES, `status header ${header}`).toContain(header);
    }
    for (const header of ['Product', 'Product__c', 'SF List', 'Licence Class', 'Licence Product']) {
      expect(PRODUCT_PREDICATES, `product header ${header}`).toContain(header);
    }
    // The authored OUTPUT role name is no ledger predicate since the
    // issuance-events lossless emit (issue #813 Stage C2): raw claims carry
    // verbatim headers only, so the set holds no role spellings.
    expect(PRODUCT_PREDICATES).not.toContain('licence_class');
  });
});

// The real-archive retirement gate for `status` and `product` (issues #444 /
// #707): with the pinned DuckDB CLI present, building the ledger and folding it
// must reproduce the committed golden's figures — the proof the fold (not a parse
// of the golden) produces the numbers, so the legacy tally is retired.
describe.skipIf(!duckDbAvailable())('status / product folds — real-archive retirement gate', { tags: ['data-validity'] }, () => {
  let fields: Map<string, FieldCatalogue>;
  beforeAll(() => {
    fields = buildValueCatalogueFold(undefined, ref).fields;
  }, 600_000);

  it('StatusFold_RealArchive_ReproducesCommittedGoldenFigures', () => {
    // The committed `status` TABLE now carries attested rows only (issue #722:
    // the membership projections are demoted to the Cross-checks section), while
    // the fold itself still yields both — so this comparison is scoped to the
    // attested slice; the membership slice is checked against its own demoted
    // location by the test below.
    const committed = parseCommittedStatusTable();
    const attestedFolded = new Map(
      (fields.get(STATUS_FIELD)?.values ?? [])
        .filter(v => v.membership === undefined)
        .map(v => [v.value, v]),
    );
    expect([...attestedFolded.keys()].sort(), 'status value set').toEqual([...committed.keys()].sort());
    for (const [key, c] of committed) {
      const f = attestedFolded.get(key);
      expect(f, `folded status ${key}`).toBeDefined();
      expect({ records: f?.count, callsigns: f?.distinctCallsigns, sources: f?.sources }, key)
        .toEqual({ records: c.records, callsigns: c.callsigns, sources: c.sources });
    }
  });

  it('StatusFold_MembershipRows_RealArchive_ReproduceCommittedCuriosityFigures', () => {
    // The fold's two membership projections (available-pool Available,
    // forbidden-list Forbidden) are published in the demoted Cross-checks
    // section (issue #722), not the status table - this is the retirement-gate
    // proof for THAT figure set: the fold, not a parse of the golden, produces
    // the curiosity section's records/callsigns/sources.
    const curiosities = parseCommittedMembershipCuriosities();
    const membershipFolded = (fields.get(STATUS_FIELD)?.values ?? []).filter(v => v.membership !== undefined);
    expect(membershipFolded.map(v => `${v.membership}/${v.value}`).sort(), 'membership rows in the fold')
      .toEqual(['available-pool/Available', 'forbidden-list/Forbidden']);
    for (const v of membershipFolded) {
      const key = `${v.membership}/${v.value}`;
      const c = curiosities.get(key);
      expect(c, `curiosity ${key}`).toBeDefined();
      expect({ records: v.count, callsigns: v.distinctCallsigns, sources: v.sources })
        .toEqual({ records: c?.records, callsigns: c?.distinctCallsigns, sources: c?.sources });
    }
  });

  it('ProductFold_RealArchive_ReproducesCommittedGoldenFigures', () => {
    const committed = parseCommittedFieldTable(RAW_PRODUCT_FIELD);
    const folded = new Map((fields.get(RAW_PRODUCT_FIELD)?.values ?? []).map(v => [v.value, v]));
    expect([...folded.keys()].sort(), 'product value set').toEqual([...committed.keys()].sort());
    for (const [value, c] of committed) {
      const f = folded.get(value);
      expect(f, `folded product ${value}`).toBeDefined();
      expect({ records: f?.count, callsigns: f?.distinctCallsigns, allocated: f?.allocated, sources: f?.sources }, value)
        .toEqual({ records: c.records, callsigns: c.callsigns, allocated: c.allocated, sources: c.sources });
    }
  });
});
