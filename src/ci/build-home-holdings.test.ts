import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  yearOf,
  monthLabel,
  holdingsPublications,
  seriesMilestones,
  homeMilestones,
  homeHoldings,
  buildHomeHoldings,
  loadPrefixIntroRows,
  SYSTEM_MIGRATION_MILESTONE,
  type PrefixIntroRow,
} from './build-home-holdings.ts';
import { buildCallsignShards } from './build-callsign-shards.ts';
import { defaultHomeModel, enhanceHomeModel, parseHoldings } from '../../site/v1/home-sections.js';
import { pinArchiveToFrozenBaseline } from '../testing/frozen-baseline-archive.ts';

// Reads committed derived files, which stop at the frozen baseline.
pinArchiveToFrozenBaseline();

// The home span-dial holdings manifest (issue #921): a build-time DERIVATION of
// the held publications (the down-markers) from the shards-manifest enumeration,
// plus the register-history milestones (the up-markers) sourced ONLY from
// already-cited in-repo reference data. Test names follow Subject_Scenario_Outcome.
//
// These exercise the pure derivation directly, plus the non-happy paths: an
// empty archive, a single publication, undated datasets, and the claims-bar on
// every milestone's authored wording.

type ManifestDataset = Parameters<typeof holdingsPublications>[0][number];

// A small, deliberately out-of-order dataset enumeration in the shards-manifest
// shape, spanning both lanes and several kinds, with one undated FOI entry and a
// year gap (no 2018 publication) — the honest-gap case the dial must preserve.
const DATASETS: ManifestDataset[] = [
  { lane: 'open-data', vintage: '2026-06-23', title: 'Ofcom open data, 2026-06-23', classes: ['register-snapshot'], rows: 158318 },
  { lane: 'foi', vintage: '2013-09-06', title: 'wdtk-174341--available-callsigns-list', classes: ['available-pool'], rows: 9099 },
  { lane: 'open-data', vintage: '2017-07-03', title: 'Ofcom open data, 2017-07-03', classes: ['register-snapshot'], rows: 120000 },
  { lane: 'foi', vintage: null, title: 'wdtk-undated--reference-note', classes: ['reference-context'], rows: 0 },
  { lane: 'open-data', vintage: '2019-01-14', title: 'Ofcom open data, 2019-01-14', classes: ['register-snapshot'], rows: 130000 },
];

// The prefix-series introduction rows, in the prefix-formats.csv shape: two that
// record an introduction (each cited), one that does not.
const PREFIX_ROWS: PrefixIntroRow[] = [
  { prefix: 'M7', introduced: '2018-10', notes: 'Introduced October 2018 — cited to FOI reservation data.' },
  { prefix: 'M0', introduced: '', notes: '' },
  { prefix: 'M8', introduced: '2025-10', notes: 'Introduced October 2025.' },
];

// The claims-bar phrasings the wording gate forbids (mirrors site/v1/copy.test.ts):
// verdict words and world-scoped absolutism must never appear in an authored
// milestone label or citation.
const BANNED_PHRASES = ['this is an ordinary issuance', 'no earlier callsign carried it', 'definitely', 'proves', 'confirmed-as-fact'];

describe('home holdings — publications (the down-markers)', { tags: ['unit'] }, () => {
  it('HoldingsPublications_MixedLaneEnumeration_ProjectsDatedEntriesInVintageOrder', () => {
    const pubs = holdingsPublications(DATASETS);
    // The undated FOI entry has no axis position, so it is dropped from the
    // markers (it would ride an "undated" affordance, not the dated axis).
    expect(pubs.map(p => p.vintage)).toEqual(['2013-09-06', '2017-07-03', '2019-01-14', '2026-06-23']);
  });

  it('HoldingsPublications_EachMark_CarriesItsKindLetterForColourIndependentReading', () => {
    const pubs = holdingsPublications(DATASETS);
    const byVintage = new Map(pubs.map(p => [p.vintage, p]));
    // The kind letter is the same vocabulary the v0 holdings map uses.
    expect(byVintage.get('2013-09-06')?.letter).toBe('A'); // available-pool
    expect(byVintage.get('2026-06-23')?.letter).toBe('R'); // register-snapshot
  });

  it('HoldingsPublications_NewestRegisterSnapshot_IsTheSingleRingedLatest', () => {
    const pubs = holdingsPublications(DATASETS);
    const ringed = pubs.filter(p => p.latest);
    expect(ringed).toHaveLength(1);
    expect(ringed[0].vintage).toBe('2026-06-23');
  });

  it('HoldingsPublications_ClasslessDataset_FallsBackToTheLaneKindFromTheSharedConstant', () => {
    // A dataset declaring no class falls back to the lane's implicit kind — the
    // SAME constant the holdings map uses (imported, not hand-duplicated), so the
    // home dial and the v0 map can never drift on the fallback.
    const classless: ManifestDataset[] = [
      { lane: 'open-data', vintage: '2020-01-01', title: 'classless open-data', classes: [], rows: 5 },
      { lane: 'foi', vintage: '2020-02-01', title: 'classless foi', classes: [], rows: 5 },
    ];
    const pubs = holdingsPublications(classless);
    const byVintage = new Map(pubs.map(p => [p.vintage, p]));
    expect(byVintage.get('2020-01-01')?.kind).toBe('register-snapshot');
    expect(byVintage.get('2020-01-01')?.letter).toBe('R');
    expect(byVintage.get('2020-02-01')?.kind).toBe('reference-context');
    expect(byVintage.get('2020-02-01')?.letter).toBe('C');
  });
});

