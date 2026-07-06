#!/usr/bin/env node

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import axios from 'axios';
import { JSDOM } from 'jsdom';
import {
  calculateFileHash,
  loadJsonFile,
  saveJsonFile,
  CONSTANTS,
  logger,
  fileExistsAndNotEmpty,
  formatFileSize,
  CsvDownloadMetadata,
  ScrapeOptions,
  ScrapeResult,
} from './utils';

// Constants
const { OFCOM_URL, OFCOM_BASE_URL } = CONSTANTS.URLS;
const OUTPUT_FILES = CONSTANTS.FILES;

// Browser-like headers to avoid bot-detection / WAF 403s.
// Ofcom's site blocks requests that look automated (e.g. User-Agent: axios/x.y.z).
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-GB,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
};

interface HtmlLinkDetails {
  href: string;
  text: string;
  element: Element;
}

async function downloadFile(url: string, outputPath: string): Promise<void> {
  try {
    logger.info(`Downloading: ${url} to ${outputPath}`);
    const response = await axios({
      method: 'GET',
      url,
      responseType: 'stream',
      timeout: 30000,
      headers: BROWSER_HEADERS,
    });

    const writer = fsSync.createWriteStream(outputPath);
    response.data.pipe(writer);

    return new Promise<void>((resolve, reject) => {
      writer.on('finish', () => {
        logger.debug(`Download complete: ${outputPath}`);
        resolve();
      });
      writer.on('error', (err) => {
        logger.error(`Error writing to file: ${outputPath}`, err);
        reject(err);
      });
    });
  } catch (error: any) {
    logger.error(`Download failed: ${url}`, error);
    throw new Error(`Failed to download file: ${error.message}`);
  }
}

/**
 * Find the amateur callsign CSV link on the page (expects exactly one match).
 *
 * IMPORTANT - why this is not a simple "href contains 'amateur'" match:
 * Ofcom files BOTH the amateur callsign CSV and the Business Radio (BR) Light
 * licences CSV under the SAME path prefix:
 *   /siteassets/resources/documents/manage-your-licence/amateur/amateur-callsign-list.csv   <- WANT
 *   /siteassets/resources/documents/manage-your-licence/amateur/live-br-light-licences.csv  <- DO NOT WANT
 * So the path contains "amateur" for the business-radio file too. Matching on
 * the path substring grabs the wrong dataset (a valid CSV, so size/header
 * checks won't catch it). We therefore select on the human-meaningful signals
 * Ofcom controls deliberately:
 *   1. the visible LINK TEXT  (e.g. "Amateur radio call signs")
 *   2. the FILENAME           (e.g. "amateur-callsign-list.csv")
 * and we explicitly EXCLUDE business-radio markers as a safety net.
 *
 * If the page structure changes such that we match zero or more-than-one link,
 * we throw loudly rather than silently grabbing a neighbour.
 */
function findCsvLink(document: Document): HtmlLinkDetails {
  logger.info("Searching for amateur callsigns CSV link...");

  // Tokens that POSITIVELY identify the amateur callsign list.
  const FILENAME_MUST_INCLUDE = 'amateur-callsign-list';      // distinctive filename stem
  const LINKTEXT_MUST_INCLUDE = 'amateur radio call sign';    // distinctive visible label (singular-tolerant)
  // Tokens that identify the WRONG (business radio) dataset, used to exclude.
  const EXCLUDE_FILENAME_TOKENS = ['br-light', 'business-radio', 'business radio'];
  const EXCLUDE_LINKTEXT_TOKENS = ['business radio', 'br light'];

  const getFilename = (href: string): string => {
    // Strip query string and take the last path segment, lower-cased.
    const noQuery = href.split('?')[0];
    const segment = noQuery.substring(noQuery.lastIndexOf('/') + 1);
    return segment.toLowerCase();
  };

  const candidates: HtmlLinkDetails[] = [];
  const rejected: { href: string; text: string; reason: string }[] = [];

  const links = document.querySelectorAll('a');
  links.forEach(element => {
    const href = element.getAttribute('href');
    if (!href) return;

    const hrefLower = href.toLowerCase();
    if (!hrefLower.includes('.csv')) return; // only care about CSV links

    const linkText = (element.textContent || '').trim();
    const linkTextLower = linkText.toLowerCase();
    const filename = getFilename(href);

    // Positive identification: require BOTH the filename stem AND the link text
    // to indicate the amateur callsign list. Requiring both makes an accidental
    // match on a future, differently-named file far less likely.
    const filenameMatches = filename.includes(FILENAME_MUST_INCLUDE);
    const linkTextMatches = linkTextLower.includes(LINKTEXT_MUST_INCLUDE);

    // Negative identification: reject anything that looks like business radio.
    const looksLikeBusinessRadio =
      EXCLUDE_FILENAME_TOKENS.some(t => filename.includes(t)) ||
      EXCLUDE_LINKTEXT_TOKENS.some(t => linkTextLower.includes(t));

    if (looksLikeBusinessRadio) {
      rejected.push({ href, text: linkText, reason: 'matched business-radio exclusion' });
      return;
    }

    if (filenameMatches && linkTextMatches) {
      logger.debug("Candidate amateur CSV link:", href, "text:", linkText);
      candidates.push({ href, text: linkText, element });
    } else if (filenameMatches || linkTextMatches) {
      // Partial match: record it so a structure change is diagnosable, but don't accept it.
      rejected.push({
        href,
        text: linkText,
        reason: `partial match (filename=${filenameMatches}, linkText=${linkTextMatches})`,
      });
    }
  });

  if (candidates.length === 0) {
    logger.error("No amateur callsign CSV link found!");
    if (rejected.length > 0) {
      logger.error("Near-misses (for diagnosis):", null,
        rejected.map(r => `${r.text || '(no text)'} [${r.href}] - ${r.reason}`));
    }
    throw new Error(
      "No amateur callsign CSV link found on the Ofcom open data page. " +
      "The page structure or naming may have changed - inspect the saved HTML."
    );
  }

  if (candidates.length > 1) {
    logger.error(`Found ${candidates.length} amateur callsign CSV candidates, expected exactly one.`);
    logger.error("Candidates:", null, candidates.map(c => `${c.text} [${c.href}]`));
    throw new Error(
      `Found ${candidates.length} amateur callsign CSV candidates, expected exactly one. ` +
      "Refusing to guess - inspect the saved HTML."
    );
  }

  logger.info("Found the amateur callsigns CSV link:", candidates[0].href);
  logger.info("  (link text: '" + candidates[0].text + "')");
  return candidates[0];
}

