import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { v1CallsignAnatomyFigure } from './v1-anatomy.ts';
import { ANATOMY_PARTS } from './anatomy.ts';

// The v1 anatomy / structure-reference page (issue #931): the labelled diagram
// and its key table are the byte-identical output of the ONE shared anatomy
// renderer, embedded once into the static page, with the glossary deep-links
// resolved to the v1 anchor scheme. These guard that the committed page carries
// exactly that output (a drift guard, like the v0 anatomy.test.ts), that the
// v1-specific glossary anchors are used rather than the v0 ones, that the
// surface stays isolated from the legacy tree, and — the show-the-working rule —
// that every part whose meaning is sourced carries its citation. Test names
// follow Subject_Scenario_Outcome.

const ANATOMY_HTML = fs.readFileSync(path.join('site', 'v1', 'anatomy.html'), 'utf8');

describe('v1 anatomy figure (issue #931)', { tags: ['unit'] }, () => {
  it('AnatomyPage_EmbeddedFigure_MatchesTheSharedRendererOutputVerbatim', () => {
    // The committed page must contain the canonical figure exactly, so the
    // diagram and its key table cannot silently diverge from the one renderer the
    // live per-callsign figure also uses.
    expect(ANATOMY_HTML).toContain(v1CallsignAnatomyFigure());
  });

  it('AnatomyFigure_GlossaryDeepLinks_UseTheV1AnchorScheme', () => {
    // The v1-specific contribution: a part's glossary link resolves to the v1
    // glossary's stable def-<kebab-key> anchor, not the v0 anchor.
    const figure = v1CallsignAnatomyFigure();
    expect(figure).toContain('glossary.html#def-rsl');
    expect(figure).toContain('glossary.html#def-suffix');
    // The v0 anchors (bare #rsl / #suffix as a glossary href) must not survive.
    expect(figure).not.toContain('glossary.html#rsl"');
    expect(figure).not.toContain('glossary.html#suffix"');
  });

  it('AnatomyFigure_NeverReferencesTheLegacyTree', () => {
    // Strict isolation: the figure embedded on the v1 page points at nothing on
    // the v0 surface (no /v0/, no callsign-structure.html).
    const figure = v1CallsignAnatomyFigure();
    expect(figure).not.toMatch(/(?<![a-z])v0/i);
    expect(figure).not.toContain('callsign-structure.html');
  });

  it('AnatomyFigure_EverySourcedPart_CarriesItsCitationLink', () => {
    // Show the working: no part's sourced meaning is stripped of its citation.
    const figure = v1CallsignAnatomyFigure();
    const citedCount = ANATOMY_PARTS.filter((p) => p.citation !== undefined).length;
    expect(citedCount).toBeGreaterThan(0);
    for (const part of ANATOMY_PARTS) {
      const citation = part.citation;
      if (citation === undefined) continue;
      // The citation is honoured only when both its link and label render — an
      // uncited fact would be a silent omission, which this catches.
      expect(figure, `part "${part.name}" is missing its citation href`).toContain(citation.href);
      expect(figure, `part "${part.name}" is missing its citation label`).toContain(`>${citation.label}</a>`);
    }
  });

  it('AnatomyPage_KeyTable_NamesEveryCanonicalPart', () => {
    // The page's structure vocabulary must AGREE with the shared part list the
    // per-callsign anatomy section also derives from — the same names, never a
    // forked vocabulary.
    for (const part of ANATOMY_PARTS) {
      expect(ANATOMY_HTML, `anatomy page does not name the part "${part.name}"`).toContain(part.name);
    }
  });
});
