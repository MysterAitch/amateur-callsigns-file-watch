import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import * as path from 'path';
import { parse } from 'csv-parse/sync';
import { collectOpenDataRegisterSources } from './collectors/open-data-register.ts';
import { collectFoiRegisterSources } from './collectors/foi-register.ts';
import { emitClaims, LISTED_PREDICATE, type SourceObservationSet } from './claim.ts';
import {
  SOURCE_REPO_URL,
  SOURCE_PERMALINK_RULE,
  ARCHIVE_INTRODUCED_IN_COMMIT,
  introducingCommit,
  sourcePermalink,
  permalinkForProvenance,
} from './source-link.ts';

// Test names follow the project's Subject_Scenario_Outcome convention.
//
// The source deep-link (issue #431, ADR 0015 Phase P4). Phase P1 already attests
// WHERE an observation sits in its source (Provenance.position + viewAnchor). This
// phase makes that WHERE VERIFIABLE and clickable: it composes the stored position
// primitives with the git commit that introduced our archived copy into a durable
// GitHub blob permalink `…/blob/{sha}/{path}#L{line}` that highlights the exact
// source line. The permalink is DERIVED ON READ, never stored, so nothing enters
// the ledger and the #404 no-inflation invariant is untouched.
//
// Two correctness arguments are tested. (1) HONESTY (priority-zero, the honesty
// rule of #431): the introducing-commit fact is an ARCHIVE fact from git history,
// never a filesystem stat of our checkout, and the link pins that immutable SHA
// rather than a moving branch. (2) ROUND-TRIP (ADR 0015 §7, the load-bearing
// self-check): re-reading the pinned commit's blob at the attested line yields the
// observation's raw subject token - so the clickable link genuinely lands on the
// exact source cell.

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');

const OPEN_DATA_SMALL_KEY = '2025-05-27';
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

// Independently re-derive the subject token at a 1-based physical line by reading
// the file AS OF the pinned commit (a fresh `git show {sha}:{path}` + csv-parse over
// the header line and that one data line). Reading from the commit - not the
// working tree - is what proves the PINNED permalink is durable and correct.
function subjectAtLineInCommit(repoPath: string, sha: string, subjectColumn: string, line: number, encoding: BufferEncoding): string {
  const bytes = execFileSync('git', ['show', `${sha}:${repoPath}`], { cwd: REPO_ROOT, maxBuffer: 512 * 1024 * 1024 });
  const lines = bytes.toString(encoding).split(/\r\n|\r|\n/);
  const miniCsv = `${lines[0]}\n${lines[line - 1]}\n`;
  const records = parse(miniCsv, { columns: true, bom: true, relax_column_count: true }) as Record<string, string>[];
  return records[0]?.[subjectColumn] ?? '';
}

function sampleOrdinals(count: number, samples: number): number[] {
  if (count <= samples) return Array.from({ length: count }, (_, i) => i);
  const step = (count - 1) / (samples - 1);
  return Array.from({ length: samples }, (_, i) => Math.round(i * step));
}

describe('the source permalink composes the stored position into a pinned GitHub blob link', { tags: ['unit'] }, () => {
  it('SourcePermalink_WhenViewAnchorGiven_ComposesPinnedBlobUrlAtTheAttestedLine', () => {
    const url = sourcePermalink({ repoPath: 'archive/foi/some-entry/raw-extract.csv', line: 42 }, 'a'.repeat(40));
    expect(url).toBe(`${SOURCE_REPO_URL}/blob/${'a'.repeat(40)}/archive/foi/some-entry/raw-extract.csv#L42`);
  });

  it('SourcePermalink_WhenViewAnchorCarriesAnEndLine_ComposesAHighlightedLineRange', () => {
    const url = sourcePermalink({ repoPath: 'archive/2025-05-27/raw.csv', line: 3, endLine: 7 }, 'b'.repeat(40));
    expect(url).toBe(`${SOURCE_REPO_URL}/blob/${'b'.repeat(40)}/archive/2025-05-27/raw.csv#L3-L7`);
  });

  it('SourcePermalink_WhenRepoPathContainsSpaces_PercentEncodesEachSegmentButKeepsSlashes', () => {
    const url = sourcePermalink({ repoPath: 'archive/entry with space/raw file.csv', line: 1 }, 'c'.repeat(40));
    expect(url).toBe(`${SOURCE_REPO_URL}/blob/${'c'.repeat(40)}/archive/entry%20with%20space/raw%20file.csv#L1`);
  });

  it('SourcePermalink_WhenComposed_PinsAnImmutableCommitShaNotAMovingBranch', () => {
    const url = sourcePermalink({ repoPath: 'archive/2025-05-27/raw.csv', line: 5 }, 'd'.repeat(40));
    // A durable deep-link must pin the exact commit; a branch ref (main/HEAD) would
    // silently re-point as the file's neighbours change around it.
    expect(url).not.toContain('/blob/main/');
    expect(url).not.toContain('/blob/HEAD/');
    expect(url).toContain(`/blob/${'d'.repeat(40)}/`);
  });

  it('PermalinkForProvenance_WhenProvenanceCarriesAViewAnchor_ComposesTheLink', () => {
    const provenance = {
      sourceFile: 'foi/some-entry/raw.csv',
      ordinal: 0,
      vintage: '2020-01-01',
      position: { kind: 'csv-line' as const, line: 12 },
      viewAnchor: { repoPath: 'archive/foi/some-entry/raw.csv', line: 12 },
    };
    expect(permalinkForProvenance(provenance, 'e'.repeat(40)))
      .toBe(`${SOURCE_REPO_URL}/blob/${'e'.repeat(40)}/archive/foi/some-entry/raw.csv#L12`);
  });

  it('PermalinkForProvenance_WhenProvenanceHasNoViewAnchor_YieldsNoLinkRatherThanAFabricatedOne', () => {
    // A legacy/positionless observation must not be given a guessed link - absence
    // of an anchor is honestly reported as no permalink.
    const provenance = { sourceFile: 'foi/legacy/raw.csv', ordinal: 3, vintage: '2016-01-01' };
    expect(permalinkForProvenance(provenance, 'f'.repeat(40))).toBeUndefined();
  });
});

