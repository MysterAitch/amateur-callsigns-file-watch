// @ts-check
// Shared per-table controls for the hand-authored browser surfaces (issue
// #667): the kind of controls a data-heavy table is expected to carry —
// download the visible data, choose which columns show, and (where a table
// renders odd-character markers) flip those markers between their friendly
// name and their raw code point.
//
// Progressive enhancement is the governing rule (ADR 0002/0003, and this
// issue's own hard requirement): the table is fully readable with no
// JavaScript at all — every control here is ADDED to an already-present static
// table and does nothing the plain markup could not already show. A page opts a
// table in with `data-table-controls`; the module reads the table's own
// `<thead>` and cells, so no build step and no per-page wiring beyond the one
// attribute and a single `initTableControls()` call.
//
// Frameworkless by design: it drives the real DOM directly (document /
// createElement) rather than taking an element factory, because it operates on
// nodes the page already rendered rather than manufacturing a value the way the
// field wrappers (field-wrappers.js) do. The pure pieces — the CSV field
// quoter, the marker code-point form, the CSV projection of a table — are
// separated out and unit-tested; the DOM assembly is exercised in jsdom.

import { CALLSIGN_CHAR_NAMES } from './browser-query.js';

// The friendly marker vocabulary, inverted to name → code point, so a friendly
// token ({NBSP}) can be turned back into its raw code-point token ({U+00A0}).
// CALLSIGN_CHAR_NAMES (browser-query.js) is the single source of that
// vocabulary; inverting it here keeps this module in step with the markers the
// browsers and the generated pages already emit, by construction. An entry
// whose "name" is itself a bare U+ label (U+FFFD) is skipped: it has no
// separate friendly form to invert.
/** @type {Record<string, number>} */
const MARKER_NAME_TO_CODEPOINT = {};
for (const [cp, name] of Object.entries(CALLSIGN_CHAR_NAMES)) {
  if (!name.startsWith('U+')) MARKER_NAME_TO_CODEPOINT[name] = Number(cp);
}

// A friendly `{NAME}` marker token restated as its raw `{U+XXXX}` code-point
// token. A token that is already a code point, or is not a recognised friendly
// marker, is returned unchanged — so the function is idempotent and safe to
// apply to any cell text. This is the inverse of translateMarkerToken
// (browser-query.js), used both for the "show code points" display toggle and
// to keep the CSV export canonical-at-rest regardless of what is on screen.
/**
 * @param {string} token
 * @returns {string}
 */
export function markerCodepointForm(token) {
  const match = /^\{([A-Z]+)\}$/.exec(token);
  if (match === null) return token;
  const cp = MARKER_NAME_TO_CODEPOINT[match[1]];
  if (cp === undefined) return token;
  return `{U+${cp.toString(16).toUpperCase().padStart(4, '0')}}`;
}

// One CSV field, RFC-4180 quoted only where it must be: a value carrying a
// comma, a double quote, or a line break is wrapped in double quotes with its
// own quotes doubled; anything else is emitted bare. Kept deliberately plain
// and faithful — no locale formatting, no thousands separators — so the file
// round-trips the values exactly as recorded.
/**
 * @param {string} value
 * @returns {string}
 */
