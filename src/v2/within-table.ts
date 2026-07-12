/**
 * Within-table interpretation-consistency passes (issue #435, ADR 0018).
 *
 * An attested column interpretation (interpretation.ts) should be internally
 * consistent WITHIN one table. Two ways it can fail, each a file-level DERIVED
 * flag claim on the affected column (@column-flag/<index>), a review candidate
 * NEVER an auto-correction:
 *
 *  - within-table-date-format-mixing (P2): a date column whose raw values require
 *    MORE THAN ONE ordering/shape to all be valid dates - some forcing day-first
 *    (a day component > 12), some forcing month-first (a month component > 12), or
 *    a mix of slash and ISO shapes. Per ADR 0018 this is a LOUD, VISIBLE flag that
 *    marks the column's date interpretation as doubtful; it does NOT hard-crash the
 *    build (the sources are external and messy, and a hard block would freeze the
 *    pipeline). Genuine parse FAILURES stay fatal in the strict converter, which is
 *    unchanged - this observational pass reads the RAW cells and never throws.
 *
 *  - within-table-normalisation-collision (P3): an enumerated-category column
 *    where TWO DISTINCT raw values collapse to the SAME canonical inside ONE table
 *    (e.g. both `Full` and `Amateur Full Radio Licence` -> `Full` per
 *    licence-category.csv). Across tables that is legitimate drift (open-data uses
 *    short forms, FOI sheets the long forms) and is NEVER flagged; inside one table
 *    it signals the terms may not be as equivalent as our map assumes. Distinct from
 *    #429's stripped-collision (that flags identifiers/callsign tokens; this flags
 *    interpreted VALUES). The flag's OBJECT names the canonical it flags; the
 *    colliding raw values reconstruct on read (explainColumnFlag).
 *
 * WITHIN-TABLE scope is enforced STRUCTURALLY: every pass consumes exactly one
 * SourceObservationSet and builds its candidate set from `source.rows` alone, so
 * cross-file variation is never in scope (the same shape as
 * emitStrippedCollisionClaims). Both flags read out Computed (deterministic
 * computations, absent from LOOKUP_RULES). Evidence reconstructs on read, reusing
 * #433's Working shape (explain.ts), so a P4 surface renders a flag's "why?" with
 * no new primitive.
 */

import type { ReferenceData } from '../sources/ofcom-amateur/components.ts';
import { normaliseLicenceCategory } from '../sources/ofcom-amateur/components.ts';
import {
  claimConfidence,
  interpretColumns,
  hasColumnInterpretations,
  FILE_LEVEL_ORDINAL,
  type Claim,
  type Provenance,
  type SourceObservationSet,
} from './claim.ts';
import type { Working, WorkingInput, WorkingStep } from './explain.ts';

// The reserved file-level predicate for a within-table interpretation flag on a
// column: the column INDEX rides in the predicate (@column-flag/<index>), so it
// aligns with @column/<index> and @interpretation/<index>.
export const COLUMN_FLAG_PREDICATE_PREFIX = '@column-flag/';

export function columnFlagPredicate(index: number): string {
  return `${COLUMN_FLAG_PREDICATE_PREFIX}${index}`;
}

// The zero-based column index a @column-flag/<index> predicate encodes, or
// undefined when the predicate is not a column-flag predicate.
export function columnFlagIndexOf(predicate: string): number | undefined {
  if (!predicate.startsWith(COLUMN_FLAG_PREDICATE_PREFIX)) return undefined;
  const rest = predicate.slice(COLUMN_FLAG_PREDICATE_PREFIX.length);
  if (!/^\d+$/.test(rest)) return undefined;
  return Number(rest);
}

// The P2 flag object: a date column mixing formats within one table.
export const WITHIN_TABLE_DATE_FORMAT_MIXING_FLAG = 'within-table-date-format-mixing';

// The P2 rule - a deterministic COMPUTATION over the column's raw values (not a
// reference lookup), so it reads out Computed.
export const WITHIN_TABLE_DATE_FORMAT_RULE = 'within-table-date-format';

