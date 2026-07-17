import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { buildDepletion, buildOverlapMatrix, buildComplementarity, renderCrossDatasetInvariants, CROSS_DATASET_INVARIANTS_PATH, type CrossDataset, type OverlapMatrix, type Complementarity } from './cross-dataset-invariants.ts';
import { duckDbAvailable } from '../v2/report-fold.ts';
import { DIRS } from '../shared/constants.ts';

// Issue #241: the cross-dataset probes join each FOI available snapshot against
// the latest register on the cleaned callsign key. Issue #361: the join is now a
// build-time DuckDB fold over the normalised register/pool projections. Test
// names follow Subject_Scenario_Outcome.

// The renderers are pure functions of already-computed structs, so they need no
// DuckDB and always run — they lock the committed report's exact formatting.
describe('cross-dataset invariants — renderers', { tags: ['unit'] }, () => {
  it('Render_AllSections_ShowDepletionDecompositionAndDateInvariant', () => {
    const md = renderCrossDatasetInvariants({
      register: '2026-06-23', allocatedTotal: 105332,
      rows: [{
        entry: 'wdtk-174341--available-callsigns-list', vintage: '2013-09-06',
        available: 26646, nowAllocated: 14966, stillAbsent: 11680,
        nowReserved: 2662, stillAvailable: 121, absentFromRegister: 8897,
        allocatedWithDate: 14966, issuedBeforeVintage: 25,
      }],
    });
    expect(md).toContain('# Cross-dataset invariants');
    expect(md).toContain('## Available-pool depletion');
    expect(md).toContain('| `wdtk-174341--available-callsigns-list` | 2013-09-06 | 26,646 | 14,966 | 11,680 | 56.2% |');
    expect(md).toContain('## Absent-from-both, decomposed');
    expect(md).toContain('| `wdtk-174341--available-callsigns-list` | 2013-09-06 | 11,680 | 2,662 | 121 | 8,897 |');
    expect(md).toContain('## Original-issue-date invariant');
    expect(md).toContain('| `wdtk-174341--available-callsigns-list` | 2013-09-06 | 14,966 | 25 | 0.2% |');
  });

  it('OverlapRender_SyntheticMatrix_ShowsSectionHeaderAndCellPercentages', () => {
    const md = renderCrossDatasetInvariants(
      { register: '2026-06-23', allocatedTotal: 0, rows: [] },
      {
        pools: [{ entry: 'pool-a', vintage: '2013-09-06', size: 100 }],
        registers: [
          { key: '2016-09', vintage: '2016-09', kind: 'foi', size: 50, partial: false },
          { key: '2026-06-23', vintage: '2026-06-23', kind: 'open-data', size: 200, partial: false },
        ],
        present: [[40, 66]],
      },
    );
    expect(md).toContain('## Available × record-of overlap matrix');
    // Independent hand computation: 40/100 = 40.0%, 66/100 = 66.0%.
    expect(md).toContain('| `pool-a` | 2013-09-06 | 100 | 40.0% | 66.0% |');
  });

  it('OverlapRender_PartialColumn_IsFlaggedAndExplained', () => {
    const md = renderCrossDatasetInvariants(
      { register: '2026-06-23', allocatedTotal: 0, rows: [] },
      {
        pools: [{ entry: 'pool-a', vintage: '2013-09-06', size: 100 }],
        registers: [
          { key: '2025-05-27', vintage: '2025-05-27', kind: 'open-data', size: 1074, partial: true },
          { key: '2026-06-23', vintage: '2026-06-23', kind: 'open-data', size: 200, partial: false },
        ],
        present: [[1, 66]],
      },
    );
    expect(md).toContain('Columns marked ⚠ are **partial publications**');
    expect(md).toContain('- `2025-05-27` ⚠ — open-data `2025-05-27` (1,074 keys, partial publication)');
    expect(md).toContain('| `pool-a` | 2013-09-06 | 100 | 1.0% | 66.0% |');
  });

  it('ComplementarityRender_BlockedResidual_ExplainsInvariantAndShowsVintageGap', () => {
    const md = renderCrossDatasetInvariants(
      { register: '2026-06-23', allocatedTotal: 0, rows: [] },
      undefined,
      {
        pools: [{ entry: 'pool-a', poolVintage: '2016-01-21', nearestRegisterKey: 'reg-2016-09', nearestRegisterVintage: '2016-09', gapDays: 224 }],
        matched: false,
      },
    );
    expect(md).toContain('## Same-vintage complementarity (documented residual)');
    expect(md).toContain('should be **complementary**');
    expect(md).toContain('| `pool-a` | 2016-01-21 | `reg-2016-09` | 2016-09 | 224 |');
    expect(md).toContain('No register snapshot shares a pool vintage');
  });

  it('ComplementarityRender_MatchedVintage_SignalsProbeIsNowComputable', () => {
    // The opposite scenario: once a register shares a pool vintage the residual
    // must announce it is computable rather than restate the block.
    const md = renderCrossDatasetInvariants(
      { register: '2026-06-23', allocatedTotal: 0, rows: [] },
      undefined,
      {
        pools: [{ entry: 'pool-a', poolVintage: '2016-09', nearestRegisterKey: 'reg-2016-09', nearestRegisterVintage: '2016-09', gapDays: 0 }],
        matched: true,
      },
    );
    expect(md).toContain('**A register snapshot now shares a pool vintage**');
    expect(md).toContain('| `pool-a` | 2016-09 | `reg-2016-09` | 2016-09 | 0 |');
    expect(md).not.toContain('No register snapshot shares a pool vintage');
  });

  it('ComplementarityRender_UnparseableVintage_RendersGapAsUnknown', () => {
    // A pool whose vintage cannot be parsed to a date yields an unknown gap
    // rather than a fabricated day count.
    const md = renderCrossDatasetInvariants(
      { register: '2026-06-23', allocatedTotal: 0, rows: [] },
      undefined,
      {
        pools: [{ entry: 'pool-x', poolVintage: '—', nearestRegisterKey: 'reg-2016-09', nearestRegisterVintage: '2016-09', gapDays: undefined }],
        matched: false,
      },
    );
    expect(md).toContain('| `pool-x` | — | `reg-2016-09` | 2016-09 | — |');
  });
});

