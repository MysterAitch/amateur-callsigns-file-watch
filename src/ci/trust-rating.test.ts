import { describe, it, expect } from 'vitest';
import {
  checkAuthorityTotality,
  checkAuthorityConsistency,
  checkNoInflationClaims,
  assertTrustRating,
} from './trust-rating.ts';
import {
  emitLedger,
  LISTED_PREDICATE,
  NORMALISES_TO_PREDICATE,
  LICENCE_CATEGORY_PREDICATE,
  LICENCE_CATEGORY_RULE,
  CLEANED_CALLSIGN_RULE,
  type Claim,
} from '../v2/claim.ts';
import { registerSourcesFor, loadRegisterSource } from '../v2/collectors/foi-register.ts';
import { loadOpenDataRegisterSource, defaultArchiveDir } from '../v2/collectors/open-data-register.ts';
import { readFoiEntryMeta, defaultFoiDir } from '../shared/foi-archive.ts';
import { loadReferenceData } from '../sources/ofcom-amateur/components.ts';
import type { ArchiveMeta } from '../shared/utils.ts';
import * as fs from 'fs';
import * as path from 'path';

const REF = loadReferenceData();
const FOI_DIR = defaultFoiDir();
const ARCHIVE_DIR = defaultArchiveDir();

// A representative real ledger: one FOI register snapshot (exercises the
// existence + attribute raw claims and the cleaned/placeholder normalisation
// edges) and one open-data publication that carries a product column (so the
// derived licence-category lookup tier is present). Building the full
// multi-million-claim corpus is unnecessary — the invariant is pure over
// Claim[], so a sample carrying every claim SHAPE proves the net.
function representativeLedger(): Claim[] {
  const foiEntry = 'ofcom-2023-12-07--open-data-call-sign-list--all-callsigns';
  const foiMeta = readFoiEntryMeta(FOI_DIR, foiEntry);
  const foiSource = loadRegisterSource(FOI_DIR, foiEntry, foiMeta, registerSourcesFor(foiMeta)[0]);

  const openKey = '2026-06-23';
  const openMeta = JSON.parse(fs.readFileSync(path.join(ARCHIVE_DIR, openKey, 'meta.json'), 'utf8')) as ArchiveMeta;
  const openSource = loadOpenDataRegisterSource(ARCHIVE_DIR, openKey, openMeta);

  return [...emitLedger(foiSource, REF), ...emitLedger(openSource, REF)];
}

describe('trust-rating archive authority gate', () => {
  it('EveryArchiveEntry_WhenClassified_ResolvesToExactlyOneAuthority', () => {
    // Totality: no open-data or FOI entry is left unclassified, and none
    // trips the lane/sourceKey inflation guard.
    expect(checkAuthorityTotality()).toEqual([]);
  });

  it('AuthorityLabels_WhenSurfacedByDatasetOverview_AgreeWithCanonicalDerivation', () => {
    // Consistency: the one generated surface that labels authority never shows
    // a rung the canonical derivation contradicts.
    expect(checkAuthorityConsistency()).toEqual([]);
  });
});

