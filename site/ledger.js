// @ts-check
// Claim-ledger page (issue #361, Stage 3a): a callsign lookup that serves LIVE
// data end-to-end from the raw-keyed claim-ledger SQLite - raw bytes -> claims
// -> SQLite -> sql.js-httpvfs -> this page. There is no embedded data object:
// every value shown is a row queried from the shipped database over range
// requests. The query + shaping layer lives in ledger-query.js (DOM-free, so it
// is unit-tested against a built database); this module owns the DOM and the
// interaction.
//
// Scope, deliberately: the callsign lookup -> dossier + timeline view only. The
// both-engines playground, the vocabulary/normalisation demonstrations and the
// cross-source links are later sub-stages, flagged as such on the page.

import {
  openLedgerQuery,
  resolveEntity,
  entityClaims,
  observationsOf,
  foldObservations,
  anatomyOf,
  fidelityOf,
  reportIssueUrl,
  groupByYear,
} from './ledger-query.js';
import { withDatabaseLoading } from './db-loading.js';
import { statusField } from './field-wrappers.js';

/** @typedef {import('./ledger-query.js').ClaimRow} ClaimRow */
/** @typedef {import('./ledger-query.js').QueryExecutor} QueryExecutor */
/** @typedef {import('./ledger-query.js').ResolvedEntity} ResolvedEntity */
/** @typedef {import('./ledger-query.js').Observation} Observation */
/** @typedef {import('./ledger-query.js').TimelineEntry} TimelineEntry */
/** @typedef {import('./ledger-query.js').Segment} Segment */

// One event this module renders onto the shared vertical timeline (see
// renderTimeline below): either a folded status observation or a "seen in"
// source reference, both shaped down to the same display fields.
/**
 * @typedef {object} TimelineDisplayEntry
 * @property {Node} lead
 * @property {string} vintage
 * @property {string} dateText
 * @property {string} [datetime]
 * @property {string} [className]
 * @property {string} [dotClass]
 * @property {string} [preciseText]
 */

// One "where it was seen" source item, exactly as ledger-query.js's fidelityOf
// (via its internal sourceItems) shapes a SourceRef for display.
/**
 * @typedef {object} DisplaySource
 * @property {number} ordinal
 * @property {string} sourceFile
 * @property {string} label
 * @property {string} url
 * @property {string} vintage
 */

// The "show the working" model behind one derived value, exactly as
// ledger-query.js's fidelityOf shapes it: the rule that produced it, its plain
// gloss, the inputs it consumed, the reproduced result (verbatim only for a
// canonical-form divergence), and the source rows it was seen in.
/**
 * @typedef {object} Working
 * @property {string} rule
 * @property {string} ruleGloss
 * @property {{ role: string, value: string }[]} inputs
 * @property {string} result
 * @property {boolean} resultVerbatim
 * @property {DisplaySource[]} sources
 */

/**
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} t
 * @param {string | null} [c]
 * @param {string | null} [txt]
 * @returns {HTMLElementTagNameMap[K]}
 */
const el = (t, c, txt) => { const e = document.createElement(t); if (c) e.className = c; if (txt != null) e.textContent = txt; return e; };
// A bold node carrying safe text. Every database-derived value is written with
// textContent (never innerHTML), so a raw '<' or '&' that register data can
// carry is never interpreted as markup.
/** @param {unknown} txt */
const b = txt => el('b', null, String(txt));

// The ElementFactory shape the shared field wrappers (field-wrappers.js,
// issue #625) expect - attrs-object rather than this file's own positional
// (tag, className, text) `el` - so the wrappers render identically here as on
// every other front-end that already holds that shape (app.js/entry-browser.js).
/**
 * @param {string} tag
 * @param {Record<string, string>} [attrs]
 * @returns {HTMLElement}
 */
const elAttrs = (tag, attrs = {}) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') e.textContent = v;
    else e.setAttribute(k, v);
  }
  return e;
};

// Render an actual raw register token, surfacing any literal whitespace or
// non-breaking space it carries as a visible marker rather than an invisible
// gap - so the value is driven by the observation's own bytes.
/**
 * @template {ParentNode} T
 * @param {T} parent
 * @param {string} str
 * @returns {T}
 */
const appendRawToken = (parent, str) => {
  let run = '';
  const flush = () => { if (run) { parent.append(run); run = ''; } };
  for (const ch of str) {
    if (ch === ' ' || ch === ' ') { flush(); parent.append(el('span', 'nbsp', '␠')); }
    else run += ch;
  }
  flush();
  return parent;
};

// An external link that opens in a new tab and announces that to assistive
// tech, mirroring the generated pages' externalLink helper. Text is set with
// textContent, so a database-derived label can never smuggle markup.
/**
 * @param {string} href
 * @param {string} label
 * @returns {HTMLAnchorElement}
 */
