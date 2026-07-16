import { describe, it, expect } from 'vitest';
import { anatomyFigureHtml, escapeHtml } from './callsign-pill.js';
import type { AnatomyPartSpec } from './callsign-pill.js';

// The shared segments-driven anatomy renderer (issue #595, in
// site/callsign-pill.js): one implementation behind both the structure page's
// committed example figure and the live per-callsign figure. These tests pin
// the renderer's contract for ARBITRARY part lists - the #468 accessibility
// conventions (label-not-just-colour, spoken <title>/<desc>, the
// always-visible table fallback) and the escaping that lets the live page feed
// it record-derived characters safely. The byte-stability of the committed
// example is guarded separately by src/ci/render/anatomy.test.ts. Test names
// follow Subject_Scenario_Outcome.

function part(overrides: Partial<AnatomyPartSpec> = {}): AnatomyPartSpec {
  return {
    token: 'prefix',
    colourName: 'blue',
    chars: 'M',
    shortLabel: 'Prefix',
    name: 'Prefix',
    meaning: 'The UK country block.',
    nameHref: 'callsign-structure.html#parts',
    ...overrides,
  };
}

function figure(parts: readonly AnatomyPartSpec[]): string {
  return anatomyFigureHtml({
    parts,
    idPrefix: 'anat',
    titleText: 'Anatomy of the callsign M7TEE',
    descLead: 'The callsign M7TEE',
    figcaptionLead: 'The parts of M7TEE',
    display: 'M7TEE',
  });
}

const THREE_PARTS: readonly AnatomyPartSpec[] = [
  part(),
  part({ token: 'digit', colourName: 'amber', chars: '7', shortLabel: 'Digit', name: 'Digit', meaning: 'A single number.' }),
  part({ token: 'suffix', colourName: 'red', chars: 'TEE', shortLabel: 'Suffix', name: 'Suffix',
    meaning: 'The ending letters.', glossaryHref: 'glossary.html#suffix' }),
];

describe('Shared anatomy renderer (issue #595)', { tags: ['unit'] }, () => {
  it('AnatomyFigure_ForAnyPartList_DrawsOneTilePerCharacterAndOneGroupPerPart', () => {
    const html = figure(THREE_PARTS);
    // Five characters (M, 7, T, E, E) -> five glyph tiles...
    const tiles = html.match(/font-size="30"/g) ?? [];
    expect(tiles.length).toBe(5);
    // ...and three colour-group underline bars with their numbered labels.
    const bars = html.match(/height="6" rx="3"/g) ?? [];
    expect(bars.length).toBe(3);
    expect(html).toContain('>1 · </tspan>');
    expect(html).toContain('>3 · </tspan>');
    expect(html).not.toContain('>4 · </tspan>');
  });

  it('AnatomyFigure_EveryPart_IsLabelledInTextNotColourAlone', () => {
    const html = figure(THREE_PARTS);
    for (const p of THREE_PARTS) {
      expect(html, `diagram label for ${p.name}`).toContain(`>${p.shortLabel}</tspan>`);
      expect(html, `table name for ${p.name}`).toContain(`>${p.name}</a>`);
      expect(html, `spelled-out colour for ${p.name}`).toContain(`>${p.colourName}</td>`);
    }
  });

  it('AnatomyFigure_AsAnImage_CarriesASpokenTitleAndPerPartDescription', () => {
    const html = figure(THREE_PARTS);
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-labelledby="anat-t anat-d"');
    expect(html).toContain('<title id="anat-t">Anatomy of the callsign M7TEE</title>');
    // The spoken description walks every part: position, characters, name, meaning.
    expect(html).toContain('The callsign M7TEE, spaced out and split into 3 colour-and-label groups.');
    expect(html).toContain('1, M is the prefix: The UK country block.');
    expect(html).toContain('3, TEE is the suffix: The ending letters.');
  });

  it('AnatomyFigure_WithNoSvgSupport_StillReadsAsATableOfEveryPart', () => {
    const html = figure(THREE_PARTS);
    expect(html).toContain('<table><caption class="table-caption">The parts of M7TEE, the diagram read as a table.</caption>');
    for (const p of THREE_PARTS) {
      expect(html, `characters cell for ${p.name}`).toContain(`<code>${p.chars}</code>`);
    }
    // The colour swatches are decorative; the colour NAME carries the meaning.
    const hiddenSwatches = html.match(/class="anat-swatch"[^>]*aria-hidden="true"/g) ?? [];
    expect(hiddenSwatches.length).toBe(THREE_PARTS.length);
  });

  it('AnatomyFigure_GlossaryLink_AppearsOnlyWhereAPartCarriesOne', () => {
    const html = figure(THREE_PARTS);
    const glossaryLinks = html.match(/>glossary<\/a>/g) ?? [];
    expect(glossaryLinks.length).toBe(1);
    expect(html).toContain('href="glossary.html#suffix"');
  });

  it('AnatomyFigure_ColoursAreThemeTokens_NotHardcodedValues', () => {
    // Theme-awareness rides on the CSS custom properties defined for light and
    // dark in site/ledger.css - the markup itself never fixes a colour.
    const html = figure(THREE_PARTS);
    expect(html).toContain('var(--anat-prefix)');
    expect(html).toContain('var(--anat-suffix)');
    expect(html).not.toMatch(/(?:fill|stroke|background)="?#[0-9a-fA-F]{3,8}/);
  });

  it('AnatomyFigure_HostileCharacters_AreEscapedNeverInterpretedAsMarkup', () => {
    // The live page feeds record-derived characters; a damaged value must
    // render as text, never as elements.
    const html = figure([part({ chars: '<img src=x>', name: 'A "quoted" & <named> part', meaning: 'x < y & "z"' })]);
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x&gt;');
    expect(html).toContain('A &quot;quoted&quot; &amp; &lt;named&gt; part');
  });

  it('EscapeHtml_OnTheFourSpecials_MatchesTheBuildSideHelperByteForByte', () => {
    expect(escapeHtml('a & b < c > d " e')).toBe('a &amp; b &lt; c &gt; d &quot; e');
  });
});
