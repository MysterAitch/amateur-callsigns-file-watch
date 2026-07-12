import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GLOSSARY_ANCHORS } from '../src/ci/site-render.ts';
import { buildClassPages } from '../src/ci/build-class-pages.ts';

// Glossary-link integrity (issues #329 / #397). The site is dense with domain
// jargon and the glossary is the single place that defines it, so a glossary
// deep-link that dangles (a renamed anchor, a term linked to an id that never
// existed) silently strands the reader at the point of confusion. These guards
// fail CI on that drift, from BOTH directions:
//
//  - every anchor the shared render layer can emit (GLOSSARY_ANCHORS) resolves
//    to a real id in glossary.html — this is what covers the GENERATED pages,
//    since glossaryTerm/glossaryCue are the only emitters there and their
//    anchor argument is compile-time constrained to a registry key, so a
//    generated link cannot point anywhere the registry does not;
//  - every glossary deep-link written into the hand-authored site/*.html pages
//    resolves to a real id too; and
//  - a sample of high-value terms is actually linked on the representative
//    pages, so the affordance cannot quietly regress to un-linked prose.

const SITE_DIR = path.join(import.meta.dirname);

// Every id="…" in the shipped glossary is a valid deep-link target.
function glossaryIds(): Set<string> {
  const html = fs.readFileSync(path.join(SITE_DIR, 'glossary.html'), 'utf8');
  const ids = new Set<string>();
  for (const m of html.matchAll(/\bid="([^"]+)"/g)) ids.add(m[1]);
  return ids;
}

// Every glossary deep-link fragment (the part after glossary.html#) in a blob
// of HTML. Same-page "#anchor" links inside the glossary are deliberately not
// matched — only cross-page glossary.html#… deep-links.
function glossaryLinkFragments(html: string): string[] {
  return [...html.matchAll(/glossary\.html#([A-Za-z0-9-]+)/g)].map(m => m[1]);
}

const VALID_IDS = glossaryIds();

// The hand-authored pages that carry glossary deep-links, read once.
const HAND_AUTHORED = fs.readdirSync(SITE_DIR).filter(f => f.endsWith('.html'));

describe('glossary anchor registry (issue #329)', () => {
  it('GlossaryRegistry_EveryAnchor_ResolvesToARealGlossaryId', () => {
    for (const anchor of Object.keys(GLOSSARY_ANCHORS)) {
      expect(VALID_IDS.has(anchor), `registry anchor #${anchor} has no matching id in glossary.html`).toBe(true);
    }
  });

  it('GlossaryRegistry_EveryAnchor_CarriesAPlainLanguageName', () => {
    // The name is the affordance's accessible text ("definition of <name>"),
    // so a blank one would ship a link announced without a subject.
    for (const [anchor, name] of Object.entries(GLOSSARY_ANCHORS)) {
      expect(name.trim().length, `registry anchor #${anchor} has an empty name`).toBeGreaterThan(0);
    }
  });
});

describe('hand-authored pages glossary links (issues #329 / #397)', () => {
  it('HandAuthoredPages_EveryGlossaryDeepLink_ResolvesToARealGlossaryId', () => {
    for (const file of HAND_AUTHORED) {
      const html = fs.readFileSync(path.join(SITE_DIR, file), 'utf8');
      for (const fragment of glossaryLinkFragments(html)) {
        expect(VALID_IDS.has(fragment), `${file} links glossary.html#${fragment}, which is not an id in glossary.html`).toBe(true);
      }
    }
  });

  // A sample of high-value terms the #397 audit called out, asserted actually
  // linked on the page a reader would meet them on — so the affordance cannot
  // regress to un-linked jargon without a test noticing.
  const SAMPLES: [page: string, fragments: string[]][] = [
    ['index.html', ['suffix', 'prefix-series']],
    ['statistics.html', ['rsl', 'prefix-series']],
    ['data-status.html', ['axis-authority', 'axis-confidence', 'axis-processing']],
  ];
  for (const [page, fragments] of SAMPLES) {
    for (const fragment of fragments) {
      it(`${page.replace('.html', '')}Page_LinksKeyTerm_${fragment}`, () => {
        const html = fs.readFileSync(path.join(SITE_DIR, page), 'utf8');
        expect(glossaryLinkFragments(html)).toContain(fragment);
      });
    }
  }

  it('GlossaryAffordance_EveryCueGlyph_IsHiddenFromAssistiveTech', () => {
    // The "?" cue is decorative; the accessible name comes from the sibling
    // visually-hidden text / aria-label. A cue glyph exposed to a screen-reader
    // would announce a meaningless bare "?", so every one must be aria-hidden.
    for (const file of HAND_AUTHORED) {
      const html = fs.readFileSync(path.join(SITE_DIR, file), 'utf8');
      for (const m of html.matchAll(/<span class="gloss-cue"([^>]*)>/g)) {
        expect(m[1], `${file} has a gloss-cue span that is not aria-hidden`).toContain('aria-hidden="true"');
      }
    }
  });
});

describe('generated pages glossary links (issues #329 / #397)', () => {
  let outputDir: string;
  let classIndex: string;

  beforeAll(() => {
    // The dataset-class section is built from directory listings and meta.json
    // only (no multi-hundred-thousand-row CSV parse), so it exercises the
    // shared glossaryTerm helper in real generated output cheaply.
    outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'glossary-links-'));
    buildClassPages(outputDir, 'https://example.test/site');
    classIndex = fs.readFileSync(path.join(outputDir, 'datasets', 'classes', 'index.html'), 'utf8');
  });

  afterAll(() => {
    fs.rmSync(outputDir, { recursive: true, force: true });
  });

  it('GeneratedClassIndex_EveryGlossaryDeepLink_ResolvesToARealGlossaryId', () => {
    const fragments = glossaryLinkFragments(classIndex);
    expect(fragments.length, 'the generated class index emitted no glossary links').toBeGreaterThan(0);
    for (const fragment of fragments) {
      expect(VALID_IDS.has(fragment), `generated class index links glossary.html#${fragment}, absent from glossary.html`).toBe(true);
    }
  });

  it('GeneratedClassIndex_JargonTerm_UsesTheSharedAffordanceWithAccessibleText', () => {
    // The dataset-class term is rendered through the shared affordance: the
    // gloss-term link, a decorative aria-hidden cue, and visually-hidden
    // accessible text naming the term (never a bare "?").
    expect(classIndex).toContain('class="gloss-term" href="../../glossary.html#dataset-class"');
    expect(classIndex).toContain('<span class="gloss-cue" aria-hidden="true">?</span>');
    expect(classIndex).toMatch(/<span class="visually-hidden"> \(definition of [^<]*dataset class[^<]*in the glossary\)<\/span>/);
  });
});
