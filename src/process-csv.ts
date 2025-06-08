#!/usr/bin/env node

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import {
  calculateFileHash,
  getFileMetadata,
  loadJsonFile,
  saveJsonFile,
  CONSTANTS,
  logger,
  fileExistsAndNotEmpty,
  formatFileSize,
  CsvDownloadMetadata,
  ProcessingMetadata
} from './utils';

// Constants
const FILES = CONSTANTS.FILES;

interface CsvRecord {
  [key: string]: string;
}

async function isProcessingNeeded(originalCsvHash: string): Promise<boolean> {
  if (!fsSync.existsSync(FILES.metadataFile)) {
    logger.debug("No existing metadata file found - processing needed");
    return true;
  }

  try {
    const existingMetadata = await loadJsonFile<ProcessingMetadata>(FILES.metadataFile);

    // Check if hash matches and all required files exist
    if (
      existingMetadata &&
      existingMetadata.originalCsvHash === originalCsvHash &&
      fileExistsAndNotEmpty(FILES.sortedCsvFile) &&
      fileExistsAndNotEmpty(FILES.jsonFile) &&
      fileExistsAndNotEmpty(FILES.sortedJsonFile)
    ) {
      logger.info("All files exist and CSV hash matches. No processing needed.");
      return false;
    }

    logger.debug("Hash mismatch or files missing - processing needed");
    return true;
  } catch (error: any) {
    logger.warn(`Error comparing with existing metadata: ${error.message}`);
    return true;
  }
}

/**
 * Process the CSV file - sort it and create JSON versions
 * @param {string} originalCsvHash - Hash of the original CSV file
 * @param {CsvDownloadMetadata | null} downloadMetadata - Metadata from download process (if available)
 * @returns {Promise<ProcessingMetadata>} - Processing results metadata
 */
async function processCSV(originalCsvHash: string, downloadMetadata: CsvDownloadMetadata | null): Promise<ProcessingMetadata> {
  try {
    logger.info("Creating sorted version of the CSV file...");
    const csvContent = await fs.readFile(FILES.originalRawCsvFile, 'utf8');
    const fileStats = fsSync.statSync(FILES.originalRawCsvFile);

    // Parse the CSV file
    logger.debug("Parsing CSV data");
    const csvData = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
    }) as CsvRecord[];

    logger.info(`Successfully parsed CSV with ${csvData.length} entries`);

    // Get the first property name (column header) dynamically
    const firstColumnName = Object.keys(csvData[0])[0];
    logger.info(`Sorting data by column: ${firstColumnName}`);

    // Sort the data (using spread to avoid mutating original data)
    const sortedCsvData = [...csvData].sort((a, b) => {
      const valA = String(a[firstColumnName] || '').toLowerCase();
      const valB = String(b[firstColumnName] || '').toLowerCase();
      return valA.localeCompare(valB);
    });

    // Write the sorted CSV
    const sortedCsvContent = stringify(sortedCsvData, {
      header: true,
      columns: Object.keys(csvData[0]),
    });

    logger.info("Start writing sorted CSV file to: ", FILES.sortedCsvFile);
    await fs.writeFile(FILES.sortedCsvFile, sortedCsvContent);
    logger.info("End writing sorted CSV file to: ", FILES.sortedCsvFile);

    // Create JSON versions of the data
    logger.info("Creating JSON versions of the data...");
    logger.info(" - Start writing sorted JSON file to: ", FILES.sortedJsonFile);
    await saveJsonFile(FILES.jsonFile, csvData);
    logger.info(" - End writing original JSON file to: ", FILES.jsonFile);
    logger.info(" - Start writing sorted JSON file to: ", FILES.sortedJsonFile);
    await saveJsonFile(FILES.sortedJsonFile, sortedCsvData);
    logger.info( " - End writing sorted JSON file to: ", FILES.sortedJsonFile);
    logger.info("Successfully created JSON files");

    // Calculate hashes for all files
    const sortedCsvHash = calculateFileHash(FILES.sortedCsvFile);
    const originalJsonHash = calculateFileHash(FILES.jsonFile);
    const sortedJsonHash = calculateFileHash(FILES.sortedJsonFile);

    // Get file sizes
    const sortedCsvFileSize = fsSync.statSync(FILES.sortedCsvFile).size;
    const originalJsonFileSize = fsSync.statSync(FILES.jsonFile).size;
    const sortedJsonFileSize = fsSync.statSync(FILES.sortedJsonFile).size;

    logger.debug(`Sorted CSV checksum: ${sortedCsvHash}`);
    logger.debug(`Original JSON checksum: ${originalJsonHash}`);
    logger.debug(`Sorted JSON checksum: ${sortedJsonHash}`);

    // Create comprehensive metadata
    const metadata: ProcessingMetadata = {
      originalCsvSize: fileStats.size,
      originalCsvHash: originalCsvHash,
      sortedCsvSize: sortedCsvFileSize,
      sortedCsvHash: sortedCsvHash,
      originalJsonSize: originalJsonFileSize,
      originalJsonHash: originalJsonHash,
      sortedJsonSize: sortedJsonFileSize,
      sortedJsonHash: sortedJsonHash,
      recordCount: csvData.length,
    };

    // Add download metadata if available
    if (downloadMetadata) {
      metadata.url = downloadMetadata.url;
      metadata.ofcomLastUpdate = downloadMetadata.ofcomReportedLastUpdate;
      metadata.linkText = downloadMetadata.linkText;
    }

    // Save metadata
    await saveJsonFile(FILES.metadataFile, metadata);
    logger.info(`Saved comprehensive metadata to ${FILES.metadataFile}`);

    return metadata;
  } catch (error: any) {
    logger.error(`Failed to process CSV file: ${error.message}`, error);
    throw new Error(`CSV processing failed: ${error.message}`);
  }
}

