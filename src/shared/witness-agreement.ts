/**
 * Derived witness agreement and the divergence record (issue #618 increment 3
 * and #619).
 *
 * A witness records where an independent copy of a held publication was
 * obtained. Its optional `sha256` is the hash of the bytes THAT witness served;
 * its optional `originalFilename` is the name the copy carried at its source
 * (provenance the held filename may have sanitised away). Agreement is DERIVED
 * ON READ from those hashes against the bytes the mirror actually holds, never
 * stored as a verdict (the ADR 0014/0015 derive-on-read discipline):
 *
 *  - no `sha256`                -> citation-grade (a location, unverified);
 *  - `sha256` equals a held copy -> corroborating (byte-identity proven — the
 *                                   "sha256 matches" prose notes, now mechanical);
 *  - `sha256` matches no held copy -> divergent (a differing copy). A divergent
 *                                   witness MUST be paired with a divergence
 *                                   record, or validation fails loudly — a
 *                                   differing hash with no explanation is
 *                                   exactly the fail-fast-fail-loud case.
 *
 * Nothing here persists a class; every consumer re-derives it, so removing or
 * changing a held copy automatically re-classifies its witnesses.
 */

// The three agreement classes a witness can carry, derived on read.
export type WitnessAgreement = 'citation-grade' | 'corroborating' | 'divergent';

// The minimal witness shape this module reads. Both lanes' witness records
// (open-data `ArchiveMeta.witnesses`, FOI `FoiWitness`) satisfy it structurally.
export interface WitnessLike {
  channel: string;
  url: string;
  sha256?: string;
  originalFilename?: string;
  fetchedAt?: string;
  note?: string;
}

// The levels at which a divergent copy can differ from the held copy it is
// compared against. `bytes` is the free level-one comparison (hashes already
// exist per file); `cells`/`rows` describe a same-shape data difference;
// `format-shifted` marks copies whose comparison is at normalised/reconstruction
// level (an xlsx vs a CSV of the same disclosure) rather than byte level.
export type DivergenceLevel = 'bytes' | 'cells' | 'rows' | 'format-shifted';
export const DIVERGENCE_LEVELS: readonly DivergenceLevel[] = ['bytes', 'cells', 'rows', 'format-shifted'];

// The divergent copy a divergence record points at: which publisher served it,
// where, and its hash — plus, where the bytes are held in full, the declared
// file they live in (`heldAs`, a file in the same entry with role
// 'divergent-copy'). When `heldAs` is absent the bytes are NOT redistributed:
// the record is a public index of the copy's existence (hash, source URL,
// original filename), and a reader verifies by obtaining the file from the
// source themselves — the public-index / withheld-bytes model.
export interface DivergenceCounterpart {
  publisher: string;
  url: string;
  sha256: string;
  originalFilename?: string;
  heldAs?: string;
}

// A structured, entry-level record of one divergence: the held copy it differs
// from, the differing counterpart, the level and a plain-English summary, and
// optionally the full enumeration (or a pointer to a committed diff artefact).
// It pairs with the divergent witness whose bytes it explains — the pairing key
// is the counterpart's hash.
export interface DivergenceRecord {
  file: string;
  counterpart: DivergenceCounterpart;
  level: DivergenceLevel;
  summary: string;
  enumeration?: string;
}

const SHA256_RE = /^[0-9a-f]{64}$/;

// Normalise a declared hash for comparison; a malformed or absent hash is
// treated as "no verifiable hash" (its shape is reported separately by the
// validators, so classification never depends on a broken token).
export function normaliseWitnessHash(hash: string | undefined): string | undefined {
  if (typeof hash !== 'string') return undefined;
  const lower = hash.trim().toLowerCase();
  return SHA256_RE.test(lower) ? lower : undefined;
}

// Build the set of hashes the mirror actually holds for an entry, lowercased so
// classification is case-insensitive. A witness whose bytes match any held copy
// is corroborating — the mirror can show it holds those exact bytes.
export function heldHashSet(hashes: Iterable<string>): Set<string> {
  const set = new Set<string>();
  for (const hash of hashes) {
    const normalised = normaliseWitnessHash(hash);
    if (normalised !== undefined) set.add(normalised);
  }
  return set;
}

