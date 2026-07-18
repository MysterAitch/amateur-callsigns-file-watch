import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { chooseExamples, sliceObservations, buildFidelityPage, normalisationRobustnessSection } from './build-fidelity-page.ts';
import { loadReferenceData } from '../sources/ofcom-amateur/components.ts';
import { defaultFoiDir, readFoiEntryMeta } from '../shared/foi-archive.ts';
import { escapeHtml } from './site-render.ts';
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

// The normalisation-robustness worked example's failure modes (issue #823):
// the callout must fail the build loudly, never silently, when the archive
// no longer backs the claim it makes. A fixture FOI directory stands in for
// the real archive so each failure mode is exercised in isolation.
describe('normalisation-robustness worked example fails loud on a broken assumption', { tags: ['unit'] }, () => {
  const KEY_A = 'wdtk-294011--available-callsigns-list';
  const KEY_B = 'wdtk-299321--available-callsigns-list';
  const SHEET_FILES = ['normalised--sheet-1-foundation.csv', 'normalised--sheet-2-intermediate.csv', 'normalised--sheet-3-full.csv'];

  let foiDir: string;

  beforeAll(() => {
    foiDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fidelity-robustness-fixture-'));
  });

  afterAll(() => {
    fs.rmSync(foiDir, { recursive: true, force: true });
  });

  function writeEntry(key: string, files: Record<string, { sha256: string }>): void {
    const dir = path.join(foiDir, key);
    fs.mkdirSync(dir, { recursive: true });
    const decls: Record<string, unknown> = {};
    for (const [name, { sha256 }] of Object.entries(files)) {
      decls[name] = { bytes: 1, sha256, role: name.startsWith('normalised') ? 'normalised' : 'data' };
    }
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ title: `Entry ${key}`, files: decls }));
  }

  function validFileSet(rawHash: string, sheetHash = 'sheethash00000000000000000000000000000000000000000000000000'): Record<string, { sha256: string }> {
    const out: Record<string, { sha256: string }> = { 'Amateur Available Call signs.xlsx': { sha256: rawHash } };
    for (const file of SHEET_FILES) out[file] = { sha256: sheetHash };
    return out;
  }

  it('NormalisationRobustnessSection_BothEntriesWellFormed_RendersTheCalloutWithLiveHashes', () => {
    writeEntry(KEY_A, validFileSet('aaaaaaaa1111111111111111111111111111111111111111111111111111'));
    writeEntry(KEY_B, validFileSet('bbbbbbbb2222222222222222222222222222222222222222222222222222'));
    const html = normalisationRobustnessSection(foiDir).join('');
    expect(html).toContain('aaaaaaaa');
    expect(html).toContain('bbbbbbbb');
    expect(html).toContain('sheethas');
    expect(html).toContain(`datasets/foi/${KEY_A}/index.html`);
    expect(html).toContain(`datasets/foi/${KEY_B}/index.html`);
  });

  it('NormalisationRobustnessSection_OneEntryMetaJsonMissing_ThrowsLoudRatherThanRenderingAGap', () => {
    fs.rmSync(path.join(foiDir, KEY_B), { recursive: true, force: true });
    writeEntry(KEY_A, validFileSet('cccccccc3333333333333333333333333333333333333333333333333333'));
    expect(() => normalisationRobustnessSection(foiDir)).toThrow(/meta\.json not found/);
  });

  it('NormalisationRobustnessSection_OneEntryMetaJsonMalformed_ThrowsLoudNamingTheFile', () => {
    writeEntry(KEY_A, validFileSet('dddddddd4444444444444444444444444444444444444444444444444444'));
    writeEntry(KEY_B, validFileSet('eeeeeeee5555555555555555555555555555555555555555555555555555'));
    fs.writeFileSync(path.join(foiDir, KEY_B, 'meta.json'), '{ not valid json');
    expect(() => normalisationRobustnessSection(foiDir)).toThrow(/not valid JSON/);
  });

  it('NormalisationRobustnessSection_RawHashesNoLongerDiffer_ThrowsRatherThanClaimingTwoSerialisations', () => {
    const sameHash = 'ffffffff6666666666666666666666666666666666666666666666666666';
    writeEntry(KEY_A, validFileSet(sameHash));
    writeEntry(KEY_B, validFileSet(sameHash));
    expect(() => normalisationRobustnessSection(foiDir)).toThrow(/expected to differ/);
  });

  it('NormalisationRobustnessSection_NormalisedSheetsNoLongerMatch_ThrowsRatherThanClaimingConvergence', () => {
    writeEntry(KEY_A, validFileSet('11111111aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'matching-sheet-hash-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'));
    writeEntry(KEY_B, validFileSet('22222222bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'different-sheet-hash-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'));
    expect(() => normalisationRobustnessSection(foiDir)).toThrow(/expected to be byte-identical/);
  });

  it('NormalisationRobustnessSection_DeclaredFileMissingFromEntry_ThrowsNamingTheMissingFile', () => {
    writeEntry(KEY_A, { 'Amateur Available Call signs.xlsx': { sha256: 'aaaa000000000000000000000000000000000000000000000000000000aa' } });
    writeEntry(KEY_B, validFileSet('bbbb000000000000000000000000000000000000000000000000000000bb'));
    expect(() => normalisationRobustnessSection(foiDir)).toThrow(/declares no file named "normalised--sheet-1-foundation\.csv"/);
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
    for (const anchor of ['about', 'provenance', 'flags', 'consistency', 'divergence', 'normalisation-robustness', 'anomalies', 'show-working', 'reconstruction', 'reverify', 'reporting']) {
      expect(page, anchor).toContain(`id="${anchor}"`);
    }
  });

  // Issue #467's residual, review fix: the method note originally claimed a
  // flat "ten before, ten after" window, but windowFor (report-sweep.ts)
  // actually expands nearest-first only until it collects 3 declared-complete
  // neighbours per side, capped at 10 - a materially smaller window in the
  // common case. This pins the corrected wording against the real constants
  // so the copy cannot silently drift back to the inaccurate flat claim.
  it('FidelityPage_AnomaliesMethodNote_DescribesTheActualNearestFirstQuotaWindowNotAFlatTenEachSide', () => {
    expect(page).toContain('id="anomalies"');
    expect(page).toContain('3 declared-complete neighbours');
    expect(page).toContain('10 publications');
    expect(page).toMatch(/nearest.*(publication|neighbour).*working outward|working outward.*nearest/i);
    // The old, inaccurate flat-window claim must not reappear.
    expect(page).not.toMatch(/ten publications before it and the ten after/i);
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

  it('FidelityPage_NormalisationRobustnessCallout_LinksBothEntriesAndShowsHashesReadFromTheirLiveMetaJson', () => {
    // Issue #823, following #807/#822: wdtk-294011 and wdtk-299321 hold two
    // different raw .xlsx serialisations of the same 2015-10-13 disclosed
    // export that normalise to byte-identical output across all three
    // sheets. Every hash the callout shows must trace back to the same
    // meta.json files read here — never a hard-coded literal that could drift
    // if either entry is ever re-derived.
    const foiDir = defaultFoiDir();
    const keyA = 'wdtk-294011--available-callsigns-list';
    const keyB = 'wdtk-299321--available-callsigns-list';
    const metaA = readFoiEntryMeta(foiDir, keyA);
    const metaB = readFoiEntryMeta(foiDir, keyB);
    const rawFile = 'Amateur Available Call signs.xlsx';

    expect(page).toContain('id="normalisation-robustness"');
    expect(page).toContain(`href="datasets/foi/${keyA}/index.html"`);
    expect(page).toContain(`href="datasets/foi/${keyB}/index.html"`);
    expect(page).toContain(escapeHtml(metaA.title));
    expect(page).toContain(escapeHtml(metaB.title));

    // The two raw hashes genuinely differ and must both appear, read live.
    const rawHashA = metaA.files[rawFile].sha256;
    const rawHashB = metaB.files[rawFile].sha256;
    expect(rawHashA).not.toBe(rawHashB);
    expect(page).toContain(rawHashA.slice(0, 8));
    expect(page).toContain(rawHashB.slice(0, 8));

    // The three normalised sheets are byte-identical across both entries and
    // the shared hash must appear once per sheet.
    for (const file of ['normalised--sheet-1-foundation.csv', 'normalised--sheet-2-intermediate.csv', 'normalised--sheet-3-full.csv']) {
      const hashA = metaA.files[file].sha256;
      const hashB = metaB.files[file].sha256;
      expect(hashA).toBe(hashB);
      expect(page).toContain(hashA.slice(0, 8));
    }

    // Epistemics: [observed] the hash facts, [derived] the convergence claim.
    const section = page.slice(page.indexOf('id="normalisation-robustness"'), page.indexOf('id="anomalies"'));
    expect(section).toContain('class="epistemic-tag tag-observed"');
    expect(section).toContain('class="epistemic-tag tag-derived"');
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

  it('FidelityPage_ForbiddenSuffixFlagExample_LinksTheAllocatedCallsignsGeneralisationRatherThanAssertingItUnlinked', () => {
    // Issue #769: "most such callsigns are long-standing allocations that
    // predate the withholding" is this project's own derived finding, already
    // computed and shown on the forbidden-suffix section index under
    // "Forbidden, yet carrying Allocated callsigns" — so this blurb links
    // through to that analysis rather than restating it as a bare assertion.
    expect(page).toContain('<a href="forbidden/index.html#with-allocated">most such callsigns are long-standing allocations that predate the withholding</a>');
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

  it('FidelityPage_UnparseableCallsignFlag_CountsTheKnownRowsAndLinksTheParseStatusFilterAsAnObservation', () => {
    // Issue #802: the parser already classifies 10 rows in the newest real
    // publication (2026-06-23) as parse_status = unparseable, including two
    // plain-English words ("EDUCATIONAL", "ENVIRONMENTS") with a real
    // Allocated status - but that signal never reached a reader-facing
    // surface. unparseable-callsign is a flag-registry cross-reference to that
    // status (reference-data/flags.md), so it must appear here with the real
    // count and a working deep link - but the value never lives in the
    // `flags` column, so the browse app filters it via its parse-status facet
    // (?parse=unparseable), not ?flags=unparseable-callsign, which would land
    // on an honestly-empty search.
    const row = page.match(/<tr id="flag-unparseable-callsign">[\s\S]*?<\/tr>/)?.[0];
    expect(row, 'unparseable-callsign row present').toBeTruthy();
    const flagRow = row ?? '';
    expect((flagRow.match(/href="index\.html\?parse=unparseable"/g) ?? []).length).toBe(2);
    expect(flagRow).not.toContain('?flags=unparseable-callsign');
    expect(flagRow).toMatch(/<a href="index\.html\?parse=unparseable"[^>]*><code>unparseable-callsign<\/code><\/a>/);
    expect(flagRow).toMatch(/aria-label="browse the 10 rows carrying the unparseable-callsign flag in the [^"]+ publication"/);
    // An observation, never a verdict: "could not be parsed"/"matches no
    // known ... formation" is fine; judgemental language is not.
    expect(flagRow).toMatch(/matches no known UK callsign formation/i);
    expect(flagRow).not.toMatch(/\b(wrong|invalid|incorrect|erroneous)\b/i);
  });

  it('FidelityPage_FlagThatDidNotFireInLatestPublication_StaysInertWithNoEmptyFilterLink', () => {
    // A "none" row has no rows to browse, so it must not link into an
    // honestly-empty (and misleading) filtered search. excel-date-shape is a
    // markdown/xlsx-only flag that does not fire in the newest open-data CSV
    // publication, so its row shows "none" and carries no ?flags= link.
    const row = page.match(/<tr id="flag-excel-date-shape">[\s\S]*?<\/tr>/)?.[0] ?? '';
    expect(row, 'excel-date-shape row present').toBeTruthy();
    expect(row).toContain('<span class="gap">none</span>');
    // Assert the specific behaviour under test — no deep-link into a filtered
    // browse view — rather than "no anchor at all": a flag's meaning cell may
    // legitimately render its own link, which this row's inertness does not.
    expect(row).not.toContain('?flags=');
  });

  it('FidelityPage_ConsistencySection_LinksTheSixTwinsNarrative', () => {
    // Issue #657's second proposed back-link: the within-table consistency
    // section points at the narrative that walks a real conflict end to end
    // (the ledger keeps both rows rather than picking a winner, the same
    // "review candidate, never auto-corrected" register as this section).
    expect(page).toContain('href="reports/narratives/the-six-twins.html"');
  });
});
