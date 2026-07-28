// @ts-check
// v1 DOM-CONSTRUCTION FOUNDATION (issue #966; ADR 0022): the single render
// primitive every v1 component builds on. `el(tag, attrs, ...children)` builds
// REAL DOM — createElement / setAttribute / textContent — never markup strings,
// so value encoding is delegated to the platform and is safe by construction:
// a child is text unless it is an el() node, and an attribute value is encoded
// by setAttribute. There is ONE codebase across both render contexts: in the
// browser the native DOM, in the Node build a jsdom document supplied via
// setBuildDocument() (the build backend of ADR 0012's amendment — jsdom never
// ships to the published site; this module imports nothing but sibling v1
// modules).
//
// The residual guards the DOM APIs do NOT provide live here, once, and are the
// actual security work (ADR 0022 "Residual security guards", OWASP-codified):
//
//   - attribute NAMES are never data-derived: an allowlist plus the data-/aria-
//     patterns; event-handler (`on*`) names and unknown names fail loud so the
//     allowlist grows deliberately, never silently;
//   - URL-valued attributes (href/src/cite) are routed through the WHATWG-
//     parsing scheme allowlist in site/v1/safe-url.js — a javascript:/data:/
//     protocol-relative value is neutralised to the inert '#';
//   - rawtext elements (script, style, iframe, …), whose children the HTML
//     serialiser emits UNESCAPED (a `</script>` in an FOI title would break
//     out), are refused at construction AND re-checked at serialisation;
//   - void elements refuse children, and the serialiser — the platform's own
//     HTML fragment serialisation via the outerHTML getter, never a hand-rolled
//     escaper — emits them per spec (`<br>`, no closing tag);
//   - SVG / MathML foreign content needs its own namespace context
//     (createElementNS + different serialisation rules) and is refused until
//     that context exists.
//
// innerHTML / insertAdjacentHTML / outerHTML-as-a-sink / document.write are
// never used anywhere in the v1 surface; reading outerHTML below is the
// serialisation SOURCE (spec: HTML fragment serialisation algorithm), not a
// sink.

import { safeHref } from './safe-url.js';

/**
 * A child of el(): text (string/number), a DOM node, null/undefined for "not
 * applicable — suppress" (ADR 0022's content-vs-command protocol), or an array
 * of the same, so a mapped list drops straight in. Arrays flatten recursively
 * at runtime; the TYPE admits one level of nesting because a JSDoc type alias
 * cannot reference itself (TS2456).
 * @typedef {Element | Text | string | number | null | undefined} ElChildLeaf
 * @typedef {ElChildLeaf | ReadonlyArray<ElChildLeaf>} ElChild
 */

/**
 * An attribute value: string/number are set as given (encoded by setAttribute);
 * boolean true sets the empty-valued boolean attribute, false/null/undefined
 * omit it (so a conditional attribute needs no surrounding if).
 * @typedef {string | number | boolean | null | undefined} ElAttrValue
 */

// Elements whose children the HTML serialisation algorithm emits as RAW TEXT
// (no entity escaping): hostile text placed inside one would survive
// serialisation as live markup. Refused outright — the v1 surface has no use
// for any of them (behaviour is wired by enhance(), styling by the shared
// stylesheet), so "strictly guarded" is simply "never built".
const RAWTEXT_ELEMENTS = new Set(['script', 'style', 'xmp', 'iframe', 'noembed', 'noframes', 'plaintext', 'noscript']);

// Foreign-content roots: they need createElementNS and namespace-aware
// serialisation (ADR 0022: "SVG / foreign content handled in its own
// context"). Refused until that context exists, so an SVG built through the
// HTML path can never serialise under the wrong rules.
const FOREIGN_CONTENT_ROOTS = new Set(['svg', 'math']);

// Elements that redefine the page's trust context: <base> rewrites every
// relative URL on the page (an href-resolution hijack the URL guard cannot
// see), <embed>/<object> are plugin/active content. None has a legitimate v1
// use; refused.
const CONTEXT_HAZARD_ELEMENTS = new Set(['base', 'embed', 'object']);

