// @ts-check
// v1 GLOSSARY SECTION REGISTRY (issue #930): the glossary page as a config array
// of section ids resolved against a registry of { id, mount(host) } — the same
// pattern as home-sections.js and callsign-sections.js. renderGlossarySections
// appends one <section data-section="id"> per entry in GLOSSARY_SECTION_ORDER and
// mounts each group's definition list, throwing on any id with no registered
// mount so a config array can never render a silent gap.
//
// SINGLE SOURCE OF TRUTH: every definition is read from V1_COPY.glossary — the
// exact registry the inline popovers open (site/v1/glossary.js) — never a second
// copy. Each term is rendered under its stable glossaryAnchorId, so the popover
// link-outs resolve to a real anchor here. A build-time invariant asserts the
// groups cover the registry exactly (no term left off the page, none listed
// twice), so a future term added to the registry cannot silently miss the page.

import { V1_COPY } from './copy.js';
import { glossaryAnchorId } from './glossary.js';

/**
 * @param {string} tag
 * @param {string | null} [cls]
 * @param {string | null} [txt]
 */
const el = (tag, cls, txt) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (txt != null) node.textContent = txt;
  return node;
};

/** @typedef {keyof typeof V1_COPY.glossary} GlossaryKey */

/**
 * @typedef {object} GlossaryGroup
 * @property {string} id     the section id (also the <section data-section>)
 * @property {string} label  the group heading, from the copy registry
 * @property {GlossaryKey[]} keys  the registry keys rendered in this group, in order
 */

// The glossary's groups, in render order. Every V1_COPY.glossary key appears in
// exactly one group (asserted below); a term added to the registry must be
// placed in a group here, or the invariant fails loudly rather than dropping it.
/** @type {GlossaryGroup[]} */
export const GLOSSARY_GROUPS = [
  { id: 'reading-the-record', label: V1_COPY.glossaryPage.readingLabel, keys: ['eventTime', 'assertionTime', 'sighting', 'disputed'] },
  { id: 'what-the-record-holds', label: V1_COPY.glossaryPage.holdingsLabel, keys: ['publication', 'vintage', 'bookkeeping', 'series', 'carriedOrigin'] },
  { id: 'how-a-value-is-produced', label: V1_COPY.glossaryPage.provenanceLabel, keys: ['derived', 'inferred', 'context'] },
];

// Every glossary registry key, and the keys the groups actually place — the two
// must match exactly. Exposed for the completeness test and the render-time guard.
export const GLOSSARY_REGISTRY_KEYS = /** @type {GlossaryKey[]} */ (Object.keys(V1_COPY.glossary));
export const GLOSSARY_GROUPED_KEYS = GLOSSARY_GROUPS.flatMap((g) => g.keys);

// Assert the groups cover the registry exactly: no term left off the page, and
// none listed twice. Thrown at import so a drift is a hard, immediate failure
// (the module cannot load), never a silently-incomplete page.
/** @returns {void} */
export function assertGroupsCoverRegistry() {
  const grouped = GLOSSARY_GROUPED_KEYS;
  const seen = new Set();
  for (const key of grouped) {
    if (seen.has(key)) throw new Error(`glossary groups: "${key}" is listed in more than one group`);
    seen.add(key);
  }
  const registry = new Set(GLOSSARY_REGISTRY_KEYS);
  for (const key of grouped) {
    if (!registry.has(key)) throw new Error(`glossary groups: "${key}" is not a term in V1_COPY.glossary`);
  }
  for (const key of GLOSSARY_REGISTRY_KEYS) {
    if (!seen.has(key)) throw new Error(`glossary groups: registry term "${key}" is on no group — every coined term must appear on the page`);
  }
}
assertGroupsCoverRegistry();

/**
 * Mount one group's definition list into its host section: a legibility panel
 * (.surface) carrying the group heading and a <dl class="gloss"> whose every
 * <dt> takes the term's stable glossaryAnchorId, so each definition is deep-
 * linkable and every popover link-out resolves. Every value is textContent.
 * @param {HTMLElement} host
 * @param {GlossaryGroup} group
 */
function mountGroup(host, group) {
  const surface = el('section', 'surface');
  surface.appendChild(el('div', 'lbl', group.label));
  const dl = el('dl', 'gloss');
  for (const key of group.keys) {
    const entry = V1_COPY.glossary[key];
    const dt = el('dt', null, entry.term);
    dt.setAttribute('id', glossaryAnchorId(key));
    dl.appendChild(dt);
    dl.appendChild(el('dd', null, entry.def));
  }
  surface.appendChild(dl);
  host.appendChild(surface);
}

// ---------------------------------------------------------------------------
// The registry + order (the config array).

export const GLOSSARY_SECTION_ORDER = GLOSSARY_GROUPS.map((g) => g.id);

/** @type {Record<string, { id: string, mount: (host: HTMLElement) => void }>} */
export const GLOSSARY_SECTION_REGISTRY = Object.fromEntries(
  GLOSSARY_GROUPS.map((group) => [group.id, { id: group.id, mount: (/** @type {HTMLElement} */ host) => mountGroup(host, group) }]),
);

/**
 * Render the glossary sections in order into `root`, one <section
 * data-section="id"> per entry. Throws on any id with no registered mount — a
 * config array can never render a silent gap.
 * @param {HTMLElement} root
 * @param {readonly string[]} [order]
 * @param {Record<string, { id: string, mount: (host: HTMLElement) => void }>} [registry]
 */
export function renderGlossarySections(root, order = GLOSSARY_SECTION_ORDER, registry = GLOSSARY_SECTION_REGISTRY) {
  for (const id of order) {
    const entry = registry[id];
    if (entry === undefined) {
      throw new Error(`renderGlossarySections: no registered section for id "${id}" — every id in GLOSSARY_SECTION_ORDER must have a registry entry`);
    }
    const section = el('section');
    section.setAttribute('data-section', id);
    entry.mount(section);
    root.appendChild(section);
  }
}
