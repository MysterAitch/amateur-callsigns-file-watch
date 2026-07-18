// @ts-check
// The shared table-sort core (issue #771): one framework-free definition of how
// every table on the site sorts, so the SQL-backed lists and the static
// pre-rendered tables cannot drift apart. The pieces here are pure — a sort-state
// model, a type-aware comparator, a multi-column row ordering, and the `?sort=`
// deep-link serialisation — and are unit-tested in isolation. Two thin backends
// apply an identical SortEntry[]: a DOM reorder (table-controls.js) and, in a
// later phase, the SQL ORDER BY emitter the interactive lists carry.
//
// Sort semantics mirror the interactive lists (app.js / entry-browser.js): a
// plain activation sorts by one column alone, toggling ascending/descending; a
// modified activation (Shift/Ctrl/Alt/Meta) APPENDS a column as a secondary
// sort, or toggles its direction when already present. A backend is free to add
// its own third "restore the authored order" stop on top of these transitions
// (the DOM reorder does, since a pre-rendered table has a meaningful authored
// order); this core keeps the two-state toggle those interactive lists use.

/**
 * The direction one column is sorted in. The compact 'asc'/'desc' form is the
 * value the `?sort=` deep link carries and the SortEntry stores; the verbose
 * 'ascending'/'descending' form (which the comparator and `aria-sort` speak) is
 * derived at the edges by the helpers below.
 * @typedef {'asc' | 'desc'} SortDir
 */

/**
 * One column of a sort: a stable key (what a header, a `?sort=` link and the
 * sort state all agree on) and the direction to order it by.
 * @typedef {{ key: string, dir: SortDir }} SortEntry
 */

/**
 * The sort type of a column's values: numbers by magnitude, ISO dates
 * chronologically, everything else by locale text order.
 * @typedef {'numeric' | 'date' | 'text'} SortType
 */

// --- type-aware comparison (blank-awareness, inference, comparator, order) ---

// Canonical tokens that stand in for a deliberately-empty cell rather than a
// value. A humanised blank ((blank), (none)) or a dash/dot placeholder must
// sort together and out of the way, not scatter through the values by the
// accident of its glyph. Matched case-insensitively against the trimmed
// canonical value. '·' is the current absent-value marker (issue #826); the
// em dash and en dash stay listed for backwards compatibility with content
// rendered before that change.
const BLANK_SORT_TOKENS = new Set(['', '(blank)', '(none)', '(n/a)', 'n/a', '·', '—', '–']);

// A value that is a plain number: an optional sign then digits, with at most one
// decimal point. Deliberately strict — no thousands separators or units — to
// match the canonical-at-rest export, which carries numbers unformatted.
const NUMERIC_SORT_RE = /^[+-]?(\d+(\.\d+)?|\.\d+)$/;

