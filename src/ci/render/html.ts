/**
 * The lowest-level shared HTML helpers every other render module builds on:
 * the repository URL, HTML escaping, and the leave-the-site external-link
 * affordance. Kept dependency-free so any sibling render module can import
 * these without a cycle.
 *
 * No behaviour of its own - these are the same helpers the dataset-pages build
 * has always emitted, so the generated HTML is byte-for-byte unchanged.
 */

export const REPO_URL = 'https://github.com/MysterAitch/amateur-callsigns-file-watch';

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // The apostrophe is escaped too (issue #966): an attribute the escaper's
    // contract assumes is double-quoted stays safe even if a caller ever emits
    // a single-quoted one, closing the one HTML metacharacter the set omitted.
    .replace(/'/g, '&#x27;');
}

// ---- URL scheme allowlist (issue #969) ----
// URL-typed, witness- and meta-derived values are UNTRUSTED and reach href/src
// sinks. They are validated by PARSING (the WHATWG URL parser, the same
// normalisation a browser applies - it strips tabs, newlines and leading
// control characters and lower-cases the scheme) and then ALLOWLISTING the
// scheme. Allowlisting, not denylisting, is what makes this obfuscation-proof:
// a mangled `java\tscript:` either parses to the javascript scheme (not on the
// allowlist) or fails to parse (not an allowed absolute URL). Relative
// references (path / query / fragment) are ordinary same-site navigation and
// are allowed; a protocol-relative `//host` inherits the page scheme and is
// refused so callers must be explicit. The allowed absolute schemes are http,
// https and mailto: none can execute script, so the dangerous ones
// (javascript:/data:/vbscript:/…) are refused. http is included because the
// archived FOI correspondence carries legitimate historical http:// links,
// rendered verbatim - a safe (if insecure-transport) scheme, never an XSS
// vector.
const SAFE_URL_SCHEMES = new Set(['http:', 'https:', 'mailto:']);

export function isSafeUrl(url: string): boolean {
  const raw = url.trim();
  if (raw === '') return true; // an empty href/src is inert, not a scheme vector
  if (raw.startsWith('//')) return false; // protocol-relative: inherits page scheme
  let parsed: URL | null = null;
  try {
    parsed = new URL(raw);
  } catch {
    parsed = null;
  }
  // No parseable absolute scheme => a relative reference: ordinary navigation.
  if (parsed === null) return true;
  return SAFE_URL_SCHEMES.has(parsed.protocol);
}

// Returns the url unchanged when it is safe to place in an href/src, or the
// inert '#' when it is not - so a neutralised link lands nowhere rather than
// firing a javascript:/data:/vbscript: payload.
export function safeUrl(url: string): string {
  return isSafeUrl(url) ? url : '#';
}

// ---- Shared affordances (issue #310) ----
// One definition each, reused across sections, so a given kind of link or
// value looks and behaves the same site-wide. Static, no JS: they emit plain
// HTML + the shared CSS, so the affordance works with JavaScript disabled.

// A link that LEAVES the site (or otherwise opens in a new browser tab): a
// trailing ↗ marker (decorative, so hidden from assistive tech) plus a
// visually-hidden "(opens in a new tab)" that announces the behaviour to a
// screen-reader, and rel="noopener" for the isolation a new tab needs. Only
// for links that leave the site's own pages - internal navigation stays a
// plain <a> so the two are visually and behaviourally distinguishable. This
// generalises the one-off series-nav ↗ into a single reusable convention.
export function externalLink(href: string, text: string, options: { escapeText?: boolean } = {}): string {
  const label = options.escapeText === false ? text : escapeHtml(text);
  // The href is neutralised through the scheme allowlist (issue #969): callers
  // pass pre-built (already entity-safe) hrefs, so it is not re-escaped here,
  // but a hostile scheme reaching this shared external-link affordance is
  // defanged to '#' rather than emitted.
  return `<a href="${safeUrl(href)}" target="_blank" rel="noopener">${label} <span class="ext-marker" aria-hidden="true">↗</span><span class="visually-hidden"> (opens in a new tab)</span></a>`;
}

// A deep link into the interactive Explore SQL console (site/explore.js),
// pre-filled with a specific database and query (issue #333). When a report
// sentence describes a SPECIFIC filtered view, it should send the reader to
// exactly that pre-filtered query rather than the empty tool they must
// re-filter; the console reads ?db= and ?sql= on load, pre-fills its controls,
// announces the pre-filled state and auto-runs a well-formed query. `relToRoot`
// places explore.html at the caller's relative depth (e.g. '../../../' from a
// dataset entry page). The query is percent-encoded and the two params are
// joined with the &amp; entity so the href is valid inside a double-quoted
// attribute — the same convention the hand-authored explore.html?…sql= links
// use. With JavaScript off the link still lands on the console with the query
// visible and editable, so the no-JS fallback stays meaningful.
export function exploreDeepLink(relToRoot: string, db: string, sql: string): string {
  return `${relToRoot}explore.html?db=${encodeURIComponent(db)}&amp;sql=${encodeURIComponent(sql)}`;
}
