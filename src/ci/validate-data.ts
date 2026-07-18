#!/usr/bin/env node

/**
 * Data-integrity validation for CI (issues #14/#15).
 *
 * Runs read-only in the CI workflow and gates auto-merge of data PRs: a
 * well-formed publication passes; tampered, incomplete, or malformed data
 * fails the check and holds the PR open for human review. The branch then
 * IS the preserved record of the anomalous bytes - nothing is lost by a red
 * check, and an admin can still merge deliberately (rule bypass) if the
 * anomaly turns out to be a legitimate record worth keeping.
 *
 * Check tiers:
 *  - structural (every archive entry, cheap): completeness of the entry file
 *    set, meta.json shape, and byte integrity (size + sha256) of every file
 *    meta.json declares - which, for the frozen-baseline entries, includes
 *    their committed derived files (ADR 0021): the baseline the parity gate
 *    compares the ledger projection against is itself hash-pinned here.
 *  - deep (changed entries only, expensive): the raw CSV actually parses,
 *    agrees with meta's recorded record count, and passes the
 *    callsign-uniqueness attestation gate (on the committed normalised
 *    contract for frozen entries; on the parse source's own callsign column,
 *    resolved through the authored binding, for post-freeze entries).
 *  - pointer consistency: the repo-root latest-* set mirrors the newest
 *    archive entry and all derived JSON/CSV files parse.
 *
 * #448 resolution: these validators RE-HOME rather than retire. The freeze
 * (ADR 0021) ended the production of new committed derivatives, not the
 * committed record itself - and this module is the committed record's gate.
 * The line-accounting invariant below runs where its meta declarations exist
 * (the frozen baseline); a post-freeze entry's line accounting is proven
 * inside the ledger emit's own parse and re-proven byte-for-byte by the
 * reconstruction oracle.
 */

import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';
import { calculateFileHash, type ArchiveMeta, type QualityObservation, errorMessage } from '../shared/utils.ts';
import { DIRS } from '../shared/constants.ts';
import { FILES } from '../sources/ofcom-amateur/constants.ts';
import { mappingForVariant, physicalLines, rawColumnForCanonical } from '../sources/ofcom-amateur/normalise.ts';
import { observeEntryHeader } from '../sources/ofcom-amateur/detect-variant.ts';
import { listArchiveKeys, parseSourceFileName } from '../shared/archive.ts';
import { derivedEntryFile, derivedEntryFileExists } from '../shared/derived-entries.ts';
import { validateFoiLaneAt } from './validate-foi.ts';
import { validatePublishersAt } from './validate-publishers.ts';
import { isPlainObject, describeShape, arrayOrProblem, parseJsonObject, type ValidationProblem } from '../shared/json-shape.ts';
import {
  heldHashSet,
  normaliseWitnessHash,
  divergenceRecordProblems,
  unpairedDivergentWitnessProblems,
} from '../shared/witness-agreement.ts';

const SHA256_RE = /^[0-9a-f]{64}$/;

// Re-exported so every existing `import type { ValidationProblem } from
// './validate-data.ts'` keeps working unchanged - the interface itself now
// lives in shared/json-shape.ts (a dependency-free leaf module) so that
// module's own `ValidationProblem`-typed helper (arrayOrProblem) needs no
// import back to this file, keeping the ESM import graph acyclic (#812).
export type { ValidationProblem };

export interface ValidationReport {
  ok: boolean;
  problems: ValidationProblem[];
  checkedEntries: number;
  checkedFoiEntries: number;
}

const VALID_PROVENANCE = new Set(['live', 'reconstructed-from-git-history', 'reconstructed-from-prior-download', 'recovered-from-web-archive']);

function entryDir(key: string): string {
  return path.join(DIRS.archive, key);
}

// The verbatim publication file: raw.csv for CSV publications, raw.xlsx for
// workbook publications (archived exactly as published, per the archive
// contract - the publisher's format is never converted away).
export function rawFileNameFor(dir: string): string {
  return fs.existsSync(path.join(dir, 'raw.xlsx')) && !fs.existsSync(path.join(dir, 'raw.csv')) ? 'raw.xlsx' : 'raw.csv';
}

