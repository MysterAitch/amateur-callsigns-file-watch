import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { chooseExamples, sliceObservations, buildFidelityPage } from './build-fidelity-page.ts';
import { loadReferenceData } from '../sources/ofcom-amateur/components.ts';
import type { SourceObservationSet } from '../v2/claim.ts';

// The fidelity & integrity deep-dive page (issue #438): the page the inline
// nudges land on, carrying the flag registry with per-flag anchors, the
// provenance/custody explanation, and — the ADR 0017 payoff — REAL derived
// claims from the latest publication rendered through the shared
// "show the working" disclosure. The fixture describes pin the deterministic
// example-selection and row-slicing rules; the real-archive describe builds
// the actual page and asserts the end-to-end wiring.

const REF = loadReferenceData();

// A synthetic register slice: a messy token needing cleaning, a plain row with
// a product cell, and a forbidden-suffix row (ASS is on the ever-forbidden
// union), so every example kind has a first-in-file-order candidate.
function syntheticSource(): SourceObservationSet {
  return {
    sourceFile: 'synthetic/fidelity-fixture.csv',
    vintage: '2026-01-01',
    columns: ['Call Sign', 'Product'],
    subjectColumn: 'Call Sign',
    categoryColumn: 'Product',
    repoPath: 'archive/synthetic/fidelity-fixture.csv',
    lineNumbers: [2, 3, 4, 5],
    rows: [
      { 'Call Sign': 'M7ABC', 'Product': '' },
      { 'Call Sign': 'm7tee', 'Product': 'Amateur Foundation Radio Licence' },
      { 'Call Sign': 'M0ASS', 'Product': '' },
      { 'Call Sign': 'M7XYZ', 'Product': 'Amateur Full Radio Licence' },
    ],
  };
}

describe('worked-example selection is deterministic and honest', { tags: ['unit'] }, () => {
  it('ChooseExamples_MixedSource_PicksTheFirstRowOfEachKindInFileOrder', () => {
    const examples = chooseExamples(syntheticSource(), REF);
    const byKind = new Map(examples.map(e => [e.kind, e.ordinal]));
    // m7tee (ordinal 1) is the first token that NEEDS cleaning; it also carries
    // the first resolvable product cell; M0ASS (ordinal 2) the first
    // forbidden-union suffix.
    expect(byKind.get('cleaned-callsign')).toBe(1);
    expect(byKind.get('licence-category')).toBe(1);
    expect(byKind.get('forbidden-suffix-flag')).toBe(2);
  });

  it('ChooseExamples_AlreadyCleanSource_FallsBackToTheFirstRowForTheCleanedExample', () => {
    const source = { ...syntheticSource(), rows: [{ 'Call Sign': 'M7ABC', 'Product': '' }], lineNumbers: [2] };
    const examples = chooseExamples(source, REF);
    // An honest "no change" working is still a working; the example is not
    // dropped just because the source is tidy.
    expect(examples.find(e => e.kind === 'cleaned-callsign')?.ordinal).toBe(0);
  });

  it('ChooseExamples_SourceWithoutAProductColumn_OmitsTheLicenceCategoryExampleRatherThanFabricating', () => {
    const source: SourceObservationSet = { ...syntheticSource(), categoryColumn: undefined };
    const examples = chooseExamples(source, REF);
    expect(examples.some(e => e.kind === 'licence-category')).toBe(false);
    // The other examples are unaffected.
    expect(examples.some(e => e.kind === 'cleaned-callsign')).toBe(true);
  });

  it('ChooseExamples_NoForbiddenSuffixInTheSource_OmitsThatExample', () => {
    const source = { ...syntheticSource(), rows: [{ 'Call Sign': 'M7ABC', 'Product': '' }], lineNumbers: [2] };
    const examples = chooseExamples(source, REF);
    expect(examples.some(e => e.kind === 'forbidden-suffix-flag')).toBe(false);
  });

  it('ChooseExamples_BlankSubjectRows_AreNeverSelected', () => {
    const source = { ...syntheticSource(), rows: [{ 'Call Sign': '', 'Product': 'Amateur Full Radio Licence' }], lineNumbers: [2] };
    expect(chooseExamples(source, REF)).toEqual([]);
  });
});

describe('row slicing keeps source positions with their rows', { tags: ['unit'] }, () => {
  it('SliceObservations_SubsetOfRows_KeepsEachRowsPhysicalLineNumber', () => {
    const { slice, sliceOrdinalOf } = sliceObservations(syntheticSource(), [2, 0]);
    // Ordinals renumber inside the slice (they are an internal join key)...
    expect(sliceOrdinalOf.get(0)).toBe(0);
    expect(sliceOrdinalOf.get(2)).toBe(1);
    // ...but each row keeps its TRUE physical line, so a permalink built from
    // the slice still points at the real file position.
    expect(slice.rows.map(r => r['Call Sign'])).toEqual(['M7ABC', 'M0ASS']);
    expect(slice.lineNumbers).toEqual([2, 4]);
  });

  it('SliceObservations_DuplicateOrdinals_CollapseToOneRow', () => {
    const { slice } = sliceObservations(syntheticSource(), [1, 1, 1]);
    expect(slice.rows).toHaveLength(1);
  });

  it('SliceObservations_SourceWithoutLineNumbers_StaysHonestlyPositionless', () => {
    const source: SourceObservationSet = { ...syntheticSource(), lineNumbers: undefined };
    const { slice } = sliceObservations(source, [0]);
    // No positions in -> no positions out: the render layer then shows "no
    // source line recorded" rather than a fabricated link.
    expect(slice.lineNumbers).toBeUndefined();
  });
});

