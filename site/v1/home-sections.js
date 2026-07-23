// @ts-check
// v1 HOME SECTION REGISTRY (issue #921): the home page as a config array of
// section ids resolved against a registry of { id, mount(host, model) } — the
// browser twin of src/ci/render/v1-sections.ts. renderHomeSections appends one
// <section data-section="id"> per entry in HOME_SECTION_ORDER and mounts each
// section's live DOM into it, throwing on any id with no registered mount. The
// section bodies are static (the home page needs no per-request data); the few
// build-stampable figures ride in the model with grounded defaults.

import { V1_COPY, EVENT_TIME_GLOSS, ASSERTION_TIME_GLOSS } from './copy.js';

// The bitemporal glosses are imported so the home module participates in the
// same verbatim-gloss guarantee the dial does (they are re-exported for any
// home-side surface that names the two clocks). Referenced here to keep the
// import meaningful to tooling.
export const HOME_BITEMPORAL_GLOSSES = [EVENT_TIME_GLOSS, ASSERTION_TIME_GLOSS];

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

// The grounded archive figures — the SINGLE record-scoped source the dated-fact
// chip, the readout row and the archive-span dial all derive from, so no two of
// them can ever disagree. Each is grounded in a committed report (cited) and is
// overridable at build time; none is a view-layer literal.
//  - The newest publication held (2026-06-23) records 158,318 callsigns
//    (reports/curiosity-index.md).
//  - 65 open-data publications are held, spanning the dense run 2013 → 2026.
//  - The earliest dated material the record reaches back to is 1903 — licence
//    history far predating the publication run, and the segment the dial's
//    scale breaks across (reports/state-at-t.md, survival-cohort.md,
//    sequence-analytics.md all report "Dated allocations 1903-05-03 → …").
const GROUNDED_ARCHIVE = {
  latestDateIso: '2026-06-23',
  latestDateLabel: '23 June 2026',
  latestMonthLabel: 'June 2026',
  callsigns: 158318,
  publicationsHeld: 65,
  heldStartYear: 2013,
  latestYear: 2026,
  historyStartYear: 1903,
};

// The home model. Every figure is derived from GROUNDED_ARCHIVE above — a single
// source, so the readout row and the span dial cannot drift apart — and is
// overridable at build time. The three from-the-record facts are real, notable
// and record-scoped, and ship as a static placeholder pool ready for build-time
// rotation.
/**
 * The archive-span facts the dial reads. Every field is build-derived from the
 * same grounded source that feeds the readout row.
 * @typedef {object} ArchiveSpan
 * @property {number} historyStartYear  earliest dated material the record reaches back to
 * @property {number} heldStartYear     first held publication — the scale-break boundary
 * @property {number} latestYear        the newest held publication's year
 * @property {string} latestLabel       humanised newest-held date (shared with the dated-fact chip)
 * @property {number} count             publications held (shared with the dated-fact chip)
 */
/**
 * @typedef {object} HomeModel
 * @property {{ date: string, count: number }} facts
 * @property {{ k: string, v: string, u: string }[]} glance
 * @property {ArchiveSpan} span
 * @property {{ headline: string, sentence: string, callsign?: string }[]} fromTheRecord
 */

