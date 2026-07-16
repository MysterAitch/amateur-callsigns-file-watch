// @ts-check
// On-screen debug console for field diagnostics — built for mobile, where the
// browser devtools console is out of reach. Enable with ?debug=1 (remembered in
// localStorage, so it survives navigation and deep links); disable with
// ?debug=0. Not linked anywhere: you reach it by typing the query onto any URL.
//
// Deliberately a CLASSIC, dependency-free script loaded BEFORE the ES modules.
// It must keep working when a module fails to load — that is the failure it
// exists to surface — so it installs its error listeners first and builds its UI
// with inline styles, depending on nothing else on the page.

(function () {
  'use strict';

  var STORE_KEY = 'callsign-debug';
  var MAX_ENTRIES = 500;

  // --- Resolve activation. An explicit ?debug= wins and is remembered. ---
  var active;
  try {
    var params = new URLSearchParams(window.location.search);
    if (params.has('debug')) {
      var v = params.get('debug');
      active = v !== '0' && v !== 'false' && v !== 'off';
      try { active ? localStorage.setItem(STORE_KEY, '1') : localStorage.removeItem(STORE_KEY); } catch (e) { /* private mode */ }
    } else {
      active = localStorage.getItem(STORE_KEY) === '1';
    }
  } catch (e) {
    active = false;
  }
  if (!active) return;

  // --- Ring buffer of captured entries. ---
  /** @typedef {{ t: string, level: string, msg: string }} DebugEntry */
  /** @type {DebugEntry[]} */
  var entries = [];
  /** @type {HTMLElement | null} */
  var logEl = null;
  /** @type {HTMLElement | null} */
  var countEl = null;
  /** @type {HTMLElement | null} */
  var badgeEl = null;
  var errorCount = 0;

  // A count of errors shown on the collapsed toggle, so a failure is visible on
  // mobile without opening the panel.
  function updateBadge() {
    if (!badgeEl) return;
    badgeEl.textContent = errorCount > 99 ? '99+' : String(errorCount);
    badgeEl.style.display = errorCount > 0 ? 'flex' : 'none';
  }

  /**
   * @param {number | string} n
   * @param {number} [width]
   */
  function pad(n, width) {
    n = String(n);
    while (n.length < (width || 2)) n = '0' + n;
    return n;
  }
  function stamp() {
    var d = new Date();
    return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + '.' + pad(d.getMilliseconds(), 3);
  }
  /** @param {unknown} a */
  function stringify(a) {
    try {
      if (a instanceof Error) return a.stack || (a.name + ': ' + a.message);
      if (typeof a === 'object' && a !== null) return JSON.stringify(a);
      return String(a);
    } catch (e) {
      return '[unstringifiable ' + (typeof a) + ']';
    }
  }
  /** @type {Record<string, string>} */
  var LEVEL_COLOUR = { error: '#ff6b6b', warn: '#ffd166', info: '#8ecae6', log: '#d0d0d0', debug: '#9aa0a6', ok: '#95d5b2' };

  /**
   * @param {string} level
   * @param {IArguments | unknown[]} parts
   */
  function record(level, parts) {
    var msg = Array.prototype.slice.call(parts).map(stringify).join(' ');
    var entry = { t: stamp(), level: level, msg: msg };
    entries.push(entry);
    if (entries.length > MAX_ENTRIES) entries.shift();
    if (logEl) { appendRow(entry); trimRows(); }
    if (countEl) { countEl.textContent = String(entries.length); }
    if (level === 'error') { errorCount += 1; updateBadge(); }
  }

  /** @param {DebugEntry} entry */
  function appendRow(entry) {
    if (!logEl) return;
    var row = document.createElement('div');
    row.style.cssText = 'padding:2px 0;border-bottom:1px solid #2a2a2a;white-space:pre-wrap;word-break:break-word';
    var when = document.createElement('span');
    when.textContent = entry.t + ' ';
    when.style.cssText = 'color:#6b6b6b';
    var lvl = document.createElement('span');
    lvl.textContent = entry.level.toUpperCase() + ' ';
    lvl.style.cssText = 'color:' + (LEVEL_COLOUR[entry.level] || '#d0d0d0') + ';font-weight:600';
    var body = document.createElement('span');
    body.textContent = entry.msg;
    body.style.cssText = 'color:#e8e8e8';
    row.appendChild(when); row.appendChild(lvl); row.appendChild(body);
    logEl.appendChild(row);
    logEl.scrollTop = logEl.scrollHeight;
  }
  function trimRows() {
    if (!logEl) return;
    while (logEl.childNodes.length > MAX_ENTRIES && logEl.firstChild) logEl.removeChild(logEl.firstChild);
  }

  // --- Capture: console methods, uncaught errors (incl. resource 404s), and
  //     unhandled promise rejections. Installed before anything else runs. ---
  /** @type {('log' | 'info' | 'warn' | 'error' | 'debug')[]} */
  var CONSOLE_LEVELS = ['log', 'info', 'warn', 'error', 'debug'];
  CONSOLE_LEVELS.forEach(function (name) {
    // The no-op fallback is widened to the variadic console-method shape so
    // the wrapper below forwards its arguments to either branch.
    var original = /** @type {(...args: unknown[]) => void} */ (console[name] ? console[name].bind(console) : function () {});
    console[name] = function () {
      record(name === 'debug' ? 'debug' : name, arguments);
      // The arguments object is array-like, not an array; apply accepts it at
      // runtime, so it is passed through as-is under an array-typed view.
      original.apply(null, /** @type {unknown[]} */ (/** @type {unknown} */ (arguments)));
    };
  });

  window.addEventListener('error', function (event) {
    // Resource load failures (a 404 on a script/style/image) surface here with
    // the failing element as target but no message — exactly the class that took
    // the lookup down. Distinguish them from thrown script errors. The target is
    // read through a widened view: which of src/href/tagName exist depends on
    // the failing element's kind, and the truthiness checks below carry the
    // runtime narrowing.
    var target = /** @type {(EventTarget & { src?: string, href?: string, tagName?: string }) | null} */ (event.target);
    if (target && target !== window && (target.src || target.href)) {
      record('error', ['RESOURCE FAILED TO LOAD: ' + (target.src || target.href) + ' <' + (target.tagName || '?').toLowerCase() + '>']);
      return;
    }
    record('error', ['UNCAUGHT: ' + (event.message || 'error') + (event.filename ? '  (' + event.filename + ':' + event.lineno + ':' + event.colno + ')' : '')]);
  }, true); // capture phase: resource errors do not bubble

  window.addEventListener('unhandledrejection', function (event) {
    var r = event.reason;
    record('error', ['UNHANDLED PROMISE REJECTION: ' + (r instanceof Error ? (r.stack || r.message) : stringify(r))]);
  });

  // --- Active diagnostics: probe the things that break in the field, so the
  //     panel answers "404 vs DB unreachable vs vendor missing vs logic". ---
  /** @param {string} path */
  function base(path) {
    return new URL(path, document.baseURI).href;
  }
  /**
   * @param {string} label
   * @param {string} path
   * @param {RequestInit} [opts]
   */
  function probe(label, path, opts) {
    var pending;
    try {
      pending = fetch(base(path), opts || { cache: 'no-store' });
    } catch (err) {
      // A thrown value is `unknown`; read the message through a narrowed view.
      var thrown = /** @type {{ message?: string }} */ ((typeof err === 'object' && err !== null) ? err : {});
      record('error', ['FAIL  ' + label + '  (' + path + ')  ' + (thrown.message ? thrown.message : String(err))]);
      return Promise.resolve(false);
    }
    return pending.then(function (res) {
      var extra = '';
      if (res.headers.get('accept-ranges')) extra += ' accept-ranges=' + res.headers.get('accept-ranges');
      var ct = res.headers.get('content-type');
      if (ct) extra += ' type=' + ct.split(';')[0];
      record(res.ok ? 'ok' : 'error', [(res.ok ? 'OK   ' : 'FAIL ') + res.status + '  ' + label + '  (' + path + ')' + extra]);
      return res.ok;
    }).catch(function (err) {
      record('error', ['FAIL  ' + label + '  (' + path + ')  ' + (err && err.message ? err.message : String(err))]);
      return false;
    });
  }

  function runDiagnostics() {
    record('info', ['— diagnostics —']);
    // The httpvfs UMD loader attaches createDbWorker to window (vendor global,
    // no shipped types); probing its presence is this diagnostic's whole point,
    // so the global is read through an optional view.
    var vendorGlobals = /** @type {{ createDbWorker?: unknown }} */ (/** @type {unknown} */ (window));
    record('info', ['createDbWorker (vendor) is a ' + typeof vendorGlobals.createDbWorker + (typeof vendorGlobals.createDbWorker === 'function' ? ' ✓' : ' ✗ — the lookup cannot run without it')]);
    record('info', ['service worker: ' + (navigator.serviceWorker ? (navigator.serviceWorker.controller ? 'controlling this page' : 'registered, not controlling') : 'unsupported')]);
    record('info', ['network: ' + (navigator.onLine ? 'online' : 'OFFLINE')]);
    // Modules the pages import (a 404 here is the deploy-coverage failure mode).
    ['app.js', 'browser-query.js', 'prefix-country.js', 'history-sync.js', 'entry-browser.js', 'callsign-pill.js'].forEach(function (m) { probe('module ' + m, m); });
    probe('vendor bundle', 'vendor/index.js');
    probe('sqlite wasm', 'vendor/sql-wasm.wasm', { method: 'HEAD', cache: 'no-store' });
    probe('data version', 'data/version.txt');
    // The database is served under a .png costume and read by HTTP Range; a HEAD
    // tells us it exists and whether Range is offered (httpvfs needs it).
    probe('lookup database', 'data/callsigns.sqlite.png', { method: 'HEAD', cache: 'no-store' });
  }

  // --- UI: a floating toggle and a collapsible panel, all inline-styled. ---
  /**
   * @param {string} label
   * @param {() => void} handler
   */
  function button(label, handler) {
    var b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'font:inherit;color:#fff;background:#333;border:1px solid #555;border-radius:6px;padding:6px 10px;margin:0 4px 0 0;min-height:34px;cursor:pointer';
    b.addEventListener('click', handler);
    return b;
  }

  function build() {
    var panel = document.createElement('div');
    panel.setAttribute('role', 'log');
    panel.setAttribute('aria-label', 'Debug console');
    panel.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2147483647;max-height:45vh;display:none;flex-direction:column;background:#141414;color:#e8e8e8;font:12px/1.5 ui-monospace,Menlo,Consolas,monospace;box-shadow:0 -2px 12px rgba(0,0,0,.5)';

    var bar = document.createElement('div');
    bar.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;gap:4px;padding:6px 8px;background:#1f1f1f;border-bottom:1px solid #333';
    var title = document.createElement('strong');
    title.textContent = 'debug';
    title.style.cssText = 'color:#8ecae6;margin-right:6px';
    countEl = document.createElement('span');
    countEl.textContent = '0';
    countEl.style.cssText = 'color:#9aa0a6;margin-right:auto';
    bar.appendChild(title); bar.appendChild(countEl);
    bar.appendChild(button('Diagnose', runDiagnostics));
    bar.appendChild(button('Copy', function () {
      var text = entries.map(function (e) { return e.t + ' ' + e.level.toUpperCase() + ' ' + e.msg; }).join('\n');
      var done = function () { record('info', ['copied ' + entries.length + ' lines to clipboard']); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
      } else { fallbackCopy(text); done(); }
    }));
    bar.appendChild(button('Clear', function () { entries.length = 0; if (logEl) logEl.textContent = ''; if (countEl) countEl.textContent = '0'; }));
    bar.appendChild(button('Off', function () {
      try { localStorage.removeItem(STORE_KEY); } catch (e) {}
      panel.remove(); toggle.remove();
    }));

    logEl = document.createElement('div');
    logEl.style.cssText = 'overflow:auto;-webkit-overflow-scrolling:touch;padding:6px 8px;flex:1';

    panel.appendChild(bar);
    panel.appendChild(logEl);

    var toggle = document.createElement('button');
    toggle.setAttribute('aria-label', 'Toggle debug console');
    toggle.style.cssText = 'position:fixed;right:10px;bottom:10px;z-index:2147483647;width:44px;height:44px;border-radius:50%;border:none;background:#8ecae6;color:#000;font-size:20px;box-shadow:0 2px 8px rgba(0,0,0,.4);cursor:pointer';
    var bug = document.createElement('span');
    bug.textContent = '🐞';
    badgeEl = document.createElement('span');
    badgeEl.style.cssText = 'position:absolute;top:-3px;right:-3px;min-width:18px;height:18px;padding:0 4px;box-sizing:border-box;display:none;align-items:center;justify-content:center;background:#e5484d;color:#fff;border-radius:9px;font:600 11px/1 system-ui,sans-serif';
    toggle.appendChild(bug);
    toggle.appendChild(badgeEl);
    toggle.addEventListener('click', function () {
      panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
    });

    document.body.appendChild(panel);
    document.body.appendChild(toggle);

    // Flush entries captured before the UI existed.
    for (var i = 0; i < entries.length; i++) appendRow(entries[i]);
    countEl.textContent = String(entries.length);
    updateBadge();
    return { panel: panel, toggle: toggle };
  }

  /** @param {string} text */
  function fallbackCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    } catch (e) { /* nothing more we can do */ }
  }

  var toggle;
  function start() {
    var ui = build();
    toggle = ui.toggle;
    record('info', ['debug console active — ' + window.location.href]);
    record('info', [navigator.userAgent]);
    // A first automatic pass so the panel is useful the moment it opens.
    runDiagnostics();
  }

  if (document.body) start();
  else window.addEventListener('DOMContentLoaded', start);
})();
