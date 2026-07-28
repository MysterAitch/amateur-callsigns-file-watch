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
import { RECORD_FACTS } from './record-facts.js';
import { safeHref } from './safe-url.js';
import * as chip from './chip.js';

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
    { id: 'onThisDay', label: j.onThisDay, href: 'on-this-day.html' },
    { id: 'timeline', label: j.timeline, href: 'timeline.html' },
    { id: 'raw', label: j.raw, href: 'how-to-get-the-raw-data.html' },
    { id: 'glossary', label: j.glossary, href: 'glossary.html' },
    { id: 'anatomy', label: j.anatomy, href: 'anatomy.html' },
  ];
}

// ---------------------------------------------------------------------------
// renderSiteBar — the white full-width header bar. The dated-fact chip itself
// is the shared component (site/v1/chip.js, ADR 0022): the same renderStatic
// the build stamp serialises into the static baselines renders it here.

/**
 * Build the header bar. `currentJourney` is the id of the active journey (or ''
 * / unknown for pages outside the nav, e.g. the raw-data guide when it is not
 * the current journey). `facts` fills the dated-fact chip and defaults to the
 * single build-injected source (record-facts.js, issues #965/#966), so no page
 * re-authors the value; pass `null` to omit the chip entirely.
 * @param {string} currentJourney
 * @param {{ date: string, count: number | string } | null} [facts]
 * @returns {HTMLElement}
 */
export function renderSiteBar(currentJourney, facts = RECORD_FACTS) {
  const bar = el('header', 'sitebar');
  bar.setAttribute('role', 'banner');
  const wrap = el('div', 'wrap');

  // Identity strip.
  const top = el('div', 'topbar');
  top.appendChild(el('span', 'id', V1_COPY.brand.id));
  top.appendChild(el('span', null, V1_COPY.brand.tagline));
  if (facts !== null) {
    top.appendChild(chip.renderStatic(facts));
  }
  wrap.appendChild(top);

  // Journey nav (only the migrated journeys).
  const nav = el('nav', 'journeys');
  nav.setAttribute('aria-label', 'Journeys');
  const list = journeys();
  list.forEach((jr, i) => {
    if (i > 0) nav.appendChild(el('span', 'sep', '·'));
    const a = el('a', null, jr.label);
    a.setAttribute('href', safeHref(jr.href));
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
      a.setAttribute('href', safeHref(crumb.href));
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
