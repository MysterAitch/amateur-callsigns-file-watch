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

  it('RenderMarkdown_RelativeLinks_PreservedForSiblingEntriesAndFiles', () => {
    // Correspondence files cross-link sibling entries relatively; those
    // paths resolve identically from the rendered page's location.
    const html = renderMarkdown('see [`ofcom-285990`](../ofcom-285990--available-list-jun-2016/) and [the extract](raw-extract-letter.md).');
    expect(html).toContain('href="../ofcom-285990--available-list-jun-2016/"');
    expect(html).toContain('href="raw-extract-letter.md"');
  });
});
