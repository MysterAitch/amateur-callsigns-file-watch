/**
 * Post-deploy functionality check (issue #497 follow-up): drives the primary
 * interaction on each dynamic page in headless Chromium (Playwright) against the
 * LIVE deployment and verifies three things, content-agnostically:
 *   1. the action is ACKNOWLEDGED immediately - a progress/"querying…" indicator
 *      appears as soon as the handler fires (the user knows they were heard);
 *   2. it TRANSITIONS to a result - some data renders in the result region
 *      (the click handler ran end to end and did not error);
 *   3. no unexpected console error/warning is emitted during the interaction.
 * It does NOT assert WHAT renders - only that a working flow produced output, so
 * it stays robust as the data changes. It is the interaction counterpart to
 * console-check.ts (page loads clean) and smoke-test.ts (bytes are served).
 *
 * Usage: node src/ci/functionality-check.ts <base-url>
 */

import { chromium, expect, type ConsoleMessage, type Page } from '@playwright/test';

// Benign console output shared with console-check.ts. Keep tight + documented.
const ALLOW: { pattern: RegExp; reason: string }[] = [
  {
    // sql.js-httpvfs full-mode probes the database with a HEAD that Pages
    // gzip-transcodes; the library warns and ignores it (Range reads are
    // unaffected). An ACCEPTED cosmetic warning, not a pending fix: full mode
    // ignores a supplied length so the HEAD cannot be configured away (#475),
    // and the cold-open latency it hints at is communicated by the loading
    // affordance (#499), not eliminated.
    pattern: /server responded with gzip encoding to a HEAD request/i,
    reason: 'sql.js-httpvfs HEAD/gzip warning on Pages - accepted cosmetic (#475)',
  },
];

interface Check {
  page: string;
  // The primary interaction: fill/click the real control(s) and submit.
  interact: (page: Page) => Promise<void>;
  // The immediate acknowledgement: this selector's text becomes non-empty
  // (a progress/"querying…" indicator) right after the action fires.
  progressSelector: string;
  // The result region: this becomes non-empty (some data rendered).
  resultSelector: string;
}

const CHECKS: Check[] = [
  {
    page: 'index.html',
    interact: async page => {
      await page.fill('#callsign', 'M7TEE');
      await page.click('#lookup-form button[type="submit"]');
    },
    // The lookup routes through the shared loading affordance (issue #499), which
    // acknowledges the click SYNCHRONOUSLY in the polite status region - before
    // the database open - so the acknowledgement is asserted there, not in the
    // result region (which only fills once the query has actually rendered, and
    // so would race a cold database open). explore/playground do the same via
    // #sql-status.
    progressSelector: '#lookup-status',
    resultSelector: '#result',
  },
  {
    page: 'explore.html',
    interact: async page => {
      await page.fill('#sql-input', 'SELECT 1 AS ok');
      await page.click('#sql-form button[type="submit"]');
    },
    progressSelector: '#sql-status',
    resultSelector: '#sql-result',
  },
  {
    page: 'playground.html',
    interact: async page => {
      await page.fill('#sql-input', 'SELECT 1 AS ok');
      await page.click('#sql-form button[type="submit"]');
    },
    progressSelector: '#sql-status',
    resultSelector: '#sql-result',
  },
];

const NAV_TIMEOUT_MS = 45_000;
const PROGRESS_TIMEOUT_MS = 8_000;
// A cold, just-deployed database is served from a fresh CDN cache object; its
// first in-browser open over range requests can legitimately take tens of
// seconds (the very latency the loading affordance communicates), so the result
// budget is generous - the acknowledgement above is what proves the handler
// fired promptly; this only proves the flow completes.
const RESULT_TIMEOUT_MS = 60_000;

const base = process.argv[2];
if (base === undefined || base.trim() === '') {
  console.error('functionality-check: base URL required as the first argument');
  process.exit(2);
}
const baseUrl = base.endsWith('/') ? base : `${base}/`;

const failures: string[] = [];
const fail = (page: string, detail: string): void => { failures.push(`${page}: ${detail}`); console.error(`  FAIL ${page} - ${detail}`); };
const allowed = (text: string): boolean => ALLOW.some(a => a.pattern.test(text));

// Wait until the selector carries non-whitespace text. Uses Playwright's native
// locator assertion (the selector is passed as DATA, never interpolated into an
// evaluated code string), auto-retrying until the timeout. The /\S/ pattern
// matches any element text containing a non-whitespace character.
async function waitForText(page: Page, selector: string, timeout: number): Promise<void> {
  await expect(page.locator(selector)).toHaveText(/\S/, { timeout });
}

async function run(browser: Awaited<ReturnType<typeof chromium.launch>>, check: Check): Promise<void> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const consoleIssues: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    const type = msg.type();
    if ((type === 'error' || type === 'warning') && !allowed(msg.text())) consoleIssues.push(`console.${type}: ${msg.text()}`);
  });
  page.on('pageerror', err => { if (!allowed(err.message)) consoleIssues.push(`pageerror: ${err.message}`); });

  try {
    await page.goto(new URL(check.page, baseUrl).toString(), { waitUntil: 'load', timeout: NAV_TIMEOUT_MS });
    await check.interact(page);

    // 1. Immediate acknowledgement: the progress indicator shows activity. The
    //    loading affordance writes it synchronously when the handler fires (before
    //    the database opens), so it is well within this budget; a miss means the
    //    action was not acknowledged.
    let acknowledged = true;
    try {
      await waitForText(page, check.progressSelector, PROGRESS_TIMEOUT_MS);
      console.log(`  ok   ${check.page} acknowledged (${check.progressSelector})`);
    } catch {
      acknowledged = false;
      fail(check.page, `no immediate indicator in ${check.progressSelector} within ${PROGRESS_TIMEOUT_MS}ms`);
    }

    // 2. Transition to a result: the result region renders some data.
    try {
      await waitForText(page, check.resultSelector, RESULT_TIMEOUT_MS);
      if (acknowledged) console.log(`  ok   ${check.page} rendered results (${check.resultSelector})`);
    } catch {
      fail(check.page, `no result rendered in ${check.resultSelector} within ${RESULT_TIMEOUT_MS}ms`);
    }
  } catch (e) {
    fail(check.page, `interaction failed: ${String(e)}`);
  }

  // 3. No unexpected console output during the interaction.
  for (const issue of consoleIssues) fail(check.page, issue);
  await context.close();
}

async function main(): Promise<void> {
  console.log(`functionality-check against ${baseUrl}`);
  const browser = await chromium.launch();
  try {
    for (const check of CHECKS) await run(browser, check);
  } finally {
    await browser.close();
  }

  console.log('');
  if (failures.length > 0) {
    console.error(`functionality-check FAILED: ${failures.length} issue(s)`);
    process.exit(1);
  }
  console.log(`functionality-check passed (${CHECKS.length} interactions)`);
}

if (import.meta.main) {
  void main();
}
