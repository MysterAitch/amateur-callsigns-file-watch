// @ts-check
// Browser query layer for the raw-keyed claim-ledger database (issue #361,
// Stage 3a). It plays the same role for the claim ledger that app.js's opener
// plays for the lookup database: it opens the shipped SQLite `.png` costume
// over sql.js-httpvfs (range requests, no whole-file download) and exposes the
// handful of read-only queries the ledger page needs.
//
// The module is split in two, deliberately:
//   - The SHAPING helpers (cleanCallsign, foldObservations, anatomyOf, flagsOf,
//     and the async resolve/claims queries) are pure with respect to an injected
//     `query(sql, params)` executor and touch no DOM, so they are unit-testable
//     in Node against a built claim-ledger SQLite (node:sqlite as the executor).
//   - openLedgerQuery() is the browser-only half: it builds the httpVFS worker
//     and returns a `query` bound to it. It is never reached in tests.
//
// The claim table it hits is the one build-ledger-db.ts ships:
//   claims(layer, raw_subject, cleaned, entity, predicate, object, rule,
//          source_file, ordinal, vintage)
// indexed on entity / cleaned / raw_subject / predicate. `cleaned` is the
// human-readable direct-lookup key (a typed literal callsign matches it in one
// indexed hop); `entity` is the RSL-less placeholder unification key every
// regional rendering collapses to. Everything here is a SELECT; the database is
// served read-only over the range-request VFS and is never written.

import { placeholderOf } from './browser-query.js';

// One flat row of the shipped `claims` table (or the compact builder's `claims`
// VIEW), exactly as the SELECTs here read it back. `rule` names the derivation
// rule on derived claims and reads back null on the raw layer.
/**
 * @typedef {object} ClaimRow
 * @property {string} layer
 * @property {string} raw_subject
 * @property {string} cleaned
 * @property {string} entity
 * @property {string} predicate
 * @property {string} object
 * @property {string | null} rule
 * @property {string} source_file
 * @property {number} ordinal
 * @property {string} vintage
 */

// The injected read-only SQL executor the shaping helpers run against: the
// browser half binds it to the httpvfs worker (async), the tests bind it to
// node:sqlite (sync). Rows are untyped at the driver boundary - each caller
// states the shape its own SELECT returns - so the row type is any[] here,
// exactly once, rather than a per-call cast.
/** @typedef {(sql: string, params?: unknown[]) => Promise<any[]> | any[]} QueryExecutor */

// resolveEntity's answer: how (and whether) a typed value resolved to a ledger
// entity. `entity` is null and `matched` is 'none' on an honest miss.
/**
 * @typedef {object} ResolvedEntity
 * @property {string} typed
 * @property {string} cleaned
 * @property {string | null} entity
 * @property {'cleaned' | 'placeholder' | 'none'} matched
 */

// One register observation after the per-row fold: a (vintage, source row)
// group of raw claims collapsed to the fields the timeline reads. classCanon /
// lastModified / created are intentionally blank for now (see STATUS_PREDICATES).
/**
 * @typedef {object} Observation
 * @property {string} vintage
 * @property {string} rawToken
 * @property {string} status
 * @property {string | null} classCanon
 * @property {string} lastModified
 * @property {string} created
 */

// One per-variant timeline entry within a vintage. `role` is stamped in a second
// pass, once the vintage's full variant list is known (solo / active / parallel).
/**
 * @typedef {object} TimelineEntry
 * @property {string | null} variant
 * @property {string} status
 * @property {boolean} active
 * @property {{ cls: string, t: string }[]} evs
 * @property {string} [role]
 */

// One "where it was seen" source reference: the observation rows that carried a
// raw token, de-duplicated to (source file, ordinal, vintage).
/** @typedef {{ sourceFile: string, ordinal: number, vintage: string }} SourceRef */

// A piece of note/gloss prose. A plain string is literal text; the object forms
// carry an inline link, a verbatim raw token (invisible characters shown), or a
// monospace code value. Modelled as one optional-property shape so a renderer
// probes `s.link` / `s.raw` / `s.code` directly (see segmentsText).
/** @typedef {string | { link?: { text: string, href: string }, raw?: string, code?: string }} Segment */

// The shipped database's costume name. The `.png` extension is the same
// deliberate lie app.js tells the CDN: GitHub Pages gzip-transcodes text-like
// content types (corrupting httpvfs range reads) but never re-compresses image
// types, so the plain-SQLite file wears a .png name. See site/app.js and
// src/v2/build-ledger-db.ts for the full rationale.
const LEDGER_DB_FILE = 'claim-ledger.sqlite.png';

// The cleaning rule the ledger's cleaned-callsign edge applies, mirrored here so
// a typed callsign is matched against the `cleaned` index in the exact form the
// builder stored: upper-case, then drop every character except A-Z, 0-9 and /.
// (See CLEANED_CALLSIGN_RULE in src/v2/claim.ts.)
/** @param {unknown} value */
export function cleanCallsign(value) {
  return String(value).toUpperCase().replace(/[^A-Z0-9/]/g, '');
}

// Resolve a typed callsign to the entity the ledger groups its observations
// under. Two indexed hops, tried in order, so a user can type either a literal
// register callsign or a regional rendering:
//   1. the cleaned form matches the `cleaned` index directly (G0TQK -> G#0TQK);
//   2. failing that, the RSL-placeholder form matches the `entity` index, so a
//      regional rendering (MW7TEE, ME7TEE) resolves to the same licence.
// Returns { typed, cleaned, entity, matched }, with entity null and matched
// 'none' when the ledger holds no observation for the value (an honest miss,
// not an invented row).
/**
 * @param {QueryExecutor} query
 * @param {string} typed
 * @returns {Promise<ResolvedEntity>}
 */
export async function resolveEntity(query, typed) {
  const cleaned = cleanCallsign(typed);
  if (cleaned === '') return { typed, cleaned, entity: null, matched: 'none' };

  /** @type {{ entity: string }[]} */
  const byCleaned = await query('SELECT DISTINCT entity FROM claims WHERE cleaned = ? LIMIT 1', [cleaned]);
  if (byCleaned.length > 0) return { typed, cleaned, entity: byCleaned[0].entity, matched: 'cleaned' };

  const placeholder = placeholderOf(cleaned);
  if (placeholder !== null) {
    /** @type {{ entity: string }[]} */
    const byEntity = await query('SELECT DISTINCT entity FROM claims WHERE entity = ? LIMIT 1', [placeholder]);
    if (byEntity.length > 0) return { typed, cleaned, entity: byEntity[0].entity, matched: 'placeholder' };
  }
  return { typed, cleaned, entity: null, matched: 'none' };
}

