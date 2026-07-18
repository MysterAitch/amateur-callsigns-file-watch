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
  'forbidden-suffix-rationale': 'the forbidden-suffix rationale',
  'placeholder-form': 'the placeholder (#) form',
  'cleaned': 'the cleaned join key',
  'unkeyable-row': 'an unkeyable row',
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
  // Observed register-status values the glossary is explicit have NO
  // canonical meaning established (site/glossary.html#status) - registered
  // here (issue #553) so the shared status field wrapper (./status.ts) can
  // crosslink a RENDERED "Live"/"Forbidden"/"Quarantine" value to that honest
  // explanation, not just leave the reader to guess.
  'status-live': 'the Live status (no canonical meaning established)',
  'status-forbidden': 'the Forbidden status (no canonical meaning established)',
  'status-quarantine': 'the Quarantine status (no canonical meaning established)',
  'axis-processing': 'the processing-progress axis',
  'axis-authority': 'the source-authority axis',
  'axis-confidence': 'the claim-confidence axis',
  // The narrative epistemics tags (issue #755): each data narrative marks a
  // claim `[observed]`/`[derived]`/`[hypothesis]`/`[confirmed]`, rendered as a
  // pill linking here (see epistemicsPill below). Namespaced `tag-*` rather
  // than reusing the existing `observation` anchor above, which defines a
  // different, narrower sense of the word (a single value witnessed in an
  // FOI-disclosed dataset) - the two must not collide.
  'tag-observed': 'the "observed" claim tag',
  'tag-derived': 'the "derived" claim tag',
  'tag-hypothesis': 'the "hypothesis" claim tag',
  'tag-confirmed': 'the "confirmed" claim tag',
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

// ---- Narrative epistemics-tag pills (issue #755) ----
// Every data narrative tags a claim `[observed]`, `[derived]`, `[hypothesis]`
// or `[confirmed]` so a reader can tell what kind of statement follows. The
// interim shape (#754/#758) rendered the tag as plain bold text, with each
// narrative repeating its own full legend explaining the four words. This
// replaces both with a single small styled pill per tag, a real link to its
// ONE shared definition here in the glossary - so the meaning lives in one
// place, not four repeated copies of it.
export const EPISTEMICS_TAGS = ['observed', 'derived', 'hypothesis', 'confirmed'] as const;
export type EpistemicsTag = typeof EPISTEMICS_TAGS[number];

const EPISTEMICS_ANCHOR: Record<EpistemicsTag, GlossaryAnchor> = {
  observed: 'tag-observed',
  derived: 'tag-derived',
  hypothesis: 'tag-hypothesis',
  confirmed: 'tag-confirmed',
};

// A single tag rendered as a pill: a real `<a>` (works with no script, as
// every other glossary link on the site does), keyboard-focusable, with an
// accessible name that states what it is rather than leaving a screen reader
// to announce the bare word - "observed - claim type, see glossary
// definition" - built from the VISIBLE word plus a visually-hidden suffix
// (the same accessible-name pattern glossaryTerm above uses), never colour
// alone: the pill also carries a distinct border/background per tag and its
// own visible word.
export function epistemicsPill(tag: EpistemicsTag, depthToRoot: number): string {
  const href = glossaryHref(EPISTEMICS_ANCHOR[tag], depthToRoot);
  return `<a class="epistemic-tag tag-${tag}" href="${href}">${tag}<span class="visually-hidden"> — claim type, see glossary definition</span></a>`;
}

// The narrative render path's ONE call site (src/ci/build-dataset-pages.ts):
// replaces the exact rendered shape every narrative's tagging convention
// produces - `**[observed]**` in the authored markdown becomes
// `<strong>[observed]</strong>` once render-markdown.ts's bold pass runs -
// with the pill above. Deliberately narrow on two axes at once: the token
// set is the closed, case-sensitive list of four words (not an open bracket
// pattern), AND the shape matched is the bold-wrapped one the tagging
// convention actually uses - so an incidental, unbolded mention of one of
// these words in square brackets elsewhere in a narrative's prose (a
// meta-reference describing the convention itself, say) is left as plain
// text rather than mangled into a pill it was never meant to be.
const TAGGED_CLAIM_RE = new RegExp(`<strong>\\[(${EPISTEMICS_TAGS.join('|')})\\]</strong>`, 'g');

export function applyEpistemicsPills(html: string, depthToRoot: number): string {
  return html.replace(TAGGED_CLAIM_RE, (_whole: string, tag: string) => epistemicsPill(tag as EpistemicsTag, depthToRoot));
}
