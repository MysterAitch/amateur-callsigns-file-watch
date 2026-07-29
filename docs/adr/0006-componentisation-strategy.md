# ADR 0006 — Reusable UI modules via native Web Components, not a framework

- Status: proposed
- Date: 2026-07-09

## Context

The site renders UI in three tiers with no shared component layer, so the same
patterns are re-implemented in each: the hand-authored static pages
(`site/*.html` + `site/app.js`, `explore.js`), the server-generated pages
(template strings in `src/ci/build-dataset-pages.ts`), and the dynamic
in-browser lookup (vanilla DOM via the `el()` helper). A callsign-result card, a
data table with overflow/scope behaviour, a status badge, a coverage/provenance
notice — each is written more than once, and consistency has to be enforced by
hand (see the styling-unification work, and the recurring accessibility fixes
that had to be applied per surface). Issue #266 asked what it would take to build
"modules of functionality", with Vue custom components in mind.

The binding constraint is ADR 0002: no runtime framework, no build step, no CDN,
vendored-and-audited dependencies only. Node type-stripping runs the TypeScript
without a bundler; the site ships hand-rolled HTML/CSS/JS.

## Decision

**Adopt native Web Components (Custom Elements) as the mechanism for reusable UI
modules. Do not adopt Vue (or any runtime framework) unless a future need for
its reactivity/DX is strong enough to justify reversing ADR 0002, which would
require its own ADR.**

Components are defined as classes extending `HTMLElement` (e.g.
`<callsign-result>`, `<data-table>`, `<status-badge>`, `<provenance-notice>`),
progressively enhancing server-rendered light-DOM content where possible. They
work identically in the static pages and the dynamic lookup, add no dependency,
no build step and no CDN, and so keep the ADR 0002 posture intact.

Sequencing: first factor the repeated HTML generation into shared,
component-shaped functions (this also delivers the styling-consistency goal and
identifies the real component boundaries); then promote the interactive/reusable
pieces to Custom Elements. This pairs naturally with the offline-first PWA
direction (ADR 0008): a component model plus a service worker is a coherent
"app" architecture without a framework.

## Consequences

- **For:** zero new dependency; one definition per component reused across all
  three tiers; encapsulation without Shadow DOM if global CSS is preferred; SSR
  content can hydrate; fully aligned with ADR 0002.
- **Against / costs:** Web Components' ergonomics are lower than Vue's (no
  template compiler, manual reactivity); Shadow DOM style isolation, if used,
  interacts with the shared design tokens; older-browser support for Custom
  Elements is a non-issue for the target audience but should be stated.
- **Reversibility:** starting with shared functions + Custom Elements does not
  foreclose Vue later; it does the opposite — it names the component boundaries a
  framework would also need. Choosing Vue now would foreclose the no-build
  posture.
- **Open:** whether to use Shadow DOM or light DOM (leaning light DOM, to keep
  the shared stylesheet authoritative); which components to build first
  (candidates: data-table, status-badge, provenance-notice, callsign-result).

Relates to #266, the styling-unification pass (#257), and ADR 0008 (PWA).
