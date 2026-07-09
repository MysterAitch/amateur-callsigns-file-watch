import { describe, it, expect } from 'vitest';
import { catalogueField, renderValueCatalogue } from './value-catalogue.ts';
import { loadReferenceData } from '../sources/ofcom-amateur/components.ts';

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
    // reference table, and the licence-vocabulary drift.
    expect(md).toContain('Live (50)');
    expect(md).toContain('M2 (6)');
    expect(md).toContain('vocabulary drift');
  });

  it('Render_FieldTable_ShowsCountsAndLanes', () => {
    const md = renderValueCatalogue(tallies({
      status: [['Allocated', 100, ['open-data', 'foi']], ['(blank)', 2, ['foi']]],
    }), ref);
    expect(md).toContain('## `status` — 2 distinct');
    expect(md).toContain('| Allocated | 100 | foi, open-data |');
  });

  it('Render_CraftedValue_IsEscapedNotInjected', () => {
    // A corrupt/crafted value must not break the table, inject markdown, or
    // carry markup into a page rendered from the report (the CodeQL
    // incomplete-sanitization fix).
    const md = renderValueCatalogue(tallies({
      status: [['a|b<script>[x](y)`', 1, ['foi']]],
    }), ref);
    expect(md).not.toContain('<script>');    // raw angle-bracket markup neutralised
    // Every metacharacter is backslash-escaped: pipe, angle brackets, link
    // brackets and backtick can no longer break the cell or inject.
    expect(md).toContain('a\\|b\\<script\\>\\[x\\](y)\\`');
  });
});
