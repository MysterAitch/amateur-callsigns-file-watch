/**
 * The v1 callsign-anatomy figure (issue #931): the SAME segments-driven,
 * accessible SVG-plus-key-table the v0 structure page draws
 * (src/ci/render/anatomy.ts), re-hosted on the v1 structure-reference page in
 * the B-light shell. It reuses the ONE shared renderer in site/callsign-pill.js
 * and the ONE canonical part list (ANATOMY_PARTS) rather than forking either, so
 * the v1 diagram cannot drift from the v0 diagram or from the vocabulary the v1
 * callsign page's anatomy section derives from the same parsed parts.
 *
 * The ONLY v1-specific contribution here is the glossary anchor scheme: the v1
 * glossary uses stable `def-<kebab-key>` anchors (site/v1/glossary.js's
 * glossaryAnchorId), so a part's glossary deep-link resolves to the term on the
 * v1 glossary page rather than the v0 anchor. The part names, meanings, colours
 * and citations are carried verbatim from the shared source.
 *
 * This is a BUILD-side module (never shipped to the v1 root): it generates the
 * figure string that is embedded, once, into site/v1/anatomy.html, and a drift
 * guard (v1-anatomy.test.ts) asserts the committed page still contains this
 * generator's exact output — so the page and the canonical renderer cannot
 * silently diverge.
 */

import { anatomyFigureHtml } from '../../../site/callsign-pill.js';
import { ANATOMY_EXAMPLE, ANATOMY_PARTS } from './anatomy.ts';

// The v1 glossary anchor for each structural term a part deep-links to. The v1
// glossary keys these terms under prefix/rsl/suffix/operatingSuffix, and its
// page anchors are def-<kebab-key> (glossaryAnchorId). Only the terms an anatomy
// part actually links to are mapped; a part with no glossary term (digit) links
// nowhere, exactly as on the v0 figure.
const V1_GLOSSARY_ANCHOR: Record<string, string> = {
  rsl: 'glossary.html#def-rsl',
  suffix: 'glossary.html#def-suffix',
};

/**
 * The complete v1 anatomy <figure> as a single-line HTML string: the accessible
 * SVG diagram plus the always-visible key table, with glossary deep-links
 * resolved to the v1 glossary's stable anchors. Deterministic and pure — two
 * calls are byte-identical — so the drift guard can pin the committed page to it.
 */
export function v1CallsignAnatomyFigure(): string {
  return anatomyFigureHtml({
    parts: ANATOMY_PARTS.map((p) => ({
      token: p.token,
      colourName: p.colourName,
      chars: p.chars,
      shortLabel: p.shortLabel,
      name: p.name,
      meaning: p.meaning,
      nameHref: p.href,
      ...(p.glossary === undefined ? {} : { glossaryHref: V1_GLOSSARY_ANCHOR[p.glossary] }),
      ...(p.citation === undefined ? {} : { citationHref: p.citation.href, citationLabel: p.citation.label }),
    })),
    idPrefix: 'anat',
    titleText: `Anatomy of the example UK amateur callsign ${ANATOMY_EXAMPLE}`,
    descLead: `The example callsign ${ANATOMY_EXAMPLE}`,
    figcaptionLead: `The parts of a UK amateur callsign, shown on the example ${ANATOMY_EXAMPLE}`,
    display: ANATOMY_EXAMPLE,
  });
}
