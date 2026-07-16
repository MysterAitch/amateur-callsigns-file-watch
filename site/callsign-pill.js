// @ts-check
// The shared visual identity of a callsign on the hand-authored browser
// surfaces. Two affordances live here:
//
//   - the callsign "pill" (issue #310): a callsign rendered as content,
//     matching the server-side callsignPill in src/ci/site-render.ts so a
//     callsign looks and reads the same on the index lookup and the
//     per-dataset entry browser as on the generated entry, series and
//     per-suffix pages; and
//   - the segments-driven anatomy figure (issue #595): ONE implementation of
//     the geometry and markup behind the labelled, colour-grouped anatomy
//     diagram, shared verbatim by the build-time structure-page example
//     (src/ci/render/anatomy.ts, issue #468 - whose committed output a drift
//     guard pins) and the live per-callsign figure (site/callsign.js).
//
// Frameworkless and build-step-free by design (ADR 0002/0003): a plain ES
// module the front-ends import directly, served verbatim - and, for the
// anatomy figure, imported by the node-side build too, so there is exactly
// one source of the markup.
//
// This module is also the browser-side counterpart of src/ci/render/callsign.ts
// (issue #658): CALLSIGN_CLASS and appendMarkedChars are the base class and
// the character-marking loop the callsign-PART wrappers in field-wrappers.js
// (a prefix series, a forbidden suffix) share, so a part reads with the same
// visual identity as the whole callsign it is a fragment of - here too.

import { callsignCharMarker } from './browser-query.js';

// The parsed component facts a pill may carry, all optional: a pill degrades to
// the bare callsign when none are supplied.
/**
 * @typedef {object} CallsignComponents
 * @property {string} [prefixSeries]
 * @property {string} [rsl]
 * @property {string} [suffix]
 * @property {string} [licenceClass]
 */

// The caller's own element factory, so this module makes no assumption about how
// a node is built: given a tag and optional attributes it returns the element.
/** @typedef {(tag: string, attrs?: Record<string, string>) => HTMLElement} ElementFactory */

// The stable class every callsign-FAMILY value carries - the whole callsign
// here, and (issue #658) a prefix series or forbidden suffix in
// field-wrappers.js - mirroring CALLSIGN_CLASS in src/ci/render/callsign.ts so
// a part reads with the SAME visual identity as the callsign it is a fragment
// of, on the hand-authored surfaces exactly as it already does on the
// generated pages. Confirmed gap (issue #652's own residual note on #644): the
// pill below did not carry this class before #658, so a browser-rendered
// callsign and a browser-rendered series/suffix could never be styled as one
// family via a shared selector - only this one export fixes that for all three.
export const CALLSIGN_CLASS = 'cs';

// The single source of truth for the pill's CSS class, so the lookup's pill
// LINKS and the entry browser's raw-form pill CHIP always target the same
// selector the stylesheet (site/style.css) styles, and can never drift apart.
export const CALLSIGN_PILL_CLASS = 'callsign-pill';

// Append `value`'s characters into `host`, making any whitespace, control,
// format or replacement character visible as a highlighted {marker} span
// (callsignCharMarker, browser-query.js) - the DOM-node equivalent of
// src/ci/render/callsign.ts's callsignDisplay('marked'), restated here (not
// duplicated) as the ONE character-marking loop every browser wrapper that
// needs odd-character transparency draws on: this module's own raw pill chip
// below, and (issue #658) the suffix field wrapper in field-wrappers.js, whose
// values carry the same "raw text lifted verbatim from a publication" risk
// profile a whole callsign does. `el` is the caller's element factory.
/**
 * @param {ElementFactory} el
 * @param {HTMLElement} host
 * @param {string} value
 * @returns {HTMLElement}
 */
export function appendMarkedChars(el, host, value) {
  for (const ch of value) {
    const marker = callsignCharMarker(ch);
    if (marker !== null) host.append(el('span', { class: 'marker', text: marker }));
    else host.append(ch);
  }
  return host;
}

