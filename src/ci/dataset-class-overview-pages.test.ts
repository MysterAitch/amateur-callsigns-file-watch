import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildClassPages } from './build-class-pages.ts';

// Test names follow Subject_Scenario_Outcome per project convention.
//
// Issue #470: each per-type page under datasets/classes/ is promoted from a bare
// definition-plus-listing into a full "dataset overview" — what the type is, the
// shape of a row, its provenance and quirks, and how it relates to the other
// types — reachable from the type index. This builds only the class section
// (like the sibling affordance/self-evidence suites) rather than the whole
// deploy artefact, so it stays a fast render check.

let outputDir: string;
let registerSnapshot: string;
let forbiddenList: string;
let referenceContext: string;
let typeIndex: string;

beforeAll(() => {
  outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'type-overview-'));
  buildClassPages(outputDir, 'https://example.test/site');
  const classesDir = path.join(outputDir, 'datasets', 'classes');
  registerSnapshot = fs.readFileSync(path.join(classesDir, 'register-snapshot.html'), 'utf8');
  forbiddenList = fs.readFileSync(path.join(classesDir, 'forbidden-list.html'), 'utf8');
  referenceContext = fs.readFileSync(path.join(classesDir, 'reference-context.html'), 'utf8');
  typeIndex = fs.readFileSync(path.join(classesDir, 'index.html'), 'utf8');
});

afterAll(() => {
  fs.rmSync(outputDir, { recursive: true, force: true });
});

describe('dataset-type overview pages (issue #470)', { tags: ['ui'] }, () => {
  it('TypeOverviewPage_RegisterSnapshot_ExplainsWhatItIsShapeProvenanceAndRelations', () => {
    // The heading is the humanised type name, with the exact vocabulary key kept
    // alongside so the code term (meta.json / validator) is never lost.
    expect(registerSnapshot).toContain('<h1>Register snapshot <small class="typekey"><code>register-snapshot</code></small></h1>');
    // The four overview movements are all present, in plain English.
    expect(registerSnapshot).toContain('<h2>What it is</h2>');
    expect(registerSnapshot).toContain('the register state at a vintage'); // definition retained
    expect(registerSnapshot).toContain('<h2>Shape of the data</h2>');
    expect(registerSnapshot).toContain('One row per callsign');
    expect(registerSnapshot).toContain('<h2>Provenance and quirks</h2>');
    expect(registerSnapshot).toContain('declared-partial export is flagged');
  });

  it('TypeOverviewPage_RegisterSnapshot_RelatesToSiblingTypesWithWorkingLinks', () => {
    expect(registerSnapshot).toContain('<h2>How it relates to other dataset types</h2>');
    // Each related type is a link to that type's own overview page (same directory).
    expect(registerSnapshot).toContain('<a href="available-pool.html">Available pool</a>');
    expect(registerSnapshot).toContain('<a href="issuance-events.html">Issuance events</a>');
    expect(registerSnapshot).toContain('<a href="attribute-addendum.html">Attribute addendum</a>');
  });

  it('TypeOverviewPage_RegisterSnapshot_GlossaryLinksJargonAndKeepsInstanceListing', () => {
    // Jargon stays one click from the glossary.
    expect(registerSnapshot).toContain('Related glossary terms:');
    expect(registerSnapshot).toContain('glossary.html#vintage');
    // The archived-entries listing is retained under its own heading.
    expect(registerSnapshot).toContain('<h2>Archived entries of this type</h2>');
    expect(registerSnapshot).toContain('href="../open-data/2026-06-23/index.html"');
    expect(registerSnapshot).toContain('<a href="index.html">All dataset types →</a>');
  });

  it('TypeOverviewPage_Any_CarriesAccessibleScaffoldingAndMarksItsNavSection', () => {
    // No-JS-readable, keyboard-first: skip link + main landmark, owning nav marked.
    expect(registerSnapshot).toContain('<a class="skip" href="#main">Skip to content</a>');
    expect(registerSnapshot).toMatch(/<main id="main"[^>]*>/);
    expect(registerSnapshot).toContain('<strong>Dataset index</strong>');
  });

  it('TypeOverviewPage_ForbiddenList_CallsOutTheDifferentSuffixRowShape', () => {
    // The forbidden-list type has a deliberately different (suffix, not callsign)
    // row shape; the overview says so and keeps the vocabulary definition.
    expect(forbiddenList).toContain('<h1>Forbidden list <small class="typekey"><code>forbidden-list</code></small></h1>');
    expect(forbiddenList).toContain('three-letter suffixes withheld from issue'); // definition
    expect(forbiddenList).toContain('three-letter suffixes — not callsigns');       // shape prose
    expect(forbiddenList).toContain('glossary.html#forbidden-suffix');
  });

  it('TypeOverviewPage_ReferenceContext_ExplainsItIsContextNotADataset', () => {
    // reference-context is not a callsign dataset; the overview must say so
    // rather than imply browsable rows.
    expect(referenceContext).toContain('<h1>Reference context <small class="typekey"><code>reference-context</code></small></h1>');
    expect(referenceContext).toContain('Not a dataset of callsigns at all');
  });

  it('TypeIndex_LinksEachTypeToItsOverviewWithHumanisedName', () => {
    // The index advertises the pages as overviews and shows each humanised name
    // alongside the exact vocabulary key (the code chip stays the link).
    expect(typeIndex).toContain('<h1>Dataset types</h1>');
    expect(typeIndex).toContain('full <b>overview</b>');
    expect(typeIndex).toContain('<a href="register-snapshot.html"><code>register-snapshot</code></a> <span class="typename">Register snapshot</span>');
    expect(typeIndex).toContain('<a href="forbidden-list.html"><code>forbidden-list</code></a> <span class="typename">Forbidden list</span>');
  });

  it('TypeOverviewPages_EveryVocabularyType_HasAReachableOverviewPage', () => {
    // Every dataset type present in the archive has an overview page linked from
    // the type index, so none is a dead end.
    for (const cls of ['register-snapshot', 'available-pool', 'issuance-events', 'forbidden-list', 'statistics-aggregate', 'attribute-addendum', 'reference-context']) {
      const page = path.join(outputDir, 'datasets', 'classes', `${cls}.html`);
      expect(fs.existsSync(page), `${cls} has no overview page`).toBe(true);
      expect(typeIndex, `type index does not link ${cls}`).toContain(`<a href="${cls}.html"><code>${cls}</code></a>`);
    }
  });
});
