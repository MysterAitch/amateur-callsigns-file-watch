import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';
import {
  type ArchiveMeta,
  type ArchivedFileMeta,
  type DiffSummary,
  CONSTANTS,
  calculateFileHash,
  logger,
  saveJsonFile,
  loadJsonFile,
} from './utils.ts';

const ARCHIVE_DIR = CONSTANTS.DIRS.archive;

// Directory name for one publication. Prefers Ofcom's own publication date
// (human-meaningful, sorts chronologically); falls back to a supplied string
// when Ofcom-date is unavailable (reconstructed historical entries).
export function archiveKeyForDate(ofcomDateIso: string | undefined, fallback: string): string {
  return (ofcomDateIso && ofcomDateIso.trim()) || fallback;
}

// Parse Ofcom's human date (e.g. "23 June 2026", "4 June 2025") to ISO YYYY-MM-DD.
// Returns undefined for unparseable input rather than guessing.
export function parseOfcomHumanDate(input: string | undefined | null): string | undefined {
  if (!input) return undefined;
  const trimmed = input.trim();
  // e.g. "23 June 2026" or "4 June 2025"
  const m = trimmed.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (!m) return undefined;
  const day = parseInt(m[1], 10);
  const monthName = m[2].toLowerCase();
  const year = parseInt(m[3], 10);
  const months: Record<string, number> = {
    january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
    july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  };
  const month = months[monthName];
  if (!month || day < 1 || day > 31) return undefined;
  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
}

// Extract "Ofcom updated: 23 June 2026" from a commit message body.
export function extractOfcomDateFromCommitMessage(commitMsg: string): string | undefined {
  const m = commitMsg.match(/Ofcom updated:\s*([^,)]+)/i);
  if (!m) return undefined;
  return parseOfcomHumanDate(m[1]);
}

export interface CsvShape {
  columnCount: number;
  columnNames: string[];
  recordCount: number;
}

// Read a CSV file's shape (columns and record count) without loading the full
// dataset into memory more than once. Used both by live processing and by the
// historical migration script.
export function inspectCsvShape(filePath: string): CsvShape {
  const csvContent = fsSync.readFileSync(filePath, 'utf8');
  const parsed = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
  }) as Array<Record<string, string>>;
  const columnNames = parsed.length > 0 ? Object.keys(parsed[0]) : [];
  return {
    columnCount: columnNames.length,
    columnNames,
    recordCount: parsed.length,
  };
}

export function computeCsvFileMeta(filePath: string, sortedBy?: string): ArchivedFileMeta {
  const size = fsSync.statSync(filePath).size;
  const sha256 = calculateFileHash(filePath);
  const shape = inspectCsvShape(filePath);
  const meta: ArchivedFileMeta = {
    size,
    sha256,
    format: 'csv',
    columnCount: shape.columnCount,
    columnNames: shape.columnNames,
    recordCount: shape.recordCount,
  };
  if (sortedBy) meta.sortedBy = sortedBy;
  return meta;
}

export function computeJsonFileMeta(filePath: string): ArchivedFileMeta {
  return {
    size: fsSync.statSync(filePath).size,
    sha256: calculateFileHash(filePath),
    format: 'json',
  };
}

// Materialise one archive entry: create archive/{key}/, write files, write meta.json.
// If an entry already exists at that key, its contents are overwritten - the caller
// is responsible for collision handling if that matters (see resolveArchiveKey).
export async function writeArchiveEntry(
  key: string,
  files: Record<string, string | Buffer>,
  meta: ArchiveMeta,
): Promise<string> {
  const dir = path.join(ARCHIVE_DIR, key);
  await fs.mkdir(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    await fs.writeFile(path.join(dir, name), content);
  }
  await saveJsonFile(path.join(dir, 'meta.json'), meta);
  logger.info(`Wrote archive entry: ${dir}`);
  return dir;
}

// Handle the case where two publications end up wanting the same archive key
// (e.g. Ofcom re-publishes on the same date with different content). Appends a
// short content-hash suffix so both are preserved.
export function resolveArchiveKey(preferredKey: string, contentHash: string): string {
  const dir = path.join(ARCHIVE_DIR, preferredKey);
  if (!fsSync.existsSync(dir)) return preferredKey;
  const existingRawPath = path.join(dir, 'raw.csv');
  if (fsSync.existsSync(existingRawPath)) {
    const existingHash = calculateFileHash(existingRawPath);
    if (existingHash === contentHash) return preferredKey; // same content, safe to overwrite/no-op
  }
  return `${preferredKey}--${contentHash.slice(0, 8)}`;
}

export async function readArchiveMeta(key: string): Promise<ArchiveMeta | null> {
  const metaPath = path.join(ARCHIVE_DIR, key, 'meta.json');
  return loadJsonFile<ArchiveMeta>(metaPath);
}

