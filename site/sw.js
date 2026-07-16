// @ts-check
// This file runs in the service-worker global scope, not the DOM the rest of
// site/ shares, so it is checked as its own tsconfig.site-worker.json project
// (see that file for why it cannot share a program with the DOM-scoped one) -
// which is what supplies the worker globals (self, caches, fetch, Response, ...).

// Service worker for the callsign data mirror (ADR 0008).
//
// Two responsibilities, deliberately separate:
//
//  1. Precache the STATIC SHELL (page HTML, app scripts, styles and the
//     vendored sql.js-httpvfs library) so the site loads instantly on repeat
//     visits and stays usable offline. The shell cache is named by the deploy
//     commit, so a new deploy supersedes it - mirroring the app's `?v=<sha>`
//     database cache-busting. The DEPLOY_VERSION literal below is rewritten to
//     the commit SHA by the Pages workflow, which also makes THIS FILE change
//     bytes each deploy so the browser re-installs the worker and the activate
//     handler can drop the old caches. Never leave a site un-updatable.
//
//  2. Serve the full database from cache ONLY when the visitor has explicitly
//     downloaded it for offline use (the lookup page's opt-in control). By
//     default the worker does not touch the database at all: the range-request
//     lookup goes straight to the network, keeping first load light. When the
//     visitor has opted in, sql.js-httpvfs's Range requests are satisfied from
//     the cached whole-file response by slicing it into 206 Partial Content
//     responses here - the honest cost is holding the file in memory once read.

// Rewritten to the commit SHA at deploy time by cicd.yaml (the literal is
// matched exactly there); 'dev' is the local, unstamped value.
const DEPLOY_VERSION = 'dev';

const SHELL_CACHE = `callsign-shell-${DEPLOY_VERSION}`;
// The offline database cache is NOT named by version: it is pruned per-entry
// on activate (any entry whose `?v=` no longer matches this deploy is dropped),
// so a superseded download is discarded but the cache object itself is stable.
const OFFLINE_DB_CACHE = 'callsign-offline-db';

// The static shell, relative to the worker's scope (the site root). './'
// captures the directory (root navigation); the rest are the hand-authored
// pages, their scripts, the shared stylesheet and the vendored library.
const SHELL_ASSETS = [
  './',
  'index.html',
  'statistics.html',
  'explore.html',
  'compare.html',
  'about.html',
  'glossary.html',
  'ledger.html',
  'callsign.html',
  'playground.html',
  'data-status.html',
  'callsign-structure.html',
  'invisible-characters.html',
  'debug.js',
  'app.js',
  'callsign-pill.js',
  'datetime.js',
  'browser-query.js',
  'entry-browser.js',
  'explore.js',
  'compare.js',
  'ledger.js',
  'ledger-query.js',
  'callsign.js',
  'playground.js',
  'db-loading.js',
  'history-sync.js',
  'prefix-country.js',
  'style.css',
  'ledger.css',
  'tokens.css',
  'manifest.webmanifest',
  'vendor/index.js',
  'vendor/sqlite.worker.js',
  'vendor/sql-wasm.wasm',
];

// `self` is typed generically (WorkerGlobalScope) by the webworker lib; a
// service worker's actual global scope is the more specific
// ServiceWorkerGlobalScope (skipWaiting, clients, and the
// install/activate/fetch/message event map), so it is read through a
// narrowed view here, once - the same "typed view of an untyped/under-typed
// global" idiom the DOM-side modules use at their own boundaries.
const sw = /** @type {ServiceWorkerGlobalScope} */ (/** @type {unknown} */ (self));

const scopeUrl = new URL('./', sw.location.href);
const SHELL_URLS = new Set(SHELL_ASSETS.map(asset => new URL(asset, scopeUrl).href));

// Hrefs whose Range requests the worker may satisfy from the offline cache -
// populated on activate from what is cached, and updated by messages from the
// page when the visitor downloads or removes an offline copy. Empty means the
// worker never intercepts the database (default-online).
const offlineDbUrls = new Set();
// In-memory whole-file buffers, filled lazily on first Range request so the
// per-request slice does not re-read the Cache API each time.
const dbBuffers = new Map();

/** @param {string} pathname */
function isDbPath(pathname) {
  // The ledger-derived projection databases the surfaces query (issue #572).
  // The legacy callsigns/combined runtime databases were retired (issue #445),
  // so they are no longer served or intercepted.
  return /\/data\/(ledger-lookup|ledger-history)\.sqlite\.png$/.test(pathname);
}

/** @param {URL} url */
function isShellRequest(url) {
  return SHELL_URLS.has(url.origin + url.pathname);
}

sw.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // Resilient precache: fetch each asset fresh (bypassing the HTTP cache) and
    // store the ones that succeed. A single stray 404 must not brick install
    // and leave the site with no worker at all.
    await Promise.all(SHELL_ASSETS.map(async (asset) => {
      try {
        const res = await fetch(new URL(asset, scopeUrl).href, { cache: 'reload' });
        if (res.ok) await cache.put(asset === './' ? scopeUrl.href : new URL(asset, scopeUrl).href, res.clone());
      } catch { /* asset unavailable at install time - skip it */ }
    }));
    await sw.skipWaiting();
  })());
});

