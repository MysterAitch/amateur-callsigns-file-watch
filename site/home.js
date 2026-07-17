// @ts-check
// Front-door enhancement for the home page (issue #712).
//
// Progressive enhancement only. With this module absent the home page is fully
// usable: the search box is the plain lookup form app.js drives, the holdings
// map and headline figures are static HTML pre-rendered at deploy time
// (src/ci/build-front-door.ts), the first surprise fact is in the markup, the
// role-tab panels are all present, and the "jump back" chips are simply hidden.
// This file layers on top: the search box's type-ahead, the surprise-card
// rotation, the holdings-map hover/focus readout, single-panel tab behaviour,
// the returning-visitor chips, and smooth in-page jumps.
//
// Navigation model: the search box runs the lookup IN PAGE (app.js renders the
// result below it), so the type-ahead is FILL-THEN-SUBMIT — selecting a
// suggestion fills the box and submits the existing lookup form, it never
// navigates away. This preserves the page's own lookup, filters and
// whole-register browsing, which only work in place.

const RECENTS_KEY = 'home.recents';
const RECENTS_FALLBACK = ['M7TEE', '2E0AAA', 'GB2RS'];

// Clean a typed query to the canonical-ish form the lookup expects: upper-cased,
// stripped to the characters a callsign, suffix or placeholder form can carry.
/** @param {string | null | undefined} value @returns {string} */
export function cleanQuery(value) {
  return (value ?? '').trim().toUpperCase().replace(/[^A-Z0-9/*#]/g, '');
}

/** @returns {string[]} the visitor's recent lookups, newest first. */
export function readRecents() {
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY);
    /** @type {unknown} */
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
  } catch { return []; }
}

// Record a looked-up value (deduped, capped, newest first). A wildcard/filter
// expression is not a callsign to resume, so it is not recorded.
/** @param {string} value @returns {string[]} the updated list */
export function pushRecent(value) {
  const clean = cleanQuery(value);
  if (clean === '' || clean.includes('*')) return readRecents();
  const next = [clean, ...readRecents().filter((c) => c !== clean)].slice(0, 8);
  try { window.localStorage.setItem(RECENTS_KEY, JSON.stringify(next)); }
  catch { /* storage unavailable (private mode) — the affordance just won't persist */ }
  return next;
}

// The rotating deck of real, dated-domain surprises. Each is a stable fact about
// the record (not a live figure), so rotation never risks presenting a stale
// number as truth. Kept impersonal, each with a genuine destination.
export const SURPRISES = [
  { kicker: 'reserved, never issued', title: 'The M2 prefix has never been issued',
    body: 'It appears in the register only as reserved — a whole prefix series held back, never allocated to a licensee.',
    href: 'series/index.html' },
  { kicker: 'forbidden by design', title: 'Over 1,400 suffixes Ofcom will not allocate',
    body: 'Some three-letter endings are off-limits — offensive, confusing, or reserved. The withheld set is tracked as it changes over time.',
    href: 'forbidden/index.html' },
  { kicker: 'try a suffix', title: 'Which prefix series is a suffix still free in?',
    body: 'Type a suffix like *TEE to see which series carry it and which leave it open — a quick sanity-check on a wanted callsign.',
    href: '?c=*TEE' },
  { kicker: 'the long view', title: 'A decade of the register, folded together',
    body: 'Archived open-data publications and FOI disclosures back to 2013, so any callsign can be traced across every snapshot the mirror holds.',
    href: 'datasets/index.html' },
  { kicker: 'the shape of the record', title: 'Every dataset lettered and tinted by kind',
    body: 'Register snapshots, available-callsign pools, issuance events, forbidden lists and more — the holdings map above shows each one, newest first.',
    href: '#holdings' },
];

// The next index in the deck, wrapping. Pure so the rotation is unit-testable.
/** @param {number} current @param {number} length @returns {number} */
export function nextSurpriseIndex(current, length) {
  if (length <= 0) return 0;
  return (current + 1) % length;
}

// The readout line for a holdings-map cell, from its data-attributes:
// {kind · title · vintage · row count}. Row count is omitted when the dataset
// carries no tabular data, so the line never reads a hollow "0 rows".
/** @param {{ kindLabel?: string|null, title?: string|null, vintage?: string|null, rows?: string|null }} d @returns {string} */
export function readoutText(d) {
  const parts = [];
  if (d.kindLabel) parts.push(d.kindLabel);
  if (d.title) parts.push(d.title);
  if (d.vintage) parts.push(d.vintage);
  if (d.rows) parts.push(`${d.rows} rows`);
  return parts.join(' · ');
}

const READOUT_DEFAULT = 'Hover or focus a cell to read its dataset — kind, title, vintage and row count.';

// Wire the search box's type-ahead. FILL-THEN-SUBMIT: selecting a suggestion (by
// click or Enter) fills the box and submits the existing lookup form, so app.js
// renders the result in place — never a navigation. The listbox follows the
// WAI-ARIA combobox pattern (aria-expanded / aria-activedescendant / role
// option) so it is operable by keyboard and screen reader. `suggest` is
// injected (the app.js hook in production, a stub in tests); it returns [] when
// the database is not yet open, so the box degrades to the plain form.
/**
 * @param {HTMLFormElement} form
 * @param {HTMLInputElement} input
 * @param {HTMLElement} list
 * @param {(prefix: string) => Promise<string[]>} suggest
 */
export function attachSearch(form, input, list, suggest) {
  /** @type {string[]} */
  let items = [];
  let active = -1;
  let seq = 0;

  function close() {
    list.replaceChildren();
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    items = [];
    active = -1;
  }

  /** @param {string[]} matches */
  function render(matches) {
    items = matches;
    active = -1;
    if (matches.length === 0) { close(); return; }
    list.replaceChildren(...matches.map((m, i) => {
      const li = document.createElement('li');
      li.id = `sug-${i}`;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', 'false');
      li.className = 'sug';
      li.textContent = m;
      // mousedown (not click) so the selection lands before the input blurs.
      li.addEventListener('mousedown', (e) => { e.preventDefault(); choose(m, true); });
      return li;
    }));
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }

  function highlight() {
    [...list.children].forEach((li, i) => li.setAttribute('aria-selected', i === active ? 'true' : 'false'));
    if (active >= 0) input.setAttribute('aria-activedescendant', `sug-${active}`);
    else input.removeAttribute('aria-activedescendant');
  }

  // Fill the box with a chosen value; when `andSubmit`, run the lookup app.js
  // owns (requestSubmit dispatches the submit event its handler listens for).
  /** @param {string} value @param {boolean} andSubmit */
  function choose(value, andSubmit) {
    input.value = value;
    close();
    if (andSubmit && typeof form.requestSubmit === 'function') form.requestSubmit();
  }

  async function refresh() {
    const value = input.value;
    // A wildcard/filter expression is not a prefix to complete; leave it be.
    if (value.trim() === '' || value.includes('*')) { close(); return; }
    const mine = ++seq;
    /** @type {string[]} */
    let matches = [];
    try { matches = await suggest(value); } catch { matches = []; }
    if (mine !== seq) return; // a newer keystroke has superseded this lookup
    // Drop an exact-and-only echo of what is already typed — nothing to add.
    const cleaned = cleanQuery(value);
    matches = matches.filter((m) => cleanQuery(m) !== cleaned);
    render(matches.slice(0, 8));
  }

  input.addEventListener('input', () => { void refresh(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (items.length) { active = Math.min(active + 1, items.length - 1); highlight(); } }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (items.length) { active = Math.max(active - 1, 0); highlight(); } }
    else if (e.key === 'Escape') { if (!list.hidden) { e.preventDefault(); close(); } }
    else if (e.key === 'Enter') {
      // With a suggestion highlighted, adopt it before the native submit runs;
      // app.js's submit handler then reads the updated value. No preventDefault,
      // so the plain-form submit still happens for a typed-but-unlisted value.
      if (active >= 0 && items[active] !== undefined) { input.value = items[active]; close(); }
      else close();
    }
  });
  // Dismiss on an outside click (leaves tap-off space on touch by design).
  document.addEventListener('click', (e) => { if (!(e.target instanceof Node) || !form.contains(e.target)) close(); });
}