const extLink = (href, label) => {
  const a = el('a', null, label);
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener';
  a.append(' ');
  const marker = el('span', 'ext-marker', '↗');
  marker.setAttribute('aria-hidden', 'true');
  a.appendChild(marker);
  a.appendChild(el('span', 'visually-hidden', ' (opens in a new tab)'));
  return a;
};

// A glossary deep-link for a term, in the shared gloss-term affordance idiom
// (dotted underline + aria-hidden "?" cue + visually-hidden accessible name),
// matching site-render.ts's glossaryTerm so the term reads and behaves the same
// wherever it appears.
/**
 * @param {string} anchor
 * @param {string} label
 * @param {string} accessibleName
 * @returns {HTMLAnchorElement}
 */
const glossTerm = (anchor, label, accessibleName) => {
  const a = el('a', 'gloss-term', label);
  a.href = `glossary.html#${anchor}`;
  const cue = el('span', 'gloss-cue', '?');
  cue.setAttribute('aria-hidden', 'true');
  a.appendChild(cue);
  a.appendChild(el('span', 'visually-hidden', ` (definition of ${accessibleName} in the glossary)`));
  return a;
};

// Render a prose segment list (see ledger-query.js) into `parent`. A plain
// string is text; a `link` is a hyperlink (an off-site http… link opens in a
// new tab, an on-site link stays in the tab); a `raw` value is a verbatim
// register token with its invisible characters made visible; a `code` value is
// a monospace span. Every value is written with textContent, never innerHTML.
/**
 * @template {ParentNode} T
 * @param {T} parent
 * @param {Segment[]} segments
 * @returns {T}
 */
const appendSegments = (parent, segments) => {
  for (const s of segments) {
    if (typeof s === 'string') { parent.append(s); continue; }
    if (s.link) {
      if (/^https?:/i.test(s.link.href)) { parent.appendChild(extLink(s.link.href, s.link.text)); }
      else { const a = el('a', null, s.link.text); a.href = s.link.href; parent.appendChild(a); }
      continue;
    }
    if (s.raw !== undefined) { parent.appendChild(appendRawToken(el('span', 'fid-code'), s.raw)); continue; }
    if (s.code !== undefined) { parent.appendChild(el('span', 'fid-code', s.code)); continue; }
  }
  return parent;
};

// ---- Shared activity-style vertical timeline (issue #466) ------------------
// A chronological list of events on a connecting spine, grouped by year: each
// event places its content (the lead node) on the LEFT and its date on the
// RIGHT, with an optional de-emphasised precise timestamp below the date. The
// markup is a semantic ordered list of years, each an ordered list of that
// year's events, with a <time> for every date, so order and dates reach
// assistive tech and the whole thing reads with no JavaScript. The spine and its
// dots are decoration (aria-hidden), and every event carries a text lead, so the
// meaning never rides on colour alone. When there are more entries than
// `collapseAfter` the overflow (whole years only, never a split year) tucks
// behind a native <details> so a long history never dominates. This one
// component backs BOTH the entity status timeline and the per-note "seen in"
// source lists, so they read identically.

// One event row: the spine dot, the lead content on the left, and the date on
// the right. A precise timestamp, when present, is a source's OWN date (e.g. a
// spreadsheet's recorded modified time), shown below the vintage, de-emphasised
// and kept clearly distinct from our fetch/processing date.
/**
 * @param {TimelineDisplayEntry} entry
 * @returns {HTMLLIElement}
 */
const timelineEvent = (entry) => {
  const li = el('li', 'tl-event' + (entry.className ? ' ' + entry.className : ''));
  const dot = el('span', 'tl-dot' + (entry.dotClass ? ' tl-dot-' + entry.dotClass : ''));
  dot.setAttribute('aria-hidden', 'true');
  li.appendChild(dot);
  const lead = el('div', 'tl-lead');
  lead.appendChild(entry.lead);
  li.appendChild(lead);
  const when = el('div', 'tl-when');
  const date = el('time', 'tl-date', entry.dateText);
  if (entry.datetime) date.setAttribute('datetime', entry.datetime);
  when.appendChild(date);
  if (entry.preciseText) when.appendChild(el('span', 'tl-precise', entry.preciseText));
  li.appendChild(when);
  return li;
};

// Render year-grouped entries into an <ol class="tl">: each year is a group
// carrying its period label and a nested <ol> of that year's events.
/**
 * @param {TimelineDisplayEntry[]} entries
 * @returns {HTMLOListElement}
 */
