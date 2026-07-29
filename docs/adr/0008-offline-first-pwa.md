# ADR 0008 — Offline-first progressive web app with opt-in full-database download

- Status: accepted
- Date: 2026-07-09

## Context

The lookup and Explore pages query a published SQLite database directly from
the browser using `sql.js-httpvfs`, which fetches only the pages it touches via
HTTP Range requests (`serverMode: 'full'`, 4 KiB chunks). The database is large
(~28–32 MB for the lookup database, ~257 MB for the combined database) and is
never committed — it is derived fresh each deploy and served from GitHub Pages,
with two hosting workarounds: a `.png` extension (so the CDN does not
gzip-transcode the Range responses and corrupt reads) and a `?v=<commit-sha>`
stamp (so two deploys inside the CDN cache window cannot mix chunks from
different database versions). See ADR 0003 and `site/app.js`.

Issue #248 asks to turn the site into an offline-first progressive web app: a
service worker that caches the static assets and the database so repeat visits
are instant and the site works with no network, plus a web-app manifest for
installability. The maintainer refined the ask in the issue comment: make the
full-database caching **user-triggered**, not automatic. The site should run
online (range-queried) by default — keeping first load light — and offer an
explicit "download the full dataset for offline use" control that fetches and
caches the whole database, shows the size and a progress bar, and then presents
a clear "now running offline" state. The full download is a deliberate choice,
not a silent precache.

Two constraints shape the design:

- The site is **frameworkless with no build step** and ships **vendored
  dependencies only**; the service worker and manifest must be plain static
  files copied by the Pages workflow, with no bundler.
- A broken service worker can make a site **un-updatable** (a stale cached
  shell that never refreshes). The supply-chain posture (ADR 0002) also forbids
  any repository writeback; the worker is a pure client-side deploy artefact.

## Decision

Add a service worker (`site/sw.js`) and a web-app manifest
(`site/manifest.webmanifest`), copied into the deploy by the site-build job of
`.github/workflows/cicd.yaml` (ADR 0019) and linked from every hand-authored page.
The design has four parts.

1. **Default-online; opt-in offline database.** The worker does **not** touch
   the database by default. The range-request lookup goes straight to the
   network exactly as before. A control on the lookup page lets the visitor
   download the whole database (lookup database prominently; combined database
   behind an "advanced" disclosure, clearly labelled ~257 MB). The download
   streams the response, showing the byte size up front (a `HEAD` probe) and a
   progress bar during transfer, stores the whole file in the Cache API, and
   then shows a persistent "running offline (downloaded &lt;date&gt;)" state
   with a "remove offline copy" control.

2. **Static-shell precache.** On install the worker precaches the shell — the
   six hand-authored pages, `app.js`/`explore.js`/`compare.js`/`style.css`, the
   manifest, and the vendored `sql.js-httpvfs` library
   (`vendor/index.js`, `vendor/sqlite.worker.js`, `vendor/sql-wasm.wasm`) — so
   the **site** works offline even before any database is downloaded.
   Navigations are network-first (a live visitor gets the freshest page,
   falling back to the cached shell offline); other shell assets are
   cache-first. The crawlable, generated dataset/series/report pages are left
   to the network untouched, preserving progressive enhancement and the
   `<noscript>` fallbacks.

3. **Cache-bust by deploy commit, mirroring `?v=`.** The shell cache is named
   `callsign-shell-<DEPLOY_VERSION>`, where `DEPLOY_VERSION` is a literal in
   `sw.js` that the Pages workflow rewrites to the commit SHA. This makes the
   worker's own bytes change every deploy — the only reliable trigger for the
   browser to re-install a worker — so a new deploy supersedes the shell and
   the `activate` handler deletes the previous deploy's caches. Without the
   stamp a cached shell could make the site un-updatable, so the rewrite is
   load-bearing. The offline database cache is pruned per-entry on activate:
   any cached database whose `?v=` no longer matches the current deploy is
   dropped, so a superseded download is discarded and the visitor is offered a
   re-download.

4. **Range-from-cache.** `sql.js-httpvfs` issues Range requests even for a
   fully-cached file, and learns the file size from the `Content-Range` total.
   The worker therefore satisfies those requests itself: when — and only
   when — the visitor has opted in, it reads the cached whole file and returns
   `206 Partial Content` slices with a correct
   `Content-Range: bytes <start>-<end>/<total>` header. This is implemented and
   works: after downloading, the lookup and Explore pages query with no
   network. The opt-in set of database URLs the worker will serve is empty
   unless the visitor has downloaded a copy, so the worker never hijacks the
   default-online lookup.

## Consequences

- **Offline querying fully works**, not just the static shell. The
  Range-from-cache handler is the crux and is implemented, so a downloaded
  database answers real queries offline through the unchanged `sql.js-httpvfs`
  code path.
- **Memory cost of Range-from-cache.** To avoid re-reading the Cache API on
  every 4 KiB Range request, the worker holds the whole file in memory once
  read. That is acceptable for the opt-in lookup database (~32 MB); the combined
  database (~257 MB) is a deliberate, clearly-labelled power-user choice and
  will use correspondingly more memory. If this proves heavy on constrained
  devices, a future refinement could slice from a `Blob`/`ReadableStream`
  without a full in-memory copy.
- **A new deploy replaces an offline copy.** Because correctness depends on the
  cached bytes matching the `?v=` the app requests, a deploy prunes the old
  download and the visitor must re-download to refresh. This is the honest
  mirror of the existing `?v=` cache-busting: serving old chunks against a new
  version reads as "database disk image is malformed". The "running offline"
  state names the version and says a new deploy replaces it.
- **The deploy version survives going offline.** `version.txt` is fetched
  uncached (never cached, by design) and so is unreachable offline; the app
  records the downloaded version in `localStorage` and falls back to it, so the
  database URL keeps carrying the `?v=` the cached copy was stored under.
- **Installability.** The manifest supplies name, theme/background colours,
  `display: standalone` and an inlined SVG data-URI icon (no binary asset,
  honouring the vendored-only/no-build posture). Some platforms prefer raster
  PNG icons for richer install prompts; the SVG is sufficient for basic
  installability and can be supplemented later without a build step.
- **Registration surface.** The worker is registered from the interactive
  pages (`app.js`, `explore.js`) and, so any entry page installs it, from a
  small inline snippet on the other hand-authored pages; the fully-static
  `statistics.html` keeps its script-free property and is precached via the
  shell. Generated dataset/series/report pages are out of this change's scope
  and remain crawlable and network-served; a first visit made directly to one
  of them will not yet have installed the worker.
- **No writeback, no new dependency.** The worker and manifest are plain static
  files; nothing is added to the supply chain and the deploy job keeps its
  read-only, Pages-only posture (ADR 0002, ADR 0003).

Relates to: issue #248; ADR 0002 (repo-level write controls / supply-chain
posture); ADR 0003 (in-repo presentation on GitHub Pages); ADR 0006.
