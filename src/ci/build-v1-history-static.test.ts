import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { JSDOM } from 'jsdom';
import {
  buildV1HistoryStatic,
  stampRegion,
  assertComponentsRegistered,
  onThisDayHtml,
  timelineHtml,
  REGION_START,
  REGION_END,
} from './build-v1-history-static.ts';

// The static no-JS baseline for the v1 history journeys (issues #965, #966).
// The deploy stamps the calendar and the timeline into the SERVED HTML, so a
// crawler indexes them and a web archive preserves them — the archive's first
// capture of a URL is the one future readers surface, and it cannot be
// re-taken.
//
// The gate these tests hold is deliberately the reader's: parse the stamped
// page with no script whatsoever and require the substance to be there. Test
// names follow Subject_Scenario_Outcome, and the non-happy paths — a page with
// no markers, a missing page, a wrong-shaped manifest, an empty corpus — are
// covered alongside.

const ON_THIS_DAY = {
  schemaVersion: 1,
  generator: 'test',
  asAt: '2024-06-23',
  datasets: [{ key: 'ofcom-2024-06-23', vintage: '2024-06-23', title: 'Amateur register — 23 June 2024' }],
  caveats: [{ id: 'earliest-surviving', label: 'earliest surviving date', gloss: 'The earliest start surviving in the asserting vintage.' }],
  entries: [
    { monthDay: '10-18', year: '2018', day: '2018-10-18', series: 'M7', event: 'first-start', callsigns: ['M7ABC'], kindLabels: ['licence-version start'], datasetIdxs: [0], caveatIds: ['earliest-surviving'], seriesIntroduced: '2018-10', predatesSeriesIntroduction: false },
  ],
  count: 1,
  days: 1,
};

const TIMELINE = {
  schemaVersion: 1,
  generator: 'test',
  asAt: '2020-06-23',
  datasets: [{ key: 'ofcom-2020-06-23', vintage: '2020-06-23', title: 'Amateur register — 23 June 2020' }],
  kinds: [{ id: 'licence-issued', label: 'licence issued' }],
  caveats: [{ id: 'earliest-surviving', label: 'earliest surviving date', gloss: 'The earliest start surviving in the asserting vintage.' }],
  histograms: { 'licence-issued': [['2018', 2], ['2019', 0], ['2020', 5]] },
  totals: { 'licence-issued': 7 },
  buckets: [
    { year: '2018', perKind: { 'licence-issued': 2 }, startsToDate: 2, activeReservations: 0, topSeries: [['M7', 2]], datasetIdxs: [0], caveatIds: ['earliest-surviving'] },
    { year: '2019', perKind: {}, startsToDate: 2, activeReservations: 1, topSeries: [['M7', 2]], datasetIdxs: [], caveatIds: [] },
    { year: '2020', perKind: { 'licence-issued': 5 }, startsToDate: 7, activeReservations: 1, topSeries: [['M7', 7]], datasetIdxs: [0], caveatIds: ['earliest-surviving'] },
  ],
};

function page(name: string): string {
  return [
    '<!DOCTYPE html><html lang="en-GB"><body><main><div id="sections"><div id="history-host">',
    REGION_START(name),
    '<section class="surface"><p class="note">placeholder</p></section>',
    REGION_END,
    '</div><section class="surface"><p class="note">cross-link</p></section></div></main></body></html>',
  ].join('\n');
}

function scaffold(overrides: { onThisDay?: unknown; timeline?: unknown } = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v1-history-static-'));
  fs.writeFileSync(path.join(dir, 'on-this-day.json'), JSON.stringify(overrides.onThisDay ?? ON_THIS_DAY));
  fs.writeFileSync(path.join(dir, 'timeline.json'), JSON.stringify(overrides.timeline ?? TIMELINE));
  fs.writeFileSync(path.join(dir, 'on-this-day.html'), page('on-this-day'));
  fs.writeFileSync(path.join(dir, 'timeline.html'), page('timeline'));
  return dir;
}

