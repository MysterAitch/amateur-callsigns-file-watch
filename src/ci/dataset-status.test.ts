import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import { renderDatasetStatus, STATUS_FILE } from './dataset-status.ts';

// Test names follow Subject_Scenario_Outcome per project convention.
//
// docs/dataset-status.md is a generated overview (issue #149): the freshness
// check below is what makes "every PR keeps it up to date" enforceable
// rather than aspirational - archive changes without a regenerated table
// fail here.

describe('Dataset status overview', () => {
  it('DatasetStatus_CommittedFile_MatchesRegenerationExactly', () => {
    const committed = fs.readFileSync(STATUS_FILE, 'utf8');
    expect(committed).toBe(renderDatasetStatus());
  });

  it('DatasetStatus_Rendering_ListsBothLanesWithOneRowPerEntry', () => {
    const rendered = renderDatasetStatus();
    expect(rendered).toContain('## Open-data lane');
    expect(rendered).toContain('## FOI lane');
    // Spot anchors, one per lane, that regressions in the walkers would drop.
    expect(rendered).toContain('| 2026-06-23 |');
    expect(rendered).toContain('| wdtk-1180568--licence-breakdown-duration-age |');
  });
});
