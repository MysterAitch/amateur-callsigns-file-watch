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
//
// The ?v= version stamp makes each deploy's database a DISTINCT cache
// object: Pages caches with max-age=600, and two deploys inside that window
// let the worker stitch 4 KiB chunks from DIFFERENT database versions -
// observed live as "database disk image is malformed". version.txt is
// written by the deploy workflow and fetched uncached.
async function openDatabase() {
  let version = 'dev';
  try {
    const res = await fetch(new URL('./data/version.txt', document.baseURI), { cache: 'no-store' });
    if (res.ok) version = (await res.text()).trim();
  } catch { /* fall back to unversioned */ }
  const dbUrl = new URL(`./data/callsigns.sqlite.png?v=${encodeURIComponent(version)}`, document.baseURI);
  return createDbWorker(
    [{ from: 'inline', config: { serverMode: 'full', url: dbUrl.toString(), requestChunkSize: 4096 } }],
    workerUrl.toString(),
    wasmUrl.toString(),
  );
}

const dbPromise = openDatabase();

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

// The master database (all datasets + the FOI observations union) is much
// larger than the lookup database, so it is opened LAZILY - only when a
// lookup first needs FOI history - and queried over the same range-request
// VFS. Same .png/?v= hosting workarounds as the main database.
let masterDbPromise = null;
function openMasterDatabase() {
  masterDbPromise ??= (async () => {
    let version = 'dev';
    try {
      const res = await fetch(new URL('./data/version.txt', document.baseURI), { cache: 'no-store' });
      if (res.ok) version = (await res.text()).trim();
    } catch { /* fall back to unversioned */ }
    const dbUrl = new URL(`./data/master.sqlite.png?v=${encodeURIComponent(version)}`, document.baseURI);
    return createDbWorker(
      [{ from: 'inline', config: { serverMode: 'full', url: dbUrl.toString(), requestChunkSize: 4096 } }],
      workerUrl.toString(),
      wasmUrl.toString(),
    );
  })();
  return masterDbPromise;
}

async function queryMaster(sql, params = []) {
  const worker = await openMasterDatabase();
  return worker.db.query(sql, params);
}

// FOI-witnessed history for a callsign: every observation row across the
// FOI lane's normalised datasets (register snapshots, available lists,
// issuance events), oldest vintage first, each linked to its entry page.
// Soft-fails to null so a master-database hiccup never breaks the lookup.
async function foiHistoryCard(callsigns) {
  try {
    const distinct = [...new Set(callsigns.filter(Boolean))];
    if (distinct.length === 0) return null;
    const rows = await queryMaster(
      `SELECT callsign, entry, dataset_classes, vintage, status, licence_class, event, event_date
       FROM observations WHERE callsign IN (${distinct.map(() => '?').join(',')})
       ORDER BY vintage IS NULL, vintage, entry`, distinct);
    if (rows.length === 0) return null;
    const table = el('table');
    table.append(el('thead', {}, [el('tr', {}, ['vintage', 'observation', 'classes', 'source entry'].map(h => el('th', { text: h })))]));
    table.append(el('tbody', {}, rows.map(r => {
      // Event rows describe a dated happening; observation rows a state.
      // NULL means the source did not assert the column at all.
      const what = r.event !== null
        ? `${r.event}${r.event_date ? ` (${r.event_date})` : ''}`
        : [r.status === null ? null : `status: ${r.status === '' ? '(asserted blank)' : r.status}`,
           r.licence_class === null || r.licence_class === '' ? null : `class: ${r.licence_class}`]
            .filter(Boolean).join(', ') || '(row present)';
      const link = el('a', { href: `datasets/foi/${encodeURIComponent(r.entry)}/index.html`, text: r.entry });
      return el('tr', {}, [
        el('td', { text: r.vintage ?? '—' }),
        el('td', { text: `${r.callsign !== distinct[0] ? r.callsign + ': ' : ''}${what}` }),
        el('td', { text: r.dataset_classes }),
        el('td', {}, [link]),
      ]);
    })));
    const wrap = el('div', { class: 'overflow' });
    wrap.append(table);
    return card(`FOI-witnessed history (${rows.length} observation${rows.length === 1 ? '' : 's'})`, [
      el('p', { class: 'muted', text: 'Rows this callsign carries across the FOI-disclosed datasets - snapshots of past register states, availability listings, and issuance events. Full provenance on each linked entry page.' }),
      wrap,
    ]);
  } catch {
    return null;
  }
}

