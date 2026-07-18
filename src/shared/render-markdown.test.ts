import { describe, it, expect } from 'vitest';
import { renderMarkdown } from './render-markdown.ts';

// Test names follow Subject_Scenario_Outcome per project convention.
//
// The minimal markdown renderer serves the dataset pages' browsing views of
// correspondence.md and raw-extract transcription files. It covers the
// archive's own markdown subset; unknown constructs degrade to escaped
// text - the verbatim .md remains the record.

describe('Markdown renderer', { tags: ['unit'] }, () => {
  it('RenderMarkdown_HeadingsRulesAndParagraphs_ProduceStructuralHtml', () => {
    const html = renderMarkdown('# Title\n\nSome text\nover two lines.\n\n---\n\n## Section');
    // Headings carry a slug id (issue #701) so in-page anchors have somewhere
    // to land.
    expect(html).toContain('<h1 id="title">Title</h1>');
    // Soft-wrapped source lines flow as one sentence - never a hard break.
    expect(html).toContain('<p>Some text over two lines.</p>');
    expect(html).toContain('<hr>');
    expect(html).toContain('<h2 id="section">Section</h2>');
  });

  it('RenderMarkdown_FencedCodeBlock_RendersAsPreformattedEscapedCode', () => {
    const html = renderMarkdown('Before.\n\n```\nraw lines = headers + rows\nx < y & z\n```\n\nAfter.');
    expect(html).toContain('<pre><code>raw lines = headers + rows\nx &lt; y &amp; z</code></pre>');
    expect(html).toContain('<p>Before.</p>');
    expect(html).toContain('<p>After.</p>');
  });

  it('RenderMarkdown_PipeTable_RendersHeaderAndRows', () => {
    const html = renderMarkdown('| period | count |\n|---|---:|\n| 2003–2004 | 29,190 |\n| 2004–2005 | 167,561 |');
    expect(html).toContain('<th>period</th>');
    expect(html).toContain('<td>2003–2004</td>');
    expect(html).toContain('<td>167,561</td>');
  });

  // Zero de-emphasis (issue #731): a table cell whose trimmed source text is
  // exactly "0" mutes at the render edge via the shared `.zero` class,
  // without the committed markdown itself changing.
  describe('zero-value table cells', { tags: ['unit'] }, () => {
    it('RenderMarkdown_PipeTableCellIsExactlyZero_WrapsItInZeroSpan', () => {
      const html = renderMarkdown('| publication | dropped |\n|---|---:|\n| 2024-01 | 0 |');
      expect(html).toContain('<td><span class="zero">0</span></td>');
    });

    it('RenderMarkdown_PipeTableCellIsNonZeroNumber_RendersPlainWithNoZeroSpan', () => {
      const html = renderMarkdown('| publication | dropped |\n|---|---:|\n| 2024-01 | 42 |');
      expect(html).toContain('<td>42</td>');
      expect(html).not.toContain('class="zero"');
    });

    it('RenderMarkdown_PipeTableCellContainsZeroWithinLongerText_DoesNotMuteIt', () => {
      // "10", "0.5", and prose merely containing the digit are not
      // themselves the literal value zero.
      const html = renderMarkdown('| a | b | c |\n|---|---|---|\n| 10 | 0.5 | 100% zero-rated |');
      expect(html).not.toContain('class="zero"');
      expect(html).toContain('<td>10</td>');
      expect(html).toContain('<td>0.5</td>');
      expect(html).toContain('<td>100% zero-rated</td>');
    });

    it('RenderMarkdown_PipeTableCellIsZeroWithSurroundingWhitespace_StillMutes', () => {
      const html = renderMarkdown('| a | b |\n|---|---|\n| x |  0  |');
      expect(html).toContain('<span class="zero">0</span>');
    });

    it('RenderMarkdown_PipeTableCellIsBlank_KeepsPlainEmptyCellDistinctFromAZero', () => {
      // A blank source cell is a different state entirely - it must never be
      // muted as though it were a zero.
      const html = renderMarkdown('| a | b |\n|---|---|\n| x |  |');
      expect(html).not.toContain('class="zero"');
      expect(html).toContain('<td></td>');
    });
  });

  it('RenderMarkdown_InlineMarkup_BoldItalicCodeAndLinks', () => {
    const html = renderMarkdown('**Freedom of Information** request *quoted text* with `meta.json` and [a page](https://example.test/x).');
    expect(html).toContain('<strong>Freedom of Information</strong>');
    expect(html).toContain('<em>quoted text</em>');
    expect(html).toContain('<code>meta.json</code>');
    expect(html).toContain('<a href="https://example.test/x">a page</a>');
  });

  it('RenderMarkdown_HtmlInSource_IsEscapedNotExecuted', () => {
    const html = renderMarkdown('Angle <script>alert(1)</script> brackets & ampersands.');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp; ampersands');
  });

  it('RenderMarkdown_Lists_RenderOrderedAndUnordered', () => {
    const html = renderMarkdown('- first\n- second\n\n1. one\n2. two');
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>first</li>');
    expect(html).toContain('<ol>');
    expect(html).toContain('<li>two</li>');
  });

  it('RenderMarkdown_ListItemSoftWrapped_ContinuationFoldsIntoTheSameItem', () => {
    // Lazy continuations are the SAME sentence - severed bullets with
    // orphan <p> siblings were observed live on every docs page.
    const html = renderMarkdown('- **curated ignores**: lines a human has judged to be\n  export furniture, hand-written into meta.\n- next item.');
    expect(html).toContain('<li><strong>curated ignores</strong>: lines a human has judged to be export furniture, hand-written into meta.</li>');
    expect(html).toContain('<li>next item.</li>');
    expect(html).not.toContain('<p>export furniture');
  });

  it('RenderMarkdown_ListInsideBlockquote_RendersAsListNotSpuriousEmphasis', () => {
    // Verbatim quoted letters carry bulleted lists; joining their lines
    // paired the orphaned * markers as <em>, corrupting the quote
    // (observed live on the 596532 follow-up).
    const html = renderMarkdown('> Findings:\n>\n> * There are six records which have a blank status.\n> * There are 21 records which are six characters long (the norm is\n>   five or fewer).\n>\n> 1. First question.\n> 2. Second question.');
    expect(html).toContain('<li>There are six records which have a blank status.</li>');
    expect(html).toContain('<li>There are 21 records which are six characters long (the norm is five or fewer).</li>');
    expect(html).toContain('<ol>');
    expect(html).toContain('<li>Second question.</li>');
    expect(html).not.toContain('<em>');
    expect(html).toContain('<blockquote>');
  });

  it('RenderMarkdown_NestedSubBullets_RenderAsNestedListNotRunInProse', () => {
    const html = renderMarkdown('- **Significance** (on the record):\n  - **First point**: something\n    wrapped over lines.\n  - **Second point**: more.\n- Next top-level item.');
    expect(html).toContain('<li><strong>Significance</strong> (on the record):<ul><li><strong>First point</strong>: something wrapped over lines.</li><li><strong>Second point</strong>: more.</li></ul></li>');
    expect(html).toContain('<li>Next top-level item.</li>');
  });

  it('RenderMarkdown_CodeSpanInsideLinkText_RestoresNestedSpans', () => {
    // The placeholder scheme must survive nesting: a code span inside link
    // text leaked out as a literal " 0 " on the live dictionary page.
    const html = renderMarkdown('documented in the generated [`foi-schemas.md`](foi-schemas.md).');
    expect(html).toContain('<a href="foi-schemas.md"><code>foi-schemas.md</code></a>');
    expect(html).not.toMatch(/>\s*0\s*</);
  });

  it('RenderMarkdown_StandaloneNumbersInProse_NeverSwallowedAsPlaceholders', () => {
    // The old space-digit-space sentinel could collide with real numbers.
    const html = renderMarkdown('census `2026-06-23`: 2,763 Allocated / 61 Reserved / 2 Available - 24 rows in total.');
    expect(html).toContain('61 Reserved');
    expect(html).toContain(' 24 rows');
    expect(html).not.toContain('undefined');
  });

  it('RenderMarkdown_RelativeLinks_PreservedForSiblingEntriesAndFiles', () => {
    // Correspondence files cross-link sibling entries relatively; those
    // paths resolve identically from the rendered page's location.
    const html = renderMarkdown('see [`ofcom-285990`](../ofcom-285990--available-list-jun-2016/) and [the extract](raw-extract-letter.md).');
    expect(html).toContain('href="../ofcom-285990--available-list-jun-2016/"');
    expect(html).toContain('href="raw-extract-letter.md"');
  });

  it('RenderMarkdown_DetailsBlock_PassedThroughSoCollapsibleSectionsWork', () => {
    // The sweep's reports wrap example tables in <details>/<summary>; these are
    // passed through verbatim (not escaped to literal text), and the table
    // inside still renders. Previously the tags rendered as escaped <p>&lt;...
    const html = renderMarkdown('<details>\n<summary>Examples: whitespace</summary>\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n</details>');
    expect(html).toContain('<details>');
    expect(html).toContain('<summary>Examples: whitespace</summary>');
    expect(html).toContain('</details>');
    expect(html).not.toContain('&lt;details&gt;');
    expect(html).not.toContain('&lt;summary&gt;');
    expect(html).toContain('<td>1</td>'); // the table inside still renders
  });

  it('RenderMarkdown_CountDeltaCell_RendersBrAndSmallNotEscapedText', () => {
    // The sweep's pattern-window tables put a count and a de-emphasised delta in
    // one cell via <br><small>; these two safe tags must render, not show as
    // literal &lt;br&gt; text (which a screen reader reads out).
    const html = renderMarkdown('| pattern | a |\n|---|---|\n| `ANAAA` | 132379<br><small>-5830 (-4.2%)</small> |');
    expect(html).toContain('132379<br><small>-5830 (-4.2%)</small>');
    expect(html).not.toContain('&lt;br&gt;');
    expect(html).not.toContain('&lt;small&gt;');
    // But other markup stays escaped (no raw HTML injection through cells).
    const scriptCell = renderMarkdown('| a |\n|---|\n| <script>x</script> |');
    expect(scriptCell).toContain('&lt;script&gt;');
  });

  it('RenderMarkdown_SparklineSpanCell_RendersAriaLabelAndTitleNotEscapedText', () => {
    // The value catalogue's self-describing sparkline (issue #732): a
    // role="img" span whose aria-label/title carry the date:count pairs
    // behind the bars must survive to a live HTML attribute, including the
    // `·` mid-dot the title uses as its separator - the char the first
    // implementation attempt found the escaping allowlist silently dropped,
    // stranding the whole span as escaped text instead of a live tag.
    const span = '<span role="img" aria-label="timeline across 2 publications: 2022-05-30: 1,234; 2023-02-20: 0" title="2022-05-30: 1,234 · 2023-02-20: 0">██·</span>';
    const html = renderMarkdown(`| value | timeline |\n|---|---|\n| \`Legacy\` | ${span} |`);
    expect(html).toContain(span);
    expect(html).not.toContain('&lt;span');
    expect(html).not.toContain('&quot;');
  });

  it('RenderMarkdown_SparklineDisclosureCell_RendersDetailsNotEscapedText', () => {
    // #742: the span's title reaches a hovering mouse only. The disclosure
    // that follows it must survive to a live <details>/<summary> - reachable
    // by tap or keyboard focus + Enter/Space, no script required - carrying
    // the same date:count pairs the span's title/aria-label already carry.
    const span = '<span role="img" aria-label="timeline across 2 publications: 2022-05-30: 1,234; 2023-02-20: 0" title="2022-05-30: 1,234 · 2023-02-20: 0">██·</span>';
    const disclosure = '<details><summary>Per-publication counts</summary>2022-05-30: 1,234<br>2023-02-20: 0</details>';
    const html = renderMarkdown(`| value | timeline |\n|---|---|\n| \`Legacy\` | ${span}${disclosure} |`);
    expect(html).toContain(disclosure);
    expect(html).not.toContain('&lt;details&gt;');
    expect(html).not.toContain('&lt;summary&gt;');
  });

  it('RenderMarkdown_MalformedSparklineDisclosure_StaysEscapedAndTableIntact', () => {
    // A hand-corrupted disclosure (wrong summary text, a stray unescaped
    // bracket) must not partially unescape into live markup - the fixed
    // literal summary text is part of the match, not an open character
    // class, so anything else stays safely escaped.
    const malformed = '<details><summary>Not the expected summary</summary>2022-05-30: 1,234</details>';
    const html = renderMarkdown(`| value | timeline | note |\n|---|---|---|\n| \`Legacy\` | ${malformed} | ok |`);
    expect(html).not.toContain('<details>');
    expect(html).toContain('&lt;details&gt;');
    expect(html).toContain('<td>ok</td>');
  });

  it('RenderMarkdown_MalformedSparklineSpan_StaysEscapedAndTableIntact', () => {
    // A hand-corrupted or partially-generated span (missing the title
    // attribute, a stray unescaped `>`) must not be partially unescaped into
    // live markup that could break the table - it stays inert escaped text,
    // and neighbouring cells in the same row are unaffected.
    const malformed = '<span role="img" aria-label="broken>██·</span>';
    const html = renderMarkdown(`| value | timeline | note |\n|---|---|---|\n| \`Legacy\` | ${malformed} | ok |`);
    expect(html).not.toContain('<span role="img"');
    expect(html).toContain('&lt;span');
    expect(html).toContain('<td>ok</td>');
    const bodyRow = html.slice(html.indexOf('<tbody>'));
    expect((bodyRow.match(/<td>/g) ?? []).length).toBe(3);
  });

  it('RenderMarkdown_HtmlComment_IsSkippedNotRenderedAsText', () => {
    // The generators' "do not edit by hand" stamp lives as an HTML comment; it
    // must not render as escaped &lt;!-- text on the page (single & multi-line).
    const single = renderMarkdown('# Report\n\n<!-- Generated by the sweep; do not edit by hand. -->\n\nBody.');
    expect(single).toContain('<h1 id="report">Report</h1>');
    expect(single).toContain('<p>Body.</p>');
    expect(single).not.toContain('do not edit');
    expect(single).not.toContain('&lt;!--');
    const multi = renderMarkdown('<!--\nmulti\nline\n-->\nAfter.');
    expect(multi).not.toContain('multi');
    expect(multi).toContain('<p>After.</p>');
  });

  it('RenderMarkdown_Table_WrappedInHorizontalScrollContainer', () => {
    // Wide report tables scroll within their own box, not the page body.
    const html = renderMarkdown('| a | b |\n|---|---|\n| 1 | 2 |');
    expect(html).toContain('<div style="overflow-x:auto">');
    expect(html).toMatch(/<div style="overflow-x:auto">\s*<table>/);
    expect(html).toContain('</table>\n</div>');
  });

  // In-page anchor links (issue #701): the target-only link recognition
  // previously matched only https?://, ./../ paths and known file extensions,
  // so a [text](#fragment) fell through to literal bracket text. Every
  // heading also gets a GitHub-style slug id, giving those anchors somewhere
  // to land; the internal-link crawl (src/ci/internal-link-crawl.test.ts)
  // fails the build on a fragment with no matching id.
  describe('In-page anchor links (issue #701)', { tags: ['unit'] }, () => {
    it('RenderMarkdown_HeadingFollowedByInPageAnchorLink_LinkRendersNotLiteralBrackets', () => {
      const html = renderMarkdown('## The UK model\n\nSee [the UK section](#the-uk-model) for detail.');
      expect(html).toContain('<h2 id="the-uk-model">The UK model</h2>');
      expect(html).toContain('<a href="#the-uk-model">the UK section</a>');
      expect(html).not.toContain('[the UK section]');
    });

    it('RenderMarkdown_HeadingWithPunctuationAndDash_SlugifiesToGithubStyleId', () => {
      const html = renderMarkdown('## France — ANFR');
      expect(html).toContain('<h2 id="france-anfr">France — ANFR</h2>');
    });

    it('RenderMarkdown_HeadingWithColonAndComma_StripsPunctuationFromId', () => {
      const html = renderMarkdown('# The six twins: one callsign, two register rows');
      expect(html).toContain('id="the-six-twins-one-callsign-two-register-rows"');
    });

    it('RenderMarkdown_RepeatedHeadingText_GetsUniqueSuffixedIds', () => {
      const html = renderMarkdown('## Summary\n\nFirst.\n\n## Summary\n\nSecond.');
      expect(html).toContain('<h2 id="summary">Summary</h2>');
      expect(html).toContain('<h2 id="summary-1">Summary</h2>');
    });

    it('RenderMarkdown_HeadingThatSlugifiesToNothing_FallsBackToSectionId', () => {
      // A heading of pure punctuation (no letters/digits survive stripping).
      const html = renderMarkdown('## ???');
      expect(html).toContain('<h2 id="section">???</h2>');
    });

    it('RenderMarkdown_BareHashLink_RendersAsAnchorNotLiteralBrackets', () => {
      // The empty-fragment / bare-'#' facet-trigger idiom used elsewhere on the
      // site (src/ci/internal-link-crawl.ts classifies it 'dynamic', out of
      // crawl scope) must still render as a link, not fall through to text.
      const html = renderMarkdown('[jump](#)');
      expect(html).toContain('<a href="#">jump</a>');
      expect(html).not.toContain('[jump]');
    });

    it('RenderMarkdown_FragmentWithNumbersAndHyphens_RendersVerbatimRegardlessOfTargetExistence', () => {
      // The renderer only recognises the link shape; whether the fragment
      // resolves to a real id on the page is the crawl's job, not the
      // renderer's - so an unusual-looking but well-formed fragment still
      // renders as a link.
      const html = renderMarkdown('[step two](#step-2.1_alt)');
      expect(html).toContain('<a href="#step-2.1_alt">step two</a>');
    });

    it('RenderMarkdown_AnchorLinkAlongsideOtherLinkStyles_AllRenderInTheSameParagraph', () => {
      // Non-happy-adjacent: an anchor beside a file link and an https:// link
      // in the same sentence must not interfere with one another.
      const html = renderMarkdown('See [overview](#overview), [the source](data.csv) or [the spec](https://example.test/spec).');
      expect(html).toContain('<a href="#overview">overview</a>');
      expect(html).toContain('<a href="data.csv">the source</a>');
      expect(html).toContain('<a href="https://example.test/spec">the spec</a>');
    });
  });
});