describe('home holdings — real archive (deriving over the committed corpus)', { tags: ['unit'] }, () => {
  it('HoldingsPublications_RealArchive_KeepsEverySameDateCollisionAsADistinctPublication', () => {
    // Regression pin for the collision finding: the committed archive holds a
    // six-way same-date collision on 2015-10-13 (and other multi-way dates).
    // Every colliding publication must survive as its own manifest entry — the
    // dial stacks them, so none may be folded away here. Built through the REAL
    // builders over the committed corpus.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'home-holdings-real-'));
    buildCallsignShards(path.join(root, 'callsign', 'data'));
    const holdings = buildHomeHoldings(root);
    const byDate = new Map<string, number>();
    for (const p of holdings.publications) byDate.set(p.vintage, (byDate.get(p.vintage) ?? 0) + 1);
    expect(byDate.get('2015-10-13'), 'the 2015-10-13 six-way collision must keep all six publications').toBe(6);
    // The count is the number of held (dated) publications — collisions included.
    expect(holdings.publications.length).toBe(holdings.count);
    // The deepest stack is at least the six-way case, so the dial reserves room.
    const maxStack = Math.max(...byDate.values());
    expect(maxStack).toBeGreaterThanOrEqual(6);
  });
});

// The live archive's register era as the shards manifest describes it at the
// 22 September 2026 build: [manifest index, vintage, first class, records in the
// file, intendedComplete, whether a verified coverage note says it omits rows].
// Replaying it truncated after each publication asks which file the site would
// have called "the newest register" on that day. Most answers were decided from
// each file's own recorded scope before the rule existed: an allocated-only list
// (2020-03-26), a reserved-only list (2020-10-23), two lists whose entries record
// that they omit the reserved pool (2023-11-24, 2023-12-07), an issued-scope file
// (2024-07-22), the two 1,074-row truncated open-data files, the 2025-06-04 file
// that omits every blank-product record, and the 2026-01-14 file that omits every
// suffix containing Z are never the newest register; nor is anything that is not
// a register snapshot. ONE answer rests on size alone, the rule's own signal: the
// smaller 2024-10 duration-breakdown sheet (103,720 records beside its 156,256
// sibling) records no scope of its own. And one answer is a known weakness, not a
// success: after 2021-01 the newest register is the "corrupt annex" export, a
// narrower copy with fourteen broken callsign cells whose clean twin arrived
// 2021-01-29 - nothing in the manifest marks it, so the rule takes it.
const REAL_REGISTER_ERA: [number, string, string, number, boolean | null, boolean][] = [
  [27, '2016-09', 'register-snapshot', 139758, null, false],
  [28, '2016-09-20', 'register-snapshot', 139758, null, false],
  [29, '2017-07-13', 'register-snapshot', 135866, null, false],
  [30, '2017-11', 'issuance-events', 113, null, false],
  [31, '2017-11', 'issuance-events', 319, null, false],
  [32, '2019-08-12', 'register-snapshot', 141295, null, false],
  [33, '2019-09-12', 'register-snapshot', 141295, null, false],
  [34, '2020-03-26', 'register-snapshot', 92318, null, false],
  [35, '2020-04-23', 'attribute-addendum', 2049, null, false],
  [36, '2020-10-23', 'register-snapshot', 50524, null, false],
  [37, '2021-01', 'register-snapshot', 146469, null, false],
  [38, '2021-01-29', 'register-snapshot', 146763, null, false],
  [39, '2021-04-21', 'register-snapshot', 147877, null, false],
  [40, '2022-03-07', 'register-snapshot', 150181, null, false],
  [41, '2022-03-14', 'register-snapshot', 150238, null, false],
  [42, '2022-05-30', 'register-snapshot', 151152, true, false],
  [43, '2023-01-25', 'register-snapshot', 152084, null, false],
  [44, '2023-02-20', 'register-snapshot', 152084, true, false],
  [45, '2023-08-18', 'register-snapshot', 153248, null, false],
  [46, '2023-11-24', 'register-snapshot', 108922, null, false],
  [47, '2023-12-07', 'register-snapshot', 108992, null, false],
  [48, '2024-01', 'register-snapshot', 153938, null, false],
  [49, '2024-04-30', 'register-snapshot', 154582, null, false],
  [50, '2024-07', 'register-snapshot', 155346, null, false],
  [51, '2024-07-22', 'register-snapshot', 110622, null, false],
  [52, '2024-09', 'register-snapshot', 159999, null, false],
  [53, '2024-10', 'register-snapshot', 156256, null, false],
  [54, '2024-10', 'register-snapshot', 103720, null, false],
  [55, '2024-10-21', 'register-snapshot', 156278, null, false],
  [56, '2025-03-13', 'register-snapshot', 157227, null, false],
  [57, '2025-04-08', 'register-snapshot', 157427, true, false],
  [58, '2025-05-27', 'register-snapshot', 1074, false, false],
  [59, '2025-06-04', 'register-snapshot', 112650, true, true],
  [60, '2025-06-08', 'register-snapshot', 1074, false, false],
  [61, '2025-09-11', 'register-snapshot', 158470, null, false],
  [62, '2025-11-11', 'register-snapshot', 159895, true, false],
  [63, '2026-01-14', 'register-snapshot', 146417, true, true],
  [64, '2026-06-23', 'register-snapshot', 158318, true, false],
  [65, '2026-09-22', 'register-snapshot', 163342, true, false],
];

