/**
 * FOI-lane unkeyable-row summary (issue #632): the data-quality rollup
 * (data-quality-fold.ts, reports/data-quality.md) folds the defect-detector
 * matrix from the raw-keyed claim ledger, restricted to the open-data lane
 * by design (OPEN_DATA_LANE - the rollup is one column per register-snapshot
 * publication, matching the legacy stats.json-derived generator it replaced).
 * The FOI lane has no counterpart there at all.
 *
 * The callsign-shard build (build-callsign-shards.ts) already counts, per
 * dataset in BOTH lanes, rows whose callsign cell is unkeyable: cleaned
 * (cleanedCallsign in sources/ofcom-amateur/components.ts - uppercase, then
 * strip everything outside A-Z, 0-9, /) to nothing at all - a blank cell, or
 * a punctuation-only token such as a literal ",,". Those rows are never
 * dropped; they fold into their dataset's own row count, just never into any
 * callsign-keyed shard or lookup. This module folds the FOI lane's share of
 * that same figure, so it can be stated once in the data-quality rollup
 * rather than left as an undocumented gap.
 *
 * Deliberately NOT routed through the claim-ledger/DuckDB fold the rest of
 * this report uses (quality-report-fold.ts / data-quality-fold.ts): the FOI
 * population is tiny (tens of rows across a couple of dozen files) and the
 * test is exactly the one line cleanedCallsign already applies over the same
 * buildFoiObservations union the shard build folds - a second, heavier
 * machinery would add cost without adding confidence.
 */

import { buildFoiObservations } from '../shared/foi-observations.ts';
import { defaultFoiDir } from '../shared/foi-archive.ts';
import { cleanedCallsign } from '../sources/ofcom-amateur/components.ts';

// One FOI file's unkeyable-row count. Only ever emitted for a file whose
// count is greater than zero (the common case - most FOI files carry none).
export interface FoiUnkeyableFile {
  entry: string;
  file: string;
  count: number;
}

export interface FoiUnkeyableSummary {
  total: number;
  // Files carrying at least one unkeyable row, sorted (entry, file) - the
  // same deterministic order the shard build's own dataset list uses.
  files: FoiUnkeyableFile[];
}

// Fold the FOI lane's unkeyable-row summary from a directory of FOI entries
// (defaults to the committed archive/foi). Reads the same buildFoiObservations
// union the callsign-shard build folds, so a change to either stays in step.
export function buildFoiUnkeyableSummary(foiDir: string = defaultFoiDir()): FoiUnkeyableSummary {
  // Keyed by entry, then by file within it - a nested map, rather than a
  // composite string key, so there is no separator to pick (and no risk of
  // one colliding with a real entry or file name).
  const byEntry = new Map<string, Map<string, number>>();
  for (const row of buildFoiObservations(foiDir)) {
    if (cleanedCallsign(row.callsign) !== '') continue;
    let byFile = byEntry.get(row.entry);
    if (byFile === undefined) byEntry.set(row.entry, byFile = new Map<string, number>());
    byFile.set(row.sourceFile, (byFile.get(row.sourceFile) ?? 0) + 1);
  }
  const files: FoiUnkeyableFile[] = [];
  for (const [entry, byFile] of [...byEntry.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    for (const [file, count] of [...byFile.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
      files.push({ entry, file, count });
    }
  }
  const total = files.reduce((sum, f) => sum + f.count, 0);
  return { total, files };
}
