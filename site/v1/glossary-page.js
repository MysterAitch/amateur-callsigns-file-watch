// @ts-check
// v1 GLOSSARY PAGE BOOTSTRAP (issue #930): renders the shared chrome and the
// config-array glossary sections. Progressive enhancement over the static
// baseline in glossary.html — with JavaScript off, the page's own static markup
// (the full definition list) still reads; with it on, the shell and sections
// re-mount from the single V1_COPY.glossary registry the inline popovers also
// open, so the page and the popovers can never drift.

import { renderSiteBar, renderBreadcrumb, renderFooter, mountInto } from './shell.js';
import { V1_COPY } from './copy.js';
import { renderGlossarySections } from './glossary-sections.js';

if (typeof document !== 'undefined' && document.querySelector('main[data-page="glossary"]') !== null) {
  mountInto('sitebar', renderSiteBar('glossary'));
  mountInto('breadcrumb', renderBreadcrumb([
    { label: V1_COPY.journeys.home, href: 'index.html' },
    { label: V1_COPY.journeys.glossary },
  ]));
  mountInto('sitefooter', renderFooter());
  const root = document.getElementById('sections');
  if (root !== null) {
    root.textContent = '';
    renderGlossarySections(/** @type {HTMLElement} */ (root));
  }
}
