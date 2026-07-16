/**
 * The callsign-anatomy figure (issue #468): an accessible, self-contained
 * inline SVG that lays a representative UK amateur callsign out with artificial
 * spacing and colour-groups each component - prefix, Regional Secondary
 * Locator, digit, suffix and operating suffix - beside an always-visible key
 * table that names every part in words.
 *
 * The geometry/markup core is the SHARED, segments-driven renderer in
 * site/callsign-pill.js (issue #595): one implementation serves both this
 * build-time example figure and the live per-callsign figure the browser
 * renders on site/callsign.html. This module contributes only the fixed
 * example's part list and page-specific wording/links.
 *
 * Colour is only ever a SECONDARY cue: each group is labelled in text on the
 * diagram AND named (with its colour spelled out) in the table, so the figure
 * meets WCAG 1.4.1 (colour is not the sole means of conveying information) and
 * reads completely with no colour, no SVG and no JavaScript. The SVG carries
 * role="img" with a <title>/<desc> spoken summary; the <table> beneath is the
 * crawlable, screen-reader-native fallback (the same progressive-enhancement
 * shape the statistics charts use).
 *
 * The markup is embedded verbatim in site/callsign-structure.html; a drift
 * guard (anatomy.test.ts) asserts the committed page still contains this
 * generator's exact output, so the diagram and its prose home cannot silently
 * diverge.
 */

import { anatomyFigureHtml } from '../../../site/callsign-pill.js';
import { glossaryHref, type GlossaryAnchor } from './glossary.ts';

export interface AnatomyPart {
  /** The `--anat-<token>` colour custom property this part is grouped under. */
  readonly token: string;
  /** The colour spelled out in words, so colour is never the only cue. */
  readonly colourName: string;
  /** The characters this part contributes, in reading order. */
  readonly chars: string;
  /** The compact label shown under the group on the diagram. */
  readonly shortLabel: string;
  /** The full part name used in the table and the accessible description. */
  readonly name: string;
  /** One-line, plain-English account of the part's role. */
  readonly meaning: string;
  /** Link to the fuller explanation elsewhere on this page. */
  readonly href: string;
  /** Optional glossary deep-link anchor for the term. */
  readonly glossary?: GlossaryAnchor;
}

// MW0ABC/P covers every core part in one clean call; the surrounding prose
// describes the simpler M7TEE alongside it. Each part's `chars` are split into
// individual glyph tiles, so `/P` becomes a slash tile and a P tile.
export const ANATOMY_EXAMPLE = 'MW0ABC/P';

export const ANATOMY_PARTS: readonly AnatomyPart[] = [
  { token: 'prefix', colourName: 'blue', chars: 'M', shortLabel: 'Prefix', name: 'Prefix',
    meaning: 'The UK country block — G, M or 2, allocated by the ITU.', href: '#parts' },
  { token: 'rsl', colourName: 'green', chars: 'W', shortLabel: 'RSL', name: 'Regional Secondary Locator',
    meaning: 'A nation letter after the first character; here W is Wales.', href: '#rsl', glossary: 'rsl' },
  { token: 'digit', colourName: 'amber', chars: '0', shortLabel: 'Digit', name: 'Digit',
    meaning: 'A single number.', href: '#parts' },
  { token: 'suffix', colourName: 'red', chars: 'ABC', shortLabel: 'Suffix', name: 'Suffix',
    meaning: 'The ending letters — the sense of “suffix” this site always means.', href: '#parts', glossary: 'suffix' },
  { token: 'op', colourName: 'violet', chars: '/P', shortLabel: 'Op. suffix', name: 'Operating suffix',
    meaning: 'An optional addition after a slash; /P means portable.', href: '#characters' },
];

/**
 * The complete anatomy <figure> as a single-line HTML string: the accessible
 * SVG diagram plus the always-visible key table. `depthToRoot` positions the
 * glossary deep-links relative to the site root (0 on the hand-authored
 * callsign-structure page).
 */
export function callsignAnatomyFigure(depthToRoot: number): string {
  return anatomyFigureHtml({
    parts: ANATOMY_PARTS.map(p => ({
      token: p.token,
      colourName: p.colourName,
      chars: p.chars,
      shortLabel: p.shortLabel,
      name: p.name,
      meaning: p.meaning,
      nameHref: p.href,
      ...(p.glossary === undefined ? {} : { glossaryHref: glossaryHref(p.glossary, depthToRoot) }),
    })),
    idPrefix: 'anat',
    titleText: `Anatomy of the example UK amateur callsign ${ANATOMY_EXAMPLE}`,
    descLead: `The example callsign ${ANATOMY_EXAMPLE}`,
    figcaptionLead: `The parts of a UK amateur callsign, shown on the example ${ANATOMY_EXAMPLE}`,
    display: ANATOMY_EXAMPLE,
  });
}