/** The stamped page as a reader with no script receives it. */
function served(dir: string, file: string): Document {
  return new JSDOM(fs.readFileSync(path.join(dir, file), 'utf8')).window.document;
}

const norm = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();

describe('build-v1-history-static — the no-JS baseline gate', { tags: ['ui'] }, () => {
  it('OnThisDayPage_WhenServedWithNoScript_CarriesTheDatedEntriesThemselves', () => {
    const dir = scaffold();
    buildV1HistoryStatic(dir);
    const doc = served(dir, 'on-this-day.html');
    expect(doc.querySelectorAll('.evt')).toHaveLength(1);
    const text = norm(doc.body.textContent);
    expect(text).toContain('M7ABC');
    expect(text).toContain('18 October');
    expect(text).toContain('earliest held start evidence');
    // …and the entry's assertion-time provenance travels with it.
    expect(text).toContain('Amateur register — 23 June 2024');
  });

  it('TimelinePage_WhenServedWithNoScript_CarriesTheHistogramsAndPerYearFigures', () => {
    const dir = scaffold();
    buildV1HistoryStatic(dir);
    const doc = served(dir, 'timeline.html');
    expect(doc.querySelectorAll('.hx-chart')).toHaveLength(1);
    expect(doc.querySelectorAll('.hx-bar')).toHaveLength(3);
    // A row per year in the cumulative table, complete without interaction.
    expect(doc.querySelectorAll('details.hx-data tbody tr').length).toBeGreaterThanOrEqual(3);
    const text = norm(doc.body.textContent);
    expect(text).toContain('As at end of 2020');
    expect(text).toContain('surviving licence-start');
  });

  it('HistoryPages_WhenServedWithNoScript_OfferNoDeadControlAndNoPromiseOfLaterContent', () => {
    const dir = scaffold();
    buildV1HistoryStatic(dir);
    for (const file of ['on-this-day.html', 'timeline.html']) {
      const doc = served(dir, file);
      expect(doc.querySelector('#history-host input'), file).toBeNull();
      expect(norm(doc.body.textContent), file).toContain('in this page as served');
      expect(norm(doc.body.textContent), file).not.toContain('renders when the page’s script runs');
    }
  });

  it('HistoryPages_WhenStamped_KeepTheFramingAroundTheStampedRegion', () => {
    // The stamp owns its marked region and nothing else: the cross-links either
    // side of it survive.
    const dir = scaffold();
    buildV1HistoryStatic(dir);
    for (const file of ['on-this-day.html', 'timeline.html']) {
      expect(norm(served(dir, file).body.textContent), file).toContain('cross-link');
      expect(norm(served(dir, file).body.textContent), file).not.toContain('placeholder');
    }
  });

  it('CommittedHistoryPages_EachCarryExactlyOneStampRegion_SoTheDeployCannotSilentlySkipThem', () => {
    // The committed shells are the contract between the pages and this stamp. A
    // page that lost its markers would deploy as an empty shell and the build
    // would have nothing to fail on without this.
    for (const [file, name] of [['on-this-day.html', 'on-this-day'], ['timeline.html', 'timeline']] as const) {
      const html = fs.readFileSync(path.join('site', 'v1', file), 'utf8');
      expect(html.split(REGION_START(name)).length - 1, file).toBe(1);
      expect(html.split(REGION_END).length - 1, file).toBe(1);
      // …and the fallback render has a host of its own to write into.
      expect(html, file).toContain('id="history-host"');
    }
  });
});

