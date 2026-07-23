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

// The archive figures, centralised in one place. These are hand-authored,
// report-cited CONSTANTS — not build-time-derived — so this is the single source
// the dated-fact chip, the readout row and the archive-span dial all read,
// rather than three independent copies. The JS-rendered home and the static
// no-JS baseline in index.html are held to these same values by a parity test
// (site/v1/sections.test.ts), so a future edit here cannot silently split the
// two renders. Deriving these from the committed archive/reports AT BUILD TIME
// is a possible follow-up, not something claimed here.
// Citations:
//  - 1903: the earliest dated allocation the record holds, verified in three
//    reports (reports/state-at-t.md, survival-cohort.md and sequence-analytics.md
//    all report "Dated allocations 1903-05-03 → …").
//  - 158,318 callsigns in the newest publication held (reports/curiosity-index.md).
//  - The 65-publications / 2013 pair is drawn from the archive's own extent and
//    has no single citable report; it is an honestly-noted centralised constant,
//    not a derived figure.
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

// The home model. Every figure reads from GROUNDED_ARCHIVE above — one source
// for the readout row and the span dial, with the static no-JS baseline held to
// it by the parity test. The three from-the-record facts are real, notable and
// record-scoped, and ship as a static placeholder pool ready for build-time
// rotation.
/**
 * The archive-span facts the dial reads. Every field is build-derived from the
 * same grounded source that feeds the readout row.
 * @typedef {object} HoldingPublication
 * @property {string} vintage  the publication's data vintage (ISO date or month)
 * @property {string} kind     dataset-class key driving the mark's tint (never colour alone)
 * @property {string} letter   the kind's single letter (R/A/I/F/S/T/C) — the colour-independent cue
 * @property {string} title    the dataset title (the marker's hover/text-parity detail)
 * @property {number} rows     row count (the hover/text-parity detail)
 * @property {boolean} latest  the single newest register snapshot — the ringed mark
 */
/**
 * @typedef {object} HoldingMilestone
 * @property {string} start     ISO year/month; === end for a point milestone
 * @property {string} end       later value for a loosely-dated range
 * @property {boolean} range    whether this is a range (a loosely-dated event)
 * @property {string} label     record-scoped, claims-bar wording
 * @property {string} citation  the in-repo citation — never empty
 * @property {string} [series]  the prefix series, for series-introduction milestones
 */
/**
 * @typedef {object} ArchiveSpan
 * @property {number} historyStartYear  earliest dated material the record reaches back to
 * @property {number} heldStartYear     first held publication — the scale-break boundary
 * @property {number} latestYear        the newest held publication's year
 * @property {string} latestLabel       humanised newest-held date (shared with the dated-fact chip)
 * @property {number} count             publications held (shared with the dated-fact chip)
 * @property {HoldingPublication[]} [publications]  the down-markers; absent on the grounded no-JS baseline
 * @property {HoldingMilestone[]} [milestones]      the up-markers; absent on the grounded no-JS baseline
 * @property {string} [rotationSeed]    build-stable seed for the milestone rotation (never Math.random)
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

// The build-derived holdings manifest (src/ci/build-home-holdings.ts), as fetched
// at runtime. Root-served (`holdings.json`) so the v1 surface stays self-
// contained.
/**
 * @typedef {object} HomeHoldings
 * @property {number} count
 * @property {number | null} heldStartYear
 * @property {number | null} latestYear
 * @property {string | null} latestDateIso
 * @property {HoldingPublication[]} publications
 * @property {HoldingMilestone[]} milestones
 */

const HUMAN_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// "23 June 2026" from an ISO date; null for anything that is not a full date, so
// a month-only value never implies a day.
/** @param {string | null} iso @returns {string | null} */
export function humaniseIsoDate(iso) {
  if (iso === null) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (m === null) return null;
  const month = HUMAN_MONTHS[Number(m[2]) - 1];
  return month === undefined ? null : `${Number(m[3])} ${month} ${m[1]}`;
}

