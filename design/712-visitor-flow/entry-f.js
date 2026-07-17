// Shared enhancement for the issue #712 COMPOSITE family (candidates F1–F4).
//
// The four variants explore different LAYOUTS of the same composed element set,
// so they share one wiring module: the search box, the derived-figure stamps,
// the returning-visitor "jump back" chips, the publication timeline, the
// rotating surprise card and the role tabs. Every variant uses the same element
// ids and hooks, so this file drives them all unchanged.
//
// Progressive enhancement: each variant is usable with this file absent — the
// search box is a plain form that submits to the real instant per-callsign page
// (callsign.html?c=, the #594 path), the timeline degrades to a static caption,
// the surprise card shows its first fact as plain HTML, and the tab panels are
// all present in the markup. This file only ADDS type-ahead, figure stamping,
// the timeline dots, surprise rotation and single-panel tab behaviour.

import { attachSearch, stampFigures, renderRecents, PUBLICATIONS, RECORD, HOLDINGS, KIND_LETTER, KIND_LABEL } from './entry-common.js';

const RECENTS_FALLBACK = ['M7TEE', '2E0AAA', 'GB2RS'];

/** Wire every composite element present on the page. Missing hooks are skipped,
 *  so a variant that omits a block simply gets no wiring for it. */
export function initComposite() {
  stampFigures();

  const form = document.getElementById('search-form');
  attachSearch(form, document.getElementById('search-input'), document.getElementById('suggest'));

  renderRecents(document.getElementById('jumpback'), { fallback: RECENTS_FALLBACK });

  renderTimeline();
  renderHoldingsMap();
  renderSurprises();
  wireTabs();
}

/** Render the corpus-wide HOLDINGS MAP (the lettered-cell grid from the built
 *  site's publisher pages, adapted here to the whole ~65-dataset corpus): one
 *  cell per dataset, lettered and tinted by kind, stacked newest vintage year
 *  first, each cell a genuine deep-link to that dataset's own page. Reuses the
 *  production component's markup and class names (see src/ci/build-publisher-
 *  pages.ts). Skipped when the grid hook is absent, so variants without the map
 *  are unaffected; degrades to the static lead + browse-all link with JS off. */
function renderHoldingsMap() {
  const grid = document.getElementById('hold-grid');
  if (!grid) return;

  const dated = HOLDINGS.filter((h) => typeof h.vintage === 'string');
  const yearOf = (h) => Number(h.vintage.slice(0, 4));
  // The single newest register snapshot keeps the removed timeline's "latest
  // snapshot" signal — a quiet accent ring on its cell.
  const latestKey = HOLDINGS
    .filter((h) => h.kind === 'register-snapshot')
    .reduce((a, b) => (a && a.vintage > b.vintage ? a : b), null)?.key;

  const cell = (h) => {
    const label = KIND_LABEL[h.kind] ?? h.kind;
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.className = 'hold-cell' + (h.key === latestKey ? ' hold-cell--latest' : '');
    a.dataset.kind = h.kind;
    a.href = h.href;
    a.setAttribute('aria-label', `${label}: ${h.title}`);
    a.innerHTML = `<span aria-hidden="true">${KIND_LETTER[h.kind] ?? h.kind.charAt(0).toUpperCase()}</span>`;
    li.appendChild(a);
    return li;
  };

  const years = dated.map(yearOf);
  const minYear = Math.min(...years);
  const maxYear = Math.max(...years);
  // Continuous axis, newest year first; an empty year renders as a visible gap.
  for (let year = maxYear; year >= minYear; year--) {
    const inYear = dated
      .filter((h) => yearOf(h) === year)
      .sort((a, b) => b.vintage.localeCompare(a.vintage) || a.key.localeCompare(b.key));
    const row = document.createElement('li');
    row.className = 'hold-map-yr' + (inYear.length === 0 ? ' hold-map-yr--empty' : '');
    const lab = document.createElement('span');
    lab.className = 'hold-map-yrlab';
    lab.textContent = String(year);
    const cells = document.createElement('ul');
    cells.className = 'hold-map-cells';
    inYear.forEach((h) => cells.appendChild(cell(h)));
    row.append(lab, cells);
    grid.appendChild(row);
  }

  // The keyboard skip affordance is only worth showing once the grid actually
  // holds its tab stops; name the real count so the promise is concrete.
  const skip = document.getElementById('hold-skip');
  if (skip) {
    skip.textContent = `Skip the holdings map (${HOLDINGS.length} datasets)`;
    skip.hidden = false;
  }
  // With the grid populated, the static browse-all fallback is redundant chrome;
  // JS-on visitors get the live map, so retire it.
  const fallback = document.getElementById('hold-fallback');
  if (fallback) fallback.hidden = true;
}

