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

// '2016-09' or '2016-09-20' -> 'September 2016' (deterministic, month precision).
// Overview surfaces read cleanly only when every vintage renders at the same
// granularity; some sources report a month, others a full day, so month is the
// finest shared precision. The exact day, where known, belongs in the detail
// views, not the overview timeline. Input that is not a leading ISO year-month
// (a prose range, an empty cell) is returned untouched so nothing is faked.
export function monthYear(isoMonth: string): string {
  const match = /^(\d{4})-(\d{2})/.exec(isoMonth);
  if (match === null) return isoMonth;
  const monthNumber = Number(match[2]);
  if (monthNumber < 1 || monthNumber > 12) return isoMonth;
  return `${MONTHS[monthNumber - 1]} ${match[1]}`;
}

// Download links always show a size; navigation links never do - the
// consistent pattern that tells a visitor what a click will do.
export function sizeOf(filePath: string): string {
  return fs.existsSync(filePath) ? ` (${formatBytes(fs.statSync(filePath).size)})` : '';
}
