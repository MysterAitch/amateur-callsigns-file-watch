// @ts-check
// Instant per-callsign page (issue #594): the at-a-glance answer for one
// callsign, served from prefix-sharded static JSON built at deploy by
// src/ci/build-callsign-shards.ts. There is NO database on this path - no
// sql.js, no worker, no range requests: the input is cleaned, its prefix picks
// one shard, and that single small fetch answers. The database-backed deep
// dives (the Ledger's raw-byte provenance, the Lookup's reference joins) are
// linked out to, never re-implemented here.
//
// The record/manifest shapes are the builder's compact projection; the JSDoc
// typedefs below mirror the builder's module header and the two must be kept
// in step. Everything data-derived is written with textContent, never
// innerHTML, so register bytes can never smuggle markup - with ONE audited
// exception, the anatomy figure, whose markup comes from the shared escaping
// renderer over segments that must reassemble the cleaned key exactly (see
// renderAnatomyFigure).

import { cleanCallsign, reportIssueUrl, FLAG_NOTES, NOTABLE_PARSE_STATUS } from './ledger-query.js';
import { canonicalCallsign } from './browser-query.js';
import { wireLedgerSearch } from './ledger.js';
import { anatomyFigureHtml } from './callsign-pill.js';
import { licenceField, statusField, LICENCE_CLASS, prefixSeriesField, suffixField } from './field-wrappers.js';

// ---------------------------------------------------------------------------
// Shapes (mirroring src/ci/build-callsign-shards.ts).

/**
 * One dataset as the manifest publishes it.
 * @typedef {object} ShardDataset
 * @property {string} key
 * @property {'open-data' | 'foi'} lane
 * @property {string} entry
 * @property {string | null} file
 * @property {string | null} vintage
 * @property {string} title
 * @property {string[]} classes
 * @property {string} href
 * @property {number} rows
 * @property {number} unkeyable
 * @property {boolean | null} intendedComplete
 * @property {string} scopeNotes
 * @property {string} coverageNote
 */

/**
 * The once-fetched manifest.
 * @typedef {object} ShardManifest
 * @property {number} schemaVersion
 * @property {{ datasets: number, callsigns: number, shards: number, unkeyableRows: number }} counts
 * @property {{ statuses: Record<string, string>, markers: Record<string, string> }} legend
 * @property {{ product: string[], type: string[], impliedClass: string[] }} vocab
 * @property {string[]} shards
 * @property {ShardDataset[]} datasets
 */

/**
 * One callsign's compact record (see the builder header for field semantics).
 * @typedef {object} CallsignRecord
 * @property {string} h
 * @property {{ d: number, s?: string[], p?: number[], t?: number[] }} [l]
 * @property {{ c?: string, m?: string, o?: string }} [d]
 * @property {{ ps?: string, pre?: string, rsl?: string, sfx?: string, ph?: string, hc?: string, ic?: number }} [a]
 * @property {string[]} [f]
 * @property {string[]} [v]
 * @property {TwinRow[]} [tw]
 * @property {number[]} [m]
 */

/**
 * One conflicting twin row of the latest register snapshot (the builder's `tw`,
 * present only when that snapshot lists the cleaned form more than once).
 * @typedef {object} TwinRow
 * @property {string} r    raw form verbatim
 * @property {string} [s]  status letter (into legend.statuses)
 * @property {string} [m]  source-intrinsic last-modified date
 * @property {number} [p]  product vocab index
 */

/**
 * One twin variant resolved for display: its raw form, whether it is the
 * format-normal token (equal to the cleaned key), and its resolved status,
 * product and modified date.
 * @typedef {object} TwinVariantView
 * @property {string} raw
 * @property {boolean} normal
 * @property {string} status
 * @property {string | null} product
 * @property {string} modified
 */

/**
 * A resolved lookup, ready to render.
 * @typedef {object} Resolution
 * @property {string} typed
 * @property {string} cleaned
 * @property {string | null} key    resolved record key (null = never seen)
 * @property {CallsignRecord | null} record
 * @property {boolean} viaRendering true when a regional rendering resolved to
 *                                  the register's core record
 * @property {string} shard         the shard file that answered
 * @property {number} shardBytes    its raw (uncompressed) byte size
 */

// ---------------------------------------------------------------------------
// Pure helpers (exported for the jsdom unit tests).

// The shard file for a cleaned form, mirroring the builder's longest-prefix
// rule: the 3-character child shard when the manifest lists one, else the
// 2-character bucket, else the irregular fallback.
/**
 * @param {string} cleaned
 * @param {ReadonlySet<string>} shardNames
 * @returns {string}
 */
export function shardNameFor(cleaned, shardNames) {
  const three = cleaned.slice(0, 3);
  if (/^[A-Z0-9]{3}$/.test(three) && shardNames.has(three)) return three;
  const two = cleaned.slice(0, 2);
  if (/^[A-Z0-9]{2}$/.test(two) && shardNames.has(two)) return two;
  return 'irregular';
}

// Short labels for the dataset-class vocabulary, for inline rendering. An
// unknown class falls back to its own token rather than an invented label.
const CLASS_LABELS = {
  'register-snapshot': 'register snapshot',
  'available-pool': 'availability list',
  'attribute-addendum': 'attribute addendum',
  'issuance-events': 'issuance events',
  'forbidden-list': 'forbidden-suffix list',
  'reference-context': 'reference context',
  'statistics-aggregate': 'statistics',
};

/**
 * @param {ShardDataset} dataset
 * @returns {string}
 */
export function datasetClassLabel(dataset) {
  return dataset.classes.map(c => Object.hasOwn(CLASS_LABELS, c) ? CLASS_LABELS[/** @type {keyof typeof CLASS_LABELS} */ (c)] : c).join(', ');
}

// One history-string cell, humanised. `kind` drives styling; `text` is the
// short cell phrase. Absence is phrased scope-aware: it is only ever a LEAD in
// a declared-complete publication (and not even that where a verified quality
// observation says records were omitted); everywhere else it is not evidence.
/**
 * @param {string} ch
 * @param {ShardDataset} dataset
 * @param {ShardManifest} manifest
 * @returns {{ kind: 'absent' | 'status' | 'marker' | 'conflict', text: string, detail: string }}
 */
export function describeCell(ch, dataset, manifest) {
  const isPool = dataset.classes.includes('available-pool');
  if (ch === '.') {
    if (dataset.coverageNote !== '') {
      return { kind: 'absent', text: 'not in this publication', detail: `Declared complete, but a verified observation says it omits records it claims to hold — absence is not evidence. ${dataset.coverageNote}` };
    }
    if (dataset.intendedComplete === true) {
      return { kind: 'absent', text: 'not in this publication', detail: 'Declared complete by the publisher — so absence is a lead, though a declaration is intent, not verified fact.' };
    }
    return { kind: 'absent', text: 'not in this publication', detail: 'This publication declared no completeness intent (or is partial), so absence is not evidence of anything.' };
  }
  if (ch === '?') return { kind: 'marker', text: isPool ? 'listed as available (not licensed)' : 'listed (this file carries no status column)', detail: '' };
  if (ch === '-') return { kind: 'marker', text: 'listed, with a blank status', detail: '' };
  if (ch === '!') return { kind: 'conflict', text: 'listed more than once — statuses disagree', detail: 'Rows in this one dataset assert different statuses. Both are kept; neither is picked as the winner — the ledger shows each row verbatim.' };
  const status = Object.hasOwn(manifest.legend.statuses, ch) ? manifest.legend.statuses[ch] : ch;
  return { kind: 'status', text: isPool ? `${status} (availability list)` : status, detail: '' };
}

