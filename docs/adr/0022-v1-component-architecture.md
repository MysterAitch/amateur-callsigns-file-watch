# ADR 0022 — The v1 UI component architecture: frameworkless JSDoc-typed modules, DOM-construction rendering, one implementation across build and browser

- Status: accepted
- Date: 2026-07-24
- Related: ADR 0003 (in-repo presentation / frameworkless, no client build step — the constraint this works within), ADR 0006 (reusable UI modules via native Web Components, *proposed* — this ADR settles its open questions and revises its default mechanism), ADR 0008 (offline-first PWA — the "app without a framework" direction this continues), ADR 0012 (supply-chain posture — the dependency policy amended alongside this decision to sanction the build backend below), ADR 0020 (sharded static-JSON serving — the async, query-driven single-callsign body is the client-render exemplar); issue #966 (the full deliberation record this consolidates)

## Context

The `site/v1` surfaces render UI three ways — build-time static HTML stamped in
CI, server-shaped section registries, and dynamic in-browser rendering — with no
single shared component layer. The same card, chip, table and reference are
written more than once, and consistency has been enforced by hand and policed by
parity tests: a hand-authored static baseline pinned against a separate JS
renderer by "StaticBaseline" tests, and a `copy.js` / `v1-copy.ts` twin kept
alive only by a byte-identical parity gate. That is the **duplicate-plus-guard**
anti-pattern — two implementations of one fact, guaranteed to drift, policed
rather than designed out. The redesign's governing aim is to author each fact,
unit and render **once** and make the two-context problem (build vs browser)
disappear rather than guarding it.

Two properties of this project shape every choice. First, **longevity**: the
record is a decades-long archival surface, and a framework pins it to a churning
runtime and toolchain, whereas static HTML plus vanilla progressive-enhancement
scripts run indefinitely and web archives capture them cleanly. Second, the
**supply-chain posture** (ADR 0012): `ignore-scripts`, precompile-and-ship, a
minimal audited dependency surface, and no client-side npm supply chain on the
published site (ADR 0003). The interactivity actually required is modest —
popovers, a year scrubber, legend filtering, in-place count updates — islands of
enhancement over authoritative static HTML, not a reactive single-page
application.

The existing `site/v1` idiom already fits: plain JavaScript modules, JSDoc-typed
and type-checked by `tsc --checkJs`, imported as native ES modules by the
browser, rendering through a small `el()` DOM-construction helper
(`createElement` / `textContent`). The question this ADR settles is how to make
that idiom a disciplined component model that serves both the build and the
browser from one implementation, without reaching for a framework and without
hand-rolling a security-critical HTML serialiser.

## Decision

**Adopt a frameworkless component model of authoritative static HTML plus
islands of one-shot progressive enhancement, authored as JSDoc-typed JavaScript
ES modules — one module per component — rendered by DOM construction, with one
render codebase that runs at build time under jsdom and in the browser against
the native DOM.**

### Language and packaging

- **JSDoc-typed JS ES modules, one per component.** No `.ts` component sources,
  no emit step and no bundler for the UI: the file in the repository is the file
  that runs, in **both** the Node build and the browser. `tsc --checkJs` keeps
  full type-checking; the heavy typed data models stay upstream in `src/`
  (build-only) and are consumed through `@typedef import()`, so the component
  type surface is thin. This continues the existing `site/v1` idiom — a
  continuation, not a new adoption — and keeps "repo JS *is* runtime JS", which
  serves both archival transparency and the least-bad/most-reversible test:
  there is no build output to rot and no migration to undo, and moving to
  TypeScript-with-emit later stays cheap if JSDoc ever chafes.
- **Namespacing is the module, not globals.** A component is referenced as
  `import * as chip from './chip.js'`; runtime dispatch goes through a registry
  keyed by `data-component` (below), never a loose imported `enhance`.

### The component contract (a menu — each component implements only the slots it needs)

- **`renderStatic(data) → content`** — build-time, authoritative, synchronous
  and pure. It is the single source of the component's **content**: the static,
  crawler-visible, no-JS-complete output. Every `renderStatic` must produce a
  *meaningful* no-JS form (a summary or table where a richer form needs script),
  never an empty shell.
