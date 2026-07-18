// @ts-check
// The shared licence/status field wrappers for the hand-authored browser
// surfaces (issue #625), mirroring the generated-page wrappers in
// src/ci/render/licence.ts and src/ci/render/status.ts (issue #553/#623) so a
// licence or register-status value looks and behaves the same rendered in the
// browser (the lookup, the entry browser, compare, the ledger dossier) as on
// the generated pages: a blank value is humanised rather than shown (or
// hidden) as nothing, a stable `.lic`/`.stat` class matches the generated
// pages' CSS, and a recognised status value is one click from its glossary
// definition. Frameworkless and build-step-free (ADR 0002/0003): the caller
// supplies its own element factory - the same ElementFactory shape
// callsign-pill.js/datetime.js use - so this module makes no assumption about
// how a node is built; nesting (the glossary-linked case) is done with the
// element's own native `.append()`, which every factory's output supports.
//
// Also here (issue #658): the callsign-PART field wrappers, mirroring
// src/ci/render/prefix-series.ts and src/ci/render/suffix.ts (issue #644) so a
// prefix series or forbidden suffix carries the SAME shared visual identity in
// the browser it already carries on the generated pages - the interactive gap
// #644 itself flagged and left for this follow-on. Both import the family's
// base class (CALLSIGN_CLASS) and, for the suffix wrapper's odd-character
// transparency, the shared marking loop (appendMarkedChars) from
// callsign-pill.js - the browser counterpart of callsign.ts, exactly as
// suffix.ts imports callsignDisplay from callsign.ts rather than copying it.

/** @typedef {(tag: string, attrs?: Record<string, string>) => HTMLElement} ElementFactory */

import { CALLSIGN_CLASS, appendMarkedChars } from './callsign-pill.js';

// The single source of truth for each wrapper's stable CSS class, matching
// LICENCE_CLASS/STATUS_CLASS in src/ci/render/licence.ts and status.ts so
// browser- and server-rendered values target the same selectors (site/style.css).
export const LICENCE_CLASS = 'lic';
export const STATUS_CLASS = 'stat';

// ---------------------------------------------------------------------------
// Licence class/category (the implied Foundation/Intermediate/Full level, or a
// source's own declared product string).

/** @typedef {'as-declared' | 'shortened'} LicenceForm */

/**
 * @typedef {object} LicenceFieldOptions
 * @property {LicenceForm} [form] Which form to render. Omitting it FOLLOWS THE
 *   DEFAULT ('as-declared'), which may move over time. DRIFT-GUARD (#553): a
 *   usage that genuinely REQUIRES the shortened form must state it here
 *   explicitly, even where it matches today's reasoning, so a later change to
 *   the default cannot silently alter it.
 * @property {string} [blankLabel] What a blank licence value reads as
 *   (default '(blank)'). A blank value is itself information - the source
 *   published the row with no product/class stated - so it is never rendered
 *   as an empty element.
 * @property {string} [extraClass] Extra class(es) appended after the stable class.
 */

const PRODUCT_PREFIX_RE = /^Amateur /;
const PRODUCT_SUFFIX_RE = / Radio Licence$/;

// The visible text a `licenceField` would show, without the surrounding
// element - exposed for a caller that needs the label alone. Mirrors
// licenceDisplay in src/ci/render/licence.ts.
/**
 * @param {string} value
 * @param {LicenceForm} [form]
 * @returns {string}
 */
export function licenceDisplay(value, form = 'as-declared') {
  if (form === 'as-declared' || value === '') return value;
  return value.replace(PRODUCT_PREFIX_RE, '').replace(PRODUCT_SUFFIX_RE, '');
}

