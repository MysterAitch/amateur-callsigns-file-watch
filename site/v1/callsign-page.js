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
import { buildCallsignModel, renderCallsignSections, describeLookupInput, callsignPageTitle, boundedQuery, lookupShape, lookupLabel, syncScrollerFocus, holdStateInView } from './callsign-sections.js';
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

/**
 * The breadcrumb trail: "Home → Look up" until something has been looked up,
 * then the looked-up key (bounded, as the heading shows it) as the last crumb,
 * so the trail, the heading, and the status line name the same string.
 * @param {string | null} lookedUp  null before a lookup, or when nothing was entered
 * @returns {{ label: string, href?: string }[]}
 */
export function lookupBreadcrumb(lookedUp) {
  const home = { label: V1_COPY.journeys.home, href: 'index.html' };
  if (lookedUp === null || lookedUp === '') return [home, { label: V1_COPY.journeys.lookup }];
  return [home, { label: V1_COPY.journeys.lookup, href: 'callsign.html' }, { label: boundedQuery(lookedUp).text }];
}

/**
 * The newest register snapshot the site names, from the build-derived holdings
 * manifest (latestRegister, chosen in src/ci/build-home-holdings.ts) - read, never
 * re-decided here. Null when it cannot be fetched or has not the expected shape;
 * the page then says the currency could not be checked rather than guessing.
 * @returns {Promise<{ vintage: string, records: number } | null>}
 */
async function fetchNewestRegister() {
  try {
    const res = await fetch(new URL(`${SHARED_MODULE_BASE}holdings.json`, document.baseURI).toString());
    if (!res.ok) return null;
    const json = /** @type {unknown} */ (await res.json());
    if (json === null || typeof json !== 'object' || !('latestRegister' in json)) return null;
    const r = /** @type {{ latestRegister: unknown }} */ (json).latestRegister;
    if (r === null || typeof r !== 'object') return null;
    const { vintage, records } = /** @type {{ vintage?: unknown, records?: unknown }} */ (r);
    return typeof vintage === 'string' && typeof records === 'number' ? { vintage, records } : null;
  } catch {
    return null;
  }
}

/**
 * Keeps each dial's scale open at its state terminus (holdStateInView) and
 * re-checks after layout, and on every resize, whether it scrolls and so should
 * take keyboard focus (syncScrollerFocus).
 * @param {Document} doc
 */
function syncDialFocus(doc) {
  const scrollers = [...doc.querySelectorAll('.dial-scroll')];
  const reopeners = scrollers.map((scroller) => holdStateInView(scroller));
  const sync = () => {
    for (const reopen of reopeners) reopen();
    for (const scroller of scrollers) syncScrollerFocus(scroller);
  };
  sync();
  window.addEventListener('resize', sync);
}

/**
 * @typedef {object} SharedModules
 * @property {typeof import('../callsign.js')} sharedCallsign
 * @property {typeof import('../callsign-events.js')} sharedEvents
 * @property {typeof import('../browser-query.js')} sharedQuery
 * @property {typeof import('../ledger-query.js')} sharedLedger
 */

/**
 * The shared pure modules, dynamically imported from the site root (see the
 * header). A non-literal import() specifier resolves to `any` - a TypeScript
 * limitation, not a value we can narrow - so each result is asserted to its known
 * static type on the same line, which restores full type-checking at every call
 * site. The unsafe-assignment rule is disabled per line for exactly that
 * any-to-typed bridge, and never wider.
 * @returns {Promise<SharedModules>}
 */
async function loadSharedModules() {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- non-literal import() specifier types as any; re-typed by the JSDoc cast on this line
  const sharedCallsign = /** @type {typeof import('../callsign.js')} */ (await import(`./${SHARED_MODULE_BASE}callsign.js`));
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- non-literal import() specifier types as any; re-typed by the JSDoc cast on this line
  const sharedEvents = /** @type {typeof import('../callsign-events.js')} */ (await import(`./${SHARED_MODULE_BASE}callsign-events.js`));
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- non-literal import() specifier types as any; re-typed by the JSDoc cast on this line
  const sharedQuery = /** @type {typeof import('../browser-query.js')} */ (await import(`./${SHARED_MODULE_BASE}browser-query.js`));
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- non-literal import() specifier types as any; re-typed by the JSDoc cast on this line
  const sharedLedger = /** @type {typeof import('../ledger-query.js')} */ (await import(`./${SHARED_MODULE_BASE}ledger-query.js`));
  return { sharedCallsign, sharedEvents, sharedQuery, sharedLedger };
}

/**
 * The page's entry point. The shared-module loader is a parameter only so the
 * tests can hand in the same modules by static import: the bundler that runs
 * them cannot resolve a variable import() path that climbs a directory.
 * @param {() => Promise<SharedModules>} [loadShared]
 */