// Every claim the ledger holds for one entity, in derivation order (by vintage,
// then the source row ordinal), so a single indexed query on `entity` backs the
// whole dossier + timeline. The page shapes this one result set three ways
// rather than round-tripping the VFS per view.
/**
 * @param {QueryExecutor} query
 * @param {string} entity
 * @returns {Promise<ClaimRow[]>}
 */
export async function entityClaims(query, entity) {
  return query(
    `SELECT layer, raw_subject, cleaned, entity, predicate, object, rule, source_file, ordinal, vintage
     FROM claims WHERE entity = ? ORDER BY vintage, source_file, ordinal, predicate`,
    [entity],
  );
}

// The register status of an observation. Across the 21 snapshots Ofcom exported
// under several schemas, the status column is named one of these three - and
// ONLY these three account for essentially every observation - while its value
// vocabulary (Allocated / Reserved / ...) stays stable, so reading whichever is
// present is a faithful, not a lossy, normalisation. Deliberately the ONLY
// attribute the timeline reads: licence class is spread across half a dozen
// differently-named columns with DIFFERENT value vocabularies ("Full" vs
// "Amateur Full Radio Licence"), and the date columns vary in both name and
// format ("2016-08-12" vs "12/08/2016") - normalising either across schemas is
// deferred vocabulary work, and folding them half-mapped would invent events
// that are not real. So the timeline is a STATUS timeline; a blank status folds
// to blank rather than being guessed.
const STATUS_PREDICATES = ['Status', 'Final Status', 'Status__c'];

/**
 * @param {Map<string, string>} byPredicate
 * @param {string[]} names
 */
function firstObject(byPredicate, names) {
  for (const name of names) {
    const value = byPredicate.get(name);
    if (value !== undefined && value !== '') return value;
  }
  return '';
}

// Collapse the flat claim rows into one observation per (vintage, source row):
// each register row emits several raw claims (@listed, Status, Type, ...) that
// share a source_file+ordinal, so they regroup into a single observation
// carrying the status the fold reads. Raw layer only - the derived
// normalises_to edges are the anatomy's business, not the timeline's. class /
// timestamps are intentionally left null/blank (see STATUS_PREDICATES).
/**
 * @param {ClaimRow[]} claims
 * @returns {Observation[]}
 */
export function observationsOf(claims) {
  /** @type {Map<string, { vintage: string, rawToken: string, byPredicate: Map<string, string> }>} */
  const byRow = new Map();
  for (const c of claims) {
    if (c.layer !== 'raw') continue;
    const key = JSON.stringify([c.vintage, c.source_file, c.ordinal, c.raw_subject]);
    let obs = byRow.get(key);
    if (obs === undefined) {
      obs = { vintage: c.vintage, rawToken: c.raw_subject, byPredicate: new Map() };
      byRow.set(key, obs);
    }
    obs.byPredicate.set(c.predicate, c.object);
  }
  return [...byRow.values()].map(obs => ({
    vintage: obs.vintage,
    rawToken: obs.rawToken,
    status: firstObject(obs.byPredicate, STATUS_PREDICATES),
    classCanon: null,
    lastModified: '',
    created: '',
  }));
}

// The temporal fold: fold every observation of an entity into a per-vintage
// timeline, tracking a stream PER RAW VARIANT (never collapsed to the entity) so
// which raw token carried each change stays visible. Within a variant a change
// is classified by tier - a licence-state move (status/class) is primary; a
// timestamp-only move is a de-emphasised admin update. `cleaned` is the
// human-readable canonical, so any raw token differing from it is tagged a raw
// variant. Pure: no DOM, so it is unit-tested directly.
/**
 * @param {Observation[]} observations
 * @param {string} cleaned
 */
export function foldObservations(observations, cleaned) {
  const obs = observations.map((o, i) => ({ ...o, i }))
    .sort((a, b) => (a.vintage < b.vintage ? -1 : a.vintage > b.vintage ? 1 : a.i - b.i));
  // rawToken -> the variant's last-seen licence state
  /** @type {Map<string, { status?: string, klass?: string | null, stamp?: string }>} */
  const state = new Map();
  /** @type {Map<string, TimelineEntry[]>} */
  const byV = new Map();
  let births = 0, changes = 0, admin = 0;
  for (const o of obs) {
    const st = state.get(o.rawToken) ?? {};
    const evs = [];
    if (o.status && o.status !== st.status) {
      const birth = st.status === undefined;
      evs.push({ cls: birth ? 'birth' : 'change', t: 'status → ' + o.status });
      if (birth) births += 1; else changes += 1;
      st.status = o.status;
    }
    if (o.classCanon && o.classCanon !== st.klass) {
      const birth = st.klass === undefined;
      evs.push({ cls: birth ? 'birth' : 'change', t: 'class → ' + o.classCanon });
      if (birth) births += 1; else changes += 1;
      st.klass = o.classCanon;
    }
    const stamp = (o.lastModified || '') + '|' + (o.created || '');
    const hasStamp = !!(o.lastModified || o.created);
    if (hasStamp && st.stamp !== undefined && stamp !== st.stamp && evs.length === 0) {
      evs.push({ cls: 'admin', t: 'admin update' + (o.lastModified ? ' · modified ' + o.lastModified : '') });
      admin += 1;
    }
    if (hasStamp || st.stamp === undefined) st.stamp = stamp;
    state.set(o.rawToken, st);
    if (evs.length === 0) evs.push({ cls: 'cont', t: 'unchanged' });
    let entries = byV.get(o.vintage);
    if (entries === undefined) { entries = []; byV.set(o.vintage, entries); }
    entries.push({ variant: o.rawToken !== cleaned ? o.rawToken : null, status: o.status, active: o.status === 'Allocated', evs });
  }
  const vints = [...byV.keys()].sort();
  for (const v of vints) {
    const list = byV.get(v) ?? [];
    const multi = list.length > 1;
    for (const ob of list) ob.role = !multi ? 'solo' : (ob.active ? 'active' : 'parallel');
  }
  return { byV, vints, births, changes, admin, snaps: obs.length, variants: new Set(obs.map(o => o.rawToken)) };
}

// Group timeline entries into chronological period buckets by the YEAR of their
// vintage, preserving input order within a period. The shape the activity-style
// vertical timeline renders from: an array of { period, entries }, periods
// ascending. Pure, so the grouping is unit-tested without a DOM. Shared by the
// entity status timeline AND the per-note "seen in" source lists, so both read
// as one component (issue #466). An entry is any object carrying a `vintage`
// string; the fields the DOM layer needs (lead, date, class) ride along untouched.
/**
 * @template {{ vintage: string }} T
 * @param {T[]} entries
 * @returns {{ period: string, entries: T[] }[]}
 */