/** Render the archived publications along a shared time axis (candidate C).
 *  Assertion-time here is the publication date each archived dataset carries. */
function renderTimeline() {
  const line = document.getElementById('f-line');
  if (!line) return;
  const readout = document.getElementById('f-readout');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const times = PUBLICATIONS.map((d) => new Date(d + 'T00:00:00Z').getTime());
  const min = Math.min(...times);
  const max = Math.max(...times);
  const pct = (t) => ((t - min) / (max - min)) * 100;

  PUBLICATIONS.forEach((d, i) => {
    const [y, m, day] = d.split('-');
    const el = document.createElement('a');
    el.className = 'f-pub' + (i === PUBLICATIONS.length - 1 ? ' latest' : '');
    el.style.left = pct(times[i]) + '%';
    el.href = 'datasets/index.html';
    const human = `${Number(day)} ${months[Number(m) - 1]} ${y}`;
    el.title = human;
    el.setAttribute('aria-label', `Publication ${human}`);
    el.innerHTML = '<i></i>';
    if (readout) {
      el.addEventListener('mouseenter', () => { readout.textContent = human; });
      el.addEventListener('focus', () => { readout.textContent = human; });
    }
    line.appendChild(el);
  });

  for (let y = 2013; y <= 2026; y++) {
    const t = new Date(`${y}-01-01T00:00:00Z`).getTime();
    if (t < min || t > max) continue;
    const tick = document.createElement('div');
    tick.className = 'f-yeartick';
    tick.style.left = pct(t) + '%';
    line.appendChild(tick);
    const lab = document.createElement('div');
    lab.className = 'f-year';
    lab.style.left = pct(t) + '%';
    lab.textContent = "'" + String(y).slice(2);
    line.appendChild(lab);
  }
}

/** The rotating deck of real, dated surprises (candidate D). */
function renderSurprises() {
  const kicker = document.getElementById('s-kicker');
  if (!kicker) return;
  const title = document.getElementById('s-title');
  const body = document.getElementById('s-body');
  const link = document.getElementById('s-link');
  const another = document.getElementById('s-another');

  const surprises = [
    { kicker: 'reserved, never issued', title: 'The M2 prefix has never been issued',
      body: 'It appears in the register only as reserved — a whole prefix series held back, never allocated to a licensee.',
      href: 'series/index.html' },
    { kicker: 'the shape of the record', title: `${RECORD.callsigns.toLocaleString('en-GB')} callsigns, ${RECORD.datasets} publications`,
      body: 'Thirteen years of Ofcom’s register, folded together so any callsign can be traced across every archived snapshot.',
      href: 'statistics.html' },
    { kicker: 'forbidden by design', title: 'Over 1,400 suffixes Ofcom will not allocate',
      body: 'Some three-letter endings are off-limits — offensive, confusing, or reserved. The set is tracked as it changes over time.',
      href: 'forbidden/index.html' },
    { kicker: 'try a suffix', title: 'Which series is a suffix still free in?',
      body: 'Type a suffix like *TEE to see which prefix series carry it and which leave it open — a quick way to sanity-check a wanted callsign.',
      href: 'callsign.html?c=*TEE' },
    { kicker: 'the long view', title: 'The earliest snapshot dates to August 2013',
      body: `The most recent lands on ${new Date(RECORD.latestSnapshot).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })} — the register captured again and again in between.`,
      href: 'datasets/index.html' },
  ];

  let idx = 0;
  function show(i) {
    const s = surprises[i];
    kicker.textContent = s.kicker;
    title.textContent = s.title;
    body.textContent = s.body;
    link.href = s.href;
  }
  show(0);
  if (another) {
    another.addEventListener('click', () => { idx = (idx + 1) % surprises.length; show(idx); });
  }
}

/** Accessible role tabs: roving tabindex, arrow-key navigation (candidate E). */
function wireTabs() {
  const tabs = [...document.querySelectorAll('.f-tab')];
  if (!tabs.length) return;
  function select(tab) {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
    }
  }
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => select(tab));
    tab.addEventListener('keydown', (e) => {
      let next;
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      } else if (e.key === 'Home') {
        next = tabs[0];
      } else if (e.key === 'End') {
        next = tabs[tabs.length - 1];
      }
      if (next) {
        e.preventDefault();
        select(next);
        next.focus();
      }
    });
  });
}
