// UK amateur callsign lookup - proof of concept over the published SQLite.
// Frameworkless by design; the only dependency is sql.js-httpvfs (vendored
// into vendor/ by the Pages build from the npm-audited package), which
// queries the database via HTTP range requests without downloading it whole.
// The library ships as a UMD bundle loaded via a classic script tag in
// index.html, which attaches createDbWorker to window.

import { countryForCallsign, stripVisitorPrefix } from './prefix-country.js';
import { placeholderOf } from './browser-query.js';
import { callsignPillLink } from './callsign-pill.js';
import { withDatabaseLoading } from './db-loading.js';

const { createDbWorker } = window;

const workerUrl = new URL('./vendor/sqlite.worker.js', import.meta.url);
const wasmUrl = new URL('./vendor/sql-wasm.wasm', import.meta.url);

// The offline download control (below) records, in localStorage, which
// database it cached and under which deploy version. Read here too so the
// deploy version survives going offline: version.txt is fetched uncached and
// so is unreachable with no network, but the database URL must still carry the
// SAME `?v=` the cached copy was stored under, or the service worker cannot
// match it. The marker's version is the offline fallback.
const OFFLINE_DB_CACHE = 'callsign-offline-db';
const OFFLINE_MARKER_KEY = 'offline-db-state';
function readOfflineMarkers() {
  try { return JSON.parse(localStorage.getItem(OFFLINE_MARKER_KEY) ?? '{}') ?? {}; }
  catch { return {}; }
}
function writeOfflineMarkers(markers) {
  try { localStorage.setItem(OFFLINE_MARKER_KEY, JSON.stringify(markers)); }
  catch { /* storage unavailable - offline state simply is not remembered */ }
}

// The deploy version stamp (data/version.txt, written uncached by the Pages
// build). Resolved once. Online it is the fresh commit SHA; offline it falls
// back to the version an offline copy was downloaded under, so the database
// URL keeps matching the cached bytes. Shared by every database opener.
let versionPromise = null;
function getVersion() {
  versionPromise ??= (async () => {
    try {
      const res = await fetch(new URL('./data/version.txt', document.baseURI), { cache: 'no-store' });
      if (res.ok) return (await res.text()).trim();
    } catch { /* offline or missing - fall through to the offline marker */ }
    return readOfflineMarkers().version ?? 'dev';
  })();
  return versionPromise;
}

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
  const version = await getVersion();
  const dbUrl = new URL(`./data/callsigns.sqlite.png?v=${encodeURIComponent(version)}`, document.baseURI);
  return createDbWorker(
    [{ from: 'inline', config: { serverMode: 'full', url: dbUrl.toString(), requestChunkSize: 4096 } }],
    workerUrl.toString(),
    wasmUrl.toString(),
  );
}

// The lookup database's open, kicked off once by the browser bootstrap
// (initLookup). Held here so the shared query() helper can await it. It is a
// `let` so importing this module in a test opens no worker: the eager open only
// happens inside the guarded bootstrap, exactly as it does on Explore and the
// Playground console.
let dbPromise = null;

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
  // Cells accept DOM nodes as well as text - the edge-density work turns
  // component values into navigable links.
  table.append(el('tbody', {}, rows.map(r => el('tr', {}, r.map((c, i) =>
    c instanceof Node
      ? el('td', { class: i >= numericFrom ? 'num' : '' }, [c])
      : el('td', { text: String(c), class: i >= numericFrom ? 'num' : '' }))))));
  const wrap = el('div', { class: 'overflow' });
  wrap.append(table);
  return wrap;
}

// Edge navigation: the graph is latent in the components - every value
// links to the surface that explores it (callsigns and placeholder forms
// to their own ?c= pages, suffixes to the availability matrix, series to
// their entity pages).
function csLink(callsign) {
  return callsignPillLink(el, callsign);
}
function suffixLink(suffix) {
  return el('a', { href: `?c=${encodeURIComponent('*' + suffix)}`, text: suffix, title: `availability matrix for *${suffix}` });
}
// Series names are stored bare (20, M7); the # RSL-slot marker is the
// uniform display convention, inserted after the leading character.
function displaySeries(series) {
  return series.includes('#') || series.length < 2 ? series : `${series[0]}#${series.slice(1)}`;
}
function seriesLink(series) {
  return el('a', { href: `series/${series.replace(/#/g, '')}.html`, text: displaySeries(series), title: `prefix series ${displaySeries(series)}` });
}

// Humanise an ISO date (or timestamp) as "23 June 2026" for the data-currency
// line; leaves anything unparseable untouched. Mirrors the dataset pages' phrasing.
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
function humanDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
  return m ? `${Number(m[3])} ${MONTH_NAMES[Number(m[2]) - 1]} ${m[1]}` : String(iso);
}

