// @ts-check
// v1 CALLSIGN SECTION REGISTRY (issue #921): the per-callsign page as a config
// array of section ids resolved against a registry of { id, mount(host, model) }
// — the browser twin of src/ci/render/v1-sections.ts. renderCallsignSections
// appends one <section data-section="id"> per entry in CALLSIGN_SECTION_ORDER
// and mounts each section's live DOM, throwing on any id with no registered
// mount.
//
// This module is deliberately free of any shared-module import: it renders a
// resolved MODEL. The shared pure data functions (latestSummary / seenSummary /
// anatomyFigureParts / twinConflict / stripModel) are reused by INJECTION —
// buildCallsignModel takes them as arguments — so the orchestrator
// (site/v1/callsign-page.js) can supply the real shared modules it loads at
// runtime, while the tests inject the same real functions over a fixture shard.
// Every data-derived value is written with textContent, never innerHTML.
//
// THE DIAL is the signature element: a two-track bitemporal panel ported from
// the green-field mockup into B-light tokens. Event-time markers ride the upper
// scale (teal, primary); per-publication assertion sightings ride the lower
// scale (grey, calibration). Findings render VERBATIM from the event shard's
// f entries, never a bare rule badge. The series-introduction context marker
// renders when meta.json supplies a seriesIntro entry for this record's series,
// and is omitted otherwise. Each event carries its assertion-time provenance
// (asserted-by), the cross-vintage disagreements are surfaced with both camps
// (resolved nowhere, #467), and bookkeeping-only records keep the event/
// bookkeeping distinction rather than reading as no evidence at all.

import { V1_COPY } from './copy.js';
import { provenanceChip, termCue } from './glossary.js';

/**
 * @param {string} tag
 * @param {string | null} [cls]
 * @param {string | null} [txt]
 */
const el = (tag, cls, txt) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (txt != null) node.textContent = txt;
  return node;
};

/** @param {string} href @param {string} label @param {string | null} [cls] */
const link = (href, label, cls = null) => {
  const a = el('a', cls, label);
  a.setAttribute('href', href);
  return a;
};

// ---------------------------------------------------------------------------
// Pure model shaping.

/**
 * @typedef {object} AssertedBy
 * @property {string} title    the asserting dataset's friendly, reader-recognisable name (issue #954: never the raw archive key)
 * @property {string} href     its dataset entry page (not linked by the v1 surface)
 * @property {string | null} vintage  its assertion-time vintage
 * @property {number} nrows    how many rows in that dataset assert the line
 * @property {string} [key]    the raw archive dataset key (issue #954): secondary detail carried in a tooltip, never the primary label
 */

/**
 * @typedef {object} DialEvent
 * @property {string} day     event-time day (YYYY-MM-DD)
 * @property {string} label
 * @property {string} [kindId]  the authored event-kind id (e.g. 'licence-issued'),
 *                            carried so the rail can recognise the agreeing origin
 *                            shape by kind rather than by matching label prose.
 * @property {boolean} state  whether this event is itself a state marker. The
 *                            current-state terminus is derived from the record's
 *                            status as a dedicated node, so licensing events
 *                            carry false.
 * @property {boolean} [disputed]  set when a held vintage asserts a competing date
 *                            for this event's kind; the dial and rail then render
 *                            every distinct claim with the visibly-disputed
 *                            treatment (issue #921).
 * @property {AssertedBy[]} assertedBy  the assertion-time provenance for this event
 */

/**
 * @typedef {object} DialBookkeeping
 * @property {string} day     event-time day (YYYY-MM-DD)
 * @property {string} label
 * @property {AssertedBy[]} assertedBy
 */

/**
 * @typedef {object} DialDisagreement
 * @property {string} kindLabel
 * @property {string} [kindId]  the disagreeing kind's authored id, resolved from the
 *                            matching event so a disputed marker carries the kind tint
 * @property {{ day: string, datasets: { title: string, href: string, vintage: string | null }[] }[]} camps  every camp kept, resolved nowhere (#467)
 */

/**
 * @typedef {object} DialSighting
 * @property {string} vintage  assertion-time vintage (YYYY-MM-DD or YYYY-MM)
 * @property {string} [title]  the publication that recorded the sighting, carried
 *                            so each pip's tooltip can name it (issue #921, A2)
 */

/**
 * @typedef {object} DialFinding
 * @property {string} statement  the engine's own sentence, verbatim
 * @property {string[]} caveats  short caveat labels
 */

/**
 * @typedef {object} TwinView
 * @property {string} label   the classification of the twin-row conflict (never a verdict)
 * @property {string | null} snapshotVintage
 * @property {boolean} normalitySplit
 * @property {{ raw: string, normal: boolean, status: string, modified: string }[]} variants
 * @property {{ kind: 'ordered' | 'tied' | 'partial' | 'none', newestRaw: string | null, newestModified: string | null }} recency
 */

/**
 * @typedef {object} CallsignModel
 * @property {string} key
 * @property {string} cleaned  the cleaned form typed/looked up
 * @property {boolean} found
 * @property {boolean} viaRendering  true when a regional rendering resolved to the register's core record
 * @property {{ statuses: string[], products: string[], types: string[], dataset: { title: string, vintage: string | null, href: string } } | null} latest
 * @property {{ first: { vintage: string | null } | null, last: { vintage: string | null } | null, present: number, registerPresent: number } | null} seen
 * @property {{ chars: string, name: string, meaning: string }[] | null} anatomy
 * @property {{ events: DialEvent[], sightings: DialSighting[], findings: DialFinding[], bookkeeping: DialBookkeeping[], disagreements: DialDisagreement[], hasEvents: boolean, hasBookkeeping: boolean }} dial
 * @property {TwinView | null} twin  the twin-row conflict annotation (issue #633), or null
 * @property {'fresh' | 'carried' | 'neutral'} carriedOrigin  how this record's licence-chain origin reads against its series introduction
 * @property {string | null} series  e.g. 'M7' (from parsed anatomy prefix)
 * @property {string | null} seriesIntro  the series' introduction month (yyyy-mm), from meta.json's seriesIntro, or null when not recorded
 * @property {AssertedBy | null} seriesIntroSource  the citation for the series-introduction reference data (issue #954), from meta.json's seriesIntroSource, or null when not carried
 */

// The shared data-shape and function types, referenced by type-only import() so
// this module carries no runtime dependency on them (the orchestrator injects
// the real functions at runtime). Typing the injected functions as `typeof` the
// shared exports means the reuse is checked exactly — an incompatible function
// fails the build, and buildCallsignModel calls each with the shapes it has.
/** @typedef {import('../callsign.js').CallsignRecord} CallsignRecord */
/** @typedef {import('../callsign.js').ShardManifest} ShardManifest */

// Build the resolved view model from the raw fetched data and the INJECTED
// shared pure functions. Pure given its dependencies — the orchestrator injects
// the real shared modules, the tests inject the identical real functions over a
// fixture. `eventRecord`/`eventMeta` are null when the event axis is not (yet)
// loaded or the callsign has no event-time claim.
// The twin-row conflict classification (issue #633): a NAME for the shape of
// the disagreement, never a verdict on which row is right. Mirrors the shared
// card's labels.
/** @param {{ variants: { normal: boolean, status: string }[], normalitySplit: boolean }} conflict @returns {string} */
function twinLabel(conflict) {
  const abnormalActive = conflict.variants.some((v) => !v.normal && v.status === 'Allocated');
  const normalActive = conflict.variants.some((v) => v.normal && v.status === 'Allocated');
  if (conflict.normalitySplit && abnormalActive && !normalActive) return V1_COPY.callsign.twin.inversion;
  if (conflict.normalitySplit) return V1_COPY.callsign.twin.formatSplit;
  return V1_COPY.callsign.twin.statusDisagree;
}

/**
 * @param {object} deps
 * @param {{ key: string | null, record: CallsignRecord | null, cleaned: string, typed: string, viaRendering?: boolean }} deps.res
 * @param {ShardManifest} deps.manifest
 * @param {import('../callsign-events.js').EventRecord | null} deps.eventRecord
 * @param {import('../callsign-events.js').EventsMeta | null} deps.eventMeta
 * @param {typeof import('../callsign.js').latestSummary} deps.latestSummary
 * @param {typeof import('../callsign.js').seenSummary} deps.seenSummary
 * @param {typeof import('../callsign.js').anatomyFigureParts} deps.anatomyFigureParts
 * @param {typeof import('../callsign.js').twinConflict} deps.twinConflict
 * @param {typeof import('../callsign-events.js').stripModel} deps.stripModel
 * @returns {CallsignModel}
 */
