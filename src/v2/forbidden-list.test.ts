import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  emitClaims,
  LISTED_PREDICATE,
  NORMALISES_TO_PREDICATE,
  LICENCE_CATEGORY_PREDICATE,
} from './claim.ts';
import { parseClaimsJsonl } from './serialise.ts';
import { projectNormalised } from './project-normalised.ts';
import { buildLedger, type EntrySelector } from './build-ledger.ts';
import {
  collectForbiddenListSources,
  forbiddenListEntries,
  forbiddenSourcesFor,
  loadForbiddenSource,
} from './collectors/forbidden-list.ts';
import { registerSourcesFor } from './collectors/foi-register.ts';
import { readFoiEntryMeta, defaultFoiDir } from '../shared/foi-archive.ts';
import { loadReferenceData } from '../sources/ofcom-amateur/components.ts';
import { assertNonEmpty } from '../testing/non-vacuity.ts';

// Test names follow the project's Subject_Scenario_Outcome convention.
//
// The forbidden-list family (#361, the CANARY of the bespoke-family batch): the
// three-letter suffixes Ofcom withholds from issue. The whole thesis is that a
// suffix is NOT a callsign - so it must ride the raw-only emit path, carry its
// token verbatim, preserve duplicate observations, and NEVER acquire a callsign
// normalisation edge or a licence-category tier. The four disclosures covered
// are the standalone 2024-12 list (the only one with per-suffix dated
// provenance) plus the forbidden sheets riding inside three register-and-
// forbidden containers. Each is reached from its ENTRY only; the raw file and
// suffix column are read from the authored converter binding, never hard-coded.

const REF = loadReferenceData();
const FOI_DIR = defaultFoiDir();

const STANDALONE_DATED_ENTRY = 'ofcom-2024-12--forbidden-suffixes';
const DUPLICATE_SUFFIX_ENTRY = 'wdtk-356636--all-callsigns-plus-forbidden';

// The four disclosures the 'forbidden-list' datasetClass covers: one standalone,
// three riding inside register-and-forbidden containers.
const EXPECTED_FORBIDDEN_ENTRIES = [
  STANDALONE_DATED_ENTRY,
  'ofcom-756622--published-register-csv',
  DUPLICATE_SUFFIX_ENTRY,
  'wdtk-596532--allocated-reserved-forbidden',
];

// An order-independent multiset of parsed records over a fixed column set - the
// equivalence unit the round-trip oracle compares (mirrors build-ledger.test).
function multiset(records: readonly Record<string, string>[], columns: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const record of records) {
    const key = JSON.stringify(columns.map(column => [column, record[column] ?? '']));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function multisetsEqual(a: Map<string, number>, b: Map<string, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [key, count] of a) if (b.get(key) !== count) return false;
  return true;
}

describe('the forbidden-list family covers exactly the classed disclosures', { tags: ['data-validity'] }, () => {
  it('ForbiddenListFamily_WhenCollected_CoversTheFourForbiddenClassedDisclosures', () => {
    const sources = collectForbiddenListSources(FOI_DIR);

    // Discovered from datasetClasses, one suffix source per classed disclosure.
    const coveredEntries = sources.map(source => source.entry).sort();
    expect(coveredEntries).toEqual([...EXPECTED_FORBIDDEN_ENTRIES].sort());

    for (const source of sources) {
      expect(source.family).toBe('forbidden-list');
      // A suffix, never a callsign - so the emit path stays raw-only.
      expect(source.subjectKind).toBe('suffix');
      const observationSet = source.load();
      expect(observationSet.rows.length).toBeGreaterThan(0);
      expect(observationSet.subjectColumn.length).toBeGreaterThan(0);
      expect(observationSet.sourceFile.startsWith(`foi/${source.entry}/`)).toBe(true);
      // A suffix source discloses no product column, so no category is derivable.
      expect(observationSet.categoryColumn).toBeUndefined();
    }
  });

  it('ForbiddenSheet_WhenRidingInsideRegisterContainer_IsDisjointFromTheRegisterCallsignSheet', () => {
    // A register-and-forbidden entry (e.g. wdtk-356636) carries both a callsign
    // sheet (the register family's) and a forbidden-suffix sheet (this family's).
    // The two selections must resolve DIFFERENT source files, so no row is
    // emitted by both families.
    const meta = readFoiEntryMeta(FOI_DIR, DUPLICATE_SUFFIX_ENTRY);
    const forbiddenFiles = forbiddenSourcesFor(meta).map(s => s.conversion.sourceFile);
    const registerFiles = registerSourcesFor(meta).map(s => s.conversion.sourceFile);
    expect(forbiddenFiles.length).toBeGreaterThan(0);
    expect(registerFiles.length).toBeGreaterThan(0);
    for (const forbiddenFile of forbiddenFiles) {
      expect(registerFiles).not.toContain(forbiddenFile);
    }
  });
});

