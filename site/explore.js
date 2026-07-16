// @ts-check
// In-browser SQL console over the published databases (exploration quick
// win b in the information-architecture draft). Frameworkless like
// app.js; sql.js-httpvfs runs
// read-only queries via HTTP range requests, so indexed lookups are fast
// and full scans are honestly slow - the page says so, and heavy analysis
// belongs on the downloaded databases. The small worker-opening helpers
// are deliberately duplicated from app.js rather than shared: both files
// stay dependency-free classic modules, and the duplication is ~20 lines.
//
// Deep links (issues #333/#397): the console reads ?db= and ?sql= on load,
// pre-fills the controls, announces via the status region and auto-runs a
// well-formed query - so a report or a hand-authored page can link a SPECIFIC
// query, not just the generic tool, exactly as the lookup page deep-links a
// callsign or a filtered view. The param parsing is pure and exported so it is
// unit-tested, and the browser bootstrap at the tail runs only when the httpvfs
// loader is present (mirroring playground.js), so importing this module in a
// test opens no worker.

import { withDatabaseLoading } from './db-loading.js';

// The row shape read back off the httpvfs worker's query() is not typed by the
// vendored library (no shipped types); every SELECT here states its own column
// use inline, so the row itself stays `any` at this one driver boundary,
// exactly as ledger-query.js's QueryExecutor does for the ledger database.
// window.createDbWorker's own signature is declared once in global.d.ts, shared
// with app.js/compare.js/entry-browser.js.
/** @typedef {{ db: { query: (sql: string, params?: unknown[]) => Promise<any[]> } }} DbWorker */

const { createDbWorker } = window;

const workerUrl = new URL('./vendor/sqlite.worker.js', import.meta.url);
const wasmUrl = new URL('./vendor/sql-wasm.wasm', import.meta.url);

/** @type {Record<string, string>} */
const DB_FILES = {
  latest: './data/ledger-lookup.sqlite.png',
  combined: './data/ledger-history.sqlite.png',
};

// Human labels for the loading affordance (issue #499): the status names the
// database being opened so a slow first-use load reads honestly.
/** @type {Record<string, string>} */
const DB_LABELS = {
  latest: 'lookup database',
  combined: 'combined database',
};

// The deploy version stamp. Online it is the fresh commit SHA; offline it
// falls back to the version an offline copy was downloaded under (recorded in
// localStorage by the lookup page's offline control), so the database URL
// keeps matching the service worker's cached bytes. Mirrors app.js's
// getVersion - deliberately duplicated to keep both files dependency-free.
/** @type {Promise<string> | null} */
let versionPromise = null;
/** @returns {Promise<string>} */
function getVersion() {
  versionPromise ??= (async () => {
    try {
      const res = await fetch(new URL('./data/version.txt', document.baseURI), { cache: 'no-store' });
      if (res.ok) return (await res.text()).trim();
    } catch { /* offline or missing - fall through to the offline marker */ }
    try {
      // localStorage.getItem's value is untrusted parsed JSON of unknown shape,
      // so it stays `unknown` at this boundary and is runtime-guarded before use.
      /** @type {unknown} */
      const parsed = JSON.parse(localStorage.getItem('offline-db-state') ?? '{}');
      const markers = /** @type {{ version?: unknown }} */ (parsed);
      if (markers && typeof markers.version === 'string') return markers.version;
    } catch { /* storage unavailable */ }
    return 'dev';
  })();
  return versionPromise;
}

// Same .png / ?v= hosting workarounds as app.js (see the comments there).
/** @type {Record<string, Promise<DbWorker>>} */
const workers = {};
/** @param {string} name */
async function openDb(name) {
  workers[name] ??= (async () => {
    const version = await getVersion();
    const dbUrl = new URL(`${DB_FILES[name]}?v=${encodeURIComponent(version)}`, document.baseURI);
    return createDbWorker(
      [{ from: 'inline', config: { serverMode: 'full', url: dbUrl.toString(), requestChunkSize: 4096 } }],
      workerUrl.toString(),
      wasmUrl.toString(),
    );
  })();
  return workers[name];
}

/**
 * @param {string} tag
 * @param {Record<string, string>} [attrs]
 * @param {(Node | string)[]} [children]
 */
