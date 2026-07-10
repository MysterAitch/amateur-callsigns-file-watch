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

export const COLUMNS = ['callsign', 'cleaned', 'status', 'product', 'implied_class', 'prefix_series'];

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
const CALLSIGN_CHAR_NAMES = { 0x09: 'TAB', 0x0a: 'LF', 0x0d: 'CR', 0x20: 'SP', 0xa0: 'NBSP', 0xfeff: 'BOM', 0xfffd: 'U+FFFD' };
export function callsignCharMarker(ch) {
  if (/[a-zA-Z0-9#/]/.test(ch)) return null;
  const cp = ch.codePointAt(0);
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

// A SQL string literal, single quotes doubled. Values come from the data or
// the user's own filter inputs; interpolating them (rather than binding ?)
// makes the DISPLAYED SQL self-contained and runnable as-is - the whole
// point of the "Edit SQL" hand-off. Safe here: the database is read-only
// (the VFS cannot write) and every statement passes the SELECT/WITH guard,
// so the worst a crafted value could do is run another read-only query the
// user could already run in SQL mode.
export function quote(value) { return `'${String(value).replace(/'/g, "''")}'`; }

// Per-column filter mini-language: comparison operators, GLOB wildcards
// (* ?), ! to negate, bare text = contains. Returns a literal SQL fragment,
// or null for an empty input. Complex boolean (a OR b) is a power query for
// SQL mode.
export function parseColumnFilter(col, raw) {
  const s = raw.trim();
  if (s === '') return null;
  const op = /^(>=|<=|!=|>|<|=)\s*(.+)$/.exec(s);
  if (op !== null) return `"${col}" ${op[1]} ${quote(op[2].trim())}`;
  const negate = s.startsWith('!');
  const body = (negate ? s.slice(1) : s).trim();
  if (body === '') return null;
  if (/[*?]/.test(body)) return `"${col}" ${negate ? 'NOT ' : ''}GLOB ${quote(body)}`;
  return `"${col}" ${negate ? 'NOT ' : ''}LIKE ${quote(`%${body}%`)}`;
}

// Compose the WHERE predicate from filter state (facets, boolean toggles,
// per-column inputs). The dataset scope is optional: pass {dataset} to scope
// to one publication; omit it for a dataset-agnostic predicate the caller
// combines with its own `dataset = <d>`. Returns a clause always safe to drop
// after WHERE - '1=1' when nothing is selected.
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
export function isDefaultSort(sort) {
  return sort.length === 1 && sort[0].col === 'callsign' && sort[0].dir === 'ASC';
}

// Serialise filter state to the compact object stored in the ?view= query
// param. Only non-default facets/toggles/filters/sort/size/customSql are
// emitted, so an untouched view serialises to {} (no param at all).
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
export function matchingCountSql(dataset, predicate) {
  return `SELECT COUNT(*) AS n FROM register_history WHERE dataset = ${quote(dataset)} AND (${predicate})`;
}

// Set-differences of the filtered cohort between an earlier `baseline` and a
// later `comparison` publication: rows whose cleaned key appeared, disappeared,
// or whose status changed. NOT IN is safe here because `cleaned` is never NULL
// (it is a derived key, blank at worst, never absent).
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
export function parseFilterState(obj) {
  const out = {};
  if (Array.isArray(obj.f)) {
    out.facets = new Map(obj.f.map(f => [f.k, { key: f.k, field: f.field, isExpr: f.x, label: f.l, values: new Set(f.v), exclude: f.e }]));
  }
  if (Array.isArray(obj.t)) out.toggles = new Set(obj.t.filter(id => TOGGLES[id] !== undefined));
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
export function stateToViewParam(state) {
  const obj = serializeFilterState(state);
  return Object.keys(obj).length === 0 ? null : JSON.stringify(obj);
}

// Inverse of stateToViewParam: a raw ?view= string (or null/absent) becomes
// the parsed state pieces. A malformed or non-object link yields {} so a stale
// or hand-mangled share link degrades to the pristine view rather than throwing.
export function viewParamToState(raw) {
  if (raw === null || raw === undefined) return {};
  let obj;
  try { obj = JSON.parse(raw); } catch { return {}; }
  if (obj === null || typeof obj !== 'object') return {};
  return parseFilterState(obj);
}

// Apply parsed ?view= pieces onto a live state object. Total by design: a piece
// ABSENT from the link resets to its default rather than keeping the previous
// value, so back/forward navigation restores each state exactly (the URL fully
// determines the filter state) instead of accumulating stale facets.
export function applyViewToState(state, parsed) {
  state.facets = parsed.facets ?? new Map();
  state.toggles = parsed.toggles ?? new Set();
  state.columnFilters = parsed.columnFilters ?? new Map();
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
export function historySyncAction(currentHref, nextHref, burstActive) {
  if (nextHref === currentHref) return 'none';
  return burstActive ? 'replace' : 'push';
}
