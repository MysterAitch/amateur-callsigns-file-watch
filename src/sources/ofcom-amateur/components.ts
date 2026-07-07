/**
 * Callsign component parser (normalised schema v2 work, issue #51): splits
 * register callsign values into constituent parts and attaches per-row
 * data-quality flags, producing the archive/{key}/components.csv derivative
 * that joins to normalised.csv by callsign.
 *
 * Denormalised by design: a row carries `rsl=W`; everything W MEANS (Wales,
 * personal-vs-club scope, citations) lives once in reference-data/rsl.csv
 * and joins at analysis time. Rows carry only determinations specific to
 * that row. Flags are a single semicolon-separated, sorted, closed
 * vocabulary (documented in reference-data/flags.md): sparse, growable
 * without schema churn, and diff-friendly.
 *
 * The parser is deliberately tolerant-then-honest: values are parsed on a
 * cleaned form (uppercased, invisibles and replacement characters removed)
 * so that a recoverable anomaly still yields components, with the anomaly
 * recorded as a flag; values matching no known formation are 'unparseable',
 * never guessed.
 */

import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';

export const COMPONENTS_SCHEMA_VERSION = 3;

export const COMPONENT_COLUMNS = [
  'callsign',
  'parse_status',
  'prefix_series',
  'rsl',
  'suffix',
  'placeholder_form',
  'home_callsign',
  'implied_class',
  'flags',
] as const;

export type ParseStatus = 'parsed' | 'visitor' | 'special-event' | 'empty' | 'unparseable';

export interface ComponentRow {
  callsign: string;
  parseStatus: ParseStatus;
  // Join key into reference-data/prefix-formats.csv ('M7', '2#0', 'GB', '').
  prefixSeries: string;
  rsl: string;
  suffix: string;
  // The RSL-placeholder normalisation of the callsign ('M#7TEE', '2#0DLQ'):
  // identical for the core and for EVERY regional rendering, so it is the
  // search/join key that unifies M7TEE, MW7TEE, ME7TEE, ... Empty for
  // visitor/special-event/empty/unparseable rows.
  placeholderForm: string;
  homeCallsign: string;
  impliedClass: string;
  flags: string[];
}

export interface PrefixSeriesInfo {
  stationLevel: string;
  issuingStatus: string;
  rslRequired: boolean;
}

export interface ReferenceData {
  rslLetters: ReadonlySet<string>;
  prefixSeries: ReadonlyMap<string, PrefixSeriesInfo>;
  forbiddenSuffixes: ReadonlySet<string>;
}

// Anchored to the repository root via this module's location, so tests and
// tools work regardless of the working directory.
const REFERENCE_DATA_DIR = path.resolve(import.meta.dirname, '..', '..', '..', 'reference-data');

export function loadReferenceData(): ReferenceData {
  const readCsv = (name: string): Record<string, string>[] =>
    parse(fs.readFileSync(path.join(REFERENCE_DATA_DIR, name), 'utf8'), { columns: true, skip_empty_lines: true }) as Record<string, string>[];

  const rslLetters = new Set(readCsv('rsl.csv').map(r => r.rsl));
  const prefixSeries = new Map(
    readCsv('prefix-formats.csv').map(r => [r.prefix, {
      stationLevel: r.station_level,
      issuingStatus: r.issuing_status,
      rslRequired: r.rsl_required === 'true',
    }]),
  );
  const forbiddenSuffixes = new Set(readCsv('forbidden-suffixes.csv').map(r => r.suffix));
  return { rslLetters, prefixSeries, forbiddenSuffixes };
}

