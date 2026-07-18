/**
 * Parse-boundary shape guards (#812): a validator's contract is to LOCATE
 * malformation in untrusted JSON it did not author, never to crash on it. A
 * `... as SomeType` assertion right after JSON.parse is exactly what lets
 * tsc/lint stay silent while a null, a string, or a stray array reaches a
 * field access and throws - these run BEFORE that access, on a value still
 * typed `unknown` (or, for a value whose static type already claims a shape
 * it cannot verify, defensively re-checked at runtime anyway).
 *
 * Dependency-free by design: this module has NO import, runtime or
 * type-only, from any validator entrypoint. validate-data.ts, validate-foi.ts
 * and validate-publishers.ts all import from here rather than from one
 * another - validate-data.ts imports the validator entrypoints
 * validatePublishersAt/validateFoiLaneAt from those two modules, so having
 * them import these helpers BACK from validate-data.ts would be a circular
 * ESM dependency. `ValidationProblem` lives here rather than in
 * validate-data.ts for exactly that reason: even a type-only import back
 * from this module to validate-data.ts still shows up as a cycle edge to
 * import-graph tooling (`npx madge --circular`), which does not distinguish
 * type-only from value imports when walking TypeScript's import syntax -
 * validate-data.ts re-exports it so every existing `from './validate-data.ts'`
 * import keeps working unchanged. shared/ is also the right home because the
 * upcoming enforcement work on the residual `JSON.parse ... as` sites
 * elsewhere in the codebase will reuse these helpers too.
 */

export interface ValidationProblem {
  path: string;
  problem: string;
}

// Deliberately NOT a type predicate: narrowing to `Record<string, unknown>`
// would make a subsequent `as ArchiveMeta`/`as FoiEntryMeta`/`as PublisherRegister`
// fail tsc's insufficient-overlap check (those interfaces have several required
// fields Record<string, unknown> cannot be seen to satisfy) - callers keep the
// parsed value typed `unknown` through this check, exactly like the direct
// `JSON.parse(...) as SomeType` it replaces, but only after this runtime check
// has actually confirmed it is a non-null, non-array object.
export function isPlainObject(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function describeShape(value: unknown): string {
  return value === null ? 'null' : Array.isArray(value) ? 'an array' : typeof value;
}

// Returns `value` as an array when it already is one; otherwise records a
// located problem and returns an empty array, so the caller's per-item loop
// degrades to a no-op rather than throwing on a coerced non-iterable value -
// `??` does not catch a truthy non-array (a string, say), so a naive
// `(value ?? []).entries()` still throws on exactly the malformed input this
// guard exists to report.
export function arrayOrProblem<T>(value: unknown, field: string, path: string, problems: ValidationProblem[]): readonly T[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    problems.push({ path, problem: `${field} must be an array, got ${describeShape(value)}` });
    return [];
  }
  return value as T[];
}

// The generic read-site counterpart to readFoiEntryMeta: most parse-boundary
// sites in this codebase have no bespoke validator of their own (they are a
// direct `fs.readFileSync` + `JSON.parse`, historically finished off with an
// `as SomeType` the #812 lint rule now forbids). These two throw a located
// error naming `path` on malformed JSON or the wrong top-level shape, and
// otherwise return the parsed value still typed `unknown` - exactly like
// isPlainObject above, deliberately NOT narrowing to `Record<string, unknown>`,
// so the caller's own `as SomeType` cast (now applied to `unknown`, not to a
// bare `JSON.parse(...)` call) is unconditionally sound as far as tsc is
// concerned, and is the "earned" cast this module's helpers exist to enable.
export function parseJsonObject(raw: string, path: string): unknown {
  const parsed: unknown = JSON.parse(raw);
  if (!isPlainObject(parsed)) {
    throw new Error(`${path}: expected a JSON object, got ${describeShape(parsed)}`);
  }
  return parsed;
}

export function parseJsonArray(raw: string, path: string): unknown {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`${path}: expected a JSON array, got ${describeShape(parsed)}`);
  }
  return parsed;
}
