// Cross-publication comparison surface (issue #199): run ONE filter across
// several publications and surface the differences. Progressive enhancement,
// frameworkless, same sql.js-httpvfs range-request engine as explore.js /
// app.js. It shares the query core (buildPredicate, ?view= round-trip) with
// the single-publication browser via browser-query.js, so a selection made
// there carries here unchanged - the predicate is dataset-agnostic and gets
// applied per publication.
//
// Honesty by construction: the differences are computed on the artefact-safe
// `cleaned` join key over the FILTERED cohort, in-browser set-diffs are gated
// by cohort size (a whole-register diff belongs on the downloaded database),
// and declared-partial / coverage-affecting publications carry a loud caveat
// because absence there is scope, not removal (issues #182-#184).

import { buildPredicate, parseFilterState, serializeFilterState, matchingCountSql, setDiffSql, TOGGLES } from './browser-query.js';

const { createDbWorker } = window;
const workerUrl = new URL('./vendor/sqlite.worker.js', import.meta.url);
const wasmUrl = new URL('./vendor/sql-wasm.wasm', import.meta.url);

let workerPromise = null;
async function openMaster() {
  workerPromise ??= (async () => {
    let version = 'dev';
    try {
      const res = await fetch(new URL('./data/version.txt', document.baseURI), { cache: 'no-store' });
      if (res.ok) version = (await res.text()).trim();
    } catch { /* fall back to unversioned */ }
    const dbUrl = new URL(`./data/master.sqlite.png?v=${encodeURIComponent(version)}`, document.baseURI);
    return createDbWorker(
      [{ from: 'inline', config: { serverMode: 'full', url: dbUrl.toString(), requestChunkSize: 4096 } }],
      workerUrl.toString(), wasmUrl.toString());
  })();
  return workerPromise;
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (k === 'text') node.textContent = v; else node.setAttribute(k, v); }
  for (const c of children) node.append(c);
  return node;
}
function code(v) { const c = el('code'); c.textContent = v ?? ''; return c; }
const nf = (n) => Number(n).toLocaleString('en-GB');

// A cohort larger than this per side is not set-diffed in the browser: the
// scan is honest work better done on the downloaded database. Counts still
// show; the diff panel explains why and points to the download.
const DIFF_CAP = 25000;
const SAMPLE = 50; // rows shown per difference category

const state = {
  facets: new Map(), toggles: new Set(), columnFilters: new Map(),
  sort: [{ col: 'callsign', dir: 'ASC' }], pageSize: 25, customSql: null,
};
const selected = new Set();      // dataset keys chosen for comparison
let datasets = [];               // [{ dataset, record_count, intended_complete, scope_notes, coverage_affecting }]

const setup = document.getElementById('setup');
const picker = document.getElementById('dataset-picker');
const filterNote = document.getElementById('filter-note');
const scopeNote = document.getElementById('scope-note');
const countsSection = document.getElementById('counts');
const countsResult = document.getElementById('counts-result');
const diffSection = document.getElementById('diff');
const diffResult = document.getElementById('diff-result');
const sqlSection = document.getElementById('sql');
const sqlText = document.getElementById('sql-text');
const bootStatus = document.getElementById('boot-status');

// A publication whose declared coverage is partial, or that carries a
// coverage-affecting quality observation: presence differences against it are
// not add/remove events.
function scopeCaveat(d) {
  if (d === undefined) return null;
  if (d.intended_complete === 'false') return 'declared partial';
  if ((d.coverage_affecting ?? '') !== '') return 'coverage-affecting observation';
  if (d.intended_complete === '' || d.intended_complete === undefined) return 'coverage not declared';
  return null;
}
function datasetOf(key) { return datasets.find(d => d.dataset === key); }

// The dataset-agnostic predicate shared with the single-publication browser.
// A custom-SQL ?view= is tied to one publication, so it cannot be compared
// automatically - the caller checks state.customSql before using this.
function predicate() { return buildPredicate(state); }