export function buildCallsignModel(deps) {
  const { res, manifest, eventRecord, eventMeta } = deps;
  const record = res.record;
  const key = res.key;
  const viaRendering = res.viaRendering ?? false;
  if (record === null || key === null) {
    return { key: res.cleaned !== '' ? res.cleaned : res.typed, cleaned: res.cleaned, found: false, viaRendering, latest: null, seen: null, anatomy: null, dial: { events: [], sightings: [], findings: [], bookkeeping: [], disagreements: [], hasEvents: false, hasBookkeeping: false }, twin: null, carriedOrigin: 'neutral', series: null, seriesIntro: null, seriesIntroSource: null };
  }

  const latest = deps.latestSummary(record, manifest);
  const seen = deps.seenSummary(record, manifest);
  const anatomyParts = deps.anatomyFigureParts(key, record.a ?? {});
  const anatomy = anatomyParts === null ? null : anatomyParts.map((p) => ({ chars: p.chars, name: p.name, meaning: p.meaning }));

  // Sightings (assertion axis): every dataset where the history string marks a
  // presence, with that dataset's vintage. The lower calibration track.
  /** @type {DialSighting[]} */
  const sightings = [];
  const h = record.h ?? '';
  for (let i = 0; i < h.length; i += 1) {
    if (h[i] === '.') continue;
    const dataset = manifest.datasets[i];
    if (dataset === undefined || dataset.vintage == null) continue;
    sightings.push({ vintage: dataset.vintage, title: dataset.title });
  }

  // Event axis, findings, bookkeeping and cross-vintage disagreements, from the
  // event strip when the event shard is present. Each event carries its
  // assertion-time provenance so it never floats free of the source that
  // asserts it (issue #726).
  // A friendly title with no reader-facing empty label (issue #954): the build
  // is expected to always emit a non-blank title (a blank one now fails the
  // build loud, see src/ci/build-callsign-shards.ts / event-time-projection.ts),
  // but a stale or mismatched artefact reaching the browser must still render
  // something honest rather than a blank string — the raw key it is filed
  // under, never fabricated prose.
  /** @param {import('../callsign-events.js').EventDataset} dataset @returns {string} */
  const friendlyTitle = (dataset) => (dataset.title !== '' ? dataset.title : dataset.key);
  /** @param {{ dataset: import('../callsign-events.js').EventDataset, nrows: number }[]} assertedBy @returns {AssertedBy[]} */
  const mapAssertedBy = (assertedBy) => assertedBy.map((a) => ({ title: friendlyTitle(a.dataset), href: a.dataset.href, vintage: a.dataset.vintage, nrows: a.nrows, key: a.dataset.key }));
  /** @type {DialEvent[]} */
  let events = [];
  /** @type {DialFinding[]} */
  let findings = [];
  /** @type {DialBookkeeping[]} */
  let bookkeeping = [];
  /** @type {DialDisagreement[]} */
  let disagreements = [];
  let hasEvents = false;
  let hasBookkeeping = false;
  if (eventRecord != null && eventMeta != null) {
    const strip = deps.stripModel(eventRecord, eventMeta);
    events = strip.licensing.map((line) => ({ day: line.day, label: line.kindLabel, kindId: line.kindId, state: false, assertedBy: mapAssertedBy(line.assertedBy) }));
    bookkeeping = strip.bookkeeping.map((line) => ({ day: line.day, label: line.kindLabel, assertedBy: mapAssertedBy(line.assertedBy) }));
    findings = strip.findings.map((f) => ({ statement: f.statement, caveats: f.caveats.map((c) => c.label) }));
    disagreements = strip.disagreements.map((d) => ({
      kindLabel: d.kindLabel,
      // Resolve the disagreeing kind's id from the matching event, so a disputed
      // marker/entry can carry the same kind tint as its undisputed siblings.
      kindId: events.find((e) => e.label === d.kindLabel)?.kindId,
      camps: d.camps.map((c) => ({ day: c.day, datasets: c.datasets.map((ds) => ({ title: friendlyTitle(ds), href: ds.href, vintage: ds.vintage })) })),
    }));
    hasEvents = events.length > 0;
    hasBookkeeping = bookkeeping.length > 0;
  }

  // Twin-row conflict (issue #633): classified, never adjudicated. Injected so
  // the reuse of the shared pure function is checked end to end.
  const conflict = deps.twinConflict(record, key, manifest);
  /** @type {TwinView | null} */
  const twin = conflict === null ? null : {
    label: twinLabel(conflict),
    snapshotVintage: conflict.snapshot.vintage,
    normalitySplit: conflict.normalitySplit,
    variants: conflict.variants.map((v) => ({ raw: v.raw, normal: v.normal, status: v.status, modified: v.modified })),
    recency: { kind: conflict.recency.kind, newestRaw: conflict.recency.newest?.raw ?? null, newestModified: conflict.recency.newest?.modified ?? null },
  };

  const series = record.a !== undefined && typeof record.a.pre === 'string' ? record.a.pre : null;
  // The series-introduction month (issue #921), from meta.json's seriesIntro
  // map when the event axis is loaded and the series has a recorded month.
  const introMonths = eventMeta != null ? eventMeta.seriesIntro : undefined;
  const seriesIntro = series !== null && introMonths != null ? (introMonths[series] ?? null) : null;
  // Its citation (issue #954): render honestly when meta.json does not carry
  // one (an older cached meta, or the event axis not loaded) rather than
  // fabricate a source for the context row.
  const seriesIntroSource = eventMeta != null && eventMeta.seriesIntroSource != null ? eventMeta.seriesIntroSource : null;

  // Carried-origin state, DATA-DRIVEN (issue #921): compare the licence-chain
  // origin month to the series introduction month, where both are known. When
  // the series introduction is not recorded, the record asserts NEITHER path —
  // a neutral explainer, never a declarative fresh/carried claim.
  const originDate = record.d !== undefined && typeof record.d.o === 'string' ? record.d.o : null;
  /** @type {'fresh' | 'carried' | 'neutral'} */
  let carriedOrigin = 'neutral';
  if (seriesIntro !== null && originDate !== null && /^\d{4}-\d{2}/.test(originDate)) {
    carriedOrigin = originDate.slice(0, 7) < seriesIntro ? 'carried' : 'fresh';
  }

  return { key, cleaned: res.cleaned, found: true, viaRendering, latest, seen, anatomy, dial: { events, sightings, findings, bookkeeping, disagreements, hasEvents, hasBookkeeping }, twin, carriedOrigin, series, seriesIntro, seriesIntroSource };
}

// A yyyy-mm introduction month rendered for readers ('2018-10' -> 'October
// 2018'). Falls back to the raw value on any unexpected shape, so a marker is
// never blank.
const SERIES_INTRO_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** @param {string} ym @returns {string} */
export function formatSeriesIntroMonth(ym) {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (m === null) return ym;
  const month = SERIES_INTRO_MONTHS[Number(m[2]) - 1];
  return month === undefined ? ym : `${month} ${m[1]}`;
}

// A date (YYYY, YYYY-MM or YYYY-MM-DD) as a fractional year, for axis
// positioning. Non-numeric input yields NaN and is filtered out by the caller.
/** @param {string} date @returns {number} */
export function fractionalYear(date) {
  const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/.exec(date);
  if (m === null) return NaN;
  const year = Number(m[1]);
  const month = m[2] !== undefined ? Number(m[2]) : 1;
  const day = m[3] !== undefined ? Number(m[3]) : 1;
  return year + (month - 1) / 12 + (day - 1) / 365;
}

// Group events sharing an event-time day into one dated cluster, preserving the
// order each day is first seen. Same-day events would otherwise overprint at an
// identical position on the dial and read as near-duplicate rows on the event
// rail; grouped, the day carries all its events in one place.
/**
 * @template {{ day: string }} E
 * @param {E[]} events
 * @returns {{ day: string, events: E[] }[]}
 */
export function groupEventsByDay(events) {
  /** @type {{ day: string, events: E[] }[]} */
  const groups = [];
  /** @type {Map<string, { day: string, events: E[] }>} */
  const byDay = new Map();
  for (const ev of events) {
    let group = byDay.get(ev.day);
    if (group === undefined) {
      group = { day: ev.day, events: [] };
      byDay.set(ev.day, group);
      groups.push(group);
    }
    group.events.push(ev);
  }
  return groups;
}

// The three event kinds whose coincidence on one day is the agreeing origin
// shape — a licence issued, its original start and its earliest surviving
// version start all stated for the same day (issue #921). When they coincide
// with no cross-vintage disagreement the rail tells it as one "licence origin"
// story; any divergence falls back to distinct rows.
/** @type {string[]} */
export const ORIGIN_KIND_IDS = ['licence-issued', 'licence-original-start', 'licence-version-original-start'];
const ORIGIN_KIND_SET = new Set(ORIGIN_KIND_IDS);
/** @param {string | undefined} kindId @returns {boolean} */
const isOriginKind = (kindId) => kindId !== undefined && ORIGIN_KIND_SET.has(kindId);

// Kind-tints (issue #921, owner-adopted): the licensing event kinds that carry a
// subtle per-kind hue, so a reader can match an event on the dial to its line on
// the rail by tint. The hues live in shell.css keyed by data-kind; this set only
// decides WHICH kinds are tinted (bookkeeping stamps and the state terminus keep
// the base grammar). The tint is always subordinate — a small swatch or a left
// accent beside a name that is always present, never the primary diamond or the
// green state node.
/** @type {Set<string>} */
export const TINTED_EVENT_KINDS = new Set([
  'licence-issued', 'licence-original-start', 'licence-version-original-start',
  'licence-cancelled', 'reserved-until',
]);

// The disagreement narrative's anchor id: disputed markers and entries link here
// so the visual (a hollow, tinted marker) and the verbal explanation reinforce.
export const DISAGREEMENT_ANCHOR_ID = 'record-disagreements';
// At or above this many competing dated claims, the dial carries the "examine"
// nudge (issue #921) — heavy disagreement is surfaced, not summarised away.
export const DISPUTE_NUDGE_THRESHOLD = 4;

