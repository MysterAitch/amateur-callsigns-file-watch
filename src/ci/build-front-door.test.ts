import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  homeFigures,
  renderHoldingsMap,
  frontDoorReplacements,
  injectFrontDoor,
  type HomeFigures,
} from './build-front-door.ts';
import { collectHoldings, type Holding } from './build-publisher-pages.ts';
import { readPublisherRegister } from '../shared/publishers.ts';

// Test names follow Subject_Scenario_Outcome per project convention.
//
// The home page's build-time surfaces (issue #712): the corpus-wide holdings
// map and the headline figures, injected into index.html at deploy. The map is
// the promise that matters — every cell must deep-link to a REAL dataset page —
// so the data-reading tests build the map from the actual archive and assert the
// destinations, while the pure render/inject tests use a small fixture.

// A minimal Holding for the render tests: only the fields the map reads are
// meaningful; the rest are filled with inert values so the fixture type-checks
// without pulling in the whole corpus.
function holding(over: Partial<Holding> & Pick<Holding, 'key' | 'lane' | 'title'>): Holding {
  return {
    authorId: 'ofcom',
    sourceKey: 'ofcom',
    witnessPublisherIds: [],
    witnessAgreementByPublisher: {},
    unresolvedChannels: [],
    ...over,
  };
}

const FIXTURE: Holding[] = [
  holding({
    key: '2026-06-23', lane: 'open-data', title: 'Publication of 23 June 2026',
    datasetClasses: ['register-snapshot'], vintage: '2026-06-23', recordCount: 158318,
    hasCoverageField: true, coverage: { complete: true },
  }),
  holding({
    key: '2025-01-14', lane: 'open-data', title: 'Publication of 14 January 2025',
    datasetClasses: ['register-snapshot'], vintage: '2025-01-14', recordCount: 150000,
    hasCoverageField: true, coverage: { complete: false }, qualityCount: 2, coverageAffecting: true,
  }),
  holding({ key: 'wdtk-1-forbidden', lane: 'foi', title: 'Forbidden suffixes disclosure', datasetClasses: ['forbidden-list'], vintage: '2019-05', recordCount: 1465 }),
  holding({ key: 'wdtk-2-notheld', lane: 'foi', title: 'A not-held response', datasetClasses: ['reference-context'] }),
];

