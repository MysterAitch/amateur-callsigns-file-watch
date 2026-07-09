import { describe, it, expect } from 'vitest';
import { buildDepletion, renderCrossDatasetInvariants } from './cross-dataset-invariants.ts';

// Issue #241: the cross-dataset probes join each FOI available snapshot against
// the latest register on the cleaned callsign key. Test names follow
// Subject_Scenario_Outcome.

describe('cross-dataset invariants — available-pool depletion', () => {
  it('AvailablePool_2013Snapshot_DepletionMatchesIndependentJoin', () => {
    const d = buildDepletion();
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
  }, 60_000);

  it('AbsentFromBoth_2013Snapshot_DecompositionSumsToStillAbsentAndMatchesJoin', () => {
    const d = buildDepletion();
    const s = d.rows.find(r => r.entry === 'wdtk-174341--available-callsigns-list');
    // Independently cross-checked status decomposition of the still-absent pool.
    expect(s?.nowReserved).toBe(2662);
    expect(s?.stillAvailable).toBe(121);
    expect(s?.absentFromRegister).toBe(8897);
    // The three buckets partition the still-absent remainder, for every row.
    for (const r of d.rows) {
      expect(r.nowReserved + r.stillAvailable + r.absentFromRegister).toBe(r.stillAbsent);
    }
  }, 60_000);

  it('OriginalIssueDate_2013Snapshot_CountsCallsignsFirstLicensedBeforeVintage', () => {
    const d = buildDepletion();
    const s = d.rows.find(r => r.entry === 'wdtk-174341--available-callsigns-list');
    // Independently cross-checked: of the 14,966 now allocated, 25 carry an
    // original-start-date predating the 2013-09-06 snapshot — reconciliation
    // candidates, not proven errors.
    expect(s?.allocatedWithDate).toBe(14966);
    expect(s?.issuedBeforeVintage).toBe(25);
    // The anomaly is always a subset of the dated allocations.
    for (const r of d.rows) expect(r.issuedBeforeVintage).toBeLessThanOrEqual(r.allocatedWithDate);
  }, 60_000);

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
