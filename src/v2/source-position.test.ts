import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';
import { collectOpenDataRegisterSources } from './collectors/open-data-register.ts';
import { collectFoiRegisterSources } from './collectors/foi-register.ts';
import { emitClaims, LISTED_PREDICATE, type SourceObservationSet } from './claim.ts';
import { serialiseClaimsJsonl, parseClaimsJsonl } from './serialise.ts';
import { physicalLines } from '../sources/ofcom-amateur/normalise.ts';
import { sampleIndices } from '../testing/non-vacuity.ts';

// Test names follow the project's Subject_Scenario_Outcome convention.
//
// The source-position enrichment (issue #431, ADR 0015, Phase P1): every
// observation of a CSV-lane source carries the 1-based PHYSICAL LINE it was
// parsed from, and a viewAnchor pointing at the real repo file. The load-bearing
// scenario - and the correctness argument for the whole phase - is a ROUND-TRIP:
// read the attested source file at the attested line and confirm it is the row
// that produced the observation's raw subject token. If the captured line ever
// drifts from the row, this oracle fails loudly.

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');

// A small open-data snapshot (fully verified) and a larger one (sampled), plus
// the FOI subset register entry - representative of BOTH capture mechanisms
// (open-data's line-accounting model; FOI's csv-parse `info`).
const OPEN_DATA_SMALL_KEY = '2025-05-27';
const OPEN_DATA_LARGE_KEY = '2026-06-23';
const FOI_ENTRY = 'ofcom-01420046--allocated-reserved-callsigns';

function openDataSource(key: string): SourceObservationSet {
  const resolved = collectOpenDataRegisterSources().find(s => s.entry === key);
  if (resolved === undefined) throw new Error(`open-data entry ${key} not found in the archive`);
  return resolved.load();
}

function foiSource(entry: string): SourceObservationSet {
  const resolved = collectFoiRegisterSources().find(s => s.entry === entry);
  if (resolved === undefined) throw new Error(`FOI register entry ${entry} not found`);
  return resolved.load();
}

// Independently re-derive the subject token at a 1-based physical line: parse the
// header line together with that one data line and read the subject column. This
// is a SEPARATE code path from the loader (a fresh csv-parse over two lines), so
// agreement is a genuine cross-check, not a tautology.
function subjectAtLine(repoPath: string, subjectColumn: string, line: number): string {
  const lines = physicalLines(fs.readFileSync(path.join(REPO_ROOT, repoPath), 'utf8'));
  const miniCsv = `${lines[0]}\n${lines[line - 1]}\n`;
  const records = parse(miniCsv, { columns: true, bom: true, relax_column_count: true }) as Record<string, string>[];
  return records[0]?.[subjectColumn] ?? '';
}

function assertPositionsRoundTrip(source: SourceObservationSet, ordinals: number[]): void {
  expect(source.lineNumbers).toBeDefined();
  expect(source.repoPath).toBeDefined();
  const lineNumbers = source.lineNumbers ?? [];
  const repoPath = source.repoPath ?? '';
  for (const ordinal of ordinals) {
    const line = lineNumbers[ordinal];
    const attested = subjectAtLine(repoPath, source.subjectColumn, line);
    const expected = source.rows[ordinal][source.subjectColumn] ?? '';
    // Verbatim equality - the raw token (whitespace/encoding artefacts intact) at
    // the attested line must be exactly the observation's raw subject.
    expect(attested).toBe(expected);
  }
}

describe('CSV source line captured while parsing round-trips to the source row', { tags: ['data-validity'] }, () => {
  it('OpenDataLane_WhenSmallSnapshotFullyChecked_EveryObservationLineYieldsItsRawSubject', () => {
    const source = openDataSource(OPEN_DATA_SMALL_KEY);
    assertPositionsRoundTrip(source, sampleIndices(source.rows.length, source.rows.length, source.sourceFile));
  });

  it('OpenDataLane_WhenLargeSnapshotSampled_AttestedLinesYieldTheirRawSubjects', () => {
    const source = openDataSource(OPEN_DATA_LARGE_KEY);
    assertPositionsRoundTrip(source, sampleIndices(source.rows.length, 200, source.sourceFile));
  });

  it('FoiLane_WhenRegisterSourceSampled_AttestedLinesYieldTheirRawSubjects', () => {
    const source = foiSource(FOI_ENTRY);
    assertPositionsRoundTrip(source, sampleIndices(source.rows.length, 200, source.sourceFile));
  });
});

