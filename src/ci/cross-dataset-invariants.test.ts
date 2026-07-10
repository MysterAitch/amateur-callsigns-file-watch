import { describe, it, expect, beforeAll } from 'vitest';
import { buildDepletion, buildOverlapMatrix, renderCrossDatasetInvariants, type CrossDataset, type OverlapMatrix } from './cross-dataset-invariants.ts';

// Issue #241: the cross-dataset probes join each FOI available snapshot against
// the latest register on the cleaned callsign key. Test names follow
// Subject_Scenario_Outcome.

describe('cross-dataset invariants — available-pool depletion', () => {
  // The real-archive join re-parses the whole register (~158k rows) and every
  // FOI snapshot; build it once and share it across the assertions rather than
  // three times (cheaper, and it stops the CPU-heavy join from starving other
  // parallel test workers).
  let d: CrossDataset;
  // Generous hook timeout: the real-archive build is CPU-heavy and a congested
  // CI runner can exceed a tight limit (the build-sqlite.tiers hook hit the same
  // contention and uses the same allowance).
  beforeAll(() => { d = buildDepletion(); }, 480_000);

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
});

describe('cross-dataset invariants — available × record-of overlap matrix', () => {
  // The matrix loads every register vintage (open-data ~150k rows each, plus
  // the FOI register-snapshots) one at a time; build it once and share it.
  let m: OverlapMatrix;
  // Generous hook timeout (see the depletion suite above): the matrix build is
  // heavy and timed out at 60s on a loaded CI runner.
  beforeAll(() => { m = buildOverlapMatrix(); }, 480_000);

  it('OverlapMatrix_RealArchive_HasNinePoolRowsAndVintageOrderedRegisterColumns', () => {
    // Nine available-pool snapshots (2013–2016) as rows.
    expect(m.pools.length).toBe(9);
    // Sixteen surviving register columns: seven open-data publications plus nine
    // FOI register-snapshots (two 2016/2019 FOI snapshots that hold no callsign
    // union are dropped, not shown as all-zero columns).
    expect(m.registers.length).toBe(16);
    expect(m.registers.filter(r => r.kind === 'open-data')).toHaveLength(7);
    expect(m.registers.filter(r => r.kind === 'foi')).toHaveLength(9);
    // Every pool row carries exactly one cell per register column.
    expect(m.present.length).toBe(m.pools.length);
    for (const row of m.present) expect(row.length).toBe(m.registers.length);
    // Rows and columns are both ordered oldest→newest so the age gradient is
    // legible left-to-right and top-to-bottom.
    const monotonic = (v: string[]): boolean => v.every((x, i) => i === 0 || v[i - 1].localeCompare(x) <= 0);
    expect(monotonic(m.registers.map(r => r.vintage))).toBe(true);
    expect(monotonic(m.pools.map(p => p.vintage))).toBe(true);
    // The two truncated publications are flagged partial, not read as low take-up.
    expect(m.registers.filter(r => r.partial).map(r => r.key)).toEqual(['2025-05-27', '2025-06-08']);
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
});
