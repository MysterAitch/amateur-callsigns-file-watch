// @ts-check
// v1 HOME PAGE BOOTSTRAP (issue #921): renders the shared chrome and the
// config-array home sections. Progressive enhancement over the static baseline
// in index.html — with JavaScript off, the page's own static markup (including
// the dated-fact chip) still reads; with it on, the shell and sections re-mount
// from the copy registry and the (build-stampable) home model.

import { renderSiteBar, renderBreadcrumb, renderFooter, mountInto } from './shell.js';
import { V1_COPY } from './copy.js';
import { renderHomeSections, defaultHomeModel } from './home-sections.js';

if (typeof document !== 'undefined' && document.querySelector('main[data-page="home"]') !== null) {
  const model = defaultHomeModel();
  mountInto('sitebar', renderSiteBar('home', model.facts));
  mountInto('breadcrumb', renderBreadcrumb([{ label: V1_COPY.journeys.home }]));
  mountInto('sitefooter', renderFooter());
  const root = document.getElementById('sections');
  if (root !== null) {
    root.textContent = '';
    renderHomeSections(/** @type {HTMLElement} */ (root), model);
  }
}
