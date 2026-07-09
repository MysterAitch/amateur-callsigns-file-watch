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
  if (state.pageSize !== 25) obj.z = state.pageSize;
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