export function groupByYear(entries) {
  /** @type {Map<string, T[]>} */
  const byYear = new Map();
  for (const entry of entries) {
    const period = String(entry.vintage).slice(0, 4);
    let bucket = byYear.get(period);
    if (bucket === undefined) { bucket = []; byYear.set(period, bucket); }
    bucket.push(entry);
  }
  return [...byYear.keys()].sort().map(period => ({ period, entries: byYear.get(period) ?? [] }));
}

// The UTF-8 bytes of a raw token, as space-separated lower-case hex - the
// evidence that a "damaged" variant differs from its clean twin in the bytes,
// not merely in appearance (G0TQK vs "G0TQK " differ by a trailing 20). Pure.
/** @param {string} str */
export function bytesHex(str) {
  return [...new TextEncoder().encode(str)].map(b => b.toString(16).padStart(2, '0')).join(' ');
}

// The layer anatomy of an entity: one entry per distinct raw token, carrying its
// bytes, the normalises_to edges the ledger derived from it (raw -> cleaned ->
// entity, each with the named rule), a count of the observations that carried
// it, and whether it is a damaged variant (its raw bytes differ from its cleaned
// form). Built from the same claim rows, so the anatomy is exactly what the
// ledger asserts - no re-derivation in the page. Per-observation attribute
// VALUES are not shown here: one token recurs across many snapshots with
// differing values, so a single value would misrepresent the set - the
// per-vintage view is the timeline's job.
/** @param {ClaimRow[]} claims */
export function anatomyOf(claims) {
  /** @type {Map<string, { raw: string, cleaned: string, bytes: string, edges: { rule: string | null, subject: string, object: string }[], observations: Set<string> }>} */
  const variants = new Map();
  for (const c of claims) {
    let v = variants.get(c.raw_subject);
    if (v === undefined) {
      v = { raw: c.raw_subject, cleaned: c.cleaned, bytes: bytesHex(c.raw_subject), edges: [], observations: new Set() };
      variants.set(c.raw_subject, v);
    }
    if (c.layer === 'derived' && c.predicate === 'normalises_to') {
      if (!v.edges.some(e => e.rule === c.rule && e.object === c.object)) {
        v.edges.push({ rule: c.rule, subject: c.raw_subject, object: c.object });
      }
    } else if (c.layer === 'raw' && c.predicate === '@listed') {
      v.observations.add(`${c.source_file} ${c.ordinal}`);
    }
  }
  return [...variants.values()].map(v => ({
    raw: v.raw,
    cleaned: v.cleaned,
    bytes: v.bytes,
    damaged: v.raw !== v.cleaned,
    observations: v.observations.size,
    edges: v.edges,
  }));
}

// Notable observations DERIVED from the claims themselves (never hard-coded):
// each flag is a fact the query result exhibits, with a plain-English gloss.
// This is the transparency-first stance - a damaged raw token is surfaced as a
// flagged observation rather than silently presented as its clean form.
/**
 * @param {ClaimRow[]} claims
 * @param {string} cleaned
 */
export function flagsOf(claims, cleaned) {
  /** @type {{ flag: string, gloss: string }[]} */
  const flags = [];
  const rawTokens = new Set(claims.map(c => c.raw_subject));
  const damaged = [...rawTokens].filter(t => t !== cleaned);
  if (damaged.length > 0) {
    flags.push({
      flag: 'raw-differs-from-cleaned',
      gloss: `${damaged.length} raw token${damaged.length > 1 ? 's' : ''} carry characters the cleaning rule removes `
        + '(whitespace, case, punctuation) yet resolve to the same entity. Kept verbatim so the difference is not hidden.',
    });
  }
  if (rawTokens.size > 1) {
    flags.push({
      flag: 'multiple-raw-variants',
      gloss: `The register published this licence under ${rawTokens.size} distinct raw tokens across the snapshots. `
        + 'The entity view keeps every one, with provenance - it never silently picks a winner.',
    });
  }
  // Co-temporal status divergence: within one vintage, two raw variants asserting
  // different statuses (e.g. a clean token Reserved beside a damaged twin marked
  // Allocated) - a lead worth scrutiny, surfaced not resolved.
  /** @type {Map<string, Set<string>>} */
  const byVintage = new Map();
  for (const o of observationsOf(claims)) {
    if (o.status === '') continue;
    const set = byVintage.get(o.vintage) ?? new Set();
    set.add(o.status);
    byVintage.set(o.vintage, set);
  }
  const diverging = [...byVintage.entries()].filter(([, statuses]) => statuses.size > 1).map(([v]) => v);
  if (diverging.length > 0) {
    flags.push({
      flag: 'co-temporal-status-divergence',
      gloss: `At ${diverging.join(', ')} the raw variants disagree on status. The register shows both; the model keeps `
        + 'them honest and traceable rather than asserting which is true.',
    });
  }
  return flags;
}

// ---- Record fidelity: the inline, selectively-disclosed affordance (#438) --
//
// A callsign's record is faithful the overwhelming majority of the time: the
// form the register published equals its canonical reference form and it
// carries no notable observation. In that case this surface says NOTHING about
// forms or fidelity (selective disclosure, ADR ethics decision 8) - the reader
// just sees their callsign, with no "M7TEE -> M7TEE" noise and nothing that
// could read as "your record was changed".
//
// A fidelity note is surfaced ONLY when the raw form differs from the canonical
// form, OR a derived data-quality observation applies. The framing is
// non-accusatory throughout: every sentence locates an observation and where it
// was seen, imputes no intent to any licensee or to the publisher, is hedged,
// and is safe if quoted in isolation. Wording is grounded in the flag registry
// (reference-data/flags.md) but uses a neutral vocabulary on the surface: we
// "note"/"observe" a fact, "flag a discrepancy" between the published source and
// our own best-effort derivation, and "draw no conclusion" where the cause is
// unknown — with no judgement disclaimer, which would only invoke the frame it
// denies. No lookalike / "did you mean" suggestion is offered: the
// plausible-correction target of an unusual token often already exists as a
// distinct, live record for possibly a different person (MOGCQ vs the separate
// live M0GCQ), so conflating them would be a real harm.

export const REPO_URL = 'https://github.com/MysterAitch/amateur-callsigns-file-watch';

// The predicate/rule tokens the ledger stores, mirrored here so this DOM-free
// module needs no TypeScript import (as cleanCallsign mirrors the cleaning
// rule). Source of truth: src/v2/claim.ts and src/v2/parse-attribute-emit.ts.
const FLAG_PREDICATE = 'flag';
const PARSE_STATUS_PREDICATE = 'parse_status';
const CLEANED_CALLSIGN_RULE = 'cleaned-callsign';

