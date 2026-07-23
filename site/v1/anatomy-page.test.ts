// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import { enhanceTermLinks } from './anatomy-page.js';
import { glossaryAnchorId } from './glossary.js';
import { V1_COPY } from './copy.js';

// The v1 anatomy / structure-reference page (issue #931). These exercise the
// static no-JS baseline (the coined terms link to real glossary anchors, the
// framing copy is the registry copy, every sourced-fact table names its source)
// and the progressive-enhancement layer (each term link upgrades into an inline
// glossary popover, and an unknown term is left as an honest plain link). Test
// names follow Subject_Scenario_Outcome and cover the non-happy paths.

type GlossaryKey = keyof typeof V1_COPY.glossary;

const norm = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();
const ANATOMY_HTML = fs.readFileSync('site/v1/anatomy.html', 'utf8');

function parse(): Document {
  return new DOMParser().parseFromString(ANATOMY_HTML, 'text/html');
}

// Mount the page's <main> into the test's own document, so the enhancement (which
// builds popover nodes with the global document) and the mounted markup share one
// document.
function mountMain(): void {
  const doc = parse();
  const main = doc.querySelector('main');
  document.body.innerHTML = '';
  if (main !== null) document.body.appendChild(document.importNode(main, true));
}

describe('v1 anatomy page — static baseline (issue #931)', { tags: ['unit'] }, () => {
  it('AnatomyPage_RobotsMeta_WithholdsFromCrawlersPreLaunch', () => {
    expect(ANATOMY_HTML).toContain('<meta name="robots" content="noindex">');
  });

  it('AnatomyPage_JourneyNav_MarksAnatomyAsTheCurrentPage', () => {
    const doc = parse();
    const current = doc.querySelector('nav.journeys a[aria-current="page"]');
    expect(current?.getAttribute('href')).toBe('anatomy.html');
  });

  it('AnatomyPage_FramingCopy_IsTheCopyRegistryCopy', () => {
    // The claims-bar wording gate walks V1_COPY; the page must carry that exact
    // copy rather than a drifted hand copy.
    expect(ANATOMY_HTML).toContain(V1_COPY.anatomyPage.eyebrow);
    expect(ANATOMY_HTML).toContain(V1_COPY.anatomyPage.lede);
    expect(ANATOMY_HTML).toContain(V1_COPY.anatomyPage.foot);
    // The "how to read the sources" key is emphasised with inline <b> in the
    // page, so it is compared on its text content.
    const held = parse().querySelector('.held');
    expect(norm(held?.textContent)).toBe(norm(V1_COPY.anatomyPage.howToReadSources));
  });

  it('AnatomyPage_EveryInlineTermLink_PointsAtARealGlossaryAnchor', () => {
    // Both correctness and a non-happy guard: a term link whose data-term is not a
    // registry key, or whose href does not match that term's stable anchor, would
    // be a dangling reference. The two must agree exactly.
    const registryKeys = new Set(Object.keys(V1_COPY.glossary));
    const links = [...parse().querySelectorAll('a.term-link[data-term]')];
    expect(links.length).toBeGreaterThan(0);
    for (const a of links) {
      const key = a.getAttribute('data-term') ?? '';
      expect(registryKeys.has(key), `term link data-term "${key}" is not a glossary key`).toBe(true);
      expect(a.getAttribute('href')).toBe(`glossary.html#${glossaryAnchorId(key as GlossaryKey)}`);
    }
  });

  it('AnatomyPage_EverySourcedFactsTable_NamesItsSourceInTheCaption', () => {
    // Show the working: no reference table is presented without naming where it
    // comes from — a caption with no source citation would be an uncited fact.
    // The diagram's own key table is excluded: it cites in its cells (the ITU
    // link), not the caption, and is guarded by the figure drift test instead.
    const captions = [...parse().querySelectorAll('table caption.table-caption')]
      .filter((cap) => cap.closest('.anatomy-figure') === null);
    expect(captions.length).toBeGreaterThan(0);
    for (const cap of captions) {
      const text = norm(cap.textContent);
      // Each reference table's caption names Ofcom or the ITU (its primary source).
      expect(/Ofcom|ITU/.test(text), `table caption cites no source: "${text}"`).toBe(true);
    }
  });

  it('AnatomyPage_InlineSourceAttributions_AccompanyTheSourcedProse', () => {
    // The prose facts carry their citations inline (the .src attributions).
    expect(parse().querySelectorAll('.src').length).toBeGreaterThanOrEqual(6);
  });
});

describe('v1 anatomy page — term popovers (issue #931)', { tags: ['ui'] }, () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('EnhanceTermLinks_EachTermLink_BecomesAPopoverLinkingToItsGlossaryAnchor', () => {
    mountMain();
    const keysOnPage = [...document.querySelectorAll('a.term-link[data-term]')]
      .map((a) => a.getAttribute('data-term') ?? '');
    expect(keysOnPage.length).toBeGreaterThan(0);
    enhanceTermLinks(document);
    // No authored term link survives as a bare anchor once enhanced …
    expect(document.querySelectorAll('a.term-link[data-term]').length).toBe(0);
    // … and each became a popover whose link-out targets the term's anchor.
    for (const key of keysOnPage) {
      const anchor = glossaryAnchorId(key as GlossaryKey);
      const more = [...document.querySelectorAll('details.term .pop-more')]
        .find((m) => m.getAttribute('href') === `glossary.html#${anchor}`);
      expect(more, `no popover links to #${anchor} for term "${key}"`).toBeDefined();
    }
  });

  it('EnhanceTermLinks_AnUnknownTerm_IsLeftAsAnHonestPlainLink', () => {
    // A term link whose data-term is not a registry key must NOT be replaced by an
    // empty popover — it stays the plain, working link it already is.
    const a = document.createElement('a');
    a.className = 'term-link';
    a.setAttribute('data-term', 'not-a-real-term');
    a.setAttribute('href', 'glossary.html#def-nowhere');
    a.textContent = 'mystery';
    document.body.appendChild(a);
    enhanceTermLinks(document);
    const survivor = document.querySelector('a.term-link[data-term="not-a-real-term"]');
    expect(survivor).not.toBeNull();
    expect(document.querySelector('details.term')).toBeNull();
  });

  it('EnhanceTermLinks_RunAgainstNoTermLinks_IsANoOp', () => {
    document.body.innerHTML = '<p>No terms here.</p>';
    expect(() => enhanceTermLinks(document)).not.toThrow();
    expect(document.querySelector('details.term')).toBeNull();
  });
});
