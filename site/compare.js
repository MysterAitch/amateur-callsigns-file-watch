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
//
// Deep links (issues #333/#397): the page reads the shareable ?view= filter,
// ?datasets= selection and ?pred= override on load and applies them, so a
// report or a hand-authored page can link a pre-filtered comparison, not just
// the generic tool. Params are validated before use - a ?pred= carrying a
// statement separator is rejected and an unknown publication key is dropped,
// each reported through the status region rather than silently applied - and
// the pure validators are exported for unit tests. The browser bootstrap at the
// tail runs only when the httpvfs loader is present (mirroring playground.js),
// so importing this module in a test opens no worker.

import { buildPredicate, stateToViewParam, viewParamToState, applyViewToState, matchingCountSql, setDiffSql, callsignCharMarker, TOGGLES } from './browser-query.js';
import { createHistorySync } from './history-sync.js';
import { withDatabaseLoading } from './db-loading.js';

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
// A callsign with whitespace/odd characters made legible (shared classifier),
// so a damaged value in a set-difference sample doesn't hide.
function rawCallsign(raw) {
  const span = el('code');
  for (const ch of String(raw ?? '')) {
    const marker = callsignCharMarker(ch);
    span.append(marker !== null ? el('span', { class: 'marker', text: marker }) : document.createTextNode(ch));
  }
  return span;
}
const nf = (n) => Number(n).toLocaleString('en-GB');

// ---- Change-magnitude indicator (issue #409) -------------------------------
// A reusable, at-a-glance readout of how much a value has CHANGED against a
// baseline, after the convention in clinical lab-result readouts: three
// severity tiers × direction. Severity AND direction are carried in SHAPE/TEXT
// — a directional caret (↑/↓) and, for a substantial deviation, a filled badge
// — never colour alone, so the signal survives for colour-blind readers,
// greyscale and forced-colours (issues #409/#397/#334). The semantic severity
// colours live in site/ledger.css (--dev-mild / --dev-strong / --on-dev-strong,
// the .chg-* classes), separate from the ledger accent, and are held to
// WCAG-AA in both themes by site/ledger-a11y.test.ts.
//
// The classifier is exported and pure so it is unit-tested directly and can be
// lifted into a shared module when a second surface adopts it. This is the
// visualisation layer for the baseline cross-dataset diffs of #330.
//
// PHASE 1 (this change): a THRESHOLD heuristic against a baseline — here the
// prior snapshot in the side-by-side counts. Deriving the TYPICAL per-period
// change and flagging deviation from that derived trend is PHASE 2, deferred to
// #210; this component does not attempt it.

// Default thresholds, as a fraction of the baseline. A FIRST-DRAFT heuristic to
// refine later (#210), stated explicitly so the boundary is visible: a register
// grows or shrinks a few percent between neighbouring snapshots as a matter of
// course, so under 2% reads as "within the expected range"; 2–10% is a mild
// deviation worth a glance; 10%+ is a substantial swing (e.g. the ~45k
// blank-product omission — #330).
export const CHANGE_THRESHOLDS = { mild: 0.02, substantial: 0.10 };

// Classify a value against a baseline. Returns the severity tier
// ('in-range' | 'mild' | 'substantial'), the direction ('up' | 'down' | 'none')
// and the signed/relative delta. Pure. A zero baseline that becomes non-zero is
// a substantial "appeared from none" (no ratio exists, but a population
// arriving from nothing is a strong signal); both zero is in-range.
export function classifyDelta(value, baseline, thresholds = CHANGE_THRESHOLDS) {
  const delta = value - baseline;
  const direction = delta > 0 ? 'up' : delta < 0 ? 'down' : 'none';
  if (delta === 0) return { severity: 'in-range', direction, delta, ratio: 0 };
  if (baseline === 0) return { severity: 'substantial', direction, delta, ratio: Infinity };
  const ratio = Math.abs(delta) / baseline;
  const severity = ratio >= thresholds.substantial ? 'substantial'
    : ratio >= thresholds.mild ? 'mild' : 'in-range';
  return { severity, direction, delta, ratio };
}

