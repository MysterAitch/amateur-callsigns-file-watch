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
// to the committed ones. Byte identity is the honest bar - the committed
// files are byte-deterministic by construction (their derivation required a
// no-op on re-run), so any weaker (semantic) comparison would hide a real
// divergence. EVERY entry carrying committed derivatives is compared, both
// lanes, no sampling; a failure names the entry and the first differing line.
//
// An entry with NO committed derivatives at all is legitimately outside the
// baseline: a freshly landed publication carries raw + meta only until (and,
// once #446 freezes the committed baseline, ever after) - the projection must
// still cover it (the inventory test), but there is nothing committed to
// byte-compare against; its protection is the projection invariant suite, the
// reconstruction oracle and the new-entry lane tests. PARTIAL presence (one
// or two of the three files) is never legitimate and stays a failure, and the
// baseline itself is pinned entry by entry (FROZEN_BASELINE_KEYS) so no
// publication can quietly leave it.
//
// The gate's standing value: two independent derivation paths - the authored
// converter lane that wrote the committed files, and the claim-ledger fold -
// agreeing byte-for-byte over the committed baseline. That agreement is what
// licenses every consumer to read the projection.
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

// The frozen committed baseline, pinned entry by entry: every dated
// publication whose derivatives were committed by the derivation lane. A
// publication landing AFTER the freeze legitimately never joins this list;
// one LEAVING it (committed derivatives deleted) must fail the gate loudly,
// which a live directory scan alone could not guarantee.
const FROZEN_BASELINE_KEYS = [
  '2022-05-30',
  '2023-02-20',
  '2025-04-08',
  '2025-05-27',
  '2025-06-04',
  '2025-06-08',
  '2025-11-11',
  '2026-01-14',
  '2026-06-23',
] as const;

// The entries carrying a committed baseline: the pinned freeze list plus any
// later entry that does carry committed derivatives (derivation still runs
// until #446 lands, so the baseline may still grow - growth is welcome,
// silent shrinkage is not).
function baselineKeys(): string[] {
  const scanned = committedKeys.filter(key =>
    PROJECTED_ENTRY_FILES.some(file => fs.existsSync(path.join(CONSTANTS.DIRS.archive, key, file))));
  return [...new Set([...FROZEN_BASELINE_KEYS, ...scanned])].sort();
}

// Compare one derivative file across the two lanes for every BASELINE entry,
// returning one named failure per divergent entry. Buffer equality first (the
// cheap whole-file check), then a line-located message on mismatch. A
// baseline entry missing this one file is a failure (a partial baseline is
// never legitimate), as is a projection gap.
function compareAcrossCorpus(fileName: (typeof PROJECTED_ENTRY_FILES)[number]): string[] {
  const failures: string[] = [];
  for (const key of baselineKeys()) {
    const committedPath = path.join(CONSTANTS.DIRS.archive, key, fileName);
    const projectedPath = path.join(projectionDir, key, fileName);
    if (!fs.existsSync(committedPath)) {
      failures.push(`${key}/${fileName}: committed file is missing - the entry is in the pinned frozen baseline (or carries sibling derivatives), so its committed derivatives must never disappear`);
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
    // none invented (a phantom publication the archive never held). This
    // spans EVERY archive entry, baseline or not: a publication with no
    // committed derivatives must still fold.
    expect(committedKeys.length).toBeGreaterThanOrEqual(9);
    const projectedKeys = fs.readdirSync(projectionDir)
      .filter(name => fs.statSync(path.join(projectionDir, name)).isDirectory())
      .sort();
    expect(projectedKeys).toEqual(committedKeys);
  });

  it('BuilderProjection_EveryPinnedBaselineEntry_StillCarriesAllThreeCommittedDerivatives', () => {
    // The byte-parity oracle is only as strong as its baseline: every pinned
    // publication must keep all three committed derivatives. A live scan
    // alone would let an entry leave the baseline silently (a bad merge, a
    // botched retirement); the pin makes shrinkage loud.
    const missing = FROZEN_BASELINE_KEYS.flatMap(key =>
      PROJECTED_ENTRY_FILES
        .filter(file => !fs.existsSync(path.join(CONSTANTS.DIRS.archive, key, file)))
        .map(file => `${key}/${file}`));
    expect(missing).toEqual([]);
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
