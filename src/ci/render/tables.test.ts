import { describe, it, expect } from 'vitest';
import { breakdownRows } from './tables.ts';

// breakdownRows' optional `labelFor` (issue #553): lets a caller route a
// breakdown's label through a shared field wrapper (status/licence) instead
// of the default escaped-and-humanised text, without disturbing any existing
// caller that does not pass it. Test names follow Subject_Scenario_Outcome.

describe('breakdownRows labelFor', { tags: ['unit'] }, () => {
  it('BreakdownRows_WhenLabelForOmitted_UsesTheDefaultEscapedHumanisedLabel', () => {
    const html = breakdownRows([['Allocated', 3], ['', 1]], 4);
    expect(html).toContain('<span class="lab">Allocated</span>');
    // A blank label still humanises via the shared convention when no
    // labelFor is supplied - unchanged behaviour for every existing caller.
    expect(html).toContain('<span class="lab">(blank)</span>');
  });

  it('BreakdownRows_WhenLabelForGiven_UsesItsReturnedHtmlVerbatimInsteadOfTheDefault', () => {
    const html = breakdownRows([['Allocated', 3]], 3, undefined, undefined, v => `<b>${v}</b>`);
    expect(html).toContain('<span class="lab"><b>Allocated</b></span>');
  });

  it('BreakdownRows_LabelForAndRowAttr_CanCombineOnTheSameRow', () => {
    // A click-to-filter row (rowAttr) can still route its label through a
    // field wrapper pinned to a non-interactive rendering - the two options
    // are independent.
    const html = breakdownRows([['Allocated', 3]], 3, undefined, () => ' data-filter="x"', v => `<i>${v}</i>`);
    expect(html).toContain('<div class="brow" data-filter="x"><span class="lab"><i>Allocated</i></span>');
  });
});
