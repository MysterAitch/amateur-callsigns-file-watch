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
//
// The .png name is a deliberate lie told to the CDN: GitHub Pages/Fastly
// gzip-transcodes text-like types (verified live: even Range requests are
// served as byte ranges OF THE COMPRESSED representation, which corrupts
// httpvfs reads), but never re-compresses image formats. Naming the SQLite
// file .png makes every range request address the real bytes. The file is
// plain SQLite; only the extension is costume.
const dbUrl = new URL('./data/callsigns.sqlite.png', document.baseURI);

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

const ROW_SELECT =
  `SELECT n.*, c.parse_status, c.prefix_series, c.rsl, c.suffix AS cs_suffix,
          c.placeholder_form, c.home_callsign, c.implied_class, c.flags
   FROM components c JOIN normalised n ON n.callsign = c.callsign`;

// Normalise ANY rendering of a callsign to its RSL-placeholder form
// (M7TEE, MW7TEE, ME7TEE, M#7TEE -> M#7TEE; 2E0ABC, 20ABC, 2#0ABC ->
// 2#0ABC). The register stores the RSL-less core (Ofcom: "the core call
// sign does not include an RSL"), and components.csv stores this same
// placeholder for every parsed row - so one indexed equality query finds
// the licence whichever variant is typed.
function placeholderOf(value) {
  const gm = /^([GM])(?:([A-Z#])?)(\d)([A-Z]+)$/.exec(value);
  if (gm) return `${gm[1]}#${gm[3]}${gm[4]}`;
  const two = /^2(?:([A-Z#])?)(\d)([A-Z]+)$/.exec(value);
  if (two) return `2#${two[2]}${two[3]}`;
  return null;
}

// Suffix availability matrix (*TEE): one row per prefix series from
// reference data, showing the register row where one exists. Where none
// exists the register simply holds no record - Ofcom does not routinely
// store records for never-allocated callsigns - which is a hopeful but NOT
// guaranteed signal of availability.
async function suffixMatrix(suffix, result) {
  const seriesList = await query('SELECT prefix, station_level, issuing_status FROM ref_prefix_formats');
  const matches = await query(
    `SELECT c.prefix_series, c.placeholder_form, n.callsign, n.status, n.product,
            COALESCE(NULLIF(n.last_modified_date, ''), n.licence_version_last_modified_date) AS modified
     FROM components c JOIN normalised n ON n.callsign = c.callsign
     WHERE c.suffix = ? AND c.parse_status = 'parsed'`, [suffix]);
  const bySeries = new Map(matches.map(m => [m.prefix_series, m]));

  const sections = [];
  const [forbidden] = await query('SELECT 1 AS hit FROM ref_forbidden_suffixes WHERE suffix = ?', [suffix]);
  if (forbidden) {
    sections.push(card('Withheld suffix', [el('p', { text:
      `"${suffix}" appears on Ofcom's August 2019 FOI withheld-suffixes list - unlikely to be newly issued, though existing allocations stand.` })]));
  }
  if (suffix.length < 2 || suffix.length > 3) {
    sections.push(card('Suffix length', [el('p', { text:
      `Suffixes are normally three letters (two-letter forms are heritage; single letters are contest callsigns via NoV) - "${suffix}" is unusual.` })]));
  }

  const rows = seriesList.map((s) => {
    const hash = s.prefix.includes('#') ? s.prefix : `${s.prefix[0]}#${s.prefix.slice(1)}`;
    const m = bySeries.get(s.prefix);
    let state = 'no record';
    if (m) {
      state = m.status;
      if (m.product) state += ' — ' + m.product;
      // An Allocated row without a product is a register anomaly worth
      // surfacing here (part of the blank-products data-quality thread).
      else if (m.status === 'Allocated') state += ' ⚠ no product recorded';
      if (m.modified) state += ` (${m.modified.slice(0, 10)})`;
    }
    return [`${hash}${suffix}`, s.station_level, s.issuing_status, state];
  });
  sections.push(card(`Availability matrix: suffix ${suffix}`, [
    el('p', { class: 'muted', text:
      'Register state per prefix series (latest dataset). "No record" means Ofcom holds no row for this callsign - Ofcom does not routinely record never-allocated callsigns, so this suggests, but does not guarantee, availability. Per-series format validity rules are not yet in the reference data.' }),
    renderTable(['callsign', 'level', 'series status', 'register state'], rows, 99),
  ]));
  result.replaceChildren(...sections);
}

// General wildcard (* matches any run of characters) over register values.
async function wildcardList(value, result) {
  const like = value.replace(/[%_]/g, ch => '\\' + ch).replace(/\*/g, '%');
  const [count] = await query(`SELECT COUNT(*) AS n FROM components WHERE callsign LIKE ? ESCAPE '\\'`, [like]);
  const rows = await query(
    `SELECT c.callsign, n.status, n.product, c.flags
     FROM components c JOIN normalised n ON n.callsign = c.callsign
     WHERE c.callsign LIKE ? ESCAPE '\\' ORDER BY c.callsign LIMIT 100`, [like]);
  result.replaceChildren(card(`Wildcard "${value}" — ${count.n} match(es)${count.n > 100 ? ', first 100 shown' : ''}`, [
    renderTable(['callsign', 'status', 'product', 'flags'], rows.map(r => [r.callsign, r.status, r.product, r.flags]), 99),
  ]));
}

async function lookup(rawInput) {
  const result = document.getElementById('result');
  result.hidden = false;
  result.replaceChildren(el('p', { class: 'muted', text: 'querying…' }));

  const value = rawInput.trim().toUpperCase();

  const suffixOnly = /^\*([A-Z]{1,4})$/.exec(value);
  if (suffixOnly) {
    await suffixMatrix(suffixOnly[1], result);
    return;
  }
  if (value.includes('*')) {
    await wildcardList(value, result);
    return;
  }

  let [row] = await query(`${ROW_SELECT} WHERE c.callsign = ? LIMIT 1`, [value]);
  let fallbackNote = null;

  if (!row) {
    const placeholder = placeholderOf(value);
    if (placeholder) {
      const matches = await query(`${ROW_SELECT} WHERE c.placeholder_form = ? ORDER BY n.callsign LIMIT 5`, [placeholder]);
      if (matches.length > 0) {
        row = matches[0];
        const others = matches.slice(1).map(m => m.callsign);
        fallbackNote = card(`${value} → ${placeholder} → register row ${row.callsign}`, [el('p', { text:
          `The register stores the RSL-less core callsign; regional renderings (with a Regional Secondary Locator at the # position) `
          + `are interchangeable forms of the same licence. "${value}" normalises to ${placeholder}, matching register row ${row.callsign}.`
          + (others.length > 0 ? ` Other register rows sharing this placeholder: ${others.join(', ')}.` : '') })]);
      }
    }
  }

  if (!row) {
    result.replaceChildren(el('p', { text: `No register row for "${value}" in the latest dataset. (The register only holds callsigns Ofcom has had reason to record.)` }));
    return;
  }

  const sections = [];
  if (fallbackNote) sections.push(fallbackNote);

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
  if (row.placeholder_form) componentRows.push(['placeholder form', row.placeholder_form]);
  if (row.home_callsign) componentRows.push(['home callsign (visitor)', row.home_callsign]);
  if (row.implied_class) componentRows.push(['implied licence class', row.implied_class]);
  sections.push(card('Components', [renderTable(['part', 'value'], componentRows, 99)]));

  // Regional renderings: every parsed callsign carries its RSL-placeholder
  // form (identical across all regional variants) - render each variant by
  // substituting personal-scope RSL letters at the # position.
  if (row.parse_status === 'parsed' && row.placeholder_form) {
    const isTwoSeries = row.placeholder_form.startsWith('2');
    const rsls = await query(`SELECT rsl, region FROM ref_rsl WHERE scope = 'all' ORDER BY region`);
    const variants = rsls.map(r => [row.placeholder_form.replace('#', r.rsl), r.region]);
    sections.push(card(`Regional renderings (${row.placeholder_form})`, [
      el('p', { class: 'muted', text: isTwoSeries
        ? 'The register stores the RSL-less core, but a Regional Secondary Locator is mandatory in use for 2-format callsigns - the # marks where it goes:'
        : 'The register stores the core callsign; a Regional Secondary Locator may optionally be inserted at the # position. These renderings are interchangeable forms of the same licence:' }),
      renderTable(['rendering', 'region'], variants, 99),
    ]));
  }

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