describe('forbidden-suffix claims are raw-only and carry their tokens verbatim', { tags: ['data-validity'] }, () => {
  it('ForbiddenSuffixClaims_WhenDatedDisclosureEmitted_ListEachSuffixAndCarryLastModifiedDateVerbatim', () => {
    const meta = readFoiEntryMeta(FOI_DIR, STANDALONE_DATED_ENTRY);
    const source = forbiddenSourcesFor(meta)[0];
    const observationSet = loadForbiddenSource(FOI_DIR, STANDALONE_DATED_ENTRY, meta, source);
    const claims = emitClaims(observationSet);

    // Raw layer only - a suffix acquires no derived claims from emitClaims.
    expect(claims.every(claim => claim.layer === 'raw')).toBe(true);
    // No callsign machinery leaked onto a suffix.
    expect(claims.some(claim => claim.predicate === NORMALISES_TO_PREDICATE)).toBe(false);
    expect(claims.some(claim => claim.predicate === LICENCE_CATEGORY_PREDICATE)).toBe(false);

    // One existence claim per suffix row.
    const listed = claims.filter(claim => claim.predicate === LISTED_PREDICATE);
    expect(listed.length).toBe(observationSet.rows.length);

    // The per-suffix dated provenance rides as its own raw attribute claim,
    // under Ofcom's OWN header, carrying the raw day-first value VERBATIM (the
    // ISO conversion belongs to the normalised derivative, not the raw ledger).
    const dateClaims = claims.filter(claim => claim.predicate === 'LastModifiedDate');
    expect(dateClaims.length).toBeGreaterThan(0);
    for (const claim of dateClaims) {
      expect(claim.object).toMatch(/^\d{2}\/\d{2}\/\d{4}/);
    }

    // A known suffix from the disclosure is listed and dated verbatim.
    const adsListed = listed.filter(claim => claim.rawSubject === 'ADS');
    expect(adsListed.length).toBe(1);
    const adsDate = dateClaims.find(claim => claim.rawSubject === 'ADS');
    expect(adsDate?.object).toBe('29/07/2016 17:19');
  });

  it('ForbiddenSuffixDuplicates_WhenSuffixListedTwice_SurviveAsDistinctObservations', () => {
    // The 2016 sheet lists ZIT twice - a data-quality artefact the raw ledger
    // surfaces as two observations (distinct ordinals), never deduped.
    const meta = readFoiEntryMeta(FOI_DIR, DUPLICATE_SUFFIX_ENTRY);
    const source = forbiddenSourcesFor(meta)[0];
    const observationSet = loadForbiddenSource(FOI_DIR, DUPLICATE_SUFFIX_ENTRY, meta, source);
    const claims = emitClaims(observationSet);

    const zitListed = claims.filter(claim => claim.predicate === LISTED_PREDICATE && claim.rawSubject === 'ZIT');
    expect(zitListed.length).toBe(2);
    // Distinct observations: different ordinals, same verbatim token.
    expect(new Set(zitListed.map(claim => claim.provenance.ordinal)).size).toBe(2);

    // The sheet's constant 'Type' column rides VERBATIM as a raw claim per row
    // (issue #813 Stage D): 'Forbidden' on every row IS a published byte, and
    // without it the sheet cannot reconstruct from the ledger. The converter's
    // ignoredColumns entry still VERIFIES the constant at normalise time; the
    // history fold reads dated provenance by its authored header name, so a
    // carried constant never masquerades as a date.
    const typeClaims = claims.filter(claim => claim.predicate === 'Type');
    expect(typeClaims.length).toBe(observationSet.rows.length);
    expect(typeClaims.every(claim => claim.object === 'Forbidden')).toBe(true);
    expect(claims.every(claim => claim.predicate === LISTED_PREDICATE || claim.predicate === 'Type')).toBe(true);
  });

  it('ForbiddenSource_WhenLoaded_AttestsTheReconstructionRouting', () => {
    // Structural coverage (issue #813 Stage D) makes every registered source a
    // reconstruction source: the forbidden loader now attests per-row source
    // lines, the header line and the true repo path/encoding, so the oracle
    // rebuilds each forbidden sheet from the persisted claims.
    for (const source of assertNonEmpty(collectForbiddenListSources(FOI_DIR), 'forbidden-list sources')) {
      const observationSet = source.load();
      expect(observationSet.repoPath).toBe(`archive/${observationSet.sourceFile}`);
      expect(observationSet.lineNumbers?.length).toBe(observationSet.rows.length);
      expect(observationSet.headerLine).toBe(1);
    }
  });

  it('ForbiddenSuffixRawLayer_WhenFoldedBack_ReproducesThePublishedSheet', () => {
    // The raw layer is a lossless encoding of the published bytes: folding the
    // raw claims back reproduces the suffix sheet exactly, under Ofcom's own
    // header, order-independent.
    const meta = readFoiEntryMeta(FOI_DIR, 'ofcom-756622--published-register-csv');
    const source = forbiddenSourcesFor(meta)[0];
    const observationSet = loadForbiddenSource(FOI_DIR, 'ofcom-756622--published-register-csv', meta, source);
    const rawClaims = emitClaims(observationSet).filter(claim => claim.layer === 'raw');

    const projected = projectNormalised(rawClaims, observationSet.columns, observationSet.subjectColumn);
    expect(projected.length).toBe(observationSet.rows.length);
    expect(multisetsEqual(
      multiset(projected.map(record => record.values), observationSet.columns),
      multiset(observationSet.rows, observationSet.columns),
    )).toBe(true);
  });
});