// A dataset-level aside for a non-zero unkeyable-row count (issue #632):
// rows whose callsign cell, cleaned, carries no A-Z0-9/ character at all — a
// blank cell, or a punctuation-only token such as a literal ",,". They are
// carried faithfully in the dataset's own row count (ShardDataset.rows /
// .unkeyable together account for every row) and never dropped; they simply
// have no key to join a callsign lookup by, so this dataset row is the only
// place they become visible. Independent of which callsign was searched —
// every dataset row in the census table carries the same figure. Null when
// the dataset has none.
/**
 * @param {ShardDataset} dataset
 * @returns {{ count: number, noun: string } | null}
 */
export function unkeyableRowInfo(dataset) {
  if (dataset.unkeyable <= 0) return null;
  return { count: dataset.unkeyable, noun: dataset.unkeyable === 1 ? 'row' : 'rows' };
}

// First/last sightings and coverage counts, derived from the history string.
/**
 * @param {CallsignRecord} record
 * @param {ShardManifest} manifest
 * @returns {{ first: ShardDataset | null, last: ShardDataset | null, present: number, registerPresent: number }}
 */
export function seenSummary(record, manifest) {
  let first = null;
  let last = null;
  let present = 0;
  let registerPresent = 0;
  for (let i = 0; i < record.h.length; i += 1) {
    if (record.h[i] === '.') continue;
    const dataset = manifest.datasets[i];
    present += 1;
    if (dataset.classes.includes('register-snapshot')) registerPresent += 1;
    first ??= dataset;
    last = dataset;
  }
  return { first, last, present, registerPresent };
}

// The latest register-snapshot observation, resolved through the manifest's
// legend and vocabularies into display strings. Null when the callsign was
// never seen in a register-snapshot dataset.
/**
 * @param {CallsignRecord} record
 * @param {ShardManifest} manifest
 * @returns {{ dataset: ShardDataset, statuses: string[], products: string[], types: string[] } | null}
 */
export function latestSummary(record, manifest) {
  const l = record.l;
  if (l === undefined) return null;
  const dataset = manifest.datasets[l.d];
  if (dataset === undefined) return null;
  const statuses = (l.s ?? []).map(ch => Object.hasOwn(manifest.legend.statuses, ch) ? manifest.legend.statuses[ch] : ch);
  const products = (l.p ?? []).map(i => manifest.vocab.product[i] ?? '(unknown product)');
  const types = (l.t ?? []).map(i => manifest.vocab.type[i] ?? '(unknown type)');
  return { dataset, statuses, products, types };
}

// The cleaned-key twin conflict of the latest register snapshot, resolved for
// annotation (issue #633). The projection carries `tw` only when the latest
// register snapshot lists the cleaned form more than once; this resolves each
// row's status/product through the manifest, orders the format-normal form
// first (rule 1: the normal form leads the presentation), and classifies the
// two annotation axes - format normality and recency - WITHOUT adjudicating
// which row is right. Returns null when there is no twin group, or when the
// group agrees on status (a duplicate, not a conflict - no manufactured doubt).
//
// recency.kind:
//   'ordered'  every row is dated and one is unambiguously the most recent.
//   'tied'     every row is dated but they share the newest date.
//   'partial'  some rows are dated and some are not - undated is characteristic
//              of pool rows (Available/Reserved), so it is not staleness.
//   'none'     no row carries a date, so recency cannot order them.
/**
 * @param {CallsignRecord} record
 * @param {string} key
 * @param {ShardManifest} manifest
 * @returns {null | { snapshot: ShardDataset, variants: TwinVariantView[], normalitySplit: boolean, recency: { kind: 'ordered' | 'tied' | 'partial' | 'none', newest: TwinVariantView | null } }}
 */
export function twinConflict(record, key, manifest) {
  const tw = record.tw;
  const l = record.l;
  if (tw === undefined || tw.length < 2 || l === undefined) return null;
  const snapshot = manifest.datasets[l.d];
  if (snapshot === undefined) return null;

  /** @type {TwinVariantView[]} */
  const variants = tw.map(t => ({
    raw: t.r,
    normal: t.r === key,
    status: t.s !== undefined && Object.hasOwn(manifest.legend.statuses, t.s) ? manifest.legend.statuses[t.s] : '',
    product: t.p !== undefined ? (manifest.vocab.product[t.p] ?? null) : null,
    modified: t.m ?? '',
  }));

  // A conflict only where the rows assert DIFFERENT statuses; equal statuses are
  // a duplicate the "listed more than once" note already covers, and annotating
  // it would manufacture doubt where the register carries none.
  const statuses = new Set(variants.map(v => v.status).filter(s => s !== ''));
  if (statuses.size < 2) return null;

  // Normal-form primacy in presentation order (stable within each group).
  const ordered = [...variants].sort((a, b) => (a.normal === b.normal ? 0 : a.normal ? -1 : 1));
  const normalitySplit = variants.some(v => v.normal) && variants.some(v => !v.normal);

  const dated = ordered.filter(v => v.modified !== '');
  const undated = ordered.filter(v => v.modified === '');
  /** @type {'ordered' | 'tied' | 'partial' | 'none'} */
  let kind;
  /** @type {TwinVariantView | null} */
  let newest = null;
  if (dated.length === 0) {
    kind = 'none';
  } else if (undated.length > 0) {
    kind = 'partial';
  } else {
    const newestDate = dated.reduce((max, v) => (v.modified > max ? v.modified : max), dated[0].modified);
    const atNewest = dated.filter(v => v.modified === newestDate);
    if (atNewest.length === 1) { kind = 'ordered'; newest = atNewest[0]; }
    else kind = 'tied';
  }

  return { snapshot, variants: ordered, normalitySplit, recency: { kind, newest } };
}

// ---------------------------------------------------------------------------
// The live anatomy figure (issue #595): the record's precomputed components
// mapped onto the shared segments-driven renderer (site/callsign-pill.js — the
// same implementation behind the structure page's example figure), so the
// diagram always agrees with the decomposition the site attests elsewhere.
// Segmentation is NEVER re-derived here: the parts come from the build-time
// parser via the shard record, and they are accepted only when their
// concatenation reproduces the resolved key exactly — anything else renders
// the explicit "no confident decomposition" state, never a guess.

