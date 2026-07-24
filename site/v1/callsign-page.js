// @ts-check
// v1 CALLSIGN PAGE ORCHESTRATOR (issue #921): resolves ?c=<value> in-browser
// and renders the config-array sections (site/v1/callsign-sections.js) from the
// resolved model.
//
// It REUSES a set of pure data modules — shardNameFor / latestSummary /
// seenSummary / anatomyFigureParts / twinConflict from the callsign module,
// stripModel from the events module, cleanCallsign / canonicalCallsign from the
// query modules — loaded at runtime by dynamic import. Those modules are shared
// with the legacy tree but the v1 surface is SELF-CONTAINED: they are deployed
// at the site ROOT beside this page (see src/ci/build-v1-shared-modules.ts), so
// the import base is the page's own directory. The one deploy-layout constant,
// SHARED_MODULE_BASE, lives in site/v1/shell.js; the tests mock it. The shared
// module's own page-init is inert here: the v1 page marks itself
// main[data-page="callsign-v1"], which the legacy init guard never matches.
//
// Fetch order: the instant shard + datasets.json first (the fast answer and the
// assertion axis), then the event shard + meta.json behind it (the event axis
// and the findings) — so the instant answer is never blocked on the lazier
// event fetch.

import { renderSiteBar, renderBreadcrumb, renderFooter, mountInto, SHARED_MODULE_BASE } from './shell.js';
import { V1_COPY } from './copy.js';
import { buildCallsignModel, renderCallsignSections } from './callsign-sections.js';
import { wireTermPopovers } from './glossary.js';

// The prefix-sharded static data, deployed at the root beside this page.
const DATA_BASE = `${SHARED_MODULE_BASE}callsign/data/`;

/** @param {string} rel @returns {Promise<{ json: unknown, bytes: number }>} */
async function fetchDataJson(rel) {
  const res = await fetch(new URL(`${DATA_BASE}${rel}`, document.baseURI).toString());
  if (!res.ok) throw new Error(`could not fetch ${rel} (HTTP ${res.status})`);
  const text = await res.text();
  return { json: JSON.parse(text), bytes: text.length };
}

/** The ?c= (or ?q=/?callsign=) parameter, matching the deep-link convention. */
function paramCallsign() {
  const params = new URLSearchParams(window.location.search);
  return params.get('c') ?? params.get('q') ?? params.get('callsign') ?? '';
}

/**
 * Keep the entered callsign in the lookup box on EVERY resolution path. A GET
 * submit reloads the page fresh, so without this the input reverts to its
 * placeholder — and after a not-found (or an invalid form, or a shard-fetch
 * failure) the reader would have to retype the whole callsign just to fix a
 * typo. Setting the value unconditionally at entry, before any resolution runs,
 * means no downstream outcome can discard the input: the typed callsign is
 * always there to edit in place (issue #921). Exported so the rule is testable
 * on its own. The trimmed typed form is kept as-is (the field renders it
 * upper-case via CSS); an empty parameter leaves the placeholder showing.
 * @param {Document} doc
 * @param {string} typed
 */
export function preserveLookupInput(doc, typed) {
  const input = doc.getElementById('csq');
  if (input === null || !(input instanceof HTMLInputElement)) return;
  const value = typed.trim();
  if (value !== '') input.value = value;
}