// Classify one witness against the bytes the mirror holds. See the module
// header for the three cases.
export function classifyWitnessAgreement(witnessSha256: string | undefined, heldHashes: ReadonlySet<string>): WitnessAgreement {
  const hash = normaliseWitnessHash(witnessSha256);
  if (hash === undefined) return 'citation-grade';
  return heldHashes.has(hash) ? 'corroborating' : 'divergent';
}

// Structural check of an entry's divergence records, shared by both lanes so
// the shape can never drift between them. `declaredFiles` are the file names the
// entry declares: a record's `file` (the held copy it diverges from) and its
// counterpart's `heldAs` (the divergent copy held in full, when present) must
// each name one of them. Returns one problem string per fault; an empty list
// means every record is well-formed. Byte-integrity of any held divergent copy
// is checked by the lane validator's ordinary file-hash pass.
export function divergenceRecordProblems(divergences: readonly DivergenceRecord[] | undefined, declaredFiles: ReadonlySet<string>): string[] {
  const problems: string[] = [];
  for (const [i, record] of (divergences ?? []).entries()) {
    const at = `divergences[${i}]`;
    if (typeof record.file !== 'string' || !declaredFiles.has(record.file)) {
      problems.push(`${at}.file "${String(record.file)}" does not name a declared file`);
    }
    if (!DIVERGENCE_LEVELS.includes(record.level)) {
      problems.push(`${at}.level "${String(record.level)}" is not in the vocabulary (${DIVERGENCE_LEVELS.join(', ')})`);
    }
    if (typeof record.summary !== 'string' || record.summary.trim() === '') {
      problems.push(`${at}.summary is missing or empty (a divergence needs a plain-English description)`);
    }
    const counterpart = record.counterpart;
    if (typeof counterpart !== 'object' || counterpart === null) {
      problems.push(`${at}.counterpart is missing`);
      continue;
    }
    if (typeof counterpart.publisher !== 'string' || counterpart.publisher.trim() === '') {
      problems.push(`${at}.counterpart.publisher is missing or empty`);
    }
    if (typeof counterpart.url !== 'string' || counterpart.url.trim() === '') {
      problems.push(`${at}.counterpart.url is missing or empty`);
    }
    if (normaliseWitnessHash(counterpart.sha256) === undefined) {
      problems.push(`${at}.counterpart.sha256 must be 64 lowercase hex characters`);
    }
    if (counterpart.heldAs !== undefined && !declaredFiles.has(counterpart.heldAs)) {
      problems.push(`${at}.counterpart.heldAs "${counterpart.heldAs}" does not name a declared file (a divergent copy held in full must be a declared file)`);
    }
  }
  return problems;
}

// One witness to check for divergence pairing: its held-hash context, plus a
// label the validator uses to locate a problem to its file.
export interface WitnessPairingContext {
  label: string;
  sha256: string | undefined;
  heldHashes: ReadonlySet<string>;
}

// The divergence-pairing rule (fail-fast-fail-loud): every divergent witness
// must be paired with a divergence record whose counterpart hash equals the
// witness hash. An unpaired divergent witness is a hard failure. Returns one
// problem string per unpaired divergent witness; an empty list means every
// divergent witness (if any) is explained. Lands with a currently-empty
// divergence set — increment 4 populates the records.
export function unpairedDivergentWitnessProblems(
  witnesses: readonly WitnessPairingContext[],
  divergences: readonly DivergenceRecord[],
): string[] {
  const explained = heldHashSet(divergences.map(d => d.counterpart?.sha256 ?? ''));
  const problems: string[] = [];
  for (const witness of witnesses) {
    if (classifyWitnessAgreement(witness.sha256, witness.heldHashes) !== 'divergent') continue;
    const hash = normaliseWitnessHash(witness.sha256);
    if (hash === undefined || !explained.has(hash)) {
      problems.push(
        `${witness.label}: witness sha256 ${String(witness.sha256)} matches no held copy (divergent) but no divergence record explains it — a differing hash must be paired with a divergences[] record (issue #618/#619)`,
      );
    }
  }
  return problems;
}