const timelineGroups = (entries) => {
  const ol = el('ol', 'tl');
  for (const { period, entries: bucket } of groupByYear(entries)) {
    const group = el('li', 'tl-group');
    const label = el('p', 'tl-period');
    label.appendChild(el('time', null, period));
    group.appendChild(label);
    const events = el('ol', 'tl-events');
    for (const entry of bucket) events.appendChild(timelineEvent(entry));
    group.appendChild(events);
    ol.appendChild(group);
  }
  return ol;
};

// The full timeline for a set of entries: the visible year-groups, plus - when
// there are more than `collapseAfter` entries - the overflow years inside a
// JS-free <details>. The split falls on a year boundary so a year is never torn
// across the fold. `collapseNoun` names the tucked items in the summary
// ("sources", "events"). Returns a wrapper so the <details> can sit beside the
// list (an <ol> may not hold a <details> as a direct child).
/**
 * @param {TimelineDisplayEntry[]} entries
 * @param {{ ariaLabel?: string, collapseAfter?: number, collapseNoun?: string }} [options]
 * @returns {HTMLDivElement}
 */
const renderTimeline = (entries, { ariaLabel, collapseAfter = Infinity, collapseNoun = 'events' } = {}) => {
  const wrap = el('div', 'tl-wrap');
  /** @type {{ period: string, entries: TimelineDisplayEntry[] }[]} */
  const visible = [];
  /** @type {{ period: string, entries: TimelineDisplayEntry[] }[]} */
  const hidden = [];
  let shown = 0;
  for (const group of groupByYear(entries)) {
    if (shown >= collapseAfter && visible.length > 0) { hidden.push(group); }
    else { visible.push(group); shown += group.entries.length; }
  }
  const head = timelineGroups(visible.flatMap(g => g.entries));
  if (ariaLabel) head.setAttribute('aria-label', ariaLabel);
  wrap.appendChild(head);
  if (hidden.length > 0) {
    const details = el('details', 'tl-more');
    const summary = el('summary');
    summary.append(`Show all ${entries.length} ${collapseNoun}`);
    details.appendChild(summary);
    details.appendChild(timelineGroups(hidden.flatMap(g => g.entries)));
    wrap.appendChild(details);
  }
  return wrap;
};

// A "where it was seen" source list, rendered as the shared timeline: one event
// per source, "row {ordinal} · {humanised label, linked}" on the left and the
// vintage on the right, grouped by year. The visible label is short and human
// ("Ofcom open data"); the FULL logical path is preserved as the link's href and
// title, so the long path never becomes run-on visible text yet is not lost. A
// many-snapshot variant collapses its overflow years behind a <details>. Shared
// by the canonical-divergence block and the "show the working" panel.
const COLLAPSE_SOURCES_AFTER = 5;
/**
 * @param {DisplaySource} s
 * @returns {TimelineDisplayEntry}
 */
const sourceEntry = (s) => {
  const lead = document.createDocumentFragment();
  lead.append(`row ${s.ordinal} · `);
  const a = extLink(s.url, s.label);
  a.title = s.sourceFile;
  lead.appendChild(a);
  return { lead, vintage: s.vintage, dateText: s.vintage, datetime: s.vintage, className: 'tl-source', dotClass: 'source' };
};
/**
 * @param {DisplaySource[]} sources
 * @returns {HTMLDivElement}
 */
const renderSourceList = (sources) => {
  const timeline = renderTimeline(sources.map(sourceEntry),
    { ariaLabel: 'Where it was seen, by snapshot', collapseAfter: COLLAPSE_SOURCES_AFTER, collapseNoun: 'sources' });
  timeline.classList.add('fid-sources');
  return timeline;
};

/** @param {string} t */
const showRaw = t => t.replace(/ /g, '[NBSP]').replace(/ /g, '[SP]');

// The primary event class of a folded observation, driving its spine dot's
// appearance. A real licence-state move (change) leads, then a first sighting
// (birth), then an admin-only update, then an unchanged continuation; a parallel
// (de-emphasised) stream is marked as such. The dot only ECHOES the meaning the
// event chips already carry in text, so nothing rides on the dot's colour.
/** @param {TimelineEntry} ob */
const primaryDotClass = (ob) => {
  if (ob.role === 'parallel') return 'parallel';
  const classes = ob.evs.map(e => e.cls);
  if (classes.includes('change')) return 'change';
  if (classes.includes('birth')) return 'birth';
  if (classes.includes('admin')) return 'admin';
  return 'cont';
};

// ---- Entity timeline (temporal fold) ---------------------------------------
// The status timeline as a vertical activity feed (issue #466): each folded
// observation is one event on the shared timeline, its event chips + any raw
// variant tag on the left and its snapshot vintage on the right, grouped by
// year. The event chips keep the model's colour-plus-text vocabulary; the spine
// dot echoes the primary event class.
/**
 * @param {HTMLElement} host
 * @param {ResolvedEntity} resolved
 * @param {ClaimRow[]} claims
 */
