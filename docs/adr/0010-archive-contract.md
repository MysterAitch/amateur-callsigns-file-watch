# ADR 0010 — The archive contract: raw bytes verbatim, keyed, provenanced, accepted before processability

- Status: accepted
- Date: 2026-07-10
- Related: ADR 0001 (golden-master derivation), ADR 0004 (FOI lane), ADR 0009 (how entries land), ADR 0013 (raw-keyed claim ledger — builds on this contract; the raw archive is the irreplaceable asset every fold derives from). Later records that change how this one reads: [ADR 0014](0014-trust-rating-safety-net.md) (makes the honesty obligation in decision 3 enforceable rather than aspirational — trust may only degrade through derivation, so a reconstructed entry cannot be surfaced as first-hand), [ADR 0015](0015-source-intrinsic-vs-archive-provenance.md) (splits the territory of the single `provenance` field into source-intrinsic versus archive/processing predicates, and its pinned-SHA source permalinks depend on decision 1's verbatim guarantee holding across commits), [ADR 0021](0021-frozen-derived-baseline.md) (freezes the committed derived files whose rules decision 1 states, so `normalised.csv` is now an equivalence baseline rather than a regenerated artefact)

## Context

`archive/` is the authoritative record the whole project rests on: every
derived artefact (normalised CSVs, components, reports, the SQLite database, the
site) is rebuildable from it, and consumers are told they may walk it as
ordinary files without git. That guarantee only holds if the rules governing
what an entry *is* — its bytes, its key, its provenance, and the conditions
under which it may be admitted at all — are fixed and honest. Those rules were
settled early and incrementally, but their canonical description is scattered
across `.gitattributes` comments, the `ArchiveMeta` type in
`src/shared/utils.ts`, the key-resolution code in `src/shared/archive.ts`, and
the README design notes. This ADR consolidates them.

Two provisions of the contract are counter-intuitive enough that, stated
without their reasoning, a reader cannot tell a deliberate constraint from an
incidental one — and each invites a plausible-sounding change that quietly
costs something.

### Why the sorted derivative exists at all

It is **not required**. The raw files carry the same information, and the
semantic diff between publications is computed independently of it
(`buildDiffSummary` in `src/shared/archive.ts` compares parsed records and is
tolerant of row-order differences by construction). It exists because the
publisher's row order is **not stable between publications**, so a `git diff`
between two consecutive raw CSVs is mostly rows moving: the real additions,
removals and field changes are buried in apparent churn across a file of
roughly 11 MB (the `2026-06-23` entry's `raw.csv` is 11,817,502 bytes as at
2026-07-29). Sorting on the callsign column collapses that to the semantic
change, presented at the callsign neighbourhood where a reader would look for
it.

The derivative is therefore for **human readers, not for machines**, and it
lives in exactly one place: the repository-root `latest-raw-sorted.csv`,
rewritten from the parsed records on every processing run. Per-entry sorted
copies are deliberately absent, and their absence is the same reasoning applied
consistently — an archive entry is a brand-new directory on commit and so has
nothing to diff against, meaning a per-entry sorted copy would cost another
~11 MB per publication for no readability at all. The one file that *is*
modified across publications is the one that carries the whole benefit.

### Whose chronology a persisted diff summary describes

An entry's `meta.json` diff summary is computed against the entry immediately
preceding it **at the moment that metadata is written**, and entries can be
inserted **retroactively**: a dataset discovered from a past year, or a
publication surfacing through a route not previously scraped, lands under a key
that sorts before entries already committed. A pre-existing entry's recorded
predecessor is then no longer its chronological predecessor, and those files are
deliberately not rewritten.

Beneath that sits an ambiguity no rewrite would resolve. "Chronology" has at
least three candidate axes — the publisher's own stated publication date, the
date the bytes were obtained, and the commit date — and they neither always
agree nor are always all available. Measured over the nine date-keyed open-data
entries committed as at 2026-07-29: three carry no publisher-stated date at all,
and of the six that carry both a publisher date and a retrieval date, the two
differ in **every** case — by four days at the closest (`2025-06-04`, retrieved
2025-06-08) and by over three years at the widest (`2023-02-20`, imported
2026-07-06). A persisted summary records **one** choice from **one** moment,
which is why it is described below as a snapshot rather than a view.

## Decision

1. **Raw bytes are preserved verbatim.** `.gitattributes` marks
   `archive/**/raw.*`, `latest-raw.*`, and the FOI lane's data attachments as
   `binary`, so a publisher's exact bytes (Ofcom's CRLF-terminated CSVs among
   them) survive checkout on any platform. This is not cosmetic, and the
   load-bearing reason is worth spelling out for anyone editing
   `.gitattributes`: **a raw file's sha256 *is* the archive entry's
   identity.** Intake decides "is this download already archived?" by hashing
   the fresh download and looking it up against the hash of every committed
   `raw.*` (`findArchiveKeyByRawHash` in
   `src/sources/ofcom-amateur/process.ts`), and same-date key collisions are
   disambiguated with a suffix of that same hash. Git's default text
   normalisation rewrites CRLF on commit or checkout, so without the `binary`
   marking the committed blob's bytes would drift from the bytes the live
   endpoint serves; the lookup would then miss, and the next fetch would mint
   a **duplicate archive entry for a publication whose bytes never changed** —
   silently, on the platform whose checkout did the smudging. Derived files
   (sorted CSVs, JSON, `meta.json`, `normalised.csv`) need no `binary`
   protection because their identity is not a hash of foreign bytes: their
   writers emit `\n` unconditionally on every platform, so their content is
   born LF. They are deliberately text — which keeps git diffs readable — with
   `eol=lf` pinned in `.gitattributes` so a checkout cannot smudge them away
   from the sha256 their `meta.json` declares.