const CARET = { up: '↑', down: '↓', none: '' };
const formatPct = (ratio) => `${(ratio * 100).toFixed(1)}%`;
// A signed percentage using a true minus sign, for the plain in-range reading.
const signedPct = (c) => `${c.direction === 'down' ? '−' : c.direction === 'up' ? '+' : ''}${formatPct(c.ratio)}`;

// The accessible name a screen-reader announces for a classified change — the
// full "up 12%, substantial" phrasing the #409 spec calls for, so severity and
// direction never depend on colour or the caret glyph alone.
export function describeChange(c) {
  const dir = c.direction === 'up' ? 'up' : c.direction === 'down' ? 'down' : 'no change';
  if (c.severity === 'in-range') return c.direction === 'none' ? 'no change' : `${dir} ${formatPct(c.ratio)}, within the expected range`;
  const tier = c.severity === 'substantial' ? 'substantial deviation' : 'mild deviation';
  const magnitude = c.ratio === Infinity ? `${dir} ${nf(Math.abs(c.delta))} from none` : `${dir} ${formatPct(c.ratio)}`;
  return `${magnitude}, ${tier}`;
}

// The render-ready description of a change: the severity class, the visible
// text (caret + magnitude), and the accessible label. Kept separate from the
// DOM build so it can be asserted without a document.
export function changeIndicatorSpec(value, baseline, thresholds = CHANGE_THRESHOLDS) {
  const c = classifyDelta(value, baseline, thresholds);
  const caret = CARET[c.direction];
  const magnitude = c.ratio === Infinity ? `${c.delta > 0 ? '+' : ''}${nf(c.delta)}` : (c.severity === 'in-range' ? signedPct(c) : formatPct(c.ratio));
  // In range: plain text, no caret marker; mild/substantial: caret + magnitude.
  const visible = c.severity === 'in-range' ? magnitude : `${caret} ${magnitude}`.trim();
  return { severity: c.severity, direction: c.direction, visible, label: describeChange(c) };
}

// Build the indicator as a DOM node for a table cell. In range renders plain
// muted text (the signed percentage, read literally by a screen-reader); mild
// and substantial hide the visible caret+magnitude from assistive tech and
// carry the full accessible phrase in a visually-hidden span instead, so the
// announcement is "up 12.0%, substantial deviation", not "up-arrow 12 percent".
export function changeIndicator(value, baseline, thresholds = CHANGE_THRESHOLDS) {
  const spec = changeIndicatorSpec(value, baseline, thresholds);
  const cls = spec.severity === 'in-range' ? 'chg chg-inrange'
    : spec.severity === 'mild' ? 'chg chg-mild' : 'chg chg-substantial';
  const span = el('span', { class: cls });
  if (spec.severity === 'in-range') { span.textContent = spec.visible; return span; }
  span.append(el('span', { 'aria-hidden': 'true', text: spec.visible }));
  span.append(el('span', { class: 'visually-hidden', text: spec.label }));
  return span;
}

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
// A hand-edited filter condition that overrides the inherited facet/toggle
// state - so a comparison whose inherited filter matched nothing can be fixed
// in place without a round-trip to a publication browser.
let customPredicate = null;
// Human notes about pieces DROPPED from a deep link (an unsafe ?pred=, an
// unknown ?datasets= key) - surfaced in the filter note so a stale or mangled
// link is honest about what it could not honour rather than failing silently.
let linkIssues = [];

