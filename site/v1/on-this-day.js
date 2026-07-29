// @ts-check
// v1 ON-THIS-DAY PAGE BOOTSTRAP (issues #932, #965): renders the shared chrome,
// then enhances the event-time calendar the page was SERVED with.
//
// The calendar is stamped into the page's static HTML at build time
// (src/ci/build-v1-history-static.ts), so it is real, readable content with no
// script at all — the state a crawler indexes and a web archive preserves. The
// script's job here is only what the build cannot know: the reader's own
// calendar day.
//
// The manifest fetch below is the FALLBACK for a page served without that stamp
// (a source tree served directly). It renders through the same renderStatic the
// build uses, so the two paths cannot produce different content — and on the
// deployed page it never runs, so the calendar costs no second request.

import { renderSiteBar, renderBreadcrumb, renderFooter, mountInto } from './shell.js';
import { V1_COPY } from './copy.js';
import * as onThisDay from './on-this-day-sections.js';
import { calmNote } from './history-common.js';
import { registerComponent, enhanceWithin } from './enhance-walk.js';

registerComponent(onThisDay.COMPONENT, onThisDay);

/**
 * Render the calendar only where the served page did not already carry it.
 * @param {HTMLElement} root
 * @returns {Promise<void>}
 */
async function ensureCalendar(root) {
  if (root.querySelector('[data-component]') !== null) return;
  try {
    const res = await fetch(new URL('on-this-day.json', document.baseURI).toString());
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const parsed = /** @type {unknown} */ (JSON.parse(await res.text()));
    const data = onThisDay.parseOnThisDay(parsed);
    if (data === null) throw new Error('the on-this-day manifest is the wrong shape');
    onThisDay.renderOnThisDay(root, data);
  } catch {
    // The static framing stands; add one calm line, never a dead control.
    root.appendChild(calmNote(V1_COPY.history.onThisDay.loadError));
  }
}

if (typeof document !== 'undefined' && document.querySelector('main[data-page="on-this-day"]') !== null) {
  mountInto('sitebar', renderSiteBar('onThisDay'));
  mountInto('breadcrumb', renderBreadcrumb([
    { label: V1_COPY.journeys.home, href: 'index.html' },
    { label: V1_COPY.journeys.onThisDay },
  ]));
  mountInto('sitefooter', renderFooter());
  // The stamp owns #history-host and nothing else on the page, so the fallback
  // render replaces only what the stamp would have written — the cross-links
  // and framing around it survive either way.
  const root = document.getElementById('history-host');
  if (root !== null) {
    void ensureCalendar(root).then(() => { enhanceWithin(root); });
  }
}