function restoreFromUrl() {
  const url = new URL(window.location.href);
  const rawView = url.searchParams.get('view');
  if (rawView !== null) {
    try {
      const parsed = parseFilterState(JSON.parse(rawView));
      if (parsed.facets !== undefined) state.facets = parsed.facets;
      if (parsed.toggles !== undefined) state.toggles = parsed.toggles;
      if (parsed.columnFilters !== undefined) state.columnFilters = parsed.columnFilters;
      if (parsed.sort !== undefined) state.sort = parsed.sort;
      if (parsed.customSql !== undefined) state.customSql = parsed.customSql;
    } catch { /* ignore a malformed link */ }
  }
  const rawSets = url.searchParams.get('datasets');
  if (rawSets !== null) for (const k of rawSets.split(',')) if (k !== '') selected.add(k);
}
function writeUrl() {
  const url = new URL(window.location.href);
  const view = serializeFilterState(state);
  if (Object.keys(view).length === 0) url.searchParams.delete('view');
  else url.searchParams.set('view', JSON.stringify(view));
  if (selected.size === 0) url.searchParams.delete('datasets');
  else url.searchParams.set('datasets', [...selected].join(','));
  window.history.replaceState(null, '', url);
}

// A human description of the inherited filter, so the page states plainly
// what is being compared.
function describeFilter() {
  if (state.customSql !== null) return 'a custom SQL query';
  const parts = [];
  for (const f of state.facets.values()) {
    if (f.values.size === 0) continue;
    parts.push(`${f.label} ${f.exclude ? '≠' : '='} ${[...f.values].map(v => v === '' ? '(blank)' : v).join(' / ')}`);
  }
  for (const id of state.toggles) if (TOGGLES[id] !== undefined) parts.push(TOGGLES[id].label);
  for (const [colName, raw] of state.columnFilters) parts.push(`${colName}: ${raw}`);
  return parts.length === 0 ? 'all rows (no filter — add filters in a publication browser and choose “compare”)' : parts.join('; ');
}

async function boot() {
  try {
    const worker = await openMaster();
    datasets = await worker.db.query('SELECT dataset, record_count, intended_complete, scope_notes, coverage_affecting FROM history_datasets ORDER BY dataset DESC');
  } catch (err) {
    bootStatus.textContent = `Could not load publications: ${String(err.message ?? err)}`;
    return;
  }
  restoreFromUrl();
  // Default selection when none arrived in the link: the two most recent
  // publications with no scope caveat at all (declared complete, no
  // coverage-affecting observation) - the cleanest baseline pair to diff.
  if (selected.size === 0) {
    const clean = datasets.filter(d => scopeCaveat(d) === null);
    for (const d of (clean.length >= 2 ? clean : datasets).slice(0, 2)) selected.add(d.dataset);
  }
  bootStatus.hidden = true;
  filterNote.textContent = `Comparing: ${describeFilter()}.`;
  renderPicker();
  setup.hidden = false;
  void refresh();
}

function renderPicker() {
  picker.replaceChildren();
  for (const d of datasets) {
    const caveat = scopeCaveat(d);
    const id = `ds-${d.dataset}`;
    const input = el('input', { type: 'checkbox', id, value: d.dataset });
    if (selected.has(d.dataset)) input.setAttribute('checked', 'checked');
    input.addEventListener('change', () => {
      if (input.checked) selected.add(d.dataset); else selected.delete(d.dataset);
      void refresh();
    });
    const label = el('label', { for: id, class: 'cmp-ds' }, [
      input, ' ', el('strong', { text: d.dataset }),
      ` — ${nf(d.record_count)} rows`,
      ...(caveat !== null ? [' ', el('span', { class: 'cmp-badge', title: d.scope_notes ?? '', text: caveat })] : []),
    ]);
    picker.append(label);
  }
}

