import * as fsSync from 'fs';
import * as fs from 'fs/promises';
import * as crypto from 'crypto';
import * as util from 'util';
import * as dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

export const CONSTANTS = {
  FILES: {
    originalRawCsvFile: 'amateur-callsigns-raw.csv',
    sortedCsvFile: 'amateur-callsigns-sorted.csv',
    jsonFile: 'amateur-callsigns.json',
    sortedJsonFile: 'amateur-callsigns-sorted.json',
    metadataFile: 'metadata-amateur-callsigns.json',
    downloadMetadataFile: 'metadata-download-info.json',
    htmlOutput: 'ofcom_page.html',
    tempCsvFile: 'temp-amateur-callsigns.csv'
  },
  URLS: {
    OFCOM_URL: 'https://www.ofcom.org.uk/about-ofcom/our-research/opendata',
    OFCOM_BASE_URL: 'https://www.ofcom.org.uk'
  }
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
