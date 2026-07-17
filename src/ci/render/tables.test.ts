import { describe, it, expect } from 'vitest';
import { breakdownRows, zeroCell } from './tables.ts';

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

// zeroCell (issue #731): the shared de-emphasis helper CI table builders
// route a numeric cell's already-formatted text through, so a literal zero
// mutes to the shared --muted token wherever it appears.
describe('zeroCell', { tags: ['unit'] }, () => {
  it('ZeroCell_WhenRawValueIsNumberZero_WrapsShownTextInZeroSpan', () => {
    expect(zeroCell(0)).toBe('<span class="zero">0</span>');
  });

  it('ZeroCell_WhenRawValueIsStringZero_WrapsShownTextInZeroSpan', () => {
    expect(zeroCell('0')).toBe('<span class="zero">0</span>');
  });

  it('ZeroCell_WhenShownTextDiffersFromRawValue_WrapsTheShownTextNotTheRaw', () => {
    // A caller passes the already-formatted display text (e.g. a
    // toLocaleString'd figure) separately from the raw value the zero check
    // runs against.
    expect(zeroCell(0, '0 rows')).toBe('<span class="zero">0 rows</span>');
  });

  it('ZeroCell_WhenRawValueIsNonZeroNumber_ReturnsShownTextUnwrapped', () => {
    expect(zeroCell(1234, '1,234')).toBe('1,234');
  });

  it('ZeroCell_WhenRawValueContainsZeroWithinALongerNumber_DoesNotMatch', () => {
    // "10", "0.5", "100" all contain the character "0" but are not
    // themselves the literal value zero - only an exact match mutes.
    expect(zeroCell(10)).toBe('10');
    expect(zeroCell('0.5')).toBe('0.5');
    expect(zeroCell(100)).toBe('100');
  });

  it('ZeroCell_WhenRawValueHasSurroundingWhitespace_StillMatchesAfterTrimming', () => {
    expect(zeroCell(' 0 ', ' 0 ')).toBe('<span class="zero"> 0 </span>');
  });

  it('ZeroCell_WhenRawValueIsEmptyString_ReturnsShownTextUnwrapped', () => {
    // A blank is a different, already-humanised state (see humaniseLabel
    // above) - never muted as though it were a zero.
    expect(zeroCell('', '(blank)')).toBe('(blank)');
  });
});
