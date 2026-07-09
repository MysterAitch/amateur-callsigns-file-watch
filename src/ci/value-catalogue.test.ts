import { describe, it, expect } from 'vitest';
import { catalogueField, renderValueCatalogue } from './value-catalogue.ts';
import { loadReferenceData } from '../sources/ofcom-amateur/components.ts';
import { renderMarkdown } from '../shared/render-markdown.ts';

// The value catalogue (issues #43/#223) enumerates every distinct value of the
// tracked fields across both lanes with counts, flagging the unexpected.
// Test names follow Subject_Scenario_Outcome.

type Cell = { count: number; lanes: Set<string> };
function tallies(spec: Record<string, [string, number, string[]][]>): Map<string, Map<string, Cell>> {
  const t = new Map<string, Map<string, Cell>>();
  for (const [field, rows] of Object.entries(spec)) {
    const m = new Map<string, Cell>();
    for (const [value, count, lanes] of rows) m.set(value, { count, lanes: new Set(lanes) });
    t.set(field, m);
  }
  return t;
}

describe('value catalogue', () => {
  const ref = loadReferenceData();

  it('CatalogueField_OrdersByCountThenValue', () => {
    const cat = catalogueField('f', new Map<string, Cell>([
      ['b', { count: 5, lanes: new Set(['x']) }],
      ['a', { count: 5, lanes: new Set(['y']) }],
      ['c', { count: 9, lanes: new Set(['x']) }],
    ]));
    expect(cat.values.map(v => v.value)).toEqual(['c', 'a', 'b']);
    expect(cat.distinct).toBe(3);
    expect(cat.total).toBe(19);
  });

  it('Render_NotableSection_FlagsUnexpectedStatusUnknownPrefixAndDrift', () => {
    const md = renderValueCatalogue(tallies({
      status: [['Allocated', 100, ['open-data']], ['Live', 50, ['foi']], ['(blank)', 2, ['foi']]],
      prefix_series: [['M7', 80, ['open-data']], ['M2', 6, ['foi']]],
      'product / licence_class': [
        ['Full', 30, ['foi']], ['Amateur Full Radio Licence', 40, ['open-data']],
        ['Foundation', 10, ['foi']], ['Amateur Foundation Radio Licence', 12, ['open-data']],
      ],
    }), ref);
    // Notable: a status outside the reasoned-about set, a prefix outside the
    // reference table, and the licence-vocabulary drift. Values render as
    // monospace code spans, so the precise value is unambiguous.
    expect(md).toContain('`Live` (50)');
    expect(md).toContain('`M2` (6)');
    expect(md).toContain('vocabulary drift');
  });

  it('Render_LicenceCategorySection_CollapsesVariantsAndFlagsUnmapped', () => {
    // The "describe, then do": the product/licence_class variants collapse to
    // canonical categories, blank is excluded, an unmapped non-blank surfaces.
    const md = renderValueCatalogue(tallies({
      'product / licence_class': [
        ['Full', 100, ['foi']],
        ['Amateur Full Radio Licence', 40, ['open-data']],
        ['Amateur Foundation Radio Licence', 30, ['open-data']],
        ['(blank)', 500, ['open-data', 'foi']],
        ['Amateur Novice Radio Licence', 3, ['open-data']],
      ],
    }), ref);
    expect(md).toContain('## Normalised licence category');
    // Full's two spellings collapse to one 140-count category listing both.
    expect(md).toContain('| `Full` | 140 |');
    expect(md).toContain('`Full` (100)');
    expect(md).toContain('`Amateur Full Radio Licence` (40)');
    // Blank is called out as a non-category, not folded in.
    expect(md).toContain('`(blank)` (500) is not a category');
    // The unmapped non-blank variant is flagged for a decision (fail loud).
    expect(md).toContain('Unmapped non-blank variants');
    expect(md).toContain('`Amateur Novice Radio Licence` (3)');
  });

  it('Render_FieldTable_ShowsCountsAndLanesWithValuesAsCodeSpans', () => {
    const md = renderValueCatalogue(tallies({
      status: [['Allocated', 100, ['open-data', 'foi']], ['(blank)', 2, ['foi']]],
    }), ref);
    expect(md).toContain('## `status` — 2 distinct');
    expect(md).toContain('| `Allocated` | 100 | foi, open-data |');
  });

  it('Render_ValueWithEdgeWhitespace_IsVisibleInMonospace', () => {
    // A leading space (table cells are trimmed on render, so it would
    // otherwise vanish) surfaces as a codepoint marker; internal spaces of a
    // multi-word value stay readable.
    const md = renderValueCatalogue(tallies({
      status: [[' Allocated', 5, ['foi']]],
    }), ref);
    expect(md).toContain('`{U+0020}Allocated`');
  });

  it('Render_CraftedValue_RendersInertNotInjected', () => {
    // A corrupt/crafted value must not break the table row, inject inline
    // markup, or become a live link/script when the committed report is
    // rendered to HTML — it renders as literal monospace text. This is the
    // property the CodeQL incomplete-sanitization fix guarantees.
    const md = renderValueCatalogue(tallies({
      status: [['a|b<script>[x](y)`', 1, ['foi']]],
    }), ref);
    // The structural characters that could break a code-span-in-a-table are
    // neutralised as visible markers; no raw pipe or unescaped backtick.
    expect(md).toContain('`a{U+007C}b<script>[x](y){U+0060}`');
    const html = renderMarkdown(md);
    expect(html).not.toContain('<script>');       // angle brackets escaped, not live
    expect(html).toContain('<code>');             // rendered as a code span
    expect(html).not.toMatch(/<a [^>]*href="y"/); // the [x](y) is inert, not a link
  });
});
