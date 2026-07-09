import { describe, it, expect } from 'vitest';
import { renderMarkdown } from './render-markdown.ts';

// Test names follow Subject_Scenario_Outcome per project convention.
//
// The minimal markdown renderer serves the dataset pages' browsing views of
// correspondence.md and raw-extract transcription files. It covers the
// archive's own markdown subset; unknown constructs degrade to escaped
// text - the verbatim .md remains the record.

describe('Markdown renderer', () => {
  it('RenderMarkdown_HeadingsRulesAndParagraphs_ProduceStructuralHtml', () => {
    const html = renderMarkdown('# Title\n\nSome text\nover two lines.\n\n---\n\n## Section');
    expect(html).toContain('<h1>Title</h1>');
    // Soft-wrapped source lines flow as one sentence - never a hard break.
    expect(html).toContain('<p>Some text over two lines.</p>');
    expect(html).toContain('<hr>');
    expect(html).toContain('<h2>Section</h2>');
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

  it('RenderMarkdown_Table_WrappedInHorizontalScrollContainer', () => {
    // Wide report tables scroll within their own box, not the page body.
    const html = renderMarkdown('| a | b |\n|---|---|\n| 1 | 2 |');
    expect(html).toContain('<div style="overflow-x:auto">');
    expect(html).toMatch(/<div style="overflow-x:auto">\s*<table>/);
    expect(html).toContain('</table>\n</div>');
  });
});