// Render the returning-visitor "jump back" chips. Recents resume as ?c= links
// (a click reloads the lookup for that callsign, the deep-link app.js reads); an
// example state shows before any lookup so the affordance is legible.
/** @param {HTMLElement} container */
export function renderRecents(container) {
  const recents = readRecents();
  const list = recents.length ? recents : RECENTS_FALLBACK;
  if (list.length === 0) { container.hidden = true; return; }
  container.hidden = false;
  const label = document.createElement('span');
  label.className = 'jb-label';
  label.textContent = 'Jump back to';
  const chips = list.map((c) => {
    const a = document.createElement('a');
    a.className = 'jb-chip';
    a.href = `?c=${encodeURIComponent(c)}`;
    a.textContent = c;
    return a;
  });
  container.replaceChildren(label, ...chips);
  if (recents.length === 0) {
    const note = document.createElement('span');
    note.className = 'jb-note';
    note.textContent = 'example — your recent lookups appear here';
    container.append(note);
  }
}

// Accessible role tabs: roving tabindex, arrow-key navigation, Home/End.
/** @param {HTMLElement[]} tabs */
export function wireTabs(tabs) {
  if (tabs.length === 0) return;
  /** @param {HTMLElement} tab */
  function select(tab) {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.tabIndex = on ? 0 : -1;
      const panel = document.getElementById(t.getAttribute('aria-controls') ?? '');
      if (panel) panel.hidden = !on;
    }
  }
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => select(tab));
    tab.addEventListener('keydown', (e) => {
      let next;
      if (e.key === 'ArrowRight') next = tabs[(i + 1) % tabs.length];
      else if (e.key === 'ArrowLeft') next = tabs[(i + tabs.length - 1) % tabs.length];
      else if (e.key === 'Home') next = tabs[0];
      else if (e.key === 'End') next = tabs[tabs.length - 1];
      if (next) { e.preventDefault(); select(next); next.focus(); }
    });
  });
}