// The shared licence field wrapper (#553/#625). Emits one of:
//   <em class="lic lic-blank">(blank)</em>        - a blank value, humanised
//   <span class="lic">…value…</span>              - the value as-declared (default)
//   <span class="lic" title="…raw…">…short…</span> - the shortened form, raw value in the title
// The shortened form never DROPS the raw value - it always carries it in the
// title. See LicenceFieldOptions for the drift-guard rule.
/**
 * @param {ElementFactory} el
 * @param {string} value
 * @param {LicenceFieldOptions} [options]
 * @returns {HTMLElement}
 */
export function licenceField(el, value, options = {}) {
  const extra = options.extraClass === undefined ? '' : ` ${options.extraClass}`;
  if (value === '') {
    return el('em', { class: `${LICENCE_CLASS} lic-blank${extra}`, text: options.blankLabel ?? '(blank)' });
  }
  const form = options.form ?? 'as-declared';
  const shown = licenceDisplay(value, form);
  /** @type {Record<string, string>} */
  const attrs = { class: `${LICENCE_CLASS}${extra}`, text: shown };
  if (shown !== value) attrs.title = value;
  return el('span', attrs);
}

// ---------------------------------------------------------------------------
// Register status (Allocated / Reserved / Available / Live / Forbidden /
// Quarantine, or a blank cell).

/** @typedef {'linked' | 'plain'} StatusGlossaryLinking */

/**
 * @typedef {object} StatusFieldOptions
 * @property {number} [depthToRoot] Where to resolve the glossary link from
 *   (site root depth: 0 for a page at the root, e.g. `../../../` for a page
 *   three levels down). Omitted, no link is possible - there is nowhere to
 *   resolve `glossary.html` from - and the value renders as plain text
 *   regardless of `glossaryLinking`.
 * @property {StatusGlossaryLinking} [glossaryLinking] How a recognised status
 *   value is crosslinked. Omitting it FOLLOWS THE DEFAULT ('linked'), which
 *   may move over time. DRIFT-GUARD (#553): a usage that genuinely REQUIRES
 *   plain text (a per-record row repeating the same handful of values many
 *   times, or a value nested inside a click-to-filter role="button" row, where
 *   a nested `<a>` is an accessibility anti-pattern) must state it here
 *   explicitly.
 * @property {string} [blankLabel] What a blank status reads as (default
 *   '(blank)'). A surface with an established wording (e.g. "(no status
 *   recorded)") pins it here.
 * @property {string} [extraClass] Extra class(es) appended after the stable class.
 */

// Every register status value the glossary defines (site/glossary.html#status),
// mapped to its anchor and plain-language name, mirroring
// GLOSSARY_ANCHORS/STATUS_GLOSSARY_ANCHOR in src/ci/render/glossary.ts and
// status.ts. Kept in step by convention (both are small, stable vocabularies):
// site/glossary-links.test.ts checks every glossary.html#… link written
// STATICALLY into the hand-authored *.html pages, but not one assembled at
// runtime from a template string here, so this table's anchors are verified
// directly in field-wrappers.test.ts instead. Anything else (a future status,
// a typo, a stray source-only string) is unrecognised and renders as plain
// text - never a fabricated link.
const STATUS_GLOSSARY = {
  Allocated: { anchor: 'allocated', name: 'the Allocated status' },
  Reserved: { anchor: 'reserved', name: 'the Reserved status' },
  Available: { anchor: 'available', name: 'the Available status (and the availability trap)' },
  Live: { anchor: 'status-live', name: 'the Live status (no canonical meaning established)' },
  Forbidden: { anchor: 'status-forbidden', name: 'the Forbidden status (no canonical meaning established)' },
  Quarantine: { anchor: 'status-quarantine', name: 'the Quarantine status (no canonical meaning established)' },
};

// The visible text a `statusField` would show, without the surrounding
// element or any glossary link. Mirrors statusDisplay in src/ci/render/status.ts.
/**
 * @param {string} value
 * @param {string} [blankLabel]
 * @returns {string}
 */
export function statusDisplay(value, blankLabel = '(blank)') {
  return value === '' ? blankLabel : value;
}

