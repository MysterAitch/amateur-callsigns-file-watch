import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Test names follow Subject_Scenario_Outcome per project convention.
//
// A narrative cites pages of this project's own site by absolute URL, because
// the page builder rewrites every relative link in a narrative to a
// repository blob link. The internal-link crawl treats an absolute URL as
// external and never resolves it, so nothing checked these.
//
// The site is deployed as two surfaces: the pages in site/v1/ at the root, and
// everything else (site/*.html and every generated tree) under /v0/. When the
// earlier surface moved under /v0/, sixty narrative links went on naming root
// paths that no longer answered as written. Forty returned 404 (dataset
// pages, the fidelity page, the forbidden-suffix pages, the ledger) and twenty
// landed on a root glossary that has none of the anchors they name. Measured
// against the live site on 2026-11-25.
//
// This pins the half that can be checked without building the site: a link
// outside /v0/ must name a page the root surface ships, and a fragment on it
// must be an id in that page's committed markup. It does not check that a
// /v0/ link resolves - most of those targets are generated at build time.

const SITE = 'https://mysteraitch.github.io/amateur-callsigns-file-watch/';
const NARRATIVES_DIR = path.join('docs', 'narratives');
const ROOT_SURFACE_DIR = path.join('site', 'v1');
const PREVIOUS_SURFACE_PREFIX = 'v0/';

interface SiteLink {
  where: string;
  target: string;
}

function siteLinksIn(markdown: string, file: string): SiteLink[] {
  const links: SiteLink[] = [];
  markdown.split(/\r?\n/).forEach((line, index) => {
    for (const match of line.matchAll(/https:\/\/mysteraitch\.github\.io\/amateur-callsigns-file-watch\/([^)\s"<>]*)/g)) {
      links.push({ where: `${file}:${index + 1}`, target: match[1] ?? '' });
    }
  });
  return links;
}

function narrativeSiteLinks(): SiteLink[] {
  return fs.readdirSync(NARRATIVES_DIR)
    .filter((name) => name.endsWith('.md'))
    .sort()
    .flatMap((name) => siteLinksIn(fs.readFileSync(path.join(NARRATIVES_DIR, name), 'utf8'), name));
}

function rootSurfacePages(): Map<string, string> {
  return new Map(fs.readdirSync(ROOT_SURFACE_DIR)
    .filter((name) => name.endsWith('.html'))
    .map((name) => [name, fs.readFileSync(path.join(ROOT_SURFACE_DIR, name), 'utf8')]));
}

// What is wrong with a link target (the part of the URL after the site base),
// or undefined when the rule has no complaint.
function rootSurfaceProblem(target: string, rootPages: Map<string, string>): string | undefined {
  if (target.startsWith(PREVIOUS_SURFACE_PREFIX)) return undefined;
  const [beforeFragment = '', fragment] = target.split('#');
  const page = beforeFragment.split('?')[0] || 'index.html';
  const markup = rootPages.get(page);
  if (markup === undefined) return `no page "${page}" on the root surface - is it under /${PREVIOUS_SURFACE_PREFIX}?`;
  if (fragment !== undefined && fragment !== '' && !markup.includes(`id="${fragment}"`)) {
    return `"${page}" on the root surface has no id "${fragment}"`;
  }
  return undefined;
}

describe('project-site links in the narratives', { tags: ['unit'] }, () => {
  it('NarrativeSiteLink_OutsideThePreviousSurface_NamesAPageAndAnchorTheRootSurfaceShips', () => {
    const rootPages = rootSurfacePages();
    const offenders = narrativeSiteLinks()
      .map((link) => ({ link, problem: rootSurfaceProblem(link.target, rootPages) }))
      .filter(({ problem }) => problem !== undefined)
      .map(({ link, problem }) => `${link.where}: ${SITE}${link.target} - ${problem}`);

    expect(offenders).toEqual([]);
  });

  it('NarrativesAndRootSurface_AreActuallyRead_SoAnEmptyScanCannotPass', () => {
    const links = narrativeSiteLinks();
    expect(links.length).toBeGreaterThan(50);
    expect(links.some((link) => link.target.startsWith(PREVIOUS_SURFACE_PREFIX))).toBe(true);
    expect(links.some((link) => !link.target.startsWith(PREVIOUS_SURFACE_PREFIX))).toBe(true);
    expect(rootSurfacePages().has('callsign.html')).toBe(true);
  });

  it('LinkScan_OverAConstructedNarrative_FindsEachSiteLinkWithItsLine', () => {
    const markdown = [
      `See the [ledger](${SITE}ledger.html?c=G6FMU) and`,
      'an [outside page](https://example.com/glossary.html).',
      `Then [one](${SITE}glossary.html#vintage), [two](${SITE}v0/fidelity.html#consistency).`,
    ].join('\n');

    expect(siteLinksIn(markdown, 'made-up.md')).toEqual([
      { where: 'made-up.md:1', target: 'ledger.html?c=G6FMU' },
      { where: 'made-up.md:3', target: 'glossary.html#vintage' },
      { where: 'made-up.md:3', target: 'v0/fidelity.html#consistency' },
    ]);
  });

  describe('the rule, over a made-up root surface', () => {
    const rootPages = new Map([
      ['callsign.html', '<main id="result"></main>'],
      ['glossary.html', '<h2 id="reading-the-record">Reading the record</h2>'],
      ['index.html', '<main id="top"></main>'],
    ]);

    it('RootLink_ToAPageOnlyThePreviousSurfaceHas_IsRejectedAndPointedAtV0', () => {
      expect(rootSurfaceProblem('ledger.html?c=G6FMU', rootPages)).toContain('no page "ledger.html"');
      expect(rootSurfaceProblem('datasets/foi/some-entry/index.html', rootPages)).toContain('/v0/');
    });

    it('RootLink_ToARootPageWithAnAnchorItLacks_IsRejected', () => {
      expect(rootSurfaceProblem('glossary.html#vintage', rootPages)).toBe('"glossary.html" on the root surface has no id "vintage"');
    });

    it('RootLink_ToARootPage_WithOrWithoutAQueryOrAPresentAnchor_IsAccepted', () => {
      expect(rootSurfaceProblem('callsign.html?c=G6FMU', rootPages)).toBeUndefined();
      expect(rootSurfaceProblem('glossary.html', rootPages)).toBeUndefined();
      expect(rootSurfaceProblem('glossary.html#reading-the-record', rootPages)).toBeUndefined();
      expect(rootSurfaceProblem('', rootPages)).toBeUndefined();
    });

    it('PreviousSurfaceLink_WhateverItNames_IsLeftToTheBuild', () => {
      expect(rootSurfaceProblem('v0/ledger.html?c=G6FMU', rootPages)).toBeUndefined();
      expect(rootSurfaceProblem('v0/no-such-page.html#nor-this', rootPages)).toBeUndefined();
    });
  });
});