const INVISIBLE_RE = /[\p{C}\p{Z}]/gu;
const REPLACEMENT_CHAR_RE = /\uFFFD/g;
// Spreadsheet date renderings of month-suffixed callsigns (20APR -> 20-Apr).
const EXCEL_DATE_RE = /^\d{1,2}-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)$/;
// The maintainer-defined plain callsign alphabet (alphanumerics plus the
// meaningful notation characters / and #).
const NON_PLAIN_RE = /[^A-Za-z0-9/#]/gu;

// Product strings encode today's licence levels; empty product legitimately
// means never-licensed, so absence of evidence is never a mismatch.
function productClass(product: string): string {
  const p = product.toLowerCase();
  if (p.includes('foundation')) return 'Foundation';
  if (p.includes('intermediate')) return 'Intermediate';
  if (p.includes('full')) return 'Full';
  return '';
}

export function parseCallsign(callsign: string, product: string, ref: ReferenceData): ComponentRow {
  const row: ComponentRow = {
    callsign,
    parseStatus: 'unparseable',
    prefixSeries: '',
    rsl: '',
    suffix: '',
    placeholderForm: '',
    homeCallsign: '',
    impliedClass: '',
    flags: [],
  };
  const flag = (f: string): void => { if (!row.flags.includes(f)) row.flags.push(f); };

  if (callsign === '') {
    row.parseStatus = 'empty';
    return row;
  }

  if (EXCEL_DATE_RE.test(callsign)) flag('excel-date-shape');

  const upper = callsign.toUpperCase();
  if (upper !== callsign) flag('lowercase');
  let clean = upper.replace(INVISIBLE_RE, '');
  if (clean !== upper) flag('whitespace');
  const deFFFD = clean.replace(REPLACEMENT_CHAR_RE, '');
  if (deFFFD !== clean) flag('encoding-failure');
  clean = deFFFD;

  if (clean.startsWith('GB')) {
    row.parseStatus = 'special-event';
    row.prefixSeries = 'GB';
    row.suffix = clean.slice(2);
    finaliseFlags(row);
    return row;
  }

  if (clean.startsWith('M/')) {
    row.parseStatus = 'visitor';
    row.homeCallsign = clean.slice(2);
    // A plausible home callsign is at least three characters of A-Z/0-9
    // containing both a letter and a digit, and does not start with 0 or 1
    // (no ITU call-sign series does - empirical, itu-call-sign-series.csv).
    // The register contains counter-examples: 1234, 1CNB, nested M/PT2FM.
    const home = row.homeCallsign;
    const plausible = home.length >= 3
      && /^[A-Z0-9]+$/.test(home)
      && /[A-Z]/.test(home)
      && /[0-9]/.test(home)
      && !/^[01]/.test(home);
    if (!plausible) flag('malformed-home-callsign');
    finaliseFlags(row);
    return row;
  }

  const gm = /^([GM])([A-Z]?)([0-9])([A-Z]+)$/.exec(clean);
  const twoWithRsl = /^2([A-Z])([0-9])([A-Z]+)$/.exec(clean);
  const twoBare = /^2([0-9])([A-Z]+)$/.exec(clean);

  if (gm) {
    row.parseStatus = 'parsed';
    row.prefixSeries = gm[1] + gm[3];
    row.rsl = gm[2];
    row.suffix = gm[4];
    // The placeholder form drops any RSL, so M7TEE and every regional
    // rendering (MW7TEE, ME7TEE, ...) normalise to the same M#7TEE key.
    row.placeholderForm = `${gm[1]}#${gm[3]}${gm[4]}`;
  } else if (twoWithRsl) {
    row.parseStatus = 'parsed';
    row.prefixSeries = `2#${twoWithRsl[2]}`;
    row.rsl = twoWithRsl[1];
    row.suffix = twoWithRsl[3];
    row.placeholderForm = `2#${twoWithRsl[2]}${twoWithRsl[3]}`;
  } else if (twoBare) {
    row.parseStatus = 'parsed';
    row.prefixSeries = `2#${twoBare[1]}`;
    row.rsl = '';
    row.suffix = twoBare[2];
    row.placeholderForm = `2#${twoBare[1]}${twoBare[2]}`;
    flag('missing-rsl');
  } else {
    finaliseFlags(row);
    return row;
  }

  if (row.rsl !== '' && !ref.rslLetters.has(row.rsl)) flag('unknown-rsl');

  const series = ref.prefixSeries.get(row.prefixSeries);
  if (series === undefined) {
    flag('unknown-prefix-series');
  } else {
    row.impliedClass = series.stationLevel;
  }

  if (ref.forbiddenSuffixes.has(row.suffix)) flag('forbidden-suffix');
  if (row.suffix.length < 2 || row.suffix.length > 3) flag('suffix-length-abnormal');

  const declared = productClass(product);
  if (row.impliedClass !== '' && declared !== '' && row.impliedClass !== declared) {
    flag('class-product-mismatch');
  }

  finaliseFlags(row);
  return row;
}

function finaliseFlags(row: ComponentRow): void {
  row.flags.sort();
}

// Flags that need the WHOLE dataset's context: the junk-stripped form of an
// anomalous value coexisting as its own row (confirmed double-listings in
// real publications). Mutates and returns the rows for chaining.
export function componentsFlagsForRows(rows: ComponentRow[]): ComponentRow[] {
  const all = new Set(rows.map(r => r.callsign));
  for (const row of rows) {
    const stripped = row.callsign.replace(NON_PLAIN_RE, '');
    if (stripped !== row.callsign && stripped !== '' && all.has(stripped)) {
      if (!row.flags.includes('stripped-collision')) row.flags.push('stripped-collision');
      row.flags.sort();
    }
  }
  return rows;
}

export function componentRowToCells(row: ComponentRow): string[] {
  return [
    row.callsign,
    row.parseStatus,
    row.prefixSeries,
    row.rsl,
    row.suffix,
    row.placeholderForm,
    row.homeCallsign,
    row.impliedClass,
    row.flags.join(';'),
  ];
}