// The shared status field wrapper (#553/#625). Emits one of:
//   <em class="stat stat-blank">(blank)</em>                       - a blank value, humanised
//   <span class="stat">…value…</span>                              - plain text
//   <span class="stat"><a class="gloss-term" href="…">…</a></span> - a recognised, linked value
// The "(?)" cue and visually-hidden accessible text match the shared
// gloss-term affordance (src/ci/render/glossary.ts) exactly, so a linked
// status reads and behaves identically wherever it appears. See
// StatusFieldOptions for the glossary-linking drift-guard rule.
/**
 * @param {ElementFactory} el
 * @param {string} value
 * @param {StatusFieldOptions} [options]
 * @returns {HTMLElement}
 */
export function statusField(el, value, options = {}) {
  const extra = options.extraClass === undefined ? '' : ` ${options.extraClass}`;
  if (value === '') {
    return el('em', { class: `${STATUS_CLASS} stat-blank${extra}`, text: options.blankLabel ?? '(blank)' });
  }
  const linking = options.glossaryLinking ?? 'linked';
  const entry = Object.hasOwn(STATUS_GLOSSARY, value) ? STATUS_GLOSSARY[/** @type {keyof typeof STATUS_GLOSSARY} */ (value)] : undefined;
  if (linking === 'linked' && entry !== undefined && options.depthToRoot !== undefined) {
    const wrap = el('span', { class: `${STATUS_CLASS}${extra}` });
    const href = `${'../'.repeat(options.depthToRoot)}glossary.html#${entry.anchor}`;
    const a = el('a', { class: 'gloss-term', href, text: value });
    const cue = el('span', { class: 'gloss-cue', 'aria-hidden': 'true', text: '?' });
    const hidden = el('span', { class: 'visually-hidden', text: ` (definition of ${entry.name} in the glossary)` });
    a.append(cue, hidden);
    wrap.append(a);
    return wrap;
  }
  return el('span', { class: `${STATUS_CLASS}${extra}`, text: value });
}

// ---------------------------------------------------------------------------
// Prefix series (issue #658, mirroring src/ci/render/prefix-series.ts, #644).
//
// A series name is stored bare everywhere (20, M7); `prefixSeriesDisplay`
// inserts the `#` RSL-slot marker purely for display, after the leading
// character - the uniform convention already established by app.js's own
// pre-#658 `displaySeries` (retired in favour of this shared one) and the
// generated pages alike. Deliberately no odd-character marking, for the same
// reason prefix-series.ts gives: a series is never raw free text lifted
// verbatim from a publication - it is hand-curated reference data or set only
// once a callsign is recognised as a standard UK form, so its character set is
// already controlled by the time this wrapper ever sees it.

// The stable class every prefix-series value carries alongside CALLSIGN_CLASS.
export const PREFIX_SERIES_CLASS = 'cs-pfx';

/** @typedef {'displayed' | 'bare'} PrefixSeriesForm */

/**
 * @typedef {object} PrefixSeriesFieldOptions
 * @property {PrefixSeriesForm} [form] Which form to render. Omitting it
 *   FOLLOWS THE DEFAULT ('displayed'), which may move over time. DRIFT-GUARD
 *   (#658, following the #553/#644 convention): a usage that genuinely
 *   REQUIRES the bare form must state it here explicitly.
 * @property {{ depthToRoot: number }} [link] The series entity-page crosslink,
 *   opt-in where the context wants one: renders as a link to
 *   `series/<slug>.html` resolved `depthToRoot` levels up. Omitted, the series
 *   is plain content to read, not a navigation target. A blank value or one
 *   whose slug resolves empty never manufactures a link even when this is given.
 * @property {string} [blankLabel] What a blank prefix series reads as (default
 *   '(blank)') - a blank value is itself information (an unparseable callsign
 *   has no series), so it is never rendered as an empty element.
 * @property {string} [extraClass] Extra class(es) appended after the stable classes.
 */

