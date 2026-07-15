/**
 * The glossary-term affordance (issue #329): the single registry of glossary
 * anchors and the helpers that render a jargon term (or a standalone cue) as a
 * link to its definition in site/glossary.html. Reused across every generated
 * section so a definition is one click away wherever a term appears.
 *
 * No behaviour of its own - these are the same helpers the site build has
 * always emitted, so the generated HTML is byte-for-byte unchanged.
 */

import { escapeHtml } from './html.ts';

// ---- Glossary-term affordance (issue #329) ----
// The site is dense with domain jargon; a reader needs a definition at the
// point of confusion. These helpers render the ONE standardised affordance —
// a jargon term linked to its definition in site/glossary.html, marked
// site-wide by a small trailing "(?)" cue — so a definition is one click (or
// one Tab-and-Enter) away wherever a term appears.
//
// The registry below is the single source of truth pairing each glossary
// deep-link anchor with a plain-language name. The name is used for the
// affordance's accessible text (never a bare "?": a screen-reader hears
// "…definition of the source-authority axis in the glossary"). A durable test
// (site/glossary-links.test.ts) asserts every anchor here — and every
// glossary deep-link emitted across the generated and hand-authored pages —
// resolves to a real id in glossary.html, so a renamed anchor fails CI rather
// than shipping a dangling link.
export const GLOSSARY_ANCHORS = {
  'prefix-series': 'prefix series',
  'rsl': 'the RSL (Regional Secondary Locator)',
  'suffix': 'a callsign suffix',
  'forbidden-suffix': 'a forbidden suffix',
  'placeholder-form': 'the placeholder (#) form',
  'cleaned': 'the cleaned join key',
  'ignored-line': 'an ignored (set-aside) line',
  'normalised': 'the normalised view',
  'canonical-form': 'the canonical form',
  'register-snapshot': 'a register snapshot',
  'dataset-class': 'a dataset class',
  'licence-class': 'the licence class',
  'observation': 'an observation',
  'vintage': 'vintage',
  'declared-complete': 'declared complete / partial',
  'allocated': 'the Allocated status',
  'reserved': 'the Reserved status',
  'available': 'the Available status (and the availability trap)',
  'status-values': 'the register status values',
  'axis-processing': 'the processing-progress axis',
  'axis-authority': 'the source-authority axis',
  'axis-confidence': 'the claim-confidence axis',
} as const satisfies Record<string, string>;

export type GlossaryAnchor = keyof typeof GLOSSARY_ANCHORS;

// The glossary deep-link for a term at the given depth below the site root.
export function glossaryHref(anchor: GlossaryAnchor, depthToRoot: number): string {
  return `${'../'.repeat(depthToRoot)}glossary.html#${anchor}`;
}

// A jargon term rendered as a glossary link with the shared "(?)" cue. The
// accessible name is "<label> (definition of <term> in the glossary)"; the cue
// glyph itself is decorative (aria-hidden). The affordance never relies on
// colour alone — the term also carries a dotted underline and the "(?)" glyph
// — and is keyboard-reachable as an ordinary link (styling in site/ledger.css,
// scoped under `.ledger`, which every page's content adopts). Pass `label` to
// tag a specific occurrence (e.g. "Foundation" pointing at #licence-class);
// `escapeLabel: false` keeps caller-supplied markup (e.g. a <code> chip).
export function glossaryTerm(anchor: GlossaryAnchor, depthToRoot: number, options: { label?: string; escapeLabel?: boolean } = {}): string {
  const text = options.label ?? GLOSSARY_ANCHORS[anchor];
  const shown = options.escapeLabel === false ? text : escapeHtml(text);
  const accessible = escapeHtml(`(definition of ${GLOSSARY_ANCHORS[anchor]} in the glossary)`);
  return `<a class="gloss-term" href="${glossaryHref(anchor, depthToRoot)}">${shown}<span class="gloss-cue" aria-hidden="true">?</span><span class="visually-hidden"> ${accessible}</span></a>`;
}

// The same affordance as a STANDALONE cue, for where inlining the whole term
// as a link would read awkwardly (e.g. beside a term already shown as a bold
// heading or a <code> chip). Renders just the "(?)" cue; its accessible name
// is the full "Definition of <term> in the glossary" (never a bare "?").
export function glossaryCue(anchor: GlossaryAnchor, depthToRoot: number): string {
  const accessible = escapeHtml(`Definition of ${GLOSSARY_ANCHORS[anchor]} in the glossary`);
  return `<a class="gloss-cue-link" href="${glossaryHref(anchor, depthToRoot)}" aria-label="${accessible}"><span class="gloss-cue" aria-hidden="true">?</span></a>`;
}