// The real-archive fold needs the pinned DuckDB CLI (DUCKDB_BIN / `duckdb` on
// PATH, installed in CI by .github/actions/setup-duckdb). Where the binary is
// absent — a bare local checkout — these cases skip rather than pretend the fold
// was verified. CI always has it, so the byte-identity gate always runs there.
describe.skipIf(!duckDbAvailable())('cross-dataset invariants — real-archive fold', { tags: ['data-validity'] }, () => {
  // The real-archive fold reads every FOI snapshot and the ~158k-row registers;
  // build each struct once and share it across the assertions rather than
  // re-folding per test. Generous hook timeout: a congested CI runner can be
  // slow, matching the allowance the build-sqlite tiers hook uses.
  let d: CrossDataset;
  let m: OverlapMatrix;
  let c: Complementarity;
  beforeAll(() => { d = buildDepletion(); m = buildOverlapMatrix(); c = buildComplementarity(); }, 480_000);

  // The retirement gate (issue #361): the report folded from the claim data via
  // DuckDB must equal the committed golden byte-for-byte. This IS the proof that
  // the fold reproduces the legacy join, so the legacy generator can retire.
  it('CrossDatasetInvariants_FoldedFromClaimData_MatchesCommittedGoldenByteForByte', () => {
    const golden = fs.readFileSync(path.resolve(process.cwd(), CROSS_DATASET_INVARIANTS_PATH), 'utf8');
    expect(renderCrossDatasetInvariants(d, m, c)).toBe(golden);
  });

  it('AvailablePool_2013Snapshot_DepletionMatchesIndependentJoin', () => {
    const s = d.rows.find(r => r.entry === 'wdtk-174341--available-callsigns-list');
    // Cross-checked by an independent cleaned join outside the generator.
    expect(s?.available).toBe(26646);
    expect(s?.nowAllocated).toBe(14966);
    expect(s?.stillAbsent).toBe(26646 - 14966);
    // Two FOI responses of the same-vintage list must agree exactly.
    const a = d.rows.find(r => r.entry === 'wdtk-294011--available-callsigns-list');
    const b = d.rows.find(r => r.entry === 'wdtk-299321--available-callsigns-list');
    expect(a).toBeDefined();
    expect(a?.available).toBe(b?.available);
    expect(a?.nowAllocated).toBe(b?.nowAllocated);
    // Drawdown is a proper subset: never more allocated than were available.
    for (const r of d.rows) expect(r.nowAllocated).toBeLessThanOrEqual(r.available);
  });

  it('AbsentFromBoth_2013Snapshot_DecompositionSumsToStillAbsentAndMatchesJoin', () => {
    const s = d.rows.find(r => r.entry === 'wdtk-174341--available-callsigns-list');
    // Independently cross-checked status decomposition of the still-absent pool.
    expect(s?.nowReserved).toBe(2662);
    expect(s?.stillAvailable).toBe(121);
    expect(s?.absentFromRegister).toBe(8897);
    // The three buckets partition the still-absent remainder, for every row.
    for (const r of d.rows) {
      expect(r.nowReserved + r.stillAvailable + r.absentFromRegister).toBe(r.stillAbsent);
    }
  });

  it('OriginalIssueDate_2013Snapshot_CountsCallsignsFirstLicensedBeforeVintage', () => {
    const s = d.rows.find(r => r.entry === 'wdtk-174341--available-callsigns-list');
    // Independently cross-checked: of the 14,966 now allocated, 25 carry an
    // original-start-date predating the 2013-09-06 snapshot — reconciliation
    // candidates, not proven errors.
    expect(s?.allocatedWithDate).toBe(14966);
    expect(s?.issuedBeforeVintage).toBe(25);
    // The anomaly is always a subset of the dated allocations.
    for (const r of d.rows) expect(r.issuedBeforeVintage).toBeLessThanOrEqual(r.allocatedWithDate);
  });

  it('OverlapMatrix_RealArchive_HasNinePoolRowsAndVintageOrderedRegisterColumns', () => {
    // Nine available-pool snapshots (2013–2016) as rows.
    expect(m.pools.length).toBe(9);
    // Thirty-four surviving register columns: nine open-data publications
    // (including the two web-archive-recovered vintages, 2025-11-11 and
    // 2026-01-14) plus twenty-five FOI register-snapshots (two FOI snapshots
    // that hold no callsign union are dropped, not shown as all-zero columns).
    expect(m.registers.length).toBe(34);
    expect(m.registers.filter(r => r.kind === 'open-data')).toHaveLength(9);
    expect(m.registers.filter(r => r.kind === 'foi')).toHaveLength(25);
    // Every pool row carries exactly one cell per register column.
    expect(m.present.length).toBe(m.pools.length);
    for (const row of m.present) expect(row.length).toBe(m.registers.length);
    // Rows and columns are both ordered oldest→newest so the age gradient is
    // legible left-to-right and top-to-bottom.
    const monotonic = (v: string[]): boolean => v.every((x, i) => i === 0 || v[i - 1].localeCompare(x) <= 0);
    expect(monotonic(m.registers.map(r => r.vintage))).toBe(true);
    expect(monotonic(m.pools.map(p => p.vintage))).toBe(true);
    // Four partial-coverage columns are flagged, not read as low take-up: the
    // two 2020 FOI exports are status-filtered slices (allocated-only and
    // reserved-only) and the two 2025 open-data publications are truncated.
    expect(m.registers.filter(r => r.partial).map(r => r.key)).toEqual(['ofcom-2020-03-26--allocated-callsigns', 'ofcom-2020-10-23--reserved-callsigns', '2025-05-27', '2025-06-08']);
  });

  it('OverlapMatrix_2013PoolVsLatestRegister_PresentEqualsDepletionComplement', () => {
    const pi = m.pools.findIndex(p => p.entry === 'wdtk-174341--available-callsigns-list');
    const ri = m.registers.findIndex(r => r.key === '2026-06-23');
    expect(pi).toBeGreaterThanOrEqual(0);
    expect(ri).toBeGreaterThanOrEqual(0);
    // Independent hand computation: presence (any register row) of the 2013 pool
    // in the latest register is exactly the pool minus the "absent from register"
    // residue the depletion probe already locks — 26,646 − 8,897 = 17,749.
    expect(m.pools[pi].size).toBe(26646);
    expect(m.present[pi][ri]).toBe(26646 - 8897);
  });

  it('OverlapMatrix_EveryPool_OverlapsLatestRegisterMoreThanEarliest', () => {
    // The age gradient at its endpoints: for every pool, more of it is present
    // in the newest register than in the oldest — the pool is taken up over
    // time. (Individual mid columns can dip where a publication holds fewer
    // rows, e.g. the smaller 2025-06-04 export, so the robust claim is the
    // oldest→newest span, not step-by-step monotonicity.)
    const earliest = 0;
    const latest = m.registers.length - 1;
    expect(m.registers[earliest].vintage).toBe('2016-09');
    expect(m.registers[latest].key).toBe('2026-06-23');
    for (let pi = 0; pi < m.pools.length; pi += 1) {
      expect(m.present[pi][latest]).toBeGreaterThan(m.present[pi][earliest]);
    }
  });
});

