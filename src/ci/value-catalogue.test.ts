import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { catalogueField, renderValueCatalogue, collectSesWindowAttestation, type SesWindowAttestation } from './value-catalogue.ts';
import { loadReferenceData } from '../sources/ofcom-amateur/components.ts';
import { DIRS } from '../shared/constants.ts';
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

describe('value catalogue', { tags: ['unit'] }, () => {
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
    // Blank is called out as a non-category, not folded in (now with its own
    // records/callsigns/allocated breakdown).
    expect(md).toContain('`(blank)` (500 records,');
    expect(md).toContain('is not a category');
    // The unmapped non-blank variant is flagged for a decision (fail loud).
    expect(md).toContain('Unmapped non-blank variants');
    expect(md).toContain('`Amateur Novice Radio Licence` (3)');
  });

  it('Render_LicenceCategoryBreakdown_UnionsCallsignsAcrossVariantsNotSum', () => {
    // #245: a callsign written two ways (both fold to `Full`) must count ONCE
    // in the category's callsigns/allocated - a plain sum of the per-variant
    // distinct counts would double-count. `G0AAA` appears under both spellings.
    const md = renderValueCatalogue(talliesWithCallsigns('product / licence_class', {
      'Full': { records: 2, callsigns: ['G0AAA', 'G0BBB'], allocated: ['G0AAA'] },
      'Amateur Full Radio Licence': { records: 2, callsigns: ['G0AAA', 'G0CCC'], allocated: ['G0AAA', 'G0CCC'] },
    }), ref);
    // records = 2 + 2 = 4 (additive); callsigns = union{G0AAA,G0BBB,G0CCC} = 3
    // (NOT 4); allocated = union{G0AAA,G0CCC} = 2 (NOT 3).
    expect(md).toContain('| `Full` | 4 | 3 | 2 |');
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

  it('NormalisationFidelity_DroppedCallsigns_SurfacedInTableAndDetail', () => {
    // The raw-vs-normalised gap (#242): per-publication counts plus the actual
    // dropped forms enumerated (e.g. the 2022 export's furniture lines).
    const md = renderValueCatalogue(tallies({ status: [['Allocated', 1, ['open-data']]] }), ref, [], [
      { key: '2022-05-30', rawRows: 151157, normalisedRows: 151152, dropped: ['Ofcom', 'Confidential Information - Do Not Distribute'], coerced: [] },
      { key: '2026-06-23', rawRows: 158318, normalisedRows: 158318, dropped: [], coerced: [] },
    ]);
    expect(md).toContain('## Normalisation fidelity (raw → normalised)');
    expect(md).toContain('| 2022-05-30 | 151,157 | 151,152 | 2 | 0 |');
    expect(md).toContain('**2022-05-30** — dropped 2:');
    expect(md).toContain('Ofcom');
  });

  it('NormalisationFidelity_NoGaps_StatesFaithful', () => {
    const md = renderValueCatalogue(tallies({ status: [['Allocated', 1, ['open-data']]] }), ref, [], [
      { key: '2026-06-23', rawRows: 158318, normalisedRows: 158318, dropped: [], coerced: [] },
    ]);
    expect(md).toContain('No gaps: normalisation preserved every callsign');
  });
});