describe('trust-rating claim no-inflation invariant', () => {
  it('RepresentativeLedger_WhenBuiltFromRealSources_CarriesEveryClaimShapeAndPasses', () => {
    const ledger = representativeLedger();

    // The sample genuinely exercises every claim shape the invariant guards,
    // so a green result is meaningful, not vacuous.
    expect(ledger.some(c => c.layer === 'raw' && c.predicate === LISTED_PREDICATE)).toBe(true);
    expect(ledger.some(c => c.layer === 'raw' && c.predicate !== LISTED_PREDICATE)).toBe(true);
    expect(ledger.some(c => c.layer === 'derived' && c.predicate === NORMALISES_TO_PREDICATE)).toBe(true);
    expect(ledger.some(c => c.layer === 'derived' && c.predicate === LICENCE_CATEGORY_PREDICATE)).toBe(true);

    expect(checkNoInflationClaims(ledger)).toEqual([]);
  });

  // --- Negative tests: the net must CATCH a deliberately-inflated rating. ---

  const rawProduct = (subject: string): Claim => ({
    layer: 'raw', rawSubject: subject, predicate: 'product', object: 'Amateur',
    provenance: { sourceFile: 'opendata/2026-06-23/raw.csv', ordinal: 0, vintage: '2026-06-23' },
  });
  const listed = (subject: string): Claim => ({
    layer: 'raw', rawSubject: subject, predicate: LISTED_PREDICATE, object: '',
    provenance: { sourceFile: 'opendata/2026-06-23/raw.csv', ordinal: 0, vintage: '2026-06-23' },
  });

  it('DerivedClaimRelabelledRaw_WhenSurfacedAsPublished_IsCaught', () => {
    // The headline inflation: a COMPUTED normalises_to edge dressed as a
    // verbatim (As-published) source assertion by flipping its layer to raw
    // while keeping its rule.
    const inflated: Claim = {
      layer: 'raw', rawSubject: 'M7TEE', predicate: NORMALISES_TO_PREDICATE, object: 'M7TEE',
      rule: CLEANED_CALLSIGN_RULE,
      provenance: { sourceFile: 'opendata/2026-06-23/raw.csv', ordinal: 0, vintage: '2026-06-23' },
    };
    const violations = checkNoInflationClaims([listed('M7TEE'), inflated]);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.some(v => /dressed as As-published/.test(v.detail))).toBe(true);
  });

  it('DerivedClaimWithoutRule_WhenProductionMethodUnattributable_IsCaught', () => {
    const noRule: Claim = {
      layer: 'derived', rawSubject: 'M7TEE', predicate: NORMALISES_TO_PREDICATE, object: 'M7TEE',
      provenance: { sourceFile: 'opendata/2026-06-23/raw.csv', ordinal: 0, vintage: '2026-06-23' },
    };
    const violations = checkNoInflationClaims([listed('M7TEE'), noRule]);
    expect(violations.some(v => /no named rule/.test(v.detail))).toBe(true);
  });

  it('DerivedClaimForInventedSubject_WhenNoRawBasis_IsCaught', () => {
    // A derived claim whose subject never appears in the raw layer of the same
    // source — an invented subject conjured at a trust rating it never earned.
    const invented: Claim = {
      layer: 'derived', rawSubject: 'ZZ9ZZA', predicate: NORMALISES_TO_PREDICATE, object: 'ZZ9ZZA',
      rule: CLEANED_CALLSIGN_RULE,
      provenance: { sourceFile: 'opendata/2026-06-23/raw.csv', ordinal: 5, vintage: '2026-06-23' },
    };
    const violations = checkNoInflationClaims([listed('M7TEE'), invented]);
    expect(violations.some(v => /invented subject/.test(v.detail))).toBe(true);
  });

  it('LicenceCategoryTier_WhenSubjectDisclosedNoProduct_IsCaught', () => {
    // A looked-up licence-category riding a listed-only subject: a category
    // invented for a callsign whose source never disclosed a product.
    const invented: Claim = {
      layer: 'derived', rawSubject: 'M7TEE', predicate: LICENCE_CATEGORY_PREDICATE, object: 'Amateur (Foundation)',
      rule: LICENCE_CATEGORY_RULE,
      provenance: { sourceFile: 'opendata/2026-06-23/raw.csv', ordinal: 0, vintage: '2026-06-23' },
    };
    const violations = checkNoInflationClaims([listed('M7TEE'), invented]);
    expect(violations.some(v => /invented category/.test(v.detail))).toBe(true);
  });

  it('LicenceCategoryTier_WhenSubjectDisclosedProduct_Passes', () => {
    // The same tier over a subject WITH a raw product claim is legitimate.
    const legit: Claim = {
      layer: 'derived', rawSubject: 'M7TEE', predicate: LICENCE_CATEGORY_PREDICATE, object: 'Amateur (Foundation)',
      rule: LICENCE_CATEGORY_RULE,
      provenance: { sourceFile: 'opendata/2026-06-23/raw.csv', ordinal: 0, vintage: '2026-06-23' },
    };
    expect(checkNoInflationClaims([listed('M7TEE'), rawProduct('M7TEE'), legit])).toEqual([]);
  });

  // --- File-level derived claims ground in their @column basis (issue #435). ---

  const fileLevelColumn = (index: number, object: string): Claim => ({
    layer: 'raw', rawSubject: '', predicate: `@column/${index}`, object,
    provenance: { sourceFile: 'opendata/2026-06-23/raw.csv', ordinal: -1, vintage: '2026-06-23' },
  });
  const fileLevelInterpretation = (index: number, object: string): Claim => ({
    layer: 'derived', rawSubject: '', predicate: `@interpretation/${index}`, object,
    rule: 'column-interpretation',
    provenance: { sourceFile: 'opendata/2026-06-23/raw.csv', ordinal: -1, vintage: '2026-06-23' },
  });

  it('FileLevelInterpretation_WhenGroundedInItsColumnHeader_Passes', () => {
    // A derived @interpretation grounds in the raw @column for the same file -
    // not in an observation subject (its rawSubject is '', its ordinal the
    // sentinel), so the observation trace must not flag it as an invented subject.
    const stream = [fileLevelColumn(0, 'Callsign'), fileLevelInterpretation(0, 'callsign-token')];
    expect(checkNoInflationClaims(stream)).toEqual([]);
  });

  it('FileLevelInterpretation_WhenItsColumnHeaderIsMissing_IsCaughtAsAnInventedColumn', () => {
    const stream = [fileLevelInterpretation(7, 'date:DD/MM/YYYY')];
    const violations = checkNoInflationClaims(stream);
    expect(violations.some(v => /invented column/.test(v.detail))).toBe(true);
  });

  it('AssertTrustRating_WhenClaimsCarryInflatedRating_ThrowsLoud', () => {
    const inflated: Claim = {
      layer: 'raw', rawSubject: 'M7TEE', predicate: NORMALISES_TO_PREDICATE, object: 'M7TEE',
      rule: CLEANED_CALLSIGN_RULE,
      provenance: { sourceFile: 'opendata/2026-06-23/raw.csv', ordinal: 0, vintage: '2026-06-23' },
    };
    expect(() => assertTrustRating([listed('M7TEE'), inflated])).toThrow(/trust-rating violation/);
  });
});
