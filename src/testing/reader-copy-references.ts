/**
 * Detectors for INTERNAL references in reader-facing copy.
 *
 * A tracker number or a repository path in a string a visitor reads is a
 * signpost for a page that was never written: it discloses nothing (this
 * repository and its issues are public), but it asks the reader to leave the
 * site and read an internal artefact to understand a claim they were shown. The
 * fix is always an explainer on the site with the copy pointing at it — never
 * deleting the reference and leaving the reader with nothing.
 *
 * SCOPE. These detectors are for strings that RENDER: copy registries, and the
 * gloss/label vocabularies whose values ship in a manifest and are shown
 * verbatim. Code comments, module headers, ADRs and commit messages are
 * deliberately out of scope — a tracker reference there is useful traceability
 * that costs a reader nothing.
 */

// A tracker reference: "issue #800", "(#800)", "PR #956", or a bare "#565". The
// bare form is included because it is the shape that actually shipped, and no
// reader-facing string has a legitimate use for a hash followed by digits.
export const TRACKER_REFERENCE = /(?:\b(?:issue|issues|pr|prs|pull request)\b\s*)?#\d+/gi;

// A path into this repository's tree: one of its top-level directories followed
// by a path. Anchored on a non-word, non-slash boundary so a URL path segment
// that merely ends in one of these words is not mistaken for a repository path.
export const REPOSITORY_PATH = /(?<![\w/])(?:docs|reports|src|site|tests?|scripts|archive|reference-data)\/[\w./-]+/gi;

// A source or data file named in the copy. Site pages (.html) are excluded: a
// reader-facing page is a legitimate destination, whereas a markdown, source or
// data file is an internal artefact.
export const SOURCE_FILE_NAME = /\b[\w-]+\.(?:md|markdown|ts|tsx|js|mjs|cjs|json|jsonl|csv|tsv|ya?ml|parquet|sqlite|py|sh|sql)\b/gi;

/**
 * Every internal reference in `text`, as the matched substrings — so a failure
 * names what was found rather than only that something was.
 */
export function internalReferencesIn(text: string): string[] {
  const found: string[] = [];
  for (const pattern of [TRACKER_REFERENCE, REPOSITORY_PATH, SOURCE_FILE_NAME]) {
    // The patterns are module-level and global; matchAll does not mutate
    // lastIndex, so sharing them across calls is safe.
    for (const match of text.matchAll(pattern)) found.push(match[0]);
  }
  return found;
}

/**
 * The offenders across a named collection of reader-facing strings, each
 * reported with the string it was found in.
 */
export function internalReferenceOffenders(strings: Iterable<readonly [string, string]>): string[] {
  const offenders: string[] = [];
  for (const [label, text] of strings) {
    const found = internalReferencesIn(text);
    if (found.length > 0) offenders.push(`${label}: ${found.join(', ')} — in: ${text}`);
  }
  return offenders;
}
