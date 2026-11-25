// @ts-check
// v1 HOME PAGE BOOTSTRAP (issue #921): renders the shared chrome and the
// config-array home sections. Progressive enhancement over the static baseline
// in index.html — with JavaScript off, the page's own static markup (including
// the dated-fact chip) still reads; with it on, the shell and sections re-mount
// from the copy registry and the (build-stampable) home model.
//
// A second layer of enhancement fetches the build-derived holdings manifest
// (holdings.json, root-served so the v1 surface stays self-contained) and
// re-mounts the sections whose content it changes: "the record at a glance",
// with the real per-publication marks and the cited register-history
// milestones, and "from the record", whose leading fact names the newest
// register. Until then, and for good if the manifest cannot be read, those two
// sections stay as the deploy stamped them from the same manifest
// (renderHomeOverBaseline), so a failed fetch never shows hand-written figures.

import { renderSiteBar, renderBreadcrumb, renderFooter, mountInto } from './shell.js';
import { V1_COPY } from './copy.js';
import { renderHomeOverBaseline, defaultHomeModel, enhanceHomeModel, parseHoldings, remountManifestSections } from './home-sections.js';

/** @param {HTMLElement} root */
async function enhanceFromHoldings(root) {
  try {
    const res = await fetch(new URL('holdings.json', document.baseURI).toString());
    if (!res.ok) return;
    const text = await res.text();
    const parsed = /** @type {unknown} */ (JSON.parse(text));
    // Validate the untrusted manifest shape before use; a wrong-shaped manifest
    // leaves the page as served rather than mis-rendering.
    const holdings = parseHoldings(parsed);
    if (holdings === null) return;
    remountManifestSections(root, enhanceHomeModel(defaultHomeModel(), holdings));
  } catch {
    // The stamped sections stand; the marks are a bonus, not load-bearing.
  }
}

if (typeof document !== 'undefined' && document.querySelector('main[data-page="home"]') !== null) {
  const model = defaultHomeModel();
  mountInto('sitebar', renderSiteBar('home'));
  mountInto('breadcrumb', renderBreadcrumb([{ label: V1_COPY.journeys.home }]));
  mountInto('sitefooter', renderFooter());
  const root = document.getElementById('sections');
  if (root !== null) {
    renderHomeOverBaseline(/** @type {HTMLElement} */ (root), model);
    void enhanceFromHoldings(/** @type {HTMLElement} */ (root));
  }
}
