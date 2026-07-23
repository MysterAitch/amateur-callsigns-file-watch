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