// The same-vintage complementarity probe (issue #241) is a documented residual:
// un-computable without a register snapshot matching an available-pool vintage,
// which the holdings lack. Its build reads only vintage metadata (no DuckDB), so
// this guard runs wherever the archive is checked out, and asserts the residual
// stays honest — the moment a matched-vintage snapshot lands, `matched` flips and
// this fails, signalling the real probe is now due.
describe.skipIf(!fs.existsSync(path.join(DIRS.archive, 'foi')))('cross-dataset invariants — complementarity residual (real archive)', { tags: ['data-validity'] }, () => {
  it('SameVintageComplementarity_NoRegisterSharesAPoolVintage_ProbeRemainsBlocked', () => {
    const c = buildComplementarity();
    // The residual is only honest while genuinely un-computable: no register
    // snapshot may share an available-pool vintage.
    expect(c.matched).toBe(false);
    expect(c.pools.length).toBeGreaterThan(0);
    for (const p of c.pools) {
      // Every pool has a nearest register strictly later than it — a positive
      // gap; a zero gap would be a matched vintage, which `matched` would catch.
      expect(p.gapDays).toBeGreaterThan(0);
      expect(p.nearestRegisterKey).not.toBe('');
    }
    // Every 2013–2016 available pool is nearest to the earliest register held.
    expect(new Set(c.pools.map(p => p.nearestRegisterVintage))).toEqual(new Set(['2016-09']));
  });
});
