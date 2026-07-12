#!/usr/bin/env node

/**
 * The interpretation-attestation oracle family (issue #435, ADR 0018): committed,
 * fail-loud self-checks that the attested column interpretation and the
 * within-table flags are TRUE of the real corpus. Runs over the interpreted
 * families (open-data-register, foi-register, attribute-addendum) - every source
 * that carries a columnInterpretations hint.
 *
 * Four checks, all pure over their inputs so the same functions gate a sample in
 * CI and could stream the whole corpus unchanged:
 *
 *  1. The attested format RE-PARSES the whole column (LOAD-BEARING). For every
 *     column attested date:DD/MM/YYYY, every non-empty raw value parses under the
 *     strict day-first parser; date:YYYY-MM-DD, under the ISO validator;
 *     integer:thousands-separated-integer, as a well-formed count. A failure is
 *     the attestation being wrong OR the column mixing - the interpretation-layer
 *     analogue of #433's explain(claim).result === claim.object.
 *  2. NO DRIFT between the materialised claim and the code: every emitted
 *     @interpretation/<i> object decodes to exactly interpretColumns(source)[i].
 *  3. Every within-table flag is REPRODUCIBLE (explainColumnFlag reproduces the
 *     finding with non-empty evidence) and COMPLETE (re-running the pass over an
 *     UNflagged interpreted column finds no hidden collision / ordering conflict).
 *
 * The cross-file scope guard and the observation-stream-unchanged check are proved
 * in the committed tests (interpretation-oracle.test.ts) with constructed corpora,
 * since they are statements ABOUT the corpus shape rather than over one source.
 */

import { parseUkDateTimeDetailed } from '../shared/normalise.ts';
import { errorMessage } from '../shared/utils.ts';
import { loadReferenceData, type ReferenceData } from '../sources/ofcom-amateur/components.ts';
import {
  emitInterpretationClaims,
  interpretColumns,
  hasColumnInterpretations,
  interpretationIndexOf,
  decodeInterpretation,
  encodeInterpretation,
  type Claim,
  type SourceObservationSet,
} from '../v2/claim.ts';
import {
  emitDateFormatMixingClaims,
  emitNormalisationCollisionClaims,
  explainColumnFlag,
  detectsDateFormatMixing,
  detectNormalisationCollisions,
  columnFlagIndexOf,
  WITHIN_TABLE_DATE_FORMAT_MIXING_FLAG,
} from '../v2/within-table.ts';
import { normaliseLicenceCategory } from '../sources/ofcom-amateur/components.ts';
import { collectReconstructionSources } from './reconstruction-oracle.ts';

// One violated expectation. `check` names the facet; `where` locates the source +
// column; `detail` says what is wrong.
export interface InterpretationViolation {
  check: 'format-reparses' | 'claim-code-drift' | 'flag-reproducible' | 'flag-complete';
  where: string;
  detail: string;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2}(?::\d{2})?)?$/;
const PLAIN_COUNT_RE = /^\d+$/;
const THOUSANDS_COUNT_RE = /^\d{1,3}(?:,\d{3})+$/;

function columnValues(source: SourceObservationSet, index: number): string[] {
  const header = source.columns[index];
  const values: string[] = [];
  for (const row of source.rows) {
    const value = row[header] ?? '';
    if (value !== '') values.push(value);
  }
  return values;
}

// Check 1: the attested format re-parses the whole column.
export function checkAttestedFormatReparses(source: SourceObservationSet): InterpretationViolation[] {
  if (!hasColumnInterpretations(source)) return [];
  const violations: InterpretationViolation[] = [];
  const interpretations = interpretColumns(source);
  interpretations.forEach((interpretation, index) => {
    const header = source.columns[index];
    const where = `${source.sourceFile}:@column/${index}(${header})`;
    const values = columnValues(source, index);
    if (interpretation.type === 'date' && interpretation.format === 'DD/MM/YYYY') {
      for (const value of values) {
        try {
          parseUkDateTimeDetailed(value);
        } catch (err) {
          violations.push({ check: 'format-reparses', where, detail: `value "${value}" does not parse under DD/MM/YYYY: ${errorMessage(err)}` });
        }
      }
    } else if (interpretation.type === 'date' && interpretation.format === 'YYYY-MM-DD') {
      for (const value of values) {
        if (!ISO_DATE_RE.test(value.trim())) {
          violations.push({ check: 'format-reparses', where, detail: `value "${value}" is not a well-formed YYYY-MM-DD date` });
        }
      }
    } else if (interpretation.type === 'integer') {
      for (const value of values) {
        const trimmed = value.trim();
        if (!PLAIN_COUNT_RE.test(trimmed) && !THOUSANDS_COUNT_RE.test(trimmed)) {
          violations.push({ check: 'format-reparses', where, detail: `value "${value}" is not a well-formed integer count` });
        }
      }
    }
  });
  return violations;
}

