// Coordinated data browser ("hand-made crossfilter") for open-data entry
// pages. Progressive enhancement over the static "Browse the data" preview:
// a SQL-as-model engine where every affordance - facet chip, sidebar
// breakdown row, chart bar, per-column input - composes ONE query against
// the published master database scoped to THIS publication
// (WHERE dataset = key), run over HTTP range requests (same engine as the
// Explore page). With JS off the static preview is the complete, crawlable
// record; this only adds interactivity. Frameworkless; d3/crossfilter belong
// in the interactive downstream, not this static record.
//
// Two modes, Home-Assistant-style: FILTERS mode (facets + per-column inputs
// build a query you can view) and SQL mode (edit the composed query
// directly; once hand-edited the facets show a custom-query state). Paths
// resolve against import.meta.url (this file is at the site root; entry
// pages live three directories deep). The .png / ?v= hosting workarounds are
// the same as app.js.

import { COLUMNS, TOGGLES, PAGE_SIZES, buildPredicate, stateToViewParam, viewParamToState, applyViewToState, resolvedCallsignCore } from './browser-query.js';
import { callsignPillRaw } from './callsign-pill.js';
import { createHistorySync } from './history-sync.js';

const { createDbWorker } = window;
const workerUrl = new URL('./vendor/sqlite.worker.js', import.meta.url);
const wasmUrl = new URL('./vendor/sql-wasm.wasm', import.meta.url);