// The figure vocabulary: same colour tokens, names and plain-English meanings
// as the structure page's example, with links resolved for this page (site
// root). Fixed caller vocabulary — never register-derived bytes.
const FIGURE_PART_META = {
  prefix: { token: 'prefix', colourName: 'blue', shortLabel: 'Prefix', name: 'Prefix',
    meaning: 'The UK country block — G, M or 2, allocated by the ITU.',
    nameHref: 'callsign-structure.html#parts' },
  rsl: { token: 'rsl', colourName: 'green', shortLabel: 'RSL', name: 'Regional Secondary Locator',
    meaning: 'A nation letter after the first character.',
    nameHref: 'callsign-structure.html#rsl', glossaryHref: 'glossary.html#rsl' },
  digit: { token: 'digit', colourName: 'amber', shortLabel: 'Digit', name: 'Digit',
    meaning: 'A single number.',
    nameHref: 'callsign-structure.html#parts' },
  suffix: { token: 'suffix', colourName: 'red', shortLabel: 'Suffix', name: 'Suffix',
    meaning: 'The ending letters — the sense of “suffix” this site always means.',
    nameHref: 'callsign-structure.html#parts', glossaryHref: 'glossary.html#suffix' },
};

/**
 * The diagram's part list for one resolved record, or null when there is no
 * confident standard decomposition to draw. Null whenever the build-time
 * parser reported anything but a clean parse (visitor, special-event, empty,
 * unparseable — their shapes are not the prefix–digit–suffix diagram), and
 * whenever the components do not reassemble into the resolved key exactly
 * (defence in depth: a figure that does not spell the callsign is a guess,
 * and a guess is never drawn).
 * @param {string} key the resolved record key (the cleaned register form)
 * @param {NonNullable<CallsignRecord['a']>} a the record's parsed components
 * @returns {import('./callsign-pill.js').AnatomyPartSpec[] | null}
 */
export function anatomyFigureParts(key, a) {
  if (a.ps !== undefined) return null;
  const pre = a.pre ?? '';
  const sfx = a.sfx ?? '';
  const rsl = a.rsl ?? '';
  // A parsed prefix series is always one country letter plus one digit (M7,
  // G0, 20, …); anything else is not the shape this diagram draws.
  if (pre.length !== 2 || sfx === '') return null;
  if (pre[0] + rsl + pre[1] + sfx !== key) return null;
  /** @type {import('./callsign-pill.js').AnatomyPartSpec[]} */
  const parts = [{ ...FIGURE_PART_META.prefix, chars: pre[0] }];
  if (rsl !== '') parts.push({ ...FIGURE_PART_META.rsl, chars: rsl });
  parts.push({ ...FIGURE_PART_META.digit, chars: pre[1] });
  parts.push({ ...FIGURE_PART_META.suffix, chars: sfx });
  return parts;
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

/** @param {string | number} txt */
const b = (txt) => el('b', null, String(txt));

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
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  return node;
};

// A run of licence/status field-wrapper nodes joined by ' / ', for a summary
// line that may name more than one distinct value at once (e.g. a snapshot
// carrying two co-temporal raw variants with different statuses).
/**
 * @template O
 * @param {(el: typeof elAttrs, value: string, options?: O) => HTMLElement} field
 * @param {string[]} values
 * @param {O} [options]
 * @returns {(Node | string)[]}
 */
const joinedFields = (field, values, options) => values.flatMap((v, i) => i === 0 ? [field(elAttrs, v, options)] : [' / ', field(elAttrs, v, options)]);

// Render a raw register token with literal spaces/non-breaking spaces made
// visible (same marker the ledger uses), so a damaged form never renders as an
// invisible gap.
/**
 * @param {HTMLElement} parent
 * @param {string} str
 */
const appendRawToken = (parent, str) => {
  let run = '';
  const flush = () => { if (run) { parent.append(run); run = ''; } };
  for (const ch of str) {
    if (ch === ' ' || ch === ' ') { flush(); parent.append(el('span', 'nbsp', '␠')); }
    else run += ch;
  }
  flush();
  return parent;
};

/**
 * @param {string} href
 * @param {string} label
 */
const extLink = (href, label) => {
  const a = el('a', null, label);
  a.setAttribute('href', href);
  a.setAttribute('target', '_blank');
  a.setAttribute('rel', 'noopener');
  a.append(' ');
  const marker = el('span', 'ext-marker', '↗');
  marker.setAttribute('aria-hidden', 'true');
  a.appendChild(marker);
  a.appendChild(el('span', 'visually-hidden', ' (opens in a new tab)'));
  return a;
};

// The shared examine trail (issue #439): the compact claim → source →
// working → provenance walk, in the SAME vocabulary and classes as the
// server-rendered surfaces (src/ci/render/show-working.ts examineTrail) — one
// affordance across the site, not a third pattern. `lead` is '' where the
// surrounding context already says "examine" (e.g. a labelled working row).
/**
 * @param {{ href: string, label: string, external?: boolean, note?: string }[]} hops
 * @param {string} [lead]
 */
const examineTrailEl = (hops, lead = 'Examine') => {
  const span = el('span', 'examine-trail');
  if (lead !== '') span.appendChild(el('span', 'examine-lead', `${lead}:`));
  hops.forEach((hop, i) => {
    if (i > 0) {
      const sep = el('span', 'examine-sep', '·');
      sep.setAttribute('aria-hidden', 'true');
      span.append(' ', sep);
    }
    if (lead !== '' || i > 0) span.append(' ');
    if (hop.external === true) span.appendChild(extLink(hop.href, hop.label));
    else {
      const a = el('a', null, hop.label);
      a.setAttribute('href', hop.href);
      span.appendChild(a);
    }
    if (hop.note !== undefined) span.append(' ', el('span', 'examine-note', hop.note));
  });
  return span;
};

// Render a ledger-query.js prose segment list (plain text, links, verbatim raw
// tokens, monospace code) - the same shape FLAG_NOTES/NOTABLE_PARSE_STATUS
// glosses carry, so their wording renders here exactly as on the Ledger.
/**
 * @param {HTMLElement} parent
 * @param {Array<string | { link?: { text: string, href: string }, raw?: string, code?: string }>} segments
 */
const appendSegments = (parent, segments) => {
  for (const s of segments) {
    if (typeof s === 'string') { parent.append(s); continue; }
    if (s.link) {
      if (/^https?:/i.test(s.link.href)) { parent.appendChild(extLink(s.link.href, s.link.text)); }
      else { const a = el('a', null, s.link.text); a.setAttribute('href', s.link.href); parent.appendChild(a); }
      continue;
    }
    if (s.raw !== undefined) { parent.appendChild(appendRawToken(el('span', 'fid-code'), s.raw)); continue; }
    if (s.code !== undefined) { parent.appendChild(el('span', 'fid-code', s.code)); continue; }
  }
  return parent;
};

// ---------------------------------------------------------------------------
// Data access: the manifest once, shards on demand, both memoised. A fetch
// failure clears the memo so a later search retries instead of being stuck.

const DATA_BASE = 'callsign/data/';

/** @type {Promise<ShardManifest> | null} */
let manifestPromise = null;
/** @type {Map<string, Promise<{ json: { shard: string, callsigns: Record<string, CallsignRecord> }, bytes: number }>>} */
const shardCache = new Map();