// Check 2 (core): a stored @interpretation claim set MUST decode to exactly
// interpretColumns(source) - the guard that forbids a committed interpretation
// drifting from the code (FoiColumnSpec.kind / the variant registry). Takes the
// claims explicitly so a genuinely-stale stored set is checkable, not just the
// freshly-emitted one.
export function checkInterpretationClaimsAgainstCode(source: SourceObservationSet, claims: readonly Claim[]): InterpretationViolation[] {
  const violations: InterpretationViolation[] = [];
  const interpreted = interpretColumns(source);
  if (claims.length !== interpreted.length) {
    violations.push({ check: 'claim-code-drift', where: source.sourceFile, detail: `emitted ${claims.length} @interpretation claims for ${interpreted.length} columns` });
    return violations;
  }
  for (const claim of claims) {
    const index = interpretationIndexOf(claim.predicate);
    if (index === undefined) {
      violations.push({ check: 'claim-code-drift', where: `${source.sourceFile}:${claim.predicate}`, detail: 'interpretation claim carries no column-positioned predicate' });
      continue;
    }
    const expected = encodeInterpretation(interpreted[index]);
    if (claim.object !== expected) {
      violations.push({ check: 'claim-code-drift', where: `${source.sourceFile}:@interpretation/${index}`, detail: `stored "${claim.object}" != code "${expected}"` });
    }
    // The stored object must also decode back to the same reading (round-trip).
    if (encodeInterpretation(decodeInterpretation(claim.object)) !== claim.object) {
      violations.push({ check: 'claim-code-drift', where: `${source.sourceFile}:@interpretation/${index}`, detail: `object "${claim.object}" does not survive a decode/encode round-trip` });
    }
  }
  return violations;
}

// Check 2: no drift between the materialised @interpretation claim and the code -
// the freshly-emitted claims must agree with interpretColumns (a stale committed
// set would be caught the same way via checkInterpretationClaimsAgainstCode).
export function checkNoInterpretationDrift(source: SourceObservationSet): InterpretationViolation[] {
  if (!hasColumnInterpretations(source)) return [];
  return checkInterpretationClaimsAgainstCode(source, emitInterpretationClaims(source));
}

// Check 3: every raised within-table flag reproduces (with non-empty evidence),
// and no interpreted column hides an unflagged collision / ordering conflict.
export function checkFlagsReproducibleAndComplete(source: SourceObservationSet, ref: ReferenceData): InterpretationViolation[] {
  if (!hasColumnInterpretations(source)) return [];
  const violations: InterpretationViolation[] = [];
  const interpretations = interpretColumns(source);
  const dateFlags = emitDateFormatMixingClaims(source);
  const collisionFlags = emitNormalisationCollisionClaims(source, ref);

  for (const claim of [...dateFlags, ...collisionFlags]) {
    const where = `${source.sourceFile}:${claim.predicate}(${claim.object})`;
    let working;
    try {
      working = explainColumnFlag(claim, source, ref);
    } catch (err) {
      violations.push({ check: 'flag-reproducible', where, detail: `flag does not reconstruct: ${errorMessage(err)}` });
      continue;
    }
    if (working.result !== claim.object) {
      violations.push({ check: 'flag-reproducible', where, detail: `explainColumnFlag result "${working.result}" != claim object "${claim.object}"` });
    }
    if (working.inputs.length === 0) {
      violations.push({ check: 'flag-reproducible', where, detail: 'flag reconstructs with no evidence inputs' });
    }
  }

  // Completeness: the emitted flags must be EXACTLY what a fresh pass finds.
  const emittedDateColumns = new Set(dateFlags.map(c => columnFlagIndexOf(c.predicate)));
  const emittedCollisions = new Set(collisionFlags.map(c => `${columnFlagIndexOf(c.predicate)}#${c.object}`));
  interpretations.forEach((interpretation, index) => {
    if (interpretation.type === 'date') {
      const mixes = detectsDateFormatMixing(columnValues(source, index));
      if (mixes && !emittedDateColumns.has(index)) {
        violations.push({ check: 'flag-complete', where: `${source.sourceFile}:@column/${index}`, detail: 'date column mixes formats but no flag was emitted (missed flag)' });
      }
      if (!mixes && emittedDateColumns.has(index)) {
        violations.push({ check: 'flag-complete', where: `${source.sourceFile}:@column/${index}`, detail: 'date-format-mixing flag emitted for a column that does not mix (phantom flag)' });
      }
    }
    if (interpretation.type === 'enumerated-category') {
      const collisions = detectNormalisationCollisions(columnValues(source, index), raw => normaliseLicenceCategory(raw, ref));
      for (const collision of collisions) {
        if (!emittedCollisions.has(`${index}#${collision.canonical}`)) {
          violations.push({ check: 'flag-complete', where: `${source.sourceFile}:@column/${index}`, detail: `collision on canonical "${collision.canonical}" not emitted (missed flag)` });
        }
      }
    }
  });

  return violations;
}

