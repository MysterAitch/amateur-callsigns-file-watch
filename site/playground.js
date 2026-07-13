// Playground / data explorer (issue #361, Stage 3b): an in-browser, read-only
// SQL console over the deployed raw-keyed claim-ledger SQLite. It is the
// power-user companion to the guided Ledger page (ledger.html): the Ledger
// page folds one callsign into a dossier; this page lets you write arbitrary
// SELECT/WITH queries against the same shipped database and see the rows.
//
// It reuses two established patterns, deliberately:
//   - the DB-open path from ledger-query.js (openLedgerQuery opens the same
//     `claim-ledger.sqlite.png` costume over sql.js-httpvfs range requests, so
//     only the pages each query needs are fetched, never the whole database); and
//   - the read-only SELECT/WITH guard the Explore console (explore.js) applies,
//     reproduced here in prepareSql so a non-query statement is rejected with an
//     honest message. The guard is safety, not decoration: the range-request VFS
//     cannot write, but rejecting non-queries keeps the errors truthful and caps
//     the result set so an unbounded scan cannot be issued by accident.
//
// The guard, the row cap and the worked examples are pure and exported, so they
// are unit-tested without a DOM; runQuery renders a result set into the page's
// table and is exercised by a JSDOM smoke test against a real built database.
// The browser bootstrap at the tail runs only when the httpvfs loader is
// present, so importing this module in a test opens no worker.

import { openLedgerQuery } from './ledger-query.js';

// The result set is capped: a query over range requests cannot be cancelled
// once issued, only bounded, so the console fetches one page past the cap to
// detect (and honestly report) truncation. Mirrors explore.js's ROW_CAP.
export const ROW_CAP = 500;

// Drop leading whitespace and SQL comments so the read-only guard sees the
// first real token. A user (or a worked example) may open a query with an
// explanatory `-- …` line or a `/* … */` block; that must not be mistaken for a
// non-SELECT statement. Only the LEADING run is stripped - comments inside the
// query are left for SQLite.
function firstToken(sql) {
  let s = sql;
  for (;;) {
    const t = s.replace(/^\s+/, '');
    if (t.startsWith('--')) { s = t.replace(/^--[^\n]*\n?/, ''); continue; }
    if (t.startsWith('/*')) { const end = t.indexOf('*/'); s = end === -1 ? '' : t.slice(end + 2); continue; }
    return t;
  }
}

// Reject anything that is not a single SELECT/WITH read. Read-only by
// construction (the VFS cannot write back), but a non-query statement is
// refused anyway so the error stays honest, and the query is wrapped in a
// bounded subquery so the result set is capped. A stray statement separator in
// the middle becomes a syntax error inside the subquery rather than a second
// statement, so only one read ever runs. The wrap puts the closing paren on its
// own line so a query ending in a `-- …` comment does not swallow it. Pure:
// unit-tested without a DOM.
export function prepareSql(raw) {
  const sql = String(raw).trim().replace(/;+\s*$/, '');
  if (sql === '') throw new Error('enter a query first');
  if (!/^(select|with)\b/i.test(firstToken(sql))) {
    throw new Error('read-only console: queries must start with SELECT or WITH');
  }
  return `SELECT * FROM (\n${sql}\n) LIMIT ${ROW_CAP + 1}`;
}