export function validateArchiveEntry(key: string): ValidationProblem[] {
  const problems: ValidationProblem[] = [];
  const dir = entryDir(key);
  const metaPath = path.join(dir, 'meta.json');
  const rawName = rawFileNameFor(dir);
  const rawPath = path.join(dir, rawName);

  if (!fs.existsSync(rawPath)) {
    problems.push({ path: rawPath, problem: `${rawName} is missing` });
  } else if (fs.statSync(rawPath).size === 0) {
    problems.push({ path: rawPath, problem: `${rawName} is empty` });
  }

  if (!fs.existsSync(metaPath)) {
    problems.push({ path: metaPath, problem: 'meta.json is missing' });
    return problems; // Everything below needs the meta.
  }

  let meta: ArchiveMeta;
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    if (!isPlainObject(parsed)) {
      problems.push({ path: metaPath, problem: `meta.json must be a JSON object, got ${describeShape(parsed)}` });
      return problems;
    }
    meta = parsed as ArchiveMeta;
  } catch (err) {
    problems.push({ path: metaPath, problem: `meta.json is not valid JSON: ${errorMessage(err)}` });
    return problems;
  }

  // Minimal honest-provenance shape (the #25 "mandatory minimal metadata"
  // principle applied to this source's automated lane).
  if (meta.schemaVersion !== 1) problems.push({ path: metaPath, problem: `unsupported schemaVersion: ${String(meta.schemaVersion)}` });
  if (typeof meta.sourceKey !== 'string' || meta.sourceKey.length === 0) problems.push({ path: metaPath, problem: 'sourceKey is missing or empty' });
  if (!VALID_PROVENANCE.has(meta.provenance)) problems.push({ path: metaPath, problem: `provenance is missing or invalid: ${meta.provenance}` });
  if (!meta.fetchedAt || Number.isNaN(Date.parse(meta.fetchedAt))) problems.push({ path: metaPath, problem: `fetchedAt is missing or not a parseable timestamp: ${meta.fetchedAt}` });
  if (meta.intendedCoverage !== undefined && typeof meta.intendedCoverage?.complete !== 'boolean') {
    problems.push({ path: metaPath, problem: 'intendedCoverage.complete must be a boolean when intendedCoverage is declared' });
  }
  if (typeof meta.files !== 'object' || meta.files === null || !meta.files[rawName]) {
    problems.push({ path: metaPath, problem: `files map is missing a ${rawName} declaration` });
    return problems;
  }

  // Witnesses (recovered/reconstructed copies): each needs the channel it came
  // through, the retrieval/replay URL, and when it was fetched - the same
  // shape the FOI lane records per file.
  const witnesses = arrayOrProblem<NonNullable<ArchiveMeta['witnesses']>[number]>(meta.witnesses, 'witnesses', metaPath, problems);
  for (const [i, witness] of witnesses.entries()) {
    const at = `witnesses[${i}]`;
    if (!isPlainObject(witness)) {
      problems.push({ path: metaPath, problem: `${at} must be an object, got ${describeShape(witness)}` });
      continue;
    }
    if (typeof witness.channel !== 'string' || witness.channel.trim() === '') {
      problems.push({ path: metaPath, problem: `${at}.channel is missing or empty` });
    }
    if (typeof witness.url !== 'string' || witness.url.trim() === '') {
      problems.push({ path: metaPath, problem: `${at}.url is missing or empty` });
    }
    if (!witness.fetchedAt || Number.isNaN(Date.parse(witness.fetchedAt))) {
      problems.push({ path: metaPath, problem: `${at}.fetchedAt is missing or not a date: ${witness.fetchedAt}` });
    }
    // The optional witness hash, when present, must be a well-formed sha256:
    // agreement is derived from it, so a malformed token is caught here rather
    // than silently mis-classifying (#618 increment 3).
    if (witness.sha256 !== undefined && !SHA256_RE.test(witness.sha256)) {
      problems.push({ path: metaPath, problem: `${at}.sha256 must be 64 lowercase hex characters when present, got ${JSON.stringify(witness.sha256)}` });
    }
  }
  // A web-archive recovery must say where it was recovered from.
  if (meta.provenance === 'recovered-from-web-archive' && witnesses.length === 0) {
    problems.push({ path: metaPath, problem: 'provenance recovered-from-web-archive requires at least one witness (capture channel + replay URL + fetchedAt)' });
  }

  // Derived witness agreement (#618 increment 3 / #619): a witness whose bytes
  // match no held copy is DIVERGENT and must be paired with a divergence record;
  // the divergence records themselves must be well-formed. Agreement is compared
  // against the union of the entry's held file hashes.
  const declaredNames = new Set(Object.keys(meta.files));
  const heldHashes = heldHashSet(Object.values(meta.files).map(f => f.sha256));
  problems.push(...divergenceRecordProblems(meta.divergences, declaredNames).map(problem => ({ path: metaPath, problem })));
  problems.push(...unpairedDivergentWitnessProblems(
    // Malformed items were already reported by the loop above; a null/non-object
    // one here is simply treated as carrying no verifiable hash (citation-grade),
    // rather than reported a second time or crashed on.
    witnesses.map((w, i) => ({
      label: `witnesses[${i}]`,
      sha256: isPlainObject(w) ? normaliseWitnessHash(w.sha256) : undefined,
      heldHashes,
    })),
    meta.divergences ?? [],
  ).map(problem => ({ path: metaPath, problem })));

  // Extract declarations: an extract must name a declared raw sibling as its
  // source, and at most one extract may exist (it is THE parse source).
  const extractNames = Object.entries(meta.files).filter(([, f]) => f.role === 'extract').map(([n]) => n);
  if (extractNames.length > 1) {
    problems.push({ path: metaPath, problem: `multiple files declare role extract (${extractNames.join(', ')}) - exactly one parse source is allowed` });
  }
  for (const name of extractNames) {
    const declared = meta.files[name];
    if (typeof declared.extractOf !== 'string' || !meta.files[declared.extractOf]) {
      problems.push({ path: metaPath, problem: `files["${name}"].extractOf must name a declared sibling file, got ${String(declared.extractOf)}` });
    }
  }

  // Byte integrity: every declared file exists and matches its recorded
  // size and sha256; every file on disk (other than meta.json itself) is
  // declared. Catches tampering, corruption, and stray files riding along.
  for (const [name, declared] of Object.entries(meta.files)) {
    const filePath = path.join(dir, name);
    if (!fs.existsSync(filePath)) {
      problems.push({ path: filePath, problem: `declared in meta.json (${name}) but absent from disk` });
      continue;
    }
    const actualSize = fs.statSync(filePath).size;
    if (actualSize !== declared.bytes) {
      problems.push({ path: filePath, problem: `size mismatch: meta declares ${declared.bytes} bytes, disk has ${actualSize}` });
      continue; // Hash will trivially mismatch too; report the root cause only.
    }
    const actualHash = calculateFileHash(filePath);
    if (actualHash !== declared.sha256) {
      problems.push({ path: filePath, problem: `sha256 mismatch: meta declares ${declared.sha256}, disk has ${actualHash}` });
    }
  }
  for (const name of fs.readdirSync(dir)) {
    if (name === 'meta.json') continue;
    if (!meta.files[name]) {
      problems.push({ path: path.join(dir, name), problem: `file ${name} present on disk but not declared in meta.json` });
    }
  }

  problems.push(...validateIgnoredLines(dir, meta));

  // Verified-quality observations: hand-curated and cited, so every entry
  // must carry the date, a non-empty statement, and non-empty evidence
  // (an observation with no evidence is not an observation).
  const qualityObservations = arrayOrProblem<QualityObservation>(meta.qualityObservations, 'qualityObservations', metaPath, problems);
  for (const [i, observation] of qualityObservations.entries()) {
    const at = `qualityObservations[${i}]`;
    if (!isPlainObject(observation)) {
      problems.push({ path: metaPath, problem: `${at} must be an object, got ${describeShape(observation)}` });
      continue;
    }
    if (!observation.observedAt || Number.isNaN(Date.parse(observation.observedAt))) {
      problems.push({ path: metaPath, problem: `${at}.observedAt is missing or not a date: ${observation.observedAt}` });
    }
    if (typeof observation.statement !== 'string' || observation.statement.trim() === '') {
      problems.push({ path: metaPath, problem: `${at}.statement is missing or empty` });
    }
    if (typeof observation.evidence !== 'string' || observation.evidence.trim() === '') {
      problems.push({ path: metaPath, problem: `${at}.evidence is missing or empty (a cited observation needs its citation)` });
    }
    if (observation.coverageAffecting !== undefined && typeof observation.coverageAffecting !== 'boolean') {
      problems.push({ path: metaPath, problem: `${at}.coverageAffecting must be a boolean when present` });
    }
  }

  return problems;
}

