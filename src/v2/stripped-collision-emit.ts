/**
 * The DERIVED stripped-collision tier for the v2 claim ledger (issue #361).
 *
 * A WHOLE-SOURCE cross-row pass: it flags a raw callsign token whose
 * junk-stripped form (NON_PLAIN_RE removed) both DIFFERS from the verbatim token
 * and coexists as its OWN distinct row in the SAME published source — a
 * confirmed double-listing (the G0TQK trailing-NBSP twin). Unlike the per-token
 * parse flags, this flag needs the set of every raw subject in the source to
 * decide membership, so it is a distinct tier with its own rule. It rides the
 * shared FLAG_PREDICATE like every other data-quality flag, so a report folds
 * "callsigns carrying stripped-collision" by object.
 */

import { NON_PLAIN_RE } from '../sources/ofcom-amateur/components.ts';
import { FLAG_PREDICATE, type Claim, type Provenance, type SourceObservationSet } from './claim-core.ts';

// The DERIVED stripped-collision flag object (issue #361, Phase B tail): a raw
// callsign token whose junk-stripped form (NON_PLAIN_RE removed) both DIFFERS
// from the verbatim token and coexists as its OWN distinct row in the SAME
// published source - a confirmed double-listing (the G0TQK trailing-NBSP twin).
// It rides the FLAG_PREDICATE like every other data-quality flag, so a report
// folds "callsigns carrying stripped-collision" by object; its OBJECT is this
// flag name.
export const STRIPPED_COLLISION_FLAG = 'stripped-collision';

// The named rule attributing every stripped-collision claim. Unlike the
// per-token parse flags (PARSE_CALLSIGN_RULE), this flag is a WHOLE-SOURCE
// cross-row computation - it needs the set of every raw subject in the source
// to decide membership - so it is NOT a parseCallsign output and carries its
// own rule, enumerable beside the parse / pattern / licence-category rules. It
// mirrors componentsFlagsForRows (components.ts), LIFTING that module's
// NON_PLAIN_RE rather than re-deriving the plain-alphabet key, and it is a
// COMPUTATION (not a reference-table lookup, absent from LOOKUP_RULES) so it
// reads out Computed.
export const STRIPPED_COLLISION_RULE = 'stripped-collision';

// The DERIVED stripped-collision claims for a source (issue #361): a WHOLE-SOURCE
// cross-row pass. For each observation whose raw subject's NON_PLAIN_RE-stripped
// form DIFFERS from the verbatim token and coexists as its OWN distinct raw row
// in the SAME source, one derived flag claim (object stripped-collision). This
// mirrors componentsFlagsForRows (components.ts) EXACTLY: the collision set is
// built over the verbatim raw subjects of THIS source's rows (never cleaned
// entities, never across sources - the legacy scope is one snapshot), and the
// key is the LIFTED NON_PLAIN_RE ([^A-Za-z0-9/#], which KEEPS '#'), deliberately
// NOT cleanedCallsign (which upper-cases and drops '#') - a future refactor must
// not silently substitute one for the other.
//
// The tier NEVER invents: a claim rides only on the JUNK-bearing observation
// whose stripped twin is actually present (the clean twin itself strips to
// itself and is not flagged), so an empty subject, a token with no junk, and a
// token whose stripped form is absent all yield nothing - honest silence.
export function emitStrippedCollisionClaims(source: SourceObservationSet): Claim[] {
  const rawSubjects = new Set<string>(source.rows.map(row => row[source.subjectColumn] ?? ''));
  const claims: Claim[] = [];
  source.rows.forEach((row, ordinal) => {
    const rawSubject = row[source.subjectColumn] ?? '';
    if (rawSubject === '') return;
    const stripped = rawSubject.replace(NON_PLAIN_RE, '');
    if (stripped === rawSubject || stripped === '' || !rawSubjects.has(stripped)) return;
    const provenance: Provenance = { sourceFile: source.sourceFile, ordinal, vintage: source.vintage };
    claims.push({ layer: 'derived', rawSubject, predicate: FLAG_PREDICATE, object: STRIPPED_COLLISION_FLAG, provenance, rule: STRIPPED_COLLISION_RULE });
  });
  return claims;
}
