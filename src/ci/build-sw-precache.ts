#!/usr/bin/env node

/**
 * Deploy-time service-worker precache stamper (issue #614): enumerates the
 * static-shell assets shipped alongside the worker by the SAME inclusion rule
 * the deploy-coverage guard enforces, and stamps them into the worker's
 * SHELL_ASSETS array plus a content-hash cache version - so no lane ever
 * hand-edits sw.js to precache a newly-added site module.
 *
 * It mirrors build-nav.ts: a Node/TS step the Pages workflow runs against the
 * copied-in _site, replacing a marked region and failing loudly if the markers
 * drift. The committed sw.js keeps a valid list between the markers so it works
 * un-stamped for local viewing; this stamper is what guarantees the DEPLOYED
 * worker precaches exactly the shipped shell.
 *
 * Cache-versioning (ADR 0008): SHELL_VERSION is a hash over the NAME AND BYTES
 * of every precached asset, so the shell cache is busted precisely when the
 * precached set - or any precached file's content - changes, and reused when a
 * deploy leaves the shell untouched. This is the manifest-hash cache key issue
 * #614 asks for; it supersedes naming the shell cache by the raw commit SHA
 * (which re-downloaded the whole shell on every deploy, changed or not). The
 * separate DEPLOY_VERSION SHA stamp still changes the worker's bytes each
 * deploy (forcing the re-install that runs the activate/prune) and still keys
 * the offline-database ?v= match.
 *
 * Usage: node src/ci/build-sw-precache.ts <path-to-sw.js>
 *   The assets are enumerated from, and hashed within, the directory that
 *   contains <path-to-sw.js> (i.e. _site at deploy) - exactly what is shipped.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

// The comment markers bounding the generated region in sw.js. The stamper
// replaces everything between them and re-emits them, so a second run is a
// no-op (idempotent). Kept identical to the strings committed in sw.js - a
// drift here fails the build loudly rather than silently skipping the stamp.
export const PRECACHE_START = '// precache:start (SHELL_VERSION + SHELL_ASSETS stamped at deploy by src/ci/build-sw-precache.ts)';
export const PRECACHE_END = '// precache:end';

// The root navigation, precached under the scope directory itself. Always the
// first entry, mirroring the hand-authored list.
export const ROOT_SHELL_ASSET = './';

// The vendored sql.js-httpvfs assets, copied into _site/vendor/ from the npm
// package at deploy (they do not live in site/, and the library's sourcemap is
// deliberately NOT precached). Explicit rather than enumerated because they
// change only when the library is re-vendored - a deliberate act, not a
// per-lane one - and enumerating vendor/ would wrongly sweep in the sourcemap.
export const VENDOR_SHELL_ASSETS = ['vendor/index.js', 'vendor/sqlite.worker.js', 'vendor/sql-wasm.wasm'];

// The static-shell asset paths (relative to the site scope), in a deterministic
// order, enumerated from `dir` by the same rule the deploy copy and the
// coverage guard use: every top-level *.html, every *.js bar the worker itself,
// every *.css and every *.webmanifest - plus the root navigation and the
// vendored library. A newly-added site module is precached automatically; no
// module the pages ship can be silently omitted.
export function shellAssetNames(dir: string): string[] {
  const entries = fs.readdirSync(dir);
  // Plain code-unit sort, not localeCompare: deterministic and identical
  // across ICU versions, so the stamped order never drifts between runners.
  const byExt = (ext: string): string[] =>
    entries.filter(f => f.endsWith(ext) && f !== 'sw.js').sort();
  return [
    ROOT_SHELL_ASSET,
    ...byExt('.html'),
    ...byExt('.js'),
    ...byExt('.css'),
    ...byExt('.webmanifest'),
    ...VENDOR_SHELL_ASSETS,
  ];
}

// A cache-busting version derived from the precached set: the sorted asset
// paths, each folded together with the bytes of the file behind it (so a
// content edit to any precached asset changes the version too). The root
// navigation './' resolves to the same bytes as index.html, which is already
// hashed, so it contributes its path only. A listed asset absent from `dir`
// (e.g. vendor/ when hashing the un-built source tree) contributes its path
// only - the deploy hashes the real _site where every asset is present.
export function shellVersion(dir: string, assets: string[]): string {
  const hash = crypto.createHash('sha256');
  for (const asset of assets) {
    hash.update(asset);
    hash.update('\0');
    if (asset === ROOT_SHELL_ASSET) continue;
    const filePath = path.join(dir, asset);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      hash.update(fs.readFileSync(filePath));
    }
    hash.update('\0');
  }
  // 16 hex chars (64 bits) is ample to distinguish shell revisions in a cache
  // name; the full digest would only lengthen every cache key for no gain.
  return hash.digest('hex').slice(0, 16);
}

// The generated region's body: the SHELL_VERSION literal and the SHELL_ASSETS
// array, formatted to match the committed source so a stamp is a minimal,
// readable diff.
export function renderPrecacheBlock(version: string, assets: string[]): string {
  const lines = assets.map(a => `  '${a}',`).join('\n');
  return [
    `const SHELL_VERSION = '${version}';`,
    'const SHELL_ASSETS = [',
    lines,
    '];',
  ].join('\n');
}

// Replaces the marked region of the worker source with a freshly-generated
// SHELL_VERSION and SHELL_ASSETS. Fails loudly if the markers are absent or
// misordered.
export function stampPrecache(source: string, version: string, assets: string[]): string {
  const startAt = source.indexOf(PRECACHE_START);
  const endAt = source.indexOf(PRECACHE_END);
  if (startAt === -1 || endAt === -1 || endAt < startAt) {
    throw new Error(`precache markers not found (or misordered): ${PRECACHE_START} … ${PRECACHE_END}`);
  }
  const head = source.slice(0, startAt + PRECACHE_START.length);
  const tail = source.slice(endAt);
  return `${head}\n${renderPrecacheBlock(version, assets)}\n${tail}`;
}

// Stamps the enumerated shell into a worker file in place. Assets are
// enumerated from, and hashed within, the file's own directory - the shipped
// tree at deploy.
export function stampPrecacheIntoFile(swPath: string): { version: string; assets: string[] } {
  const dir = path.dirname(swPath);
  const assets = shellAssetNames(dir);
  const version = shellVersion(dir, assets);
  const source = fs.readFileSync(swPath, 'utf8');
  fs.writeFileSync(swPath, stampPrecache(source, version, assets));
  return { version, assets };
}

function main(): void {
  const swPath = process.argv[2];
  if (swPath === undefined || swPath.trim().length === 0) {
    console.error('usage: node src/ci/build-sw-precache.ts <path-to-sw.js>');
    process.exitCode = 1;
    return;
  }
  const { version, assets } = stampPrecacheIntoFile(swPath);
  console.log(`precache stamped into ${swPath}: ${assets.length} assets, version ${version}`);
}

if (import.meta.main) {
  main();
}
