import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildRedirectStubs, V0_REFRESH_META_RE } from './build-v0-redirect-stubs.ts';
import {
  extractLinks,
  classifyLink,
  resolveInternalLink,
  resolveEmittedFile,
  listFilesRelative,
} from './internal-link-crawl.ts';

// The /v0/ re-root (issue #921) preserves the entire generated site under a
// `/v0/` prefix and leaves a thin redirect stub at every old root URL, so no
// deep link breaks while a new v1 launches at the root. These tests build a
// miniature v0 tree at assorted nesting depths and assert that every emitted
// page gains a stub whose refresh target resolves - through the same
// link-integrity crawler the real build is guarded by - to the actual v0 file,
// so a stub with a wrong relative depth can never ship silently. Test names
// follow Subject_Scenario_Outcome per project convention.

// The relative paths (POSIX, root-relative) of a representative v0 tree: the
// root shell, a one-level section index, and a deeply-nested dataset entry -
// the depth case the refresh target must reach correctly.
const V0_HTML = [
  'index.html',
  'callsign.html',
  'how-to-get-the-raw-data.html',
  'datasets/index.html',
  'datasets/open-data/2026-06-23/index.html',
  'datasets/foi/ofcom-2016-09-20--callsign-database--all-callsigns/index.html',
];
// A non-HTML asset the stub generator must ignore (only *.html gets a stub).
const V0_NON_HTML = ['data/version.txt', 'vendor/index.js'];

let root: string;
let v0Dir: string;

function writeV0Tree(): void {
  for (const rel of V0_HTML) {
    const abs = path.join(v0Dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, `<!DOCTYPE html><html lang="en-GB"><head><title>${rel}</title></head><body>${rel}</body></html>`);
  }
  for (const rel of V0_NON_HTML) {
    const abs = path.join(v0Dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, 'not html');
  }
}

// The root-relative paths of the stubs written outside the v0/ subtree - i.e.
// the mirrored root copies the generator produces.
function rootStubs(): string[] {
  return listFilesRelative(root).filter(rel => !rel.startsWith('v0/'));
}

// The single internal link every stub carries (both the meta-refresh target
// and the no-JavaScript fallback anchor point at the same place). Returns the
// raw href/refresh value so the caller can resolve it against the emitted set.
function stubRefreshTarget(stubRel: string): string {
  const html = fs.readFileSync(path.join(root, stubRel), 'utf8');
  const meta = html.match(V0_REFRESH_META_RE);
  if (meta === null) throw new Error(`stub ${stubRel} has no meta refresh`);
  return meta[1];
}

