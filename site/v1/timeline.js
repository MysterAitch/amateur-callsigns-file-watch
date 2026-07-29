// @ts-check
// v1 TIMELINE PAGE BOOTSTRAP (issues #932, #965): renders the shared chrome,
// then enhances the event-time timeline the page was SERVED with.
//
// The histograms, the cumulative table and the readout for the record's own
// "as at" year are stamped into the page's static HTML at build time
// (src/ci/build-v1-history-static.ts), together with the compact per-year
// figures the scrubber needs. So the page is complete with no script, and the
// scrubber runs off data embedded in that same HTML rather than a second
// request — which also means an archived copy of this page still scrubs.
//
// The manifest fetch below is the FALLBACK for a page served without that stamp
// (a source tree served directly). It renders through the same renderStatic the
// build uses, so the two paths cannot produce different content.

import { renderSiteBar, renderBreadcrumb, renderFooter, mountInto } from './shell.js';
import { V1_COPY } from './copy.js';
import * as timeline from './timeline-sections.js';
import { calmNote } from './history-common.js';
import { registerComponent, enhanceWithin } from './enhance-walk.js';

registerComponent(timeline.COMPONENT, timeline);

/**
 * Render the timeline only where the served page did not already carry it.
 * @param {HTMLElement} root
 * @returns {Promise<void>}
 */
async function ensureTimeline(root) {
  if (root.querySelector('[data-component]') !== null) return;
  try {
    const res = await fetch(new URL('timeline.json', document.baseURI).toString());
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const parsed = /** @type {unknown} */ (JSON.parse(await res.text()));
    const data = timeline.parseTimeline(parsed);
    if (data === null) throw new Error('the timeline manifest is the wrong shape');
    timeline.renderTimeline(root, data);
  } catch {
    // The static framing stands; add one calm line, never a dead control.
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
  // The stamp owns #history-host and nothing else on the page, so the fallback
  // render replaces only what the stamp would have written — the cross-links
  // and framing around it survive either way.
  const root = document.getElementById('history-host');
  if (root !== null) {
    void ensureTimeline(root).then(() => { enhanceWithin(root); });
  }
}
