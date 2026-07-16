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
 * {marker} by the SAME convention the browser surfaces use. The marker
 * vocabulary is not duplicated here: callsignCharMarker and the friendly-name
 * translation are IMPORTED from site/browser-query.js, the single source of
 * truth (issue #610), so a damaged callsign reads identically on a generated
 * page and in the interactive browsers by construction.
 *
 * The #310 callsign pill is the linked instance of this wrapper: callsignPill
 * delegates here, so the lookup URL and the pill markup stay defined once.
 */

import { escapeHtml } from './html.ts';
import { callsignCharMarker, translateMarkerToken } from '../../../site/browser-query.js';

// Re-exported so callers (and the drift-guard tests) reach the marker convention
// through the render module, while its one definition stays in browser-query.js.
export { callsignCharMarker };

// The single source of truth for the wrapper's stable CSS class: every
// callsign rendered as content - linked pill or plain chip - carries it, so
// the stylesheet targets one selector and the family can never drift apart.
export const CALLSIGN_CLASS = 'cs';

// How the wrapper treats characters outside the plain callsign alphabet.
//  - 'marked' (the default): the value is raw, as published; anything outside
//    [A-Za-z0-9/#] is made visible as a highlighted marker ({SP}, {NBSP},
//    {ZWSP}, {U+XXXX} for the unnamed, or the stray glyph itself), so damage
//    cannot hide.
//  - 'pre-marked': the value ALREADY carries {U+XXXX} markers (e.g. a
//    stats.json example, marked at derivation time); the wrapper highlights
//    those tokens - translating each to its friendly name at the edge (#610)
//    while keeping the code point in the title - without re-marking, so a
//    literal brace in a marker is never double-marked.
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

// A {…} marker token in a pre-marked value (the split's capture group keeps
// the tokens in the output so they can be highlighted).
const PRE_MARKED_TOKEN_RE = /(\{[^{}]+\})/;

// The inner HTML of a callsign field, without the surrounding element: the
// escaped characters with odd ones wrapped in highlighted `.marker` spans per
// the requested treatment. Exposed for callers that supply their own element.
export function callsignDisplay(value: string, oddCharacters: CallsignOddCharacters = 'marked'): string {
  if (oddCharacters === 'verbatim') return escapeHtml(value);
  if (oddCharacters === 'pre-marked') {
    // The value already carries {…} markers from derivation time (#553): the
    // wrapper highlights those tokens without re-marking. At the edge (#610) a
    // {U+XXXX} token is translated to its friendly name where one exists, with
    // the exact code point kept in the marker's title; a token with no friendly
    // name, an already-friendly token, or a literal brace passes through
    // untouched, so the no-double-marking guarantee holds.
    return value.split(PRE_MARKED_TOKEN_RE)
      .map(part => {
        if (!PRE_MARKED_TOKEN_RE.test(part)) return escapeHtml(part);
        const { text, title } = translateMarkerToken(part);
        const titleAttr = title === null ? '' : ` title="${escapeHtml(title)}"`;
        return `<span class="marker"${titleAttr}>${escapeHtml(text)}</span>`;
      })
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
