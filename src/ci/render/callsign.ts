/**
 * The shared callsign field wrapper (issue #553): one helper for EVERY callsign
 * displayed on a generated page, so a callsign wears the same monospace visual,
 * makes its odd characters visible by the same convention, and offers the same
 * register-lookup crosslink wherever it appears - and per-surface drift
 * disappears by construction.
 *
 * Odd-character transparency is the load-bearing guarantee: a whitespace,
 * control, format or replacement character in a published callsign must never
 * hide (the fail-fast/transparency rule) - it renders as a visible highlighted
 * {marker} by the SAME convention the browser surfaces use (callsignCharMarker
 * in site/browser-query.js, mirrored here so a damaged callsign reads
 * identically on a generated page and in the interactive browsers).
 *
 * The #310 callsign pill is the linked instance of this wrapper: callsignPill
 * delegates here, so the lookup URL and the pill markup stay defined once.
 */

import { escapeHtml } from './html.ts';

// The single source of truth for the wrapper's stable CSS class: every
// callsign rendered as content - linked pill or plain chip - carries it, so
// the stylesheet targets one selector and the family can never drift apart.
export const CALLSIGN_CLASS = 'cs';

// How the wrapper treats characters outside the plain callsign alphabet.
//  - 'marked' (the default): the value is raw, as published; anything outside
//    [A-Za-z0-9/#] is made visible as a highlighted marker ({SP}, {NBSP},
//    {U+200B}, or the stray glyph itself), so damage cannot hide.
//  - 'pre-marked': the value ALREADY carries {…} markers (e.g. a stats.json
//    example, marked at derivation time); the wrapper highlights those tokens
//    without re-marking, so a literal brace in a marker is never double-marked.
//  - 'verbatim': no marking at all - for a value known to be clean by
//    construction (e.g. a curated reference callsign), stated explicitly.
export type CallsignOddCharacters = 'marked' | 'pre-marked' | 'verbatim';

// The parsed callsign components a caller may have to hand for the wrapper's
// supplementary title. Every field is optional: the wrapper uses whatever is
// present and degrades to the bare callsign when none is.
export interface CallsignComponents {
  prefixSeries?: string;
  rsl?: string;
  suffix?: string;
  // The human licence class / station level (e.g. 'Foundation'), where known.
  licenceClass?: string;
}

export interface CallsignFieldOptions {
  // How odd characters are made visible. Omitting it FOLLOWS THE DEFAULT
  // ('marked'), which may move over time. DRIFT-GUARD (#553): a usage that
  // genuinely REQUIRES a particular treatment must state it here explicitly -
  // even when it matches today's default - so a later change to the default
  // cannot silently alter it. A usage happy to track the convention passes
  // nothing.
  oddCharacters?: CallsignOddCharacters;
  // The register-lookup crosslink, opt-in where the context wants one: the
  // wrapper renders as the #310 pill LINK (?c=<callsign>) resolved
  // `depthToRoot` levels up. Omitted, the callsign is a plain non-link chip -
  // content to read, not a navigation target.
  lookup?: { depthToRoot: number };
  // Parsed component facts for the supplementary title ("M7TEE — prefix
  // series M7 · suffix TEE · Foundation"). The ACCESSIBLE NAME is always the
  // callsign itself (the element's text), never the title.
  components?: CallsignComponents;
  // What a blank callsign reads as. A blank value is itself information (a
  // record the source left empty), so it is never rendered as an empty
  // element - it is humanised to this label (default '(blank)', matching the
  // site-wide humanise-blanks convention). A surface that REQUIRES its own
  // wording pins it here.
  blankLabel?: string;
  // Extra class(es) appended after the stable class, for a surface that needs
  // to target a specific callsign without disturbing the shared visual.
  extraClass?: string;
}

// Friendly names for the odd characters observed in real register exports;
// anything else invisible falls back to its {U+XXXX} code point. Mirrors
// CALLSIGN_CHAR_NAMES in site/browser-query.js.
const CALLSIGN_CHAR_NAMES: Record<number, string> = {
  0x09: 'TAB', 0x0a: 'LF', 0x0d: 'CR', 0x20: 'SP', 0xa0: 'NBSP', 0xfeff: 'BOM', 0xfffd: 'U+FFFD',
};