/** @returns {HomeModel} */
export function defaultHomeModel() {
  const g = GROUNDED_ARCHIVE;
  const heldYears = g.latestYear - g.heldStartYear;
  return {
    facts: { date: g.latestDateLabel, count: g.publicationsHeld },
    // Holdings readouts, derived from the grounded source above.
    glance: [
      { k: 'publications', v: String(g.publicationsHeld), u: `folded, ${g.heldStartYear}–${g.latestYear}` },
      { k: 'callsigns', v: g.callsigns.toLocaleString('en-GB'), u: 'latest register' },
      { k: 'span held', v: `${heldYears}y`, u: `${g.heldStartYear} → ${g.latestYear}` },
      { k: 'latest snapshot', v: g.latestDateIso, u: g.latestMonthLabel },
    ],
    // The archive-span dial's facts — the same grounded figures, plus the deeper
    // history horizon the readout row does not itself surface.
    span: {
      historyStartYear: g.historyStartYear,
      heldStartYear: g.heldStartYear,
      latestYear: g.latestYear,
      latestLabel: g.latestDateLabel,
      count: g.publicationsHeld,
    },
    // From-the-record notable-detail pool (static placeholder, ready for
    // build-time rotation). Each fact is record-scoped and sourced:
    //  1. reports/curiosity-index.md — the newest publication (2026-06-23)
    //     holds 158,318 records.
    //  2. reports/forbidden-suffix-history.md — 1,465 three-letter suffixes
    //     withheld in the 2016-09 disclosure; the set has since shifted
    //     (+JIZ, −QNF, −ZFJ by 2024).
    //  3. reports/prefixes.md — the M2 prefix block appears reserved-only
    //     across the publications held (no issued callsign in it).
    fromTheRecord: [
      {
        headline: '158,318 callsigns',
        sentence: 'The newest publication held (2026-06-23) records 158,318 callsigns — the whole body a decade of publications is folded against.',
      },
      {
        headline: '1,465 withheld suffixes',
        sentence: 'The 2016 forbidden-suffix disclosure withheld 1,465 three-letter suffixes from new issues; the held record shows that set shifting since — one added, two dropped by 2024.',
      },
      {
        headline: 'M2 — reserved-only',
        sentence: 'Across the publications held, the M2 prefix block appears reserved-only: the record shows no issued callsign in it.',
        callsign: 'M7TEE',
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// The archive-span dial geometry — pure, so the reading it draws is pinned by
// test independently of the DOM. Given the build-derived ArchiveSpan it returns
// whether there is a reading worth drawing at all, whether a distinct earlier-
// history segment (and the scale break) applies, and the tick/needle geometry.
/**
 * @typedef {object} SpanDialGeometry
 * @property {boolean} render        whether there is a held run worth drawing
 * @property {boolean} showHistory   whether a distinct history segment + scale break applies
 * @property {number} heldDivisions  year cells across the dense held run (always >= 1)
 * @property {number} needleLeft     the current reading's position within the held run, percent
 * @property {number} count
 * @property {number} historyStartYear
 * @property {number} heldStartYear
 * @property {number} latestYear
 */
/** @param {ArchiveSpan} span @returns {SpanDialGeometry} */
export function spanDialGeometry(span) {
  const { historyStartYear, heldStartYear, latestYear, count } = span;
  const validHeld = Number.isFinite(heldStartYear) && Number.isFinite(latestYear) && latestYear >= heldStartYear;
  // No publications held, or no usable held-run dates: there is no reading to
  // draw, so the dial is omitted. The readout row still carries every figure as
  // text, so nothing is lost — the dial is its decorative-plus-informative twin.
  const render = count > 0 && validHeld;
  const heldYears = validHeld ? latestYear - heldStartYear : 0;
  // A single-date held run (start === latest) collapses to one cell rather than
  // dividing the axis by zero; the needle then sits at that sole reading.
  const heldDivisions = Math.max(1, heldYears);
  // The current reading is the newest held publication — the right end of the
  // dense run (a collapsed single-point run reads at that same sole position).
  const needleLeft = 100;
  // A distinct history segment (and the scale break) is drawn only where the
  // record genuinely reaches back before the held run began.
  const showHistory = render && Number.isFinite(historyStartYear) && historyStartYear < heldStartYear;
  return { render, showHistory, heldDivisions, needleLeft, count, historyStartYear, heldStartYear, latestYear };
}

// Fill a wording template's {placeholders} from a values map.
/** @param {string} tpl @param {Record<string, string | number>} vals */
const fillTemplate = (tpl, vals) =>
  tpl.replace(/\{(\w+)\}/g, (/** @type {string} */ _m, /** @type {string} */ key) => String(vals[key] ?? ''));

// ---------------------------------------------------------------------------
// Section mounts. Each renders into its own host element (the <section> the
// renderer created), using textContent for every data-derived value. Body
// sections mount their content on a `.surface` legibility panel — the same
// carded component the callsign page uses — so no body content sits bare on the
// page ground (the round-3 backing-surface rule); only the header/footer bars
// and the ground itself are uncarded.

/** @param {HTMLElement} host */
function mountLookupHero(host) {
  const head = el('header', 'head hero');
  const h1 = el('h1', null, V1_COPY.brand.id);
  h1.appendChild(el('span', 'path', ' / home'));
  head.appendChild(h1);
  head.appendChild(el('p', 'lede', V1_COPY.home.lede));

  const form = el('form', 'lookup');
  form.setAttribute('role', 'search');
  form.setAttribute('aria-label', V1_COPY.home.lookupLabel);
  form.setAttribute('action', 'callsign.html');
  form.setAttribute('method', 'get');
  const lbl = el('label', 'lk-lbl', V1_COPY.home.lookupLabel);
  lbl.setAttribute('for', 'csq');
  form.appendChild(lbl);
  const row = el('div', 'lk-row');
  const input = el('input', 'lk-in');
  input.setAttribute('id', 'csq');
  input.setAttribute('name', 'c');
  input.setAttribute('type', 'text');
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('spellcheck', 'false');
  input.setAttribute('placeholder', V1_COPY.home.placeholder);
  input.setAttribute('aria-describedby', 'lk-hint');
  row.appendChild(input);
  const go = el('button', 'lk-go', 'Look up →');
  go.setAttribute('type', 'submit');
  row.appendChild(go);
  form.appendChild(row);
  const hint = el('p', 'lk-hint');
  hint.setAttribute('id', 'lk-hint');
  hint.append(`${V1_COPY.home.lookupHint} Try `);
  hint.appendChild(link('callsign.html?c=M7TEE', 'M7TEE', 'cs'));
  hint.append('.');
  form.appendChild(hint);
  head.appendChild(form);
  host.appendChild(head);

  const trust = el('div', 'trust');
  trust.appendChild(el('span', 'mono', 'TRACE ›'));
  trust.appendChild(el('span', null, V1_COPY.home.trust));
  host.appendChild(trust);
}

/** @param {HTMLElement} host @param {HomeModel} model */
function mountAtAGlance(host, model) {
  const surface = el('section', 'surface');
  surface.appendChild(el('div', 'lbl', V1_COPY.home.atAGlanceLabel));
  const grid = el('div', 'readout');
  for (const cell of model.glance) {
    const c = el('div', 'cell');
    c.appendChild(el('div', 'k', cell.k));
    c.appendChild(el('div', 'v', cell.v));
    c.appendChild(el('div', 'u', cell.u));
    grid.appendChild(c);
  }
  surface.appendChild(grid);
  mountSpanDial(surface, model.span);
  host.appendChild(surface);
}

// The compact archive-span dial: a miniature of the site's dial language. It
// derives everything from the build-derived ArchiveSpan (never a view literal),
// and is the readout row's decorative-plus-informative twin — so it carries
// role="img" with an aria-label summarising the reading, its scale is
// aria-hidden, and every fact it shows is also present as text (the readout row
// above, and the dial's own text foot). A span with nothing to draw is omitted
// rather than rendered empty.
/** @param {HTMLElement} host @param {ArchiveSpan} span */
function mountSpanDial(host, span) {
  const geo = spanDialGeometry(span);
  if (!geo.render) return;
  const S = V1_COPY.home.span;
  const vals = {
    count: geo.count,
    heldStart: geo.heldStartYear,
    latest: geo.latestYear,
    historyStart: geo.historyStartYear,
    asOf: span.latestLabel,
  };

  const dial = el('div', 'spandial');
  dial.setAttribute('role', 'img');
  dial.setAttribute('aria-label', fillTemplate(geo.showHistory ? S.ariaWithHistory : S.ariaHeldOnly, vals));

  // Header: label + the visible range it covers.
  const head = el('div', 'sd-head');
  head.appendChild(el('span', 'sd-lbl', S.label));
  const rangeStart = geo.showHistory ? geo.historyStartYear : geo.heldStartYear;
  head.appendChild(el('span', 'sd-range', `${rangeStart} — ${geo.latestYear}`));
  dial.appendChild(head);

  // The scale itself is decorative reinforcement — the reading is in the
  // aria-label and the text foot, so it is hidden from assistive technology.
  const scale = el('div', 'sd-scale');
  scale.setAttribute('aria-hidden', 'true');

  if (geo.showHistory) {
    const hist = el('div', 'sd-seg history');
    hist.appendChild(el('div', 'sd-cap', S.historyCap));
    hist.appendChild(el('div', 'sd-base'));
    for (const left of ['0', '50%', '100%']) {
      const tick = el('span', 'sd-tick');
      tick.style.left = left;
      hist.appendChild(tick);
    }
    const yr = el('span', 'sd-yr edge-l', String(geo.historyStartYear));
    yr.style.left = '0';
    hist.appendChild(yr);
    scale.appendChild(hist);

    const brk = el('div', 'sd-break');
    brk.appendChild(el('span'));
    brk.appendChild(el('span'));
    scale.appendChild(brk);
  }

  const held = el('div', 'sd-seg held');
  held.appendChild(el('div', 'sd-cap on', fillTemplate(S.heldCap, vals)));
  held.appendChild(el('div', 'sd-base on'));
  const ticks = el('div', 'sd-ticks');
  for (let i = 0; i < geo.heldDivisions; i++) ticks.appendChild(el('span'));
  held.appendChild(ticks);
  const yrStart = el('span', 'sd-yr', String(geo.heldStartYear));
  yrStart.style.left = '0';
  held.appendChild(yrStart);
  // Only label the end year when the run actually spans more than a single point.
  if (geo.latestYear > geo.heldStartYear) {
    const yrEnd = el('span', 'sd-yr', String(geo.latestYear));
    yrEnd.style.left = '100%';
    held.appendChild(yrEnd);
  }
  const needle = el('div', 'sd-needle');
  needle.style.left = `${geo.needleLeft}%`;
  needle.appendChild(el('span', 'nd'));
  needle.appendChild(el('span', 'nlbl', fillTemplate(S.needleLabel, vals)));
  held.appendChild(needle);
  scale.appendChild(held);
  dial.appendChild(scale);

  // Text foot: the same facts in plain words, so nothing is conveyed by the
  // scale's colour or position alone.
  const foot = el('div', 'sd-foot');
  const heldItem = el('span');
  heldItem.appendChild(el('b', null, String(geo.count)));
  heldItem.append(` ${S.footHeld}`);
  foot.appendChild(heldItem);
  const runItem = el('span');
  runItem.appendChild(el('b', null, String(geo.heldStartYear)));
  runItem.append(' → ');
  runItem.appendChild(el('b', null, String(geo.latestYear)));
  runItem.append(` ${S.footRun}`);
  foot.appendChild(runItem);
  if (geo.showHistory) {
    const histItem = el('span');
    histItem.append(`${S.footHistory} `);
    histItem.appendChild(el('b', null, String(geo.historyStartYear)));
    foot.appendChild(histItem);
  }
  dial.appendChild(foot);

  host.appendChild(dial);
}

/** @param {HTMLElement} host */
function mountWaysIn(host) {
  const surface = el('section', 'surface');
  surface.appendChild(el('div', 'lbl', V1_COPY.home.waysInLabel));
  const grid = el('div', 'modules');
  // Only the journeys the v1 surface serves. Unmigrated destinations do not
  // appear here — nothing on the surface points off it.
  const cards = [
    { idx: '01', card: V1_COPY.home.cards.lookup, href: 'callsign.html' },
    { idx: '02', card: V1_COPY.home.cards.rawData, href: 'how-to-get-the-raw-data.html' },
  ];
  for (const c of cards) {
    const mod = el('div', 'mod');
    const top = el('div', 'top');
    const name = el('div', 'name');
    name.appendChild(link(c.href, c.card.name));
    top.appendChild(name);
    top.appendChild(el('span', 'idx', c.idx));
    mod.appendChild(top);
    mod.appendChild(el('p', 'say', c.card.say));
    grid.appendChild(mod);
  }
  surface.appendChild(grid);
  host.appendChild(surface);
}

/** @param {HTMLElement} host @param {HomeModel} model */
function mountFromTheRecord(host, model) {
  const surface = el('section', 'surface');
  surface.appendChild(el('div', 'lbl', V1_COPY.home.fromTheRecordLabel));
  const watch = el('div', 'watch');
  const bar = el('div', 'bar');
  const chip = el('span', 'chip');
  chip.appendChild(el('span', 'led'));
  chip.append('from the pool');
  bar.appendChild(chip);
  watch.appendChild(bar);
  const first = model.fromTheRecord[0];
  const body = el('div', 'body');
  const inner = el('div');
  inner.appendChild(el('div', 'big mono', first.headline));
  const p = el('p');
  p.append(first.sentence);
  if (first.callsign !== undefined) {
    p.append(' See ');
    p.appendChild(link(`callsign.html?c=${encodeURIComponent(first.callsign)}`, first.callsign, 'cs'));
    p.append('.');
  }
  inner.appendChild(p);
  body.appendChild(inner);
  watch.appendChild(body);
  watch.appendChild(el('div', 'rot-foot', V1_COPY.home.fromTheRecordFoot));
  surface.appendChild(watch);
  host.appendChild(surface);
}

/** @param {HTMLElement} host */
function mountScopeDisclaimer(host) {
  const fold = el('details', 'fold');
  fold.appendChild(el('summary', null, V1_COPY.home.scopeDisclaimerLabel));
  const b = el('div', 'b');
  b.appendChild(el('p', null, V1_COPY.home.scopeDisclaimer));
  fold.appendChild(b);
  host.appendChild(fold);
}

// ---------------------------------------------------------------------------
// The registry + order (the config array).

export const HOME_SECTION_ORDER = [
  'lookup-hero',
  'at-a-glance',
  'ways-in',
  'from-the-record',
  'scope-disclaimer',
];

/** @type {Record<string, { id: string, mount: (host: HTMLElement, model: HomeModel) => void }>} */
export const HOME_SECTION_REGISTRY = {
  'lookup-hero': { id: 'lookup-hero', mount: mountLookupHero },
  'at-a-glance': { id: 'at-a-glance', mount: mountAtAGlance },
  'ways-in': { id: 'ways-in', mount: mountWaysIn },
  'from-the-record': { id: 'from-the-record', mount: mountFromTheRecord },
  'scope-disclaimer': { id: 'scope-disclaimer', mount: mountScopeDisclaimer },
};

/**
 * Render the home sections in order into `root`, one <section data-section="id">
 * per entry. Throws on any id with no registered mount — a config array can
 * never render a silent gap.
 * @param {HTMLElement} root
 * @param {HomeModel} model
 * @param {readonly string[]} [order]
 * @param {Record<string, { id: string, mount: (host: HTMLElement, model: HomeModel) => void }>} [registry]
 */
export function renderHomeSections(root, model, order = HOME_SECTION_ORDER, registry = HOME_SECTION_REGISTRY) {
  for (const id of order) {
    const entry = registry[id];
    if (entry === undefined) {
      throw new Error(`renderHomeSections: no registered section for id "${id}" — every id in HOME_SECTION_ORDER must have a registry entry`);
    }
    const section = el('section');
    section.setAttribute('data-section', id);
    entry.mount(section, model);
    root.appendChild(section);
  }
}