// Truncated after manifest index → the index the site should call the newest
// register. Every point where the newest file is NOT a whole register is listed
// with the earlier file it must fall back to.
const NEWEST_REGISTER_AFTER: Record<number, number> = {
  27: 27, 28: 28, 29: 29, 30: 29, 31: 29, 32: 32, 33: 33, 34: 33, 35: 33, 36: 33,
  37: 37, 38: 38, 39: 39, 40: 40, 41: 41, 42: 42, 43: 43, 44: 44, 45: 45, 46: 45,
  47: 45, 48: 48, 49: 49, 50: 50, 51: 50, 52: 52, 53: 53, 54: 53, 55: 55, 56: 56,
  57: 57, 58: 57, 59: 57, 60: 57, 61: 61, 62: 62, 63: 62, 64: 64, 65: 65,
};

function realEraUpTo(lastIndex: number): ManifestDataset[] {
  return REAL_REGISTER_ERA
    .filter(([i]) => i <= lastIndex)
    .map(([i, vintage, kind, records, intendedComplete, omits]) => ({
      lane: 'foi', vintage, title: `publication ${i}`, classes: [kind], rows: records,
      intendedComplete, coverageNote: omits ? 'a verified observation says this file omits records' : '',
    }));
}

describe('home holdings — the newest register (whole files only)', { tags: ['unit'] }, () => {
  for (const [after, expected] of Object.entries(NEWEST_REGISTER_AFTER)) {
    const [, vintage, , records] = REAL_REGISTER_ERA.find(([i]) => i === expected) ?? [];
    it(`LatestRegister_RealArchiveTruncatedAfterPublication${after}_IsPublication${expected}`, () => {
      expect(homeHoldings(realEraUpTo(Number(after)), PREFIX_ROWS).latestRegister).toEqual({ vintage, records });
    });
  }

  it('LatestRegister_RealArchiveTruncatedAtEachPoint_RingsTheSameFileItCounts', () => {
    for (const after of [34, 36, 46, 51, 54, 58, 59, 60, 63, 65]) {
      const h = homeHoldings(realEraUpTo(after), PREFIX_ROWS);
      const ringed = h.publications.filter((p) => p.latest);
      expect(ringed, `after ${after}`).toHaveLength(1);
      expect(ringed[0].rows, `after ${after}`).toBe(h.latestRegister?.records);
    }
  });

  it('LatestRegister_RegisterGenuinelyShrinksByUnderAFifth_StillCountsAsTheNewestRegister', () => {
    // 2026-01-14's size drop (8.4%) was a real shrink plus a known omission; a
    // register that shrinks by less than a fifth is taken as whole.
    const datasets: ManifestDataset[] = [
      { lane: 'open-data', vintage: '2030-01-01', title: 'a', classes: ['register-snapshot'], rows: 160000 },
      { lane: 'open-data', vintage: '2030-06-01', title: 'b', classes: ['register-snapshot'], rows: 129000 },
    ];
    expect(homeHoldings(datasets, PREFIX_ROWS).latestRegister).toEqual({ vintage: '2030-06-01', records: 129000 });
  });

  it('LatestRegister_RegisterUnderFourFifthsOfThePreviousWholeOne_FallsBackToThatOne', () => {
    const datasets: ManifestDataset[] = [
      { lane: 'open-data', vintage: '2030-01-01', title: 'a', classes: ['register-snapshot'], rows: 160000 },
      { lane: 'open-data', vintage: '2030-06-01', title: 'b', classes: ['register-snapshot'], rows: 127999 },
    ];
    expect(homeHoldings(datasets, PREFIX_ROWS).latestRegister).toEqual({ vintage: '2030-01-01', records: 160000 });
  });
});

