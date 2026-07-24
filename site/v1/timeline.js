// @ts-check
// v1 TIMELINE PAGE BOOTSTRAP (issue #932): renders the shared chrome, then
// fetches the root-served timeline manifest (timeline.json, root-served so the
// v1 surface stays self-contained) and renders the event-time histograms, the
// cumulative table and the scrubber. With JavaScript off, the page's static
// framing and reading notes stand as the complete baseline — the per-year
// figures are a build-derived projection that renders with the script.

import { renderSiteBar, renderBreadcrumb, renderFooter, mountInto } from './shell.js';
import { V1_COPY } from './copy.js';
import { renderTimeline, parseTimeline } from './timeline-sections.js';
import { calmNote } from './history-common.js';

/** @param {HTMLElement} root */
async function loadTimeline(root) {
  try {
    const res = await fetch(new URL('timeline.json', document.baseURI).toString());
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const parsed = /** @type {unknown} */ (JSON.parse(await res.text()));
    const data = parseTimeline(parsed);
    if (data === null) throw new Error('the timeline manifest is the wrong shape');
    renderTimeline(root, data);
  } catch {
    // The static framing/reading notes stand; add one calm line, never a dead control.
    root.appendChild(calmNote(V1_COPY.history.timeline.loadError));
  }
}

if (typeof document !== 'undefined' && document.querySelector('main[data-page="timeline"]') !== null) {
  mountInto('sitebar', renderSiteBar('timeline'));
  mountInto('breadcrumb', renderBreadcrumb([
    { label: V1_COPY.journeys.home, href: 'index.html' },
    { label: V1_COPY.journeys.timeline },
  ]));
  mountInto('sitefooter', renderFooter());
  const root = document.getElementById('sections');
  if (root !== null) void loadTimeline(/** @type {HTMLElement} */ (root));
}
