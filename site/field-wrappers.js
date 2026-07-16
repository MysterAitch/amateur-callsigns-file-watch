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

/** @typedef {(tag: string, attrs?: Record<string, string>) => HTMLElement} ElementFactory */

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
