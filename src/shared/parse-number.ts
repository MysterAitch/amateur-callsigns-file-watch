/**
 * The parse boundary for EXTERNAL numerics (issue #812), a companion to
 * json-shape.ts's JSON-parse-boundary guards. `Number(raw)` and `parseInt(raw,
 * 10)` both silently return NaN for a malformed value ("various", "", a stray
 * comma) rather than failing - and NaN is not caught by a `!== undefined`
 * filter, so it goes on to poison a sum, a Math.min/Math.max, or a comparison
 * with no error anywhere (the class of defect #816 fixed one instance of:
 * `Number(vintage.slice(0, 4))` on a non-ISO vintage silently blanked the
 * front door's whole year-grouped holdings map). These two helpers are the
 * sanctioned way to turn an external string into a number at the boundary: a
 * malformed value becomes a located failure (requireNumber) or an honest
 * `undefined` that a normal `!== undefined` filter actually catches
 * (numberOrUndefined), never a silent NaN.
 *
 * Deliberately NOT a lint rule: unlike the JSON.parse boundary, the ~59
 * `Number()`/`parseInt` call sites surveyed for #812 are overwhelmingly benign
 * (array indices, already-validated digits, arithmetic on values with no
 * external-input path) - banning the bare form everywhere would be noisy for
 * negligible gain. This module is the convention for the sites that DO parse
 * untrusted external input; adoption is by judgement, not enforcement.
 */

// A non-negative integer string ("42", "0"), or undefined for anything else -
// including a NaN-producing malformed value, so a normal `!== undefined`
// filter actually excludes it (NaN famously does not). Deliberately stricter
// than `Number()`: no leading/trailing whitespace, no sign, no decimal point,
// no thousands separator - callers that need to tolerate any of those must
// strip/normalise before calling, an explicit decision rather than a silent
// default.
export function numberOrUndefined(raw: string): number | undefined {
  return /^\d+$/.test(raw) ? Number(raw) : undefined;
}

// The throwing counterpart: a non-numeric `raw` is a located, named failure
// (which field, in which file) rather than a NaN that surfaces symptoms far
// from its cause.
export function requireNumber(raw: string, ctx: { field: string; file: string }): number {
  const parsed = numberOrUndefined(raw);
  if (parsed === undefined) {
    throw new Error(`${ctx.file}: ${ctx.field} is not a well-formed non-negative integer: "${raw}"`);
  }
  return parsed;
}
