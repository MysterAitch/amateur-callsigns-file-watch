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
    // the range-served databases, so it is expected, not a per-deploy fault. The
    // underlying hosting quirk is #475; #499 tracks removing the HEAD (and so this
    // exception) by supplying the database length via config.
    pattern: /server responded with gzip encoding to a HEAD request/i,
    reason: 'sql.js-httpvfs HEAD/gzip warning on Pages - expected (#475); removal tracked in #499',
  },
];

const VERBOSE = process.env.CONSOLE_CHECK_VERBOSE === '1';
// Time to let a page's scripts run and any async load settle before judging it.
const SETTLE_MS = 6_000;
const NAV_TIMEOUT_MS = 45_000;

const base = process.argv[2] ?? process.env.PAGES_URL;
if (base === undefined || base.trim() === '') {
  console.error('console-check: base URL required as the first argument');
  process.exit(2);
}
const baseUrl = base.endsWith('/') ? base : `${base}/`;

interface Issue { page: string; kind: string; text: string; }

const allowed = (text: string): boolean => ALLOW.some(a => a.pattern.test(text));

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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
      page.on('requestfailed', req => {
        const failure = req.failure();
        const errorText = failure !== null ? failure.errorText : 'unknown';
        // ERR_ABORTED is a CANCELLED request, not a fault: pages start the
        // sql.js-httpvfs range-load and it is still in flight when we move on, so
        // the browser aborts it. Real reachability is covered by smoke-test.ts;
        // here it would be pure noise. Genuine network failures (DNS, refused,
        // blocked) surface under other error codes and are still recorded.
        if (errorText.includes('ERR_ABORTED')) return;
        record('requestfailed', `${req.url()} - ${errorText}`);
      });

      try {
        await page.goto(new URL(pageRel, baseUrl).toString(), { waitUntil: 'load', timeout: NAV_TIMEOUT_MS });
        await delay(SETTLE_MS);
      } catch (e) {
        record('navigation', String(e));
      }

      const real = captured.filter(i => !allowed(i.text));
      if (real.length === 0) console.log(`  ok   ${pageRel}`);
      else { for (const i of real) console.error(`  FAIL ${pageRel} ${i.kind}: ${i.text}`); issues.push(...real); }

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
