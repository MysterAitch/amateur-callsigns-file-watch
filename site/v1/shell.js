// @ts-check
// v1 SITE SHELL (issue #921): the three chrome renderers shared by every v1
// page — the white header bar (brand + dated-fact chip + five-journey nav),
// the breadcrumb, and the white footer bar. Dependency-free of any third party;
// all wording comes from the copy registry (site/v1/copy.js), and the DOM is
// built with the same el()/elAttrs() idiom as site/callsign.js.

import { V1_COPY } from './copy.js';

// ---------------------------------------------------------------------------
// THE DEPLOY-LAYOUT ASSUMPTION, in one place.
//
// v1 is the deploy root; the previous, fuller-featured site is preserved one
// directory down, under /v0/. Every reference from a v1 root page to a v0
// surface (its pages, and — for the callsign page — its prefix-sharded data)
// is built relative to this base. Change this one constant if the two ever move
// relative to each other. Tests override it to a fixture tree.
export const V0_BASE = 'v0/';

/** A path into the preserved previous version. @param {string} rel */
export function v0Href(rel) {
  return `${V0_BASE}${rel}`;
}

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

// The five journeys, in launch order. `current` journeys are v1 pages; the rest
// route into the preserved previous version and wear an honest label so a
// reader is never misled into thinking a v0 surface is part of the new shell.
/**
 * @typedef {object} JourneyDef
 * @property {string} id
 * @property {string} label
 * @property {string} href
 * @property {boolean} previous  true when the target is a /v0/ surface
 */

/** @returns {JourneyDef[]} */
function journeys() {
  const j = V1_COPY.journeys;
  return [
    { id: 'home', label: j.home, href: 'index.html', previous: false },
    { id: 'lookup', label: j.lookup, href: 'callsign.html', previous: false },
    { id: 'history', label: j.history, href: v0Href('on-this-day.html'), previous: true },
    { id: 'browse', label: j.browse, href: v0Href('explore.html'), previous: true },
    { id: 'how', label: j.how, href: v0Href('about.html'), previous: true },
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
 * Build the header bar. `currentJourney` is the id of the active journey (or ''
 * / unknown for pages outside the five, e.g. the raw-data guide). `facts` fills
 * the dated-fact chip; when omitted the chip is left out (a page with no build
 * stamp still renders a valid bar).
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
    const chip = datedFactChip(facts);
    const a = el('a', 'chip asof');
    a.setAttribute('href', `${v0Href('data-status.html')}`);
    a.setAttribute('title', chip.title);
    // The count is bolded inside the otherwise-plain chip text.
    const [before, after] = chip.text.split(String(facts.count));
    a.append(before);
    a.appendChild(el('b', null, String(facts.count)));
    if (after !== undefined) a.append(after);
    top.appendChild(a);
  }
  wrap.appendChild(top);

  // Five-journey nav.
  const nav = el('nav', 'journeys');
  nav.setAttribute('aria-label', 'Journeys');
  const list = journeys();
  list.forEach((jr, i) => {
    if (i > 0) nav.appendChild(el('span', 'sep', '·'));
    const a = el('a', null, jr.label);
    a.setAttribute('href', jr.href);
    if (jr.id === currentJourney) a.setAttribute('aria-current', 'page');
    if (jr.previous) {
      a.append(' ');
      const mark = el('span', 'v0mark', `(${V1_COPY.journeys.v0Mark})`);
      a.appendChild(mark);
    }
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
  prov.append(`${V1_COPY.footer.provenance} · ${V1_COPY.footer.notAffiliated} · `);
  const a = el('a', null, V1_COPY.footer.v0Link);
  a.setAttribute('href', v0Href('index.html'));
  prov.appendChild(a);
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
