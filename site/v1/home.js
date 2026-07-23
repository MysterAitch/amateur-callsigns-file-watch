// @ts-check
// v1 HOME PAGE BOOTSTRAP (issue #921): renders the shared chrome and the
// config-array home sections. Progressive enhancement over the static baseline
// in index.html — with JavaScript off, the page's own static markup (including
// the dated-fact chip) still reads; with it on, the shell and sections re-mount
// from the copy registry and the (build-stampable) home model.
//
// A second layer of enhancement fetches the build-derived holdings manifest
// (holdings.json, root-served so the v1 surface stays self-contained) and
// re-mounts "the record at a glance" with the real per-publication marks and
// the cited register-history milestones. On any failure the grounded baseline
// simply stands — the marks are additive, never load-bearing.

import { renderSiteBar, renderBreadcrumb, renderFooter, mountInto } from './shell.js';
import { V1_COPY } from './copy.js';
import { renderHomeSections, defaultHomeModel, enhanceHomeModel, HOME_SECTION_REGISTRY } from './home-sections.js';

/** @param {HTMLElement} root */
async function enhanceAtAGlance(root) {
  try {
    const res = await fetch(new URL('holdings.json', document.baseURI).toString());
    if (!res.ok) return;
    const text = await res.text();
    const parsed = /** @type {unknown} */ (JSON.parse(text));
    const holdings = /** @type {import('./home-sections.js').HomeHoldings} */ (parsed);
    const enhanced = enhanceHomeModel(defaultHomeModel(), holdings);
    const section = root.querySelector('section[data-section="at-a-glance"]');
    if (section === null) return;
    section.textContent = '';
    HOME_SECTION_REGISTRY['at-a-glance'].mount(/** @type {HTMLElement} */ (section), enhanced);
  } catch {
    // The grounded no-JS baseline stands; the marks are a bonus, not load-bearing.
  }
}

if (typeof document !== 'undefined' && document.querySelector('main[data-page="home"]') !== null) {
  const model = defaultHomeModel();
  mountInto('sitebar', renderSiteBar('home', model.facts));
  mountInto('breadcrumb', renderBreadcrumb([{ label: V1_COPY.journeys.home }]));
  mountInto('sitefooter', renderFooter());
  const root = document.getElementById('sections');
  if (root !== null) {
    root.textContent = '';
    renderHomeSections(/** @type {HTMLElement} */ (root), model);
    void enhanceAtAGlance(/** @type {HTMLElement} */ (root));
  }
}