function renderEntity(host, resolved, claims) {
  host.textContent = '';
  const observations = observationsOf(claims);
  const f = foldObservations(observations, resolved.cleaned);
  const card = el('div', 'entity');
  const head = el('div', 'entity-head');
  head.appendChild(el('div', 'id', resolved.entity));
  const s1 = el('div', 'stat');
  s1.append(b(f.snaps), ' observations · ', b(f.vints.length), ' vintages');
  if (f.variants.size > 1) s1.append(' · ', b(f.variants.size), ' raw variants');
  if (f.admin) s1.append(' · ', b(f.admin), ' admin updates');
  head.appendChild(s1);
  const verdict = el('div', 'verdict ' + (f.changes ? 'moved' : 'flat'),
    f.changes ? `${f.changes} real change${f.changes > 1 ? 's' : ''}` : 'no real change');
  head.appendChild(verdict);
  card.appendChild(head);

  /** @type {TimelineDisplayEntry[]} */
  const entries = [];
  for (const v of f.vints) {
    for (const ob of f.byV.get(v) ?? []) {
      const lead = document.createDocumentFragment();
      if (ob.variant) {
        const vt = el('span', 'variant-tag');
        vt.textContent = 'raw variant ' + showRaw(ob.variant);
        lead.appendChild(vt);
      }
      if (ob.role === 'parallel') lead.appendChild(el('span', 'ev split-inactive', ob.status + ' · parallel'));
      for (const e of ob.evs) lead.appendChild(el('span', 'ev ' + e.cls, e.t));
      entries.push({
        lead,
        vintage: v,
        dateText: v,
        datetime: v,
        className: ob.role === 'parallel' ? 'parallel' : '',
        dotClass: primaryDotClass(ob),
      });
    }
  }
  card.appendChild(renderTimeline(entries, { ariaLabel: 'Status timeline across the snapshots' }));
  host.appendChild(card);
}

// ---- Layer anatomy: raw token -> normalises_to edges -> entity -------------
/**
 * @param {HTMLElement} host
 * @param {ResolvedEntity} resolved
 * @param {ClaimRow[]} claims
 */
function renderAnatomy(host, resolved, claims) {
  host.textContent = '';
  const variants = anatomyOf(claims);
  for (const o of variants) {
    const box = el('div', 'obs');
    const top = el('div'); top.style.display = 'flex'; top.style.justifyContent = 'space-between'; top.style.alignItems = 'center';
    top.appendChild(el('span', 'badge raw', 'raw token'));
    top.appendChild(el('span', 'obs-mini', o.damaged ? 'differs from cleaned' : 'clean'));
    box.appendChild(top);
    const kv = el('div', 'kv');
    const valNode = appendRawToken(el('span', 'v'), o.raw);
    const bytesNode = el('span', 'v');
    bytesNode.append(el('span', 'bytes', o.bytes));
    const obsNode = el('span', 'v'); obsNode.append(b(o.observations), ` observation${o.observations === 1 ? '' : 's'}`);
    kv.append(el('span', 'k', 'Value'), valNode, el('span', 'k', 'bytes'), bytesNode, el('span', 'k', 'seen in'), obsNode);
    box.appendChild(kv);
    for (const edge of o.edges) {
      const edgeBox = el('div', 'edge');
      const ruleLabel = el('span', null, 'rule:');
      ruleLabel.style.color = 'var(--muted)';
      edgeBox.append(
        el('span', 'badge derived', 'derived'),
        '  ',
        appendRawToken(el('span'), edge.subject),
        ' ',
        el('span', 'rel', 'normalises_to'),
        ' ' + edge.object,
        el('br'),
        ruleLabel, ' ' + edge.rule,
      );
      box.appendChild(edgeBox);
    }
    host.appendChild(box);
  }
}

// ---- Dossier: attributes + derived notable observations (flags) ------------
/**
 * @param {HTMLElement} host
 * @param {ResolvedEntity} resolved
 * @param {ClaimRow[]} claims
 */