// The supplementary title (hover / assistive-technology description) a pill
// carries when parsed component data is to hand, or null when none is -
// identical in shape to the server pill's title ("M7TEE — prefix series M7 ·
// suffix TEE · Foundation"). The ACCESSIBLE NAME stays the bare callsign (the
// element's own text); these facts are supplementary only, and the pill
// degrades to just the callsign when no components are given. Pure (no DOM), so
// it is unit-tested directly.
/**
 * @param {string} callsign
 * @param {CallsignComponents} [components]
 * @returns {string | null}
 */
export function callsignPillTitle(callsign, components = {}) {
  const facts = [];
  if (components.prefixSeries) facts.push(`prefix series ${components.prefixSeries}`);
  if (components.rsl) facts.push(`RSL ${components.rsl}`);
  if (components.suffix) facts.push(`suffix ${components.suffix}`);
  if (components.licenceClass) facts.push(components.licenceClass);
  return facts.length > 0 ? `${callsign} — ${facts.join(' · ')}` : null;
}

// A callsign rendered as a pill LINK to its canonical per-callsign page
// (callsign.html?c=<callsign>, issue #594) - the browser-surface counterpart
// of the server callsignPill, used wherever an interactive surface's results
// link a callsign to its own entry (the lookup, the entry browser, Explore,
// Compare). `el` is the caller's own element factory, so this module makes no
// assumption about how a node is built. The link text is the bare callsign, so
// the accessible name IS the callsign; any component data becomes the
// supplementary title only.
/**
 * @param {ElementFactory} el
 * @param {string} callsign
 * @param {CallsignComponents} [components]
 */
export function callsignPillLink(el, callsign, components = {}) {
  /** @type {Record<string, string>} */
  const attrs = { class: `${CALLSIGN_CLASS} ${CALLSIGN_PILL_CLASS}`, href: `callsign.html?c=${encodeURIComponent(callsign)}`, text: callsign };
  const title = callsignPillTitle(callsign, components);
  if (title !== null) attrs.title = title;
  return el('a', attrs);
}

// A callsign rendered so every character is legible AND wearing the shared pill
// visual (issue #310): plain glyphs pass through, but any whitespace, control,
// format or replacement character becomes a visible {marker} span ({SP},
// {NBSP}, {U+200B}, …), so a clean callsign renders identically and a damaged
// one stops hiding. Used for the entry browser's raw callsign column, where it
// stays a NON-link chip: the raw as-published bytes are data to inspect, not a
// navigation target, and its accessible name is the raw text WITH its markers,
// preserving the browser's transparency view. `el` is the caller's element
// factory.
/**
 * @param {ElementFactory} el
 * @param {string} raw
 */
export function callsignPillRaw(el, raw) {
  const node = el('code', { class: `${CALLSIGN_CLASS} ${CALLSIGN_PILL_CLASS}` });
  return appendMarkedChars(el, node, raw);
}

// ---------------------------------------------------------------------------
// The parameterised callsign-anatomy figure (issue #595).
//
// Environment-neutral by design: strings in, one HTML string out - no DOM, no
// node APIs - so the same code runs under the node build and in the browser.
//
// The #468 accessibility conventions live HERE, once: colour is only ever a
// SECONDARY cue (each group is labelled in text on the diagram AND named,
// with its colour spelled out, in the always-visible key table); the SVG
// carries role="img" with a <title>/<desc> spoken summary; and the <table>
// beneath is the crawlable, screen-reader-native fallback. Theme-awareness
// comes free: every colour is a var(--anat-*/--surface-2/--ink/--muted)
// custom property, defined for light and dark in site/ledger.css.
//
// The geometry is COMPUTED from the part list, not hand-authored path data.
// Every interpolated value is HTML-escaped here; `token` and the href fields
// are trusted caller vocabulary (fixed lists in both consumers), never
// register-derived bytes.