// A representative single-line caption's width, as a fraction of the scale's
// minimum width (DIAL_AXIS_MIN_WIDTH_REM, the .scale min-width) — a reference the
// geometry tests use to reason about "near" vs "well-separated" markers. The LIVE
// tiering no longer keys off this single figure: it measures each caption's OWN
// width and tiers two markers apart exactly when their spans would overlap (see
// intervalOf in dialGeometry, issue #921 polish). Kept as documentation of the
// typical case and the tests' reference point.
const NEAR_DATED_CAPTION_WIDTH_REM = 7;
const DIAL_AXIS_MIN_WIDTH_REM = 600 / 16;
export const NEAR_DATED_SEPARATION_THRESHOLD_PERCENT = (NEAR_DATED_CAPTION_WIDTH_REM / DIAL_AXIS_MIN_WIDTH_REM) * 100;

// Whether a day-group is the agreeing origin shape (issue #921): it holds all
// three origin kinds (issued, original start, version start), none of those
// kinds is also stated on a different day, and no held vintage disagrees about
// any of them. Every divergence — a spread date or a surfaced disagreement —
// returns false, so the rail falls back to the plain grouped card with distinct
// rows. Record-scoped: this reads the held record's own coincidence, never an
// unqualified claim about the register.
/**
 * @param {{ day: string, events: DialEvent[] }} group
 * @param {{ day: string, events: DialEvent[] }[]} allGroups
 * @param {DialDisagreement[]} disagreements
 * @returns {boolean}
 */
export function isAgreeingOriginGroup(group, allGroups, disagreements) {
  const groupKinds = new Set(group.events.map((e) => e.kindId));
  if (!ORIGIN_KIND_IDS.every((k) => groupKinds.has(k))) return false;
  // Divergence: an origin kind also stated on another day (dates differ).
  for (const other of allGroups) {
    if (other === group) continue;
    if (other.events.some((e) => isOriginKind(e.kindId))) return false;
  }
  // Divergence: a held vintage disagrees about one of the origin kinds. Matched
  // against the origin events' own labels, so no label vocabulary is duplicated.
  const originLabels = new Set(group.events.filter((e) => isOriginKind(e.kindId)).map((e) => e.label));
  return !disagreements.some((d) => originLabels.has(d.kindLabel));
}

// Vertical geometry of the dial scale, in px — the SINGLE source shared with
// shell.css. dialGeometry composes the tallest caption extent from these
// constants; the mount publishes them (and the derived --scale-h / --axis-top)
// as custom properties on the .scale element, and shell.css positions every
// marker from the same var()s, so the height budget the JS reserves and the
// layout the CSS paints cannot drift. A stacked or near-dated composition grows
// the panel; a lone compact reading keeps the default height.
export const DIAL_SCALE_GEOMETRY = {
  axisTopDefault: 136, // compact axis offset from the scale top; the panel only grows past this
  belowAxis: 74,       // room kept beneath the axis for the sighting (calibration) track
  tierStep: 34,        // each near-dated separation tier lifts a marker this far; kept a
                       //   few px above the rendered caption height so consecutive tiers
                       //   clear with breathing room, never touch (issue #921 polish)
  stackBase: 34,       // a co-dated stack's bottom clearance above the axis
  stackRowH: 15,       // rendered height of one named row in a stack
  stackDayH: 15,       // rendered height of the shared day line beneath a stack
  capBase: 46,         // a single marker's caption bottom clearance above the axis
  capH: 32,            // a single two-line caption's rendered height (a true upper bound
                       //   on the ~30.3px paint, so the reserved headroom never under-reserves)
  stemBase: 34,        // stem length from the axis
  dotBase: 30,         // diamond bottom clearance above the axis
  connBase: 30,        // stack connector bottom clearance above the axis
  connH: 6,            // stack connector length
  topMargin: 14,       // breathing room kept above the tallest composed caption
};

// A caption's estimated rendered width in px (issue #921 polish): the dial
// captions are 11px monospace, so width tracks character count. Clamped to the
// .cap max-width (14rem) and grown by the caption plate padding plus a small
// safety allowance (real glyph advances vary a touch, so estimating a little wide
// anchors a shade early — always safe, never an overflow). Pure, so both the
// edge decision and the caption geometry can reason about widths without a DOM.
const DIAL_MONO_CHAR_PX = 6.6;
const DIAL_CAP_MAX_PX = 224; // 14rem at 16px, the .cap max-width
const DIAL_CAP_CHROME_PX = 16; // caption plate padding + safety allowance
export const DIAL_AXIS_MIN_WIDTH_PX = DIAL_AXIS_MIN_WIDTH_REM * 16;
/** @param {string} text @returns {number} */
export function estimateCaptionWidthPx(text) {
  return Math.min(text.length * DIAL_MONO_CHAR_PX, DIAL_CAP_MAX_PX) + DIAL_CAP_CHROME_PX;
}

// Caption edge-anchoring (issue #921 polish): a dial caption is centred on its
// marker, so a marker near the axis extreme would push its caption past the scale
// edge — the overflow the owner's round-2 captures showed. WIDTH-AWARE: a caption
// only fits centred when the marker sits at least a half-caption-width from each
// edge, so a wider caption anchors further in than a narrow one. Measured against
// the scale's MINIMUM width (the worst case: captions occupy the largest fraction
// there), so the same anchoring holds at every viewport. Returns 'l' to anchor the
// caption's left to the marker (extend inward, rightward), 'r' to anchor its right
// (extend inward, leftward), or null to stay centred. Never truncates.
/** @param {number} leftPct @param {number} capWidthPx @returns {'l' | 'r' | null} */
export function captionEdge(leftPct, capWidthPx) {
  const halfPct = (capWidthPx / 2) / DIAL_AXIS_MIN_WIDTH_PX * 100;
  if (leftPct < halfPct) return 'l';
  if (leftPct > 100 - halfPct) return 'r';
  return null;
}

// The caption text a cluster paints — the single event's leading clause, or the
// widest row of a co-dated stack — used to estimate the cluster's caption width.
// The ' — ' split delimiter is the em dash KIND_LABELS (issue #954) is
// authored with (src/ci/build-callsign-event-shards.ts) — a build-time
// vocabulary separator, distinct from the copy registry's en-dash house
// style, so it stays an em dash here regardless of any copy-wording pass.
/** @param {string[]} labels @returns {string} */
export function clusterCaptionText(labels) {
  const clauses = labels.map((l) => l.split(' — ')[0]);
  return clauses.reduce((widest, c) => (c.length > widest.length ? c : widest), clauses[0] ?? '');
}

// The upward extent (px above the axis) a cluster's caption reaches at its tier:
// a co-dated stack grows by its row count, a lone marker by its two-line caption.
// The same arithmetic the stylesheet lays out, so the reserved headroom is a true
// upper bound on the painted height (issue #921 review).
/** @param {number} count @param {number} tier @returns {number} */
export function clusterCaptionExtent(count, tier) {
  const g = DIAL_SCALE_GEOMETRY;
  const lift = tier * g.tierStep;
  return count > 1
    ? g.stackBase + lift + count * g.stackRowH + g.stackDayH
    : g.capBase + lift + g.capH;
}

// Within-kind disagreements render EVERY distinct claim (issue #921): the shard
// keeps only the earliest-surviving value per kind on the primary strip and
// confines the competing dates to the disagreement block, which hid them from
// the instrument. This expands the event list so each camp day of a disagreeing
// kind becomes its own event — marked disputed and carrying that camp's asserting
// datasets — while an existing event on a camp day is marked disputed in place.
// The result feeds the normal layout machinery (same-day stacking, near-dated
// tiering, kind tints), so disputed claims collide and grow the panel exactly as
// undisputed ones do. No cap: heavy disagreement is surfaced, not summarised
// away. Events are returned in day order so the rail reads chronologically.
/**
 * @param {DialEvent[]} events
 * @param {DialDisagreement[]} disagreements
 * @returns {DialEvent[]}
 */
