/**
 * v2 claim ledger — the public import surface (issue #361).
 *
 * The atom of the raw-keyed claim model is a CLAIM and every published table
 * becomes a fold over a ledger of claims. This module is a thin BARREL: it
 * re-exports the core model + shared vocabulary (claim-core.ts) and every
 * per-tier emit step from its own module, so consumers continue to import every
 * symbol from './claim.ts' whether it lives in the core or in a tier module.
 * Splitting the emit tiers into their own modules lets tier lanes (#431/#433/
 * #455) proceed in parallel without contending on one file, while this barrel
 * keeps the import surface stable and the emitted Claim[] identical.
 *
 * The families gathered here:
 *  - claim-core.ts            — the claim/provenance TYPES, the cross-tier
 *                               vocabulary (FLAG_PREDICATE), and the confidence
 *                               readout (ClaimConfidence, claimConfidence).
 *  - raw-emit.ts              — the raw-layer emit (emitClaims, @listed).
 *  - normalisation-edges.ts   — the rule-attributed normalisation edges.
 *  - parse-attribute-emit.ts  — the #406 T1 parse-attribute tier.
 *  - callsign-pattern-emit.ts — the #422 callsign-pattern tier.
 *  - stripped-collision-emit.ts — the whole-source stripped-collision tier.
 *  - licence-category-emit.ts — the canonical licence-category tier.
 *  - emit-ledger.ts           — the emitLedger orchestrator over the tiers.
 *  - provenance.ts            — the #436 provenance helpers.
 *  - source-link.ts           — the #431 P4 source deep-link (position ->
 *                               pinned GitHub blob permalink) + archive provenance.
 *  - file-manifest.ts         — the #434 file-level manifest layer.
 *  - interpretation.ts        — the #435 column-interpretation tier.
 */

// The core data model + shared vocabulary + confidence readout.
export {
  FLAG_PREDICATE,
  CONFIDENCE_ORDER,
  claimConfidence,
  type ClaimLayer,
  type NormalisationForm,
  type SourcePosition,
  type ViewAnchor,
  type Provenance,
  type Observation,
  type Claim,
  type NormalisationEdge,
  type ClaimConfidence,
  type SourceObservationSet,
  type AuthoredRoleBinding,
  type EventDateColumnBinding,
} from './claim-core.ts';

// The raw-layer emit step and its existence predicate.
export { LISTED_PREDICATE, emitClaims } from './raw-emit.ts';

// The rule-attributed normalisation-edge tier.
export {
  NORMALISES_TO_PREDICATE,
  CLEANED_CALLSIGN_RULE,
  PLACEHOLDER_FORM_RULE,
  normalisationEdgesFor,
  edgeToClaim,
} from './normalisation-edges.ts';

// The canonical licence-category tier.
export {
  LICENCE_CATEGORY_PREDICATE,
  LICENCE_CATEGORY_RULE,
  emitLicenceCategoryClaims,
} from './licence-category-emit.ts';

// The derived authored-event tier (issue #813 Stage C2).
export {
  EVENT_PREDICATE,
  AUTHORED_EVENT_RULE,
  emitAuthoredEventClaims,
} from './issuance-event-emit.ts';

// The derived authored-binding-role tier (issue #813 Stage D).
export {
  AUTHORED_ROLE_RULE,
  emitAuthoredRoleClaims,
} from './authored-role-emit.ts';

// The derived event-time tier (issue #725 S1).
export {
  EVENT_DATE_PREDICATE_PREFIX,
  EVENT_DATE_RULE,
  EVENT_DATE_KINDS,
  eventDatePredicate,
  eventKindOf,
  eventKindForDateOutput,
  eventKindForFoiDateColumn,
  isoDayFromAttested,
  isoDayFromCellUnderAnyAttestedFormat,
  emitEventDateClaims,
} from './event-time-emit.ts';

// The derived callsign-pattern tier.
export {
  CALLSIGN_PATTERN_PREDICATE,
  CALLSIGN_PATTERN_RULE,
  emitCallsignPatternClaims,
} from './callsign-pattern-emit.ts';

// The whole-source stripped-collision tier.
export {
  STRIPPED_COLLISION_FLAG,
  STRIPPED_COLLISION_RULE,
  emitStrippedCollisionClaims,
} from './stripped-collision-emit.ts';

// The full-ledger emit orchestrator.
export { emitLedger } from './emit-ledger.ts';

// The cohesive companion layers re-exported so the public surface stays one
// module: consumers continue to import every symbol from './claim.ts' whether it
// lives here or in a companion module.
export { provenanceFor, anchorProvenance } from './provenance.ts';
export {
  SOURCE_REPO_URL,
  SOURCE_PERMALINK_RULE,
  ARCHIVE_INTRODUCED_IN_COMMIT,
  sourcePermalink,
  permalinkForProvenance,
  introducingCommit,
  type ArchiveProvenance,
} from './source-link.ts';
export {
  FILE_LEVEL_ORDINAL,
  COLUMN_PREDICATE_PREFIX,
  SUBJECT_PREDICATE,
  IGNORED_PREDICATE,
  columnPredicate,
  columnIndexOf,
  isFileLevelClaim,
  emitFileManifestClaims,
} from './file-manifest.ts';
export {
  PREFIX_SERIES_PREDICATE,
  IMPLIED_CLASS_PREDICATE,
  PARSE_STATUS_PREDICATE,
  RSL_PREDICATE,
  PARSE_CALLSIGN_RULE,
  emitParseAttributeClaims,
} from './parse-attribute-emit.ts';
export {
  INTERPRETATION_PREDICATE_PREFIX,
  COLUMN_INTERPRETATION_RULE,
  interpretationPredicate,
  interpretationIndexOf,
  encodeInterpretation,
  decodeInterpretation,
  interpretColumns,
  hasColumnInterpretations,
  emitInterpretationClaims,
  type ColumnInterpretation,
  type ColumnInterpretationType,
} from './interpretation.ts';