function renderDossier(host, resolved, claims) {
  host.textContent = '';
  const card = el('div', 'entity');
  const head = el('div', 'entity-head');
  head.appendChild(el('div', 'id', resolved.entity));
  const observations = observationsOf(claims);
  const st = el('div', 'stat');
  if (observations.length > 0) {
    // The latest snapshot may carry more than one raw variant (a clean token
    // beside a damaged twin), each with its own status, so name every status
    // seen at that vintage rather than picking one arbitrarily.
    const latestVintage = observations.map(o => o.vintage).sort().at(-1);
    const latestStatuses = [...new Set(observations
      .filter(o => o.vintage === latestVintage && o.status !== '')
      .map(o => o.status))].sort();
    // The shared status field wrapper (#553/#625): the dossier shows only
    // this one summary line (never a repeated per-row column), so the default
    // 'linked' crosslinking is the right call, at the site root (depth 0).
    if (latestStatuses.length > 0) {
      const statusVal = el('b');
      latestStatuses.forEach((s, i) => {
        if (i > 0) statusVal.append(' / ');
        statusVal.append(statusField(elAttrs, s, { depthToRoot: 0 }));
      });
      st.append(statusVal);
    } else {
      st.append(b('(no status)'));
    }
    st.append(' · latest snapshot ', latestVintage ?? '');
  } else {
    st.append('no observations');
  }
  head.appendChild(st);
  card.appendChild(head);

  const body = el('div'); body.style.padding = '16px 18px';
  const note = el('p', 'obs-mini'); note.style.margin = '0 0 6px';
  note.textContent = `Resolved from "${resolved.typed}" via the ${resolved.matched === 'placeholder' ? 'placeholder-form (entity)' : 'cleaned'} index.`;
  body.appendChild(note);

  /** @param {string} title */
  const section = (title) => { const s = el('div', 'dsec'); s.appendChild(el('h4', null, title)); return s; };
  /**
   * @param {string} lab
   * @param {Node | string | (Node | string)[]} parts
   */
  const row = (lab, parts) => {
    const r = el('div', 'drow');
    r.appendChild(el('span', 'lab', lab));
    const v = el('span', 'val');
    for (const p of (Array.isArray(parts) ? parts : [parts])) v.append(p);
    r.appendChild(v);
    return r;
  };

  const facts = section('what the ledger asserts');
  facts.appendChild(row('entity', [b(resolved.entity), ' — the RSL-less placeholder key every regional rendering collapses to']));
  facts.appendChild(row('canonical form', [b(resolved.cleaned), ' — the reference form this callsign is matched on (', glossTerm('canonical-form', 'canonical form', 'the canonical form'), ')']));
  const variants = [...new Set(claims.map(c => c.raw_subject))];
  const variantVal = el('span');
  variants.forEach((t, i) => { if (i > 0) variantVal.append('  ·  '); appendRawToken(variantVal, t); });
  facts.appendChild(row('raw tokens', variantVal));
  const vintages = [...new Set(claims.map(c => c.vintage))].sort();
  facts.appendChild(row('snapshots', [b(vintages.length), vintages.length > 0 ? ` · ${vintages[0]} → ${vintages.at(-1)}` : '']));
  body.appendChild(facts);

  renderFidelity(body, resolved, claims);
  card.appendChild(body);
  host.appendChild(card);
}

// ---- Record fidelity affordance (issue #438) -------------------------------
// The inline, selectively-disclosed fidelity surface. Nothing is added for the
// clean, unremarkable record (the ~99% case): the section is omitted entirely
// so there is no "canonical form" noise and nothing that could read as "your
// record was changed". When a published form diverges from the canonical form,
// or a derived observation applies, it surfaces a standing non-accusatory
// preamble, the canonical form (glossary-linked), each note with its plain
// gloss and a JS-free "show the working" disclosure, and a basic examine/report
// right-of-reply hook. Exported so the DOM output is unit-testable without a
// database worker. Deliberately carries NO lookalike / "did you mean"
// suggestion.
/**
 * @param {HTMLElement} body
 * @param {ResolvedEntity} resolved
 * @param {ClaimRow[]} claims
 */
export function renderFidelity(body, resolved, claims) {
  const fidelity = fidelityOf(claims, resolved);
  if (!fidelity.disclose) return; // selective disclosure: surface nothing

  const sec = el('div', 'dsec fidelity');
  sec.appendChild(el('h4', null, 'record fidelity'));
  sec.appendChild(appendSegments(el('p', 'fid-preamble'), fidelity.preamble));

  if (fidelity.canonical) {
    const c = el('div', 'fid-canonical');
    c.appendChild(appendSegments(el('p', 'fid-line'), fidelity.canonical.intro));
    for (const v of fidelity.canonical.variants) {
      const vrow = el('div', 'fid-variant');
      vrow.appendChild(appendSegments(el('p', 'fid-line'), v.prose));
      if (v.sources.length > 0) {
        const seen = el('div', 'fid-seen');
        seen.appendChild(el('span', 'fid-seen-label', 'Seen in'));
        seen.appendChild(renderSourceList(v.sources));
        vrow.appendChild(seen);
      }
      vrow.appendChild(renderWorking(v.working));
      c.appendChild(vrow);
    }
    sec.appendChild(c);
  }

  for (const note of fidelity.notes) {
    const fc = el('div', 'flagcard fid-note');
    const t = el('div', 'fid-note-head');
    t.appendChild(el('span', 'fn', note.label));
    t.appendChild(el('span', 'tb d', 'derived'));
    fc.appendChild(t);
    if (note.gloss && note.gloss.length > 0) fc.appendChild(appendSegments(el('div', 'fg'), note.gloss));
    if (note.working) fc.appendChild(renderWorking(note.working));
    sec.appendChild(fc);
  }

  // Right-of-reply hook (issue #439 basic form): raise a neutral, pre-filled
  // public issue. No response-time expectation is set.
  const actions = el('p', 'fid-actions');
  actions.appendChild(extLink(reportIssueUrl(resolved.cleaned), 'Report an observation about this callsign'));
  actions.append(' — opens a public GitHub issue; this project mirrors Ofcom’s published snapshots and cannot change the official register.');
  sec.appendChild(actions);

  body.appendChild(sec);
}