export function expandDisputedEvents(events, disagreements) {
  /** @type {DialEvent[]} */
  const out = events.map((e) => ({ ...e }));
  for (const d of disagreements) {
    const kindId = d.kindId ?? out.find((e) => e.label === d.kindLabel)?.kindId;
    for (const camp of d.camps) {
      const existing = out.find((e) => e.label === d.kindLabel && e.day === camp.day);
      if (existing !== undefined) {
        existing.disputed = true;
        continue;
      }
      out.push({
        day: camp.day,
        label: d.kindLabel,
        kindId,
        state: false,
        disputed: true,
        assertedBy: camp.datasets.map((ds) => ({ title: ds.title, href: ds.href, vintage: ds.vintage, nrows: 1 })),
      });
    }
  }
  return out.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

// How many distinct competing dated claims a record holds across all its
// disagreeing kinds — the count behind the high-density "examine" nudge (issue
// #921). Each camp is one asserted date, so the total is the number of
// conflicting claims on the instrument.
/** @param {DialDisagreement[]} disagreements @returns {number} */
export function disputedClaimCount(disagreements) {
  return disagreements.reduce((n, d) => n + d.camps.length, 0);
}

// Pure geometry for the dial: map event days and sighting vintages onto one
// shared year axis. Returns the axis domain, the year ticks and each marker's
// left-percentage — everything the mount needs, and everything the test pins.
// Co-dated events collapse into one positioned cluster (carrying every event's
// label and kind), adjacent clusters closer than a caption width take stepped
// separation tiers, and an optional current-state terminus is positioned on the
// same axis.
/**
 * @param {DialEvent[]} events
 * @param {DialSighting[]} sightings
 * @param {{ label: string, day: string } | null} [state]  the current-state terminus, or null for none
 * @returns {{ minYear: number, maxYear: number, years: { year: number, left: number }[], events: { left: number, day: string, labels: string[], kinds: (string | null)[], disputed: boolean[], count: number, tier: number }[], sightings: { left: number, vintage: string, title?: string }[], state: { left: number, label: string, day: string, tier: number } | null, axisTop: number, scaleHeight: number }}
 */
export function dialGeometry(events, sightings, state = null) {
  const fracs = [
    ...events.map((e) => fractionalYear(e.day)),
    ...sightings.map((s) => fractionalYear(s.vintage)),
  ].filter((f) => !Number.isNaN(f));
  const minYear = fracs.length > 0 ? Math.floor(Math.min(...fracs)) : new Date().getFullYear();
  let maxYear = fracs.length > 0 ? Math.ceil(Math.max(...fracs)) : minYear + 1;
  if (maxYear <= minYear) maxYear = minYear + 1;
  const span = maxYear - minYear;
  // Positions map into an inset [4%, 96%] band, not the full width, so a marker
  // hard against the earliest or latest year keeps room for its centred caption
  // rather than clipping at the panel edge.
  /** @param {number} frac */
  const pos = (frac) => Math.max(0, Math.min(100, 4 + ((frac - minYear) / span) * 92));
  // Year ticks: every whole year when the span is small, every two years when
  // it is wide, so labels never crowd.
  const step = span <= 8 ? 1 : 2;
  /** @type {{ year: number, left: number }[]} */
  const years = [];
  for (let y = minYear; y <= maxYear; y += step) years.push({ year: y, left: pos(y) });
  const clusters = groupEventsByDay(events.filter((e) => !Number.isNaN(fractionalYear(e.day))))
    .map((grp) => {
      const labels = grp.events.map((e) => e.label);
      return { left: pos(fractionalYear(grp.day)), day: grp.day, labels, kinds: grp.events.map((e) => e.kindId ?? null), disputed: grp.events.map((e) => e.disputed === true), count: grp.events.length, tier: 0, capText: clusterCaptionText(labels) };
    });
  // Near-dated separation: walking the clusters left-to-right, any cluster
  // whose gap to the one before it is under the caption-width threshold joins a
  // run and steps up one tier; a gap at or above the threshold starts a fresh
  // run at tier 0. This keeps every caption in a crowded run at a distinct
  // height while leaving well-spaced markers flat.
  const g = DIAL_SCALE_GEOMETRY;
  // Base clearance and content height of a cluster's caption, in px — a stack
  // grows by its rows, a lone marker by its two-line caption.
  /** @param {{ count: number }} c */
  const baseOf = (c) => (c.count > 1 ? g.stackBase : g.capBase);
  /** @param {{ count: number }} c */
  const contentOf = (c) => (c.count > 1 ? c.count * g.stackRowH + g.stackDayH : g.capH);
  // Each caption's anchored horizontal span, as a fraction of the axis at the
  // MINIMUM scale width (the worst case for fit). A centred caption spans a half
  // each side of its marker; an edge-anchored one spans its full width inward. Two
  // captions must tier apart exactly when these spans would overlap (issue #921
  // polish), so the criterion tracks each caption's OWN width rather than a single
  // assumed figure.
  /** @param {{ left: number, capText: string }} t @returns {{ lo: number, hi: number }} */
  const spanOf = (t) => {
    const half = (estimateCaptionWidthPx(t.capText) / 2) / DIAL_AXIS_MIN_WIDTH_PX * 100;
    const edge = captionEdge(t.left, estimateCaptionWidthPx(t.capText));
    if (edge === 'l') return { lo: t.left, hi: t.left + 2 * half };
    if (edge === 'r') return { lo: t.left - 2 * half, hi: t.left };
    return { lo: t.left - half, hi: t.left + half };
  };
  // The current-state terminus joins the SAME tiering pass as the event clusters
  // (issue #921 polish): it is not one of the clusters, so without this a terminus
  // whose caption would overlap the newest event's would overprint it at tier 0.
  // Placed in the left-to-right pass, whichever sits rightmost lifts clear.
  const stateFrac = state !== null ? fractionalYear(state.day) : NaN;
  /** @type {{ left: number, count: number, tier: number, capText: string } | null} */
  const stateTierable = state !== null && !Number.isNaN(stateFrac) ? { left: pos(stateFrac), count: 1, tier: 0, capText: state.label } : null;
  const byLeft = [...clusters, ...(stateTierable !== null ? [stateTierable] : [])].sort((a, b) => a.left - b.left);
  for (let i = 1; i < byLeft.length; i += 1) {
    const prev = byLeft[i - 1];
    const cur = byLeft[i];
    // No horizontal overlap between the two captions → the later one stays flat.
    if (spanOf(cur).lo >= spanOf(prev).hi - 0.01) {
      cur.tier = 0;
      continue;
    }
    // Lift this caption clear of the previous caption's full painted top, so
    // overlapping captions never collide — whatever the mix of stacks, singles and
    // the state terminus (issue #921). At least one step.
    const prevTop = baseOf(prev) + prev.tier * g.tierStep + contentOf(prev);
    cur.tier = Math.max(1, Math.ceil((prevTop - baseOf(cur)) / g.tierStep));
  }
  // Compose the vertical height budget (issue #921 review): grow the scale so the
  // tallest stacked-and-tiered caption always clears the axis with no spill into
  // the controls above and no accidental scrollbar, and keep the compact default
  // when nothing needs the room. Stacks, near-dated singles and the state caption
  // are all measured at their tier.
  let maxExtent = 0;
  for (const c of clusters) maxExtent = Math.max(maxExtent, clusterCaptionExtent(c.count, c.tier));
  if (stateTierable !== null) maxExtent = Math.max(maxExtent, clusterCaptionExtent(1, stateTierable.tier));
  const axisTop = Math.max(g.axisTopDefault, maxExtent + g.topMargin);
  const scaleHeight = axisTop + g.belowAxis;
  const stateOut = state !== null && stateTierable !== null
    ? { left: stateTierable.left, label: state.label, day: state.day, tier: stateTierable.tier }
    : null;
  return {
    minYear,
    maxYear,
    years,
    events: clusters,
    sightings: sightings.filter((s) => !Number.isNaN(fractionalYear(s.vintage))).map((s) => ({ left: pos(fractionalYear(s.vintage)), vintage: s.vintage, title: s.title })),
    state: stateOut,
    axisTop,
    scaleHeight,
  };
}

// The current-state terminus (issue #921): the record's latest held status as a
// green node closing the event story on both the dial scale and the event rail.
// It is an assertion-anchored claim — "as of the newest publication that asserts
// it" — so it anchors to the newest publication sighting, falling back to the
// newest event day only when no sighting is held. It carries the latest dataset
// as its assertion-time provenance, so the terminus expands to which publication
// asserts it exactly as every other rail node does. Absent when the record
// carries no status, so a status-less record renders no terminus and never a
// bare node.
/** @param {CallsignModel} model @returns {{ label: string, day: string, assertedBy: AssertedBy[] } | null} */
export function currentStateNode(model) {
  if (model.latest === null || model.latest.statuses.length === 0) return null;
  const sightingDays = model.dial.sightings.map((s) => s.vintage).filter((d) => !Number.isNaN(fractionalYear(d)));
  const eventDays = model.dial.events.map((e) => e.day).filter((d) => !Number.isNaN(fractionalYear(d)));
  const anchorDays = sightingDays.length > 0 ? sightingDays : eventDays;
  if (anchorDays.length === 0) return null;
  const day = anchorDays.reduce((newest, d) => (fractionalYear(d) > fractionalYear(newest) ? d : newest));
  const dataset = model.latest.dataset;
  const assertedBy = dataset.title !== '' ? [{ title: dataset.title, href: dataset.href, vintage: dataset.vintage, nrows: 1 }] : [];
  return { label: `${model.latest.statuses.join(' / ')} – ${V1_COPY.callsign.dial.currentStateLabel}`, day, assertedBy };
}

// ---------------------------------------------------------------------------
// Section mounts.

// The shared absent-value marker (issue #826): a middle dot, never a bare em
// dash, with the accessible label carried on title AND aria-label. Used where a
// value position carries NO value (distinct from a blank-but-present value,
// which keeps its own humanised "(no … recorded)" wording).
/** @param {string} [label] @returns {HTMLElement} */
function absentMark(label = 'not recorded') {
  const span = el('span', 'absent', '·');
  span.setAttribute('title', label);
  span.setAttribute('aria-label', label);
  return span;
}

/** @param {HTMLElement} host @param {CallsignModel} model */
function mountFastAnswer(host, model) {
  const head = el('header', 'cshead surface');
  head.appendChild(el('div', 'ey', V1_COPY.callsign.eyebrow));
  head.appendChild(el('h1', null, model.key));
  if (!model.found) {
    const callout = el('div', 'callout');
    callout.append(`No record for ${model.key} in any of the publications this mirror holds. Absence here is never evidence about the register – this mirror holds only what has been published or disclosed.`);
    head.appendChild(callout);
    host.appendChild(head);
    return;
  }

  // Regional-rendering note: the typed form resolved to the register's core
  // record, so name which record answered (issue #921 review item 3).
  if (model.viaRendering) {
    const note = el('p', 'note muted');
    note.append(V1_COPY.callsign.viaRenderingNote.replace('{cleaned}', model.cleaned).replace('{key}', model.key));
    head.appendChild(note);
  }

  const row = el('div', 'status-row');
  const statusCell = el('div', 'c');
  statusCell.appendChild(el('div', 'k', 'status'));
  const statusV = el('div', 'v');
  statusV.appendChild(el('span', 'led'));
  if (model.latest !== null && model.latest.statuses.length > 0) statusV.append(model.latest.statuses.join(' / '));
  else statusV.append(V1_COPY.callsign.noStatusRecorded);
  statusCell.appendChild(statusV);
  row.appendChild(statusCell);

  const productCell = el('div', 'c');
  productCell.appendChild(el('div', 'k', 'product'));
  const productV = el('div', 'v sm');
  // A blank-but-present product is humanised (many legitimate allocations carry
  // a blank product), never a bare em dash.
  if (model.latest !== null && model.latest.products.length > 0) productV.append(model.latest.products.join(' / '));
  else productV.append(V1_COPY.callsign.noProductRecorded);
  productCell.appendChild(productV);
  row.appendChild(productCell);

  const seriesCell = el('div', 'c');
  seriesCell.appendChild(el('div', 'k', 'series'));
  const seriesV = el('div', 'v');
  // An unparsed series is an absent VALUE — the middle-dot marker, not '—'.
  if (model.series !== null) seriesV.append(model.series);
  else seriesV.appendChild(absentMark());
  seriesCell.appendChild(seriesV);
  row.appendChild(seriesCell);

  head.appendChild(row);
  host.appendChild(head);
}

// Fill a `{placeholder}` template from a map of values. Only the named
// placeholders are substituted; any stray brace is left untouched, so a missing
// value fails visibly rather than silently blanking.
/** @param {string} tpl @param {Record<string, string>} vars @returns {string} */
const fillTemplate = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (/** @type {string} */ m, /** @type {string} */ k) => (Object.hasOwn(vars, k) ? vars[k] : m));

