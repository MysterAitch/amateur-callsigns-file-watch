// @ts-check
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
import { statusField, absentMarker } from './field-wrappers.js';
import { callsignPillLink } from './callsign-pill.js';
import { dateTimeDisplay } from './datetime.js';

/** @typedef {import('./browser-query.js').FilterState} FilterState */

// The row shape read back off the httpvfs worker's query() is not typed by the
// vendored library (no shipped types); every SELECT here states its own column
// use inline, exactly as ledger-query.js's QueryExecutor does for the ledger
// database. window.createDbWorker's own signature is declared once in
// global.d.ts, shared with app.js/entry-browser.js/explore.js.
/** @typedef {{ db: { query: (sql: string, params?: unknown[]) => Promise<any[]> } }} DbWorker */

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
      const res = await fetch(new URL('./data/version.txt', document.baseURI), { cache: 'no-store' });
      if (res.ok) version = (await res.text()).trim();
    } catch { /* fall back to unversioned */ }
    const dbUrl = new URL(`./data/ledger-history.sqlite.png?v=${encodeURIComponent(version)}`, document.baseURI);
    return createDbWorker(
      [{ from: 'inline', config: { serverMode: 'full', url: dbUrl.toString(), requestChunkSize: 4096 } }],
      workerUrl.toString(), wasmUrl.toString());
  })();
  return workerPromise;
}

// Mirrors document.createElement's own overload shape: a known tag name
// returns its specific HTMLElement subtype (so callers get .value/.hidden etc.
// without a cast), while the plain-string fallback overload keeps this
// assignable as a generic ElementFactory (none of this module's callers need
// that, but the shape matches entry-browser.js/explore.js for consistency).
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
/** @param {unknown} v */
function code(v) {
  const c = el('code');
  // eslint-disable-next-line @typescript-eslint/no-base-to-string -- `v` is deliberately `unknown` (any displayable value); a non-primitive intentionally falls back to its default stringification here rather than being excluded from display.
  c.textContent = v == null ? '' : String(v);
  return c;
}
// The counts table's '% of publication' cell: a zero-total cohort has no
// percentage to compute at all, so it degrades to the shared absent-value
// marker (#826), never a fabricated 0.00%. Exported (like registerHistoryTable/
// foiHistoryTable in app.js) so this boundary is unit-testable without opening
// the countsResult DOM/worker plumbing renderCounts drives.
/**
 * @param {number} total
 * @param {number} matching
 * @returns {HTMLElement}
 */
export function matchPercentCell(total, matching) {
  return total > 0 ? el('td', { text: `${(100 * matching / total).toFixed(2)}%` }) : el('td', {}, [absentMarker(el)]);
}
// The cleaned (artefact-stripped join key) column: this IS the register's own
// callsign, so - unlike the raw callsign column below - it links to its
// canonical per-callsign page (callsign.html, issue #594). `v` is deliberately
// `unknown` at this display boundary (an arbitrary named column in practice
// always a string here); a non-string falls back to the existing generic cell
// rather than being coerced into a broken link.
/** @param {unknown} v */
function cleanedCallsignCell(v) {
  return typeof v === 'string' ? callsignPillLink(el, v) : code(v);
}
// A callsign with whitespace/odd characters made legible (shared classifier),
// so a damaged value in a set-difference sample doesn't hide.
/** @param {unknown} raw */
function rawCallsign(raw) {
  const span = el('code');
  // eslint-disable-next-line @typescript-eslint/no-base-to-string -- `raw` is deliberately `unknown` at this display boundary; a non-primitive intentionally falls back to its default stringification rather than being excluded from the sample.
  for (const ch of String(raw ?? '')) {
    const marker = callsignCharMarker(ch);
    span.append(marker !== null ? el('span', { class: 'marker', text: marker }) : document.createTextNode(ch));
  }
  return span;
}
/** @param {number} n */
const nf = (n) => Number(n).toLocaleString('en-GB');

// ---- Change-magnitude indicator (issue #409) -------------------------------
// A reusable, at-a-glance readout of how much a value has CHANGED against a
// baseline, after the convention in clinical lab-result readouts: three
// severity tiers × direction. Severity AND direction are carried in SHAPE/TEXT
// — a directional caret (↑/↓) and, for a substantial count change, a filled badge
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
// change and flagging departures from that derived trend is PHASE 2, deferred to
// #210; this component does not attempt it.

