// @ts-check
// The per-callsign EVENT-TIME strip (issue #726): what the corpus asserts
// happened to this callsign and when — licence starts, cancellations,
// reservation-window bounds — rendered from the prefix-sharded static JSON
// built at deploy by src/ci/build-callsign-event-shards.ts. Fetched LAZILY
// after the instant answer has rendered, so the instant path (issue #594) is
// untouched.
//
// The two time axes are never conflated (issue #726, binding): every dated
// line below is EVENT time, and each carries its "asserted by" list — the
// datasets and vintages that stated it (ASSERTION time) — inline, so the
// assertion-time provenance is at most one glance away from any event-time
// claim. Derived findings ship as the state-at-t engine's own statements
// VERBATIM with their caveats (issue #861 item 4: statement + caveats, never a
// bare rule-name badge). Cross-vintage disagreements list both camps and
// resolve nothing (issue #467). Absence of an event claim is NON-OBSERVATION:
// it never reads as "was available" or "did not exist".
//
// Conditional prominence (the durable pattern from the issue #726 review):
// every explanatory affordance here is ALWAYS PRESENT but folded (<details>)
// when not directly applicable — passively answering "what would this look
// like?" — and opened automatically when this record's own evidence carries
// the signals (a vintages-disagree listing, a multi-row version window).
// Likewise the bookkeeping stamps fold closed when licensing evidence exists
// (they are system presence, not the story) and open when they are the only
// evidence there is.
//
// The record/meta shapes are the builder's compact projection; the JSDoc
// typedefs below mirror src/ci/build-callsign-event-shards.ts and the two must
// be kept in step. Everything data-derived is written with textContent, never
// innerHTML.

import { dateTime } from './datetime.js';

// ---------------------------------------------------------------------------
// Shapes (mirroring src/ci/build-callsign-event-shards.ts).

/**
 * One dataset reference of the events meta.
 * @typedef {object} EventDataset
 * @property {string} lane     'opendata' | 'foi' (the ledger's lane token)
 * @property {string} key      dataset key (archive date / FOI entry)
 * @property {string} vintage  assertion-time vintage (yyyy-mm-dd or yyyy-mm)
 * @property {string} title
 * @property {string} href     site-root-relative dataset entry page
 */

/**
 * The once-fetched events meta.
 * @typedef {object} EventsMeta
 * @property {number} schemaVersion
 * @property {string} asAt
 * @property {{ datasets: number, subjects: number, shards: number, unkeyableEventClaims: number }} counts
 * @property {EventDataset[]} datasets
 * @property {{ id: string, label: string, contribution: string }[]} kinds
 * @property {{ id: string, gloss: string }[]} rules
 * @property {{ id: string, label: string, gloss: string }[]} caveats
 * @property {{ start: string, end: string }[]} episodes
 * @property {Record<string, string>} [seriesIntro]  prefix series -> introduction month (yyyy-mm), issue #921
 * @property {string[]} shards
 */

/**
 * One callsign's compact event record (see the builder header):
 * e = [kindIdx, day, [[datasetIdx, nrows], ...], episodeIdx?][]
 * f = [ruleIdx, statement, caveatIdxs, evidenceLineIdxs][]
 * g = [kindIdx, [day, datasetIdxs][]][]
 * w = 1 when a multi-row version window is present.
 * @typedef {object} EventRecord
 * @property {Array<[number, string, Array<[number, number]>] | [number, string, Array<[number, number]>, number]>} e
 * @property {Array<[number, string, number[], number[]]>} f
 * @property {Array<[number, Array<[string, number[]]>]>} [g]
 * @property {number} [w]
 */

// ---------------------------------------------------------------------------
// Resolved view models (pure, exported for the jsdom unit tests).

/**
 * @typedef {object} EvidenceLineView
 * @property {string} kindId
 * @property {string} kindLabel
 * @property {string} contribution
 * @property {string} day
 * @property {{ dataset: EventDataset, nrows: number }[]} assertedBy
 * @property {{ start: string, end: string } | null} episode
 */

/**
 * @typedef {object} FindingView
 * @property {string} rule
 * @property {string} ruleGloss
 * @property {string} statement
 * @property {{ id: string, label: string, gloss: string }[]} caveats
 */