export async function initCallsignPageV1(loadShared = loadSharedModules) {
  // Chrome first, so the page frames itself even if the data fetch fails. The
  // dated-fact chip reads the single build-injected source (issues #965/#966),
  // so this page re-authors no figure.
  mountInto('sitebar', renderSiteBar('lookup'));
  // The page's own title, as served; a lookup prefixes the callsign to it.
  const baseTitle = document.title;
  const typed = paramCallsign();
  // Retain the entered callsign in the search box up front, so no resolution
  // outcome below (found, not-found, invalid or fetch failure) can leave the
  // reader with an emptied field (issue #921).
  preserveLookupInput(document, typed);
  mountInto('breadcrumb', renderBreadcrumb(lookupBreadcrumb(null)));
  mountInto('sitefooter', renderFooter());

  const root = document.getElementById('sections');
  const status = document.getElementById('lookup-status');
  if (root === null) return;

  // An empty query keeps the page's static instruction; nothing is repeated in
  // the status line.
  if (typed.trim() === '') return;
  if (status !== null) status.textContent = V1_COPY.callsign.lookup.statusLookingUp;

  try {
    const { sharedCallsign, sharedEvents, sharedQuery, sharedLedger } = await loadShared();
    const { shardNameFor, latestSummary, seenSummary, anatomyFigureParts, twinConflict } = sharedCallsign;
    const { stripModel } = sharedEvents;
    const { canonicalCallsign } = sharedQuery;
    const { cleanCallsign } = sharedLedger;

    // What was typed against what will be looked up: the heading, breadcrumb,
    // status line, and tab title all name the looked-up key once the lookup
    // has an answer, and the page says what the cleaning left out or changed
    // rather than doing it silently.
    const input = describeLookupInput(typed, cleanCallsign);
    const cleaned = input.lookedUp;
    /** @param {string} label */
    const nameTheLookup = (label) => {
      document.title = callsignPageTitle(label, baseTitle);
      mountInto('breadcrumb', renderBreadcrumb(lookupBreadcrumb(label)));
    };

    // Instant axis first: manifest + the one shard the prefix picks, with the
    // newest register the site names (holdings.json) fetched alongside.
    const newestRegisterPending = fetchNewestRegister();
    const manifest = /** @type {import('../callsign.js').ShardManifest} */ ((await fetchDataJson('datasets.json')).json);
    if (lookupShape(cleaned) === 'empty') {
      // Nothing survives the cleaning rule but perhaps a "/", so there is no key
      // to look up and no shard to ask: say so rather than report a miss.
      const model = buildCallsignModel({ res: { key: null, record: null, cleaned, typed, input }, manifest, eventRecord: null, eventMeta: null, latestSummary, seenSummary, anatomyFigureParts, twinConflict, stripModel });
      root.textContent = '';
      renderCallsignSections(/** @type {HTMLElement} */ (root), model);
      nameTheLookup(lookupLabel(input));
      if (status !== null) status.textContent = V1_COPY.callsign.lookup.statusNothingToLookUp;
      return;
    }
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
    // The shard that answered, for the status line: the core's shard when a
    // regional rendering resolved through it.
    let answeredFrom = shardName;
    if (record === null) {
      const core = canonicalCallsign(cleaned);
      if (core !== null && core !== cleaned) {
        const coreShardName = shardNameFor(core, shardNames);
        const coreShard = /** @type {{ callsigns: Record<string, import('../callsign.js').CallsignRecord> }} */ ((await fetchDataJson(`${coreShardName}.json`)).json);
        if (Object.hasOwn(coreShard.callsigns, core)) { key = core; record = coreShard.callsigns[core]; viaRendering = true; answeredFrom = coreShardName; }
      }
    }
    const res = { key, record, cleaned, typed, viaRendering, input };

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

    const newestRegister = await newestRegisterPending;
    const model = buildCallsignModel({ res, manifest, eventRecord, eventMeta, latestSummary, seenSummary, anatomyFigureParts, twinConflict, stripModel, newestRegister });
    root.textContent = '';
    renderCallsignSections(/** @type {HTMLElement} */ (root), model);
    // A regional rendering resolves to its core record: name the record shown.
    nameTheLookup(model.found ? model.key : lookupLabel(input));
    // Enhance the coined-term and provenance-chip popovers into a well-mannered
    // set (issue #921, B1); with the script off they remain plain <details>
    // disclosures that still open their definitions.
    wireTermPopovers(document);
    syncDialFocus(document);
    if (status !== null) {
      status.textContent = model.found
        ? `Answered ${model.key} from one shard (${answeredFrom}.json) – no database involved.`
        : `No record found for ${boundedQuery(cleaned).text} – checked shard ${shardName}.json.`;
    }
  } catch (err) {
    // Nothing was resolved, so the title and breadcrumb keep naming the page,
    // not a callsign the page could not look up.
    if (status !== null) status.textContent = V1_COPY.callsign.lookup.statusCouldNotLookUp;
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
