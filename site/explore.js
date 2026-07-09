// In-browser SQL console over the published databases (exploration quick
// win b in the information-architecture draft). Frameworkless like
// app.js; sql.js-httpvfs runs
// read-only queries via HTTP range requests, so indexed lookups are fast
// and full scans are honestly slow - the page says so, and heavy analysis
// belongs on the downloaded databases. The small worker-opening helpers
// are deliberately duplicated from app.js rather than shared: both files
// stay dependency-free classic modules, and the duplication is ~20 lines.

const { createDbWorker } = window;

const workerUrl = new URL('./vendor/sqlite.worker.js', import.meta.url);
const wasmUrl = new URL('./vendor/sql-wasm.wasm', import.meta.url);

const DB_FILES = {
  latest: './data/callsigns.sqlite.png',
  master: './data/master.sqlite.png',
};

// The deploy version stamp. Online it is the fresh commit SHA; offline it
// falls back to the version an offline copy was downloaded under (recorded in
// localStorage by the lookup page's offline control), so the database URL
// keeps matching the service worker's cached bytes. Mirrors app.js's
// getVersion - deliberately duplicated to keep both files dependency-free.
let versionPromise = null;
function getVersion() {
  versionPromise ??= (async () => {
    try {
      const res = await fetch(new URL('./data/version.txt', document.baseURI), { cache: 'no-store' });
      if (res.ok) return (await res.text()).trim();
    } catch { /* offline or missing - fall through to the offline marker */ }
    try {
      const markers = JSON.parse(localStorage.getItem('offline-db-state') ?? '{}');
      if (markers && typeof markers.version === 'string') return markers.version;
    } catch { /* storage unavailable */ }
    return 'dev';
  })();
  return versionPromise;
}

// Same .png / ?v= hosting workarounds as app.js (see the comments there).
const workers = {};
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
// only avoided.
function prepareSql(raw) {
  const sql = raw.trim().replace(/;+\s*$/, '');
  if (!/^\s*(select|with)\b/i.test(sql)) {
    throw new Error('read-only console: queries must start with SELECT or WITH');
  }
  return `SELECT * FROM (${sql}) LIMIT ${ROW_CAP + 1}`;
}

async function run() {
  const status = document.getElementById('sql-status');
  const result = document.getElementById('sql-result');
  const dbName = document.getElementById('db-select').value;
  const raw = document.getElementById('sql-input').value;
  if (raw.trim() === '') return;

  let sql;
  try {
    sql = prepareSql(raw);
  } catch (err) {
    status.textContent = String(err.message ?? err);
    return;
  }

  status.textContent = `querying ${dbName}… (first use downloads pages of the database as needed)`;
  result.hidden = true;
  const started = performance.now();
  try {
    const worker = await openDb(dbName);
    const rows = await worker.db.query(sql);
    const elapsed = ((performance.now() - started) / 1000).toFixed(1);
    const truncated = rows.length > ROW_CAP;
    const shown = truncated ? rows.slice(0, ROW_CAP) : rows;
    status.textContent = `${shown.length}${truncated ? `+ (capped at ${ROW_CAP})` : ''} row${shown.length === 1 ? '' : 's'} in ${elapsed}s`;
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
  } catch (err) {
    status.textContent = '';
    result.replaceChildren(el('p', { class: 'error', role: 'alert', text: `Query failed: ${String(err.message ?? err)}` }));
    result.hidden = false;
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
  { db: 'master', title: 'Every publication and its declared scope', sql: 'SELECT dataset, record_count, intended_complete, scope_notes FROM history_datasets ORDER BY dataset' },
  { db: 'master', title: 'One callsign across every publication', sql: "SELECT dataset, status, product FROM register_history WHERE callsign = 'G2CP' ORDER BY dataset" },
  { db: 'master', title: 'Every FOI-witnessed observation of a callsign', sql: "SELECT entry, vintage, status, licence_class, event, event_date FROM observations WHERE callsign = 'G2CP' ORDER BY vintage" },
  { db: 'master', title: 'NULL vs blank: the semantics in action', sql: "SELECT entry, status, CASE WHEN status IS NULL THEN 'not asserted by source' WHEN status = '' THEN 'asserted BLANK by source' ELSE 'asserted' END AS reading FROM observations WHERE callsign = 'G0TQK' ORDER BY entry" },
  { db: 'master', title: 'Licence-category mix in one publication (canonical, dataset-scoped)', sql: "SELECT normalised_licence_category, COUNT(*) AS n FROM register_history WHERE dataset = '2026-06-23' AND normalised_licence_category IS NOT NULL GROUP BY normalised_licence_category ORDER BY n DESC" },
];

function renderExamples() {
  const list = document.getElementById('example-list');
  for (const example of EXAMPLES) {
    const button = el('button', { type: 'button', class: 'example', text: example.title });
    button.addEventListener('click', () => {
      document.getElementById('db-select').value = example.db;
      document.getElementById('sql-input').value = example.sql;
      document.getElementById('sql-status').textContent = `loaded (${example.db} database) — press Run`;
    });
    list.append(button, el('span', { class: 'muted', text: ` ${example.db} ` }));
    list.append(el('br'));
  }
}

document.getElementById('sql-form').addEventListener('submit', (event) => {
  event.preventDefault();
  void run();
});
renderExamples();

// Offline-first (ADR 0008): register the service worker so the static shell
// (this page, its scripts and the vendored library) is cached and the site
// loads offline. The database itself is only cached when the visitor opts in
// from the lookup page; once cached, the worker serves it here too.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register(new URL('./sw.js', document.baseURI).href).catch(() => {});
}
