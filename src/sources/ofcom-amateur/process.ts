#!/usr/bin/env node

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import {
  calculateFileHash,
  loadJsonFile,
  saveJsonFile,
  CONSTANTS,
  logger,
  fileExistsAndNotEmpty,
  formatFileSize,
  CsvDownloadMetadata,
  ArchiveMeta,
  ProcessResult,
} from '../../shared/utils';
import {
  archiveKeyForDate,
  parseOfcomHumanDate,
  resolveArchiveKey,
  writeArchiveEntry,
  writeLatestPointers,
  computeCsvFileMeta,
  buildDiffSummary,
  readPreviousArchiveRecords,
  listArchiveKeys,
} from '../../shared/archive';

const FILES = CONSTANTS.FILES;
const ARCHIVE_DIR = CONSTANTS.DIRS.archive;

interface CsvRecord {
  [key: string]: string;
}

/**
 * Given a raw CSV staged at FILES.originalRawCsvFile plus the sidecar download
 * metadata (URL, ?v=, Ofcom-reported date), materialise the archive entry
 * (raw.csv + raw-sorted.csv + meta.json) and refresh the repo-root `latest-*` pointers.
 *
 * Idempotent: if the raw content is already archived (same sha256), no new entry
 * is created; latest-* pointers are still refreshed to that entry so downstream
 * consumers see a consistent "current" view.
 */
