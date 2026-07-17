import { describe, it, expect } from 'vitest';
import {
  extractLinks,
  classifyLink,
  resolveInternalLink,
  resolveEmittedFile,
  anchorIds,
} from './internal-link-crawl.ts';

// Unit coverage for the internal-link crawler primitives (issue #561). The heavy
// end-to-end guard runs these over the fully built site; here they are exercised
// on small fixtures so the parsing and resolution rules are pinned independently
// of the multi-minute real-site build. Test names follow Subject_Scenario_Outcome.

describe('internal link extraction', { tags: ['unit'] }, () => {
  it('ExtractLinks_HrefAndSrcInEitherQuoteStyle_AreAllCollected', () => {
    const html = `<a href="a.html">x</a><img src='b.png'><link href="c.css"><script src="d.js"></script>`;
    expect(extractLinks(html)).toEqual([
      { attr: 'href', raw: 'a.html' },
      { attr: 'src', raw: 'b.png' },
      { attr: 'href', raw: 'c.css' },
      { attr: 'src', raw: 'd.js' },
    ]);
  });

  it('ExtractLinks_AttributeValueWithEntities_IsReturnedVerbatim', () => {
    // The path is split off before decoding, so the raw &amp; must survive here.
    const html = `<a href="explore.html?db=combined&amp;sql=SELECT">q</a>`;
    expect(extractLinks(html)).toEqual([{ attr: 'href', raw: 'explore.html?db=combined&amp;sql=SELECT' }]);
  });

  it('ExtractLinks_NonLinkAttributes_AreIgnored', () => {
    // data-* affordances (the click-to-filter triggers) are not links.
    const html = `<div data-filter-expr="href=nope" data-browser-sql="src=nope"></div><a href="real.html">y</a>`;
    expect(extractLinks(html)).toEqual([{ attr: 'href', raw: 'real.html' }]);
  });
});

describe('internal link classification', { tags: ['unit'] }, () => {
  it('ClassifyLink_HttpAndProtocolRelative_AreExternal', () => {
    expect(classifyLink('https://example.test/a')).toBe('external');
    expect(classifyLink('http://example.test/a')).toBe('external');
    expect(classifyLink('//cdn.example.test/a.js')).toBe('external');
  });

  it('ClassifyLink_NonNavigationalSchemesAndBareHash_AreDynamic', () => {
    // The bare '#' facet trigger and the empty string resolve to nothing, as do
    // the mailto:/tel:/javascript:/data: schemes.
    for (const raw of ['#', '', 'mailto:a@b.test', 'tel:+441234', 'javascript:void(0)', 'data:text/plain,x']) {
      expect(classifyLink(raw), raw).toBe('dynamic');
    }
  });

  it('ClassifyLink_RelativePathsAndFragments_AreInternal', () => {
    for (const raw of ['a.html', './a.html', '../../series/M7.html', 'index.html?c=M7ABC', '#main', 'page.html#sec']) {
      expect(classifyLink(raw), raw).toBe('internal');
    }
  });
});

describe('internal link resolution', { tags: ['unit'] }, () => {
  it('ResolveInternalLink_RelativeAscent_NormalisesAgainstTheSourceDirectory', () => {
    expect(resolveInternalLink('datasets/open-data/2026-06-23/index.html', '../../../series/M7.html'))
      .toEqual({ path: 'series/M7.html', fragment: null });
  });

  it('ResolveInternalLink_QueryAndFragment_AreSeparatedFromThePath', () => {
    expect(resolveInternalLink('series/M7.html', '../index.html?c=M7ABC#top'))
      .toEqual({ path: 'index.html', fragment: 'top' });
  });

  it('ResolveInternalLink_SamePageFragment_TargetsTheSourcePage', () => {
    expect(resolveInternalLink('reports/index.html', '#main'))
      .toEqual({ path: 'reports/index.html', fragment: 'main' });
  });

  it('ResolveInternalLink_SiblingDirectoryLink_KeepsTheTrailingSlash', () => {
    // Correspondence records link sibling FOI entries by directory; the trailing
    // slash is preserved so the resolver can serve that directory's index.html.
    expect(resolveInternalLink('datasets/foi/entry-a/correspondence.md.html', '../entry-b/'))
      .toEqual({ path: 'datasets/foi/entry-b/', fragment: null });
  });
});

describe('emitted-file resolution', { tags: ['unit'] }, () => {
  const emitted = new Set(['index.html', 'series/M7.html', 'datasets/foi/entry-b/index.html']);

  it('ResolveEmittedFile_ExactFile_Resolves', () => {
    expect(resolveEmittedFile('series/M7.html', emitted)).toBe('series/M7.html');
  });

  it('ResolveEmittedFile_DirectoryLink_ResolvesToItsIndexHtml', () => {
    // Both the trailing-slash form and the bare directory name serve index.html
    // on a static host.
    expect(resolveEmittedFile('datasets/foi/entry-b/', emitted)).toBe('datasets/foi/entry-b/index.html');
    expect(resolveEmittedFile('datasets/foi/entry-b', emitted)).toBe('datasets/foi/entry-b/index.html');
  });

  it('ResolveEmittedFile_NothingEmitted_ReturnsNull', () => {
    // The empty-slug regression (series/.html) and any dropped output land here.
    expect(resolveEmittedFile('series/.html', emitted)).toBeNull();
    expect(resolveEmittedFile('datasets/foi/missing/index.html', emitted)).toBeNull();
  });
});

