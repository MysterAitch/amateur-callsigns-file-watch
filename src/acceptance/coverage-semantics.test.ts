import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import type { ArchiveMeta } from '../shared/utils.ts';
import { listFoiEntryKeys, readFoiEntryMeta, defaultFoiDir, FOI_DATASET_RECOVERY } from '../shared/foi-archive.ts';
import { parseJsonObject } from '../shared/json-shape.ts';

// Independent acceptance criteria for coverage / completeness / absence
// semantics a rebuild MUST honour (v2 reference, section D). The load-bearing
// rule is that intent (intendedCoverage) and verified quality
// (qualityObservations) are SEPARATE axes, and that a coverage-affecting
// observation makes absence read as scope, not as a change of fact. These
// assertions read the real archive metadata rather than any derived view.

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');

function readRegisterMeta(key: string): ArchiveMeta {
  const metaPath = path.join(REPO_ROOT, 'archive', key, 'meta.json');
  return parseJsonObject(fs.readFileSync(metaPath, 'utf8'), metaPath) as ArchiveMeta;
}

describe('the 2025-06-04 coverage-affecting defect (acceptance criteria D1 / D3)', { tags: ['data-validity'] }, () => {
  const meta = readRegisterMeta('2025-06-04');

  it('Coverage_WhenBlankProductRecordsSilentlyDropped_IntentRemainsDeclaredComplete', () => {
    // Intent is never retro-edited: the publisher presented this as a complete
    // export, so intendedCoverage.complete stays true even after the defect
    // was found.
    expect(meta.intendedCoverage?.complete).toBe(true);
  });

  it('Coverage_WhenBlankProductRecordsSilentlyDropped_QualityObservationRecordsContradiction', () => {
    // The contradiction is captured on the separate quality axis, flagged as
    // coverage-affecting, with cited evidence.
    const observations = meta.qualityObservations ?? [];
    const coverageAffecting = observations.filter(o => o.coverageAffecting === true);
    expect(coverageAffecting.length).toBeGreaterThan(0);
    expect(coverageAffecting[0].statement.toLowerCase()).toContain('blank product');
    expect(coverageAffecting[0].evidence.length).toBeGreaterThan(0);
  });
});

describe('declared-partial register publications (acceptance criteria D1 / D2)', { tags: ['data-validity'] }, () => {
  it('Coverage_WhenTruncatedPublication_DeclaredPartialWithScopeNotes', () => {
    // The two truncated 1,074-row publications are knowingly partial: their
    // missing rows are scope, not revocations, and scopeNotes says what the
    // partial view covers.
    for (const key of ['2025-05-27', '2025-06-08']) {
      const meta = readRegisterMeta(key);
      expect(meta.intendedCoverage?.complete).toBe(false);
      expect((meta.intendedCoverage?.scopeNotes ?? '').length).toBeGreaterThan(0);
    }
  });
});

describe('FOI dataset-recovery states (acceptance criterion C5 / D-appendix)', { tags: ['data-validity'] }, () => {
  const foiDir = path.join(REPO_ROOT, 'archive', 'foi');

  function foiMetaFor(prefix: string) {
    const key = listFoiEntryKeys(foiDir).find(k => k.startsWith(prefix));
    expect(key, `expected an FOI entry starting ${prefix}`).toBeDefined();
    return readFoiEntryMeta(foiDir, key ?? '');
  }

  it('DatasetRecovery_WhenListAttachmentNeverCaptured_MarkedUnrecovered', () => {
    // An attested-but-uncaptured list is put on the record machine-readably as
    // an open recovery target, not silently treated as recovered.
    expect(foiMetaFor('ofcom-285990').datasetRecovery).toBe('unrecovered');
  });

  it('DatasetRecovery_WhenStatusFilteredSlice_MarkedPartialNotMissingBytes', () => {
    // A status-filtered disclosure (allocated-only / reserved-only) is a
    // COVERAGE statement, so overlap probes read its limited overlap as
    // by-construction rather than low take-up.
    expect(foiMetaFor('ofcom-2020-03-26').datasetRecovery).toBe('partial');
    expect(foiMetaFor('ofcom-2020-10-23').datasetRecovery).toBe('partial');
  });

  it('DatasetRecovery_WhenValuePresent_DrawnFromClosedVocabulary', () => {
    // Recovery states are a closed vocabulary; absence of the field means
    // fully recovered.
    const declared = listFoiEntryKeys(defaultFoiDir())
      .map(key => readFoiEntryMeta(defaultFoiDir(), key).datasetRecovery)
      .filter((recovery): recovery is string => recovery !== undefined);
    expect(declared.length, 'no FOI entry declared a datasetRecovery value to check').toBeGreaterThan(0);
    for (const recovery of declared) {
      expect(FOI_DATASET_RECOVERY).toContain(recovery);
    }
  });
});