2. **Keys are publication dates, content-hash-suffixed on collision, and
   correctable.** An open-data key is Ofcom's own publication date
   (human-meaningful and chronologically sortable). When two publications want
   the same date with different content, a short content-hash suffix
   distinguishes them (`2025-06-04--0a1b2c`), so both are preserved rather than
   one overwriting the other. The open-data lane is constrained to date-shaped
   keys (`^\d{4}-\d{2}-\d{2}(--[0-9a-f]+)?$`); anything else under `archive/`
   belongs to another lane (ADR 0004's `archive/foi/`) and must never surface
   through `listArchiveKeys()`, because a non-date key would hijack
   newest-entry and latest-pointer logic. Keys are correctable when better
   provenance emerges — the key names the entry, it does not freeze a claim.

3. **Provenance is declared, from a closed vocabulary.** Every entry's
   `meta.json` carries a `provenance` field, one of `live`,
   `reconstructed-from-git-history`, or `reconstructed-from-prior-download`.
   `live` entries were fetched first-hand by the current codebase;
   reconstructed entries were materialised retroactively (from prior git blobs,
   or from downloads retained outside the repository) and may legitimately lack
   fields only a live fetch captures (source URL, cache-buster value), with
   `reconstructionNotes` recording what is known about how and when the bytes
   were originally obtained. Consumers surface the distinction rather than
   hiding it: a reconstructed entry is not first-hand and says so.

4. **`intendedCoverage` records intent, never verified quality.**
   `intendedCoverage.complete = true` means the publisher presented the entry as
   the full dataset; `false` means it is knowingly partial (an FOI response
   scoped to a subset, or a visibly truncated publication), with `scopeNotes`
   describing what a partial view covers. This is deliberately about intent, not
   quality: an intended-complete export can still carry defects (blank fields,
   suspected missing records), and those are a separate observation axis, not a
   reason to mark coverage incomplete. Consumers diffing or aggregating across
   entries must not read missing rows in a partial entry as revocations — they
   are scope, not change.

5. **Raw acceptance is never blocked on processability.** A dataset enters the
   archive on the strength of honest provenance metadata alone. Normalisation
   and other derivation are optional enhancements layered on later (ADR 0001's
   golden-master sweep), and their absence never keeps well-provenanced raw
   bytes out. The founding preference is that an honest crash or an
   un-normalised raw entry beats silently mirroring truncated or broken data:
   the sanity gates exist to fail loud, and a raw record worth keeping despite
   failing checks lands through the deliberate admin-bypass escape hatch
   (ADR 0009).

## Consequences

- Idempotence and reconstruction both depend on byte-exact raw preservation;
  the `.gitattributes` binary markings are a hard invariant, not a convenience.
- The schema-versioning *policy* for derived data folds in here: `meta.json`
  carries a `schemaVersion`, and `docs/normalised-schema.md` stays a living
  reference for the schema *contents* rather than becoming an ADR — contents
  evolve, the contract that versions them does not.
- Derived metadata is a snapshot, not a live truth: a `meta.json` diff summary
  is written once and is not rewritten if publications are later inserted
  between existing entries, so consumers needing an authoritative current diff
  re-derive from the raw files.
- **Diff summaries are persisted for `live` entries only.** `buildDiffSummary`
  has exactly one caller — the first-hand intake path — so no reconstruction or
  recovery route can produce one: the rule holds structurally, not through a
  per-provenance conditional that a new intake route could forget. It is
  deliberate rather than incidental, because a retroactively materialised
  entry's inferred predecessor mixes the chronological axes above, and a figure
  derived against the wrong predecessor does not merely lack authority — it
  reads as licensing activity when it is an artefact of comparing across a gap.
  Reconstructed and recovered entries therefore carry record counts and no diff.
  Measured 2026-07-29 over the committed `archive/*/meta.json`: one `live` entry
  with a summary, eight non-live entries without one. Retroactive insertion is
  not hypothetical — two entries keyed `2025-11-11` and `2026-01-14` were
  retrieved on 2026-07-15, nine days after the live entry whose key sorts after
  both of them was archived.
- A persisted summary can also be **self-referential**: a later fetch that
  matches an archived copy byte for byte records the entry as its own
  predecessor, which is fetch lineage rather than dataset lineage. Consumer
  surfaces must distinguish the two, because rendering the byte-identical result
  against the *previous publication* asserts something false about it.
- **The sort must stay stable and deterministic**, because the readability
  property is the whole point: change the sort and every comparison spanning the
  change boundary reads as total churn, which is exactly the noise the
  derivative exists to remove. The sort key is resolved by column **name**
  through the shared header-variant registry (`callsignColumnFor`), never by
  position, so an upstream column reorder cannot silently change what the file
  is sorted by; a raw file carrying no recognised callsign column falls back to
  the first column and warns, and that warning is itself a data-quality signal
  worth acting on. Two properties of the comparison are unpinned and worth
  knowing before anyone relies on cross-platform byte equality: it is a
  default-locale `localeCompare`, so a host with different collation could order
  equal-looking keys differently, and ties fall back to the publisher's own row
  order through the sort's stability. Neither can break an invariant today
  because nothing declares this file's sha256 — but neither is asserted either.
- **The sorted derivative will periodically be proposed for deletion as
  redundant, and that is the wrong call.** It is redundant to every machine
  consumer and load-bearing for every human one, which is why the reasoning
  above is recorded rather than left to be re-derived. `validate-data` requires
  the file to be present and to agree on record count with the JSON
  derivatives, so removing it fails the `data-validation` check loudly instead
  of quietly degrading every future review of a publication.
- The derived-file line-ending pins are **per-path, not blanket**, and the
  sorted derivative sits outside them: `latest-raw-sorted.csv` carries no
  `.gitattributes` entry and so relies on git's default text handling rather
  than an explicit `eol=lf`. Nothing declares its hash, so no invariant rests on
  its bytes; the pins exist precisely where a `meta.json` sha256 or a
  byte-equality no-op check does rest on them. Anything that starts declaring
  this file's hash must pin it first.
- The provenance vocabulary is **closed but not frozen**. `ArchiveMeta.provenance`
  in `src/shared/utils.ts` is the authority on its current members, and it has
  gained one since this record was written: `recovered-from-web-archive`, for a
  publication retrieved verbatim from a public web archive's capture of it, with
  the capture and replay coordinates carried in `witnesses[]` and the original
  publisher URL in `publicationUrl`. Read the type for the live set. The
  distinction the decision above draws is unchanged and is what matters: `live`
  means first-hand by the current codebase, and every other member is not
  first-hand and says so.
- Every consumer surface inherits the honesty obligations: reconstructed
  provenance and declared-partial coverage are shown to readers, so absence of a
  callsign from a partial entry is never presented as evidence of anything.
