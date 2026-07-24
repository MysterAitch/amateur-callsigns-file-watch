/**
 * Build-output safety scan (issue #969, defence-in-depth with the #966
 * output-encoding work). A fail-closed net over the ACTUAL published HTML.
 *
 * The HTML is parsed with parse5 - the same HTML5-spec-compliant parser a
 * browser (and jsdom) uses - so every attribute value is decoded EXACTLY as a
 * browser would decode it before its scheme is read: numeric character
 * references with OR WITHOUT the trailing semicolon (`&#106avascript:` decodes
 * to `javascript:` in a browser), the legacy named references, whitespace and
 * control characters, and both quoted and unquoted attribute syntax. A
 * hand-rolled entity regex cannot match that faithfully (it misses the
 * semicolon-less form, among others), so the parser closes the obfuscation
 * class structurally rather than by chasing edge cases. parse5 is a dev/build
 * dependency (a test-oracle tool), never shipped to the browser.
 *
 * It refuses:
 *   - any inline event-handler attribute (on*),
 *   - any url-typed attribute (href/src/action/formaction/xlink:href/poster)
 *     whose value resolves to a scheme outside the allowlist (http/https/mailto/
 *     relative, plus image data URIs for favicons), and
 *   - any inline <script> outside an explicit per-page allowlist.
 *
 * Each page is parsed to a lightweight AST that is walked and then discarded, so
 * the whole built site is scanned one page at a time without the memory blow-up
 * of retaining a full DOM per page.
 */

import { parseFragment } from 'parse5';
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

// The scan's URL allowlist is the shared isSafeUrl policy (http/https/mailto/
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

// A parse5 default-tree-adapter node. Only the shape this scan reads is typed.
interface Parse5Node {
  tagName?: string;
  attrs?: { name: string; value: string }[];
  childNodes?: Parse5Node[];
  nodeName?: string;
  value?: string;
}

function inlineScriptBody(node: Parse5Node): string | null {
  const hasSrc = (node.attrs ?? []).some(a => a.name.toLowerCase() === 'src');
  if (hasSrc) return null;
  const text = (node.childNodes ?? [])
    .filter(child => child.nodeName === '#text')
    .map(child => child.value ?? '')
    .join('');
  return text.trim() === '' ? null : text;
}

// Every unsafe sink in one HTML document, walking the parsed tree.
export function findUnsafeSinks(html: string, options: ScanOptions): UnsafeSink[] {
  const sinks: UnsafeSink[] = [];
  const root = parseFragment(html) as unknown as Parse5Node;

  const visit = (node: Parse5Node): void => {
    if (node.tagName !== undefined) {
      for (const attr of node.attrs ?? []) {
        const name = attr.name.toLowerCase();
        // Inline event handlers (onclick, onload, onerror, …) execute script.
        if (/^on[a-z]/.test(name)) {
          sinks.push({ kind: 'event-handler', detail: `<${node.tagName} ${name}=…>` });
          continue;
        }
        // url-typed attributes: parse5 has already decoded the value exactly as
        // a browser would, so allowlisting the parsed scheme is browser-faithful.
        if (URL_ATTRIBUTES.has(name) && !isAllowedUrlValue(attr.value)) {
          sinks.push({ kind: 'unsafe-url', detail: `<${node.tagName} ${name}="${snippet(attr.value)}">` });
        }
      }
      if (!options.allowInlineScripts && node.tagName === 'script') {
        const body = inlineScriptBody(node);
        if (body !== null) {
          sinks.push({ kind: 'inline-script', detail: `inline <script>: ${snippet(body)}` });
        }
      }
    }
    for (const child of node.childNodes ?? []) visit(child);
  };

  visit(root);
  return sinks;
}
