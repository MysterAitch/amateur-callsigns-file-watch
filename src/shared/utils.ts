import * as fsSync from 'fs';
import * as fs from 'fs/promises';
import * as crypto from 'crypto';
import * as util from 'util';
import * as dotenv from 'dotenv';
import type { DivergenceRecord } from './witness-agreement.ts';

// Load environment variables from .env file
dotenv.config();

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
  // Declared byte length, cross-checked against fs.statSync(...).size by
  // validateArchiveEntry. Named to match the FOI lane's FoiFileDeclaration.bytes
  // (src/shared/foi-archive.ts) - the two schemas assert the identical concept
  // and had drifted to different names with no lane-semantic reason (#683).
  bytes: number;
  sha256: string;
  format?: 'csv' | 'json' | 'sqlite' | 'xlsx' | 'other';
  columnCount?: number;
  columnNames?: string[];
  recordCount?: number;
  // For sorted derivatives: name of the column the data is sorted on.
  sortedBy?: string;
  // Derivation role, mirroring the FOI lane's vocabulary: 'extract' marks a
  // mechanical, hash-pinned projection of a raw file that the normaliser
  // parses in its stead - a sheet extract of a raw workbook, or a shape-only
  // header fill of a CSV whose duplicate empty header names would otherwise
  // collapse under parsing. Absent on ordinary files.
  role?: 'extract';
  // For role 'extract': the raw file this was mechanically derived from.
  extractOf?: string;
  // For role 'extract': the tool that produced it (e.g. src/shared/xlsx-extract.ts).
  extractedBy?: string;
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
  // maintainer retained outside this repository; 'recovered-from-web-archive'
  // entries were retrieved verbatim from a public web archive's capture of the
  // publication (Internet Archive Wayback, UK Government Web Archive) - the
  // capture and replay coordinates live in witnesses[]. Non-live entries may be
  // missing fields (sourceUrl, ?v= value, etc.) that only live fetches capture,
  // and their fetchedAt records the import/retrieval time - reconstructionNotes
  // carries what is known about when and how the bytes were originally obtained.
  provenance: 'live' | 'reconstructed-from-git-history' | 'reconstructed-from-prior-download' | 'recovered-from-web-archive';
  // INTENDED scope of the raw record as published: complete=true means the
  // publisher presented it as the full dataset (e.g. Ofcom's opendata
  // export), complete=false means it is knowingly partial (e.g. an FOI
  // response scoped to a subset of licences, or a visibly truncated
  // publication). Consumers aggregating or diffing across entries must not
  // read missing rows in a partial entry as revocations - they are scope,
  // not change; scopeNotes says what a partial view covers.
  //
  // Deliberately about intent, NOT verified quality (the field name says so):
  // an intended-complete export can still carry data-quality defects (blank
  // fields, suspected missing records) - those are a separate observation
  // axis, not a reason to mark coverage incomplete. Supplied at intake:
  // automatically for opendata exports, at ratification for holding-pen
  // material.
  intendedCoverage?: { complete: boolean; scopeNotes?: string };
  sourceUrl?: string;
  sourceVersionParam?: string;
  ofcomReportedUpdate?: string;
  ofcomReportedUpdateIso?: string;
  fetchedAt: string;
  linkText?: string;
  // For reconstructed entries only: the commit these files were extracted from.
  gitCommitSha?: string;
  reconstructionNotes?: string;
  // Optional explicit converter binding (the FOI lane's model): the default is
  // the lane's registered converter with header auto-detection; an entry whose
  // shape auto-detection cannot distinguish (identical headers, different date
  // rendering) binds its variant here. Verified against the actual headers at
  // conversion time - a wrong binding fails as loudly as an unknown shape.
  converter?: { script?: string; variant?: string };
  // The publication's own URL on the publisher's site (the FOI lane's
  // vocabulary): for recovered-from-web-archive entries this is the ORIGINAL
  // Ofcom URL the archive captured, while witnesses[] carries the capture.
  publicationUrl?: string;
  // Independent copies of this publication and where each was obtained -
  // channel (e.g. 'wayback', 'ukgwa', 'live'), the retrieval/replay URL, and
  // when it was fetched. The FOI lane records these per file; the open-data
  // lane's entry is a single publication, so they sit at entry level.
  //
  // sha256 is the hash of the bytes THAT witness served (#618 increment 3):
  // present where the copy's bytes are verifiable from what the mirror holds,
  // absent where the witness is a location only (citation-grade). Agreement is
  // DERIVED ON READ (src/shared/witness-agreement.ts), never stored.
  // originalFilename records the name the copy carried at its source (#619) -
  // provenance the held filename may have sanitised away.
  witnesses?: { channel: string; url: string; fetchedAt: string; sha256?: string; originalFilename?: string; note?: string }[];
  // Structured records of copies claiming to be this publication that DIFFER
  // from the held copy (#618 increment 4 / #619). A divergent witness (its
  // sha256 matches no held copy) must be paired here, else validation fails.
  // Empty/absent when every witnessed copy is byte-identical to a held one.
  divergences?: DivergenceRecord[];
  files: Record<string, ArchivedFileMeta>;
  diffSummary?: DiffSummary;
  // The verbatim header line(s) of raw.csv (terminators excluded) - makes
  // the line accounting fully explicit: every physical raw line is exactly
  // one of header / data row / ignored line. An array so a future source
  // with multi-row headers (title rows, the FOI-lane preamble pattern)
  // fits without a schema change; today's exports always have exactly one.
  // Written by the retired derivation lane (frozen baseline entries); byte-verified by validate:data, so
  // header drift in a re-fetch is loudly visible. (columnNames records the
  // PARSED header; this records the bytes.)
  headerLines?: { line: number; content: string }[];
  // Raw lines excluded from normalisation as non-data (blank separators,
  // export footers, generated-by stamps) - enumerated against the immutable
  // raw.csv so nothing is dropped silently and the count invariant
  // (raw lines = 1 header + normalised rows + ignored lines) is exact.
  // Written by the retired derivation lane, curated by hand since; absent when the export is clean; every
  // entry re-verified by validate:data (byte match + must-not-be-data).
  ignoredLines?: IgnoredRawLine[];
  // VERIFIED-QUALITY observations - the axis intendedCoverage always
  // promised to keep separate. intendedCoverage records the publisher's
  // INTENT (never retro-edited); this records what we have since found
  // about the data's actual quality. Hand-curated and cited, reviewed like
  // reference data. A coverageAffecting observation means the publication
  // silently omits records it claims to include (the confirmed 2025-06-04
  // blank-product filter) - consumers must then treat its absences like a
  // declared-partial's: not evidence.
  qualityObservations?: QualityObservation[];
}

