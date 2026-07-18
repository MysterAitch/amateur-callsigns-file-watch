import { describe, it, expect } from 'vitest';
import { numberOrUndefined, requireNumber } from './parse-number.ts';

// Test names follow Subject_Scenario_Outcome per project convention.
//
// These two are the parse boundary for external numerics (#812): the failure
// mode they exist to close is a bare `Number(raw)`/`parseInt(raw, 10)`
// silently returning NaN for a malformed value, which then slips past a
// `!== undefined` filter and poisons whatever consumes it with no error
// anywhere (#816's vintageYear defect was exactly this shape).

describe('numberOrUndefined', { tags: ['unit'] }, () => {
  it('NumberOrUndefined_WhenGivenAWellFormedNonNegativeInteger_ReturnsTheNumber', () => {
    expect(numberOrUndefined('42')).toBe(42);
    expect(numberOrUndefined('0')).toBe(0);
  });

  it('NumberOrUndefined_WhenGivenNonNumericText_ReturnsUndefinedNotNaN', () => {
    // The load-bearing assertion: `Number('various')` is NaN, and NaN would
    // pass a naive `!== undefined` filter silently. undefined is caught.
    const result = numberOrUndefined('various');
    expect(result).toBeUndefined();
    expect(Number.isNaN(result)).toBe(false);
  });

  it('NumberOrUndefined_WhenGivenAnEmptyString_ReturnsUndefined', () => {
    expect(numberOrUndefined('')).toBeUndefined();
  });

  it('NumberOrUndefined_WhenGivenADecimalOrSignedOrCommaSeparatedValue_ReturnsUndefined', () => {
    // Deliberately stricter than Number(): a caller that wants to tolerate
    // any of these must normalise first, rather than have it happen silently.
    expect(numberOrUndefined('4.2')).toBeUndefined();
    expect(numberOrUndefined('-1')).toBeUndefined();
    expect(numberOrUndefined('1,234')).toBeUndefined();
    expect(numberOrUndefined(' 42 ')).toBeUndefined();
  });
});

describe('requireNumber', { tags: ['unit'] }, () => {
  it('RequireNumber_WhenGivenAWellFormedNonNegativeInteger_ReturnsTheNumber', () => {
    expect(requireNumber('123', { field: 'recordCount', file: 'stats.json' })).toBe(123);
  });

  it('RequireNumber_WhenGivenNonNumericText_ThrowsNamingTheFieldAndFile', () => {
    expect(() => requireNumber('various', { field: 'recordCount', file: 'stats.json' }))
      .toThrow(/stats\.json.*recordCount.*various/s);
  });
});