function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const child of children) node.append(child);
  return node;
}

const ROW_CAP = 500;

// Read-only by construction (the VFS cannot write back), but reject
// non-query statements anyway so error messages stay honest, and cap the
// result set - an unbounded scan over range requests cannot be cancelled,
// only avoided. Exported so the deep-link exemplar test can assert every
// hand-authored explore.html?sql= link passes the very guard the console runs.
/** @param {string} raw */
export function prepareSql(raw) {
  const sql = raw.trim().replace(/;+\s*$/, '');
  if (!/^\s*(select|with)\b/i.test(sql)) {
    throw new Error('read-only console: queries must start with SELECT or WITH');
  }
  return `SELECT * FROM (${sql}) LIMIT ${ROW_CAP + 1}`;
}

async function run() {
  const status = document.getElementById('sql-status');
  const result = document.getElementById('sql-result');
  const alert = document.getElementById('sql-alert');
  const runBtn = /** @type {HTMLButtonElement | null} */ (document.querySelector('#sql-form button[type="submit"]'));
  const dbSelect = /** @type {HTMLSelectElement | null} */ (document.getElementById('db-select'));
  const sqlInput = /** @type {HTMLTextAreaElement | null} */ (document.getElementById('sql-input'));
  const dbName = dbSelect ? dbSelect.value : 'latest';
  const raw = sqlInput ? sqlInput.value : '';
  if (raw.trim() === '') return;
  if (alert) alert.hidden = true;

  let sql;
  try {
    sql = prepareSql(raw);
  } catch (err) {
    // Caught value is `unknown`; read `.message` through the same narrowed view
    // db-loading.js uses at the same kind of boundary.
    const message = /** @type {{ message?: string }} */ ((typeof err === 'object' && err !== null) ? err : {}).message;
    if (status) status.textContent = message ?? String(err);
    return;
  }

  if (result) result.hidden = true;
  const started = performance.now();
  try {
    // The shared affordance (#499) disables Run, shows an escalating loading
    // status while the database opens (a cold combined-database open is a measured
    // ~20s), flips to the running state once the query starts, and raises the
    // assertive #sql-alert on failure (distinguishing a load from a query error).
    // The success row-count and table stay this surface's concern.
    // Column names and types are whatever the hand-written query selects, so
    // each row is read generically as text, number or NULL.
    /** @type {Record<string, string | number | null>[]} */
    const rows = await withDatabaseLoading({
      button: runBtn ?? undefined,
      statusEl: status ?? undefined,
      alertEl: alert ?? undefined,
      resultEl: result ?? undefined,
      label: DB_LABELS[dbName] ?? `${dbName} database`,
    }, async (markRunning) => {
      const worker = await openDb(dbName);
      markRunning();
      /** @type {Record<string, string | number | null>[]} */
      const queried = await worker.db.query(sql);
      return queried;
    });
    const elapsed = ((performance.now() - started) / 1000).toFixed(1);
    const truncated = rows.length > ROW_CAP;
    const shown = truncated ? rows.slice(0, ROW_CAP) : rows;
    if (status) status.textContent = `${shown.length}${truncated ? `+ (capped at ${ROW_CAP})` : ''} row${shown.length === 1 ? '' : 's'} in ${elapsed}s`;
    if (result) {
      if (shown.length === 0) {
        result.replaceChildren(el('p', { class: 'muted', text: 'No rows.' }));
      } else {
        const headers = Object.keys(shown[0]);
        const table = el('table');
        table.append(el('thead', {}, [el('tr', {}, headers.map(h => el('th', { text: h })))]));
        table.append(el('tbody', {}, shown.map(r => el('tr', {}, headers.map(h =>
          el('td', { text: r[h] === null ? 'NULL' : String(r[h]), class: r[h] === null ? 'muted' : '' }))))));
        const wrap = el('div', { class: 'overflow' });
        wrap.append(table);
        result.replaceChildren(wrap);
      }
      result.hidden = false;
    }
  } catch {
    // The affordance already raised #sql-alert (load vs query) and reset the
    // button; the result region stays hidden. Nothing more to render here.
  }
}