// The JS-free "show the working" disclosure behind one derived value: a native
// <details>/<summary> (works with JavaScript off), revealing the rule gloss,
// the inputs it consumed, the reproduced result, and a link to examine the
// source rows the observation was seen in. Built from the emitted claims, so it
// shows exactly what the model asserts.
/** @param {Working} working */
function renderWorking(working) {
  const d = el('details', 'fid-why');
  const sum = el('summary');
  sum.append('Show the working');
  d.appendChild(sum);

  const panel = el('div', 'fid-work');
  panel.appendChild(row2('rule', working.ruleGloss));

  const inputsVal = el('span');
  working.inputs.forEach((inp, i) => {
    if (i > 0) inputsVal.append('  ·  ');
    inputsVal.append(inp.role + ': ');
    appendRawToken(inputsVal, inp.value);
  });
  panel.appendChild(row2('inputs', inputsVal));
  // The result is a verbatim callsign only for the canonical-divergence working
  // (resultVerbatim), where its invisible characters should be shown. For a flag
  // or parse-status working the result is a label token (e.g. 'forbidden-suffix'
  // / 'unparseable'), rendered as plain text.
  panel.appendChild(row2('result', working.resultVerbatim ? appendRawToken(el('span'), working.result) : working.result));

  if (working.sources.length > 0) {
    const r = el('div', 'fid-work-row');
    r.appendChild(el('span', 'k', 'seen in'));
    r.appendChild(renderSourceList(working.sources));
    panel.appendChild(r);
  }
  d.appendChild(panel);
  return d;
}

// One label/value line inside a working panel.
/**
 * @param {string} lab
 * @param {string | Node} value
 * @returns {HTMLDivElement}
 */
function row2(lab, value) {
  const r = el('div', 'fid-work-row');
  r.appendChild(el('span', 'k', lab));
  const v = el('span', 'v');
  if (typeof value === 'string') v.textContent = value; else v.appendChild(value);
  r.appendChild(v);
  return r;
}

// ---- Orchestration ---------------------------------------------------------
// Resolve a typed callsign, fetch its claims once, and drive all three views
// from that single result set. Exported so a JSDOM test can run the full lookup
// against a node:sqlite-backed executor without the browser worker. Returns the
// resolution so callers can react (e.g. update the URL / title).
/**
 * @param {QueryExecutor} query
 * @param {string} typed
 * @returns {Promise<ResolvedEntity>}
 */
export async function runLookup(query, typed) {
  const entityHost = document.getElementById('entity');
  const anatomyHost = document.getElementById('anatomy');
  const dossierHost = document.getElementById('dossier');
  const missHost = document.getElementById('miss');

  const resolved = await resolveEntity(query, typed);
  if (resolved.entity === null) {
    if (entityHost) entityHost.textContent = '';
    if (anatomyHost) anatomyHost.textContent = '';
    if (dossierHost) dossierHost.textContent = '';
    if (missHost) {
      missHost.textContent = '';
      missHost.appendChild(el('div', 'callout',
        `No observation for "${typed}" in the register snapshots this ledger folds. That is not proof it is `
        + 'unrecorded: the ledger covers register-snapshot publications only, not Ofcom’s other disclosures, and '
        + 'the register does not list every un-issued callsign.'));
    }
    return resolved;
  }
  if (missHost) missHost.textContent = '';
  const claims = await entityClaims(query, resolved.entity);
  if (entityHost) renderEntity(entityHost, resolved, claims);
  if (anatomyHost) renderAnatomy(anatomyHost, resolved, claims);
  if (dossierHost) renderDossier(dossierHost, resolved, claims);
  return resolved;
}

// ---- Shareable deep-link params (issues #440, #333, #397) -------------------
// The lookup is deep-linkable: a search writes ?c=<callsign> to the URL, so the
// address bar always carries a shareable/copyable link to the current search,
// and back/forward step between searches. The param handling is pure and
// exported so the whole state<->URL round-trip is unit-testable without a
// database worker (mirroring the Explore/Compare deep-link helpers, #420).

