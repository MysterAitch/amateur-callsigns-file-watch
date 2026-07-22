/**
 * The small deterministic formatting/humanisation helpers the generated pages
 * build on: byte sizes, ISO dates rendered as "30 May 2022", and the on-disk
 * size suffix for download links. No locale machinery - the same output on
 * every machine so the generated HTML is byte-for-byte unchanged.
 */

import * as fs from 'fs';
import { escapeHtml } from './html.ts';

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// '2022-05-30' -> '30 May 2022' (deterministic; no locale machinery).
export function humanDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (match === null) return isoDate;
  return `${Number(match[3])} ${MONTHS[Number(match[2]) - 1]} ${match[1]}`;
}

// '2016-09' or '2016-09-20' -> 'September 2016' (deterministic, month precision).
// Overview surfaces read cleanly only when every vintage renders at the same
// granularity; some sources report a month, others a full day, so month is the
// finest shared precision. The exact day, where known, belongs in the detail
// views, not the overview timeline. Input that is not a leading ISO year-month
// (a prose range, an empty cell) is returned untouched so nothing is faked.
export function monthYear(isoMonth: string): string {
  const match = /^(\d{4})-(\d{2})/.exec(isoMonth);
  if (match === null) return isoMonth;
  const monthNumber = Number(match[2]);
  if (monthNumber < 1 || monthNumber > 12) return isoMonth;
  return `${MONTHS[monthNumber - 1]} ${match[1]}`;
}

// Download links always show a size; navigation links never do - the
// consistent pattern that tells a visitor what a click will do.
export function sizeOf(filePath: string): string {
  return fs.existsSync(filePath) ? ` (${formatBytes(fs.statSync(filePath).size)})` : '';
}

// ---- The shared date/time field wrapper (issues #553, #551) ----
// One helper for EVERY displayed timestamp, so a year-month, a full date and a
// through-second time all share a single stable class and always carry the
// exact value in the title. The reader sees the precision their surface calls
// for; nothing finer is fabricated and nothing known is lost (the transparency
// rule from #551 - "show less, lose nothing").

// How much of a date/time a surface shows. `year-month` is the DEFAULT (#551):
// overview / list / aggregate surfaces read cleanly at month precision. The
// finer forms earn their place on detail views and where a day disambiguates.
export type DateTimePrecision = 'year-month' | 'full-date' | 'date-time';

// Whether the display is a plain formatted date or a humanised relative phrase
// ("5 months ago"). Off by default: a generated page renders the same on every
// machine, so a relative phrase (which depends on "now") is opt-in and needs a
// reference instant supplied.
export type DateTimeHumanisation = 'off' | 'relative';

export interface DateTimeOptions {
  // The precision to display. Omitting it FOLLOWS THE DEFAULT, which may move
  // over time. DRIFT-GUARD (#553): a usage that genuinely REQUIRES a specific
  // precision must state it here explicitly - even when it matches today's
  // default - so a later change to the default cannot silently alter it. A
  // usage that is happy to track the convention passes nothing.
  precision?: DateTimePrecision;
  // Off (default) shows the formatted date; 'relative' shows a phrase like
  // "5 months ago", computed against `now`. The exact value stays in the title
  // either way.
  humanise?: DateTimeHumanisation;
  // The reference instant for relative humanisation (an ISO string). Required
  // for deterministic output when `humanise` is 'relative'; without it the
  // display degrades to the formatted date so a page never bakes in a
  // build-machine clock.
  now?: string;
  // An optional self-describing prefix for the exact-value title, e.g.
  // "Exact reported date" -> title="Exact reported date: 2016-09-20". Omitted,
  // the title is the bare exact value.
  exactLabel?: string;
  // Extra class(es) appended after the stable `ts` class, for a surface that
  // needs to target a specific timestamp without disturbing the shared visual.
  extraClass?: string;
}

// The single source of truth for the wrapper's CSS class, so every timestamp -
// server-rendered or browser-rendered (site/datetime.js mirrors this) - targets
// the one selector the stylesheet styles and they can never drift apart.
export const DATE_TIME_CLASS = 'ts';

// The movable default precision (#551). Exported so callers and tests can refer
// to the convention by name rather than hard-coding 'year-month', and so the
// drift-guard rule has something concrete to point at.
export const DEFAULT_DATE_TIME_PRECISION: DateTimePrecision = 'year-month';

const PRECISION_RANK: Record<DateTimePrecision, number> = { 'year-month': 0, 'full-date': 1, 'date-time': 2 };

// The precision actually present in a value, or null when it is not a leading
// ISO date at all (a prose range, a blank cell) - such input is never coerced.
function availablePrecision(value: string): DateTimePrecision | null {
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return 'date-time';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'full-date';
  if (/^\d{4}-\d{2}$/.test(value)) return 'year-month';
  return null;
}

// The formatted (non-relative) display at a given precision. The value is known
// to carry at least this much precision by the time this is called.
function formatAtPrecision(value: string, precision: DateTimePrecision): string {
  if (precision === 'year-month') return monthYear(value);
  if (precision === 'full-date') return humanDate(value);
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(value);
  return match === null ? humanDate(value) : `${humanDate(match[1])} ${match[2]} UTC`;
}

