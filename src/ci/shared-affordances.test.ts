import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildClassPages } from './build-class-pages.ts';
import { setAsideLinesSection } from './build-dataset-pages.ts';
import { datasetLabel, callsignPill, escapeHtml, exploreDeepLink } from './site-render.ts';

// Shared affordance layer (issues #310 / #328). The site renders callsigns and
// dataset identifiers on many surfaces; the value of the shared components is
// only realised if those surfaces actually route THROUGH them rather than
// hand-rolling equivalent markup. These guards assert two things: the shared
// components emit well-formed output, and representative generated surfaces
// carry that output (not an ad-hoc equivalent). A future edit that reintroduces
// a bespoke dataset label or a bare callsign anchor then fails CI rather than
// letting the affordances silently drift back apart.

const CI_DIR = import.meta.dirname;

// The generators that own a surface rendering callsigns or dataset labels. The
// register-lookup URL and the dataset-label markup are constructed once, in the
// shared components; a caller that rebuilds either by hand is drift.
const OWNING_GENERATORS = [
  'build-forbidden-section.ts',
  'build-dataset-pages.ts',
  'build-class-pages.ts',
  'build-data-status.ts',
  'build-home-aggregates.ts',
];

describe('datasetLabel component (issue #328)', { tags: ['unit'] }, () => {
  it('DatasetLabel_WithHref_LeadsWithHumanNameAndFollowsWithRawKey', () => {
    const html = datasetLabel('Publication of 23 June 2026', 'ofcom-2026-06-23--call-sign-list', { href: 'open-data/x/index.html' });
    // The human name reads first, linked to the dataset's detail page.
    expect(html).toContain('<a href="open-data/x/index.html">Publication of 23 June 2026</a>');
    // The raw archive key follows as a secondary monospace identifier.
    expect(html).toContain('<span class="dstitle"><span class="mono">ofcom-2026-06-23--call-sign-list</span></span>');
    // Name comes before key (name primary, key secondary).
    expect(html.indexOf('Publication of')).toBeLessThan(html.indexOf('dstitle'));
  });

  it('DatasetLabel_WithoutHref_StillNamesTheDatasetAndKeyAsPlainText', () => {
    const html = datasetLabel('An undated record', 'some-key');
    expect(html).not.toContain('<a ');
    expect(html).toContain('An undated record');
    expect(html).toContain('<span class="dstitle"><span class="mono">some-key</span></span>');
  });

  it('DatasetLabel_ByDefault_EscapesNameAndKeyAgainstInjection', () => {
    const html = datasetLabel('Name <b>x</b>', 'key&"<>', { href: 'h' });
    expect(html).toContain(escapeHtml('Name <b>x</b>'));
    expect(html).toContain(escapeHtml('key&"<>'));
    expect(html).not.toContain('<b>x</b>');
  });

  it('DatasetLabel_Trailing_SlotsCallerMarkupBetweenNameAndKey', () => {
    const html = datasetLabel('Name', 'key', { href: 'h', trailing: ' <span class="muted">(also X)</span>' });
    expect(html).toBe('<a href="h">Name</a> <span class="muted">(also X)</span><span class="dstitle"><span class="mono">key</span></span>');
  });
});

