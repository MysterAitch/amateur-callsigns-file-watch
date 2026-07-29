# ADR 0012 — Supply-chain posture: a minimal, auditable dependency and write surface

- Status: accepted
- Date: 2026-07-10
- Related: ADR 0001 (PR-gated processing), ADR 0002 (repository write controls), ADR 0003 (frameworkless site), ADR 0009 (branch relay), ADR 0010 (archive contract), [ADR 0013](0013-raw-keyed-claim-ledger.md) (extends this posture to a class it was not written for: a build-time query engine adopted as a pinned, checksum-verified static CLI binary rather than a native npm dependency — outside the lockfile, so its integrity rests on the pin and the checksum rather than on `npm audit`), ADR 0019 (unified `cicd.yaml` — preserves the read-only-CI posture via job-level permissions), ADR 0022 (v1 component architecture — the render backend and a11y oracle sanctioned in the 2026-07-24 addendum below); issues #47 (item 4), #966 (the dependency-stance deliberation the addendum consolidates)

> *(Amended 2026-07-24.)* The original decision below states the posture as a
> single line held uniformly across every dependency. The
> [addendum](#addendum-2026-07-24-dependency-tiers-and-the-adopt-vs-build-criteria)
> refines it into three tiers by where a dependency runs — shipped, build, and
> test-oracle — and gives the criteria for adopting one; it sharpens the
> original principle rather than reversing it. Read the two together.

## Context

The project's whole value rests on the archive being a trustworthy record and
its derived artefacts being reproducible from it (ADR 0010). A supply-chain
compromise — a malicious dependency install script, a hijacked action tag, a
third-party service with a write token, a library bump that silently churns
golden-master output — would undermine that trust at a stroke. The defensive
posture against this has been in force since deployment, but its description is
scattered: partly in ADR 0002's write-controls section, partly in `.npmrc`,
partly in the SHA pins across `.github/workflows/*`, partly in rationale
comments on the hand-rolled renderers (`src/shared/normalise.ts`,
`src/shared/markdown.ts`, `src/shared/zip.ts`, `src/shared/render-markdown.ts`,
`src/shared/xlsx-extract.ts`), and partly in pull-request threads. This ADR
consolidates the posture into one place and states the single principle behind
its parts.

The principle is that **a minimal, auditable dependency and attack surface, and
golden-master determinism, reinforce each other**: every dependency not taken is
both one fewer thing to be compromised and one fewer thing that can change
committed output between runs. The no-writeback stance (ADR 0002) closes the
same loop from the other side — no external party holds a credential that could
rewrite the record.

## Decision

1. **Install scripts do not run by default.** `.npmrc` sets
   `ignore-scripts=true`. npm `postinstall` scripts execute before any review
   pass and are a repeated attack vector (event-stream, ua-parser-js, colors.js,
   the ongoing npm hijackings the file names); with scripts off, a package that
   genuinely needs one fails loudly rather than executing arbitrary code
   silently on install. The file documents the deliberate one-off escape hatch
   (`npm install --foreground-scripts <pkg>` after investigating what the script
   does) rather than granting blanket permission.

2. **GitHub Actions are pinned to commit SHAs, not tags.** Every `uses:` in
   `.github/workflows/*` references a full commit SHA with the human-readable
   version in a trailing comment — e.g.
   `actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0`. A tag is
   a movable pointer an upstream compromise can re-aim at malicious code; a SHA
   is immutable, so a pinned workflow runs exactly the reviewed bytes. Dependabot
   (`.github/dependabot.yml`) advances these pins through ordinary gated PRs
   (ADR 0002), keeping them current without surrendering the immutability
   property between bumps.

3. **No third-party service holds write access.** The only write path to the
   repository is the fetch host's SSH-only, branch-scoped deploy-key push
   (ADR 0009) and the workflows' PR-only writeback (ADR 0001, ADR 0002); both
   land through the reviewed, allowlisted gate and neither can touch `main`
   directly. Dependabot was chosen over hosted Renovate precisely so no external
   service holds a token (ADR 0002). The published site carries no client-side
   npm supply chain and no CDN script tags: it is frameworkless with no build
   step (ADR 0003), and its single client dependency, `sql.js-httpvfs`, is
   vendored at build time by copying the npm-audited package out of
   `node_modules` into the deploy artefact — never a remote `<script>`, never
   vendored into git (ADR 0003).

4. **Byte-stability-critical renderers are hand-rolled on Node built-ins.**
   Where output is a committed golden master or ships in the reproducible deploy
   artefact, the renderer is owned by the repository rather than delegated to a
   library:
   - the normalised-CSV renderer (`renderCsv` in `src/shared/normalise.ts`) —
     minimal RFC-4180 quoting, LF endings, trailing newline — "so a dependency
     bump can never churn every archived normalised.csv";
   - the markdown table-cell / code-span helpers (`src/shared/markdown.ts`) and
     the markdown-to-HTML renderer (`src/shared/render-markdown.ts`), which
     render the repository's own committed markdown to a small, known subset;
   - the deterministic zip writer (`src/shared/zip.ts`), which fixes the DOS
     timestamp to the 1980 epoch and sorts entries so rebuilds over unchanged
     data are byte-identical;
   - the xlsx→CSV extractor (`src/shared/xlsx-extract.ts`), dependency-free and
     re-derivable in CI.

   The line these renderers hold is deliberate: **support only the small subset
   the repository's own committed files actually use, and throw on anything
   else** — a new construct earns review, never a silent guess. This keeps the
   dependency and attack surface small while making determinism a property of
   code we can read, not of a library's changelog.

## Consequences

- Hand-rolling carries a real maintenance cost: the renderers must be extended
  by hand when the committed corpus legitimately needs a new construct, and the
  test suite (each renderer's `*.test.ts`, plus the golden-master extracts) is
  the safety net that makes that safe. This is an accepted trade for
  determinism and a bounded attack surface, not a free win.
- The "no build step" constraint on the site (ADR 0003) is part of the posture,
  not merely a simplicity preference: it is what keeps a client-side npm supply
  chain off the published surface. Growth that would require a build belongs
  downstream (ADR 0003, ADR 0011), not on this repository's Pages deploy.
- `ignore-scripts=true` means a dependency that truly needs its install script
  fails until handled deliberately; that loudness is the intended behaviour, and
  the one-off escape hatch in `.npmrc` is the sanctioned response.
- When to reconsider a hand-rolled renderer: if it materially outgrows the
  subset it supports — enough that maintaining it by hand becomes a larger risk
  than the dependency it avoids — the preferred move is a **vendored, npm-audited
  library pinned and reviewed** (the `sql.js-httpvfs` pattern, ADR 0003), not a
  live CDN or an unpinned dependency. The principle is unchanged; only the point
  on the build-vs-vendor curve moves.
- This posture is a living record: when `.npmrc`, the action pins, the vendoring
  approach, or a renderer's ownership changes, update this ADR alongside the
  code, as ADR 0002 is treated for the GitHub-settings half.

### The attack classes this posture answers

Each mechanism above exists against a specific, named class of compromise; a
reader weighing an exception should identify which class the exception would
reopen.

1. **Install-time arbitrary code execution** — a dependency's lifecycle script
   runs attacker code on `npm install`, before any review (the event-stream /
   ua-parser-js / colors.js shape). Answered by `ignore-scripts=true`
   (decision 1).
2. **Upstream re-tagging** — a compromised action repository re-aims a version
   tag at malicious code, so an unchanged workflow file runs changed bytes.
   Answered by commit-SHA pinning (decision 2).
3. **A third-party credential becoming a write path into the record** — a
   hosted service holding a token that can push, merge, or rewrite history.
   Answered by the no-third-party-write rule (decision 3); the only writers are
   the branch-scoped deploy key and PR-only workflow tokens, both landing
   through the gated door ADR 0002 records.
4. **Silent derived-output churn** — a dependency bump changing committed
   golden-master bytes without anyone deciding it should. A correctness and
   trust failure rather than a classic intrusion, but the posture treats it as
   the same family: unreviewed third-party change reaching the record. Answered
   by the hand-rolled renderers plus golden-master tests (decision 4), and it
   doubles as detection — an unexplained re-run diff is the tripwire.
5. **Client-side injection on the published site** — a CDN script or a
   client-bundle dependency compromised after review. Answered by the no-build,
   no-CDN, vendored-only site surface (decision 3; ADR 0003).

Two neighbouring classes are answered *outside* this record and are listed so
the map is complete: **workflows executing attacker-pushed content**
(pwn-request shapes) are answered by schedule-only triggers and the
`workflow-audit` required check (ADR 0001, ADR 0002), and **compromise of the
fetch host itself** is bounded by the branch-scoped deploy key and the
data-path allowlist (ADR 0009).

### When a scoped write pattern would be acceptable

"No third-party service holds write access" is the standing rule, not a
never. The accepted writers (the deploy key, the workflow tokens, Dependabot)
already trace the boundary, so the conditions for any future scoped writer are
derivable rather than novel — all of them, together:

- its writes can only land as branches or pull requests through the same
  ruleset-gated door (never a token that can reach `main` or rewrite history);
- its capability is the narrowest that does the job — branch-scoped,
  path-allowlisted where the write shape allows it;
- its actions are attributable and auditable after the fact;
- the required status checks still gate every merge it proposes.

What remains unacceptable in all cases is a standing credential, held outside
this repository's review flow, that can write the default branch directly —
that is the compromise class the whole posture exists to keep closed.

### The posture under a real capability demand

The line has been probed once by a genuine capability gap: PDF text
extraction for archived FOI response letters, evaluated on issue #979. No
JS-ecosystem route fits, and the evaluated self-hosted web tools failed the
pipeline bar (no API, or determinism unproven). The evaluation's outcome was
to prefer scripting version-pinned external engines directly, under the same
byte-determinism and sanity-gate rules as every converter — that is, the
posture held and the pressure was answered *within* it. The tool choice
itself is recorded on the issue and graduates to an ADR only once determinism
is proven on held corpus files; nothing here pre-decides it.

## Addendum (2026-07-24): dependency tiers and the adopt-vs-build criteria

The original decision above treats "a dependency" as one uniform thing. The
component-architecture work (ADR 0022, issue #966) showed that this conflates
dependencies that behave very differently, and that the conflation was pushing
the project toward hand-rolling code — a security-critical HTML output encoder —
where hand-rolling was the *riskier* choice, not the safer one. This addendum
draws the distinction the original decision left implicit. It refines the
principle; it does not weaken it.

### The reserved anchor bites hardest on shipped code

The two concerns behind the whole posture — **archival longevity** and the
**client-side supply chain** — bite mainly on code that **ships** to the
published site and is captured in the archive. A build- or test-time dependency
runs in CI, emits reviewed output, and **never reaches the client or the
record**. And determinism, the other half of the original principle, comes from
the **golden-master tests**, not from the code being hand-rolled: a library-built
artefact that a golden test pins byte-for-byte is exactly as deterministic as a
hand-rolled one. So the strictness that is right for shipped code is
disproportionate for a build dependency, and hand-rolling a complex,
security-sensitive primitive to avoid a build dependency can *increase* risk
rather than reduce it.

### Three tiers by where a dependency runs

- **SHIPPED / browser-runtime — strict.** Anything served to the client or
  vendored into the deploy artefact stays bare-minimal, vendored, pinned and
  audited (the `sql.js-httpvfs` pattern, ADR 0003). This is the original
  posture, unchanged. The published site carries no client-side npm supply chain
  and no CDN script tags.
- **BUILD / dev — deliberate.** A dependency used only in the Node build or the
  test toolchain may be adopted for **targeted value** under the adopt-checklist
  below. It must never appear in the build output.
- **TEST-ORACLE — liberal.** A library we would never ship may be used at
  build/verification time purely as a **correctness oracle**: run our
  hand-rolled or platform implementation and the mature reference over the same
  inputs and assert they agree. Oracle dependencies never enter the build
  output — they only verify — so they are the most freely adoptable tier. This
  is how we trust a thin-slice hand-roll without flying blind: we
  differentially-test it against the solved thing (for example, our output
  encoder against DOMPurify over the hostile-string corpus, with parsed-DOM
  assertions; a future build-time force layout against `d3-force`; `axe-core` as
  the accessibility oracle).

The spectrum is therefore **SHIPPED (strict) → BUILD (deliberate) → TEST-ORACLE
(liberal)**.

### Adopt-checklist for a build or test dependency

A build/dev/test dependency is adopted only when it clears all of:

1. it solves a problem that is **actively harmful if hand-rolled** (security- or
   correctness-critical, or a systemic surface), not mere convenience;
2. it is **non-shipped, or vendorable** — it does not enter the client bundle or
   the deploy artefact;
3. it has a **small, auditable surface**;
4. it **installs cleanly under `ignore-scripts`** (no postinstall build the
   posture would have to fight);
5. it is **maintained and has verifiable provenance**;
6. it has a **cheap, reversible exit** — dropping it later is not a rewrite;
7. it is **lockfile-pinned**;
8. its output is **golden-covered** — a test pins the artefact, so a version bump
   cannot silently churn committed output.

### The browser-library criterion: value × blast-radius

For a dependency that *would* ship to the client, the adopt-vs-build call is
**value × blast-radius** — how much it buys against how much of the surface it
touches and how hard it is to remove. Worked examples:

- **`sql.js-httpvfs`** — *adopt.* High value (in-browser range-read of the
  published database), low blast-radius (isolated to the Explore path), already
  vendored and audited.
- **`jsdom`** — *adopt, build-only.* Already an in-tree audited dependency (the
  scrapers use it), so the render backend below adds **no new dependency** and
  never ships.
- **Reactivity libraries** — *resist.* High blast-radius: they impose a paradigm
  across the whole component surface and are the ADR 0022 framework tripwire.
- **`d3-force`** — *adopt when the need is real*, and prefer **baking the layout
  at build time** so it is a build dependency rather than shipped, unless the
  interactivity genuinely has to ship.
- **WebGL / `three.js`** — the far end: a clear adopt for a single contained
  visualisation surface where the value is high and the blast-radius stays inside
  that surface.
- **`crossfilter`** — *not yet.* Plain `Array.filter` suffices until data scale
  forces the upgrade.

### Concrete sanctions under this policy

- **`jsdom` as the build-time render backend** for the v1 components (ADR 0022):
  one vanilla-DOM render codebase runs against jsdom's spec-faithful DOM in the
  Node build and against the native DOM in the browser. It replaces both a
  hand-rolled string serialiser (whose escaping would be a systemic XSS surface)
  and any new DOM library (`happy-dom`, `linkedom` — the latter carries
  documented entity-fidelity quirks). It is build-time only, already in-tree, and
  the most spec-faithful option — the safest choice for a security-critical
  serialiser. **Adopted.**
- **`axe-core` (dev-only)** as the accessibility oracle for proactive a11y
  testing of the components. It never ships and purely verifies. **Adopted.**

The **hand-rolled-renderer clause** of the original decision is reframed
accordingly: hand-rolling remains right for the small, byte-stability-critical
renderers whose subset the repository fully controls (`renderCsv`, the markdown
helpers, the deterministic zip writer, the xlsx extractor), because there the
hand-roll *is* the low-risk option and a library would add churn surface. It is
**not** a mandate to hand-roll a large, security-sensitive primitive to avoid a
build-only dependency — there, a spec-faithful build backend held to golden and
differential tests is the least-bad choice.
