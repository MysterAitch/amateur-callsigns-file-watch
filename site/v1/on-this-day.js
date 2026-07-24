// @ts-check
// v1 ON-THIS-DAY PAGE BOOTSTRAP (issue #932): renders the shared chrome, then
// fetches the root-served on-this-day manifest (on-this-day.json, root-served so
// the v1 surface stays self-contained) and renders the event-time calendar with
// the viewer's "today" signpost. With JavaScript off, the page's static framing
// and reading notes stand as the complete baseline — the dated calendar is a
// build-derived projection that renders with the script, never hand-authored.

import { renderSiteBar, renderBreadcrumb, renderFooter, mountInto } from './shell.js';
import { V1_COPY } from './copy.js';
import { renderOnThisDay, enhanceToday, parseOnThisDay } from './on-this-day-sections.js';
import { calmNote } from './history-common.js';

/** @param {HTMLElement} root */
async function loadCalendar(root) {
  try {
    const res = await fetch(new URL('on-this-day.json', document.baseURI).toString());
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const parsed = /** @type {unknown} */ (JSON.parse(await res.text()));
    const data = parseOnThisDay(parsed);
    if (data === null) throw new Error('the on-this-day manifest is the wrong shape');
    renderOnThisDay(root, data);
    enhanceToday(document, data);
  } catch {
    // The static framing/reading notes stand; add one calm line, never a dead control.
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
  const root = document.getElementById('sections');
  if (root !== null) void loadCalendar(/** @type {HTMLElement} */ (root));
}