// ---- Aggregate over one source + over the corpus ----------------------------

export function checkInterpretationSource(source: SourceObservationSet, ref: ReferenceData): InterpretationViolation[] {
  return [
    ...checkAttestedFormatReparses(source),
    ...checkNoInterpretationDrift(source),
    ...checkFlagsReproducibleAndComplete(source, ref),
  ];
}

// A within-table flag surfaced by the corpus pass - the "surprise" the build
// exists to expose, reported (not swallowed) alongside the pass/fail verdict.
export interface SurfacedFlag {
  sourceFile: string;
  columnHeader: string;
  rule: string;
  object: string;
}

export interface InterpretationOracleReport {
  sourcesChecked: number;
  violations: InterpretationViolation[];
  surfacedFlags: SurfacedFlag[];
}

// Run the whole oracle over every interpreted source the reconstruction corpus
// resolves. Returns the report; assertInterpretationOracle throws on any violation.
export function runInterpretationOracle(
  sources: readonly SourceObservationSet[],
  ref: ReferenceData = loadReferenceData(),
): InterpretationOracleReport {
  const violations: InterpretationViolation[] = [];
  const surfacedFlags: SurfacedFlag[] = [];
  let sourcesChecked = 0;
  for (const source of sources) {
    if (!hasColumnInterpretations(source)) continue;
    sourcesChecked += 1;
    violations.push(...checkInterpretationSource(source, ref));
    for (const claim of [...emitDateFormatMixingClaims(source), ...emitNormalisationCollisionClaims(source, ref)]) {
      const index = columnFlagIndexOf(claim.predicate) ?? -1;
      surfacedFlags.push({ sourceFile: source.sourceFile, columnHeader: source.columns[index] ?? '?', rule: claim.rule ?? '', object: claim.object });
    }
  }
  return { sourcesChecked, violations, surfacedFlags };
}

function formatViolations(violations: readonly InterpretationViolation[]): string {
  const lines = violations.map(v => `  [${v.check}] ${v.where}: ${v.detail}`);
  return `${violations.length} interpretation-oracle violation(s):\n${lines.join('\n')}`;
}

export function assertInterpretationOracle(
  sources: readonly SourceObservationSet[],
  ref: ReferenceData = loadReferenceData(),
): InterpretationOracleReport {
  const report = runInterpretationOracle(sources, ref);
  if (report.violations.length > 0) {
    throw new Error(formatViolations(report.violations));
  }
  return report;
}

// Resolve every interpreted source the reconstruction corpus covers (the
// open-data + FOI register + attribute-addendum lanes that carry a hint).
export function collectInterpretedSources(): SourceObservationSet[] {
  return collectReconstructionSources()
    .map(resolved => resolved.load())
    .filter(hasColumnInterpretations);
}

const IS_MAIN = import.meta.main;
if (IS_MAIN) {
  const report = assertInterpretationOracle(collectInterpretedSources());
  console.log(`interpretation-oracle: ${report.sourcesChecked} interpreted sources OK`);
  if (report.surfacedFlags.length === 0) {
    console.log('  no within-table interpretation flags in the real corpus');
  } else {
    const mixing = report.surfacedFlags.filter(f => f.object === WITHIN_TABLE_DATE_FORMAT_MIXING_FLAG).length;
    console.log(`  surfaced ${report.surfacedFlags.length} within-table flag(s) (${mixing} date-format-mixing):`);
    for (const flag of report.surfacedFlags) {
      console.log(`    [${flag.rule}] ${flag.sourceFile} column "${flag.columnHeader}" -> ${flag.object}`);
    }
  }
}
