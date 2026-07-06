import * as fsSync from 'fs';
import * as fs from 'fs/promises';
import * as crypto from 'crypto';
import * as util from 'util';
import * as dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

export const CONSTANTS = {
  FILES: {
    // Staging inbox: scrape-and-download writes the freshly-fetched raw CSV here;
    // process-csv reads from here, produces the archive entry, then updates the
    // latest-* pointers. Kept at a stable path so scrape and process share a handoff.
    originalRawCsvFile: 'amateur-callsigns-raw.csv',

    // Convenience "pointer" copies at repo root - always reflect the newest archive
    // entry. Consumers that just want "the current dataset" read these without
    // walking archive/.
    latestRawCsv: 'latest-raw.csv',
    latestRawSortedCsv: 'latest-raw-sorted.csv',
    latestJson: 'latest.json',
    latestRawSortedJson: 'latest-raw-sorted.json',
    latestMeta: 'latest-meta.json',

    // Per-fetch download context (URL, ?v=, Ofcom-reported date). Written by scrape,
    // read by process to enrich the archive entry's meta.json.
    downloadMetadataFile: 'metadata-download-info.json',

    // Debug: last successfully-fetched HTML page from Ofcom's opendata index.
    htmlOutput: 'ofcom_page.html',
  },
  DIRS: {
    // Per-publication archive. Each subdirectory is one Ofcom publication with
    // raw.csv, raw-sorted.csv, meta.json (and any future derived artefacts).
    archive: 'archive',
  },
  URLS: {
    OFCOM_URL: 'https://www.ofcom.org.uk/about-ofcom/our-research/opendata',
    OFCOM_BASE_URL: 'https://www.ofcom.org.uk'
  },
  SOURCES: {
    // Stable key identifying this source in archive metadata. When we add FOI or
    // other sources, each will have its own key. Do not change without a migration
    // pass over existing archive/*/meta.json files.
    OFCOM_AMATEUR: 'ofcom-amateur-callsigns',
  },
};

export interface FileMetadata {
  name: string;
  size: number;
  lastModified: string;
}

export interface CsvDownloadMetadata {
  url: string;
  ofcomReportedLastUpdate: string;
  linkText: string;
}

export interface ProcessingMetadata {
  originalCsvSize: number;
  originalCsvHash: string;
  sortedCsvSize: number;
  sortedCsvHash: string;
  originalJsonSize: number;
  originalJsonHash: string;
  sortedJsonSize: number;
  sortedJsonHash: string;
  recordCount?: number;
  url?: string;
  ofcomLastUpdate?: string;
  linkText?: string;
}

// Per-file record inside an archive entry's meta.json.
export interface ArchivedFileMeta {
  size: number;
  sha256: string;
  format?: 'csv' | 'json' | 'sqlite' | 'other';
  columnCount?: number;
  columnNames?: string[];
  recordCount?: number;
  // For sorted derivatives: name of the column the data is sorted on.
  sortedBy?: string;
}

// Semantic diff of this publication vs the archive entry immediately preceding
// it in archive-key order AT THE MOMENT THIS META WAS WRITTEN.
//
// SNAPSHOT SEMANTICS - important caveat: this is a point-in-time snapshot, not
// a live view. If entries are later inserted between this one and its previous
// (e.g. a retroactively-discovered publication is dropped into archive/), the
// `previousArchiveKey` referenced here becomes stale relative to current
// archive chronology, but this meta.json is NOT rewritten. Consumers that need
// an authoritative up-to-date diff should re-derive it from the raw CSVs at
// read time, using whichever chronological definition they prefer (there are
// multiple: Ofcom publication date, our fetch date, git-commit date; they do
// not always agree). The persisted diff here is a convenience for notification
// bodies and casual inspection - not a source of truth.
//
// Because of the above ambiguity, diff summaries are NOT computed for
// reconstructed-from-git-history entries: their "previous" is inferred from a
// mixed axis (Ofcom-date and commit-date) that can misorder relative to
// real-world chronology, and the resulting numbers may actively mislead.
// Historical entries get their record counts recorded but no diff.
//
// Sample arrays are capped for readability; the two archive entries themselves
// are the authoritative record.
export interface DiffSummary {
  previousArchiveKey?: string;
  previousRecordCount?: number;
  currentRecordCount: number;
  unchanged?: number;
  fieldChanged?: number;
  added?: number;
  removed?: number;
  sampleAdded?: string[];
  sampleRemoved?: string[];
}

// Options fed to runScrape by the scheduled orchestrator to enable the
// courtesy ?v= fast-path: if the CSV URL's version parameter hasn't changed
// since we last successfully downloaded, and our last verification was
// recent, we skip the ~11 MB download entirely (just fetch the small HTML
// index).
//
// If all three lastKnown* fields are undefined, runScrape treats the state as
// fresh (first run) and does a normal download. That's the migration-safe
// default - existing invocations that don't pass options behave exactly as
// they did before this feature was added.
export interface ScrapeOptions {
  lastKnownV?: string;
  lastKnownVContentHash?: string;
  lastKnownVVerifiedAt?: string; // ISO
  verificationIntervalDays?: number; // default 7
}

