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
 *    meta.json declares.
 *  - deep (changed entries only, expensive): the raw CSV actually parses and
 *    agrees with meta's recorded record count.
 *  - pointer consistency: the repo-root latest-* set mirrors the newest
 *    archive entry and all derived JSON/CSV files parse.
 */

import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';
import { CONSTANTS, calculateFileHash, type ArchiveMeta , errorMessage } from '../shared/utils.ts';
import { physicalLines, ignoreReasonForRecord } from '../sources/ofcom-amateur/normalise.ts';
import { listArchiveKeys } from '../shared/archive.ts';
import { validateFoiLaneAt } from './validate-foi.ts';

export interface ValidationProblem {
  path: string;
  problem: string;
}

export interface ValidationReport {
  ok: boolean;
  problems: ValidationProblem[];
  checkedEntries: number;
  checkedFoiEntries: number;
}

const VALID_PROVENANCE = new Set(['live', 'reconstructed-from-git-history', 'reconstructed-from-prior-download']);

function entryDir(key: string): string {
  return path.join(CONSTANTS.DIRS.archive, key);
}

export function validateArchiveEntry(key: string): ValidationProblem[] {
  const problems: ValidationProblem[] = [];
  const dir = entryDir(key);
  const metaPath = path.join(dir, 'meta.json');
  const rawPath = path.join(dir, 'raw.csv');

  if (!fs.existsSync(rawPath)) {
    problems.push({ path: rawPath, problem: 'raw.csv is missing' });
  } else if (fs.statSync(rawPath).size === 0) {
    problems.push({ path: rawPath, problem: 'raw.csv is empty' });
  }

  if (!fs.existsSync(metaPath)) {
    problems.push({ path: metaPath, problem: 'meta.json is missing' });
    return problems; // Everything below needs the meta.
  }

  let meta: ArchiveMeta;
  try {
    meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as ArchiveMeta;
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
  if (typeof meta.files !== 'object' || meta.files === null || !meta.files['raw.csv']) {
    problems.push({ path: metaPath, problem: 'files map is missing a raw.csv declaration' });
    return problems;
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
    if (actualSize !== declared.size) {
      problems.push({ path: filePath, problem: `size mismatch: meta declares ${declared.size} bytes, disk has ${actualSize}` });
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
  const rawPath = path.join(dir, 'raw.csv');
  const normalisedDecl = meta.files['normalised.csv'];
  const ignored = meta.ignoredLines ?? [];
  if (normalisedDecl === undefined && ignored.length === 0) return problems;
  if (!fs.existsSync(rawPath)) return problems; // already reported above
  const variant = (meta as { normalised?: { headerVariant?: string } }).normalised?.headerVariant;

  const lines = physicalLines(fs.readFileSync(rawPath, 'utf8'));
  for (const header of meta.headerLines ?? []) {
    if (lines[header.line - 1] !== header.content) {
      problems.push({ path: metaPath, problem: `headerLines: line ${header.line} content mismatch - meta declares ${JSON.stringify(header.content)}, raw.csv has ${JSON.stringify(lines[header.line - 1])}` });
    }
  }
  const headerLine = lines[0] ?? '';
  const seen = new Set<number>();
  for (const entry of ignored) {
    if (!Number.isInteger(entry.line) || entry.line < 2 || entry.line > lines.length) {
      problems.push({ path: metaPath, problem: `ignoredLines: line ${entry.line} is out of range for raw.csv (${lines.length} lines)` });
      continue;
    }
    if (seen.has(entry.line)) {
      problems.push({ path: metaPath, problem: `ignoredLines: line ${entry.line} is listed twice` });
      continue;
    }
    seen.add(entry.line);
    if (lines[entry.line - 1] !== entry.content) {
      problems.push({ path: metaPath, problem: `ignoredLines: line ${entry.line} content mismatch - meta declares ${JSON.stringify(entry.content)}, raw.csv has ${JSON.stringify(lines[entry.line - 1])}` });
      continue;
    }
    if (typeof entry.reason !== 'string' || entry.reason.trim() === '') {
      problems.push({ path: metaPath, problem: `ignoredLines: line ${entry.line} has no reason` });
    }
    // Predicate re-check: whitespace-only lines are trivially non-data;
    // anything else must parse under the entry's header variant and still
    // fail the row-validity predicate.
    if (entry.content.trim() === '') continue;
    if (variant === undefined) {
      problems.push({ path: metaPath, problem: 'ignoredLines present but meta.normalised.headerVariant is missing - cannot re-verify the row-validity predicate' });
      break;
    }
    try {
      const [record] = parse(`${headerLine}\n${entry.content}`, { columns: true, bom: true }) as Record<string, string>[];
      if (record !== undefined && ignoreReasonForRecord(record, variant) === undefined) {
        problems.push({ path: rawPath, problem: `ignoredLines: line ${entry.line} is a VALID data row (${JSON.stringify(entry.content)}) - data must never be ignored` });
      }
    } catch {
      // Unparseable under the variant's header - by definition not a data
      // row; the enumeration stands.
    }
  }

  if (normalisedDecl?.recordCount !== undefined) {
    const headerCount = meta.headerLines?.length ?? 1;
    const expected = headerCount + normalisedDecl.recordCount + ignored.length;
    if (lines.length !== expected) {
      problems.push({ path: rawPath, problem: `raw line accounting failed: ${lines.length} physical lines but ${headerCount} header + ${normalisedDecl.recordCount} normalised rows + ${ignored.length} ignored = ${expected} - rows are being lost or invented somewhere` });
    }
  }
  return problems;
}

export function deepValidateEntryCsv(key: string): ValidationProblem[] {
  const problems: ValidationProblem[] = [];
  const rawPath = path.join(entryDir(key), 'raw.csv');
  if (!fs.existsSync(rawPath)) return [{ path: rawPath, problem: 'raw.csv is missing' }];

  let records: unknown[];
  try {
    records = parse(fs.readFileSync(rawPath, 'utf8'), { columns: true, skip_empty_lines: true });
  } catch (err) {
    problems.push({ path: rawPath, problem: `raw.csv failed to parse as CSV: ${errorMessage(err)}` });
    return problems;
  }
  if (records.length === 0) {
    problems.push({ path: rawPath, problem: 'raw.csv parsed to zero records' });
  }

  const metaPath = path.join(entryDir(key), 'meta.json');
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as ArchiveMeta;
    const declared = meta.files?.['raw.csv']?.recordCount;
    if (declared !== undefined && declared !== records.length) {
      problems.push({ path: rawPath, problem: `recordCount mismatch: meta declares ${declared}, CSV parses to ${records.length}` });
    }
  } catch {
    // Structural validation reports unreadable meta; no duplicate here.
  }

  // Callsign uniqueness: NOTED on raw (the stats detectors record publisher
  // duplicates as a data-quality fact) but ENFORCED on normalised - the
  // normalised dataset is this repository's contract and downstream joins
  // (components.csv and beyond) key on callsign. The converter is the
  // decision point for resolving publisher duplicates; this check turns an
  // unresolved duplicate into an invalid PR rather than a silently broken
  // join. Empty callsigns are exempt: multiple empties exist in real
  // publications (2023-02-20 carries two), their handling policy is
  // deliberately undecided, and they are surfaced by the emptyCallsign
  // detector - join consumers must exclude them.
  const normalisedPath = path.join(entryDir(key), 'normalised.csv');
  if (fs.existsSync(normalisedPath)) {
    try {
      const rows = parse(fs.readFileSync(normalisedPath, 'utf8'), { columns: true, skip_empty_lines: true }) as Record<string, string>[];
      const seen = new Set<string>();
      const duplicated = new Set<string>();
      for (const row of rows) {
        const callsign = row['callsign'] ?? '';
        if (callsign === '') continue;
        if (seen.has(callsign)) duplicated.add(callsign);
        else seen.add(callsign);
      }
      if (duplicated.size > 0) {
        const sample = [...duplicated].sort().slice(0, 5).join(', ');
        problems.push({
          path: normalisedPath,
          problem: `duplicate callsign values in normalised.csv (downstream joins key on callsign): ${duplicated.size} duplicated value(s), e.g. ${sample}`,
        });
      }
    } catch (err) {
      problems.push({ path: normalisedPath, problem: `normalised.csv failed to parse as CSV: ${errorMessage(err)}` });
    }
  }

  return problems;
}

export function validateLatestPointers(): ValidationProblem[] {
  const problems: ValidationProblem[] = [];
  const F = CONSTANTS.FILES;
  const keys = listArchiveKeys();
  if (keys.length === 0) return [{ path: CONSTANTS.DIRS.archive, problem: 'no archive entries found' }];
  const newest = [...keys].sort().at(-1);
  if (newest === undefined) return [{ path: CONSTANTS.DIRS.archive, problem: 'could not determine newest archive entry' }];

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
