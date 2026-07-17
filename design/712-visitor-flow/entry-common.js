// Shared prototype logic for the issue #712 entry-flow candidates.
//
// This is MOCKUP scaffolding, not production code: it powers the candidate
// front-doors that layer over the real built site so the visitor-flow
// hypotheses can be seen and compared. Every candidate wires its search box to
// the REAL instant per-callsign page (callsign.html?c=, the #594 path), so a
// submit is a genuine instant answer, not a faked one. The suggestion index is
// a small curated sample purely so type-ahead can be demonstrated offline; the
// live site's own lookup queries the full range-served database.
//
// Progressive enhancement: the candidates are usable with this file absent —
// the search box is a plain form that submits to the real lookup, and the
// orientation content is static HTML. This file only ADDS the type-ahead, the
// headline-figure stamping and the returning-visitor "jump back" affordances.

// Headline shape of the record, as derived figures. Epistemics: these are
// DERIVED aggregates, dated to the build they were read from, never presented
// as live truth. A real deployment would stamp these at build time; here they
// are the figures read from the 16 July 2026 build's shard manifest.
export const RECORD = {
  callsigns: 180090,
  datasets: 65,
  earliestYear: 2013,
  latestSnapshot: '2026-06-23',
  derivedAt: '2026-07-16',
};

// The archived open-data publication dates (a genuine subset of the record —
// the open-data lane), oldest first, for the timeline front-door candidate.
export const PUBLICATIONS = [
  '2013-08-28', '2013-09-06', '2014-03-14', '2014-08-18', '2015-02-25',
  '2015-04-16', '2015-06-11', '2015-10-13', '2016-01-21', '2016-06-29',
  '2016-09-20', '2017-04-24', '2017-07-03', '2017-07-13', '2019-08-12',
  '2019-09-12', '2020-03-26', '2020-04-23', '2020-10-23', '2021-01-29',
  '2021-04-21', '2022-03-07', '2022-03-14', '2022-05-30', '2023-01-25',
  '2023-02-20', '2023-08-18', '2023-11-24', '2023-12-07', '2024-04-30',
  '2024-07-22', '2024-10-21', '2025-03-13', '2025-04-08', '2025-05-27',
  '2025-06-04', '2025-06-08', '2025-09-11', '2025-11-11', '2026-01-14',
  '2026-06-23',
];

// A small curated sample of real callsigns and suffixes, each with a plain hint,
// so type-ahead can be shown without the full database. On selection every one
// resolves through the real instant page.
export const SUGGESTIONS = [
  { q: 'M7TEE', hint: 'Foundation · M7 series' },
  { q: 'M0AAA', hint: 'Full · M0 series' },
  { q: '2E0AAA', hint: 'Intermediate · 2E0 series' },
  { q: 'G0ABC', hint: 'Full · G0 series' },
  { q: 'MW0XYZ', hint: 'Full · Welsh regional' },
  { q: 'GM4ABC', hint: 'Full · Scottish regional' },
  { q: 'GB2RS', hint: 'Special event / news service' },
  { q: 'M3AAA', hint: 'Foundation · legacy M3 series' },
  { q: '2W0ABC', hint: 'Intermediate · Welsh regional' },
  { q: 'MI0AAA', hint: 'Full · Northern Ireland' },
  { q: '*TEE', hint: 'Suffix — which series is *TEE free in?' },
  { q: '*XYZ', hint: 'Suffix search across all series' },
  { q: 'M#7TEE', hint: 'Placeholder form — optional RSL slot' },
];

const RECENTS_KEY = 'entry712.recents';

