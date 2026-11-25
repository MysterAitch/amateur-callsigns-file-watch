// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { frontDoorReplacements, type HomeFigures } from './build-front-door.ts';
import type { Holding } from './build-publisher-pages.ts';

// A skip link whose target id does not exist moves nobody: keyboard and
// screen-reader users follow it and stay where they were. The home page's
// "Skip the holdings map" link pointed at an id nothing carried, and shipped
// that way because no check asked the page whether its own skip links land.
// Test names follow Subject_Scenario_Outcome per project convention.

const SKIP_LINK_SELECTOR = 'a.skip, a.hold-skip';

// The hrefs of every skip link on a page whose in-page target id is absent.
function brokenSkipTargets(html: string): string[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const broken: string[] = [];
  for (const link of doc.querySelectorAll(SKIP_LINK_SELECTOR)) {
    const href = link.getAttribute('href') ?? '';
    if (!href.startsWith('#') || href.length === 1) {
      broken.push(href);
      continue;
    }
    if (doc.getElementById(decodeURIComponent(href.slice(1))) === null) broken.push(href);
  }
  return broken;
}

describe('brokenSkipTargets (the checker itself, on constructed pages)', { tags: ['unit'] }, () => {
  it('BrokenSkipTargets_WhenEverySkipTargetExists_ReportsNothing', () => {
    const html = '<a class="skip" href="#main">Skip</a><a class="hold-skip" href="#after">Skip map</a>'
      + '<main id="main"><div><p id="after"></p></div></main>';
    expect(brokenSkipTargets(html)).toEqual([]);
  });

  it('BrokenSkipTargets_WhenOneTargetIsMissing_ReportsExactlyThatLink', () => {
    const html = '<a class="skip" href="#main">Skip</a><a class="hold-skip" href="#gone">Skip map</a><main id="main"></main>';
    expect(brokenSkipTargets(html)).toEqual(['#gone']);
  });

  it('BrokenSkipTargets_WhenSkipLinkHasNoFragmentOrAnEmptyOne_IsReportedAsBroken', () => {
    const html = '<a class="skip" href="#">Skip</a><a class="skip" href="other.html">Skip</a>';
    expect(brokenSkipTargets(html)).toEqual(['#', 'other.html']);
  });
});

describe('Skip links on the hand-authored pages', { tags: ['unit'] }, () => {
  // The hand-authored pages at the site root (the older /v0/ surface); the v1
  // tree is owned and checked elsewhere.
  const SITE = 'site';
  const pages = fs.readdirSync(SITE).filter(f => f.endsWith('.html'));

  it('SkipLinks_OnEveryHandAuthoredPage_LandOnAnElementThatExists', () => {
    expect(pages.length).toBeGreaterThan(5);
    for (const page of pages) {
      const html = fs.readFileSync(path.join(SITE, page), 'utf8');
      expect(brokenSkipTargets(html), page).toEqual([]);
    }
  });

  it('SkipLinks_OnTheHomePageAfterTheHoldingsMapIsInjected_LandOnAnElementThatExists', () => {
    // The holdings-map skip link only exists once the build injects the map into
    // the placeholder, so the page is assembled the way the build assembles it.
    const holdings: Holding[] = [{
      key: '2026-06-23', lane: 'open-data', title: 'Publication of 23 June 2026',
      authorId: 'ofcom', sourceKey: 'ofcom', witnessPublisherIds: [], witnessAgreementByPublisher: {}, unresolvedChannels: [],
      datasetClasses: ['register-snapshot'], vintage: '2026-06-23', recordCount: 1,
    }];
    const figures: HomeFigures = { callsigns: 1, datasets: 1, spanFrom: 2026, spanTo: 2026, latestKey: '2026-06-23', latestDate: '23 June 2026' };
    let html = fs.readFileSync(path.join(SITE, 'index.html'), 'utf8');
    for (const [placeholder, replacement] of frontDoorReplacements(holdings, figures)) {
      html = html.split(placeholder).join(replacement);
    }
    expect(html).toContain('class="hold-skip"');
    expect(brokenSkipTargets(html)).toEqual([]);
  });
});
