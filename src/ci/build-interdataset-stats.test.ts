import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildInterdatasetStats } from './build-interdataset-stats.ts';
import { listArchiveKeys } from '../shared/archive.ts';
import { BUILDER_PROJECTION_DIR_ENV } from '../shared/derived-entries.ts';
import { DIRS } from '../shared/constants.ts';

// Issue #177 Surface 2: the STATIC inter-dataset statistics page — statistics
// ACROSS the archived open-data publications (blank-product filtering,
// record-count deltas, column/flag/pattern drift), distinct from the
// latest-publication statistics page (Surface 1). These build the real archive
// into a scratch directory and assert the rendered markup carries the figures
// and framing the PR cites. Test names follow Subject_Scenario_Outcome.

let outputDir: string;
let urls: string[];

const read = (): string => fs.readFileSync(path.join(outputDir, 'statistics', 'inter-dataset.html'), 'utf8');

beforeAll(() => {
  outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'interdataset-'));
  urls = buildInterdatasetStats(outputDir, 'https://example.test/site');
}, 600_000);

afterAll(() => {
  fs.rmSync(outputDir, { recursive: true, force: true });
});

describe('Inter-dataset statistics — blank-product join (the lead statistic)', { tags: ['data-validity'] }, () => {
  it('BlankProductTable_RealArchive_ReproducesThePerPublicationCounts', () => {
    const page = read();
    // The figures from the issue table, reproduced from the committed data
    // (not hard-coded): records and blank-product count per publication.
    expect(page).toContain('<td class="n">151,152</td><td class="n"><span class="gap">(no product column)</span></td>');
    expect(page).toContain('<td class="n">152,084</td><td class="n">44,712</td>');
    expect(page).toContain('<td class="n">157,427</td><td class="n">45,157</td>');
    expect(page).toContain('<td class="n">112,650</td><td class="n">0</td>');
    expect(page).toContain('<td class="n">158,318</td><td class="n">40,160</td>');
  });

  it('BlankProductFilterCase_ZeroBlankProductCount_IsNotDeEmphasised', () => {
    // Issue #731 (zero de-emphasis): every OTHER numeric zero on the site
    // mutes via the shared class, but this one is a deliberate exception.
    // 112,650 records with a literal 0 blank-product count is the filter-case
    // ANOMALY this whole page exists to surface (⚠ in the reading column,
    // asserted above) - muting the zero here would visually undercut the
    // very warning the page is making. The records-count cell beside it
    // (never zero for a real publication) is unaffected either way.
    const page = read();
    expect(page).toContain('<td class="n">112,650</td><td class="n">0</td>');
    expect(page).not.toContain('<td class="n">112,650</td><td class="n"><span class="zero">0</span></td>');
  });

  it('BlankProductNarrative_FilterCase_Names2025_06_04AndReproducesTheArithmetic', () => {
    const page = read();
    // The finding: the declared-complete publication that silently dropped
    // every blank-product record, with the arithmetic reconstructed from data.
    expect(page).toContain('4 June 2025 is the blank-product-filter case.');
    expect(page).toContain('157,427 − 45,157 = 112,270');
    expect(page).toContain('within 380 of the 112,650 actually published');
    // The 2025-06-04 row itself carries the filter reading, with a ⚠ marker.
    expect(page).toContain('<span class="marker">⚠</span> declared complete, yet every blank-product record silently omitted');
    // It references the shipped quality observation / timeline fix (issue #190),
    // rather than re-doing it.
    expect(page).toContain('issue #190');
  });

  it('BlankProductNarrative_FilterCaseNotice_IsAmberNotInformational', () => {
    const page = read();
    // The filter-case narrative is a warning strip (safety/coverage
    // information), not a neutral note.
    expect(page).toMatch(/<div class="notice warn"><span>⚠<\/span><span><b>4 June 2025 is the blank-product-filter case\./);
  });
});

