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
//
// WHAT THIS ESTABLISHES, AND WHAT IT DOES NOT (issue #990). These functions are
// named for their MECHANISM — a scheme allowlist — and not for a verdict about
// the URL, because the property they establish is narrower than "safe":
//
//   - the SCHEME is cleared, the DESTINATION is not. An allowlisted scheme says
//     nothing about where the URL points: `https://<hostile-host>/…` passes, as
//     does an authority carrying credentials. Anything needing a trusted
//     destination — an outbound redirect target, say — needs its own host check
//     ON TOP of this one; this is not that check.
//   - a relative reference passes by DEFAULT, not by verification. It has no
//     parseable absolute scheme, so there is no scheme to refuse; the pass is a
//     deliberate default-allow for ordinary same-site navigation rather than a
//     positive finding about the value.
//
// So a `true` result means "this value will not execute script by virtue of its
// scheme" — no more. Callers must not read it as a general safety verdict.
const ALLOWED_URL_SCHEMES = new Set(['http:', 'https:', 'mailto:']);

// Whether the value's scheme, if it has a parseable one, is on the allowlist.
// NOT a judgement that the URL is safe - see the note above.
export function passesSchemeAllowlist(url: string): boolean {
  // Normalise backslashes to forward slashes as a browser does before resolving
  // a URL, so `/\host` or `\\host` - which a browser treats as the
  // protocol-relative `//host` (an open-redirect vector) - cannot masquerade as
  // an ordinary relative path and slip through as "relative".
  const raw = url.trim().replace(/\\/g, '/');
  if (raw === '') return true; // an empty href/src is inert, not a scheme vector
  if (raw.startsWith('//')) return false; // protocol-relative: inherits page scheme
  let parsed: URL | null = null;
  try {
    parsed = new URL(raw);
  } catch {
    parsed = null;
  }
  // No parseable absolute scheme => a relative reference: ordinary same-site
  // navigation, allowed by default rather than positively verified.
  if (parsed === null) return true;
  return ALLOWED_URL_SCHEMES.has(parsed.protocol);
}

// Returns the url unchanged when its scheme is on the allowlist, or the inert
// '#' when it is not - so a neutralised link lands nowhere rather than firing a
// javascript:/data:/vbscript: payload. Neutralises the SCHEME only; it does not
// vet the destination (see the note above).
export function neutraliseDisallowedScheme(url: string): string {
  return passesSchemeAllowlist(url) ? url : '#';
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
  return `<a href="${neutraliseDisallowedScheme(href)}" target="_blank" rel="noopener">${label} <span class="ext-marker" aria-hidden="true">↗</span><span class="visually-hidden"> (opens in a new tab)</span></a>`;
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
