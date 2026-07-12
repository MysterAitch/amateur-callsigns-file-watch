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
export async function resolveEntity(query, typed) {
  const cleaned = cleanCallsign(typed);
  if (cleaned === '') return { typed, cleaned, entity: null, matched: 'none' };

  const byCleaned = await query('SELECT DISTINCT entity FROM claims WHERE cleaned = ? LIMIT 1', [cleaned]);
  if (byCleaned.length > 0) return { typed, cleaned, entity: byCleaned[0].entity, matched: 'cleaned' };

  const placeholder = placeholderOf(cleaned);
  if (placeholder !== null) {
    const byEntity = await query('SELECT DISTINCT entity FROM claims WHERE entity = ? LIMIT 1', [placeholder]);
    if (byEntity.length > 0) return { typed, cleaned, entity: byEntity[0].entity, matched: 'placeholder' };
  }
  return { typed, cleaned, entity: null, matched: 'none' };
}

// Every claim the ledger holds for one entity, in derivation order (by vintage,
// then the source row ordinal), so a single indexed query on `entity` backs the
// whole dossier + timeline. The page shapes this one result set three ways
// rather than round-tripping the VFS per view.
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
export function observationsOf(claims) {
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
export function foldObservations(observations, cleaned) {
  const obs = observations.map((o, i) => ({ ...o, i }))
    .sort((a, b) => (a.vintage < b.vintage ? -1 : a.vintage > b.vintage ? 1 : a.i - b.i));
  const state = new Map(); // rawToken -> { status, klass, stamp }
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
    if (!byV.has(o.vintage)) byV.set(o.vintage, []);
    byV.get(o.vintage).push({ variant: o.rawToken !== cleaned ? o.rawToken : null, status: o.status, active: o.status === 'Allocated', evs });
  }
  const vints = [...byV.keys()].sort();
  for (const v of vints) {
    const list = byV.get(v);
    const multi = list.length > 1;
    for (const ob of list) ob.role = !multi ? 'solo' : (ob.active ? 'active' : 'parallel');
  }
  return { byV, vints, births, changes, admin, snaps: obs.length, variants: new Set(obs.map(o => o.rawToken)) };
}

