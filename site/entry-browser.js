// @ts-check
// Coordinated data browser ("hand-made crossfilter") for open-data entry
// pages. Progressive enhancement over the static "Browse the data" preview:
// a SQL-as-model engine where every affordance - facet chip, sidebar
// breakdown row, chart bar, per-column input - composes ONE query against
// the published combined database scoped to THIS publication
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
import { callsignPillLink, callsignPillRaw } from './callsign-pill.js';
import { createHistorySync } from './history-sync.js';
import { withDatabaseLoading } from './db-loading.js';
import { licenceField, statusField } from './field-wrappers.js';
import { nextSort as coreNextSort } from './table-sort.js';

/** @typedef {import('./browser-query.js').FilterState} FilterState */
/** @typedef {import('./browser-query.js').Facet} Facet */
/** @typedef {import('./browser-query.js').SortEntry} SortEntry */

// This browser holds its sort in the shared FilterState shape (browser-query.js:
// { col, dir } with verbose 'ASC'/'DESC' directions — the form the ORDER BY reads
// directly and the ?view= link carries), while the sort-state TRANSITIONS are the
// shared table-sort core's, so this surface and every other sortable table on the
// site cannot drift apart. These two adapters map a SortEntry across that edge: to
// the core's compact { key, dir } for a transition, and back to this shape after.
//
// A direction is treated as ascending ONLY when it is exactly 'ASC', matching the
// transition rule this browser has always applied (a strict `dir === 'ASC'` test):
// a well-formed 'DESC', and any non-canonical value a stale or hand-edited ?view=
// link can carry (browser-query parses sort.dir from untrusted JSON without
// normalising it), both count as descending. Preserving that exact predicate
// keeps the first toggle off such a value identical to the pre-shared behaviour
// rather than diverging on untrusted input.
/** @param {SortEntry} entry @returns {import('./table-sort.js').SortEntry} */
function toCoreSort(entry) { return { key: entry.col, dir: entry.dir === 'ASC' ? 'asc' : 'desc' }; }
/** @param {import('./table-sort.js').SortEntry} entry @returns {SortEntry} */
function toLocalSort(entry) { return { col: entry.key, dir: entry.dir === 'desc' ? 'DESC' : 'ASC' }; }

// The live state this browser holds: the shared FilterState (facets/toggles/
// columnFilters/sort/pageSize/customSql - see browser-query.js) plus the
// current page, which is this surface's own concern (the comparison surface
// has no pagination).
/** @typedef {FilterState & { page: number }} EntryBrowserState */

// The row shape read back off the httpvfs worker's query() is not typed by the
// vendored library (no shipped types); every SELECT here states its own column
// use inline, exactly as ledger-query.js's QueryExecutor does for the ledger
// database. window.createDbWorker's own signature is declared once in
// global.d.ts, shared with app.js/compare.js/explore.js.
/** @typedef {{ db: { query: (sql: string, params?: unknown[]) => Promise<any[]> } }} DbWorker */

// A row from either the filters-mode SELECT (whose columns are exactly
// COLUMNS - all textual register columns) or a hand-written custom query
// (whose columns are named by the query itself, e.g. a COUNT(*) alias). The
// two columns the rendering special-cases by name are always textual
// register data; anything else is read generically as text, number or NULL.
/** @typedef {{ callsign: string, cleaned: string, [column: string]: string | number | null }} QueryRow */

const { createDbWorker } = window;
const workerUrl = new URL('./vendor/sqlite.worker.js', import.meta.url);
const wasmUrl = new URL('./vendor/sql-wasm.wasm', import.meta.url);

/** @type {Promise<DbWorker> | null} */
let workerPromise = null;
/** @returns {Promise<DbWorker>} */
async function openCombined() {
  workerPromise ??= (async () => {
    let version = 'dev';
    try {
      const res = await fetch(new URL('./data/version.txt', import.meta.url), { cache: 'no-store' });
      if (res.ok) version = (await res.text()).trim();
    } catch { /* fall back to unversioned */ }
    const dbUrl = new URL(`./data/ledger-history.sqlite.png?v=${encodeURIComponent(version)}`, import.meta.url);
    return createDbWorker(
      [{ from: 'inline', config: { serverMode: 'full', url: dbUrl.toString(), requestChunkSize: 4096 } }],
      workerUrl.toString(), wasmUrl.toString());
  })();
  return workerPromise;
}

