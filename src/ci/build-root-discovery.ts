#!/usr/bin/env node

/**
 * Root discovery files for the v1 launch (issue #921): a slim sitemap.xml at
 * the deploy root listing the three v1 pages that now own the root, plus a
 * robots.txt that points crawlers at it.
 *
 * The preserved previous version keeps its own, fuller sitemap at
 * /v0/sitemap.xml (built by build-dataset-pages.ts and left untouched); this
 * root sitemap is deliberately just the three launched v1 URLs, so a crawler
 * that reads the root discovers the new front door rather than the redirect
 * stubs mirroring every old deep link.
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

// The three v1 pages that own the deploy root. The home page is listed as the
// directory root (a clean canonical URL), the other two by filename.
export const ROOT_DISCOVERY_PATHS = ['', 'callsign.html', 'how-to-get-the-raw-data.html'] as const;

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

export function renderRobots(baseUrl: string): string {
  const root = baseUrl.replace(/\/+$/, '');
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