// Default thresholds, as a fraction of the baseline. A FIRST-DRAFT heuristic to
// refine later (#210), stated explicitly so the boundary is visible: a register
// grows or shrinks a few percent between neighbouring snapshots as a matter of
// course, so under 2% reads as "within the expected range"; 2–10% is a mild
// deviation worth a glance; 10%+ is a substantial swing (e.g. the ~45k
// blank-product omission — #330).
/** @typedef {{ mild: number, substantial: number }} ChangeThresholds */
/** @type {ChangeThresholds} */
export const CHANGE_THRESHOLDS = { mild: 0.02, substantial: 0.10 };

/** @typedef {'in-range' | 'mild' | 'substantial'} ChangeSeverity */
/** @typedef {'up' | 'down' | 'none'} ChangeDirection */
/**
 * @typedef {object} DeltaClassification
 * @property {ChangeSeverity} severity
 * @property {ChangeDirection} direction
 * @property {number} delta
 * @property {number} ratio
 */

// Classify a value against a baseline. Returns the severity tier
// ('in-range' | 'mild' | 'substantial'), the direction ('up' | 'down' | 'none')
// and the signed/relative delta. Pure. A zero baseline that becomes non-zero is
// a substantial "appeared from none" (no ratio exists, but a population
// arriving from nothing is a strong signal); both zero is in-range.
/**
 * @param {number} value
 * @param {number} baseline
 * @param {ChangeThresholds} [thresholds]
 * @returns {DeltaClassification}
 */
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

/** @type {Record<ChangeDirection, string>} */
const CARET = { up: '↑', down: '↓', none: '' };
/** @param {number} ratio */
const formatPct = (ratio) => `${(ratio * 100).toFixed(1)}%`;
// A signed percentage using a true minus sign, for the plain in-range reading.
/** @param {DeltaClassification} c */
const signedPct = (c) => `${c.direction === 'down' ? '−' : c.direction === 'up' ? '+' : ''}${formatPct(c.ratio)}`;

// The accessible name a screen-reader announces for a classified change — the
// full "up 12%, substantial count change" phrasing the #409 spec calls for, so
// severity and direction never depend on colour or the caret glyph alone.
//
// The tier is a COUNT CHANGE on a DECLARED-COMPLETE BASIS (issue #836), not a
// verified register change: the indicator is only rendered when neither side
// carries a scope caveat, and "no caveat" means the publication declared itself
// complete (intended_complete, empty coverage_affecting) — publisher INTENT, not
// verified completeness. Intended-complete exports have been observed silently
// filtering records (the blank-product omission, #330), so a large swing here is
// a lead to check against the publication, never proof the register itself moved.
// The wording says "count change (declared-complete basis)" rather than
// "deviation" so an undiscovered silent filter cannot read as a verified change.
/** @param {DeltaClassification} c */
export function describeChange(c) {
  const dir = c.direction === 'up' ? 'up' : c.direction === 'down' ? 'down' : 'no change';
  if (c.severity === 'in-range') return c.direction === 'none' ? 'no change' : `${dir} ${formatPct(c.ratio)}, within the expected range`;
  const tier = c.severity === 'substantial' ? 'substantial count change (declared-complete basis)' : 'mild count change (declared-complete basis)';
  const magnitude = c.ratio === Infinity ? `${dir} ${nf(Math.abs(c.delta))} from none` : `${dir} ${formatPct(c.ratio)}`;
  return `${magnitude}, ${tier}`;
}

// The render-ready description of a change: the severity class, the visible
// text (caret + magnitude), and the accessible label. Kept separate from the
// DOM build so it can be asserted without a document.
/**
 * @param {number} value
 * @param {number} baseline
 * @param {ChangeThresholds} [thresholds]
 */
export function changeIndicatorSpec(value, baseline, thresholds = CHANGE_THRESHOLDS) {
  const c = classifyDelta(value, baseline, thresholds);
  const caret = CARET[c.direction];
  const magnitude = c.ratio === Infinity ? `${c.delta > 0 ? '+' : ''}${nf(c.delta)}` : (c.severity === 'in-range' ? signedPct(c) : formatPct(c.ratio));
  // In range: plain text, no caret marker; mild/substantial: caret + magnitude.
  const visible = c.severity === 'in-range' ? magnitude : `${caret} ${magnitude}`.trim();
  return { severity: c.severity, direction: c.direction, visible, label: describeChange(c) };
}

