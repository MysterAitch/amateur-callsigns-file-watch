// Name the ITU-allocated holder of a visitor call sign's international series.
//
// Source: ITU Appendix 42 (Table of allocation of international call sign
// series), distilled to reference-data/itu-call-sign-series.csv and loaded
// into the published database's itu_series table. DOM-free and dependency-free
// so it is unit-testable in node and shared by whichever surface renders it.
//
// The table is a list of three-character series RANGES, each pinning the first
// TWO characters and spanning the third A-Z ("EIA - EIZ" and "EJA - EJZ" ->
// Ireland; "NAA - NAZ" -> United States of America). A handful of blocks are
// split on the third LETTER ("3DA - 3DM" -> Eswatini, "3DN - 3DZ" -> Fiji).
//
// Resolution is a longest-prefix match: strip the UK visitor prefix (M[A-Z]?/),
// take the home call's leading prefix, and match it against the most SPECIFIC
// series range it falls within. This names who HOLDS the call sign series - a
// declared allocation, not a verified claim about the operator's own licence.

// The UK visitor/reciprocal prefix: M, an optional Regional Secondary Locator
// letter (M/ England, MM/ Scotland, MW/ Wales, MI/ NI, MD/ Isle of Man, ...),
// then a slash. The home call follows.
const VISITOR_PREFIX = /^M[A-Z]?\//i;

// Strip the UK visitor prefix from a call sign, leaving the foreign home call.
// A call sign without the prefix (e.g. a home call passed in directly) is
// returned unchanged. Only the leading M[A-Z]?/ is removed - a later slash
// (a portable/mobile suffix) is left for the caller/prefix extractor.
export function stripVisitorPrefix(callsign) {
  const s = String(callsign ?? '').trim();
  const m = VISITOR_PREFIX.exec(s);
  return m ? s.slice(m[0].length) : s;
}

// Parse one "XAA - XAZ" series cell into { start, end }; null if malformed.
export function parseSeries(text) {
  const m = /^\s*([A-Za-z0-9]+)\s*-\s*([A-Za-z0-9]+)\s*$/.exec(String(text ?? ''));
  return m ? { start: m[1].toUpperCase(), end: m[2].toUpperCase() } : null;
}

// Length of the shared leading run of two strings - how tightly a range pins
// its call signs, and so how specific a match against it is.
function commonPrefixLength(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  return i;
}

function distinct(values) {
  return [...new Set(values)];
}

// Resolve the ITU-allocated holder of a call sign's series.
//
// `callsign` may carry the UK visitor prefix (M/EI8DJ) or be a bare home call
// (EI8DJ). `rows` is the itu_series table as { series, allocated_to } objects
// (the full table, or any superset of the rows sharing the call's first
// character). Returns a structured result - never throws, never guesses:
//
//   { status: 'resolved',    country, series, basis, home, visitorPrefix, ... }
//   { status: 'ambiguous',   candidates: [{ series, country }], basis, ... }
//   { status: 'unallocated', ... }   first character maps to no ITU series
//   { status: 'malformed',   ... }   no usable prefix could be derived
export function countryForCallsign(callsign, rows) {
  const input = String(callsign ?? '');
  const home = stripVisitorPrefix(input);
  const visitorPrefix = input.trim().slice(0, input.trim().length - home.length);
  // The prefix lives before any portable/mobile slash; keep letters and digits.
  const cleaned = home.split('/')[0].replace(/[^A-Za-z0-9]/g, '').toUpperCase();

  const base = { input, home, visitorPrefix, cleaned, country: null, series: null, candidates: [] };
  const malformed = (message) => ({ ...base, status: 'malformed', basis: message });
  const unallocated = (message) => ({ ...base, status: 'unallocated', basis: message });
  const resolved = (country, series, basis) => ({ ...base, status: 'resolved', country, series, basis });
  const ambiguous = (candidates, basis) => ({ ...base, status: 'ambiguous', candidates, basis });

  if (cleaned.length === 0) {
    return malformed(`"${input}" has no letters or digits to derive an ITU prefix from.`);
  }

  const first = cleaned[0];
  const ranges = (rows ?? [])
    .map((r) => ({ ...parseSeries(r.series), country: r.allocated_to, series: r.series }))
    .filter((r) => r.start !== undefined && r.start[0] === first);
  if (ranges.length === 0) {
    return unallocated(`"${cleaned}" begins with a prefix outside the ITU call-sign series table.`);
  }

  // Single-letter prefix (a digit in the second position, e.g. W1AW, G0ICN):
  // the call belongs to the whole first-character block. One holder names it;
  // a split block is listed honestly rather than guessed.
  if (/[0-9]/.test(cleaned[1] ?? '')) {
    const countries = distinct(ranges.map((r) => r.country));
    if (countries.length === 1) return resolved(countries[0], null, `single-letter ${first} prefix (whole ${first} block)`);
    return ambiguous(ranges.map((r) => ({ series: r.series, country: r.country })), `whole ${first} block is split between allocations`);
  }

  // A letter in the third position gives a full three-character key, so the
  // most SPECIFIC containing range wins (longest-prefix match). This resolves
  // split blocks whose third letter disambiguates them (3DM -> Eswatini,
  // 3DN -> Fiji).
  if (/[A-Z]/.test(cleaned[2] ?? '')) {
    const code = cleaned.slice(0, 3);
    const hits = ranges.filter((r) => code >= r.start && code <= r.end);
    if (hits.length > 0) {
      const specificity = (r) => commonPrefixLength(r.start, r.end);
      const maxSpec = Math.max(...hits.map(specificity));
      const best = hits.filter((r) => specificity(r) === maxSpec);
      const countries = distinct(best.map((r) => r.country));
      if (countries.length === 1) return resolved(countries[0], best[0].series, `series ${best[0].series}`);
      return ambiguous(best.map((r) => ({ series: r.series, country: r.country })), `series ${code} spans more than one allocation`);
    }
    // No containing range for a letter key: fall through to the two-character
    // block test, which may still place it.
  }

  // Two-character block (a digit in the third position, e.g. EI8DJ, 3D2AB, or
  // a prefix shorter than three characters): the third-position sub-range
  // cannot be consulted, so only the two-character block can. One holder names
  // it; a split block (3D: Eswatini/Fiji) is listed honestly.
  const first2 = cleaned.slice(0, 2);
  const block = ranges.filter((r) => r.start.slice(0, 2) <= first2 && first2 <= r.end.slice(0, 2));
  if (block.length === 0) {
    return unallocated(`"${cleaned}" does not fall in any ITU series for the ${first} block.`);
  }
  const blockCountries = distinct(block.map((r) => r.country));
  if (blockCountries.length === 1) {
    const single = distinct(block.map((r) => r.series));
    return resolved(blockCountries[0], single.length === 1 ? single[0] : null, `${first2} block`);
  }
  return ambiguous(block.map((r) => ({ series: r.series, country: r.country })), `${first2} block is split between allocations - the series table alone cannot name the country`);
}
