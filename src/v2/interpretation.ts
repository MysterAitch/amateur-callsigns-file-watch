/**
 * Attested column interpretation (issue #435, ADR 0018) - the DERIVED twin of
 * the #434 file-level manifest.
 *
 * The manifest attests each column's verbatim as-published HEADER (@column/<i>,
 * raw, As-published - a header string IS a source byte). This module attests our
 * INTERPRETATION of that column: the inferred {type, format} we read the column
 * under (a date column's DD/MM/YYYY vs YYYY-MM-DD, a thousands-separated integer,
 * an enumerated licence category, the callsign-token subject). That reading is an
 * INFERENCE layered over the verbatim header, so an @interpretation/<i> claim is
 * layer:'derived' and reads out Looked-up (it is resolved from our authored
 * column spec - DATE_COLUMNS/VARIANTS for the open-data lane, FoiColumnSpec.kind
 * for the FOI lane - not inferred from the data).
 *
 * MATERIALISED, not reconstruct-on-read (the one deliberate departure from #433's
 * store-nothing default). The justification is cardinality: an interpretation is a
 * property of a COLUMN, so the whole corpus adds only O(columns x sources) claims
 * - the same order as the @column headers it sits beside, never the ~18M per-value
 * claims #433 refused to duplicate. And #434's contract is to reconstruct the
 * source FROM CLAIMS ALONE: the format we parsed a date column under is a genuine
 * re-serialisation input a claims-only consumer cannot otherwise recover, so it
 * MUST be stored. The code stays the single source of truth (interpretColumns is
 * LIFTED from the loaders' authored spec); a drift oracle forbids the stored value
 * from disagreeing with it. The per-ROW parse still reconstructs on read (#433).
 *
 * Store the MINIMUM: {type, format} only. NOT the canonical mapping a column feeds
 * (that is the licence-category tier's job) and NOT the parsed values.
 */

import { FILE_LEVEL_ORDINAL } from './file-manifest.ts';
import type { Claim, Provenance, SourceObservationSet } from './claim.ts';

// The inferred kind of a column's values. `date`/`integer` carry a serialised
// shape we parse under (the format); the others carry no parse - a verbatim
// string, the callsign-token subject, an enumerated category keyed by exact
// match, or a callsign constructed from an authored prefix plus the cell.
export type ColumnInterpretationType =
  | 'string'
  | 'date'
  | 'integer'
  | 'callsign-token'
  | 'enumerated-category'
  | 'constructed-callsign';

// The inferred interpretation of ONE column: its type, and (where the type has a
// serialised shape we parse under) the format we parse it under. `format` is
// undefined for types that carry no parse.
export interface ColumnInterpretation {
  type: ColumnInterpretationType;
  // 'DD/MM/YYYY' (open-data + FOI day-first CSV dates), 'YYYY-MM-DD' (workbook
  // iso-date extracts), 'thousands-separated-integer' (the FOI counts). A free
  // string so a future format is a value, not a type change.
  format?: string;
}

// The reserved file-level predicate for a column's attested interpretation. Like
// @column/<index>, the column INDEX rides in the predicate (never a delimiter in
// the object), so the object stays a clean {type, format} encoding and both the
// order and the exact reading are stored facts. One @interpretation/<i> sits
// beside each @column/<i>.
export const INTERPRETATION_PREDICATE_PREFIX = '@interpretation/';

export function interpretationPredicate(index: number): string {
  return `${INTERPRETATION_PREDICATE_PREFIX}${index}`;
}

// The zero-based column index an @interpretation/<index> predicate encodes, or
// undefined when the predicate is not an interpretation predicate. The strict
// integer check mirrors columnIndexOf so a stray predicate is never mistaken for
// a positioned interpretation.
export function interpretationIndexOf(predicate: string): number | undefined {
  if (!predicate.startsWith(INTERPRETATION_PREDICATE_PREFIX)) return undefined;
  const rest = predicate.slice(INTERPRETATION_PREDICATE_PREFIX.length);
  if (!/^\d+$/.test(rest)) return undefined;
  return Number(rest);
}

// The named rule attributing every @interpretation claim. The reading is
// RESOLVED from our authored column spec (a lookup), so the rule is registered in
// claim.ts's LOOKUP_RULES and every interpretation claim reads out Looked-up.
export const COLUMN_INTERPRETATION_RULE = 'column-interpretation';

