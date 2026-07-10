// The shared callsign "pill" for the hand-authored browser surfaces (issue
// #310): the visual identity of a callsign rendered as content, matching the
// server-side callsignPill in src/ci/site-render.ts so a callsign looks and
// reads the same on the index lookup and the per-dataset entry browser as on
// the generated entry, series and per-suffix pages. Frameworkless and
// build-step-free by design (ADR 0002/0003): a plain ES module the front-ends
// import directly, served verbatim.

import { callsignCharMarker } from './browser-query.js';

// The single source of truth for the pill's CSS class, so the lookup's pill
// LINKS and the entry browser's raw-form pill CHIP always target the same
// selector the stylesheet (site/style.css) styles, and can never drift apart.
export const CALLSIGN_PILL_CLASS = 'callsign-pill';

// The supplementary title (hover / assistive-technology description) a pill
// carries when parsed component data is to hand, or null when none is -
// identical in shape to the server pill's title ("M7TEE — prefix series M7 ·
// suffix TEE · Foundation"). The ACCESSIBLE NAME stays the bare callsign (the
// element's own text); these facts are supplementary only, and the pill
// degrades to just the callsign when no components are given. Pure (no DOM), so
// it is unit-tested directly.
export function callsignPillTitle(callsign, components = {}) {
  const facts = [];
  if (components.prefixSeries) facts.push(`prefix series ${components.prefixSeries}`);
  if (components.rsl) facts.push(`RSL ${components.rsl}`);
  if (components.suffix) facts.push(`suffix ${components.suffix}`);
  if (components.licenceClass) facts.push(components.licenceClass);
  return facts.length > 0 ? `${callsign} — ${facts.join(' · ')}` : null;
}

// A callsign rendered as a pill LINK to the register lookup (?c=<callsign>) -
// the browser-surface counterpart of the server callsignPill, used on the
// index lookup wherever a callsign links to its own entry. `el` is the caller's
// own element factory, so this module makes no assumption about how a node is
// built. The link text is the bare callsign, so the accessible name IS the
// callsign; any component data becomes the supplementary title only.
export function callsignPillLink(el, callsign, components = {}) {
  const attrs = { class: CALLSIGN_PILL_CLASS, href: `?c=${encodeURIComponent(callsign)}`, text: callsign };
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
export function callsignPillRaw(el, raw) {
  const node = el('code', { class: CALLSIGN_PILL_CLASS });
  for (const ch of raw) {
    const marker = callsignCharMarker(ch);
    if (marker !== null) node.append(el('span', { class: 'marker', text: marker }));
    else node.append(document.createTextNode(ch));
  }
  return node;
}
