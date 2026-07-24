import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { shellAssetNames } from './build-sw-precache.ts';

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
//
// (c) is no longer a hand-maintained list: build-sw-precache.ts enumerates the
// precache set by a fixed rule and stamps it into sw.js at deploy (issue #614).
// So the guard checks the GENERATOR'S RULE covers every shipped module, rather
// than that a person kept a list current - same protection, no coordination
// point on sw.js.

const SITE_DIR = 'site';
const SITE_V1_DIR = path.join('site', 'v1');
const PAGES_WORKFLOW = path.join('.github', 'workflows', 'cicd.yaml');

// The v1 shell's deployable assets - the pages, modules and stylesheets copied
// flat to the deploy root (issue #921). *.test.ts are tooling, not shipped.
const V1_DEPLOYABLE_EXT = ['.html', '.js', '.css'];
function v1DeployableFiles(): string[] {
  return fs.readdirSync(SITE_V1_DIR).filter(f => V1_DEPLOYABLE_EXT.includes(path.extname(f)) && !f.endsWith('.test.ts'));
}

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

// The precache set the generator's rule yields for the site source tree - the
// exact list the deploy stamper injects into sw.js.
function generatedShellAssets(): string[] {
  return shellAssetNames(SITE_DIR);
}

// The committed fallback list the un-stamped worker precaches for local viewing
// (the quoted entries of sw.js's SHELL_ASSETS array). The deploy re-derives it,
// so it may lag the rule; it must never carry a STALE local module, though.
function committedShellAssets(): string[] {
  const src = fs.readFileSync(path.join(SITE_DIR, 'sw.js'), 'utf8');
  const block = src.match(/const SHELL_ASSETS = \[([\s\S]*?)\];/);
  if (block === null) throw new Error('SHELL_ASSETS array not found in sw.js');
  return [...block[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
}

describe('site deploy coverage', { tags: ['unit'] }, () => {
  it('SiteModuleImports_EveryTarget_ResolvesToAShippedFile', () => {
    const present = new Set(fs.readdirSync(SITE_DIR));
    for (const mod of [...browserModules(), 'sw.js']) {
      for (const target of importTargets(mod)) {
        expect(present.has(target), `${mod} imports ./${target}, which is not a file in site/`).toBe(true);
      }
    }
  });

  it('DeployCopyStep_ShipsEverySiteAsset_ViaGlobIntoTheV0Reroot', () => {
    const wf = fs.readFileSync(PAGES_WORKFLOW, 'utf8').replace(/\r\n/g, '\n');
    // Glob-based, so a new module cannot be forgotten. A regression to a
    // hand-listed set (the failure mode this whole file guards) fails here.
    // The one glob copy line must also land under the /v0/ re-root (issue
    // #921), not the bare deploy root - a stray copy at the root would collide
    // with the redirect stubs that now own those paths.
    const globLine = wf.split('\n').find(l => /\bcp\b[^\n]*site\/\*\.html\b/.test(l));
    expect(globLine, 'the site-asset glob copy step is missing').toBeDefined();
    expect(globLine ?? '').toMatch(/site\/\*\.js\b/);
    expect(globLine ?? '').toMatch(/site\/\*\.css\b/);
    expect(globLine ?? '').toMatch(/site\/\*\.webmanifest\b/);
    expect(globLine ?? '', 'the site-asset glob copy must target _site/v0/').toMatch(/\s_site\/v0\/\s*$/);
  });

  it('DeployV1CopyStep_ShipsEveryV1Asset_ViaGlobIntoTheDeployRoot', () => {
    // Issue #921: the v1 shell copies flat into the deploy ROOT (not /v0/), so
    // the v1 pages own the root. The copy is glob-based by extension, so a
    // new v1 module cannot be forgotten - but a v1 asset with an extension
    // OUTSIDE the globbed set would be silently dropped, so this guard fails
    // loudly if one ever appears (forcing the glob to be widened alongside it).
    const wf = fs.readFileSync(PAGES_WORKFLOW, 'utf8').replace(/\r\n/g, '\n');
    const globLine = wf.split('\n').find(l => /\bcp\b[^\n]*site\/v1\/\*\.html\b/.test(l));
    expect(globLine, 'the v1-shell copy step is missing').toBeDefined();
    expect(globLine ?? '').toMatch(/site\/v1\/\*\.js\b/);
    expect(globLine ?? '').toMatch(/site\/v1\/\*\.css\b/);
    // It must land at the bare deploy root, not the /v0/ re-root.
    expect(globLine ?? '', 'the v1 shell must copy into the bare _site/ root').toMatch(/\s_site\/\s*$/);
    // Every deployable v1 file's extension must be covered by the glob set.
    const globbed = new Set([...(globLine ?? '').matchAll(/site\/v1\/\*(\.[a-z]+)\b/g)].map(m => m[1]));
    const uncovered = v1DeployableFiles().filter(f => !globbed.has(path.extname(f)));
    expect(uncovered, `v1 deployable files with no matching copy glob: ${uncovered.join(', ')}`).toEqual([]);
  });

  it('V1SiteModuleImports_EveryTarget_ResolvesToAShippedV1File', () => {
    // The v1 modules import each other by './name.js'; every such target must be
    // a real file in site/v1 (the flat copy ships them all together).
    const present = new Set(fs.readdirSync(SITE_V1_DIR));
    for (const mod of v1DeployableFiles().filter(f => f.endsWith('.js'))) {
      const src = fs.readFileSync(path.join(SITE_V1_DIR, mod), 'utf8');
      for (const m of src.matchAll(/from\s+['"]\.\/([a-z0-9-]+\.js)['"]/g)) {
        expect(present.has(m[1]), `${mod} imports ./${m[1]}, which is not a file in site/v1/`).toBe(true);
      }
    }
  });

  it('DeployStep_StampsThePrecacheManifest_IntoTheWorker', () => {
    const wf = fs.readFileSync(PAGES_WORKFLOW, 'utf8');
    // Generation must be wired into the deploy, or the live worker keeps the
    // committed fallback and a newly-added module is never precached. A drop of
    // this step (the failure mode of the whole rule-based approach) fails here.
    expect(wf).toMatch(/node\s+src\/ci\/build-sw-precache\.ts\b[^\n]*sw\.js/);
  });

  it('ServiceWorkerPrecacheRule_CoversEveryBrowserModule', () => {
    // The generator's inclusion rule must precache every browser module the
    // pages ship. If the rule were ever narrowed (e.g. a prefix excluded) so a
    // real module fell outside it, the offline shell would be incomplete - and
    // this fails loudly, exactly as the old hand-list guard did for an omission.
    const covered = new Set(generatedShellAssets());
    const missing = browserModules().filter(m => !covered.has(m));
    expect(missing, `precache rule omits browser modules (offline shell incomplete): ${missing.join(', ')}`).toEqual([]);
  });

  it('ServiceWorkerPrecacheRule_ListsNoLocalModuleAbsentFromSite', () => {
    // The inverse: a precached local *.js that no longer exists would fail its
    // install fetch. The rule enumerates site/ so this holds by construction;
    // the guard pins it against a future rule that hard-codes a name. Vendored
    // assets live under vendor/ and are copied from the package at deploy, so
    // they are out of scope here.
    const present = new Set(fs.readdirSync(SITE_DIR));
    const stale = generatedShellAssets().filter(a => a.endsWith('.js') && !a.includes('/') && !present.has(a));
    expect(stale, `precache rule lists modules absent from site/: ${stale.join(', ')}`).toEqual([]);
  });

  it('CommittedFallbackList_CarriesNoStaleLocalModule_ForLocalViewing', () => {
    // The committed SHELL_ASSETS is the un-stamped worker's fallback (local
    // `serve:site`). It may LAG the rule (the deploy re-derives it), but a stale
    // entry - a local *.js no longer in site/ - would 404 its install fetch, so
    // it must not carry one. Completeness is the deploy stamper's job, not this.
    const present = new Set(fs.readdirSync(SITE_DIR));
    const stale = committedShellAssets().filter(a => a.endsWith('.js') && !a.includes('/') && !present.has(a));
    expect(stale, `sw.js committed SHELL_ASSETS lists modules absent from site/: ${stale.join(', ')}`).toEqual([]);
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