// Point-of-use glossary hooks (issues #260/#263). A term label carries a
// small linked marker to its glossary entry, so a reader mid-lookup can learn
// what a word means without leaving the result. The status value additionally
// links to the register-status glossary, which resolves the "Available"
// overload (the literal status vs the inferred "no record → maybe free").
function glossLabel(text, anchor) {
  return el('span', {}, [
    text + ' ',
    el('a', { href: `glossary.html#${anchor}`, class: 'muted hint', title: `glossary: ${text}`, text: '(?)' }),
  ]);
}
const STATUS_ANCHORS = {
  allocated: 'allocated', reserved: 'reserved', available: 'available',
  live: 'status-live', forbidden: 'status-forbidden', quarantine: 'status-quarantine',
};
function statusCell(status) {
  if (status === '' || status == null) return status;
  const anchor = STATUS_ANCHORS[String(status).toLowerCase()] ?? 'status-values';
  return el('span', {}, [
    String(status) + ' ',
    el('a', { href: `glossary.html#${anchor}`, class: 'muted hint', title: 'what this register status means', text: '(what this means)' }),
  ]);
}
// Extract the suffix (trailing letter run after the last digit) from a typed
// callsign, so a not-found lookup can route to that suffix's availability
// matrix (issue #261). Returns null when there is no clear suffix.
function suffixOf(value) {
  const m = /[0-9]([A-Z]+)$/.exec(String(value).toUpperCase().replace(/[^A-Z0-9/]/g, ''));
  return m ? m[1] : null;
}

async function query(sql, params = []) {
  const worker = await dbPromise;
  return worker.db.query(sql, params);
}

// The combined database (all datasets + the FOI observations union) is much
// larger than the lookup database, so it is opened LAZILY - only when a
// lookup first needs FOI history - and queried over the same range-request
// VFS. Same .png/?v= hosting workarounds as the main database.
let combinedDbPromise = null;
function openCombinedDatabase() {
  combinedDbPromise ??= (async () => {
    const version = await getVersion();
    const dbUrl = new URL(`./data/combined.sqlite.png?v=${encodeURIComponent(version)}`, document.baseURI);
    return createDbWorker(
      [{ from: 'inline', config: { serverMode: 'full', url: dbUrl.toString(), requestChunkSize: 4096 } }],
      workerUrl.toString(),
      wasmUrl.toString(),
    );
  })();
  return combinedDbPromise;
}

async function queryCombined(sql, params = []) {
  const worker = await openCombinedDatabase();
  return worker.db.query(sql, params);
}

// The publications in register_history with their SCOPE facts, oldest
// first - the timeline axis for longitudinal views. Scope matters because
// absence is only meaningful relative to what a publication intended to
// cover: Ofcom has published declared-partial ~1k-row truncations of a
// ~150k register. Cached after the first query.
let historyDatasetsPromise = null;
function historyDatasets() {
  historyDatasetsPromise ??= queryCombined(
    'SELECT dataset, record_count, intended_complete, coverage_affecting FROM history_datasets ORDER BY dataset');
  return historyDatasetsPromise;
}

// Register history across every archived open-data publication: one row
// per publication showing the callsign's status then, with transitions
// annotated and absences shown (a callsign present in 2022 and gone in
// 2023 is itself an event). Deliberately neutral on WHY a transition
// happened - Allocated -> Reserved can be surrender, progression to a new
// licence level under a different callsign, or death; the register does
// not say which. Soft-fails to null (combined-database hiccup never breaks
// the lookup).
async function registerHistoryCard(callsigns) {
  try {
    const distinct = [...new Set(callsigns.filter(Boolean))];
    if (distinct.length === 0) return null;
    const [datasets, rows] = await Promise.all([
      historyDatasets(),
      queryCombined(
        `SELECT dataset, callsign, status, product FROM register_history
         WHERE callsign IN (${distinct.map(() => '?').join(',')}) ORDER BY dataset, callsign`, distinct),
    ]);
    if (rows.length === 0) return null;
    const byKey = new Map(rows.map(r => [`${r.dataset}|${r.callsign}`, r]));
    const found = [...new Set(rows.map(r => r.callsign))];

    const table = el('table');
    table.append(el('thead', {}, [el('tr', {}, ['publication', 'status', 'product', 'change'].map(h => el('th', { text: h })))]));
    const tbody = el('tbody');
    for (const callsign of found) {
      if (found.length > 1) {
        tbody.append(el('tr', {}, [el('td', { colspan: '4' }, [el('strong', { text: callsign })])]));
      }
      // previous = last state KNOWN from evidence: presence anywhere is
      // evidence; absence is evidence only in an intended-complete
      // publication. Absence from a declared-partial or undeclared-scope
      // publication is NO INFORMATION - it neither annotates a change nor
      // updates the known state (scope differences, publisher truncation
      // and omission errors all look identical to absence).
      let previous = null; // null = no evidence yet; '' = known absent
      for (const d of datasets) {
        const row = byKey.get(`${d.dataset}|${callsign}`);
        const status = row ? row.status : '';
        // A publication counts as complete-for-absence only if it declared
        // complete AND has no coverage-affecting quality observation: the
        // confirmed 2025-06-04 blank-product filter declared complete but
        // silently omitted ~45k records, so its absences are not evidence.
        const complete = d.intended_complete === 'true' && (d.coverage_affecting ?? '') === '';
        const informative = row !== undefined || complete;
        let change = '';
        if (informative && previous !== null && status !== previous) {
          const from = previous === '' ? '(absent)' : previous;
          const to = status === '' ? '(absent)' : status;
          change = `${from} → ${to}`;
        }
        const link = el('a', { href: `datasets/open-data/${d.dataset}/index.html`, text: d.dataset });
        const notEvidenceReason = (d.coverage_affecting ?? '') !== ''
          ? 'known to omit records it declares (see the publication page)'
          : `${d.intended_complete === 'false' ? 'declared partial' : 'undeclared scope'}, ${Number(d.record_count).toLocaleString('en-GB')} rows`;
        const statusText = row ? (status === '' ? '(blank status)' : status)
          : complete ? '(absent from this publication)'
            : `(not in this publication — ${notEvidenceReason}; not evidence of absence)`;
        tbody.append(el('tr', {}, [
          el('td', {}, [link]),
          el('td', { text: statusText }),
          el('td', { text: row ? row.product : '' }),
          el('td', { text: change, class: change === '' ? '' : 'flag' }),
        ]));
        if (informative) previous = status;
      }
    }
    table.append(tbody);
    const wrap = el('div', { class: 'overflow' });
    wrap.append(table);
    return card('Register history (archived open-data publications)', [
      el('p', { class: 'muted', text:
        'Status per archived publication, oldest first. A change row records only what the register shows - an Allocated → Reserved transition can be a surrendered licence, progression to a new licence level under a different callsign, or the holder’s death; the register does not say which. Absence is only treated as evidence in publications that DECLARED themselves complete - and a declaration is intent, not verified fact: intended-complete exports have been observed silently filtering records (e.g. omitting rows with a blank product field, which many legitimate allocations carry), so even an "(absent)" change here is a lead to check against the publication, never proof. Missing from a partial or undeclared-scope publication can equally be truncation, a publisher omission error, or a scope difference. Gaps between publications can hide intermediate states.' }),
      wrap,
    ]);
  } catch {
    return null;
  }
}