describe('build-v1-history-static — stamping', { tags: ['unit'] }, () => {
  it('StampRegion_APageCarryingTheRegion_RewritesOnlyBetweenTheMarkers', () => {
    const { html, replaced } = stampRegion(page('timeline'), 'timeline', '<p>rendered</p>');
    expect(replaced).toBe(1);
    expect(html).toContain('<p>rendered</p>');
    expect(html).not.toContain('placeholder');
    expect(html).toContain('cross-link');
  });

  it('StampRegion_APageWhoseRegionNamesAnotherSurface_ReportsZeroSoTheCallerCanFailLoud', () => {
    // A mis-stamped page must be a loud mismatch, never a silent swap of one
    // surface's content into another's page.
    expect(stampRegion(page('timeline'), 'on-this-day', '<p>rendered</p>').replaced).toBe(0);
  });

  it('StampRegion_RunTwice_IsIdempotent', () => {
    const once = stampRegion(page('timeline'), 'timeline', '<p>rendered</p>').html;
    expect(stampRegion(once, 'timeline', '<p>rendered</p>').html).toBe(once);
  });

  it('AssertComponentsRegistered_MarkupNamingAnUnregisteredComponent_FailsLoud', () => {
    // A component root nobody registers an enhancer for would ship as static
    // content that silently never upgrades.
    expect(() => assertComponentsRegistered('<section data-component="ghost"></section>', 'a test fixture'))
      .toThrow(/no registered enhancer/);
    expect(assertComponentsRegistered('<section data-component="timeline"></section>', 'a test fixture'))
      .toEqual(['timeline']);
  });
});

describe('build-v1-history-static — determinism and failure modes', { tags: ['unit'] }, () => {
  it('BuildV1HistoryStatic_RunTwiceOverTheSameManifests_IsByteIdentical', () => {
    const dir = scaffold();
    buildV1HistoryStatic(dir);
    const first = ['on-this-day.html', 'timeline.html'].map(f => fs.readFileSync(path.join(dir, f)));
    buildV1HistoryStatic(dir);
    const second = ['on-this-day.html', 'timeline.html'].map(f => fs.readFileSync(path.join(dir, f)));
    expect(second[0]?.equals(first[0] ?? Buffer.alloc(0))).toBe(true);
    expect(second[1]?.equals(first[1] ?? Buffer.alloc(0))).toBe(true);
  });

  it('HistoryHtml_RenderedTwiceFromOneManifest_CarriesNoBuildClockOrEnvironmentValue', () => {
    const dir = scaffold();
    expect(onThisDayHtml(dir)).toBe(onThisDayHtml(dir));
    expect(timelineHtml(dir)).toBe(timelineHtml(dir));
    expect(onThisDayHtml(dir)).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:/); // no ISO timestamp
  });

  it('BuildV1HistoryStatic_WhenAPageLostItsMarkers_FailsLoudRatherThanShippingAShell', () => {
    const dir = scaffold();
    fs.writeFileSync(path.join(dir, 'timeline.html'), '<html><body><div id="sections"></div></body></html>');
    expect(() => buildV1HistoryStatic(dir)).toThrow(/expected exactly one "timeline" region/);
  });

  it('BuildV1HistoryStatic_WhenAPageIsNotDeployedYet_FailsLoud', () => {
    const dir = scaffold();
    fs.rmSync(path.join(dir, 'on-this-day.html'));
    expect(() => buildV1HistoryStatic(dir)).toThrow(/not found/);
  });

  it('BuildV1HistoryStatic_WhenAManifestIsTheWrongShape_RefusesToStampFromIt', () => {
    const dir = scaffold({ timeline: { schemaVersion: 1, buckets: 'nope' } });
    expect(() => buildV1HistoryStatic(dir)).toThrow(/not the shape the page renders/);
  });

  it('BuildV1HistoryStatic_WhenTheCorpusCarriesNothingToPlot_StampsAnHonestEmptyStateNotAShell', () => {
    // Unhappy path: an empty corpus must still produce a page that STATES the
    // absence, rather than one that looks like the render failed.
    const dir = scaffold({
      onThisDay: { ...ON_THIS_DAY, entries: [], caveats: [], count: 0, days: 0 },
      timeline: { ...TIMELINE, kinds: [], buckets: [], histograms: {}, totals: {}, caveats: [] },
    });
    buildV1HistoryStatic(dir);
    for (const file of ['on-this-day.html', 'timeline.html']) {
      expect(norm(served(dir, file).body.textContent), file).toContain('No entries');
    }
  });
});