// The canonical, byte-deterministic mini-encoding of an interpretation: `type`,
// or `type:format` when a format is present. Goldens-safe (a tiny stable string),
// greppable, and diffable - one claim per column mirroring @column.
export function encodeInterpretation(interpretation: ColumnInterpretation): string {
  return interpretation.format === undefined
    ? interpretation.type
    : `${interpretation.type}:${interpretation.format}`;
}

const INTERPRETATION_TYPES: ReadonlySet<string> = new Set<ColumnInterpretationType>([
  'string', 'date', 'integer', 'callsign-token', 'enumerated-category', 'constructed-callsign',
]);

// The inverse of encodeInterpretation: decode a stored object back to a
// {type, format}. Throws (fail loud) on an unknown type - a stored interpretation
// that no longer decodes is a surfaced gap, never a silent default.
export function decodeInterpretation(encoded: string): ColumnInterpretation {
  const colon = encoded.indexOf(':');
  const type = colon === -1 ? encoded : encoded.slice(0, colon);
  if (!INTERPRETATION_TYPES.has(type)) {
    throw new Error(`decodeInterpretation: unknown column-interpretation type "${type}" in "${encoded}"`);
  }
  const interpretation: ColumnInterpretation = { type: type as ColumnInterpretationType };
  if (colon !== -1) interpretation.format = encoded.slice(colon + 1);
  return interpretation;
}

// The interpretation of every column of a source, indexed 1:1 to source column
// order (so it aligns with @column/<index>). The SINGLE source of truth every
// consumer reads - the emit path and the self-checks both call it, so a shown
// interpretation cannot diverge from a materialised one. The lift itself lives in
// the loader lane that owns the authored spec (interpretOpenDataColumns in the
// open-data normaliser; interpretFoiColumns in the FOI normaliser), and the
// loader stores the result on the SourceObservationSet - so this reads a stored
// authored fact, never re-deriving one. Fail loud when a source that should carry
// the hint does not, or the hint is mis-sized: a missing/ragged interpretation is
// a gap to surface, never a silent empty.
export function interpretColumns(source: SourceObservationSet): ColumnInterpretation[] {
  const hint = source.columnInterpretations;
  if (hint === undefined) {
    throw new Error(`interpretColumns: source ${source.sourceFile} carries no columnInterpretations hint - its loader must populate the authored per-column interpretation`);
  }
  if (hint.length !== source.columns.length) {
    throw new Error(`interpretColumns: source ${source.sourceFile} has ${hint.length} interpretations for ${source.columns.length} columns - the hint must align 1:1 with the header`);
  }
  return hint.map(interpretation => ({ ...interpretation }));
}

// Whether a source carries the authored per-column interpretation hint - the
// guard a corpus pass uses to run the interpretation self-checks over exactly the
// families that attest an interpretation, without interpretColumns throwing on a
// family that does not.
export function hasColumnInterpretations(source: SourceObservationSet): boolean {
  return source.columnInterpretations !== undefined;
}

// Emit the file-level DERIVED @interpretation/<index> claims for a source: one per
// column, object = the {type, format} mini-encoding, on the FILE_LEVEL_ORDINAL
// sentinel so it never enters the observation multiset (exactly as the @column
// manifest does). A source that carries no interpretation hint emits nothing -
// additive, so a family that has not opted in is untouched. The header line rides
// the provenance position (like the @column claims) so a P4 surface can permalink
// each interpretation to its header byte.
export function emitInterpretationClaims(source: SourceObservationSet): Claim[] {
  const interpretations = source.columnInterpretations;
  if (interpretations === undefined) return [];
  const interpreted = interpretColumns(source);
  return interpreted.map((interpretation, index) => {
    const provenance: Provenance = { sourceFile: source.sourceFile, ordinal: FILE_LEVEL_ORDINAL, vintage: source.vintage };
    if (source.headerLine !== undefined) provenance.position = { kind: 'csv-line', line: source.headerLine };
    return {
      layer: 'derived',
      rawSubject: '',
      predicate: interpretationPredicate(index),
      object: encodeInterpretation(interpretation),
      provenance,
      rule: COLUMN_INTERPRETATION_RULE,
    } satisfies Claim;
  });
}