// A URL-supplied ?pred= is applied verbatim as a SQL WHERE condition, so it
// gets the SAME guard the hand-edit "Apply filter" button uses: a single
// condition, no statement separator. A link carrying a ';' is rejected (the
// comparison degrades to its inherited filter) rather than smuggling a second
// statement into the read-only query. Pure, so it is unit-tested. Returns the
// usable predicate (or null) and the rejected raw value (or null) for a note.
export function sanitiseComparePredicate(rawPred) {
  if (rawPred === null || rawPred === '') return { predicate: null, rejected: null };
  if (rawPred.includes(';')) return { predicate: null, rejected: rawPred };
  return { predicate: rawPred, rejected: null };
}

// Split a ?datasets= selection into keys that exist in the loaded publication
// list and keys that do not (a stale link naming a since-removed publication).
// Unknown keys are dropped from the selection and reported, never silently
// applied. Pure; order-preserving and de-duplicated.
export function partitionSelectedDatasets(rawSets, knownKeys) {
  const known = new Set(knownKeys);
  const chosen = [];
  const unknown = [];
  const seen = new Set();
  for (const k of (rawSets ?? '').split(',')) {
    if (k === '' || seen.has(k)) continue;
    seen.add(k);
    (known.has(k) ? chosen : unknown).push(k);
  }
  return { chosen, unknown };
}

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
const predInput = document.getElementById('pred-input');
const bootStatus = document.getElementById('boot-status');
const bootAlert = document.getElementById('boot-alert');

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

// The dataset-agnostic predicate applied to every publication. A hand-edited
// filter (customPredicate) overrides the inherited facet/toggle/column state.
// A custom-SQL ?view= is tied to one publication, so it cannot be compared
// automatically - the caller checks state.customSql before using this.
function predicate() { return customPredicate ?? buildPredicate(state); }

// Read the shareable state (?view= filter, ?datasets= selection, ?pred=
// override) wholesale from the URL. Total by design: pieces absent from the
// link reset to their defaults, so a back/forward restore reproduces each
// state exactly rather than accumulating a stale selection.
function readStateFromUrl() {
  const url = new URL(window.location.href);
  linkIssues = [];
  applyViewToState(state, viewParamToState(url.searchParams.get('view')));
  selected.clear();
  const { chosen, unknown } = partitionSelectedDatasets(url.searchParams.get('datasets'), datasets.map(d => d.dataset));
  for (const k of chosen) selected.add(k);
  if (unknown.length > 0) {
    linkIssues.push(`ignored ${unknown.length} unknown publication${unknown.length === 1 ? '' : 's'} in the link (${unknown.join(', ')})`);
  }
  const { predicate, rejected } = sanitiseComparePredicate(url.searchParams.get('pred'));
  customPredicate = predicate;
  if (rejected !== null) {
    linkIssues.push('ignored an unsafe filter in the link (a filter must be a single condition, no “;”)');
  }
}
// The single restore path shared by popstate (first load routes through boot,
// which also applies its default selection). Re-render's own sync() is a no-op
// because the URL already matches, so restoring never itself writes history.
function restore() {
  readStateFromUrl();
  if (predInput !== null) predInput.value = customPredicate ?? '';
  updateFilterNote();
  renderPicker();
  void refresh();
}
function buildUrl() {
  const url = new URL(window.location.href);
  const view = stateToViewParam(state);
  if (view === null) url.searchParams.delete('view');
  else url.searchParams.set('view', view);
  if (selected.size === 0) url.searchParams.delete('datasets');
  else url.searchParams.set('datasets', [...selected].join(','));
  if (customPredicate === null) url.searchParams.delete('pred');
  else url.searchParams.set('pred', customPredicate);
  return url.toString();
}
const historySync = createHistorySync({ getUrl: buildUrl, onPopState: restore });
function writeUrl() { historySync.sync(); }

