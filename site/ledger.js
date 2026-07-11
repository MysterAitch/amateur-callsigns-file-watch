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
  flagsOf,
} from './ledger-query.js';

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
    kv.append(el('span', 'k', 'Value'), valNode, el('span', 'k', 'bytes'), bytesNode);
    for (const a of o.attrs) { kv.append(el('span', 'k', a.predicate), el('span', 'v', a.object)); }
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
  const latest = observations[observations.length - 1];
  const st = el('div', 'stat');
  if (latest) {
    st.append(b(latest.status || '(no status)'));
    if (latest.classCanon) st.append(' · ', latest.classCanon);
    st.append(' · latest snapshot ', latest.vintage);
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
  facts.appendChild(row('cleaned', [b(resolved.cleaned), ' — the human-readable canonical (direct-lookup key)']));
  const variants = [...new Set(claims.map(c => c.raw_subject))];
  const variantVal = el('span');
  variants.forEach((t, i) => { if (i > 0) variantVal.append('  ·  '); appendRawToken(variantVal, t); });
  facts.appendChild(row('raw tokens', variantVal));
  const vintages = [...new Set(claims.map(c => c.vintage))].sort();
  facts.appendChild(row('vintages', vintages.join(', ')));
  body.appendChild(facts);

  const flags = flagsOf(claims, resolved.cleaned);
  const fs2 = section('notable observations');
  if (flags.length > 0) {
    for (const f of flags) {
      const fc = el('div', 'flagcard');
      const t = el('div'); t.style.display = 'flex'; t.style.justifyContent = 'space-between'; t.style.gap = '8px';
      t.appendChild(el('span', 'fn', f.flag)); t.appendChild(el('span', 'tb d', 'derived'));
      fc.appendChild(t);
      fc.appendChild(el('div', 'fg', f.gloss));
      fs2.appendChild(fc);
    }
  } else {
    fs2.appendChild(el('p', 'obs-mini', 'None — a clean, unremarkable record.'));
  }
  body.appendChild(fs2);
  card.appendChild(body);
  host.appendChild(card);
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
        `No claim in this ledger for "${typed}". This is the representative subset (two register snapshots), `
        + 'so most callsigns are absent — that is a bound of the sample, not evidence the callsign is unrecorded.'));
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

// ---- Browser bootstrap (guarded) -------------------------------------------
// Runs only in a real browser with the httpVFS loader present. A unit/JSDOM
// test importing this module for its render functions never trips this, so
// importing the module opens no worker.
function initLedgerPage() {
  const status = document.getElementById('lookup-status');
  const setStatus = (text, isError) => {
    if (!status) return;
    status.textContent = text;
    status.classList.toggle('is-error', isError === true);
  };
  const queryPromise = (async () => {
    try {
      return await openLedgerQuery();
    } catch (err) {
      console.error(err);
      setStatus('The claim-ledger database could not be loaded. Try reloading the page.', true);
      throw err;
    }
  })();

  const lookup = async (typed) => {
    const value = typed.trim();
    if (value === '') return;
    setStatus(`Querying the ledger for ${value.toUpperCase()}…`);
    try {
      const query = await queryPromise;
      const resolved = await runLookup(query, value);
      setStatus(resolved.entity === null
        ? `No observation for ${value.toUpperCase()} in the subset.`
        : `Resolved ${value.toUpperCase()} → ${resolved.entity}.`);
      for (const chip of document.querySelectorAll('#resolver .chip')) {
        chip.setAttribute('aria-pressed', String(chip.dataset.cs === value.toUpperCase()));
      }
    } catch (err) {
      console.error(err);
      setStatus(`The lookup for ${value.toUpperCase()} failed. Try reloading the page.`, true);
    }
  };

  const resolver = document.getElementById('resolver');
  if (resolver) {
    resolver.addEventListener('click', (e) => {
      const chip = e.target.closest('button.chip');
      if (!chip) return;
      const input = document.getElementById('callsign-input');
      if (input) input.value = chip.dataset.cs;
      void lookup(chip.dataset.cs);
    });
  }
  const form = document.getElementById('lookup-form');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = document.getElementById('callsign-input');
      void lookup(input ? input.value : '');
    });
  }

  // Initial view: a deep-link ?c=, else the first sample chip.
  const params = new URLSearchParams(window.location.search);
  const deepLink = params.get('c');
  const first = document.querySelector('#resolver .chip');
  const initial = (deepLink && deepLink.trim() !== '') ? deepLink.trim() : (first ? first.dataset.cs : '');
  if (initial !== '') {
    const input = document.getElementById('callsign-input');
    if (input) input.value = initial;
    void lookup(initial);
  }
}

if (typeof window !== 'undefined' && typeof window.createDbWorker === 'function') {
  initLedgerPage();
}