async function refresh() {
  writeUrl();
  if (state.customSql !== null) {
    countsSection.hidden = false; diffSection.hidden = true; sqlSection.hidden = true;
    countsResult.replaceChildren(el('p', { class: 'muted' }, [
      'This view uses a custom SQL query, which is tied to a single publication and cannot be compared automatically. Open it in the ',
      el('a', { href: 'explore.html', text: 'Explore console' }), ' to run it against other publications by hand.',
    ]));
    return;
  }
  const chosen = datasets.filter(d => selected.has(d.dataset)).map(d => d.dataset).sort();
  scopeNote.textContent = '';
  if (chosen.length === 0) {
    countsSection.hidden = true; diffSection.hidden = true; sqlSection.hidden = true;
    scopeNote.textContent = 'Select one or more publications to compare.';
    return;
  }
  const pred = predicate();
  await renderCounts(chosen, pred);
  renderSql(chosen, pred);
  await renderDiff(chosen, pred);
}

async function renderCounts(chosen, pred) {
  countsSection.hidden = false;
  // A trivial predicate matches every row, so the answer is already known -
  // history_datasets.record_count - and no whole-register scan over range
  // requests is needed. Only a real filter costs a query.
  const trivial = pred === '1=1';
  if (!trivial) countsResult.replaceChildren(el('p', { class: 'muted', text: 'Counting… (scans each publication over HTTP range requests — a few seconds)' }));
  const rows = [];
  let worker = null;
  for (const key of chosen) {
    const d = datasetOf(key);
    const total = Number(d?.record_count ?? 0);
    let matching = total;
    if (!trivial) {
      try {
        worker ??= await openMaster();
        const r = await worker.db.query(matchingCountSql(key, pred));
        matching = Number(r[0].n);
      } catch (err) { countsResult.replaceChildren(el('p', { class: 'muted', text: `Query failed: ${String(err.message ?? err)}` })); return; }
    }
    rows.push({ key, matching, total, caveat: scopeCaveat(d) });
  }
  // Cache the cohort sizes for the diff gate.
  countCache.clear();
  for (const r of rows) countCache.set(r.key, r.matching);

  const thead = el('thead', {}, [el('tr', {}, ['publication', 'matching rows', 'of total', '% of publication', 'scope'].map(h => el('th', { text: h })))]);
  const tbody = el('tbody', {}, rows.map(r => el('tr', {}, [
    el('td', {}, [code(r.key)]),
    el('td', { text: nf(r.matching) }),
    el('td', { class: 'muted', text: nf(r.total) }),
    el('td', { text: r.total > 0 ? `${(100 * r.matching / r.total).toFixed(2)}%` : '—' }),
    el('td', { class: 'muted', text: r.caveat ?? '' }),
  ])));
  const wrap = el('div', { class: 'overflow', style: 'overflow-x:auto' }, [el('table', {}, [thead, tbody])]);
  countsResult.replaceChildren(wrap);
}
const countCache = new Map();

