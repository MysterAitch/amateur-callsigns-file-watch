#!/usr/bin/env node

/**
 * v1 shared-module deployment (issue #921). The v1 callsign page resolves in
 * the browser by dynamically importing a handful of pure data modules. Those
 * modules are shared with the legacy tree (they carry no absolute paths and
 * resolve everything against document.baseURI), but the v1 surface must be
 * SELF-CONTAINED — it references nothing outside the pages it serves. So the
 * modules, and their full transitive import closure, are ALSO deployed at the
 * site ROOT beside the v1 pages, byte-identical to the copies the legacy tree
 * ships. Hosting them twice during migration is a few tens of KB.
 *
 * The entry points are the modules site/v1/callsign-page.js imports at runtime;
 * the closure is computed from their relative imports, so a newly-added
 * dependency is deployed automatically — a module left behind would 404 the
 * callsign page. The deploy-coverage test pins the closure so the shipped set
 * cannot silently drift from what the page needs.
 *
 * Usage: node src/ci/build-v1-shared-modules.ts <siteSrcDir> <deployRootDir>
 *   siteSrcDir     the hand-authored site source (e.g. site)
 *   deployRootDir  the deploy root the modules are copied into (e.g. _site)
 */

import * as fs from 'fs';
import * as path from 'path';

// The modules site/v1/callsign-page.js dynamically imports at runtime. Their
// closure is everything the browser loads when it imports these.
export const V1_SHARED_ENTRYPOINTS: readonly string[] = [
  'callsign.js',
  'callsign-events.js',
  'browser-query.js',
  'ledger-query.js',
];

// The relative './x.js' modules a given site module statically imports.
function relativeImports(siteSrcDir: string, file: string): string[] {
  const src = fs.readFileSync(path.join(siteSrcDir, file), 'utf8');
  return [...src.matchAll(/from\s+['"]\.\/([a-z0-9-]+\.js)['"]/g)].map(m => m[1]);
}

// The full transitive import closure of the v1 shared entry points, sorted.
export function sharedModuleClosure(siteSrcDir: string): string[] {
  const seen = new Set<string>();
  const walk = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const target of relativeImports(siteSrcDir, file)) walk(target);
  };
  for (const entry of V1_SHARED_ENTRYPOINTS) walk(entry);
  return [...seen].sort();
}

// Copy every module in the closure from the site source into the deploy root.
// Returns the list copied (the closure), for the guarding test.
export function deployV1SharedModules(siteSrcDir: string, deployRootDir: string): string[] {
  const closure = sharedModuleClosure(siteSrcDir);
  fs.mkdirSync(deployRootDir, { recursive: true });
  for (const file of closure) {
    fs.copyFileSync(path.join(siteSrcDir, file), path.join(deployRootDir, file));
  }
  console.log(`v1 shared modules: copied ${closure.length} module(s) into ${deployRootDir}`);
  return closure;
}

if (import.meta.main) {
  const args = process.argv.slice(2).filter(a => a.trim().length > 0);
  const [siteSrcDir, deployRootDir] = args;
  if (siteSrcDir === undefined || deployRootDir === undefined) {
    console.error('usage: build-v1-shared-modules.ts <siteSrcDir> <deployRootDir>');
    process.exit(1);
  }
  deployV1SharedModules(siteSrcDir, deployRootDir);
}
