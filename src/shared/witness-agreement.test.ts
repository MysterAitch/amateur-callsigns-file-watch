import { describe, it, expect } from 'vitest';
import {
  classifyWitnessAgreement,
  heldHashSet,
  normaliseWitnessHash,
  divergenceRecordProblems,
  unpairedDivergentWitnessProblems,
  type DivergenceRecord,
} from './witness-agreement.ts';

// Test names follow Subject_Scenario_Outcome per project convention.
//
// Derived witness agreement (#618 increment 3 / #619): a witness with no hash
// is citation-grade; a hash that matches a held copy is corroborating; a hash
// that matches none is divergent and must be paired with a divergence record,
// or validation fails loudly. Nothing is stored — every class is re-derived.

const HELD_A = 'a'.repeat(64);
const HELD_B = 'b'.repeat(64);
const UNHELD = 'c'.repeat(64);

describe('classifyWitnessAgreement — deriving agreement on read', { tags: ['unit'] }, () => {
  const held = heldHashSet([HELD_A, HELD_B]);

  it('Witness_WhenNoHashRecorded_IsCitationGrade', () => {
    expect(classifyWitnessAgreement(undefined, held)).toBe('citation-grade');
    expect(classifyWitnessAgreement('', held)).toBe('citation-grade');
  });

  it('Witness_WhenHashMatchesAHeldCopy_IsCorroborating', () => {
    expect(classifyWitnessAgreement(HELD_A, held)).toBe('corroborating');
    expect(classifyWitnessAgreement(HELD_B, held)).toBe('corroborating');
  });

  it('Witness_WhenHashMatchesAHeldCopyInDifferentCase_IsCorroborating', () => {
    // The held set and the witness hash are both normalised to lowercase, so a
    // case difference is not a false divergence.
    expect(classifyWitnessAgreement(HELD_A.toUpperCase(), held)).toBe('corroborating');
  });

  it('Witness_WhenHashMatchesNoHeldCopy_IsDivergent', () => {
    expect(classifyWitnessAgreement(UNHELD, held)).toBe('divergent');
  });

  it('Witness_WhenHashMalformed_IsTreatedAsCitationGradeNotDivergent', () => {
    // A malformed token is not a verifiable hash; its shape is reported by the
    // validators, so classification degrades to citation-grade rather than
    // manufacturing a divergence.
    expect(classifyWitnessAgreement('not-a-hash', held)).toBe('citation-grade');
  });
});

describe('normaliseWitnessHash — a hash is 64 lowercase hex characters', { tags: ['unit'] }, () => {
  it('Hash_WhenWellFormedUppercase_NormalisesToLowercase', () => {
    expect(normaliseWitnessHash(HELD_A.toUpperCase())).toBe(HELD_A);
  });

  it('Hash_WhenMalformedOrAbsent_IsUndefined', () => {
    expect(normaliseWitnessHash(undefined)).toBeUndefined();
    expect(normaliseWitnessHash('deadbeef')).toBeUndefined();
    expect(normaliseWitnessHash('g'.repeat(64))).toBeUndefined();
  });
});

describe('divergenceRecordProblems — the divergence record shape', { tags: ['unit'] }, () => {
  const declared = new Set(['held.xlsx', 'divergent--copy.xlsx']);
  const validRecord: DivergenceRecord = {
    file: 'held.xlsx',
    counterpart: { publisher: 'ofcom', url: 'https://example.org/copy.xlsx', sha256: UNHELD },
    level: 'cells',
    summary: 'eleven suffix-month callsigns rendered as date serials',
  };

  it('DivergenceRecord_WhenWellFormed_HasNoProblems', () => {
    expect(divergenceRecordProblems([validRecord], declared)).toEqual([]);
  });

  it('DivergenceRecord_WhenHeldCopyHeldInFull_HeldAsMustNameADeclaredFile', () => {
    const withHeld: DivergenceRecord = { ...validRecord, counterpart: { ...validRecord.counterpart, heldAs: 'divergent--copy.xlsx' } };
    expect(divergenceRecordProblems([withHeld], declared)).toEqual([]);
    const dangling: DivergenceRecord = { ...validRecord, counterpart: { ...validRecord.counterpart, heldAs: 'not-declared.xlsx' } };
    expect(divergenceRecordProblems([dangling], declared).some(p => /heldAs .* does not name a declared file/.test(p))).toBe(true);
  });

  it('DivergenceRecord_WhenFileNotDeclared_Fails', () => {
    const bad: DivergenceRecord = { ...validRecord, file: 'ghost.xlsx' };
    expect(divergenceRecordProblems([bad], declared).some(p => /\.file "ghost.xlsx" does not name a declared file/.test(p))).toBe(true);
  });

  it('DivergenceRecord_WhenLevelNotInVocabulary_Fails', () => {
    const bad = { ...validRecord, level: 'columns' } as unknown as DivergenceRecord;
    expect(divergenceRecordProblems([bad], declared).some(p => /\.level "columns" is not in the vocabulary/.test(p))).toBe(true);
  });

  it('DivergenceRecord_WhenSummaryEmpty_Fails', () => {
    const bad: DivergenceRecord = { ...validRecord, summary: '   ' };
    expect(divergenceRecordProblems([bad], declared).some(p => /\.summary is missing or empty/.test(p))).toBe(true);
  });

  it('DivergenceRecord_WhenCounterpartHashMalformed_Fails', () => {
    const bad: DivergenceRecord = { ...validRecord, counterpart: { ...validRecord.counterpart, sha256: 'short' } };
    expect(divergenceRecordProblems([bad], declared).some(p => /counterpart\.sha256 must be 64 lowercase hex characters/.test(p))).toBe(true);
  });
});

describe('unpairedDivergentWitnessProblems — a divergent witness must be explained', { tags: ['unit'] }, () => {
  const held = heldHashSet([HELD_A]);
  const divergence: DivergenceRecord = {
    file: 'held.xlsx',
    counterpart: { publisher: 'ofcom', url: 'https://example.org/copy.xlsx', sha256: UNHELD },
    level: 'cells',
    summary: 'a differing copy',
  };

  it('DivergentWitness_WhenNoDivergenceRecordExplainsIt_IsAHardFailure', () => {
    const problems = unpairedDivergentWitnessProblems(
      [{ label: 'witnesses[0]', sha256: UNHELD, heldHashes: held }],
      [],
    );
    expect(problems.length).toBe(1);
    expect(problems[0]).toMatch(/matches no held copy \(divergent\) but no divergence record explains it/);
  });

  it('DivergentWitness_WhenPairedWithAMatchingDivergenceRecord_Passes', () => {
    const problems = unpairedDivergentWitnessProblems(
      [{ label: 'witnesses[0]', sha256: UNHELD, heldHashes: held }],
      [divergence],
    );
    expect(problems).toEqual([]);
  });

  it('CorroboratingWitness_WithNoDivergenceRecords_Passes', () => {
    // A corroborating witness never needs a divergence record — the empty set is
    // exactly the increment-3 state before any divergence has been migrated.
    const problems = unpairedDivergentWitnessProblems(
      [{ label: 'witnesses[0]', sha256: HELD_A, heldHashes: held }],
      [],
    );
    expect(problems).toEqual([]);
  });

  it('CitationGradeWitness_WithNoDivergenceRecords_Passes', () => {
    const problems = unpairedDivergentWitnessProblems(
      [{ label: 'witnesses[0]', sha256: undefined, heldHashes: held }],
      [],
    );
    expect(problems).toEqual([]);
  });
});