/** @returns {string[]} the visitor's recently viewed callsigns, newest first. */
export function readRecents() {
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Record a callsign as recently viewed (deduped, capped, newest first). */
export function pushRecent(callsign) {
  const clean = cleanQuery(callsign);
  if (!clean) return;
  try {
    const next = [clean, ...readRecents().filter((c) => c !== clean)].slice(0, 8);
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable (private mode, disabled) — the affordance simply
    // does not persist; nothing else depends on it.
  }
}

/** Clean a typed query to the canonical-ish form the lookup expects. */
export function cleanQuery(value) {
  return String(value ?? '').trim().toUpperCase().replace(/[^A-Z0-9/*#]/g, '');
}

/** The real destination for a query: the instant per-callsign page (#594). */
export function destinationFor(value) {
  return `callsign.html?c=${encodeURIComponent(cleanQuery(value))}`;
}

function humaniseDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];
  return `${d} ${months[m - 1]} ${y}`;
}

/** Stamp any element carrying a data-figure attribute with its derived value. */
export function stampFigures(root = document) {
  const fmt = new Intl.NumberFormat('en-GB');
  for (const el of root.querySelectorAll('[data-figure]')) {
    const key = el.getAttribute('data-figure');
    if (key === 'callsigns') el.textContent = fmt.format(RECORD.callsigns);
    else if (key === 'datasets') el.textContent = String(RECORD.datasets);
    else if (key === 'span') el.textContent = `${RECORD.earliestYear}–${new Date(RECORD.latestSnapshot).getFullYear()}`;
    else if (key === 'latest') el.textContent = humaniseDate(RECORD.latestSnapshot);
    else if (key === 'derivedAt') el.textContent = humaniseDate(RECORD.derivedAt);
  }
}

/**
 * Wire a search box: type-ahead suggestions, keyboard navigation and submit.
 * The listbox follows the WAI-ARIA combobox pattern enough to be usable by
 * keyboard and screen reader; on submit or selection it navigates to the real
 * instant page.
 */
export function attachSearch(form, input, list) {
  if (!form || !input || !list) return;
  let items = [];
  let active = -1;

  function close() {
    list.innerHTML = '';
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    active = -1;
  }

  function render(matches) {
    items = matches;
    active = -1;
    if (!matches.length) { close(); return; }
    list.innerHTML = '';
    matches.forEach((m, i) => {
      const li = document.createElement('li');
      li.id = `sug-${i}`;
      li.setAttribute('role', 'option');
      li.className = 'sug';
      li.innerHTML = `<span class="sug-q">${m.q}</span><span class="sug-hint">${m.hint}</span>`;
      li.addEventListener('mousedown', (e) => { e.preventDefault(); go(m.q); });
      list.appendChild(li);
    });
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }

  function match(value) {
    const v = cleanQuery(value);
    if (!v) return render(SUGGESTIONS.slice(0, 6));
    return render(SUGGESTIONS.filter((s) => cleanQuery(s.q).includes(v)).slice(0, 6));
  }

  function highlight() {
    for (const [i, li] of [...list.children].entries()) {
      li.setAttribute('aria-selected', i === active ? 'true' : 'false');
    }
    input.setAttribute('aria-activedescendant', active >= 0 ? `sug-${active}` : '');
  }

  function go(value) {
    const clean = cleanQuery(value);
    if (!clean) return;
    pushRecent(clean);
    window.location.href = destinationFor(clean);
  }

  input.addEventListener('input', () => match(input.value));
  input.addEventListener('focus', () => { if (input.value) match(input.value); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(active + 1, items.length - 1); highlight(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(active - 1, -1); highlight(); }
    else if (e.key === 'Escape') { close(); }
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (active >= 0 && items[active]) go(items[active].q);
    else go(input.value);
  });
  document.addEventListener('click', (e) => { if (!form.contains(e.target)) close(); });
}

/** Render the returning-visitor "jump back" chips into a container. */
export function renderRecents(container, opts = {}) {
  if (!container) return;
  const recents = readRecents();
  const list = recents.length ? recents : (opts.fallback || []);
  const isExample = recents.length === 0 && list.length > 0;
  if (!list.length) { container.hidden = true; return; }
  container.hidden = false;
  const label = isExample
    ? '<span class="jb-note">example — your recent lookups appear here</span>'
    : '';
  container.innerHTML =
    `<span class="jb-label">Jump back to</span>` +
    list.map((c) => `<a class="jb-chip" href="${destinationFor(c)}">${c}</a>`).join('') +
    label;
}
