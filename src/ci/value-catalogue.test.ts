import { describe, it, expect } from 'vitest';
import { catalogueField, renderValueCatalogue } from './value-catalogue.ts';
import { loadReferenceData } from '../sources/ofcom-amateur/components.ts';
import { renderMarkdown } from '../shared/render-markdown.ts';

// The value catalogue (issues #43/#223) enumerates every distinct value of the
// tracked fields across both lanes with counts, flagging the unexpected.
// Test names follow Subject_Scenario_Outcome.

type Cell = { lanes: Set<string>; bySource: Map<string, number>; callsigns?: Set<string>; allocatedCallsigns?: Set<string> };
// Simple form: the whole count under one synthetic source (breadth = 1).
function tallies(spec: Record<string, [string, number, string[]][]>): Map<string, Map<string, Cell>> {
  const t = new Map<string, Map<string, Cell>>();
  for (const [field, rows] of Object.entries(spec)) {
    const m = new Map<string, Cell>();
    for (const [value, count, lanes] of rows) m.set(value, { lanes: new Set(lanes), bySource: new Map([['s', count]]) });
    t.set(field, m);
  }
  return t;
}
// Breakdown form (#245): a value with its distinct callsigns and the subset of
// those callsigns that are allocated, so records / callsigns / allocated differ.
function talliesWithCallsigns(field: string, spec: Record<string, { records: number; callsigns: string[]; allocated: string[]; lanes?: string[] }>): Map<string, Map<string, Cell>> {
  const m = new Map<string, Cell>();
  for (const [value, s] of Object.entries(spec)) {
    m.set(value, {
      lanes: new Set(s.lanes ?? ['open-data']),
      bySource: new Map([['s', s.records]]),
      callsigns: new Set(s.callsigns),
      allocatedCallsigns: new Set(s.allocated),
    });
  }
  return new Map([[field, m]]);
}
// Per-source form for breadth/timeline: field -> value -> { sourceKey -> count }.
function talliesBySource(field: string, spec: Record<string, Record<string, number>>, lanes: string[] = ['open-data']): Map<string, Map<string, Cell>> {
  const m = new Map<string, Cell>();
  for (const [value, bySource] of Object.entries(spec)) {
    m.set(value, { lanes: new Set(lanes), bySource: new Map(Object.entries(bySource)) });
  }
  return new Map([[field, m]]);
}

describe('value catalogue', () => {
  const ref = loadReferenceData();

  it('CatalogueField_OrdersByCountThenValue', () => {
    const cell = (bySource: Record<string, number>, lane: string): Cell =>
      ({ lanes: new Set([lane]), bySource: new Map(Object.entries(bySource)) });
    const cat = catalogueField('f', new Map<string, Cell>([
      ['b', cell({ p: 5 }, 'x')],
      ['a', cell({ q: 5 }, 'y')],
      ['c', cell({ p: 9 }, 'x')],
    ]));
    expect(cat.values.map(v => v.value)).toEqual(['c', 'a', 'b']);
    expect(cat.distinct).toBe(3);
    expect(cat.total).toBe(19);
    // Count is summed across sources; breadth is the distinct-source count.
    expect(cat.values.find(v => v.value === 'c')?.sources).toBe(1);
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
    // records / callsigns / allocated / sources / lanes - allocated is `—` for
    // the status field (the value already IS the status).
    expect(md).toContain('| value | records | callsigns | allocated | sources | lanes |');
    expect(md).toContain('| `Allocated` | 100 | 0 | — | 1 | foi, open-data |');
  });

  it('Render_CountBreakdown_DisambiguatesRecordsDistinctCallsignsAndAllocated', () => {
    // #245: a bare count conflates denominators. The breakdown makes each figure
    // unambiguous - records (rows), the distinct callsigns those span, and how
    // many of those callsigns are allocated.
    const md = renderValueCatalogue(talliesWithCallsigns('prefix_series', {
      // 6 records but only 2 distinct callsigns (each recurs across publications),
      // of which 1 is allocated.
      M0: { records: 6, callsigns: ['M0AAA', 'M0BBB'], allocated: ['M0AAA'] },
    }), ref);
    expect(md).toContain('| value | records | callsigns | allocated | sources | lanes |');
    expect(md).toContain('| `M0` | 6 | 2 | 1 | 1 | open-data |');
  });

  it('Render_Breadth_DistinguishesManySourcesFromHighVolume', () => {
    // A value spread thinly across many publications and one concentrated in a
    // single publication can share a lane; the sources column tells them apart.
    const md = renderValueCatalogue(talliesBySource('status', {
      Spread: { '2022-05-30': 1, '2023-02-20': 1, '2025-04-08': 1 },
      Concentrated: { '2026-06-23': 3000 },
    }), ref);
    expect(md).toContain('| value | records | callsigns | allocated | sources | lanes |');
    expect(md).toContain('| `Spread` | 3 | 0 | — | 3 |');
    expect(md).toContain('| `Concentrated` | 3,000 | 0 | — | 1 |');
  });

  it('Render_Timeline_ShowsPresentThenGoneAsSparkline', () => {
    // A value present in the early publications and absent from the recent ones
    // renders as bars then dots — the "used then dropped" shape at a glance.
    const timeline = ['2022-05-30', '2023-02-20', '2025-04-08', '2026-06-23'];
    const md = renderValueCatalogue(talliesBySource('status', {
      Legacy: { '2022-05-30': 100, '2023-02-20': 100 },
    }), ref, timeline);
    expect(md).toContain('| value | records | callsigns | allocated | sources | timeline | lanes |');
    const row = md.split('\n').find(l => l.startsWith('| `Legacy`')) ?? '';
    // timeline is the sixth data column now (records, callsigns, allocated,
    // sources, timeline).
    expect(row.split('|')[6].trim()).toBe('██··');
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