// The Explore-console deep link (issue #333): a report reference that describes
// a SPECIFIC filtered view should send the reader to exactly that pre-filtered
// query in the interactive console, not the empty tool they must re-filter. The
// helper builds the ?db=/?sql= link the console (site/explore.js) reads on load;
// these guards pin the round-trip so a generated href always decodes back to the
// exact database and query — the "lands on the RIGHT set" contract.
describe('exploreDeepLink component (issue #333)', { tags: ['unit'] }, () => {
  it('ExploreDeepLink_WithDbAndQuery_BuildsAConsoleUrlThatDecodesBackToThem', () => {
    const sql = "SELECT * FROM register_history WHERE dataset = '2026-06-23' ORDER BY callsign";
    const href = exploreDeepLink('../../../', 'combined', sql);
    // The console lives at the caller's relative depth and carries both params.
    expect(href.startsWith('../../../explore.html?')).toBe(true);
    // The params are joined with the HTML entity so the href is valid inside a
    // double-quoted attribute (the site-wide convention for hand-authored links).
    expect(href).toContain('&amp;');
    // Parsing the href the way the browser (and explore.js) does recovers the
    // EXACT database and query — so the link lands on precisely the described set.
    const params = new URLSearchParams(href.split('?')[1].replace(/&amp;/g, '&'));
    expect(params.get('db')).toBe('combined');
    expect(params.get('sql')).toBe(sql);
  });

  it('ExploreDeepLink_QueryWithSpacesAndOperators_IsPercentEncodedNotRawInTheHref', () => {
    // A raw space or & in the query would break the attribute or the param
    // boundary; the encoded href must still round-trip to the original query.
    const sql = "SELECT * FROM t WHERE a = 'x' AND b = 'y'";
    const href = exploreDeepLink('', 'latest', sql);
    expect(href).not.toContain('sql=SELECT *'); // spaces encoded, never literal
    const params = new URLSearchParams(href.split('?')[1].replace(/&amp;/g, '&'));
    expect(params.get('db')).toBe('latest');
    expect(params.get('sql')).toBe(sql);
  });
});

describe('callsignPill component (issue #310)', { tags: ['unit'] }, () => {
  it('CallsignPill_Always_RendersAWellFormedLookupLinkAsAPill', () => {
    const pill = callsignPill('M7TEE', 3);
    expect(pill).toBe('<a class="cs callsign-pill" href="../../../index.html?c=M7TEE">M7TEE</a>');
  });

  it('CallsignPill_EncodesTheCallsignInTheLookupHref', () => {
    // A callsign with a slash (a visitor form) must be URL-encoded, not break
    // the href — a well-formedness guard on the shared link.
    const pill = callsignPill('M/DL1ABC', 1);
    expect(pill).toContain('index.html?c=M%2FDL1ABC');
  });
});

// The register-lookup URL lives in callsignPill alone; no owning generator may
// hand-roll a `?c=` anchor. This is the anti-drift guard: a bespoke callsign
// link reintroduced in any of these generators fails here.
describe('callsign rendering routes through the shared pill (issue #310)', { tags: ['unit'] }, () => {
  it('OwningGenerators_RenderCallsigns_OnlyViaTheSharedPillNotAdHocAnchors', () => {
    for (const file of OWNING_GENERATORS) {
      const src = fs.readFileSync(path.join(CI_DIR, file), 'utf8');
      expect(src.includes('index.html?c='), `${file} builds a register-lookup href by hand; render callsigns via the shared callsign field wrapper (callsignField/callsignPill) instead`).toBe(false);
    }
  });
});