/**
 * @typedef {object} DisagreementView
 * @property {string} kindLabel
 * @property {{ day: string, datasets: EventDataset[] }[]} camps
 */

/**
 * @typedef {object} StripModel
 * @property {EvidenceLineView[]} licensing
 * @property {EvidenceLineView[]} bookkeeping
 * @property {FindingView[]} findings
 * @property {DisagreementView[]} disagreements
 * @property {boolean} bookkeepingOpen  bookkeeping is the only evidence
 * @property {boolean} reissueOpen      the reissue explainer's auto-open state
 * @property {string[]} reissueReasons  this record's own signals, human-phrased
 */

/**
 * Resolve one compact record against the meta into render-ready view models.
 * Fail-safe never fail-silent: an index outside the meta vocabularies throws —
 * a claim that cannot name its source or rule must not render as if it could.
 * @param {EventRecord} record
 * @param {EventsMeta} meta
 * @returns {StripModel}
 */
export function stripModel(record, meta) {
  /** @param {number} idx @returns {EventDataset} */
  const datasetAt = (idx) => {
    const dataset = meta.datasets[idx];
    if (dataset === undefined) throw new Error(`event record cites dataset index ${idx}, outside the meta's dataset table`);
    return dataset;
  };
  /** @type {EvidenceLineView[]} */
  const lines = record.e.map((line) => {
    const [kindIdx, day, assertedBy] = line;
    const episodeIdx = line.length > 3 ? line[3] : undefined;
    const kind = meta.kinds[kindIdx];
    if (kind === undefined) throw new Error(`event record cites kind index ${kindIdx}, outside the meta's kind vocabulary`);
    const episode = episodeIdx === undefined ? null : meta.episodes[episodeIdx] ?? null;
    if (episodeIdx !== undefined && episode === null) throw new Error(`event record cites episode index ${episodeIdx}, outside the meta's episode list`);
    return {
      kindId: kind.id,
      kindLabel: kind.label,
      contribution: kind.contribution,
      day,
      assertedBy: assertedBy.map(([dsIdx, nrows]) => ({ dataset: datasetAt(dsIdx), nrows })),
      episode,
    };
  });
  const licensing = lines.filter(l => l.contribution !== 'system-presence');
  const bookkeeping = lines.filter(l => l.contribution === 'system-presence');

  /** @type {FindingView[]} */
  const findings = record.f.map(([ruleIdx, statement, caveatIdxs]) => {
    const rule = meta.rules[ruleIdx];
    if (rule === undefined) throw new Error(`event record cites rule index ${ruleIdx}, outside the meta's rule vocabulary`);
    if (statement === '') throw new Error(`finding under rule ${rule.id} arrived with an empty statement - a bare rule name must not render`);
    return {
      rule: rule.id,
      ruleGloss: rule.gloss,
      statement,
      caveats: caveatIdxs.map((idx) => {
        const caveat = meta.caveats[idx];
        if (caveat === undefined) throw new Error(`finding cites caveat index ${idx}, outside the meta's caveat vocabulary`);
        return caveat;
      }),
    };
  });

  /** @type {DisagreementView[]} */
  const disagreements = (record.g ?? []).map(([kindIdx, values]) => {
    const kind = meta.kinds[kindIdx];
    if (kind === undefined) throw new Error(`disagreement cites kind index ${kindIdx}, outside the meta's kind vocabulary`);
    return {
      kindLabel: kind.label,
      camps: values.map(([day, dsIdxs]) => ({ day, datasets: dsIdxs.map(datasetAt) })),
    };
  });

  /** @type {string[]} */
  const reissueReasons = [];
  // Known soft spot in the auto-open signal: the engine's disagreement list
  // does not (yet) distinguish a one-day movement across differing attested
  // date renderings (the S2 rendering-difference candidate) from a genuine
  // revision, so if such a pair ever surfaces as a disagreement the explainer
  // would open slightly over-prominently. That direction UNDER-claims (an
  // explainer opening where the mechanism note still applies), never
  // over-claims; a future engine-side classification on the disagreement
  // entries could refine the trigger — do not re-derive it here.
  if (disagreements.length > 0) {
    reissueReasons.push('the held vintages disagree about this record’s dates (listed above — both camps kept)');
  }
  if (record.w === 1) {
    reissueReasons.push('a vintage asserts more than one dated licence-version row for this callsign (a multi-row version window)');
  }

  return {
    licensing,
    bookkeeping,
    findings,
    disagreements,
    bookkeepingOpen: licensing.length === 0 && bookkeeping.length > 0,
    reissueOpen: reissueReasons.length > 0,
    reissueReasons,
  };
}