// Give a dial marker its tooltip (issue #921, A2): the same text on `title` (the
// hover tooltip) and `aria-label` (the accessible equivalent), so a marker is
// never a bare unlabelled dot. The scale as a whole keeps its role="img"
// overview; these per-marker labels name the individual reading.
/** @param {HTMLElement} node @param {string} text */
function markerTooltip(node, text) {
  node.setAttribute('title', text);
  node.setAttribute('aria-label', text);
}

// Apply a kind-tint to a node (issue #921): mark it with data-kind so shell.css
// paints the kind's swatch/accent. Only the licensing event kinds are tinted;
// anything else is left in the base grammar. The tint is decorative — the event
// name is always present, so it is never the sole discriminator.
/** @param {HTMLElement} node @param {string | null | undefined} kindId */
function applyKindTint(node, kindId) {
  if (kindId != null && TINTED_EVENT_KINDS.has(kindId)) node.setAttribute('data-kind', kindId);
}

// Publish the composed vertical geometry as custom properties on the scale (issue
// #921): --scale-h / --axis-top are the height and axis offset dialGeometry grew
// to fit this composition; the rest are the shared constant offsets shell.css
// lays every marker out from. One writer keeps the JS budget and the CSS layout
// locked together.
/** @param {HTMLElement} scale @param {{ scaleHeight: number, axisTop: number }} geo */
function applyScaleGeometry(scale, geo) {
  const g = DIAL_SCALE_GEOMETRY;
  /** @type {Record<string, number>} */
  const props = {
    '--scale-h': geo.scaleHeight, '--axis-top': geo.axisTop, '--tier-step': g.tierStep,
    '--stem-base': g.stemBase, '--dot-base': g.dotBase, '--cap-base': g.capBase,
    '--stack-base': g.stackBase, '--stack-row-h': g.stackRowH, '--stack-day-h': g.stackDayH,
    '--conn-base': g.connBase, '--conn-h': g.connH,
  };
  for (const [k, v] of Object.entries(props)) scale.style.setProperty(k, `${v}px`);
}

// The instrument legend (issue #921, A2): a plain-English row decoding the dial
// so a first-time reader need not infer the marker vocabulary from prose. Each
// marker TYPE is named only when it is actually drawn (no phantom entries), and
// the row is the natural home for the kind-tint scheme — every tinted kind
// present is named beside a swatch in its stable hue, so the colour scheme is
// learnable. Returns null when there is nothing to decode.
/**
 * @param {{ hasEvents: boolean, hasSightings: boolean, hasState: boolean, hasDisputed: boolean, tintedKinds: string[] }} present
 * @returns {HTMLElement | null}
 */
function buildDialLegend(present) {
  if (!present.hasEvents && !present.hasSightings && !present.hasState) return null;
  const legend = el('div', 'dial-legend');
  legend.setAttribute('role', 'group');
  legend.setAttribute('aria-label', V1_COPY.callsign.dial.legendLabel);
  legend.appendChild(el('span', 'dl-lbl', V1_COPY.callsign.dial.legendLabel));
  /** @param {string} markCls @param {string} text */
  const item = (markCls, text) => {
    const it = el('span', 'dl-item');
    it.appendChild(el('span', `dl-mk ${markCls}`));
    it.append(` ${text}`);
    legend.appendChild(it);
  };
  if (present.hasEvents) item('ev', V1_COPY.callsign.dial.legendEvent);
  if (present.hasSightings) item('si', V1_COPY.callsign.dial.legendSighting);
  if (present.hasState) item('state', V1_COPY.callsign.dial.legendState);
  if (present.hasDisputed) item('disputed', V1_COPY.callsign.dial.legendDisputed);
  const kindNames = V1_COPY.callsign.dial.kindLegend;
  for (const kindId of present.tintedKinds) {
    // A tinted kind with no registered legend name is skipped rather than drawn
    // nameless — the swatch is never the sole cue.
    if (!Object.hasOwn(kindNames, kindId)) continue;
    const name = kindNames[/** @type {keyof typeof kindNames} */ (kindId)];
    const it = el('span', 'dl-item');
    const sw = el('span', 'dl-sw');
    sw.setAttribute('data-kind', kindId);
    it.appendChild(sw);
    it.append(` ${name}`);
    legend.appendChild(it);
  }
  return legend;
}

// The tinted event kinds present among a record's events, in first-seen order —
// the set the legend names beside their swatches. Bookkeeping and the state
// terminus keep the base grammar, so only the TINTED_EVENT_KINDS appear.
/** @param {DialEvent[]} events @returns {string[]} */
function tintedKindsPresent(events) {
  /** @type {string[]} */
  const out = [];
  for (const e of events) {
    if (e.kindId != null && TINTED_EVENT_KINDS.has(e.kindId) && !out.includes(e.kindId)) out.push(e.kindId);
  }
  return out;
}

