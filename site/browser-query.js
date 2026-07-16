// @ts-check
// Shared query/state core for the coordinated data browser (entry-browser.js,
// one publication) and the cross-publication comparison surface (issue #199).
// Pure by construction - no DOM, no window - so it is unit-testable in node
// and importable by both front-ends. The rendering/interaction lives in the
// callers; this module owns only how filter state becomes SQL and how it
// round-trips through the shareable ?view= link.
//
// The predicate is deliberately dataset-agnostic: the entry browser scopes it
// to one publication (WHERE dataset = key); the comparison surface omits that
// clause and applies `dataset = <d>` itself, once per publication, so the same
// user selection runs identically across many datasets.

// A single sort instruction: which column, and the SQL direction keyword to
// order it by ('ASC' or 'DESC' in practice; typed as the string the UI carries).
/** @typedef {{ col: string, dir: string }} SortEntry */

// One facet in the filter state: a set of selected values for a field, either
// included or excluded, where the field may be a plain column or a SQL expression.
/**
 * @typedef {object} Facet
 * @property {string} key
 * @property {string} field
 * @property {boolean} isExpr
 * @property {string} label
 * @property {Set<string>} values
 * @property {boolean} exclude
 */

// A facet as it appears in the compact serialised ?view= object (short keys, and
// values as a plain array rather than a Set), the inverse of serializeFilterState.
/**
 * @typedef {object} SerializedFacet
 * @property {string} k
 * @property {string} field
 * @property {boolean} x
 * @property {string} l
 * @property {string[]} v
 * @property {boolean} e
 */

// The live filter state both front-ends hold and this module reads. The pieces
// are native collections so they mutate in place and serialise compactly.
/**
 * @typedef {object} FilterState
 * @property {Map<string, Facet>} facets
 * @property {Set<string>} toggles
 * @property {Map<string, string>} columnFilters
 * @property {SortEntry[]} sort
 * @property {number} pageSize
 * @property {string | null} customSql
 */

export const COLUMNS = ['callsign', 'cleaned', 'status', 'product', 'implied_class', 'prefix_series'];

/** @type {Record<string, { label: string, sql: string }>} */
export const TOGGLES = {
  'raw-cleaned': { label: 'raw ≠ cleaned', sql: 'callsign != cleaned' },
  forbidden: { label: 'forbidden-suffix', sql: 'suffix IN (SELECT suffix FROM ref_forbidden_suffixes)' },
  // Invalid / non-parseable rows (e.g. a stray ",,") - parse_status rides in
  // register_history alongside the other component keys.
  unparseable: { label: 'unparseable', sql: "parse_status = 'unparseable'" },
};

export const PAGE_SIZES = [25, 50, 100, 250, 500, 1000];

// The pristine defaults an untouched view holds - kept here so serialise
// (what to omit from ?view=), the front-ends' initial state, and the restore
// path (what to reset an absent piece back to) all agree on one definition.
export const DEFAULT_PAGE_SIZE = 25;
/** @returns {SortEntry[]} */
export function defaultSort() { return [{ col: 'callsign', dir: 'ASC' }]; }

