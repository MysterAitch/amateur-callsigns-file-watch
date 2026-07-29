import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  categoriseSuffix,
  everForbiddenSuffixes,
  buildForbiddenSuffixRationale,
  loadForbiddenSuffixRationale,
  OFCOM_FOI_SOURCE,
} from './forbidden-suffix-rationale.ts';
import { assertNonEmpty } from '../testing/non-vacuity.ts';

// Issue #196: categorise WHY each withheld suffix is likely restricted.
// Test names follow Subject_Scenario_Outcome. The oracle throughout is the
// real, committed corpus (the forbidden-suffixes union and Ofcom's own FOI
// wording) - never a synthetic fixture - per the project's data-validity
// convention for reference-data guards.

describe('forbidden-suffix rationale — categorisation rules', { tags: ['data-validity'] }, () => {
  it('CategoriseSuffix_QCodeBlockMember_SourcedAsItuQCode', () => {
    for (const suffix of ['QAA', 'QRZ', 'QSL', 'QTH', 'QNF', 'QZZ']) {
      expect(categoriseSuffix(suffix)).toEqual({ category: 'itu-q-code', epistemics: 'sourced', source: OFCOM_FOI_SOURCE });
    }
  });

  it('CategoriseSuffix_M1172OperationalAbbreviation_SourcedAsItuOperationalAbbreviation', () => {
    for (const suffix of ['ADS', 'CFM', 'COL', 'ETA', 'TXT']) {
      expect(categoriseSuffix(suffix)).toEqual({ category: 'itu-operational-abbreviation', epistemics: 'sourced', source: OFCOM_FOI_SOURCE });
    }
  });

  it('CategoriseSuffix_Sos_SourcedAsItuSignalConfusion', () => {
    expect(categoriseSuffix('SOS')).toEqual({ category: 'itu-signal-confusion', epistemics: 'sourced', source: OFCOM_FOI_SOURCE });
  });

  it('CategoriseSuffix_KnownOffensiveLookingSuffix_StaysUnclassifiedRatherThanInventingARationale', () => {
    // ASS/CNT/BUM etc. are exactly the "conventional practice" bucket Ofcom's
    // FOI letter describes only in general terms, with no per-suffix mapping
    // published. This project has no citable authority to attribute any one
    // of them individually, so categoriseSuffix must return undefined - never
    // guess "offensive" on its own initiative.
    for (const suffix of ['ASS', 'CNT', 'BUM', 'AID', 'DIE']) {
      expect(categoriseSuffix(suffix)).toBeUndefined();
    }
  });

  it('CategoriseSuffix_UndocumentedProceduralSignal_StaysUnclassifiedDespiteBeingWellKnownInFormat', () => {
    // TTT (safety) and XXX (urgency) are well known ham/maritime signals, but
    // ITU-R M.1172 - the only primary document held - does not define them,
    // so they must not be cited to a document that does not say so.
    expect(categoriseSuffix('TTT')).toBeUndefined();
    expect(categoriseSuffix('XXX')).toBeUndefined();
  });

  it('CategoriseSuffix_ThreeLetterStringNotOnAnyForbiddenList_IsStillCategorisableByPatternAlone', () => {
    // categoriseSuffix is a pure pattern match, independent of union
    // membership - a boundary worth pinning so a caller cannot assume it
    // implicitly checks the forbidden list too.
    expect(categoriseSuffix('QZQ')).toEqual({ category: 'itu-q-code', epistemics: 'sourced', source: OFCOM_FOI_SOURCE });
  });
});

