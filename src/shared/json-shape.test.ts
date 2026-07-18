import { describe, it, expect } from 'vitest';
import { parseJsonObject, parseJsonArray, isPlainObject, describeShape } from './json-shape.ts';

// Test names follow Subject_Scenario_Outcome per project convention.
//
// parseJsonObject/parseJsonArray are the generic parse-boundary readers #812's
// enforcement rule steers every JSON.parse(...) site towards. Their doc
// comment promises a LOCATED error - naming the caller's `path` - on either a
// malformed-JSON failure or a wrong top-level shape; a raw JSON.parse
// SyntaxError does not carry that path, so the malformed-JSON case is
// asserted explicitly here rather than assumed to follow from the shape case.

describe('parseJsonObject', { tags: ['unit'] }, () => {
  it('ParseJsonObject_WhenGivenMalformedJson_ThrowsLocatedErrorNamingThePath', () => {
    expect(() => parseJsonObject('{ broken', 'entry/meta.json')).toThrowError(
      /entry\/meta\.json.*not valid JSON/s,
    );
  });

  it('ParseJsonObject_WhenGivenAWellFormedObject_ReturnsIt', () => {
    expect(parseJsonObject('{"a":1}', 'entry/meta.json')).toEqual({ a: 1 });
  });

  it('ParseJsonObject_WhenGivenJsonNull_ThrowsLocatedErrorNamingThePath', () => {
    expect(() => parseJsonObject('null', 'entry/meta.json')).toThrowError(
      /entry\/meta\.json.*expected a JSON object.*null/s,
    );
  });

  it('ParseJsonObject_WhenGivenAJsonArray_ThrowsLocatedErrorNamingThePath', () => {
    expect(() => parseJsonObject('[]', 'entry/meta.json')).toThrowError(
      /entry\/meta\.json.*expected a JSON object.*an array/s,
    );
  });
});

describe('parseJsonArray', { tags: ['unit'] }, () => {
  it('ParseJsonArray_WhenGivenMalformedJson_ThrowsLocatedErrorNamingThePath', () => {
    expect(() => parseJsonArray('[ broken', 'entry/list.json')).toThrowError(
      /entry\/list\.json.*not valid JSON/s,
    );
  });

  it('ParseJsonArray_WhenGivenAWellFormedArray_ReturnsIt', () => {
    expect(parseJsonArray('[1,2,3]', 'entry/list.json')).toEqual([1, 2, 3]);
  });

  it('ParseJsonArray_WhenGivenAJsonObject_ThrowsLocatedErrorNamingThePath', () => {
    expect(() => parseJsonArray('{}', 'entry/list.json')).toThrowError(
      /entry\/list\.json.*expected a JSON array.*object/s,
    );
  });
});

describe('isPlainObject', { tags: ['unit'] }, () => {
  it('IsPlainObject_WhenGivenAPlainObject_ReturnsTrue', () => {
    expect(isPlainObject({})).toBe(true);
  });

  it('IsPlainObject_WhenGivenNullOrAnArray_ReturnsFalse', () => {
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject([])).toBe(false);
  });
});

describe('describeShape', { tags: ['unit'] }, () => {
  it('DescribeShape_WhenGivenNullOrAnArrayOrAPrimitive_NamesTheShape', () => {
    expect(describeShape(null)).toBe('null');
    expect(describeShape([])).toBe('an array');
    expect(describeShape('x')).toBe('string');
  });
});
