import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Deploy-integrity contract. A newly-added browser module that was imported by
// a page but never shipped 404s at load and takes down every page whose script
// transitively imports it (this is exactly how the live lookup broke: app.js
// imported prefix-country.js, and compare.js/entry-browser.js imported
// history-sync.js, but the deploy copied a hand-listed set that omitted both).
// Every ES module under site/ that the pages import must therefore be:
//   (a) a real file,
//   (b) copied to the deploy by the Pages workflow (via a glob, so a later
//       module cannot be forgotten), and
//   (c) precached by the service worker, so the offline shell is complete.

const SITE_DIR = 'site';
const PAGES_WORKFLOW = path.join('.github', 'workflows', 'pages.yml');

// Every browser module in site/. The service worker is deployed but never
// precaches itself, and *.test.ts are tooling, not shipped assets.
function browserModules(): string[] {
  return fs.readdirSync(SITE_DIR).filter(f => f.endsWith('.js') && f !== 'sw.js');
}

// The relative './x.js' modules a given site script statically imports.
function importTargets(file: string): string[] {
  const src = fs.readFileSync(path.join(SITE_DIR, file), 'utf8');
  return [...src.matchAll(/from\s+['"]\.\/([a-z0-9-]+\.js)['"]/g)].map(m => m[1]);
}

// The quoted entries of the service worker's SHELL_ASSETS precache array.
function shellAssets(): string[] {
  const src = fs.readFileSync(path.join(SITE_DIR, 'sw.js'), 'utf8');
  const block = src.match(/const SHELL_ASSETS = \[([\s\S]*?)\];/);
  if (block === null) throw new Error('SHELL_ASSETS array not found in sw.js');
  return [...block[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
}

describe('site deploy coverage', () => {
  it('SiteModuleImports_EveryTarget_ResolvesToAShippedFile', () => {
    const present = new Set(fs.readdirSync(SITE_DIR));
    for (const mod of [...browserModules(), 'sw.js']) {
      for (const target of importTargets(mod)) {
        expect(present.has(target), `${mod} imports ./${target}, which is not a file in site/`).toBe(true);
      }
    }
  });

  it('DeployCopyStep_ShipsEverySiteAsset_ViaGlob', () => {
    const wf = fs.readFileSync(PAGES_WORKFLOW, 'utf8');
    // Glob-based, so a new module cannot be forgotten. A regression to a
    // hand-listed set (the failure mode this whole file guards) fails here.
    expect(wf).toMatch(/cp\b[^\n]*site\/\*\.js\b/);
    expect(wf).toMatch(/cp\b[^\n]*site\/\*\.html\b/);
    expect(wf).toMatch(/cp\b[^\n]*site\/\*\.css\b/);
  });

  it('ServiceWorkerShellPrecache_ListsEveryBrowserModule', () => {
    const listed = new Set(shellAssets());
    const missing = browserModules().filter(m => !listed.has(m));
    expect(missing, `sw.js SHELL_ASSETS omits browser modules (offline shell incomplete): ${missing.join(', ')}`).toEqual([]);
  });

  it('ServiceWorkerShellPrecache_ListsNoModuleAbsentFromSite', () => {
    // The inverse: a precached local *.js that no longer exists would fail its
    // install fetch. Vendored assets live under vendor/ and are copied from the
    // package at deploy, so they are out of scope here.
    const present = new Set(fs.readdirSync(SITE_DIR));
    const stale = shellAssets().filter(a => a.endsWith('.js') && !a.includes('/') && !present.has(a));
    expect(stale, `sw.js SHELL_ASSETS lists modules absent from site/: ${stale.join(', ')}`).toEqual([]);
  });

  it('DebugConsole_IsWiredOnScriptedPagesOnly', () => {
    const loadsDebug = (page: string): boolean =>
      fs.readFileSync(path.join(SITE_DIR, page), 'utf8').includes('src="debug.js"');
    // Pages that already run a module carry the debug console — it can only help
    // where there is script to debug, and it is what surfaces a module that
    // fails to load.
    ['index.html', 'explore.html', 'compare.html'].forEach(function (page) {
      expect(loadsDebug(page), page + ' should load debug.js').toBe(true);
    });
    // The deliberately static pages stay script-free so their archived captures
    // stay complete and reproducible (see the no-scripts assertions in
    // build-home-aggregates and build-interdataset-stats).
    ['statistics.html', 'about.html', 'glossary.html'].forEach(function (page) {
      expect(loadsDebug(page), page + ' must stay script-free').toBe(false);
    });
  });
});