export function csvField(value) {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

// The canonical export text of one cell: the value as recorded, not as
// prettified for the screen. An explicit `data-export` attribute wins (the
// caller has stated the canonical value outright); otherwise the cell's text is
// read child by child, and any odd-character `.marker` span contributes its
// raw code-point form ({U+00A0}, never {NBSP}) so an invisible character
// survives the export unambiguously. Ordinary layout whitespace (the newlines
// and indentation of the source markup) is collapsed to single spaces and
// trimmed; the markers carry the whitespace that is actually DATA.
/**
 * @param {Element} cell
 * @returns {string}
 */
export function cellExportValue(cell) {
  const explicit = cell instanceof HTMLElement ? cell.dataset.export : undefined;
  if (explicit !== undefined) return explicit;
  let out = '';
  for (const node of cell.childNodes) {
    if (node.nodeType === Node.ELEMENT_NODE && /** @type {Element} */ (node).classList.contains('marker')) {
      out += markerCodepointForm(node.textContent ?? '');
    } else {
      out += node.textContent ?? '';
    }
  }
  return out.replace(/\s+/g, ' ').trim();
}

// The header row's cells, in order — the last row of the `<thead>`, so a table
// with a filter/sort row above its labels still reads the labels. Empty when a
// table has no header row (the module then declines to enhance it).
/**
 * @param {HTMLTableElement} table
 * @returns {HTMLTableCellElement[]}
 */
function headerCells(table) {
  const head = table.tHead;
  if (head === null || head.rows.length === 0) return [];
  return Array.from(head.rows[head.rows.length - 1].cells);
}

// The visible-column indices of a table: every column whose header cell is not
// hidden, in order. Column selection toggles `hidden` on a whole column, so
// this is what both the export and the column menu read.
/**
 * @param {HTMLTableElement} table
 * @returns {number[]}
 */
function visibleColumnIndices(table) {
  return headerCells(table).flatMap((cell, i) => (cell.hidden ? [] : [i]));
}

// The table projected to CSV text: a header row then one row per body row,
// each limited to the currently-visible columns (or every column when
// `visibleOnly` is false). Values come from cellExportValue, so the export is
// canonical-at-rest — code points, not friendly names — with a header row.
// Rows are joined with "\n", matching the entry browser's existing CSV so every
// download on the site reads the same. An empty result (no visible columns)
// yields the empty string, which the caller treats as "nothing to download".
/**
 * @param {HTMLTableElement} table
 * @param {{ visibleOnly?: boolean }} [options]
 * @returns {string}
 */
export function tableToCsv(table, options = {}) {
  const visibleOnly = options.visibleOnly ?? true;
  const header = headerCells(table);
  const cols = visibleOnly ? visibleColumnIndices(table) : header.map((_, i) => i);
  if (cols.length === 0) return '';
  const lines = [cols.map(i => csvField(cellExportValue(header[i]))).join(',')];
  const body = table.tBodies.length > 0 ? Array.from(table.tBodies[0].rows) : [];
  for (const row of body) {
    const cells = row.cells;
    lines.push(cols.map(i => csvField(i < cells.length ? cellExportValue(cells[i]) : '')).join(','));
  }
  return lines.join('\n');
}

// A small DOM helper local to this module: an element with attributes and text
// in one call, matching the shape the other browser modules use.
/**
 * @param {string} tag
 * @param {Record<string, string>} [attrs]
 * @param {string} [text]
 * @returns {HTMLElement}
 */
function el(tag, attrs = {}, text) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

// A filename-safe slug for the download, from the table's caption or the
// caller-supplied name; falls back to a stable default so a nameless table
// still downloads to something sensible.
/**
 * @param {string} name
 * @returns {string}
 */
function downloadSlug(name) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug === '' ? 'table' : slug;
}

// Set (or clear) the `hidden` flag on every cell of one column, across the head
// and body rows alike, so a hidden column disappears from the rendered table
// while staying in the DOM (it returns intact when re-shown, and JS-off readers
// never lose it).
/**
 * @param {HTMLTableElement} table
 * @param {number} index
 * @param {boolean} hidden
 */
function setColumnHidden(table, index, hidden) {
  for (const row of table.rows) {
    const cell = row.cells[index];
    if (cell !== undefined) cell.hidden = hidden;
  }
}

// Record each odd-character marker's two forms once, so the display toggle can
// flip between them without recomputing: `data-friendly` is what the table
// rendered ({NBSP}); `data-codepoint` is the raw form ({U+00A0}).
/**
 * @param {HTMLTableElement} table
 * @returns {HTMLElement[]}
 */
function markerSpans(table) {
  const spans = /** @type {HTMLElement[]} */ (Array.from(table.querySelectorAll('.marker')));
  for (const span of spans) {
    if (span.dataset.friendly === undefined) {
      const friendly = span.textContent ?? '';
      span.dataset.friendly = friendly;
      span.dataset.codepoint = markerCodepointForm(friendly);
    }
  }
  return spans;
}

/**
 * @typedef {object} TableController
 * @property {HTMLElement} element The controls container inserted into the page.
 * @property {HTMLTableElement} table The enhanced table.
 */