export interface QualityObservation {
  // ISO date the observation was made (not the data's vintage).
  observedAt: string;
  // One-sentence finding about the data's actual quality.
  statement: string;
  // How it was established: the arithmetic, a link, or an issue reference.
  evidence: string;
  // True when the observation means the publication omits records it
  // claims to include - such absences are not evidence (as for a
  // declared-partial). Absent/false = a quality note that does not affect
  // how absence should be read.
  coverageAffecting?: boolean;
}

export interface IgnoredRawLine {
  // 1-based physical line number in raw.csv.
  line: number;
  // The verbatim line without its terminator (CR/LF are serialisation).
  content: string;
  reason: string;
}

export const logger = {
  debug: (message: string, ...args: unknown[]): void => {
    if (process.env.DEBUG) {
      console.debug(`[${new Date().toISOString()}] [DEBUG] ${message}`, ...args);
    }
  },
  info: (message: string, ...args: unknown[]): void => {
    console.log(`[${new Date().toISOString()}] [INFO] ${message}`, ...args);
  },
  warn: (message: string, ...args: unknown[]): void => {
    console.warn(`[${new Date().toISOString()}] [WARNING] ${message}`, ...args);
  },
  // error accepts unknown because caught values are unknown - callers pass
  // whatever they caught without narrowing ceremony.
  error: (message: string, error: unknown = null, ...args: unknown[]): void => {
    console.error(`[${new Date().toISOString()}] [ERROR] ${message}`, ...args);
    if (error !== null && error !== undefined && process.env.DEBUG) {
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
  } catch (error) {
    logger.error(`Failed to calculate hash for ${filePath}`, error);
    throw new Error(`Hash calculation failed: ${errorMessage(error)}`);
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
  } catch (error) {
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
  } catch (error) {
    logger.error(`Error loading JSON file ${filePath}`, error);
    return null;
  }
}

// Caught values are unknown (anything can be thrown); this is the single
// sanctioned way to get a printable message out of one.
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Single serialisation convention for every JSON file this project writes:
// 2-space indent, trailing newline. Byte-level agreement between writers is
// load-bearing - validateLatestPointers compares latest-meta.json against the
// newest entry's meta.json by hash, so two writers with different conventions
// would produce spurious mismatches and diff churn.
export function serialiseJson<T>(data: T): string {
  return JSON.stringify(data, null, 2) + '\n';
}

export async function saveJsonFile<T>(filePath: string, data: T): Promise<boolean> {
  try {
    await fs.writeFile(filePath, serialiseJson(data));
    logger.debug(`Successfully saved JSON to ${filePath}`);
    return true;
  } catch (error) {
    logger.error(`Error saving JSON file ${filePath}`, error);
    return false;
  }
}

// Sync sibling for callers in synchronous pipelines.
// Throws on failure rather than returning false - sweep callers convert the
// throw into a per-entry failure report.
export function saveJsonFileSync<T>(filePath: string, data: T): void {
  fsSync.writeFileSync(filePath, serialiseJson(data));
}

// sha256 of in-memory content - the sibling of calculateFileHash for content
// that is already in memory (avoids re-reading a file just written).
export function calculateContentHash(content: string | Buffer): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

export function fileExistsAndNotEmpty(filePath: string): boolean {
  try {
    if (!fsSync.existsSync(filePath)) {
      return false;
    }
    const stats = fsSync.statSync(filePath);
    return stats.size > 0;
  } catch (error) {
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