async function initCallsignPageV1() {
  // Chrome first, so the page frames itself even if the data fetch fails. The
  // dated-fact chip reads the single build-injected source (issues #965/#966),
  // so this page re-authors no figure.
  mountInto('sitebar', renderSiteBar('lookup'));
  const typed = paramCallsign();
  // Retain the entered callsign in the search box up front, so no resolution
  // outcome below (found, not-found, invalid or fetch failure) can leave the
  // reader with an emptied field (issue #921).
  preserveLookupInput(document, typed);
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
    // The shared pure modules, dynamically imported from the site root. A
    // non-literal import() specifier resolves to `any` — a TypeScript
    // limitation, not a value we can narrow — so each result is asserted to its
    // known static type on the same line, which restores full type-checking at
    // every call site below. The unsafe-assignment rule is disabled per line for
    // exactly that any→typed bridge, and never wider.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- non-literal import() specifier types as any; re-typed by the JSDoc cast on this line
    const sharedCallsign = /** @type {typeof import('../callsign.js')} */ (await import(`./${SHARED_MODULE_BASE}callsign.js`));
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- non-literal import() specifier types as any; re-typed by the JSDoc cast on this line
    const sharedEvents = /** @type {typeof import('../callsign-events.js')} */ (await import(`./${SHARED_MODULE_BASE}callsign-events.js`));
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- non-literal import() specifier types as any; re-typed by the JSDoc cast on this line
    const sharedQuery = /** @type {typeof import('../browser-query.js')} */ (await import(`./${SHARED_MODULE_BASE}browser-query.js`));
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- non-literal import() specifier types as any; re-typed by the JSDoc cast on this line
    const sharedLedger = /** @type {typeof import('../ledger-query.js')} */ (await import(`./${SHARED_MODULE_BASE}ledger-query.js`));
    const { shardNameFor, latestSummary, seenSummary, anatomyFigureParts, twinConflict } = sharedCallsign;
    const { stripModel } = sharedEvents;
    const { canonicalCallsign } = sharedQuery;
    const { cleanCallsign } = sharedLedger;

    // Instant axis first: manifest + the one shard the prefix picks.
    const cleaned = cleanCallsign(typed);
    const manifest = /** @type {import('../callsign.js').ShardManifest} */ ((await fetchDataJson('datasets.json')).json);
    const shardNames = new Set(manifest.shards);
    const shardName = shardNameFor(cleaned, shardNames);
    const shard = /** @type {{ callsigns: Record<string, import('../callsign.js').CallsignRecord> }} */ ((await fetchDataJson(`${shardName}.json`)).json);

    /** @type {string | null} */
    let key = Object.hasOwn(shard.callsigns, cleaned) ? cleaned : null;
    /** @type {import('../callsign.js').CallsignRecord | null} */
    let record = key !== null ? shard.callsigns[key] : null;
    // True when the typed form resolved only via its regional-rendering core —
    // the fast-answer note names it so the reader knows which record answered.
    let viaRendering = false;
    if (record === null) {
      const core = canonicalCallsign(cleaned);
      if (core !== null && core !== cleaned) {
        const coreShardName = shardNameFor(core, shardNames);
        const coreShard = /** @type {{ callsigns: Record<string, import('../callsign.js').CallsignRecord> }} */ ((await fetchDataJson(`${coreShardName}.json`)).json);
        if (Object.hasOwn(coreShard.callsigns, core)) { key = core; record = coreShard.callsigns[core]; viaRendering = true; }
      }
    }
    const res = { key, record, cleaned, typed, viaRendering };

    // Event axis behind it: meta + the event shard the same prefix picks. A
    // failure here degrades the dial to its assertion axis; it never blocks the
    // instant answer already resolved above.
    /** @type {import('../callsign-events.js').EventRecord | null} */
    let eventRecord = null;
    /** @type {import('../callsign-events.js').EventsMeta | null} */
    let eventMeta = null;
    if (key !== null) {
      try {
        eventMeta = /** @type {import('../callsign-events.js').EventsMeta} */ ((await fetchDataJson('events/meta.json')).json);
        const evShardName = shardNameFor(key, new Set(eventMeta.shards));
        const evShard = /** @type {{ callsigns: Record<string, import('../callsign-events.js').EventRecord> }} */ ((await fetchDataJson(`events/${evShardName}.json`)).json);
        eventRecord = Object.hasOwn(evShard.callsigns, key) ? evShard.callsigns[key] : null;
      } catch {
        eventRecord = null;
        eventMeta = null;
      }
    }

    const model = buildCallsignModel({ res, manifest, eventRecord, eventMeta, latestSummary, seenSummary, anatomyFigureParts, twinConflict, stripModel });
    root.textContent = '';
    renderCallsignSections(/** @type {HTMLElement} */ (root), model);
    // Enhance the coined-term and provenance-chip popovers into a well-mannered
    // set (issue #921, B1); with the script off they remain plain <details>
    // disclosures that still open their definitions.
    wireTermPopovers(document);
    if (status !== null) {
      status.textContent = model.found
        ? `Answered ${model.key} from one shard (${shardName}.json) – no database involved.`
        : `No record found for ${typed} – checked shard ${shardName}.json.`;
    }
  } catch (err) {
    if (status !== null) status.textContent = '';
    const alert = document.getElementById('lookup-alert');
    if (alert !== null) {
      alert.textContent = `Could not resolve this callsign (${err instanceof Error ? err.message : String(err)}). `
        + 'This page resolves from its own small static data files; please try again.';
      alert.hidden = false;
    }
  }
}

if (typeof document !== 'undefined' && document.querySelector('main[data-page="callsign-v1"]') !== null) {
  void initCallsignPageV1();
}
