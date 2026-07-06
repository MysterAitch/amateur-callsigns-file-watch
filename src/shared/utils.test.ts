import { describe, it, expect } from 'vitest';
import { errorMessage } from './utils';

// Test names follow Subject_Scenario_Outcome per project convention.
//
// errorMessage is the single sanctioned way to get a printable message from a
// caught value - anything can be thrown, so every shape must produce
// something readable rather than crashing the error path itself.

describe('errorMessage', () => {
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
