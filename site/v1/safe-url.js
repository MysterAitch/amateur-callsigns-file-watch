// @ts-check
// v1 URL SCHEME ALLOWLIST (issue #969): the browser twin of
// passesSchemeAllowlist / neutraliseDisallowedScheme in src/ci/render/html.ts,
// kept in lockstep with that TypeScript source of truth. URL-typed values that
// reach an href/src are validated by PARSING (the WHATWG URL parser the browser
// itself applies — it strips tabs, newlines and leading control characters and
// lower-cases the scheme) and then ALLOWLISTING the scheme. Allowlisting, not
// denylisting, is what makes this obfuscation-proof: a mangled `java\tscript:`
// either parses to the javascript scheme (not on the allowlist) or fails to
// parse as an absolute URL. Relative references (path / query / fragment) are
// ordinary same-site navigation and pass; a protocol-relative `//host` inherits
// the page scheme and is refused. The allowed absolute schemes are http, https
// and mailto (none can execute script), so a hostile javascript:/data:/vbscript:
// href is neutralised to the inert '#'.
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

/**
 * Whether the value's scheme, if it has a parseable one, is on the allowlist.
 * NOT a judgement that the URL is safe: the destination is unchecked, and a
 * relative reference passes by default-allow (see the note at the top).
 * @param {string} url
 * @returns {boolean}
 */
export function passesSchemeAllowlist(url) {
  // Normalise backslashes to forward slashes as a browser does before resolving
  // a URL, so `/\host` or `\\host` - which a browser treats as the
  // protocol-relative `//host` (an open-redirect vector) - cannot masquerade as
  // an ordinary relative path and slip through as "relative".
  const raw = String(url).trim().replace(/\\/g, '/');
  if (raw === '') return true; // an empty href/src is inert, not a scheme vector
  if (raw.startsWith('//')) return false; // protocol-relative: inherits page scheme
  let parsed = null;
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

/**
 * Returns the url unchanged when its scheme is on the allowlist, or the inert
 * '#' when it is not. Neutralises the SCHEME only — it does not vet the
 * destination (see the note at the top of this module).
 * @param {string} url
 * @returns {string}
 */
export function neutraliseDisallowedScheme(url) {
  return passesSchemeAllowlist(url) ? url : '#';
}
