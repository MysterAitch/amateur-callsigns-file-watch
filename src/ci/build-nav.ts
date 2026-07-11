#!/usr/bin/env node

/**
 * Deploy-time navigation injector: stamps the canonical site navigation - the
 * single source, navHtml in site-render.ts - into the hand-authored
 * site/*.html pages, so the nav strip lives in ONE place.
 *
 * The generated pages (dataset/series/reports/forbidden) already build their
 * nav from navHtml. The hand-authored pages carried their own hand-maintained
 * copy, which drifted whenever a nav entry was added (the Inter-dataset link,
 * the Forbidden-suffixes section). This injector removes that second copy: at
 * deploy it replaces each page's marked nav region with navHtml's output,
 * marking the correct item active per page.
 *
 * It mirrors build-home-aggregates.ts: a Node/TS step the Pages workflow runs
 * against the copied-in _site/*.html, replacing a marked region and failing
 * loudly if the markers drift. No build step for the site itself; the shared
 * nav data is imported, never duplicated (ADR 0002/0003).
 *
 * The committed pages keep a full nav between the markers so they stay valid
 * and complete for local/no-deploy viewing; the injector is what guarantees
 * every deployed page carries the identical canonical strip.
 *
 * Usage: node src/ci/build-nav.ts <path-to-page.html> [<more.html> ...]
 */

import * as fs from 'fs';
import * as path from 'path';
import { navHtml } from './site-render.ts';

// The comment markers bounding the nav region in each hand-authored page. The
// injector replaces everything between them and re-emits them, so a second run
// is a no-op (idempotent). Kept identical to the strings committed in the pages
// - a drift here fails the build loudly rather than silently skipping a page.
export const NAV_START = '<!-- nav:start (canonical strip stamped in at deploy by src/ci/build-nav.ts) -->';
export const NAV_END = '<!-- nav:end -->';

// Each hand-authored page sits at the site root (depth 0), mapped to the nav
// item it marks active. The generated pages own their own active item; the
// Inter-dataset page is generated, so it is absent here.
export const ACTIVE_NAV: Record<string, string> = {
  'index.html': 'Lookup',
  'statistics.html': 'Statistics',
  'explore.html': 'Explore',
  'compare.html': 'Compare',
  'ledger.html': 'Ledger',
  'playground.html': 'Playground',
  'glossary.html': 'Glossary',
  'about.html': 'About',
};

// The canonical nav element for a hand-authored (root-depth) page, wrapped
// exactly as htmlPage wraps it (<nav><p>…</p></nav>) so the strip reads the
// same as on the generated pages.
export function canonicalNav(currentNav: string): string {
  return `<nav><p>${navHtml(0, currentNav)}</p></nav>`;
}

// Replaces the marked nav region of a page's HTML with the canonical strip for
// the given active item. Fails loudly if the markers are absent or misordered.
export function injectNav(html: string, currentNav: string): string {
  const startAt = html.indexOf(NAV_START);
  const endAt = html.indexOf(NAV_END);
  if (startAt === -1 || endAt === -1 || endAt < startAt) {
    throw new Error(`nav markers not found (or misordered): ${NAV_START} … ${NAV_END}`);
  }
  const head = html.slice(0, startAt + NAV_START.length);
  const tail = html.slice(endAt);
  return `${head}\n  ${canonicalNav(currentNav)}\n  ${tail}`;
}

// Injects the canonical nav into a single hand-authored page file, choosing its
// active item from ACTIVE_NAV by basename. An unrecognised page name fails
// loudly rather than guessing an active item.
export function injectNavIntoFile(filePath: string): void {
  const name = path.basename(filePath);
  const currentNav = ACTIVE_NAV[name];
  if (currentNav === undefined) {
    throw new Error(`no active nav item mapped for ${name}; known pages: ${Object.keys(ACTIVE_NAV).join(', ')}`);
  }
  const html = fs.readFileSync(filePath, 'utf8');
  fs.writeFileSync(filePath, injectNav(html, currentNav));
}

function main(): void {
  const files = process.argv.slice(2).filter(a => a.trim().length > 0);
  if (files.length === 0) {
    console.error('usage: node src/ci/build-nav.ts <path-to-page.html> [<more.html> ...]');
    process.exitCode = 1;
    return;
  }
  for (const file of files) {
    injectNavIntoFile(file);
    console.log(`canonical nav injected into ${file}`);
  }
}

if (import.meta.main) {
  main();
}
