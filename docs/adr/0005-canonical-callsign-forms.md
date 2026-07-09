# ADR 0005: Canonical callsign forms as the unification strategy

Date: 2026-07-09
Status: accepted

## Context

A callsign appears in the data under many surface forms. The same station is
`M7TEE` in the register and `MW7TEE` on air from Wales; the same publisher
value arrives as `2E1HON`, `2e1hon`, or `2E1HON ` across exports; a
visitor is `M/EI8DJ` from England and `MM/EI8DJ` from Scotland. If joins keyed
off the raw string, these renderings would fragment: longitudinal history
would break on a whitespace artefact, and a regional rendering would never
find its canonical row.

The register also contains genuine anomalies that must not be silently
"fixed" — deliberate stripped-collisions (`G6 FMU` and `G6FMU` both listed),
and, most recently, three `Reserved` reciprocal rows carrying a literal `#`
after the slash (`M/#PT2FM`, `M/#VK4VGK`, `M/#YO3IES`) that conflict with the
documented callsign format. The project's founding ethos is fail-loud and
declared-not-verified: derived data must be trustworthy, and where the source
is ambiguous the honest move is to record and surface, not to adjudicate.

The visitor/reciprocal work (issue #204) forced these threads together and is
the occasion for writing the strategy down.

## Decision

**The project relies on computed canonical forms as its join keys, never on
the raw callsign string.** Two derived columns in `components.csv` carry this,
each a *unifier, not an identity claim*:

1. **`cleaned` — the artefact-unification key.** Uppercase, stripped of
   everything outside `A–Z`, `0–9` and `/`. Absorbs case, whitespace,
   invisible characters and replacement characters, so a value joins to
   itself across publications regardless of publisher damage. Collisions are
   expected and deliberate (`G6 FMU`/`G6FMU` → `G6FMU`); uniqueness cannot be
   enforced, so no consumer treats `cleaned` as a primary key.

2. **`placeholder_form` — the rendering-unification key.** Normalises the
   Regional Secondary Locator slot to `#`, so every regional rendering of a
   callsign collapses to one form. It spans all callsign families the same
   way: core (`M7TEE`, `MW7TEE` → `M#7TEE`), Intermediate (`20DLQ`, `2E0DLQ`
   → `2#0DLQ`), and — added here — visitor/reciprocal, where the RSL sits in
   position 2 before the slash (`M/EI8DJ`, `MW/EI8DJ`, `MM/EI8DJ` →
   `M#/EI8DJ`). The site's lookup uses this form to resolve `MM/1CNB` to the
   canonical `M/1CNB` register row exactly as it resolves `MM7TEE` to
   `M7TEE` — one mechanism, no per-family special cases.

Three principles govern how these forms are built and defended:

3. **Preserve the raw, normalise for joining, never overwrite.** The verbatim
   value stays in `callsign`; canonical forms are additional columns. The
   slash is load-bearing and never stripped — it is the only disambiguator
   between reciprocal `M/1CNB` and core `M1CNB`. There is exactly one
   canonical form per callsign; no dual-canonical complexity is introduced.

4. **Record anomalies as flags; do not adjudicate them.** When a value
   conflicts with the documented format, the raw stays verbatim, a best-effort
   canonical form is still derived, and the anomaly is recorded in the closed
   `flags` vocabulary so it stays visible and filterable. The `#`-after-slash
   reserved rows are treated this way: the `#` is read as a reserved-template
   placeholder, stripped from the home portion (which then parses cleanly),
   and recorded with the new `hash-in-register` flag — not mistaken for a
   `malformed-home-callsign`, and not "corrected" out of existence.

5. **Attribute every external claim to its actual primary source.** The
   RSL-before-slash convention rests on RSGB "Operating for Visitors" (the
   `Mx/` examples `M/F1ABC`/`MM/F1ABC`/`MW/F1ABC`) and Ofcom's licensee
   guidance (the RSL letter table §5.7; the CEPT country-prefix-first rule
   §7.3; the `2#0` slot notation in Table 1 that mirrors this repo's `#`
   convention). Ofcom's guidance is *silent* on the inbound `M/homecall`
   example, and that silence is stated rather than papered over — a
   search-summary that wrongly attributed such an example to the Ofcom PDF was
   corrected against the full text before merge.

## Consequences

- Consumers join on `cleaned` (across publications) and `placeholder_form`
  (across renderings) and never on the raw string; both are documented in
  `docs/normalised-schema.md` with their non-uniqueness caveats.
- Every callsign family flows through one normalisation path. Extending to a
  new family (as visitor/reciprocal did) is an addition to the parser and a
  golden re-run, not a new lookup mechanism.
- Anomalies remain first-class, visible data: the register's oddities are
  surfaced through flags rather than smoothed away, keeping the derived data
  faithful to the source.
- Attribution discipline is the standing rule for reference-data work: cite
  the source that actually makes the claim, and record what the primary text
  does not say. CEPT/HAREC class labelling (a `cept_level` attribute) stays
  out of scope here — issue #201.
