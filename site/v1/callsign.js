// @ts-check
// v1 CALLSIGN PAGE ORCHESTRATOR (issue #921): resolves ?c=<value> in-browser,
// exactly the convention the v0 page uses for ?q=, and renders the config-array
// sections (site/v1/callsign-sections.js) from the resolved model.
//
// It REUSES v0's pure data functions — shardNameFor / latestSummary /
// seenSummary / anatomyFigureParts from the v0 callsign module, stripModel from
// the v0 events module, cleanCallsign / canonicalCallsign from the v0 query
// modules — loaded at runtime from the preserved previous version. The one
// deploy-layout assumption (v1 at the root, v0 one directory down) lives in
// V0_BASE (site/v1/shell.js); this module builds both its dynamic imports and
// its data-fetch base from it, so a layout change is a one-constant edit and
// the tests mock it. The v0 module's own page-init is inert here: the v1 page
// marks itself main[data-page="callsign-v1"], which v0's init guard never
// matches.
//
// Fetch order mirrors v0 exactly: the instant shard + datasets.json first (the
// fast answer and the assertion axis), then the event shard + meta.json behind
// it (the event axis and the findings) — so the instant answer is never blocked
// on the lazier event fetch.

import { renderSiteBar, renderBreadcrumb, renderFooter, mountInto, V0_BASE } from './shell.js';
import { V1_COPY } from './copy.js';
import { buildCallsignModel, renderCallsignSections } from './callsign-sections.js';

// The v0 data lives beside the v0 pages, under the same base.
const V0_DATA_BASE = `${V0_BASE}callsign/data/`;

/** @param {string} rel @returns {Promise<{ json: unknown, bytes: number }>} */
async function fetchV0Json(rel) {
  const res = await fetch(new URL(`${V0_DATA_BASE}${rel}`, document.baseURI).toString());
  if (!res.ok) throw new Error(`could not fetch ${rel} (HTTP ${res.status})`);
  const text = await res.text();
  return { json: JSON.parse(text), bytes: text.length };
}

/** The ?c= (or ?q=/?callsign=) parameter, matching the v0 deep-link convention. */
function paramCallsign() {
  const params = new URLSearchParams(window.location.search);
  return params.get('c') ?? params.get('q') ?? params.get('callsign') ?? '';
}