// The visible text a `prefixSeriesField` would show, without the surrounding
// element. Mirrors prefixSeriesDisplay in src/ci/render/prefix-series.ts.
/**
 * @param {string} value
 * @param {PrefixSeriesForm} [form]
 * @returns {string}
 */
export function prefixSeriesDisplay(value, form = 'displayed') {
  if (form === 'bare' || value === '' || value.includes('#') || value.length < 2) return value;
  return `${value[0]}#${value.slice(1)}`;
}

// URL-safe slug for a prefix series' entity page (series/<slug>.html). Names
// are stored bare, so this is normally the identity; the `#` strip stays as a
// guard for any display-form input reaching here directly. Mirrors
// prefixSeriesSlug in src/ci/render/prefix-series.ts.
/**
 * @param {string} series
 * @returns {string}
 */
export function prefixSeriesSlug(series) {
  return series.replace(/#/g, '');
}

// The shared prefix-series field wrapper (#658/#644). Emits one of:
//   <em class="cs cs-pfx-blank">(blank)</em>          - a blank value, humanised
//   <span class="cs cs-pfx">…value…</span>            - plain content (default)
//   <a class="cs cs-pfx" href="…series/…">…value…</a> - the opt-in series-page link
// See PrefixSeriesFieldOptions for the drift-guard rule.
/**
 * @param {ElementFactory} el
 * @param {string} value
 * @param {PrefixSeriesFieldOptions} [options]
 * @returns {HTMLElement}
 */
export function prefixSeriesField(el, value, options = {}) {
  const extra = options.extraClass === undefined ? '' : ` ${options.extraClass}`;
  if (value === '') {
    return el('em', { class: `${CALLSIGN_CLASS} ${PREFIX_SERIES_CLASS}-blank${extra}`, text: options.blankLabel ?? '(blank)' });
  }
  const form = options.form ?? 'displayed';
  const shown = prefixSeriesDisplay(value, form);
  if (options.link !== undefined) {
    const slug = prefixSeriesSlug(value);
    if (slug !== '') {
      const href = `${'../'.repeat(options.link.depthToRoot)}series/${encodeURIComponent(slug)}.html`;
      return el('a', { class: `${CALLSIGN_CLASS} ${PREFIX_SERIES_CLASS}${extra}`, href, text: shown });
    }
  }
  return el('span', { class: `${CALLSIGN_CLASS} ${PREFIX_SERIES_CLASS}${extra}`, text: shown });
}

// ---------------------------------------------------------------------------
// Forbidden suffix (issue #658, mirroring src/ci/render/suffix.ts, #644).
//
// Unlike the prefix series above, a suffix here IS raw free text lifted
// verbatim from a published FOI disclosure or parsed straight off a register
// row - the same risk profile as a raw callsign, so odd-character
// transparency matters here too. Marking is delegated to appendMarkedChars
// (callsign-pill.js) - the SAME loop, not a copy, so a marked character reads
// identically wherever it appears.
//
// The per-suffix detail page lives at forbidden/suffix/<SUFFIX>/index.html,
// built at the site root - a DIFFERENT tree to the one the generated pages'
// own SuffixLinkOrigin resolves within (forbidden/index.html,
// forbidden/<entry>/index.html, forbidden/suffix/<OTHER>/index.html). The
// hand-authored surfaces this wrapper serves (index.html, callsign.html) sit
// at their OWN, generally shallower depths outside that tree entirely, so this
// wrapper resolves its link the same way every other browser-family crosslink
// does - `depthToRoot` from the site root - rather than reusing the generated
// wrapper's tree-relative origin enum. A deliberate divergence, not an
// oversight: the two geometries solve the same problem for two different trees.

// The stable class every suffix value carries alongside CALLSIGN_CLASS.
export const SUFFIX_CLASS = 'cs-sfx';

/** @typedef {'marked' | 'verbatim'} SuffixOddCharacters */

/**
 * @typedef {object} SuffixFieldOptions
 * @property {SuffixOddCharacters} [oddCharacters] How odd characters are made
 *   visible. Omitting it FOLLOWS THE DEFAULT ('marked'), which may move over
 *   time. DRIFT-GUARD (#658, following the #553/#644 convention): a usage that
 *   genuinely REQUIRES no marking (a value known clean by construction) must
 *   state it here explicitly.
 * @property {{ depthToRoot: number }} [link] The per-suffix detail-page
 *   crosslink, opt-in where the context wants one AND knows the page exists
 *   (every ever-forbidden union suffix has one; nothing else does). Omitted,
 *   the suffix is plain content to read, not a navigation target.
 * @property {string} [blankLabel] What a blank suffix reads as (default '(blank)').
 * @property {string} [extraClass] Extra class(es) appended after the stable classes.
 */

// The shared suffix field wrapper (#658/#644). Emits one of:
//   <em class="cs cs-sfx-blank">(blank)</em>            - a blank value, humanised
//   <code class="cs cs-sfx">…marked characters…</code>  - plain content (default)
//   <a class="cs cs-sfx" href="…forbidden/suffix/…">…marked…</a> - the opt-in per-suffix-page link
// See SuffixFieldOptions for the drift-guard rule.
/**
 * @param {ElementFactory} el
 * @param {string} value
 * @param {SuffixFieldOptions} [options]
 * @returns {HTMLElement}
 */
export function suffixField(el, value, options = {}) {
  const extra = options.extraClass === undefined ? '' : ` ${options.extraClass}`;
  if (value === '') {
    return el('em', { class: `${CALLSIGN_CLASS} ${SUFFIX_CLASS}-blank${extra}`, text: options.blankLabel ?? '(blank)' });
  }
  const oddCharacters = options.oddCharacters ?? 'marked';
  const cls = `${CALLSIGN_CLASS} ${SUFFIX_CLASS}${extra}`;
  const host = options.link === undefined
    ? el('code', { class: cls })
    : el('a', { class: cls, href: `${'../'.repeat(options.link.depthToRoot)}forbidden/suffix/${encodeURIComponent(value)}/index.html` });
  if (oddCharacters === 'verbatim') { host.append(value); return host; }
  return appendMarkedChars(el, host, value);
}

// ---------------------------------------------------------------------------
// Absent-value marker (issue #826), mirroring absentMarker in
// src/ci/render/format.ts so an absent value looks and behaves identically
// rendered in the browser and on the generated pages.
//
// A value position with NO value at all - a NULL column, an unset field -
// distinct from a BLANK-BUT-PRESENT value, which keeps its own '(blank)'-style
// humanised wrapper untouched (licenceField/statusField/prefixSeriesField/
// suffixField above). Before this, such a position rendered a bare em dash:
// ambiguous, since the em dash also does duty as prose punctuation throughout
// the site, and inaccessible, since a bare glyph carries no name for
// assistive tech. The middle dot never doubles as prose punctuation, so it
// reads unambiguously as "nothing here"; the accessible label is always
// carried via `title` AND `aria-label`, never a bare glyph.

export const ABSENT_MARKER = '·';
export const ABSENT_CLASS = 'absent';
export const ABSENT_LABEL = 'not recorded';

// The shared absent-value wrapper (#826). Emits
//   <span class="absent" title="not recorded" aria-label="not recorded">·</span>
// `label` defaults to ABSENT_LABEL; a caller with a more specific fact to
// state (e.g. "not currently in the register") may pass its own.
/**
 * @param {ElementFactory} el
 * @param {string} [label]
 * @returns {HTMLElement}
 */
export function absentMarker(el, label = ABSENT_LABEL) {
  return el('span', { class: ABSENT_CLASS, title: label, 'aria-label': label, text: ABSENT_MARKER });
}
