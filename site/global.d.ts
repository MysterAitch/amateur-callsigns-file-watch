// Ambient declarations for the vendor/page globals several site/*.js modules
// read directly off `window`, shared here rather than repeated per file as a
// local narrowed-view cast (the idiom used elsewhere for a one-off untyped
// boundary, e.g. ledger-query.js's window.createDbWorker read): three of
// these modules pin the literal `window.__xReadyTimer` source text in their
// own startup-warning tests, so a per-file cast that renames the access
// would break an assertion checking an unrelated fact (that the ready timer
// gets cleared), not the type shape itself.
//
// createDbWorker: attached by the httpvfs UMD loader (vendor/, no shipped
// types) before app.js/compare.js/entry-browser.js/explore.js run their
// guarded bootstrap. Declared as always present (not optional) because every
// call site is only ever reached from inside that guarded bootstrap, exactly
// the assumption ledger-query.js's local cast of the same global already
// makes; each module still probes its actual runtime presence with its own
// `typeof window.createDbWorker === 'function'` guard before bootstrapping.
//
// __lookupReadyTimer / __compareReadyTimer / __exploreReadyTimer: stamped by
// each page's own inline startup-warning script (index.html / compare.html /
// explore.html) and cancelled by that page's module once its bootstrap
// completes; playground.html and ledger.html use the same mechanism but read
// it through a local narrowed view (no literal-source test pins their form).
interface Window {
  createDbWorker: (
    configs: unknown[],
    workerUrl: string,
    wasmUrl: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the vendored library ships no types (see the module comment above); every caller states its own row shape at the point it reads a query() result, exactly as ledger-query.js's QueryExecutor does.
  ) => Promise<{ db: { query: (sql: string, params?: unknown[]) => Promise<any[]> } }>;
  __lookupReadyTimer?: ReturnType<typeof setTimeout>;
  __compareReadyTimer?: ReturnType<typeof setTimeout>;
  __exploreReadyTimer?: ReturnType<typeof setTimeout>;
}