// --- rendering helper shared by both browsers ---
// Everything outside the plain callsign alphabet (letters, digits, / and #,
// matching the parser's NON_PLAIN set) is flagged so it can't hide or pass
// unnoticed. Returns null for a plain glyph (pass through unchanged); a
// {friendly-name} or {U+XXXX} label for an INVISIBLE character (whitespace,
// control, format, replacement - no glyph of its own); or the character
// itself for a visible stray (a hyphen, dot, star) which stays readable but
// is shown highlighted. Pure, so it is unit-tested; the DOM assembly and the
// highlight styling live in each browser.
// The single source of truth for the friendly marker vocabulary (issue #610):
// the server render layer (src/ci/render/callsign.ts) imports this table and
// the translation helper below rather than mirroring them, so a marker reads
// identically on a generated page and in the interactive browsers by
// construction. Only invisibles with a widely-recognised abbreviation are
// named; ZWSP (zero-width space, U+200B) earns one on the same grounds as BOM -
// a completely invisible character whose {U+200B} form gives the reader no
// intuition, whereas {ZWSP} names the culprit. Anything else invisible falls
// back to its {U+XXXX} code point (U+FFFD, the replacement character, is left
// as its bare code point on purpose - it already reads unambiguously).
/** @type {Record<number, string>} */
export const CALLSIGN_CHAR_NAMES = { 0x09: 'TAB', 0x0a: 'LF', 0x0d: 'CR', 0x20: 'SP', 0xa0: 'NBSP', 0x200b: 'ZWSP', 0xfeff: 'BOM', 0xfffd: 'U+FFFD' };
/** @param {string} ch */
export function callsignCharMarker(ch) {
  if (/[a-zA-Z0-9#/]/.test(ch)) return null;
  const cp = ch.codePointAt(0);
  // An empty input has no code point and so no marker; guarding it also lets the
  // lookups below treat cp as a definite number.
  if (cp === undefined) return null;
  const named = CALLSIGN_CHAR_NAMES[cp];
  if (named !== undefined) return `{${named}}`;
  // Characters with no standalone glyph get the codepoint: \p{C}
  // (control/format, incl. zero-width chars \s misses), \p{Z} (all
  // separators), and \p{M} (combining marks - a lone accent would otherwise
  // float onto the marker span). Any other non-plain character is a visible
  // glyph of its own (a stray hyphen, an accented letter, an emoji), so show
  // it as-is; the caller highlights it. `for...of` iterates by code point, so
  // an astral emoji is one unit here.
  if (/[\p{C}\p{Z}\p{M}]/u.test(ch)) return `{U+${cp.toString(16).toUpperCase().padStart(4, '0')}}`;
  return ch;
}

// Long-form descriptions for the friendly-named invisibles, so a marker
// translated to its friendly name can still spell out the exact code point in
// its title ('non-breaking space (U+00A0)'). Keyed by code point; every entry
// with a real friendly name in CALLSIGN_CHAR_NAMES carries one.
/** @type {Record<number, string>} */
const CALLSIGN_CHAR_DESCRIPTIONS = {
  0x09: 'tab', 0x0a: 'line feed', 0x0d: 'carriage return', 0x20: 'space',
  0xa0: 'non-breaking space', 0x200b: 'zero-width space', 0xfeff: 'byte-order mark',
};

// A pre-marked {U+XXXX} code-point token, capturing the hex. Anchored, so only
// a whole token translates - a literal brace or a fragment of surrounding text
// never does.
const CODEPOINT_MARKER_TOKEN_RE = /^\{U\+([0-9A-Fa-f]{4,6})\}$/;

/** @param {number} cp */
function codepointLabel(cp) { return `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`; }

// Translate ONE pre-marked marker token to its friendly presentation - the
// render-time half of issue #610. Derivation stores the unambiguous {U+XXXX}
// code point (as UTC is stored and the timezone applied at the edge); the
// friendly name is applied as close to the reader as reasonably possible. A
// {U+XXXX} token whose code point has a friendly name becomes {NAME} with a
// title that STILL spells the exact code point ('non-breaking space (U+00A0)');
// every other token - a {U+XXXX} with no friendly name, an already-friendly
// {SP}/{NBSP}, a malformed {U+} fragment, or a non-token string - is returned
// unchanged with no title. Pure, so the generated pages and the browsers
// translate identically.
/** @param {string} token @returns {{ text: string, title: string | null }} */
export function translateMarkerToken(token) {
  const match = CODEPOINT_MARKER_TOKEN_RE.exec(token);
  if (match === null) return { text: token, title: null };
  const cp = parseInt(match[1], 16);
  const named = CALLSIGN_CHAR_NAMES[cp];
  // No friendly name, or a "name" that is itself the bare U+ label (U+FFFD):
  // the code point already reads unambiguously, so leave it exactly as
  // derivation wrote it.
  if (named === undefined || named.startsWith('U+')) return { text: token, title: null };
  const description = CALLSIGN_CHAR_DESCRIPTIONS[cp];
  const gloss = description === undefined ? codepointLabel(cp) : `${description} (${codepointLabel(cp)})`;
  return { text: `{${named}}`, title: gloss };
}

// A SQL string literal, single quotes doubled. Values come from the data or
// the user's own filter inputs; interpolating them (rather than binding ?)
// makes the DISPLAYED SQL self-contained and runnable as-is - the whole
// point of the "Edit SQL" hand-off. Safe here: the database is read-only
// (the VFS cannot write) and every statement passes the SELECT/WITH guard,
// so the worst a crafted value could do is run another read-only query the
// user could already run in SQL mode.
/** @param {unknown} value */
export function quote(value) { return `'${String(value).replace(/'/g, "''")}'`; }

// --- callsign RSL-normalisation shared by the index lookup (app.js) and the
// per-dataset browser (entry-browser.js) ---
// Normalise ANY rendering of a callsign to its RSL-placeholder form
// (M7TEE, MW7TEE, ME7TEE, M#7TEE -> M#7TEE; 2E0ABC, 20ABC, 2#0ABC -> 2#0ABC).
// The register stores the RSL-less core (Ofcom: "the core call sign does not
// include an RSL"), and the lookup's components.csv stores this same
// placeholder for every parsed row - so one indexed equality query on
// placeholder_form finds the licence whichever variant is typed. Visitor/
// reciprocal prefix Mx/ carries the RSL in position 2 (M/, MM/, MW/, ...), so
// every regional rendering normalises to M#/homecall and resolves to the
// canonical M/ register row. Pure (no DOM, no reference data), so both
// front-ends share it; expects an already-upper-cased value (the callers
// upper-case user input before calling).
/** @param {string} value */
export function placeholderOf(value) {
  const gm = /^([GM])(?:([A-Z#])?)(\d)([A-Z]+)$/.exec(value);
  if (gm) return `${gm[1]}#${gm[3]}${gm[4]}`;
  const two = /^2(?:([A-Z#])?)(\d)([A-Z]+)$/.exec(value);
  if (two) return `2#${two[2]}${two[3]}`;
  const visitor = /^M(?:[A-Z#]?)\/(.+)$/.exec(value);
  if (visitor) return `M#/${visitor[1]}`;
  return null;
}

// The canonical RSL-less register core of a callsign rendering: the register
// stores this form (the placeholder with the RSL slot removed), so matching a
// search's core against a `callsign` column resolves a regional variant to its
// canonical row. Returns null when the value is not a recognised callsign
// rendering (nothing to resolve).
/** @param {string} value */
export function canonicalCallsign(value) {
  const placeholder = placeholderOf(value);
  return placeholder === null ? null : placeholder.replace('#', '');
}

// The canonical register core a plain callsign-column search resolves TO, or
// null when there is nothing to resolve: a non-callsign column, an empty
// input, an operator/negation/wildcard search (those are matched literally),
// an unrecognised value, or a value that is already its own core. Shared by
// parseColumnFilter (to widen the predicate) and the browser UI (to show the
// "MW7TEE -> M7TEE" resolution), so the two never disagree on when a variant
// resolves.
/**
 * @param {string} col
 * @param {string} raw
 */
export function resolvedCallsignCore(col, raw) {
  if (col !== 'callsign') return null;
  const s = raw.trim();
  if (s === '' || /^(>=|<=|!=|>|<|=)/.test(s) || s.startsWith('!') || /[*?]/.test(s)) return null;
  const upper = s.toUpperCase();
  const core = canonicalCallsign(upper);
  return core !== null && core !== upper ? core : null;
}

// Per-column filter mini-language: comparison operators, GLOB wildcards
// (* ?), ! to negate, bare text = contains. Returns a literal SQL fragment,
// or null for an empty input. Complex boolean (a OR b) is a power query for
// SQL mode. A plain callsign search that names a regional variant also matches
// its canonical register core, so a search there resolves the same way the
// index lookup does.
/**
 * @param {string} col
 * @param {string} raw
 */
export function parseColumnFilter(col, raw) {
  const s = raw.trim();
  if (s === '') return null;
  const op = /^(>=|<=|!=|>|<|=)\s*(.+)$/.exec(s);
  if (op !== null) return `"${col}" ${op[1]} ${quote(op[2].trim())}`;
  const negate = s.startsWith('!');
  const body = (negate ? s.slice(1) : s).trim();
  if (body === '') return null;
  if (/[*?]/.test(body)) return `"${col}" ${negate ? 'NOT ' : ''}GLOB ${quote(body)}`;
  const like = `"${col}" ${negate ? 'NOT ' : ''}LIKE ${quote(`%${body}%`)}`;
  const core = resolvedCallsignCore(col, s);
  return core !== null ? `(${like} OR "${col}" = ${quote(core)})` : like;
}

// Compose the WHERE predicate from filter state (facets, boolean toggles,
// per-column inputs). The dataset scope is optional: pass {dataset} to scope
// to one publication; omit it for a dataset-agnostic predicate the caller
// combines with its own `dataset = <d>`. Returns a clause always safe to drop
// after WHERE - '1=1' when nothing is selected.
/**
 * @param {FilterState} state
 * @param {{ dataset?: string }} [opts]
 */
export function buildPredicate(state, opts = {}) {
  const clauses = [];
  if (opts.dataset !== undefined) clauses.push(`dataset = ${quote(opts.dataset)}`);
  for (const f of state.facets.values()) {
    if (f.values.size === 0) continue;
    const field = f.isExpr ? f.field : `"${f.field}"`;
    const vals = [...f.values].map(quote).join(', ');
    clauses.push(`${field} ${f.exclude ? 'NOT IN' : 'IN'} (${vals})`);
  }
  for (const id of state.toggles) if (TOGGLES[id] !== undefined) clauses.push(`(${TOGGLES[id].sql})`);
  for (const [col, raw] of state.columnFilters) {
    const frag = parseColumnFilter(col, raw);
    if (frag !== null) clauses.push(`(${frag})`);
  }
  return clauses.length > 0 ? clauses.join(' AND ') : '1=1';
}

// The default sort the ?view= link omits (so a pristine view has no param).
/** @param {SortEntry[]} sort */
export function isDefaultSort(sort) {
  return sort.length === 1 && sort[0].col === 'callsign' && sort[0].dir === 'ASC';
}

// Serialise filter state to the compact object stored in the ?view= query
// param. Only non-default facets/toggles/filters/sort/size/customSql are
// emitted, so an untouched view serialises to {} (no param at all).
/** @param {FilterState} state */
export function serializeFilterState(state) {
  const obj = {};
  const facets = [...state.facets.values()].filter(f => f.values.size > 0)
    .map(f => ({ k: f.key, field: f.field, x: f.isExpr, l: f.label, v: [...f.values], e: f.exclude }));
  if (facets.length > 0) obj.f = facets;
  if (state.toggles.size > 0) obj.t = [...state.toggles];
  if (state.columnFilters.size > 0) obj.c = [...state.columnFilters];
  if (!isDefaultSort(state.sort)) obj.s = state.sort;
  if (state.pageSize !== DEFAULT_PAGE_SIZE) obj.z = state.pageSize;
  if (state.customSql !== null && state.customSql !== undefined) obj.q = state.customSql;
  return obj;
}

// --- cross-publication comparison SQL (issue #199) ---
// The comparison surface applies the dataset-agnostic predicate to each
// selected publication and set-diffs the results on the artefact-safe
// `cleaned` key. Every per-dataset piece is a SELF-CONTAINED, non-correlated
// subquery, so the shared unqualified predicate resolves against that
// subquery's own columns with no aliasing - the same predicate string the
// single-publication browser builds drops straight in.

// Rows in one publication matching the predicate.
/**
 * @param {string} dataset
 * @param {string} predicate
 */
export function matchingCountSql(dataset, predicate) {
  return `SELECT COUNT(*) AS n FROM register_history WHERE dataset = ${quote(dataset)} AND (${predicate})`;
}

// Set-differences of the filtered cohort between an earlier `baseline` and a
// later `comparison` publication: rows whose cleaned key appeared, disappeared,
// or whose status changed. NOT IN is safe here because `cleaned` is never NULL
// (it is a derived key, blank at worst, never absent).
/**
 * @param {string} baseline
 * @param {string} comparison
 * @param {string} predicate
 */
export function setDiffSql(baseline, comparison, predicate) {
  const inBaseline = `SELECT cleaned FROM register_history WHERE dataset = ${quote(baseline)} AND (${predicate})`;
  const inComparison = `SELECT cleaned FROM register_history WHERE dataset = ${quote(comparison)} AND (${predicate})`;
  return {
    appeared: `SELECT callsign, cleaned, status FROM register_history WHERE dataset = ${quote(comparison)} AND (${predicate}) AND cleaned NOT IN (${inBaseline}) ORDER BY callsign`,
    disappeared: `SELECT callsign, cleaned, status FROM register_history WHERE dataset = ${quote(baseline)} AND (${predicate}) AND cleaned NOT IN (${inComparison}) ORDER BY callsign`,
    changed: `SELECT ra.callsign, ra.cleaned, ra.status AS status_before, rb.status AS status_after`
      + ` FROM (SELECT callsign, cleaned, status FROM register_history WHERE dataset = ${quote(baseline)} AND (${predicate})) ra`
      + ` JOIN (SELECT cleaned, status FROM register_history WHERE dataset = ${quote(comparison)} AND (${predicate})) rb ON ra.cleaned = rb.cleaned`
      + ` WHERE ra.status != rb.status ORDER BY ra.callsign`,
  };
}

// Inverse of serializeFilterState: reconstruct the state pieces from a parsed
// ?view= object. Returns only the pieces present, as native Map/Set/array, so
// the caller merges them into its own live state and syncs its UI. Unknown
// toggle ids are dropped (schema drift safety).
/**
 * The argument is untrusted parsed JSON of unknown shape (a possibly stale or
 * hand-mangled ?view= link), so every piece is `unknown` at this JSON boundary
 * and is runtime-guarded (Array.isArray / typeof) before use.
 * @param {Record<string, unknown>} obj
 * @returns {Partial<FilterState>}
 */
export function parseFilterState(obj) {
  /** @type {Partial<FilterState>} */
  const out = {};
  if (Array.isArray(obj.f)) {
    out.facets = new Map(obj.f.map((/** @type {SerializedFacet} */ f) => [f.k, { key: f.k, field: f.field, isExpr: f.x, label: f.l, values: new Set(f.v), exclude: f.e }]));
  }
  if (Array.isArray(obj.t)) out.toggles = new Set(obj.t.filter((/** @type {string} */ id) => TOGGLES[id] !== undefined));
  if (Array.isArray(obj.c)) out.columnFilters = new Map(obj.c);
  if (Array.isArray(obj.s)) out.sort = obj.s;
  if (typeof obj.z === 'number') out.pageSize = obj.z;
  if (typeof obj.q === 'string') out.customSql = obj.q;
  return out;
}

// --- shared ?view= round-trip + history wiring (issue #214) ---
// The single-publication browser and the comparison surface both read/write
// the same ?view= param, so the state<->URL mapping and the back/forward
// restore path live here once. These stay pure (no DOM, no window): the thin
// History-API side effects live in the front-ends via historySyncAction.

// The value for the ?view= query param, or null when the view is pristine (so
// the caller deletes the param rather than emitting an empty {}).
/** @param {FilterState} state */
export function stateToViewParam(state) {
  const obj = serializeFilterState(state);
  return Object.keys(obj).length === 0 ? null : JSON.stringify(obj);
}

// Inverse of stateToViewParam: a raw ?view= string (or null/absent) becomes
// the parsed state pieces. A malformed or non-object link yields {} so a stale
// or hand-mangled share link degrades to the pristine view rather than throwing.
/**
 * @param {string | null | undefined} raw
 * @returns {Partial<FilterState>}
 */
export function viewParamToState(raw) {
  if (raw === null || raw === undefined) return {};
  /** @type {unknown} */
  let obj;
  try { obj = JSON.parse(raw); } catch { return {}; }
  if (obj === null || typeof obj !== 'object') return {};
  return parseFilterState(/** @type {Record<string, unknown>} */ (obj));
}

// Apply parsed ?view= pieces onto a live state object. Total by design: a piece
// ABSENT from the link resets to its default rather than keeping the previous
// value, so back/forward navigation restores each state exactly (the URL fully
// determines the filter state) instead of accumulating stale facets.
/**
 * @param {FilterState} state
 * @param {Partial<FilterState>} parsed
 */
export function applyViewToState(state, parsed) {
  // `new Map()`/`new Set()` with no arguments infer <any, any> / <any> rather
  // than picking up the assignment's contextual type, hence the explicitly
  // typed empty fallbacks below.
  /** @type {Map<string, Facet>} */
  const emptyFacets = new Map();
  state.facets = parsed.facets ?? emptyFacets;
  state.toggles = parsed.toggles ?? new Set();
  /** @type {Map<string, string>} */
  const emptyColumnFilters = new Map();
  state.columnFilters = parsed.columnFilters ?? emptyColumnFilters;
  state.sort = parsed.sort ?? defaultSort();
  state.pageSize = parsed.pageSize ?? DEFAULT_PAGE_SIZE;
  state.customSql = parsed.customSql ?? null;
}

// Decide how a state->URL sync should touch the History API. A no-op sync (the
// URL already mirrors the state - e.g. paginating, first load, an idempotent
// refresh) writes nothing. A discrete change pushes a new entry (leaving the
// prior state in history for Back); rapid follow-ups still within the debounce
// window replace that entry, so a burst of actions collapses to ONE history
// step rather than one per action. Pure, so the push/replace/none decision is
// unit-tested without a DOM; the front-ends own the timer and the actual
// pushState/replaceState calls.
/**
 * @param {string} currentHref
 * @param {string} nextHref
 * @param {boolean} burstActive
 */
export function historySyncAction(currentHref, nextHref, burstActive) {
  if (nextHref === currentHref) return 'none';
  return burstActive ? 'replace' : 'push';
}
