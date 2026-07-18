/**
 * The FOI archive lane's shared shape (ADR 0004): meta.json interfaces,
 * entry enumeration/reading helpers, and the controlled vocabularies that
 * the validator (src/ci/validate-foi.ts), the derivation verification
 * (src/ci/foi-verification.ts), the dataset-status overview
 * (src/ci/dataset-status.ts) and the schema-registry generator all share -
 * one source of truth, so documentation and validation cannot diverge.
 *
 * Directory parameters are explicit throughout: validate-data's tests chdir
 * into scratch roots and resolve cwd-relative, while the sweep and the
 * overview resolve from the repo root - callers pass whichever suits.
 */

import * as fs from 'fs';
import * as path from 'path';
import { DIRS } from './constants.ts';
import type { DivergenceRecord } from './witness-agreement.ts';

// Default FOI lane location, cwd-relative (matching validate-data's
// convention); REPO_ROOT-anchored callers pass their own dir instead.
export function defaultFoiDir(): string {
  return path.join(DIRS.archive, 'foi');
}

export interface FoiWitness {
  channel: string;
  url: string;
  // Optional: some disclosure-log `live` copies are recorded without a fetch
  // timestamp (the FOI-lane validator requires only channel and url). A
  // renderer must degrade honestly ("fetch date not recorded"), never fabricate
  // a date or emit "undefined".
  fetchedAt?: string;
  // The hash of the bytes THIS witness served (#618 increment 3): present where
  // the copy's bytes are verifiable from what the mirror holds (the ingestion
  // source of the held file), absent where the witness is a location only
  // (citation-grade). Agreement is DERIVED ON READ against the held file hashes
  // (src/shared/witness-agreement.ts), never stored as a verdict.
  sha256?: string;
  // The name the copy carried at its source (#619) - provenance the held
  // filename may have sanitised away. Absent where not known or identical.
  originalFilename?: string;
  // Some witnesses carry a free-text note (why this copy was ingested as the
  // primary raw, whether a mirror was found); surfaced where useful, never
  // required.
  note?: string;
}

export interface FoiRelatedEntry {
  // Usually a sibling entry key; free-text drop-zone references also occur.
  // For a key-shaped value the validator requires the sibling to exist; a
  // typed relation (see relationType) then layers its own semantics on top.
  entry: string;
  relation: string;
  // Marks this relation as belonging to a controlled type with its own
  // validated semantics, rather than an untyped cross-reference (#580).
  // 'same-dataset' asserts the SAME underlying dataset, obtained through a
  // different source or channel (the WDTK requester copy and the Ofcom
  // publication of one response, say) - distinct from a file's witnesses[]
  // (multiple observed copies of ONE declared file within an entry).
  // Identity is symmetric by definition, so the validator requires the named
  // sibling to reciprocate the same relationType back. Absent for the
  // general free-prose cross-reference, which stays existence-checked only.
  relationType?: string;
}

export interface FoiFileDeclaration {
  // Declared byte length, cross-checked against fs.statSync(...).size by
  // validateFoiEntry. Named to match the open-data lane's
  // ArchivedFileMeta.bytes (src/shared/utils.ts) - the same rename that
  // resolved the two schemas' accidental size/bytes drift (#683).
  bytes: number;
  sha256: string;
  // For role 'normalised': the exact row count the converter computed while
  // producing this file (FoiConvertResult.recordCount,
  // src/shared/foi-normalise.ts), cross-checked by foi-verification.ts's
  // byte-identical re-derivation. Absent for files never run through a
  // converter - a mechanical 'extract' (xlsx-extract.ts) has no comparable
  // count of its own, and PDFs/letters/transcripts were never parsed at all -
  // those keep only the curated, publisher-indicative
  // sheetsIndicative[].approxRows figure.
  recordCount?: number;
  role: string;
  contentsIndicative?: string;
  datasetClasses?: string[];
  sheetsIndicative?: unknown;
  variantNote?: string;
  witnesses?: FoiWitness[];
  // Derivation references - each names another declared file in the entry.
  extractOf?: string;
  extractedBy?: string;
  extractedFrom?: string;
  normalisedFrom?: string;
  // For role 'divergent-copy' (#618 increment 4): the faithful held file this
  // copy diverges from. The divergent bytes are held in full so the difference
  // is re-verifiable forever; the paired divergences[] record says what differs.
  divergesFrom?: string;
}

