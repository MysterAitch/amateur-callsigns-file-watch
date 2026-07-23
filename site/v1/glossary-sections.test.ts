// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import {
  GLOSSARY_SECTION_ORDER,
  GLOSSARY_SECTION_REGISTRY,
  GLOSSARY_REGISTRY_KEYS,
  GLOSSARY_GROUPED_KEYS,
  renderGlossarySections,
} from './glossary-sections.js';
import { inlineTerm, glossaryAnchorId } from './glossary.js';
import { V1_COPY } from './copy.js';

// The v1 glossary page (issue #930): the full-page home for the coined
// vocabulary, rendered from the SINGLE V1_COPY.glossary registry the inline
// popovers also open. These exercise the config-array section registry, the
// registry↔page completeness invariant, and — the load-bearing contract — that
// every popover link-out resolves to a real anchor on this page (and that no
// anchor is orphaned). Test names follow Subject_Scenario_Outcome, and cover the
// non-happy paths: an unregistered section id fails loudly, and a term with no
// page anchor (or an anchor with no term) is caught by the parity guard.

type GlossaryKey = keyof typeof V1_COPY.glossary;

const norm = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();

// Extract each rendered definition, keyed by its anchor id, from a sections
// container (the JS render root, or the static page's #sections element).
function extractGlossaryEntries(scope: ParentNode): Record<string, { term: string; def: string }> {
  const out: Record<string, { term: string; def: string }> = {};
  for (const dt of scope.querySelectorAll('dl.gloss dt')) {
    const id = dt.getAttribute('id') ?? '';
    const dd = dt.nextElementSibling;
    out[id] = { term: norm(dt.textContent), def: norm(dd?.textContent) };
  }
  return out;
}

function renderIntoSections(): HTMLElement {
  const root = document.createElement('div');
  renderGlossarySections(root);
  return root;
}

describe('v1 glossary page sections', { tags: ['ui'] }, () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('GlossarySectionOrder_EveryId_HasARegistryEntryAndViceVersa', () => {
    expect(Object.keys(GLOSSARY_SECTION_REGISTRY).sort()).toEqual([...GLOSSARY_SECTION_ORDER].sort());
  });

  it('GlossaryGroups_CoverTheCoinedRegistry_ExactlyOnce', () => {
    // Completeness invariant: every coined term is placed on the page exactly
    // once, and no group lists a term absent from the registry. A term added to
    // V1_COPY.glossary with no group would fail here rather than silently miss.
    expect([...GLOSSARY_GROUPED_KEYS].sort()).toEqual([...GLOSSARY_REGISTRY_KEYS].sort());
    expect(new Set(GLOSSARY_GROUPED_KEYS).size).toBe(GLOSSARY_GROUPED_KEYS.length);
    expect(GLOSSARY_REGISTRY_KEYS.sort()).toEqual((Object.keys(V1_COPY.glossary) as GlossaryKey[]).sort());
  });

  it('RenderGlossarySections_InOrder_MountsOneDataSectionPerEntry', () => {
    const root = renderIntoSections();
    const sections = [...root.querySelectorAll('section[data-section]')];
    expect(sections.map(s => s.getAttribute('data-section'))).toEqual([...GLOSSARY_SECTION_ORDER]);
  });

  it('RenderGlossarySections_UnregisteredId_ThrowsRatherThanEmitAGap', () => {
    const root = document.createElement('div');
    expect(() => renderGlossarySections(root, ['not-a-section'])).toThrow(/no registered section/);
  });

  it('RenderGlossarySections_EveryBodySection_SitsOnALegibilityPanel', () => {
    // The round-3 backing-surface rule: no body content sits bare on the ground.
    const root = renderIntoSections();
    const sections = [...root.querySelectorAll('section[data-section]')];
    expect(sections.length).toBeGreaterThan(0);
    for (const section of sections) {
      expect(section.querySelector('.surface'), `section "${section.getAttribute('data-section')}" must sit on a panel`).not.toBeNull();
    }
  });

  it('RenderGlossarySections_EveryCoinedTerm_RendersUnderItsStableAnchorWithItsRegistryDefinition', () => {
    const entries = extractGlossaryEntries(renderIntoSections());
    for (const key of GLOSSARY_REGISTRY_KEYS) {
      const anchor = glossaryAnchorId(key);
      expect(entries[anchor], `term "${key}" is missing its anchor #${anchor} on the page`).toBeDefined();
      expect(entries[anchor].term).toBe(V1_COPY.glossary[key].term);
      expect(entries[anchor].def).toBe(norm(V1_COPY.glossary[key].def));
    }
  });
});