// Fold the build-derived holdings manifest into a home model: the span dial's
// figures and its bi-temporal marks become derived (retiring the hand-authored
// count / span / newest-date for the enhanced render), while the figures the
// manifest does not carry — the 1903 history horizon and the latest-register
// callsign total — stay the report-cited constants of the base model. The
// grounded base model remains the honest no-JS baseline; this is the progressive
// enhancement layered over it once the manifest arrives.
/** @param {HomeModel} base @param {HomeHoldings} holdings @returns {HomeModel} */
export function enhanceHomeModel(base, holdings) {
  const heldStartYear = holdings.heldStartYear ?? base.span.heldStartYear;
  const latestYear = holdings.latestYear ?? base.span.latestYear;
  const latestLabel = humaniseIsoDate(holdings.latestDateIso) ?? base.span.latestLabel;
  return {
    ...base,
    facts: { date: latestLabel, count: holdings.count },
    span: {
      ...base.span,
      count: holdings.count,
      heldStartYear,
      latestYear,
      latestLabel,
      publications: holdings.publications,
      milestones: holdings.milestones,
      rotationSeed: holdings.latestDateIso ?? String(latestYear),
    },
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
 * @property {PipGeometry[]} pips         the down-markers, positioned within the held run
 * @property {MilestoneGeometry[]} milestones  the up-markers, positioned within their segment
 */
/**
 * @typedef {object} PipGeometry
 * @property {number} leftPct  position within the held segment, percent
 * @property {string} vintage
 * @property {string} kind
 * @property {string} letter
 * @property {string} title
 * @property {number} rows
 * @property {boolean} latest
 */
/**
 * @typedef {object} MilestoneGeometry
 * @property {'history' | 'held'} seg  the segment the mark sits in
 * @property {number} leftPct   the label/point position within that segment, percent
 * @property {number} startLeft  the range's left edge within that segment, percent
 * @property {number} endLeft    the range's right edge within that segment, percent
 * @property {boolean} range
 * @property {string} start
 * @property {string} end
 * @property {string} label
 * @property {string} citation
 * @property {string} [series]
 */

/** @param {number} value @param {number} lo @param {number} hi */
const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));

// The fractional-year position of an ISO year / month / day ('2018-10' ->
// 2018.75). Month and day move the value within the year so a mark sits at its
// real vintage, not merely its year column. NaN for an unparseable value, so a
// bad vintage cannot silently position at year zero.
/** @param {string} iso @returns {number} */
export function fractionalYearOf(iso) {
  const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/.exec(iso);
  if (m === null) return Number.NaN;
  const year = Number(m[1]);
  const month = m[2] !== undefined ? Number(m[2]) : 1;
  const day = m[3] !== undefined ? Number(m[3]) : 1;
  return year + (month - 1) / 12 + (day - 1) / 372;
}

// The initial focused milestone for the paginated caption: a DETERMINISTIC
// rotation seeded from a build-stable value (never Math.random at render, so a
// rebuild — not a page view — moves the selection). Always a valid index.
/** @param {number} count @param {string} seed @returns {number} */
export function milestoneRotationStart(count, seed) {
  if (count <= 0) return 0;
  let sum = 0;
  for (const ch of String(seed)) sum = (sum + ch.charCodeAt(0)) % 100000;
  return sum % count;
}