describe('the last-modified date join is guarded against a present-but-wrong column', { tags: ['data-validity'] }, () => {
  it('ForbiddenSource_WhenLastModifiedBindingNamesARealNonDateColumn_FailsLoudNamingTheSourceAndColumn', () => {
    // The gap #844 closes: the forbidden-history fold joins per-suffix dates by
    // the binding's authored last-modified column NAME. An ABSENT name already
    // fails loud, but a name that IS a real header yet the WRONG column - here the
    // suffix column, a real header carrying suffix tokens, not dates - would join
    // cleanly and silently null (or mis-read) every date, caught only by the
    // committed golden. Loading such a source must now throw a located error.
    const meta = readFoiEntryMeta(FOI_DIR, STANDALONE_DATED_ENTRY);
    const source = forbiddenSourcesFor(meta)[0];
    // Re-point the date binding at the suffix column: a real, present header whose
    // values (three-letter suffix tokens) are not dates.
    const misbound = { ...source, lastModifiedColumn: source.suffixColumn };

    expect(() => loadForbiddenSource(FOI_DIR, STANDALONE_DATED_ENTRY, meta, misbound))
      .toThrowError(new RegExp(`authored last-modified column "${source.suffixColumn}" carries non-date values`));
  });

  it('ForbiddenSource_WhenLastModifiedBindingNamesTheRealDateColumn_LoadsWithoutThrowing', () => {
    // Behaviour preserved: the correct binding (the 2024-12 export's real
    // LastModifiedDate column) still loads, so the guard passes on the shape the
    // committed golden was built from and the report reproduces byte-equal.
    const meta = readFoiEntryMeta(FOI_DIR, STANDALONE_DATED_ENTRY);
    const source = forbiddenSourcesFor(meta)[0];
    expect(source.lastModifiedColumn).not.toBeNull();

    const observationSet = loadForbiddenSource(FOI_DIR, STANDALONE_DATED_ENTRY, meta, source);
    expect(observationSet.rows.length).toBeGreaterThan(0);
  });
});

