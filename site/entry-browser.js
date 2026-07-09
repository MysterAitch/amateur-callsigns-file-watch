// Scoped data browser for open-data entry pages (variant Q, phase 3b).
// Progressive enhancement over the static "Browse the data" preview: filter
// chips and a SQL box that query the published master database scoped to
// THIS publication (WHERE dataset = key) over HTTP range requests - the same
// engine as the Explore page. With JS off (or in a Wayback capture) the
// static preview the page already rendered is the complete, crawlable
// record; this only adds interactivity. Frameworkless like app.js/explore.js.
//
// Paths resolve against import.meta.url (this file sits at the site root),
// NOT document.baseURI - entry pages live three directories deep, so a
// page-relative URL would 404. The .png / ?v= hosting workarounds are the
// same as app.js (see the comments there).

const { createDbWorker } = window;
const workerUrl = new URL('./vendor/sqlite.worker.js', import.meta.url);
const wasmUrl = new URL('./vendor/sql-wasm.wasm', import.meta.url);
const ROW_CAP = 500;

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

function codeCell(value) {
  const c = el('code');
  c.textContent = value ?? '';
  return c;
}

// A raw callsign rendered with visible markers for the invisible/odd
// characters that make it differ from its cleaned key.
function renderRawCallsign(raw) {
  const span = el('code');
  for (const ch of raw) {
    const cp = ch.codePointAt(0);
    if (ch === ' ') span.append(el('span', { class: 'marker', text: '{NBSP}' }));
    else if (ch === '�') span.append(el('span', { class: 'marker', text: '{U+FFFD}' }));
    else if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) span.append(el('span', { class: 'marker', text: `{U+${cp.toString(16).toUpperCase().padStart(4, '0')}}` }));
    else span.append(document.createTextNode(ch));
  }
  return span;
}

// The per-row note for the "raw ≠ cleaned" filter: what the difference IS.
function describeDiff(raw, cleaned) {
  const notes = [];
  if (/ /.test(raw)) notes.push('non-breaking space');
  if (/�/.test(raw)) notes.push('replacement character (encoding damage)');
  if (/^\s|\s$/.test(raw.replace(/ /g, ' '))) notes.push('leading/trailing whitespace');
  else if (/\S[  ]+\S/.test(raw)) notes.push('space mid-callsign');
  if (raw.toUpperCase() !== raw) notes.push('lowercase letters');
  const stripped = raw.replace(/[A-Za-z0-9/\s �]/g, '');
  if (stripped !== '') notes.push('other non-standard characters');
  return notes.length > 0 ? notes.join('; ') : 'differs after cleaning';
}

const section = document.querySelector('.browser[data-dataset]');
if (section !== null) enhance(section);