async function initCallsignPageV1() {
  // Chrome first, so the page frames itself even if the data fetch fails.
  const facts = { date: '23 June 2026', count: 65 };
  mountInto('sitebar', renderSiteBar('lookup', facts));
  const typed = paramCallsign();
  mountInto('breadcrumb', renderBreadcrumb([
    { label: V1_COPY.journeys.home, href: 'index.html' },
    { label: V1_COPY.journeys.lookup, href: 'callsign.html' },
    { label: typed !== '' ? typed.toUpperCase() : 'Look up' },
  ]));
  mountInto('sitefooter', renderFooter());

  const root = document.getElementById('sections');
  const status = document.getElementById('lookup-status');
  if (root === null) return;

  if (typed.trim() === '') {
    if (status !== null) status.textContent = 'Enter a callsign above to resolve it in-browser.';
    return;
  }
  if (status !== null) status.textContent = `Resolving ${typed}…`;

  try {
    // The v0 pure functions, loaded from the preserved previous version. The
    // template-literal specifier is deliberately not statically analysable: the
    // module resolves at runtime from V0_BASE, and never in the test process.
    // A non-literal import() specifier resolves to `any` — a TypeScript
    // limitation, not a value we can narrow. Each module is asserted to its
    // known static type immediately, which restores full type-checking at
    // every call site below; the four assertions are the unavoidable any→typed
    // bridge, so the unsafe-assignment rule is scoped off for exactly them.
    /* eslint-disable @typescript-eslint/no-unsafe-assignment */
    const v0Callsign = /** @type {typeof import('../callsign.js')} */ (await import(`./${V0_BASE}callsign.js`));
    const v0Events = /** @type {typeof import('../callsign-events.js')} */ (await import(`./${V0_BASE}callsign-events.js`));
    const v0Query = /** @type {typeof import('../browser-query.js')} */ (await import(`./${V0_BASE}browser-query.js`));
    const v0Ledger = /** @type {typeof import('../ledger-query.js')} */ (await import(`./${V0_BASE}ledger-query.js`));
    /* eslint-enable @typescript-eslint/no-unsafe-assignment */
    const { shardNameFor, latestSummary, seenSummary, anatomyFigureParts } = v0Callsign;
    const { stripModel } = v0Events;
    const { canonicalCallsign } = v0Query;
    const { cleanCallsign } = v0Ledger;

    // Instant axis first: manifest + the one shard the prefix picks.
    const cleaned = cleanCallsign(typed);
    const manifest = /** @type {import('../callsign.js').ShardManifest} */ ((await fetchV0Json('datasets.json')).json);
    const shardNames = new Set(manifest.shards);
    const shardName = shardNameFor(cleaned, shardNames);
    const shard = /** @type {{ callsigns: Record<string, import('../callsign.js').CallsignRecord> }} */ ((await fetchV0Json(`${shardName}.json`)).json);

    /** @type {string | null} */
    let key = Object.hasOwn(shard.callsigns, cleaned) ? cleaned : null;
    /** @type {import('../callsign.js').CallsignRecord | null} */
    let record = key !== null ? shard.callsigns[key] : null;
    if (record === null) {
      const core = canonicalCallsign(cleaned);
      if (core !== null && core !== cleaned) {
        const coreShardName = shardNameFor(core, shardNames);
        const coreShard = /** @type {{ callsigns: Record<string, import('../callsign.js').CallsignRecord> }} */ ((await fetchV0Json(`${coreShardName}.json`)).json);
        if (Object.hasOwn(coreShard.callsigns, core)) { key = core; record = coreShard.callsigns[core]; }
      }
    }
    const res = { key, record, cleaned, typed };

    // Event axis behind it: meta + the event shard the same prefix picks. A
    // failure here degrades the dial to its assertion axis; it never blocks the
    // instant answer already resolved above.
    /** @type {import('../callsign-events.js').EventRecord | null} */
    let eventRecord = null;
    /** @type {import('../callsign-events.js').EventsMeta | null} */
    let eventMeta = null;
    if (key !== null) {
      try {
        eventMeta = /** @type {import('../callsign-events.js').EventsMeta} */ ((await fetchV0Json('events/meta.json')).json);
        const evShardName = shardNameFor(key, new Set(eventMeta.shards));
        const evShard = /** @type {{ callsigns: Record<string, import('../callsign-events.js').EventRecord> }} */ ((await fetchV0Json(`events/${evShardName}.json`)).json);
        eventRecord = Object.hasOwn(evShard.callsigns, key) ? evShard.callsigns[key] : null;
      } catch {
        eventRecord = null;
        eventMeta = null;
      }
    }

    const model = buildCallsignModel({ res, manifest, eventRecord, eventMeta, latestSummary, seenSummary, anatomyFigureParts, stripModel });
    root.textContent = '';
    renderCallsignSections(/** @type {HTMLElement} */ (root), model);
    if (status !== null) {
      status.textContent = model.found
        ? `Answered ${model.key} from one shard (${shardName}.json) — no database involved.`
        : `No record found for ${typed} — checked shard ${shardName}.json.`;
    }
  } catch (err) {
    if (status !== null) status.textContent = '';
    const alert = document.getElementById('lookup-alert');
    if (alert !== null) {
      alert.textContent = `Could not resolve this callsign (${err instanceof Error ? err.message : String(err)}). `
        + 'This page needs the previous version’s static data files; try again, or use the previous version’s database-backed lookup.';
      alert.hidden = false;
    }
  }
}

if (typeof document !== 'undefined' && document.querySelector('main[data-page="callsign-v1"]') !== null) {
  void initCallsignPageV1();
}
