/**
 * The T1 parse-derived attribute tier for the v2 claim ledger (issue #406).
 *
 * Beside the verbatim raw layer, the ledger carries the per-callsign attributes
 * parseCallsign COMPUTES from the raw token - its prefix series, implied station
 * class, parse status, RSL, and each data-quality flag - so entity-level report
 * fields can fold from the ledger (each later with its own equivalence oracle,
 * like the licence-category tier). The parse output is CONSUMED here, never
 * re-derived: the whole tier is a projection of parseCallsign
 * (src/sources/ofcom-amateur/components.ts) into rule-attributed derived claims,
 * so any change to what a callsign parses to is owned by components.ts alone.
 *
 *   - prefix_series : the join key into prefix-formats.csv ('M7', 'G0', '20',
 *                     'GB'), emitted only when the parse resolved one.
 *   - implied_class : the station level the prefix series implies ('Foundation',
 *                     'Full', ...), emitted only when the series is known.
 *   - parse_status  : the parser's synthesised determination of the token's
 *                     callsign formation ('parsed' / 'visitor' / 'special-event'
 *                     / 'unparseable'), present for every non-empty token.
 *   - flag          : one claim per raised flag, the closed data-quality
 *                     vocabulary (reference-data/flags.md); its OBJECT is the
 *                     flag name, so a report folds "callsigns carrying flag X"
 *                     by object rather than by a per-flag predicate.
 *   - rsl           : the Regional Secondary Locator letter the parse split out
 *                     of the token (the 'W' in MW7TEE, the country letter in a
 *                     MW/-visitor call), emitted only where the parse resolved a
 *                     non-empty one - an RSL-less core call (M7TEE) or a token
 *                     that carries no RSL slot (GB special-event) yields none.
 *                     Unblocks the regional-identifiers fold (#422).
 */

import { parseCallsign, type ReferenceData } from '../sources/ofcom-amateur/components.ts';
import { FLAG_PREDICATE, type Claim, type SourceObservationSet } from './claim.ts';
import { provenanceFor } from './provenance.ts';

export const PREFIX_SERIES_PREDICATE = 'prefix_series';
export const IMPLIED_CLASS_PREDICATE = 'implied_class';
export const PARSE_STATUS_PREDICATE = 'parse_status';
export const RSL_PREDICATE = 'rsl';

// The one named rule attributing every parse-derived claim to parseCallsign
// (components.ts). A SINGLE rule - not one per attribute - because one
// deterministic computation produces prefix series, implied class, parse status
// and flags together from the same parse; naming it keeps the tier's production
// method a COMPUTATION (never a reference-table lookup, so it reads out Computed,
// never As-published) and its rule set enumerable beside the normalisation and
// licence-category rules.
export const PARSE_CALLSIGN_RULE = 'parse-callsign';

// The DERIVED T1 parse-attribute claims for a source (issue #406): for each
// observation whose raw subject is a callsign token, the per-callsign attributes
// parseCallsign COMPUTES — its prefix series, implied class, parse status and
// each raised flag — projected into rule-attributed derived claims. The parse is
// LIFTED whole from components.ts and CONSUMED here, never re-derived; the token
// is parsed WITH the source's disclosed product (source.categoryColumn) so a
// class-vs-product mismatch the parser detects rides as a real flag claim rather
// than being invisible, and WITH the source's disclosed original start date
// (source.originalStartDateColumn) so the temporal
// forbidden-suffix-issued-after-first-known-list flag - which parseCallsign
// already computes from that date and the per-suffix first-known-forbidden
// reference - rides too. Both extra flags join parsed.flags under the ONE
// parse-callsign rule; no new predicate or rule is introduced for them.
//
// The tier NEVER invents: a claim rides only where the parse actually yields a
// value. parse_status is the sole always-present attribute (every non-empty
// token resolves to one determination), so it is emitted for every observation;
// prefix_series, implied_class and rsl emit only when the parse resolved one (a
// visitor or unparseable token yields neither series nor class; an RSL-less core
// call or a GB special-event token yields no rsl), and a flag claim only for a
// flag actually raised. An empty subject (an all-blank anchor row) yields
// nothing, mirroring how the normalisation edges skip it — there is no callsign
// to parse.
export function emitParseAttributeClaims(source: SourceObservationSet, ref: ReferenceData): Claim[] {
  const claims: Claim[] = [];
  const productColumn = source.categoryColumn;
  const startDateColumn = source.originalStartDateColumn;
  source.rows.forEach((row, ordinal) => {
    const rawSubject = row[source.subjectColumn] ?? '';
    if (rawSubject === '') return;
    const product = productColumn !== undefined ? (row[productColumn] ?? '') : '';
    // The RAW original-start-date cell (verbatim, under Ofcom's own header) is
    // passed as parseCallsign's fourth argument so the temporal
    // forbidden-suffix-issued-after-first-known-list flag can fire; a source
    // that discloses no such column passes '' and the parser withholds the flag.
    const originalStartDate = startDateColumn !== undefined ? (row[startDateColumn] ?? '') : '';
    const parsed = parseCallsign(rawSubject, product, ref, originalStartDate);
    const provenance = provenanceFor(source, ordinal);
    const emit = (predicate: string, object: string): void => {
      claims.push({ layer: 'derived', rawSubject, predicate, object, provenance, rule: PARSE_CALLSIGN_RULE });
    };
    emit(PARSE_STATUS_PREDICATE, parsed.parseStatus);
    if (parsed.prefixSeries !== '') emit(PREFIX_SERIES_PREDICATE, parsed.prefixSeries);
    if (parsed.impliedClass !== '') emit(IMPLIED_CLASS_PREDICATE, parsed.impliedClass);
    if (parsed.rsl !== '') emit(RSL_PREDICATE, parsed.rsl);
    for (const flag of parsed.flags) emit(FLAG_PREDICATE, flag);
  });
  return claims;
}