// Outcome of runScrape - describes which of the four possible paths it took
// so the orchestrator can update state and decide whether to run process.
//
// downloaded         - v changed (or first-run) -> fresh CSV promoted into staging path
// fast-path-skipped  - v unchanged, verification is fresh -> no download; staging path unchanged
// verified-unchanged - v unchanged, verification stale -> downloaded, hash still matches state
// anomaly-detected   - v unchanged but downloaded content differs from state hash. Staging
//                      path is NOT overwritten in this case; the previous good CSV is preserved.
export interface ScrapeResult {
  action: 'downloaded' | 'fast-path-skipped' | 'verified-unchanged' | 'anomaly-detected';
  currentV?: string;
  contentHash?: string; // sha256 of the raw CSV; present for downloaded/verified/anomaly
  anomalyMessage?: string; // present only for anomaly-detected
}

// Outcome of running the process step - what the caller (scheduled-run
// orchestrator) needs to know to compose git commits and ntfy notifications.
export interface ProcessResult {
  // The archive key that now corresponds to the current raw CSV, whether newly
  // created or matched from a prior entry.
  archiveKey: string;
  // True iff processing created a new archive/{key}/ directory; false if the
  // raw content was already archived and only latest-* pointers were refreshed.
  wasNewArchiveEntry: boolean;
  recordCount: number;
  diffSummary?: DiffSummary;
  ofcomReportedUpdate?: string;
}

// meta.json for one archive/{key}/ entry. schemaVersion lets us evolve the shape
// without a big-bang migration - readers check the version and adapt.
export interface ArchiveMeta {
  schemaVersion: 1;
  sourceKey: string;
  // 'live' entries were fetched by the current codebase; 'reconstructed-from-git-history'
  // entries were materialised retroactively from prior git blobs;
  // 'reconstructed-from-prior-download' entries were imported from downloads the
  // maintainer retained outside this repository. Reconstructed entries of either kind
  // may be missing fields (sourceUrl, ?v= value, etc.) that only live fetches capture,
  // and their fetchedAt records the import time - reconstructionNotes carries what is
  // known about when and how the bytes were originally obtained.
  provenance: 'live' | 'reconstructed-from-git-history' | 'reconstructed-from-prior-download';
  sourceUrl?: string;
  sourceVersionParam?: string;
  ofcomReportedUpdate?: string;
  ofcomReportedUpdateIso?: string;
  fetchedAt: string;
  linkText?: string;
  // For reconstructed entries only: the commit these files were extracted from.
  gitCommitSha?: string;
  reconstructionNotes?: string;
  files: Record<string, ArchivedFileMeta>;
  diffSummary?: DiffSummary;
}

export const logger = {
  debug: (message: string, ...args: any[]): void => {
    if (process.env.DEBUG) {
      console.debug(`[${new Date().toISOString()}] [DEBUG] ${message}`, ...args);
    }
  },
  info: (message: string, ...args: any[]): void => {
    console.log(`[${new Date().toISOString()}] [INFO] ${message}`, ...args);
  },
  warn: (message: string, ...args: any[]): void => {
    console.warn(`[${new Date().toISOString()}] [WARNING] ${message}`, ...args);
  },
  error: (message: string, error: Error | null = null, ...args: any[]): void => {
    console.error(`[${new Date().toISOString()}] [ERROR] ${message}`, ...args);
    if (error && process.env.DEBUG) {
      console.error(util.inspect(error, { depth: null, colors: true }));
    }
  }
};

export function calculateFileHash(filePath: string): string {
  try {
    const fileBuffer = fsSync.readFileSync(filePath);
    const hashSum = crypto.createHash('sha256');
    hashSum.update(fileBuffer);
    return hashSum.digest('hex');
  } catch (error: any) {
    logger.error(`Failed to calculate hash for ${filePath}`, error);
    throw new Error(`Hash calculation failed: ${error.message}`);
  }
}

export function getFileMetadata(pattern: string | RegExp | null = null): FileMetadata[] {
  try {
    const matchPattern = pattern || /amateur-callsigns|metadata/;

    const files = fsSync.readdirSync('.')
      .filter(file => file.match(matchPattern))
      .map(file => {
        const stats = fsSync.statSync(file);
        return {
          name: file,
          size: stats.size,
          lastModified: stats.mtime.toISOString()
        };
      });
    return files;
  } catch (error: any) {
    logger.error('Error getting file information', error);
    return [];
  }
}

export async function loadJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    if (!fsSync.existsSync(filePath)) {
      logger.warn(`File does not exist: ${filePath}`);
      return null;
    }
    const content = await fs.readFile(filePath, 'utf8');
    return JSON.parse(content) as T;
  } catch (error: any) {
    logger.error(`Error loading JSON file ${filePath}`, error);
    return null;
  }
}

export async function saveJsonFile<T>(filePath: string, data: T): Promise<boolean> {
  try {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
    logger.debug(`Successfully saved JSON to ${filePath}`);
    return true;
  } catch (error: any) {
    logger.error(`Error saving JSON file ${filePath}`, error);
    return false;
  }
}

export function fileExistsAndNotEmpty(filePath: string): boolean {
  try {
    if (!fsSync.existsSync(filePath)) {
      return false;
    }
    const stats = fsSync.statSync(filePath);
    return stats.size > 0;
  } catch (error: any) {
    logger.error(`Error checking file ${filePath}`, error);
    return false;
  }
}

export function formatFileSize(bytes: number, decimals: number = 2): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}
