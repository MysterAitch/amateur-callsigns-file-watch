import { describe, it, expect } from 'vitest';
import { sampleIndices, forEachSampled, assertNonEmpty } from './non-vacuity.ts';

// Test names follow the project's Subject_Scenario_Outcome convention.
//
// The non-vacuity guard for sampled test loops (issue #977). The property under
// test is negative as much as positive: a sample drawn from an EMPTY collection
// must fail loudly, naming the collection, rather than silently yielding an
// empty result that a caller's `for` loop would iterate zero times over -
// passing green having asserted nothing.

describe('sampleIndices refuses to sample from an empty collection', { tags: ['unit'] }, () => {
  it('SampleIndices_WhenCollectionIsEmpty_ThrowsRatherThanReturningAnEmptySample', () => {
    expect(() => sampleIndices(0, 200)).toThrow();
  });

  it('SampleIndices_WhenCollectionIsEmpty_NamesTheCollectionInTheFailureMessage', () => {
    expect(() => sampleIndices(0, 200, 'ordinals for source XYZ')).toThrow(/ordinals for source XYZ/);
  });

  it('SampleIndices_WhenCollectionIsEmpty_UsesAGenericLabelIfNoneGiven', () => {
    expect(() => sampleIndices(0, 200)).toThrow(/collection/);
  });
});

describe('sampleIndices samples a non-empty collection evenly', { tags: ['unit'] }, () => {
  it('SampleIndices_WhenCollectionSmallerThanCap_ReturnsEveryIndex', () => {
    expect(sampleIndices(5, 200)).toEqual([0, 1, 2, 3, 4]);
  });

  it('SampleIndices_WhenCollectionLargerThanCap_ReturnsExactlyTheCapAndSpansFirstToLast', () => {
    const sample = sampleIndices(10_000, 50);
    expect(sample).toHaveLength(50);
    expect(sample[0]).toBe(0);
    expect(sample[sample.length - 1]).toBe(9_999);
    // Strictly increasing - no repeated ordinal masquerading as coverage.
    for (let i = 1; i < sample.length; i++) expect(sample[i]).toBeGreaterThan(sample[i - 1]);
  });

  it('SampleIndices_WhenCollectionHasExactlyOneItem_ReturnsThatSingleIndexOnce', () => {
    // The aside noted in issue #977: a naive step-based sampler can divide by
    // (maxSamples - 1) and, for a single-item collection, return the cap's-worth
    // of copies of index 0 rather than genuinely sampling once. A single-row
    // source must be checked once, not "200 times" while reading as 200 samples.
    expect(sampleIndices(1, 200)).toEqual([0]);
  });

  it('SampleIndices_WhenMaxSamplesIsOne_ReturnsASingleIndexRatherThanDividingByZero', () => {
    // maxSamples - 1 = 0 is the same degenerate-step hazard from the other
    // direction; it must resolve to one real sample, never NaN/Infinity.
    const sample = sampleIndices(10_000, 1);
    expect(sample).toEqual([0]);
    expect(Number.isFinite(sample[0])).toBe(true);
  });
});

describe('forEachSampled', { tags: ['unit'] }, () => {
  it('ForEachSampled_WhenItemsIsEmpty_ThrowsRatherThanSilentlySkippingTheCallback', () => {
    const seen: string[] = [];
    expect(() => forEachSampled([] as string[], 200, item => seen.push(item), 'widget list')).toThrow(/widget list/);
    expect(seen).toEqual([]);
  });

  it('ForEachSampled_WhenItemsIsNonEmpty_InvokesTheCallbackForEverySampledItem', () => {
    const items = Array.from({ length: 1_000 }, (_, i) => `item-${i}`);
    const seen: string[] = [];
    forEachSampled(items, 20, item => seen.push(item));
    expect(seen.length).toBe(20);
    expect(seen[0]).toBe('item-0');
    expect(seen[seen.length - 1]).toBe('item-999');
  });
});

describe('assertNonEmpty', { tags: ['unit'] }, () => {
  it('AssertNonEmpty_WhenCollectionIsEmpty_ThrowsNamingTheCollection', () => {
    expect(() => assertNonEmpty([] as string[], 'itu_series holders')).toThrow(/itu_series holders/);
  });

  it('AssertNonEmpty_WhenCollectionIsEmpty_UsesAGenericLabelIfNoneGiven', () => {
    expect(() => assertNonEmpty([])).toThrow(/collection/);
  });

  it('AssertNonEmpty_WhenCollectionIsNonEmpty_ReturnsItUnchangedForInlineUse', () => {
    const items = ['a', 'b', 'c'];
    expect(assertNonEmpty(items)).toBe(items);
  });
});
