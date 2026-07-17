import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  callsignAnatomyFigure,
  ANATOMY_PARTS,
  ANATOMY_EXAMPLE,
  navHtml,
} from '../site-render.ts';
import { ACTIVE_NAV } from '../build-nav.ts';

// Test names follow Subject_Scenario_Outcome per project convention. These
// exercise the anatomy figure (issue #468) as a user meets it: an accessible,
// colour-AND-label diagram that still reads with no colour, no SVG and no
// scripts, plus its wiring into the site navigation.

const STRUCTURE_PAGE = path.join('site', 'callsign-structure.html');

describe('Callsign anatomy figure', { tags: ['unit'] }, () => {
  const figure = callsignAnatomyFigure(0);

  it('AnatomyFigure_Rendered_IsAnAccessibleSvgImageWithSpokenSummary', () => {
    // A screen reader meets the SVG as a single image with a spoken title and
    // description, wired by aria-labelledby to the <title>/<desc> ids.
    expect(figure).toContain('role="img"');
    expect(figure).toContain('aria-labelledby="anat-t anat-d"');
    expect(figure).toContain('<title id="anat-t">');
    expect(figure).toContain('<desc id="anat-d">');
    expect(figure).toContain(ANATOMY_EXAMPLE);
    // The spoken description names every part, so the breakdown is heard
    // without reaching the table.
    for (const part of ANATOMY_PARTS) {
      expect(figure).toContain(part.name.toLowerCase());
    }
  });

  it('AnatomyFigure_EveryPart_IsLabelledInTextNotColourAlone', () => {
    // WCAG 1.4.1: each colour group is also carried by a text label on the
    // diagram (its short label) and named in full in the table, so meaning
    // never depends on colour perception.
    for (const part of ANATOMY_PARTS) {
      expect(figure, `diagram label for ${part.name}`).toContain(`>${part.shortLabel}</tspan>`);
      expect(figure, `table name for ${part.name}`).toContain(`>${part.name}</a>`);
    }
  });

  it('AnatomyFigure_EachColour_IsPairedWithItsSpelledOutName', () => {
    // The colour itself is named in words in the key table, and the colour
    // swatch is decorative (aria-hidden) - so a reader who cannot see the
    // colour still learns which colour each part carries.
    for (const part of ANATOMY_PARTS) {
      expect(figure, `colour name for ${part.name}`).toContain(`>${part.colourName}</td>`);
    }
    const swatches = figure.match(/anat-swatch/g) ?? [];
    expect(swatches.length).toBe(ANATOMY_PARTS.length);
    const hiddenSwatches = figure.match(/class="anat-swatch"[^>]*aria-hidden="true"/g) ?? [];
    expect(hiddenSwatches.length).toBe(ANATOMY_PARTS.length);
  });

  it('AnatomyFigure_WithNoSvg_StillReadsAsATableOfEveryPart', () => {
    // The <table> is the crawlable, no-JS, no-SVG fallback: a row per part,
    // each with its characters, so the figure degrades to plain content.
    expect(figure).toContain('<table>');
    expect(figure).toContain('<caption');
    for (const part of ANATOMY_PARTS) {
      expect(figure, `characters cell for ${part.name}`).toContain(`<code>${part.chars}</code>`);
    }
    const bodyRows = figure.match(/<tr><th scope="row">/g) ?? [];
    expect(bodyRows.length).toBe(ANATOMY_PARTS.length);
  });

  it('AnatomyFigure_JargonTerms_LinkToTheirGlossaryDefinitions', () => {
    // The RSL and suffix terms carry glossary deep-links, matching the
    // site-wide affordance.
    expect(figure).toContain('glossary.html#rsl');
    expect(figure).toContain('glossary.html#suffix');
  });

  it('AnatomyFigure_PrefixMeaning_CitesTheItuAllocationTableItRestsOn', () => {
    // Issue #770: the "allocated by the ITU" claim otherwise names no source.
    // It links to the same ITU GLAD call-sign-series table already cited for
    // the UK country block in reference-data/README.md.
    expect(figure).toContain('<a href="https://www.itu.int/gladapp/Allocation/CallSigns">ITU</a>');
  });
});

describe('Anatomy page and navigation wiring', { tags: ['ui'] }, () => {
  it('CallsignStructurePage_EmbedsTheGeneratedFigureVerbatim_SoTheyCannotDrift', () => {
    // The committed page must contain the generator's exact output; if either
    // changes without the other, this fails rather than shipping a diagram
    // that no longer matches its single source.
    const page = fs.readFileSync(STRUCTURE_PAGE, 'utf8');
    expect(page).toContain(callsignAnatomyFigure(0));
  });

  it('SiteNavigation_ListsTheAnatomyPage_AsALinkFromOtherPages', () => {
    // The nav single source carries the Anatomy entry, so every generated and
    // re-stamped page links to it.
    const nav = navHtml(0);
    expect(nav).toContain('<a href="callsign-structure.html">Anatomy</a>');
    expect(ACTIVE_NAV['callsign-structure.html']).toBe('Anatomy');
  });

  it('CallsignStructurePage_MarksAnatomyActive_InItsOwnNavStrip', () => {
    // On the anatomy page itself the item is the current page: bold, not a
    // self-link.
    const page = fs.readFileSync(STRUCTURE_PAGE, 'utf8');
    expect(page).toContain('<strong>Anatomy</strong>');
    expect(page).not.toContain('<a href="callsign-structure.html">Anatomy</a>');
  });
});