describe('home holdings — assembly', { tags: ['unit'] }, () => {
  it('HomeHoldings_RealSpan_DerivesCountAndEndpointsFromTheEnumeration', () => {
    const h = homeHoldings(DATASETS, PREFIX_ROWS);
    // The count is DERIVED — never a hand-authored figure.
    expect(h.count).toBe(4);
    expect(h.heldStartYear).toBe(2013);
    expect(h.latestYear).toBe(2026);
    // The "read as of" reading is the newest full-date vintage.
    expect(h.latestDateIso).toBe('2026-06-23');
  });

  it('HomeHoldings_HonestYearGap_LeavesTheEmptyYearUnfilled', () => {
    const h = homeHoldings(DATASETS, PREFIX_ROWS);
    const years = new Set(h.publications.map(p => p.vintage.slice(0, 4)));
    // 2018 has no publication in the fixture — the gap must survive, not be
    // interpolated or compressed away.
    expect(years.has('2018')).toBe(false);
    expect(years.has('2017')).toBe(true);
    expect(years.has('2019')).toBe(true);
  });

  it('HomeHoldings_EmptyArchive_ReportsZeroWithNullEndpointsRatherThanGuessing', () => {
    const h = homeHoldings([], PREFIX_ROWS);
    expect(h.count).toBe(0);
    expect(h.heldStartYear).toBeNull();
    expect(h.latestYear).toBeNull();
    expect(h.latestDateIso).toBeNull();
    expect(h.publications).toEqual([]);
  });

  it('HomeHoldings_SinglePublication_CollapsesTheSpanToOnePoint', () => {
    const h = homeHoldings([DATASETS[0]], PREFIX_ROWS);
    expect(h.count).toBe(1);
    expect(h.heldStartYear).toBe(2026);
    expect(h.latestYear).toBe(2026);
  });

  it('HomeHoldings_MonthOnlyNewestVintage_LeavesTheReadingUndatedRatherThanImplyingADay', () => {
    const monthly: ManifestDataset[] = [{ lane: 'foi', vintage: '2021-04', title: 'wdtk-month-only', classes: ['available-pool'], rows: 10 }];
    const h = homeHoldings(monthly, PREFIX_ROWS);
    expect(h.latestYear).toBe(2021);
    expect(h.latestDateIso).toBeNull();
  });

  // The home page states how many callsigns the newest register holds. The
  // figures below appear nowhere in the source, so a passing test cannot be
  // reading a hand-written constant.
  it('HomeHoldings_NewestRegisterSnapshot_ReportsItsVintageAndEveryRecordIncludingUnkeyableOnes', () => {
    const datasets: ManifestDataset[] = [
      ...DATASETS,
      { lane: 'open-data', vintage: '2027-03-05', title: 'Ofcom open data, 2027-03-05', classes: ['register-snapshot'], rows: 161321, unkeyable: 2 },
    ];

    // 161,321 rows the lookup can key plus 2 it cannot: the file holds 161,323.
    expect(homeHoldings(datasets, PREFIX_ROWS).latestRegister).toEqual({ vintage: '2027-03-05', records: 161323 });
  });

  // The home page showed 163,342 callsigns for the 2026-09-22 register and,
  // in the same panel, "163,341 rows" on that register's dial mark: the mark
  // counted only the rows the lookup could key. Every count of a publication's
  // rows elsewhere on the site (its dataset page, the statistics page, the
  // previous home page's holdings map) counts every row in the file.
  it('HoldingsPublications_APublicationWithUnkeyableRows_CountsEveryRowInTheFile', () => {
    const datasets: ManifestDataset[] = [
      { lane: 'foi', vintage: '2020-04-23', title: 'a disclosure with unkeyable rows', classes: ['available-pool'], rows: 2037, unkeyable: 12 },
      { lane: 'open-data', vintage: '2027-03-05', title: 'Ofcom open data, 2027-03-05', classes: ['register-snapshot'], rows: 161321, unkeyable: 2 },
      { lane: 'open-data', vintage: '2019-01-14', title: 'no unkeyable field', classes: ['register-snapshot'], rows: 130000 },
    ];

    const h = homeHoldings(datasets, PREFIX_ROWS);

    // 2,037 + 12 = 2,049; 161,321 + 2 = 161,323; an entry without the field keeps its rows.
    expect(h.publications.map(p => [p.vintage, p.rows])).toEqual([['2019-01-14', 130000], ['2020-04-23', 2049], ['2027-03-05', 161323]]);
    const newest = h.publications.find(p => p.latest);
    expect(newest?.rows, 'the ringed mark and the callsign total count the same file').toBe(h.latestRegister?.records);
  });

  it('HomeHoldings_NewestPublicationIsNotARegister_StillReportsTheNewestRegister', () => {
    const datasets: ManifestDataset[] = [
      ...DATASETS,
      { lane: 'foi', vintage: '2028-01-01', title: 'a later disclosure', classes: ['available-pool'], rows: 77 },
    ];

    const h = homeHoldings(datasets, PREFIX_ROWS);

    expect(h.latestDateIso).toBe('2028-01-01');
    expect(h.latestRegister).toEqual({ vintage: '2026-06-23', records: 158318 });
  });

  it('HomeHoldings_NoRegisterSnapshotHeld_ReportsNoLatestRegister', () => {
    const datasets: ManifestDataset[] = [{ lane: 'foi', vintage: '2021-04', title: 'wdtk-month-only', classes: ['available-pool'], rows: 10 }];

    expect(homeHoldings(datasets, PREFIX_ROWS).latestRegister).toBeNull();
  });

  // The builder and the page are written in different files, in different
  // languages' type systems. This passes the builder's actual output through
  // the page's own parser and model, so a field one side names differently
  // from the other fails here and not in a visitor's browser.
  it('HoldingsManifest_AsTheBuilderWritesIt_IsReadByThePageAndSetsItsCallsignTotal', () => {
    const datasets: ManifestDataset[] = [
      ...DATASETS,
      { lane: 'open-data', vintage: '2027-03-05', title: 'Ofcom open data, 2027-03-05', classes: ['register-snapshot'], rows: 161321, unkeyable: 2 },
    ];
    const asServed: unknown = JSON.parse(JSON.stringify(homeHoldings(datasets, PREFIX_ROWS)));

    const parsed = parseHoldings(asServed);
    if (parsed === null) throw new Error('the page rejected the manifest the builder wrote');
    const model = enhanceHomeModel(defaultHomeModel(), parsed);

    expect(model.glance.find(cell => cell.k === 'callsigns')?.v).toBe('161,323');
    expect(model.glance.find(cell => cell.k === 'latest snapshot')?.v).toBe('2027-03-05');
    expect(model.fromTheRecord[0].sentence).toContain('(2027-03-05) records 161,323 callsigns');
    expect(model.facts).toEqual({ date: '5 March 2027', count: 5 });
  });

  it('HomeHoldings_BuiltTwice_IsByteIdenticalForTheSameInputs', () => {
    // Deterministic output is what lets the deploy cache and the self-check hold.
    const a = JSON.stringify(homeHoldings(DATASETS, PREFIX_ROWS));
    const b = JSON.stringify(homeHoldings(DATASETS, PREFIX_ROWS));
    expect(a).toBe(b);
  });
});