describe('the built fidelity page over the real archive', { tags: ['data-validity'] }, () => {
  let outputDir: string;
  let page: string;

  beforeAll(() => {
    outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fidelity-page-'));
    buildFidelityPage(outputDir, 'https://example.test/site');
    page = fs.readFileSync(path.join(outputDir, 'fidelity.html'), 'utf8');
  }, 120_000);

  afterAll(() => {
    fs.rmSync(outputDir, { recursive: true, force: true });
  });

  it('FidelityPage_WhenBuilt_CarriesEveryDeclaredSectionAnchor', () => {
    for (const anchor of ['about', 'provenance', 'flags', 'consistency', 'divergence', 'show-working', 'reconstruction', 'reverify', 'reporting']) {
      expect(page, anchor).toContain(`id="${anchor}"`);
    }
  });

  it('FidelityPage_DivergenceSection_ListsTheMigratedKnownCaseFlaggedNotAdjudicated', () => {
    // The 2020-03-26 case: Ofcom's two copies of one disclosure, the differing
    // copy held in full, the eleven mangled cells summarised — an observation,
    // both copies held for the reader to compare, never a verdict.
    expect(page).toContain('id="divergence"');
    expect(page).toContain('amateur-radio-allocated-call-signs.xlsx');
    expect(page).toContain('date serials');
    expect(page).toMatch(/never adjudicated|does not.*verdict|not.*adjudicate/i);
  });

  it('FidelityPage_FlagRegistry_GivesEveryRegisteredFlagItsOwnAnchoredRow', () => {
    // The per-record nudges deep-link #flag-<name>; every registered flag must
    // therefore have an anchored row here (the crawl test enforces the reverse).
    expect(page).toContain('id="flag-forbidden-suffix"');
    expect(page).toContain('id="flag-excel-date-shape"');
    expect(page).toContain('id="flag-stripped-collision"');
  });

  it('FidelityPage_ShowWorkingExamples_RenderRealDerivedClaimsWithPinnedPermalinks', () => {
    // The ADR 0017 P4 payoff, end to end: real claims from the newest
    // publication, each with the JS-free disclosure and a pinned GitHub
    // permalink into the archived source file.
    expect(page).toContain('<details class="show-working">');
    expect(page).toMatch(/blob\/[0-9a-f]{40}\/archive\/\d{4}-\d{2}-\d{2}\//);
    // The reproduced-result line proves the working reproduces the claim.
    expect(page).toContain('Reproduces: <code>');
  });

  it('FidelityPage_Epistemics_KeepTheStandingCaveatsAndNonAccusatoryFraming', () => {
    expect(page).toContain('declared, not verified');
    expect(page).toContain('never a verdict');
    expect(page).toContain('absence is not evidence');
  });

  it('FidelityPage_Tables_CarryCaptionsAndScopedHeaders', () => {
    // The site-wide self-evidence contract applies here too.
    expect(page).toContain('<caption');
    expect(page).not.toMatch(/<th(?![a-z])(?![^>]*scope=)/);
  });

  it('FidelityPage_FlagThatFiredInLatestPublication_LinksNameAndCountToTheFilteredBrowseView', () => {
    // A reader must be able to go straight from "N rows carry <flag>" to those
    // rows. Both the flag name and its count deep-link into the browse app,
    // pre-filtered to that flag (?flags=<flag>), and the link's accessible name
    // describes the population it lands on rather than leaving a bare number or
    // glyph. rsl-in-register fires in the newest real publication, so its row
    // must carry the link.
    const row = page.match(/<tr id="flag-rsl-in-register">[\s\S]*?<\/tr>/)?.[0];
    expect(row, 'rsl-in-register row present').toBeTruthy();
    const flagRow = row ?? '';
    // Two links (name + count), both to the same pre-filtered view.
    expect((flagRow.match(/href="index\.html\?flags=rsl-in-register"/g) ?? []).length).toBe(2);
    // The flag keeps its <code> styling inside the link.
    expect(flagRow).toMatch(/<a href="index\.html\?flags=rsl-in-register"[^>]*><code>rsl-in-register<\/code><\/a>/);
    // Descriptive accessible name naming the flag and its population.
    expect(flagRow).toMatch(/aria-label="browse the [\d,]+ rows? carrying the rsl-in-register flag in the [^"]+ publication"/);
  });

  it('FidelityPage_FlagThatDidNotFireInLatestPublication_StaysInertWithNoEmptyFilterLink', () => {
    // A "none" row has no rows to browse, so it must not link into an
    // honestly-empty (and misleading) filtered search. excel-date-shape is a
    // markdown/xlsx-only flag that does not fire in the newest open-data CSV
    // publication, so its row shows "none" and carries no ?flags= link.
    const row = page.match(/<tr id="flag-excel-date-shape">[\s\S]*?<\/tr>/)?.[0] ?? '';
    expect(row, 'excel-date-shape row present').toBeTruthy();
    expect(row).toContain('<span class="gap">none</span>');
    expect(row).not.toContain('?flags=excel-date-shape');
    expect(row).not.toContain('<a ');
  });

  it('FidelityPage_ConsistencySection_LinksTheSixTwinsNarrative', () => {
    // Issue #657's second proposed back-link: the within-table consistency
    // section points at the narrative that walks a real conflict end to end
    // (the ledger keeps both rows rather than picking a winner, the same
    // "review candidate, never auto-corrected" register as this section).
    expect(page).toContain('href="reports/narratives/the-six-twins.html"');
  });
});