// ---------------------------------------------------------------------------
// DOM helpers (the page-module idiom: textContent everywhere).

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

// The attrs-object element factory the shared datetime wrapper expects.
/**
 * @param {string} tag
 * @param {Record<string, string>} [attrs]
 * @returns {HTMLElement}
 */
const elAttrs = (tag, attrs = {}) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  return node;
};

/**
 * @param {string} href
 * @param {string} label
 */
const link = (href, label) => {
  const a = el('a', null, label);
  a.setAttribute('href', href);
  return a;
};

/**
 * @param {string} href
 * @param {string} label
 */
const extLink = (href, label) => {
  const a = link(href, label);
  a.setAttribute('target', '_blank');
  a.setAttribute('rel', 'noopener');
  a.append(' ');
  const marker = el('span', 'ext-marker', '↗');
  marker.setAttribute('aria-hidden', 'true');
  a.appendChild(marker);
  a.appendChild(el('span', 'visually-hidden', ' (opens in a new tab)'));
  return a;
};

// An event day rendered at full-date precision (REQUIRED here, not the #551
// year-month default: the event axis is day-precision and the strip's whole
// point is the dated claim).
/** @param {string} day */
const eventDay = (day) => dateTime(elAttrs, day, { precision: 'full-date', exactLabel: 'Event day (as asserted)' });

// An assertion-time vintage, day- or month-keyed as published.
/** @param {string} vintage */
const vintageEl = (vintage) => dateTime(elAttrs, vintage, { precision: 'full-date', exactLabel: 'Assertion time (vintage)' });

// The inline "asserted by" run: the assertion-time axis carried beside every
// event-time value.
/** @param {{ dataset: EventDataset, nrows: number }[]} assertedBy */
function assertedByEl(assertedBy) {
  const span = el('span', 'evt-assert');
  span.append(' — asserted by ');
  assertedBy.forEach((a, i) => {
    if (i > 0) span.append('; ');
    span.appendChild(link(a.dataset.href, a.dataset.title));
    span.append(' (vintage ');
    span.appendChild(vintageEl(a.dataset.vintage));
    span.append(a.nrows > 1 ? `, ${a.nrows} rows)` : ')');
  });
  return span;
}

/** @param {EvidenceLineView} line */
function evidenceLineEl(line) {
  const li = el('li', 'evt-line');
  li.appendChild(eventDay(line.day));
  li.append(` — ${line.kindLabel}`);
  li.appendChild(assertedByEl(line.assertedBy));
  if (line.episode !== null) {
    const note = el('span', 'evt-episode');
    note.append(` · falls inside the mass-update episode ${line.episode.start} → ${line.episode.end}: `
      + 'tens of thousands of identical stamps record one system episode, not a per-record event.');
    li.appendChild(note);
  }
  return li;
}

// ---------------------------------------------------------------------------
// The strip renderer (fetch-free; the async wrapper below feeds it).

/**
 * @param {HTMLElement} host
 * @param {string} key      the resolved cleaned callsign
 * @param {EventRecord | null} record  null = no event-time claims held
 * @param {EventsMeta} meta
 */