/**
 * Validate that a freshly-downloaded file really is the amateur callsign CSV,
 * BEFORE we treat it as good data (hash/commit/process).
 *
 * Guards against two failure modes seen or anticipated in this project:
 *   (a) A Cloudflare "Just a moment..." challenge page saved as if it were CSV
 *       (small HTML file, no valid header).
 *   (b) The WRONG dataset (e.g. business radio) downloaded - a valid CSV, so a
 *       size check alone won't catch it; we assert the expected header columns.
 *
 * Throws on failure so the caller can abort without overwriting good data.
 */
function verifyAmateurCsv(filePath: string): void {
  const EXPECTED_HEADER_TOKENS = ['callsign', 'status']; // tolerant of column reordering/renames
  const MIN_BYTES = 100 * 1024; // real file is ~10 MB; a challenge page is a few KB

  if (!fileExistsAndNotEmpty(filePath)) {
    throw new Error(`Downloaded file missing or empty: ${filePath}`);
  }

  const stats = fsSync.statSync(filePath);
  if (stats.size < MIN_BYTES) {
    throw new Error(
      `Downloaded file is suspiciously small (${formatFileSize(stats.size)}, ` +
      `expected >= ${formatFileSize(MIN_BYTES)}). Likely a challenge page or truncated download, not the CSV.`
    );
  }

  // Read just the first line to validate the header (avoid loading ~10 MB).
  const fd = fsSync.openSync(filePath, 'r');
  let firstLine = '';
  try {
    const buf = Buffer.alloc(4096);
    const bytesRead = fsSync.readSync(fd, buf, 0, buf.length, 0);
    const chunk = buf.toString('utf8', 0, bytesRead).replace(/^\uFEFF/, ''); // strip BOM
    firstLine = (chunk.split(/\r?\n/)[0] || '').toLowerCase();
  } finally {
    fsSync.closeSync(fd);
  }

  // Reject obvious challenge/HTML content.
  if (firstLine.includes('<!doctype') || firstLine.includes('<html') || firstLine.includes('just a moment')) {
    throw new Error(
      "Downloaded file looks like an HTML/challenge page, not CSV. Aborting before overwriting good data."
    );
  }

  const missing = EXPECTED_HEADER_TOKENS.filter(tok => !firstLine.includes(tok));
  if (missing.length > 0) {
    throw new Error(
      `Downloaded CSV header missing expected column(s) [${missing.join(', ')}]. ` +
      `Got header: "${firstLine}". This may be the wrong dataset - aborting.`
    );
  }

  logger.info("Sanity check passed: file looks like the amateur callsign CSV.");
}

function extractUpdateDateFromHtmlTable(linkElement: Element): string | null {
  let element: Element | null = linkElement;
  let tableRow: Element | null = null;

  while (element && element.tagName !== 'TR') {
    element = element.parentElement;
    if (element && element.tagName === 'TR') {
      tableRow = element;
      break;
    }
  }

  if (tableRow) {
    const cells = tableRow.querySelectorAll('td');
    if (cells.length > 1) {
      const date = cells[1].textContent?.trim() || null;
      if (date) {
        logger.debug(`Found date from table: ${date}`);
        return date;
      }
    }
  }

  logger.info("Could not find date in table");
  return null;
}