// The marker for one character of a callsign - the server twin of
// callsignCharMarker in site/browser-query.js, so generated pages and the
// interactive browsers flag exactly the same characters the same way.
// Returns null for a plain glyph (letters, digits, / and #: pass through
// unchanged); a {friendly-name} or {U+XXXX} label for an INVISIBLE character
// (whitespace, control, format, replacement - no glyph of its own); or the
// character itself for a visible stray (a hyphen, dot, star), which stays
// readable but is highlighted by the caller.
export function callsignCharMarker(ch: string): string | null {
  if (/[a-zA-Z0-9#/]/.test(ch)) return null;
  const cp = ch.codePointAt(0);
  // An empty input has no code point and so no marker; guarding it also lets
  // the lookups below treat cp as a definite number.
  if (cp === undefined) return null;
  const named = CALLSIGN_CHAR_NAMES[cp];
  if (named !== undefined) return `{${named}}`;
  // Characters with no standalone glyph get the codepoint: \p{C}
  // (control/format, incl. zero-width chars \s misses), \p{Z} (all
  // separators), and \p{M} (combining marks - a lone accent would otherwise
  // float onto the marker span). Any other non-plain character is a visible
  // glyph of its own, shown as-is and highlighted.
  if (/[\p{C}\p{Z}\p{M}]/u.test(ch)) return `{U+${cp.toString(16).toUpperCase().padStart(4, '0')}}`;
  return ch;
}

// A {…} marker token in a pre-marked value (the split's capture group keeps
// the tokens in the output so they can be highlighted).
const PRE_MARKED_TOKEN_RE = /(\{[^{}]+\})/;

// The inner HTML of a callsign field, without the surrounding element: the
// escaped characters with odd ones wrapped in highlighted `.marker` spans per
// the requested treatment. Exposed for callers that supply their own element.
export function callsignDisplay(value: string, oddCharacters: CallsignOddCharacters = 'marked'): string {
  if (oddCharacters === 'verbatim') return escapeHtml(value);
  if (oddCharacters === 'pre-marked') {
    return value.split(PRE_MARKED_TOKEN_RE)
      .map(part => (PRE_MARKED_TOKEN_RE.test(part) ? `<span class="marker">${escapeHtml(part)}</span>` : escapeHtml(part)))
      .join('');
  }
  let html = '';
  // `for...of` iterates by code point, so an astral character is one unit.
  for (const ch of value) {
    const marker = callsignCharMarker(ch);
    html += marker !== null ? `<span class="marker">${escapeHtml(marker)}</span>` : escapeHtml(ch);
  }
  return html;
}

// The supplementary title built from the parsed components, or null when none
// are supplied - identical in shape to the browser pill's title
// (callsignPillTitle in site/callsign-pill.js).
function componentsTitle(callsign: string, components: CallsignComponents): string | null {
  const facts: string[] = [];
  if (components.prefixSeries !== undefined && components.prefixSeries !== '') facts.push(`prefix series ${components.prefixSeries}`);
  if (components.rsl !== undefined && components.rsl !== '') facts.push(`RSL ${components.rsl}`);
  if (components.suffix !== undefined && components.suffix !== '') facts.push(`suffix ${components.suffix}`);
  if (components.licenceClass !== undefined && components.licenceClass !== '') facts.push(components.licenceClass);
  return facts.length > 0 ? `${callsign} — ${facts.join(' · ')}` : null;
}

// The shared callsign field wrapper (#553). Emits one of:
//   <em class="cs cs-blank">(blank)</em>                    - a blank value, humanised
//   <code class="cs" [title]>…marked characters…</code>     - a plain chip
//   <a class="cs callsign-pill" href="…?c=…" [title]>…</a>  - the #310 lookup pill
// The stable class is always present; odd characters render per
// CallsignFieldOptions (see the drift-guard rule there); the accessible name
// is the callsign's own text, with component facts as a supplementary title.
export function callsignField(value: string, options: CallsignFieldOptions = {}): string {
  const extra = options.extraClass === undefined ? '' : ` ${options.extraClass}`;
  if (value === '') {
    // Nothing to mark, title or look up: a blank humanises to its label and
    // deliberately carries no lookup link (there is no callsign to look up).
    const label = options.blankLabel ?? '(blank)';
    return `<em class="${CALLSIGN_CLASS} cs-blank${escapeHtml(extra)}">${escapeHtml(label)}</em>`;
  }
  const display = callsignDisplay(value, options.oddCharacters);
  const title = componentsTitle(value, options.components ?? {});
  const titleAttr = title === null ? '' : ` title="${escapeHtml(title)}"`;
  if (options.lookup !== undefined) {
    const href = `${'../'.repeat(options.lookup.depthToRoot)}index.html?c=${encodeURIComponent(value)}`;
    return `<a class="${CALLSIGN_CLASS} callsign-pill${escapeHtml(extra)}" href="${href}"${titleAttr}>${display}</a>`;
  }
  return `<code class="${CALLSIGN_CLASS}${escapeHtml(extra)}"${titleAttr}>${display}</code>`;
}

// A callsign rendered as a small monospace pill that links to the register
// lookup (?c=<callsign>) - the #310 affordance, now the linked instance of the
// shared callsign field wrapper. `depthToRoot` places the lookup link at the
// right relative depth; any parsed component data becomes the supplementary
// title only, and the pill degrades to just the callsign when none is given.
export function callsignPill(callsign: string, depthToRoot: number, components: CallsignComponents = {}): string {
  return callsignField(callsign, { lookup: { depthToRoot }, components });
}