// A value that is an ISO-8601 date or date-time (the only date shape the record
// stores). Requires at least the year-month form (YYYY-MM; the day and time are
// optional, matching the month-precision dates the record can carry) so a bare
// number is read as a number, not a year, and confirms the engine can parse it.
const DATE_SORT_RE = /^\d{4}-\d{2}(-\d{2})?([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;

// Whether a canonical value reads as an intentional blank rather than data.
/**
 * @param {string} value
 * @returns {boolean}
 */
export function isBlankSortValue(value) {
  return BLANK_SORT_TOKENS.has(value.trim().toLowerCase());
}

/**
 * @param {string} value
 * @returns {boolean}
 */
function isNumericSortValue(value) {
  return NUMERIC_SORT_RE.test(value.trim());
}

/**
 * @param {string} value
 * @returns {boolean}
 */
function isDateSortValue(value) {
  const trimmed = value.trim();
  return DATE_SORT_RE.test(trimmed) && !Number.isNaN(Date.parse(trimmed));
}

// The sort type of a column, inferred from its canonical values: 'numeric' when
// every non-blank value is a number, 'date' when every non-blank value is an ISO
// date/date-time, otherwise 'text'. Blank cells are ignored for the inference
// (and sorted apart by the comparator), so a numeric column punctuated by blanks
// is still recognised as numeric and sorts by magnitude, not lexically.
/**
 * @param {string[]} values
 * @returns {SortType}
 */
export function inferSortType(values) {
  const meaningful = values.filter(value => !isBlankSortValue(value));
  if (meaningful.length === 0) return 'text';
  if (meaningful.every(isNumericSortValue)) return 'numeric';
  if (meaningful.every(isDateSortValue)) return 'date';
  return 'text';
}

// Compare two non-blank canonical values in ascending sense for a given type:
// numbers by magnitude, dates chronologically, text by locale order (so accented
// letters fall where a reader expects). Blanks are not passed here — the row
// ordering keeps them apart — so this stays a total order over real values.
/**
 * @param {string} a
 * @param {string} b
 * @param {SortType} type
 * @returns {number}
 */
export function compareSortValues(a, b, type) {
  if (type === 'numeric') {
    const na = Number(a);
    const nb = Number(b);
    return na < nb ? -1 : na > nb ? 1 : 0;
  }
  if (type === 'date') {
    const ta = Date.parse(a);
    const tb = Date.parse(b);
    return ta < tb ? -1 : ta > tb ? 1 : 0;
  }
  return a.localeCompare(b);
}

// The order body rows should take for one sort, as indices into the authored
// `keys` array. A stable sort: equal values keep their authored order, and blank
// cells always sink to the end whichever direction is chosen, so they never
// break up the run of values that actually carry meaning.
/**
 * @param {string[]} keys canonical value per row, in authored order
 * @param {SortType} type
 * @param {'ascending' | 'descending'} direction
 * @returns {number[]}
 */
export function sortedRowOrder(keys, type, direction) {
  const sign = direction === 'descending' ? -1 : 1;
  return keys
    .map((key, index) => ({ key, index }))
    .sort((a, b) => {
      const aBlank = isBlankSortValue(a.key);
      const bBlank = isBlankSortValue(b.key);
      if (aBlank || bBlank) {
        if (aBlank && bBlank) return a.index - b.index;
        return aBlank ? 1 : -1;
      }
      const cmp = compareSortValues(a.key, b.key, type);
      return cmp !== 0 ? sign * cmp : a.index - b.index;
    })
    .map(entry => entry.index);
}

// The order body rows should take for a MULTI-column sort, as authored-row
// indices. Each SortEntry is applied in turn: the first that separates two rows
// decides their order; equal rows fall through to the next entry, and rows equal
// on every entry keep their authored order (a stable sort). Blank cells sink to
// the end of each column independently of that column's direction, matching the
// single-column ordering. The caller supplies the canonical value and the sort
// type for any (row, column) pair, so this stays free of the DOM and the table's
// own type inference.
/**
 * @param {SortEntry[]} entries
 * @param {number} rowCount
 * @param {(rowIndex: number, key: string) => string} valueAt
 * @param {(key: string) => SortType} typeOf
 * @returns {number[]}
 */
export function sortedRowOrderMulti(entries, rowCount, valueAt, typeOf) {
  const order = Array.from({ length: rowCount }, (_, i) => i);
  return order.sort((a, b) => {
    for (const entry of entries) {
      const av = valueAt(a, entry.key);
      const bv = valueAt(b, entry.key);
      const aBlank = isBlankSortValue(av);
      const bBlank = isBlankSortValue(bv);
      if (aBlank || bBlank) {
        if (aBlank && bBlank) continue;
        return aBlank ? 1 : -1;
      }
      const cmp = compareSortValues(av, bv, typeOf(entry.key));
      if (cmp !== 0) return (entry.dir === 'desc' ? -1 : 1) * cmp;
    }
    return a - b;
  });
}

// --- sort-state model + transitions ---

/**
 * @param {SortDir} dir
 * @returns {SortDir}
 */
function flipDir(dir) {
  return dir === 'asc' ? 'desc' : 'asc';
}

// The sort state a header activation produces, mirroring the interactive lists'
// semantics. A plain activation (multi off) sorts by the column ALONE, toggling
// to descending only when it was already the sole ascending sort, otherwise
// (re)starting it ascending — so any existing multi-column sort collapses to
// this one column. A modified activation (multi on) APPENDS the column as a
// secondary sort, or toggles just that column's direction when it is already
// part of the sort. Always returns a NEW array; the input is never mutated.
/**
 * @param {SortEntry[]} state
 * @param {string} key
 * @param {{ multi?: boolean }} [options]
 * @returns {SortEntry[]}
 */
export function nextSort(state, key, options = {}) {
  const multi = options.multi ?? false;
  const idx = state.findIndex(s => s.key === key);
  if (multi) {
    if (idx >= 0) return state.map((s, i) => (i === idx ? { key: s.key, dir: flipDir(s.dir) } : s));
    return [...state, { key, dir: 'asc' }];
  }
  const wasAscSingle = state.length === 1 && idx === 0 && state[0].dir === 'asc';
  return [{ key, dir: wasAscSingle ? 'desc' : 'asc' }];
}

// --- `?sort=` deep-link serialisation ---

// Serialise a sort spec to the compact deep-link value ("count:desc,suffix:asc"),
// or '' for the empty (unsorted / authored-order) spec so a pristine view carries
// no param. Direction is constrained to asc/desc.
/**
 * @param {SortEntry[]} entries
 * @returns {string}
 */
export function sortToParam(entries) {
  return entries.map(s => `${s.key}:${s.dir === 'desc' ? 'desc' : 'asc'}`).join(',');
}

// Inverse of sortToParam: parse a deep-link value into a sort spec. A malformed
// token (no key) is dropped, and an optional `isKnownKey` predicate drops any key
// the target no longer offers — so a stale or hand-mangled link degrades to what
// it can honour rather than erroring. Direction defaults to ascending unless the
// token explicitly says descending.
/**
 * @param {string | null | undefined} raw
 * @param {(key: string) => boolean} [isKnownKey]
 * @returns {SortEntry[]}
 */
export function sortFromParam(raw, isKnownKey) {
  if (!raw) return [];
  /** @type {SortEntry[]} */
  const out = [];
  const seen = new Set();
  for (const token of raw.split(',')) {
    const [rawKey, rawDir] = token.split(':');
    const key = (rawKey ?? '').trim();
    // Trim and de-duplicate so a stale or hand-edited link ("count:asc,
    // count:desc", or stray spaces) degrades to a coherent spec rather than
    // duplicate columns with conflicting directions: the first occurrence of a
    // key wins, later repeats are dropped.
    if (key === '' || seen.has(key)) continue;
    if (isKnownKey !== undefined && !isKnownKey(key)) continue;
    seen.add(key);
    out.push({ key, dir: (rawDir ?? '').trim().toLowerCase() === 'desc' ? 'desc' : 'asc' });
  }
  return out;
}

// The `aria-sort` value for a column's direction: the verbose form the attribute
// expects, with 'none' for a column that is not part of the current sort.
/**
 * @param {SortDir | null} dir
 * @returns {'ascending' | 'descending' | 'none'}
 */
export function ariaSortValue(dir) {
  if (dir === 'asc') return 'ascending';
  if (dir === 'desc') return 'descending';
  return 'none';
}