describe('v0 root redirect stubs (issue #921)', { tags: ['unit'] }, () => {
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'v0-stubs-'));
    v0Dir = path.join(root, 'v0');
    writeV0Tree();
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('RedirectStubs_EveryV0HtmlFile_GetsARootStubMirroringItsPath', () => {
    buildRedirectStubs(v0Dir, root, []);
    const stubs = new Set(rootStubs());
    for (const rel of V0_HTML) {
      expect(stubs.has(rel), `expected a root stub at ${rel}`).toBe(true);
    }
    // Exactly the HTML pages are mirrored - no more, no fewer.
    expect(stubs.size).toBe(V0_HTML.length);
  });

  it('RedirectStubs_NonHtmlV0Assets_AreNotMirrored', () => {
    buildRedirectStubs(v0Dir, root, []);
    const stubs = new Set(rootStubs());
    for (const rel of V0_NON_HTML) {
      expect(stubs.has(rel), `${rel} is not HTML and must not be mirrored`).toBe(false);
    }
  });

  it('RedirectStub_RefreshTarget_ResolvesToTheEmittedV0File', () => {
    buildRedirectStubs(v0Dir, root, []);
    // The full emitted set the crawler resolves against: every file under the
    // deploy root, v0 tree included (the stubs live here too now).
    const emitted = new Set(listFilesRelative(root));
    for (const stubRel of rootStubs()) {
      const target = stubRefreshTarget(stubRel);
      const resolved = resolveInternalLink(stubRel, target);
      const landed = resolveEmittedFile(resolved.path, emitted);
      expect(landed, `stub ${stubRel} refresh target ${target} does not resolve to an emitted v0 file`).not.toBeNull();
      // It must land inside the preserved v0 tree, not back on the stub itself.
      expect(landed?.startsWith('v0/'), `stub ${stubRel} must point into /v0/, got ${landed}`).toBe(true);
    }
  });

  it('RedirectStub_NoJavaScriptFallbackAnchor_ResolvesToTheSameV0File', () => {
    // The visible fallback <a> must work with JavaScript (and meta-refresh)
    // disabled, so it is crawled by the same link-integrity helpers.
    buildRedirectStubs(v0Dir, root, []);
    const emitted = new Set(listFilesRelative(root));
    for (const stubRel of rootStubs()) {
      const html = fs.readFileSync(path.join(root, stubRel), 'utf8');
      const internal = extractLinks(html)
        .filter(l => l.attr === 'href')
        .map(l => l.raw)
        .filter(raw => classifyLink(raw) === 'internal');
      expect(internal.length, `stub ${stubRel} has no internal fallback link`).toBeGreaterThan(0);
      for (const raw of internal) {
        const landed = resolveEmittedFile(resolveInternalLink(stubRel, raw).path, emitted);
        expect(landed, `stub ${stubRel} fallback link ${raw} does not resolve`).not.toBeNull();
      }
    }
  });

  it('RedirectStub_DeeplyNestedPage_ReachesV0AtTheCorrectDepth', () => {
    buildRedirectStubs(v0Dir, root, []);
    const deep = 'datasets/open-data/2026-06-23/index.html';
    const target = stubRefreshTarget(deep);
    // Three directory segments deep, so it climbs three levels then descends
    // through v0/ to the mirrored page.
    expect(target).toBe('../../../v0/datasets/open-data/2026-06-23/index.html');
    // And the climb genuinely lands on the real file on disk.
    const onDisk = path.resolve(path.dirname(path.join(root, deep)), target);
    expect(fs.existsSync(onDisk), `${onDisk} should exist`).toBe(true);
  });

  it('RedirectStub_RootIndex_TargetsV0IndexWithNoClimb', () => {
    buildRedirectStubs(v0Dir, root, []);
    expect(stubRefreshTarget('index.html')).toBe('v0/index.html');
  });

  it('RedirectStubs_ClaimedRootPath_IsLeftForTheRootOwnerNoStub', () => {
    // The v1 shell PR later claims index.html/callsign.html/how-to-get-the-raw-
    // data.html at the root; a claimed path must NOT receive a redirect stub.
    const claimed = ['index.html', 'callsign.html'];
    buildRedirectStubs(v0Dir, root, claimed);
    const stubs = new Set(rootStubs());
    for (const rel of claimed) {
      expect(stubs.has(rel), `${rel} is claimed and must not be stubbed`).toBe(false);
    }
    // Every other page is still stubbed.
    for (const rel of V0_HTML.filter(r => !claimed.includes(r))) {
      expect(stubs.has(rel), `${rel} is unclaimed and must be stubbed`).toBe(true);
    }
  });

  it('RedirectStub_Markup_DeclaresEnGbLangCanonicalAndInstantRefresh', () => {
    buildRedirectStubs(v0Dir, root, []);
    const html = fs.readFileSync(path.join(root, 'datasets/index.html'), 'utf8');
    expect(html).toMatch(/<html lang="en-GB">/);
    expect(html).toContain('<link rel="canonical" href="https://mysteraitch.github.io/amateur-callsigns-file-watch/v0/datasets/index.html">');
    // Instant client redirect for the JavaScript/HTML-enabled path.
    expect(html).toMatch(/<meta http-equiv="refresh" content="0;\s*url=\.\.\/v0\/datasets\/index\.html">/);
    // A visible, human-readable fallback paragraph for the no-JS path.
    expect(html).toMatch(/<p>[\s\S]*<a href="\.\.\/v0\/datasets\/index\.html">[\s\S]*<\/a>[\s\S]*<\/p>/);
  });

  it('RedirectStubs_CustomBaseUrl_UsesItForTheCanonicalLink', () => {
    buildRedirectStubs(v0Dir, root, [], 'https://example.test/mirror/v0');
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    expect(html).toContain('<link rel="canonical" href="https://example.test/mirror/v0/index.html">');
  });
});