// Elements whose serialised form does NOT come from their child-node list:
// <template> holds its children in a separate `content` DocumentFragment that
// the serialiser emits, so children appended the ordinary way land in the
// child-node list and are SILENTLY DROPPED from the output. No v1 surface uses
// a template; refused, so "children vanished" can never happen unnoticed.
const STRUCTURAL_HAZARD_ELEMENTS = new Set(['template']);

// The union every construction-refusing category contributes to. Construction
// refuses each category below with its own message; serialise() re-checks THIS
// union across the whole tree (defence in depth), so the two layers are derived
// from the same source and can never fall out of step — a tag added to any
// category set above is refused at BOTH construction and serialisation, with no
// second list to keep in sync.
const REFUSED_ELEMENTS = new Set([
  ...RAWTEXT_ELEMENTS, ...FOREIGN_CONTENT_ROOTS, ...CONTEXT_HAZARD_ELEMENTS, ...STRUCTURAL_HAZARD_ELEMENTS,
]);

/**
 * Why a given tag is refused, naming the category it belongs to — so both the
 * construction guards and the serialise-time re-check speak from the same
 * categorisation. Every tag passed here is in REFUSED_ELEMENTS.
 * @param {string} tag  lowercase tag name
 * @returns {string}
 */
function refusalReason(tag) {
  if (RAWTEXT_ELEMENTS.has(tag)) return 'a rawtext element (script/style/…) whose text serialises unescaped';
  if (FOREIGN_CONTENT_ROOTS.has(tag)) return 'foreign content (svg/math) needing namespace-aware serialisation';
  if (CONTEXT_HAZARD_ELEMENTS.has(tag)) return 'a context-hazard element (base/embed/object) that redefines the page trust context';
  if (STRUCTURAL_HAZARD_ELEMENTS.has(tag)) return 'a structural-hazard element (template) whose content fragment serialises apart from its child-node list';
  return 'a construction-refused element';
}

// The HTML void elements: no children, and serialised with no closing tag.
const VOID_ELEMENTS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

// The attribute-NAME allowlist (ADR 0022: attribute names are never
// data-derived). Deliberately small — covering the chrome, tables, links and
// a11y the v1 surface actually renders — and grown one deliberate line at a
// time: an unknown name fails loud below rather than passing silently.
const ATTRIBUTE_NAME_ALLOWLIST = new Set([
  'alt', 'cite', 'class', 'colspan', 'datetime', 'dir', 'for', 'headers',
  'hidden', 'href', 'id', 'lang', 'open', 'rel', 'role', 'rowspan', 'scope',
  'src', 'tabindex', 'title', 'type', 'value',
]);

// data-* / aria-* names pass by pattern (lowercase, hyphenated), so component
// roots (`data-component`) and a11y wiring need no per-name registration.
const ATTRIBUTE_NAME_PATTERN = /^(?:data|aria)-[a-z0-9-]+$/;

// Attributes whose value the browser treats as a URL; their values route
// through the scheme allowlist (safe-url.js) rather than landing verbatim.
const URL_VALUED_ATTRIBUTES = new Set(['href', 'src', 'cite']);

// Event-handler attribute names (onclick, onerror, ONLOAD, …): checked first
// and named in their own error, because a handler smuggled through markup is
// the classic evasion the allowlist exists to stop.
const EVENT_HANDLER_NAME = /^on/i;

// Tag names: lowercase ASCII only. Custom-element names (hyphenated) are
// deliberately outside the pattern — ADR 0022 reserves custom elements for a
// component that genuinely needs per-instance lifecycle, which none does yet.
const TAG_NAME_PATTERN = /^[a-z][a-z0-9]*$/;

// ---------------------------------------------------------------------------
// The render document: the browser's own `document` when one exists (browser,
// jsdom test environment), otherwise the injected build backend. The build
// (src/ci/build-v1-chip.ts and successors) supplies a jsdom document once at
// startup; this module itself never imports jsdom, because this file ships to
// the browser verbatim (repo file = runtime file, ADR 0022).