// Mirrors document.createElement's own overload shape: a known tag name
// returns its specific HTMLElement subtype (so callers get .value/.open/
// .disabled etc. without a cast), while the plain-string fallback overload
// keeps this assignable where a caller wants the dependency-injected
// ElementFactory shape (e.g. callsignPillRaw), which knows only "some tag,
// some HTMLElement".
/**
 * @template {keyof HTMLElementTagNameMap} K
 * @overload
 * @param {K} tag
 * @param {Record<string, string>} [attrs]
 * @param {(Node | string)[]} [children]
 * @returns {HTMLElementTagNameMap[K]}
 */
/**
 * @overload
 * @param {string} tag
 * @param {Record<string, string>} [attrs]
 * @param {(Node | string)[]} [children]
 * @returns {HTMLElement}
 */
/**
 * @param {string} tag
 * @param {Record<string, string>} [attrs]
 * @param {(Node | string)[]} [children]
 */
function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (k === 'text') node.textContent = v; else node.setAttribute(k, v); }
  for (const c of children) node.append(c);
  return node;
}
/** @param {unknown} value */
function codeCell(value) {
  const c = el('code');
  if (value == null) { c.textContent = ''; return c; }
  // Narrowed to a type with its own toString() (not TS's `{}`/Object.prototype
  // reading), so the display value renders exactly as `String(value)` always
  // has - including "[object Object]" for the rare non-primitive.
  /** @type {{ toString(): string }} */
  const displayable = value;
  c.textContent = String(displayable);
  return c;
}

// The raw callsign column: every character legible (whitespace, control,
// format and replacement characters become visible {markers}) inside the shared
// callsign-pill visual (issue #310). A non-link chip - the raw as-published
// bytes are data to inspect, not a navigation target - so the browser's
// transparency view is preserved while a callsign looks the same as everywhere
// else on the site.
/** @param {string} raw */
function renderRawCallsign(raw) {
  return callsignPillRaw(el, raw);
}
// The cleaned (artefact-stripped join key) column: this IS the register's own
// callsign, so - unlike the raw column above - it links to its canonical
// per-callsign page (callsign.html, issue #594), the same shared pill every
// other results surface uses.
/** @param {string} cleaned */
function renderCleanedCallsign(cleaned) {
  return callsignPillLink(el, cleaned);
}
/** @param {string} raw */
function describeDiff(raw) {
  const notes = [];
  if (/ /.test(raw)) notes.push('non-breaking space');
  if (/�/.test(raw)) notes.push('replacement character (encoding failure)');
  else if (/^\s|\s$/.test(raw)) notes.push('leading/trailing whitespace');
  else if (/\S[  ]+\S/.test(raw)) notes.push('space mid-callsign');
  if (raw.toUpperCase() !== raw) notes.push('lowercase letters');
  if (raw.replace(/[A-Za-z0-9/\s �]/g, '') !== '') notes.push('other non-standard characters');
  return notes.length > 0 ? notes.join('; ') : 'differs after cleaning';
}

const bootSection = /** @type {HTMLElement | null} */ (document.querySelector('.browser[data-dataset]'));
if (bootSection !== null) enhance(bootSection);

// Exported (and the combined opener is injectable) so a JSDOM test can drive the
// eager first-load path against a controlled opener - asserting the shared
// loading affordance is engaged - without opening a real range-request worker.
// In the browser it runs with the module's memoised openCombined.
/**
 * @param {HTMLElement} section
 * @param {{ openCombined?: () => Promise<DbWorker> }} [options]
 */
