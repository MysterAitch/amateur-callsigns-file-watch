// @ts-check
// v1 CALLSIGN SECTION REGISTRY (issue #921): the per-callsign page as a config
// array of section ids resolved against a registry of { id, mount(host, model) }
// — the browser twin of src/ci/render/v1-sections.ts. renderCallsignSections
// appends one <section data-section="id"> per entry in CALLSIGN_SECTION_ORDER
// and mounts each section's live DOM, throwing on any id with no registered
// mount.
//
// This module is deliberately free of any v0 import: it renders a resolved
// MODEL. The v0 pure data functions (resolveCallsign / latestSummary /
// seenSummary / anatomyFigureParts / stripModel) are reused by INJECTION —
// buildCallsignModel takes them as arguments — so the orchestrator
// (site/v1/callsign.js) can supply the real v0 modules it loads at runtime,
// while the tests inject the same real functions over a fixture shard. Every
// data-derived value is written with textContent, never innerHTML.
//
// THE DIAL is the signature element: a two-track bitemporal panel ported from
// the green-field mockup into B-light tokens. Event-time markers ride the upper
// scale (teal, primary); per-publication assertion sightings ride the lower
// scale (grey, calibration). Findings render VERBATIM from the event shard's
// f entries, never a bare rule badge. The series-introduction context marker is
// only carried when meta.json supplies series data; the current meta.json does
// not, so the dial ships without it (the meta.json extension is deferred to the
// wiring PR — build-callsign-event-shards.ts is untouched this round).

import { V1_COPY } from './copy.js';
import { v0Href } from './shell.js';

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
 * @typedef {object} DialEvent
 * @property {string} day     event-time day (YYYY-MM-DD)
 * @property {string} label
 * @property {boolean} state  true for the current-state marker (rendered green)
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
 * @typedef {object} CallsignModel
 * @property {string} key
 * @property {boolean} found
 * @property {{ statuses: string[], products: string[], types: string[], dataset: { title: string, vintage: string | null, href: string } } | null} latest
 * @property {{ first: { vintage: string | null } | null, last: { vintage: string | null } | null, present: number, registerPresent: number } | null} seen
 * @property {{ chars: string, name: string, meaning: string }[] | null} anatomy
 * @property {{ events: DialEvent[], sightings: DialSighting[], findings: DialFinding[], hasEvents: boolean }} dial
 * @property {string | null} series  e.g. 'M7' (from parsed anatomy prefix)
 */

// The v0 data-shape and function types, referenced by type-only import() so
// this module carries no runtime dependency on v0 (the orchestrator injects the
// real functions at runtime). Typing the injected functions as `typeof` the v0
// exports means the reuse is checked exactly — an incompatible function fails
// the build, and buildCallsignModel calls each with the shapes it really has.
/** @typedef {import('../callsign.js').CallsignRecord} CallsignRecord */
/** @typedef {import('../callsign.js').ShardManifest} ShardManifest */

// Build the resolved view model from the raw fetched data and the INJECTED v0
// pure functions. Pure given its dependencies — the orchestrator injects the
// real v0 modules, the tests inject the identical real functions over a
// fixture. `eventRecord`/`eventMeta` are null when the event axis is not (yet)
// loaded or the callsign has no event-time claim.
/**
 * @param {object} deps
 * @param {{ key: string | null, record: CallsignRecord | null, cleaned: string, typed: string }} deps.res
 * @param {ShardManifest} deps.manifest
 * @param {import('../callsign-events.js').EventRecord | null} deps.eventRecord
 * @param {import('../callsign-events.js').EventsMeta | null} deps.eventMeta
 * @param {typeof import('../callsign.js').latestSummary} deps.latestSummary
 * @param {typeof import('../callsign.js').seenSummary} deps.seenSummary
 * @param {typeof import('../callsign.js').anatomyFigureParts} deps.anatomyFigureParts
 * @param {typeof import('../callsign-events.js').stripModel} deps.stripModel
 * @returns {CallsignModel}
 */