// Extract the ?v= query parameter from the CSV URL. Ofcom uses this as a
// cache-buster - when the underlying content changes the value bumps, which
// makes it a cheap "did anything change?" signal without downloading the
// full 11 MB CSV.
export function extractVersionParam(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const m = url.match(/[?&]v=([^&]+)/);
  return m ? m[1] : undefined;
}

const DEFAULT_VERIFICATION_INTERVAL_DAYS = 7;

export type VersionCheckPath =
  | 'download-new'          // first run, or v changed - always download
  | 'skip-fast-path'        // v unchanged and verification is fresh
  | 'download-and-verify';  // v unchanged but verification is stale - re-download to confirm

/**
 * Pure decision function: given the observed v and the last-known state, which
 * of the three paths should scrape take? Extracted from runScrape so it is
 * exhaustively testable without any network or filesystem setup.
 */
export function decideVersionCheckPath(
  currentV: string | undefined,
  options: ScrapeOptions | undefined,
  now: Date,
): VersionCheckPath {
  const opts = options ?? {};
  // No prior state (fresh install, or `?v=` wasn't extractable from the URL):
  // fall through to the normal download path.
  if (!opts.lastKnownV || !opts.lastKnownVContentHash || !opts.lastKnownVVerifiedAt) {
    return 'download-new';
  }
  if (!currentV) return 'download-new';
  if (currentV !== opts.lastKnownV) return 'download-new';

  // Same v - either fast-path or verify depending on staleness.
  const intervalDays = opts.verificationIntervalDays ?? DEFAULT_VERIFICATION_INTERVAL_DAYS;
  const verifiedAt = new Date(opts.lastKnownVVerifiedAt);
  const ageDays = (now.getTime() - verifiedAt.getTime()) / (1000 * 60 * 60 * 24);
  return ageDays >= intervalDays ? 'download-and-verify' : 'skip-fast-path';
}

