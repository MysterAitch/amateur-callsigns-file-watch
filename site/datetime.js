// @ts-check
// The shared date/time field wrapper for the hand-authored browser surfaces
// (issues #553, #551), mirroring the server-side dateTime in
// src/ci/render/format.ts so a timestamp looks and behaves the same rendered in
// the browser (the register lookup, the entry browser) as on the generated
// pages. One stable class, and the exact value always in the title: show less,
// lose nothing. Frameworkless and build-step-free (ADR 0002/0003) - a plain ES
// module served verbatim; `// @ts-check` + the JSDoc typedef below give it full
// type safety on the options object with no build step (issue #553), so it opts
// into checking individually even while the global checkJs backlog (#530)
// stays off.

/**
 * How much of a date/time a surface shows. `year-month` is the DEFAULT (#551).
 * @typedef {'year-month' | 'full-date' | 'date-time'} DateTimePrecision
 */

/**
 * Whether the display is a plain formatted date or a humanised relative phrase.
 * @typedef {'off' | 'relative'} DateTimeHumanisation
 */

/**
 * Per-usage options for the date/time wrapper.
 * @typedef {Object} DateTimeOptions
 * @property {DateTimePrecision} [precision] The precision to display. Omitting
 *   it FOLLOWS THE DEFAULT, which may move over time. DRIFT-GUARD (#553): a
 *   usage that genuinely REQUIRES a specific precision must state it here
 *   explicitly - even when it matches today's default - so a later change to the
 *   default cannot silently alter it.
 * @property {DateTimeHumanisation} [humanise] Off (default) shows the formatted
 *   date; 'relative' shows a phrase like "5 months ago" computed against `now`.
 * @property {string} [now] The reference instant (ISO) for relative
 *   humanisation. Without it the display degrades to the formatted date.
 * @property {string} [exactLabel] An optional self-describing prefix for the
 *   exact-value title, e.g. "Exact reported date".
 * @property {string} [extraClass] Extra class(es) appended after the stable
 *   `ts` class.
 */

// The single source of truth for the wrapper's CSS class, matching
// DATE_TIME_CLASS in src/ci/render/format.ts so browser- and server-rendered
// timestamps target the one selector the stylesheet styles.
export const DATE_TIME_CLASS = 'ts';

/** The movable default precision (#551). @type {DateTimePrecision} */
export const DEFAULT_DATE_TIME_PRECISION = 'year-month';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

/** @type {Record<DateTimePrecision, number>} */
const PRECISION_RANK = { 'year-month': 0, 'full-date': 1, 'date-time': 2 };

// '2022-05-30' -> '30 May 2022'; a value without a full day is returned
// untouched so nothing is faked. Mirrors humanDate in format.ts.
/** @param {string} value @returns {string} */
function humanDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return m === null ? value : `${Number(m[3])} ${MONTH_NAMES[Number(m[2]) - 1]} ${m[1]}`;
}

// '2016-09' or '2016-09-20' -> 'September 2016'. Mirrors monthYear in format.ts.
/** @param {string} value @returns {string} */
function monthYear(value) {
  const m = /^(\d{4})-(\d{2})/.exec(value);
  if (m === null) return value;
  const n = Number(m[2]);
  return n < 1 || n > 12 ? value : `${MONTH_NAMES[n - 1]} ${m[1]}`;
}

/** @param {string} value @returns {DateTimePrecision | null} */
function availablePrecision(value) {
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return 'date-time';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'full-date';
  if (/^\d{4}-\d{2}$/.test(value)) return 'year-month';
  return null;
}

/** @param {string} value @param {DateTimePrecision} precision @returns {string} */
function formatAtPrecision(value, precision) {
  if (precision === 'year-month') return monthYear(value);
  if (precision === 'full-date') return humanDate(value);
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(value);
  return m === null ? humanDate(value) : `${humanDate(m[1])} ${m[2]} UTC`;
}