describe('Inter-dataset statistics — declared-partial publications', { tags: ['data-validity'] }, () => {
  it('PartialPublications_InEveryTable_AreFlaggedSoZerosReadAsIncomplete', () => {
    const page = read();
    // The two declared-partial exports (1,074 rows) are marked so their zeros
    // read as "incomplete", not "no blanks".
    expect(page).toContain('declared partial — a zero here means <b>incomplete</b>, not "no blanks"');
    // The ⚠ marker rides the publication key in the column-drift / flag tables.
    expect(page).toContain('2025-05-27 <span class="marker" title="declared-partial export">⚠</span>');
    expect(page).toContain('2025-06-08 <span class="marker" title="declared-partial export">⚠</span>');
  });

  it('RecordCountDeltas_PartialExport_CarriesNoDeltaWhileCompletesDoVsPreviousComplete', () => {
    const page = read();
    // A partial export is not a register that shrank, so it carries no delta.
    expect(page).toContain('— (partial export, not a change in the register)');
    // Complete publications are diffed against the previous COMPLETE one: the
    // filter case reads as a ~44.8k drop versus 8 April 2025 (its true
    // chronological predecessor 27 May 2025 being partial, and skipped).
    expect(page).toContain('−44,777 (−28.4%) <span class="gap">vs 8 April 2025</span>');
  });
});

describe('Inter-dataset statistics — the other cross-publication comparisons', { tags: ['data-validity'] }, () => {
  it('FlagEvolution_RealArchive_RendersAFlagByPublicationMatrixWithAbsenceMarked', () => {
    const page = read();
    expect(page).toContain('<h2 id="flags">Data-quality flag evolution</h2>');
    // A flag present in every publication (forbidden-suffix) and one absent
    // from the earliest (rendered as an em dash, not a hard zero).
    expect(page).toContain('<code>forbidden-suffix</code>');
    expect(page).toContain('<td class="n"><span class="gap">—</span></td>');
  });

  it('PatternDrift_ReusesCompareStats_RendersNewAndLostPatternsPerTransition', () => {
    const page = read();
    expect(page).toContain('<h2 id="patterns">Callsign-pattern appearance and disappearance</h2>');
    // A transition between two complete publications is listed (the set
    // difference is compareStats, reused not reinvented).
    expect(page).toContain('20 February 2023 → 8 April 2025');
    // The filter-case transitions are annotated so their drift is not read as
    // the register changing.
    expect(page).toContain('one side is the blank-product-filter publication');
  });

  it('ColumnDrift_RealArchive_ShowsDistinctAndBlankPerColumnNotBareTotals', () => {
    const page = read();
    expect(page).toContain('<h2 id="vocabulary">Column vocabulary and emptiness drift</h2>');
    expect(page).toContain('6 distinct · 45,157 blank');
    // Cross-links the value catalogue for the actual vocabulary rather than
    // duplicating it.
    expect(page).toContain('../reports/value-catalogue.html');
  });

  it('AdjacentSurfaces_AreCrossLinkedNotDuplicated', () => {
    const page = read();
    expect(page).toContain('href="../compare.html"');
    expect(page).toContain('href="../reports/cross-dataset-invariants.html"');
    expect(page).toContain('href="../reports/value-catalogue.html"');
  });
});

