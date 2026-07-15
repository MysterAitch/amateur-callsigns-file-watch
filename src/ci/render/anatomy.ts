/**
 * The callsign-anatomy figure (issue #468): an accessible, self-contained
 * inline SVG that lays a representative UK amateur callsign out with artificial
 * spacing and colour-groups each component - prefix, Regional Secondary
 * Locator, digit, suffix and operating suffix - beside an always-visible key
 * table that names every part in words.
 *
 * Colour is only ever a SECONDARY cue: each group is labelled in text on the
 * diagram AND named (with its colour spelled out) in the table, so the figure
 * meets WCAG 1.4.1 (colour is not the sole means of conveying information) and
 * reads completely with no colour, no SVG and no JavaScript. The SVG carries
 * role="img" with a <title>/<desc> spoken summary; the <table> beneath is the
 * crawlable, screen-reader-native fallback (the same progressive-enhancement
 * shape the statistics charts use).
 *
 * The geometry is COMPUTED from the part list below, not hand-authored path
 * data, so the parts and their spacing stay the single source of truth. The
 * markup is embedded verbatim in site/callsign-structure.html; a drift guard
 * (anatomy.test.ts) asserts the committed page still contains this generator's
 * exact output, so the diagram and its prose home cannot silently diverge.
 */

import { escapeHtml } from './html.ts';
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

// Layout constants (SVG user units). The geometry below is derived from these
// and the part list, so re-spacing the diagram is a matter of the numbers here.
const TILE_W = 46;
const TILE_H = 58;
const IN_GROUP_GAP = 6;
const GROUP_GAP = 30;
const PAD_X = 22;
const TOP_Y = 26;

interface GlyphCell {
  readonly ch: string;
  readonly part: number;
  readonly x: number;
}

function glyphCells(): GlyphCell[] {
  const flat: { ch: string; part: number }[] = [];
  ANATOMY_PARTS.forEach((p, pi) => {
    for (const ch of p.chars) flat.push({ ch, part: pi });
  });
  const cells: GlyphCell[] = [];
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

function groupExtent(cells: GlyphCell[], part: number): { left: number; right: number; centre: number } {
  const own = cells.filter(c => c.part === part);
  const left = Math.min(...own.map(c => c.x));
  const right = Math.max(...own.map(c => c.x)) + TILE_W;
  return { left, right, centre: (left + right) / 2 };
}

// A single spoken sentence per part, assembled into the SVG <desc> so a screen
// reader hears the whole breakdown without touching the table.
function spokenDescription(): string {
  const parts = ANATOMY_PARTS
    .map((p, i) => `${i + 1}, ${p.chars} is the ${p.name.toLowerCase()}: ${p.meaning}`)
    .join(' ');
  return `The example callsign ${ANATOMY_EXAMPLE}, spaced out and split into ${ANATOMY_PARTS.length} `
    + `colour-and-label groups. ${parts} Every group is also named in the table beneath the diagram.`;
}

/**
 * The complete anatomy <figure> as a single-line HTML string: the accessible
 * SVG diagram plus the always-visible key table. `depthToRoot` positions the
 * glossary deep-links relative to the site root (0 on the hand-authored
 * callsign-structure page).
 */
export function callsignAnatomyFigure(depthToRoot: number): string {
  const cells = glyphCells();
  const width = (cells[cells.length - 1]?.x ?? PAD_X) + TILE_W + PAD_X;
  const glyphBaseline = TOP_Y + TILE_H / 2 + 10;
  const underlineY = TOP_Y + TILE_H + 10;
  const labelY = underlineY + 24;
  const height = labelY + 12;

  const tiles = cells.map(c => {
    const token = ANATOMY_PARTS[c.part].token;
    const cx = (c.x + TILE_W / 2).toFixed(1);
    return `<rect x="${c.x}" y="${TOP_Y}" width="${TILE_W}" height="${TILE_H}" rx="8"`
      + ` fill="var(--surface-2)" stroke="var(--anat-${token})" stroke-width="2"/>`
      + `<text x="${cx}" y="${glyphBaseline}" text-anchor="middle" font-family="var(--mono)"`
      + ` font-size="30" font-weight="700" fill="var(--ink)">${escapeHtml(c.ch)}</text>`;
  }).join('');

  const groups = ANATOMY_PARTS.map((p, pi) => {
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

  const svg = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="anat-t anat-d"`
    + ` preserveAspectRatio="xMidYMid meet"><title id="anat-t">Anatomy of the example UK amateur`
    + ` callsign ${escapeHtml(ANATOMY_EXAMPLE)}</title><desc id="anat-d">${escapeHtml(spokenDescription())}</desc>`
    + `${tiles}${groups}</svg>`;

  const rows = ANATOMY_PARTS.map((p, i) => {
    const gloss = p.glossary === undefined ? ''
      : ` (<a href="${glossaryHref(p.glossary, depthToRoot)}">glossary</a>)`;
    return `<tr><th scope="row">${i + 1}</th>`
      + `<td><a href="${p.href}">${escapeHtml(p.name)}</a>${gloss}</td>`
      + `<td><code>${escapeHtml(p.chars)}</code></td>`
      + `<td><span class="anat-swatch" style="background:var(--anat-${p.token})" aria-hidden="true"></span>${escapeHtml(p.colourName)}</td>`
      + `<td>${escapeHtml(p.meaning)}</td></tr>`;
  }).join('');

  const table = `<table><caption class="table-caption">The parts of ${escapeHtml(ANATOMY_EXAMPLE)},`
    + ` the diagram read as a table.</caption><thead><tr><th scope="col">#</th><th scope="col">Part</th>`
    + `<th scope="col">Characters</th><th scope="col">Colour</th><th scope="col">What it is</th></tr></thead>`
    + `<tbody>${rows}</tbody></table>`;

  return `<figure class="anatomy-figure"><figcaption>The parts of a UK amateur callsign, shown on the`
    + ` example ${escapeHtml(ANATOMY_EXAMPLE)}. Colour groups each part; every part is also labelled in`
    + ` words here and in the table.</figcaption>${svg}<div class="overflow">${table}</div></figure>`;
}