describe('forbidden-suffix rationale — real archive', { tags: ['data-validity'] }, () => {
  const union = everForbiddenSuffixes();

  it('EverForbiddenSuffixes_RealUnion_Has1466Entries', () => {
    // Mirrors reference-data/README.md's documented union size.
    expect(union.length).toBe(1466);
  });

  it('BuildForbiddenSuffixRationale_RealUnion_Classifies699SuffixesAcrossThreeSourcedFamilies', () => {
    const rows = buildForbiddenSuffixRationale();
    expect(rows.length).toBe(699);
    const byCategory = new Map<string, number>();
    for (const r of rows) byCategory.set(r.category, (byCategory.get(r.category) ?? 0) + 1);
    // The full 26x26 QAA-QZZ combinatorial block, not merely the subset the
    // ITU document assigns a meaning to - the wholesale match is itself the
    // finding that grounds treating it as a blanket rule.
    expect(byCategory.get('itu-q-code')).toBe(676);
    expect(byCategory.get('itu-operational-abbreviation')).toBe(22);
    expect(byCategory.get('itu-signal-confusion')).toBe(1);
  });

  it('BuildForbiddenSuffixRationale_RealUnion_LeavesTheMajorityUnclassified', () => {
    // The residual (offensive/bullying-prone "conventional practice" bucket,
    // per Ofcom's own words) is the majority of the list, and stays entirely
    // absent from the classified rows - not zero-rationale rows, no rows.
    const rows = buildForbiddenSuffixRationale();
    expect(union.length - rows.length).toBe(767);
    const classifiedSuffixes = new Set(rows.map(r => r.suffix));
    expect(classifiedSuffixes.has('ASS')).toBe(false);
    expect(classifiedSuffixes.has('JIZ')).toBe(false);
  });

  it('BuildForbiddenSuffixRationale_Output_IsSortedBySuffixForDeterministicDiffs', () => {
    const rows = buildForbiddenSuffixRationale();
    const suffixes = rows.map(r => r.suffix);
    expect(suffixes).toEqual([...suffixes].sort((a, b) => a.localeCompare(b)));
  });
});

describe('forbidden-suffix rationale — committed CSV', { tags: ['data-validity'] }, () => {
  const csvPath = path.join('reference-data', 'forbidden-suffix-rationale.csv');

  it('CommittedRationaleCsv_MatchesGeneratedOutput_SoItCannotSilentlyDrift', () => {
    // Mirrors forbidden-suffixes.csv's own reproducibility guard: the
    // committed file is derived, not hand-edited, so it must always equal
    // what the generator produces from the current union.
    const generated = buildForbiddenSuffixRationale();
    const map = loadForbiddenSuffixRationale(csvPath);
    expect(map.size).toBe(generated.length);
    for (const row of assertNonEmpty(generated, 'generated forbidden-suffix rationale rows')) {
      expect(map.get(row.suffix)).toEqual(row);
    }
  });

  it('CommittedRationaleCsv_IsPlainAsciiLfNoNulBytes', () => {
    const buf = fs.readFileSync(csvPath);
    expect(buf.includes(0)).toBe(false);
    expect(buf.toString('utf8')).not.toContain('\r');
  });

  it('EverForbiddenSuffixes_WhenFirstColumnIsNotSuffix_ThrowsNamingTheDriftRatherThanMisKeying', () => {
    // Structural-fragility guard (#977): the union's suffixes are read from
    // each row's FIRST field, so a re-shaped file (columns reordered or a
    // column prepended) read by position would silently return non-suffix
    // values as "suffixes".
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forbidden-header-drift-'));
    try {
      const csvPath = path.join(dir, 'forbidden-suffixes.csv');
      fs.writeFileSync(csvPath, 'first_known_forbidden,suffix\n2016-07-29,ADS\n');
      expect(() => everForbiddenSuffixes(csvPath)).toThrow(/expected the first column to be "suffix"/);
      expect(() => everForbiddenSuffixes(csvPath)).toThrow(/first_known_forbidden/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('LoadForbiddenSuffixRationale_WhenHeaderReordered_ThrowsRatherThanMisMappingColumns', () => {
    // The loader destructures each row positionally into
    // suffix/category/epistemics/source, so a reordered header means every
    // field would land under the wrong name — asserted loud, never guessed.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rationale-header-drift-'));
    try {
      const csvPath = path.join(dir, 'forbidden-suffix-rationale.csv');
      fs.writeFileSync(csvPath, 'category,suffix,epistemics,source\nitu-q-code,QNF,sourced,ofcom-foi-337399\n');
      expect(() => loadForbiddenSuffixRationale(csvPath)).toThrow(/expected the header/);
      expect(() => loadForbiddenSuffixRationale(csvPath)).toThrow(/category,suffix,epistemics,source/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('LoadForbiddenSuffixRationale_SuffixAbsentFromTheFile_IsUndefinedNeverFabricated', () => {
    const map = loadForbiddenSuffixRationale(csvPath);
    expect(map.get('ASS')).toBeUndefined();
    expect(map.get('CNT')).toBeUndefined();
  });
});
