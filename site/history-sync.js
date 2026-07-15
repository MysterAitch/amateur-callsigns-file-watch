// @ts-check
// Thin History-API wiring shared by the data browser (entry-browser.js) and
// the cross-publication comparison surface (compare.js), issue #214. The pure
// state<->URL mapping and the push/replace decision live in browser-query.js;
// this module owns only the window.history side effects, kept deliberately
// small because the History API is awkward to exercise without a real DOM.
//
// Two cadences, so back/forward step between meaningful filter states without
// history filling with duplicates:
//   - The URL mirror is INSTANT: every discrete change writes the URL straight
//     away, so a copy/share always grabs the live view.
//   - The pushState is DEBOUNCED (leading edge): the first change of a burst
//     pushes a new entry - preserving the previous state for Back - and rapid
//     follow-ups within the window replaceState into that same entry, so a
//     burst of actions collapses to ONE history step.
//
// Feedback-loop guard: restoring from popstate re-runs the front-end's render,
// which calls sync() again; while restoring, sync() is a no-op so a restore
// never itself pushes or replaces.

import { historySyncAction } from './browser-query.js';

/**
 * @param {object} options
 * @param {() => string} options.getUrl - the URL the current filter state maps to
 * @param {() => void} options.onPopState - re-applies the URL to state and re-renders
 * @param {number} [options.debounceMs] - burst window collapsing rapid changes to one history step
 * @returns {{ sync: () => void }}
 */
export function createHistorySync({ getUrl, onPopState, debounceMs = 400 }) {
  /** @type {ReturnType<typeof setTimeout> | null} */
  let burstTimer = null;
  let restoring = false;

  function sync() {
    if (restoring) return;
    const next = getUrl();
    const action = historySyncAction(window.location.href, next, burstTimer !== null);
    if (action === 'none') return;
    if (action === 'push') window.history.pushState(null, '', next);
    else window.history.replaceState(null, '', next);
    if (burstTimer !== null) clearTimeout(burstTimer);
    burstTimer = setTimeout(() => { burstTimer = null; }, debounceMs);
  }

  window.addEventListener('popstate', () => {
    restoring = true;
    // A pending burst belongs to the state we just navigated away from; drop it
    // so it can't push after the restore.
    if (burstTimer !== null) { clearTimeout(burstTimer); burstTimer = null; }
    // onPopState re-reads the URL, applies it to state and re-renders; its
    // synchronous head calls sync() (a no-op while restoring is true).
    try { onPopState(); } finally { restoring = false; }
  });

  return { sync };
}