// The reusable explainer pages this surface links out to, so a reader meeting a
// term for the first time can follow it to a plain-English explanation.
export const FAQ_CALLSIGN_STRUCTURE = 'callsign-structure.html';
export const FAQ_INVISIBLE_CHARACTERS = 'invisible-characters.html';

// Prose is modelled as an array of SEGMENTS so a sentence can carry an inline
// link (to an explainer or the glossary), a verbatim raw token (with its
// invisible characters made visible), or a monospace code value - while every
// value is still written to the DOM with textContent, never innerHTML. A plain
// string segment is literal text; the objects below are the richer parts.
//   link:  a hyperlink { text, href }  (http… opens in a new tab; else same-tab)
//   raw:   a verbatim register token, invisible characters shown
//   code:  a monospace value (e.g. the canonical form)
/** @type {(text: string, href: string) => Segment} */
const lnk = (text, href) => ({ link: { text, href } });
/** @type {(value: string) => Segment} */
const rawSeg = (value) => ({ raw: value });
/** @type {(value: string) => Segment} */
const codeSeg = (value) => ({ code: value });

// The readable text of a segment list (the link text and values, in order),
// for accessible-name building and for tests. Pure.
/** @param {Segment[]} segments */
export function segmentsText(segments) {
  return segments.map(s => {
    if (typeof s === 'string') return s;
    if (s.link) return s.link.text;
    if (s.raw !== undefined) return s.raw;
    if (s.code !== undefined) return s.code;
    return '';
  }).join('');
}

// The standing framing preamble (ADR ethics decision 2), in plain language. It
// defuses the "my record was corrupted" reading before any surprising note:
// says plainly whose data this is, that the notes are observations not
// judgements, that a callsign can belong to different people over time, and
// that nothing here changes a record.
/** @type {Segment[]} */
export const FIDELITY_PREAMBLE = [
  'What you see below describes what an official register — published by Ofcom, the UK '
  + 'regulator — actually recorded for this ',
  lnk('callsign', FAQ_CALLSIGN_STRUCTURE),
  ', and which file we found it in. The notes are things we note or observe in the published data; '
  + 'where a value looks inconsistent with the rules we derive, we flag the discrepancy and draw no '
  + 'conclusion about why. A single callsign can also belong to different people at different times, '
  + 'because callsigns are re-issued over the years. We always keep the data exactly as it was '
  + 'published; nothing here changes any record.',
];

// A plain-English gloss per derivation rule (kept in step with src/v2/explain.ts
// RULE_GLOSSES). Used to head the "show the working" panel. Exported so the
// fidelity-map drift guard (issue #465) can assert it covers every rule the
// ledger emits — a rule with no gloss would surface to a reader as a bare token.
/** @type {Record<string, string>} */
export const RULE_GLOSSES = {
  [CLEANED_CALLSIGN_RULE]: 'Upper-cased and reduced to the plain callsign alphabet (A–Z, 0–9, /).',
  'placeholder-form': 'Parsed the callsign and moved the regional secondary locator to the # placeholder slot.',
  'callsign-pattern': 'Mapped each character to its shape class (letter, digit, invisibles marked).',
  'licence-category': 'Looked up the published product value in the licence-category reference table.',
  'parse-callsign': 'Computed by the callsign parser from the published form (with the reference tables).',
  'stripped-collision': 'The plain-character form of this value coexists as its own row in the same source.',
};

// Non-accusatory notes for the derived data-quality flags the ledger can carry
// (predicate `flag`), keyed by the flag token stored in the database. `label`
// is neutral plain English (no "malformed"/"unparseable"/"defect" review tone);
// `gloss` is a short, hedged, source-located sentence (segments), drawn from
// reference-data/flags.md and kept deliberately tight - the depth on any linked
// term lives in the explainer page, so the inline note stays plain AND short.
// The neutrality is carried by the plain factual statement (and, for a mismatch,
// the source-vs-derivation framing), never by a judgement disclaimer. Absent
// keys fall back to the raw token so a newly added flag surfaces honestly.
// Exported so the fidelity-map drift guard (issue #465) can assert it covers the
// whole emitted flag vocabulary (reference-data/flags.md), keeping that honest
// fallback from ever actually firing in front of a reader.
/** @type {Record<string, { label: string, gloss: Segment[] }>} */
export const FLAG_NOTES = {
  'lowercase': {
    label: 'Lower-case letters in the published form',
    gloss: ['The register normally writes a ', lnk('callsign', FAQ_CALLSIGN_STRUCTURE),
      ' in capitals; this entry has one or more lower-case letters. We read it the same either way and record it as published.'],
  },
  'whitespace': {
    label: 'A hidden space in the published form',
    gloss: ['This entry contains a space or other ', lnk('character you cannot see', FAQ_INVISIBLE_CHARACTERS),
      '. Kept verbatim and noted here, not silently removed.'],
  },
  'encoding-failure': {
    label: 'A “replacement character” in the published form',
    gloss: ['This entry contains a Unicode ', lnk('replacement character', FAQ_INVISIBLE_CHARACTERS),
      ' (U+FFFD) — usually the mark of a text conversion that could not carry a character across. Recorded as found; the original is kept verbatim.'],
  },
  'excel-date-shape': {
    label: 'The value looks like a spreadsheet date',
    gloss: ['In this snapshot the value is written the way a spreadsheet shows a date (for example 20-Apr) rather than as a ',
      lnk('callsign', FAQ_CALLSIGN_STRUCTURE), '. Other snapshots may show it differently. Kept exactly as published and noted here.'],
  },
  'spreadsheet-error-token': {
    label: 'A spreadsheet error code in the callsign column',
    gloss: ['The value is a spreadsheet error code (such as #REF!) that landed in the callsign column of this file — a fault carried over from the source, not a ',
      lnk('callsign', FAQ_CALLSIGN_STRUCTURE), '. Kept as found rather than guessed at or dropped.'],
  },
  'rsl-in-register': {
    label: 'A Regional Secondary Locator is shown in the published form',
    gloss: ['The register usually stores the core callsign without its ', lnk('Regional Secondary Locator', FAQ_CALLSIGN_STRUCTURE),
      ' (the letter that shows which UK nation or Crown Dependency a station is in). This entry includes it, so we note it.'],
  },
  'unknown-rsl': {
    label: 'A Regional Secondary Locator not on our reference list',
    gloss: ['This callsign’s ', lnk('Regional Secondary Locator', FAQ_CALLSIGN_STRUCTURE),
      ' is not one in our reference list (some temporary or special ones are deliberately not listed). Recorded as an honest unknown, not an error.'],
  },
  'unknown-prefix-series': {
    label: 'A prefix not on our reference list',
    gloss: ['This callsign’s ', lnk('prefix', FAQ_CALLSIGN_STRUCTURE),
      ' is not in Ofcom’s current published table, so no licence class is read from it. Recorded as an honest unknown.'],
  },
  'forbidden-suffix': {
    label: 'Suffix appears on a withheld-suffix list',
    gloss: ['We note this callsign’s ', lnk('suffix', FAQ_CALLSIGN_STRUCTURE),
      ' is on the combined list of suffixes Ofcom has withheld from new licences. On its own this is unremarkable: many long-standing callsigns carry such a suffix, so the list governs new issues, not existing ones.'],
  },
  'forbidden-suffix-issued-after-first-known-list': {
    label: 'Start date looks later than when the suffix was first withheld',
    gloss: ['We note an apparent discrepancy: the start date recorded in the source is later than the earliest date we have seen this ',
      lnk('suffix', FAQ_CALLSIGN_STRUCTURE),
      ' withheld, so on our reading it was issued after the suffix was already being held back. We draw no conclusion — the reason isn’t clear from the data, and our reading of the withholding timeline is itself a best-effort derivation.'],
  },
  'suffix-length-abnormal': {
    label: 'The suffix is an unusual length',
    gloss: ['This callsign’s ', lnk('suffix', FAQ_CALLSIGN_STRUCTURE),
      ' is outside the usual two-to-three-letter length. Two-letter suffixes are older, historic callsigns. Noted here for reference.'],
  },
  'class-product-mismatch': {
    label: 'Licence class from the callsign differs from the product column',
    gloss: ['We flag a discrepancy between the product recorded in this snapshot and the licence ',
      lnk('class', FAQ_CALLSIGN_STRUCTURE), ' our ', lnk('prefix', FAQ_CALLSIGN_STRUCTURE),
      ' analysis implies. We draw no conclusion — the cause is unknown, and our prefix-to-class mapping is itself a best-effort derivation, so the difference could sit on either side: perhaps an old entry left uncorrected, perhaps a legitimate arrangement not stated in the public data.'],
  },
  'stripped-collision': {
    label: 'The same callsign appears twice in one file',
    gloss: ['Reduced to plain characters, this value matches another row in the same snapshot — the register lists the same callsign twice, once as normal text and once carrying extra ',
      lnk('hidden or unusual characters', FAQ_INVISIBLE_CHARACTERS), '. Both are shown; neither is dropped.'],
  },
  'malformed-home-callsign': {
    label: 'A visitor entry whose home callsign looks unusual',
    gloss: ['This is a visitor entry (written M/ then the visitor’s home ', lnk('callsign', FAQ_CALLSIGN_STRUCTURE),
      ') where the home part does not look like a normal callsign. Recorded as found.'],
  },
  'hash-in-register': {
    label: 'A placeholder “#” after the slash in a visitor entry',
    gloss: ['A visitor entry with a “#” just after the slash. The “#” reads as a fill-in placeholder, not a real ',
      lnk('callsign', FAQ_CALLSIGN_STRUCTURE), ' character, so we set it aside, read the rest normally, and note it here.'],
  },
  'unparseable-callsign': {
    label: 'Unparseable callsign',
    gloss: ['The value could not be parsed as any UK ', lnk('callsign', FAQ_CALLSIGN_STRUCTURE),
      ' — an observation of what the source published, not a verdict. We keep it exactly as published rather than reshape it into a guess.'],
  },
};

