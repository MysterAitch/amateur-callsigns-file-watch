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
  CsvDownloadMetadata
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
 * Find the amateur callsign CSV link on the page (expects exactly one match)
 */
function findCsvLink(document: Document): HtmlLinkDetails {
  logger.info("Searching for amateur callsigns CSV link...");
  const csvLinks: HtmlLinkDetails[] = [];

  const links = document.querySelectorAll('a');
  links.forEach(element => {
    const href = element.getAttribute('href');
    if (href && href.toLowerCase().includes('amateur') && href.toLowerCase().includes('.csv')) {
      const linkText = element.textContent?.trim() || '';
      logger.debug("Found CSV link:", href, "with text:", linkText);
      csvLinks.push({ href, text: linkText, element });
    }
  });

  if (csvLinks.length === 0) {
    logger.error("No amateur callsign CSV link found!");
    throw new Error("No amateur callsign CSV link found on the Ofcom website.");
  }

  if (csvLinks.length > 1) {
    logger.error(`Found ${csvLinks.length} amateur callsign CSV links, expected exactly one.`);
    logger.debug("Found links:", csvLinks.map(link => `${link.text} (${link.href})`));
    throw new Error(`Found ${csvLinks.length} amateur callsign CSV links, expected exactly one.`);
  }

  logger.info("Found the amateur callsigns CSV link:", csvLinks[0].href);
  return csvLinks[0];
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

function buildAbsoluteOfcomUrl(url: string): string {
  if (url.match(/^https?:\/\//)) {
    return url;
  }
  const relativeUrl = url.startsWith('/') ? url : `/${url}`;
  return `${OFCOM_BASE_URL}${relativeUrl}`;
}

async function main(): Promise<void> {
  try {
    logger.info("Starting Ofcom amateur radio callsigns scraping process");

    // Fetch the Ofcom opendata page with browser-like headers to avoid WAF/bot 403s
    logger.info(`Fetching content from: ${OFCOM_URL}`);
    const response = await axios.get(OFCOM_URL, {
      headers: BROWSER_HEADERS,
      timeout: 30000,
    });

    // Save HTML for debugging
    await fs.writeFile(OUTPUT_FILES.htmlOutput, response.data);
    logger.debug(`Saved HTML content to ${OUTPUT_FILES.htmlOutput}`);

    // Parse and find the CSV link
    logger.info("Parsing HTML content...");
    const dom = new JSDOM(response.data);
    const document = dom.window.document;

    const csvLinkDetails = findCsvLink(document);

    // Extract update date
    const updatedDate = extractUpdateDateFromHtmlTable(csvLinkDetails.element) ||
      new Date().toLocaleDateString('en-GB', {
        day: 'numeric', month: 'long', year: 'numeric'
      });

    // Build full URL
    const fullUrl = buildAbsoluteOfcomUrl(csvLinkDetails.href);

    logger.info(`Found CSV URL :`, fullUrl);
    logger.info(`Link text :`, csvLinkDetails.text);
    logger.info(`Ofcom-reported last updated date:`, updatedDate);

    const downloadMetadata: CsvDownloadMetadata = {
      url: fullUrl,
      linkText: csvLinkDetails.text,
      ofcomReportedLastUpdate: updatedDate,
    };

    logger.debug('Saving download metadata to: ', OUTPUT_FILES.downloadMetadataFile);
    await saveJsonFile(OUTPUT_FILES.downloadMetadataFile, downloadMetadata);

    // Check if we had a previous version before overwriting
    const previousFileExists = fileExistsAndNotEmpty(OUTPUT_FILES.originalRawCsvFile);
    let previousHash = null;
    if (previousFileExists) {
      try {
        previousHash = calculateFileHash(OUTPUT_FILES.originalRawCsvFile);
        logger.debug(`Previous file hash: ${previousHash}`);
      } catch (error) {
        logger.warn("Could not calculate hash of previous file:", error);
      }
    }

    // Download the CSV
    logger.info(`Downloading amateur callsigns CSV file to ${OUTPUT_FILES.originalRawCsvFile}...`);
    await downloadFile(fullUrl, OUTPUT_FILES.originalRawCsvFile);
    logger.info("Download complete.");

    // Compare hashes
    if (previousHash !== null) {
      try {
        const newHash = calculateFileHash(OUTPUT_FILES.originalRawCsvFile);
        if (newHash === previousHash) {
          logger.info("Downloaded file is identical to the previous version (same hash).");
        } else {
          logger.info("Downloaded file is different from the previous version (hash changed).");
        }
      } catch (error) {
        logger.warn("Could not compare file hashes:", error);
      }
    }

    if (fileExistsAndNotEmpty(OUTPUT_FILES.originalRawCsvFile)) {
      const stats = fsSync.statSync(OUTPUT_FILES.originalRawCsvFile);
      logger.info(`CSV file downloaded successfully. File size: ${formatFileSize(stats.size)}`);
    } else {
      throw new Error("Failed to download the CSV file or the downloaded file is empty");
    }

    logger.info("Scraping process completed successfully");
  } catch (error: any) {
    logger.error(`Failed to scrape and download: ${error.message}`, error);
    process.exit(1);
  }
}

process.on('unhandledRejection', (reason: any) => {
  logger.error('Unhandled Rejection at:', reason);
  process.exit(1);
});

main().catch((err: Error) => {
  logger.error("Fatal error:", err);
  process.exit(1);
});