- **`enhance(el)`** — progressively upgrades the *existing* static DOM in place
  (popover, sort, filter, control-swap). Additive, never a re-render from
  scratch, and it reads the data **embedded** in the static HTML
  (`data-*` attributes / inline JSON islands) rather than re-fetching — so an
  enhanced view can never show different numbers from the static one. Every
  component **always** exports `enhance`, a written no-op `export function
  enhance(){}` where it has no behaviour, so the load-time walk calls it
  uniformly with no presence-check and "no enhancement" reads as an intentional
  statement rather than an ambiguous absence.
- **`refresh(el, data)`** — optional; present only where a value is genuinely
  dynamic (per-query fill, interaction-driven counts, opt-in stale-cache
  freshen). It is invoked **contextually** by a controller holding references
  only to the refreshable components it drives, so its absence never creates a
  presence-check — it stays the genuine optional menu item. The rule is *always
  export the slots a uniform sweep calls*: `renderStatic` and `enhance` are hit
  by uniform sweeps and are therefore always present; a refresh sweep is
  **signal-scoped** (it iterates only the set that registered to react to a
  signal, every member of which genuinely refreshes), so no universal no-op
  `refresh` boilerplate is warranted. The sweep decides, not the slot.

### The content-vs-command return protocol

Data and control travel on separate channels. A render or refresh returns:

- **a string or element** (even an "empty-looking" one such as `"none"` or
  `"0"`) = **content** → "render this";
- **`null`** = **command** → "not applicable; suppress it". At **runtime** this
  means a **reversible hide** (`display:none` / the `hidden` attribute), *not*
  DOM removal: the element, its listeners and its sub-state are preserved so the
  next refresh simply un-hides it — no churn, no re-insertion problem — and it
  is correctly hidden from assistive technology. At **build** time `null` means
  "not emitted" (absent from the static HTML, nothing to hide). Toggle-able
  components are therefore rendered-then-hidden — always present in the DOM — so
  a dispatcher only ever hides, shows or updates existing elements, never
  inserts from nothing (a filtered table renders every row and hides the
  filtered ones).
- **`undefined` / no return** (refresh only) = "leave exactly as-is".

The discipline is that the empty string is **never** overloaded as a command:
`""` is content ("show nothing visible"), `null` is the command ("be absent").
DOM removal, `visibility:hidden` (reserve space, avoid reflow) and animation are
**explicit opt-ins**, never the silent meaning of `null`. The protocol is
JSDoc-typed (`@returns {string | null}`) and tested at all three outcomes; the
vocabulary is **suppress / hide (reversible)**, not "remove".

### Async

`renderStatic` stays synchronous and pure, so build-time generation is
deterministic. Where data is unknown at build — the query-driven callsign body
(ADR 0020) — the **mount / loader** returns a `Promise` of the rendered result
(a rejection *is* the error state); there is no separate "async component kind",
just one return shape whose promise lives in the loader, not in `renderStatic`.
The **controller** owns the states around it: *pending* (a skeleton while in
flight), *error* (a rejection surfaces honest error UI, never a blank), and
*race* (`AbortController` plus ignore-stale-result, since promises do not
self-cancel). Floating promises are closed off by `typescript-eslint`'s
`no-floating-promises` and explicit `Promise<…>` return types.

### The registry and the enhance walk

- **A `data-component` registry.** Each component root is marked
  `data-component="chip"`; a single load-time pass queries `[data-component]`
  and runs each element's registered enhancer on its own subtree. The registry
  is a `Map` (or null-prototype object) looked up with `Object.hasOwn`, so an
  unknown `data-component` is a safe no-op and never reaches `Object.prototype`.
  Registration optionally verifies each component exposes `renderStatic` and
  `enhance`, and a build-time assertion checks that every emitted
  `data-component` has a registered enhancer — a forgotten slot is a loud error,
  not a silent gap.
- **`enhance` is scoped to its root** — never `document`-wide selectors (they
  would grab sibling instances) — **idempotent** (enhanced nodes are marked) and
  **re-runnable** on newly-inserted subtrees via a single `enhanceWithin(root)`
  any mutator calls, so dynamically-added rows get enhanced; prefer event
  delegation on containers over per-cell listeners.