/** @param {ArchiveSpan} span @returns {SpanDialGeometry} */
export function spanDialGeometry(span) {
  const { historyStartYear, heldStartYear, latestYear, count } = span;
  const heldFinite = Number.isFinite(heldStartYear) && Number.isFinite(latestYear);
  // Corrupt input: dated, but the held run ends before it starts. This is a data
  // error, not the legitimate empty-archive state (count <= 0) — so fail loud
  // rather than render:false, which would silently read as "nothing held".
  if (heldFinite && latestYear < heldStartYear) {
    throw new RangeError(`spanDialGeometry: held run ends (${latestYear}) before it starts (${heldStartYear}) — corrupt span dates`);
  }
  const validHeld = heldFinite;
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

  // The bi-temporal marks (issue #921). Publications position within the held
  // run (assertion time, drawn DOWN); milestones position within whichever
  // segment contains them (event time, drawn UP). A collapsed single-year run
  // reads every mark at the sole reading rather than dividing by zero.
  const heldSpan = latestYear - heldStartYear;
  const histSpan = heldStartYear - historyStartYear;
  /** @param {number} f */
  const posInHeld = (f) => clamp(heldSpan > 0 ? ((f - heldStartYear) / heldSpan) * 100 : 100, 0, 100);
  /** @param {number} f */
  const posInHist = (f) => clamp(histSpan > 0 ? ((f - historyStartYear) / histSpan) * 100 : 0, 0, 100);

  /** @type {PipGeometry[]} */
  const pips = render
    ? (span.publications ?? [])
        .filter(p => Number.isFinite(fractionalYearOf(p.vintage)))
        .map(p => ({
          leftPct: posInHeld(fractionalYearOf(p.vintage)),
          vintage: p.vintage, kind: p.kind, letter: p.letter, title: p.title, rows: p.rows, latest: p.latest === true,
        }))
    : [];

  /** @type {MilestoneGeometry[]} */
  const milestones = render
    ? (span.milestones ?? [])
        .filter(m => Number.isFinite(fractionalYearOf(m.start)) && Number.isFinite(fractionalYearOf(m.end)))
        .map(m => {
          const fStart = fractionalYearOf(m.start);
          const fEnd = fractionalYearOf(m.end);
          const mid = (fStart + fEnd) / 2;
          const seg = showHistory && mid < heldStartYear ? 'history' : 'held';
          const pos = seg === 'history' ? posInHist : posInHeld;
          const startLeft = pos(Math.min(fStart, fEnd));
          const endLeft = pos(Math.max(fStart, fEnd));
          return {
            seg, leftPct: (startLeft + endLeft) / 2, startLeft, endLeft,
            range: m.range === true, start: m.start, end: m.end, label: m.label, citation: m.citation, series: m.series,
          };
        })
    : [];

  return { render, showHistory, heldDivisions, needleLeft, count, historyStartYear, heldStartYear, latestYear, pips, milestones };
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

  // The bi-temporal marks are drawn only when the build-derived holdings
  // manifest has been consumed (the enhanced model); the grounded no-JS baseline
  // carries the axis, count and needle plus an honest note that the marks appear
  // with the script.
  const enhanced = geo.pips.length > 0 || geo.milestones.length > 0;

  const dial = el('div', enhanced ? 'spandial enhanced' : 'spandial');
  dial.setAttribute('role', 'img');
  // The reading, in the aria-label: the base summary, plus the marks named as a
  // count over the run and the milestones listed, so nothing the marks show is
  // conveyed by colour or position alone.
  let aria = fillTemplate(geo.showHistory ? S.ariaWithHistory : S.ariaHeldOnly, vals);
  if (geo.pips.length > 0) {
    aria += fillTemplate(S.ariaPublicationsClause, { count: geo.pips.length, heldStart: geo.heldStartYear, latest: geo.latestYear });
  }
  if (geo.milestones.length > 0) {
    aria += fillTemplate(S.ariaMilestonesClause, { list: geo.milestones.map(m => m.label).join(', ') });
  }
  dial.setAttribute('aria-label', aria);

  // Header: label + the visible range it covers.
  const head = el('div', 'sd-head');
  head.appendChild(el('span', 'sd-lbl', S.label));
  const rangeStart = geo.showHistory ? geo.historyStartYear : geo.heldStartYear;
  head.appendChild(el('span', 'sd-range', `${rangeStart} — ${geo.latestYear}`));
  dial.appendChild(head);

  // The milestone marks, built up front so the caption's pagination can toggle
  // their focus state. Parallel to geo.milestones by index.
  /** @type {HTMLElement[]} */
  const milestoneMarks = geo.milestones.map((m) => {
    const mark = el('span', m.range ? 'sd-up range' : 'sd-up');
    if (m.range) {
      mark.style.left = `${m.startLeft}%`;
      mark.style.width = `${Math.max(0, m.endLeft - m.startLeft)}%`;
    } else {
      mark.style.left = `${m.leftPct}%`;
    }
    mark.appendChild(el('span', 'sd-up-stem'));
    mark.appendChild(el('span', 'sd-up-head'));
    return mark;
  });

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
    // Any milestone whose event falls in the earlier-history segment.
    geo.milestones.forEach((m, i) => { if (m.seg === 'history') hist.appendChild(milestoneMarks[i]); });
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

  // Up-markers (event time) that fall in the held run.
  geo.milestones.forEach((m, i) => { if (m.seg === 'held') held.appendChild(milestoneMarks[i]); });

  // Down-markers (assertion time): one kind-tinted, lettered mark per held
  // publication at its vintage, the single newest register snapshot ringed. The
  // mark's kind rides a data attribute (the tint) AND its letter (never colour
  // alone); the hover title and the text-parity fold below carry the detail.
  if (geo.pips.length > 0) {
    const downs = el('div', 'sd-downs');
    for (const pip of geo.pips) {
      const line = fillTemplate(pip.rows > 0 ? S.publicationLine : S.publicationLineNoRows, {
        title: pip.title, vintage: pip.vintage, rows: pip.rows.toLocaleString('en-GB'),
      });
      const mark = el('span', pip.latest ? 'sd-pip latest' : 'sd-pip', pip.letter);
      mark.style.left = `${pip.leftPct}%`;
      mark.setAttribute('data-kind', pip.kind);
      mark.setAttribute('title', pip.latest ? `${line} · ${S.latestMarkLabel}` : line);
      downs.appendChild(mark);
    }
    held.appendChild(downs);
  }

  scale.appendChild(held);
  dial.appendChild(scale);

  // The milestone caption + its pagination (overwhelm control): a small,
  // deterministically-rotated selection is captioned at once, prev/next cycling
  // the full cited set with no viewport movement. Built before the foot so the
  // whole up-marker story sits together beneath the axis.
  if (geo.milestones.length > 0) mountMilestoneCaption(dial, geo.milestones, milestoneMarks, span.rotationSeed ?? String(geo.latestYear), S);

  // The kind legend: only the kinds actually present, letter + tint + plain
  // name, so the tint is never the sole cue. Decorative reinforcement of the
  // text-parity fold below, so hidden from assistive technology.
  if (geo.pips.length > 0) mountKindLegend(dial, geo.pips, S);

  // Text foot: the same facts in plain words, so nothing is conveyed by the
  // scale's colour or position alone. The reading ("as of <date>") leads and is
  // ALWAYS present here — the in-scale needle label that also carries it is
  // hidden at narrow widths, so the foot is the reading's text home on mobile.
  const foot = el('div', 'sd-foot');
  const readingItem = el('span');
  readingItem.append(`${S.footReading} `);
  readingItem.appendChild(el('b', null, span.latestLabel));
  foot.appendChild(readingItem);
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
  // Milestone count, in the text foot, so the up-marks are never position-only.
  if (geo.milestones.length > 0) {
    const mileItem = el('span');
    mileItem.appendChild(el('b', null, String(geo.milestones.length)));
    mileItem.append(` ${S.milestonesLabel}`);
    foot.appendChild(mileItem);
  }
  dial.appendChild(foot);

  // Text parity for the down-markers: the full held list behind a fold, so the
  // marks' kind/title/vintage/row-count are never conveyed by colour or position
  // alone — and the keyboard/AT reader reaches every publication without tabbing
  // 65 individual marks.
  if (geo.pips.length > 0) {
    const fold = el('details', 'sd-holdlist');
    fold.appendChild(el('summary', null, fillTemplate(S.allPublicationsSummary, { count: geo.pips.length })));
    const list = el('ul');
    for (const pip of geo.pips) {
      const kindName = /** @type {Record<string, string>} */ (S.kindLabels)[pip.kind] ?? pip.letter;
      const line = fillTemplate(pip.rows > 0 ? S.publicationLine : S.publicationLineNoRows, {
        title: pip.title, vintage: pip.vintage, rows: pip.rows.toLocaleString('en-GB'),
      });
      const li = el('li');
      li.append(`${kindName}: ${line}`);
      if (pip.latest) li.append(` · ${S.latestMarkLabel}`);
      list.appendChild(li);
    }
    fold.appendChild(list);
    dial.appendChild(fold);
  }

  // The honest no-JS / no-manifest note: shown only when the individual marks
  // are not drawn, so the static baseline never implies marks that are absent.
  if (!enhanced) dial.appendChild(el('div', 'sd-note', S.enhanceNote));

  host.appendChild(dial);
}