export interface FoiEntryMeta {
  schemaVersion: number;
  sourceKey: string;
  requestId: number | null;
  ofcomReference: string | null;
  ofcomReferenceNote?: string;
  requestUrl: string | null;
  publicationUrl?: string;
  title: string;
  requester: string | null;
  requestedAt: string | null;
  requestedAtNote?: string;
  respondedAt: string | null;
  respondedAtNote?: string;
  outcome: string;
  dataVintage: string | null;
  dataVintageNote?: string;
  // Archive-side recovery state, distinct from the FOI-transaction outcome:
  // absent = fully recovered; see FOI_DATASET_RECOVERY.
  datasetRecovery?: string;
  datasetClasses: string[];
  converter: { script?: string; variant?: string } | null;
  relatedEntries?: FoiRelatedEntry[];
  // Structured records of copies claiming to be a disclosed file that DIFFER
  // from the held copy (#618 increment 4 / #619). A divergent witness (its
  // sha256 matches no held copy) must be paired here, else validation fails.
  divergences?: DivergenceRecord[];
  files: Record<string, FoiFileDeclaration>;
}

// Every role a declared file may carry. Six are observed in the archive;
// 'data-container' is the anticipated role for verbatim-committed containers
// whose inner artefacts are separately extracted (ADR 0004 / #133 pattern).
export const FOI_FILE_ROLES: readonly string[] = [
  'data',
  'data-container',
  'extract',
  'normalised',
  'response-letter',
  'acknowledgement-letter',
  'transcript',
  // A copy claiming to be a disclosed file that DIFFERS from the faithful held
  // copy, held in full so the difference is re-verifiable (#618 increment 4 /
  // #619). Never the entry's parse source; paired with a divergences[] record.
  'divergent-copy',
];

// FOI-transaction outcomes (a historical fact about the request; extended
// deliberately when a genuinely new outcome arrives, like VALID_PROVENANCE).
export const FOI_OUTCOMES: readonly string[] = ['successful', 'not held'];

// relatedEntries' controlled relation types (#580): a relationType absent
// from an item means it is an untyped, free-prose cross-reference (existence
// of a key-shaped target is still checked, but nothing about the relation's
// semantics is). 'same-dataset' is the one currently defined typed relation -
// see FoiRelatedEntry.relationType for its meaning and the symmetry it implies.
export const FOI_RELATION_TYPES: readonly string[] = ['same-dataset'];

// Archive-side dataset recovery states (datasetRecovery field): absent means
// fully recovered; these values put an incomplete recovery on the record
// machine-readably (e.g. ofcom-285990's attested-but-uncaptured list).
export const FOI_DATASET_RECOVERY: readonly string[] = ['unrecovered', 'partial'];

// Dataset-class vocabulary with its authored prose definitions - rendered
// verbatim into docs/foi-schemas.md and enforced by the validator, so the
// glossary and the accepted values are the same object.
export const FOI_DATASET_CLASSES: Readonly<Record<string, string>> = {
  'register-snapshot': 'the register state at a vintage: one row per callsign carrying its status (and class/date attributes where disclosed)',
  'available-pool': 'callsigns (or suffixes) available for issue at a vintage - asserts nothing about allocated callsigns',
  'issuance-events': 'dated per-callsign events: issue, re-issue, reallocation, reciprocal-licence issue',
  'forbidden-list': 'three-letter suffixes withheld from issue (a different row shape by design: suffixes, not callsigns)',
  'statistics-aggregate': 'counts and aggregates, not per-callsign rows',
  'attribute-addendum': 'per-callsign or per-licence attributes intended for downstream joins (identifiers, dates, classes)',
  'reference-context': 'records that are context rather than datasets: not-held responses, referrals, policy signposts, system-history statements',
};

export function listFoiEntryKeys(foiDir: string = defaultFoiDir()): string[] {
  if (!fs.existsSync(foiDir)) return [];
  return fs.readdirSync(foiDir)
    .filter(name => fs.statSync(path.join(foiDir, name)).isDirectory())
    .sort();
}

export function readFoiEntryMeta(foiDir: string, key: string): FoiEntryMeta {
  return JSON.parse(fs.readFileSync(path.join(foiDir, key, 'meta.json'), 'utf8')) as FoiEntryMeta;
}