/** @type {Document | null} */
let buildDocument = null;

/**
 * Supply the Node build backend's document (jsdom). Used only where no global
 * `document` exists; in the browser the native document always wins, so a
 * build-side import of this module can never re-point a live page's DOM.
 * @param {Document} doc
 * @returns {void}
 */
export function setBuildDocument(doc) {
  buildDocument = doc;
}

/** @returns {Document} */
function resolveDocument() {
  if (typeof document !== 'undefined') return document;
  if (buildDocument !== null) return buildDocument;
  throw new Error('el(): no DOM available — in a Node build call setBuildDocument(new JSDOM().window.document) before rendering');
}

/**
 * Cross-realm-safe "is this a DOM node": a jsdom-built node and a browser-built
 * node come from different constructors, so duck-type on the DOM's own
 * invariants rather than instanceof.
 * @param {unknown} value
 * @returns {value is Node}
 */
function isDomNode(value) {
  return typeof value === 'object' && value !== null
    && typeof (/** @type {{ nodeType?: unknown }} */ (value).nodeType) === 'number'
    && typeof (/** @type {{ nodeName?: unknown }} */ (value).nodeName) === 'string';
}

/**
 * @param {string} tag  for the error message only
 * @param {ReadonlyArray<ElChild>} children
 * @param {(string | Node)[]} out
 * @returns {(string | Node)[]}
 */
function flattenChildren(tag, children, out) {
  for (const child of children) {
    if (child === null || child === undefined) continue; // suppress: not applicable
    if (Array.isArray(child)) { flattenChildren(tag, child, out); continue; }
    if (typeof child === 'string') { out.push(child); continue; }
    if (typeof child === 'number') { out.push(String(child)); continue; }
    if (isDomNode(child)) { out.push(child); continue; }
    throw new Error(`el(): <${tag}> given a child of type ${typeof child} — a child is text or an el() node, never anything else (markup arrives as DOM, not strings)`);
  }
  return out;
}

/**
 * @param {HTMLElement} node
 * @param {string} name
 * @param {ElAttrValue} value
 * @returns {void}
 */
function setGuardedAttribute(node, name, value) {
  if (EVENT_HANDLER_NAME.test(name)) {
    throw new Error(`el(): refusing event-handler attribute "${name}" — behaviour is wired by enhance(), never by a markup attribute`);
  }
  if (!ATTRIBUTE_NAME_ALLOWLIST.has(name) && !ATTRIBUTE_NAME_PATTERN.test(name)) {
    throw new Error(`el(): attribute name "${name}" is not on the allowlist (site/v1/el.js) — attribute names are never data-derived; add a genuinely needed name there deliberately`);
  }
  if (value === null || value === undefined || value === false) return; // omit
  const str = value === true ? '' : String(value);
  node.setAttribute(name, URL_VALUED_ATTRIBUTES.has(name) ? safeHref(str) : str);
}

/**
 * Build a real DOM element. Children are TEXT unless they are DOM nodes;
 * null/undefined children and false/null/undefined attribute values are
 * omitted (the suppress command of ADR 0022's return protocol, applied to
 * arguments). All the residual guards documented at the top of this file run
 * here, fail-loud.
 * @param {string} tag
 * @param {Record<string, ElAttrValue> | null} [attrs]
 * @param {...ElChild} children
 * @returns {HTMLElement}
 */
