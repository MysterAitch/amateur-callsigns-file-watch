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
 * @property {string} title    the asserting dataset's title
 * @property {string} href     its dataset entry page (not linked by the v1 surface)
 * @property {string | null} vintage  its assertion-time vintage
 * @property {number} nrows    how many rows in that dataset assert the line
 */

/**
 * @typedef {object} DialEvent
 * @property {string} day     event-time day (YYYY-MM-DD)
 * @property {string} label
 * @property {boolean} state  reserved for a current-state marker; the event
 *                            builder does not emit one, so this is always false
 *                            today (the render still handles a true value).
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
 * @property {{ day: string, datasets: { title: string, href: string, vintage: string | null }[] }[]} camps  every camp kept, resolved nowhere (#467)
 */

/**
 * @typedef {object} DialSighting
 * @property {string} vintage  assertion-time vintage (YYYY-MM-DD or YYYY-MM)
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
    return { key: res.cleaned !== '' ? res.cleaned : res.typed, cleaned: res.cleaned, found: false, viaRendering, latest: null, seen: null, anatomy: null, dial: { events: [], sightings: [], findings: [], bookkeeping: [], disagreements: [], hasEvents: false, hasBookkeeping: false }, twin: null, carriedOrigin: 'neutral', series: null, seriesIntro: null };
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
    sightings.push({ vintage: dataset.vintage });
  }

  // Event axis, findings, bookkeeping and cross-vintage disagreements, from the
  // event strip when the event shard is present. Each event carries its
  // assertion-time provenance so it never floats free of the source that
  // asserts it (issue #726).
  /** @param {{ dataset: import('../callsign-events.js').EventDataset, nrows: number }[]} assertedBy @returns {AssertedBy[]} */
  const mapAssertedBy = (assertedBy) => assertedBy.map((a) => ({ title: a.dataset.title, href: a.dataset.href, vintage: a.dataset.vintage, nrows: a.nrows }));
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
    events = strip.licensing.map((line) => ({ day: line.day, label: line.kindLabel, state: false, assertedBy: mapAssertedBy(line.assertedBy) }));
    bookkeeping = strip.bookkeeping.map((line) => ({ day: line.day, label: line.kindLabel, assertedBy: mapAssertedBy(line.assertedBy) }));
    findings = strip.findings.map((f) => ({ statement: f.statement, caveats: f.caveats.map((c) => c.label) }));
    disagreements = strip.disagreements.map((d) => ({
      kindLabel: d.kindLabel,
      camps: d.camps.map((c) => ({ day: c.day, datasets: c.datasets.map((ds) => ({ title: ds.title, href: ds.href, vintage: ds.vintage })) })),
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

  return { key, cleaned: res.cleaned, found: true, viaRendering, latest, seen, anatomy, dial: { events, sightings, findings, bookkeeping, disagreements, hasEvents, hasBookkeeping }, twin, carriedOrigin, series, seriesIntro };
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

// Pure geometry for the dial: map event days and sighting vintages onto one
// shared year axis. Returns the axis domain, the year ticks and each marker's
// left-percentage — everything the mount needs, and everything the test pins.
/**
 * @param {DialEvent[]} events
 * @param {DialSighting[]} sightings
 * @returns {{ minYear: number, maxYear: number, years: { year: number, left: number }[], events: { left: number, label: string, day: string, state: boolean }[], sightings: { left: number, vintage: string }[] }}
 */
export function dialGeometry(events, sightings) {
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
  return {
    minYear,
    maxYear,
    years,
    events: events.filter((e) => !Number.isNaN(fractionalYear(e.day))).map((e) => ({ left: pos(fractionalYear(e.day)), label: e.label, day: e.day, state: e.state })),
    sightings: sightings.filter((s) => !Number.isNaN(fractionalYear(s.vintage))).map((s) => ({ left: pos(fractionalYear(s.vintage)), vintage: s.vintage })),
  };
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
    callout.append(`No record for ${model.key} in any of the publications this mirror holds. Absence here is never evidence about the register — this mirror holds only what has been published or disclosed.`);
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

// The bitemporal dial (the signature element).
/** @param {HTMLElement} host @param {CallsignModel} model */
function mountEvidenceDial(host, model) {
  const surface = el('section', 'surface');
  const lbl = el('div', 'lbl');
  lbl.append(V1_COPY.callsign.evidenceLabel);
  surface.appendChild(lbl);
  surface.appendChild(el('p', 'note', V1_COPY.callsign.evidenceLead));

  const dial = el('div', 'dial');

  // Upper track label + gloss (verbatim).
  const evLab = el('div', 'tracklab event');
  evLab.appendChild(el('span', 'sw'));
  evLab.appendChild(el('b', null, V1_COPY.callsign.dial.eventLabel));
  evLab.append(` — ${V1_COPY.callsign.dial.eventGloss.replace(`${V1_COPY.callsign.dial.eventLabel} — `, '')}`);
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
  const geo = dialGeometry(model.dial.events, model.dial.sightings);
  const ariaBits = [`One year axis from ${geo.minYear} to ${geo.maxYear}.`];
  if (geo.events.length > 0) ariaBits.push(`Event time, above the axis: ${geo.events.map((e) => `${e.label} (${e.day})`).join('; ')}.`);
  if (geo.sightings.length > 0) ariaBits.push(`Assertion time, below the axis: ${geo.sightings.length} publication sightings.`);
  scale.setAttribute('aria-label', ariaBits.join(' '));
  scale.appendChild(el('div', 'axis'));
  for (const y of geo.years) {
    const yr = el('div', 'yr', String(y.year));
    yr.setAttribute('style', `left:${y.left.toFixed(1)}%`);
    scale.appendChild(yr);
  }
  for (const ev of geo.events) {
    const marker = el('div', ev.state ? 'ev state' : 'ev');
    marker.setAttribute('style', `left:${ev.left.toFixed(1)}%`);
    marker.appendChild(el('span', 'stem'));
    marker.appendChild(el('span', 'dot'));
    // The marker caption stays terse — the leading clause of the kind label,
    // the full label reads on the event-timeline section below. Long captions
    // near an axis edge otherwise overrun the panel.
    const cap = el('span', 'cap', ev.label.split(' — ')[0]);
    cap.appendChild(el('small', null, ev.day));
    marker.appendChild(cap);
    scale.appendChild(marker);
  }
  for (const si of geo.sightings) {
    const marker = el('div', 'si');
    marker.setAttribute('style', `left:${si.left.toFixed(1)}%`);
    marker.appendChild(el('span', 'stem'));
    marker.appendChild(el('span', 'pip'));
    scale.appendChild(marker);
  }
  dial.appendChild(scale);

  // Lower track label + gloss (verbatim).
  const asLab = el('div', 'tracklab assert');
  asLab.appendChild(el('span', 'sw'));
  asLab.appendChild(el('b', null, V1_COPY.callsign.dial.assertLabel));
  asLab.append(` — ${V1_COPY.callsign.dial.assertGloss.replace(`${V1_COPY.callsign.dial.assertLabel} — `, '')}`);
  dial.appendChild(asLab);

  // Reading / calibration note.
  const note = el('div', 'dial-note');
  const g1 = el('span', 'g event');
  g1.appendChild(el('b', null, V1_COPY.callsign.dial.readingLead));
  g1.append(` — ${geo.events.length} event marker${geo.events.length === 1 ? '' : 's'} on the primary scale.`);
  note.appendChild(g1);
  const g2 = el('span', 'g assert');
  g2.appendChild(el('b', null, V1_COPY.callsign.dial.calibrationLead));
  g2.append(` — ${geo.sightings.length} sighting${geo.sightings.length === 1 ? '' : 's'}. ${V1_COPY.callsign.dial.calibrationNote}`);
  note.appendChild(g2);
  dial.appendChild(note);

  // Series-introduction context marker (issue #921): only when meta.json
  // records when this callsign's SERIES was opened. A series-level fact that
  // frames the event scale — never a claim about this record's own issuance.
  if (model.seriesIntro !== null && model.series !== null) {
    const context = el('div', 'dial-context');
    context.appendChild(el('span', 'tb', 'context'));
    const text = V1_COPY.callsign.dial.seriesIntro
      .replace('{series}', model.series)
      .replace('{month}', formatSeriesIntroMonth(model.seriesIntro));
    context.append(` ${text}.`);
    dial.appendChild(context);
  }

  surface.appendChild(dial);

  // Findings, VERBATIM (never a bare rule badge).
  if (model.dial.findings.length > 0) {
    for (const f of model.dial.findings) {
      const fEl = el('div', 'dial-finding');
      fEl.appendChild(el('span', 'tb', 'inferred'));
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
    const dhead = el('div', 'dd-head');
    dhead.appendChild(el('span', 'tb', 'derived'));
    dhead.append(` ${V1_COPY.callsign.dial.disagreementLabel}`);
    card.appendChild(dhead);
    card.appendChild(el('p', 'note', V1_COPY.callsign.dial.disagreementGloss));
    const ul = el('ul', 'dd-camps');
    for (const d of model.dial.disagreements) {
      const li = el('li');
      li.append(`${d.kindLabel} — `);
      d.camps.forEach((camp, i) => {
        if (i > 0) li.append(' vs ');
        li.appendChild(el('b', null, camp.day));
        const titles = camp.datasets.map((ds) => (ds.vintage != null ? `${ds.title} (vintage ${ds.vintage})` : ds.title)).join(', ');
        li.append(` per ${titles}`);
      });
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
/** @param {AssertedBy[]} assertedBy @returns {HTMLElement} */
function assertedByFold(assertedBy) {
  const details = el('details', 'evt-assert');
  const n = assertedBy.length;
  details.appendChild(el('summary', null, `asserted by ${n} publication${n === 1 ? '' : 's'}`));
  const ul = el('ul');
  for (const a of assertedBy) {
    const li = el('li');
    const bits = a.vintage != null ? `${a.title} (vintage ${a.vintage})` : a.title;
    li.append(a.nrows > 1 ? `${bits}, ${a.nrows} rows` : bits);
    ul.appendChild(li);
  }
  details.appendChild(ul);
  return details;
}

/** @param {HTMLElement} host @param {CallsignModel} model */
function mountEventTimeline(host, model) {
  const surface = el('section', 'surface');
  const lbl = el('div', 'lbl');
  lbl.append(V1_COPY.callsign.eventTimelineLabel);
  lbl.appendChild(el('span', 'ax', 'event-time'));
  surface.appendChild(lbl);
  surface.appendChild(el('p', 'note', V1_COPY.callsign.eventTimelineLead));

  const hasEvents = model.dial.events.length > 0;
  const hasBookkeeping = model.dial.bookkeeping.length > 0;
  if (!hasEvents && !hasBookkeeping) {
    surface.appendChild(el('p', 'note muted', V1_COPY.callsign.dial.noEvidence));
    host.appendChild(surface);
    return;
  }

  if (hasEvents) {
    const tlWrap = el('div', 'timeline');
    for (const ev of model.dial.events) {
      const tl = el('div', 'tl');
      const when = el('div', 'when', ev.day);
      when.appendChild(el('small', null, 'event'));
      tl.appendChild(when);
      const track = el('div', 'track');
      track.appendChild(el('div', 'ttl', ev.label));
      if (ev.assertedBy.length > 0) track.appendChild(assertedByFold(ev.assertedBy));
      tl.appendChild(track);
      tlWrap.appendChild(tl);
    }
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
    details.appendChild(el('summary', null, `record bookkeeping stamps (${n} dated ${n === 1 ? 'line' : 'lines'} — system presence, not licensing events)`));
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
    surface.appendChild(el('p', 'note muted', 'No confident decomposition — the parser did not read this as a standard UK callsign, so no diagram is drawn (a guessed segmentation would be worse than none).'));
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
    cardHead.appendChild(el('span', 'tb', 'derived'));
    card.appendChild(cardHead);
    card.appendChild(el('p', 'note', V1_COPY.callsign.twin.gloss));
    const detail = el('p', 'note');
    const vintage = t.snapshotVintage ?? 'an undated snapshot';
    const states = t.variants.map((v) => `${v.raw}${v.status !== '' ? ` (${v.status}${v.modified !== '' ? `, modified ${v.modified}` : ''})` : ''}`);
    detail.append(`In the latest register snapshot (${vintage}): ${states.join(' vs ')}. `);
    if (t.recency.kind === 'ordered' && t.recency.newestRaw !== null) {
      detail.append(`By the register’s own last-modified dates, ${t.recency.newestRaw} is the most recently modified${t.recency.newestModified !== null ? ` (${t.recency.newestModified})` : ''} — recency, not a ruling.`);
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
  liRaw.append(' — the archived files, per-entry zips, the SQLite tiers and the claim ledger.');
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