// Read the deep-link callsign from URL params. Accepts ?c= (canonical) AND
// ?callsign= (legacy alias, aligning with the Lookup page's
// `params.get('c') ?? params.get('callsign')`). Total by construction: a blank
// or absent param yields null so a bare load degrades gracefully to the sample
// chip rather than throwing. The value is trimmed and upper-cased to the
// canonical callsign form the register uses.
/**
 * @param {URLSearchParams} params
 * @returns {{ callsign: string | null }}
 */
export function parseLedgerParams(params) {
  const raw = params.get('c') ?? params.get('callsign');
  const callsign = (raw !== null && raw.trim() !== '') ? raw.trim().toUpperCase() : null;
  return { callsign };
}

// The URL a search for `callsign` should show: the current location with its
// query reduced to ?c=<callsign>, hash preserved. Pure (returns a string); the
// caller decides pushState vs replaceState. URLSearchParams percent-encodes the
// value, so a callsign is carried literally and can never smuggle markup.
/**
 * @param {string} baseHref
 * @param {string} callsign
 * @returns {string}
 */
export function ledgerSearchUrl(baseHref, callsign) {
  const url = new URL(baseHref);
  url.search = new URLSearchParams({ c: callsign }).toString();
  return url.toString();
}

// Wire the search form, sample chips, the ?c=/?callsign= deep link and
// back/forward to a single search runner, keeping the URL in lockstep with the
// resolved callsign. Dependency-injected (doc, win, and the async runSearch
// callback) so the state<->URL round-trip is unit-testable without a database
// worker. runSearch(callsign) performs the live lookup; this layer only reads
// URL params and writes the input value (never innerHTML), so a hostile param
// can never reach the DOM as markup.
/**
 * @param {{ doc: Document, win: Window, runSearch: (callsign: string) => Promise<unknown> }} options
 */
export function wireLedgerSearch({ doc, win, runSearch }) {
  // `doc` may be a JSDOM document from another realm than this module's own
  // ambient DOM globals (tests inject their own JSDOM instance), where
  // `instanceof HTMLInputElement`/`HTMLElement` would wrongly say no - these
  // elements are asserted from the page's known markup shape (ledger.html)
  // rather than verified by constructor identity.
  const getInput = () => /** @type {HTMLInputElement | null} */ (doc.getElementById('callsign-input'));
  const first = /** @type {HTMLElement | null} */ (doc.querySelector('#resolver .chip'));
  const fallback = first ? (first.dataset.cs ?? '') : '';

  // mode: 'push' adds a history entry (a user-initiated search, so Back returns
  // to the previous search); 'replace' rewrites the current entry (the initial
  // load, so it adds no spurious entry); 'none' leaves history untouched (a
  // popstate restore, whose URL is already the target).
  /** @param {string} callsign @param {'push' | 'replace' | 'none'} mode */
  const writeUrl = (callsign, mode) => {
    if (mode === 'none') return;
    const next = ledgerSearchUrl(win.location.href, callsign);
    if (next === win.location.href) return;
    if (mode === 'replace') win.history.replaceState(null, '', next);
    else win.history.pushState(null, '', next);
  };

  /** @param {string} typed @param {'push' | 'replace' | 'none'} mode */
  const search = (typed, mode) => {
    const value = typed.trim().toUpperCase();
    if (value === '') return Promise.resolve();
    const input = getInput();
    if (input) input.value = value;
    writeUrl(value, mode);
    return runSearch(value);
  };

  const resolver = doc.getElementById('resolver');
  if (resolver) {
    resolver.addEventListener('click', (e) => {
      const target = /** @type {HTMLElement | null} */ (e.target);
      const chip = /** @type {HTMLElement | null} */ (target ? target.closest('button.chip') : null);
      if (!chip) return;
      void search(chip.dataset.cs ?? '', 'push');
    });
  }
  const form = doc.getElementById('lookup-form');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = getInput();
      void search(input ? input.value : '', 'push');
    });
  }

  // Back/forward: re-read the URL's callsign and re-run the lookup for it, so
  // history navigation actually replays searches. A blank/absent param (having
  // navigated back to a bare URL) falls back to the sample chip.
  win.addEventListener('popstate', () => {
    const target = parseLedgerParams(new URLSearchParams(win.location.search)).callsign ?? fallback;
    void search(target, 'none');
  });

  // Initial view: a deep-link ?c=/?callsign=, else the first sample chip. Either
  // way the URL is normalised with replaceState so the shown callsign is always
  // reflected in a shareable link, without adding a history entry.
  const initial = parseLedgerParams(new URLSearchParams(win.location.search)).callsign ?? fallback;
  if (initial !== '') void search(initial, 'replace');
}