describe('v1 glossary popover link-outs resolve (issue #930)', { tags: ['ui'] }, () => {
  it('GlossaryAnchorId_ForACamelCaseKey_IsAStableKebabAnchor', () => {
    expect(glossaryAnchorId('eventTime')).toBe('def-event-time');
    expect(glossaryAnchorId('carriedOrigin')).toBe('def-carried-origin');
    expect(glossaryAnchorId('sighting')).toBe('def-sighting');
  });

  it('EveryPopover_ForEveryTerm_LinksToTheTermsFullDefinitionOnTheGlossaryPage', () => {
    // The load-bearing contract: the popover carries the definition inline AND a
    // link out to its permanent anchor, using the copy-registry label — never a
    // dead end that stops short.
    for (const key of GLOSSARY_REGISTRY_KEYS) {
      const more = inlineTerm(key).querySelector('.pop-more');
      expect(more, `popover for "${key}" has no link-out`).not.toBeNull();
      expect(more?.textContent).toBe(V1_COPY.glossaryPage.popMore);
      expect(more?.getAttribute('href')).toBe(`glossary.html#${glossaryAnchorId(key)}`);
    }
  });

  it('PopoverLinkOuts_AndPageAnchors_AreInExactCorrespondence', () => {
    // Both non-happy directions at once: a popover term with no page anchor, and a
    // page anchor no popover points at, each fail. The two sets must be identical.
    const pageAnchors = new Set(Object.keys(extractGlossaryEntries(renderIntoSections())));
    const popoverTargets = new Set(
      GLOSSARY_REGISTRY_KEYS.map((key) => {
        const href = inlineTerm(key).querySelector('.pop-more')?.getAttribute('href') ?? '';
        return href.replace('glossary.html#', '');
      }),
    );
    expect([...popoverTargets].sort()).toEqual([...pageAnchors].sort());
    // No empty/blank anchor ever ships (an unnamed term would be unreachable).
    expect(pageAnchors.has('')).toBe(false);
  });
});

describe('v1 glossary static/JS parity (issue #930)', { tags: ['unit'] }, () => {
  it('StaticBaseline_GlossaryDefinitions_MatchTheModelRenderedDefinitions', () => {
    // The hand-maintained JS-off baseline in glossary.html is held identical to
    // the single-source render, so an edit to a registry definition cannot
    // silently split the static and scripted pages.
    const staticDoc = new DOMParser().parseFromString(fs.readFileSync('site/v1/glossary.html', 'utf8'), 'text/html');
    const staticSections = staticDoc.querySelector('#sections');
    expect(staticSections).not.toBeNull();
    expect(extractGlossaryEntries(staticSections as ParentNode)).toEqual(extractGlossaryEntries(renderIntoSections()));
  });

  it('StaticBaseline_SectionOrderAndHeadings_MatchTheConfigArray', () => {
    const staticDoc = new DOMParser().parseFromString(fs.readFileSync('site/v1/glossary.html', 'utf8'), 'text/html');
    const ids = [...(staticDoc.querySelector('#sections')?.querySelectorAll('section[data-section]') ?? [])]
      .map(s => s.getAttribute('data-section'));
    expect(ids).toEqual([...GLOSSARY_SECTION_ORDER]);
  });

  it('StaticGlossary_HeaderAndFoot_CarryTheRegistryCopy', () => {
    // The page header and foot are authored copy sourced from the registry; guard
    // that they carry the registry wording rather than a drifted hand copy.
    const html = fs.readFileSync('site/v1/glossary.html', 'utf8');
    expect(html).toContain(V1_COPY.glossaryPage.lede);
    expect(html).toContain(V1_COPY.glossaryPage.foot);
    expect(html).toContain(V1_COPY.glossaryPage.eyebrow);
  });
});
