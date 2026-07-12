import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildClassPages } from './build-class-pages.ts';
import { tableCaption, escapeHtml } from './site-render.ts';

// Table self-evidence contract (issues #334 / #397). A data table is
// self-evident when a reader — sighted or using assistive tech — can tell what
// the table is, what each column means, and where a cell leads, without
// hunting the surrounding prose. These guards assert those properties on
// representative generated and hand-authored tables so a future edit that
// drops a caption, an unscoped header, or turns a linked identifier back into
// dead text fails CI rather than shipping a table a reader has to decode.
//
// The dataset-class section is built from directory listings and meta.json
// only (no multi-hundred-thousand-row CSV parse), so it exercises the shared
// caption/scoped-header/glossary table rendering in real generated output
// cheaply — the same tables the dataset index and class pages ship.

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const SITE_DIR = path.join(REPO_ROOT, 'site');

// Every id="…" in the shipped glossary is a valid deep-link target — the same
// source of truth the glossary-link integrity guard uses.
function glossaryIds(): Set<string> {
  const html = fs.readFileSync(path.join(SITE_DIR, 'glossary.html'), 'utf8');
  const ids = new Set<string>();
  for (const m of html.matchAll(/\bid="([^"]+)"/g)) ids.add(m[1]);
  return ids;
}
const VALID_IDS = glossaryIds();

// Split an HTML blob into its <table>…</table> spans (non-greedy, one table
// per match) so each can be checked in isolation.
function tables(html: string): string[] {
  return [...html.matchAll(/<table[\s>][\s\S]*?<\/table>/g)].map(m => m[0]);
}

// The glossary anchor fragments that appear inside a table's header cells (a
// <th> that wraps the shared gloss-term affordance).
function headerGlossaryFragments(table: string): string[] {
  const fragments: string[] = [];
  for (const th of table.matchAll(/<th[\s>][\s\S]*?<\/th>/g)) {
    for (const m of th[0].matchAll(/glossary\.html#([A-Za-z0-9-]+)/g)) fragments.push(m[1]);
  }
  return fragments;
}

describe('tableCaption helper (issue #334)', () => {
  it('TableCaption_ByDefault_EscapesTextAndTagsForStyling', () => {
    expect(tableCaption('Rows & columns')).toBe('<caption class="table-caption">Rows &amp; columns</caption>');
  });

  it('TableCaption_WithEscapeFalse_KeepsCallerMarkup', () => {
    // A caption may embed a glossary-linked term, so raw markup must survive
    // when the caller opts out of escaping.
    const inner = '<a href="#x">term</a>';
    expect(tableCaption(inner, { escape: false })).toBe(`<caption class="table-caption">${inner}</caption>`);
  });
});

describe('generated tables — self-evidence contract (issues #334 / #397)', () => {
  let classIndex: string;
  let classPage: string;

  beforeAll(() => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'table-self-evidence-'));
    try {
      buildClassPages(outputDir, 'https://example.test/site');
      classIndex = fs.readFileSync(path.join(outputDir, 'datasets', 'classes', 'index.html'), 'utf8');
      classPage = fs.readFileSync(path.join(outputDir, 'datasets', 'classes', 'register-snapshot.html'), 'utf8');
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('GeneratedTables_EveryDataTable_CarriesACaptionNamingIt', () => {
    for (const [label, html] of [['class index', () => classIndex], ['class page', () => classPage]] as const) {
      const found = tables(html());
      expect(found.length, `${label} rendered no tables`).toBeGreaterThan(0);
      for (const table of found) {
        expect(table, `a table on the ${label} has no <caption>`).toContain('<caption class="table-caption">');
      }
    }
  });

  it('GeneratedTables_EveryHeaderCell_IsScoped', () => {
    for (const html of [classIndex, classPage]) {
      for (const table of tables(html)) {
        for (const th of table.matchAll(/<th(\s[^>]*)?>/g)) {
          expect(th[1] ?? '', `a header cell is missing scope: ${th[0]}`).toMatch(/scope="(col|row|colgroup|rowgroup)"/);
        }
      }
    }
  });

  it('GeneratedTables_JargonHeaders_ResolveToRealGlossaryAnchors', () => {
    // The class tables head their vintage / class columns with the shared
    // glossary affordance; each such header must deep-link to a real id.
    const fragments = [...tables(classIndex), ...tables(classPage)].flatMap(headerGlossaryFragments);
    expect(fragments.length, 'no jargon header linked to the glossary').toBeGreaterThan(0);
    for (const fragment of fragments) {
      expect(VALID_IDS.has(fragment), `a table header links glossary.html#${fragment}, absent from glossary.html`).toBe(true);
    }
  });

  it('GeneratedTables_IdentifierColumn_LinksOutRatherThanDeadText', () => {
    // The row-header (first) cell of each listing table is the entity's
    // identifier and must link to its detail page — a reader navigates onward
    // from the table, not by hunting elsewhere.
    for (const html of [classIndex, classPage]) {
      for (const th of html.matchAll(/<th scope="row">([\s\S]*?)<\/th>/g)) {
        expect(th[1], `a row-header identifier is dead text: ${th[0]}`).toContain('<a href="');
      }
    }
  });
});

describe('hand-authored tables — self-evidence contract (issues #334 / #397)', () => {
  it('Playground_EveryDataTable_HasCaptionAndScopedHeaders', () => {
    const html = fs.readFileSync(path.join(SITE_DIR, 'playground.html'), 'utf8');
    const found = tables(html);
    expect(found.length, 'playground.html rendered no tables').toBeGreaterThan(0);
    for (const table of found) {
      expect(table, 'a playground table has no <caption>').toContain('<caption class="table-caption">');
      for (const th of table.matchAll(/<th(\s[^>]*)?>/g)) {
        expect(th[1] ?? '', `a playground header cell is missing scope: ${th[0]}`).toMatch(/scope="(col|row)"/);
      }
    }
  });

  it('Ledger_TableCaption_IsStyledForBothThemes', () => {
    // The caption must be styled (small, muted, left-aligned) under the ledger
    // visual language every page adopts, so it reads as a label not a heading.
    const css = fs.readFileSync(path.join(SITE_DIR, 'ledger.css'), 'utf8');
    expect(css).toContain('.ledger caption.table-caption');
  });
});

// Guard the helper's escaping stays wired to the shared escapeHtml, so a
// caption can never inject unescaped angle brackets by default.
describe('tableCaption escaping (issue #334)', () => {
  it('TableCaption_EscapesAngleBrackets_LikeTheSharedEscaper', () => {
    const raw = 'a < b > c';
    expect(tableCaption(raw)).toContain(escapeHtml(raw));
  });
});