/**
 * One colour-and-label group of the diagram, fully resolved by the caller
 * (hrefs already relative to the hosting page).
 * @typedef {object} AnatomyPartSpec
 * @property {string} token       the `--anat-<token>` colour custom property
 * @property {string} colourName  the colour spelled out in words
 * @property {string} chars       the characters this part contributes, in order
 * @property {string} shortLabel  the compact label under the group on the diagram
 * @property {string} name        the full part name (table + spoken description)
 * @property {string} meaning     one-line, plain-English account of the part's role
 * @property {string} nameHref    where the part name links in the table
 * @property {string} [glossaryHref] optional resolved glossary deep-link
 */

/**
 * Everything one rendered figure needs beyond its parts. The lead strings are
 * caller-phrased so the example figure says "the example MW0ABC/P" while the
 * live figure says the viewed callsign; this module supplies the shared
 * sentence structure around them.
 * @typedef {object} AnatomyFigureSpec
 * @property {readonly AnatomyPartSpec[]} parts
 * @property {string} idPrefix       SVG <title>/<desc> id prefix (unique per page)
 * @property {string} titleText      the SVG <title> text
 * @property {string} descLead       opening phrase of the spoken <desc>
 * @property {string} figcaptionLead opening sentence of the <figcaption>
 * @property {string} display        the assembled callsign, for the table caption
 */

/**
 * Minimal HTML escaping for text and double-quoted attribute contexts -
 * byte-identical to the build-side src/ci/render/html.ts helper, restated
 * here so this module stays dependency-free in the browser.
 * @param {string} text
 * @returns {string}
 */
export function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Layout constants (SVG user units). The geometry below is derived from these
// and the part list, so re-spacing the diagram is a matter of the numbers here.
const TILE_W = 46;
const TILE_H = 58;
const IN_GROUP_GAP = 6;
const GROUP_GAP = 30;
const PAD_X = 22;
const TOP_Y = 26;

/**
 * @typedef {object} GlyphCell
 * @property {string} ch
 * @property {number} part
 * @property {number} x
 */

/**
 * One positioned tile per character, spaced tighter within a group than
 * between groups.
 * @param {readonly AnatomyPartSpec[]} parts
 * @returns {GlyphCell[]}
 */
function glyphCells(parts) {
  /** @type {{ ch: string, part: number }[]} */
  const flat = [];
  parts.forEach((p, pi) => {
    for (const ch of p.chars) flat.push({ ch, part: pi });
  });
  /** @type {GlyphCell[]} */
  const cells = [];
  let cursor = PAD_X;
  flat.forEach((c, i) => {
    if (i > 0) {
      const sameGroup = flat[i - 1].part === c.part;
      cursor += TILE_W + (sameGroup ? IN_GROUP_GAP : GROUP_GAP);
    }
    cells.push({ ch: c.ch, part: c.part, x: cursor });
  });
  return cells;
}

/**
 * @param {readonly GlyphCell[]} cells
 * @param {number} part
 * @returns {{ left: number, right: number, centre: number }}
 */
function groupExtent(cells, part) {
  const own = cells.filter(c => c.part === part);
  const left = Math.min(...own.map(c => c.x));
  const right = Math.max(...own.map(c => c.x)) + TILE_W;
  return { left, right, centre: (left + right) / 2 };
}

/**
 * A single spoken sentence per part, assembled into the SVG <desc> so a screen
 * reader hears the whole breakdown without touching the table.
 * @param {string} descLead
 * @param {readonly AnatomyPartSpec[]} parts
 * @returns {string}
 */
function spokenDescription(descLead, parts) {
  const sentences = parts
    .map((p, i) => `${i + 1}, ${p.chars} is the ${p.name.toLowerCase()}: ${p.meaning}`)
    .join(' ');
  return `${descLead}, spaced out and split into ${parts.length} `
    + `colour-and-label groups. ${sentences} Every group is also named in the table beneath the diagram.`;
}

