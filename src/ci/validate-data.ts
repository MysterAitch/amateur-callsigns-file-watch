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
import { CONSTANTS, calculateFileHash, ArchiveMeta } from '../shared/utils';
import { listArchiveKeys } from '../shared/archive';

export interface ValidationProblem {
  path: string;
  problem: string;
}

export interface ValidationReport {
  ok: boolean;
  problems: ValidationProblem[];
  checkedEntries: number;
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
    meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  } catch (err: any) {
    problems.push({ path: metaPath, problem: `meta.json is not valid JSON: ${err.message}` });
    return problems;
  }

  // Minimal honest-provenance shape (the #25 "mandatory minimal metadata"
  // principle applied to this source's automated lane).
  if (meta.schemaVersion !== 1) problems.push({ path: metaPath, problem: `unsupported schemaVersion: ${meta.schemaVersion}` });
  if (typeof meta.sourceKey !== 'string' || meta.sourceKey.length === 0) problems.push({ path: metaPath, problem: 'sourceKey is missing or empty' });
  if (!VALID_PROVENANCE.has(meta.provenance)) problems.push({ path: metaPath, problem: `provenance is missing or invalid: ${meta.provenance}` });
  if (!meta.fetchedAt || Number.isNaN(Date.parse(meta.fetchedAt))) problems.push({ path: metaPath, problem: `fetchedAt is missing or not a parseable timestamp: ${meta.fetchedAt}` });
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

  return problems;
}

export function deepValidateEntryCsv(key: string): ValidationProblem[] {
  const problems: ValidationProblem[] = [];
  const rawPath = path.join(entryDir(key), 'raw.csv');
  if (!fs.existsSync(rawPath)) return [{ path: rawPath, problem: 'raw.csv is missing' }];

  let records: unknown[];
  try {
    records = parse(fs.readFileSync(rawPath, 'utf8'), { columns: true, skip_empty_lines: true });
  } catch (err: any) {
    problems.push({ path: rawPath, problem: `raw.csv failed to parse as CSV: ${err.message}` });
    return problems;
  }
  if (records.length === 0) {
    problems.push({ path: rawPath, problem: 'raw.csv parsed to zero records' });
  }

  const metaPath = path.join(entryDir(key), 'meta.json');
  try {
    const meta: ArchiveMeta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    const declared = meta.files?.['raw.csv']?.recordCount;
    if (declared !== undefined && declared !== records.length) {
      problems.push({ path: rawPath, problem: `recordCount mismatch: meta declares ${declared}, CSV parses to ${records.length}` });
    }
  } catch {
    // Structural validation reports unreadable meta; no duplicate here.
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
      const parsed = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
      if (!Array.isArray(parsed)) {
        problems.push({ path: jsonFile, problem: 'expected a JSON array of records' });
      } else if (jsonCount === undefined) {
        jsonCount = parsed.length;
      } else if (parsed.length !== jsonCount) {
        problems.push({ path: jsonFile, problem: `record count ${parsed.length} disagrees with sibling JSON derivative (${jsonCount})` });
      }
    } catch (err: any) {
      problems.push({ path: jsonFile, problem: `not valid JSON: ${err.message}` });
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
    } catch (err: any) {
      problems.push({ path: F.latestRawSortedCsv, problem: `failed to parse as CSV: ${err.message}` });
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
  return { ok: problems.length === 0, problems, checkedEntries: keys.length };
}

function main(): void {
  // Args are archive keys to deep-validate (CI passes the entries a PR
  // touched). With no args, deep-validate the newest entry.
  const args = process.argv.slice(2).filter(a => a.trim().length > 0);
  const deepKeys = args.length > 0 ? args : listArchiveKeys().sort().slice(-1);
  const report = validateRepoData(deepKeys);
  console.log(`Validated ${report.checkedEntries} archive entries (deep: ${deepKeys.join(', ') || 'none'}) + latest-* pointers.`);
  if (!report.ok) {
    for (const p of report.problems) {
      console.error(`FAIL ${p.path}: ${p.problem}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log('All data validation checks passed.');
}

if (require.main === module) {
  main();
}