// Worked examples: one-click starters that TRIAL the ledger's query surface.
// Indexed columns (entity / cleaned / raw_subject on the observation table) are
// preferred so the fast examples stay fast over range requests; the two that
// must scan the corpus are marked `heavy: true` so the page can set honest
// expectations before a slow query runs. Each example queries the `claims` VIEW
// (the flat ten-column contract) or the compact base tables directly.
export const EXAMPLES = [
  {
    title: 'Schema — tables and views in this database',
    note: 'fast · reads the SQLite catalogue',
    sql: `SELECT type, name
FROM sqlite_master
WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'
ORDER BY type, name`,
  },
  {
    title: 'Per-entity dossier — every claim for one licence',
    note: 'fast · indexed on entity',
    sql: `-- Every claim the ledger holds for one entity, raw and derived,
-- in derivation order. 'G#0TQK' is the RSL-less placeholder key.
SELECT layer, predicate, object, rule, source_file, vintage
FROM claims
WHERE entity = 'G#0TQK'
ORDER BY vintage, ordinal, predicate`,
  },
  {
    title: 'Variants of an entity — the raw tokens behind one licence',
    note: 'fast · indexed on entity',
    sql: `-- Each distinct raw token the register published for this entity,
-- with how many snapshot rows carried it. A token differing from
-- its cleaned form is a publisher artefact kept verbatim, not hidden.
SELECT raw_subject, cleaned, COUNT(*) AS observations
FROM claims
WHERE entity = 'G#0TQK' AND predicate = '@listed'
GROUP BY raw_subject, cleaned
ORDER BY observations DESC`,
  },
  {
    title: 'Status fold — a window over one entity’s timeline',
    note: 'fast · indexed on entity · window function',
    sql: `-- Fold one entity's status across the snapshots and flag each
-- transition with LAG(). The status column is named differently across
-- Ofcom's schemas (Status / Final Status / Status__c), so all three are read.
WITH status_by_vintage AS (
  SELECT vintage, object AS status
  FROM claims
  WHERE entity = 'G#0TQK' AND layer = 'raw'
    AND predicate IN ('Status', 'Final Status', 'Status__c')
  GROUP BY vintage, object
)
SELECT vintage, status,
       LAG(status) OVER (ORDER BY vintage) AS previous_status,
       CASE WHEN status IS NOT LAG(status) OVER (ORDER BY vintage)
            THEN 'changed' ELSE 'unchanged' END AS transition
FROM status_by_vintage
ORDER BY vintage`,
  },
  {
    title: 'Corpus aggregate — observations per snapshot vintage',
    note: 'heavier · scans the observation table',
    sql: `-- How many register rows each archived snapshot contributed.
-- This scans every observation, so it is slower over range requests
-- than the indexed point-lookups above.
SELECT s.vintage, COUNT(*) AS observations
FROM observation o
JOIN source s ON s.source_id = o.source_id
GROUP BY s.vintage
ORDER BY s.vintage`,
  },
  {
    title: 'Suffix cohort — every licence sharing a callsign suffix',
    note: 'heavier · suffix match cannot use the prefix index',
    sql: `-- The cohort-building pattern behind forbidden-suffix analysis:
-- every entity whose cleaned callsign ends in a given three-letter suffix.
-- A trailing-wildcard match scans the corpus. NOTE: this database carries the
-- register snapshots only; the curated forbidden-suffix list is published
-- separately (see the Forbidden suffixes section), so this finds a suffix
-- cohort, it does not assert any suffix is forbidden.
SELECT DISTINCT entity, cleaned
FROM claims
WHERE predicate = '@listed' AND cleaned LIKE '%TEE'
ORDER BY cleaned
LIMIT 200`,
  },
];

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const child of children) node.append(child);
  return node;
}

// Render a result set into the result host as a scrollable table. Every value
// is written with textContent (via the `text` attr), never innerHTML, so a
// register value carrying '<' or '&' is shown literally, never interpreted as
// markup. NULL is shown as a muted 'NULL' so it reads distinctly from a blank
// string the source actually asserted.
export function renderResults(resultEl, rows, truncated = false) {
  if (rows.length === 0) {
    resultEl.replaceChildren(el('p', { class: 'obs-mini', text: 'No rows.' }));
    return;
  }
  const headers = Object.keys(rows[0]);
  const table = el('table', { class: 'pg-table' });
  table.append(el('thead', {}, [el('tr', {}, headers.map(h => el('th', { text: h })))]));
  table.append(el('tbody', {}, rows.map(r => el('tr', {}, headers.map(h =>
    el('td', { text: r[h] === null ? 'NULL' : String(r[h]), class: r[h] === null ? 'pg-null' : '' }))))));
  const wrap = el('div', { class: 'overflow' });
  wrap.append(table);
  if (truncated) {
    wrap.append(el('p', { class: 'obs-mini', text: `Showing the first ${ROW_CAP} rows; add your own LIMIT to page further.` }));
  }
  resultEl.replaceChildren(wrap);
}

// Guard, run and render one query against an injected executor. Exported so a
// JSDOM smoke test drives the exact browser code path against a real built
// database (node:sqlite as the executor), minus the httpvfs transport. Returns
// the rendered rows (empty on a guarded/failed query) so a caller/test can
// assert without scraping the DOM.
export async function runQuery(query, rawSql, { statusEl, resultEl }) {
  let sql;
  try {
    sql = prepareSql(rawSql);
  } catch (err) {
    if (statusEl) statusEl.textContent = String(err.message ?? err);
    return [];
  }
  if (statusEl) statusEl.textContent = 'Querying… (the first read fetches pages of the database as needed).';
  const started = Date.now();
  try {
    const raw = await query(sql);
    const truncated = raw.length > ROW_CAP;
    const rows = truncated ? raw.slice(0, ROW_CAP) : raw;
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    if (statusEl) {
      statusEl.textContent = `${rows.length}${truncated ? `+ (capped at ${ROW_CAP})` : ''} row${rows.length === 1 ? '' : 's'} in ${elapsed}s`;
    }
    if (resultEl) renderResults(resultEl, rows, truncated);
    return rows;
  } catch (err) {
    if (statusEl) statusEl.textContent = '';
    if (resultEl) {
      resultEl.replaceChildren(el('p', { class: 'pg-error', role: 'alert', text: `Query failed: ${String(err.message ?? err)}` }));
    }
    return [];
  }
}