// The surprise card: show the deck's facts, rotating on the "again" button.
function wireSurprises() {
  const kicker = document.getElementById('s-kicker');
  const title = document.getElementById('s-title');
  const body = document.getElementById('s-body');
  const link = /** @type {HTMLAnchorElement | null} */ (document.getElementById('s-link'));
  const another = document.getElementById('s-another');
  if (!kicker || !title || !body || !link) return;
  let idx = 0;
  /** @param {number} i */
  const show = (i) => {
    const s = SURPRISES[i];
    kicker.textContent = s.kicker;
    title.textContent = s.title;
    body.textContent = s.body;
    link.setAttribute('href', s.href);
  };
  show(0);
  another?.addEventListener('click', () => { idx = nextSurpriseIndex(idx, SURPRISES.length); show(idx); });
}

// The holdings-map readout: announce a cell's dataset on hover/focus, restore
// the default hint on leave/blur. Delegated so it covers every cell the
// build-time map rendered.
function wireHoldingsReadout() {
  const grid = document.getElementById('hold-grid');
  const readout = document.getElementById('hold-readout');
  if (!grid || !readout) return;
  /** @param {EventTarget | null} target */
  const cellOf = (target) => (target instanceof Element ? target.closest('.hold-cell') : null);
  const announce = (/** @type {Element | null} */ cell) => {
    if (!(cell instanceof HTMLElement)) return;
    readout.textContent = readoutText({
      kindLabel: cell.dataset.kindLabel, title: cell.dataset.title,
      vintage: cell.dataset.vintage, rows: cell.dataset.rows,
    });
  };
  const reset = () => { readout.textContent = READOUT_DEFAULT; };
  grid.addEventListener('mouseover', (e) => announce(cellOf(e.target)));
  grid.addEventListener('mouseout', reset);
  grid.addEventListener('focusin', (e) => announce(cellOf(e.target)));
  grid.addEventListener('focusout', reset);
}

// Smooth in-page jumps that also move focus to the destination, so keyboard and
// screen-reader users land where a sighted click would. Motion preference is
// respected. The search-box jump additionally focuses the input.
function wireJumps() {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  for (const a of document.querySelectorAll('a[href^="#"]')) {
    const anchor = /** @type {HTMLAnchorElement} */ (a);
    const id = anchor.getAttribute('href')?.slice(1) ?? '';
    if (id === '') continue;
    anchor.addEventListener('click', (e) => {
      const target = document.getElementById(id);
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: id === 'callsign' ? 'center' : 'start' });
      const focusTarget = id === 'callsign'
        ? /** @type {HTMLElement} */ (document.getElementById('callsign'))
        : target;
      focusTarget?.focus({ preventScroll: true });
    });
  }
}

export function initHome() {
  const form = /** @type {HTMLFormElement | null} */ (document.getElementById('lookup-form'));
  const input = /** @type {HTMLInputElement | null} */ (document.getElementById('callsign'));
  const list = document.getElementById('suggest');
  if (form && input && list) {
    // The suggestion source is app.js's hook (the real database); if it is not
    // yet published, the box simply offers nothing until it is.
    /** @type {(prefix: string) => Promise<string[]>} */
    const suggest = (prefix) => {
      const hook = /** @type {{ callsignSuggest?: (p: string) => Promise<string[]> }} */ (window).callsignSuggest;
      return hook ? hook(prefix) : Promise.resolve([]);
    };
    attachSearch(form, input, list, suggest);
    // Record every looked-up callsign so the jump-back chips can resume it. This
    // runs alongside app.js's own submit handler; recording after is harmless.
    form.addEventListener('submit', () => { pushRecent(input.value); });
  }

  const jumpback = document.getElementById('jumpback');
  if (jumpback) renderRecents(jumpback);

  wireTabs([...document.querySelectorAll('.home-tabs .tab')].map((t) => /** @type {HTMLElement} */ (t)));
  wireSurprises();
  wireHoldingsReadout();
  wireJumps();
}

if (typeof window !== 'undefined' && typeof document !== 'undefined' && document.getElementById('lookup-form')) {
  initHome();
}