// The line-accounting contract (ratified 2026-07-08): every physical line
// of raw.csv is exactly one of header / data row / ignored line, and
// every entry is re-verified here -
//   1. each declared header line and ignored line byte-matches the named
//      physical line of raw.csv (raw is immutable and hash-pinned, so
//      line numbers are stable);
//   2. each ignored line FAILS the row-validity predicate - a mechanism
//      for ignoring furniture must never be able to quietly ignore data;
//   3. the count invariant is exact arithmetic:
//      raw physical lines = header lines + normalised rows + ignored lines.
// The invariant runs for every normalised entry even with nothing ignored,
// so silent row loss anywhere in the derivation chain fails validation.
function validateIgnoredLines(dir: string, meta: ArchiveMeta): ValidationProblem[] {
  const problems: ValidationProblem[] = [];
  const metaPath = path.join(dir, 'meta.json');
  // Line accounting runs against the PARSE SOURCE - the declared extract when
  // one exists, else raw.csv - because that is the text the normaliser reads
  // and whose every physical line the invariant accounts for. The verbatim
  // raw file's integrity is separately pinned by its sha256 declaration.
  const parseSource = parseSourceFileName(meta);
  const rawPath = path.join(dir, parseSource);
  const normalisedDecl = meta.files['normalised.csv'];
  const ignored = meta.ignoredLines ?? [];
  if (normalisedDecl === undefined && ignored.length === 0) return problems;
  if (!fs.existsSync(rawPath)) return problems; // already reported above

  const lines = physicalLines(fs.readFileSync(rawPath, 'utf8'));
  for (const header of meta.headerLines ?? []) {
    if (lines[header.line - 1] !== header.content) {
      problems.push({ path: metaPath, problem: `headerLines: line ${header.line} content mismatch - meta declares ${JSON.stringify(header.content)}, ${parseSource} has ${JSON.stringify(lines[header.line - 1])}` });
    }
  }
  const seen = new Set<number>();
  for (const entry of ignored) {
    if (!Number.isInteger(entry.line) || entry.line < 2 || entry.line > lines.length) {
      problems.push({ path: metaPath, problem: `ignoredLines: line ${entry.line} is out of range for ${parseSource} (${lines.length} lines)` });
      continue;
    }
    if (seen.has(entry.line)) {
      problems.push({ path: metaPath, problem: `ignoredLines: line ${entry.line} is listed twice` });
      continue;
    }
    seen.add(entry.line);
    if (lines[entry.line - 1] !== entry.content) {
      problems.push({ path: metaPath, problem: `ignoredLines: line ${entry.line} content mismatch - meta declares ${JSON.stringify(entry.content)}, ${parseSource} has ${JSON.stringify(lines[entry.line - 1])}` });
      continue;
    }
    // Validity is syntactic-vs-semantic (ratified 2026-07-08): blank lines
    // are auto-ignored; every OTHER ignored line is a CURATED human
    // judgement (export furniture) and must say so - a non-empty reason is
    // the minimum audit trail, and the byte-match above plus the count
    // invariant below keep the curation honest. There is deliberately no
    // mechanical can-this-be-ignored predicate any more: syntactically
    // valid rows can only leave the table via reviewed, explicit curation.
    if (typeof entry.reason !== 'string' || entry.reason.trim() === '') {
      problems.push({ path: metaPath, problem: `ignoredLines: line ${entry.line} has no reason` });
    }
  }

  if (normalisedDecl?.recordCount !== undefined) {
    const headerCount = meta.headerLines?.length ?? 1;
    const expected = headerCount + normalisedDecl.recordCount + ignored.length;
    if (lines.length !== expected) {
      problems.push({ path: rawPath, problem: `${parseSource} line accounting failed: ${lines.length} physical lines but ${headerCount} header + ${normalisedDecl.recordCount} normalised rows + ${ignored.length} ignored = ${expected} - rows are being lost or invented somewhere` });
    }
  }
  return problems;
}