// The intent caveat a mild/substantial badge carries visibly (issue #836),
// echoing the register-history note's warning (site/app.js): the classification
// rests on the publication having DECLARED itself complete, which is intent, not
// verified completeness. A visible affordance (title on hover) alongside the
// accessible label, so the "declared-complete basis" reaches sighted readers too.
export const DECLARED_COMPLETE_BASIS_NOTE = 'A count change on a declared-complete basis: the publication declared itself complete, which is publisher intent, not verified completeness. Intended-complete exports have been observed silently filtering records, so a swing is a lead to check against the publication, not proof the register changed.';

// Build the indicator as a DOM node for a table cell. In range renders plain
// muted text (the signed percentage, read literally by a screen-reader); mild
// and substantial hide the visible caret+magnitude from assistive tech and
// carry the full accessible phrase in a visually-hidden span instead, so the
// announcement is "up 12.0%, substantial count change (declared-complete basis)",
// not "up-arrow 12 percent". The same declared-complete-basis caveat rides in the
// badge's title (issue #836), visible on hover.
/**
 * @param {number} value
 * @param {number} baseline
 * @param {ChangeThresholds} [thresholds]
 */
export function changeIndicator(value, baseline, thresholds = CHANGE_THRESHOLDS) {
  const spec = changeIndicatorSpec(value, baseline, thresholds);
  const cls = spec.severity === 'in-range' ? 'chg chg-inrange'
    : spec.severity === 'mild' ? 'chg chg-mild' : 'chg chg-substantial';
  if (spec.severity === 'in-range') { const plain = el('span', { class: cls }); plain.textContent = spec.visible; return plain; }
  const span = el('span', { class: cls, title: DECLARED_COMPLETE_BASIS_NOTE });
  span.append(el('span', { 'aria-hidden': 'true', text: spec.visible }));
  span.append(el('span', { class: 'visually-hidden', text: spec.label }));
  return span;
}

// A cohort larger than this per side is not set-diffed in the browser: the
// scan is honest work better done on the downloaded database. Counts still
// show; the diff panel explains why and points to the download.
const DIFF_CAP = 25000;
const SAMPLE = 50; // rows shown per difference category

/** @type {FilterState} */
const state = {
  facets: new Map(), toggles: new Set(), columnFilters: new Map(),
  sort: [{ col: 'callsign', dir: 'ASC' }], pageSize: 25, customSql: null,
};
/** @type {Set<string>} */
const selected = new Set();      // dataset keys chosen for comparison
// One row of history_datasets, exactly as loadDatasets' SELECT reads it back.
/**
 * @typedef {object} HistoryDatasetRow
 * @property {string} dataset
 * @property {number} record_count
 * @property {string} intended_complete
 * @property {string} scope_notes
 * @property {string} coverage_affecting
 */
/** @type {HistoryDatasetRow[]} */
let datasets = [];
// A hand-edited filter condition that overrides the inherited facet/toggle
// state - so a comparison whose inherited filter matched nothing can be fixed
// in place without a round-trip to a publication browser.
/** @type {string | null} */
let customPredicate = null;
// Human notes about pieces DROPPED from a deep link (an unsafe ?pred=, an
// unknown ?datasets= key) - surfaced in the filter note so a stale or mangled
// link is honest about what it could not honour rather than failing silently.
/** @type {string[]} */
let linkIssues = [];

// A URL-supplied ?pred= is applied verbatim as a SQL WHERE condition, so it
// gets the SAME guard the hand-edit "Apply filter" button uses: a single
// condition, no statement separator. A link carrying a ';' is rejected (the
// comparison degrades to its inherited filter) rather than smuggling a second
// statement into the read-only query. Pure, so it is unit-tested. Returns the
// usable predicate (or null) and the rejected raw value (or null) for a note.
/** @param {string | null} rawPred */
export function sanitiseComparePredicate(rawPred) {
  if (rawPred === null || rawPred === '') return { predicate: null, rejected: null };
  if (rawPred.includes(';')) return { predicate: null, rejected: rawPred };
  return { predicate: rawPred, rejected: null };
}

// Split a ?datasets= selection into keys that exist in the loaded publication
// list and keys that do not (a stale link naming a since-removed publication).
// Unknown keys are dropped from the selection and reported, never silently
// applied. Pure; order-preserving and de-duplicated.
/**
 * @param {string | null} rawSets
 * @param {string[]} knownKeys
 */
export function partitionSelectedDatasets(rawSets, knownKeys) {
  const known = new Set(knownKeys);
  /** @type {string[]} */
  const chosen = [];
  /** @type {string[]} */
  const unknown = [];
  const seen = new Set();
  for (const k of (rawSets ?? '').split(',')) {
    if (k === '' || seen.has(k)) continue;
    seen.add(k);
    (known.has(k) ? chosen : unknown).push(k);
  }
  return { chosen, unknown };
}