export function buildCallsignModel(deps) {
  const { res, manifest, eventRecord, eventMeta } = deps;
  const record = res.record;
  const key = res.key;
  if (record === null || key === null) {
    return { key: res.cleaned !== '' ? res.cleaned : res.typed, found: false, latest: null, seen: null, anatomy: null, dial: { events: [], sightings: [], findings: [], hasEvents: false }, series: null };
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

  // Event axis + findings, from the event shard when present.
  /** @type {DialEvent[]} */
  let events = [];
  /** @type {DialFinding[]} */
  let findings = [];
  let hasEvents = false;
  if (eventRecord != null && eventMeta != null) {
    const strip = deps.stripModel(eventRecord, eventMeta);
    events = strip.licensing.map((line) => ({ day: line.day, label: line.kindLabel, state: false }));
    findings = strip.findings.map((f) => ({ statement: f.statement, caveats: f.caveats.map((c) => c.label) }));
    hasEvents = events.length > 0;
  }

  const series = record.a !== undefined && typeof record.a.pre === 'string' ? record.a.pre : null;

  return { key, found: true, latest, seen, anatomy, dial: { events, sightings, findings, hasEvents }, series };
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
  /** @param {number} frac */
  const pos = (frac) => Math.max(0, Math.min(100, ((frac - minYear) / span) * 100));
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
  const row = el('div', 'status-row');
  const statusCell = el('div', 'c');
  statusCell.appendChild(el('div', 'k', 'status'));
  const statusV = el('div', 'v');
  const statuses = model.latest !== null && model.latest.statuses.length > 0 ? model.latest.statuses.join(' / ') : '(no status recorded)';
  statusV.appendChild(el('span', 'led'));
  statusV.append(statuses);
  statusCell.appendChild(statusV);
  row.appendChild(statusCell);

  const productCell = el('div', 'c');
  productCell.appendChild(el('div', 'k', 'product'));
  const products = model.latest !== null && model.latest.products.length > 0 ? model.latest.products.join(' / ') : '(no product recorded)';
  productCell.appendChild(el('div', 'v sm', products));
  row.appendChild(productCell);

  const seriesCell = el('div', 'c');
  seriesCell.appendChild(el('div', 'k', 'series'));
  seriesCell.appendChild(el('div', 'v', model.series ?? '—'));
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
    const cap = el('span', 'cap', ev.label);
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
    surface.appendChild(el('p', 'note', V1_COPY.callsign.dial.noEvidence));
  }

  host.appendChild(surface);
}

/** @param {HTMLElement} host @param {CallsignModel} model */
function mountEventTimeline(host, model) {
  const surface = el('section', 'surface');
  const lbl = el('div', 'lbl');
  lbl.append(V1_COPY.callsign.eventTimelineLabel);
  lbl.appendChild(el('span', 'ax', 'event-time'));
  surface.appendChild(lbl);
  surface.appendChild(el('p', 'note', V1_COPY.callsign.eventTimelineLead));
  if (model.dial.events.length === 0) {
    surface.appendChild(el('p', 'note muted', V1_COPY.callsign.dial.noEvidence));
    host.appendChild(surface);
    return;
  }
  const tlWrap = el('div', 'timeline');
  for (const ev of model.dial.events) {
    const tl = el('div', 'tl');
    const when = el('div', 'when', ev.day);
    when.appendChild(el('small', null, 'event'));
    tl.appendChild(when);
    const track = el('div', 'track');
    track.appendChild(el('div', 'ttl', ev.label));
    tl.appendChild(track);
    tlWrap.appendChild(tl);
  }
  surface.appendChild(tlWrap);
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

/** @param {HTMLElement} host */
function mountRecordFidelity(host) {
  const surface = el('section', 'surface');
  surface.appendChild(el('div', 'lbl', V1_COPY.callsign.recordFidelityLabel));
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
  // Carried-origin explainer (folded; ordinary wording by default).
  const carried = el('details', 'fold');
  carried.appendChild(el('summary', null, V1_COPY.callsign.carriedOrigin.label));
  const cb = el('div', 'b');
  cb.appendChild(el('p', null, V1_COPY.callsign.carriedOrigin.ordinary));
  cb.appendChild(el('p', null, V1_COPY.callsign.carriedOrigin.carried));
  carried.appendChild(cb);
  host.appendChild(carried);

  // Related views + provenance.
  const prov = el('details', 'fold');
  prov.appendChild(el('summary', null, V1_COPY.callsign.extrasLabel));
  const pb = el('div', 'b');
  const target = model.found ? model.key : '';
  const ul = el('ul');
  if (target !== '') {
    const liLedger = el('li');
    liLedger.appendChild(link(`${v0Href('ledger.html')}?c=${encodeURIComponent(target)}`, 'Full provenance & timeline (ledger)'));
    liLedger.append(' — every raw byte and derivation behind this record, queried live.');
    ul.appendChild(liLedger);
    const liLookup = el('li');
    liLookup.appendChild(link(`${v0Href('index.html')}?c=${encodeURIComponent(target)}`, 'Database lookup'));
    liLookup.append(' — reference joins, regional variants and the suffix availability matrix.');
    ul.appendChild(liLookup);
  }
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