// The curated variant declarations deepValidateEntryCsv resolves the callsign
// column through for a post-freeze entry (ADR 0021): the same precedence the
// ledger projection uses (forced binding, then the recorded one, then
// detection from the entry's own header row).
type DeepValidationMeta = ArchiveMeta & {
  converter?: { variant?: string };
  normalised?: { headerVariant?: string };
};

// The callsigns that appear more than once (the empty token exempt - multiple
// empties exist in real publications and are surfaced by the emptyCallsign
// detector instead), in first-seen order.
function duplicatedCallsigns(callsigns: Iterable<string>): Set<string> {
  const seen = new Set<string>();
  const duplicated = new Set<string>();
  for (const callsign of callsigns) {
    if (callsign === '') continue;
    if (seen.has(callsign)) duplicated.add(callsign);
    else seen.add(callsign);
  }
  return duplicated;
}

// Whether the entry's curation attests publisher duplicates (the statement
// must mention them), which is what licenses preserving them faithfully.
function duplicatesAttested(meta: DeepValidationMeta | undefined): boolean {
  return (meta?.qualityObservations ?? []).some(o => /duplicate callsign/i.test(o.statement));
}

export function deepValidateEntryCsv(key: string): ValidationProblem[] {
  const problems: ValidationProblem[] = [];
  const metaPath = path.join(entryDir(key), 'meta.json');
  // Deep-parse the PARSE SOURCE (the declared extract when one exists, else
  // raw.csv) - the text the normaliser actually reads. A raw.xlsx publication
  // is byte-pinned by its sha256; its parseability is proven via the extract.
  let parseSource = 'raw.csv';
  let meta: DeepValidationMeta | undefined;
  try {
    meta = parseJsonObject(fs.readFileSync(metaPath, 'utf8'), metaPath) as DeepValidationMeta;
    parseSource = parseSourceFileName(meta);
  } catch {
    // Structural validation reports unreadable/malformed meta; parse raw.csv below.
  }
  const rawPath = path.join(entryDir(key), parseSource);
  if (!fs.existsSync(rawPath)) return [{ path: rawPath, problem: `${parseSource} is missing` }];

  let records: Record<string, string>[];
  try {
    records = parse(fs.readFileSync(rawPath, 'utf8'), { columns: true, skip_empty_lines: true, bom: true }) as Record<string, string>[];
  } catch (err) {
    problems.push({ path: rawPath, problem: `${parseSource} failed to parse as CSV: ${errorMessage(err)}` });
    return problems;
  }
  if (records.length === 0) {
    problems.push({ path: rawPath, problem: `${parseSource} parsed to zero records` });
  }

  const declared = meta?.files?.[parseSource]?.recordCount;
  if (declared !== undefined && declared !== records.length) {
    problems.push({ path: rawPath, problem: `recordCount mismatch: meta declares ${declared}, CSV parses to ${records.length}` });
  }

  // Callsign uniqueness: NOTED on raw (the stats detectors record publisher
  // duplicates as a data-quality fact) but ENFORCED as this repository's
  // contract - downstream joins (components and beyond) key on callsign.
  // This check turns an unattested duplicate into an invalid PR rather than
  // a silently broken join. Publications that GENUINELY carry duplicate
  // callsign rows (the recovered 2025-11-11 / 2026-01-14 register vintages
  // each repeat a couple of hundred callsigns) are preserved faithfully,
  // never repaired - but only behind an explicit, curated qualityObservation
  // attesting the duplicates (statement mentioning duplicate callsigns +
  // evidence), so the fact is loud, reviewed and machine-visible to join
  // consumers. Empty callsigns are exempt: multiple empties exist in real
  // publications (2023-02-20 carries two), their handling policy is
  // deliberately undecided, and they are surfaced by the emptyCallsign
  // detector - join consumers must exclude them.
  //
  // Two homes for the check (#448, ADR 0021):
  //  - a FROZEN-BASELINE entry carries a committed normalised.csv - the
  //    contractual dataset - so the check reads it (through the
  //    archive/projection switch, like every derived read);
  //  - a POST-FREEZE entry carries no committed derivative, so the check
  //    runs on the parse source's own callsign column, resolved through the
  //    same authored binding the ledger projection uses (curated variant,
  //    else detection from the entry's header row). The normaliser copies
  //    the callsign token verbatim and is row-preserving, so the duplicate
  //    set is identical either way. An entry whose shape resolves to no
  //    authored binding is skipped here - the ledger projection refuses it
  //    loudly before any surface publishes it.
  // The RAW/META byte-integrity checks above stay archive reads by design:
  // byte-integrity of the committed record is never lost.
  if (derivedEntryFileExists(key, 'normalised.csv')) {
    const normalisedPath = derivedEntryFile(key, 'normalised.csv');
    try {
      const rows = parse(fs.readFileSync(normalisedPath, 'utf8'), { columns: true, skip_empty_lines: true }) as Record<string, string>[];
      const duplicated = duplicatedCallsigns(rows.map(row => row['callsign'] ?? ''));
      if (duplicated.size > 0 && !duplicatesAttested(meta)) {
        const sample = [...duplicated].sort().slice(0, 5).join(', ');
        problems.push({
          path: normalisedPath,
          problem: `duplicate callsign values in normalised.csv (downstream joins key on callsign): ${duplicated.size} duplicated value(s), e.g. ${sample} - preserve them faithfully by attesting the fact in a qualityObservation (statement mentioning duplicate callsigns), or resolve them in the converter`,
        });
      }
    } catch (err) {
      problems.push({ path: normalisedPath, problem: `normalised.csv failed to parse as CSV: ${errorMessage(err)}` });
    }
  } else {
    const observed = observeEntryHeader(entryDir(key), { files: meta?.files });
    const variant = meta?.converter?.variant ?? meta?.normalised?.headerVariant ?? observed.variant;
    const mapping = variant === undefined ? undefined : mappingForVariant(variant);
    const callsignColumn = mapping === undefined ? undefined : rawColumnForCanonical(mapping, 'callsign');
    if (callsignColumn !== undefined) {
      const duplicated = duplicatedCallsigns(records.map(record => record[callsignColumn] ?? ''));
      if (duplicated.size > 0 && !duplicatesAttested(meta)) {
        const sample = [...duplicated].sort().slice(0, 5).join(', ');
        problems.push({
          path: rawPath,
          problem: `duplicate callsign values in ${parseSource} (downstream joins key on callsign; this entry has no committed normalised.csv - ADR 0021): ${duplicated.size} duplicated value(s), e.g. ${sample} - preserve them faithfully by attesting the fact in a qualityObservation (statement mentioning duplicate callsigns)`,
        });
      }
    }
  }

  return problems;
}

