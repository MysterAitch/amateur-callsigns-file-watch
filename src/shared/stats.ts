/**
 * Per-entry data-quality statistics (issue #46): a pure derivative of the
 * canonical (normalised) rows, produced alongside normalised.csv in the
 * golden-master lane and archived as stats.json.
 *
 * Purpose: make anomalies visible at a glance and comparable across
 * publications - the callsign format taxonomy surfaces placeholder
 * conventions, regional-identifier prevalence, punctuation oddities and
 * casing errors without any parsing; the per-column distributions catch
 * blank-value spikes and range drift.
 *
 * Determinism is load-bearing (re-runs must be byte no-ops): keys are
 * lexicographically sorted at serialisation, there are no timestamps, and
 * everything derives from the rows alone.
 */

export interface StringColumnStats {
  distinct: number;
  empty: number;
  minLength: number;
  maxLength: number;
}

export interface DateColumnStats {
  distinct: number;
  empty: number;
  min: string;
  max: string;
}

// One quality detector's result: how many rows it flagged, plus up to
// EXAMPLE_CAP offending values (lexicographically sorted, invisibles
// rendered as {U+XXXX} markers so examples are readable everywhere).
export interface DetectorResult {
  count: number;
  examples: string[];
}

// Automated publication-defect detectors (issue #51), each grounded in a
// defect class observed in real Ofcom exports. A row can trip several
// detectors; counters are independent.
export interface CallsignQuality {
  // Values shaped like spreadsheet date renderings (e.g. "20-Apr"): a real
  // intermediate callsign such as 20APR interpreted as a date somewhere in
  // the publisher's export pipeline. Observed in the 2023/2025-04 exports.
  excelDateShaped: DetectorResult;
  // U+FFFD (replacement character) present: upstream encoding corruption by
  // construction.
  encodingFailure: DetectorResult;
  // Any whitespace/unprintable/invisible character (including space).
  whitespaceBearing: DetectorResult;
  // The value stripped to [A-Za-z0-9/#] differs AND that stripped form also
  // exists as its own row - the register effectively lists one callsign
  // twice (confirmed live: G0TQK, G7IWE, G6FMU, M/EI8DJ).
  postNormalisationDuplicates: DetectorResult;
  emptyCallsign: DetectorResult;
  // Any a-z present (fully lowercase g0jrk and mixed-case NaNAAA observed).
  lowercaseBearing: DetectorResult;
}

// The component-parse facts a stats aggregate needs: flags and parse status
// per row (the full detail lives in components.csv).
export interface ComponentAggregateInput {
  parseStatus: string;
  flags: readonly string[];
}

export interface EntryStats {
  statsSchemaVersion: 5;
  recordCount: number;
  // Format taxonomy of the callsign column: uppercase→A, lowercase→a,
  // digit→N; whitespace, unprintable, and invisible characters (Unicode
  // Other and Separator categories, INCLUDING regular space - whitespace in
  // a callsign is unambiguously invalid) appear as explicit {U+XXXX}
  // markers; all other characters preserved verbatim. Codepoints stay in
  // the pattern itself - process once, visible immediately, no detective
  // work - so a tab anomaly and an NBSP anomaly are distinct rows.
  callsignPatterns: Record<string, number>;
  callsignQuality: CallsignQuality;
  // Aggregated from components.csv rows (flag vocabulary:
  // reference-data/flags.md); empty objects when no component parse ran.
  callsignFlags: Record<string, number>;
  parseStatuses: Record<string, number>;
  columns: Record<string, StringColumnStats | DateColumnStats>;
}

// Whitespace/unprintable/invisible characters, marked per-codepoint in
// patterns. Substitution runs AFTER the letter/digit mappings, so the marker
// text's own letters can never be re-mapped. (A raw callsign containing a
// literal "{U+XXXX}" string would collide with a marker; accepted as
// vanishingly unlikely, and the raw data remains the arbiter.)
// U+FFFD is included explicitly: the replacement character is category So
// (a symbol, not a control), so \p{C}\p{Z} misses it - observed live as raw
// replacement characters inside pattern tables while every other anomaly
// carried a marker.
const UNPRINTABLE_RE = /[\p{C}\p{Z}\uFFFD]/gu;

function codepointMarker(c: string): string {
  return `{U+${(c.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}}`;
}

export function callsignPattern(callsign: string): string {
  return callsign
    .replace(/[A-Z]/g, 'A')
    .replace(/[a-z]/g, 'a')
    .replace(/[0-9]/g, 'N')
    .replace(UNPRINTABLE_RE, codepointMarker);
}

// Raw value with ONLY the unprintables exploded to {U+XXXX} markers -
// letters and digits untouched - for enumerating raw register values
// legibly (report example lists), wherever the invisible sits.
export function markUnprintables(text: string): string {
  return text.replace(UNPRINTABLE_RE, codepointMarker);
}

const EXAMPLE_CAP = 5;

// Spreadsheet date renderings of real month-suffixed callsigns: digits,
// hyphen, then exactly a capitalised English month abbreviation.
const EXCEL_DATE_RE = /^\d{1,2}-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)$/;