export function renderEventStripInto(host, key, record, meta) {
  host.textContent = '';

  if (record === null) {
    const callout = el('div', 'callout');
    callout.append(`No event-time claim for ${key} exists in the held corpus — none of the archived publications `
      + 'carries a dated licensing or bookkeeping cell for it. This is non-observation: it is ');
    callout.appendChild(el('b', null, 'not'));
    callout.append(' evidence the callsign was available, nor that it never existed (see ');
    callout.appendChild(link('glossary.html#available', 'the availability trap'));
    callout.append('). The ');
    callout.appendChild(link(`ledger.html?c=${encodeURIComponent(key)}`, 'ledger'));
    callout.append(' shows everything that IS held for it, byte by byte.');
    host.appendChild(callout);
    return;
  }

  const model = stripModel(record, meta);

  // --- Licensing events (event time, each wearing its assertion time) ------
  const licensingHead = el('h3', 'evt-h', 'Dated licensing evidence');
  host.appendChild(licensingHead);
  if (model.licensing.length === 0) {
    const none = el('p', 'obs-mini');
    none.append('No dated licensing evidence (start, cancellation or reservation bound) is held for this record — '
      + 'non-observation, never “was available” or “did not exist”. The bookkeeping stamps below are the only '
      + 'dated evidence the corpus carries here.');
    host.appendChild(none);
  } else {
    const ol = el('ol', 'evt-lines');
    ol.setAttribute('aria-label', 'Dated licensing evidence, oldest first');
    for (const line of model.licensing) ol.appendChild(evidenceLineEl(line));
    host.appendChild(ol);
  }

  // --- Bookkeeping stamps: folded when licensing evidence carries the story,
  // open when they are the only evidence (conditional prominence). ----------
  if (model.bookkeeping.length > 0) {
    const details = el('details', 'evt-bookkeeping');
    if (model.bookkeepingOpen) details.setAttribute('open', '');
    const summary = el('summary');
    summary.append(`Record bookkeeping stamps (${model.bookkeeping.length} dated ${model.bookkeeping.length === 1 ? 'line' : 'lines'} — system presence, never licensing events)`);
    details.appendChild(summary);
    const note = el('p', 'obs-mini');
    note.append('Created/last-modified stamps attest the record’s presence in the publisher’s export system by a '
      + 'date — not licensing history. A stamp inside a detected mass-update episode largely records the episode '
      + 'itself (for pre-2016 records, the migration into the current system).');
    details.appendChild(note);
    const ol = el('ol', 'evt-lines');
    ol.setAttribute('aria-label', 'Record bookkeeping stamps, oldest first');
    for (const line of model.bookkeeping) ol.appendChild(evidenceLineEl(line));
    details.appendChild(ol);
    host.appendChild(details);
  }

  // --- Disagreements: both camps, resolved nowhere (#467). -----------------
  if (model.disagreements.length > 0) {
    const card = el('div', 'flagcard evt-disagree');
    const head = el('div', 'fid-note-head');
    head.appendChild(el('span', 'fn', 'The held vintages disagree about this record’s dates'));
    head.appendChild(el('span', 'tb d', 'derived'));
    card.appendChild(head);
    const gloss = el('div', 'fg');
    gloss.append('Different vintages assert different dates for the same past event. Every camp is listed with its '
      + 'asserting datasets; the mirror adjudicates none of them — a later assertion is not automatically the '
      + 'truer one, and an earlier one is not automatically stale.');
    card.appendChild(gloss);
    const ul = el('ul', 'evt-camps');
    for (const d of model.disagreements) {
      const li = el('li');
      li.append(`${d.kindLabel} — earliest asserted: `);
      d.camps.forEach((camp, i) => {
        if (i > 0) li.append(' vs ');
        li.appendChild(eventDay(camp.day));
        li.append(' per ');
        camp.datasets.forEach((ds, j) => {
          if (j > 0) li.append(', ');
          li.appendChild(link(ds.href, ds.title));
          li.append(' (vintage ');
          li.appendChild(vintageEl(ds.vintage));
          li.append(')');
        });
      });
      ul.appendChild(li);
    }
    card.appendChild(ul);
    host.appendChild(card);
  }

  // --- Findings: the engine's statements verbatim, with caveats (#861). ----
  const findingsHead = el('h3', 'evt-h');
  findingsHead.append('What can honestly be inferred, as at ');
  findingsHead.appendChild(dateTime(elAttrs, meta.asAt, { precision: 'full-date', exactLabel: 'Assertion ceiling (the latest held vintage day)' }));
  host.appendChild(findingsHead);
  const findingsSub = el('p', 'obs-mini');
  findingsSub.append('Derived by the state-at-t rules from the assertions above — inferred, conservative, and '
    + 'each finding names its caveats. The date is the latest assertion day the held corpus covers, not today: '
    + 'the mirror cannot see past its sources.');
  host.appendChild(findingsSub);
  const fUl = el('ul', 'evt-findings');
  for (const finding of model.findings) {
    const li = el('li');
    li.appendChild(el('span', 'tb d', 'inferred'));
    li.append(` ${finding.statement}.`);
    if (finding.caveats.length > 0) {
      const cav = el('span', 'evt-caveats');
      cav.append(' Caveats: ');
      finding.caveats.forEach((caveat, i) => {
        if (i > 0) cav.append('; ');
        const a = link('#evt-legend', caveat.label);
        a.setAttribute('title', caveat.gloss);
        cav.appendChild(a);
      });
      cav.append('.');
      li.appendChild(cav);
    }
    // The rule name rides WITH the statement and caveats (never alone): the
    // re-runnable citation of the derivation, glossed in the legend below.
    const rule = el('code', 'evt-rule', finding.rule);
    rule.setAttribute('title', finding.ruleGloss);
    li.append(' ');
    li.appendChild(rule);
    fUl.appendChild(li);
  }
  host.appendChild(fUl);

  // --- The reissue explainer: always present, folded; opened by this
  // record's own signals (the conditional-prominence pattern). --------------
  const reissue = el('details', 'evt-reissue');
  if (model.reissueOpen) reissue.setAttribute('open', '');
  const reissueSummary = el('summary');
  reissueSummary.append(model.reissueOpen
    ? 'How reissues and revisions appear in this record (directly relevant here)'
    : 'How reissues and revisions would appear in a record like this');
  reissue.appendChild(reissueSummary);
  const rBody = el('div', 'evt-reissue-body');
  if (model.reissueOpen) {
    const why = el('p');
    why.append('This note is open because this record’s own evidence carries the signals: ');
    model.reissueReasons.forEach((reason, i) => {
      if (i > 0) why.append('; ');
      why.append(reason);
    });
    why.append('.');
    rBody.appendChild(why);
  }
  const p1 = el('p');
  p1.append('A “start” date here is the earliest start ');
  p1.appendChild(el('b', null, 'surviving'));
  p1.append(' in the vintage that asserts it — never “the true original”. Ofcom’s register keeps a rolling window '
    + 'of licence versions, so two mechanisms move the earliest surviving date forward over time: the retention '
    + 'window dropping older version rows, and a reissue or variation replacing a sole row wholesale. Either way, '
    + 'a later export can assert a later start for the same callsign than an earlier export did.');
  rBody.appendChild(p1);
  const p2 = el('p');
  p2.append('This mirror never merges those into one “best” date: every vintage’s assertion is preserved side by '
    + 'side, so a reissue shows up as the vintages disagreeing — both camps listed, neither adjudicated. A record '
    + 'with a single stable, corroborated history simply shows every vintage asserting the same dates.');
  rBody.appendChild(p2);
  reissue.appendChild(rBody);
  host.appendChild(reissue);

  // --- Legend: rules and caveats, glossed once, folded. --------------------
  const legend = el('details', 'evt-legend-details');
  legend.id = 'evt-legend';
  const legendSummary = el('summary');
  legendSummary.append('Rule and caveat glossary (the engine’s own definitions)');
  legend.appendChild(legendSummary);
  const rulesHead = el('h4', null, 'Inference rules');
  legend.appendChild(rulesHead);
  const rUl = el('ul');
  for (const rule of meta.rules) {
    const li = el('li');
    li.appendChild(el('code', null, rule.id));
    li.append(` — ${rule.gloss}`);
    rUl.appendChild(li);
  }
  legend.appendChild(rUl);
  const cavHead = el('h4', null, 'Caveats');
  legend.appendChild(cavHead);
  const cUl = el('ul');
  for (const caveat of meta.caveats) {
    const li = el('li');
    li.appendChild(el('b', null, caveat.label));
    li.append(` — ${caveat.gloss}`);
    cUl.appendChild(li);
  }
  legend.appendChild(cUl);
  host.appendChild(legend);

  // --- Crosslinks: the deeper evidence, one hop away. ----------------------
  const trail = el('p', 'obs-mini evt-trail');
  trail.append('Examine: ');
  trail.appendChild(link(`ledger.html?c=${encodeURIComponent(key)}`, 'every raw byte behind these claims (ledger)'));
  trail.append(' · ');
  trail.appendChild(extLink('https://github.com/MysterAitch/amateur-callsigns-file-watch/blob/main/reports/state-at-t.md', 'the state-at-t rules, demonstrated over the corpus'));
  trail.append(' · ');
  trail.appendChild(extLink('https://github.com/MysterAitch/amateur-callsigns-file-watch/blob/main/reports/event-time-coherency.md', 'cross-vintage revisions, corpus-wide'));
  trail.append(' · ');
  trail.appendChild(link('on-this-day.html', 'the on-this-day calendar'));
  host.appendChild(trail);
}

