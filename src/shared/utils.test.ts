import { describe, it, expect } from 'vitest';
import { errorMessage, verifyIgnoredColumn } from './utils.ts';

// Test names follow Subject_Scenario_Outcome per project convention.
//
// errorMessage is the single sanctioned way to get a printable message from a
// caught value - anything can be thrown, so every shape must produce
// something readable rather than crashing the error path itself.

describe('errorMessage', { tags: ['unit'] }, () => {
  it('ErrorMessage_WhenErrorInstance_ReturnsItsMessage', () => {
    expect(errorMessage(new Error('disk full'))).toBe('disk full');
  });

  it('ErrorMessage_WhenErrorSubclass_ReturnsItsMessage', () => {
    expect(errorMessage(new RangeError('out of range'))).toBe('out of range');
  });

  it('ErrorMessage_WhenStringThrown_ReturnsTheString', () => {
    expect(errorMessage('plain string throw')).toBe('plain string throw');
  });

  it('ErrorMessage_WhenNonErrorObjectThrown_StringifiesWithoutCrashing', () => {
    expect(errorMessage({ code: 'ENOENT' })).toBe('[object Object]');
  });

  it('ErrorMessage_WhenNullOrUndefinedThrown_StringifiesWithoutCrashing', () => {
    expect(errorMessage(null)).toBe('null');
    expect(errorMessage(undefined)).toBe('undefined');
  });
});

// verifyIgnoredColumn (issue #577) is the shared enforcement both the FOI
// lane and the open-data lane's converters call for every column they
// deliberately do not carry - a column silently starting to carry data, or a
// "constant" silently starting to vary, must fail loudly rather than
// disappear without a trace. Exercised here in isolation, independent of
// either lane's converter machinery.
describe('verifyIgnoredColumn', { tags: ['unit'] }, () => {
  it('VerifyIgnoredColumn_WhenDeclaredEmptyAndEveryRowIsBlank_DoesNotThrow', () => {
    const records = [{ callsign: 'M0IVB', spare: '' }, { callsign: 'M7TEE', spare: '' }];
    expect(() => verifyIgnoredColumn({ column: 'spare', verification: { kind: 'empty' } }, records, 'source.csv')).not.toThrow();
  });

  it('VerifyIgnoredColumn_WhenDeclaredEmptyButARowCarriesAValue_ThrowsNamingColumnAndRow', () => {
    const records = [{ callsign: 'M0IVB', spare: '' }, { callsign: 'M7TEE', spare: 'surprise' }];
    expect(() => verifyIgnoredColumn({ column: 'spare', verification: { kind: 'empty' } }, records, 'source.csv'))
      .toThrow(/source\.csv.*"spare".*declared empty.*data row 2.*"surprise"/);
  });

  it('VerifyIgnoredColumn_WhenDeclaredConstantAndEveryRowMatches_DoesNotThrow', () => {
    const records = [{ callsign: 'M0IVB', kind: 'Amateur' }, { callsign: 'M7TEE', kind: 'Amateur' }];
    expect(() => verifyIgnoredColumn({ column: 'kind', verification: { kind: 'constant', value: 'Amateur' } }, records, 'source.csv')).not.toThrow();
  });

  it('VerifyIgnoredColumn_WhenDeclaredConstantButARowDiffers_ThrowsNamingColumnAndRow', () => {
    const records = [{ callsign: 'M0IVB', kind: 'Amateur' }, { callsign: 'M7TEE', kind: 'Business' }];
    expect(() => verifyIgnoredColumn({ column: 'kind', verification: { kind: 'constant', value: 'Amateur' } }, records, 'source.csv'))
      .toThrow(/source\.csv.*"kind".*declared constant "Amateur".*data row 2.*"Business"/);
  });

  it('VerifyIgnoredColumn_WhenDeclaredContentBearing_NeverThrowsRegardlessOfValues', () => {
    const records = [{ callsign: 'M0IVB', notes: 'anything' }, { callsign: 'M7TEE', notes: '' }, { callsign: 'G4ABC', notes: 'something else entirely' }];
    expect(() => verifyIgnoredColumn({ column: 'notes', verification: { kind: 'content-bearing', note: 'positional provenance' } }, records, 'source.csv')).not.toThrow();
  });

  it('VerifyIgnoredColumn_WhenColumnMissingFromARecord_TreatedAsEmptyNotACrash', () => {
    const records = [{ callsign: 'M0IVB' }];
    expect(() => verifyIgnoredColumn({ column: 'spare', verification: { kind: 'empty' } }, records, 'source.csv')).not.toThrow();
  });
});