// Parse a leading ISO date/time to epoch milliseconds (UTC), or null when it is
// not one. A month-only or day-only value anchors to the start of the period so
// relative phrasing has a concrete instant to measure from.
function toEpochUtc(value: string): number | null {
  const dt = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(value);
  if (dt !== null) return Date.UTC(+dt[1], +dt[2] - 1, +dt[3], +dt[4], +dt[5], dt[6] === undefined ? 0 : +dt[6]);
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (d !== null) return Date.UTC(+d[1], +d[2] - 1, +d[3]);
  const m = /^(\d{4})-(\d{2})$/.exec(value);
  if (m !== null) return Date.UTC(+m[1], +m[2] - 1, 1);
  return null;
}

function unit(count: number, noun: string, direction: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'} ${direction}`;
}

// A deterministic "5 months ago" / "in 5 months" phrase for `value` measured
// against `now`, both ISO. Returns null when either is not a parseable date, so
// the caller can fall back to the formatted display. No locale machinery: the
// same output on every machine.
export function relativeDateTime(value: string, now: string): string | null {
  const then = toEpochUtc(value);
  const ref = toEpochUtc(now);
  if (then === null || ref === null) return null;
  const ms = ref - then;
  const direction = ms >= 0 ? 'ago' : 'from now';
  const abs = Math.abs(ms);
  const minutes = Math.floor(abs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return unit(minutes, 'minute', direction);
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return unit(hours, 'hour', direction);
  const days = Math.floor(hours / 24);
  if (days < 31) return unit(days, 'day', direction);
  // Calendar-aware months and years, so "one month ago" lands on the same day
  // of the previous month rather than drifting by the 30/31-day mismatch.
  const earlier = new Date(Math.min(then, ref));
  const later = new Date(Math.max(then, ref));
  let months = (later.getUTCFullYear() - earlier.getUTCFullYear()) * 12 + (later.getUTCMonth() - earlier.getUTCMonth());
  if (later.getUTCDate() < earlier.getUTCDate()) months -= 1;
  if (months < 12) return unit(months, 'month', direction);
  return unit(Math.floor(months / 12), 'year', direction);
}

// The visible text a `dateTime` would show, without the surrounding markup -
// exposed for callers (and the browser mirror's tests) that need the label
// alone. Applies the drift-guarded default, clamps the requested precision to
// what the value actually carries (never fabricating a finer figure), and
// honours relative humanisation.
export function dateTimeDisplay(value: string, options: DateTimeOptions = {}): string {
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

// The shared date/time wrapper (#553). Emits
//   <span class="ts" title="<exact value>">…display…</span>
// so every timestamp on the site shares one visual and one guarantee: whatever
// precision is shown, the exact value passed in is always recoverable from the
// title. `value` is any leading-ISO date/time (or unparseable text, returned as
// its own exact value untouched). See DateTimeOptions for the drift-guard rule.
export function dateTime(value: string, options: DateTimeOptions = {}): string {
  const cls = options.extraClass === undefined ? DATE_TIME_CLASS : `${DATE_TIME_CLASS} ${options.extraClass}`;
  const title = options.exactLabel === undefined ? value : `${options.exactLabel}: ${value}`;
  return `<span class="${escapeHtml(cls)}" title="${escapeHtml(title)}">${escapeHtml(dateTimeDisplay(value, options))}</span>`;
}

// ---- The shared absent-value marker (#826) ----
// A value position with NO value at all - a NULL column, an unset field, an
// undefined denominator - distinct from a BLANK-BUT-PRESENT value, which keeps
// its own '(blank)'-style humanised wrapper untouched (licenceField/
// statusField/etc. in render/licence.ts, render/status.ts). Before this, such
// a position rendered a bare em dash: ambiguous, since the em dash also does
// duty as prose punctuation throughout the site, and inaccessible, since a
// bare glyph carries no name for assistive tech. The middle dot never doubles
// as prose punctuation, so it reads unambiguously as "nothing here"; the
// accessible label is always carried via `title` AND `aria-label`, never a
// bare glyph. Mirrors absentMarker in site/field-wrappers.js so an absent
// value looks and behaves identically rendered in the browser and on the
// generated pages.

export const ABSENT_MARKER = '·';
export const ABSENT_CLASS = 'absent';
export const ABSENT_LABEL = 'not recorded';

// Emits <span class="absent" title="…" aria-label="…">·</span>. `label`
// defaults to ABSENT_LABEL ('not recorded'); a caller with a more specific
// fact to state (e.g. "not currently in the register") may pass its own.
export function absentMarker(label: string = ABSENT_LABEL): string {
  const escaped = escapeHtml(label);
  return `<span class="${ABSENT_CLASS}" title="${escaped}" aria-label="${escaped}">${ABSENT_MARKER}</span>`;
}

// The shared cannot-evaluate marker (issue #905). A publication that never
// carried a flag's required column populated could not fire that flag at all,
// so its cell is neither a zero (an evaluated "none found") nor an absent value
// (·, "not asserted") - it is "not assessable", a third state. The visible text
// is a fixed "n/a"; `reason` names WHY (e.g. "no populated … column in this
// publication") and rides in the title/aria-label so the tooltip explains the
// distinction. Styled by the shared `.na` class, defined both in the generated
// pages' inline CSS (render/page.ts) and in site/style.css for the statistics
// page, so it reads the same everywhere.
export const NOT_ASSESSABLE_CLASS = 'na';
export const NOT_ASSESSABLE_TEXT = 'n/a';

export function notAssessableMarker(reason: string): string {
  const label = `not assessable — ${escapeHtml(reason)}`;
  return `<span class="${NOT_ASSESSABLE_CLASS}" title="${label}" aria-label="${label}">${NOT_ASSESSABLE_TEXT}</span>`;
}
