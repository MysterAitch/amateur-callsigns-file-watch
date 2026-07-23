// @ts-check
// v1 GLOSSARY POPOVERS (issue #921, B1): the one interaction grammar for coined
// vocabulary — a jargon term (or a provenance chip) opens a click-toggled
// popover carrying its definition inline, never a whole-page navigation out of
// the prose.
//
// The popover is a plain <details class="term"> so it works with NO script and
// no popover-API support: the <summary> is the affordance, the .pop is the
// definition, and shell.css shows the definition purely on the [open] state.
// The script here is progressive enhancement only: it makes the popovers behave
// as a well-mannered set (one open at a time, dismissed on outside-click or
// Escape) and keeps a popover inside the viewport (flipping it to hang from the
// right edge when a centred/left-anchored one would overflow). Because the
// definition lives inside the inline term it scrolls WITH the prose and stays
// anchored to its word.
//
// All wording comes from the copy registry (site/v1/copy.js); no term text is
// authored here.

import { V1_COPY } from './copy.js';

/** @param {string} tag @param {string | null} [cls] @param {string | null} [txt] */
const el = (tag, cls, txt) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (txt != null) node.textContent = txt;
  return node;
};

/** @typedef {keyof typeof V1_COPY.glossary} GlossaryKey */

/**
 * The definition body of a popover: the term name as a label, then its plain
 * definition. Built with textContent throughout (never innerHTML).
 * @param {{ term: string, def: string }} entry
 * @returns {HTMLElement}
 */
function buildPop(entry) {
  const pop = el('div', 'pop');
  pop.setAttribute('role', 'tooltip');
  pop.appendChild(el('span', 'pl', entry.term));
  pop.append(entry.def);
  return pop;
}

/**
 * An inline coined term rendered as a popover: the word carries a dashed
 * underline and opens its definition on click. `label` overrides the visible
 * word (e.g. a plural or a mid-sentence casing) while the definition stays keyed
 * to the registry entry.
 * @param {GlossaryKey} key
 * @param {string} [label]
 * @returns {HTMLDetailsElement}
 */
export function inlineTerm(key, label) {
  const entry = V1_COPY.glossary[key];
  const details = /** @type {HTMLDetailsElement} */ (el('details', 'term'));
  const summary = el('summary', null, label ?? entry.term);
  summary.setAttribute('aria-label', `${label ?? entry.term} — glossary definition`);
  details.appendChild(summary);
  details.appendChild(buildPop(entry));
  return details;
}

/**
 * A standalone "?" cue popover, for where the term is already written out in the
 * surrounding prose (e.g. the dial's track labels carry their one-line gloss
 * verbatim) and only a click-through to the fuller definition is wanted. Keeps
 * the prose text intact and appends the cue after it.
 * @param {GlossaryKey} key
 * @returns {HTMLDetailsElement}
 */
export function termCue(key) {
  const entry = V1_COPY.glossary[key];
  const details = /** @type {HTMLDetailsElement} */ (el('details', 'term cue'));
  const summary = el('summary', null, '?');
  summary.setAttribute('aria-label', `${entry.term} — glossary definition`);
  details.appendChild(summary);
  details.appendChild(buildPop(entry));
  return details;
}

/**
 * A provenance/derivation chip (the small monospace `.tb` marker) rendered as a
 * popover: the chip stays visible and keeps its exact label text (so the marker
 * still reads "derived"/"inferred"/"context"), and clicking it opens the
 * definition of what that mechanism means. This is the deferred glossary
 * popover the chip's styling comment always pointed at (issue #921, B1).
 * @param {'derived' | 'inferred' | 'context'} kind
 * @returns {HTMLDetailsElement}
 */
export function provenanceChip(kind) {
  const entry = V1_COPY.glossary[kind];
  const details = /** @type {HTMLDetailsElement} */ (el('details', 'term prov-term'));
  const summary = el('summary', 'prov-summary');
  summary.setAttribute('aria-label', `${kind} — glossary definition`);
  summary.appendChild(el('span', 'tb', kind));
  details.appendChild(summary);
  details.appendChild(buildPop(entry));
  return details;
}

/**
 * Keep an open popover inside the viewport: if a left-anchored popover would
 * spill past the right edge, flip it to hang from the term's right instead
 * (shell.css positions it from data-edge). No-op where layout metrics are
 * unavailable (e.g. jsdom returns zeroed rects), so it never throws.
 * @param {HTMLDetailsElement} term
 */
function positionPopover(term) {
  const pop = term.querySelector('.pop');
  if (pop === null) return;
  term.removeAttribute('data-edge');
  const rect = pop.getBoundingClientRect();
  const vw = term.ownerDocument.defaultView?.innerWidth ?? 0;
  if (vw > 0 && rect.right > vw - 8) term.setAttribute('data-edge', 'r');
}

/**
 * Wire every glossary popover under `root` into a well-mannered set: one open at
 * a time, dismissed on an outside click or Escape, and positioned inside the
 * viewport. Idempotent per document — the document-level listeners are attached
 * once however many roots are wired.
 * @param {HTMLElement | Document} root
 */
export function wireTermPopovers(root) {
  const doc = root instanceof Document ? root : (root.ownerDocument ?? document);
  /** @returns {HTMLDetailsElement[]} */
  const openTerms = () => [...doc.querySelectorAll('details.term[open]')].filter((t) => t instanceof HTMLDetailsElement);
  for (const node of root.querySelectorAll('details.term')) {
    if (!(node instanceof HTMLDetailsElement)) continue;
    if (node.dataset.wired === '1') continue;
    node.dataset.wired = '1';
    node.addEventListener('toggle', () => {
      if (!node.open) return;
      for (const other of openTerms()) if (other !== node) other.open = false;
      positionPopover(node);
    });
  }
  if (doc instanceof Document && doc.documentElement.dataset.termPopoversWired !== '1') {
    doc.documentElement.dataset.termPopoversWired = '1';
    doc.addEventListener('click', (event) => {
      const target = event.target;
      for (const term of openTerms()) {
        if (target instanceof Node && term.contains(target)) continue;
        term.open = false;
      }
    });
    doc.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      for (const term of openTerms()) term.open = false;
    });
  }
}
