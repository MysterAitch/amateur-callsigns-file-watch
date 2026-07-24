/**
 * Build-output safety scan (issue #969, defence-in-depth with the #966
 * output-encoding work). A fail-closed net over the ACTUAL published HTML.
 *
 * It decodes HTML character references in every attribute value it inspects (so
 * an entity-obfuscated payload such as `&#106;avascript:` or `java&#9;script:`
 * is resolved to the same string a browser would see before the scheme is read
 * - a plain substring grep would miss both), and refuses:
 *   - any inline event-handler attribute (on*),
 *   - any url-typed attribute (href/src/action/formaction/xlink:href/poster)
 *     whose value resolves to a scheme outside the allowlist (http/https/mailto/
 *     relative, plus image data URIs for favicons), and
 *   - any inline <script> outside an explicit per-page allowlist.
 *
 * It is a pure, allocation-light string scan (no DOM tree is built - scanning
 * the whole generated site page-by-page with a DOM parser exhausts memory), so
 * it runs over the entire built site as well as against the fixture self-tests.
 */

import { isSafeUrl } from './render/html.ts';

// URL-bearing attributes a browser will navigate to or fetch from.
const URL_ATTRIBUTES = new Set(['href', 'src', 'action', 'formaction', 'xlink:href', 'poster']);

export type UnsafeSinkKind = 'event-handler' | 'unsafe-url' | 'inline-script';

export interface UnsafeSink {
  kind: UnsafeSinkKind;
  detail: string;
}

export interface ScanOptions {
  // When false, an inline <script> (no src, non-empty body) is a violation.
  // The hand-authored static pages carry reviewed bootstrap scripts and pass
  // true; generated pages compose ingested data and must carry none, so they
  // pass false and the gate is fail-closed for them.
  allowInlineScripts: boolean;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  tab: '\t', newline: '\n', nbsp: ' ',
};

// Decode the HTML character references a browser would resolve inside an
// attribute value: numeric (decimal and hex) and the small set of named
// entities that matter for scheme obfuscation. Unknown named entities are left
// verbatim (a conservative, safe default).
function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = parseInt(body.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    if (body.startsWith('#')) {
      const code = parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named ?? whole;
  });
}

// The scan's URL allowlist is the shared isSafeUrl policy (https / mailto /
// relative) PLUS one narrow, documented carve-out: a `data:image/…` URI. The
// static pages carry inline SVG favicons as `data:image/svg+xml` link icons - a
// safe, non-scripting image data URI - so the gate permits image data URIs
// while still failing closed on the dangerous ones (`data:text/html`,
// `data:application/…`) and on javascript:/vbscript:/protocol-relative. Parsed,
// never substring-matched, so an obfuscated media type cannot slip through.
function isImageDataUri(value: string): boolean {
  let parsed: URL | null = null;
  try {
    parsed = new URL(value.trim());
  } catch {
    return false;
  }
  return parsed.protocol === 'data:' && parsed.pathname.toLowerCase().startsWith('image/');
}

function isAllowedUrlValue(value: string): boolean {
  return isSafeUrl(value) || isImageDataUri(value);
}

// A short, safe-to-log fingerprint of an attribute or script body.
function snippet(value: string): string {
  const oneLine = value.replace(/\s+/g, ' ').trim();
  return oneLine.length > 80 ? `${oneLine.slice(0, 80)}…` : oneLine;
}

// Matches one quoted attribute: name plus its single- or double-quoted value.
const ATTRIBUTE_RE = /([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
// Matches a <script …>…</script> block; the first group holds its attributes.
const SCRIPT_RE = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;

// Every unsafe sink in one HTML document.
export function findUnsafeSinks(html: string, options: ScanOptions): UnsafeSink[] {
  const sinks: UnsafeSink[] = [];

  for (const match of html.matchAll(ATTRIBUTE_RE)) {
    const name = match[1].toLowerCase();
    const rawValue = match[2] !== undefined ? match[2] : (match[3] ?? '');
    // Inline event handlers (onclick, onload, onerror, …) execute script.
    if (/^on[a-z]/.test(name)) {
      sinks.push({ kind: 'event-handler', detail: `${name}=…` });
      continue;
    }
    // url-typed attributes: the entity-decoded value must pass the allowlist.
    if (URL_ATTRIBUTES.has(name)) {
      const decoded = decodeEntities(rawValue);
      if (!isAllowedUrlValue(decoded)) {
        sinks.push({ kind: 'unsafe-url', detail: `${name}="${snippet(decoded)}"` });
      }
    }
  }

  if (!options.allowInlineScripts) {
    for (const match of html.matchAll(SCRIPT_RE)) {
      const attrs = match[1];
      const body = match[2] ?? '';
      if (!/\bsrc\s*=/i.test(attrs) && body.trim() !== '') {
        sinks.push({ kind: 'inline-script', detail: `inline <script>: ${snippet(body)}` });
      }
    }
  }

  return sinks;
}