async function processStagedCsv(downloadMetadata: CsvDownloadMetadata | null): Promise<ProcessResult> {
  if (!fileExistsAndNotEmpty(FILES.originalRawCsvFile)) {
    throw new Error(`${FILES.originalRawCsvFile} not found or empty. Run the scrape step first.`);
  }

  const rawSha = calculateFileHash(FILES.originalRawCsvFile);
  logger.info(`Raw CSV size: ${formatFileSize(fsSync.statSync(FILES.originalRawCsvFile).size)}, sha256: ${rawSha}`);

  // Parse + sort. The sort is deterministic per current sort policy (first column,
  // case-insensitive locale compare) so the sorted CSV is a well-defined derivative.
  //
  // Sort primarily for git-diff readability. Ofcom's publication row order is not
  // stable between publications, so a git diff of raw-vs-raw is unreadable noise
  // (huge apparent churn from re-ordered rows). Diffing sorted-vs-sorted collapses
  // to the actual semantic changes (added, removed, field-updated rows) at their
  // callsign-neighbourhood. Not strictly required for correctness - buildDiffSummary
  // already computes the semantic diff independently - but the derivative pays for
  // itself the moment anyone inspects the archive in a git viewer.
  //
  // We parse before the idempotence check because latest.json / latest-sorted.json
  // pointers are regenerated on every run (they are not archived per publication),
  // and require the parsed records regardless of whether a new archive entry is
  // being created.
  const rawContent = await fs.readFile(FILES.originalRawCsvFile, 'utf8');
  const records = parse(rawContent, {
    columns: true,
    skip_empty_lines: true,
  }) as CsvRecord[];

  if (records.length === 0) {
    throw new Error('Parsed raw CSV is empty - refusing to archive an empty publication.');
  }

  const firstColumn = Object.keys(records[0])[0];
  const sortedRecords = [...records].sort((a, b) =>
    String(a[firstColumn] ?? '').toLowerCase().localeCompare(String(b[firstColumn] ?? '').toLowerCase())
  );
  const sortedContent = stringify(sortedRecords, {
    header: true,
    columns: Object.keys(records[0]),
  });

  // Idempotence check first (cheap - only hashes existing archive entries). If
  // the current content is already archived, short-circuit before the more
  // expensive previous-archive read below.
  const existingKey = findArchiveKeyByRawHash(rawSha);
  if (existingKey) {
    logger.info(`Raw content already archived at archive/${existingKey}/ - no new entry needed.`);
    const newest = newestArchiveKey();
    if (newest) await writeLatestPointers(newest);
    await fs.writeFile(FILES.latestRawSortedCsv, sortedContent);
    await writeLatestJsonDerivatives(records, sortedRecords);
    const existingMeta = await loadJsonFile<ArchiveMeta>(path.join(ARCHIVE_DIR, existingKey, 'meta.json'));
    return {
      archiveKey: existingKey,
      wasNewArchiveEntry: false,
      recordCount: records.length,
      ofcomReportedUpdate: existingMeta?.ofcomReportedUpdate,
    };
  }

  // Read previous archive ONCE - used for both the regression guard AND the
  // diff summary. Avoids parsing ~11 MB of previous raw twice on every real
  // publication.
  const previous = readPreviousArchiveRecords('');

  // Record-count regression guard. Ofcom has historically shipped truncated /
  // filtered publications (e.g. the May 2025 entry with 1074 records vs the
  // surrounding ~150k). A CSV that has valid headers AND parses cleanly can
  // still be semantically wrong. Refuse anything that drops by more than
  // REGRESSION_THRESHOLD_FRACTION vs the previous archived record count. The
  // orchestrator's failure escalation surfaces this as a HIGH ntfy so Roger
  // knows to investigate rather than silently mirroring a bad publication.
  const REGRESSION_THRESHOLD_FRACTION = 0.5;
  if (previous && previous.records.length > 0) {
    const ratio = records.length / previous.records.length;
    if (ratio < REGRESSION_THRESHOLD_FRACTION) {
      throw new Error(
        `Record count regression: current publication has ${records.length} records ` +
        `vs previous archive/${previous.key}/ with ${previous.records.length} ` +
        `(${(ratio * 100).toFixed(1)}% - below ${(REGRESSION_THRESHOLD_FRACTION * 100)}% threshold). ` +
        `Possible bad Ofcom publication - refusing to archive; manual review required.`
      );
    }
  }

  // Diff summary vs the previous archive entry (if any). Semantic diff (added /
  // removed / fieldChanged), tolerant of sort-order differences between publications.
  const diffSummary = buildDiffSummary(
    records,
    previous ? previous.records : null,
    previous ? previous.key : undefined,
  );

  // Determine the archive directory name. Prefer Ofcom's own publication date
  // (human-meaningful, sortable). Falls back to today's date if Ofcom didn't
  // report one. Handles collisions (re-publication on the same date with
  // different content) by appending a short hash suffix.
  const ofcomDateIso = parseOfcomHumanDate(downloadMetadata?.ofcomReportedLastUpdate);
  const preferredKey = archiveKeyForDate(ofcomDateIso, todayIso());
  const finalKey = resolveArchiveKey(preferredKey, rawSha);
  if (finalKey !== preferredKey) {
    logger.warn(`Archive key collision: ${preferredKey} already exists with different content; using ${finalKey}`);
  }

  // Only raw.csv is archived per-publication. The sort variant lives ONLY at
  // latest-raw-sorted.csv - inside archive/{key}/ it would have no git-diff
  // value (every archive entry is a new directory, not a modification). All
  // git-diff readability lives at latest-raw-sorted.csv which IS modified
  // across publications. See writeLatestPointers in archive.ts for rationale.
  const rawFileMeta = computeCsvFileMeta(FILES.originalRawCsvFile);

  const meta: ArchiveMeta = {
    schemaVersion: 1,
    sourceKey: CONSTANTS.SOURCES.OFCOM_AMATEUR,
    provenance: 'live',
    // Ofcom's opendata export is published as the full callsign population,
    // not a scoped subset - unlike e.g. FOI responses, which declare their
    // scope at intake. Intent, not verified quality.
    intendedCoverage: { complete: true },
    fetchedAt: new Date().toISOString(),
    files: {
      'raw.csv': rawFileMeta,
    },
    diffSummary,
  };
  if (downloadMetadata) {
    if (downloadMetadata.url) meta.sourceUrl = downloadMetadata.url;
    if (downloadMetadata.ofcomReportedLastUpdate) meta.ofcomReportedUpdate = downloadMetadata.ofcomReportedLastUpdate;
    if (ofcomDateIso) meta.ofcomReportedUpdateIso = ofcomDateIso;
    if (downloadMetadata.linkText) meta.linkText = downloadMetadata.linkText;
    const vParam = extractVersionParam(downloadMetadata.url);
    if (vParam) meta.sourceVersionParam = vParam;
  }

  await writeArchiveEntry(finalKey, {
    'raw.csv': await fs.readFile(FILES.originalRawCsvFile),
  }, meta);

  await writeLatestPointers(finalKey);
  // The sort variant and JSON derivatives are computed once from the in-memory
  // records here and written directly to latest-* - regenerated on every process
  // run, never archived per-publication.
  await fs.writeFile(FILES.latestRawSortedCsv, sortedContent);
  await writeLatestJsonDerivatives(records, sortedRecords);

  logger.info(`Archived publication as archive/${finalKey}/ (${records.length} records)`);
  if (diffSummary.previousArchiveKey) {
    const d = diffSummary;
    logger.info(
      `Diff vs archive/${d.previousArchiveKey}/: ` +
      `${d.unchanged ?? 0} unchanged, ${d.fieldChanged ?? 0} field-changed, ` +
      `${d.added ?? 0} added, ${d.removed ?? 0} removed`
    );
  } else {
    logger.info('No previous archive entry to diff against; this is the first live entry (or the migration seeded this one).');
  }

  return {
    archiveKey: finalKey,
    wasNewArchiveEntry: true,
    recordCount: records.length,
    diffSummary,
    ofcomReportedUpdate: meta.ofcomReportedUpdate,
  };
}

