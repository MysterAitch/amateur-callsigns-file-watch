/**
 * Source deep-link composition (issue #431, ADR 0015 Phase P4).
 *
 * Phase P1 attests WHERE an observation sits in its source: Provenance.position
 * (the 1-based physical CSV line) and Provenance.viewAnchor (the repo-relative path
 * + line of the line-viewable file). This module makes that WHERE VERIFIABLE and
 * clickable: it composes those stored primitives with the git commit that
 * introduced our archived copy into a durable GitHub blob permalink
 * `…/blob/{sha}/{path}#L{line}`, which GitHub renders by jumping to and
 * highlighting that exact source line - so a claim's provenance is a first-class
 * dense cross-link back to the byte it rests on (the transparency mission), and the
 * #433 "show the working" surface can turn every evidence position into a clickable
 * link.
 *
 * Two load-bearing decisions from ADR 0015, honoured here:
 *
 *  - DERIVE ON READ, PERSIST NOTHING (decisions 5-6). The permalink is COMPUTED
 *    from stored primitives (viewAnchor + introducing-commit SHA), never a stored
 *    string, so it can never drift from the position it points at and nothing enters
 *    the claim ledger - the #404 no-inflation invariant and the JSONL/N-Quads bytes
 *    are literally untouched.
 *
 *  - THE HONESTY RULE (priority-zero, decisions 1-2). The introducing commit is an
 *    ARCHIVE/PROCESSING fact - a fact about OUR handling of OUR copy, read from git
 *    history - carried under the `archive:` predicate namespace, rigorously distinct
 *    from a source-intrinsic date. A filesystem stat of our checked-out copy
 *    (ctime/mtime, merely when WE downloaded the bytes) is UNREPRESENTABLE in the
 *    ArchiveProvenance.origin type, the strongest guard against presenting a
 *    processing artefact as a source fact.
 *
 * The SHA is PINNED (the introducing commit, not a moving branch) so the link is
 * durable: raw files are byte-stable across commits per the archive contract (ADR
 * 0010), so any commit in which the file exists highlights the correct line, and
 * the introducing commit is the natural, stable anchor.
 */

import { execFileSync } from 'child_process';
import type { Provenance, ViewAnchor } from './claim.ts';

// The repository the archived bytes live in. A GitHub blob permalink at a pinned
// commit SHA highlights an exact source line durably. This is the v2 provenance
// lane's own single source of truth for the slug (the CI render layer keeps its own
// REPO_URL for its own surfaces); the two are the same repo but deliberately
// decoupled so an emit-lane change never reaches into the render lane.
export const SOURCE_REPO_URL = 'https://github.com/MysterAitch/amateur-callsigns-file-watch';

// The named rule the composed permalink is attributed to. It reads out Computed
// confidence (a deterministic derivation from stored primitives), NOT As-published:
// the link is OUR construction over the source's position, not a source byte. A
// surface (#433) names this rule when it shows the link so a reader knows it is a
// derived convenience, re-computable from the position + SHA it displays alongside.
export const SOURCE_PERMALINK_RULE = 'github-blob-permalink';

// The predicate for ARCHIVE/PROCESSING provenance (ADR 0015 decision 1): the git
// commit that introduced our archived copy of a file. The `archive:` namespace
// marks it as genuinely OURS - a fact about our handling of our copy - never to be
// confused with a source-intrinsic date. A consumer tells "the source's" from
// "ours" by predicate alone (the honesty rule), no case-by-case judgement.
export const ARCHIVE_INTRODUCED_IN_COMMIT = 'archive:introducedInCommit';

// The provenance of OUR archived copy of a source file: the git commit that first
// introduced it to the repo. `origin` is a CLOSED set admitting only git-history -
// a filesystem stat of our checkout is unrepresentable here, so the forbidden move
// (claiming our download time as the source's date) cannot be expressed. `predicate`
// carries the honest archive: namespace the fact belongs to.
export interface ArchiveProvenance {
  repoPath: string;
  introducedInCommit: string;
  origin: 'git-log';
  predicate: typeof ARCHIVE_INTRODUCED_IN_COMMIT;
}

// Percent-encode each path segment while preserving the `/` separators, so a repo
// path with a space or other reserved character composes into a valid URL. Ordinary
// ASCII archive paths (letters, digits, `-`, `_`, `.`) pass through unchanged.
function encodeRepoPath(repoPath: string): string {
  return repoPath.split('/').map(encodeURIComponent).join('/');
}

// Compose the durable GitHub blob permalink for a source position: the pinned
// commit SHA, the repo-relative path, and the 1-based line (a highlighted range
// when the anchor carries an endLine). Pure - same inputs yield the same URL - and
// the sole place the `…/blob/{sha}/{path}#L{line}` shape is constructed.
export function sourcePermalink(anchor: ViewAnchor, commitSha: string): string {
  const fragment = anchor.endLine !== undefined && anchor.endLine !== anchor.line
    ? `#L${anchor.line}-L${anchor.endLine}`
    : `#L${anchor.line}`;
  return `${SOURCE_REPO_URL}/blob/${commitSha}/${encodeRepoPath(anchor.repoPath)}${fragment}`;
}

// The permalink for a claim's provenance, or undefined when the provenance carries
// no viewAnchor. A positionless (legacy) observation is honestly given NO link
// rather than a fabricated one - absence is reported, never guessed.
export function permalinkForProvenance(provenance: Provenance, commitSha: string): string | undefined {
  if (provenance.viewAnchor === undefined) return undefined;
  return sourcePermalink(provenance.viewAnchor, commitSha);
}

// The full 40-hex git commit that introduced a repo-relative file AT ITS CURRENT
// PATH - the pinned, durable anchor for its source permalink. `--diff-filter=A`
// isolates the addition(s) of this exact path; git lists newest-first, so the LAST
// line is the earliest such introduction. Renames are DELIBERATELY not followed: a
// followed rename would resolve to the file's original addition under a DIFFERENT
// path, a commit at which the current path does not exist and the permalink would
// 404. The addition of the current path is a commit where the path is guaranteed to
// resolve, and (raw files being byte-stable per the archive contract, ADR 0010) it
// carries the identical bytes. Fail loud when git reports no introducing commit: a
// source file the ledger positions into but git has never tracked is a surfaced
// gap, never a silently missing link.
export function introducingCommit(repoPath: string, options: { cwd?: string } = {}): ArchiveProvenance {
  const output = execFileSync(
    'git',
    ['log', '--diff-filter=A', '--format=%H', '--', repoPath],
    { cwd: options.cwd, encoding: 'utf8' },
  );
  const commits = output.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  const introduced = commits.at(-1);
  if (introduced === undefined) {
    throw new Error(`introducingCommit: git found no commit that introduced "${repoPath}" - the file is untracked or the path is wrong`);
  }
  return { repoPath, introducedInCommit: introduced, origin: 'git-log', predicate: ARCHIVE_INTRODUCED_IN_COMMIT };
}
