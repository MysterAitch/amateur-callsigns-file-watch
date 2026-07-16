Visual evidence for the #594 inbound-links PR — before/after screenshots, light and dark, of the lookup result row (`site/app.js` / `site/callsign-pill.js`) and the entry browser's cleaned-column cell (`site/entry-browser.js`). Captions are on the PR itself.

Captured by rendering the real production modules against fixture data (the same dependency-injection technique the vitest suites use) with Playwright, after the Chrome-extension browser-automation channel hit a persistent `document_idle` fault for the whole session (reproducing the same failure mode already documented on PRs #640/#652).

- `before-lookup-{light,dark}.png` / `after-lookup-{light,dark}.png` — the lookup result row's callsign pill: same visual pill, destination moves from the lookup's own `?c=` self-search to `callsign.html?c=`.
- `before-entry-browser-{light,dark}.png` / `after-entry-browser-{light,dark}.png` — the entry browser's `cleaned` column: was a plain, unstyled `<code>` text cell; now a linked pill to the canonical per-callsign page (the raw as-published `callsign` column, left unchanged, stays a non-link transparency chip in both).