describe('the forbidden-list family builds through buildLedger with no callsign edge on any suffix', { tags: ['data-validity'] }, () => {
  let outputDir: string;

  beforeAll(() => {
    outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-forbidden-'));
    const wanted = new Set(EXPECTED_FORBIDDEN_ENTRIES);
    const selector: EntrySelector = entry => wanted.has(entry);
    buildLedger(outputDir, FOI_DIR, REF, selector);
  });

  afterAll(() => {
    fs.rmSync(outputDir, { recursive: true, force: true });
  });

  it('ForbiddenListLedger_WhenBuiltViaEntrySelector_EmitsRawSuffixClaimsAndNoNormalisesToEdge', () => {
    const summary = buildLedger(outputDir, FOI_DIR, REF, entry => new Set(EXPECTED_FORBIDDEN_ENTRIES).has(entry));

    // The family reports all four classed disclosures.
    expect(summary.entriesByFamily['forbidden-list']).toBe(EXPECTED_FORBIDDEN_ENTRIES.length);

    const forbiddenSources = summary.perSource.filter(s => s.family === 'forbidden-list');
    expect(forbiddenSources.length).toBe(EXPECTED_FORBIDDEN_ENTRIES.length);
    for (const s of forbiddenSources) {
      // A suffix source emits raw observation claims and derives nothing - the
      // callsign edge / licence-category tier is guarded off by subjectKind.
      expect(s.rawClaims).toBeGreaterThan(0);
      expect(s.derivedClaims).toBe(0);
    }

    // Inspect the forbidden family's OWN written JSONL (targeted by jsonlStem,
    // so the callsign sheets sharing these container entries are not mistaken
    // for this family's output): every claim is raw, none is a callsign edge or
    // a category tier, and each sheet anchors its suffixes with @listed.
    const ledgerDir = path.join(outputDir, 'ledger');
    for (const source of collectForbiddenListSources(FOI_DIR)) {
      const jsonl = fs.readFileSync(path.join(ledgerDir, `${source.jsonlStem}.jsonl`), 'utf8');
      const claims = parseClaimsJsonl(jsonl);
      expect(claims.length).toBeGreaterThan(0);
      expect(claims.every(claim => claim.layer === 'raw')).toBe(true);
      expect(claims.some(claim => claim.predicate === NORMALISES_TO_PREDICATE)).toBe(false);
      expect(claims.some(claim => claim.predicate === LICENCE_CATEGORY_PREDICATE)).toBe(false);
      expect(claims.some(claim => claim.predicate === LISTED_PREDICATE)).toBe(true);
    }
  });

  it('ForbiddenListEntries_WhenDiscovered_MatchTheClassedDisclosures', () => {
    // The entry discovery keys off datasetClasses, so an as-published duplicate
    // with no converter binding (converter null) is classed forbidden-list yet
    // resolves no suffix source and is not double-counted.
    const entries = forbiddenListEntries(FOI_DIR).map(e => e.entry);
    for (const expected of EXPECTED_FORBIDDEN_ENTRIES) {
      expect(entries).toContain(expected);
    }
    const withSources = forbiddenListEntries(FOI_DIR).filter(e => forbiddenSourcesFor(e.meta).length > 0);
    expect(withSources.map(e => e.entry).sort()).toEqual([...EXPECTED_FORBIDDEN_ENTRIES].sort());
  });
});