let workerPromise = null;
async function openMaster() {
  workerPromise ??= (async () => {
    let version = 'dev';
    try {
      const res = await fetch(new URL('./data/version.txt', import.meta.url), { cache: 'no-store' });
      if (res.ok) version = (await res.text()).trim();
    } catch { /* fall back to unversioned */ }
    const dbUrl = new URL(`./data/master.sqlite.png?v=${encodeURIComponent(version)}`, import.meta.url);
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
function codeCell(value) { const c = el('code'); c.textContent = value ?? ''; return c; }

// The raw callsign column: every character legible (whitespace, control,
// format and replacement characters become visible {markers}) inside the shared
// callsign-pill visual (issue #310). A non-link chip - the raw as-published
// bytes are data to inspect, not a navigation target - so the browser's
// transparency view is preserved while a callsign looks the same as everywhere
// else on the site.
function renderRawCallsign(raw) {
  return callsignPillRaw(el, raw);
}
function describeDiff(raw, cleaned) {
  const notes = [];
  if (/ /.test(raw)) notes.push('non-breaking space');
  if (/�/.test(raw)) notes.push('replacement character (encoding damage)');
  else if (/^\s|\s$/.test(raw)) notes.push('leading/trailing whitespace');
  else if (/\S[  ]+\S/.test(raw)) notes.push('space mid-callsign');
  if (raw.toUpperCase() !== raw) notes.push('lowercase letters');
  if (raw.replace(/[A-Za-z0-9/\s �]/g, '') !== '') notes.push('other non-standard characters');
  return notes.length > 0 ? notes.join('; ') : 'differs after cleaning';
}

const section = document.querySelector('.browser[data-dataset]');
if (section !== null) enhance(section);

function enhance(section) {
  const dataset = section.getAttribute('data-dataset');
  const staticView = section.querySelector('.browser-static');
  if (staticView === null) return;

  const state = {
    facets: new Map(),        // key -> { field, isExpr, values:Set, exclude:bool }
    toggles: new Set(),       // toggle ids present = active
    columnFilters: new Map(), // col -> raw input string
    sort: [{ col: 'callsign', dir: 'ASC' }], // multi-column: Shift/Ctrl-click appends
    pageSize: 25,
    page: 0,
    customSql: null,          // string => SQL mode
  };

  // --- UI scaffold, inserted before the static preview ---
  const chips = el('div', { class: 'chips' });
  const pills = el('div', { class: 'pills' });
  const toolbar = el('div', { class: 'browser-toolbar' });
  // role="status" makes the results line a polite live region, so a change in
  // the matching-row count - whether from a filter action or a back/forward
  // restore - is announced to assistive technology.
  const statusLine = el('p', { class: 'browser-status', role: 'status' });
  const result = el('div', { class: 'browser-result' });
  section.insertBefore(chips, staticView);
  section.insertBefore(pills, staticView);
  section.insertBefore(toolbar, staticView);
  section.insertBefore(statusLine, staticView);
  staticView.after(result);
  // The static preview was the no-JS fallback; once the live browser takes
  // over it is redundant, so hide it (it stays in the DOM for crawlers).
  staticView.hidden = true;

  // Toolbar: page size, pagination, SQL toggle.
  const sizeInput = el('input', { type: 'number', min: '1', max: '1000', value: '25', list: 'page-sizes', class: 'pagesize', 'aria-label': 'rows per page' });
  const sizeList = el('datalist', { id: 'page-sizes' }, PAGE_SIZES.map(s => el('option', { value: String(s) })));
  const prevBtn = el('button', { type: 'button', class: 'pg', text: '‹ prev' });
  const nextBtn = el('button', { type: 'button', class: 'pg', text: 'next ›' });
  const pageInfo = el('span', { class: 'pageinfo browser-status' });
  const sqlBtn = el('button', { type: 'button', class: 'pg', text: 'Edit SQL ▸' });
  const dlBtn = el('button', { type: 'button', class: 'pg', text: '↓ CSV' });
  const cmpBtn = el('button', { type: 'button', class: 'pg', title: 'compare this view across publications', text: 'compare ↗' });
  toolbar.append(el('label', { class: 'browser-status' }, ['rows/page ', sizeInput]), sizeList, prevBtn, nextBtn, pageInfo, sqlBtn, dlBtn, cmpBtn);

  // SQL box (collapsible). Shows the composed query; running it enters SQL mode.
  const sqlBox = el('details', { class: 'sqlbox' });
  sqlBox.append(el('summary', { text: 'SQL for the current view' }));
  const textarea = el('textarea', { rows: '4', spellcheck: 'false', 'aria-label': 'SQL query' });
  const runBtn = el('button', { type: 'button', class: 'run', text: 'Run as query' });
  const resetSqlBtn = el('button', { type: 'button', class: 'pg', text: 'Back to filters' });
  sqlBox.append(textarea, el('div', {}, [runBtn, ' ', resetSqlBtn]));
  section.insertBefore(sqlBox, result);

  // Schema reference (collapsible): the queryable surface a hand-written
  // query can reach, so composing SQL needs no trip to the data dictionary.
  // Two column groups mirror how the master's register_history is built:
  // canonical keys the mirror derives for EVERY publication, and source
  // columns carried from Ofcom's publication into the master's UNION schema -
  // present as columns for all rows but populated only for the publications
  // that actually carried them (e.g. the licence_version_* dates).
  const columnList = (cols) => el('ul', { class: 'schema-cols' },
    cols.map(([name, note]) => el('li', {}, note === undefined ? [codeCell(name)] : [codeCell(name), ` — ${note}`])));
  const schemaBox = el('details', { class: 'schema-ref' });
  schemaBox.append(el('summary', { text: 'Tables & columns' }));
  schemaBox.append(
    el('p', { class: 'browser-status', text: `Queries run against the published master database. In filters mode the scope is limited to this publication (WHERE dataset = '${dataset}') automatically; a hand-written query reaches every publication unless you add that clause yourself.` }),
    el('h4', { text: 'register_history' }),
    el('p', { class: 'browser-status', text: 'One row per callsign per publication.' }),
    el('p', { class: 'schema-group', text: 'Canonical keys (derived by the mirror, present for every publication):' }),
    columnList([
      ['dataset', 'the publication key'],
      ['cleaned', 'artefact-stripped join key'],
      ['suffix'],
      ['implied_class'],
      ['prefix_series'],
      ['parse_status'],
    ]),
    el('p', { class: 'schema-group', text: 'Source columns (carried from Ofcom’s publication into the UNION schema; a column is populated only where that publication carried it — e.g. the licence_version_* dates):' }),
    columnList([
      ['callsign', 'raw, as published'],
      ['status'],
      ['product'],
      ['type'],
      ['created_date'],
      ['last_modified_date'],
      ['licence_version_last_modified_date'],
      ['licence_version_original_start_date'],
    ]),
    el('h4', { text: 'ref_forbidden_suffixes' }),
    el('p', { class: 'browser-status', text: 'Ofcom’s withheld-suffix list.' }),
    columnList([['suffix']]),
  );
  section.insertBefore(schemaBox, result);

  // Interesting queries: curated starting points scoped to THIS
  // publication (KQL-editor style). Selecting one loads and runs it in SQL
  // mode; the facet UI then shows the custom-query state until reset. Only
  // always-present columns are used so no example errors on older variants.
  const EXAMPLES = [
    { title: 'Status × licence level (counts and %)', sql: `SELECT status, implied_class, COUNT(*) AS n,\n  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) AS pct\nFROM register_history WHERE dataset = '${dataset}'\nGROUP BY status, implied_class ORDER BY n DESC` },
    { title: 'Callsigns whose raw form needed cleaning', sql: `SELECT callsign, cleaned, status\nFROM register_history WHERE dataset = '${dataset}' AND callsign != cleaned\nORDER BY callsign` },
    // Dates + whether the callsign predates the forbidden list's first known
    // publication (Ofcom's August 2019 FOI). NULL start date -> 'unknown', not
    // a false 'no'. Date columns exist in the master's UNION schema (NULL for
    // publications that did not carry them).
    { title: 'Withheld-suffix callsigns — issued before the 2019 list?', sql: `SELECT callsign, status,\n  licence_version_original_start_date AS issued,\n  last_modified_date AS last_modified,\n  CASE WHEN licence_version_original_start_date IS NULL THEN 'unknown'\n       WHEN licence_version_original_start_date < '2019-08-01' THEN 'yes'\n       ELSE 'no' END AS predates_2019_list\nFROM register_history WHERE dataset = '${dataset}'\n  AND suffix IN (SELECT suffix FROM ref_forbidden_suffixes)\nORDER BY issued` },
    { title: 'Longest callsigns first', sql: `SELECT callsign, LENGTH(callsign) AS len, status, implied_class\nFROM register_history WHERE dataset = '${dataset}'\nORDER BY len DESC, callsign` },
    { title: 'Reserved callsigns by prefix (with level and %)', sql: `SELECT prefix_series, implied_class AS level, COUNT(*) AS n,\n  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) AS pct\nFROM register_history WHERE dataset = '${dataset}' AND status = 'Reserved'\nGROUP BY prefix_series ORDER BY n DESC` },
  ];
  const examplesBox = el('details', { class: 'examples' });
  examplesBox.append(el('summary', { text: 'Interesting queries' }));
  const exList = el('div', { class: 'exlist' });
  for (const ex of EXAMPLES) {
    const button = el('button', { type: 'button', class: 'exq', text: ex.title });
    button.addEventListener('click', () => { textarea.value = ex.sql; sqlBox.open = true; state.customSql = ex.sql; state.page = 0; void refresh(); });
    exList.append(button);
  }
  examplesBox.append(exList);
  section.insertBefore(examplesBox, result);

  // --- query construction (literal values, so the shown SQL runs as-is).
  // Scoped to THIS publication via the shared predicate builder's dataset
  // option; the comparison surface reuses the same builder without it. ---
  function filtersSql() {
    const where = buildPredicate(state, { dataset });
    const cols = COLUMNS.map(c => `"${c}"`).join(', ');
    const order = state.sort.map(s => `"${s.col}" ${s.dir}`).join(', ');
    return { inner: `SELECT ${cols} FROM register_history WHERE ${where} ORDER BY ${order}`, where };
  }

  function composedSql() {
    if (state.customSql !== null) return state.customSql;
    return filtersSql().inner;
  }

  // --- run + render ---
  async function refresh() {
    statusLine.textContent = 'querying this publication…';
    result.hidden = true;
    historySync.sync(); // keep the shareable ?view= link in sync (push on a discrete change, no-op otherwise)
    let inner; let countSql;
    if (state.customSql !== null) {
      inner = state.customSql;
      countSql = `SELECT COUNT(*) AS n FROM (${inner})`;
    } else {
      const q = filtersSql();
      inner = q.inner;
      countSql = `SELECT COUNT(*) AS n FROM register_history WHERE ${q.where}`;
    }
    try {
      const started = performance.now();
      const worker = await openMaster();
      const total = Number((await worker.db.query(countSql))[0].n);
      const maxPage = Math.max(0, Math.ceil(total / state.pageSize) - 1);
      if (state.page > maxPage) state.page = maxPage;
      const rows = await worker.db.query(`SELECT * FROM (${inner}) LIMIT ${state.pageSize} OFFSET ${state.page * state.pageSize}`);
      const elapsed = ((performance.now() - started) / 1000).toFixed(1);
      renderRows(rows, total, elapsed);
    } catch (err) {
      statusLine.textContent = `Query failed: ${String(err.message ?? err)}`;
    }
  }

  function renderRows(rows, total, elapsed) {
    const from = total === 0 ? 0 : state.page * state.pageSize + 1;
    const to = state.page * state.pageSize + rows.length;
    statusLine.textContent = `${total.toLocaleString('en-GB')} matching row${total === 1 ? '' : 's'} in ${elapsed}s`;
    pageInfo.textContent = total === 0 ? '' : `${from.toLocaleString('en-GB')}–${to.toLocaleString('en-GB')} of ${total.toLocaleString('en-GB')}`;
    prevBtn.disabled = state.page === 0;
    nextBtn.disabled = to >= total;
    textarea.value = composedSql();

    const custom = state.customSql !== null;
    // Custom-mode empty result has no columns to show, so a bare message. In
    // filters mode we keep the header + per-column filter row so an over-
    // narrow filter can be adjusted, not trap the user with a blank panel.
    if (custom && rows.length === 0) { result.replaceChildren(el('p', { class: 'browser-status', text: 'No matching rows.' })); result.hidden = false; return; }
    const showDiff = !custom && state.toggles.has('raw-cleaned');
    const headers = custom ? Object.keys(rows[0]) : [...COLUMNS, ...(showDiff ? ['difference'] : [])];
    const thead = el('thead');
    const headRow = el('tr');
    for (const h of headers) {
      const sortable = !custom && COLUMNS.includes(h);
      const si = state.sort.findIndex(s => s.col === h);
      const arrow = si >= 0 ? `${state.sort[si].dir === 'ASC' ? ' ▲' : ' ▼'}${state.sort.length > 1 ? String(si + 1) : ''}` : '';
      const th = el('th', sortable ? { role: 'button', tabindex: '0', class: 'sortable', title: 'click to sort; Shift-click to add a secondary sort' } : {}, [`${h}${arrow}`]);
      if (sortable) {
        // Shift/Ctrl/Alt-click appends a secondary sort; plain click resets
        // to a single-column sort, toggling direction if already sorting by it.
        const sortBy = (multi) => {
          const idx = state.sort.findIndex(s => s.col === h);
          if (multi) {
            if (idx >= 0) state.sort[idx].dir = state.sort[idx].dir === 'ASC' ? 'DESC' : 'ASC';
            else state.sort.push({ col: h, dir: 'ASC' });
          } else {
            const wasAscSingle = state.sort.length === 1 && idx === 0 && state.sort[0].dir === 'ASC';
            state.sort = [{ col: h, dir: wasAscSingle ? 'DESC' : 'ASC' }];
          }
          state.page = 0; void refresh();
        };
        th.addEventListener('click', e => sortBy(e.shiftKey || e.ctrlKey || e.altKey || e.metaKey));
        th.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sortBy(e.shiftKey); } });
      }
      headRow.append(th);
    }
    thead.append(headRow);
    // Per-column filter inputs (filters mode only).
    if (!custom) {
      const filterRow = el('tr', { class: 'colfilters' });
      for (const h of headers) {
        if (h === 'difference') { filterRow.append(el('th')); continue; }
        const input = el('input', { type: 'text', 'aria-label': `filter ${h}`, placeholder: '>= , * , !' });
        input.value = state.columnFilters.get(h) ?? '';
        const apply = () => { const v = input.value.trim(); if (v === '') state.columnFilters.delete(h); else state.columnFilters.set(h, v); state.page = 0; void refresh(); };
        input.addEventListener('change', apply);
        input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); apply(); } });
        filterRow.append(el('th', {}, [input]));
      }
      thead.append(filterRow);
    }
    const tbody = rows.length === 0
      ? el('tbody', {}, [el('tr', {}, [el('td', { colspan: String(headers.length), class: 'browser-status', text: 'No matching rows — adjust or clear the filters above.' })])])
      : el('tbody', {}, rows.map(r => el('tr', {}, headers.map(h => {
        if (h === 'callsign') return el('td', {}, [renderRawCallsign(r.callsign)]);
        if (h === 'cleaned') return el('td', {}, [codeCell(r.cleaned)]);
        if (h === 'difference') return el('td', { class: 'diffnote', text: describeDiff(r.callsign, r.cleaned ?? '') });
        return el('td', { text: r[h] === null ? 'NULL' : String(r[h]), class: r[h] === null ? 'browser-status' : '' });
      }))));
    const wrap = el('div', { class: 'overflow', style: 'overflow-x:auto' });
    wrap.append(el('table', {}, [thead, tbody]));
    result.replaceChildren(wrap);
    result.hidden = false;
    renderPills();
  }

  // --- active-filter pills ---
  function renderPills() {
    pills.replaceChildren();
    if (state.customSql !== null) {
      const pill = el('span', { class: 'pill custom' }, ['custom SQL — ', el('button', { type: 'button', 'aria-label': 'back to filters', text: 'reset ✕' })]);
      pill.querySelector('button').addEventListener('click', () => { state.customSql = null; state.page = 0; void refresh(); });
      pills.append(pill);
      return;
    }
    const add = (label, remove) => {
      const pill = el('span', { class: 'pill' }, [label, ' ', el('button', { type: 'button', 'aria-label': `remove ${label}`, text: '✕' })]);
      pill.querySelector('button').addEventListener('click', () => { remove(); state.page = 0; void refresh(); });
      pills.append(pill);
    };
    for (const f of state.facets.values()) {
      for (const v of f.values) add(`${f.label} ${f.exclude ? '≠' : '='} ${v === '' ? '(blank)' : v}`, () => { f.values.delete(v); if (f.values.size === 0) state.facets.delete(f.key); });
    }
    for (const id of state.toggles) add(TOGGLES[id].label, () => state.toggles.delete(id));
    for (const [col, raw] of state.columnFilters) {
      // A regional-variant callsign search resolves to its canonical register
      // core (the same normalisation the index lookup applies); surface that
      // resolution so the extra matched row isn't a surprise (MW7TEE → M7TEE).
      const core = resolvedCallsignCore(col, raw);
      add(`${col}: ${raw}${core !== null ? ` → ${core}` : ''}`, () => state.columnFilters.delete(col));
    }
  }

  // --- filter triggers (sidebar rows, chart bars, chips) ---
  function facetKeyOf(node) {
    const explicit = node.getAttribute('data-filter-label');
    const expr = node.getAttribute('data-filter-expr');
    if (expr !== null) return { key: expr, field: expr, isExpr: true, label: explicit ?? node.closest('.bd,figure')?.querySelector('h3,figcaption')?.textContent?.trim() ?? expr };
    const col = node.getAttribute('data-filter-col');
    return { key: col, field: col, isExpr: false, label: explicit ?? col };
  }
  function toggleFacetValue(node) {
    const { key, field, isExpr, label } = facetKeyOf(node);
    const value = node.getAttribute('data-filter-val');
    let facet = state.facets.get(key);
    if (facet === undefined) { facet = { key, field, isExpr, label, values: new Set(), exclude: false }; state.facets.set(key, facet); }
    if (facet.values.has(value)) facet.values.delete(value); else facet.values.add(value);
    if (facet.values.size === 0) state.facets.delete(key);
    state.customSql = null; state.page = 0; void refresh();
    section.scrollIntoView({ block: 'start' });
  }
  for (const node of document.querySelectorAll('[data-filter-col],[data-filter-expr]')) {
    const trigger = (e) => { if (e.target.closest('a') !== null) return; toggleFacetValue(node); };
    node.addEventListener('click', trigger);
    node.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); trigger(e); } });
  }

  // Notable "compound filter" links carry a full data-browser-sql query (a
  // preset that facets can't express as one predicate, e.g. forbidden AND
  // issued-since-2019). Clicking loads it as a custom query and runs it;
  // <a href="#"> for link styling, so preventDefault the jump.
  for (const node of document.querySelectorAll('[data-browser-sql]')) {
    const sql = node.getAttribute('data-browser-sql');
    const go = (e) => { if (e) e.preventDefault(); textarea.value = sql; sqlBox.open = true; state.customSql = sql; state.page = 0; void refresh(); section.scrollIntoView({ block: 'start' }); };
    node.addEventListener('click', go);
    node.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(e); } });
  }

  // Quick chips: reset + the two boolean toggles.
  const chipDefs = [
    { label: 'clear filters', run: () => { state.facets.clear(); state.toggles.clear(); state.columnFilters.clear(); state.customSql = null; state.page = 0; } },
    ...Object.entries(TOGGLES).map(([id, t]) => ({ label: t.label, toggle: id })),
  ];
  const chipEls = [];
  for (const def of chipDefs) {
    const chip = el('span', { class: 'chip', role: 'button', tabindex: '0', text: def.label });
    const fire = () => {
      if (def.run) def.run();
      else { if (state.toggles.has(def.toggle)) state.toggles.delete(def.toggle); else state.toggles.add(def.toggle); state.customSql = null; state.page = 0; }
      syncChips(); void refresh();
    };
    chip.addEventListener('click', fire);
    chip.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fire(); } });
    chipEls.push({ def, chip }); chips.append(chip);
  }
  function syncChips() { for (const { def, chip } of chipEls) chip.classList.toggle('active', def.toggle !== undefined && state.toggles.has(def.toggle)); }

  // Toolbar wiring.
  sizeInput.addEventListener('change', () => { const n = Math.max(1, Math.min(1000, Number(sizeInput.value) || 25)); state.pageSize = n; sizeInput.value = String(n); state.page = 0; void refresh(); });
  prevBtn.addEventListener('click', () => { if (state.page > 0) { state.page -= 1; void refresh(); } });
  nextBtn.addEventListener('click', () => { state.page += 1; void refresh(); });
  sqlBtn.addEventListener('click', () => { sqlBox.open = true; textarea.value = composedSql(); textarea.focus(); });
  runBtn.addEventListener('click', () => {
    const raw = textarea.value.trim().replace(/;+\s*$/, '');
    if (!/^\s*(select|with)\b/i.test(raw)) { statusLine.textContent = 'read-only: queries must start with SELECT or WITH'; return; }
    state.customSql = raw; state.page = 0; void refresh();
  });
  resetSqlBtn.addEventListener('click', () => { state.customSql = null; state.page = 0; void refresh(); });

  // --- shareable state: the current filters live in a ?view= query param
  // (a query param, not the hash, so it doesn't clash with the :target
  // inspect tabs), so any filtered view is a bookmarkable / shareable link.
  // Discrete actions push a history entry (via historySync); back/forward
  // replay them through restore(). ---
  function buildUrl() {
    const url = new URL(window.location.href);
    const param = stateToViewParam(state);
    if (param === null) url.searchParams.delete('view');
    else url.searchParams.set('view', param); // searchParams handles encoding
    return url.toString();
  }
  // The single restore path shared by first load and popstate: read the ?view=
  // link, apply it wholesale to state (absent pieces reset to defaults), resync
  // the UI and re-render. Re-render's own sync() is a no-op here because the URL
  // already matches, so restoring never itself writes history.
  function restore() {
    applyViewToState(state, viewParamToState(new URL(window.location.href).searchParams.get('view')));
    state.page = 0;
    sizeInput.value = String(state.pageSize);
    if (state.customSql !== null) { textarea.value = state.customSql; sqlBox.open = true; }
    syncChips();
    void refresh();
  }
  const historySync = createHistorySync({ getUrl: buildUrl, onPopState: restore });

  // --- download the current view as CSV, with a query/meta comment header ---
  const DOWNLOAD_CAP = 20000;
  const csvField = (v) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  async function downloadCsv() {
    const prev = dlBtn.textContent;
    dlBtn.disabled = true; dlBtn.textContent = '…';
    try {
      const inner = state.customSql !== null ? state.customSql : filtersSql().inner;
      const worker = await openMaster();
      const rows = await worker.db.query(`SELECT * FROM (${inner}) LIMIT ${DOWNLOAD_CAP + 1}`);
      const truncated = rows.length > DOWNLOAD_CAP;
      const shown = truncated ? rows.slice(0, DOWNLOAD_CAP) : rows;
      const headers = shown.length > 0 ? Object.keys(shown[0]) : [];
      const lines = [
        `# UK amateur callsign register — publication ${dataset}`,
        `# query: ${inner.replace(/\s+/g, ' ')}`,
        `# rows: ${shown.length}${truncated ? ` (capped at ${DOWNLOAD_CAP.toLocaleString('en-GB')})` : ''}`,
        `# generated: ${new Date().toISOString()}`,
        `# source: this data mirror (derived from Ofcom's open-data publication)`,
        headers.map(csvField).join(','),
        ...shown.map(r => headers.map(h => csvField(r[h])).join(',')),
      ];
      const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = el('a', { href: url, download: `${dataset}-view.csv` });
      document.body.append(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      if (truncated) statusLine.textContent = `Downloaded ${DOWNLOAD_CAP.toLocaleString('en-GB')} rows (capped) — narrow the filters for the full set.`;
    } catch (err) {
      statusLine.textContent = `Download failed: ${String(err.message ?? err)}`;
    } finally {
      dlBtn.disabled = false; dlBtn.textContent = prev;
    }
  }
  dlBtn.addEventListener('click', () => void downloadCsv());

  // Hand off the current view to the cross-publication comparison surface:
  // carry the live filter state as ?view= (the same format the compare page
  // reads) and pre-select THIS publication. compare.html sits at the site
  // root next to this module, so resolve it against import.meta.url and it
  // works regardless of how deep the entry page is.
  cmpBtn.addEventListener('click', () => {
    const param = stateToViewParam(state);
    const cmp = new URL('./compare.html', import.meta.url);
    if (param !== null) cmp.searchParams.set('view', param);
    cmp.searchParams.set('datasets', dataset);
    window.location.href = cmp.toString();
  });

  restore();
}