// Open-data lane keys are publication dates, optionally content-hash
// suffixed on same-date collisions (2025-06-04--0a1b2c). Anything else
// under archive/ belongs to another lane (ADR 0004: archive/foi/) and must
// never surface here - a non-date key would hijack newest-entry logic
// (latest pointers, sweep coverage).
const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}(--[0-9a-f]+)?$/;

// Returns archive keys in chronological order (lexicographic works because keys are
// ISO dates, optionally with content-hash suffix which orders stably within a date).
export function listArchiveKeys(): string[] {
  if (!fsSync.existsSync(ARCHIVE_DIR)) return [];
  return fsSync.readdirSync(ARCHIVE_DIR)
    .filter(name => DATE_KEY_RE.test(name) && fsSync.statSync(path.join(ARCHIVE_DIR, name)).isDirectory())
    .sort();
}

// Copy the newest archive entry's raw.csv into the repo-root `latest-raw.csv`
// pointer file, and write `latest-meta.json` mirroring its meta. Sort/JSON
// derivatives are NOT copied - they are regenerated by process-csv.ts from the
// parsed records (which it has in memory anyway) and written directly to root.
//
// Rationale: per-publication sort derivatives inside archive/{key}/ have zero
// git-diff value because each archive entry is a brand-new directory on commit
// (there's nothing to diff against). All the git-diff readability of "what
// changed between publications" lives at latest-raw-sorted.csv, which IS
// modified on each publication. So we don't waste ~11 MB per publication
// archiving a sort variant that no consumer benefits from.
//
// Normalisation output (future) is a different case - normalisation logic
// evolves, so archive/{key}/normalised.csv preserves point-in-time output.
// Sort logic is stable, so the sort variant doesn't need archiving.
export async function writeLatestPointers(key: string): Promise<void> {
  const src = path.join(ARCHIVE_DIR, key);
  const meta = await readArchiveMeta(key);
  if (!meta) {
    throw new Error(`Cannot write latest pointers: no meta.json at ${src}`);
  }

  const F = CONSTANTS.FILES;
  await fs.copyFile(path.join(src, 'raw.csv'), F.latestRawCsv);
  await saveJsonFile(F.latestMeta, meta);
  logger.info(`Updated latest-raw.csv and latest-meta.json from archive/${key}`);
}

interface CsvRecord {
  [key: string]: string;
}

// Compute a callsign-keyed semantic diff between the newest publication and the
// previous one. "unchanged" and "fieldChanged" are computed per primary-key row;
// "added" and "removed" are set differences on the primary key.
//
// Assumes the first column of each dataset is the primary key (callsign) - true
// for Ofcom's amateur CSV. Robust to different sort orders in the two files.
export function buildDiffSummary(
  currentRecords: CsvRecord[],
  previousRecords: CsvRecord[] | null,
  previousArchiveKey: string | undefined,
  sampleSize = 5,
): DiffSummary {
  const summary: DiffSummary = {
    currentRecordCount: currentRecords.length,
  };
  if (previousArchiveKey) summary.previousArchiveKey = previousArchiveKey;
  if (!previousRecords) return summary;

  summary.previousRecordCount = previousRecords.length;

  const pk = (r: CsvRecord): string => {
    const firstKey = Object.keys(r)[0];
    return String(r[firstKey] ?? '');
  };

  const prevByKey = new Map<string, CsvRecord>();
  for (const r of previousRecords) prevByKey.set(pk(r), r);
  const currByKey = new Map<string, CsvRecord>();
  for (const r of currentRecords) currByKey.set(pk(r), r);

  let unchanged = 0;
  let fieldChanged = 0;
  const added: string[] = [];
  const removed: string[] = [];

  for (const [key, curr] of currByKey) {
    const prev = prevByKey.get(key);
    if (!prev) {
      added.push(key);
      continue;
    }
    if (recordsEqual(curr, prev)) unchanged++;
    else fieldChanged++;
  }
  for (const key of prevByKey.keys()) {
    if (!currByKey.has(key)) removed.push(key);
  }

  summary.unchanged = unchanged;
  summary.fieldChanged = fieldChanged;
  summary.added = added.length;
  summary.removed = removed.length;
  if (added.length > 0) summary.sampleAdded = added.slice(0, sampleSize);
  if (removed.length > 0) summary.sampleRemoved = removed.slice(0, sampleSize);
  return summary;
}

function recordsEqual(a: Record<string, string>, b: Record<string, string>): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}

// Read the previous archive entry's raw.csv (if any) as parsed records, for diffing.
// Returns { records, key } or null if there is no prior entry.
export function readPreviousArchiveRecords(excludingKey: string): { records: CsvRecord[]; key: string } | null {
  const keys = listArchiveKeys().filter(k => k !== excludingKey);
  if (keys.length === 0) return null;
  const previousKey = keys[keys.length - 1];
  const rawPath = path.join(ARCHIVE_DIR, previousKey, 'raw.csv');
  if (!fsSync.existsSync(rawPath)) return null;
  const content = fsSync.readFileSync(rawPath, 'utf8');
  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
  }) as CsvRecord[];
  return { records, key: previousKey };
}