// The P3 rule - a deterministic COMPUTATION over the column's distinct raw values
// and the canonicalisation function, so it reads out Computed. The flag's OBJECT
// is the canonical value the collision produced, not a fixed flag name.
export const WITHIN_TABLE_NORMALISATION_COLLISION_RULE = 'within-table-normalisation-collision';

// ---- P2: within-table date-format mixing ------------------------------------

// The ordering/shape a single raw date value is COMPATIBLE with. `day-first` and
// `month-first` are the two FORCING classifications (a component > 12 proves the
// slot); `ambiguous-slash` fits either slash ordering; `iso` is a YYYY-MM-DD shape;
// `other` is neither a slash nor an ISO date (an empty or malformed cell the strict
// converter would reject - noted, never a basis for the flag on its own).
export type DateShape = 'day-first' | 'month-first' | 'ambiguous-slash' | 'iso' | 'other';

const SLASH_DATE_RE = /^(\d{1,2})\/(\d{1,2})\/\d{4}(?:[ T].*)?$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(?:[ T].*)?$/;

// Classify a raw date value's compatible ordering/shape, independent of the
// strict day-first parser so the pass can SEE mixing the parser would otherwise
// throw on. Uses the same day/month>12 primitive as ParsedUkDateTime.ambiguous.
export function classifyDateShape(value: string): DateShape {
  const trimmed = value.trim();
  if (trimmed === '') return 'other';
  if (ISO_DATE_RE.test(trimmed)) return 'iso';
  const slash = SLASH_DATE_RE.exec(trimmed);
  if (slash === null) return 'other';
  const first = Number(slash[1]);
  const second = Number(slash[2]);
  if (first > 12 && second <= 12) return 'day-first';
  if (second > 12 && first <= 12) return 'month-first';
  if (first <= 12 && second <= 12) return 'ambiguous-slash';
  return 'other';
}

// Whether a column's raw date values MIX formats: at least one value forces
// day-first AND at least one forces month-first (an ordering contradiction), OR a
// slash-shaped value coexists with an ISO-shaped one (a shape contradiction). A
// uniformly-one-ordering or uniformly-ambiguous column does NOT mix.
export function detectsDateFormatMixing(values: readonly string[]): boolean {
  let dayFirst = false;
  let monthFirst = false;
  let slash = false;
  let iso = false;
  for (const value of values) {
    switch (classifyDateShape(value)) {
      case 'day-first': dayFirst = true; slash = true; break;
      case 'month-first': monthFirst = true; slash = true; break;
      case 'ambiguous-slash': slash = true; break;
      case 'iso': iso = true; break;
      case 'other': break;
    }
  }
  return (dayFirst && monthFirst) || (slash && iso);
}

// The non-empty raw values of one column (by index) across a source's rows, in
// row order - the candidate set every within-table pass is built from.
function columnValues(source: SourceObservationSet, index: number): string[] {
  const header = source.columns[index];
  const values: string[] = [];
  for (const row of source.rows) {
    const value = row[header] ?? '';
    if (value !== '') values.push(value);
  }
  return values;
}

// The P2 pass: one within-table-date-format-mixing flag claim per date-attested
// column whose raw values mix formats. File-level, derived, Computed.
export function emitDateFormatMixingClaims(source: SourceObservationSet): Claim[] {
  if (!hasColumnInterpretations(source)) return [];
  const interpretations = interpretColumns(source);
  const claims: Claim[] = [];
  interpretations.forEach((interpretation, index) => {
    if (interpretation.type !== 'date') return;
    if (!detectsDateFormatMixing(columnValues(source, index))) return;
    claims.push(dateFormatFlagClaim(source, index));
  });
  return claims;
}

function fileLevelProvenance(source: SourceObservationSet): Provenance {
  const provenance: Provenance = { sourceFile: source.sourceFile, ordinal: FILE_LEVEL_ORDINAL, vintage: source.vintage };
  if (source.headerLine !== undefined) provenance.position = { kind: 'csv-line', line: source.headerLine };
  return provenance;
}

function dateFormatFlagClaim(source: SourceObservationSet, index: number): Claim {
  return {
    layer: 'derived',
    rawSubject: '',
    predicate: columnFlagPredicate(index),
    object: WITHIN_TABLE_DATE_FORMAT_MIXING_FLAG,
    provenance: fileLevelProvenance(source),
    rule: WITHIN_TABLE_DATE_FORMAT_RULE,
  };
}

