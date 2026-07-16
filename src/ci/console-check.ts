/**
 * Post-deploy browser-console check (issue #497 follow-up): loads a selection of
 * pages in headless Chromium (Playwright) against the LIVE deployment and fails
 * if any page emits console errors/warnings, an uncaught page error, or a failed
 * request. It is the runtime counterpart to smoke-test.ts: that confirms the
 * bytes are served; this confirms the pages actually RUN clean in a real browser
 * (broken imports, CSP violations, missing assets, deprecation warnings, database
 * load failures - none of which a fetch-only check can see).
 *
 * A message is only a failure if it is NOT matched by the ALLOW list below, which
 * is calibrated against the live site so we assert "zero UNEXPECTED console
 * output" rather than guessing what is benign. Set CONSOLE_CHECK_VERBOSE=1 to
 * print every captured message (used to (re)calibrate the allow list).
 *
 * Usage: node src/ci/console-check.ts <base-url>
 */

import { chromium, type ConsoleMessage } from '@playwright/test';

// Pages worth loading in a browser: the hand-authored and generated pages that
// carry scripts. The data pages (ledger, explore, playground) exercise the
// sql.js-httpvfs range-request load path - the richest source of runtime faults.
const PAGES = [
  'index.html',
  'statistics.html',
  'explore.html',
  'compare.html',
  'ledger.html',
  'callsign.html',
  'playground.html',
  'data-status.html',
  'glossary.html',
  'about.html',
  'callsign-structure.html',
  'invisible-characters.html',
];

// Benign, expected console output (calibrated against the live site). Keep this
// list tight and documented - each entry is a deliberate exception, not a mute.
const ALLOW: { pattern: RegExp; reason: string }[] = [
  {
    // sql.js-httpvfs full-mode probes the database with a HEAD, and GitHub Pages
    // gzip-transcodes that HEAD response; the library detects this, warns, and
    // ignores it (its Range reads are unaffected). It appears on every deploy of
    // the range-served databases, so it is expected, not a per-deploy fault. This
    // is an ACCEPTED cosmetic warning, not a pending fix: the library's full mode
    // ignores a supplied database length, so the HEAD cannot be configured away
    // (the underlying hosting quirk is #475), and the cold-open latency it hints
    // at is instead COMMUNICATED to the user by the shared loading affordance
    // (#499) rather than eliminated.
    pattern: /server responded with gzip encoding to a HEAD request/i,
    reason: 'sql.js-httpvfs HEAD/gzip warning on Pages - accepted cosmetic (#475); cold-open latency is communicated via the loading affordance (#499)',
  },
];

const VERBOSE = process.env.CONSOLE_CHECK_VERBOSE === '1';
// After load, wait for the page to reach network idle so async console output has
// time to appear - but as a SOFT budget, not a gate. The data pages open a
// range-served database that legitimately keeps streaming (the ledger never
// idles), so a timeout here just means "judged while still loading". The settle
// time is printed for every page, so an unexpectedly slow load is visible.
const SETTLE_TIMEOUT_MS = 12_000;
const NAV_TIMEOUT_MS = 45_000;

const base = process.argv[2] ?? process.env.PAGES_URL;
if (base === undefined || base.trim() === '') {
  console.error('console-check: base URL required as the first argument');
  process.exit(2);
}
const baseUrl = base.endsWith('/') ? base : `${base}/`;

interface Issue { page: string; kind: string; text: string; }

const allowed = (text: string): boolean => ALLOW.some(a => a.pattern.test(text));

async function main(): Promise<void> {
  console.log(`console-check against ${baseUrl}${VERBOSE ? ' (verbose)' : ''}`);
  const browser = await chromium.launch();
  const issues: Issue[] = [];
  try {
    for (const pageRel of PAGES) {
      const context = await browser.newContext();
      const page = await context.newPage();
      const captured: Issue[] = [];
      const record = (kind: string, text: string): void => {
        if (VERBOSE) console.log(`  [${pageRel}] ${kind}: ${text}`);
        captured.push({ page: pageRel, kind, text });
      };
      page.on('console', (msg: ConsoleMessage) => {
        const type = msg.type();
        if (type === 'error' || type === 'warning') record(`console.${type}`, msg.text());
      });
      page.on('pageerror', err => record('pageerror', err.message));
      // We watch the browser CONSOLE (console.error/warning + uncaught pageerror),
      // which is the ask - and which already includes Chrome's own "Failed to load
      // resource" errors for genuinely failed requests. Raw requestfailed events
      // are deliberately NOT watched: a cancelled request (ERR_ABORTED, e.g. an
      // in-flight database range-read when we move on) is not a console message
      // and not a fault, so watching them would just mean filtering that noise.

      const started = Date.now();
      try {
        await page.goto(new URL(pageRel, baseUrl).toString(), { waitUntil: 'load', timeout: NAV_TIMEOUT_MS });
      } catch (e) {
        record('navigation', String(e));
      }
      // Soft settle: give async output time to appear; a still-streaming database
      // page simply gets judged mid-stream (see the SETTLE_TIMEOUT_MS note).
      await page.waitForLoadState('networkidle', { timeout: SETTLE_TIMEOUT_MS }).catch(() => undefined);
      const settleMs = Date.now() - started;

      const real = captured.filter(i => !allowed(i.text));
      if (real.length === 0) console.log(`  ok   ${pageRel} (${settleMs}ms)`);
      else { for (const i of real) console.error(`  FAIL ${pageRel} (${settleMs}ms) ${i.kind}: ${i.text}`); issues.push(...real); }

      await context.close();
    }
  } finally {
    await browser.close();
  }

  console.log('');
  if (issues.length > 0) {
    console.error(`console-check FAILED: ${issues.length} unexpected message(s) across ${new Set(issues.map(i => i.page)).size} page(s)`);
    process.exit(1);
  }
  console.log(`console-check passed (${PAGES.length} pages clean)`);
}

if (import.meta.main) {
  void main();
}
