// Split of the value-catalogue-fold suite by field family (#929): this file
// carries the raw `status` and `product / licence_class` field folds and the
// field-source-roles partition. The small shared support (ref, claim,
// FieldFigures, parseCommittedFieldTable) is duplicated across the three split
// files, each of which runs as its own heavy-fold matrix job so no single job
// carries the whole ~9-minute suite.
import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  buildValueCatalogueFold,
  foldStatusDistribution,
  foldProductDistribution,
  STATUS_FIELD,
  RAW_PRODUCT_FIELD,
  STATUS_PREDICATES,
  PRODUCT_PREDICATES,
} from './value-catalogue-fold.ts';
import { resolveFieldSources, type FieldSources } from './field-source-roles.ts';
import {
  buildFieldTallies,
  catalogueField,
  VALUE_CATALOGUE_PATH,
  PRODUCT_FIELD,
  type FieldCatalogue,
  type ValueTally,
} from './value-catalogue.ts';
import { loadReferenceData } from '../sources/ofcom-amateur/components.ts';
import { serialiseClaimsJsonl } from '../v2/serialise.ts';
import {
  LISTED_PREDICATE,
  type Claim,
} from '../v2/claim.ts';
import { duckDbAvailable } from '../v2/report-fold.ts';

const ref = loadReferenceData();

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

interface FieldFigures { records: number; callsigns: number; allocated: number; sources: number; lanes: string[] }

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
