// @ts-check
// v1 DATED-FACT CHIP component (issues #965, #966; ADR 0022): the first
// component authored on the el() DOM-construction foundation. There is ONE
// render implementation for both contexts: the browser site bar
// (site/v1/shell.js) appends renderStatic()'s node directly, and the build
// stamp (src/ci/build-v1-chip.ts) serialises the SAME node under the jsdom
// build backend into every root page's static no-JS baseline — so the static
// chip cannot drift from the browser chip, because there is no second
// implementation to police (define once, not duplicate-plus-guard).
//
// The facts stay build-derived: record-facts.js is rewritten at every deploy
// from the holdings manifest (src/ci/build-v1-chip.ts reads holdings.json,
// itself a pure projection of the archived publications), and remains the
// single source no page re-authors. This module renders those facts; it never
// authors them.

import { el } from './el.js';
import { V1_COPY } from './copy.js';

/** @typedef {{ date: string, count: number | string }} ChipFacts */

/**
 * The dated-fact chip text, from the build-stamped facts. Never the word
 * "current": it states, as a fact, the newest publication held and the count.
 * @param {ChipFacts} facts
 * @returns {{ text: string, title: string }}
 */
export function datedFactChip(facts) {
  /** @param {string} s */
  const fill = (s) => s.replaceAll('{date}', facts.date).replaceAll('{count}', String(facts.count));
  return { text: fill(V1_COPY.chip.template), title: fill(V1_COPY.chip.title) };
}

/**
 * The chip's parts, split STRUCTURALLY on the {count} placeholder in the
 * template — never on the rendered count value. The rendered count can also
 * occur inside the date (e.g. "23 June 2026" with 23 publications held), so
 * splitting the finished string on the count would break the chip; splitting
 * the template on the placeholder before the date is substituted cannot.
 * @param {ChipFacts} facts
 * @returns {{ before: string, count: string, after: string, title: string }}
 */
export function datedFactChipParts(facts) {
  const [rawBefore, rawAfter = ''] = V1_COPY.chip.template.split('{count}');
  /** @param {string} s */
  const fillDate = (s) => s.replaceAll('{date}', facts.date);
  return { before: fillDate(rawBefore), count: String(facts.count), after: fillDate(rawAfter), title: datedFactChip(facts).title };
}

/**
 * Build the chip: a stated fact, not a link — the data-status surface it once
 * pointed at is not part of the v1 surface, so the chip carries the fact in a
 * tooltip rather than leading off the surface. The count is bolded from the
 * template's own {count} slot (see datedFactChipParts).
 * @param {ChipFacts} facts
 * @returns {HTMLElement}
 */
export function renderStatic(facts) {
  const parts = datedFactChipParts(facts);
  return el('span', { class: 'chip asof', title: parts.title },
    parts.before,
    el('b', null, parts.count),
    parts.after === '' ? null : parts.after);
}

/**
 * The chip has no behaviour to add — a written no-op (ADR 0022) so the uniform
 * enhance walk calls every component identically and "no enhancement" reads as
 * an intentional statement rather than an ambiguous absence.
 * @returns {void}
 */
export function enhance() {}