function buildAbsoluteOfcomUrl(url: string): string {
  if (url.match(/^https?:\/\//)) {
    return url;
  }
  const relativeUrl = url.startsWith('/') ? url : `/${url}`;
  return `${OFCOM_BASE_URL}${relativeUrl}`;
}

/**
 * Fetch Ofcom's opendata page, locate the amateur callsigns CSV link, and take
 * one of four possible paths based on the URL's `?v=` version parameter:
 *
 *   - downloaded         first run or v changed; do the full 11 MB download
 *   - fast-path-skipped  v matches state and verification is recent; no download
 *   - verified-unchanged v matches state but stale; re-download, hash matches
 *   - anomaly-detected   v matches state but hash differs (Ofcom republished
 *                        under the same v); staging file is NOT overwritten
 *
 * The full-download path also runs the sanity gate (rejects HTML/challenge
 * pages, too-small files, and CSVs missing expected header tokens) and
 * atomically promotes the temp file into the staging path.
 *
 * Callable from the scheduled-run orchestrator as well as from `npm run pull`.
 * Throws on any hard failure (network, sanity gate rejection). Anomalies are
 * signalled by a returned `action: 'anomaly-detected'` rather than a throw,
 * so the orchestrator can compose the right notification.
 */
export async function runScrape(options?: ScrapeOptions): Promise<ScrapeResult> {
  logger.info("Starting Ofcom amateur radio callsigns scraping process");

  // Fetch the Ofcom opendata page with browser-like headers to avoid WAF/bot 403s
  logger.info(`Fetching content from: ${OFCOM_URL}`);
  const response = await axios.get(OFCOM_URL, {
    headers: BROWSER_HEADERS,
    timeout: 30000,
  });

  await fs.writeFile(OUTPUT_FILES.htmlOutput, response.data);
  logger.debug(`Saved HTML content to ${OUTPUT_FILES.htmlOutput}`);

  logger.info("Parsing HTML content...");
  const dom = new JSDOM(response.data);
  const document = dom.window.document;

  const csvLinkDetails = findCsvLink(document);

  const updatedDate = extractUpdateDateFromHtmlTable(csvLinkDetails.element) ||
    new Date().toLocaleDateString('en-GB', {
      day: 'numeric', month: 'long', year: 'numeric'
    });

  const fullUrl = buildAbsoluteOfcomUrl(csvLinkDetails.href);
  const currentV = extractVersionParam(fullUrl);

  logger.info(`Found CSV URL :`, fullUrl);
  logger.info(`Link text :`, csvLinkDetails.text);
  logger.info(`Ofcom-reported last updated date:`, updatedDate);
  logger.info(`Observed ?v= : ${currentV ?? '(none)'}`);

  const downloadMetadata: CsvDownloadMetadata = {
    url: fullUrl,
    linkText: csvLinkDetails.text,
    ofcomReportedLastUpdate: updatedDate,
  };

  const decision = decideVersionCheckPath(currentV, options, new Date());
  logger.info(`Version-check decision: ${decision}`);

  // Fast-path: v hasn't changed AND our last verification is recent. Skip the
  // ~11 MB download entirely. We still refresh the download metadata sidecar
  // so subsequent process runs see the current URL/link/date - none of that
  // costs a large fetch.
  if (decision === 'skip-fast-path') {
    await saveJsonFile(OUTPUT_FILES.downloadMetadataFile, downloadMetadata);
    logger.info("Fast-path: skipping CSV download (v unchanged, verification fresh).");
    return { action: 'fast-path-skipped', currentV };
  }

  // Either a fresh download or a verification re-download. Both take the same
  // atomic-promote path: temp file -> sanity gate -> atomic rename. What
  // differs is what we do AFTER: verify-and-compare-hash, or accept-as-new.
  const tempCsvPath = `${OUTPUT_FILES.originalRawCsvFile}.tmp-${process.pid}`;
  logger.info(`Downloading amateur callsigns CSV to temporary file ${tempCsvPath}...`);
  let tempHash: string;
  try {
    await downloadFile(fullUrl, tempCsvPath);
    logger.info("Download complete.");

    // SANITY GATE: validate content before accepting it. Throws on failure.
    verifyAmateurCsv(tempCsvPath);

    // Hash the temp file BEFORE promoting so the verification path can check
    // for the anomaly (same v, different content) without touching the good
    // staging file.
    tempHash = calculateFileHash(tempCsvPath);
    logger.debug(`Downloaded temp file hash: ${tempHash}`);
  } catch (err) {
    // Clean up the temp file; leave any existing good CSV untouched.
    try { if (fsSync.existsSync(tempCsvPath)) fsSync.unlinkSync(tempCsvPath); } catch { /* ignore */ }
    throw err;
  }

  // Verification path: v matched state but staleness triggered a re-download.
  // If the hash still matches, all is well - refresh verifiedAt and leave the
  // staging file alone. If it DIFFERS, this is the anomaly (Ofcom republished
  // content under the same ?v= value) - do NOT overwrite the good staging
  // file; the orchestrator will notify HIGH and can decide next steps.
  if (decision === 'download-and-verify') {
    const expected = options?.lastKnownVContentHash;
    try { fsSync.unlinkSync(tempCsvPath); } catch { /* ignore */ }
    if (expected && tempHash === expected) {
      logger.info("Verification succeeded: v and hash both unchanged since last successful download.");
      // Metadata still refreshed - the URL / Ofcom-reported date can shift
      // independently of ?v= (e.g. a fresh crawl might see the same file but
      // a subtly different link text).
      await saveJsonFile(OUTPUT_FILES.downloadMetadataFile, downloadMetadata);
      return { action: 'verified-unchanged', currentV, contentHash: tempHash };
    }
    const msg =
      `Ofcom appears to have republished under an unchanged ?v=${currentV ?? '(none)'} - ` +
      `previous hash ${expected ?? '(unknown)'} vs newly-downloaded ${tempHash}. ` +
      `Staging CSV was NOT overwritten; manual investigation required.`;
    logger.warn(msg);
    // Do NOT refresh download metadata either - metadata should describe the
    // last KNOWN-GOOD publication until we've decided what to do.
    return { action: 'anomaly-detected', currentV, contentHash: tempHash, anomalyMessage: msg };
  }

  // Normal download path: v changed (or first-run). Promote the temp file into
  // the staging path and refresh metadata.
  fsSync.renameSync(tempCsvPath, OUTPUT_FILES.originalRawCsvFile);
  const stats = fsSync.statSync(OUTPUT_FILES.originalRawCsvFile);
  logger.info(`CSV file downloaded and validated successfully. File size: ${formatFileSize(stats.size)}`);

  logger.debug('Saving download metadata to: ', OUTPUT_FILES.downloadMetadataFile);
  await saveJsonFile(OUTPUT_FILES.downloadMetadataFile, downloadMetadata);

  logger.info("Scraping process completed successfully");
  return { action: 'downloaded', currentV, contentHash: tempHash };
}

// Auto-invoke when run directly (npm run pull). When imported by the scheduled
// orchestrator, runScrape is called explicitly and this block does nothing.
if (require.main === module) {
  process.on('unhandledRejection', (reason: any) => {
    logger.error('Unhandled Rejection at:', reason);
    process.exit(1);
  });

  runScrape().catch((err: Error) => {
    logger.error(`Failed to scrape and download: ${err.message}`, err);
    process.exit(1);
  });
}
