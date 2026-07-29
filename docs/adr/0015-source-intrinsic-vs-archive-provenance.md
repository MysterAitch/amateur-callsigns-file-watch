# ADR 0015 — Source-intrinsic vs archive/processing provenance

- Status: accepted
- Date: 2026-07-12
- Related: #431, #361 (raw-keyed claim ledger), #404 (trust-rating net), ADR 0013, ADR 0014, ADR 0016 (file-level claims + reconstruction oracle — the companion #431 fidelity infrastructure), ADR 0017 (#433 show-the-working — the downstream consumer that turns the P4 permalink into a per-claim evidence link)

## Context

The ledger keys every observation by `(source_file, ordinal)` and carries a
three-field `Provenance`. We want to attest, additionally: (1) the precise
position of each observation in its original (CSV line; spreadsheet
sheet/row/col; later PDF/image coordinates); (2) metadata the source itself
recorded about the file (OOXML `dcterms:created`/`dcterms:modified`, edit
duration; container-preserved entry mtimes); and (3) the git commit that
introduced our archived copy, with a permalink.

These fall into two fundamentally different classes, and the transparency
mission (priority-zero: never present a processing artefact as a source fact)
turns on never conflating them. The specific hazard: a file's on-disk
`ctime`/`mtime` is merely when WE downloaded or checked out our copy; a git
checkout rewrites it to checkout time. Emitting it as a source date ("the
register was produced on…") would be a fabrication.

This ADR is landed with Phase 1 (P1), which builds the CSV-line arm of (1). It
records the full model up front so the later phases (P2 xlsx cell; P3 file
metadata; P4 git commit + composed permalink) slot into a decided frame rather
than reopening it.

## Decision

1. **Two provenance classes, distinguished by predicate namespace.**
   - *Source-intrinsic* — `pos:*` (carried as `Provenance.position`, an
     observation-key refinement), and file-level `dcterms:created`,
     `dcterms:modified`, `src:editDuration`, `src:containerEntryModified`.
     Admissible ONLY when read from inside the document (OOXML docProps) or
     inside the container (zip central directory). Confidence: As-published.
   - *Archive/processing* — `archive:introducedInCommit`, `archive:commitUrl`,
     optionally `archive:committedAt`. Facts about OUR handling of OUR copy,
     from git history. Never a source date.

2. **A filesystem stat of our copy is not a provenance source.**
   `ctime`/`mtime`/`birthtime` of the checked-out file are excluded outright —
   never source-intrinsic, and redundant with the git commit as an archive
   fact. The `FileProvenanceOrigin` type admits only `ooxml-*`,
   `zip-central-directory`, and `git-log` origins, so **a filesystem-stat origin
   is unrepresentable in the type** — the strongest possible guard against the
   forbidden move, backed at runtime by the trust-rating gate.

3. **Positions enrich the observation, they are not subject claims.** Position
   is a property of the `(source_file, ordinal)` key, so it rides on
   `Provenance.position` and the compact-DB observation row — never a
   per-observation claim (which would inflate the corpus and complicate the #404
   no-inflation trace for no query gain). It is carried once, on the
   observation's `@listed` anchor, since every claim of an observation shares the
   key.

4. **File-level facts are a separate claim stream** (P3), subject = the source
   file, joined to observations by `sourceFile` — not shoehorned into the
   observation/subject-claim model.

5. **Derive-on-read, persist nothing** (consistent with ADR 0014):
   source-intrinsic file facts are re-read from the archived bytes at build
   time; archive facts from git at build time. The immutable bytes/history are
   the source of truth; a persisted copy could drift.

6. **Provenance composes into a durable deep-link** (P4). git SHA (introducing
   commit) + repo-relative path + line → a GitHub blob permalink
   `…/blob/{sha}/{path}#L{line}` that highlights the exact source line. It is
   COMPUTED-ON-READ from stored primitives (position, `viewAnchor`,
   introducing-commit SHA), never a stored string, tagged with a named rule
   (Computed confidence) — so it cannot drift. Binary `.xlsx` deep-links to its
   committed text extract's line while still attesting the true sheet/row/col;
   text sources link to their own line. The SHA is pinned (not "latest") for
   durability, valid because raw files are byte-stable across commits per the
   archive contract (ADR 0010). The pinned SHA is the commit that introduced the
   file AT ITS CURRENT PATH — renames are deliberately NOT followed, because a
   followed rename resolves to the file's original addition under a *different*
   path, a commit at which the current path does not exist and the permalink would
   404. The addition of the current path is a commit where the path is guaranteed
   to resolve. `Provenance.viewAnchor` carries the true repo-relative path that the
   logical `sourceFile` key abstracts away (it drops the `archive/` prefix, and
   rewrites the open-data lane's path to `opendata/…`), so the permalink is
   buildable.

7. **Self-enforced.** The trust-rating gate asserts the namespace/intrinsic/
   origin correspondence and that no filesystem-stat-derived timestamp exists
   (from P3, when the file-provenance stream lands). Each phase ships a
   self-check; the load-bearing one: a captured position round-trips to the
   exact source cell (re-read the CSV line / re-open the workbook and confirm the
   value matches), and the composed permalink lands on the observation's raw
   subject.

## Consequences

- Consumers can trust that any `dcterms:*`/`src:*`/`pos:*` fact is genuinely the
  source's, and any `archive:*` fact is genuinely ours — by predicate alone, no
  case-by-case judgement.
- The 2016-09-20 entry's prose recital of embedded created/modified becomes a
  structured, re-verifiable, byte-backed attestation (derived on read, P3).
- Additive: legacy ledgers (no position, no file stream) parse unchanged; #404
  untouched — `position` never enters the claim multiset, so the no-inflation
  invariant and the fat-vs-compact `claims` VIEW parity are both undisturbed.
- P1 delivers `Provenance.position` (the `csv-line` arm), `Provenance.viewAnchor`,
  and the compact-DB `observation.pos_kind`/`pos_line` + `source.repo_path`
  columns. The reserved `SourcePosition` arms (`sheet-cell`, `markdown-row`,
  `pdf`, `image`) are named here but built in later phases.
- P4 delivers `src/v2/source-link.ts`: the pure `sourcePermalink` /
  `permalinkForProvenance` composers (position + pinned SHA → the blob permalink,
  the `github-blob-permalink` Computed rule), and `introducingCommit` (the archive
  fact, `archive:introducedInCommit`, whose `origin` type admits only `git-log`).
  It is derive-on-read: nothing is added to the ledger, so the golden/N-Quads bytes
  and #404 are untouched. Its self-check (`source-link.test.ts`) round-trips a
  composed permalink to the observation's raw subject by re-reading the PINNED
  commit's blob (`git show {sha}:{path}`), so the durable link is proven to land on
  the exact source cell. The file-provenance *source-intrinsic* stream (P3: OOXML
  `dcterms:*` document dates, container-preserved mtimes) remains named here but
  built later, keeping the honesty-rule namespace separation this ADR fixes.
- The reserved phases remain reserved (as of 2026-07-29): P2 (`sheet-cell`
  positions read from inside the workbook) and the P3 file-provenance stream are
  unbuilt, and #431 has since closed without them — no live tracker carries
  them, so a resumption starts from this record and the reserved
  `SourcePosition` arms in `src/v2/claim-core.ts`. Until P3 lands, the
  `FileProvenanceOrigin` type described in the Decision exists only as the
  delivered `git-log` arm (`ArchiveProvenance.origin`, `src/v2/source-link.ts`);
  the `ooxml-*` and `zip-central-directory` origins are part of the decided
  frame, not yet of the code.
