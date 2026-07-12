/**
 * Shared normalisation core (source-agnostic).
 *
 * Everything here must be byte-deterministic: normalised outputs are archived
 * golden masters whose re-run diffs are review artefacts (ADR 0001). Hence:
 *  - the CSV renderer is hand-rolled (minimal RFC-4180 quoting, LF endings,
 *    trailing newline) rather than delegated to csv-stringify, so a dependency
 *    bump can never churn every archived normalised.csv;
 *  - sorting callers must use codepoint comparison, never localeCompare
 *    (ICU collation data varies across environments).
 *
 * The date parser is deliberately STRICT dd/mm/yyyy: UK day-first order is
 * empirically proven in the raw data (day>12 values throughout), and
 * strictness turns a wholesale month-first flip into a loud file-wide
 * failure - in a publication of ~150k rows, real days >12 are statistically
 * guaranteed to land in the month position and explode the parse.
 */

// Strict UK date(-time) parser. Accepts exactly:
//   dd/mm/yyyy
//   dd/mm/yyyy H:mm | HH:mm  (optionally :ss)
// Returns ISO-ordered 'yyyy-mm-dd' (+' hh:mm'/' hh:mm:ss'), zero-padded.
// Empty/whitespace input passes through as '' (raw legitimately has empty
// date cells). Anything else throws.
const UK_DATE_RE = /^(\d{2})\/(\d{2})\/(\d{4})(?: (\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;

export interface ParsedUkDateTime {
  iso: string;
  // True when the day/month pair would parse validly under EITHER day-first
  // or month-first order (both components <= 12) - i.e. this single value
  // cannot self-verify its ordering. Converters aggregate the split per
  // column as day-first-verification evidence for reviewers. Derived from
  // the same match as the parse, so the two can never disagree about what
  // counts as a date.
  ambiguous: boolean;
}

export function parseUkDateTimeDetailed(value: string): ParsedUkDateTime {
  const trimmed = value.trim();
  if (trimmed === '') return { iso: '', ambiguous: false };

  const m = UK_DATE_RE.exec(trimmed);
  if (!m) {
    throw new Error(`unrecognised date format (expected dd/mm/yyyy[ hh:mm[:ss]]): "${trimmed}"`);
  }
  const [, dd, mm, yyyy, h, min, sec] = m;
  const day = Number(dd);
  const month = Number(mm);
  if (month < 1 || month > 12) {
    throw new Error(`month out of range in "${trimmed}" - possible month-first (mm/dd) ordering`);
  }
  const daysInMonth = new Date(Number(yyyy), month, 0).getDate();
  if (day < 1 || day > daysInMonth) {
    throw new Error(`day out of range for ${yyyy}-${mm} in "${trimmed}"`);
  }

  let iso = `${yyyy}-${mm}-${dd}`;
  if (h !== undefined) {
    const hour = Number(h);
    if (hour > 23 || Number(min) > 59 || (sec !== undefined && Number(sec) > 59)) {
      throw new Error(`time out of range in "${trimmed}"`);
    }
    iso += ` ${h.padStart(2, '0')}:${min}`;
    if (sec !== undefined) iso += `:${sec}`;
  }
  return { iso, ambiguous: day <= 12 && month <= 12 };
}

export function parseUkDateTime(value: string): string {
  return parseUkDateTimeDetailed(value).iso;
}

// Minimal RFC-4180 rendering: quote only when the value contains a comma,
// quote, or newline; escape quotes by doubling; LF line endings; trailing
// newline. Byte-deterministic by construction. Exported so the reconstruction
// oracle (issue #434) canonicalises quoting on BOTH the original and the
// reconstruction through the ONE renderer, never a second copy that could drift.
export function renderCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function renderCsv(header: string[], rows: string[][]): string {
  const out: string[] = [header.map(renderCell).join(',')];
  for (const row of rows) {
    out.push(row.map(renderCell).join(','));
  }
  return out.join('\n') + '\n';
}

// Codepoint-order comparison for deterministic sorting (never localeCompare).
export function codepointCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