// Populate the one-click example starters. Clicking one loads its SQL into the
// textarea (ready to Run) rather than running it immediately, so a heavier
// example is never fired without the user seeing it first.
function renderExamples(listEl, inputEl, statusEl) {
  for (const example of EXAMPLES) {
    const button = el('button', { type: 'button', class: 'chip', text: example.title });
    button.addEventListener('click', () => {
      inputEl.value = example.sql;
      if (statusEl) statusEl.textContent = 'Loaded — press Run.';
      inputEl.focus();
    });
    const row = el('div', { class: 'pg-example' });
    row.append(button, el('span', { class: 'obs-mini', text: example.note }));
    listEl.append(row);
  }
}

// Wire the Run form to an injected database-opener. Kept separate from
// initPlayground (and exported) so a DOM test can drive the exact submit path
// with a controlled opener - asserting the page reacts the instant Run is
// pressed, before the database has opened, rather than sitting silent while the
// range-request VFS spins up on the first query.
export function wireConsole({ form, input, statusEl, resultEl, runBtn, openDatabase }) {
  // Open the database lazily, on the first Run, so merely loading the page costs
  // nothing until a query is issued; memoised so later Runs reuse the open.
  let queryPromise = null;
  const getQuery = () => (queryPromise ??= openDatabase());

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    // Guard the query BEFORE opening the database, so an empty or non-SELECT
    // query is refused instantly and the VFS is never spun up just to reject it.
    try {
      prepareSql(input.value);
    } catch (err) {
      if (statusEl) statusEl.textContent = String(err.message ?? err);
      return;
    }
    // A valid query. The first Run opens the database (fetching pages over range
    // requests), which runQuery cannot report until it resolves - so show an
    // immediate affordance here and hold the button, rather than look inert.
    const firstOpen = queryPromise === null;
    if (statusEl && firstOpen) statusEl.textContent = 'Opening the database…';
    if (runBtn) runBtn.disabled = true;
    void (async () => {
      try {
        const query = await getQuery();
        await runQuery(query, input.value, { statusEl, resultEl });
      } catch (err) {
        console.error(err);
        if (statusEl) statusEl.textContent = 'The claim-ledger database could not be loaded. Try reloading the page.';
      } finally {
        if (runBtn) runBtn.disabled = false;
      }
    })();
  });
}

// ---- Browser bootstrap (guarded) -------------------------------------------
// Runs only in a real browser with the httpvfs loader present, exactly like
// ledger.js. A unit/JSDOM test importing this module for prepareSql/runQuery
// never trips this, so importing the module opens no worker.
function initPlayground() {
  const form = document.getElementById('sql-form');
  const input = document.getElementById('sql-input');
  const statusEl = document.getElementById('sql-status');
  const resultEl = document.getElementById('sql-result');
  const listEl = document.getElementById('example-list');
  if (listEl && input) renderExamples(listEl, input, statusEl);

  if (form && input) {
    const runBtn = form.querySelector('button[type="submit"]');
    wireConsole({ form, input, statusEl, resultEl, runBtn, openDatabase: openLedgerQuery });
  }

  // Signal a successful start: cancel the startup-warning timer (playground.html)
  // and hide the warning if it was already shown. Reaching here means the module
  // loaded and its wiring ran; if it had failed to load, the warning surfaces.
  if (window.__playgroundReadyTimer !== undefined) clearTimeout(window.__playgroundReadyTimer);
  const startupWarning = document.getElementById('startup-warning');
  if (startupWarning !== null) startupWarning.hidden = true;

  // Offline-first (ADR 0008): register the service worker so the static shell is
  // cached and the page loads offline. The claim-ledger database itself is not
  // cached (its offline opt-in is a later sub-stage), so queries still need the
  // network; the console shell loads regardless.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register(new URL('./sw.js', document.baseURI).href).catch(() => {});
  }
}

if (typeof window !== 'undefined' && typeof window.createDbWorker === 'function') {
  initPlayground();
}