function enhance(section) {
  const dataset = section.getAttribute('data-dataset');
  const staticView = section.querySelector('.browser-static');
  if (staticView === null) return;

  const chipsBar = el('div', { class: 'chips' });
  const statusLine = el('p', { class: 'browser-status' });
  const result = el('div', { class: 'browser-result' });
  result.hidden = true;

  // Status values come from the sidebar breakdown (already in the DOM), so
  // no extra scan is needed to build the chips.
  const statusValues = [...document.querySelectorAll('[data-filter-status]')].map(n => n.getAttribute('data-filter-status'));
  const chips = [
    { label: 'all', kind: 'reset' },
    ...statusValues.map(s => ({ label: s, kind: 'status', value: s })),
    { label: 'raw ≠ cleaned', kind: 'artefact' },
    { label: 'forbidden-suffix', kind: 'forbidden' },
  ];
  const chipEls = new Map();
  for (const c of chips) {
    const chip = el('span', { class: 'chip', role: 'button', tabindex: '0', text: c.label });
    const fire = () => void activate(c, chip);
    chip.addEventListener('click', fire);
    chip.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fire(); } });
    chipEls.set(c, chip);
    chipsBar.append(chip);
  }

  section.insertBefore(chipsBar, staticView);
  section.insertBefore(statusLine, staticView);
  staticView.after(result);

  function setActive(chip) {
    for (const c of chipEls.values()) c.classList.remove('active');
    if (chip !== null) chip.classList.add('active');
  }

  async function activate(chipDef, chip) {
    if (chipDef.kind === 'reset') {
      setActive(null);
      staticView.hidden = false;
      result.hidden = true;
      statusLine.textContent = '';
      return;
    }
    setActive(chip);
    staticView.hidden = true;
    result.hidden = true;
    statusLine.textContent = 'querying this publication…';
    let where; let params;
    if (chipDef.kind === 'status') { where = 'status = ?'; params = [dataset, chipDef.value]; }
    else if (chipDef.kind === 'artefact') { where = 'callsign != cleaned'; params = [dataset]; }
    else { where = 'suffix IN (SELECT suffix FROM ref_forbidden_suffixes)'; params = [dataset]; }
    const sql = `SELECT callsign, cleaned, status, product FROM register_history WHERE dataset = ? AND ${where} ORDER BY callsign LIMIT ${ROW_CAP + 1}`;
    try {
      const started = performance.now();
      const worker = await openMaster();
      const rows = await worker.db.query(sql, params);
      renderScoped(rows, chipDef.kind === 'artefact', ((performance.now() - started) / 1000).toFixed(1));
    } catch (err) {
      statusLine.textContent = `Query failed: ${String(err.message ?? err)}`;
    }
  }

  function finishStatus(rows) {
    const truncated = rows.length > ROW_CAP;
    const shown = truncated ? rows.slice(0, ROW_CAP) : rows;
    return { shown, label: `${shown.length}${truncated ? `+ (capped at ${ROW_CAP})` : ''} row${shown.length === 1 ? '' : 's'}` };
  }

  function renderScoped(rows, showDiff, elapsed) {
    const { shown, label } = finishStatus(rows);
    statusLine.textContent = `${label} in ${elapsed}s${showDiff ? ' — publisher whitespace/encoding artefacts; the difference is annotated per row.' : ''}`;
    if (shown.length === 0) { result.replaceChildren(el('p', { class: 'browser-status', text: 'No rows.' })); result.hidden = false; return; }
    const headers = showDiff ? ['callsign (raw)', 'cleaned', 'status', 'difference'] : ['callsign', 'cleaned', 'status', 'product'];
    const tbody = el('tbody', {}, shown.map(r => el('tr', {}, [
      el('td', {}, [showDiff ? renderRawCallsign(r.callsign) : codeCell(r.callsign)]),
      el('td', {}, [codeCell(r.cleaned)]),
      el('td', { text: r.status ?? '' }),
      showDiff ? el('td', { class: 'diffnote', text: describeDiff(r.callsign, r.cleaned ?? '') }) : el('td', { text: r.product ?? '' }),
    ])));
    renderTable(headers, tbody);
  }

  function renderGeneric(rows, elapsed) {
    const { shown, label } = finishStatus(rows);
    statusLine.textContent = `${label} in ${elapsed}s`;
    if (shown.length === 0) { result.replaceChildren(el('p', { class: 'browser-status', text: 'No rows.' })); result.hidden = false; return; }
    const headers = Object.keys(shown[0]);
    const tbody = el('tbody', {}, shown.map(r => el('tr', {}, headers.map(h =>
      el('td', { text: r[h] === null ? 'NULL' : String(r[h]), class: r[h] === null ? 'browser-status' : '' })))));
    renderTable(headers, tbody);
  }

  function renderTable(headers, tbody) {
    const table = el('table', {}, [el('thead', {}, [el('tr', {}, headers.map(h => el('th', { text: h })))]), tbody]);
    const wrap = el('div', { class: 'overflow', style: 'overflow-x:auto' });
    wrap.append(table);
    result.replaceChildren(wrap);
    result.hidden = false;
  }

  // The SQL box: scoped to this publication, with the read-only guard and
  // the row cap that the Explore console uses.
  const details = el('details', { class: 'sqlbox' });
  details.append(el('summary', { text: '▸ Query this publication with SQL' }));
  const textarea = el('textarea', { rows: '4', spellcheck: 'false' });
  textarea.value = `SELECT callsign, cleaned, status, product\nFROM register_history\nWHERE dataset = '${dataset}' AND callsign != cleaned\nORDER BY callsign`;
  const runBtn = el('button', { type: 'button', class: 'run', text: 'Run' });
  const runSql = async () => {
    const raw = textarea.value.trim().replace(/;+\s*$/, '');
    if (!/^\s*(select|with)\b/i.test(raw)) { statusLine.textContent = 'read-only console: queries must start with SELECT or WITH'; return; }
    setActive(null);
    staticView.hidden = true;
    result.hidden = true;
    statusLine.textContent = 'querying…';
    try {
      const started = performance.now();
      const worker = await openMaster();
      const rows = await worker.db.query(`SELECT * FROM (${raw}) LIMIT ${ROW_CAP + 1}`);
      renderGeneric(rows, ((performance.now() - started) / 1000).toFixed(1));
    } catch (err) {
      statusLine.textContent = `Query failed: ${String(err.message ?? err)}`;
    }
  };
  runBtn.addEventListener('click', () => void runSql());
  details.append(textarea, el('br'), runBtn);
  section.append(details);

  // Wire the sidebar status-breakdown rows to their matching chip, so the
  // At-a-glance counts double as filters (Roger's "click to filter").
  for (const node of document.querySelectorAll('[data-filter-status]')) {
    const value = node.getAttribute('data-filter-status');
    const chipDef = chips.find(x => x.kind === 'status' && x.value === value);
    if (chipDef === undefined) continue;
    const trigger = () => { void activate(chipDef, chipEls.get(chipDef)); section.scrollIntoView({ block: 'start' }); };
    node.addEventListener('click', trigger);
    node.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); trigger(); } });
  }
}