export function validateLatestPointers(): ValidationProblem[] {
  const problems: ValidationProblem[] = [];
  const F = FILES;
  const keys = listArchiveKeys();
  if (keys.length === 0) return [{ path: DIRS.archive, problem: 'no archive entries found' }];
  const newest = [...keys].sort().at(-1);
  if (newest === undefined) return [{ path: DIRS.archive, problem: 'could not determine newest archive entry' }];

  // latest-raw.csv must be byte-identical to the newest entry's raw.csv.
  const newestRaw = path.join(entryDir(newest), 'raw.csv');
  if (!fs.existsSync(F.latestRawCsv)) {
    problems.push({ path: F.latestRawCsv, problem: 'latest-raw.csv is missing' });
  } else if (fs.existsSync(newestRaw) && calculateFileHash(F.latestRawCsv) !== calculateFileHash(newestRaw)) {
    problems.push({ path: F.latestRawCsv, problem: `latest-raw.csv differs from newest entry archive/${newest}/raw.csv` });
  }

  // latest-meta.json must mirror the newest entry's meta.json.
  const newestMeta = path.join(entryDir(newest), 'meta.json');
  if (!fs.existsSync(F.latestMeta)) {
    problems.push({ path: F.latestMeta, problem: 'latest-meta.json is missing' });
  } else if (fs.existsSync(newestMeta) && calculateFileHash(F.latestMeta) !== calculateFileHash(newestMeta)) {
    problems.push({ path: F.latestMeta, problem: `latest-meta.json differs from newest entry archive/${newest}/meta.json` });
  }

  // Derived JSON files parse and agree with each other on record count.
  let jsonCount: number | undefined;
  for (const jsonFile of [F.latestJson, F.latestRawSortedJson]) {
    if (!fs.existsSync(jsonFile)) {
      problems.push({ path: jsonFile, problem: 'file is missing' });
      continue;
    }
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
      if (!Array.isArray(parsed)) {
        problems.push({ path: jsonFile, problem: 'expected a JSON array of records' });
      } else if (jsonCount === undefined) {
        jsonCount = parsed.length;
      } else if (parsed.length !== jsonCount) {
        problems.push({ path: jsonFile, problem: `record count ${parsed.length} disagrees with sibling JSON derivative (${jsonCount})` });
      }
    } catch (err) {
      problems.push({ path: jsonFile, problem: `not valid JSON: ${errorMessage(err)}` });
    }
  }

  // Sorted CSV derivative parses and matches the JSON record count.
  if (!fs.existsSync(F.latestRawSortedCsv)) {
    problems.push({ path: F.latestRawSortedCsv, problem: 'file is missing' });
  } else {
    try {
      const records = parse(fs.readFileSync(F.latestRawSortedCsv, 'utf8'), { columns: true, skip_empty_lines: true });
      if (jsonCount !== undefined && records.length !== jsonCount) {
        problems.push({ path: F.latestRawSortedCsv, problem: `record count ${records.length} disagrees with JSON derivatives (${jsonCount})` });
      }
    } catch (err) {
      problems.push({ path: F.latestRawSortedCsv, problem: `failed to parse as CSV: ${errorMessage(err)}` });
    }
  }

  return problems;
}

