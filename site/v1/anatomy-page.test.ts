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

describe('v1 anatomy page — structure-reference completeness (issue #959)', { tags: ['unit'] }, () => {
  it('AnatomyPage_ClubRsl_NamesTheClubOnlySetAndCitesAPrimarySource', () => {
    // The club RSL front: the page must state that a club draws on a club-only
    // letter set (the GX/MX class) and cite a saved primary document for it.
    expect(ANATOMY_HTML).toContain('GX3DEF');
    expect(ANATOMY_HTML).toContain('Full (Club)');
    expect(ANATOMY_HTML).toContain('Policy on temporary call signs and call sign enhancement');
    expect(ANATOMY_HTML).toContain('§3.6');
  });

  it('AnatomyPage_TemporaryRsl_DocumentsMechanismAndKnownGrantsWithSources', () => {
    // The special-event RSL front: the notified, time-bounded mechanism plus the
    // documented letter grants, each cited to Ofcom guidance §5.7.1 / the 2018 policy.
    expect(ANATOMY_HTML).toContain('temporary RSL');
    expect(ANATOMY_HTML).toContain('no more than one year');
    expect(ANATOMY_HTML).toContain('§5.7.1');
    // The three documented grants.
    expect(ANATOMY_HTML).toContain('national mourning, 2022');
    expect(ANATOMY_HTML).toContain('2O0ABC');
    expect(ANATOMY_HTML).toContain('MA6ABC');
  });

  it('AnatomyPage_TemporaryRslTable_EveryRow_CarriesANonEmptySourceCell', () => {
    // Unhappy-path guard: a documented-grant row with no source is an uncited
    // fact. Locate the grants table by its caption and assert every row's final
    // (Source) cell is non-empty.
    const table = [...parse().querySelectorAll('table')].find(
      (t) => /Documented temporary RSLs/.test(norm(t.querySelector('caption')?.textContent)),
    );
    expect(table, 'the documented temporary-RSL table is missing').toBeDefined();
    const rows = [...(table as HTMLTableElement).querySelectorAll('tbody tr')];
    expect(rows.length).toBeGreaterThan(0);
    for (const tr of rows) {
      const cells = [...tr.querySelectorAll('td, th')];
      const source = norm(cells[cells.length - 1]?.textContent);
      expect(source.length, `a temporary-RSL row has an empty source cell: "${norm(tr.textContent)}"`).toBeGreaterThan(0);
      expect(/Ofcom/.test(source), `a temporary-RSL row's source names no document: "${source}"`).toBe(true);
    }
  });

  it('AnatomyPage_Reciprocal_NamesBothReciprocalProductsWithSources', () => {
    // The reciprocal/visitor front: the two distinct reciprocal products (#232)
    // are both named, with the authoritative definition cited.
    expect(ANATOMY_HTML).toContain('Full (Temporary Reciprocal) Licence');
    expect(ANATOMY_HTML).toContain('Full (Reciprocal)');
    expect(ANATOMY_HTML).toContain('11 December 2023');
    // The visitor-prefix construction links to its new glossary term.
    const visitorLink = parse().querySelector('a.term-link[data-term="visitorPrefix"]');
    expect(visitorLink?.getAttribute('href')).toBe('glossary.html#def-visitor-prefix');
  });

  it('AnatomyPage_SuffixLength_StatesPermittedFormsAndTheRegisterWitness', () => {
    // The suffix-length front: the permitted forms (primary source) beside the
    // register's own observed distribution (in-repo witness), each attributed.
    expect(ANATOMY_HTML).toContain('normally three letters');
    expect(ANATOMY_HTML).toContain('special contest callsigns');
    expect(ANATOMY_HTML).toContain('§5.2');
    // The observed distribution is framed as an observation, not a completeness claim.
    expect(ANATOMY_HTML).toContain('99.7%');
    expect(ANATOMY_HTML).toContain('Observation of what the record holds');
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
