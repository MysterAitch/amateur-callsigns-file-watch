import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';
import { loadReferenceData, normaliseLicenceCategory } from '../sources/ofcom-amateur/components.ts';

// Independent acceptance criteria for the licence-type / status vocabulary
// rules a rebuild MUST satisfy (v2 reference, section B). The canonical
// mapping is a SEPARATE derived view over the verbatim raw product string;
// the distinctions asserted here (Temporary Reciprocal vs Full Reciprocal,
// blank vs unmapped) are the ones a naive re-implementation is most likely to
// get wrong.

const REF = loadReferenceData();

describe('canonical licence-category map (acceptance criterion B2)', { tags: ['data-validity'] }, () => {
  it('LicenceCategory_WhenSourceVintagesDiffer_CollapseToOneCategory', () => {
    // The register writes the same class differently by vintage; both
    // spellings map to one canonical category while remaining distinct raw
    // strings (the raw value is carried verbatim elsewhere).
    expect(normaliseLicenceCategory('Full', REF)).toBe('Full');
    expect(normaliseLicenceCategory('Amateur Full Radio Licence', REF)).toBe('Full');
    expect(normaliseLicenceCategory('Foundation', REF)).toBe('Foundation');
    expect(normaliseLicenceCategory('Amateur Foundation Radio Licence', REF)).toBe('Foundation');
    expect(normaliseLicenceCategory('Intermediate', REF)).toBe('Intermediate');
    expect(normaliseLicenceCategory('Amateur Intermediate Radio Licence', REF)).toBe('Intermediate');
    expect(normaliseLicenceCategory('Amateur Club Radio Licence', REF)).toBe('Club');
    expect(normaliseLicenceCategory('Special Event Station', REF)).toBe('Special Event Station');
  });
});

describe('special-event / NoV family distinction (issue #344)', { tags: ['data-validity'] }, () => {
  it('LicenceCategory_WhenNonPermanentSpecialEventVariants_CollapseToSpecialEventStation', () => {
    // The event-bounded special-event working: the plain product and its two
    // Notice-of-Variation spellings share one canonical category, the raw
    // spellings carried verbatim elsewhere.
    expect(normaliseLicenceCategory('Special Event Station', REF)).toBe('Special Event Station');
    expect(normaliseLicenceCategory('NoV Special Event Station', REF)).toBe('Special Event Station');
    expect(normaliseLicenceCategory('NoV Special Special Event Station', REF)).toBe('Special Event Station');
  });

  it('LicenceCategory_WhenPermanentSpecialEventVariants_StayDistinctFromNonPermanent', () => {
    // The permanent variant is kept a separate category from the event-bounded
    // one — different licence mechanics (an open-ended NoV), not merged for
    // tidiness, on the precedent that keeps Temporary Reciprocal from Full
    // (Reciprocal). Neither permanent spelling reads as plain Special Event.
    const perm = normaliseLicenceCategory('Perm Special Event Station', REF);
    const novPerm = normaliseLicenceCategory('NoV Permanent Special Event Station', REF);
    expect(perm).toBe('Permanent Special Event Station');
    expect(novPerm).toBe('Permanent Special Event Station');
    expect(perm).not.toBe('Special Event Station');
  });

  it('LicenceCategory_WhenSpecialResearchPermit_IsItsOwnCategoryNotSpecialEvent', () => {
    // A research permit is a different instrument from an event station; it is
    // its own category, never folded into special-event working.
    const research = normaliseLicenceCategory('Special Research Permit', REF);
    expect(research).toBe('Special Research Permit');
    expect(research).not.toBe('Special Event Station');
    expect(research).not.toBe('Permanent Special Event Station');
  });
});

describe('reciprocal distinction (acceptance criterion B3)', { tags: ['data-validity'] }, () => {
  it('LicenceCategory_WhenTemporaryReciprocalVersusFullReciprocal_MustNotCollapse', () => {
    // A temporary visitor authorisation (phased out) and a permanent
    // full-on-reciprocal licence (HAREC / T-R 61-02) are different products;
    // they must stay distinct categories.
    const temporary = normaliseLicenceCategory('Amateur Temporary Reciprocal Radio Licence', REF);
    const full = normaliseLicenceCategory('Amateur Full (Reciprocal) Radio Licence', REF);
    expect(temporary).toBe('Temporary Reciprocal');
    expect(full).toBe('Full Reciprocal');
    expect(temporary).not.toBe(full);
  });
});

describe('blank versus unmapped products (acceptance criteria B4 / B5)', { tags: ['data-validity'] }, () => {
  it('LicenceCategory_WhenBlankProduct_IsNotACategory', () => {
    // A blank product asserts no class (many live allocations carry one); it
    // is not forced into a bucket.
    expect(normaliseLicenceCategory('', REF)).toBeNull();
    expect(normaliseLicenceCategory('   ', REF)).toBeNull();
  });

  it('LicenceCategory_WhenUnmappedNonBlankProduct_ReturnsNullToFailLoud', () => {
    // An unrecognised NON-blank product must surface as null rather than be
    // silently bucketed - an unknown product is a surprise to expose, not to
    // guess at.
    expect(normaliseLicenceCategory('Amateur Novice Radio Licence', REF)).toBeNull();
  });
});

describe('licence-category mapping integrity', { tags: ['data-validity'] }, () => {
  it('LicenceCategoryMap_EveryProduct_ResolvesToExactlyOneCategory', () => {
    // A product string maps to at most one category by construction: a duplicate
    // key would silently overwrite in the map (a row matching two categories,
    // ambiguously categorised). Guard the source CSV against that so the fold's
    // one-to-one product→category join stays honest.
    const csv = fs.readFileSync(
      path.resolve(import.meta.dirname, '..', '..', 'reference-data', 'licence-category.csv'), 'utf8');
    const rows = parse(csv, { columns: true, skip_empty_lines: true }) as { product: string; normalised_category: string }[];
    const seen = new Set<string>();
    for (const row of rows) {
      expect(seen.has(row.product), `duplicate product key: ${row.product}`).toBe(false);
      seen.add(row.product);
    }
    // The loaded map exposes one category per product, never a set.
    expect(REF.licenceCategory.size).toBe(rows.length);
  });
});
