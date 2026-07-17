// @ts-check
// Edge presentation of an ITU call-sign-series allocation: turn a stored ISO
// 3166-1 alpha-2 code into a flag glyph, and word the allocation strictly by
// its HOLDER.
//
// Canonical-at-rest, presentation-at-edge: the reference data
// (reference-data/itu-entity-iso.csv, loaded into the ref_entity_iso table)
// stores only the two-letter code; the flag emoji is the Unicode Regional
// Indicator composition of that code, computed here at render time and never
// stored - so the data at rest stays plain codepoints and the friendly glyph
// lives at the edge. DOM-free and dependency-free so it is unit-testable and
// shared by whichever surface renders it.
//
// Framing rule (issue #201): the accurate claim is about the SERIES, not the
// person. An allocation names the administration that HOLDS the international
// call-sign series - a state, territory or organisation - and says nothing
// about the operator's own nationality, residence or licence. Every string
// here is issuer-attributed ("allocated to <entity>") and neutral.

// 'A' -> U+1F1E6, the first Regional Indicator Symbol; a flag is two of them.
const REGIONAL_INDICATOR_A = 0x1f1e6;
const LETTER_A = 'A'.charCodeAt(0);

// Compose the flag emoji for an ISO 3166-1 alpha-2 code. An empty or
// non-conforming code yields '' - international organisations (United Nations,
// ICAO, WMO) hold call-sign series but have no national flag, and unmapped or
// malformed codes must never be rendered as a wrong or placeholder glyph.
/** @param {unknown} alpha2 */
export function flagEmoji(alpha2) {
  // eslint-disable-next-line @typescript-eslint/no-base-to-string -- `alpha2` is deliberately `unknown` at this public boundary; a non-primitive falls back to its default stringification rather than throwing.
  const code = String(alpha2 ?? '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return '';
  return String.fromCodePoint(
    REGIONAL_INDICATOR_A + (code.charCodeAt(0) - LETTER_A),
    REGIONAL_INDICATOR_A + (code.charCodeAt(1) - LETTER_A),
  );
}

// The standing epistemic line shown wherever an allocation renders: a best-effort
// derivation from the ITU reference table, naming the SERIES holder - never a
// register assertion about the operator.
export const ALLOCATION_ATTRIBUTION =
  'This names the ITU-allocated holder of the call sign series, not the operator’s '
  + 'nationality nor a verified claim about their licence. '
  + 'Source: ITU Radio Regulations, Appendix 42 (Table of allocation of international call sign series).';

// One resolved allocation, ready to word. `series` is the matched series cell
// (e.g. "EIA - EJZ") when a single one is known, or null when only the wider
// block resolves.
/** @typedef {{ cleaned: string, country: string, series: string | null }} ResolvedAllocation */

// Word a resolved allocation, issuer-attributed. `flag` is the (possibly empty)
// glyph from flagEmoji; an empty flag simply renders no glyph, with no stray
// leading space.
/**
 * @param {ResolvedAllocation} res
 * @param {string} flag
 */
export function allocationHeadline(res, flag) {
  const lead = flag ? `${flag} ` : '';
  const inSeries = res.series
    ? `falls in call sign series ${res.series}, allocated to ${res.country}`
    : `falls in a call sign series allocated to ${res.country}`;
  return `${lead}${res.cleaned} ${inSeries} (ITU Appendix 42).`;
}
