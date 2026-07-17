#!/usr/bin/env node

/**
 * One-shot migration: walk git log for every commit that ever touched the raw
 * amateur callsigns CSV and materialise each unique version into archive/{key}/
 * with a best-effort meta.json. Purpose: give the archive the "authoritative
 * record" property retroactively, so nothing that ever landed in git is lost
 * behind git-log spelunking.
 *
 * This script is idempotent - running it twice does not create duplicate
 * entries, because writeArchiveEntry uses the same "same content = same key"
 * behaviour as live processing. The HEAD commit is intentionally SKIPPED here;
 * that entry is created via the normal live process-csv flow which has richer
 * download-metadata provenance.
 */

import * as fsSync from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { execFileSync } from 'child_process';
import { parse } from 'csv-parse/sync';
import {
  logger,
  type ArchiveMeta,
  errorMessage,
} from '../../shared/utils.ts';
import { DIRS } from '../../shared/constants.ts';
import { FILES, OFCOM_AMATEUR_SOURCE_KEY } from './constants.ts';
import {
  writeArchiveEntry,
  resolveArchiveKey,
  archiveKeyForDate,
  extractOfcomDateFromCommitMessage,
  computeCsvFileMeta,
} from '../../shared/archive.ts';

const RAW_CSV_PATH_IN_REPO = FILES.originalRawCsvFile;
const ARCHIVE_DIR = DIRS.archive;

// Historical filenames the raw CSV has lived under. Order matters: the current
// name is tried first, older names as fallbacks. Extend this if the file is
// ever renamed again.
const HISTORICAL_RAW_CSV_PATHS: string[] = [
  RAW_CSV_PATH_IN_REPO,     // amateur-callsigns-raw.csv (current)
  'amateur-callsigns.csv',  // pre-3b260b1 TS-migration name
];

interface HistoricalCommit {
  sha: string;
  authorDateIso: string;
  message: string;
}

interface CsvRecord {
  [key: string]: string;
}

// Enumerate every commit that touched the raw CSV path, oldest-first for
// chronological diff computation.
//
// NOTE: git has a well-known quirk where `--reverse` combined with `--follow`
// silently truncates history to a single commit. So we deliberately do NOT
// pass --reverse to git; we fetch in default (newest-first) order and reverse
// the list in JS. --follow is preserved so renames of the raw CSV don't break
// the walk (defensive; the path hasn't changed in this repo's history yet).
function listHistoricalCommits(headSha: string): HistoricalCommit[] {
  // Use a unit separator between fields and a record separator between commits
  // so nothing in the commit message can accidentally break parsing.
  const FIELD = '\x1f';
  const RECORD = '\x1e';

  // Query git for touching-commits against EVERY historical path, then merge and
  // dedupe. This is more robust than relying on --follow alone, which caught the
  // rename in one direction here but --follow interacts oddly with other options
  // and we don't need it if we know the historical names.
  const commitsBySha = new Map<string, HistoricalCommit>();
  for (const filepath of HISTORICAL_RAW_CSV_PATHS) {
    const output = execFileSync(
      'git',
      ['log', `--format=%H${FIELD}%aI${FIELD}%B${RECORD}`, '--', filepath],
      { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
    );
    output
      .split(RECORD)
      .map(chunk => chunk.trim())
      .filter(chunk => chunk.length > 0)
      .forEach(chunk => {
        const [sha, authorDateIso, ...msgParts] = chunk.split(FIELD);
        if (sha === headSha) return; // skip HEAD - handled by live flow
        if (!commitsBySha.has(sha)) {
          commitsBySha.set(sha, { sha, authorDateIso, message: msgParts.join(FIELD).trim() });
        }
      });
  }

  // Sort oldest-first by author date, so diff-summary chains build chronologically.
  return Array.from(commitsBySha.values()).sort((a, b) =>
    a.authorDateIso.localeCompare(b.authorDateIso)
  );
}

function getHeadSha(): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
}

// Extract the raw CSV content at a specific commit. Tries each historical path
// name in order and returns the first that succeeds. Returns null if the file
// isn't found under any known name at that commit.
function extractCsvAtCommit(sha: string): { content: Buffer; pathAtCommit: string } | null {
  for (const filepath of HISTORICAL_RAW_CSV_PATHS) {
    try {
      const content = execFileSync(
        'git',
        ['show', `${sha}:${filepath}`],
        { maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] },
      );
      return { content, pathAtCommit: filepath };
    } catch {
      // try next path
    }
  }
  return null;
}

function sha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// Truncate an ISO date-time to a YYYY-MM-DD calendar date, in UTC.
function isoToCalendarDay(iso: string): string {
  return iso.slice(0, 10);
}

