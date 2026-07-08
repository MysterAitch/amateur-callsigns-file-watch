/**
 * The FOI archive lane's shared shape (ADR 0004): meta.json interfaces,
 * entry enumeration/reading helpers, and the controlled vocabularies that
 * the validator (src/ci/validate-foi.ts), the derivation sweep
 * (src/ci/foi-sweep.ts), the dataset-status overview
 * (src/ci/dataset-status.ts) and the schema-registry generator all share -
 * one source of truth, so documentation and validation cannot diverge.
 *
 * Directory parameters are explicit throughout: validate-data's tests chdir
 * into scratch roots and resolve cwd-relative, while the sweep and the
 * overview resolve from the repo root - callers pass whichever suits.
 */

import * as fs from 'fs';
import * as path from 'path';
import { CONSTANTS } from './utils.ts';

// Default FOI lane location, cwd-relative (matching validate-data's
// convention); REPO_ROOT-anchored callers pass their own dir instead.
export function defaultFoiDir(): string {
  return path.join(CONSTANTS.DIRS.archive, 'foi');
}

export interface FoiWitness {
  channel: string;
  url: string;
  fetchedAt: string;
}

export interface FoiRelatedEntry {
  // Usually a sibling entry key; free-text drop-zone references also occur
  // (the validator only requires existence for key-shaped values).
  entry: string;
  relation: string;
}

export interface FoiFileDeclaration {
  bytes: number;
  sha256: string;
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
];

// FOI-transaction outcomes (a historical fact about the request; extended
// deliberately when a genuinely new outcome arrives, like VALID_PROVENANCE).
export const FOI_OUTCOMES: readonly string[] = ['successful', 'not held'];

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