/**
 * The complete anatomy <figure> as a single-line HTML string: the accessible
 * SVG diagram plus the always-visible key table.
 * @param {AnatomyFigureSpec} spec
 * @returns {string}
 */
export function anatomyFigureHtml(spec) {
  const { parts } = spec;
  const cells = glyphCells(parts);
  const width = (cells[cells.length - 1]?.x ?? PAD_X) + TILE_W + PAD_X;
  const glyphBaseline = TOP_Y + TILE_H / 2 + 10;
  const underlineY = TOP_Y + TILE_H + 10;
  const labelY = underlineY + 24;
  const height = labelY + 12;

  const tiles = cells.map(c => {
    const token = parts[c.part].token;
    const cx = (c.x + TILE_W / 2).toFixed(1);
    return `<rect x="${c.x}" y="${TOP_Y}" width="${TILE_W}" height="${TILE_H}" rx="8"`
      + ` fill="var(--surface-2)" stroke="var(--anat-${token})" stroke-width="2"/>`
      + `<text x="${cx}" y="${glyphBaseline}" text-anchor="middle" font-family="var(--mono)"`
      + ` font-size="30" font-weight="700" fill="var(--ink)">${escapeHtml(c.ch)}</text>`;
  }).join('');

  const groups = parts.map((p, pi) => {
    const { left, right, centre } = groupExtent(cells, pi);
    const bar = `<rect x="${left.toFixed(1)}" y="${underlineY}" width="${(right - left).toFixed(1)}"`
      + ` height="6" rx="3" fill="var(--anat-${p.token})"/>`;
    // The number ties the group to its row in the key table; it stays in the
    // neutral ink colour so it is legible independent of the group colour.
    const label = `<text x="${centre.toFixed(1)}" y="${labelY}" text-anchor="middle" font-size="12.5">`
      + `<tspan fill="var(--muted)">${pi + 1} · </tspan>`
      + `<tspan fill="var(--anat-${p.token})" font-weight="600">${escapeHtml(p.shortLabel)}</tspan></text>`;
    return bar + label;
  }).join('');

  const svg = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="${spec.idPrefix}-t ${spec.idPrefix}-d"`
    + ` preserveAspectRatio="xMidYMid meet"><title id="${spec.idPrefix}-t">${escapeHtml(spec.titleText)}</title>`
    + `<desc id="${spec.idPrefix}-d">${escapeHtml(spokenDescription(spec.descLead, parts))}</desc>`
    + `${tiles}${groups}</svg>`;

  const rows = parts.map((p, i) => {
    const gloss = p.glossaryHref === undefined ? ''
      : ` (<a href="${p.glossaryHref}">glossary</a>)`;
    return `<tr><th scope="row">${i + 1}</th>`
      + `<td><a href="${p.nameHref}">${escapeHtml(p.name)}</a>${gloss}</td>`
      + `<td><code>${escapeHtml(p.chars)}</code></td>`
      + `<td><span class="anat-swatch" style="background:var(--anat-${p.token})" aria-hidden="true"></span>${escapeHtml(p.colourName)}</td>`
      + `<td>${escapeHtml(p.meaning)}</td></tr>`;
  }).join('');

  const table = `<table><caption class="table-caption">The parts of ${escapeHtml(spec.display)},`
    + ` the diagram read as a table.</caption><thead><tr><th scope="col">#</th><th scope="col">Part</th>`
    + `<th scope="col">Characters</th><th scope="col">Colour</th><th scope="col">What it is</th></tr></thead>`
    + `<tbody>${rows}</tbody></table>`;

  return `<figure class="anatomy-figure"><figcaption>${escapeHtml(spec.figcaptionLead)}. Colour groups each`
    + ` part; every part is also labelled in words here and in the table.</figcaption>${svg}`
    + `<div class="overflow">${table}</div></figure>`;
}