// The milestone caption + pagination. The focused milestone is chosen by a
// deterministic build-seeded rotation (never Math.random), and prev/next cycle
// the full set — state-only, no viewport movement, an aria-live region so the
// change is announced. Each caption carries the milestone's own citation behind
// a "source" fold, so a milestone can never read as an uncited claim.
/**
 * @param {HTMLElement} dial
 * @param {MilestoneGeometry[]} milestones
 * @param {HTMLElement[]} marks
 * @param {string} seed
 * @param {typeof V1_COPY.home.span} S
 */
function mountMilestoneCaption(dial, milestones, marks, seed, S) {
  const wrap = el('div', 'sd-milecap');
  const bar = el('div', 'sd-mile-bar');
  bar.appendChild(el('span', 'sd-mile-lbl', S.milestonesLabel));
  const pos = el('span', 'sd-mile-pos');
  bar.appendChild(pos);
  const nav = el('div', 'sd-mile-nav');
  const prev = el('button', 'sd-mile-btn', '‹');
  prev.setAttribute('type', 'button');
  prev.setAttribute('aria-label', S.milestonePrev);
  const next = el('button', 'sd-mile-btn', '›');
  next.setAttribute('type', 'button');
  next.setAttribute('aria-label', S.milestoneNext);
  nav.appendChild(prev);
  nav.appendChild(next);
  bar.appendChild(nav);
  wrap.appendChild(bar);

  const body = el('div', 'sd-mile-body');
  body.setAttribute('aria-live', 'polite');
  wrap.appendChild(body);

  let focused = milestoneRotationStart(milestones.length, seed);
  const paint = () => {
    const m = milestones[focused];
    pos.textContent = fillTemplate(S.milestonePosition, { i: focused + 1, n: milestones.length });
    marks.forEach((mark, i) => mark.classList.toggle('focus', i === focused));
    body.textContent = '';
    body.appendChild(el('div', 'sd-mile-when', m.range ? `${m.start} – ${m.end}` : m.start));
    body.appendChild(el('div', 'sd-mile-what', m.label));
    if (m.citation !== '') {
      const src = el('details', 'sd-mile-src');
      src.appendChild(el('summary', null, S.milestoneSourceLabel));
      src.appendChild(el('p', null, m.citation));
      body.appendChild(src);
    }
  };
  const step = (/** @type {number} */ delta) => { focused = (focused + delta + milestones.length) % milestones.length; paint(); };
  prev.addEventListener('click', () => step(-1));
  next.addEventListener('click', () => step(1));
  paint();

  dial.appendChild(wrap);
}

// The kind legend: one chip per kind PRESENT among the marks, in first-seen
// order, carrying the kind letter, its tint and its plain-English name. Hidden
// from assistive technology — the text-parity fold names each publication's kind
// in words — so the tint is reinforcement, never the sole cue.
/**
 * @param {HTMLElement} dial
 * @param {PipGeometry[]} pips
 * @param {typeof V1_COPY.home.span} S
 */
function mountKindLegend(dial, pips, S) {
  const seen = new Set();
  const legend = el('div', 'sd-legend');
  legend.setAttribute('aria-hidden', 'true');
  for (const pip of pips) {
    if (seen.has(pip.kind)) continue;
    seen.add(pip.kind);
    const item = el('span', 'sd-legend-item');
    const chip = el('span', 'sd-legend-chip', pip.letter);
    chip.setAttribute('data-kind', pip.kind);
    item.appendChild(chip);
    item.appendChild(el('span', null, /** @type {Record<string, string>} */ (S.kindLabels)[pip.kind] ?? pip.letter));
    legend.appendChild(item);
  }
  dial.appendChild(legend);
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