// ---------------------------------------------------------------------------
// Data access: meta once, shards on demand, both memoised; a failure clears
// the memo so a later lookup retries.

const EVENTS_BASE = 'callsign/data/events/';

/** @type {Promise<EventsMeta> | null} */
let metaPromise = null;
/** @type {Map<string, Promise<{ json: { shard: string, callsigns: Record<string, EventRecord> }, bytes: number }>>} */
const shardCache = new Map();

/** For test isolation only. */
export function resetEventStripCaches() {
  metaPromise = null;
  shardCache.clear();
}

/** @param {string} name */
async function fetchJson(name) {
  const res = await fetch(new URL(`${EVENTS_BASE}${name}`, document.baseURI).toString());
  if (!res.ok) throw new Error(`could not fetch ${name} (HTTP ${res.status})`);
  const text = await res.text();
  /** @type {unknown} */
  const json = JSON.parse(text);
  return { json, bytes: text.length };
}

/** @returns {Promise<EventsMeta>} */
function loadEventsMeta() {
  metaPromise ??= fetchJson('meta.json')
    .then(r => /** @type {EventsMeta} */ (r.json))
    .catch(err => { metaPromise = null; throw err; });
  return metaPromise;
}

/** @param {string} name */
function loadEventShard(name) {
  let cached = shardCache.get(name);
  if (cached === undefined) {
    cached = fetchJson(`${name}.json`)
      .then(r => ({ json: /** @type {{ shard: string, callsigns: Record<string, EventRecord> }} */ (r.json), bytes: r.bytes }))
      .catch(err => { shardCache.delete(name); throw err; });
    shardCache.set(name, cached);
  }
  return cached;
}

