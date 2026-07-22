// @ts-check
// v1 HOME SECTION REGISTRY (issue #921): the home page as a config array of
// section ids resolved against a registry of { id, mount(host, model) } — the
// browser twin of src/ci/render/v1-sections.ts. renderHomeSections appends one
// <section data-section="id"> per entry in HOME_SECTION_ORDER and mounts each
// section's live DOM into it, throwing on any id with no registered mount. The
// section bodies are static (the home page needs no per-request data); the few
// build-stampable figures ride in the model with grounded defaults.

import { V1_COPY, EVENT_TIME_GLOSS, ASSERTION_TIME_GLOSS } from './copy.js';
import { v0Href } from './shell.js';

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

// The home model. Every figure defaults to a value grounded in the committed
// reports (cited below), and is overridable at build time. The three
// from-the-record facts are real, notable and record-scoped — each cites the
// report it is drawn from — and ship as a static placeholder pool ready for
// build-time rotation.
/**
 * @typedef {object} HomeModel
 * @property {{ date: string, count: number }} facts
 * @property {{ k: string, v: string, u: string }[]} glance
 * @property {{ headline: string, sentence: string, callsign?: string }[]} fromTheRecord
 */

/** @returns {HomeModel} */
export function defaultHomeModel() {
  return {
    facts: { date: '23 June 2026', count: 65 },
    // Holdings readouts. Figures grounded in reports/curiosity-index.md (the
    // newest publication, 2026-06-23, holds 158,318 records) and the archive
    // span; build-stamped in the wiring PR.
    glance: [
      { k: 'publications', v: '65', u: 'folded, 2013–2026' },
      { k: 'callsigns', v: '158,318', u: 'latest register' },
      { k: 'span held', v: '13y', u: '2013 → 2026' },
      { k: 'latest snapshot', v: '2026-06-23', u: 'June 2026' },
    ],
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
// Section mounts. Each renders into its own host element (the <section> the
// renderer created), using textContent for every data-derived value.

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
  host.appendChild(el('div', 'lbl', V1_COPY.home.atAGlanceLabel));
  const grid = el('div', 'readout');
  for (const cell of model.glance) {
    const c = el('div', 'cell');
    c.appendChild(el('div', 'k', cell.k));
    c.appendChild(el('div', 'v', cell.v));
    c.appendChild(el('div', 'u', cell.u));
    grid.appendChild(c);
  }
  host.appendChild(grid);
}

/** @param {HTMLElement} host */
function mountWaysIn(host) {
  host.appendChild(el('div', 'lbl', V1_COPY.home.waysInLabel));
  const grid = el('div', 'modules');
  // Event-first order: Look up · Explore the history, then Browse & query ·
  // How the record works.
  const cards = [
    { idx: '01', card: V1_COPY.home.cards.lookup, href: 'callsign.html' },
    { idx: '02', card: V1_COPY.home.cards.history, href: v0Href('on-this-day.html') },
    { idx: '03', card: V1_COPY.home.cards.browse, href: v0Href('explore.html'), extra: { href: 'how-to-get-the-raw-data.html', label: 'get the raw data' } },
    { idx: '04', card: V1_COPY.home.cards.how, href: v0Href('about.html') },
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
    if (c.extra !== undefined) {
      const re = el('div', 're');
      re.appendChild(link(c.extra.href, c.extra.label));
      mod.appendChild(re);
    }
    grid.appendChild(mod);
  }
  host.appendChild(grid);
}

/** @param {HTMLElement} host @param {HomeModel} model */
function mountFromTheRecord(host, model) {
  host.appendChild(el('div', 'lbl', V1_COPY.home.fromTheRecordLabel));
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
  host.appendChild(watch);
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
