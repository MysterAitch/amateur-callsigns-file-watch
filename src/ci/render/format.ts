/**
 * The small deterministic formatting/humanisation helpers the generated pages
 * build on: byte sizes, ISO dates rendered as "30 May 2022", and the on-disk
 * size suffix for download links. No locale machinery - the same output on
 * every machine so the generated HTML is byte-for-byte unchanged.
 */

import * as fs from 'fs';

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// '2022-05-30' -> '30 May 2022' (deterministic; no locale machinery).
export function humanDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (match === null) return isoDate;
  return `${Number(match[3])} ${MONTHS[Number(match[2]) - 1]} ${match[1]}`;
}

// Download links always show a size; navigation links never do - the
// consistent pattern that tells a visitor what a click will do.
export function sizeOf(filePath: string): string {
  return fs.existsSync(filePath) ? ` (${formatBytes(fs.statSync(filePath).size)})` : '';
}