describe('special-event family temporal character (issue #344)', { tags: ['ui'] }, () => {
  const ref = loadReferenceData();
  // A product tally so the licence-category section (which the temporal note is
  // appended to) renders; the temporal note rides beside a real category table.
  const baseTallies = tallies({
    status: [['Allocated', 1, ['open-data']]],
    'product / licence_class': [['Special Event Station', 1, ['foi']]],
  });
  const render = (windows: SesWindowAttestation[]): string =>
    renderValueCatalogue(baseTallies, ref, [], [], undefined, undefined, windows);

  it('TemporalCharacter_WhenNoAttestation_OmitsTheSection', () => {
    // No source states a reservation window, so the note is not invented.
    const md = render([]);
    expect(md).not.toContain('Temporal character of the special-event family');
  });

  it('TemporalCharacter_WhenWindowsAttested_RendersCharacterAndCoveragePerCategory', () => {
    const md = render([
      { category: 'Special Event Station', character: 'event-bounded', statingField: 3_715, withEndDate: 3_501, openEnded: 214 },
      { category: 'Special Research Permit', character: 'open-ended', statingField: 1, withEndDate: 0, openEnded: 1 },
    ]);
    expect(md).toContain('### Temporal character of the special-event family');
    expect(md).toContain('| `Special Event Station` | event-bounded | 3,715 | 3,501 | 214 |');
    expect(md).toContain('| `Special Research Permit` | open-ended | 1 | 0 | 1 |');
  });

  it('TemporalCharacter_WhenPermanentRecordExpiresOrEventRecordOpen_FlagsTheCounterExamples', () => {
    // The within-table inconsistency is flagged, never smoothed: an open-ended
    // category whose records nonetheless expire, and an event-bounded category
    // whose records are left open.
    const md = render([
      { category: 'Special Event Station', character: 'event-bounded', statingField: 3_715, withEndDate: 3_501, openEnded: 214 },
      { category: 'Permanent Special Event Station', character: 'open-ended', statingField: 53, withEndDate: 36, openEnded: 17 },
    ]);
    expect(md).toContain('⚠ The correspondence is a tendency the register does not enforce');
    expect(md).toContain('`Permanent Special Event Station`: 36 records nonetheless carry an end date');
    expect(md).toContain('`Special Event Station`: 214 records carry none');
  });

  it('TemporalCharacter_WhenSingleCounterExample_UsesSingularWording', () => {
    const md = render([
      { category: 'Permanent Special Event Station', character: 'open-ended', statingField: 1, withEndDate: 1, openEnded: 0 },
    ]);
    // Singular "record ... carries" (not "records ... carry") for a count of one.
    expect(md).toContain('`Permanent Special Event Station`: 1 record nonetheless carries an end date');
  });

  it('TemporalCharacter_WhenNoCounterExamples_OmitsTheFlagButKeepsTheTable', () => {
    // A category cleanly matching its character (all event records expire) needs
    // no inconsistency flag.
    const md = render([
      { category: 'Special Event Station', character: 'event-bounded', statingField: 100, withEndDate: 100, openEnded: 0 },
    ]);
    expect(md).toContain('### Temporal character of the special-event family');
    expect(md).not.toContain('⚠ The correspondence is a tendency');
  });
});

describe('collectSesWindowAttestation over the real archive', { tags: ['data-validity'] }, () => {
  it('SesWindowAttestation_RealArchive_AttestsTheThreeCategoriesWithTheirRegisterCoverage', () => {
    // The register's own reservation-expiry field, read over the whole FOI lane,
    // attests exactly the three special-event categories and their event-window
    // coverage. The figures are the corpus's own evidence (the 2024-09 register
    // snapshot is the sole source that states the field), pinned so a drift in
    // the mapping or the source trips CI. The permanent category carrying MORE
    // expiring records than open ones is the register's own inconsistency,
    // surfaced not smoothed.
    const ref = loadReferenceData();
    const attestations = collectSesWindowAttestation(path.join(DIRS.archive, 'foi'), ref);
    const byCategory = new Map(attestations.map(a => [a.category, a]));
    expect([...byCategory.keys()].sort()).toEqual([
      'Permanent Special Event Station', 'Special Event Station', 'Special Research Permit',
    ]);
    expect(byCategory.get('Special Event Station')).toEqual({
      category: 'Special Event Station', character: 'event-bounded', statingField: 3_715, withEndDate: 3_501, openEnded: 214,
    });
    expect(byCategory.get('Permanent Special Event Station')).toEqual({
      category: 'Permanent Special Event Station', character: 'open-ended', statingField: 53, withEndDate: 36, openEnded: 17,
    });
    expect(byCategory.get('Special Research Permit')).toEqual({
      category: 'Special Research Permit', character: 'open-ended', statingField: 1, withEndDate: 0, openEnded: 1,
    });
  }, 600_000);
});

describe('buildNormalisationFidelity over the real archive', { tags: ['data-validity'] }, () => {
  it('RealArchive_2022Export_DropsFiveFurnitureLinesOthersFaithful', async () => {
    const { buildNormalisationFidelity } = await import('./value-catalogue.ts');
    const fidelity = buildNormalisationFidelity();
    const y2022 = fidelity.find(f => f.key === '2022-05-30');
    // The 2022 raw export carried five non-callsign furniture lines (title,
    // copyright, confidentiality, generator stamp, "Ofcom") that normalisation
    // correctly excluded; nothing was coerced.
    expect(y2022?.dropped.length).toBe(5);
    expect(y2022?.coerced.length).toBe(0);
    expect(y2022?.dropped).toContain('Ofcom');
    // Every other publication is 1:1 faithful (no drops, no coercions).
    for (const f of fidelity.filter(f => f.key !== '2022-05-30')) {
      expect(f.dropped.length).toBe(0);
      expect(f.coerced.length).toBe(0);
    }
  }, 600_000);
});
