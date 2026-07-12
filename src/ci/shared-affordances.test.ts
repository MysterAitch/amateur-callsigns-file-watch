import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildClassPages } from './build-class-pages.ts';
import { datasetLabel, callsignPill, escapeHtml } from './site-render.ts';

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
];

describe('datasetLabel component (issue #328)', () => {
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

describe('callsignPill component (issue #310)', () => {
  it('CallsignPill_Always_RendersAWellFormedLookupLinkAsAPill', () => {
    const pill = callsignPill('M7TEE', 3);
    expect(pill).toBe('<a class="callsign-pill" href="../../../index.html?c=M7TEE">M7TEE</a>');
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
describe('callsign rendering routes through the shared pill (issue #310)', () => {
  it('OwningGenerators_RenderCallsigns_OnlyViaTheSharedPillNotAdHocAnchors', () => {
    for (const file of OWNING_GENERATORS) {
      const src = fs.readFileSync(path.join(CI_DIR, file), 'utf8');
      expect(src.includes('index.html?c='), `${file} builds a register-lookup href by hand; render callsigns via callsignPill instead`).toBe(false);
    }
  });
});

describe('dataset identifiers route through the shared label on generated surfaces (issues #328 / #310)', () => {
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
