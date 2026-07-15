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
 * One page needs a stronger assertion. The ledger AUTO-LOADS a default sample on
 * page load (its first sample chip resolves into the result region before any
 * click), so a plain "result region non-empty" check would pass trivially,
 * proving nothing about the click. For it the check instead waits for that
 * default to SETTLE, snapshots the result region, then asserts a NON-default
 * sample click CHANGES it - accepting either a found (#entity) or a missed
 * (#miss) outcome, both of which prove the handler ran and produced output. The
 * budgets are database-sized: it is the 1.44 GB claim ledger, whose cold open
 * and fresh queries stream for tens of seconds over range requests.
 *
 * Usage: node src/ci/functionality-check.ts <base-url>
 */

import { chromium, expect, type ConsoleMessage, type Page } from '@playwright/test';
import { primeLedgerCdn } from './ledger-warmup.ts';

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
  // The result region: this becomes non-empty (some data rendered). A selector
  // may resolve to more than one element (the ledger's #entity, #miss), in which
  // case any one carrying text counts as rendered.
  resultSelector: string;
  // The immediate acknowledgement: this selector's text becomes non-empty
  // (a progress/"querying…" indicator) right after the action fires. Omitted for
  // a page whose result region is pre-populated on load (see changeDetection),
  // where an "indicator appeared" assertion is meaningless.
  progressSelector?: string;
  // Present only for a page that auto-loads a default result on page load (the
  // ledger). Instead of asserting the result region is merely non-empty - which
  // the auto-load already makes true - the check waits for that default to
  // SETTLE, snapshots the region, fires the interaction (a non-default sample
  // chip), then asserts the region TRANSITIONS to the new result. Budgets are
  // database-sized (see LEDGER_SETTLE_TIMEOUT_MS / LEDGER_TRANSITION_TIMEOUT_MS).
  changeDetection?: { settleTimeoutMs: number; transitionTimeoutMs: number };
}

// The claim ledger is the 1.44 GB raw-keyed database (issue #361). Its cold
// in-browser open plus the first streamed query legitimately runs for tens of
// seconds over range requests, so the default-sample SETTLE budget is well
// beyond the 60s the lighter pages use. The check primes the CDN edge before
// navigating (see primeLedgerCdn, issue #537), so this budget is expected to
// measure a WARM open; it is nonetheless RETAINED at its cold-safe size as the
// safety net, so a genuine hang - not merely a cold deploy - still fails. The
// post-click TRANSITION reuses the warm open, but a fresh query on a database
// this size still streams, so it too gets a generous, database-sized budget.
// Declared before CHECKS so the ledger entry can carry them as its
// change-detection budgets.
const LEDGER_SETTLE_TIMEOUT_MS = 120_000;
const LEDGER_TRANSITION_TIMEOUT_MS = 90_000;

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
  {
    page: 'ledger.html',
    // Click a NON-default sample chip. The page auto-loads the first chip on load
    // (G0TQK, aria-pressed), so a *different* callsign is what proves the click
    // did something. M7TEE is a distinct sample whose result differs from the
    // default's; a found callsign renders #entity, a miss renders #miss - either
    // proves the handler ran, so the change-detection accepts both.
    interact: async page => {
      await page.click('#resolver button[data-cs="M7TEE"]');
    },
    // Both outcomes live here: #entity when found, #miss when not. Either one
    // carrying the new callsign's result is a valid transition.
    resultSelector: '#entity, #miss',
    changeDetection: {
      settleTimeoutMs: LEDGER_SETTLE_TIMEOUT_MS,
      transitionTimeoutMs: LEDGER_TRANSITION_TIMEOUT_MS,
    },
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

// The combined, trimmed text of every element a result selector matches, with
// empty regions dropped, so it is '' only when NO region carries text (both
// #entity and #miss empty) and otherwise the concatenation of whichever
// rendered. A single-space joiner separates two regions' text; found (#entity)
// and missed (#miss) outcomes produce plainly different content, so any real
// transition changes the string. The selector is passed as DATA, never evaluated.
async function regionText(page: Page, selector: string): Promise<string> {
  const texts = await page.locator(selector).allTextContents();
  return texts.map(t => t.trim()).filter(t => t !== '').join(' ');
}

// The default flow for a page whose result region starts EMPTY: fire the
// interaction, assert an immediate acknowledgement (the progress indicator shows
// activity - the loading affordance writes it synchronously when the handler
// fires, before the database opens), then assert a transition to a non-empty
// result region.
async function verifyAcknowledgeThenResult(page: Page, check: Check): Promise<void> {
  await check.interact(page);

  let acknowledged = true;
  const progressSelector = check.progressSelector;
  if (progressSelector !== undefined) {
    try {
      await waitForText(page, progressSelector, PROGRESS_TIMEOUT_MS);
      console.log(`  ok   ${check.page} acknowledged (${progressSelector})`);
    } catch {
      acknowledged = false;
      fail(check.page, `no immediate indicator in ${progressSelector} within ${PROGRESS_TIMEOUT_MS}ms`);
    }
  }

  try {
    await waitForText(page, check.resultSelector, RESULT_TIMEOUT_MS);
    if (acknowledged) console.log(`  ok   ${check.page} rendered results (${check.resultSelector})`);
  } catch {
    fail(check.page, `no result rendered in ${check.resultSelector} within ${RESULT_TIMEOUT_MS}ms`);
  }
}

// The flow for a page that auto-loads a default result on load (the ledger).
// A plain non-emptiness assertion would pass on the pre-loaded default without
// the click proving anything, so this detects a genuine CHANGE: wait for the
// default sample to SETTLE, snapshot the result region, fire the interaction (a
// non-default sample chip), then assert the region becomes non-empty AND differs
// from the settled default. Requiring "differs AND non-empty" (not merely
// "differs") is deliberate: the result region is briefly cleared mid re-render,
// and an empty region must not be mistaken for the new result. Both a found
// (#entity) and a missed (#miss) outcome are accepted via the combined selector.
async function verifyTransition(page: Page, check: Check, budgets: { settleTimeoutMs: number; transitionTimeoutMs: number }): Promise<void> {
  // 1. The auto-loaded default sample settles. This is the ledger's heaviest
  //    wait - a cold open of the 1.44 GB database plus its first streamed query.
  try {
    await expect.poll(() => regionText(page, check.resultSelector), { timeout: budgets.settleTimeoutMs }).not.toBe('');
    console.log(`  ok   ${check.page} default sample settled (${check.resultSelector})`);
  } catch {
    fail(check.page, `default sample did not settle in ${check.resultSelector} within ${budgets.settleTimeoutMs}ms`);
    return;
  }
  const settled = await regionText(page, check.resultSelector);

  // 2. Fire the interaction (click a non-default sample chip).
  await check.interact(page);

  // 3. The result region transitions to the newly-picked callsign: non-empty and
  //    different from the settled default. The database is warm now, but a fresh
  //    query on one this size still streams, so the budget stays generous.
  try {
    await expect.poll(async () => {
      const now = await regionText(page, check.resultSelector);
      return now !== '' && now !== settled;
    }, { timeout: budgets.transitionTimeoutMs }).toBe(true);
    console.log(`  ok   ${check.page} transitioned to a new result (${check.resultSelector})`);
  } catch {
    fail(check.page, `result did not transition in ${check.resultSelector} within ${budgets.transitionTimeoutMs}ms`);
  }
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
    // Warm the CDN edge BEFORE the browser navigates and cold-opens the ledger,
    // so the timed settle assertion measures a warm open (what a returning user
    // experiences) rather than the one-off cold deploy's origin round-trips
    // (issue #537, the #475 cold-open latency surfacing as a false-alarm CI
    // failure). Bounded and best-effort - a warm-up failure logs and proceeds,
    // and the settle timeout below is retained as the real safety net for a
    // genuine hang. Only the ledger (changeDetection) needs it; the other pages
    // are small.
    if (check.changeDetection !== undefined) {
      await primeLedgerCdn(baseUrl);
    }
    await page.goto(new URL(check.page, baseUrl).toString(), { waitUntil: 'load', timeout: NAV_TIMEOUT_MS });
    if (check.changeDetection !== undefined) {
      await verifyTransition(page, check, check.changeDetection);
    } else {
      await verifyAcknowledgeThenResult(page, check);
    }
  } catch (e) {
    fail(check.page, `interaction failed: ${String(e)}`);
  }

  // No unexpected console output during the interaction.
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