export function enhance(section, { openCombined: openCombinedFn = openCombined } = {}) {
  // Guaranteed present: this module only ever enhances a `.browser[data-dataset]`
  // section (the module's own bootstrap selector, or the test scaffold that
  // mirrors it), and the server-rendered markup always stamps the attribute.
  const dataset = /** @type {string} */ (section.getAttribute('data-dataset'));
  const staticView = /** @type {HTMLElement | null} */ (section.querySelector('.browser-static'));
  if (staticView === null) return;

  /** @type {EntryBrowserState} */
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
  // Assertive alert for a load FAILURE, owned by the shared loading affordance
  // (issue #499). Hidden until raised; role="alert" so assistive tech announces
  // a failed cold open of the combined database, distinct from the polite status.
  const alertEl = el('p', { class: 'db-alert', role: 'alert', hidden: '' });
  const result = el('div', { class: 'browser-result' });
  section.insertBefore(chips, staticView);
  section.insertBefore(pills, staticView);
  section.insertBefore(toolbar, staticView);
  section.insertBefore(statusLine, staticView);
  section.insertBefore(alertEl, staticView);
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
  // Two column groups mirror how the combined's register_history is built:
  // canonical keys the mirror derives for EVERY publication, and source
  // columns carried from Ofcom's publication into the combined's UNION schema -
  // present as columns for all rows but populated only for the publications
  // that actually carried them (e.g. the licence_version_* dates).
  /** @param {[string, string?][]} cols */
  const columnList = (cols) => el('ul', { class: 'schema-cols' },
    cols.map(([name, note]) => el('li', {}, note === undefined ? [codeCell(name)] : [codeCell(name), ` — ${note}`])));
  const schemaBox = el('details', { class: 'schema-ref' });
  schemaBox.append(el('summary', { text: 'Tables & columns' }));
  schemaBox.append(
    el('p', { class: 'browser-status', text: `Queries run against the published combined database. In filters mode the scope is limited to this publication (WHERE dataset = '${dataset}') automatically; a hand-written query reaches every publication unless you add that clause yourself.` }),
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
    // Dates + whether each withheld-suffix callsign's LICENCE-VERSION ORIGINAL
    // START post-dates its own suffix's first-known-forbidden date, read
    // straight from the forbidden-suffix-issued-after-first-known-list flag
    // (per-suffix, not a flat list-wide date). This is the licence chain's
    // original start, NOT the callsign's issuance (#915/#918): for a recently-
    // introduced series it can be carried licence history (e.g. M9RAF, carried
    // origin 2024-12-21), so the query is licence-scoped, not issuance-scoped.
    // NULL start date -> 'unknown', not a false answer. Date columns exist in
    // the combined's UNION schema (NULL for publications that did not carry them).
    { title: 'Withheld-suffix callsigns — licence-version start before or after first known forbidden?', sql: `SELECT callsign, status,\n  licence_version_original_start_date AS licence_start,\n  last_modified_date AS last_modified,\n  CASE WHEN ';' || flags || ';' LIKE '%;forbidden-suffix-issued-after-first-known-list;%' THEN 'starts after'\n       WHEN licence_version_original_start_date IS NULL THEN 'unknown'\n       ELSE 'predates' END AS licence_start_vs_withholding\nFROM register_history WHERE dataset = '${dataset}'\n  AND suffix IN (SELECT suffix FROM ref_forbidden_suffixes)\nORDER BY licence_start` },
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
    // Route the combined-database open + query through the shared loading
    // affordance (issue #499), consistent with Explore and Playground. There is
    // no trigger button - the browser refreshes eagerly on first load and on
    // every filter change - so the affordance runs button-less: it drives the
    // polite statusLine (a first-use reassurance escalates if the cold open runs
    // long, a measured ~20s on GitHub Pages, issue #475), marks the result region
    // aria-busy, and on a LOAD failure raises the assertive alert. markRunning()
    // marks the open -> query transition. openCombined() is memoised, so after the
    // first refresh it is warm and the affordance is momentary; routing every
    // refresh through it keeps the behaviour uniform. `opened` distinguishes a
    // query-phase failure (keep the honest inline "Query failed" message) from a
    // load failure (the affordance already alerted and cleared the status).
    const started = performance.now();
    let opened = false;
    try {
      /** @type {{ rows: QueryRow[], total: number }} */
      const outcome = await withDatabaseLoading(
        { statusEl: statusLine, alertEl, resultEl: result, label: 'combined database' },
        async (markRunning) => {
          const worker = await openCombinedFn();
          opened = true;
          markRunning();
          /** @type {{ n: number }[]} */
          const countRows = await worker.db.query(countSql);
          const totalRows = Number(countRows[0].n);
          const maxPage = Math.max(0, Math.ceil(totalRows / state.pageSize) - 1);
          if (state.page > maxPage) state.page = maxPage;
          /** @type {QueryRow[]} */
          const pageRows = await worker.db.query(`SELECT * FROM (${inner}) LIMIT ${state.pageSize} OFFSET ${state.page * state.pageSize}`);
          return { rows: pageRows, total: totalRows };
        },
      );
      const { rows, total } = outcome;
      const elapsed = ((performance.now() - started) / 1000).toFixed(1);
      renderRows(rows, total, elapsed);
    } catch (err) {
      // Caught value is `unknown`; read `.message` through the same narrowed view
      // db-loading.js uses at the same kind of boundary.
      const message = /** @type {{ message?: string }} */ ((typeof err === 'object' && err !== null) ? err : {}).message;
      if (opened) statusLine.textContent = `Query failed: ${message ?? String(err)}`;
    }
  }

  /**
   * @param {QueryRow[]} rows
   * @param {number} total
   * @param {string} elapsed
   */
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
        /** @param {boolean} multi */
        const sortBy = (multi) => {
          // The transition rules — a plain activation sorts by this column ALONE,
          // toggling ascending/descending; a modified (Shift/Ctrl/Alt/Meta)
          // activation APPENDS a secondary sort, or toggles just its direction
          // when already present — are the shared table-sort core's, applied
          // across this backend's verbose-direction edge. The core returns a NEW
          // spec, which replaces the previous one rather than mutating in place.
          state.sort = coreNextSort(state.sort.map(toCoreSort), h, { multi }).map(toLocalSort);
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
        if (h === 'cleaned') return el('td', {}, [renderCleanedCallsign(r.cleaned)]);
        if (h === 'difference') return el('td', { class: 'diffnote', text: describeDiff(r.callsign) });
        // A 'status' or licence-class/product column (#553/#625) routes
        // through the shared field wrappers, mirroring the generated pages'
        // raw-preview convention (build-dataset-pages.ts) so a previewed row
        // reads consistently with the rest of the site - status is pinned to
        // 'plain' for the same reason that preview pins it: this table repeats
        // the same handful of values across a page of rows. NULL ("not
        // asserted by this row's source") is untouched by the wrapper, which
        // only humanises an ASSERTED blank ('').
        if (typeof r[h] === 'string' && h === 'status') return el('td', {}, [statusField(el, r[h], { glossaryLinking: 'plain' })]);
        // `product`/`licence_class` are PUBLISHED by the source; `implied_class`
        // is DERIVED by the mirror (the level read from the prefix series). They
        // otherwise share the `.lic` chrome, so the derived one carries the quiet
        // provenance cue (#836) rather than reading as a register fact.
        if (typeof r[h] === 'string' && (h === 'product' || h === 'licence_class' || h === 'implied_class')) return el('td', {}, [licenceField(el, r[h], h === 'implied_class' ? { provenance: 'derived' } : {})]);
        if (r[h] === null) return el('td', { text: 'NULL', class: 'browser-status' });
        // A custom hand-written query (the `custom` mode above) can select
        // arbitrary columns, including a numeric one; a literal zero
        // de-emphasises (issue #731), a state distinct from NULL
        // ("not asserted", .browser-status above).
        const text = String(r[h]);
        return el('td', { text, class: text.trim() === '0' ? 'zero' : '' });
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
      pill.querySelector('button')?.addEventListener('click', () => { state.customSql = null; state.page = 0; void refresh(); });
      pills.append(pill);
      return;
    }
    /**
     * @param {string} label
     * @param {() => void} remove
     */
    const add = (label, remove) => {
      const pill = el('span', { class: 'pill' }, [label, ' ', el('button', { type: 'button', 'aria-label': `remove ${label}`, text: '✕' })]);
      pill.querySelector('button')?.addEventListener('click', () => { remove(); state.page = 0; void refresh(); });
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
  /**
   * @param {Element} node
   * @returns {{ key: string, field: string, isExpr: boolean, label: string }}
   */
  function facetKeyOf(node) {
    const explicit = node.getAttribute('data-filter-label');
    const expr = node.getAttribute('data-filter-expr');
    if (expr !== null) return { key: expr, field: expr, isExpr: true, label: explicit ?? node.closest('.bd,figure')?.querySelector('h3,figcaption')?.textContent?.trim() ?? expr };
    // Guaranteed present: reached only for a node matched via [data-filter-col]
    // (the caller's selector below), never [data-filter-expr] alone.
    const col = /** @type {string} */ (node.getAttribute('data-filter-col'));
    return { key: col, field: col, isExpr: false, label: explicit ?? col };
  }
  /** @param {Element} node */
  function toggleFacetValue(node) {
    const { key, field, isExpr, label } = facetKeyOf(node);
    // Guaranteed present: every filter-trigger node carries its value alongside
    // data-filter-col/data-filter-expr (site-render.ts stamps them together).
    const value = /** @type {string} */ (node.getAttribute('data-filter-val'));
    let facet = state.facets.get(key);
    if (facet === undefined) { facet = { key, field, isExpr, label, values: new Set(), exclude: false }; state.facets.set(key, facet); }
    if (facet.values.has(value)) facet.values.delete(value); else facet.values.add(value);
    if (facet.values.size === 0) state.facets.delete(key);
    state.customSql = null; state.page = 0; void refresh();
    section.scrollIntoView({ block: 'start' });
  }
  // Cast to HTMLElement (not the plain Element the compound selector's overload
  // returns): every filter-trigger node in the rendered markup is an HTML
  // element, and keydown lives on HTMLElement's event map, not Element's.
  for (const node of /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('[data-filter-col],[data-filter-expr]'))) {
    /** @param {Event} e */
    const trigger = (e) => {
      const target = /** @type {Element | null} */ (e.target);
      if (target !== null && target.closest('a') !== null) return;
      toggleFacetValue(node);
    };
    node.addEventListener('click', trigger);
    node.addEventListener('keydown', (/** @type {KeyboardEvent} */ e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); trigger(e); } });
  }

  // Notable "compound filter" links carry a full data-browser-sql query (a
  // preset that facets can't express as one predicate, e.g. forbidden AND
  // issued-since-2019). Clicking loads it as a custom query and runs it;
  // <a href="#"> for link styling, so preventDefault the jump.
  for (const node of /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('[data-browser-sql]'))) {
    // Guaranteed present: reached only for a node matched via [data-browser-sql].
    const sql = /** @type {string} */ (node.getAttribute('data-browser-sql'));
    /** @param {Event} [e] */
    const go = (e) => { if (e) e.preventDefault(); textarea.value = sql; sqlBox.open = true; state.customSql = sql; state.page = 0; void refresh(); section.scrollIntoView({ block: 'start' }); };
    node.addEventListener('click', go);
    node.addEventListener('keydown', (/** @type {KeyboardEvent} */ e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(e); } });
  }

  // Quick chips: reset + the two boolean toggles.
  /** @typedef {{ label: string, run: () => void } | { label: string, toggle: string }} ChipDef */
  /** @type {ChipDef[]} */
  const chipDefs = [
    { label: 'clear filters', run: () => { state.facets.clear(); state.toggles.clear(); state.columnFilters.clear(); state.customSql = null; state.page = 0; } },
    ...Object.entries(TOGGLES).map(([id, t]) => ({ label: t.label, toggle: id })),
  ];
  /** @type {{ def: ChipDef, chip: HTMLElement }[]} */
  const chipEls = [];
  for (const def of chipDefs) {
    const chip = el('span', { class: 'chip', role: 'button', tabindex: '0', text: def.label });
    const fire = () => {
      if ('run' in def) def.run();
      else { if (state.toggles.has(def.toggle)) state.toggles.delete(def.toggle); else state.toggles.add(def.toggle); state.customSql = null; state.page = 0; }
      syncChips(); void refresh();
    };
    chip.addEventListener('click', fire);
    chip.addEventListener('keydown', (/** @type {KeyboardEvent} */ e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fire(); } });
    chipEls.push({ def, chip }); chips.append(chip);
  }
  function syncChips() { for (const { def, chip } of chipEls) chip.classList.toggle('active', 'toggle' in def && state.toggles.has(def.toggle)); }

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
  /** @param {unknown} v */
  const csvField = (v) => {
    if (v === null || v === undefined) return '';
    // Narrowed to a type with its own toString() (not TS's `{}`/Object.prototype
    // reading), so this renders exactly as `String(v)` always has.
    /** @type {{ toString(): string }} */
    const displayable = v;
    const s = String(displayable);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  async function downloadCsv() {
    const prev = dlBtn.textContent;
    dlBtn.disabled = true; dlBtn.textContent = '…';
    try {
      const inner = state.customSql !== null ? state.customSql : filtersSql().inner;
      const worker = await openCombinedFn();
      /** @type {QueryRow[]} */
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
      // Caught value is `unknown`; read `.message` through the same narrowed view
      // db-loading.js uses at the same kind of boundary.
      const message = /** @type {{ message?: string }} */ ((typeof err === 'object' && err !== null) ? err : {}).message;
      statusLine.textContent = `Download failed: ${message ?? String(err)}`;
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