/**
 * Fetch and render the event strip for one resolved callsign. Deliberately
 * fire-and-forget from the instant lookup path: a failure renders a calm
 * in-panel note and never disturbs the panels already on screen.
 * @param {object} opts
 * @param {HTMLElement} opts.host
 * @param {HTMLElement} opts.status  small per-panel status line
 * @param {string} opts.key          the resolved cleaned callsign
 * @param {(cleaned: string, shardNames: ReadonlySet<string>) => string} opts.shardNameFor
 *        the longest-prefix shard resolver (injected from callsign.js so the
 *        one rule lives in one place)
 * @returns {Promise<void>}
 */
export async function renderEventStrip(opts) {
  const { host, status, key, shardNameFor } = opts;
  status.textContent = 'Loading the event-time evidence…';
  try {
    const meta = await loadEventsMeta();
    const shardName = shardNameFor(key, new Set(meta.shards));
    const shard = await loadEventShard(shardName);
    const record = Object.hasOwn(shard.json.callsigns, key) ? shard.json.callsigns[key] : null;
    renderEventStripInto(host, key, record, meta);
    const sizeKb = (shard.bytes / 1024).toFixed(1);
    status.textContent = `Event-time evidence from events/${shardName}.json (${sizeKb} KB), loaded after the instant answer.`;
  } catch (err) {
    host.textContent = '';
    const note = el('p', 'muted');
    note.append(`Could not load the event-time data (${err instanceof Error ? err.message : String(err)}). `
      + 'The record’s full provenance is still available on the ');
    note.appendChild(link(`ledger.html?c=${encodeURIComponent(key)}`, 'ledger'));
    note.append('.');
    host.appendChild(note);
    status.textContent = '';
  }
}