// A dataset-picker checkbox's human label (#551): full date, not the default
// month-only precision - the picker lists EVERY archived publication side by
// side, and the archive already holds more than one in the same month (e.g.
// 2025-06-04 and 2025-06-08), so day precision is this surface's disambiguation
// case, not a stylistic choice. Pure, so it is unit-tested without the picker's
// DOM. The raw key stays visible too (a monospace chip beside the label), so
// the exact machine value is never only inferable from the humanised text.
/** @param {string} datasetKey */
export function datasetPickerLabel(datasetKey) {
  return dateTimeDisplay(datasetKey, { precision: 'full-date' });
}

// Guaranteed present: compare.html always ships this fixed panel scaffold, and
// nothing here has ever null-guarded these (a page missing one of them is not
// a state this module tries to run in).
const setup = /** @type {HTMLElement} */ (document.getElementById('setup'));
const picker = /** @type {HTMLElement} */ (document.getElementById('dataset-picker'));
const filterNote = /** @type {HTMLElement} */ (document.getElementById('filter-note'));
const scopeNote = /** @type {HTMLElement} */ (document.getElementById('scope-note'));
const countsSection = /** @type {HTMLElement} */ (document.getElementById('counts'));
const countsResult = /** @type {HTMLElement} */ (document.getElementById('counts-result'));
const diffSection = /** @type {HTMLElement} */ (document.getElementById('diff'));
const diffResult = /** @type {HTMLElement} */ (document.getElementById('diff-result'));
const sqlSection = /** @type {HTMLElement} */ (document.getElementById('sql'));
const sqlText = /** @type {HTMLElement} */ (document.getElementById('sql-text'));
const predInput = /** @type {HTMLTextAreaElement} */ (document.getElementById('pred-input'));
const bootStatus = /** @type {HTMLElement} */ (document.getElementById('boot-status'));
const bootAlert = /** @type {HTMLElement} */ (document.getElementById('boot-alert'));

// A publication whose declared coverage is partial, or that carries a
// coverage-affecting quality observation: presence differences against it are
// not add/remove events.
/** @param {HistoryDatasetRow} [d] */
function scopeCaveat(d) {
  if (d === undefined) return null;
  if (d.intended_complete === 'false') return 'declared partial';
  if ((d.coverage_affecting ?? '') !== '') return 'coverage-affecting observation';
  if (d.intended_complete === '' || d.intended_complete === undefined) return 'coverage not declared';
  return null;
}
/** @param {string} key */
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

// Open the combined database and read the publication list. This is the page's
// EAGER, no-button first load, and it is the cold one: the combined database is
// the large ~1 GB costume whose first open over HTTP range requests is a
// measured ~20s (issue #475). It runs through the shared loading affordance
// (issue #499) so the wait is communicated exactly as it is on Explore and the
// Playground - with no trigger button, the affordance drives the boot status
// (escalating to a first-use reassurance if the open runs long) and rides the
// results region's aria-busy, and a failed open raises the honest assertive
// alert instead of a bare status line. Exported (with its opener and elements
// injected) so a DOM test drives this exact eager path against a controlled
// opener without spinning up a real worker.
/**
 * @param {{ statusEl?: HTMLElement, alertEl?: HTMLElement, resultEl?: HTMLElement, openDatabase: () => Promise<DbWorker> }} elements
 * @returns {Promise<HistoryDatasetRow[]>}
 */
export function loadDatasets({ statusEl, alertEl, resultEl, openDatabase }) {
  return withDatabaseLoading(
    { statusEl, alertEl, resultEl, label: 'combined database' },
    async (markRunning) => {
      const worker = await openDatabase();
      markRunning();
      /** @type {HistoryDatasetRow[]} */
      const rows = await worker.db.query('SELECT dataset, record_count, intended_complete, scope_notes, coverage_affecting FROM history_datasets ORDER BY dataset DESC');
      return rows;
    },
  );
}