// Set-aside (ignored) raw-line affordance (issue #331). Lines a normalisation
// deliberately set aside (the curated ignoredLines vocabulary) must read as
// "intentionally excluded, not lost" at a glance wherever the lines themselves
// are displayed: a pale amber row tint PLUS a textual "set aside" badge, so
// colour is never the sole indicator (WCAG 1.4.1).
describe('setAsideLinesSection component (issue #331)', { tags: ['unit'] }, () => {
  const CURATED = [
    { line: 151154, content: 'Call Sign List for Open Data,,', reason: 'export footer furniture, not a register assertion (curated)' },
    { line: 151155, content: 'Ofcom,,', reason: 'export footer furniture, not a register assertion (curated)' },
  ];

  it('SetAsideLines_WithCuratedIgnoredLines_RendersTintClassAndTextBadgePerRow', () => {
    const html = setAsideLinesSection(CURATED, 3);
    // Every set-aside line is one row carrying the affordance class (the amber
    // tint hook) — and only those rows.
    expect(html.match(/<tr class="set-aside">/g)?.length).toBe(2);
    // The non-colour indicator: a visible textual badge on each row, so the
    // meaning survives greyscale, forced-colours and colour-blindness.
    expect(html.match(/<span class="tb setaside">set aside<\/span>/g)?.length).toBe(2);
    // The verbatim content and the curated reason are both shown.
    expect(html).toContain('<code>Call Sign List for Open Data,,</code>');
    expect(html).toContain('export footer furniture, not a register assertion (curated)');
    // Self-evident table contract (#334): caption + scoped headers.
    expect(html).toContain('<caption class="table-caption">');
    expect(html).toMatch(/<th scope="col">/);
    expect(html).toMatch(/<th scope="row"/);
    // The count reads in the always-visible summary, with the enumeration one
    // JS-free <details> click away.
    expect(html).toMatch(/<summary>2 raw lines set aside as non-data[^<]*<\/summary>/);
    // The term links to its glossary explanation at the entry-page depth.
    expect(html).toContain('glossary.html#ignored-line');
  });

  it('SetAsideLines_NoIgnoredLines_EmitsNothing', () => {
    // The ~always case: a publication with no curated ignores carries no
    // affordance markup at all — nothing that could read as a data caveat.
    expect(setAsideLinesSection([], 3)).toBe('');
  });

  it('SetAsideLines_BlankLineContent_IsHumanisedNotAnEmptyCell', () => {
    // A blank source line is itself information; never render an empty cell.
    const html = setAsideLinesSection([{ line: 6, content: '', reason: 'blank' }], 3);
    expect(html).toContain('(blank line)');
    expect(html).not.toContain('<code></code>');
  });

  it('SetAsideLines_ContentWithMarkup_IsEscapedAgainstInjection', () => {
    const html = setAsideLinesSection([{ line: 2, content: '<b>&"x</b>', reason: 'r <i>y</i>' }], 3);
    expect(html).toContain(escapeHtml('<b>&"x</b>'));
    expect(html).not.toContain('<b>&');
    expect(html).not.toContain('<i>y</i>');
  });

  it('SetAsideLines_SingleLine_ReadsSingularInTheSummary', () => {
    const html = setAsideLinesSection([{ line: 4, content: 'footer,,', reason: 'furniture' }], 3);
    expect(html).toMatch(/<summary>1 raw line set aside as non-data/);
  });

  it('LedgerStylesheet_SetAsideAffordance_IsStyledWithThemeMappedSignalTokens', () => {
    // The tint and badge live in site/ledger.css under `.ledger`, drawn from
    // the signal (amber) token pair — which the stylesheet maps for BOTH the
    // light and dark themes — never a raw hex only one theme can carry.
    const css = fs.readFileSync(path.join(CI_DIR, '..', '..', 'site', 'ledger.css'), 'utf8');
    const tintRule = /\.ledger tr\.set-aside[^{]*\{[^}]*var\(--signal-soft\)[^}]*\}/;
    expect(css).toMatch(tintRule);
    expect(css).toContain('.tb.setaside');
  });
});

describe('dataset identifiers route through the shared label on generated surfaces (issues #328 / #310)', { tags: ['unit'] }, () => {
  let classIndex: string;
  let classPage: string;

  beforeAll(() => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-affordances-'));
    try {
      buildClassPages(outputDir, 'https://example.test/site');
      classIndex = fs.readFileSync(path.join(outputDir, 'datasets', 'classes', 'index.html'), 'utf8');
      classPage = fs.readFileSync(path.join(outputDir, 'datasets', 'classes', 'register-snapshot.html'), 'utf8');
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('ClassPages_EveryDatasetRow_UsesTheSharedLabelMarkup', () => {
    // A class page lists every dataset carrying the class, one dataset per row.
    const cells = [...classPage.matchAll(/<th scope="row" class="dskey">([\s\S]*?)<\/th>/g)].map(m => m[1]);
    expect(cells.length, 'class page rendered no dataset-label row headers').toBeGreaterThan(0);
    for (const cell of cells) {
      // The shared label's shape: a linked human name, then the raw key in the
      // secondary monospace span.
      expect(cell, 'a dataset row header is not a linked name').toMatch(/^<a href="[^"]+">/);
      expect(cell, 'a dataset row header has no secondary key').toContain('<span class="dstitle"><span class="mono">');
    }
  });

  it('ClassPages_DatasetRows_DoNotUseTheOldAdHocNameKeyMarkup', () => {
    // The pre-refactor markup put the key in a bare <br><code>…</code>; its
    // absence confirms the surface migrated to the shared component.
    for (const html of [classIndex, classPage]) {
      expect(html).not.toMatch(/<\/a><br><code>[^<]+<\/code><\/th>/);
    }
  });
});
