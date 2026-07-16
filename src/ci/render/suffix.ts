/**
 * The shared callsign-suffix field wrapper (issue #644): one helper for EVERY
 * three-letter forbidden-suffix token displayed on the forbidden-suffix
 * section (a disclosure's list preview, the added/removed diff, the A-Z
 * browse block, a per-suffix page's own heading and at-a-glance facts), so a
 * suffix reads with the SAME visual identity as the callsign it is a
 * fragment of (issue #553's own reasoning for the family of field wrappers).
 *
 * Unlike ./prefix-series.ts, a suffix here IS raw free text lifted verbatim
 * from a published FOI disclosure ("declared, not verified" throughout
 * build-forbidden-section.ts) - the same risk profile as a raw callsign, so
 * odd-character transparency matters here too: a whitespace, control or
 * stray glyph in a published suffix must never hide. Marking is delegated to
 * ./callsign.ts's own `callsignDisplay` - the SAME implementation, not a
 * copy, so a marked character reads identically wherever it appears.
 *
 * Every per-suffix detail page lives at forbidden/suffix/<SUFFIX>/index.html;
 * the crosslink is opt-in and the caller states which page it is linking
 * FROM (`SuffixLinkOrigin`), mirroring the pre-#644 `suffixHref`/`suffixLinks`
 * helpers this module replaces. A suffix with no known per-suffix page (a
 * hypothetical future adoption site showing a callsign's own parsed suffix,
 * which need not be on the forbidden list) simply omits `link` - the wrapper
 * never manufactures one.
 */

import { escapeHtml } from './html.ts';
import { CALLSIGN_CLASS, callsignDisplay, type CallsignOddCharacters } from './callsign.ts';

// The stable class every suffix value carries alongside the shared callsign
// base class (CALLSIGN_CLASS) - see PREFIX_SERIES_CLASS in ./prefix-series.ts
// for the same pairing rationale.
export const SUFFIX_CLASS = 'cs-sfx';

// A suffix never carries a derivation-time {…}-marked form (unlike a
// callsign, which can arrive pre-marked from stats.json): only 'marked' and
// 'verbatim' apply.
export type SuffixOddCharacters = Extract<CallsignOddCharacters, 'marked' | 'verbatim'>;

// Every disclosure/index/suffix page the forbidden-suffix section renders a
// suffix from, each resolving the per-suffix page's relative href
// differently: mirrors the pre-#644 `LinkOrigin` in build-forbidden-section.ts.
//  - 'index': forbidden/index.html -> forbidden/suffix/<SUFFIX>/index.html
//  - 'disclosure': forbidden/<entry>/index.html -> ../suffix/<SUFFIX>/index.html
//  - 'suffix': forbidden/suffix/<OTHER>/index.html -> ../<SUFFIX>/index.html
export type SuffixLinkOrigin = 'index' | 'disclosure' | 'suffix';

function suffixHref(suffix: string, from: SuffixLinkOrigin): string {
  const enc = encodeURIComponent(suffix);
  if (from === 'index') return `suffix/${enc}/index.html`;
  if (from === 'disclosure') return `../suffix/${enc}/index.html`;
  return `../${enc}/index.html`;
}

export interface SuffixFieldOptions {
  // How odd characters are made visible. Omitting it FOLLOWS THE DEFAULT
  // ('marked'), which may move over time. DRIFT-GUARD (#644, following the
  // #553 convention): a usage that genuinely REQUIRES no marking (a value
  // known clean by construction) must state it here explicitly.
  oddCharacters?: SuffixOddCharacters;
  // The per-suffix detail-page crosslink, opt-in where the context wants one
  // AND knows the page exists (every ever-forbidden union suffix has one;
  // nothing else does). Omitted, the suffix is plain content to read, not a
  // navigation target - the "unknown suffix" case never fabricates a link.
  link?: { from: SuffixLinkOrigin };
  // What a blank suffix reads as. A blank value is itself information, so it
  // is never rendered as an empty element - it is humanised to this label
  // (default '(blank)', matching the site-wide humanise-blanks convention).
  blankLabel?: string;
  // Extra class(es) appended after the stable classes, for a surface that
  // needs to target a specific suffix without disturbing the shared visual.
  extraClass?: string;
}

// The shared suffix field wrapper (#644). Emits one of:
//   <em class="cs cs-sfx-blank">(blank)</em>          - a blank value, humanised
//   <code class="cs cs-sfx">…marked characters…</code> - plain content (default)
//   <a class="cs cs-sfx" href="…suffix/…">…marked…</a>  - the opt-in per-suffix-page link
// The stable classes are always present; odd characters render per
// SuffixFieldOptions (see the drift-guard rule there). See
// PrefixSeriesFieldOptions in ./prefix-series.ts for the sibling wrapper this
// one deliberately diverges from on marking, following the data's own grain.
export function suffixField(value: string, options: SuffixFieldOptions = {}): string {
  const extra = options.extraClass === undefined ? '' : ` ${options.extraClass}`;
  if (value === '') {
    const label = options.blankLabel ?? '(blank)';
    return `<em class="${CALLSIGN_CLASS} ${SUFFIX_CLASS}-blank${escapeHtml(extra)}">${escapeHtml(label)}</em>`;
  }
  const display = callsignDisplay(value, options.oddCharacters ?? 'marked');
  if (options.link !== undefined) {
    const href = suffixHref(value, options.link.from);
    return `<a class="${CALLSIGN_CLASS} ${SUFFIX_CLASS}${escapeHtml(extra)}" href="${href}">${display}</a>`;
  }
  return `<code class="${CALLSIGN_CLASS} ${SUFFIX_CLASS}${escapeHtml(extra)}">${display}</code>`;
}