export function validateRepoData(deepKeys: string[]): ValidationReport {
  const problems: ValidationProblem[] = [];
  const keys = listArchiveKeys();
  for (const key of keys) {
    problems.push(...validateArchiveEntry(key));
  }
  for (const key of deepKeys) {
    if (keys.includes(key)) {
      problems.push(...deepValidateEntryCsv(key));
    }
  }
  problems.push(...validateLatestPointers());
  // The FOI lane (ADR 0004 point 4): structural/referential checks + full
  // hash verification of every declared file, every run.
  const foi = validateFoiLaneAt();
  problems.push(...foi.problems);
  // The publisher register (#618): its own shape and vocabularies, plus that
  // every witness channel across both lanes resolves through it.
  problems.push(...validatePublishersAt());
  return { ok: problems.length === 0, problems, checkedEntries: keys.length, checkedFoiEntries: foi.checkedEntries };
}

function main(): void {
  // Args are archive keys to deep-validate (CI passes the entries a PR
  // touched). With no args, deep-validate the newest entry.
  const args = process.argv.slice(2).filter(a => a.trim().length > 0);
  const deepKeys = args.length > 0 ? args : listArchiveKeys().sort().slice(-1);
  const report = validateRepoData(deepKeys);
  console.log(`Validated ${report.checkedEntries} open-data + ${report.checkedFoiEntries} FOI entries (deep: ${deepKeys.join(', ') || 'none'}) + latest-* pointers.`);
  if (!report.ok) {
    for (const p of report.problems) {
      console.error(`FAIL ${p.path}: ${p.problem}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log('All data validation checks passed.');
}

if (import.meta.main) {
  main();
}