// Junk-stripping for the duplicate detector: the maintainer-defined
// "plain" callsign alphabet is alphanumerics plus / and # (both meaningful
// notation in Ofcom publications).
const NON_PLAIN_RE = /[^A-Za-z0-9/#]/gu;

function detect(rows: readonly string[], predicate: (value: string) => boolean): DetectorResult {
  const offenders = rows.filter(predicate);
  const examples = [...new Set(offenders.map(v => v.replace(UNPRINTABLE_RE, codepointMarker)))]
    .sort()
    .slice(0, EXAMPLE_CAP);
  return { count: offenders.length, examples };
}

// Non-global twin of UNPRINTABLE_RE: a g-flagged regex is stateful under
// .test() (lastIndex persists between calls), which silently alternates
// results across rows.
const HAS_UNPRINTABLE_RE = /[\p{C}\p{Z}]/u;

function computeCallsignQuality(callsigns: readonly string[]): CallsignQuality {
  const all = new Set(callsigns);
  return {
    excelDateShaped: detect(callsigns, v => EXCEL_DATE_RE.test(v)),
    encodingFailure: detect(callsigns, v => v.includes('\uFFFD')),
    whitespaceBearing: detect(callsigns, v => HAS_UNPRINTABLE_RE.test(v)),
    postNormalisationDuplicates: detect(callsigns, (v) => {
      const stripped = v.replace(NON_PLAIN_RE, '');
      return stripped !== v && stripped !== '' && all.has(stripped);
    }),
    emptyCallsign: detect(callsigns, v => v === ''),
    lowercaseBearing: detect(callsigns, v => /[a-z]/.test(v)),
  };
}

// distinct and length/value ranges deliberately consider non-empty values
// only; emptiness is its own counter. A column with many empties would
// otherwise always report minLength 0 / min '', hiding the real range.
export function computeEntryStats(
  header: readonly string[],
  rows: readonly (readonly string[])[],
  dateColumns: ReadonlySet<string>,
  components: readonly ComponentAggregateInput[] = [],
): EntryStats {
  const callsignIndex = header.indexOf('callsign');
  const patterns = new Map<string, number>();
  const callsigns: string[] = [];
  const perColumn = header.map(() => ({ values: new Set<string>(), empty: 0, minLen: Infinity, maxLen: -Infinity, min: '', max: '' }));

  for (const row of rows) {
    if (callsignIndex >= 0) {
      const callsign = row[callsignIndex] ?? '';
      callsigns.push(callsign);
      const p = callsignPattern(callsign);
      patterns.set(p, (patterns.get(p) ?? 0) + 1);
    }
    for (let i = 0; i < header.length; i++) {
      const value = row[i] ?? '';
      const acc = perColumn[i];
      if (value === '') {
        acc.empty += 1;
        continue;
      }
      acc.values.add(value);
      if (value.length < acc.minLen) acc.minLen = value.length;
      if (value.length > acc.maxLen) acc.maxLen = value.length;
      if (acc.min === '' || value < acc.min) acc.min = value;
      if (acc.max === '' || value > acc.max) acc.max = value;
    }
  }

  const columns: Record<string, StringColumnStats | DateColumnStats> = {};
  header.forEach((column, i) => {
    const acc = perColumn[i];
    const hasValues = acc.values.size > 0;
    if (dateColumns.has(column)) {
      columns[column] = { distinct: acc.values.size, empty: acc.empty, min: acc.min, max: acc.max };
    } else {
      columns[column] = {
        distinct: acc.values.size,
        empty: acc.empty,
        minLength: hasValues ? acc.minLen : 0,
        maxLength: hasValues ? acc.maxLen : 0,
      };
    }
  });

  const callsignFlags = new Map<string, number>();
  const parseStatuses = new Map<string, number>();
  for (const c of components) {
    parseStatuses.set(c.parseStatus, (parseStatuses.get(c.parseStatus) ?? 0) + 1);
    for (const f of c.flags) callsignFlags.set(f, (callsignFlags.get(f) ?? 0) + 1);
  }
  const sortedEntries = (m: Map<string, number>): Record<string, number> =>
    Object.fromEntries([...m.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

  return {
    statsSchemaVersion: 5,
    recordCount: rows.length,
    callsignPatterns: Object.fromEntries([...patterns.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
    callsignQuality: computeCallsignQuality(callsigns),
    callsignFlags: sortedEntries(callsignFlags),
    parseStatuses: sortedEntries(parseStatuses),
    columns,
  };
}

// Serialise with lexicographically sorted keys at every level so a count
// shifting never reorders lines - stats.json diffs between publications are
// themselves a review signal and must stay minimal.
export function renderStatsJson(stats: EntryStats): string {
  const sortKeys = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sortKeys);
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, v]) => [k, sortKeys(v)]),
      );
    }
    return value;
  };
  return JSON.stringify(sortKeys(stats), null, 2) + '\n';
}

export interface StatsComparison {
  recordCountDeltaPct: number;
  // Patterns present in the entry but not the neighbour, and vice versa.
  newPatterns: string[];
  lostPatterns: string[];
}

export function compareStats(entry: EntryStats, neighbour: EntryStats): StatsComparison {
  const entryPatterns = new Set(Object.keys(entry.callsignPatterns));
  const neighbourPatterns = new Set(Object.keys(neighbour.callsignPatterns));
  return {
    recordCountDeltaPct: neighbour.recordCount === 0
      ? 0
      : ((entry.recordCount - neighbour.recordCount) / neighbour.recordCount) * 100,
    newPatterns: [...entryPatterns].filter(p => !neighbourPatterns.has(p)).sort(),
    lostPatterns: [...neighbourPatterns].filter(p => !entryPatterns.has(p)).sort(),
  };
}
