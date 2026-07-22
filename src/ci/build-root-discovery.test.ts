import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  buildRootDiscovery,
  rootDiscoveryUrls,
  renderRootSitemap,
  renderRobots,
} from './build-root-discovery.ts';

// Root discovery files for the v1 launch (issue #921): the slim root sitemap +
// robots.txt that advertise the three v1 pages now owning the deploy root,
// distinct from the preserved /v0/sitemap.xml. Test names follow
// Subject_Scenario_Outcome.

const BASE = 'https://example.test/mirror';

function build(): { dir: string; sitemap: string; robots: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'root-discovery-'));
  buildRootDiscovery(dir, BASE);
  return {
    dir,
    sitemap: fs.readFileSync(path.join(dir, 'sitemap.xml'), 'utf8'),
    robots: fs.readFileSync(path.join(dir, 'robots.txt'), 'utf8'),
  };
}

describe('root discovery files', { tags: ['unit'] }, () => {
  it('RootSitemap_ListsTheThreeV1Urls_AsAbsoluteLocations', () => {
    const urls = rootDiscoveryUrls(BASE);
    expect(urls).toEqual([
      'https://example.test/mirror/',
      'https://example.test/mirror/callsign.html',
      'https://example.test/mirror/how-to-get-the-raw-data.html',
    ]);
    const sitemap = renderRootSitemap(BASE);
    for (const url of urls) expect(sitemap).toContain(`<loc>${url}</loc>`);
  });

  it('RootSitemap_LeavesTheV0SitemapAlone_AdvertisingNoV0Urls', () => {
    // The v0 sitemap lives at /v0/sitemap.xml and is built elsewhere; the root
    // sitemap must advertise only the launched v1 front door, no /v0/ deep link.
    const sitemap = renderRootSitemap(BASE);
    expect(sitemap).not.toContain('/v0/');
  });

  it('Robots_PointsAtTheRootSitemap_AndAllowsCrawling', () => {
    const robots = renderRobots(BASE);
    expect(robots).toContain('Sitemap: https://example.test/mirror/sitemap.xml');
    expect(robots).toMatch(/User-agent: \*/);
    expect(robots).toMatch(/Allow: \//);
  });

  it('BuildRootDiscovery_WritesBothFiles_IntoTheDeployRoot', () => {
    const { dir, sitemap, robots } = build();
    expect(fs.existsSync(path.join(dir, 'sitemap.xml'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'robots.txt'))).toBe(true);
    expect(sitemap).toContain('<urlset');
    expect(robots).toContain('Sitemap:');
  });

  it('BuildRootDiscovery_BuiltTwiceOverTheSameBase_IsByteIdentical', () => {
    const a = build();
    const b = build();
    expect(fs.readFileSync(path.join(a.dir, 'sitemap.xml')).equals(fs.readFileSync(path.join(b.dir, 'sitemap.xml')))).toBe(true);
    expect(fs.readFileSync(path.join(a.dir, 'robots.txt')).equals(fs.readFileSync(path.join(b.dir, 'robots.txt')))).toBe(true);
  });
});
