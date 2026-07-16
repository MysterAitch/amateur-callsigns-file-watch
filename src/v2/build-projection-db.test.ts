import { describe, it, expect } from 'vitest';
import { projectPublicationFromClaims, parseFlagRegistry } from './build-projection-db.ts';
import { LISTED_PREDICATE, type Claim } from './claim.ts';
import { loadReferenceData } from '../sources/ofcom-amateur/components.ts';
import { placeholderOf } from '../../site/browser-query.js';

// Test names follow Subject_Scenario_Outcome per project convention.
//
// The claims->canonical-rows fold behind the ledger projection databases (issue
// #572): fixture claims in, canonical register rows and components out. The
// full-corpus equivalence against the legacy build lives in the heavy parity
// suite (projection-parity.test.ts); these tests pin the fold's own semantics -
// column mapping, date rendering, ordering, padding exclusion, fail-loud paths -
// on synthetic sources.

const REF = loadReferenceData();

// Fixture claims for one open-data source: the @listed anchor per row plus one
// raw attribute claim per non-empty non-subject cell - exactly the multiset the
// raw emit stores (raw-emit.ts), so the fold is exercised on the stored shape.
function claimsFor(
  key: string,
  subjectColumn: string,
  rows: Record<string, string>[],
): Claim[] {
  const sourceFile = `opendata/${key}/raw.csv`;
  const claims: Claim[] = [];
  rows.forEach((row, ordinal) => {
    const rawSubject = row[subjectColumn] ?? '';
    const provenance = { sourceFile, ordinal, vintage: key };
    claims.push({ layer: 'raw', rawSubject, predicate: LISTED_PREDICATE, object: '', provenance });
    for (const [column, value] of Object.entries(row)) {
      if (column === subjectColumn || value === '') continue;
      claims.push({ layer: 'raw', rawSubject, predicate: column, object: value, provenance });
    }
  });
  return claims;
}