// Worked examples: indexed-lookup friendly by design (callsign-keyed or
// small tables) - fast over range requests. Heavy scans belong on the
// downloaded databases, and the page says so.
const EXAMPLES = [
  { db: 'latest', title: 'What tables exist?', sql: "SELECT name, type FROM sqlite_master WHERE type = 'table' ORDER BY name" },
  { db: 'latest', title: 'The register row for a callsign', sql: "SELECT * FROM normalised WHERE callsign = 'M7TEE'" },
  { db: 'latest', title: 'Every callsign sharing a suffix (indexed)', sql: "SELECT c.callsign, c.prefix_series, n.status FROM components c JOIN normalised n ON n.callsign = c.callsign WHERE c.suffix = 'TEE' ORDER BY c.callsign" },
  { db: 'latest', title: 'The data-quality flag vocabulary', sql: 'SELECT flag, meaning FROM flag_registry ORDER BY flag' },
  { db: 'latest', title: 'The precomputed series × RSL matrix', sql: 'SELECT series, rsl, n FROM rsl_matrix ORDER BY series, rsl' },
  { db: 'combined', title: 'Every publication and its declared scope', sql: 'SELECT dataset, record_count, intended_complete, scope_notes FROM history_datasets ORDER BY dataset' },
  { db: 'combined', title: 'One callsign across every publication', sql: "SELECT dataset, status, product FROM register_history WHERE callsign = 'G2CP' ORDER BY dataset" },
  { db: 'combined', title: 'Every FOI-witnessed observation of a callsign', sql: "SELECT entry, vintage, status, licence_class, event, event_date FROM observations WHERE callsign = 'G2CP' ORDER BY vintage" },
  { db: 'combined', title: 'NULL vs blank: the semantics in action', sql: "SELECT entry, status, CASE WHEN status IS NULL THEN 'not asserted by source' WHEN status = '' THEN 'asserted BLANK by source' ELSE 'asserted' END AS reading FROM observations WHERE callsign = 'G0TQK' ORDER BY entry" },
  { db: 'combined', title: 'Licence-category mix in one publication (canonical, dataset-scoped)', sql: "SELECT normalised_licence_category, COUNT(*) AS n FROM register_history WHERE dataset = '2026-06-23' AND normalised_licence_category IS NOT NULL GROUP BY normalised_licence_category ORDER BY n DESC" },
];

function renderExamples() {
  const list = document.getElementById('example-list');
  for (const example of EXAMPLES) {
    const button = el('button', { type: 'button', class: 'example', text: example.title });
    button.addEventListener('click', () => {
      const dbSelect = /** @type {HTMLSelectElement | null} */ (document.getElementById('db-select'));
      const sqlInput = /** @type {HTMLTextAreaElement | null} */ (document.getElementById('sql-input'));
      const sqlStatus = document.getElementById('sql-status');
      if (dbSelect) dbSelect.value = example.db;
      if (sqlInput) sqlInput.value = example.sql;
      // Say plainly what happened: the example QUERY is now in the editor (and
      // which database it selected). "loaded" alone collides with the loading
      // affordance's "Loading the … database" - here nothing has been loaded yet,
      // the query is just ready to run.
      if (sqlStatus) sqlStatus.textContent = `Example query ready in the editor — ${DB_LABELS[example.db] ?? example.db} selected. Press Run.`;
    });
    if (list) {
      list.append(button, el('span', { class: 'muted', text: ` ${example.db} ` }));
      list.append(el('br'));
    }
  }
}

// --- shareable deep-link params (issues #333/#397) ---------------------------
// Parse ?db= (which database) and ?sql= (the query) from the URL. Pure and
// total so a stale or hand-mangled link degrades rather than throwing: an
// unknown ?db= is reported (not applied), and an absent/blank ?sql= yields null
// so a bare page load is untouched. Mirrors the lookup page's ?c=/?series=
// deep-link parsing (app.js).
/** @typedef {{ db: string | null, sql: string | null, unknownDb: string | null }} ExploreParams */
/**
 * @param {URLSearchParams} params
 * @returns {ExploreParams}
 */