// The bitemporal dial (the signature element).
/** @param {HTMLElement} host @param {CallsignModel} model */
function mountEvidenceDial(host, model) {
  const surface = el('section', 'surface');
  const lbl = el('div', 'lbl');
  lbl.append(V1_COPY.callsign.evidenceLabel);
  surface.appendChild(lbl);
  surface.appendChild(el('p', 'note', V1_COPY.callsign.evidenceLead));
  // A one-line worked micro-example in the framing copy (issue #921, A2): reads
  // one diamond and one pip so the event-time / assertion-time distinction is
  // concrete before the reader meets the instrument.
  surface.appendChild(el('p', 'note dial-example', V1_COPY.callsign.dial.microExample));

  const dial = el('div', 'dial');

  // Upper track label + gloss (verbatim).
  const evLab = el('div', 'tracklab event');
  evLab.appendChild(el('span', 'sw'));
  evLab.appendChild(el('b', null, V1_COPY.callsign.dial.eventLabel));
  // The one-line gloss stays verbatim in the prose; a "?" cue after it opens the
  // fuller definition as a popover rather than sending the reader off the page
  // (issue #921, B1). Kept as a trailing sibling so the verbatim gloss text is
  // never broken up.
  evLab.append(` — ${V1_COPY.callsign.dial.eventGloss.replace(`${V1_COPY.callsign.dial.eventLabel} — `, '')} `);
  evLab.appendChild(termCue('eventTime'));
  dial.appendChild(evLab);

  // Controls.
  const ctl = el('div', 'dial-ctl');
  ctl.setAttribute('role', 'group');
  ctl.setAttribute('aria-label', 'Highlight one clock');
  const scale = el('div', 'scale');
  scale.setAttribute('role', 'img');
  /** @param {string} label @param {'both'|'event'|'assert'} track @param {boolean} pressed */
  const ctlBtn = (label, track, pressed) => {
    const b = el('button', null, label);
    b.setAttribute('type', 'button');
    b.setAttribute('aria-pressed', String(pressed));
    b.addEventListener('click', () => {
      for (const other of ctl.querySelectorAll('button')) other.setAttribute('aria-pressed', 'false');
      b.setAttribute('aria-pressed', 'true');
      scale.classList.toggle('dim-assert', track === 'event');
      scale.classList.toggle('dim-event', track === 'assert');
    });
    return b;
  };
  ctl.appendChild(ctlBtn(V1_COPY.callsign.dial.showBoth, 'both', true));
  ctl.appendChild(ctlBtn(V1_COPY.callsign.dial.eventOnly, 'event', false));
  ctl.appendChild(ctlBtn(V1_COPY.callsign.dial.assertOnly, 'assert', false));
  dial.appendChild(ctl);

  // The scale.
  const stateNode = currentStateNode(model);
  // Expand within-kind disagreements into a marker per distinct claim (issue #921)
  // before laying out, so disputed claims join the same stacking/tiering machinery.
  const events = expandDisputedEvents(model.dial.events, model.dial.disagreements);
  const geo = dialGeometry(events, model.dial.sightings, stateNode);
  const ariaBits = [`One year axis from ${geo.minYear} to ${geo.maxYear}.`];
  if (geo.events.length > 0) ariaBits.push(`Event time, above the axis: ${geo.events.flatMap((c) => c.labels.map((l) => `${l} (${c.day})`)).join('; ')}.`);
  if (geo.sightings.length > 0) ariaBits.push(`Assertion time, below the axis: ${geo.sightings.length} publication sightings.`);
  if (geo.state !== null) {
    const by = stateNode !== null && stateNode.assertedBy.length > 0 ? `, asserted by ${stateNode.assertedBy[0].title}` : '';
    ariaBits.push(`${geo.state.label}, as of ${geo.state.day}${by}.`);
  }
  scale.setAttribute('aria-label', ariaBits.join(' '));
  applyScaleGeometry(scale, geo);
  scale.appendChild(el('div', 'axis'));
  for (const y of geo.years) {
    const yr = el('div', 'yr', String(y.year));
    yr.setAttribute('style', `left:${y.left.toFixed(1)}%`);
    scale.appendChild(yr);
  }
  for (const cl of geo.events) {
    // The separation tier rides a CSS custom property; the stylesheet steps the
    // stem, dot and caption up by it so a near-dated run's captions never
    // overlap while every x stays true (issue #921).
    const allDisputed = cl.disputed.every((d) => d);
    const cls = ['ev'];
    if (cl.count > 1) cls.push('stacked');
    // A single wholly-disputed marker reads hollow; a stack marks its disputed
    // rows individually and only goes hollow when every row is disputed.
    if (allDisputed) cls.push('disputed');
    const marker = el('div', cls.join(' '));
    marker.setAttribute('style', `left:${cl.left.toFixed(1)}%;--tier:${cl.tier}`);
    // Anchor the caption inward when a centred caption would overflow the scale
    // edge, sized to this cluster's own caption width (issue #921 polish).
    const edge = captionEdge(cl.left, estimateCaptionWidthPx(clusterCaptionText(cl.labels)));
    if (edge !== null) marker.setAttribute('data-edge', edge);
    if (cl.count === 1) applyKindTint(marker, cl.kinds[0]);
    marker.appendChild(el('span', 'stem'));
    marker.appendChild(el('span', 'dot'));
    if (cl.count === 1) {
      // A single event shows the leading clause of its kind label, the day
      // beneath — no interaction needed to read what happened.
      const cap = el('span', 'cap', cl.labels[0].split(' — ')[0]);
      cap.appendChild(el('small', null, cl.day));
      marker.appendChild(cap);
      markerTooltip(marker, fillTemplate(V1_COPY.callsign.dial.tooltipEvent, { label: cl.labels[0], day: cl.day }));
    } else {
      // Co-dated events: the centred vertical stack (issue #921). Every event is
      // named on its own row in record order, the shared day shown once beneath.
      // No count teaser and nothing to hunt for — a tall stack is accepted. Each
      // row carries its own kind tint and disputed state so a mixed day reads
      // honestly.
      marker.appendChild(el('span', 'conn'));
      const stack = el('span', 'vstack');
      cl.labels.forEach((label, i) => {
        const r = el('span', cl.disputed[i] ? 'r disputed' : 'r', label.split(' — ')[0]);
        applyKindTint(r, cl.kinds[i]);
        stack.appendChild(r);
      });
      stack.appendChild(el('span', 'd', cl.day));
      markerTooltip(marker, fillTemplate(V1_COPY.callsign.dial.tooltipEvent, { label: cl.labels.join('; '), day: cl.day }));
      marker.appendChild(stack);
    }
    scale.appendChild(marker);
  }
  // The current-state terminus — the record's latest held status, in the green
  // node the shell already styles (.scale .ev.state), closing the event story.
  if (geo.state !== null) {
    const marker = el('div', 'ev state');
    marker.setAttribute('style', `left:${geo.state.left.toFixed(1)}%;--tier:${geo.state.tier}`);
    const sEdge = captionEdge(geo.state.left, estimateCaptionWidthPx(geo.state.label));
    if (sEdge !== null) marker.setAttribute('data-edge', sEdge);
    marker.appendChild(el('span', 'stem'));
    marker.appendChild(el('span', 'dot'));
    const cap = el('span', 'cap', geo.state.label);
    cap.appendChild(el('small', null, geo.state.day));
    // The dial marker cannot host a disclosure fold; its assertion-time
    // provenance rides the title/aria instead, with the expandable fold on the
    // matching event-rail terminus. Every state node carries a tooltip naming its
    // status and date, gaining the asserting publication when one is held.
    if (stateNode !== null && stateNode.assertedBy.length > 0) {
      const a = stateNode.assertedBy[0];
      const source = a.vintage != null ? `${a.title} (vintage ${a.vintage})` : a.title;
      markerTooltip(marker, fillTemplate(V1_COPY.callsign.dial.tooltipStateAssertedBy, { label: geo.state.label, day: geo.state.day, source }));
    } else {
      markerTooltip(marker, fillTemplate(V1_COPY.callsign.dial.tooltipState, { label: geo.state.label, day: geo.state.day }));
    }
    marker.appendChild(cap);
    scale.appendChild(marker);
  }
  for (const si of geo.sightings) {
    const marker = el('div', 'si');
    marker.setAttribute('style', `left:${si.left.toFixed(1)}%`);
    marker.appendChild(el('span', 'stem'));
    marker.appendChild(el('span', 'pip'));
    // Each pip names the publication that recorded the sighting and its vintage
    // (issue #921, A2), falling back to the vintage alone when no title is held.
    markerTooltip(marker, si.title != null && si.title !== ''
      ? fillTemplate(V1_COPY.callsign.dial.tooltipSighting, { title: si.title, vintage: si.vintage })
      : fillTemplate(V1_COPY.callsign.dial.tooltipSightingNoTitle, { vintage: si.vintage }));
    scale.appendChild(marker);
  }
  dial.appendChild(scale);

  // Lower track label + gloss (verbatim).
  const asLab = el('div', 'tracklab assert');
  asLab.appendChild(el('span', 'sw'));
  asLab.appendChild(el('b', null, V1_COPY.callsign.dial.assertLabel));
  asLab.append(` — ${V1_COPY.callsign.dial.assertGloss.replace(`${V1_COPY.callsign.dial.assertLabel} — `, '')} `);
  asLab.appendChild(termCue('assertionTime'));
  dial.appendChild(asLab);

  // The instrument legend (issue #921, A2): decode the marker vocabulary and the
  // kind-tint scheme, naming only the marker types actually drawn on this record.
  const legend = buildDialLegend({
    hasEvents: geo.events.length > 0,
    hasSightings: geo.sightings.length > 0,
    hasState: geo.state !== null,
    hasDisputed: events.some((e) => e.disputed === true),
    tintedKinds: tintedKindsPresent(events),
  });
  if (legend !== null) dial.appendChild(legend);

  // Reading / calibration note.
  const note = el('div', 'dial-note');
  const g1 = el('span', 'g event');
  g1.appendChild(el('b', null, V1_COPY.callsign.dial.readingLead));
  // The count is honest about CLAIMS: every distinct dated event reading, disputed
  // ones included (issue #921), so a record whose vintages disagree reads as more
  // claims, not fewer.
  const claimCount = events.length;
  g1.append(` – ${claimCount} dated event claim${claimCount === 1 ? '' : 's'} on the primary scale.`);
  note.appendChild(g1);
  const g2 = el('span', 'g assert');
  g2.appendChild(el('b', null, V1_COPY.callsign.dial.calibrationLead));
  g2.append(` – ${geo.sightings.length} sighting${geo.sightings.length === 1 ? '' : 's'}. ${V1_COPY.callsign.dial.calibrationNote}`);
  note.appendChild(g2);
  dial.appendChild(note);

  // Series-introduction context marker (issue #921): only when meta.json
  // records when this callsign's SERIES was opened. A series-level fact that
  // frames the event scale — never a claim about this record's own issuance.
  // Carries an asserted-by fold like every other rail row (issue #954), when
  // meta.json ships the citation; rendered without one otherwise, honestly,
  // rather than inventing a source.
  if (model.seriesIntro !== null && model.series !== null) {
    const context = el('div', 'dial-context');
    context.appendChild(provenanceChip('context'));
    const text = V1_COPY.callsign.dial.seriesIntro
      .replace('{series}', model.series)
      .replace('{month}', formatSeriesIntroMonth(model.seriesIntro));
    context.append(` ${text}.`);
    if (model.seriesIntroSource !== null) context.appendChild(assertedByFold([model.seriesIntroSource]));
    dial.appendChild(context);
  }

  // High-density disagreement nudge (issue #921): where a record carries many
  // competing dated claims the instrument is deliberately cluttered — the mess is
  // the signal. Pair it with an explicit invitation into the plain-language
  // narrative rather than smoothing the clutter away.
  const disputes = disputedClaimCount(model.dial.disagreements);
  if (disputes >= DISPUTE_NUDGE_THRESHOLD) {
    const nudge = el('div', 'dial-dispute-nudge');
    nudge.appendChild(provenanceChip('derived'));
    nudge.append(` ${V1_COPY.callsign.dial.disputeNudge.replace('{count}', String(disputes))} `);
    nudge.appendChild(link(`#${DISAGREEMENT_ANCHOR_ID}`, V1_COPY.callsign.dial.disputeNudgeCta, 'nudge-cta'));
    dial.appendChild(nudge);
  }

  surface.appendChild(dial);

  // Findings, VERBATIM (never a bare rule badge).
  if (model.dial.findings.length > 0) {
    for (const f of model.dial.findings) {
      const fEl = el('div', 'dial-finding');
      fEl.appendChild(provenanceChip('inferred'));
      fEl.append(` ${f.statement}.`);
      if (f.caveats.length > 0) fEl.append(` Caveats: ${f.caveats.join('; ')}.`);
      surface.appendChild(fEl);
    }
  } else if (!model.dial.hasEvents) {
    // No dated licensing evidence. Distinguish bookkeeping-only (dated system
    // presence) from genuine non-observation — the two are not the same, and
    // reading bookkeeping stamps as "no evidence" would understate the record.
    surface.appendChild(el('p', 'note', model.dial.hasBookkeeping ? V1_COPY.callsign.dial.bookkeepingOnly : V1_COPY.callsign.dial.noEvidence));
  }

  // Cross-vintage disagreements (#467): every camp kept, adjudicated nowhere.
  // Dataset names render as plain text — the v1 surface links only to itself.
  if (model.dial.disagreements.length > 0) {
    const card = el('div', 'dial-disagree');
    card.setAttribute('id', DISAGREEMENT_ANCHOR_ID);
    const dhead = el('div', 'dd-head');
    dhead.appendChild(provenanceChip('derived'));
    dhead.append(` ${V1_COPY.callsign.dial.disagreementLabel}`);
    card.appendChild(dhead);
    card.appendChild(el('p', 'note', V1_COPY.callsign.dial.disagreementGloss));
    const ul = el('ul', 'dd-camps');
    for (const d of model.dial.disagreements) {
      // Plain language a fresh reader can reconstruct (issue #921): which held
      // publication asserts which date for this kind, and that the values cannot
      // all hold together. Record-scoped, both sides shown, none adjudicated.
      const li = el('li');
      const kind = d.kindLabel.split(' — ')[0];
      d.camps.forEach((camp, i) => {
        if (i > 0) li.append('; ');
        const sources = camp.datasets
          .map((ds) => (ds.vintage != null ? `the ${ds.title} (vintage ${ds.vintage})` : `the ${ds.title}`))
          .join(' and ');
        li.append(`${sources} state${camp.datasets.length === 1 ? 's' : ''} the ${kind} as `);
        li.appendChild(el('b', null, camp.day));
      });
      li.append(` – ${V1_COPY.callsign.dial.disagreementResolution}.`);
      ul.appendChild(li);
    }
    card.appendChild(ul);
    surface.appendChild(card);
  }

  host.appendChild(surface);
}

