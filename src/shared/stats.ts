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

export interface EntryStats {
  statsSchemaVersion: 1;
  recordCount: number;
  // Format taxonomy of the callsign column: uppercase→A, lowercase→a,
  // digit→N, all other characters preserved verbatim.
  callsignPatterns: Record<string, number>;
  columns: Record<string, StringColumnStats | DateColumnStats>;
}

export function callsignPattern(callsign: string): string {
  return callsign.replace(/[A-Z]/g, 'A').replace(/[a-z]/g, 'a').replace(/[0-9]/g, 'N');
}

// distinct and length/value ranges deliberately consider non-empty values
// only; emptiness is its own counter. A column with many empties would
// otherwise always report minLength 0 / min '', hiding the real range.
export function computeEntryStats(
  header: readonly string[],
  rows: readonly (readonly string[])[],
  dateColumns: ReadonlySet<string>,
): EntryStats {
  const callsignIndex = header.indexOf('callsign');
  const patterns = new Map<string, number>();
  const perColumn = header.map(() => ({ values: new Set<string>(), empty: 0, minLen: Infinity, maxLen: -Infinity, min: '', max: '' }));

  for (const row of rows) {
    if (callsignIndex >= 0) {
      const p = callsignPattern(row[callsignIndex] ?? '');
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

  return {
    statsSchemaVersion: 1,
    recordCount: rows.length,
    callsignPatterns: Object.fromEntries([...patterns.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
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
