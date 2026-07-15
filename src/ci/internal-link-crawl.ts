import * as fs from 'fs';
import * as path from 'path';

// Internal-link integrity primitives (issue #561). The generated pages are
// densely cross-linked (reports → per-suffix / per-dataset / per-class pages,
// breadcrumbs, series nav, glossary cues). A renamed page, a dropped generator
// output, or a hand-authored typo can ship a dead crosslink silently, degrading
// the very cross-linking the site is built around. These helpers parse a built
// HTML tree and resolve every internal href/src to an emitted file, so a break
// fails a test rather than reaching production.
//
// The functions here are deliberately pure and filesystem-light so the crawler
// logic can be unit-tested on a fixture, separate from the heavy real-site build
// that exercises it end to end.

export interface HtmlLink {
  attr: 'href' | 'src';
  raw: string;
}

// Every href/src attribute value in a blob of HTML, single- or double-quoted.
// The value is returned verbatim (HTML entities such as &amp; intact); callers
// that need the path split it off before decoding.
export function extractLinks(html: string): HtmlLink[] {
  const links: HtmlLink[] = [];
  for (const m of html.matchAll(/\b(href|src)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    const attr = m[1] as 'href' | 'src';
    const raw = m[2] !== undefined ? m[2] : (m[3] ?? '');
    links.push({ attr, raw });
  }
  return links;
}

// 'external' links leave the site (an absolute scheme or a protocol-relative
// host); 'dynamic' links are non-navigational affordances the crawl cannot and
// should not resolve to a file (the empty string, the bare '#' facet trigger,
// and mailto:/tel:/javascript:/data: schemes); 'internal' links are relative
// paths and same-page fragments that MUST resolve to an emitted target.
export type LinkKind = 'external' | 'dynamic' | 'internal';

export function classifyLink(raw: string): LinkKind {
  const value = raw.trim();
  if (value === '' || value === '#') return 'dynamic';
  // Absolute scheme (http:, https:, mailto:, tel:, javascript:, data:, …) or a
  // protocol-relative //host. Everything with a scheme is off-crawl: an http(s)
  // target is external (and out of scope), the rest are non-navigational.
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('//')) {
    return /^https?:/i.test(value) || value.startsWith('//') ? 'external' : 'dynamic';
  }
  return 'internal';
}

export interface ResolvedTarget {
  // The target file path, POSIX-style and relative to the site root, with the
  // query string and fragment stripped. Empty when the link is a same-page
  // fragment (the path is then the source page itself, filled in by the caller).
  path: string;
  fragment: string | null;
}

// Resolve an internal link against the site-root-relative path of the page it
// appears on. The query string (?…) and fragment (#…) are separated; the path
// is normalised (../ and ./ collapsed) so it can be looked up in the emitted set.
export function resolveInternalLink(fromRel: string, raw: string): ResolvedTarget {
  const hashIndex = raw.indexOf('#');
  const fragment = hashIndex >= 0 ? raw.slice(hashIndex + 1) : null;
  const beforeHash = hashIndex >= 0 ? raw.slice(0, hashIndex) : raw;
  const queryIndex = beforeHash.indexOf('?');
  const pathPart = queryIndex >= 0 ? beforeHash.slice(0, queryIndex) : beforeHash;

  const fromPosix = fromRel.split(path.sep).join('/');
  if (pathPart === '') {
    // A same-page fragment (#anchor) targets the page it sits on.
    return { path: fromPosix, fragment };
  }
  const dir = fromPosix.includes('/') ? fromPosix.slice(0, fromPosix.lastIndexOf('/')) : '';
  const resolved = path.posix.normalize(dir === '' ? pathPart : `${dir}/${pathPart}`);
  return { path: resolved, fragment };
}

// Decode a resolved path for matching against on-disk names, tolerating a
// malformed escape by falling back to the raw path (suffix directories are
// plain A–Z, so the two coincide; this only guards exotic encodings).
export function decodePathForLookup(p: string): string {
  try {
    return decodeURIComponent(p);
  } catch {
    return p;
  }
}

// Resolve a site-root-relative target against the set of emitted paths, honouring
// the static-host convention that a directory link (a trailing slash, or a bare
// directory name) serves that directory's index.html. Returns the emitted path
// the link lands on, or null when nothing was emitted for it. The decoded form
// is tried too, so a percent-encoded path segment matches its on-disk name.
export function resolveEmittedFile(target: string, emitted: ReadonlySet<string>): string | null {
  for (const candidate of new Set([target, decodePathForLookup(target)])) {
    if (emitted.has(candidate)) return candidate;
    const dir = candidate.endsWith('/') ? candidate.slice(0, -1) : candidate;
    const indexed = dir === '' ? 'index.html' : `${dir}/index.html`;
    if (emitted.has(indexed)) return indexed;
  }
  return null;
}

// Every id/name anchor a page defines — the set a #fragment must land in.
export function anchorIds(html: string): Set<string> {
  const ids = new Set<string>();
  for (const m of html.matchAll(/\b(?:id|name)="([^"]+)"/g)) ids.add(m[1]);
  return ids;
}

// Every file under a directory tree, as POSIX paths relative to that root.
export function listFilesRelative(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) walk(abs, rel);
      else out.push(rel);
    }
  };
  walk(root, '');
  return out;
}