// Rebuild the opted-in set from the offline cache, dropping entries that no
// longer match this deploy's version stamp (a superseded database download).
async function refreshOfflineDbState() {
  offlineDbUrls.clear();
  dbBuffers.clear();
  const cache = await caches.open(OFFLINE_DB_CACHE);
  const keys = await cache.keys();
  await Promise.all(keys.map(async (req) => {
    const v = new URL(req.url).searchParams.get('v');
    if (v !== DEPLOY_VERSION) {
      await cache.delete(req);
    } else {
      offlineDbUrls.add(req.url);
    }
  }));
}

sw.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.map((name) =>
      (name === SHELL_CACHE || name === OFFLINE_DB_CACHE) ? undefined : caches.delete(name)));
    await refreshOfflineDbState();
    await sw.clients.claim();
  })());
});

sw.addEventListener('message', (event) => {
  // event.data is `any` (its shape is whatever the page posted); narrowed here
  // to the two message shapes this worker actually handles.
  const data = /** @type {{ type?: string, url?: string }} */ (event.data || {});
  if (data.type === 'offline-db-added' && typeof data.url === 'string') {
    offlineDbUrls.add(data.url);
    dbBuffers.delete(data.url);
  } else if (data.type === 'offline-db-removed' && typeof data.url === 'string') {
    offlineDbUrls.delete(data.url);
    dbBuffers.delete(data.url);
  }
});

/** @param {string} href */
async function getFullDbBuffer(href) {
  if (dbBuffers.has(href)) return dbBuffers.get(href);
  const cache = await caches.open(OFFLINE_DB_CACHE);
  const res = await cache.match(href);
  if (!res) return null;
  const buffer = await res.arrayBuffer();
  dbBuffers.set(href, buffer);
  return buffer;
}

/** @param {Record<string, string>} extra */
function dbResponseHeaders(extra) {
  return new Headers(Object.assign({
    'Content-Type': 'image/png',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
  }, extra));
}

// Satisfy sql.js-httpvfs's Range requests from the cached whole file. httpvfs
// learns the file size from the `Content-Range` total, so that header must be
// correct or every read is misaligned.
/**
 * @param {Request} request
 * @param {string} href
 * @returns {Promise<Response>}
 */
async function serveDbFromCache(request, href) {
  const buffer = await getFullDbBuffer(href);
  if (!buffer) return fetch(request); // cache lost between the check and now
  const total = buffer.byteLength;
  const range = request.headers.get('range');
  if (!range) {
    return new Response(buffer.slice(0), {
      status: 200,
      headers: dbResponseHeaders({ 'Content-Length': String(total) }),
    });
  }
  const match = /bytes=(\d*)-(\d*)/.exec(range);
  let start = match && match[1] !== '' ? parseInt(match[1], 10) : 0;
  let end = match && match[2] !== '' ? parseInt(match[2], 10) : total - 1;
  if (!Number.isFinite(start) || start < 0) start = 0;
  if (!Number.isFinite(end) || end > total - 1) end = total - 1;
  if (start > end || start >= total) {
    return new Response(null, { status: 416, headers: dbResponseHeaders({ 'Content-Range': `bytes */${total}` }) });
  }
  const slice = buffer.slice(start, end + 1);
  return new Response(slice, {
    status: 206,
    statusText: 'Partial Content',
    headers: dbResponseHeaders({
      'Content-Range': `bytes ${start}-${end}/${total}`,
      'Content-Length': String(slice.byteLength),
    }),
  });
}

/**
 * @param {Request} request
 * @returns {Promise<Response>}
 */
async function cacheFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  const hit = await cache.match(request, { ignoreSearch: true });
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

// Navigations prefer the network (so a live visitor gets the freshest page),
// falling back to the precached shell when offline.
/**
 * @param {Request} request
 * @returns {Promise<Response>}
 */
async function networkFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    return await fetch(request);
  } catch (err) {
    const hit = await cache.match(request, { ignoreSearch: true });
    if (hit) return hit;
    throw err;
  }
}

sw.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== sw.location.origin) return;

  // Database: intercept ONLY when the visitor has opted into offline use. When
  // they have not, do nothing - the request goes to the network exactly as if
  // no worker were installed (no hijacking of the default-online lookup).
  if (isDbPath(url.pathname)) {
    if (offlineDbUrls.has(url.href)) {
      event.respondWith(serveDbFromCache(request, url.href));
    }
    return;
  }

  // The version stamp must always be read fresh (it is what makes each deploy a
  // distinct database cache object); never serve it from a cache.
  if (url.pathname.endsWith('/data/version.txt')) return;

  if (isShellRequest(url)) {
    event.respondWith(request.mode === 'navigate' ? networkFirst(request) : cacheFirst(request));
  }
  // Everything else (generated dataset/series/report pages, archived files) is
  // left to the network untouched - those crawlable pages are not precached.
});
