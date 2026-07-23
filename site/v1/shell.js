// @ts-check
// v1 SITE SHELL (issue #921): the three chrome renderers shared by every v1
// page — the white header bar (brand + dated-fact chip + journey nav), the
// breadcrumb, and the white footer bar. Dependency-free of any third party;
// all wording comes from the copy registry (site/v1/copy.js), and the DOM is
// built with the same el() idiom as the shared page modules.
//
// The v1 surface is self-contained: it links only to pages the v1 surface
// itself serves. A journey that has not been migrated simply does not appear —
// the honest state for something not here yet — rather than pointing off the
// surface.

import { V1_COPY } from './copy.js';

// ---------------------------------------------------------------------------
// SHARED-MODULE DEPLOY BASE, in one place.
//
// The v1 callsign page resolves in the browser by dynamically importing a
// handful of pure data modules that are shared with the legacy tree. So the v1
// surface stays self-contained, those modules are deployed at the site ROOT
// beside the v1 pages (see src/ci/build-v1-shared-modules.ts), the same base the
// v1 pages sit at. This constant is that base ('' = the page's own directory);
// the tests override it to point at a fixture tree.
export const SHARED_MODULE_BASE = '';

// ---------------------------------------------------------------------------
// DOM helpers (the page-module idiom: textContent everywhere; never innerHTML).

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

// The journeys the v1 surface offers, in order — every one a page v1 serves at
// the root. Unmigrated destinations are deliberately absent.
/**
 * @typedef {object} JourneyDef
 * @property {string} id
 * @property {string} label
 * @property {string} href
 */

/** @returns {JourneyDef[]} */
function journeys() {
  const j = V1_COPY.journeys;
  return [
    { id: 'home', label: j.home, href: 'index.html' },
    { id: 'lookup', label: j.lookup, href: 'callsign.html' },
    { id: 'raw', label: j.raw, href: 'how-to-get-the-raw-data.html' },
    { id: 'glossary', label: j.glossary, href: 'glossary.html' },
    { id: 'anatomy', label: j.anatomy, href: 'anatomy.html' },
  ];
}

// ---------------------------------------------------------------------------
// renderSiteBar — the white full-width header bar.

/**
 * The dated-fact chip text, from the build-stamped facts. Never the word
 * "current": it states, as a fact, the newest publication held and the count.
 * @param {{ date: string, count: number | string }} facts
 * @returns {{ text: string, title: string }}
 */
export function datedFactChip(facts) {
  /** @param {string} s */
  const fill = (s) => s.replaceAll('{date}', facts.date).replaceAll('{count}', String(facts.count));
  return { text: fill(V1_COPY.chip.template), title: fill(V1_COPY.chip.title) };
}

/**
 * The chip's parts, split STRUCTURALLY on the {count} placeholder in the
 * template — never on the rendered count value. The rendered count can also
 * occur inside the date (e.g. "23 June 2026" with 23 publications held), so
 * splitting the finished string on the count would break the chip; splitting
 * the template on the placeholder before the date is substituted cannot.
 * @param {{ date: string, count: number | string }} facts
 * @returns {{ before: string, count: string, after: string, title: string }}
 */
export function datedFactChipParts(facts) {
  const [rawBefore, rawAfter = ''] = V1_COPY.chip.template.split('{count}');
  /** @param {string} s */
  const fillDate = (s) => s.replaceAll('{date}', facts.date);
  return { before: fillDate(rawBefore), count: String(facts.count), after: fillDate(rawAfter), title: datedFactChip(facts).title };
}

/**
 * Build the header bar. `currentJourney` is the id of the active journey (or ''
 * / unknown for pages outside the nav, e.g. the raw-data guide when it is not
 * the current journey). `facts` fills the dated-fact chip; when omitted the
 * chip is left out (a page with no build stamp still renders a valid bar).
 * @param {string} currentJourney
 * @param {{ date: string, count: number | string } | null} [facts]
 * @returns {HTMLElement}
 */
export function renderSiteBar(currentJourney, facts = null) {
  const bar = el('header', 'sitebar');
  bar.setAttribute('role', 'banner');
  const wrap = el('div', 'wrap');

  // Identity strip.
  const top = el('div', 'topbar');
  top.appendChild(el('span', 'id', V1_COPY.brand.id));
  top.appendChild(el('span', null, V1_COPY.brand.tagline));
  if (facts !== null) {
    const parts = datedFactChipParts(facts);
    // A stated fact, not a link: the data-status surface it once pointed at is
    // not part of the v1 surface, so the chip carries the fact in a tooltip
    // rather than leading off the surface.
    const chip = el('span', 'chip asof');
    chip.setAttribute('title', parts.title);
    chip.append(parts.before);
    chip.appendChild(el('b', null, parts.count));
    if (parts.after !== '') chip.append(parts.after);
    top.appendChild(chip);
  }
  wrap.appendChild(top);

  // Journey nav (only the migrated journeys).
  const nav = el('nav', 'journeys');
  nav.setAttribute('aria-label', 'Journeys');
  const list = journeys();
  list.forEach((jr, i) => {
    if (i > 0) nav.appendChild(el('span', 'sep', '·'));
    const a = el('a', null, jr.label);
    a.setAttribute('href', jr.href);
    if (jr.id === currentJourney) a.setAttribute('aria-current', 'page');
    nav.appendChild(a);
  });
  wrap.appendChild(nav);

  bar.appendChild(wrap);
  return bar;
}

// ---------------------------------------------------------------------------
// renderBreadcrumb — the depth trail.

/**
 * @param {{ label: string, href?: string }[]} crumbs  last entry is the current page
 * @returns {HTMLElement}
 */
export function renderBreadcrumb(crumbs) {
  const nav = el('nav', 'crumbs');
  nav.setAttribute('aria-label', 'Breadcrumb');
  crumbs.forEach((crumb, i) => {
    if (i > 0) nav.appendChild(el('span', 'arw', '→'));
    const last = i === crumbs.length - 1;
    if (crumb.href !== undefined && !last) {
      const a = el('a', null, crumb.label);
      a.setAttribute('href', crumb.href);
      nav.appendChild(a);
    } else {
      nav.appendChild(el('b', null, crumb.label));
    }
  });
  return nav;
}

// ---------------------------------------------------------------------------
// renderFooter — the white full-width footer bar.

/** @returns {HTMLElement} */
export function renderFooter() {
  const foot = el('footer', 'sitefoot');
  foot.setAttribute('role', 'contentinfo');
  const wrap = el('div', 'wrap');
  const prov = el('p', 'foot-prov');
  prov.append(`${V1_COPY.brand.id} · ${V1_COPY.brand.tagline}`);
  prov.appendChild(el('br'));
  prov.append(`${V1_COPY.footer.provenance} · ${V1_COPY.footer.notAffiliated}`);
  wrap.appendChild(prov);
  foot.appendChild(wrap);
  return foot;
}

// ---------------------------------------------------------------------------
// Mount helper: replace a placeholder element (by id) with a rendered node.
// Progressive enhancement — the static HTML carries a minimal fallback the
// script upgrades.

/**
 * @param {string} id
 * @param {HTMLElement} node
 */
export function mountInto(id, node) {
  const host = document.getElementById(id);
  if (host === null) return;
  host.replaceChildren(node);
}