describe('the introducing-commit is an honest archive fact, never a processing artefact', { tags: ['data-validity'] }, () => {
  it('IntroducingCommit_WhenArchivedFileResolved_ReturnsAGitLogShaLabelledAsArchiveProvenance', () => {
    const source = foiSource(FOI_ENTRY);
    const repoPath = source.repoPath ?? '';
    const provenance = introducingCommit(repoPath, { cwd: REPO_ROOT });
    // A full 40-hex SHA, sourced from git history, honestly labelled as an
    // archive/processing fact under the archive: predicate namespace.
    expect(provenance.introducedInCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(provenance.origin).toBe('git-log');
    expect(provenance.repoPath).toBe(repoPath);
    expect(provenance.predicate).toBe(ARCHIVE_INTRODUCED_IN_COMMIT);
    expect(ARCHIVE_INTRODUCED_IN_COMMIT.startsWith('archive:')).toBe(true);
  });

  it('IntroducingCommit_WhenPathIsNotInHistory_FailsLoudlyRatherThanGuessing', () => {
    expect(() => introducingCommit('archive/this/path/does/not/exist.csv', { cwd: REPO_ROOT })).toThrow();
  });
});

describe('the composed permalink round-trips to the exact source cell it deep-links', { tags: ['data-validity'] }, () => {
  for (const [label, load] of [
    ['FOI', () => foiSource(FOI_ENTRY)],
    ['open-data', () => openDataSource(OPEN_DATA_SMALL_KEY)],
  ] as const) {
    it(`${label}Source_WhenAnchorPermalinkComposed_LandsOnTheObservationsRawSubjectInThePinnedCommit`, () => {
      const source = load();
      const repoPath = source.repoPath ?? '';
      const sha = introducingCommit(repoPath, { cwd: REPO_ROOT }).introducedInCommit;
      const lineNumbers = source.lineNumbers ?? [];
      const encoding = source.encoding ?? 'utf8';
      const ordinals = sampleOrdinals(source.rows.length, Math.min(source.rows.length, 50));
      for (const ordinal of ordinals) {
        const line = lineNumbers[ordinal];
        const url = sourcePermalink({ repoPath, line }, sha);
        // The URL is a well-formed pinned blob link at the attested line.
        expect(url).toBe(`${SOURCE_REPO_URL}/blob/${sha}/${repoPath}#L${line}`);
        // And re-reading that pinned blob at that line yields the observation's raw
        // subject token verbatim - the link lands on the exact source cell.
        const attested = subjectAtLineInCommit(repoPath, sha, source.subjectColumn, line, encoding);
        expect(attested).toBe(source.rows[ordinal][source.subjectColumn] ?? '');
      }
    });
  }

  it('EmittedListedAnchor_WhenItsPermalinkComposed_ResolvesToTheObservationsSourceRow', () => {
    // End-to-end over the ACTUAL emit output: every @listed anchor carries the
    // position/viewAnchor P1 attests, so composing its permalink and round-tripping
    // proves an emitted claim carries verifiable provenance about WHERE it came from.
    const source = foiSource(FOI_ENTRY);
    const repoPath = source.repoPath ?? '';
    const sha = introducingCommit(repoPath, { cwd: REPO_ROOT }).introducedInCommit;
    const encoding = source.encoding ?? 'utf8';
    const anchors = emitClaims(source).filter(c => c.predicate === LISTED_PREDICATE);
    expect(anchors.length).toBe(source.rows.length);
    for (const ordinal of sampleOrdinals(anchors.length, Math.min(anchors.length, 50))) {
      const anchor = anchors[ordinal];
      const url = permalinkForProvenance(anchor.provenance, sha);
      expect(url).toBeDefined();
      const line = anchor.provenance.viewAnchor?.line ?? 0;
      const attested = subjectAtLineInCommit(repoPath, sha, source.subjectColumn, line, encoding);
      expect(attested).toBe(anchor.rawSubject);
    }
  });

  it('SourcePermalinkRule_WhenComposingAnchorLinks_NamesTheDerivedComputedRule', () => {
    // The rule name is exported so a surface (#433) attributes the composed link as
    // a Computed-confidence derivation, not an as-published source string.
    expect(SOURCE_PERMALINK_RULE).toBe('github-blob-permalink');
  });
});