async function main(): Promise<void> {
  const headSha = getHeadSha();
  logger.info(`HEAD is ${headSha}; will migrate historical commits touching ${RAW_CSV_PATH_IN_REPO}`);

  const commits = listHistoricalCommits(headSha);
  logger.info(`Found ${commits.length} historical commits touching the raw CSV (excluding HEAD).`);

  // Track hashes we've already materialised, so no-op commits (e.g. the TS
  // migration commit which touched scripts but not necessarily CSV content)
  // don't produce duplicate archive entries.
  const seenHashes = new Set<string>();
  let entriesCreated = 0;
  let entriesSkipped = 0;

  for (const commit of commits) {
    const extracted = extractCsvAtCommit(commit.sha);
    if (!extracted) {
      logger.warn(`Commit ${commit.sha.slice(0, 7)}: CSV not present under any known path, skipping.`);
      entriesSkipped++;
      continue;
    }
    const rawBuf = extracted.content;
    if (rawBuf.length === 0) {
      logger.warn(`Commit ${commit.sha.slice(0, 7)}: CSV present at ${extracted.pathAtCommit} but empty, skipping.`);
      entriesSkipped++;
      continue;
    }

    const rawSha = sha256(rawBuf);
    if (seenHashes.has(rawSha)) {
      logger.info(`Commit ${commit.sha.slice(0, 7)}: content identical to prior migrated entry (sha ${rawSha.slice(0, 8)}), skipping.`);
      entriesSkipped++;
      continue;
    }
    seenHashes.add(rawSha);

    // Best-effort provenance recovery.
    const ofcomDateIso = extractOfcomDateFromCommitMessage(commit.message);
    const ofcomHumanFromMsg = commit.message.match(/Ofcom updated:\s*([^,)]+)/i)?.[1]?.trim();
    const preferredKey = archiveKeyForDate(ofcomDateIso, isoToCalendarDay(commit.authorDateIso));
    const finalKey = resolveArchiveKey(preferredKey, rawSha);

    // Parse the historical CSV just to capture shape (column count/names,
    // record count) in the meta. We do NOT sort here - the sort variant lives
    // exclusively at repo-root latest-raw-sorted.csv, not per publication.
    const rawText = rawBuf.toString('utf8');
    let records: CsvRecord[];
    try {
      records = parse(rawText, { columns: true, skip_empty_lines: true }) as CsvRecord[];
    } catch (err) {
      logger.warn(`Commit ${commit.sha.slice(0, 7)}: CSV parse failed (${errorMessage(err)}); archiving raw with unknown shape.`);
      records = [];
    }

    // Deliberately no diff summary for reconstructed entries. See DiffSummary
    // docstring in utils.ts for the rationale.

    // Stage the raw file so computeCsvFileMeta can inspect it, then let
    // writeArchiveEntry write it in the canonical way.
    const stagedDir = path.join(ARCHIVE_DIR, finalKey);
    fsSync.mkdirSync(stagedDir, { recursive: true });
    fsSync.writeFileSync(path.join(stagedDir, 'raw.csv'), rawBuf);

    const meta: ArchiveMeta = {
      schemaVersion: 1,
      sourceKey: OFCOM_AMATEUR_SOURCE_KEY,
      provenance: 'reconstructed-from-git-history',
      fetchedAt: commit.authorDateIso, // best available - the commit's author date
      gitCommitSha: commit.sha,
      reconstructionNotes:
        `Reconstructed from git commit ${commit.sha.slice(0, 7)} (path at commit: ${extracted.pathAtCommit}). ` +
        (ofcomDateIso
          ? `Ofcom-reported publication date extracted from commit message.`
          : `Ofcom-reported publication date unknown; using commit author date (${isoToCalendarDay(commit.authorDateIso)}) as archive key.`),
      files: {
        'raw.csv': computeCsvFileMeta(path.join(stagedDir, 'raw.csv')),
      },
    };
    if (ofcomHumanFromMsg) meta.ofcomReportedUpdate = ofcomHumanFromMsg;
    if (ofcomDateIso) meta.ofcomReportedUpdateIso = ofcomDateIso;

    // Rewrite via writeArchiveEntry so meta.json is created identically to the
    // live path (single canonical writer).
    await writeArchiveEntry(finalKey, {
      'raw.csv': rawBuf,
    }, meta);

    entriesCreated++;
    logger.info(
      `Migrated commit ${commit.sha.slice(0, 7)} -> archive/${finalKey}/ ` +
      `(${records.length} records; ` +
      (ofcomDateIso ? `Ofcom date "${ofcomHumanFromMsg}"` : `commit-date key`) +
      `)`
    );
  }

  logger.info(`Migration complete. Created ${entriesCreated} archive entries; skipped ${entriesSkipped} commits.`);
}

process.on('unhandledRejection', (reason: unknown) => {
  logger.error('Unhandled Rejection at:', reason);
  process.exit(1);
});

main().catch((err: Error) => {
  logger.error('Migration failed:', err);
  process.exit(1);
});