describe('home holdings — milestones (the up-markers)', { tags: ['unit'] }, () => {
  it('SeriesMilestones_OnlyRowsWithAnIntroductionMonth_BecomeCitedMilestones', () => {
    const milestones = seriesMilestones(PREFIX_ROWS);
    // The row with no introduction month (M0) yields no milestone.
    expect(milestones.map(m => m.series)).toEqual(['M7', 'M8']);
    for (const m of milestones) {
      expect(m.range).toBe(false);
      expect(m.citation.trim().length, `milestone ${m.label} must be cited`).toBeGreaterThan(0);
    }
    expect(milestones[0].label).toBe('M7 series opened October 2018');
  });

  it('HomeMilestones_EveryEntry_CarriesANonEmptyCitation', () => {
    // The binding sourcing bar: a milestone can never ship uncited.
    for (const m of homeMilestones(PREFIX_ROWS)) {
      expect(m.citation.trim().length, `uncited milestone: ${m.label}`).toBeGreaterThan(0);
    }
  });

  it('HomeMilestones_AuthoredWording_PassesTheClaimsBar', () => {
    for (const m of homeMilestones(PREFIX_ROWS)) {
      const text = `${m.label} ${m.citation}`.toLowerCase();
      for (const banned of BANNED_PHRASES) {
        expect(text.includes(banned), `banned phrasing "${banned}" in milestone: ${m.label}`).toBe(false);
      }
    }
  });

  it('SystemMigrationMilestone_AnchoredToTheEvidencedChange_IsAPointBy2016AndFlagsInferredPlatform', () => {
    // The headline is anchored to the EVIDENCED change (by 2016), a POINT — not a
    // 2016–2017 range, which would read as a two-year migration the record does
    // not describe. The 2017 naming date stays in the citation fold; the pre-2016
    // Siebel platform is flagged inferred (claims bar), since the verbatim held
    // correspondence does not name it.
    expect(SYSTEM_MIGRATION_MILESTONE.range).toBe(false);
    expect(SYSTEM_MIGRATION_MILESTONE.start).toBe('2016');
    expect(SYSTEM_MIGRATION_MILESTONE.end).toBe('2016');
    expect(SYSTEM_MIGRATION_MILESTONE.label).toBe('Licensing system changed, by 2016');
    expect(SYSTEM_MIGRATION_MILESTONE.citation.toLowerCase()).toContain('inferred');
    expect(SYSTEM_MIGRATION_MILESTONE.citation).toContain('Siebel');
    // The observed anchor (Salesforce, 2017) and the cited docs stay in the fold.
    expect(SYSTEM_MIGRATION_MILESTONE.citation).toContain('Salesforce');
    expect(SYSTEM_MIGRATION_MILESTONE.citation).toContain('2017');
    expect(SYSTEM_MIGRATION_MILESTONE.citation).toContain('docs/narratives/ofcom-systems-and-publication-chronology.md');
  });

  it('LoadPrefixIntroRows_TheCommittedReferenceData_YieldsCitedSeriesIntroductions', () => {
    // Ties the milestone set to the REAL reference data: every series that
    // records an introduction month carries a non-empty note (its citation), so
    // the shipped milestone catalogue is sourced, not invented.
    const rows = loadPrefixIntroRows();
    const introduced = rows.filter(r => r.introduced.trim() !== '');
    expect(introduced.length).toBeGreaterThan(0);
    for (const r of introduced) {
      expect(r.notes.trim().length, `series ${r.prefix} records an introduction but no citing note`).toBeGreaterThan(0);
    }
    // M7's known introduction is present and cited.
    const m7 = rows.find(r => r.prefix === 'M7');
    expect(m7?.introduced).toBe('2018-10');
  });
});

describe('home holdings — helpers (pure)', { tags: ['unit'] }, () => {
  it('YearOf_IsoVintage_ReadsTheLeadingYearOrNull', () => {
    expect(yearOf('2016-09-20')).toBe(2016);
    expect(yearOf('2021-04')).toBe(2021);
    expect(yearOf(null)).toBeNull();
    expect(yearOf('undated')).toBeNull();
  });

  it('MonthLabel_IsoMonth_HumanisesToMonthAndYear', () => {
    expect(monthLabel('2018-10')).toBe('October 2018');
    expect(monthLabel('2025-10')).toBe('October 2025');
    // A bare year has no month to name — returned as-is rather than guessed.
    expect(monthLabel('2016')).toBe('2016');
  });
});