/** @param {string} name */
async function fetchJson(name) {
  const res = await fetch(new URL(`${DATA_BASE}${name}`, document.baseURI).toString());
  if (!res.ok) throw new Error(`could not fetch ${name} (HTTP ${res.status})`);
  const text = await res.text();
  /** @type {unknown} */
  const json = JSON.parse(text);
  return { json, bytes: text.length };
}

/** @returns {Promise<ShardManifest>} */
function loadManifest() {
  manifestPromise ??= fetchJson('datasets.json')
    .then(r => /** @type {ShardManifest} */ (r.json))
    .catch(err => { manifestPromise = null; throw err; });
  return manifestPromise;
}

/** @param {string} name */
function loadShard(name) {
  let cached = shardCache.get(name);
  if (cached === undefined) {
    cached = fetchJson(`${name}.json`)
      .then(r => ({ json: /** @type {{ shard: string, callsigns: Record<string, CallsignRecord> }} */ (r.json), bytes: r.bytes }))
      .catch(err => { shardCache.delete(name); throw err; });
    shardCache.set(name, cached);
  }
  return cached;
}

// Resolve a typed callsign: clean it, fetch its shard, and - when the literal
// key misses - try the register's RSL-less core, so a regional rendering
// (MW7TEE) answers with the core record (M7TEE), exactly as the Ledger's
// placeholder hop does.
/**
 * @param {string} typed
 * @returns {Promise<Resolution>}
 */
export async function resolveCallsign(typed) {
  const cleaned = cleanCallsign(typed);
  const manifest = await loadManifest();
  const shardNames = new Set(manifest.shards);
  const shardName = shardNameFor(cleaned, shardNames);
  const shard = await loadShard(shardName);
  const direct = Object.hasOwn(shard.json.callsigns, cleaned) ? shard.json.callsigns[cleaned] : null;
  if (direct !== null) {
    return { typed, cleaned, key: cleaned, record: direct, viaRendering: false, shard: shardName, shardBytes: shard.bytes };
  }
  const core = canonicalCallsign(cleaned);
  if (core !== null && core !== cleaned) {
    const coreShardName = shardNameFor(core, shardNames);
    const coreShard = await loadShard(coreShardName);
    const coreRecord = Object.hasOwn(coreShard.json.callsigns, core) ? coreShard.json.callsigns[core] : null;
    if (coreRecord !== null) {
      return { typed, cleaned, key: core, record: coreRecord, viaRendering: true, shard: coreShardName, shardBytes: coreShard.bytes };
    }
  }
  return { typed, cleaned, key: null, record: null, viaRendering: false, shard: shardName, shardBytes: shard.bytes };
}

// ---------------------------------------------------------------------------
// Rendering.

/** @param {string} lab @param {(Node | string)[]} parts */
const drow = (lab, parts) => {
  const r = el('div', 'drow');
  r.appendChild(el('span', 'lab', lab));
  const v = el('span', 'val');
  for (const p of parts) v.append(p);
  r.appendChild(v);
  return r;
};

/**
 * @param {HTMLElement} host
 * @param {Resolution} res
 * @param {ShardManifest} manifest
 */
function renderGlance(host, res, manifest) {
  host.textContent = '';
  const record = res.record;
  const key = res.key;
  if (record === null || key === null) return;

  const card = el('div', 'entity');
  const head = el('div', 'entity-head');
  head.appendChild(el('div', 'id', key));
  const latest = latestSummary(record, manifest);
  const stat = el('div', 'stat');
  if (latest !== null) {
    // The shared field wrappers (#553/#625): the glance card shows only this
    // one summary line (never a repeated per-row column), so status uses the
    // default 'linked' crosslink, at the site root (depth 0). The established
    // "(no status recorded)" wording is pinned as the blank label.
    const statusVal = el('b');
    statusVal.append(...(latest.statuses.length > 0
      ? joinedFields(statusField, latest.statuses, { depthToRoot: 0 })
      : [statusField(elAttrs, '', { blankLabel: '(no status recorded)', depthToRoot: 0 })]));
    stat.append(statusVal);
    if (latest.products.length > 0) { stat.append(' · '); stat.append(...joinedFields(licenceField, latest.products)); }
    stat.append(` · latest register snapshot ${latest.dataset.vintage ?? '(vintage unknown)'}`);
  } else {
    stat.append('never seen in a register snapshot we hold');
  }
  head.appendChild(stat);
  card.appendChild(head);

  const body = el('div');
  body.style.padding = '16px 18px';

  if (res.viaRendering) {
    const note = el('p', 'obs-mini');
    note.style.margin = '0 0 6px';
    note.append(`"${res.cleaned}" is a regional rendering; the register stores the core record ${key} (the `);
    const a = el('a', null, 'Regional Secondary Locator');
    a.setAttribute('href', 'callsign-structure.html');
    note.append(a, ' travels separately).');
    body.appendChild(note);
  }

  if (latest !== null) {
    const statusParts = latest.statuses.length > 0
      ? joinedFields(statusField, latest.statuses, { depthToRoot: 0 })
      : [statusField(elAttrs, '', { blankLabel: '(no status recorded)', depthToRoot: 0 })];
    const statusVal = el('b');
    statusVal.append(...statusParts);
    body.appendChild(drow('status', [statusVal,
      latest.statuses.length > 1 ? ' — more than one row in that snapshot; see the notes below' : '']));
    const productParts = latest.products.length > 0
      ? joinedFields(licenceField, latest.products)
      : [licenceField(elAttrs, '', { blankLabel: '(no product recorded — many legitimate allocations carry a blank product)' })];
    body.appendChild(drow('product', productParts));
    if (latest.types.length > 0) body.appendChild(drow('type', [latest.types.join(' / ')]));
    const datasetLink = el('a', null, latest.dataset.title);
    datasetLink.setAttribute('href', latest.dataset.href);
    // Only append the vintage when the dataset's title does not already carry
    // it (the open-data titles do; the FOI entry keys often do not).
    const vintage = latest.dataset.vintage ?? 'vintage unknown';
    body.appendChild(drow('recorded in', latest.dataset.title.includes(vintage) ? [datasetLink] : [datasetLink, ` (${vintage})`]));
  } else {
    const seen = seenSummary(record, manifest);
    body.appendChild(drow('register state', [
      'This callsign appears in ', b(seen.present), ` archived dataset${seen.present === 1 ? '' : 's'}, none of them a register snapshot — `
      + 'typically an availability list (offered as available, i.e. not licensed, at that date). '
      + 'That tells you nothing about its state today.']));
  }

  const dates = record.d;
  if (dates !== undefined) {
    if (dates.o !== undefined) body.appendChild(drow('original start', [b(dates.o), ' — as published (the licence version’s original start date)']));
    if (dates.c !== undefined) body.appendChild(drow('created', [dates.c, ' — the register row’s own created stamp, as published']));
    if (dates.m !== undefined) body.appendChild(drow('modified', [dates.m, ' — the register row’s own last-modified stamp, as published']));
  }

  const seen = seenSummary(record, manifest);
  if (seen.first !== null && seen.last !== null) {
    body.appendChild(drow('in view', [
      b(seen.first.vintage ?? '?'), ' → ', b(seen.last.vintage ?? '?'),
      ` · present in ${seen.present} of ${manifest.counts.datasets} archived datasets (${seen.registerPresent} register snapshot${seen.registerPresent === 1 ? '' : 's'})`,
    ]));
  }

  // The report-this affordance (issue #439): a calm, always-present invitation
  // to report a suspected problem or examine this record further, pre-filled
  // with this callsign and the exact page so a report is located to its hop.
  // Mirrors the server-rendered affordance (src/ci/render/report.ts) on the
  // dataset and forbidden-suffix pages.
  const report = el('p', 'report-affordance');
  const pageUrl = typeof location === 'undefined' ? '' : location.href;
  report.appendChild(extLink(reportIssueUrl(key, { surface: 'the per-callsign page', pageUrl }), 'Report or examine this record'));
  report.append(' — opens a pre-filled GitHub issue naming this callsign and page. A report is an observation for investigation, not a verdict. ');
  const reportingLink = el('a', null, 'What happens to a report');
  reportingLink.setAttribute('href', 'fidelity.html#reporting');
  report.append(reportingLink, '.');
  body.appendChild(report);

  card.appendChild(body);
  host.appendChild(card);
}