// An event's assertion-time provenance, as a compact expandable list — the
// assertion axis carried one affordance away from each event-time claim (issue
// #726). Dataset names are plain text: the v1 surface links only to itself.
// The friendly title leads (issue #954); the raw archive key, where carried,
// rides as a native-tooltip secondary detail rather than the primary label.
/** @param {AssertedBy[]} assertedBy @returns {HTMLElement} */
function assertedByFold(assertedBy) {
  const details = el('details', 'evt-assert');
  const n = assertedBy.length;
  details.appendChild(el('summary', null, `asserted by ${n} publication${n === 1 ? '' : 's'}`));
  const ul = el('ul');
  for (const a of assertedBy) {
    const li = el('li');
    if (a.key != null && a.key !== '') li.setAttribute('title', a.key);
    const bits = a.vintage != null ? `${a.title} (vintage ${a.vintage})` : a.title;
    li.append(a.nrows > 1 ? `${bits}, ${a.nrows} rows` : bits);
    ul.appendChild(li);
  }
  details.appendChild(ul);
  return details;
}

// The current-state terminus as a rail node: the green .tl.state node the shell
// styles, carrying the record's latest held status and — like every other rail
// node — its assertion-time provenance as an expandable fold.
/** @param {{ label: string, day: string, assertedBy: AssertedBy[] }} stateNode @returns {HTMLElement} */
function stateTerminusRow(stateNode) {
  const tl = el('div', 'tl state');
  const when = el('div', 'when', stateNode.day);
  when.appendChild(el('small', null, 'state'));
  tl.appendChild(when);
  const track = el('div', 'track');
  track.appendChild(el('div', 'ttl', stateNode.label));
  if (stateNode.assertedBy.length > 0) track.appendChild(assertedByFold(stateNode.assertedBy));
  tl.appendChild(track);
  return tl;
}

// One event as a rail line: its title and, one affordance away, the publications
// that assert it. Wrapped in .evt so a multi-event day-group card can distinguish
// its events with a hairline rule between them (issue #921).
/** @param {DialEvent} ev @returns {HTMLElement} */
function eventLine(ev) {
  const line = el('div', ev.disputed === true ? 'evt disputed' : 'evt');
  applyKindTint(line, ev.kindId);
  const ttl = el('div', 'ttl', ev.label);
  // A disputed entry links to the plain-language disagreement narrative, so the
  // hollow tinted marker and the verbal explanation reinforce (issue #921).
  if (ev.disputed === true) {
    ttl.append(' ');
    ttl.appendChild(link(`#${DISAGREEMENT_ANCHOR_ID}`, V1_COPY.callsign.dial.disputeLink, 'dispute-link'));
  }
  line.appendChild(ttl);
  if (ev.assertedBy.length > 0) line.appendChild(assertedByFold(ev.assertedBy));
  return line;
}

// A day-group as the plain grouped card: one dated node, each same-day event
// distinguished within it (issue #921). A lone event carries no inner rule.
/** @param {{ day: string, events: DialEvent[] }} group @returns {HTMLElement} */
function plainGroupRow(group) {
  const tl = el('div', group.events.length > 1 ? 'tl grouped' : 'tl');
  const when = el('div', 'when', group.day);
  when.appendChild(el('small', null, 'event'));
  tl.appendChild(when);
  const track = el('div', 'track');
  for (const ev of group.events) track.appendChild(eventLine(ev));
  tl.appendChild(track);
  return tl;
}

// A day-group as the agreeing-origin semantic row (issue #921): the told-story
// form for the common case where a licence's issue, original-start and
// version-start dates coincide. One "Licence origin" title with an equivalence
// mark and record-scoped coincidence prose, the constituent kinds listed
// beneath — each still carrying its own assertion-provenance fold.
/** @param {{ day: string, events: DialEvent[] }} group @returns {HTMLElement} */
function originGroupRow(group) {
  const tl = el('div', 'tl origin');
  const when = el('div', 'when', group.day);
  when.appendChild(el('small', null, 'origin'));
  tl.appendChild(when);
  const track = el('div', 'track');
  const ttl = el('div', 'ttl');
  ttl.append(`${V1_COPY.callsign.dial.originSemantic.title} `);
  ttl.appendChild(el('span', 'eqmark', V1_COPY.callsign.dial.originSemantic.equiv));
  track.appendChild(ttl);
  track.appendChild(el('p', 'dsc', V1_COPY.callsign.dial.originSemantic.coincide));
  // The origin constituents first, then any other same-day event, so the story
  // leads with the three kinds it coalesces.
  const origin = group.events.filter((e) => isOriginKind(e.kindId));
  const others = group.events.filter((e) => !isOriginKind(e.kindId));
  for (const ev of [...origin, ...others]) track.appendChild(eventLine(ev));
  // An attested, sourced caveat on how the original-start date is read (issue
  // #921), folded so it supports the story without crowding it.
  const note = el('details', 'fold origin-note');
  note.appendChild(el('summary', null, V1_COPY.callsign.dial.originSemantic.interpretationLabel));
  const nb = el('div', 'b');
  nb.appendChild(el('p', null, V1_COPY.callsign.dial.originSemantic.interpretation));
  note.appendChild(nb);
  track.appendChild(note);
  tl.appendChild(track);
  return tl;
}

/** @param {HTMLElement} host @param {CallsignModel} model */
function mountEventTimeline(host, model) {
  const surface = el('section', 'surface');
  const lbl = el('div', 'lbl');
  lbl.append(V1_COPY.callsign.eventTimelineLabel);
  lbl.appendChild(el('span', 'ax', 'event-time'));
  surface.appendChild(lbl);
  surface.appendChild(el('p', 'note', V1_COPY.callsign.eventTimelineLead));

  // Expand within-kind disagreements into a rail entry per distinct claim (issue
  // #921), so the fallback grouped cards show every camp, not just the earliest.
  const events = expandDisputedEvents(model.dial.events, model.dial.disagreements);
  const hasEvents = events.length > 0;
  const hasBookkeeping = model.dial.bookkeeping.length > 0;
  // The current-state terminus is a STATE claim, not an event, so it renders
  // whenever a status is held — independent of event/bookkeeping evidence,
  // mirroring the dial. When there is no event-time evidence the non-observation
  // copy still holds (it speaks to events, which are genuinely absent); the
  // terminus renders beside it rather than instead of it, so the two never
  // contradict and the dial never shows a terminus the rail omits.
  const stateNode = currentStateNode(model);

  if (!hasEvents && !hasBookkeeping) {
    surface.appendChild(el('p', 'note muted', V1_COPY.callsign.dial.noEvidence));
    if (stateNode !== null) {
      const tlWrap = el('div', 'timeline');
      tlWrap.appendChild(stateTerminusRow(stateNode));
      surface.appendChild(tlWrap);
    }
    host.appendChild(surface);
    return;
  }

  if (hasEvents || stateNode !== null) {
    const tlWrap = el('div', 'timeline');
    // Co-dated events group under one dated node, so the rail reads as the dial
    // does — one card per day — rather than as near-identical repeated rows. The
    // agreeing origin triple tells its own "licence origin" story; every other
    // day renders the plain grouped card with its events distinguished within.
    const groups = groupEventsByDay(events);
    for (const group of groups) {
      tlWrap.appendChild(isAgreeingOriginGroup(group, groups, model.dial.disagreements)
        ? originGroupRow(group)
        : plainGroupRow(group));
    }
    // The current-state terminus closes the rail with the record's latest held
    // status, in the green state node the shell already styles (.tl.state).
    if (stateNode !== null) tlWrap.appendChild(stateTerminusRow(stateNode));
    surface.appendChild(tlWrap);
  }

  // Bookkeeping stamps: system presence, never licensing events. Folded when
  // dated licensing evidence carries the story; opened when they are the only
  // dated evidence held (conditional prominence) — the open summary carries the
  // system-presence framing, so no separate lead paragraph repeats it.
  if (hasBookkeeping) {
    const details = el('details', 'evt-bookkeeping');
    if (!hasEvents) details.setAttribute('open', '');
    const n = model.dial.bookkeeping.length;
    details.appendChild(el('summary', null, `record bookkeeping stamps (${n} dated ${n === 1 ? 'line' : 'lines'} – system presence, not licensing events)`));
    const ul = el('div', 'timeline');
    for (const bk of model.dial.bookkeeping) {
      const tl = el('div', 'tl');
      const when = el('div', 'when', bk.day);
      when.appendChild(el('small', null, 'stamp'));
      tl.appendChild(when);
      const track = el('div', 'track');
      track.appendChild(el('div', 'ttl', bk.label));
      if (bk.assertedBy.length > 0) track.appendChild(assertedByFold(bk.assertedBy));
      tl.appendChild(track);
      ul.appendChild(tl);
    }
    details.appendChild(ul);
    surface.appendChild(details);
  }

  host.appendChild(surface);
}