async function renderAggregates() {
  const target = document.getElementById('flags-table');
  // Pre-rendered at deploy time (build-home-aggregates.ts) - the dynamic
  // path remains for pages served without the injection (local dev).
  if (target.dataset.prerendered !== undefined) return;
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

// Primary-by-secondary locator matrix from the precomputed rsl_matrix
// table (aggregated at build time - a live GROUP BY over the components
// table would be prohibitively chatty over the range-request VFS). Rows and
// columns are driven by reference data so absences stay visible; observed
// locators missing from reference data are flagged with a warning marker.
async function renderRslMatrix() {
  const target = document.getElementById('rsl-matrix-table');
  // Pre-rendered at deploy time (build-home-aggregates.ts) - the dynamic
  // path remains for pages served without the injection (local dev).
  if (target.dataset.prerendered !== undefined) return;
  try {
    const refSeries = (await query('SELECT prefix FROM ref_prefix_formats')).map(r => r.prefix);
    const refRsl = (await query('SELECT rsl FROM ref_rsl ORDER BY rsl')).map(r => r.rsl);
    const cellsRows = await query('SELECT series, rsl, n FROM rsl_matrix');

    const counts = new Map(cellsRows.map(r => [`${r.series}|${r.rsl}`, r.n]));
    const observedSeries = [...new Set(cellsRows.map(r => r.series))];
    const observedRsl = [...new Set(cellsRows.map(r => r.rsl).filter(r => r !== ''))];
    const seriesRows = [...new Set([...refSeries, ...observedSeries])].sort();
    const unknownRsl = observedRsl.filter(r => !refRsl.includes(r)).sort();
    const columns = [...refRsl, ...unknownRsl, ''];

    const count = (series, rsl) => counts.get(`${series}|${rsl}`) ?? 0;
    const quiet = n => n === 0 ? '·' : n;
    const rows = seriesRows.map(series => [
      refSeries.includes(series) ? series : `${series} ⚠`,
      ...columns.map(rsl => quiet(count(series, rsl))),
      quiet(columns.reduce((sum, rsl) => sum + count(series, rsl), 0)),
    ]);
    rows.push([
      'total',
      ...columns.map(rsl => quiet(seriesRows.reduce((sum, s) => sum + count(s, rsl), 0))),
      quiet(cellsRows.reduce((sum, r) => sum + r.n, 0)),
    ]);
    // Elaborations from the precomputed tables: exclusion counts inline,
    // enumerations behind details where the population is small enough to
    // list (the RSL-bearing rows ARE the interesting finds). Invisible
    // characters explode to {U+XXXX} markers wherever they sit.
    const explode = s => [...s].map(ch =>
      /[\p{C}\p{Z}]/u.test(ch)
        ? `{U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}}`
        : ch).join('');
    const excludedCounts = await query('SELECT status, n FROM matrix_excluded ORDER BY status');
    // Count-first phrasing, matching the reports' bullet convention
    // ("10 unparseable") - one grammar on every surface.
    const excludedText = excludedCounts.length === 0 ? 'none'
      : excludedCounts.map(r => `${r.n} ${r.status}`).join(', ');
    const caption = el('p', { class: 'muted', text: `Excluded from this table: ${excludedText}.` });

    const detailsBlocks = [];
    const bearing = await query('SELECT callsign, series, rsl FROM rsl_bearing ORDER BY callsign');
    if (bearing.length > 0 && bearing.length <= 50) {
      const d = el('details', {}, [el('summary', { text: `RSL-bearing records (${bearing.length})` })]);
      d.append(renderTable(['callsign', 'series', 'RSL'],
        bearing.map(r => [explode(r.callsign), r.series, r.rsl]), 99));
      detailsBlocks.push(d);
    }
    const exampleRows = await query('SELECT status, callsign FROM excluded_examples ORDER BY status, callsign');
    for (const { status, n } of excludedCounts) {
      if (n === 0 || n > 50) continue;
      const examples = exampleRows.filter(r => r.status === status).map(r => explode(r.callsign));
      const d = el('details', {}, [el('summary', { text: `Excluded: ${status} (${n})` })]);
      d.append(el('p', { class: 'mono', text: examples.join(', ') }));
      detailsBlocks.push(d);
    }

    target.replaceChildren(
      renderTable(['series', ...refRsl, ...unknownRsl.map(r => `${r} ⚠`), '(none)', 'total'], rows, 1),
      caption,
      ...detailsBlocks,
    );
  } catch (err) {
    target.textContent = `failed to load matrix: ${err}`;
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

// Name a visitor's home country from the ITU call-sign series table
// (Radio Regulations Appendix 42, via reference data). Series rows are
// three-character ranges ("P2A - P2Z"), so:
// - third character a LETTER: exact range containment names one country.
// - third character a DIGIT (e.g. PT2FM, 3D2AB): the series table indexes
//   by third LETTER, so a split two-character block is ambiguous - list
//   every holder honestly rather than guess (the 3D block splits
//   Eswatini/Fiji, and 3D2 in practice is Fiji).
async function visitorHomeCard(homeCallsign) {
  const clean = homeCallsign.replace(/^[^A-Za-z0-9]+/, '').toUpperCase();
  const shape = /^([A-Z0-9])([A-Z0-9]?)([A-Z0-9]?)/.exec(clean);
  if (clean.length < 3 || !shape || !/[A-Z]/.test(clean[0]) && !/[0-9]/.test(clean[0])) {
    return card('Visitor home callsign', [el('p', { class: 'muted', text:
      `"${homeCallsign}" is too short or malformed to derive an ITU prefix.` })]);
  }

  // All series sharing the first character (at most ~50 rows).
  const rows = await query('SELECT series, allocated_to FROM itu_series WHERE series LIKE ?', [`${clean[0]}%`]);
  const ranges = rows.map(r => {
    const m = /^(\S+)\s*-\s*(\S+)$/.exec(r.series);
    return m ? { start: m[1], end: m[2], country: r.allocated_to, series: r.series } : null;
  }).filter(Boolean);
  if (ranges.length === 0) {
    return card('Visitor home callsign', [el('p', { text:
      `"${clean}" does not begin with a series in the ITU call-sign table - possibly malformed, or a prefix outside Appendix 42.` })]);
  }

  const named = (hit, how) => card('Visitor home callsign', [el('p', { text:
    `${clean} ${how}, allocated to ${hit}.` })]);

  // Single-letter prefix (digit in second position, e.g. W1AW, G0ICN): the
  // callsign belongs to the whole first-letter block. If one country holds
  // the entire block (USA for K/N/W, UK for G/M, ...), that names it.
  if (/[0-9]/.test(clean[1])) {
    const countries = [...new Set(ranges.map(r => r.country))];
    if (countries.length === 1) return named(countries[0], `has a single-letter ${clean[0]} prefix (whole block)`);
    return card('Visitor home callsign', [
      el('p', { text: `${clean} has a single-letter ${clean[0]} prefix, but the ${clean[0]} block is split between allocations:` }),
      renderTable(['series', 'allocated to'], ranges.map(r => [r.series, r.country]), 99),
    ]);
  }

  // Two-character prefix with a letter third character: exact range match.
  if (/[A-Z]/.test(clean[2])) {
    const code = clean.slice(0, 3);
    const hit = ranges.find(r => code >= r.start && code <= r.end);
    if (hit) return named(hit.country, `falls in ITU series ${hit.series}`);
  }

  // Digit third character (e.g. PT2FM, 3D2AB): the series table indexes by
  // third LETTER, so only the two-character block can be consulted. One
  // holder names it; a split block (3D: Eswatini/Fiji) is listed honestly
  // rather than guessed - 3D2 in practice is Fiji, but the table alone
  // cannot say so.
  const first2 = clean.slice(0, 2);
  const blockRanges = ranges.filter(r => r.start.slice(0, 2) <= first2 && first2 <= r.end.slice(0, 2));
  const countries = [...new Set(blockRanges.map(r => r.country))];
  if (countries.length === 1) return named(countries[0], `begins with the ${first2} block`);
  if (countries.length > 1) {
    return card('Visitor home callsign', [
      el('p', { text: `${clean} has a digit in the third position, and the ${first2} block is split between allocations - the ITU series table cannot name the country alone:` }),
      renderTable(['series', 'allocated to'], blockRanges.map(r => [r.series, r.country]), 99),
    ]);
  }
  return card('Visitor home callsign', [el('p', { text:
    `"${clean}" does not fall in any ITU series for the ${clean[0]} block - possibly malformed.` })]);
}

// Suffix availability matrix (*TEE): one row per prefix series from
// reference data, showing the register row where one exists. Where none
// exists the register simply holds no record - Ofcom does not routinely
// store records for never-allocated callsigns - which is a hopeful but NOT
// guaranteed signal of availability.
async function suffixMatrix(suffix, result) {
  const seriesList = await query('SELECT prefix, station_level, issuing_status FROM ref_prefix_formats');
  const matches = await query(
    `SELECT c.prefix_series, c.placeholder_form, c.flags, n.callsign, n.status, n.product,
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
    let flags = '';
    if (m) {
      state = m.status;
      if (m.product) state += ' — ' + m.product;
      // An Allocated row without a product is a register anomaly worth
      // surfacing here (part of the blank-products data-quality thread).
      else if (m.status === 'Allocated') state += ' ⚠ no product recorded';
      if (m.modified) state += ` (${m.modified.slice(0, 10)})`;
      // Per-row data-quality flags (forbidden-suffix, class-product-mismatch,
      // rsl-in-register, ...) - vocabulary in the flag registry.
      flags = m.flags ? m.flags.split(';').join(', ') : '';
    } else if (s.prefix === 'M8' || s.prefix === 'M9') {
      // Corresponding-callsign reservation (Ofcom statement, Dec 2023, via
      // reference data): while a 2#0/2#1 callsign is on issue, its M8/M9
      // equivalent is reserved for that holder for three years from go-live.
      const twin = bySeries.get(s.prefix === 'M8' ? '2#0' : '2#1');
      if (twin) {
        state = `no record — reserved for the current ${s.prefix === 'M8' ? '2#0' : '2#1'} holder (${twin.callsign}; corresponding-callsign reservation)`;
      }
    }
    return [`${hash}${suffix}`, s.station_level, s.issuing_status, state, flags];
  });
  sections.push(card(`Availability matrix: suffix ${suffix}`, [
    el('p', { class: 'muted', text:
      'Register state per prefix series (latest dataset). "No record" means Ofcom holds no row for this callsign - Ofcom does not routinely record never-allocated callsigns, so this suggests, but does not guarantee, availability. Per-series format validity rules are not yet in the reference data. Flags are per-row data-quality markers (see the flag registry).' }),
    renderTable(['callsign', 'level', 'series status', 'register state', 'flags'], rows, 99),
  ]));
  result.replaceChildren(...sections);
}

const PAGE_SIZE = 50;

// Translate the pattern notation to a SQLite GLOB: A = letter, N = digit,
// * = any run; anything else is literal. GLOB metacharacters in literals
// are wrapped in a character class so they cannot widen the match.
function patternToGlob(pattern) {
  return [...pattern].map(ch =>
    ch === 'A' ? '[A-Za-z]'
      : ch === 'N' ? '[0-9]'
        : ch === '*' ? '*'
          : /[[\]?]/.test(ch) ? `[${ch}]` : ch,
  ).join('');
}

// Build WHERE conditions from the criteria object. Facet model: values
// ticked WITHIN a group are alternatives (IN - a row has one status), while
// groups combine with AND - so the shown count is exactly the number of
// matching rows. Flags are the exception: they AND individually, since one
// row can carry several. Flags are stored semicolon-separated, so each
// token match wraps both sides in ';' for exactness.
function buildConds(criteria) {
  const conds = [];
  const params = [];
  if (criteria.value !== '') {
    conds.push(`c.callsign LIKE ? ESCAPE '\\'`);
    params.push(criteria.value.replace(/[%_]/g, ch => '\\' + ch).replace(/\*/g, '%'));
  }
  for (const flag of criteria.flags) {
    conds.push(`(';' || c.flags || ';') LIKE ?`);
    params.push(`%;${flag};%`);
  }
  if (criteria.statuses.length > 0) {
    conds.push(`n.status IN (${criteria.statuses.map(() => '?').join(',')})`);
    params.push(...criteria.statuses);
  }
  if (criteria.parseStatuses.length > 0) {
    conds.push(`c.parse_status IN (${criteria.parseStatuses.map(() => '?').join(',')})`);
    params.push(...criteria.parseStatuses);
  }
  if (criteria.series !== '') {
    conds.push('c.prefix_series = ?');
    params.push(criteria.series);
  }
  if (criteria.length !== '') {
    conds.push('length(c.callsign) = ?');
    params.push(Number(criteria.length));
  }
  if (criteria.pattern !== '') {
    conds.push('c.callsign GLOB ?');
    params.push(patternToGlob(criteria.pattern.toUpperCase()));
  }
  if (criteria.abnormal) {
    conds.push(`c.callsign GLOB '*[^A-Za-z0-9]*'`);
  }
  return { conds, params };
}

function describeCriteria(criteria) {
  return [
    criteria.value !== '' ? `"${criteria.value}"` : null,
    criteria.flags.length > 0 ? `flags: ${criteria.flags.join(' + ')}` : null,
    criteria.statuses.length > 0 ? `status: ${criteria.statuses.join('/')}` : null,
    criteria.parseStatuses.length > 0 ? `parse: ${criteria.parseStatuses.join('/')}` : null,
    criteria.series !== '' ? `series: ${criteria.series}` : null,
    criteria.length !== '' ? `length: ${criteria.length}` : null,
    criteria.pattern !== '' ? `pattern: ${criteria.pattern.toUpperCase()}` : null,
    criteria.abnormal ? 'abnormal characters' : null,
  ].filter(Boolean).join(' · ') || 'whole register';
}

// Paginated list of register rows matching the criteria.
async function filteredList(criteria, page, result) {
  const { conds, params } = buildConds(criteria);
  const where = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';
  const [count] = await query(
    `SELECT COUNT(*) AS n FROM components c JOIN normalised n ON n.callsign = c.callsign ${where}`, params);
  const rows = await query(
    `SELECT c.callsign, n.status, n.product, c.parse_status, c.flags
     FROM components c JOIN normalised n ON n.callsign = c.callsign
     ${where} ORDER BY c.callsign LIMIT ${PAGE_SIZE} OFFSET ${page * PAGE_SIZE}`, params);

  const total = count.n;
  const first = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const last = page * PAGE_SIZE + rows.length;

  const nav = el('p', {});
  if (page > 0) {
    const prev = el('button', { type: 'button', text: '← previous' });
    prev.addEventListener('click', () => void filteredList(criteria, page - 1, result));
    nav.append(prev, ' ');
  }
  nav.append(el('span', { class: 'muted', text: ` showing ${first}–${last} of ${total} ` }));
  if (last < total) {
    const next = el('button', { type: 'button', text: 'next →' });
    next.addEventListener('click', () => void filteredList(criteria, page + 1, result));
    nav.append(' ', next);
  }

  result.replaceChildren(card(`Matches — ${describeCriteria(criteria)}`, [
    renderTable(['callsign', 'status', 'product', 'parse status', 'flags'],
      rows.map(r => [r.callsign, r.status, r.product, r.parse_status, r.flags]), 99),
    nav,
  ]));
}

function criteriaActive(criteria) {
  return criteria.flags.length > 0 || criteria.statuses.length > 0 || criteria.parseStatuses.length > 0
    || criteria.series !== '' || criteria.length !== '' || criteria.pattern !== '' || criteria.abnormal;
}

async function lookup(criteria) {
  const result = document.getElementById('result');
  result.hidden = false;
  result.replaceChildren(el('p', { class: 'muted', text: 'querying…' }));

  const value = criteria.value;

  const suffixOnly = /^\*([A-Z]{1,4})$/.exec(value);
  if (suffixOnly && !criteriaActive(criteria)) {
    await suffixMatrix(suffixOnly[1], result);
    return;
  }
  if (value.includes('*') || (criteriaActive(criteria) && value === '')) {
    await filteredList(criteria, 0, result);
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
    // Absent from the current register is exactly where FOI history is
    // most valuable: heritage transfers, pre-war annex callsigns, and
    // past availability listings still witness the callsign.
    const history = await foiHistoryCard([value]);
    result.replaceChildren(
      el('p', { text: `No register row for "${value}" in the latest dataset. (The register only holds callsigns Ofcom has had reason to record.)` }),
      ...(history ? [history] : []),
    );
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

  if (row.home_callsign) {
    sections.push(await visitorHomeCard(row.home_callsign));
  }

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

  // FOI-witnessed history: query by the register row's callsign plus the
  // as-typed value (regional renderings appear literally in FOI datasets).
  const history = await foiHistoryCard([row.callsign, value]);
  if (history) sections.push(history);

  result.replaceChildren(...sections);
}

function addCheckbox(fieldset, value, title) {
  const box = el('input', { type: 'checkbox', value });
  fieldset.append(el('label', title ? { title } : {}, [box, value]));
}

// Facet values come from the data itself (DISTINCT queries), so the panel
// self-maintains as datasets evolve - new statuses or series just appear.
async function populateFilters() {
  try {
    const registry = await query('SELECT flag, meaning FROM flag_registry ORDER BY flag');
    for (const r of registry) addCheckbox(document.getElementById('flag-filters'), r.flag, r.meaning);

    const statuses = await query('SELECT DISTINCT status FROM normalised ORDER BY status');
    for (const r of statuses) addCheckbox(document.getElementById('status-filters'), r.status);

    const parses = await query('SELECT DISTINCT parse_status FROM components ORDER BY parse_status');
    for (const r of parses) addCheckbox(document.getElementById('parse-filters'), r.parse_status);

    const seriesSelect = document.getElementById('series-filter');
    const series = await query(`SELECT DISTINCT prefix_series FROM components WHERE prefix_series != '' ORDER BY prefix_series`);
    for (const r of series) seriesSelect.append(el('option', { value: r.prefix_series, text: r.prefix_series }));
  } catch {
    /* filters stay empty if the database can't load */
  }
}

function checked(fieldsetId) {
  return [...document.querySelectorAll(`#${fieldsetId} input:checked`)].map(box => box.value);
}

function gatherCriteria() {
  return {
    value: document.getElementById('callsign').value.trim().toUpperCase(),
    flags: checked('flag-filters'),
    statuses: checked('status-filters'),
    parseStatuses: checked('parse-filters'),
    series: document.getElementById('series-filter').value,
    length: document.getElementById('length-filter').value.trim(),
    pattern: document.getElementById('pattern-filter').value.trim(),
    abnormal: document.getElementById('abnormal-filter').checked,
  };
}

document.getElementById('lookup-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const criteria = gatherCriteria();
  if (criteria.value !== '' || criteriaActive(criteria)) void lookup(criteria);
});

void populateFilters();
void renderRslMatrix();
void renderAggregates();
void renderBuildInfo();
