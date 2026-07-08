# Site information architecture — working draft

*Blank-slate design (2026-07-09): the site as it would be structured if built
fresh, iterated towards strategically. Draft for discussion — not yet
ratified; delete or trim freely.*

## The audiences and their journeys

| # | persona | arrives asking | entry point | journey |
|---|---------|----------------|-------------|---------|
| J1 | callsign holder | "tell me about M7TEE" | home lookup / shared `?c=` link | search → answer → history → source entries |
| J2 | suffix hunter | "is \*TEE available?" | home lookup | `*SUF` matrix → series pages → candidate callsigns |
| J3 | data user | "give me trustworthy data + schemas" | dataset index (or README) | index → entry page → downloads → dictionary |
| J4 | verifier | "can I trust this? how do I cite it?" | any page → About | About → meta/witnesses/GitHub → raw bytes |
| J5 | explorer | "show me something interesting" | home story hooks | hook → story page (statistics / series / correspondence) → wander via cross-links |
| J6 | analyst | "how has the register changed?" | statistics | trends / comparisons (issue #177) → drill-downs |

Concrete question-shapes behind J1/J2/J5 (from review):

- "I spoke to M7TEE on air — what's the history of their callsign?" →
  datasets it appears in (✓ built) **plus the ecosystem**: conventional
  directory outlinks (QRZ-style deep links by URL pattern — cheap, no
  claims made) and, later and only with curation care, personal links
  (blogs etc. are per-person PII-adjacent data — a deliberate lane, not a
  default).
- "I hold M7TEE — everything about it, including who held it before me"
  → register history + FOI issuance events (✓ built), reissue/heritage
  chains where disclosed.
- "Just passed — is a callsign with my initials free?" → the `*SUF`
  journey, framed on the home page as "try your initials".
- "I heard an odd/offensive callsign — why is that allowed?" → the
  forbidden-list timing story: legacy allocations pre-date the withheld
  list (the `forbidden-suffix` flag + the post-2019 subset, issue #179,
  answer exactly this).

J1/J2 are well served today. J3 wades through analysis to reach files.
J4 has the pieces but no page that tells the trust story. J5 is unserved —
the archive is full of stories nothing points at. J6 exists only as tables
without context.

## Joins are the product

The demonstrated value events (the ingestion-footer discovery; the
issue-date-column inversion) came from **correlating datasets**, not
reading one. The site must serve unbounded exploration, not only
presentation:

- The master database is the join surface; an **Explore** affordance
  documents it: join keys (callsign; entry/dataset), NULL-vs-blank
  semantics, worked example queries (e.g. "callsigns Allocated in 2019's
  FOI snapshot but absent from the 2026 register"), and where to run them
  (download the .sqlite.gz; or the in-browser lookup for single entities).
- Cross-links are the wander fabric: every fact should link to the
  surfaces that contextualise it (class chips #178, series pages, entry
  pages, registry).

## The graph layer (and where it lives)

End-state vision: knowledge-graph navigation — from a callsign, outbound
edges to series, RSL, suffix, renderings, placeholder form, holders,
witnessing datasets; clusters forming from dense cross-referencing.
Resolution of the here-vs-downstream tension, following the precedent the
SQLite lookup already set (in-repo PoC as a DERIVED deploy artefact,
never committed):

1. **Links-first (here, now)**: the graph is latent in components.csv —
   it already is an edge list. Every component value on the callsign view
   becomes a link (suffix → `*SUF`, series → series page, renderings and
   placeholder → their `?c=` pages, home callsign → its page). Most of
   the click-through vision is link density over existing anchors, no new
   data model.
2. **Derived edges artefact (here, deploy-time)**: extract typed edges
   from the normalised layers (in-publication, witnessed-by, series,
   suffix, transfer events, later rule-applies) into a published
   `edges` artefact beside the SQLite tiers. Deterministic, regenerable,
   hand-maintained never — the committed layer stays tabular golden
   masters + cited reference data. **Edges are derived/inferred
   knowledge, never primary data**: every edge type declares its
   derivation rule (documented in the dictionary), so the graph carries
   the same declared-not-verified epistemics as everything else.
3. **Graph database / cluster analysis / visualisation (downstream)**:
   ingests the published edges (`LOAD CSV`-grade work). Because the
   extraction is published here, the eventual consumer duplicates
   nothing and the in-repo PoC is not hamstrung — both consume the same
   artefact. Scale note: the node space is observations (callsign ×
   dataset: ~158k allocated/reserved in recent full publications alone,
   before the availability-era datasets, × a potential 20–30+ datasets)
   plus attribute/event nodes — millions of edges at maturity, which is
   exactly why traversal/cluster tooling is layer-3 work.

The weighting stands: collection + normalisation into joinable form is
more than half the battle and stays this repo's enduring work; the UI is
comparatively trivial once the data is right.

## The institutional-knowledge lane (new data commitment)

Community knowledge that no dataset states: the M2 story, G2+two-letter
heritage conventions, era requirements ("Full licence issued before the
2003 licensing changes ⇒ holder passed a morse assessment"). Captured as
**curated, cited, date-anchored rules** in reference data (reviewed like
code; each rule marked sourced-vs-recollection), they enable honest
inference at point of use: a callsign page can say *"first seen 2001 as
Full ⇒ morse assessment passed (rule R3, source)"*. This is the
join-and-infer value in the repo's declared-not-verified voice. It is a
**data lane** (curation + sourcing discipline), not a site feature — the
site merely surfaces it. Prior art: reference-data/*.csv + flags.md
already follow this pattern; the M2/G2 memories and the 2018 FOI prefix
counts are first candidate entries.

## The structural principle: artefact vs analysis

Entry pages currently mix two surfaces. Separating them resolves most
placement questions:

- **Artefact pages** (dataset entries) serve J3/J4: *what is this, what are
  its caveats, get the data, prove where it came from.* Short pages.
  Ratified order: ① identity + scope/provenance caveats → ② **Get the
  data** (download items: name+size, muted note, gutters; zip; descriptor)
  → ③ quality **summary** with so-what headline linking to analysis →
  ④ provenance detail.
- **The statistics constellation** serves J5/J6 and quality judgement: the
  statistics page becomes the analysis home (headline register state,
  flags-over-publications, locator matrix, later trends + inter-dataset
  comparisons). Register-analysis content (e.g. the RSL matrix) lives here
  and on series pages — not on artefact pages, which link to it.
  Per-publication analysis drill-downs (anchors vs `analysis/{key}` pages)
  are a sizing decision, deferred.

## Where artefacts live (the mental model)

| layer | examples | lives | why |
|-------|----------|-------|-----|
| raw | `raw.csv`, FOI files | **git, verbatim, hash-pinned** | the record itself |
| committed-derived (golden masters) | `normalised.csv`, `components.csv`, `stats.json` | **git** | byte-deterministic AND their re-derivation **diffs are review artefacts** — converter changes and corrections must be human-visible in PRs |
| curated knowledge | reference-data, flags registry, future inference rules | **git** | reviewed like code, cited |
| deploy-derived | SQLite tiers, zips, union CSV, all pages, future edges artefact | **Actions → Pages only, never committed** | non-deterministic, re-serialisations, presentation, or pure inference — their diffs carry no review value; regenerable from the layers above |

The criterion is not raw-vs-derived but *whose diff a human should review*.
Downstream consumers may ingest either the committed layer (git) or the
published artefacts (Pages) — both are stable interfaces.

## Content rules

1. **What / so what / now what** for every headline stat: value → factual
   context (trend vs previous publication, computed at build; the
   registry's own recorded meaning — never fresh editorial) → an action
   link (registry, affected rows, dataset). Basic orientation is this
   repo's job; sophisticated analysis stays downstream.
2. **Absence is not evidence** phrasing everywhere; declared completeness
   is intent, not verified fact.
3. Downloads always carry sizes; navigation never does.
4. Every fact shown is asserted somewhere committed (meta, stats.json,
   registry) — pages present, they do not compute truths.

## Ratified designs awaiting implementation

*Specified precisely so implementation needs no further epistemic
decisions (2026-07-09).*

### Quality observations (new meta axis)

Motivated by the confirmed 2025-06-04 blank-product filter (declared
complete; 112,650 rows = the April publication minus its 45,157
blank-product records, +380 drift — counts table on issue #177):

- `meta.json` gains optional `qualityObservations: [{ observedAt,
  statement, evidence, coverageAffecting }]` — hand-curated, cited,
  reviewed like reference data. `intendedCoverage` is NEVER retro-edited:
  intent stays intent; verified quality is a separate axis (as that
  field's docs always promised).
- The master's `history_datasets` carries `coverage_affecting_observation`;
  the timeline treats such publications like declared-partials —
  **absence is not evidence there** (today a blank-product callsign
  absent from 2025-06-04 gets a false "(absent)" annotation).
- Entry pages surface the observation under the H1 beside the
  scope/provenance notes.
- First entry: 2025-06-04 — "omits all blank-product records (~45k,
  including live allocations) while declaring complete"; evidence: #177.

### Knowledge-lane registry format

`reference-data/conventions.csv` (working name), reviewed like code:
`rule_id` (stable slug) · `statement` (one plain sentence) · `applies_to`
(selector mini-grammar, initially `series:` / `class:` /
`issued-before:` / `issued-after:` conjunctions) · `effective_from` /
`effective_to` (date anchors) · `inference` (the sentence a page renders
at point of use) · `epistemics` (`sourced` | `recollection` —
recollection entries ALWAYS render with "(community recollection,
unverified)") · `source` (required when sourced) · `notes`.

First candidates: morse-era rule (stays `recollection` until the
licensing-change date is sourced); M2 reserved-never-issued (2018 FOI
prefix counts as source); G2 two-letter heritage conventions
(wdtk-251507 as source); the 1970/1977/1984/1987 issue-spike
explanations stay OUT until dated and sourced.

### Edges artefact vocabulary (graph layer 2)

Published at deploy as `data/edges.csv`
(`from_type, from, to_type, to, edge_type, source`): edge types
`in-publication` (register_history), `witnessed-by` (observations),
`in-series` / `has-suffix` / `renders-as` / `cleaned-as` (components —
cleaned-as duplicates expected), `transferred` (issuance-events
observations), `rule-applies` (conventions selectors). Edges are
derived knowledge, never primary; `source` names the deriving table so
every edge is auditable. No UNIQUE constraints anywhere.

### Story hooks (curated; the wording IS the work)

Claim (exactly supported) + link + source:

1. "**74 → 9.** Forbidden-suffix callsigns were issued routinely for
   decades — until the flow collapsed in 2017, two years before Ofcom's
   withheld list became public." → the Explore cohort example. Source:
   the 2019 FOI issue-date histogram (#179 comment).
2. "**M2: present in the register, never issued.** One register row, and
   a 2018 FOI count that lists totals for every prefix around it." →
   series/M2.html. Source: register + 2018 FOI prefix counts.
3. "**The register lists one callsign twice.** G0TQK has been Reserved
   (since 1993) and Allocated (since 2018) at the same time — and its
   encoding-damaged twin haunts the 2022 publication." → ?c=G0TQK.
   Source: the 2019 snapshot's two rows + the 2022 register.
4. "**An intended-complete publication that wasn't.** The June 2025
   dataset silently omitted ~45,000 records — every row with a blank
   product field." → the 2025-06-04 entry page (once its quality
   observation renders). Source: #177 counts table.

## Page inventory (ideal)

| page | serves | answers | belongs | does NOT belong |
|------|--------|---------|---------|-----------------|
| home | J1/J2 entry hall | "look something up"; "what is this place?"; "what's interesting?" | lookup; 3–4 curated story hooks; doors to datasets/statistics/series/About | aggregate tables (moved to statistics ✓) |
| callsign / suffix views (`?c=`) | J1/J2 | entity state + full history | register row, components, renderings, series facts, both history cards | — |
| series pages | J2/J5 | "what is the G2 series?" | reference facts + latest counts + examples | deep matrix analysis (link instead) |
| dataset index | J3 | "what exists, what scope?" | orientation lead; catalogue with scope caveats; dictionary; bulk downloads | — |
| entry pages | J3/J4 | "what is this artefact? get it; trust it" | ratified order above | full RSL matrix; long registry prose (link) |
| statistics (analysis home) | J5/J6 | "state, quality, change of the register" | headline state; flags table; matrix; trends (#177); story call-outs | — |
| About / provenance | J4 | "what is this project? why trust it? how to cite?" | mission, integrity model (hash-pinned meta, verbatim raw, fail-loud), citation guidance, what the site is NOT | implementation minutiae (link to repo) |
| dictionary pages | J3 | column meanings | as now | — |

| Explore (SQL/join guide) | J6/J3 | "how do I correlate these datasets myself?" | join keys, semantics, worked queries, master DB pointer | hosted query execution (downstream's job) |

New curated inputs: story hooks file; conventions/inference-rules
registry (date-anchored, cited, sourced-vs-recollection marked);
ecosystem outlink patterns; About page prose (mostly exists in
README/ADRs). All reviewed like reference data.

## Phased build (each phase shippable)

1. **Entry-page restructure** (ratified): artefact order, download items,
   C-style card grouping + subtle background, quality summary with
   trend-vs-previous so-what; matrix replaced by a link to analysis.
   Same skeleton for FOI entries (facts join identity; correspondence
   prominent — it *is* the story for J5).
2. **Statistics as analysis home**: reorder with orientation lead; absorb
   the matrix as its centrepiece alongside the flags table; add so-what
   lines. (#177 trends slot in later.)
3. **Home as entry hall**: story hooks + doors; retire "proof of concept"
   framing.
4. **About page**.
5. Style harmonisation across app + generated pages (one shared stylesheet
   direction; density in doses).

6. **Exploration quick wins** (ratified): the cheap 80% of the
   exploratory vision inside the current architecture —
   a. **Link density** on the callsign/suffix views: every component
      value (series, suffix, renderings, placeholder, home callsign) and
      every matrix/history callsign becomes a navigable edge.
   b. **In-browser SQL console**: arbitrary read-only SQL over the
      latest + master databases via the existing range-request workers
      (textarea + results table; each Explore-guide example becomes a
      "run this" link). The highest exploration-per-effort item.
   c. **Filter deep-links** (`?series=…&status=…&flags=…`): every
      filtered view shareable; every count on series/statistics pages
      links to the actual rows behind it.
   Plus the **Explore guide** (join keys, semantics, worked queries —
   serves J6 immediately without waiting for #177's visualisations).
7. **Knowledge lane bootstrap**: conventions/inference-rules registry
   format + first sourced entries (M2, G2 heritage, morse-era rule);
   callsign/series pages surface applicable rules with citations.
   Ecosystem outlinks (directory URL patterns) ride along; personal-link
   curation explicitly deferred.

8. **Graph layers**: link density on the callsign view (layer 1 — can
   ride any early phase); derived edges artefact beside the SQLite tiers
   (layer 2, pairs naturally with the Explore guide); graph
   database/clusters remain downstream (layer 3).

Cross-cutting fix list folded into whichever phase touches the surface:
matrix/suffix-view callsign links, register-row provenance line, share
affordance on lookup results, class chips (#178), 404 page.