async function renderDiff(chosen, pred) {
  if (chosen.length !== 2) {
    diffSection.hidden = false;
    diffResult.replaceChildren(el('p', { class: 'muted', text: chosen.length < 2 ? 'Select a second publication to see what changed.' : 'Set-differences compare a pair — select exactly two publications.' }));
    return;
  }
  diffSection.hidden = false;
  const [a, b] = chosen; // chosen is sorted ascending, so a is the earlier baseline
  const da = datasetOf(a); const db = datasetOf(b);
  const caveats = [];
  if (scopeCaveat(da) !== null) caveats.push(`${a} is ${scopeCaveat(da)}`);
  if (scopeCaveat(db) !== null) caveats.push(`${b} is ${scopeCaveat(db)}`);

  const sizeA = countCache.get(a) ?? Infinity;
  const sizeB = countCache.get(b) ?? Infinity;
  if (Math.max(sizeA, sizeB) > DIFF_CAP) {
    diffResult.replaceChildren(el('p', { class: 'muted' }, [
      `The filtered cohort is large (${nf(Math.max(sizeA, sizeB))} rows) — an in-browser set-diff over HTTP range requests would be slow. Narrow the filter, or run it on the `,
      el('a', { href: 'datasets/index.html', text: 'downloaded master database' }), '.',
    ]));
    return;
  }

  diffResult.replaceChildren(el('p', { class: 'muted', text: `Comparing ${a} → ${b}…` }));
  let worker;
  try { worker = await openMaster(); } catch (err) { diffResult.replaceChildren(el('p', { class: 'muted', text: String(err.message ?? err) })); return; }

  const diff = setDiffSql(a, b, pred);
  let appeared; let disappeared; let changed;
  try {
    appeared = await worker.db.query(diff.appeared);
    disappeared = await worker.db.query(diff.disappeared);
    changed = await worker.db.query(diff.changed);
  } catch (err) { diffResult.replaceChildren(el('p', { class: 'muted', text: `Diff failed: ${String(err.message ?? err)}` })); return; }

  const nodes = [];
  if (caveats.length > 0) {
    nodes.push(el('p', { class: 'cmp-warn' }, [
      el('strong', { text: 'Scope caveat: ' }),
      `${caveats.join('; ')}. Absence in such a publication is not evidence of removal — read “appeared”/“disappeared” below as presence changes in these exports, not licensing events.`,
    ]));
  }
  const presentLabel = caveats.length > 0 ? 'present only in' : 'appeared in';
  const absentLabel = caveats.length > 0 ? 'absent from' : 'disappeared by';
  nodes.push(diffBlock(`${presentLabel} ${b} (not in ${a})`, appeared, ['callsign', 'cleaned', 'status']));
  nodes.push(diffBlock(`${absentLabel} ${b} (was in ${a})`, disappeared, ['callsign', 'cleaned', 'status']));
  nodes.push(diffBlock(`status changed ${a} → ${b}`, changed, ['callsign', 'cleaned', 'status_before', 'status_after']));
  // cleaned is a deliberately non-unique join key: a callsign listed twice in
  // one publication (a stripped-collision, e.g. "G6 FMU" and "G6FMU") counts
  // as two rows here, so these are row counts, not distinct-callsign counts.
  nodes.push(el('p', { class: 'muted', text: 'Counts are rows on the cleaned join key; a callsign listed twice in a publication (a stripped-collision) counts twice.' }));
  diffResult.replaceChildren(...nodes);
}

function diffBlock(title, rows, columns) {
  const shown = rows.slice(0, SAMPLE);
  const details = el('details', { class: 'cmp-diffblock' });
  details.append(el('summary', {}, [el('strong', { text: `${nf(rows.length)} ` }), title]));
  if (rows.length === 0) { details.append(el('p', { class: 'muted', text: 'none' })); return details; }
  const thead = el('thead', {}, [el('tr', {}, columns.map(h => el('th', { text: h })))]);
  const tbody = el('tbody', {}, shown.map(r => el('tr', {}, columns.map(h => (h === 'callsign' || h === 'cleaned') ? el('td', {}, [code(r[h])]) : el('td', { text: r[h] === null ? 'NULL' : String(r[h]) })))));
  details.append(el('div', { class: 'overflow', style: 'overflow-x:auto' }, [el('table', {}, [thead, tbody])]));
  if (rows.length > SAMPLE) details.append(el('p', { class: 'muted', text: `showing ${SAMPLE} of ${nf(rows.length)}` }));
  return details;
}

function renderSql(chosen, pred) {
  sqlSection.hidden = false;
  const counts = chosen.map(k => `SELECT '${k}' AS publication, COUNT(*) AS matching\nFROM register_history WHERE dataset = '${k}' AND (${pred})`).join('\nUNION ALL\n');
  sqlText.textContent = counts + '\nORDER BY publication;';
}

boot();