describe('the round-trip sampler refuses to pass vacuously over an empty source', { tags: ['unit'] }, () => {
  it('PositionRoundTrip_WhenSourceLoadsNoRows_FailsRatherThanPassingVacuously', () => {
    // A source that loaded zero rows (a loader change, a filter that stops
    // matching, a schema rename) must not let `assertPositionsRoundTrip` pass
    // green having asserted nothing (issue #977) - sampling zero ordinals from it
    // must fail loudly, naming the empty source, rather than yielding `[]` for
    // the round-trip loop to iterate zero times over.
    const emptySource: SourceObservationSet = {
      sourceFile: 'foi/empty-entry/raw.csv',
      vintage: '2020-01-01',
      columns: ['Callsign'],
      subjectColumn: 'Callsign',
      rows: [],
      lineNumbers: [],
      repoPath: 'archive/foi/empty-entry/raw.csv',
    };
    expect(() => assertPositionsRoundTrip(emptySource, sampleIndices(emptySource.rows.length, 200, emptySource.sourceFile)))
      .toThrow(/foi\/empty-entry\/raw\.csv/);
  });
});

describe('the captured line accounting is complete and consistent', { tags: ['data-validity'] }, () => {
  for (const [label, load] of [
    ['open-data', () => openDataSource(OPEN_DATA_SMALL_KEY)],
    ['FOI', () => foiSource(FOI_ENTRY)],
  ] as const) {
    it(`${label}Source_WhenLoaded_HasOneStrictlyIncreasingLinePerRow`, () => {
      const source = load();
      const lineNumbers = source.lineNumbers ?? [];
      // One line per row, none missing.
      expect(lineNumbers.length).toBe(source.rows.length);
      // Strictly increasing: 1 record = 1 physical line, so a later row is always
      // on a later line. A duplicate or out-of-order line would betray a broken
      // capture.
      for (let i = 1; i < lineNumbers.length; i++) {
        expect(lineNumbers[i]).toBeGreaterThan(lineNumbers[i - 1]);
      }
      // Every line is a real data line beyond the header.
      expect(lineNumbers[0]).toBeGreaterThanOrEqual(2);
    });

    it(`${label}Source_WhenLoaded_ExposesAViewAnchorPathToAnExistingRepoFile`, () => {
      const source = load();
      expect(source.repoPath).toBeDefined();
      expect(fs.existsSync(path.join(REPO_ROOT, source.repoPath ?? ''))).toBe(true);
    });
  }
});

describe('position enriches only the anchor, and survives JSONL round-trip', { tags: ['data-validity'] }, () => {
  it('EmittedClaims_WhenObservationEmitted_CarryPositionOnTheListedAnchorOnly', () => {
    const source = foiSource(FOI_ENTRY);
    const claims = emitClaims(source);
    for (const claim of claims) {
      if (claim.predicate === LISTED_PREDICATE) {
        expect(claim.provenance.position).toEqual({ kind: 'csv-line', line: (source.lineNumbers ?? [])[claim.provenance.ordinal] });
        expect(claim.provenance.viewAnchor?.repoPath).toBe(source.repoPath);
        expect(claim.provenance.viewAnchor?.line).toBe((source.lineNumbers ?? [])[claim.provenance.ordinal]);
      } else {
        // Attribute claims of the same observation share its key and so its
        // position - it is carried once, on the anchor, never repeated here.
        expect(claim.provenance.position).toBeUndefined();
        expect(claim.provenance.viewAnchor).toBeUndefined();
      }
    }
  });

  it('Ledger_WhenSerialisedToJsonlAndBack_PreservesPositionAndViewAnchor', () => {
    const source = openDataSource(OPEN_DATA_SMALL_KEY);
    const claims = emitClaims(source);
    const reloaded = parseClaimsJsonl(serialiseClaimsJsonl(claims));
    expect(reloaded).toEqual(claims);
    // And the anchors specifically still carry a csv-line position.
    const anchors = reloaded.filter(c => c.predicate === LISTED_PREDICATE);
    expect(anchors.length).toBeGreaterThan(0);
    for (const anchor of anchors) {
      expect(anchor.provenance.position?.kind).toBe('csv-line');
    }
  });
});