// FOI-witnessed history for a callsign: every observation row across the
// FOI lane's normalised datasets (register snapshots, available lists,
// issuance events), oldest vintage first, each linked to its entry page.
// Soft-fails to null so a combined-database hiccup never breaks the lookup.
async function foiHistoryCard(callsigns) {
  try {
    const distinct = [...new Set(callsigns.filter(Boolean))];
    if (distinct.length === 0) return null;
    const rows = await queryCombined(
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

// The aggregate views (locator matrix, flags-per-publication) live on the
// fully static statistics.html, pre-rendered at deploy time by
// build-home-aggregates.ts - this page carries only the interactive lookup.

async function renderBuildInfo() {
  try {
    const info = await query('SELECT key, value FROM build_info');
    const get = k => info.find(r => r.key === k)?.value ?? '?';
    document.getElementById('build-info').textContent =
      `Dataset ${get('dataset')} · built ${get('generated_at')} · commit ${String(get('commit')).slice(0, 9)}`;
    // Near-header data-currency line (issue #259): the same figures phrased
    // for a human — when Ofcom published this register, and when we mirrored it.
    const currency = document.getElementById('data-currency');
    if (currency) {
      currency.textContent =
        `Current register: published ${humanDate(get('dataset'))} · mirrored ${humanDate(get('generated_at'))}.`;
    }
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

// Callsign RSL-normalisation (placeholderOf) is shared with the per-dataset
// browser through the DOM-free query core; see site/browser-query.js. The
// lookup passes it an upper-cased value and matches c.placeholder_form.

// Name a visitor's home country from the ITU call-sign series table (Radio
// Regulations Appendix 42, via reference data). The resolution - stripping the
// UK visitor prefix, longest-prefix matching the home call against the series
// ranges, and refusing to guess when a split block is ambiguous - lives in the
// DOM-free, unit-tested prefix-country module; this wrapper only renders it.
// The country named is the ITU-allocated HOLDER of the call sign series, a
// declared allocation, not a verified claim about the operator's own licence.
const ITU_SOURCE_NOTE = 'Source: ITU Appendix 42 (Table of allocation of international call sign series). '
  + 'This names the holder of the call sign series, not a verified claim about the operator\'s licence.';

async function visitorHomeCard(homeCallsign) {
  const home = stripVisitorPrefix(homeCallsign);
  const first = (home.match(/[A-Za-z0-9]/)?.[0] ?? '').toUpperCase();
  // All series sharing the first character (at most ~50 rows).
  const rows = first
    ? await query('SELECT series, allocated_to FROM itu_series WHERE series LIKE ?', [`${first}%`])
    : [];
  const res = countryForCallsign(homeCallsign, rows);
  const note = el('p', { class: 'muted', text: ITU_SOURCE_NOTE });
  // A '#' recorded after the slash is a suspected artifact (same as the
  // register's hash-in-register flag; ADR 0005 gives the canonical M#/ form).
  // Surface that the raw data is one thing and the country rests on a manual
  // canonicalisation - never let the correction pass silently.
  const artifactNote = res.artifact
    ? [el('p', { class: 'muted', text: `${res.artifactNote} (Recorded as the hash-in-register anomaly.)` })]
    : [];

  if (res.status === 'resolved') {
    const where = res.series ? `falls in ITU series ${res.series}` : res.basis;
    return card('Visitor home callsign', [
      el('p', { text: `${res.cleaned} ${where}, allocated to ${res.country}.` }),
      ...artifactNote,
      note,
    ]);
  }
  if (res.status === 'ambiguous') {
    return card('Visitor home callsign', [
      el('p', { text: `${res.cleaned}: the ${res.basis}. The series table alone cannot name one country, so every holder is listed:` }),
      renderTable(['series', 'allocated to'], res.candidates.map(c => [c.series, c.country]), 99),
      ...artifactNote,
      note,
    ]);
  }
  // Unallocated or malformed: state honestly that no country can be derived.
  return card('Visitor home callsign', [
    el('p', { class: 'muted', text: res.basis }),
    ...artifactNote,
    note,
  ]);
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

  // Longitudinal presence per candidate callsign, one IN query over the
  // combined's register_history: which archived publications carry it, and
  // whether its status ever varied. Soft-fails to an empty map.
  const candidates = seriesList.map(s => `${s.prefix.replace('#', '')}${suffix}`);
  const historyByCallsign = new Map();
  try {
    const historyRows = await queryCombined(
      `SELECT callsign, dataset, status FROM register_history
       WHERE callsign IN (${candidates.map(() => '?').join(',')}) ORDER BY dataset`, candidates);
    for (const h of historyRows) {
      const acc = historyByCallsign.get(h.callsign) ?? { datasets: [], statuses: new Set() };
      acc.datasets.push(h.dataset);
      acc.statuses.add(h.status);
      historyByCallsign.set(h.callsign, acc);
    }
  } catch { /* combined unavailable - history column degrades to blank */ }

  const rows = seriesList.map((s) => {
    // Series names are stored bare (20, M7); the # RSL-slot marker is the
    // uniform display convention, inserted after the leading character.
    const hash = `${s.prefix[0]}#${s.prefix.slice(1)}`;
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
      const twin = bySeries.get(s.prefix === 'M8' ? '20' : '21');
      if (twin) {
        state = `no record — reserved for the current ${s.prefix === 'M8' ? '2#0' : '2#1'} holder (${twin.callsign}; corresponding-callsign reservation)`;
      }
    }
    // Longitudinal column: publications carrying this callsign, with a
    // marker when the status ever varied across them - a disappearance or
    // an Allocated -> Reserved swing is visible at a glance. For no-record
    // rows a non-empty history means the callsign EXISTED in an earlier
    // publication and has since left the register.
    const h = historyByCallsign.get(`${s.prefix.replace('#', '')}${suffix}`);
    let history = '';
    if (h) {
      history = `seen in ${h.datasets.length} publication${h.datasets.length === 1 ? '' : 's'}`;
      if (h.statuses.size > 1) history += ` ⚠ status varied (${[...h.statuses].map(v => v === '' ? '(blank)' : v).join(' / ')})`;
      // Present historically, no row today: reported neutrally - the
      // publications vary in scope, so this is a lead, not a verdict.
      if (!m) history += ' — absent from the latest publication';
    }
    return [csLink(`${hash}${suffix}`), s.station_level, s.issuing_status, state, flags, history];
  });
  sections.push(card(`Availability matrix: suffix ${suffix}`, [
    el('p', { class: 'muted', text:
      'Register state per prefix series (latest dataset). "No record" means Ofcom holds no row for this callsign - Ofcom does not routinely record never-allocated callsigns, so this suggests, but does not guarantee, availability. Per-series format validity rules are not yet in the reference data. Flags are per-row data-quality markers (see the flag registry). History spans archived publications OF VARYING SCOPE (Ofcom has published declared-partial truncations), so absence from one publication is not by itself evidence of removal - look a callsign up for its scope-aware timeline. Status changes can be surrender, progression, or death; the register does not say which.' }),
    renderTable(['callsign', 'level', 'series status', 'register state', 'flags', 'history'], rows, 99),
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
      rows.map(r => [csLink(r.callsign), r.status, r.product, r.parse_status, r.flags]), 99),
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
        const note = el('p', { text:
          `The register stores the RSL-less core callsign; regional renderings (with a Regional Secondary Locator at the # position) `
          + `are interchangeable forms of the same licence. "${value}" normalises to ${placeholder}, matching register row ${row.callsign}.` });
        if (others.length > 0) {
          note.append(' Other register rows sharing this placeholder: ');
          others.forEach((o, i) => { if (i > 0) note.append(', '); note.append(csLink(o)); });
          note.append('.');
        }
        fallbackNote = card(`${value} → ${placeholder} → register row ${row.callsign}`, [note]);
      }
    }
  }

  if (!row) {
    // Artefact recovery via the cleaned join key: rows whose CLEANED form
    // matches the search are likely the same callsign wearing publisher
    // whitespace/encoding damage (2E1HON vs "2E1HON{U+00A0}"). Suggested,
    // never silently adopted - an artefact match is a lead, not an
    // identity.
    let artefactNote = null;
    const cleanedInput = value.toUpperCase().replace(/[^A-Z0-9/]/g, '');
    if (cleanedInput !== '') {
      const likely = await query(
        `${ROW_SELECT} WHERE c.cleaned = ? AND n.callsign != ? ORDER BY n.callsign LIMIT 5`,
        [cleanedInput, value]);
      if (likely.length > 0) {
        const note = el('p', { text: 'No exact register row, but these rows clean to the same key - likely the same callsign carrying publisher whitespace or encoding artefacts: ' });
        likely.forEach((m, i) => { if (i > 0) note.append(', '); note.append(csLink(m.callsign)); });
        note.append('.');
        artefactNote = card(`Likely matches for ${value}`, [note]);
      }
    }
    // Absent from the current register is exactly where history is most
    // valuable: earlier publications may still hold the callsign, and FOI
    // datasets witness heritage transfers and pre-war annex callsigns.
    const [registerHistory, foiHistory] = await Promise.all([registerHistoryCard([value]), foiHistoryCard([value])]);
    // Checking availability? Absence from the register is NOT evidence a
    // callsign is free (issue #261). Route to the suffix-availability matrix
    // for the typed suffix, and say plainly that no-record is not proof.
    const suffix = suffixOf(value);
    let suffixCta = null;
    if (suffix) {
      const note = el('p', {}, [
        'Checking whether this callsign is free? Absence here is ',
        el('strong', { text: 'not' }),
        ' proof of availability — the register does not list every un-issued callsign, only the ones Ofcom has had reason to record. ',
        'To see this suffix across every prefix series, view the ',
        el('a', { href: `?c=${encodeURIComponent('*' + suffix)}`, text: `*${suffix} availability matrix`, title: `availability matrix for *${suffix}` }),
        ' (and read ',
        el('a', { href: 'glossary.html#available', text: 'what “available” means' }),
        ').',
      ]);
      suffixCta = card(`Is ${value} available?`, [note]);
    }
    result.replaceChildren(
      el('p', { text: `No register row for "${value}" in the latest dataset. (The register only holds callsigns Ofcom has had reason to record.)` }),
      ...(suffixCta ? [suffixCta] : []),
      ...(artefactNote ? [artefactNote] : []),
      ...(registerHistory ? [registerHistory] : []),
      ...(foiHistory ? [foiHistory] : []),
    );
    return;
  }

  const sections = [];
  if (fallbackNote) sections.push(fallbackNote);

  sections.push(card('Register row (normalised)', [renderTable(
    ['field', 'value'],
    [['callsign', row.callsign], ['product', row.product], ['status', statusCell(row.status)], ['type', row.type],
      ['created', row.created_date], ['last modified', row.last_modified_date],
      ['licence version modified', row.licence_version_last_modified_date],
      ['licence version start', row.licence_version_original_start_date]].filter(([, v]) => v !== ''),
    99)]));

  const componentRows = [['parse status', row.parse_status]];
  if (row.prefix_series) componentRows.push([glossLabel('prefix series', 'prefix-series'), seriesLink(row.prefix_series)]);
  if (row.rsl) componentRows.push([glossLabel('regional secondary locator', 'rsl'), row.rsl]);
  if (row.cs_suffix) componentRows.push(['suffix', suffixLink(row.cs_suffix)]);
  if (row.placeholder_form) componentRows.push([glossLabel('placeholder form', 'placeholder-form'), csLink(row.placeholder_form)]);
  if (row.home_callsign) componentRows.push(['home callsign (visitor)', csLink(row.home_callsign)]);
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
    const variants = rsls.map(r => [csLink(row.placeholder_form.replace('#', r.rsl)), r.region]);
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
      sections.push(card(`Prefix series ${displaySeries(series.prefix)}`, [renderTable(['fact', 'value'], [
        ['station level', series.station_level],
        ['issuing status', series.issuing_status],
        ['RSL required', series.rsl_required],
        ...(series.notes ? [['notes', series.notes]] : []),
      ], 99),
      el('p', { class: 'muted' }, [
        el('a', { href: `series/${series.prefix.replace(/#/g, '')}.html`, text: `Series ${series.prefix} page` }),
        ' — reference facts joined with latest-publication counts.',
      ])]));
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

  // Longitudinal history: the register's own state across archived
  // publications, then FOI-witnessed observations - queried by the
  // register row's callsign plus the as-typed value (regional renderings
  // appear literally in FOI datasets).
  const [registerHistory, foiHistory] = await Promise.all([
    registerHistoryCard([row.callsign, value]),
    foiHistoryCard([row.callsign, value]),
  ]);
  if (registerHistory) sections.push(registerHistory);
  if (foiHistory) sections.push(foiHistory);

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
    for (const r of series) seriesSelect.append(el('option', { value: r.prefix_series, text: displaySeries(r.prefix_series) }));
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

// Every executed lookup gets a shareable URL: a callsign (?c=M7TEE) OR a
// filtered view (?series=20&status=Reserved&flags=forbidden-suffix). This
// is the dynamic half of the entity-pages plan (precomputing 158k static
// callsign pages would alone exceed the Pages cap) AND the answer to
// "which N?" - every count on a series/statistics page links to its rows.
function criteriaToParams(criteria) {
  const params = new URLSearchParams();
  if (criteria.value) params.set('c', criteria.value);
  if (criteria.series) params.set('series', criteria.series);
  if (criteria.statuses.length) params.set('status', criteria.statuses.join(','));
  if (criteria.parseStatuses.length) params.set('parse', criteria.parseStatuses.join(','));
  if (criteria.flags.length) params.set('flags', criteria.flags.join(','));
  if (criteria.length) params.set('len', criteria.length);
  if (criteria.pattern) params.set('pattern', criteria.pattern);
  if (criteria.abnormal) params.set('abnormal', '1');
  return params;
}

function tickBoxes(fieldsetId, values) {
  const wanted = new Set(values);
  for (const box of document.querySelectorAll(`#${fieldsetId} input`)) {
    if (wanted.has(box.value)) box.checked = true;
  }
}

// Restore form state from URL params (checkboxes must already exist, so
// this runs after populateFilters). Opens the filter panel when any facet
// is set so the applied conditions are visible, not hidden.
function applyParamsToForm(params) {
  const c = params.get('c') ?? params.get('callsign');
  if (c) document.getElementById('callsign').value = c.trim().toUpperCase();
  if (params.get('series')) document.getElementById('series-filter').value = params.get('series');
  if (params.get('len')) document.getElementById('length-filter').value = params.get('len');
  if (params.get('pattern')) document.getElementById('pattern-filter').value = params.get('pattern');
  if (params.get('abnormal') === '1') document.getElementById('abnormal-filter').checked = true;
  tickBoxes('status-filters', (params.get('status') ?? '').split(',').filter(Boolean));
  tickBoxes('parse-filters', (params.get('parse') ?? '').split(',').filter(Boolean));
  tickBoxes('flag-filters', (params.get('flags') ?? '').split(',').filter(Boolean));
  if ([...params.keys()].some(k => k !== 'c')) {
    const details = document.getElementById('filters');
    if (details) details.open = true;
  }
}

// Build the primary lookup runner, routing the database open + query through the
// shared loading affordance (issue #499): the Look-up button reflects its state
// (disabled + "Waiting for data…" while the lookup database opens, "Running…"
// once the query starts), a polite status escalates if the cold open runs long,
// and a load, query or integrity failure raises the assertive #lookup-alert -
// identical to Explore and the Playground console. The affordance now OWNS the
// load-failure announcement, so the in-result fallback below keeps the datasets
// escape hatch but carries no second role="alert" (assistive tech is not told
// twice); the "querying…" placeholder can therefore never hang, preserving the
// fail-loud contract. Dependency-injected and exported so a DOM test can drive
// the exact submit path with a controlled opener, mirroring playground.js's
// wireConsole; the bootstrap passes the page's real elements, the eagerly-opened
// dbPromise and the real lookup renderer.
//
// Only the SMALL lookup database's open is wrapped. The lazy combined-database
// opens behind the register-history and FOI-history cards are deliberately left
// soft-failing to null (see registerHistoryCard / foiHistoryCard / suffixMatrix),
// so a combined hiccup annotates a card as unavailable but never trips this
// affordance or breaks the lookup.
export function makeRunLookup({ button, statusEl, alertEl, resultEl, open, lookup: lookupFn, label = 'lookup database' }) {
  return async function runLookup(criteria) {
    try {
      await withDatabaseLoading(
        { button, statusEl, alertEl, resultEl, label },
        async (markRunning) => {
          await open(); // force the cold open before the query starts
          markRunning();
          await lookupFn(criteria);
        },
      );
    } catch (err) {
      console.error(err);
      // The affordance already raised the assertive #lookup-alert (load vs query
      // vs integrity) and reset the button; this fallback replaces the "querying…"
      // placeholder with the datasets escape hatch and carries no role="alert" of
      // its own, so the failure is announced once, not twice.
      resultEl.hidden = false;
      resultEl.replaceChildren(el('div', { class: 'error' }, [
        'The lookup database could not be loaded or queried. Try reloading the page, or ',
        el('a', { href: 'datasets/index.html', text: 'browse the datasets' }),
        ' instead.',
      ]));
    }
    return resultEl;
  };
}

// Browser bootstrap. Runs only when the httpvfs UMD loader is present (it
// attaches createDbWorker), exactly like explore.js and playground.js - so
// importing this module in a test opens no worker and wires no DOM, leaving the
// exported helpers (makeRunLookup, the pure query builders) unit-testable.
function initLookup() {
  // Kick off the cold open once; the shared query() helper awaits this promise.
  dbPromise = openDatabase();

  const runLookup = makeRunLookup({
    button: document.querySelector('#lookup-form button[type="submit"]'),
    statusEl: document.getElementById('lookup-status'),
    alertEl: document.getElementById('lookup-alert'),
    resultEl: document.getElementById('result'),
    open: () => dbPromise,
    lookup,
  });

  document.getElementById('lookup-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const criteria = gatherCriteria();
    if (criteria.value !== '' || criteriaActive(criteria)) {
      const url = new URL(window.location.href);
      url.search = criteriaToParams(criteria).toString();
      window.history.replaceState(null, '', url);
      void runLookup(criteria);
    }
  });

  void renderBuildInfo();

  const initialParams = new URLSearchParams(window.location.search);
  // The form field is named "c", so a native submit produces the canonical ?c=.
  // ?callsign= is also honoured as a legacy alias (older links, and any URL left
  // from before the field was renamed), so a reload recovers the lookup rather
  // than ignoring the param. Neither key counts as a filter.
  const hasFilterParams = [...initialParams.keys()].some(k => k !== 'c' && k !== 'callsign');

  // Fast path: a callsign-only deep link runs immediately (a callsign
  // lookup ignores filters), without waiting for the filter panel's DISTINCT
  // scans. The title and scroll make it read as that callsign's own page.
  if (!hasFilterParams) {
    const c = initialParams.get('c') ?? initialParams.get('callsign');
    if (c !== null && c.trim() !== '') {
      const value = c.trim().toUpperCase();
      document.getElementById('callsign').value = value;
      document.title = `${value} — UK amateur callsign`;
      void runLookup(gatherCriteria()).then(() => document.getElementById('result').scrollIntoView({ block: 'start' }));
    }
  }

  // Filter deep links must wait for the checkboxes to exist before ticking
  // them; a shared filtered-view URL then reproduces the exact result set.
  populateFilters().then(() => {
    if (!hasFilterParams) return;
    applyParamsToForm(initialParams);
    const criteria = gatherCriteria();
    if (criteria.value === '' && !criteriaActive(criteria)) return;
    void runLookup(criteria).then(() => document.getElementById('result').scrollIntoView({ block: 'start' }));
  }).catch((err) => {
    // Only reached if wiring the filter panel itself fails (the database-load
    // path is now owned by runLookup's affordance); surface it loudly rather
    // than leaving the panel silently empty.
    console.error(err);
    const result = document.getElementById('result');
    result.hidden = false;
    result.replaceChildren(el('div', { class: 'error', role: 'alert' }, [
      'The lookup database could not be loaded. Try reloading the page, or ',
      el('a', { href: 'datasets/index.html', text: 'browse the datasets' }),
      ' instead.',
    ]));
  });

  initOffline();

  // Signal a successful start: cancel the startup-warning timer (index.html) and
  // hide the warning if it was already shown. Reaching here means the module
  // loaded and its wiring ran; if a module had failed to load, none of this
  // executes and the warning surfaces.
  if (typeof window !== 'undefined' && window.__lookupReadyTimer !== undefined) {
    clearTimeout(window.__lookupReadyTimer);
  }
  const startupWarning = document.getElementById('startup-warning');
  if (startupWarning !== null) startupWarning.hidden = true;
}

// ---- Offline-first (ADR 0008) ------------------------------------------
// Registers the service worker (static-shell precache) and drives the
// user-triggered full-database download. Online by default: nothing here
// caches the database until the visitor explicitly asks for it, and if
// service workers are unavailable the lookup carries on online exactly as
// before.

const OFFLINE_DBS = {
  latest: { file: 'callsigns.sqlite.png', label: 'lookup database' },
  combined: { file: 'combined.sqlite.png', label: 'combined database' },
};

function offlineSupported() {
  return 'serviceWorker' in navigator && 'caches' in window && typeof Response !== 'undefined';
}

function offlineDbUrl(file, version) {
  return new URL(`./data/${file}?v=${encodeURIComponent(version)}`, document.baseURI).href;
}

function humanBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

async function notifyServiceWorker(message) {
  try {
    const reg = await navigator.serviceWorker.ready;
    reg.active?.postMessage(message);
  } catch { /* worker not controlling yet - activate will pick the cache up */ }
}

// Reflect the current offline state: which databases (for THIS deploy version)
// are cached, when they were downloaded, and whether searches now run offline.
async function renderOfflineState() {
  const state = document.getElementById('offline-state');
  const downloadBtn = document.getElementById('offline-download');
  const removeBtn = document.getElementById('offline-remove');
  if (!state) return;
  const version = await getVersion();
  const markers = readOfflineMarkers();
  const cache = await caches.open(OFFLINE_DB_CACHE);
  const cached = {};
  for (const [key, { file }] of Object.entries(OFFLINE_DBS)) {
    cached[key] = !!(await cache.match(offlineDbUrl(file, version)));
  }
  const anyCached = Object.values(cached).some(Boolean);
  if (anyCached) {
    const parts = [];
    for (const [key, { file, label }] of Object.entries(OFFLINE_DBS)) {
      if (!cached[key]) continue;
      const when = markers.files?.[file]?.date;
      parts.push(when ? `${label} (downloaded ${humanDate(when)})` : label);
    }
    state.textContent =
      `Running offline: ${parts.join(' and ')} cached for this version (${String(version).slice(0, 9)}). `
      + 'Searches now work with no network. A new deploy replaces it — re-download to refresh.';
    if (removeBtn) removeBtn.hidden = false;
    if (downloadBtn) downloadBtn.hidden = cached.latest;
  } else {
    state.textContent =
      'Running online: each search fetches only the few kilobytes of the database it touches.';
    if (removeBtn) removeBtn.hidden = true;
    if (downloadBtn) downloadBtn.hidden = false;
  }
}

async function downloadForOffline(which, buttons) {
  const { file, label } = OFFLINE_DBS[which];
  const wrap = document.getElementById('offline-progress-wrap');
  const bar = document.getElementById('offline-progress');
  const progressLabel = document.getElementById('offline-progress-label');
  const state = document.getElementById('offline-state');
  buttons.forEach(b => { if (b) b.disabled = true; });
  if (wrap) wrap.hidden = false;
  if (bar) bar.removeAttribute('value'); // indeterminate until the size is known
  if (progressLabel) progressLabel.textContent = `Preparing to download the ${label}…`;
  try {
    const version = await getVersion();
    const url = offlineDbUrl(file, version);
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    const total = Number(res.headers.get('Content-Length')) || 0;
    const reader = res.body.getReader();
    const chunks = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      const pct = total > 0 ? Math.round((received / total) * 100) : 0;
      if (bar && total > 0) bar.value = pct;
      if (progressLabel) {
        progressLabel.textContent = total > 0
          ? `Downloading the ${label}: ${humanBytes(received)} of ${humanBytes(total)} (${pct}%)`
          : `Downloading the ${label}: ${humanBytes(received)}…`;
      }
    }
    const blob = new Blob(chunks, { type: 'image/png' });
    const cache = await caches.open(OFFLINE_DB_CACHE);
    await cache.put(url, new Response(blob, {
      headers: { 'Content-Type': 'image/png', 'Content-Length': String(blob.size), 'Accept-Ranges': 'bytes' },
    }));
    // Let the worker know it may now satisfy this database's Range requests
    // from the cache (it does not touch the database otherwise).
    await notifyServiceWorker({ type: 'offline-db-added', url });
    const markers = readOfflineMarkers();
    markers.version = version;
    markers.files = markers.files ?? {};
    markers.files[file] = { date: new Date().toISOString(), size: blob.size };
    writeOfflineMarkers(markers);
    if (wrap) wrap.hidden = true;
    await renderOfflineState();
  } catch (err) {
    console.error(err);
    if (wrap) wrap.hidden = true;
    if (state) state.textContent =
      `The offline download failed (${String(err?.message ?? err)}). The lookup still works online — try again.`;
  } finally {
    buttons.forEach(b => { if (b) b.disabled = false; });
  }
}

async function removeOffline(buttons) {
  buttons.forEach(b => { if (b) b.disabled = true; });
  try {
    const version = await getVersion();
    const cache = await caches.open(OFFLINE_DB_CACHE);
    for (const { file } of Object.values(OFFLINE_DBS)) {
      const url = offlineDbUrl(file, version);
      await cache.delete(url);
      await notifyServiceWorker({ type: 'offline-db-removed', url });
    }
    writeOfflineMarkers({});
    await renderOfflineState();
  } finally {
    buttons.forEach(b => { if (b) b.disabled = false; });
  }
}

// Best-effort: show the download size up front, so the choice is informed.
async function annotateOfflineSize() {
  const downloadBtn = document.getElementById('offline-download');
  if (!downloadBtn) return;
  try {
    const version = await getVersion();
    const res = await fetch(offlineDbUrl(OFFLINE_DBS.latest.file, version), { method: 'HEAD', cache: 'no-store' });
    const total = Number(res.headers.get('Content-Length')) || 0;
    if (total > 0) downloadBtn.textContent = `Download the full dataset for offline use (${humanBytes(total)})`;
  } catch { /* size stays unshown - not essential */ }
}

function initOffline() {
  const section = document.getElementById('offline');
  if (!section) return;
  const downloadBtn = document.getElementById('offline-download');
  const combinedBtn = document.getElementById('offline-download-combined');
  const removeBtn = document.getElementById('offline-remove');
  const controls = document.getElementById('offline-controls');
  if (!offlineSupported()) {
    const state = document.getElementById('offline-state');
    if (state) state.textContent =
      'Offline use is not available in this browser, but the lookup works online as normal.';
    if (controls) controls.hidden = true;
    const advanced = document.getElementById('offline-advanced');
    if (advanced) advanced.hidden = true;
    return;
  }
  navigator.serviceWorker.register(new URL('./sw.js', document.baseURI).href)
    .catch(err => console.error('Service worker registration failed', err));
  const buttons = [downloadBtn, combinedBtn, removeBtn];
  downloadBtn?.addEventListener('click', () => void downloadForOffline('latest', buttons));
  combinedBtn?.addEventListener('click', () => void downloadForOffline('combined', buttons));
  removeBtn?.addEventListener('click', () => void removeOffline(buttons));
  void renderOfflineState();
  void annotateOfflineSize();
}

// Run the browser bootstrap only when the httpvfs loader has attached
// createDbWorker (as vendor/index.js does before this module loads). Guarding it
// keeps the module import-safe: a unit/JSDOM test importing it for makeRunLookup
// or the pure query builders opens no worker and wires no DOM. Mirrors
// explore.js and playground.js.
if (typeof window !== 'undefined' && typeof window.createDbWorker === 'function') {
  initLookup();
}