export function parseExploreParams(params) {
  const rawDb = params.get('db');
  // Legacy alias: the combined database was historically named "master", so an
  // old shared link carrying ?db=master resolves to the combined database and
  // keeps working rather than reporting an unknown database.
  const requestedDb = rawDb === 'master' ? 'combined' : rawDb;
  const known = Object.prototype.hasOwnProperty.call(DB_FILES, requestedDb ?? '');
  const db = known ? requestedDb : null;
  const unknownDb = (rawDb !== null && rawDb !== '' && !known) ? rawDb : null;
  const rawSql = params.get('sql');
  const sql = (rawSql !== null && rawSql.trim() !== '') ? rawSql : null;
  return { db, sql, unknownDb };
}

// Apply parsed deep-link params to the console controls and ANNOUNCE the result
// through the status region (role="status" in explore.html, so assistive tech
// hears the pre-filled state). Safe by construction: the query is written to the
// textarea's value (never innerHTML, so a '<' in it can never become markup) and
// the database is a whitelisted key, so nothing from the link reaches the DOM as
// markup or the query engine unchecked - and whatever runs still passes the
// read-only SELECT/WITH guard in prepareSql. Returns true only for a WELL-FORMED
// query link (a valid or absent db, plus a query): a link naming an unknown
// database pre-fills and reports but does NOT auto-run, so the reader sees what
// was ignored before pressing Run. Pure aside from the passed-in elements.
/**
 * @param {{ dbSelect?: HTMLSelectElement, input?: HTMLTextAreaElement, statusEl?: HTMLElement }} elements
 * @param {URLSearchParams} params
 */
export function applyExploreParams({ dbSelect, input, statusEl }, params) {
  const { db, sql, unknownDb } = parseExploreParams(params);
  if (db === null && sql === null && unknownDb === null) return false;
  if (db !== null && dbSelect) dbSelect.value = db;
  if (sql !== null && input) input.value = sql;
  const notes = [];
  if (unknownDb !== null) {
    const using = dbSelect ? dbSelect.value : 'latest';
    notes.push(`Ignored an unknown database “${unknownDb}” in the link; using the ${using} database.`);
  }
  if (sql !== null && unknownDb === null) notes.push('Loaded a shared query — running…');
  else if (sql !== null) notes.push('Loaded a shared query — review it and press Run.');
  else if (db !== null) notes.push(`Selected the ${db} database — enter a query and press Run.`);
  if (statusEl && notes.length > 0) statusEl.textContent = notes.join(' ');
  return sql !== null && unknownDb === null;
}

// ---- Browser bootstrap (guarded) -------------------------------------------
// Runs only in a real browser with the httpvfs loader present (which attaches
// createDbWorker), exactly like playground.js. A unit/JSDOM test importing this
// module for the pure param helpers never trips this, so importing it opens no
// worker.
function initExplore() {
  document.getElementById('sql-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    void run();
  });
  renderExamples();

  // A shareable deep link pre-fills the controls, announces via the status
  // region and auto-runs a well-formed query so the link opens a pre-run view.
  const shouldRun = applyExploreParams({
    dbSelect: /** @type {HTMLSelectElement | null} */ (document.getElementById('db-select')) ?? undefined,
    input: /** @type {HTMLTextAreaElement | null} */ (document.getElementById('sql-input')) ?? undefined,
    statusEl: document.getElementById('sql-status') ?? undefined,
  }, new URLSearchParams(window.location.search));
  if (shouldRun) void run();

  // Offline-first (ADR 0008): register the service worker so the static shell
  // (this page, its scripts and the vendored library) is cached and the site
  // loads offline. The database itself is only cached when the visitor opts in
  // from the lookup page; once cached, the worker serves it here too.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register(new URL('./sw.js', document.baseURI).href).catch(() => {});
  }

  // Signal a successful start: cancel the startup-warning timer (explore.html)
  // and hide the warning if it was already shown. Reaching here means the module
  // loaded and its wiring ran; if a module had failed to load, none of this
  // executes and the warning surfaces. Query failures are reported inline by
  // run(), independently of this.
  if (window.__exploreReadyTimer !== undefined) clearTimeout(window.__exploreReadyTimer);
  const startupWarning = document.getElementById('startup-warning');
  if (startupWarning !== null) startupWarning.hidden = true;
}

if (typeof window !== 'undefined' && typeof window.createDbWorker === 'function') {
  initExplore();
}