describe('projectPublicationFromClaims', { tags: ['unit'] }, () => {
  it('ProjectPublication_DayFirstDateColumns_RenderIsoExactlyAsTheConverterDoes', () => {
    // v2025-salesforce: CreatedDate/LastModifiedDate arrive UK day-first.
    const claims = claimsFor('2099-01-01', 'Value__c', [
      { 'Value__c': 'M7TEE', 'Product__c': 'Amateur Radio (Foundation)', 'Status__c': 'Allocated', 'Type__c': 'Amateur', 'CreatedDate': '23/06/2021 09:15:00', 'LastModifiedDate': '01/02/2023 10:11' },
    ]);
    const publication = projectPublicationFromClaims(claims, REF, 'v2025-salesforce');
    expect(publication.key).toBe('2099-01-01');
    // CANONICAL_COLUMNS order: callsign, product, status, type, created_date,
    // last_modified_date, licence_version_last_modified_date, licence_version_original_start_date.
    expect(publication.rows).toEqual([
      ['M7TEE', 'Amateur Radio (Foundation)', 'Allocated', 'Amateur', '2021-06-23 09:15:00', '2023-02-01 10:11', '', ''],
    ]);
  });

  it('ProjectPublication_IsoExtractDateColumns_CarriedVerbatimTrimmed', () => {
    // v2026-licence-version-iso: workbook-extract dates arrive ISO already.
    const claims = claimsFor('2099-02-02', 'Callsign', [
      { 'Callsign': 'M7TEE', 'Product__c': 'Amateur Radio (Foundation)', 'Status': 'Allocated', 'Type__c': 'Amateur', 'Licence_Version.LastModifiedDate': '2025-12-31 23:59:59', 'Licence_Version.Original_start_date__c': '2020-05-01' },
    ]);
    const publication = projectPublicationFromClaims(claims, REF, 'v2026-licence-version-iso');
    expect(publication.rows[0][6]).toBe('2025-12-31 23:59:59');
    expect(publication.rows[0][7]).toBe('2020-05-01');
  });

  it('ProjectPublication_MalformedIsoExtractDate_FailsLoudly', () => {
    const claims = claimsFor('2099-02-02', 'Callsign', [
      { 'Callsign': 'M7TEE', 'Status': 'Allocated', 'Licence_Version.Original_start_date__c': '01/05/2020' },
    ]);
    expect(() => projectPublicationFromClaims(claims, REF, 'v2026-licence-version-iso'))
      .toThrow(/not a well-formed ISO extract date/);
  });

  it('ProjectPublication_RowOrder_SortsByCallsignCodepointThenWholeRow', () => {
    const claims = claimsFor('2099-01-01', 'Value__c', [
      { 'Value__c': 'M7ZZZ', 'Status__c': 'Allocated' },
      { 'Value__c': 'G0AAA', 'Status__c': 'Allocated' },
      // Duplicate callsign: the whole-row tie-break orders deterministically.
      { 'Value__c': 'G0AAA', 'Status__c': 'Reserved' },
    ]);
    const publication = projectPublicationFromClaims(claims, REF, 'v2025-salesforce');
    expect(publication.rows.map(r => [r[0], r[2]])).toEqual([
      ['G0AAA', 'Allocated'],
      ['G0AAA', 'Reserved'],
      ['M7ZZZ', 'Allocated'],
    ]);
  });

  it('ProjectPublication_PaddingColumns_ExcludedFromCanonicalRows', () => {
    // v2026-licence-version-padded declares five null-mapped padding columns;
    // a stray value in one is carried by the ledger but never enters the
    // canonical projection - exactly the converter's behaviour.
    const claims = claimsFor('2099-03-03', 'Callsign', [
      { 'Callsign': 'M7TEE', 'Status': 'Allocated', 'unknown-1': 'stray-token' },
    ]);
    const publication = projectPublicationFromClaims(claims, REF, 'v2026-licence-version-padded');
    expect(publication.rows[0]).toHaveLength(8);
    expect(publication.rows[0]).not.toContain('stray-token');
  });

  it('ProjectPublication_BlankCells_ProjectAsEmptyStrings', () => {
    // The raw emit stores no claim for an empty cell; the fold reprojects the
    // absence as '' so the record set stays rectangular.
    const claims = claimsFor('2099-01-01', 'Value__c', [
      { 'Value__c': 'M7TEE' },
    ]);
    const publication = projectPublicationFromClaims(claims, REF, 'v2025-salesforce');
    expect(publication.rows[0]).toEqual(['M7TEE', '', '', '', '', '', '', '']);
  });

  it('ProjectPublication_AllBlankRow_SurvivesViaItsListedAnchor', () => {
    // The 2022 publication carries an all-empty row (,,): only its @listed
    // anchor is stored, and the fold must still reproject the row.
    const claims = claimsFor('2099-01-01', 'Value__c', [
      { 'Value__c': '' },
      { 'Value__c': 'M7TEE', 'Status__c': 'Allocated' },
    ]);
    const publication = projectPublicationFromClaims(claims, REF, 'v2025-salesforce');
    expect(publication.rows).toHaveLength(2);
    expect(publication.rows[0]).toEqual(['', '', '', '', '', '', '', '']);
    expect(publication.components[0].parseStatus).toBe('empty');
  });

  it('ProjectPublication_UnknownVariant_FailsLoudly', () => {
    const claims = claimsFor('2099-01-01', 'Value__c', [{ 'Value__c': 'M7TEE' }]);
    expect(() => projectPublicationFromClaims(claims, REF, 'v1999-nonexistent'))
      .toThrow(/not in the variant registry/);
  });

  it('ProjectPublication_NonOpenDataSource_FailsLoudly', () => {
    const claims: Claim[] = [{
      layer: 'raw', rawSubject: 'M7TEE', predicate: LISTED_PREDICATE, object: '',
      provenance: { sourceFile: 'foi/some-entry/file.csv', ordinal: 0, vintage: '2020-01-01' },
    }];
    expect(() => projectPublicationFromClaims(claims, REF, 'v2025-salesforce'))
      .toThrow(/opendata/);
  });

  it('ProjectPublication_RegionalRendering_PlaceholderFormAgreesWithBrowserNormalisation', () => {
    // The lookup resolves a typed regional rendering by computing placeholderOf
    // in the browser and matching components.placeholder_form. The two sides of
    // that contract must agree: the build-side placeholder of the register core
    // equals the browser-side placeholder of ANY regional rendering of it.
    const claims = claimsFor('2099-01-01', 'Value__c', [
      { 'Value__c': 'M7TEE', 'Product__c': 'Amateur Radio (Foundation)', 'Status__c': 'Allocated' },
      { 'Value__c': '2E0ABC', 'Product__c': 'Amateur Radio (Intermediate)', 'Status__c': 'Allocated' },
    ]);
    const publication = projectPublicationFromClaims(claims, REF, 'v2025-salesforce');
    const byCallsign = new Map(publication.components.map(c => [c.callsign, c]));
    expect(byCallsign.get('M7TEE')?.placeholderForm).toBe('M#7TEE');
    for (const rendering of ['M7TEE', 'MW7TEE', 'MD7TEE', 'M#7TEE']) {
      expect(placeholderOf(rendering)).toBe(byCallsign.get('M7TEE')?.placeholderForm);
    }
    for (const rendering of ['2E0ABC', '20ABC', '2W0ABC']) {
      expect(placeholderOf(rendering)).toBe(byCallsign.get('2E0ABC')?.placeholderForm);
    }
  });

  it('ProjectPublication_StrippedCollisionPair_FlaggedAcrossTheWholeSet', () => {
    // 'G6 FMU' and 'G6FMU' share a cleaned key; the whole-set flag pass must
    // run over the folded rows exactly as it does over the converter's.
    const claims = claimsFor('2099-01-01', 'Value__c', [
      { 'Value__c': 'G6 FMU', 'Status__c': 'Allocated' },
      { 'Value__c': 'G6FMU', 'Status__c': 'Allocated' },
    ]);
    const publication = projectPublicationFromClaims(claims, REF, 'v2025-salesforce');
    const byCallsign = new Map(publication.components.map(c => [c.callsign, c]));
    // The flag rides the row whose junk-stripped form collides with another
    // row ('G6 FMU'), not the plain row it collides with ('G6FMU') - the same
    // asymmetry the converter's whole-set pass produces.
    expect(byCallsign.get('G6 FMU')?.flags).toContain('stripped-collision');
    expect(byCallsign.get('G6FMU')?.flags).not.toContain('stripped-collision');
  });
});

describe('parseFlagRegistry', { tags: ['unit'] }, () => {
  it('FlagRegistry_ReferenceMarkdown_ParsesToNonEmptyVocabulary', () => {
    const rows = parseFlagRegistry();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.flag).toMatch(/^[a-z-]+$/);
      expect(row.meaning.length).toBeGreaterThan(0);
    }
  });
});