/**
 * Main function
 */
async function main(): Promise<void> {
  try {
    logger.info("Starting amateur callsigns CSV processing");

    // Check if the CSV file exists
    if (!fileExistsAndNotEmpty(FILES.originalRawCsvFile)) {
      throw new Error(`${FILES.originalRawCsvFile} file not found or empty! Please run scrape-and-download.js first.`);
    }

    // Check for download metadata (contains URL and Ofcom last updated date)
    const downloadMetadata = await loadJsonFile<CsvDownloadMetadata>(FILES.downloadMetadataFile);

    if (downloadMetadata) {
      logger.info(`Found download metadata. URL: ${downloadMetadata.url}`);
      logger.info(`Ofcom-reported last updated date: ${downloadMetadata.ofcomReportedLastUpdate}`);
    } else {
      logger.warn(`${FILES.downloadMetadataFile} not found. Some metadata will be missing.`);
    }

    // Get file stats
    const fileStats = fsSync.statSync(FILES.originalRawCsvFile);
    logger.info(`Original CSV file size: ${formatFileSize(fileStats.size)}`);

    // Calculate hash of the original CSV file
    const originalCsvHash = calculateFileHash(FILES.originalRawCsvFile);
    logger.debug(`Original CSV hash: ${originalCsvHash}`);

    // Check if we need to process the file by comparing with existing metadata
    const needsProcessing = await isProcessingNeeded(originalCsvHash);

    if (needsProcessing) {
      logger.info("Processing CSV data...");
      await processCSV(originalCsvHash, downloadMetadata);
    } else {
      logger.info("No changes detected. Using existing files.");
    }

    logger.info("CSV processing complete!");
    logger.info("Files available:");

    // List files related to amateur callsigns
    const files = getFileMetadata();

    // Display file information
    files.forEach(file => {
      logger.info(`- ${file.name}: ${formatFileSize(file.size)} (Last modified: ${new Date(file.lastModified).toLocaleString()})`);
    });

    logger.info("All operations completed successfully");
  } catch (error: any) {
    logger.error(`Processing failed: ${error.message}`, error);
    process.exit(1);
  }
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
  logger.error('Unhandled Rejection at:', reason);
  process.exit(1);
});

// Run the main function
main().catch((error: Error) => {
  logger.error("Fatal error:", error);
  process.exit(1);
});
