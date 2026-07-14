# ADR 0012 — Supply-chain posture: a minimal, auditable dependency and write surface

- Status: accepted
- Date: 2026-07-10
- Related: ADR 0001 (PR-gated processing), ADR 0002 (repository write controls), ADR 0003 (frameworkless site), ADR 0009 (branch relay), ADR 0010 (archive contract), ADR 0019 (unified `cicd.yaml` — preserves the read-only-CI posture via job-level permissions); issue #47 (item 4)

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