/**
 * The anatomy figure slot (#anatomy-figure): the viewed callsign's own
 * labelled, colour-grouped diagram, or the explicit no-decomposition state.
 * The slot is a progressive enhancement over the textual components list
 * (renderAnatomy below), which remains the JS-free baseline.
 * @param {HTMLElement} host
 * @param {Resolution} res
 */
function renderAnatomyFigure(host, res) {
  host.textContent = '';
  const record = res.record;
  const key = res.key;
  if (record === null || key === null) { host.hidden = true; return; }

  const parts = anatomyFigureParts(key, record.a ?? {});
  if (parts === null) {
    // Fail loud but friendly: name the shape the parser DID read where it read
    // one, and never draw a fabricated segmentation.
    const ps = record.a?.ps;
    const note = el('p', 'muted');
    if (ps === 'visitor') {
      note.append('No diagram: this is a visitor/reciprocal form — M/ followed by the visitor’s own home '
        + 'callsign — not the prefix–digit–suffix shape this diagram draws. The components below show what '
        + 'the parser did read.');
    } else if (ps === 'special-event') {
      note.append('No diagram: this is a special-event GB form, outside the prefix–digit–suffix shape this '
        + 'diagram draws. The components below show what the parser did read.');
    } else {
      note.append('No confident decomposition: the parser could not read this as a standard UK callsign, so '
        + 'no diagram is drawn — a guessed segmentation would be worse than none. The form is kept exactly '
        + 'as published.');
    }
    host.appendChild(note);
    host.hidden = false;
    return;
  }

  // The one deliberate innerHTML on this page: the markup comes from the
  // shared renderer, which HTML-escapes every interpolated value, and the
  // segments above are accepted only when they reassemble the cleaned key
  // (alphabet A–Z 0–9 /) exactly — so register bytes cannot smuggle markup.
  host.innerHTML = anatomyFigureHtml({
    parts,
    idPrefix: 'anat',
    titleText: `Anatomy of the callsign ${key}`,
    descLead: `The callsign ${key}`,
    figcaptionLead: `The parts of ${key}, as read by the build-time parser`,
    display: key,
  });
  host.hidden = false;
}

/**
 * @param {HTMLElement} host
 * @param {Resolution} res
 * @param {ShardManifest} manifest
 */
function renderAnatomy(host, res, manifest) {
  host.textContent = '';
  const record = res.record;
  const key = res.key;
  if (record === null || key === null) return;
  const a = record.a ?? {};

  const sec = el('div', 'dsec');
  if (a.ps !== undefined) {
    const note = el('p', 'muted');
    note.append(`Our parser could not read this as a standard UK callsign (parse status: ${a.ps}). `
      + 'It is kept exactly as published rather than reshaped into a guess.');
    sec.appendChild(note);
  }
  if (a.pre !== undefined) {
    // The shared prefix-series field wrapper (#644/#658): fixes a genuine
    // divergence this row carried before - the bare stored value (M7) was
    // shown as-is, with no `#` RSL-slot marker, unlike every other surface's
    // "M#7" display convention - and adds the family's `cs cs-pfx` classes.
    const seriesField = prefixSeriesField(elAttrs, a.pre, { link: { depthToRoot: 0 } });
    sec.appendChild(drow('prefix series', [seriesField, ' — the letters-and-digit block that implies the licence level']));
  }
  if (a.rsl !== undefined) {
    const rslLink = el('a', null, a.rsl);
    rslLink.setAttribute('href', 'callsign-structure.html');
    sec.appendChild(drow('RSL', [rslLink, ' — Regional Secondary Locator, shown in this register form (usually the register stores the core without it)']));
  }
  if (a.sfx !== undefined) {
    // The shared suffix field wrapper (#644/#658): odd-character transparency
    // plus the family's `cs cs-sfx` classes, in place of a plain bold span. The
    // per-suffix detail page link is opt-in ONLY when this callsign's own
    // suffix is actually on the forbidden list (record.f), matching the same
    // guard renderLinks below already applies - a suffix with no such page
    // never gets a fabricated link.
    const suffixOptions = (record.f ?? []).includes('forbidden-suffix') ? { link: { depthToRoot: 0 } } : {};
    sec.appendChild(drow('suffix', [suffixField(elAttrs, a.sfx, suffixOptions), ' — the callsign’s personal tail']));
  }
  if (a.hc !== undefined) sec.appendChild(drow('home callsign', [b(a.hc), ' — this is a visitor/reciprocal entry: M/ then the visitor’s own callsign']));
  if (a.ph !== undefined) {
    sec.appendChild(drow('placeholder form', [el('span', 'fid-code', a.ph), ' — the # marks the RSL slot; every regional rendering collapses to this one key']));
  }
  if (a.ic !== undefined) {
    const cls = manifest.vocab.impliedClass[a.ic] ?? '(unknown)';
    const clsLink = el('a', null, cls);
    clsLink.setAttribute('href', 'glossary.html#licence-class');
    // The shared LICENCE_CLASS hook (#553/#625) is carried here for consistent
    // styling, alongside - not instead of - this row's own established link
    // straight to the licence-class AXIS anchor: a deliberate divergence from
    // licenceField's usual no-auto-link behaviour, since this is the one row
    // that already exists to explain what "implied class" means.
    const clsWrap = el('span', LICENCE_CLASS);
    clsWrap.appendChild(clsLink);
    sec.appendChild(drow('implied class', [clsWrap, ' — read from the prefix series via the reference tables; a best-effort derivation, not a register assertion']));
  }
  if (Object.keys(a).length === 0) {
    sec.appendChild(el('p', 'muted', 'No components could be read from this form.'));
  }
  host.appendChild(sec);
}

/**
 * @param {HTMLElement} host
 * @param {Resolution} res
 * @param {ShardManifest} manifest
 */
