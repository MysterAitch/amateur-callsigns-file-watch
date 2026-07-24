// @ts-check
// v1 URL SCHEME ALLOWLIST (issue #969): the browser twin of isSafeUrl / safeUrl
// in src/ci/render/html.ts, kept in lockstep with that TypeScript source of
// truth. URL-typed values that reach an href/src are validated by PARSING (the
// WHATWG URL parser the browser itself applies — it strips tabs, newlines and
// leading control characters and lower-cases the scheme) and then ALLOWLISTING
// the scheme. Allowlisting, not denylisting, is what makes this
// obfuscation-proof: a mangled `java\tscript:` either parses to the javascript
// scheme (not on the allowlist) or fails to parse as an absolute URL. Relative
// references (path / query / fragment) are ordinary same-site navigation and
// pass; a protocol-relative `//host` inherits the page scheme and is refused.
// The allowed absolute schemes are http, https and mailto (none can execute
// script), so a hostile javascript:/data:/vbscript: href is neutralised to the
// inert '#'. Kept in lockstep with the TS source of truth.

const SAFE_URL_SCHEMES = new Set(['http:', 'https:', 'mailto:']);

/**
 * @param {string} url
 * @returns {boolean}
 */
export function isSafeUrl(url) {
  const raw = String(url).trim();
  if (raw === '') return true; // an empty href/src is inert, not a scheme vector
  if (raw.startsWith('//')) return false; // protocol-relative: inherits page scheme
  let parsed = null;
  try {
    parsed = new URL(raw);
  } catch {
    parsed = null;
  }
  // No parseable absolute scheme => a relative reference: ordinary navigation.
  if (parsed === null) return true;
  return SAFE_URL_SCHEMES.has(parsed.protocol);
}

/**
 * Returns the url unchanged when it is safe to place in an href/src, or the
 * inert '#' when it is not.
 * @param {string} url
 * @returns {string}
 */
export function safeHref(url) {
  return isSafeUrl(url) ? url : '#';
}