// Parse-status values worth surfacing. `parsed`, `visitor` and `special-event`
// are the normal outcomes and are NOT surfaced (selective disclosure). Only the
// two that mean "the register lists a token we could not read as a callsign" are.
// Exported so the fidelity-map drift guard (issue #465) can assert every key is a
// real emitted parse status (no stale entry) — the guard cannot demand the whole
// vocabulary here precisely because the surfacing is deliberately selective.
/** @type {Record<string, { label: string, gloss: Segment[] }>} */
export const NOTABLE_PARSE_STATUS = {
  'unparseable': {
    label: 'We could not read this as a standard callsign',
    gloss: ['We note the register lists this entry, but our parser could not read it as a standard UK ',
      lnk('callsign', FAQ_CALLSIGN_STRUCTURE),
      ', so we keep it exactly as published rather than reshape it into a guess — and we do not suggest a “corrected” callsign, because a similar-looking one may be a different, real licence held by someone else.'],
  },
  'empty': {
    label: 'The callsign field is empty',
    gloss: ['The callsign field for this row is empty in the source. Recorded as found.'],
  },
};

// The "the six twins" narrative's back-link (issue #657), shared by both the
// static co-temporal-status-divergence note below and the enriched version of
// it further down (coTemporalDivergenceNote), so the two copies cannot drift
// to different wording or a different target.
/** @type {() => Segment[]} */
const sixTwinsNarrativeLink = () => [' ', lnk('Read the story: the six twins', 'reports/narratives/the-six-twins.html'), '.'];

// Plain notes for the cross-record observations flagsOf computes (these are not
// per-row database flags but genuine multi-observation findings). flagsOf's own
// glosses use model jargon ("raw tokens", "the entity view"); these plainer
// versions read better for a lay reader while staying precise.
/** @type {Record<string, { label: string, gloss: Segment[] }>} */
const COMPUTED_NOTES = {
  'multiple-raw-variants': {
    label: 'Published in more than one form',
    gloss: ['Across the snapshots, the register published this licence under more than one written form. We keep every one, with a note of where it came from; we never quietly pick a single “winner”.'],
  },
  'co-temporal-status-divergence': {
    label: 'Two forms disagree on status in one snapshot',
    gloss: ['Within a single snapshot, two written forms of this callsign show different statuses. We show both exactly as published rather than decide which is right.',
      ...sixTwinsNarrativeLink()],
  },
};