// The UTF-8 bytes of a raw token, as space-separated lower-case hex - the
// evidence that a "damaged" variant differs from its clean twin in the bytes,
// not merely in appearance (G0TQK vs "G0TQK " differ by a trailing 20). Pure.
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
export function anatomyOf(claims) {
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
export function flagsOf(claims, cleaned) {
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
// and is safe if quoted in isolation. Wording is drawn from the flag registry
// (reference-data/flags.md), which is deliberately "records the discrepancy,
// not a verdict". No lookalike / "did you mean" suggestion is offered: the
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

// The standing framing preamble (ADR ethics decision 2). It defuses the
// "my record was corrupted" reading before any potentially-surprising note.
export const FIDELITY_PREAMBLE =
  'These notes describe what the archived register snapshots record for this '
  + 'callsign, and where. They locate an observation rather than assign fault, and '
  + 'impute nothing to any licensee or to the publisher. A callsign’s history '
  + 'may also span more than one licensee over time. The form each source published '
  + 'is always kept verbatim; nothing here alters a record.';

// A plain-English gloss per derivation rule (kept in step with src/v2/explain.ts
// RULE_GLOSSES). Used to head the "show the working" panel.
const RULE_GLOSSES = {
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
// `gloss` is a short, hedged, source-located sentence drawn from
// reference-data/flags.md. Absent keys fall back to the raw token so a newly
// added flag surfaces honestly rather than silently vanishing.
const FLAG_NOTES = {
  'lowercase': {
    label: 'Lowercase letters in the published form',
    gloss: 'The register published this callsign with one or more lowercase letters. It is read case-insensitively; the observation is recorded, not corrected.',
  },
  'whitespace': {
    label: 'Whitespace in the published form',
    gloss: 'The published form carries a space or other invisible character. It is kept verbatim and noted here rather than silently removed.',
  },
  'encoding-failure': {
    label: 'Replacement character in the published form',
    gloss: 'The published form contains a Unicode replacement character (U+FFFD), which usually marks a text-encoding step that could not represent the original byte. Recorded as observed; the raw form is kept verbatim.',
  },
  'excel-date-shape': {
    label: 'Reads as a spreadsheet date',
    gloss: 'In this snapshot the value appears in the shape a spreadsheet uses to show a date (for example 20-Apr) rather than a callsign. Adjacent snapshots may render it differently. The value is kept exactly as published and located here.',
  },
  'spreadsheet-error-token': {
    label: 'Spreadsheet error token in the callsign column',
    gloss: 'The value is a spreadsheet formula-error literal (such as #REF!) that appears in the callsign column of this export — a source artefact preserved verbatim, not a callsign. It is left as-is rather than guessed at or dropped.',
  },
  'rsl-in-register': {
    label: 'Regional locator present in the published form',
    gloss: 'The register normally stores the locator-less core callsign, so a published form that includes an explicit regional secondary locator is the notable case and is recorded here.',
  },
  'unknown-rsl': {
    label: 'Regional locator not in the reference list',
    gloss: 'The regional secondary locator letter is not one enumerated in the reference table (some temporary or special locators are deliberately not listed). Recorded as an honest unknown, not an error.',
  },
  'unknown-prefix-series': {
    label: 'Prefix series not in the reference table',
    gloss: 'The prefix series is not present in Ofcom’s current prefix table, so no licence class is implied from it. Recorded as an honest unknown.',
  },
  'forbidden-suffix': {
    label: 'Suffix appears on a withheld-suffix list',
    gloss: 'The suffix appears on the combined list of suffixes Ofcom’s disclosures have withheld from new issuance. On its own this is unremarkable: many long-standing allocations carry such a suffix, so the list evidently governs new issuance rather than existing holdings. Recorded, not a verdict.',
  },
  'forbidden-suffix-issued-after-first-known-list': {
    label: 'Start date appears to post-date the suffix’s first-known withheld month',
    gloss: 'A candidate for scrutiny, not a verdict: the recorded original start date appears to fall after the month this suffix is first known to have been withheld. Innocent explanations come first — a heritage re-issue under a letter of consent, a publisher date artefact, or a version start date that resets on a later change rather than recording first issuance.',
  },
  'suffix-length-abnormal': {
    label: 'Suffix length outside the usual range',
    gloss: 'The suffix is outside the usual two-to-three-letter range. Two-letter forms are heritage; recorded here for reference.',
  },
  'class-product-mismatch': {
    label: 'Prefix-implied class differs from the product column',
    gloss: 'The licence class implied by the prefix series differs from the product recorded in this snapshot. This records the discrepancy, not a verdict: the cause is unknown — plausibly an issuance-time entry left uncorrected, plausibly a legitimate arrangement not stated publicly.',
  },
  'stripped-collision': {
    label: 'A plain-character twin coexists in the same source',
    gloss: 'Reduced to plain characters, this value matches another row in the same snapshot — the register lists the same callsign twice, once verbatim and once carrying extra characters. Both are shown; neither is dropped.',
  },
  'malformed-home-callsign': {
    label: 'Visitor row whose home-callsign portion is unusual',
    gloss: 'This is a visitor (M/…) row whose home-callsign portion does not take the shape of a callsign. Recorded as observed.',
  },
  'hash-in-register': {
    label: 'Placeholder character after the slash in a visitor row',
    gloss: 'A visitor row carrying a literal # immediately after the slash, which reads as a reserved template placeholder rather than a callsign character. It is set aside and the home portion parsed normally; recorded here.',
  },
};

// Parse-status values worth surfacing. `parsed`, `visitor` and `special-event`
// are the normal outcomes and are NOT surfaced (selective disclosure). Only the
// two that mean "the register lists a token the parser could not resolve" are.
const NOTABLE_PARSE_STATUS = {
  'unparseable': {
    label: 'Not resolved to a standard callsign',
    gloss: 'The register lists this token, but the callsign parser could not resolve it to a standard callsign formation. It is kept exactly as published and recorded here rather than reshaped into a guess.',
  },
  'empty': {
    label: 'Empty callsign field',
    gloss: 'The callsign field for this row is empty in the source. Recorded as observed.',
  },
};

// Labels for the cross-record observations flagsOf computes (these are not
// per-row database flags but genuine multi-observation findings). The gloss for
// each comes from flagsOf itself, so its wording stays single-sourced.
const COMPUTED_LABELS = {
  'multiple-raw-variants': 'Published under more than one form',
  'co-temporal-status-divergence': 'Forms disagree on status within one snapshot',
};

// The real repository path of a source file. The logical `source_file` key the
// ledger stores rewrites the open-data lane's on-disk 'archive/<key>/raw.csv' to
// 'opendata/<key>/raw.csv'; the FOI lane keeps its 'foi/<entry>/<file>' path
// under archive/. So the repo path is 'archive/' + the key with any leading
// 'opendata/' removed. (Mirrors the collectors' `repoPath`.)
export function sourceRepoPath(sourceFile) {
  return 'archive/' + String(sourceFile).replace(/^opendata\//, '');
}

// A link to examine the exact source file on GitHub. The database does not carry
// a per-row line number, so this points at the file (the working names the row
// ordinal in prose); it is framed as "examine the source", not a pinned
// permalink, to stay honest about that.
export function sourceFileUrl(sourceFile) {
  return `${REPO_URL}/blob/main/${sourceRepoPath(sourceFile)}`;
}

// A pre-filled "report an observation" GitHub issue URL (ADR ethics decision 4,
// the basic right-of-reply hook). The body is neutral - it states the fact and
// sets expectations honestly (public issue; we mirror Ofcom and cannot change
// the official register; no set response time) - and pre-fills NO grievance
// framing on the reporter's behalf. Labels are omitted so an unknown label
// never trips GitHub's chooser.
export function reportIssueUrl(callsign) {
  const body = [
    `This is a public GitHub issue about the archived register record for ${callsign}.`,
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
function sourcesForRaw(claims, rawSubject) {
  const seen = new Map();
  for (const c of claims) {
    if (c.raw_subject !== rawSubject || c.predicate !== '@listed') continue;
    const key = `${c.source_file}#${c.ordinal}`;
    if (!seen.has(key)) seen.set(key, { sourceFile: c.source_file, ordinal: c.ordinal, vintage: c.vintage });
  }
  return [...seen.values()];
}

function ruleGlossFor(rule) {
  return RULE_GLOSSES[rule] ?? rule ?? '';
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
export function fidelityOf(claims, resolved) {
  const cleaned = resolved.cleaned;

  // Canonical-form divergence: a published (raw) form that differs from the
  // canonical reference form. Each divergent form keeps the working behind its
  // cleaned-callsign normalises_to edge.
  const rawTokens = [...new Set(claims.map(c => c.raw_subject))];
  const divergent = rawTokens.filter(t => t !== cleaned && t !== '');
  const canonical = divergent.length === 0 ? null : {
    canonicalForm: cleaned,
    variants: divergent.map(raw => ({
      raw,
      bytes: bytesHex(raw),
      working: {
        rule: CLEANED_CALLSIGN_RULE,
        ruleGloss: ruleGlossFor(CLEANED_CALLSIGN_RULE),
        inputs: [{ role: 'published form', value: raw }],
        result: cleaned,
        sources: sourcesForRaw(claims, raw),
      },
    })),
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
        sources: sourcesForRaw(claims, raw),
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
        sources: sourcesForRaw(claims, raw),
      },
    });
  }

  // Cross-record observations flagsOf computes. `raw-differs-from-cleaned` is
  // represented by the canonical block above, so it is not repeated as a note.
  for (const f of flagsOf(claims, cleaned)) {
    if (f.flag === 'raw-differs-from-cleaned') continue;
    notes.push({ id: f.flag, label: COMPUTED_LABELS[f.flag] ?? f.flag, gloss: f.gloss, working: null });
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

export async function openLedgerQuery() {
  const { createDbWorker } = window;
  const workerUrl = new URL('./vendor/sqlite.worker.js', import.meta.url);
  const wasmUrl = new URL('./vendor/sql-wasm.wasm', import.meta.url);
  const version = await ledgerVersion();
  const dbUrl = new URL(`./data/${LEDGER_DB_FILE}?v=${encodeURIComponent(version)}`, document.baseURI);
  const worker = await createDbWorker(
    [{ from: 'inline', config: { serverMode: 'full', url: dbUrl.toString(), requestChunkSize: 4096 } }],
    workerUrl.toString(),
    wasmUrl.toString(),
  );
  return (sql, params = []) => worker.db.query(sql, params);
}
