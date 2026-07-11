import { describe, it, expect } from 'vitest';
import { loadReferenceData, normaliseLicenceCategory } from '../sources/ofcom-amateur/components.ts';

// Independent acceptance criteria for the licence-type / status vocabulary
// rules a rebuild MUST satisfy (v2 reference, section B). The canonical
// mapping is a SEPARATE derived view over the verbatim raw product string;
// the distinctions asserted here (Temporary Reciprocal vs Full Reciprocal,
// blank vs unmapped) are the ones a naive re-implementation is most likely to
// get wrong.

const REF = loadReferenceData();

describe('canonical licence-category map (acceptance criterion B2)', () => {
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
    expect(normaliseLicenceCategory('Special Event Station', REF)).toBe('Special Event');
  });
});

describe('reciprocal distinction (acceptance criterion B3)', () => {
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

describe('blank versus unmapped products (acceptance criteria B4 / B5)', () => {
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