// Parse a leading ISO date/time to epoch milliseconds (UTC), or null when it is
// not one. Month/day-only values anchor to the start of the period.
/** @param {string} value @returns {number | null} */
function toEpochUtc(value) {
  const dt = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(value);
  if (dt !== null) return Date.UTC(+dt[1], +dt[2] - 1, +dt[3], +dt[4], +dt[5], dt[6] === undefined ? 0 : +dt[6]);
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (d !== null) return Date.UTC(+d[1], +d[2] - 1, +d[3]);
  const m = /^(\d{4})-(\d{2})$/.exec(value);
  if (m !== null) return Date.UTC(+m[1], +m[2] - 1, 1);
  return null;
}

/** @param {number} count @param {string} noun @param {string} direction @returns {string} */
function unit(count, noun, direction) {
  return `${count} ${noun}${count === 1 ? '' : 's'} ${direction}`;
}

// A deterministic "5 months ago" / "in 5 months" phrase for `value` measured
// against `now`, both ISO; null when either is not a parseable date. Mirrors
// relativeDateTime in format.ts.
/** @param {string} value @param {string} now @returns {string | null} */
export function relativeDateTime(value, now) {
  const then = toEpochUtc(value);
  const ref = toEpochUtc(now);
  if (then === null || ref === null) return null;
  const ms = ref - then;
  const direction = ms >= 0 ? 'ago' : 'from now';
  const abs = Math.abs(ms);
  const minutes = Math.floor(abs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return unit(minutes, 'minute', direction);
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return unit(hours, 'hour', direction);
  const days = Math.floor(hours / 24);
  if (days < 31) return unit(days, 'day', direction);
  const earlier = new Date(Math.min(then, ref));
  const later = new Date(Math.max(then, ref));
  let months = (later.getUTCFullYear() - earlier.getUTCFullYear()) * 12 + (later.getUTCMonth() - earlier.getUTCMonth());
  if (later.getUTCDate() < earlier.getUTCDate()) months -= 1;
  if (months < 12) return unit(months, 'month', direction);
  return unit(Math.floor(months / 12), 'year', direction);
}

// The visible text a `dateTime` would show, without markup. Applies the
// drift-guarded default, clamps the requested precision to what the value
// actually carries (never fabricating a finer figure), and honours relative
// humanisation. Mirrors dateTimeDisplay in format.ts.
/** @param {string} value @param {DateTimeOptions} [options] @returns {string} */
export function dateTimeDisplay(value, options = {}) {
  if (options.humanise === 'relative' && options.now !== undefined) {
    const phrase = relativeDateTime(value, options.now);
    if (phrase !== null) return phrase;
  }
  const available = availablePrecision(value);
  if (available === null) return value;
  const requested = options.precision ?? DEFAULT_DATE_TIME_PRECISION;
  const effective = PRECISION_RANK[requested] <= PRECISION_RANK[available] ? requested : available;
  return formatAtPrecision(value, effective);
}

/**
 * A callback that builds an element from a tag and attributes - the caller's
 * own factory, so this module makes no assumption about how a node is built.
 * @callback ElementFactory
 * @param {string} tag
 * @param {Record<string, string>} attrs
 * @returns {HTMLElement}
 */

// The shared date/time wrapper (#553): a <span class="ts" title="<exact value>">
// carrying the requested precision as its text and the exact value in its
// title. `el` is the caller's element factory (as used across the browser
// front-ends). See DateTimeOptions for the drift-guard rule.
/** @param {ElementFactory} el @param {string} value @param {DateTimeOptions} [options] @returns {HTMLElement} */
export function dateTime(el, value, options = {}) {
  const cls = options.extraClass === undefined ? DATE_TIME_CLASS : `${DATE_TIME_CLASS} ${options.extraClass}`;
  const title = options.exactLabel === undefined ? value : `${options.exactLabel}: ${value}`;
  return el('span', { class: cls, title, text: dateTimeDisplay(value, options) });
}