/** @param {HTMLElement} host @param {CallsignModel} model */
function mountAnatomy(host, model) {
  const surface = el('section', 'surface');
  surface.appendChild(el('div', 'lbl', V1_COPY.callsign.anatomyLabel));
  if (model.anatomy === null || model.anatomy.length === 0) {
    surface.appendChild(el('p', 'note muted', 'No confident decomposition – the parser did not read this as a standard UK callsign, so no diagram is drawn (a guessed segmentation would be worse than none).'));
    host.appendChild(surface);
    return;
  }
  const grid = el('div', 'anat');
  for (const part of model.anatomy) {
    const p = el('div', 'p');
    p.appendChild(el('span', 'g', part.chars));
    const m = el('span', 'm');
    m.appendChild(el('span', 'role', part.name));
    m.appendChild(el('span', 'd', part.meaning));
    p.appendChild(m);
    grid.appendChild(p);
  }
  surface.appendChild(grid);
  host.appendChild(surface);
}

/** @param {HTMLElement} host @param {CallsignModel} model */
function mountRecordFidelity(host, model) {
  const surface = el('section', 'surface');
  surface.appendChild(el('div', 'lbl', V1_COPY.callsign.recordFidelityLabel));

  // Twin-row conflict (#633): the latest snapshot lists this callsign more than
  // once with differing status. Classified and shown with its working from the
  // register's own values — adjudicated nowhere.
  if (model.twin !== null) {
    const t = model.twin;
    const card = el('div', 'fid-note');
    const cardHead = el('div', 'fid-note-head');
    cardHead.appendChild(el('span', 'fn', t.label));
    cardHead.appendChild(provenanceChip('derived'));
    card.appendChild(cardHead);
    card.appendChild(el('p', 'note', V1_COPY.callsign.twin.gloss));
    const detail = el('p', 'note');
    const vintage = t.snapshotVintage ?? 'an undated snapshot';
    const states = t.variants.map((v) => `${v.raw}${v.status !== '' ? ` (${v.status}${v.modified !== '' ? `, modified ${v.modified}` : ''})` : ''}`);
    detail.append(`In the latest register snapshot (${vintage}): ${states.join(' vs ')}. `);
    if (t.recency.kind === 'ordered' && t.recency.newestRaw !== null) {
      detail.append(`By the register’s own last-modified dates, ${t.recency.newestRaw} is the most recently modified${t.recency.newestModified !== null ? ` (${t.recency.newestModified})` : ''} – recency, not a ruling.`);
    } else if (t.recency.kind === 'tied') {
      detail.append('Both rows carry the newest last-modified date, so recency does not order them.');
    } else if (t.recency.kind === 'partial') {
      detail.append('Some rows are undated; undated rows are characteristic of pool entries, so a missing date is not evidence of staleness.');
    } else {
      detail.append('No row carries a last-modified date, so recency cannot order them.');
    }
    card.appendChild(detail);
    surface.appendChild(card);
  }

  const notes = el('div', 'notes');
  const n1 = el('div', 'n');
  n1.appendChild(el('b', null, 'self-consistent'));
  n1.append(` ${V1_COPY.callsign.fidelity.selfConsistent}`);
  notes.appendChild(n1);
  const n2 = el('div', 'n');
  n2.appendChild(el('b', null, 'flagged, not adjudicated'));
  n2.append(` ${V1_COPY.callsign.fidelity.flaggedNotAdjudicated}`);
  notes.appendChild(n2);
  surface.appendChild(notes);
  host.appendChild(surface);
}

/** @param {HTMLElement} host @param {CallsignModel} model */
function mountExtras(host, model) {
  // Carried-origin explainer (folded). DATA-DRIVEN: the paragraph reflects this
  // record's own origin-vs-series state — "fresh" when the licence-chain origin
  // post-dates the series, "carried" when it pre-dates it, and "neutral" when
  // the series introduction is not recorded, so no path is asserted.
  const carried = el('details', 'fold');
  carried.appendChild(el('summary', null, V1_COPY.callsign.carriedOrigin.label));
  const cb = el('div', 'b');
  const co = V1_COPY.callsign.carriedOrigin;
  const para = model.carriedOrigin === 'fresh' ? co.ordinary : model.carriedOrigin === 'carried' ? co.carried : co.neutral;
  cb.appendChild(el('p', null, para));
  carried.appendChild(cb);
  host.appendChild(carried);

  // Related views + provenance — only surfaces the v1 site itself serves.
  const prov = el('details', 'fold');
  prov.appendChild(el('summary', null, V1_COPY.callsign.extrasLabel));
  const pb = el('div', 'b');
  const ul = el('ul');
  const liRaw = el('li');
  liRaw.appendChild(link('how-to-get-the-raw-data.html', 'Get the raw data'));
  liRaw.append(' – the archived files, per-entry zips, the SQLite tiers and the claim ledger.');
  ul.appendChild(liRaw);
  pb.appendChild(ul);
  pb.appendChild(el('p', null, V1_COPY.callsign.footer));
  prov.appendChild(pb);
  host.appendChild(prov);
}

// ---------------------------------------------------------------------------
// The registry + order (the config array).

export const CALLSIGN_SECTION_ORDER = [
  'fast-answer',
  'the-evidence-dial',
  'event-timeline',
  'anatomy',
  'record-fidelity',
  'extras',
];

// Sections that only make sense with a resolved record (issue #921, A4). On a
// no-record lookup these are suppressed entirely, so the no-record card stands
// alone rather than fronting an empty evidence instrument, a bare axis and an
// undrawable anatomy — which read as broken and undercut the clean no-record
// message. Only 'fast-answer' (which carries the no-record callout) survives a
// miss. Kept as a set so the suppression is one greppable rule, not a literal id
// test scattered through the renderer.
export const RECORD_DEPENDENT_SECTIONS = new Set([
  'the-evidence-dial',
  'event-timeline',
  'anatomy',
  'record-fidelity',
  'extras',
]);

/** @type {Record<string, { id: string, mount: (host: HTMLElement, model: CallsignModel) => void }>} */
export const CALLSIGN_SECTION_REGISTRY = {
  'fast-answer': { id: 'fast-answer', mount: mountFastAnswer },
  'the-evidence-dial': { id: 'the-evidence-dial', mount: mountEvidenceDial },
  'event-timeline': { id: 'event-timeline', mount: mountEventTimeline },
  anatomy: { id: 'anatomy', mount: mountAnatomy },
  'record-fidelity': { id: 'record-fidelity', mount: mountRecordFidelity },
  extras: { id: 'extras', mount: mountExtras },
};

/**
 * Render the callsign sections in order into `root`, one
 * <section data-section="id"> per entry. Throws on any id with no registered
 * mount — a config array can never render a silent gap.
 * @param {HTMLElement} root
 * @param {CallsignModel} model
 * @param {readonly string[]} [order]
 * @param {Record<string, { id: string, mount: (host: HTMLElement, model: CallsignModel) => void }>} [registry]
 */
export function renderCallsignSections(root, model, order = CALLSIGN_SECTION_ORDER, registry = CALLSIGN_SECTION_REGISTRY) {
  for (const id of order) {
    // A no-record lookup suppresses the record-dependent sections (issue #921,
    // A4): the no-record card stands alone. The id is still validated below when
    // it is not suppressed, so an unregistered id never renders a silent gap.
    if (!model.found && RECORD_DEPENDENT_SECTIONS.has(id)) continue;
    const entry = registry[id];
    if (entry === undefined) {
      throw new Error(`renderCallsignSections: no registered section for id "${id}" — every id in CALLSIGN_SECTION_ORDER must have a registry entry`);
    }
    const section = el('section');
    section.setAttribute('data-section', id);
    entry.mount(section, model);
    root.appendChild(section);
  }
}
