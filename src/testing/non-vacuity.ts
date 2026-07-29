/**
 * Non-vacuity guards for suites that assert per-item invariants over a
 * collection derived from real data (issue #977).
 *
 * Sampling real data deliberately is correct - re-checking every one of a
 * source's ~160k rows on every run buys little and costs minutes of CI, and
 * pinning an exact derived total is correct too, since it fails loudly on
 * drift. The defect this guards against is narrower: a test whose assertions
 * live entirely inside a loop over such a collection (sampled or otherwise),
 * with nothing asserting the collection is non-empty. If it is ever empty - a
 * loader change, a filter that stops matching, a schema rename - the loop body
 * never runs, the test passes green having asserted nothing, and the surface
 * it was meant to guard is silently unprotected from that moment on.
 *
 * `sampleIndices`, `forEachSampled` and `assertNonEmpty` refuse an empty
 * collection themselves, so the non-vacuity property is enforced once, here,
 * rather than remembered by every author at every new call site.
 */

// Evenly-spread ordinals across `count` items, always including the first and
// last, capped at `maxSamples`. Throws if `count` is zero rather than
// returning `[]` - a caller that loops over the result can never do so zero
// times while believing it sampled something.
export function sampleIndices(count: number, maxSamples: number, label = 'collection'): number[] {
  if (count === 0) {
    throw new Error(
      `sampleIndices: ${label} is empty - refusing to sample zero items (a loop over this result would assert nothing and pass regardless)`,
    );
  }
  const cappedSamples = Math.min(count, Math.max(maxSamples, 1));
  // A cap of exactly one sample has no "step" to compute (the step formula
  // below divides by cappedSamples - 1 = 0, yielding Infinity/NaN); the first
  // item is the only sensible single sample.
  if (cappedSamples <= 1) return [0];
  if (count <= cappedSamples) return Array.from({ length: count }, (_, i) => i);
  const step = (count - 1) / (cappedSamples - 1);
  return Array.from({ length: cappedSamples }, (_, i) => Math.round(i * step));
}

// Runs `fn` over an evenly-spread sample of `items` (or all of them, if
// `items.length <= maxSamples`). Throws if `items` is empty - see module
// comment. This is the shape issue #977 recommends: the guard travels with the
// iteration itself, so a new call site cannot forget it.
export function forEachSampled<T>(items: readonly T[], maxSamples: number, fn: (item: T, index: number) => void, label = 'items'): void {
  for (const index of sampleIndices(items.length, maxSamples, label)) {
    fn(items[index], index);
  }
}

// The un-sampled sibling: for a test that loops over an ENTIRE real-data
// collection (no sampling involved), asserts it is non-empty and returns it
// unchanged, so the assertion can sit inline at the top of a `for` loop's
// source expression rather than as a separate statement a future edit could
// drift away from the loop it guards.
export function assertNonEmpty<A extends readonly unknown[]>(items: A, label = 'collection'): A {
  if (items.length === 0) {
    throw new Error(`assertNonEmpty: ${label} is empty - refusing to let a loop over it pass having asserted nothing`);
  }
  return items;
}
