// @ts-check
// ROOT RETIREMENT WORKER. Its only job is to remove a service worker that can
// no longer be updated any other way.
//
// Until 2026-07-22 the whole site was served from the root with a caching
// service worker registered at the root scope. That site then moved into a
// subdirectory (where it registers its own worker, at that narrower scope)
// and the root worker's script stopped being served. A browser checks for a new worker by fetching the
// script, and a 404 leaves the installed one in place indefinitely. So every
// browser that had visited before the move kept the old worker, which answers
// requests for scripts and styles from the copy it cached that day - including
// the names the root pages reuse now. Observed 2026-11-25: root scope still
// controlled, shell cache dated 22 July 2026, today's pages running July's
// scripts.
//
// Serving this file at the root gives those browsers something to update to.
// It takes over at once, unregisters the root registration, and reloads the
// open pages so they are fetched with no worker in the way.
//
// It deliberately does two things only:
//  - It registers no fetch handler, so it can never serve anything itself.
//  - It deletes no caches. Cache storage is shared with the moved site's own
//    worker, and that includes a visitor's opted-in offline database copy.
//    The old shell cache is small, and that worker clears foreign caches
//    when it activates.
//
// Nothing served at the root may register this file: it would install,
// unregister, reload and register again without end (pinned by
// src/ci/root-worker-registration.test.ts). It must stay served
// for as long as a browser might still hold the old worker - removing it puts
// those browsers back where they were.

const sw = /** @type {ServiceWorkerGlobalScope} */ (/** @type {unknown} */ (self));

sw.addEventListener('install', (event) => {
  event.waitUntil(sw.skipWaiting());
});

sw.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    await sw.registration.unregister();
    const windows = await sw.clients.matchAll({ type: 'window' });
    // A page that refuses to reload is simply left for its next navigation,
    // which the unregistered worker no longer controls.
    await Promise.all(windows.map((client) => client.navigate(client.url).catch(() => null)));
  })());
});