async function boot() {
  try {
    datasets = await loadDatasets({ statusEl: bootStatus, alertEl: bootAlert, resultEl: setup, openDatabase: openCombined });
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
      input, ' ', el('strong', { text: datasetPickerLabel(d.dataset) }), ' ', code(d.dataset),
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

// One row of the counts table: a publication's matching/total cohort size and
// its scope caveat (null when the publication carries none).
/**
 * @typedef {object} CountRow
 * @property {string} key
 * @property {number} matching
 * @property {number} total
 * @property {string | null} caveat
 */

/**
 * @param {string[]} chosen
 * @param {string} pred
 */
async function renderCounts(chosen, pred) {
  countsSection.hidden = false;
  // A trivial predicate matches every row, so the answer is already known -
  // history_datasets.record_count - and no whole-register scan over range
  // requests is needed. Only a real filter costs a query.
  const trivial = pred === '1=1';
  if (!trivial) countsResult.replaceChildren(el('p', { class: 'muted', text: 'Counting… (scans each publication over HTTP range requests — a few seconds)' }));
  /** @type {CountRow[]} */
  const rows = [];
  /** @type {DbWorker | null} */
  let worker = null;
  for (const key of chosen) {
    const d = datasetOf(key);
    const total = Number(d?.record_count ?? 0);
    let matching = total;
    if (!trivial) {
      try {
        worker ??= await openCombined();
        /** @type {{ n: number }[]} */
        const r = await worker.db.query(matchingCountSql(key, pred));
        matching = Number(r[0].n);
      } catch (err) {
        // Caught value is `unknown`; read `.message` through the same narrowed
        // view db-loading.js uses at the same kind of boundary.
        const message = /** @type {{ message?: string }} */ ((typeof err === 'object' && err !== null) ? err : {}).message;
        countsResult.replaceChildren(el('p', { class: 'muted', text: `Query failed: ${message ?? String(err)}` })); return;
      }
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
  // marked "scope differs" rather than dressed up as a substantial count change.
  /**
   * @param {CountRow} r
   * @param {CountRow} [prior]
   */
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
    matchPercentCell(r.total, r.matching),
    changeCell(r, rows[i - 1]),
    el('td', { class: 'muted', text: r.caveat ?? '' }),
  ])));
  const table = el('table', {}, [thead, tbody]);
  table.prepend(el('caption', { class: 'table-caption', text: 'Matching rows per publication (oldest→newest), with the change of each against the prior snapshot.' }));
  const wrap = el('div', { class: 'overflow', style: 'overflow-x:auto' }, [table]);
  // State the first-draft thresholds on the surface itself, so the heuristic is
  // visible and adjustable rather than hidden in the code (#409 Phase 1).
  const note = el('p', { class: 'muted', style: 'font-size:.83rem' }, [
    'Change vs prior classifies each snapshot against the one above it: under 2% of the baseline reads as within the expected range (plain), 2–10% as a mild count change (coloured, with a ↑/↓ caret), 10%+ as a substantial count change (a filled badge). First-draft thresholds; deriving the typical per-period change is later work (#210). This is a count change on a declared-complete basis: a snapshot is only classified when neither it nor its baseline carries a scope caveat, but "no caveat" means the publication declared itself complete — publisher intent, not verified completeness. Intended-complete exports have been observed silently filtering records (e.g. the blank-product omission, #330), so a swing here is a lead to check against the publication, not proof the register itself changed.',
  ]);
  countsResult.replaceChildren(wrap, note);
}
/** @type {Map<string, number>} */
const countCache = new Map();

/**
 * @param {string[]} chosen
 * @param {string} pred
 */
