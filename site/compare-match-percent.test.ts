// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { matchPercentCell } from './compare.js';
import { ABSENT_CLASS, ABSENT_MARKER, ABSENT_LABEL } from './field-wrappers.js';

// The counts table's '% of publication' cell (issue #199): a real cohort
// renders its matching-rows share as a percentage; a zero-total cohort has no
// percentage to compute at all, so it degrades to the shared absent-value
// marker (#826) rather than a fabricated "0.00%" or "NaN%". Test names follow
// the Subject_Scenario_Outcome convention.

describe('compare matchPercentCell', { tags: ['ui'] }, () => {
  it('MatchPercentCell_WhenTotalIsPositive_RendersTheRoundedPercentage', () => {
    const cell = matchPercentCell(200, 50);
    expect(cell.tagName).toBe('TD');
    expect(cell.textContent).toBe('25.00%');
  });

  it('MatchPercentCell_WhenTotalIsZero_RendersTheAbsentMarkerNotAFabricatedPercentage', () => {
    const cell = matchPercentCell(0, 0);
    const marker = cell.querySelector(`.${ABSENT_CLASS}`);
    expect(marker?.textContent).toBe(ABSENT_MARKER);
    expect(marker?.getAttribute('title')).toBe(ABSENT_LABEL);
    expect(marker?.getAttribute('aria-label')).toBe(ABSENT_LABEL);
    expect(cell.textContent).not.toMatch(/NaN|undefined/);
  });
});
