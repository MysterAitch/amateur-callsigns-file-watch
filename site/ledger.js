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
} from './ledger-query.js';
import { withDatabaseLoading } from './db-loading.js';

const el = (t, c, txt) => { const e = document.createElement(t); if (c) e.className = c; if (txt != null) e.textContent = txt; return e; };
// A bold node carrying safe text. Every database-derived value is written with
// textContent (never innerHTML), so a raw '<' or '&' that register data can
// carry is never interpreted as markup.
const b = txt => el('b', null, String(txt));

// Render an actual raw register token, surfacing any literal whitespace or
// non-breaking space it carries as a visible marker rather than an invisible
// gap - so the value is driven by the observation's own bytes.
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

// Render a "where it was seen" source list (the structured items ledger-query
// supplies) as a clean bulleted list, one source per line:
//   row {ordinal} · {humanised source label, linked} · {vintage}
// The visible label is short and human ("Ofcom open data"); the FULL logical
// path is preserved as the link's href and title attribute, so the long path
// stops being run-on visible text without being lost. When a value was seen in
// more than COLLAPSE_SOURCES_AFTER snapshots the first few stay visible and the
// remainder tuck behind a native <details> (works with JavaScript off) so a
// many-snapshot variant never dominates. Shared by the canonical-divergence
// block and the "show the working" panel so both read identically.
const COLLAPSE_SOURCES_AFTER = 5;
const sourceListItem = (s) => {
  const li = el('li', 'fid-source');
  li.append(`row ${s.ordinal} · `);
  const a = extLink(s.url, s.label);
  a.title = s.sourceFile;
  li.appendChild(a);
  li.append(` · ${s.vintage}`);
  return li;
};
const sourceListUl = (items) => {
  const ul = el('ul', 'fid-source-list');
  for (const s of items) ul.appendChild(sourceListItem(s));
  return ul;
};
const renderSourceList = (sources) => {
  const wrap = el('div', 'fid-sources');
  wrap.appendChild(sourceListUl(sources.slice(0, COLLAPSE_SOURCES_AFTER)));
  const rest = sources.slice(COLLAPSE_SOURCES_AFTER);
  if (rest.length > 0) {
    const d = el('details', 'fid-more-sources');
    const sum = el('summary');
    sum.append(`Show all ${sources.length} sources`);
    d.appendChild(sum);
    d.appendChild(sourceListUl(rest));
    wrap.appendChild(d);
  }
  return wrap;
};

const showRaw = t => t.replace(/ /g, '[NBSP]').replace(/ /g, '[SP]');

// ---- Entity timeline (temporal fold) ---------------------------------------
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

  const tl = el('div', 'tl');
  for (const v of f.vints) {
    const list = f.byV.get(v);
    list.forEach((ob, idx) => {
      const row = el('div', 'tl-row' + (ob.role === 'parallel' ? ' parallel' : ''));
      row.appendChild(el('div', 'vint', idx === 0 ? v : ''));
      const body = el('div', 'body');
      if (ob.variant) { const vt = el('span', 'variant-tag'); vt.textContent = 'raw variant ' + showRaw(ob.variant); body.appendChild(vt); }
      if (ob.role === 'parallel') body.appendChild(el('span', 'ev split-inactive', ob.status + ' · parallel'));
      for (const e of ob.evs) body.appendChild(el('span', 'ev ' + e.cls, e.t));
      row.appendChild(body); tl.appendChild(row);
    });
  }
  card.appendChild(tl);
  host.appendChild(card);
}

// ---- Layer anatomy: raw token -> normalises_to edges -> entity -------------
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
    st.append(b(latestStatuses.length > 0 ? latestStatuses.join(' / ') : '(no status)'));
    st.append(' · latest snapshot ', latestVintage);
  } else {
    st.append('no observations');
  }
  head.appendChild(st);
  card.appendChild(head);

  const body = el('div'); body.style.padding = '16px 18px';
  const note = el('p', 'obs-mini'); note.style.margin = '0 0 6px';
  note.textContent = `Resolved from "${resolved.typed}" via the ${resolved.matched === 'placeholder' ? 'placeholder-form (entity)' : 'cleaned'} index.`;
  body.appendChild(note);

  const section = (title) => { const s = el('div', 'dsec'); s.appendChild(el('h4', null, title)); return s; };
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
export function parseLedgerParams(params) {
  const raw = params.get('c') ?? params.get('callsign');
  const callsign = (raw !== null && raw.trim() !== '') ? raw.trim().toUpperCase() : null;
  return { callsign };
}

// The URL a search for `callsign` should show: the current location with its
// query reduced to ?c=<callsign>, hash preserved. Pure (returns a string); the
// caller decides pushState vs replaceState. URLSearchParams percent-encodes the
// value, so a callsign is carried literally and can never smuggle markup.
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
export function wireLedgerSearch({ doc, win, runSearch }) {
  const getInput = () => doc.getElementById('callsign-input');
  const first = doc.querySelector('#resolver .chip');
  const fallback = first ? first.dataset.cs : '';

  // mode: 'push' adds a history entry (a user-initiated search, so Back returns
  // to the previous search); 'replace' rewrites the current entry (the initial
  // load, so it adds no spurious entry); 'none' leaves history untouched (a
  // popstate restore, whose URL is already the target).
  const writeUrl = (callsign, mode) => {
    if (mode === 'none') return;
    const next = ledgerSearchUrl(win.location.href, callsign);
    if (next === win.location.href) return;
    if (mode === 'replace') win.history.replaceState(null, '', next);
    else win.history.pushState(null, '', next);
  };

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
      const chip = e.target.closest('button.chip');
      if (!chip) return;
      void search(chip.dataset.cs, 'push');
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
 * @param {{ button?: HTMLButtonElement, statusEl?: HTMLElement, alertEl?: HTMLElement, resultEl?: HTMLElement, doc?: Document, openDatabase: () => unknown, performLookup?: (query: unknown, value: string) => Promise<{ entity: string | null }>, label?: string }} options
 */
export function makeLedgerLookup({
  button, statusEl, alertEl, resultEl, doc = document,
  openDatabase, performLookup = runLookup, label = 'claim-ledger database',
}) {
  // Open the database once and memoise it. A rejected open is NOT cached: the
  // memo is cleared on failure so a later search retries rather than being stuck
  // on a transient error. A subsequent search reuses the warm open.
  let queryPromise = null;
  const getQuery = () => {
    queryPromise ??= Promise.resolve(openDatabase())
      .catch((err) => { queryPromise = null; throw err; });
    return queryPromise;
  };

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
        for (const chip of doc.querySelectorAll('#resolver .chip')) {
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
  const { lookup } = makeLedgerLookup({
    button: document.querySelector('#lookup-form button'),
    statusEl: document.getElementById('lookup-status'),
    alertEl: document.getElementById('lookup-alert'),
    resultEl: document.getElementById('entity'),
    openDatabase: openLedgerQuery,
    label: 'claim-ledger database',
  });

  wireLedgerSearch({ doc: document, win: window, runSearch: lookup });
}

if (typeof window !== 'undefined' && typeof window.createDbWorker === 'function') {
  initLedgerPage();
}