describe('Inter-dataset statistics — static, discoverable, accessible', { tags: ['data-validity'] }, () => {
  it('Page_HasNoScripts_SoArchivedCapturesAreComplete', () => {
    const page = read();
    expect(page).not.toContain('<script');
    expect(page).not.toContain('data-browser-sql');
  });

  it('Page_Nav_MarksInterDatasetCurrentAndReachesSiblingSurfaces', () => {
    const page = read();
    // Discoverable: the shared nav carries the section and marks it current
    // (not self-linked) here.
    expect(page).toContain('<strong>Inter-dataset</strong>');
    expect(page).toContain('href="../statistics.html">Statistics</a>');
    expect(page).toContain('href="../compare.html">Compare</a>');
  });

  it('Page_DeclaredNotVerified_IsStatedUpFront', () => {
    const page = read();
    expect(page).toContain('<b>declared, not verified</b>');
    expect(page).toContain('is not evidence of anything about the register');
  });

  it('Page_Accessibility_CarriesSkipLinkMainLandmarkAndScopedHeaders', () => {
    const page = read();
    expect(page).toContain('<a class="skip" href="#main">Skip to content</a>');
    // The inter-dataset page shares the generated page shell, so its landmark
    // now carries the ledger visual-language class (issue #394); match by id.
    expect(page).toMatch(/<main id="main"[^>]*>/);
    expect(page).toContain('</main>');
    expect(page).toContain('<th scope="col">');
  });

  it('Build_ReturnsTheSitemapUrl', () => {
    expect(urls).toEqual(['https://example.test/site/statistics/inter-dataset.html']);
  });

  it('Build_Rebuild_IsDeterministic', () => {
    const second = fs.mkdtempSync(path.join(os.tmpdir(), 'interdataset-2-'));
    try {
      buildInterdatasetStats(second, 'https://example.test/site');
      expect(fs.readFileSync(path.join(second, 'statistics', 'inter-dataset.html'), 'utf8')).toBe(read());
    } finally {
      fs.rmSync(second, { recursive: true, force: true });
    }
  });
});

// The derived-entry switch, exercised through a real consumer (issue #629
// phase 2): with BUILDER_PROJECTION_DIR set the builder reads its stats.json
// inputs from the projection directory - proven by byte-identical output over
// a copied projection, and by a LOUD failure when the projection is missing
// (never a silent fallback to the archive).
describe('Inter-dataset statistics — derived-entry source switch', { tags: ['data-validity'] }, () => {
  const withProjectionDir = <T>(dir: string, run: () => T): T => {
    const saved = process.env[BUILDER_PROJECTION_DIR_ENV];
    process.env[BUILDER_PROJECTION_DIR_ENV] = dir;
    try {
      return run();
    } finally {
      if (saved === undefined) delete process.env[BUILDER_PROJECTION_DIR_ENV];
      else process.env[BUILDER_PROJECTION_DIR_ENV] = saved;
    }
  };

  it('Build_AgainstAProjectionCarryingTheSameBytes_IsByteIdenticalToTheArchiveBuild', () => {
    const projection = fs.mkdtempSync(path.join(os.tmpdir(), 'interdataset-proj-'));
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'interdataset-proj-out-'));
    try {
      for (const key of listArchiveKeys()) {
        fs.mkdirSync(path.join(projection, key), { recursive: true });
        fs.copyFileSync(path.join(DIRS.archive, key, 'stats.json'), path.join(projection, key, 'stats.json'));
      }
      withProjectionDir(projection, () => buildInterdatasetStats(out, 'https://example.test/site'));
      expect(fs.readFileSync(path.join(out, 'statistics', 'inter-dataset.html'), 'utf8')).toBe(read());
    } finally {
      fs.rmSync(projection, { recursive: true, force: true });
      fs.rmSync(out, { recursive: true, force: true });
    }
  });

  it('Build_WithProjectionDirPointingAtNothing_FailsLoud_NotSilentlyWrong', () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'interdataset-missing-out-'));
    try {
      expect(() => withProjectionDir(path.join(out, 'never-built'), () => buildInterdatasetStats(out, 'https://example.test/site')))
        .toThrow(/does not name an existing directory/);
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
  });

  it('Build_WithAProjectionMissingAnEntry_FailsLoudAsAnIntegrityFailure', () => {
    const projection = fs.mkdtempSync(path.join(os.tmpdir(), 'interdataset-partial-'));
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'interdataset-partial-out-'));
    try {
      // Only the first entry is projected; the builder must refuse to treat
      // the remainder as absent data.
      const keys = listArchiveKeys();
      fs.mkdirSync(path.join(projection, keys[0]), { recursive: true });
      fs.copyFileSync(path.join(DIRS.archive, keys[0], 'stats.json'), path.join(projection, keys[0], 'stats.json'));
      expect(() => withProjectionDir(projection, () => buildInterdatasetStats(out, 'https://example.test/site')))
        .toThrow(/integrity failure/);
    } finally {
      fs.rmSync(projection, { recursive: true, force: true });
      fs.rmSync(out, { recursive: true, force: true });
    }
  });
});