// JSON derivatives are convenience artefacts for consumers that want to skip
// CSV parsing. They are NOT archived per publication (per current policy: they
// carry no information the CSVs don't, and would double repo growth); they only
// live as latest-* pointers, regenerated on every process run.
async function writeLatestJsonDerivatives(records: CsvRecord[], sortedRecords: CsvRecord[]): Promise<void> {
  await saveJsonFile(FILES.latestJson, records);
  await saveJsonFile(FILES.latestRawSortedJson, sortedRecords);
}

// Look up an archive key by its raw.csv sha256, so identical content is not
// re-archived under a new key.
function findArchiveKeyByRawHash(rawSha: string): string | null {
  for (const key of listArchiveKeys()) {
    const rawPath = path.join(ARCHIVE_DIR, key, 'raw.csv');
    if (fsSync.existsSync(rawPath) && calculateFileHash(rawPath) === rawSha) return key;
  }
  return null;
}

function newestArchiveKey(): string | null {
  const keys = listArchiveKeys();
  return keys.length > 0 ? keys[keys.length - 1] : null;
}

function todayIso(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

// Extract the ?v= query parameter from Ofcom's cache-busted CSV URL, so it can be
// recorded in the archive meta.json for later verification / anomaly detection.
function extractVersionParam(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const m = url.match(/[?&]v=([^&]+)/);
  return m ? m[1] : undefined;
}

/**
 * Read the staged raw CSV, produce the archive entry (if new content) and
 * refresh `latest-*` pointers. Idempotent - returns the archive key it landed
 * on and whether that was a fresh entry, so orchestrator code can decide
 * whether to commit + notify.
 *
 * Callable from the scheduled-run orchestrator as well as from `npm run process`.
 * Throws on failure; does not call process.exit itself.
 */
export async function runProcess(): Promise<ProcessResult> {
  logger.info('Starting amateur callsigns CSV processing');

  const downloadMetadata = await loadJsonFile<CsvDownloadMetadata>(FILES.downloadMetadataFile);
  if (downloadMetadata) {
    logger.info(`Download metadata found. URL: ${downloadMetadata.url}`);
    logger.info(`Ofcom-reported last updated date: ${downloadMetadata.ofcomReportedLastUpdate}`);
  } else {
    logger.warn(`${FILES.downloadMetadataFile} not found. Archive meta will be missing provenance fields.`);
  }

  const result = await processStagedCsv(downloadMetadata);
  logger.info('Processing complete.');
  return result;
}

if (require.main === module) {
  process.on('unhandledRejection', (reason: unknown) => {
    logger.error('Unhandled Rejection at:', reason);
    process.exit(1);
  });

  runProcess().catch((err: Error) => {
    logger.error(`Processing failed: ${err.message}`, err);
    process.exit(1);
  });
}