function renderHistory(host, res, manifest) {
  host.textContent = '';
  const record = res.record;
  if (record === null) return;

  const table = el('table', 'census');
  table.setAttribute('aria-label', 'Sightings per archived dataset, oldest first');
  const thead = el('thead');
  const hr = el('tr');
  for (const h of ['Vintage', 'Dataset', 'What it records']) hr.appendChild(el('th', null, h));
  thead.appendChild(hr);
  table.appendChild(thead);
  const tbody = el('tbody');
  const multi = new Set(record.m ?? []);
  for (let i = 0; i < record.h.length; i += 1) {
    const dataset = manifest.datasets[i];
    if (dataset === undefined) continue;
    const cell = describeCell(record.h[i], dataset, manifest);
    const tr = el('tr');
    if (cell.kind === 'absent') tr.className = 'muted';
    tr.appendChild(el('td', 'n', dataset.vintage ?? '(unknown)'));
    const dsTd = el('td');
    const dsLink = el('a', null, dataset.title);
    dsLink.setAttribute('href', dataset.href);
    dsTd.appendChild(dsLink);
    dsTd.append(` — ${datasetClassLabel(dataset)}`);
    const unkeyable = unkeyableRowInfo(dataset);
    if (unkeyable !== null) {
      dsTd.append(' · ');
      const unkeyableLink = el('a', null, `${unkeyable.count.toLocaleString('en-GB')} unkeyable ${unkeyable.noun}`);
      unkeyableLink.setAttribute('href', 'glossary.html#unkeyable-row');
      dsTd.appendChild(unkeyableLink);
      dsTd.append(' (blank or punctuation-only callsign cell — carried here, but not addressable by callsign)');
    }
    tr.appendChild(dsTd);
    const whatTd = el('td');
    if (cell.kind === 'status') whatTd.appendChild(b(cell.text));
    else whatTd.append(cell.text);
    if (multi.has(i) && cell.kind !== 'conflict') whatTd.append(' · listed more than once');
    if (cell.detail !== '') whatTd.setAttribute('title', cell.detail);
    tr.appendChild(whatTd);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  host.appendChild(table);

  const note = el('p', 'obs-mini');
  note.append('Gaps between publications can hide intermediate states, and a status change can be surrender, '
    + 'progression or the holder’s death — the register does not say which. Hover an absent row for how its '
    + 'absence should be read.');
  host.appendChild(note);
}

// One label/value line inside a "show the working" panel (the ledger's row2
// idiom, reused so the two surfaces read as one component).
/** @param {string} lab @param {Node | string} value */
const workRow = (lab, value) => {
  const r = el('div', 'fid-work-row');
  r.appendChild(el('span', 'k', lab));
  const v = el('span', 'v');
  if (typeof value === 'string') v.textContent = value; else v.appendChild(value);
  r.appendChild(v);
  return r;
};

// A short human phrase for one twin variant's licence state: its status and,
// where the register carries one, its product.
/** @param {TwinVariantView} v */
function variantStatePhrase(v) {
  const status = v.status !== '' ? v.status : '(no status recorded)';
  return v.product !== null && v.product !== '' ? `${status} (${v.product})` : status;
}

// The cleaned-key twin-conflict annotation card (issue #633): a derived-claim
// note that ADDS format-normality and recency context to a within-snapshot
// status conflict without ever downgrading the conflict or picking a winner.
// The gloss leads with the user-meaningful fact (rule 3), the recency line
// shows its working from the register's own dates (rule 2, with the pool-row
// caveat), and a "show the working" panel exposes every row verbatim with
// linkable evidence (rule 5).
/**
 * @param {NonNullable<ReturnType<typeof twinConflict>>} conflict
 * @param {string} key
 */
function twinConflictCard(conflict, key) {
  const { snapshot, variants, normalitySplit, recency } = conflict;
  const vintage = snapshot.vintage ?? 'an undated snapshot';
  const abnormal = variants.filter(v => !v.normal);
  const normal = variants.filter(v => v.normal);
  const abnormalActive = abnormal.filter(v => v.status === 'Allocated');
  const normalActive = normal.some(v => v.status === 'Allocated');
  const inversion = normalitySplit && abnormalActive.length > 0 && !normalActive;

  const label = inversion
    ? 'A non-standard spelling holds the active licence'
    : normalitySplit
      ? 'The written forms differ in format and status'
      : 'Two written forms disagree on status';

  const card = el('div', 'flagcard fid-note');
  const head = el('div', 'fid-note-head');
  head.appendChild(el('span', 'fn', label));
  head.appendChild(el('span', 'tb d', 'derived'));
  card.appendChild(head);

  const gloss = el('div', 'fg');

  // Normality annotation (rule 3): lead with the fact that the abnormal
  // variant(s) carry the attributes they carry, then the canonical form's.
  if (normalitySplit) {
    gloss.append(`In the latest register snapshot (${vintage}), `);
    abnormal.forEach((v, i) => {
      if (i > 0) gloss.append(i === abnormal.length - 1 ? ' and ' : ', ');
      gloss.append('the variant ');
      gloss.appendChild(appendRawToken(el('span', 'fid-code'), v.raw));
      gloss.append(` — a non-standard spelling — is listed ${variantStatePhrase(v)}`);
    });
    gloss.append(', while the canonical form ');
    gloss.appendChild(el('span', 'fid-code', key));
    const normalStates = [...new Set(normal.map(variantStatePhrase))];
    gloss.append(` is listed ${normalStates.length > 0 ? normalStates.join(' / ') : '(no status recorded)'}. `);
  } else {
    // No format split: two same-shaped forms simply disagree. State it plainly.
    const states = variants.map(v => variantStatePhrase(v));
    gloss.append(`In the latest register snapshot (${vintage}), two rows of this callsign disagree on status (${states.join(' vs ')}). `);
  }

  // Recency annotation (rule 2), with its working shown from the register's own
  // dates and the pool-row caveat where a row is undated.
  if (recency.kind === 'ordered' && recency.newest !== null) {
    const others = variants.filter(v => v !== recency.newest);
    gloss.append('By the register’s own last-modified dates, the most recently modified row is ');
    gloss.appendChild(appendRawToken(el('span', 'fid-code'), recency.newest.raw));
    gloss.append(` (modified ${recency.newest.modified}), listed ${variantStatePhrase(recency.newest)}`);
    const olderDates = others.map(v => v.modified).filter(d => d !== '');
    if (olderDates.length > 0) gloss.append(`; the other row was last modified ${olderDates.join(', ')}`);
    gloss.append('. ');
  } else if (recency.kind === 'tied') {
    const date = variants.find(v => v.modified !== '')?.modified ?? '';
    gloss.append(`Both rows carry the same last-modified date (${date}), so recency does not order them. `);
  } else if (recency.kind === 'partial') {
    const dated = variants.filter(v => v.modified !== '');
    const undated = variants.filter(v => v.modified === '');
    gloss.append(`Only the ${dated.length > 1 ? 'rows' : 'row'} `);
    dated.forEach((v, i) => { if (i > 0) gloss.append(', '); gloss.appendChild(appendRawToken(el('span', 'fid-code'), v.raw)); });
    const datedDates = [...new Set(dated.map(v => v.modified))];
    gloss.append(` carr${dated.length > 1 ? 'y' : 'ies'} a last-modified date (${datedDates.join(', ')}); the `);
    undated.forEach((v, i) => { if (i > 0) gloss.append(', '); gloss.appendChild(appendRawToken(el('span', 'fid-code'), v.raw)); });
    gloss.append(` ${undated.length > 1 ? 'rows are' : 'form is'} undated. Undated rows are characteristic of pool entries `
      + '(Available/Reserved), so the missing date is not evidence of staleness. ');
  } else {
    gloss.append('Neither row carries a last-modified date, so recency cannot order them. ');
  }

  // The conflict is never resolved here; the annotation only adds context.
  gloss.append('Both rows are kept exactly as published; neither is treated as the winner. The ');
  const ledgerA = el('a', null, 'ledger shows each one verbatim');
  ledgerA.setAttribute('href', `ledger.html?c=${encodeURIComponent(key)}`);
  gloss.append(ledgerA, '.');
  card.appendChild(gloss);

  // Show the working (rule 5): the derived claim's inputs - each row verbatim
  // with its status, product and date - and linkable evidence (the snapshot and
  // the ledger). A native <details>, so it works with JavaScript off.
  const why = el('details', 'fid-why');
  const summary = el('summary');
  summary.append('Show the working');
  why.appendChild(summary);
  const work = el('div', 'fid-work');
  const snapLink = el('a', null, snapshot.title);
  snapLink.setAttribute('href', snapshot.href);
  work.appendChild(workRow('snapshot', snapLink));
  variants.forEach((v, i) => {
    const val = el('span');
    appendRawToken(val, v.raw);
    val.append(` — ${v.normal ? 'canonical form' : 'non-standard spelling'} · ${variantStatePhrase(v)}`
      + (v.modified !== '' ? ` · modified ${v.modified}` : ' · undated'));
    work.appendChild(workRow(`row ${i + 1}`, val));
  });
  // The examine hops, in the shared trail vocabulary (issue #439): the
  // snapshot entry is the provenance context, the ledger reconstructs the
  // working byte by byte. The row label already says "examine", so the trail
  // carries no lead of its own.
  const seen = el('div', 'fid-work-row');
  seen.appendChild(el('span', 'k', 'examine'));
  const seenV = el('span', 'v');
  seenV.appendChild(examineTrailEl([
    { href: snapshot.href, label: 'the snapshot entry (provenance)' },
    { href: `ledger.html?c=${encodeURIComponent(key)}`, label: 'the ledger, byte by byte' },
  ], ''));
  seen.appendChild(seenV);
  work.appendChild(seen);
  why.appendChild(work);
  card.appendChild(why);

  return card;
}

/**
 * @param {HTMLElement} host
 * @param {HTMLElement} panel
 * @param {Resolution} res
 * @param {ShardManifest} manifest
 */
function renderNotes(host, panel, res, manifest) {
  host.textContent = '';
  const record = res.record;
  const key = res.key;
  if (record === null || key === null) { panel.hidden = true; return; }

  /** @type {HTMLElement[]} */
  const cards = [];
  /** @param {string} label @param {(note: HTMLElement) => void} fill */
  const addCard = (label, fill) => {
    const card = el('div', 'flagcard');
    card.appendChild(el('div', 'fn', label));
    const gloss = el('div', 'fg');
    fill(gloss);
    card.appendChild(gloss);
    cards.push(card);
  };

  // The twin-conflict annotation leads the notes: it is the most salient
  // observation when the latest snapshot lists the cleaned form more than once
  // with disagreeing statuses (issue #633).
  const conflict = twinConflict(record, key, manifest);
  if (conflict !== null) cards.push(twinConflictCard(conflict, key));

  for (const flag of record.f ?? []) {
    const meta = Object.hasOwn(FLAG_NOTES, flag) ? FLAG_NOTES[/** @type {keyof typeof FLAG_NOTES} */ (flag)] : { label: flag, gloss: [] };
    addCard(meta.label, gloss => appendSegments(gloss, meta.gloss));
  }

  const ps = record.a?.ps;
  if (ps !== undefined && Object.hasOwn(NOTABLE_PARSE_STATUS, ps)) {
    const meta = NOTABLE_PARSE_STATUS[/** @type {keyof typeof NOTABLE_PARSE_STATUS} */ (ps)];
    addCard(meta.label, gloss => appendSegments(gloss, meta.gloss));
  }

  const forms = record.v ?? [];
  if (forms.length > 0) {
    addCard('Published in more than one written form', gloss => {
      gloss.append('Across the archived publications this callsign also appears as: ');
      forms.forEach((form, i) => {
        if (i > 0) gloss.append(' · ');
        gloss.appendChild(appendRawToken(el('span', 'fid-code'), form));
      });
      gloss.append(' (');
      const inv = el('a', null, 'invisible characters shown');
      inv.setAttribute('href', 'invisible-characters.html');
      gloss.append(inv, '). Each form is kept verbatim, with provenance, on the ');
      const ledgerA = el('a', null, 'ledger');
      ledgerA.setAttribute('href', `ledger.html?c=${encodeURIComponent(key)}`);
      gloss.append(ledgerA, ' — we never quietly pick a single winner.');
    });
  }

  const multi = record.m ?? [];
  if (multi.length > 0) {
    const conflicts = multi.filter(i => record.h[i] === '!').length;
    addCard(`Listed more than once in ${multi.length} dataset${multi.length === 1 ? '' : 's'}`, gloss => {
      gloss.append('The same cleaned form appears on more than one row of those publications — a duplicate, '
        + 'or a damaged twin alongside the clean form. ');
      if (conflicts > 0) gloss.append(`In ${conflicts} of them the rows disagree on status (the ‘!’ rows above). `);
      gloss.append('Both rows are always kept; the ');
      const ledgerA = el('a', null, 'ledger shows each one verbatim');
      ledgerA.setAttribute('href', `ledger.html?c=${encodeURIComponent(key)}`);
      gloss.append(ledgerA, '.');
    });
  }

  if (cards.length === 0) { panel.hidden = true; return; }

  const preamble = el('p', 'fid-preamble');
  preamble.append('These notes describe what the official register — published by Ofcom, the UK regulator — '
    + 'actually recorded, and where. They are observations, not judgements: a callsign can belong to different '
    + 'people at different times, and nothing here changes any record.');
  host.appendChild(preamble);
  for (const card of cards) host.appendChild(card);

  // The examine trail for the notes (issue #439): the shared walk from these
  // observations to the evidence behind them. The ledger folds
  // register-snapshot publications only, so its working hop is offered ONLY
  // when this record was seen in one; otherwise the trail degrades honestly to
  // the recording dataset entry's provenance — never a link to a working that
  // does not exist there.
  const seen = seenSummary(record, manifest);
  const latest = latestSummary(record, manifest);
  /** @type {{ href: string, label: string, external?: boolean, note?: string }[]} */
  const hops = [];
  if (seen.registerPresent > 0) {
    hops.push({ href: `ledger.html?c=${encodeURIComponent(key)}`, label: 'the working behind each derived value (ledger)' });
  }
  const entryDataset = latest !== null ? latest.dataset : seen.last;
  if (entryDataset !== null) {
    hops.push({
      href: entryDataset.href,
      label: entryDataset.vintage !== null
        ? `the ${entryDataset.vintage} dataset entry (provenance)`
        : 'the dataset entry that recorded it (provenance)',
    });
  }
  hops.push({ href: 'fidelity.html#show-working', label: 'how workings are reconstructed' });
  const trail = el('p', 'examine-under');
  trail.appendChild(examineTrailEl(hops));
  host.appendChild(trail);

  // The report-this affordance rides in the record's context block (renderGlance)
  // so it is present for every resolved record, not only a flagged one; the
  // notes panel therefore carries no separate report link (issue #439).
  panel.hidden = false;
}

/**
 * @param {HTMLElement} host
 * @param {Resolution} res
 */
function renderLinks(host, res) {
  host.textContent = '';
  const target = res.key ?? res.cleaned;
  /** @param {string} href @param {string} label @param {string} detail */
  const add = (href, label, detail) => {
    const li = el('li');
    const a = el('a', null, label);
    a.setAttribute('href', href);
    li.append(a, ` — ${detail}`);
    host.appendChild(li);
  };
  if (target !== '') {
    add(`ledger.html?c=${encodeURIComponent(target)}`, 'Full provenance & timeline (Ledger)',
      'every raw byte, every derivation rule and every source row behind this record, queried live');
    add(`index.html?c=${encodeURIComponent(target)}`, 'Database lookup',
      'reference joins, regional variants, FOI history and the suffix availability matrix');
  }
  const record = res.record;
  if (record?.a?.pre !== undefined) {
    add(`series/${encodeURIComponent(record.a.pre)}.html`, `Prefix series ${record.a.pre}`,
      'what this series means, its issuance status and its place in the register');
  }
  if ((record?.f ?? []).includes('forbidden-suffix') && record?.a?.sfx !== undefined) {
    add(`forbidden/suffix/${encodeURIComponent(record.a.sfx)}/index.html`, `Withheld suffix ${record.a.sfx}`,
      'when this suffix was first seen withheld from new issues, and every callsign carrying it');
  }
  add('callsign-structure.html', 'Callsign anatomy explainer', 'how UK callsign formats are put together');
  add('glossary.html', 'Glossary', 'what “Allocated”, “Reserved”, “available” and the rest actually mean');
}

/**
 * @param {HTMLElement} host
 * @param {Resolution} res
 * @param {ShardManifest} manifest
 */
function renderMiss(host, res, manifest) {
  host.textContent = '';
  if (res.record !== null) return;
  const spanFirst = manifest.datasets[0]?.vintage ?? '?';
  const spanLast = manifest.datasets[manifest.datasets.length - 1]?.vintage ?? '?';
  const callout = el('div', 'callout');
  callout.append(`No record for "${res.cleaned !== '' ? res.cleaned : res.typed}" in any of the `
    + `${manifest.counts.datasets} archived datasets this mirror holds (${spanFirst} → ${spanLast}). `
    + 'Absence in this mirror is not evidence about the register itself: the register does not list every '
    + 'un-issued callsign — only those Ofcom has had reason to record — and this mirror holds only what has '
    + 'been published or disclosed. In particular it is ');
  callout.appendChild(b('not'));
  callout.append(' proof the callsign is free (see ');
  const availA = el('a', null, 'what “available” means');
  availA.setAttribute('href', 'glossary.html#available');
  callout.append(availA, '). The ');
  const lookupA = el('a', null, 'database lookup');
  lookupA.setAttribute('href', `index.html?c=${encodeURIComponent(res.cleaned !== '' ? res.cleaned : res.typed)}`);
  callout.append(lookupA, ' can also check the suffix across every prefix series.');
  host.appendChild(callout);
}

// ---------------------------------------------------------------------------
// Orchestration.

/**
 * Run one lookup end to end and render every panel. Exported for the jsdom
 * test, which drives it with stubbed fetches.
 * @param {string} typed
 * @returns {Promise<Resolution>}
 */
export async function runLookup(typed) {
  const started = performance.now();
  const manifest = await loadManifest();
  const res = await resolveCallsign(typed);
  const hosts = {
    result: document.getElementById('result'),
    anatomyFigure: document.getElementById('anatomy-figure'),
    anatomy: document.getElementById('anatomy'),
    history: document.getElementById('history'),
    notes: document.getElementById('notes'),
    notesPanel: document.getElementById('notes-panel'),
    links: document.getElementById('links'),
    miss: document.getElementById('miss'),
  };
  if (hosts.miss) renderMiss(hosts.miss, res, manifest);
  if (hosts.result) renderGlance(hosts.result, res, manifest);
  if (hosts.anatomyFigure) renderAnatomyFigure(hosts.anatomyFigure, res);
  if (hosts.anatomy) renderAnatomy(hosts.anatomy, res, manifest);
  if (hosts.history) renderHistory(hosts.history, res, manifest);
  if (hosts.notes && hosts.notesPanel) renderNotes(hosts.notes, hosts.notesPanel, res, manifest);
  if (hosts.links) renderLinks(hosts.links, res);
  const elapsed = Math.max(1, Math.round(performance.now() - started));
  const status = document.getElementById('lookup-status');
  if (status) {
    const sizeKb = (res.shardBytes / 1024).toFixed(1);
    status.textContent = res.record !== null
      ? `Answered ${res.key ?? res.cleaned} from one ${sizeKb} KB shard (${res.shard}.json) in ${elapsed} ms — no database involved.`
      : `No record found — checked shard ${res.shard}.json (${sizeKb} KB) in ${elapsed} ms.`;
  }
  for (const chip of document.querySelectorAll('#resolver .chip')) {
    chip.setAttribute('aria-pressed', String(chip instanceof HTMLElement && chip.dataset.cs === typed));
  }
  return res;
}

function initCallsignPage() {
  const alertEl = document.getElementById('lookup-alert');
  const statusEl = document.getElementById('lookup-status');
  /** @param {string} value */
  const runSearch = async (value) => {
    if (statusEl) statusEl.textContent = `Fetching ${value}…`;
    if (alertEl) alertEl.hidden = true;
    try {
      await runLookup(value);
    } catch (err) {
      if (statusEl) statusEl.textContent = '';
      if (alertEl) {
        alertEl.textContent = `Could not fetch the callsign data (${err instanceof Error ? err.message : String(err)}). `
          + 'This page needs its static data files; try again, or use the database-backed Lookup or Ledger pages.';
        alertEl.hidden = false;
      }
    }
  };
  // The Ledger's search wiring is deliberately dependency-injected and id-based
  // (#lookup-form / #callsign-input / #resolver, ?c=/?callsign= deep links,
  // back/forward replay), so this page reuses it wholesale.
  wireLedgerSearch({ doc: document, win: window, runSearch });
}

if (typeof document !== 'undefined' && document.querySelector('main[data-page="callsign"]') !== null) {
  initCallsignPage();
}
