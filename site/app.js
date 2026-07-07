// UK amateur callsign lookup - proof of concept over the published SQLite.
// Frameworkless by design; the only dependency is sql.js-httpvfs (vendored
// into vendor/ by the Pages build from the npm-audited package), which
// queries the database via HTTP range requests without downloading it whole.
// The library ships as a UMD bundle loaded via a classic script tag in
// index.html, which attaches createDbWorker to window.

const { createDbWorker } = window;

const workerUrl = new URL('./vendor/sqlite.worker.js', import.meta.url);
const wasmUrl = new URL('./vendor/sql-wasm.wasm', import.meta.url);

// The database URL must be ABSOLUTE: the worker resolves relative URLs
// against its own location (vendor/), not the page - observed live as a 404
// on vendor/data/callsigns.sqlite.
const dbUrl = new URL('./data/callsigns.sqlite', document.baseURI);

const dbPromise = createDbWorker(
  [{ from: 'inline', config: { serverMode: 'full', url: dbUrl.toString(), requestChunkSize: 4096 } }],
  workerUrl.toString(),
  wasmUrl.toString(),
);

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const child of children) node.append(child);
  return node;
}

function renderTable(headers, rows, numericFrom = 1) {
  const table = el('table');
  table.append(el('thead', {}, [el('tr', {}, headers.map((h, i) => el('th', { text: h, class: i >= numericFrom ? 'num' : '' })))]));
  table.append(el('tbody', {}, rows.map(r => el('tr', {}, r.map((c, i) => el('td', { text: String(c), class: i >= numericFrom ? 'num' : '' }))))));
  const wrap = el('div', { class: 'overflow' });
  wrap.append(table);
  return wrap;
}

async function query(sql, params = []) {
  const worker = await dbPromise;
  return worker.db.query(sql, params);
}

async function renderAggregates() {
  const target = document.getElementById('flags-table');
  try {
    const datasets = await query('SELECT key, record_count FROM datasets ORDER BY key DESC');
    const flags = await query('SELECT dataset, flag, count FROM stats_flags');
    const flagNames = [...new Set(flags.map(f => f.flag))].sort();
    const byDataset = new Map(datasets.map(d => [d.key, new Map()]));
    for (const f of flags) byDataset.get(f.dataset)?.set(f.flag, f.count);
    const rows = flagNames.map(flag => [flag, ...datasets.map(d => byDataset.get(d.key)?.get(flag) ?? 0)]);
    target.replaceChildren(
      renderTable(['flag', ...datasets.map(d => d.key)], [
        ['records', ...datasets.map(d => d.record_count)],
        ...rows,
      ]),
    );
  } catch (err) {
    target.textContent = `failed to load aggregates: ${err}`;
  }
}

async function renderBuildInfo() {
  try {
    const info = await query('SELECT key, value FROM build_info');
    const get = k => info.find(r => r.key === k)?.value ?? '?';
    document.getElementById('build-info').textContent =
      `Dataset ${get('dataset')} · built ${get('generated_at')} · commit ${String(get('commit')).slice(0, 9)}`;
  } catch {
    /* non-essential */
  }
}

function card(title, children) {
  return el('div', { class: 'card' }, [el('h3', { text: title }), ...children]);
}

async function lookup(rawInput) {
  const result = document.getElementById('result');
  result.hidden = false;
  result.replaceChildren(el('p', { class: 'muted', text: 'querying…' }));

  const value = rawInput.trim().toUpperCase();
  const [row] = await query(
    `SELECT n.*, c.parse_status, c.prefix_series, c.rsl, c.suffix AS cs_suffix,
            c.home_callsign, c.implied_class, c.flags
     FROM components c JOIN normalised n ON n.callsign = c.callsign
     WHERE c.callsign = ? LIMIT 1`, [value]);

  if (!row) {
    result.replaceChildren(el('p', { text: `No register row for "${value}" in the latest dataset. (The register only holds callsigns Ofcom has had reason to record.)` }));
    return;
  }

  const sections = [];

  sections.push(card('Register row (normalised)', [renderTable(
    ['field', 'value'],
    [['callsign', row.callsign], ['product', row.product], ['status', row.status], ['type', row.type],
      ['created', row.created_date], ['last modified', row.last_modified_date],
      ['licence version modified', row.licence_version_last_modified_date],
      ['licence version start', row.licence_version_original_start_date]].filter(([, v]) => v !== ''),
    99)]));

  const componentRows = [['parse status', row.parse_status]];
  if (row.prefix_series) componentRows.push(['prefix series', row.prefix_series]);
  if (row.rsl) componentRows.push(['regional secondary locator', row.rsl]);
  if (row.cs_suffix) componentRows.push(['suffix', row.cs_suffix]);
  if (row.home_callsign) componentRows.push(['home callsign (visitor)', row.home_callsign]);
  if (row.implied_class) componentRows.push(['implied licence class', row.implied_class]);
  sections.push(card('Components', [renderTable(['part', 'value'], componentRows, 99)]));

  if (row.prefix_series) {
    const [series] = await query('SELECT * FROM ref_prefix_formats WHERE prefix = ?', [row.prefix_series]);
    if (series) {
      sections.push(card(`Prefix series ${series.prefix}`, [renderTable(['fact', 'value'], [
        ['station level', series.station_level],
        ['issuing status', series.issuing_status],
        ['RSL required', series.rsl_required],
        ...(series.notes ? [['notes', series.notes]] : []),
      ], 99)]));
    }
  }

  if (row.rsl) {
    const [rsl] = await query('SELECT * FROM ref_rsl WHERE rsl = ?', [row.rsl]);
    sections.push(card(`RSL "${row.rsl}"`, [
      rsl
        ? renderTable(['fact', 'value'], [['region', rsl.region], ['scope', rsl.scope], ...(rsl.notes ? [['notes', rsl.notes]] : [])], 99)
        : el('p', { text: 'Not a standard RSL letter - possibly a temporary/special RSL (these are not enumerated in reference data).' }),
    ]));
  }

  if (row.cs_suffix) {
    const [forbidden] = await query('SELECT 1 AS hit FROM ref_forbidden_suffixes WHERE suffix = ?', [row.cs_suffix]);
    if (forbidden) {
      sections.push(card('Suffix note', [el('p', { text:
        `"${row.cs_suffix}" appears on Ofcom's August 2019 FOI withheld-suffixes list. Most such register rows are long-standing allocations - the list evidently governs new issuance, not existing holdings.` })]));
    }
  }

  const flagList = row.flags ? row.flags.split(';') : [];
  if (flagList.length > 0) {
    const registry = await query(
      `SELECT flag, meaning FROM flag_registry WHERE flag IN (${flagList.map(() => '?').join(',')})`, flagList);
    const meanings = new Map(registry.map(r => [r.flag, r.meaning]));
    sections.push(card('Flags', flagList.map(f => el('p', {}, [
      el('span', { class: 'flag', text: f }),
      el('span', { class: 'muted', text: ' ' + (meanings.get(f) ?? '') }),
    ]))));
  } else {
    sections.push(card('Flags', [el('p', { class: 'status-ok', text: 'None - nothing anomalous recorded for this row.' })]));
  }

  result.replaceChildren(...sections);
}

document.getElementById('lookup-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const input = document.getElementById('callsign').value;
  if (input.trim() !== '') void lookup(input);
});

void renderAggregates();
void renderBuildInfo();