// ---- Lookup runner (loading affordance) ------------------------------------
// Build the callsign-lookup runner that the search wiring drives. The database
// open + lookup run through the shared loading affordance (issue #499), so the
// first-use wait is communicated exactly as it is on Explore and the Playground:
// the Look up button is disabled and reads "Waiting for data…" while the
// database opens, flips to "Running…" once the query starts, a polite status
// escalates if the cold open runs long, and a load failure raises the assertive
// #lookup-alert. The surface keeps ownership of its own result rendering
// (runLookup populates the timeline / anatomy / dossier) and the resolved-status
// messaging. The claim-ledger database is served chunked (a fast length, no cold
// HEAD stall), but the affordance is applied anyway so every query surface reads
// identically.
//
// Dependency-injected (the button/status/alert/result elements, the async
// database opener, and the lookup runner) and exported, so a JSDOM test drives
// the exact affordance path without a real database worker. runLookup is the
// default lookup runner; a test may substitute a stub to assert the affordance
// in isolation.
/**
 * The affordance elements are optional (passed straight to withDatabaseLoading,
 * which guards each); `openDatabase` opens the query worker and is required.
 * `performLookup` defaults to runLookup and is dependency-injected in tests - the
 * runner only reads `.entity` off its result, so that is all the contract needs.
 * @param {{ button?: HTMLButtonElement, statusEl?: HTMLElement, alertEl?: HTMLElement, resultEl?: HTMLElement, doc?: Document, openDatabase: () => Promise<QueryExecutor> | QueryExecutor, performLookup?: (query: QueryExecutor, value: string) => Promise<{ entity: string | null }>, label?: string }} options
 */
export function makeLedgerLookup({
  button, statusEl, alertEl, resultEl, doc = document,
  openDatabase, performLookup = runLookup, label = 'claim-ledger database',
}) {
  // Open the database once and memoise it. A rejected open is NOT cached: the
  // memo is cleared on failure so a later search retries rather than being stuck
  // on a transient error. A subsequent search reuses the warm open.
  /** @type {Promise<QueryExecutor> | null} */
  let queryPromise = null;
  const getQuery = () => {
    queryPromise ??= Promise.resolve(openDatabase())
      .catch((err) => { queryPromise = null; throw err; });
    return queryPromise;
  };

  /** @param {string} value */
  const lookup = (value) => {
    if (value === '') return Promise.resolve();
    return withDatabaseLoading(
      { button, statusEl, alertEl, resultEl, label },
      async (markRunning) => {
        const query = await getQuery();
        markRunning();
        const resolved = await performLookup(query, value);
        // The surface owns its resolved-status line; the affordance leaves the
        // status untouched on success, so this is the message the user is left
        // with (the miss text is rendered into #miss by the lookup runner).
        if (statusEl) {
          statusEl.textContent = resolved.entity === null
            ? `No observation for ${value} in the subset.`
            : `Resolved ${value} → ${resolved.entity}.`;
        }
        for (const rawChip of doc.querySelectorAll('#resolver .chip')) {
          const chip = /** @type {HTMLElement} */ (rawChip);
          chip.setAttribute('aria-pressed', String(chip.dataset.cs === value));
        }
        return resolved;
      },
      // The affordance owns the load-failure alert and the button state; there
      // is nothing more to render here, so swallow the rethrow.
    ).catch(() => {});
  };

  return { lookup };
}

// ---- Browser bootstrap (guarded) -------------------------------------------
// Runs only in a real browser with the httpVFS loader present. A unit/JSDOM
// test importing this module for its render/param functions never trips this,
// so importing the module opens no worker.
function initLedgerPage() {
  const lookupButton = document.querySelector('#lookup-form button');
  const { lookup } = makeLedgerLookup({
    button: lookupButton instanceof HTMLButtonElement ? lookupButton : undefined,
    statusEl: document.getElementById('lookup-status') ?? undefined,
    alertEl: document.getElementById('lookup-alert') ?? undefined,
    resultEl: document.getElementById('entity') ?? undefined,
    openDatabase: openLedgerQuery,
    label: 'claim-ledger database',
  });

  wireLedgerSearch({ doc: document, win: window, runSearch: lookup });
}

// The httpvfs UMD loader (vendor/, no shipped types) attaches createDbWorker to
// window at runtime; read through a typed view of that global, mirroring the
// same boundary crossing in ledger-query.js's openLedgerQuery. The outer
// `typeof window` guard must run first and short-circuit, unevaluated, so this
// module never throws when imported somewhere window does not exist at all
// (a plain node process, as opposed to a jsdom test).
if (typeof window !== 'undefined') {
  const pageGlobals = /** @type {{ createDbWorker?: unknown }} */ (/** @type {unknown} */ (window));
  if (typeof pageGlobals.createDbWorker === 'function') {
    initLedgerPage();
  }
}