// ---- P3: within-table normalisation collision -------------------------------

// A canonicaliser maps a raw value to its canonical form, or null when the value
// has no canonical (a blank, or an unmapped value). Parameterises the P3 pass so
// the same collision detector serves any interpreted column (today the licence
// product via normaliseLicenceCategory; a future status canonicalisation would
// answer the allocated-vs-live question the same way).
export type Canonicaliser = (raw: string) => string | null;

// One canonical that ≥2 DISTINCT raw values in one table collapse to.
export interface NormalisationCollision {
  canonical: string;
  rawValues: string[];
}

// The collisions in one column's distinct non-empty raw values: group distinct
// raws by their canonical, and report every canonical produced by ≥2 distinct
// raws. `rawValues` are sorted for a deterministic, diffable finding.
export function detectNormalisationCollisions(values: readonly string[], canonicalise: Canonicaliser): NormalisationCollision[] {
  const byCanonical = new Map<string, Set<string>>();
  for (const raw of new Set(values)) {
    if (raw === '') continue;
    const canonical = canonicalise(raw);
    if (canonical === null) continue;
    const group = byCanonical.get(canonical) ?? new Set<string>();
    group.add(raw);
    byCanonical.set(canonical, group);
  }
  const collisions: NormalisationCollision[] = [];
  for (const [canonical, raws] of byCanonical) {
    if (raws.size >= 2) collisions.push({ canonical, rawValues: [...raws].sort() });
  }
  return collisions.sort((a, b) => (a.canonical < b.canonical ? -1 : a.canonical > b.canonical ? 1 : 0));
}

// The P3 pass: one within-table-normalisation-collision flag claim per colliding
// CANONICAL on each enumerated-category column, object = the canonical. Today the
// only enumerated-category column feeds normaliseLicenceCategory; the pass is
// parameterised over (column, canonicaliseFn) so a future canonicalisation reuses
// it unchanged. File-level, derived, Computed.
export function emitNormalisationCollisionClaims(source: SourceObservationSet, ref: ReferenceData): Claim[] {
  if (!hasColumnInterpretations(source)) return [];
  const interpretations = interpretColumns(source);
  const claims: Claim[] = [];
  interpretations.forEach((interpretation, index) => {
    if (interpretation.type !== 'enumerated-category') return;
    const collisions = detectNormalisationCollisions(columnValues(source, index), raw => normaliseLicenceCategory(raw, ref));
    for (const collision of collisions) {
      claims.push({
        layer: 'derived',
        rawSubject: '',
        predicate: columnFlagPredicate(index),
        object: collision.canonical,
        provenance: fileLevelProvenance(source),
        rule: WITHIN_TABLE_NORMALISATION_COLLISION_RULE,
      });
    }
  });
  return claims;
}

// Every within-table interpretation flag for a source (P2 + P3), the file-level
// derived flag stream that rides beside the @interpretation attestations.
export function emitWithinTableFlagClaims(source: SourceObservationSet, ref: ReferenceData): Claim[] {
  return [...emitDateFormatMixingClaims(source), ...emitNormalisationCollisionClaims(source, ref)];
}

// ---- Evidence reconstructed on read (composition with #433) -----------------

// Reconstruct the WORKING behind a within-table flag claim: re-run the SAME pass
// over the source's rows and return a #433 Working whose `result` reproduces the
// finding (the flag object). Fail loud if the claim is not a within-table flag,
// or the finding does not reproduce - an unexplainable flag is a surfaced gap,
// never a silent blank (mirroring explain()'s contract). The colliding raw values
// (each an origin pointing at its source cell) reconstruct here, never stored.
export function explainColumnFlag(claim: Claim, source: SourceObservationSet, ref: ReferenceData): Working {
  const index = columnFlagIndexOf(claim.predicate);
  if (index === undefined) {
    throw new Error(`explainColumnFlag: ${claim.predicate} is not a @column-flag predicate`);
  }
  const header = source.columns[index];
  if (header === undefined) {
    throw new Error(`explainColumnFlag: column index ${index} is out of range for ${source.sourceFile}`);
  }

  if (claim.rule === WITHIN_TABLE_DATE_FORMAT_RULE) {
    return explainDateFormatMixing(claim, source, index, header);
  }
  if (claim.rule === WITHIN_TABLE_NORMALISATION_COLLISION_RULE) {
    return explainNormalisationCollision(claim, source, index, header, ref);
  }
  throw new Error(`explainColumnFlag: unknown within-table rule "${claim.rule ?? '(none)'}" on ${claim.predicate}`);
}

