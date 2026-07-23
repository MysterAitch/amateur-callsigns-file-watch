#!/usr/bin/env node

/**
 * Root discovery files for the v1 launch (issue #921): a slim sitemap.xml at
 * the deploy root listing the v1 pages that now own the root (see
 * ROOT_DISCOVERY_PATHS below), plus a robots.txt that points crawlers at it.
 *
 * The preserved previous version keeps its own, fuller sitemap at
 * /v0/sitemap.xml (built by build-dataset-pages.ts and left untouched); this
 * root sitemap is deliberately just the v1 pages listed in
 * ROOT_DISCOVERY_PATHS, so a crawler that reads the root discovers the new
 * front door rather than the redirect stubs mirroring every old deep link.
 *
 * Pure and deterministic: the URL set is fixed and the output carries no build
 * clock, so two builds over the same base URL are byte-identical.
 *
 * Usage: node src/ci/build-root-discovery.ts <siteDir> [baseUrl]
 *   siteDir  the deploy root the files are written into (e.g. _site)
 *   baseUrl  the absolute site root (default the production Pages root)
 */

import * as fs from 'fs';
import * as path from 'path';

const DEFAULT_BASE_URL = 'https://mysteraitch.github.io/amateur-callsigns-file-watch';

// Whether the site may be indexed and crawled — the single source of truth.
// Pre-launch the mirror is deliberately withheld from crawlers EVERYWHERE (the
// legacy tree included), not just discouraged: robots.txt disallows all and the
// sitemap is written but never advertised, and the v1 pages carry a noindex
// meta. The first web-archive capture is a deliberate launch-milestone event
// (see the change-history / v1.0 milestone): flip this one constant to true at
// that point and the discovery files AND the pages' robots meta switch to their
// indexable state together. Keeping it a single flag is what stops the launch
// flip from half-applying — the guarding tests assert both states off it.
export const SITE_INDEXABLE = false;

// The v1 pages that own the deploy root. The home page is listed as the
// directory root (a clean canonical URL), the others by filename. A page joins
// this set when it enters the v1 navigation, so a nav-advertised page is always
// in the crawlable universe.
export const ROOT_DISCOVERY_PATHS = ['', 'callsign.html', 'how-to-get-the-raw-data.html', 'glossary.html', 'anatomy.html'] as const;

// The absolute URLs the root sitemap advertises, for a given site base.
export function rootDiscoveryUrls(baseUrl: string): string[] {
  const root = baseUrl.replace(/\/+$/, '');
  return ROOT_DISCOVERY_PATHS.map(rel => (rel === '' ? `${root}/` : `${root}/${rel}`));
}

export function renderRootSitemap(baseUrl: string): string {
  const urls = rootDiscoveryUrls(baseUrl)
    .map(loc => `  <url><loc>${loc}</loc></url>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

export function renderRobots(baseUrl: string, indexable: boolean = SITE_INDEXABLE): string {
  const root = baseUrl.replace(/\/+$/, '');
  if (!indexable) {
    // Pre-launch: withhold the whole site. sitemap.xml is still written (below),
    // but deliberately not advertised here until the flag flips.
    return 'User-agent: *\nDisallow: /\n';
  }
  return `User-agent: *\nAllow: /\nSitemap: ${root}/sitemap.xml\n`;
}

export function buildRootDiscovery(siteDir: string, baseUrl: string = DEFAULT_BASE_URL): void {
  fs.mkdirSync(siteDir, { recursive: true });
  fs.writeFileSync(path.join(siteDir, 'sitemap.xml'), renderRootSitemap(baseUrl));
  fs.writeFileSync(path.join(siteDir, 'robots.txt'), renderRobots(baseUrl));
  console.log(`root discovery: wrote sitemap.xml (${ROOT_DISCOVERY_PATHS.length} URLs) and robots.txt into ${siteDir}`);
}

if (import.meta.main) {
  const args = process.argv.slice(2).filter(a => a.trim().length > 0);
  const [siteDir, baseUrl] = args;
  if (siteDir === undefined) {
    console.error('usage: build-root-discovery.ts <siteDir> [baseUrl]');
    process.exit(1);
  }
  buildRootDiscovery(siteDir, baseUrl ?? DEFAULT_BASE_URL);
}