// A human description of the inherited filter, so the page states plainly
// what is being compared.
function describeFilter() {
  if (customPredicate !== null) return `a custom filter — ${customPredicate}`;
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

// Write the filter note into the status region (role="status" in compare.html,
// so a deep-linked pre-filtered state is announced to assistive tech), and
// append any notes about pieces a deep link could not honour so the degradation
// is visible rather than silent.
function updateFilterNote() {
  let text = `Comparing: ${describeFilter()}.`;
  if (linkIssues.length > 0) text += ` From the shared link: ${linkIssues.join('; ')}.`;
  filterNote.textContent = text;
}

// Open the master database and read the publication list. This is the page's
// EAGER, no-button first load, and it is the cold one: the master database is
// the large ~1 GB costume whose first open over HTTP range requests is a
// measured ~20s (issue #475). It runs through the shared loading affordance
// (issue #499) so the wait is communicated exactly as it is on Explore and the
// Playground - with no trigger button, the affordance drives the boot status
// (escalating to a first-use reassurance if the open runs long) and rides the
// results region's aria-busy, and a failed open raises the honest assertive
// alert instead of a bare status line. Exported (with its opener and elements
// injected) so a DOM test drives this exact eager path against a controlled
// opener without spinning up a real worker.
export function loadDatasets({ statusEl, alertEl, resultEl, openDatabase }) {
  return withDatabaseLoading(
    { statusEl, alertEl, resultEl, label: 'master database' },
    async (markRunning) => {
      const worker = await openDatabase();
      markRunning();
      return worker.db.query('SELECT dataset, record_count, intended_complete, scope_notes, coverage_affecting FROM history_datasets ORDER BY dataset DESC');
    },
  );
}

async function boot() {
  try {
    datasets = await loadDatasets({ statusEl: bootStatus, alertEl: bootAlert, resultEl: setup, openDatabase: openMaster });
  } catch {
    // The shared affordance already raised the assertive #boot-alert (a transient
    // load failure vs a query failure) and cleared the boot status; the setup
    // panel stays hidden. Nothing more to report here.
    return;
  }
  readStateFromUrl();
  // Default selection when none arrived in the link: the two most recent
  // publications with no scope caveat at all (declared complete, no
  // coverage-affecting observation) - the cleanest baseline pair to diff.
  if (selected.size === 0) {
    const clean = datasets.filter(d => scopeCaveat(d) === null);
    for (const d of (clean.length >= 2 ? clean : datasets).slice(0, 2)) selected.add(d.dataset);
  }
  bootStatus.hidden = true;
  updateFilterNote();
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

  const thead = el('thead', {}, [el('tr', {}, ['publication', 'matching rows', 'of total', '% of publication', 'change vs prior', 'scope'].map(h => el('th', { text: h })))]);
  // The "change vs prior" cell carries the change-magnitude indicator (#409):
  // each row against the row above it (rows run oldest→newest), so it reads as
  // "how much this snapshot moved from the prior one" — Phase-1 threshold
  // classification against the prior snapshot as baseline. The first row is the
  // baseline (no prior). A row is only classified when NEITHER it nor its
  // baseline carries a scope caveat: a declared-partial / coverage-affecting
  // publication's count is scope, not a real-world change, so a swing across
  // one (e.g. the blank-product omission, #330) is shown as a plain delta
  // marked "scope differs" rather than dressed up as a substantial deviation.
  const changeCell = (r, prior) => {
    if (prior === undefined) return el('td', { class: 'muted', text: 'baseline' });
    if (r.caveat !== null || prior.caveat !== null) {
      const c = classifyDelta(r.matching, prior.matching);
      return el('td', { class: 'muted', title: 'a scope caveat on either side makes this delta scope, not a real-world change' }, [signedPct(c), ' (scope differs)']);
    }
    return el('td', {}, [changeIndicator(r.matching, prior.matching)]);
  };
  const tbody = el('tbody', {}, rows.map((r, i) => el('tr', {}, [
    el('td', {}, [code(r.key)]),
    el('td', { text: nf(r.matching) }),
    el('td', { class: 'muted', text: nf(r.total) }),
    el('td', { text: r.total > 0 ? `${(100 * r.matching / r.total).toFixed(2)}%` : '—' }),
    changeCell(r, rows[i - 1]),
    el('td', { class: 'muted', text: r.caveat ?? '' }),
  ])));
  const table = el('table', {}, [thead, tbody]);
  table.prepend(el('caption', { class: 'table-caption', text: 'Matching rows per publication (oldest→newest), with the change of each against the prior snapshot.' }));
  const wrap = el('div', { class: 'overflow', style: 'overflow-x:auto' }, [table]);
  // State the first-draft thresholds on the surface itself, so the heuristic is
  // visible and adjustable rather than hidden in the code (#409 Phase 1).
  const note = el('p', { class: 'muted', style: 'font-size:.83rem' }, [
    'Change vs prior classifies each snapshot against the one above it: under 2% of the baseline reads as within the expected range (plain), 2–10% as a mild deviation (coloured, with a ↑/↓ caret), 10%+ as a substantial deviation (a filled badge). First-draft thresholds; deriving the typical per-period change is later work (#210).',
  ]);
  countsResult.replaceChildren(wrap, note);
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
  const tbody = el('tbody', {}, shown.map(r => el('tr', {}, columns.map(h => {
    if (h === 'callsign') return el('td', {}, [rawCallsign(r[h])]);
    if (h === 'cleaned') return el('td', {}, [code(r[h])]);
    return el('td', { text: r[h] === null ? 'NULL' : String(r[h]) });
  }))));
  details.append(el('div', { class: 'overflow', style: 'overflow-x:auto' }, [el('table', {}, [thead, tbody])]));
  if (rows.length > SAMPLE) details.append(el('p', { class: 'muted', text: `showing ${SAMPLE} of ${nf(rows.length)}` }));
  return details;
}

function renderSql(chosen, pred) {
  sqlSection.hidden = false;
  // Keep the editable filter box in step with the active predicate (unless the
  // user is mid-edit having typed something not yet applied).
  if (document.activeElement !== predInput) predInput.value = pred;
  const counts = chosen.map(k => `SELECT '${k}' AS publication, COUNT(*) AS matching\nFROM register_history WHERE dataset = '${k}' AND (${pred})`).join('\nUNION ALL\n');
  sqlText.textContent = counts + '\nORDER BY publication;';
}

// ---- Browser bootstrap (guarded) -------------------------------------------
// Runs only in a real browser with the httpvfs loader present (which attaches
// createDbWorker), exactly like playground.js. A unit/JSDOM test importing this
// module for the pure validators never trips this, so importing it opens no
// worker.
function initCompare() {
  // The editable filter: apply a hand-typed WHERE condition (read-only - a
  // single condition, no statement terminator), or reset to the inherited
  // filter. Safe like the entry browser's literal SQL: the VFS is read-only, so
  // the worst a crafted condition does is run another read-only read. A manual
  // edit supersedes the deep link, so its dropped-param notes are cleared.
  document.getElementById('pred-apply').addEventListener('click', () => {
    const raw = predInput.value.trim();
    if (raw.includes(';')) { scopeNote.textContent = 'Filter must be a single condition (no “;”).'; return; }
    customPredicate = raw === '' ? null : raw;
    linkIssues = [];
    updateFilterNote();
    void refresh();
  });
  document.getElementById('pred-reset').addEventListener('click', () => {
    customPredicate = null;
    linkIssues = [];
    updateFilterNote();
    void refresh();
  });

  boot();

  // Signal a successful start: cancel the startup-warning timer (compare.html)
  // and hide the warning if it was already shown. Reaching here means the module
  // loaded and its wiring ran; if a module had failed to load, none of this
  // executes and the warning surfaces. boot() reports its own data-loading
  // errors separately, so a database that fails to open still shows those.
  if (window.__compareReadyTimer !== undefined) clearTimeout(window.__compareReadyTimer);
  const startupWarning = document.getElementById('startup-warning');
  if (startupWarning !== null) startupWarning.hidden = true;
}

if (typeof window !== 'undefined' && typeof window.createDbWorker === 'function') {
  initCompare();
}
