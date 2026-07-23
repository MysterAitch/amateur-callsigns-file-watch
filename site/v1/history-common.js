// @ts-check
// v1 HISTORY — shared render helpers (issue #932). The two event-first history
// surfaces (the on-this-day calendar and the event-time timeline) share one
// assertion-time fold, one caveat vocabulary and one mechanism-explainer idiom,
// so they read as one instrument. Everything data-derived is written with
// textContent, never innerHTML; the v1 surface links only to itself, so dataset
// names render as plain text (the raw archive key rides as a native tooltip),
// exactly as the callsign page's assertedByFold does (post-#956 conventions).

import { inlineTerm, termCue } from './glossary.js';

/** @param {string} tag @param {string | null} [cls] @param {string | null} [txt] */
export const el = (tag, cls, txt) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (txt != null) node.textContent = txt;
  return node;
};

/** @param {string} href @param {string} label @param {string | null} [cls] */
export const link = (href, label, cls) => {
  const a = el('a', cls ?? null, label);
  a.setAttribute('href', href);
  return a;
};

/**
 * Fill {placeholder} tokens in a copy template. Every value is coerced to a
 * string; an unfilled token is left verbatim (visible, never silently dropped).
 * @param {string} template
 * @param {Record<string, string | number>} values
 * @returns {string}
 */
export function fill(template, values) {
  let out = template;
  for (const [k, v] of Object.entries(values)) out = out.replaceAll(`{${k}}`, String(v));
  return out;
}

/**
 * @typedef {object} HistoryDataset
 * @property {string} key
 * @property {string} vintage
 * @property {string} title
 */

/**
 * @typedef {object} HistoryCaveat
 * @property {string} id
 * @property {string} label
 * @property {string} gloss
 */

/**
 * The page lede, carrying its event-time glossary cue via the live glossary
 * machinery (the same popover the callsign dial opens) so the coined vocabulary
 * is one click from its definition. The lede text already carries the event-time
 * gloss verbatim; the cue links out to the fuller glossary definition.
 * @param {string} ledeText
 * @returns {HTMLElement}
 */
export function ledeWithCue(ledeText) {
  const p = el('p', 'note hx-lede');
  p.append(ledeText);
  const ax = el('span', 'ax hx-ax');
  ax.append('event-time');
  ax.appendChild(termCue('eventTime'));
  p.append(' ');
  p.appendChild(ax);
  return p;
}

/**
 * The assertion-time fold for a dated claim: a compact expandable list of the
 * publications that assert it, the friendly title leading and the raw archive
 * key riding as a native tooltip. Dataset names are plain text — the v1 surface
 * links only to itself. `nrows`, where a source carries a per-claim row count,
 * rides after the title.
 * @param {HistoryDataset[]} datasets  the sources asserting this claim
 * @param {string} foldLabelTemplate   copy template with {count} and {publication}
 * @returns {HTMLElement}
 */
export function assertedByFold(datasets, foldLabelTemplate) {
  const details = el('details', 'evt-assert');
  const n = datasets.length;
  const label = fill(foldLabelTemplate, { count: n, publication: n === 1 ? 'publication' : 'publications' });
  details.appendChild(el('summary', null, label));
  const ul = el('ul');
  for (const d of datasets) {
    const li = el('li');
    if (d.key !== '') li.setAttribute('title', d.key);
    li.append(d.vintage !== '' ? `${d.title} (` : d.title);
    if (d.vintage !== '') {
      li.append('vintage ');
      const v = inlineTerm('vintage', d.vintage);
      li.appendChild(v);
      li.append(')');
    }
    ul.appendChild(li);
  }
  details.appendChild(ul);
  return details;
}

/**
 * Resolve a list of caveat ids to the small linked labels that ride beside a
 * dated figure: each links to the page's folded explainer and carries its full
 * gloss as a tooltip, so a caveat id never renders bare (issue #861). An id with
 * no legend entry falls back to a humanised label and flags the gap in the
 * tooltip rather than showing a machine id.
 * @param {string[]} caveatIds
 * @param {Map<string, HistoryCaveat>} legend
 * @param {string} explainerHref
 * @returns {HTMLElement | null}  a `.hx-caveats` span, or null when there are none
 */
export function caveatLinks(caveatIds, legend, explainerHref) {
  if (caveatIds.length === 0) return null;
  const span = el('span', 'hx-caveats');
  span.append('Caveats: ');
  caveatIds.forEach((id, i) => {
    if (i > 0) span.append('; ');
    const caveat = legend.get(id);
    const a = link(explainerHref, caveat === undefined ? id.replace(/-/g, ' ') : caveat.label);
    a.setAttribute('title', caveat === undefined ? 'This caveat is not in the page legend; see the explainer.' : caveat.gloss);
    span.appendChild(a);
  });
  span.append('.');
  return span;
}

/**
 * The folded mechanism explainer, built from the manifest's caveat legend so its
 * every bullet is the engine's own gloss — never a second, driftable copy. Each
 * caveat's stable id becomes the `<li>` id, so the caveat links can target it.
 * @param {string} explainerId
 * @param {string} labelText
 * @param {string} leadText
 * @param {HistoryCaveat[]} caveats
 * @returns {HTMLElement}
 */
export function explainer(explainerId, labelText, leadText, caveats) {
  const details = el('details', 'hx-explainer');
  details.id = explainerId;
  details.appendChild(el('summary', null, labelText));
  const body = el('div', 'b');
  body.appendChild(el('p', 'note', leadText));
  const ul = el('ul');
  for (const c of caveats) {
    const li = el('li');
    li.id = `${explainerId}-${c.id}`;
    li.appendChild(el('b', null, c.label));
    li.append(` – ${c.gloss}`);
    ul.appendChild(li);
  }
  body.appendChild(ul);
  details.appendChild(body);
  return details;
}

/**
 * The honest no-JS / load-failure note: a calm `.note` line, never a dead
 * control or an empty shell.
 * @param {string} text
 * @returns {HTMLElement}
 */
export function calmNote(text) {
  return el('p', 'note hx-note', text);
}