describe('Home holdings map (issue #712)', { tags: ['unit'] }, () => {
  it('HoldingsMap_FixtureCorpus_RendersOneDeepLinkedCellPerDataset', () => {
    const html = renderHoldingsMap(FIXTURE);
    const hrefs = [...html.matchAll(/<a class="hold-cell[^"]*"[^>]*href="([^"]+)"/g)].map(m => m[1]);
    expect(hrefs).toHaveLength(FIXTURE.length);
    // Open-data cells resolve by publication date, FOI cells by request key —
    // the same destinations the dataset pages themselves are built at.
    expect(hrefs).toContain('datasets/open-data/2026-06-23/index.html');
    expect(hrefs).toContain('datasets/foi/wdtk-1-forbidden/index.html');
    // Every href is a site-root-relative dataset page (index.html sits at root).
    for (const href of hrefs) expect(href).toMatch(/^datasets\/(open-data|foi)\/[^"]+\/index\.html$/);
  });

  it('HoldingsMap_EachCell_CarriesKindTitleVintageAndRowCountForTheReadout', () => {
    const html = renderHoldingsMap(FIXTURE);
    // The 23 June cell carries the data-attributes home.js reads for its readout.
    const cell = /<a class="hold-cell[^"]*"[^>]*data-kind="register-snapshot"[^>]*href="datasets\/open-data\/2026-06-23[^>]*>/.exec(html);
    expect(cell).not.toBeNull();
    const tag = cell?.[0] ?? '';
    expect(tag).toContain('data-kind-label="Register snapshot"');
    expect(tag).toContain('data-title="Publication of 23 June 2026"');
    expect(tag).toContain('data-vintage="23 June 2026"');
    expect(tag).toContain('data-rows="158,318"');
    // A dataset with no tabular data reports an empty row count, never a
    // hollow "0 rows".
    const notHeld = /<a class="hold-cell[^"]*"[^>]*href="datasets\/foi\/wdtk-2-notheld[^>]*>/.exec(html)?.[0] ?? '';
    expect(notHeld).toContain('data-rows=""');
  });

  it('HoldingsMap_EachCell_CarriesDeclaredCoverageAndQualityFlagsForThePopover', () => {
    // The richer per-cell popover (#741) reads these straight off the cell —
    // no second data source, and no fetch.
    const html = renderHoldingsMap(FIXTURE);
    const complete = /<a class="hold-cell[^"]*"[^>]*href="datasets\/open-data\/2026-06-23[^>]*>/.exec(html)?.[0] ?? '';
    expect(complete).toContain('data-key="2026-06-23"');
    expect(complete).toContain('data-coverage="complete"');
    expect(complete).toContain('data-quality="0"');
    expect(complete).toContain('data-coverage-affecting="false"');

    const partial = /<a class="hold-cell[^"]*"[^>]*href="datasets\/open-data\/2025-01-14[^>]*>/.exec(html)?.[0] ?? '';
    expect(partial).toContain('data-coverage="partial"');
    expect(partial).toContain('data-quality="2"');
    expect(partial).toContain('data-coverage-affecting="true"');

    // The FOI lane declares no coverage field at all — "none", not "partial".
    const foi = /<a class="hold-cell[^"]*"[^>]*href="datasets\/foi\/wdtk-1-forbidden[^>]*>/.exec(html)?.[0] ?? '';
    expect(foi).toContain('data-coverage="none"');
    expect(foi).toContain('data-quality="0"');
  });

  it('HoldingsMap_LatestRegisterSnapshot_KeepsTheAccentRingSignal', () => {
    const html = renderHoldingsMap(FIXTURE);
    // Exactly the newest register snapshot wears the latest ring.
    const rings = [...html.matchAll(/hold-cell--latest[^>]*href="([^"]+)"/g)].map(m => m[1]);
    expect(rings).toEqual(['datasets/open-data/2026-06-23/index.html']);
  });

  it('HoldingsMap_KeyboardAffordances_CarrySkipLinkAndLiveReadout', () => {
    const html = renderHoldingsMap(FIXTURE, 'past-holdings');
    expect(html).toContain('class="hold-skip" href="#past-holdings"');
    expect(html).toContain(`Skip the holdings map (${FIXTURE.length} datasets)`);
    expect(html).toContain('id="hold-readout"');
    expect(html).toContain('role="status"');
  });

  it('HoldingsMap_Legend_NamesOnlyTheKindsActuallyPresent', () => {
    const html = renderHoldingsMap(FIXTURE);
    const legend = html.slice(html.indexOf('hold-legend'));
    // Labels come from the shared humaniseClassKey vocabulary, so the legend
    // reads the same words as the dataset-class pages.
    expect(legend).toContain('Register snapshot');
    expect(legend).toContain('Forbidden list');
    // No available-pool cell is present, so its legend entry must not appear.
    expect(legend).not.toContain('Available pool');
  });
});