// The first row whose cell in `header` matches `value` - the witness origin a
// colliding value deep-links to. Returns undefined only when the value is absent
// (a caller-side bug the explain contract surfaces).
function witnessOrdinal(source: SourceObservationSet, header: string, value: string): number | undefined {
  for (let ordinal = 0; ordinal < source.rows.length; ordinal += 1) {
    if ((source.rows[ordinal][header] ?? '') === value) return ordinal;
  }
  return undefined;
}

function rawCellInput(role: string, source: SourceObservationSet, header: string, value: string): WorkingInput {
  const ordinal = witnessOrdinal(source, header, value);
  if (ordinal === undefined) {
    throw new Error(`explainColumnFlag: value "${value}" does not appear in column "${header}" of ${source.sourceFile} - the finding does not reconstruct`);
  }
  return { role, value, origin: { kind: 'raw-claim', sourceFile: source.sourceFile, ordinal, predicate: header } };
}

function explainDateFormatMixing(claim: Claim, source: SourceObservationSet, index: number, header: string): Working {
  const values = columnValues(source, index);
  if (!detectsDateFormatMixing(values)) {
    throw new Error(`explainColumnFlag: date column "${header}" of ${source.sourceFile} does not reproduce within-table-date-format-mixing`);
  }
  const inputs: WorkingInput[] = [];
  const steps: WorkingStep[] = [];
  const witnessFor = (shape: DateShape, role: string): void => {
    const value = values.find(v => classifyDateShape(v) === shape);
    if (value === undefined) return;
    inputs.push(rawCellInput(role, source, header, value));
    steps.push({ detail: `raw value forces ${shape}`, from: value, to: shape });
  };
  witnessFor('day-first', 'day-first-witness');
  witnessFor('month-first', 'month-first-witness');
  witnessFor('iso', 'iso-witness');
  witnessFor('ambiguous-slash', 'slash-witness');
  steps.push({ detail: `column "${header}" requires more than one ordering/shape to parse - its date interpretation is doubtful` });
  return {
    claim,
    rule: WITHIN_TABLE_DATE_FORMAT_RULE,
    ruleGloss: 'The date column mixes formats within one table (some values force day-first, others month-first or a differing shape).',
    confidence: claimConfidence(claim),
    inputs,
    steps,
    result: WITHIN_TABLE_DATE_FORMAT_MIXING_FLAG,
  };
}

function explainNormalisationCollision(claim: Claim, source: SourceObservationSet, index: number, header: string, ref: ReferenceData): Working {
  const canonical = claim.object;
  const values = columnValues(source, index);
  const collision = detectNormalisationCollisions(values, raw => normaliseLicenceCategory(raw, ref))
    .find(c => c.canonical === canonical);
  if (collision === undefined) {
    throw new Error(`explainColumnFlag: column "${header}" of ${source.sourceFile} does not reproduce a normalisation collision on canonical "${canonical}"`);
  }
  const inputs: WorkingInput[] = collision.rawValues.map(raw => rawCellInput('colliding-raw-value', source, header, raw));
  const steps: WorkingStep[] = [
    { detail: `${collision.rawValues.length} distinct raw values in "${header}" collapse to one canonical`, to: canonical },
    { detail: `colliding raw values: ${collision.rawValues.map(v => JSON.stringify(v)).join(', ')}` },
  ];
  return {
    claim,
    rule: WITHIN_TABLE_NORMALISATION_COLLISION_RULE,
    ruleGloss: 'Two or more distinct raw values collapse to one canonical inside a single table (a within-table terminology-equivalence doubt).',
    confidence: claimConfidence(claim),
    inputs,
    steps,
    result: canonical,
  };
}