// The real repository path of a source file. The logical `source_file` key the
// ledger stores rewrites the open-data lane's on-disk 'archive/<key>/raw.csv' to
// 'opendata/<key>/raw.csv'; the FOI lane keeps its 'foi/<entry>/<file>' path
// under archive/. So the repo path is 'archive/' + the key with any leading
// 'opendata/' removed. (Mirrors the collectors' `repoPath`.)
/** @param {string} sourceFile */
export function sourceRepoPath(sourceFile) {
  return 'archive/' + String(sourceFile).replace(/^opendata\//, '');
}

// A link to examine the exact source file on GitHub. The database does not carry
// a per-row line number, so this points at the file (the working names the row
// ordinal in prose); it is framed as "examine the source", not a pinned
// permalink, to stay honest about that.
/** @param {string} sourceFile */
export function sourceFileUrl(sourceFile) {
  return `${REPO_URL}/blob/main/${sourceRepoPath(sourceFile)}`;
}

// A pre-filled "report an observation" GitHub issue URL (ADR ethics decision 4,
// the basic right-of-reply hook; issue #439). The body is neutral - it states
// the fact and sets expectations honestly (public issue; we mirror Ofcom and
// cannot change the official register; no set response time) - and pre-fills NO
// grievance framing on the reporter's behalf. Labels are omitted so an unknown
// label never trips GitHub's chooser.
//
// The optional `context` adds a "Where you saw it" block (the surface and the
// page URL) so a report from a client-rendered page arrives located to its hop
// (the error-locability principle) - the client half of the shared #439
// affordance whose server half lives in src/ci/render/report.ts. Omitting it
// leaves the URL byte-identical to the original callsign-only form, so callers
// that pass just a callsign are unaffected.
/**
 * @param {string} callsign
 * @param {{ surface?: string, pageUrl?: string }} [context]
 */
export function reportIssueUrl(callsign, context) {
  const where = context === undefined ? [] : [
    '',
    'Where you saw it:',
    ...(context.surface ? [`- Surface: ${context.surface}`] : []),
    ...(context.pageUrl ? [`- Page: ${context.pageUrl}`] : []),
  ];
  const body = [
    `This is a public GitHub issue about the archived register record for ${callsign}.`,
    ...where,
    '',
    'What did you observe? (please describe)',
    '',
    '',
    'Please note: this project mirrors Ofcom’s published register snapshots. It cannot '
    + 'change the official register, and any correction upstream is outside its control. '
    + 'There is no set response time, and this issue is public.',
  ].join('\n');
  const params = new URLSearchParams({ title: `Observation about ${callsign}`, body });
  return `${REPO_URL}/issues/new?${params.toString()}`;
}

// The observations (source_file / ordinal / vintage) that carry a given raw
// token, de-duplicated and ordered - the "where it was seen" of a working.
/**
 * @param {ClaimRow[]} claims
 * @param {string} rawSubject
 * @returns {SourceRef[]}
 */
function sourcesForRaw(claims, rawSubject) {
  /** @type {Map<string, SourceRef>} */
  const seen = new Map();
  for (const c of claims) {
    if (c.raw_subject !== rawSubject || c.predicate !== '@listed') continue;
    const key = `${c.source_file}#${c.ordinal}`;
    if (!seen.has(key)) seen.set(key, { sourceFile: c.source_file, ordinal: c.ordinal, vintage: c.vintage });
  }
  return [...seen.values()];
}

/** @param {string} rule */
function ruleGlossFor(rule) {
  return RULE_GLOSSES[rule] ?? rule ?? '';
}

// A short, human-readable label for a source file, derived purely from its
// logical path. The long repository path is unreadable inline ("opendata/
// 2025-06-04/raw.csv"); this collapses it to the lane it belongs to — "Ofcom
// open data" for the register snapshots, "Ofcom FOI" for a disclosure-log
// download, "FOI · WDTK <id>" for a WhatDoTheyKnow request — so a list of
// sources reads at a glance. The FULL path is never discarded here: callers keep
// it as the link's href and title, so the label loses nothing. An unrecognised
// path falls back to itself rather than an invented label. Pure.
/** @param {string} sourceFile */
export function sourceLabel(sourceFile) {
  const s = String(sourceFile);
  if (/^opendata\//.test(s)) return 'Ofcom open data';
  const wdtk = s.match(/^foi\/wdtk-(.+?)(?:--|\/|$)/);
  if (wdtk) return `FOI · WDTK ${wdtk[1]}`;
  if (/^foi\/ofcom-/.test(s)) return 'Ofcom FOI';
  return s;
}

// Structured "where it was seen" items for the DOM to render as a bulleted list,
// one source per line. Each item carries the row ordinal, the humanised label,
// the examine-source URL, the full logical path (kept for the link's title so
// nothing is lost) and the vintage. The rendering (bullets, and the collapse of
// a long list behind a disclosure) lives in the DOM layer; the model just
// supplies the fields. Pure.
/** @param {SourceRef[]} sources */
function sourceItems(sources) {
  return sources.map(s => ({
    ordinal: s.ordinal,
    sourceFile: s.sourceFile,
    label: sourceLabel(s.sourceFile),
    url: sourceFileUrl(s.sourceFile),
    vintage: s.vintage,
  }));
}

// Enrich the co-temporal-status-divergence note (issue #633): where a snapshot
// lists two written forms of one callsign with different statuses, LEAD with the
// user-meaningful fact - that the format-normal (canonical) form and a
// non-standard spelling carry the statuses they carry - and attach a working
// with the per-form statuses and the source rows behind them. Format normality
// orders the presentation (the canonical form is the entity's identity) but
// NEVER resolves the conflict: both forms are shown exactly as published. The
// ledger deliberately does not fold the register's timestamps (see
// STATUS_PREDICATES), so recency is not asserted here - the divergence stays a
// plainly flagged conflict, now with format context. Returns null when there is
// no diverging vintage. Pure.
/**
 * @param {ClaimRow[]} claims
 * @param {string} cleaned
 * @returns {null | { label: string, gloss: Segment[], working: { rule: string, ruleGloss: string, inputs: { role: string, value: string }[], result: string, resultVerbatim: boolean, sources: ReturnType<typeof sourceItems> } }}
 */
export function coTemporalDivergenceNote(claims, cleaned) {
  /** @type {Map<string, { rawToken: string, status: string }[]>} */
  const byVintage = new Map();
  for (const o of observationsOf(claims)) {
    if (o.status === '') continue;
    const list = byVintage.get(o.vintage) ?? [];
    list.push({ rawToken: o.rawToken, status: o.status });
    byVintage.set(o.vintage, list);
  }
  const diverging = [...byVintage.entries()]
    .filter(([, rows]) => new Set(rows.map(r => r.status)).size > 1)
    .map(([v]) => v)
    .sort();
  if (diverging.length === 0) return null;

  // Lead with the most recent diverging snapshot - the one that best answers
  // "what does the register say now".
  const vintage = diverging[diverging.length - 1];
  const rows = byVintage.get(vintage) ?? [];
  // Distinct (form, status) pairs, format-normal first (rule 1).
  /** @type {Map<string, { rawToken: string, status: string, normal: boolean }>} */
  const distinct = new Map();
  for (const r of rows) {
    const k = `${r.rawToken} ${r.status}`;
    if (!distinct.has(k)) distinct.set(k, { rawToken: r.rawToken, status: r.status, normal: r.rawToken === cleaned });
  }
  const forms = [...distinct.values()].sort((a, b) => (a.normal === b.normal ? 0 : a.normal ? -1 : 1));
  const abnormal = forms.filter(f => !f.normal);
  const normal = forms.filter(f => f.normal);

  /** @type {Segment[]} */
  const gloss = [];
  if (abnormal.length > 0 && normal.length > 0) {
    gloss.push(`Within the ${vintage} snapshot, `);
    abnormal.forEach((f, i) => {
      if (i > 0) gloss.push(i === abnormal.length - 1 ? ' and ' : ', ');
      gloss.push('the variant ', rawSeg(f.rawToken), ` — a non-standard spelling — is listed ${f.status}`);
    });
    const normalStatuses = [...new Set(normal.map(f => f.status))].join(' / ');
    gloss.push(', while the canonical form ', codeSeg(cleaned), ` is listed ${normalStatuses}. `);
    gloss.push('The register publishes both; we show each exactly as published and do not decide which is right.');
  } else {
    const pairs = forms.map(f => f.status).join(' vs ');
    gloss.push(`Within the ${vintage} snapshot, two written forms of this callsign are listed with different statuses (${pairs}). `);
    gloss.push('We show both exactly as published rather than decide which is right.');
  }
  gloss.push(...sixTwinsNarrativeLink());

  // Working: the per-form statuses that make up the divergence, and the source
  // rows they were seen in (linkable evidence, rule 5).
  /** @type {Map<string, SourceRef>} */
  const sourceKeys = new Map();
  for (const c of claims) {
    if (c.vintage !== vintage || c.predicate !== '@listed') continue;
    const key = `${c.source_file}#${c.ordinal}`;
    if (!sourceKeys.has(key)) sourceKeys.set(key, { sourceFile: c.source_file, ordinal: c.ordinal, vintage: c.vintage });
  }
  const sources = sourceItems([...sourceKeys.values()]);

  return {
    label: (abnormal.length > 0 && normal.length > 0)
      ? 'A non-standard spelling carries a different status'
      : 'Two forms disagree on status in one snapshot',
    gloss,
    working: {
      rule: 'co-temporal-status-divergence',
      ruleGloss: 'Two written forms of one callsign are listed with different statuses within a single snapshot — read from the register’s own rows, not derived.',
      inputs: forms.map(f => ({ role: f.status, value: f.rawToken })),
      result: `statuses disagree at ${vintage}`,
      resultVerbatim: false,
      sources,
    },
  };
}

// The structured fidelity model for a resolved callsign, ready for the surface
// to render. `disclose` is false for the clean, unremarkable case (nothing is
// surfaced then). `canonical` describes any divergence between a published form
// and the canonical reference form, with the working behind the normalisation.
// `notes` are the non-accusatory data-quality observations, each optionally
// carrying a "working" (inputs -> rule -> result, with the source rows it was
// seen in). Nothing is re-derived here: every note is read from the derived
// claims the ledger already emitted (the same emit path src/v2/explain.ts
// reconstructs), so the surface cannot drift from what the model asserts.
/**
 * @param {ClaimRow[]} claims
 * @param {ResolvedEntity} resolved
 */
export function fidelityOf(claims, resolved) {
  const cleaned = resolved.cleaned;

  // Canonical-form divergence: a published (raw) form that differs from the
  // canonical reference form. `intro` explains, plainly and once, what the entry
  // contains and what the canonical form is (jargon depth pushed to the linked
  // explainer). Each divergent form shows itself verbatim beside the canonical
  // form, with the working behind its cleaned-callsign normalises_to edge.
  const rawTokens = [...new Set(claims.map(c => c.raw_subject))];
  const divergent = rawTokens.filter(t => t !== cleaned && t !== '');
  const canonical = divergent.length === 0 ? null : {
    canonicalForm: cleaned,
    intro: [
      'We observe the published form differs from its ', lnk('canonical form', 'glossary.html#canonical-form'),
      '. The canonical form is what we match on: we upper-case the letters and drop anything outside the ',
      lnk('standard callsign set', FAQ_CALLSIGN_STRUCTURE),
      ' (A–Z, 0–9 and “/”). A difference can be as small as a lower-case letter, or a stray character that is removed.',
    ],
    variants: divergent.map(raw => {
      const sources = sourceItems(sourcesForRaw(claims, raw));
      // Only mention "invisible characters shown" when the form actually carries
      // whitespace/invisible characters (the marker is only then meaningful).
      const hasInvisible = /[\s\u00a0\u0000-\u001f\u007f-\u009f\ufffd]/.test(raw);
      return {
        raw,
        // Side-by-side prose: the entry exactly as published, then the canonical
        // form we use. Invisible characters (if any) are shown, linked to the
        // explainer that says how. Where it was seen is NOT crammed into this
        // sentence: the surface renders `sources` as a bulleted list so long file
        // paths do not turn the line into a run-on.
        prose: [
          'As published: ', rawSeg(raw),
          ...(hasInvisible ? [' (', lnk('invisible characters shown', FAQ_INVISIBLE_CHARACTERS), ')'] : []),
          '. Canonical form: ', codeSeg(cleaned), '.',
        ],
        sources,
        // resultVerbatim: the result of THIS working is a callsign token, so the
        // surface should show its invisible characters (unlike a flag working,
        // whose result is a label like 'forbidden-suffix').
        working: {
          rule: CLEANED_CALLSIGN_RULE,
          ruleGloss: ruleGlossFor(CLEANED_CALLSIGN_RULE),
          inputs: [{ role: 'published form', value: raw }],
          result: cleaned,
          resultVerbatim: true,
          sources,
        },
      };
    }),
  };

  const notes = [];

  // Derived per-row flags carried in the database (predicate `flag`).
  const flagObjects = [...new Set(claims
    .filter(c => c.layer === 'derived' && c.predicate === FLAG_PREDICATE)
    .map(c => c.object))].sort();
  for (const flag of flagObjects) {
    const meta = FLAG_NOTES[flag] ?? { label: flag, gloss: '' };
    const carriers = claims.filter(c => c.layer === 'derived' && c.predicate === FLAG_PREDICATE && c.object === flag);
    const raw = carriers[0]?.raw_subject ?? '';
    notes.push({
      id: flag,
      label: meta.label,
      gloss: meta.gloss,
      working: {
        rule: carriers[0]?.rule ?? '',
        ruleGloss: ruleGlossFor(carriers[0]?.rule ?? ''),
        inputs: [{ role: 'published form', value: raw }],
        result: flag,
        // A flag working's result is a label token (e.g. 'forbidden-suffix'),
        // rendered as plain text, so it is NOT shown verbatim like a callsign.
        resultVerbatim: false,
        sources: sourceItems(sourcesForRaw(claims, raw)),
      },
    });
  }

  // Notable parse statuses (unparseable / empty). The normal outcomes are not
  // surfaced. Deliberately NO lookalike or "did you mean" is offered here.
  const statusClaims = claims.filter(c => c.layer === 'derived' && c.predicate === PARSE_STATUS_PREDICATE);
  const notableStatuses = [...new Set(statusClaims.map(c => c.object))].filter(s => NOTABLE_PARSE_STATUS[s]);
  for (const status of notableStatuses.sort()) {
    const meta = NOTABLE_PARSE_STATUS[status];
    const carrier = statusClaims.find(c => c.object === status);
    const raw = carrier?.raw_subject ?? '';
    notes.push({
      id: `parse-status-${status}`,
      label: meta.label,
      gloss: meta.gloss,
      working: {
        rule: carrier?.rule ?? '',
        ruleGloss: ruleGlossFor(carrier?.rule ?? ''),
        inputs: [{ role: 'published form', value: raw }],
        result: status,
        // The result is a status label, not a callsign, so it is not verbatim
        // (consistent with the flag working above).
        resultVerbatim: false,
        sources: sourceItems(sourcesForRaw(claims, raw)),
      },
    });
  }

  // Cross-record observations flagsOf computes. `raw-differs-from-cleaned` is
  // represented by the canonical block above, so it is not repeated as a note.
  for (const f of flagsOf(claims, cleaned)) {
    if (f.flag === 'raw-differs-from-cleaned') continue;
    // The co-temporal status divergence is enriched (#633): its presentation
    // leads with the format-normality fact and carries a working with the
    // per-form statuses and the source rows behind them, rather than a bare
    // gloss.
    if (f.flag === 'co-temporal-status-divergence') {
      const enriched = coTemporalDivergenceNote(claims, cleaned);
      if (enriched !== null) {
        notes.push({ id: f.flag, label: enriched.label, gloss: enriched.gloss, working: enriched.working });
        continue;
      }
    }
    const meta = COMPUTED_NOTES[f.flag] ?? { label: f.flag, gloss: [f.gloss] };
    notes.push({ id: f.flag, label: meta.label, gloss: meta.gloss, working: null });
  }

  return { disclose: canonical !== null || notes.length > 0, preamble: FIDELITY_PREAMBLE, canonical, notes };
}

// --- browser-only: open the shipped claim-ledger `.png` over sql.js-httpvfs ---
// Mirrors app.js's opener: the worker resolves relative URLs against vendor/, so
// the database URL is absolute, and each deploy's ?v=<sha> makes the database a
// distinct CDN cache object (two deploys inside the Pages max-age window
// otherwise stitch range chunks from different builds). The version is read from
// the same uncached data/version.txt the lookup uses.
async function ledgerVersion() {
  try {
    const res = await fetch(new URL('./data/version.txt', document.baseURI), { cache: 'no-store' });
    if (res.ok) return (await res.text()).trim();
  } catch { /* offline or missing - a dev/local build has no stamp */ }
  return 'dev';
}

// The deploy splits the database into fixed-size chunk files and writes this
// manifest beside them: the total byte length (so the worker takes it from here
// and never HEADs the whole object - a HEAD on GitHub Pages negotiates a
// compressed `Vary: Accept-Encoding` variant that is a persistent ~30s CDN MISS,
// issue #475), the chunk-file size, and the numeric-suffix width.
/** @typedef {{ databaseLengthBytes: number, serverChunkSize: number, suffixLength: number }} ChunkManifest */
/** @returns {Promise<ChunkManifest>} */
async function ledgerChunks() {
  const res = await fetch(new URL('./data/claim-ledger.chunks.json', document.baseURI), { cache: 'no-store' });
  if (!res.ok) throw new Error('claim-ledger chunk manifest is missing');
  // res.json() resolves `any`; routed through `unknown` first so the cast to
  // the manifest shape is a narrowing (of a genuinely unknown value), not an
  // assertion straight off `any`.
  /** @type {unknown} */
  const raw = await res.json();
  return /** @type {ChunkManifest} */ (raw);
}

// Self-check (issue #475): a range read of the final byte the manifest's length
// implies must return 206 from a real last chunk. Guards against a stale manifest
// or a truncated split leaving the declared length past the actual bytes - which
// SQLite would otherwise surface as "database disk image is malformed", or worse,
// as silently short reads. Runs off the open's critical path and fails LOUD
// rather than letting a wrong length pass unnoticed. Uses a Range GET (identity,
// fast), never a HEAD.
/**
 * @param {ChunkManifest} chunks
 * @param {string} urlPrefix
 * @param {string} version
 */
export async function validateLedgerLength({ databaseLengthBytes, serverChunkSize, suffixLength }, urlPrefix, version) {
  const lastIndex = Math.floor((databaseLengthBytes - 1) / serverChunkSize);
  const lastByte = (databaseLengthBytes - 1) % serverChunkSize;
  const url = `${urlPrefix}${String(lastIndex).padStart(suffixLength, '0')}?cb=${encodeURIComponent(version)}`;
  try {
    const res = await fetch(url, { headers: { Range: `bytes=${lastByte}-${lastByte}` } });
    if (res.status !== 206) {
      console.error(`claim-ledger length self-check FAILED: the manifest length (${databaseLengthBytes}) is not readable from the final chunk (HTTP ${res.status}). The database may be truncated or the manifest stale - query results should not be trusted.`);
      return false;
    }
    return true;
  } catch (err) {
    console.error('claim-ledger length self-check could not run:', err);
    return false;
  }
}

/** @returns {Promise<QueryExecutor>} */
export async function openLedgerQuery() {
  // The httpvfs UMD loader (vendor/, no shipped types) attaches createDbWorker
  // to window, so it is read through a typed view of that global here - the one
  // place the untyped vendor boundary is crossed.
  const { createDbWorker } = /** @type {{ createDbWorker: (configs: unknown[], workerUrl: string, wasmUrl: string) => Promise<{ db: { query: QueryExecutor } }> }} */ (/** @type {unknown} */ (window));
  const workerUrl = new URL('./vendor/sqlite.worker.js', import.meta.url);
  const wasmUrl = new URL('./vendor/sql-wasm.wasm', import.meta.url);
  const [version, chunks] = await Promise.all([ledgerVersion(), ledgerChunks()]);
  const urlPrefix = new URL(`./data/${LEDGER_DB_FILE}.`, document.baseURI).toString();
  const worker = await createDbWorker(
    [{ from: 'inline', config: {
      serverMode: 'chunked',
      urlPrefix,
      suffixLength: chunks.suffixLength,
      serverChunkSize: chunks.serverChunkSize,
      requestChunkSize: 4096,
      databaseLengthBytes: chunks.databaseLengthBytes,
      cacheBust: version,
    } }],
    workerUrl.toString(),
    wasmUrl.toString(),
  );
  // Fire-and-forget the length self-check; it warns loudly on mismatch without
  // blocking the first query.
  void validateLedgerLength(chunks, urlPrefix, version);
  return (sql, params = []) => worker.db.query(sql, params);
}
