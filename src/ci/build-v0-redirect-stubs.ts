import * as fs from 'fs';
import * as path from 'path';
import { listFilesRelative } from './internal-link-crawl.ts';
import { escapeHtml } from './render/html.ts';

// The /v0/ re-root (issue #921). The whole generated site now serves under a
// `/v0/` prefix so a bare-bones v1 can launch at the root. To keep every old
// deep link alive, each page emitted under the v0 tree gets a thin redirect
// stub at the mirrored root URL: it canonicalises to the /v0/ page, redirects
// there instantly via <meta http-equiv="refresh">, and - crucially - carries a
// visible fallback anchor so it works with JavaScript (and meta-refresh)
// disabled. The stub's refresh/fallback target is a RELATIVE path computed for
// the stub's own nesting depth, so a page many directories deep still reaches
// its /v0/ mirror.
//
// Paths are kept POSIX/root-relative throughout (the same shape the internal-
// link crawler consumes) so the guarding test can resolve each stub's target
// against the emitted v0 tree with the shared link-integrity helpers - a stub
// with a wrong relative depth then fails a test rather than reaching production.

const DEFAULT_V0_BASE_URL = 'https://mysteraitch.github.io/amateur-callsigns-file-watch/v0';

// The meta-refresh line's target, captured so the guard can crawl it. Anchored
// to the exact markup renderStub emits.
export const V0_REFRESH_META_RE = /<meta http-equiv="refresh" content="0; url=([^"]*)">/;

// The relative link from a root stub at `rel` to its /v0/ mirror. A stub sits
// at the site root; its mirror sits under `v0/`. So it climbs out of its own
// directory (one `../` per directory segment) and descends through `v0/` to the
// same relative path. Root-level `index.html` (no directory) climbs nowhere and
// yields `v0/index.html`.
export function v0RelativeTarget(rel: string): string {
  const dirDepth = rel.split('/').length - 1;
  return `${'../'.repeat(dirDepth)}v0/${rel}`;
}

function renderStub(rel: string, baseUrl: string): string {
  const relTarget = v0RelativeTarget(rel);
  const canonical = `${baseUrl}/${rel}`;
  const hrefAttr = escapeHtml(relTarget);
  return [
    '<!DOCTYPE html>',
    '<html lang="en-GB">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>Moved to ${escapeHtml(rel)}</title>`,
    // A redirect stub is not itself canonical content and must not compete with
    // the /v0/ page in search results.
    '<meta name="robots" content="noindex">',
    `<link rel="canonical" href="${escapeHtml(canonical)}">`,
    `<meta http-equiv="refresh" content="0; url=${hrefAttr}">`,
    '</head>',
    '<body>',
    // The no-JavaScript, no-meta-refresh fallback: a plain anchor to the same
    // target, so the page is never a dead end however it is rendered.
    `<p>This page has moved to <a href="${hrefAttr}">${escapeHtml(canonical)}</a>. You should be redirected automatically.</p>`,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

// Write a root-level redirect stub for every HTML page emitted under the built
// v0 tree, excluding the paths claimed by the root owner (the v1 shell). The
// stub's relative target is verified on disk here so a wrong-depth stub fails
// loudly at build time, not only in the guarding test.
//
//   v0Dir            - the built v0 tree (e.g. _site/v0)
//   siteDir          - the deploy root the stubs are written into (e.g. _site)
//   claimedRootPaths - root-relative paths NOT to stub (the v1 shell owns them)
//   baseUrl          - absolute /v0/ base for the canonical link
export function buildRedirectStubs(
  v0Dir: string,
  siteDir: string,
  claimedRootPaths: readonly string[],
  baseUrl: string = DEFAULT_V0_BASE_URL,
): void {
  const claimed = new Set(claimedRootPaths);
  let written = 0;
  for (const rel of listFilesRelative(v0Dir)) {
    if (!rel.endsWith('.html')) continue;
    if (claimed.has(rel)) continue;

    const stubPath = path.join(siteDir, rel);
    fs.mkdirSync(path.dirname(stubPath), { recursive: true });
    fs.writeFileSync(stubPath, renderStub(rel, baseUrl));

    // Fail loudly if the computed relative target does not resolve, on disk,
    // back to the emitted v0 page this stub mirrors.
    const resolved = path.resolve(path.dirname(stubPath), v0RelativeTarget(rel));
    const expected = path.resolve(v0Dir, rel);
    if (resolved !== expected) {
      throw new Error(`redirect stub for ${rel} resolves to ${resolved}, expected ${expected}`);
    }
    written += 1;
  }
  console.log(`v0 redirect stubs: wrote ${written} stub(s) into ${siteDir} (claimed: ${claimed.size})`);
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const baseFlag = args.find(a => a.startsWith('--base-url='));
  const positional = args.filter(a => a.trim().length > 0 && !a.startsWith('--'));
  const [v0Dir, siteDir, ...claimed] = positional;
  if (v0Dir === undefined || siteDir === undefined) {
    console.error('usage: build-v0-redirect-stubs.ts <v0Dir> <siteDir> [--base-url=URL] [claimedRootPath ...]');
    process.exit(1);
  }
  const baseUrl = baseFlag === undefined ? DEFAULT_V0_BASE_URL : baseFlag.slice('--base-url='.length);
  buildRedirectStubs(v0Dir, siteDir, claimed, baseUrl);
}
