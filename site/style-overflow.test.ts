import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Narrow-viewport overflow guards (issues #793/#794): a visitor on a
// phone-width screen should never see a page scroll sideways, whether from a
// long unbroken inline code token forcing the page itself wider (#794), or
// from a wide table/pre inside a properly-clipped .overflow container still
// managing to widen the DOCUMENT's own scrollable region (#793 - confirmed
// live on data-status.html: the .overflow box itself rendered at the right
// width and clipped its own paint, yet document.documentElement.scrollWidth
// still reported the excess). jsdom does not lay out CSS, so the true "does
// the page overflow" scenario is verified with a real browser at build time
// (see the PR evidence); this guard instead pins the CSS contract so a future
// edit that drops the containment fails here rather than shipping a silent
// regression.
const STYLE_CSS = fs.readFileSync(path.join('site', 'style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const LEDGER_CSS = fs.readFileSync(path.join('site', 'ledger.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

// Matches a bare rule body for the given selector, ignoring any longer
// selector this one is a prefix of (so `.overflow` does not also match a
// hypothetical `.overflow-x` or `.overflow .foo`).
function ruleBody(css: string, selector: string, cssLabel: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(?:^|[,}])\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  if (!m) throw new Error(`${cssLabel}: no rule found for selector "${selector}"`);
  return m[1] ?? '';
}

describe('Wide-table containment guards (issue #793)', { tags: ['unit'] }, () => {
  it('OverflowContainer_InStyleCss_CarriesLayoutContainment', () => {
    // overflow-x:auto alone clips the wide child's paint; contain:layout is
    // what stops that child's intrinsic size from also widening the document
    // itself (the specific #793 defect - reproduced on the hand-authored
    // pages that load style.css directly, e.g. data-status.html).
    const body = ruleBody(STYLE_CSS, '.overflow', 'style.css');
    expect(body).toMatch(/overflow-x:\s*auto/);
    expect(body).toMatch(/contain:\s*layout/);
  });

  it('OverflowContainer_InLedgerCss_CarriesLayoutContainment', () => {
    // Every generated page (dataset/entry/narrative/publisher pages) loads
    // ledger.css instead of style.css, so the same containment is needed here
    // independently - this is the rule the data-status page's #ds-grid table
    // actually renders under.
    const body = ruleBody(LEDGER_CSS, '.ledger .overflow', 'ledger.css');
    expect(body).toMatch(/overflow-x:\s*auto/);
    expect(body).toMatch(/contain:\s*layout/);
  });

  it('DamageCatalogueWrap_InLedgerCss_CarriesLayoutContainment', () => {
    // The damage catalogue's wide table uses its own wrapper class rather
    // than .overflow, but it is the same overflow-x:auto-only shape that
    // caused #793, so it needs the same fix.
    const body = ruleBody(LEDGER_CSS, '.ledger .dmg-wrap', 'ledger.css');
    expect(body).toMatch(/overflow-x:\s*auto/);
    expect(body).toMatch(/contain:\s*layout/);
  });

  it('FencedCodeBlock_InLedgerCss_ScrollsSidewaysRatherThanWrappingOrOverflowingThePage', () => {
    // A fenced ```-delimited code block (renderMarkdown's <pre><code> output)
    // carries meaningful line breaks and indentation that must survive
    // verbatim, so it gets its own horizontal scroll (matching the wide-table
    // convention above) rather than the inline-code wrap treatment below.
    const preBody = ruleBody(LEDGER_CSS, '.ledger pre', 'ledger.css');
    expect(preBody).toMatch(/overflow-x:\s*auto/);
    expect(preBody).toMatch(/contain:\s*layout/);
  });
});

describe('Unbroken inline-code overflow guards (issue #794)', { tags: ['unit'] }, () => {
  it('InlineCode_InStyleCss_WrapsALongUnbrokenToken', () => {
    // A long unbroken token (a regex, a file path) has no spaces to wrap on;
    // without overflow-wrap it forces the whole page wider than the viewport
    // at narrow widths instead of breaking within its own line.
    expect(ruleBody(STYLE_CSS, 'code, .mono', 'style.css')).toMatch(/overflow-wrap:\s*anywhere/);
  });

  it('InlineCode_InLedgerCss_WrapsALongUnbrokenToken', () => {
    // Reproduced live on reports/narratives/the-six-twins.html, which loads
    // ledger.css (not style.css) via the generated-page shell.
    expect(ruleBody(LEDGER_CSS, '.ledger code', 'ledger.css')).toMatch(/overflow-wrap:\s*anywhere/);
  });

  it('InlineCode_InsideAFencedBlock_KeepsItsVerbatimFormattingRatherThanWrapping', () => {
    // Once a code block scrolls in its own box (the guard above), its inline
    // <code> must NOT also try to wrap - that would fight the pre's
    // white-space:pre and could reflow indentation-sensitive text.
    const body = ruleBody(LEDGER_CSS, '.ledger pre code', 'ledger.css');
    expect(body).toMatch(/overflow-wrap:\s*normal/);
    expect(body).toMatch(/white-space:\s*pre/);
  });
});