async function renderDiff(chosen, pred) {
  if (chosen.length !== 2) {
    diffSection.hidden = false;
    diffResult.replaceChildren(el('p', { class: 'muted', text: chosen.length < 2 ? 'Select a second publication to see what changed.' : 'Set-differences compare a pair — select exactly two publications.' }));
    return;
  }
  diffSection.hidden = false;
  const [a, b] = chosen; // chosen is sorted ascending, so a is the earlier baseline
  const da = datasetOf(a); const db = datasetOf(b);
  /** @type {string[]} */
  const caveats = [];
  if (scopeCaveat(da) !== null) caveats.push(`${a} is ${scopeCaveat(da)}`);
  if (scopeCaveat(db) !== null) caveats.push(`${b} is ${scopeCaveat(db)}`);

  const sizeA = countCache.get(a) ?? Infinity;
  const sizeB = countCache.get(b) ?? Infinity;
  if (Math.max(sizeA, sizeB) > DIFF_CAP) {
    diffResult.replaceChildren(el('p', { class: 'muted' }, [
      `The filtered cohort is large (${nf(Math.max(sizeA, sizeB))} rows) — an in-browser set-diff over HTTP range requests would be slow. Narrow the filter, or run it on the `,
      el('a', { href: 'datasets/index.html', text: 'downloaded combined database' }), '.',
    ]));
    return;
  }

  diffResult.replaceChildren(el('p', { class: 'muted', text: `Comparing ${a} → ${b}…` }));
  /** @type {DbWorker} */
  let worker;
  try {
    worker = await openCombined();
  } catch (err) {
    // Caught value is `unknown`; read `.message` through the same narrowed view
    // db-loading.js uses at the same kind of boundary.
    const message = /** @type {{ message?: string }} */ ((typeof err === 'object' && err !== null) ? err : {}).message;
    diffResult.replaceChildren(el('p', { class: 'muted', text: message ?? String(err) })); return;
  }

  const diff = setDiffSql(a, b, pred);
  /** @type {Record<string, unknown>[]} */
  let appeared;
  /** @type {Record<string, unknown>[]} */
  let disappeared;
  /** @type {Record<string, unknown>[]} */
  let changed;
  try {
    /** @type {Record<string, unknown>[]} */
    const appearedRows = await worker.db.query(diff.appeared);
    /** @type {Record<string, unknown>[]} */
    const disappearedRows = await worker.db.query(diff.disappeared);
    /** @type {Record<string, unknown>[]} */
    const changedRows = await worker.db.query(diff.changed);
    appeared = appearedRows;
    disappeared = disappearedRows;
    changed = changedRows;
  } catch (err) {
    // Caught value is `unknown`; read `.message` through the same narrowed view
    // db-loading.js uses at the same kind of boundary.
    const message = /** @type {{ message?: string }} */ ((typeof err === 'object' && err !== null) ? err : {}).message;
    diffResult.replaceChildren(el('p', { class: 'muted', text: `Diff failed: ${message ?? String(err)}` })); return;
  }

  /** @type {Node[]} */
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

/**
 * One set-difference/change sample table (callsign/cleaned/status columns),
 * rendered as a collapsible `<details>`. Exported so the field-wrapper
 * adoption on its status columns (#625) is exercised directly.
 * @param {string} title
 * @param {Record<string, unknown>[]} rows
 * @param {string[]} columns
 */
export function diffBlock(title, rows, columns) {
  const shown = rows.slice(0, SAMPLE);
  const details = el('details', { class: 'cmp-diffblock' });
  details.append(el('summary', {}, [el('strong', { text: `${nf(rows.length)} ` }), title]));
  if (rows.length === 0) { details.append(el('p', { class: 'muted', text: 'none' })); return details; }
  const thead = el('thead', {}, [el('tr', {}, columns.map(h => el('th', { text: h })))]);
  const tbody = el('tbody', {}, shown.map(r => el('tr', {}, columns.map(h => {
    if (h === 'callsign') return el('td', {}, [rawCallsign(r[h])]);
    if (h === 'cleaned') return el('td', {}, [cleanedCallsignCell(r[h])]);
    // A status column (#553/#625) routes through the shared field wrapper -
    // 'plain' linking, since this sample table repeats the same handful of
    // status values down up to SAMPLE rows.
    if ((h === 'status' || h === 'status_before' || h === 'status_after') && typeof r[h] === 'string') {
      return el('td', {}, [statusField(el, r[h], { glossaryLinking: 'plain' })]);
    }
    // eslint-disable-next-line @typescript-eslint/no-base-to-string -- row values are deliberately `unknown` (an arbitrary named column); a non-primitive intentionally falls back to its default stringification rather than being excluded from the cell.
    return el('td', { text: r[h] === null ? 'NULL' : String(r[h]) });
  }))));
  details.append(el('div', { class: 'overflow', style: 'overflow-x:auto' }, [el('table', {}, [thead, tbody])]));
  if (rows.length > SAMPLE) details.append(el('p', { class: 'muted', text: `showing ${SAMPLE} of ${nf(rows.length)}` }));
  return details;
}

/**
 * @param {string[]} chosen
 * @param {string} pred
 */
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
  document.getElementById('pred-apply')?.addEventListener('click', () => {
    const raw = predInput.value.trim();
    if (raw.includes(';')) { scopeNote.textContent = 'Filter must be a single condition (no “;”).'; return; }
    customPredicate = raw === '' ? null : raw;
    linkIssues = [];
    updateFilterNote();
    void refresh();
  });
  document.getElementById('pred-reset')?.addEventListener('click', () => {
    customPredicate = null;
    linkIssues = [];
    updateFilterNote();
    void refresh();
  });

  void boot();

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
