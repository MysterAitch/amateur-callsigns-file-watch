import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildBuilderProjection, PROJECTED_ENTRY_FILES } from './build-builder-projection.ts';
import { listArchiveKeys } from '../shared/archive.ts';
import { CONSTANTS } from '../shared/utils.ts';

// Test names follow Subject_Scenario_Outcome per project convention.
//
// FULL-CORPUS PARITY GATE for the builder-facing ledger projection (issue
// #629 phase 1): over the REAL archive, the projection's per-entry derivative
// files (normalised.csv, components.csv, stats.json) must be BYTE-IDENTICAL
// to the committed ones the deploy builders and validation read today. Byte
// identity is the honest bar - the committed files are byte-deterministic by
// construction (the normalise sweep re-derives them and requires a no-op), so
// any weaker (semantic) comparison would hide a real divergence. EVERY entry
// is compared, both lanes, no sampling; a failure names the entry and the
// first differing line.
//
// This gate is the merge condition for the whole legacy-switchover push: only
// while it holds may phase 2 repoint the consumers (build-dataset-pages,
// build-callsign-shards, build-home-aggregates, build-data-status,
// build-interdataset-stats, forbidden-suffix-callsigns, validate-data) at the
// projection, and only after that may the sweeps retire (#446 -> #447 -> #448).
//
// Heavy by design (a whole-corpus ledger emit + fold); it runs in the isolated
// heavy pool (src/testing/heavy-tests.json). BUILDER_PROJECTION_DIR reuses a
// prebuilt scratch directory across local runs, mirroring the invariant
// suite's PROJECTION_DB_DIR discipline.

let scratch: string;
let ownsScratch = false;
let projectionDir: string;
let committedKeys: string[];

const PROJECTION_SUBDIR = 'projection';
const LEDGER_SUBDIR = 'ledger-emit';

beforeAll(() => {
  const reuse = process.env.BUILDER_PROJECTION_DIR?.trim() || undefined;
  scratch = reuse ?? fs.mkdtempSync(path.join(os.tmpdir(), 'builder-projection-parity-'));
  ownsScratch = reuse === undefined;
  projectionDir = path.join(scratch, PROJECTION_SUBDIR);

  committedKeys = listArchiveKeys();
  if (committedKeys.length === 0) throw new Error('no archive entries found - the parity gate needs the real corpus');

  const alreadyBuilt = committedKeys.every(key =>
    PROJECTED_ENTRY_FILES.every(file => fs.existsSync(path.join(projectionDir, key, file))));
  if (!alreadyBuilt) {
    buildBuilderProjection(projectionDir, { ledgerDir: path.join(scratch, LEDGER_SUBDIR) });
  }
}, 3_600_000);

afterAll(() => {
  if (ownsScratch) fs.rmSync(scratch, { recursive: true, force: true });
});

// The first differing line between two texts, for a failure message that
// locates the divergence rather than dumping megabytes. Line 1 is the header.
function firstDifferingLine(committed: string, projected: string): string {
  const a = committed.split('\n');
  const b = projected.split('\n');
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    if (a[i] !== b[i]) {
      const excerpt = (line: string | undefined): string => line === undefined ? '<absent>' : JSON.stringify(line.length > 200 ? `${line.slice(0, 200)}…` : line);
      return `line ${i + 1}: committed ${excerpt(a[i])} vs projected ${excerpt(b[i])}`;
    }
  }
  return 'no differing line found - the difference is in raw bytes only (encoding or line terminators)';
}

// Compare one derivative file across the two lanes for EVERY committed entry,
// returning one named failure per divergent entry. Buffer equality first (the
// cheap whole-file check), then a line-located message on mismatch.
function compareAcrossCorpus(fileName: (typeof PROJECTED_ENTRY_FILES)[number]): string[] {
  const failures: string[] = [];
  for (const key of committedKeys) {
    const committedPath = path.join(CONSTANTS.DIRS.archive, key, fileName);
    const projectedPath = path.join(projectionDir, key, fileName);
    if (!fs.existsSync(committedPath)) {
      failures.push(`${key}/${fileName}: committed file is missing - every open-data entry is expected to carry it`);
      continue;
    }
    if (!fs.existsSync(projectedPath)) {
      failures.push(`${key}/${fileName}: the projection produced no file for this entry`);
      continue;
    }
    const committed = fs.readFileSync(committedPath);
    const projected = fs.readFileSync(projectedPath);
    if (!committed.equals(projected)) {
      failures.push(`${key}/${fileName}: ${firstDifferingLine(committed.toString('utf8'), projected.toString('utf8'))}`);
    }
  }
  return failures;
}

describe('Builder projection parity - full corpus, both lanes', { tags: ['data-validity'] }, () => {
  it('BuilderProjection_CommittedArchiveInventory_IsProjectedExactlyEntryForEntry', () => {
    // Coverage before content: the projection must produce exactly the
    // committed open-data entry set - no entry dropped (a silent fold gap),
    // none invented (a phantom publication the archive never held).
    expect(committedKeys.length).toBeGreaterThanOrEqual(9);
    const projectedKeys = fs.readdirSync(projectionDir)
      .filter(name => fs.statSync(path.join(projectionDir, name)).isDirectory())
      .sort();
    expect(projectedKeys).toEqual(committedKeys);
  });

  it('BuilderProjection_EveryEntryBothLanes_NormalisedCsvIsByteIdentical', () => {
    expect(compareAcrossCorpus('normalised.csv')).toEqual([]);
  });

  it('BuilderProjection_EveryEntryBothLanes_ComponentsCsvIsByteIdentical', () => {
    expect(compareAcrossCorpus('components.csv')).toEqual([]);
  });

  it('BuilderProjection_EveryEntryBothLanes_StatsJsonIsByteIdentical', () => {
    expect(compareAcrossCorpus('stats.json')).toEqual([]);
  });
});