- **Nesting is function composition plus the walk.** Static nesting: a
  component's `renderStatic` calls its children's `renderStatic` (table → cell →
  callsign-reference), needing no machinery and no knowledge of a child's
  internals. Enhancement nests through the registry, not a parent↔child
  protocol: a callsign reference inside a table cell self-enhances its popover
  without the table knowing it exists. A new component is a registered enhancer;
  there is no lifecycle and no coordination.

### Identity and multiplicity

Static HTML is **id-free** for anything that can appear more than once on a page;
internal wiring uses `querySelector` scoped within the component root. Where an
id is unavoidable (`aria-controls`, the popover API's `popovertarget`), it is
**minted uniquely per instance at enhance time** — opaque, never data-derived,
never interpolated into a selector — and no-JS baselines use id-free constructs
(`<details>`) rather than `popovertarget`+id. Per-instance state lives on the
instance (DOM or closure), never at module level. An id-uniqueness test renders N
instances and asserts no duplicate ids.

### Reference components

A reference (source/publisher, event type, publication/dataset type, glossary
term, date) takes its identity from a **single** existing source
(`reference-data/publishers.json`, the event-kind vocabulary / `KIND_LABELS`,
the dataset-class vocabulary, the glossary registry) plus an optional injected
**context value** that always carries its own meaning — never a bare, ambiguous
number. A context-dependent count *must* carry its meaning in a label, tooltip
or `aria` text, because the same glyph means different things on different pages.
A reference is rendered identically everywhere (the interaction-grammar
consistency of #921); a filter's `(N)` is the *same* refreshable
reference-with-count as a timeline legend key's `(N)` — one component, one flow,
only the source of the number differs (a live filtered total via `refresh` vs a
build-time static count).

### Residual security guards

DOM construction is safe-by-construction for text and attribute *values*
(`textContent` / `setAttribute` encode automatically), which is the point of
using it. The guards the DOM APIs do **not** provide are mandatory and are the
actual security work — small and OWASP-codified:

- **URL scheme allowlist** parsed with the WHATWG URL parser, not naive
  string-matching: allow relative and `https:`, reject `javascript:` / `data:` /
  protocol-relative. (`setAttribute` does not reject a `javascript:` href — at
  the time of decision the `link()` helper in `callsign-sections.js` set href
  with no scheme guard, the concrete gap that motivated this item. Since built:
  the allowlist lives in `site/v1/safe-url.js`, is routed through both
  construction and serialisation by `el()`, and is exercised against the
  hostile-string corpus — verified 2026-07-29.)
- **Rawtext / `<script>` / inline-JSON-island encoding**: inside a `<script>`
  island a `</script>` in an FOI title breaks out, so JSON islands escape `<` to
  `<` rather than entity-escaping.
- **No `innerHTML` / `insertAdjacentHTML` / `outerHTML` / `document.write` /
  `new Function`**, and no template-literal HTML outside the render primitive —
  lint-guarded.
- **Attribute names are never data-derived** (allowlist; reject `on*`).
- **SVG / foreign content** handled in its own context.

Register data is effectively **untrusted external input** (a value may contain
markup); the encoding is verified against a checked-in **hostile-string corpus**
with **parsed-DOM** assertions (see CONTRIBUTING and the ADR 0012 amendment).

### Light DOM, not shadow DOM

Components render into the **light DOM**. Declarative-shadow-DOM SSR fights
crawler visibility, the no-JS baseline, the shared authoritative stylesheet and
a11y; its only real benefit here — id-collision isolation — is already solved by
the no-static-ids / mint-at-enhance rule.

### The framework tripwire

Staying frameworkless is a standing decision with a written tripwire, so it is
not re-litigated each time. What we build is a *sliver* — server-render,
composition, hydration — deliberately **not** the expensive core (reactivity,
virtual DOM, diffing, a component runtime, lifecycle): "authoritative static HTML
plus islands of progressive enhancement", not a reactive SPA. **The tripwire is
reactive client-side state driving synchronised re-renders across components.**
The **canary** already on the board is the timeline legend-filter (legend →
bars → key counts is cross-component state); it is still hand-rollable as a small
shared filter-controller (a state object plus `refresh` calls), so it is the
test. If that wiring becomes painful, or several such surfaces accrue, reconsider
— and the fallback is a **minimal SSR-plus-islands library** (lit-html /
petite-vue / Alpine), never a full SPA framework.

## Consequences

- **Duplication is designed out, not policed.** A dual-context render — a
  reference rendered both in a build-stamped table and in the client-rendered
  callsign body — has exactly **one** implementation, so the StaticBaseline
  parity tests and the `copy.js` / `v1-copy.ts` twin retire: the static HTML is
  *generated by* `renderStatic`, so there is no second copy to keep in sync.
  The retirement is per-surface, not immediate — each parity guard stands until
  its surface migrates onto the component model, and as of 2026-07-29 the
  `copy.js` / `src/ci/render/v1-copy.ts` twin and the StaticBaseline tests are
  still live. A guard disappearing *before* its surface migrates would be the
  duplicate-plus-guard failure this ADR exists to end, minus the guard.
- **The test surface shifts rather than shrinks.** Retiring the parity tests is
  offset by render-backend fidelity tests (Node-serialised output equals
  browser-rendered-then-serialised output, asserting on the *parsed* DOM tree,
  not string equality), component render-output tests, enhance-behaviour tests
  (jsdom / Playwright), the id-uniqueness test, and the no-JS baseline gate.
- **The security surface is concentrated and covered.** Because encoding lives in
  one render primitive backed by a spec-faithful DOM, getting that one primitive
  right makes the system safe; the residual guards are a small, explicit,
  OWASP-mapped checklist rather than a systemic hand-rolled hazard.
- **Longevity and the supply-chain posture are preserved.** No client-side npm
  supply chain, no build step and no CDN on the published surface (ADR 0003); the
  build render backend is a build-time-only dependency that never ships or is
  archived (ADR 0012 amendment).
- **ADR 0006's open questions are settled.** Light DOM over shadow DOM is
  decided; the reusable-module mechanism is a JSDoc-JS module plus the
  `data-component` registry rather than a custom-element class by default — a
  custom element is reserved for the rare component that genuinely needs
  per-instance lifecycle and state, which is itself the tripwire.
- **Parked, non-blocking items** carried from the deliberation: the
  virtualisation ceiling (render-all-then-hide does not scale to the full
  register; a node-count budget sets pagination/virtualisation before the browse
  surfaces migrate — tracked as #1032) and the Content-Security-Policy mechanics
  on GitHub Pages (no response headers; `<meta http-equiv>` cannot nonce; inline
  styles and the no-JS class-flip script need hashing or refactoring — tracked
  as #1033). Neither blocks the first build steps, but each has a trigger that
  someone must notice: #1032 fires when a browse surface starts migrating,
  #1033 whenever a strict policy is next wanted.

## Alternatives considered and rejected

- **Adopt a framework.** *Astro* fails the supply-chain and longevity tests — a
  large, churning toolchain with install scripts against the `ignore-scripts`
  posture, and a runtime that dates the archive. *lit* SSR is experimental and
  ships a runtime; *Alpine* breaks a strict CSP; *htmx* presupposes a dynamic
  backend the static host does not provide. Each either fails supply-chain /
  longevity / CSP or merely relocates the problem. *Eleventy* is shelved as a
  possible **build-layer** fallback only (it would not ship to the client), not
  adopted now. Frameworkless remains the least-bad and most-reversible choice.
- **A hand-rolled string HTML serialiser** (the earlier `el()`→string framing in
  this issue's first design comments). Rejected: it would make output encoding a
  *systemic* hand-rolled surface — the single highest-risk kind of code to get
  subtly wrong, with XSS as the failure mode. DOM construction backed by a
  spec-faithful DOM dissolves that risk by delegating value-encoding to the
  platform. **This supersedes the string-`el()` framing recorded in the earlier
  #966 comments.**
- **Shadow DOM.** Rejected as above — it fights crawler visibility, the no-JS
  baseline, shared styling and a11y, for a benefit already obtained more cheaply.

This ADR consolidates the full deliberation in **issue #966** (the design thread,
the four adversarial design reviews, and the four-stream architecture
evaluation); that issue remains the living design record.