// Enhance one already-rendered table with the shared controls. Returns the
// controller, or null when the table cannot meaningfully take controls (no
// header row) — in which case the table is left exactly as it was. Idempotent:
// a table already enhanced is returned unchanged rather than double-decorated.
/**
 * @param {HTMLTableElement} table
 * @param {{ name?: string; codepoints?: boolean }} [options]
 * @returns {TableController | null}
 */
export function enhanceTable(table, options = {}) {
  if (table.dataset.tcEnhanced === 'true') return null;
  const header = headerCells(table);
  if (header.length === 0) return null;
  table.dataset.tcEnhanced = 'true';

  const caption = table.caption?.textContent?.trim() ?? '';
  const name = options.name ?? (caption !== '' ? caption : 'this table');

  const container = el('div', { class: 'table-controls', role: 'group', 'aria-label': `Controls for ${name}` });
  const status = el('span', { class: 'tc-status', role: 'status', 'aria-live': 'polite' });

  // --- download the visible data as CSV ---
  const downloadBtn = el('button', { type: 'button', class: 'tc-btn tc-download' }, 'Download CSV');
  downloadBtn.addEventListener('click', () => {
    const csv = tableToCsv(table, { visibleOnly: true });
    if (csv === '') {
      status.textContent = 'Select at least one column to download.';
      return;
    }
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = el('a', { href: url, download: `${downloadSlug(name)}.csv` });
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    const rowCount = table.tBodies.length > 0 ? table.tBodies[0].rows.length : 0;
    status.textContent = `Downloaded ${rowCount} ${rowCount === 1 ? 'row' : 'rows'}.`;
  });
  container.append(downloadBtn);

  // --- column selection (only where there is more than one column to choose) ---
  if (header.length > 1) {
    const details = el('details', { class: 'tc-cols' });
    const summary = el('summary', { class: 'tc-btn' }, 'Columns');
    const menu = el('div', { class: 'tc-colmenu' });
    header.forEach((cell, i) => {
      const label = el('label');
      const checkbox = /** @type {HTMLInputElement} */ (el('input', { type: 'checkbox' }));
      checkbox.checked = !cell.hidden;
      checkbox.addEventListener('change', () => {
        setColumnHidden(table, i, !checkbox.checked);
        const shown = visibleColumnIndices(table).length;
        status.textContent = shown === 0 ? 'All columns hidden.' : `${shown} of ${header.length} columns shown.`;
      });
      label.append(checkbox, document.createTextNode(` ${cellExportValue(cell) || `Column ${i + 1}`}`));
      menu.append(label);
    });
    details.append(summary, menu);
    container.append(details);
  }

  // --- code-points display toggle (only where the table renders markers) ---
  const spans = markerSpans(table);
  if (options.codepoints === true || spans.length > 0) {
    const toggleLabel = el('label', { class: 'tc-toggle' });
    const toggle = /** @type {HTMLInputElement} */ (el('input', { type: 'checkbox', class: 'tc-codepoints' }));
    toggle.addEventListener('change', () => {
      for (const span of markerSpans(table)) {
        span.textContent = toggle.checked ? (span.dataset.codepoint ?? '') : (span.dataset.friendly ?? '');
      }
      status.textContent = toggle.checked ? 'Showing code points.' : 'Showing friendly names.';
    });
    toggleLabel.append(toggle, document.createTextNode(' Show code points'));
    container.append(toggleLabel);
  }

  container.append(status);

  // Insert the controls above the table — above its horizontal-scroll wrapper
  // (.overflow) where one is present, so the controls are not themselves inside
  // the scroll region.
  const wrapper = table.parentElement;
  const anchor = wrapper !== null && wrapper.classList.contains('overflow') ? wrapper : table;
  anchor.parentElement?.insertBefore(container, anchor);
  return { element: container, table };
}

// Enhance every opted-in table (`data-table-controls`) under `root`. Called
// once per page after load; safe to call again (enhanceTable is idempotent).
/**
 * @param {ParentNode} [root]
 * @returns {TableController[]}
 */
export function initTableControls(root = document) {
  const tables = /** @type {HTMLTableElement[]} */ (Array.from(root.querySelectorAll('table[data-table-controls]')));
  const controllers = [];
  for (const table of tables) {
    const codepoints = table.dataset.tableControls === 'codepoints';
    const controller = enhanceTable(table, { codepoints });
    if (controller !== null) controllers.push(controller);
  }
  return controllers;
}