// #812: a confirmed dormant defect. The home-page map's vintageYear used to
// compute Number(h.vintage.slice(0, 4)) unguarded - a holding with a defined
// but non-ISO vintage (e.g. "various") produced NaN, which PASSES a `!==
// undefined` filter, poisoning Math.min/Math.max over the WHOLE corpus so the
// year loop never iterated and the entire map rendered empty with no error.
// validate-foi.ts now rejects such a value at authoring time; this is the
// render-side defence-in-depth backstop.
describe('Home holdings map — a non-ISO vintage does not blank the whole map (#812)', { tags: ['unit'] }, () => {
  const MIXED: Holding[] = [
    ...FIXTURE,
    holding({ key: 'wdtk-3-various', lane: 'foi', title: 'A disclosure with an unparseable vintage', datasetClasses: ['reference-context'], vintage: 'various' }),
  ];
  const html = renderHoldingsMap(MIXED);

  it('MixedVintages_NonIsoHolding_JoinsTheUndatedRowInstead', () => {
    // The undated row is the last one rendered (after every year group), so
    // everything from its label onward is that one row's own cells.
    const undatedIdx = html.indexOf('>undated</span>');
    expect(undatedIdx).toBeGreaterThan(-1);
    expect(html.slice(undatedIdx)).toContain('datasets/foi/wdtk-3-various/index.html');
  });

  it('MixedVintages_IsoDatedHoldings_StillRenderUnderTheirYears', () => {
    // Before the fix this whole block was empty - every ISO-dated cell in
    // FIXTURE vanished along with the "various" one.
    const hrefs = [...html.matchAll(/<a class="hold-cell[^"]*"[^>]*href="([^"]+)"/g)].map(m => m[1]);
    expect(hrefs).toContain('datasets/open-data/2026-06-23/index.html');
    expect(hrefs).toContain('datasets/open-data/2025-01-14/index.html');
    expect(hrefs).toContain('datasets/foi/wdtk-1-forbidden/index.html');
    expect(hrefs).toHaveLength(MIXED.length);
    expect(html).toMatch(/<span class="hold-map-yrlab">2026<\/span>/);
  });
});

describe('Home figure injection (issue #712)', { tags: ['unit'] }, () => {
  const fig: HomeFigures = {
    callsigns: 158318, datasets: 62, spanFrom: 2013, spanTo: 2026,
    latestKey: '2026-06-23', latestDate: '23 June 2026',
  };

  it('FrontDoorReplacements_HeadlineFigures_AreHumanisedForEnGb', () => {
    const byToken = new Map(frontDoorReplacements(FIXTURE, fig));
    expect(byToken.get('<!--home:callsigns-->')).toBe('158,318');
    expect(byToken.get('<!--home:datasets-->')).toBe('62');
    expect(byToken.get('<!--home:span-->')).toBe('2013–2026');
    expect(byToken.get('<!--home:latest-->')).toBe('23 June 2026');
  });

  it('InjectFrontDoor_PlaceholderMissing_FailsLoudlyRatherThanShippingTheFallback', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'front-door-bad-'));
    const scratch = path.join(dir, 'index.html');
    fs.writeFileSync(scratch, '<html><body>no placeholders here</body></html>');
    expect(() => injectFrontDoor(scratch)).toThrow(/placeholder not found/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('InjectFrontDoor_RealIndex_ReplacesEveryPlaceholderWithDerivedContent', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'front-door-'));
    const scratch = path.join(dir, 'index.html');
    fs.copyFileSync(path.join('site', 'index.html'), scratch);
    injectFrontDoor(scratch);
    const html = fs.readFileSync(scratch, 'utf8');
    // No build-time placeholder survives — a drifted one would have thrown.
    expect(html).not.toContain('<!--home:');
    // The map and its cells are present, and the figures are populated numbers.
    expect(html).toContain('class="hold-map"');
    expect(html).toMatch(/data-figure="callsigns">[\d,]+</);
    expect(html).toMatch(/data-figure="datasets">\d+</);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('Home figures derive from the real corpus (issue #712)', { tags: ['data-validity'] }, () => {
  it('HomeFigures_RealArchive_DeriveCorpusWideShape', () => {
    const fig = homeFigures();
    expect(fig.datasets).toBeGreaterThanOrEqual(35);
    expect(fig.callsigns).toBeGreaterThan(100_000);
    expect(fig.spanFrom).toBeLessThan(fig.spanTo);
    expect(fig.spanFrom).toBeGreaterThanOrEqual(2013);
    expect(fig.latestKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Month precision (#551): this headline names one publication, not a
    // list, so no day is needed to disambiguate it from a sibling - the exact
    // date stays fully recoverable from latestKey itself.
    expect(fig.latestDate).toMatch(/^[A-Z][a-z]+ \d{4}$/);
  }, 120_000);

  it('HoldingsMap_RealCorpus_EveryCellDeepLinksToItsOwnDatasetPageKey', () => {
    const holdings = collectHoldings(readPublisherRegister());
    const html = renderHoldingsMap(holdings);
    const hrefs = [...html.matchAll(/<a class="hold-cell[^"]*"[^>]*href="([^"]+)"/g)].map(m => m[1]);
    // One cell per dataset, and each resolves to a real dataset-page key — the
    // exact key collectHoldings folded, which build-dataset-pages emits a page
    // for.
    expect(hrefs).toHaveLength(holdings.length);
    const keys = new Set(holdings.map(h => h.key));
    for (const href of hrefs) {
      const m = /^datasets\/(?:open-data|foi)\/(.+)\/index\.html$/.exec(href);
      expect(m, `unexpected cell href ${href}`).not.toBeNull();
      expect(keys.has(decodeURIComponent(m?.[1] ?? '')), `${href} names no held dataset`).toBe(true);
    }
  }, 120_000);
});