export function el(tag, attrs = null, ...children) {
  if (typeof tag !== 'string' || !TAG_NAME_PATTERN.test(tag)) {
    throw new Error(`el(): invalid tag name ${JSON.stringify(tag)} — lowercase HTML element names only`);
  }
  if (RAWTEXT_ELEMENTS.has(tag)) {
    throw new Error(`el(): refusing rawtext element <${tag}> — its children serialise unescaped, so hostile text would become live markup`);
  }
  if (FOREIGN_CONTENT_ROOTS.has(tag)) {
    throw new Error(`el(): <${tag}> is foreign content and needs its own namespace context (createElementNS); not supported by the HTML path`);
  }
  if (CONTEXT_HAZARD_ELEMENTS.has(tag)) {
    throw new Error(`el(): refusing <${tag}> — it redefines the page's URL or active-content context and has no v1 use`);
  }
  if (STRUCTURAL_HAZARD_ELEMENTS.has(tag)) {
    throw new Error(`el(): refusing <${tag}> — its children live in a separate content fragment that serialises apart from the child-node list, so appended children would be silently dropped`);
  }
  if (attrs !== null && (typeof attrs !== 'object' || Array.isArray(attrs) || isDomNode(attrs))) {
    throw new Error(`el(): <${tag}> attrs must be a plain object or null — got ${typeof attrs}; pass null when the element has attributes to skip`);
  }
  const node = resolveDocument().createElement(tag);
  if (attrs !== null) {
    for (const [name, value] of Object.entries(attrs)) setGuardedAttribute(node, name, value);
  }
  const flat = flattenChildren(tag, children, []);
  if (VOID_ELEMENTS.has(tag) && flat.length > 0) {
    throw new Error(`el(): void element <${tag}> cannot take children`);
  }
  for (const child of flat) node.append(child);
  return node;
}

/**
 * Serialise an el()-built element to static HTML for build-time emission,
 * using the platform's HTML fragment serialisation (the outerHTML getter —
 * jsdom's serialiser at build time, the browser's in a page). Never a
 * hand-rolled escaper (ADR 0022 rejected that as the highest-risk code to get
 * subtly wrong).
 *
 * Defence in depth for a tree NOT built purely by el() (a hand-created node
 * appended via appendChild, ordinary future childNodes work): the whole tree is
 * walked and asserted to contain ONLY elements and text nodes, and no element
 * from any construction-refused category. Two hazards this closes that a live
 * el() tree never carries:
 *   - a comment / processing-instruction / CDATA node, whose data the serialiser
 *     emits between its delimiters with NO markup escaping — a comment crafted to
 *     close early would re-introduce a live element (and an event handler) on
 *     browser reparse; refused because only elements and text are permitted;
 *   - a construction-refused element (rawtext, foreign-content, context-hazard
 *     such as <base>, structural-hazard such as <template>) — refused from the
 *     SAME REFUSED_ELEMENTS the construction guards derive from, so serialise can
 *     never fall behind what construction rejects.
 * @param {Element} node
 * @returns {string}
 */
export function serialise(node) {
  if (!isDomNode(node) || node.nodeType !== 1) {
    throw new Error('serialise(): expected an el()-built element');
  }
  const element = /** @type {Element} */ (node);
  assertSerialisableTree(element);
  return element.outerHTML;
}

// Node-type constants (the DOM's own numbering), named so the whole-tree check
// reads as intent rather than magic numbers.
const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

/**
 * Walk the whole tree and refuse anything the platform serialiser would emit
 * unsafely: any node that is not an element or a text node (comment / PI /
 * CDATA), and any element from a construction-refused category. The two checks
 * together mean the serialised output can only contain el()-shaped, escaped
 * content — the property the whole foundation rests on.
 * @param {Element} root
 * @returns {void}
 */
function assertSerialisableTree(root) {
  /** @type {Element[]} */
  const stack = [root];
  while (stack.length > 0) {
    const current = /** @type {Element} */ (stack.pop());
    if (REFUSED_ELEMENTS.has(current.nodeName.toLowerCase())) {
      throw new Error(`serialise(): refusing a tree containing <${current.nodeName.toLowerCase()}> — ${refusalReason(current.nodeName.toLowerCase())}`);
    }
    for (const child of current.childNodes) {
      if (child.nodeType === TEXT_NODE) continue; // text is entity-escaped by the serialiser
      if (child.nodeType !== ELEMENT_NODE) {
        throw new Error('serialise(): refusing a tree containing a non-element, non-text node (comment/processing-instruction/CDATA) — its data would serialise with no markup escaping, so a smuggled comment could re-introduce live markup on reparse');
      }
      stack.push(/** @type {Element} */ (child));
    }
  }
}