describe('anchor collection', { tags: ['unit'] }, () => {
  it('AnchorIds_IdAndNameAttributes_AreBothCollected', () => {
    const html = `<main id="main"></main><section id="sec"></section><a name="legacy"></a>`;
    const ids = anchorIds(html);
    expect(ids.has('main')).toBe(true);
    expect(ids.has('sec')).toBe(true);
    expect(ids.has('legacy')).toBe(true);
    expect(ids.has('absent')).toBe(false);
  });
});

// The composed dangling-in-page-anchor check (issue #701): render-markdown.ts
// now recognises [text](#fragment) links and gives every heading a slug id,
// so a fragment link has somewhere to land - but nothing stopped a TYPO'd
// fragment (one with no matching id anywhere on the target page) from
// rendering silently as a dead link. This pins the exact composition the real
// site build's beforeAll loop (src/ci/build-dataset-pages.test.ts, "Internal
// link integrity across the built site") runs over every generated page, on
// small in-memory fixtures instead of the multi-minute real build.
describe('dangling in-page anchor detection (issue #701)', { tags: ['unit'] }, () => {
  // Mirrors the production crawl loop: every internal link's fragment (if
  // any) must resolve to a real id/name on its RESOLVED target page.
  const findDanglingAnchors = (pages: Record<string, string>): string[] => {
    const emitted = new Set(Object.keys(pages));
    const dangling: string[] = [];
    for (const [rel, html] of Object.entries(pages)) {
      for (const { raw } of extractLinks(html)) {
        if (classifyLink(raw) !== 'internal') continue;
        const { path: target, fragment } = resolveInternalLink(rel, raw);
        if (fragment === null || fragment === '') continue;
        const key = resolveEmittedFile(target, emitted);
        if (key === null) continue; // a missing file is the OTHER check's concern
        const ids = anchorIds(pages[key]);
        if (!ids.has(fragment)) dangling.push(`${rel} -> ${raw}`);
      }
    }
    return dangling;
  };

  it('DanglingAnchorCheck_FragmentMatchesAnEmittedHeadingId_PageIsClean', () => {
    const pages = {
      'page.html': '<h2 id="the-uk-model">The UK model</h2><a href="#the-uk-model">see above</a>',
    };
    expect(findDanglingAnchors(pages)).toEqual([]);
  });

  it('DanglingAnchorCheck_FragmentHasNoMatchingIdOnItsPage_FailsTheCheck', () => {
    // A typo'd or stale fragment (renamed heading, removed section) - the
    // renderer would still emit the <a>, so only the crawl catches this.
    const pages = {
      'page.html': '<h2 id="the-uk-model">The UK model</h2><a href="#the-uk-mode">see above</a>',
    };
    expect(findDanglingAnchors(pages)).toEqual(['page.html -> #the-uk-mode']);
  });

  it('DanglingAnchorCheck_EmptyFragment_IsOutOfScopeNotFlagged', () => {
    // classifyLink treats the bare '#' facet-trigger idiom as 'dynamic', so it
    // never reaches the anchor check at all.
    const pages = { 'page.html': '<a href="#">jump</a>' };
    expect(findDanglingAnchors(pages)).toEqual([]);
  });

  it('DanglingAnchorCheck_HeadingExistsOnlyOnAnotherPage_SameFragmentOnThisPageStillFails', () => {
    // The anchor must resolve against the page the link ACTUALLY targets -
    // a heading id that exists elsewhere on the site does not rescue a
    // same-page reference to a fragment absent on the current page.
    const pages = {
      'a.html': '<h2 id="glossary">Glossary</h2>',
      'b.html': '<p>See <a href="#glossary">the glossary</a> below.</p>',
    };
    expect(findDanglingAnchors(pages)).toEqual(['b.html -> #glossary']);
  });

  it('DanglingAnchorCheck_CrossPageFragmentLinkToTheRightPage_Resolves', () => {
    // The correct fix for the previous case: point at the page that actually
    // carries the heading.
    const pages = {
      'a.html': '<h2 id="glossary">Glossary</h2>',
      'b.html': '<p>See <a href="a.html#glossary">the glossary</a> below.</p>',
    };
    expect(findDanglingAnchors(pages)).toEqual([]);
  });

  it('DanglingAnchorCheck_FragmentWithSpecialCharacters_MatchedExactlyAgainstTheId', () => {
    // A fragment containing characters beyond plain slug text (as a hand-typed
    // anchor to non-generated HTML might carry) still resolves when the id
    // matches exactly, and still fails when it does not.
    const clean = { 'page.html': '<h2 id="step-2.1_alt">Step 2.1 (alt)</h2><a href="#step-2.1_alt">go</a>' };
    expect(findDanglingAnchors(clean)).toEqual([]);
    const broken = { 'page.html': '<h2 id="step-2.1_alt">Step 2.1 (alt)</h2><a href="#step-2.1-alt">go</a>' };
    expect(findDanglingAnchors(broken)).toEqual(['page.html -> #step-2.1-alt']);
  });
});
