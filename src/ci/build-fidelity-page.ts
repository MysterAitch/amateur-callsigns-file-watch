#!/usr/bin/env node

/**
 * Builds the fidelity & integrity deep-dive page (issue #438): the ONE place
 * the inline fidelity nudges land, elaborating what the mirror's fidelity and
 * data-quality observations mean and how to examine and re-verify them.
 *
 * The page draws together the fidelity data streams that already exist:
 *  - the provenance / chain-of-custody record (#431, ADR 0015): verbatim raw
 *    bytes, hash-pinned meta.json declarations, and the computed-on-read
 *    GitHub permalinks back to exact source lines;
 *  - the data-quality flag registry (reference-data/flags.md), one anchored
 *    row per flag so a per-record nudge deep-links straight to its meaning;
 *  - the within-table consistency passes (#435, ADR 0018);
 *  - the "show the working" engine (#433, ADR 0017): REAL derived claims from
 *    the latest archived publication, explained on read and rendered with the
 *    shared disclosure (src/ci/render/show-working.ts) — the end-to-end
 *    demonstration that every derived value's evidence is one click away;
 *  - the reconstruction oracle (#434, ADR 0016): what its pass proves and
 *    which source families it covers.
 *
 * Everything on the page is an OBSERVATION about what the sources show, never
 * a verdict; the copy keeps the site's standing epistemics (declared, not
 * verified; absence is not evidence). Deterministic for unchanged inputs — the
 * examples are chosen by first-in-file-order rules and the permalink commit is
 * the pinned introducing commit — so re-deploys only change when the data does.
 *
 * Usage: node src/ci/build-fidelity-page.ts <output-dir> [base-url]
 */

import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import {
  emitLedger,
  FLAG_PREDICATE,
  CLEANED_CALLSIGN_RULE,
  LICENCE_CATEGORY_RULE,
  type Claim,
  type SourceObservationSet,
} from '../v2/claim.ts';
import { explain } from '../v2/explain.ts';
import { renderWorking } from './render/show-working.ts';
import { loadOpenDataRegisterSource, defaultArchiveDir } from '../v2/collectors/open-data-register.ts';
import { COVERED_FAMILIES, MARKDOWN_PROSE_SCOPE_NOTE } from './reconstruction-oracle.ts';
import { parseFlagRegistry } from './build-sqlite.ts';
import { listArchiveKeys } from '../shared/archive.ts';
import type { ArchiveMeta } from '../shared/utils.ts';
import {
  cleanedCallsign,
  parseCallsign,
  normaliseLicenceCategory,
  loadReferenceData,
  type ReferenceData,
} from '../sources/ofcom-amateur/components.ts';
import { renderInline } from '../shared/render-markdown.ts';
import {
  REPO_URL,
  escapeHtml,
  externalLink,
  htmlPage,
  glossaryTerm,
  tableCaption,
  exploreDeepLink,
} from './site-render.ts';
import { flagAnchor } from './render/fidelity.ts';

const DEFAULT_BASE_URL = 'https://mysteraitch.github.io/amateur-callsigns-file-watch';

// The forbidden-suffix flag the worked example demonstrates (the same token the
// registry and the parse tier use).
const FORBIDDEN_SUFFIX_FLAG = 'forbidden-suffix';

// One worked example: which derived rule it demonstrates, and the ordinal of
// the source row it draws on.
export interface ExampleSelection {
  kind: 'cleaned-callsign' | 'licence-category' | 'forbidden-suffix-flag';
  ordinal: number;
}

// Choose the rows whose derived claims the page explains, by deterministic
// first-in-file-order rules so the build is reproducible:
//  - cleaned-callsign: the first row whose raw token NEEDS cleaning (case /
//    whitespace / invisibles), so the working has a real transformation to
//    show; falls back to the first non-blank row (an honest "no change"
//    working) when the whole source is already clean;
//  - licence-category: the first row whose product cell resolves through the
//    reference table (absent when the source discloses no product column —
//    that example is then honestly omitted, never fabricated);
//  - forbidden-suffix flag: the first row whose parsed suffix is on the
//    ever-forbidden union (absent when no row carries one).
export function chooseExamples(source: SourceObservationSet, ref: ReferenceData): ExampleSelection[] {
  const examples: ExampleSelection[] = [];

  let cleanedOrdinal: number | undefined;
  let fallbackOrdinal: number | undefined;
  let categoryOrdinal: number | undefined;
  let forbiddenOrdinal: number | undefined;

  for (let ordinal = 0; ordinal < source.rows.length; ordinal += 1) {
    const row = source.rows[ordinal];
    const token = row[source.subjectColumn] ?? '';
    if (token === '') continue;
    if (fallbackOrdinal === undefined) fallbackOrdinal = ordinal;
    if (cleanedOrdinal === undefined) {
      const cleaned = cleanedCallsign(token);
      if (cleaned !== token && cleaned !== '') cleanedOrdinal = ordinal;
    }
    if (categoryOrdinal === undefined && source.categoryColumn !== undefined) {
      const product = row[source.categoryColumn] ?? '';
      if (product.trim() !== '' && normaliseLicenceCategory(product, ref) !== null) categoryOrdinal = ordinal;
    }
    if (forbiddenOrdinal === undefined) {
      // Cheap pre-filter (suffix membership) before the full parse confirms the
      // flag, so the scan does not run the parser over every row.
      const cleaned = cleanedCallsign(token);
      if (cleaned.length >= 3 && ref.forbiddenSuffixes.has(cleaned.slice(-3))
        && parseCallsign(token, '', ref).flags.includes(FORBIDDEN_SUFFIX_FLAG)) {
        forbiddenOrdinal = ordinal;
      }
    }
    if (cleanedOrdinal !== undefined && forbiddenOrdinal !== undefined
      && (categoryOrdinal !== undefined || source.categoryColumn === undefined)) break;
  }

  const cleaned = cleanedOrdinal ?? fallbackOrdinal;
  if (cleaned !== undefined) examples.push({ kind: 'cleaned-callsign', ordinal: cleaned });
  if (categoryOrdinal !== undefined) examples.push({ kind: 'licence-category', ordinal: categoryOrdinal });
  if (forbiddenOrdinal !== undefined) examples.push({ kind: 'forbidden-suffix-flag', ordinal: forbiddenOrdinal });
  return examples;
}

// Narrow a source to just the named rows, keeping the per-row source positions
// aligned, so emitting and explaining a handful of claims never pays the
// whole-corpus emit. Ordinals renumber inside the slice (they are the ledger's
// internal join key); the SOURCE POSITIONS — the line numbers the permalinks
// are built from — travel with their rows, so every rendered evidence link
// still points at the true physical line of the real file. Returns the sliced
// set plus the original->slice ordinal mapping.
export function sliceObservations(source: SourceObservationSet, ordinals: readonly number[]): { slice: SourceObservationSet; sliceOrdinalOf: Map<number, number> } {
  const unique = [...new Set(ordinals)].sort((a, b) => a - b);
  const sliceOrdinalOf = new Map<number, number>();
  unique.forEach((original, index) => sliceOrdinalOf.set(original, index));
  const slice: SourceObservationSet = {
    ...source,
    rows: unique.map(o => source.rows[o]),
    lineNumbers: source.lineNumbers === undefined ? undefined : unique.map(o => (source.lineNumbers ?? [])[o]),
  };
  return { slice, sliceOrdinalOf };
}

// The pinned commit the page's evidence permalinks anchor at. One working's
// links span SEVERAL files — the observation's archived source AND the
// versioned reference tables — and a single pin is only honest if every one of
// them exists at it. The archived file's introducing commit (ADR 0015's
// natural per-file anchor) fails that test: reference-data/ may postdate it,
// and a link to a file at a commit before it existed 404s. The build's OWN
// commit provably contains every file the build just read, is durable once
// pushed (the deploy builds only pushed commits), and per ADR 0015 any commit
// in which the byte-stable file exists highlights the correct line. It is also
// shallow-clone-safe: no history walk is needed.
export function buildCommit(): string {
  const fromEnv = process.env.GITHUB_SHA;
  if (fromEnv !== undefined && /^[0-9a-f]{40}$/.test(fromEnv)) return fromEnv;
  return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
}

// Find the ONE claim of a worked example in the sliced ledger. A selection that
// yields no claim is a selector/emit mismatch — a bug — surfaced loudly, never
// a silently absent example.
function exampleClaim(example: ExampleSelection, ledger: readonly Claim[], sliceOrdinal: number): Claim {
  const found = ledger.find(c => {
    if (c.layer !== 'derived' || c.provenance.ordinal !== sliceOrdinal) return false;
    switch (example.kind) {
      case 'cleaned-callsign': return c.rule === CLEANED_CALLSIGN_RULE;
      case 'licence-category': return c.rule === LICENCE_CATEGORY_RULE;
      case 'forbidden-suffix-flag': return c.predicate === FLAG_PREDICATE && c.object === FORBIDDEN_SUFFIX_FLAG;
    }
  });
  if (found === undefined) {
    throw new Error(`fidelity page: the ${example.kind} example (source ordinal ${example.ordinal}) emitted no matching derived claim — selector and emit disagree`);
  }
  return found;
}

const EXAMPLE_BLURBS: Record<ExampleSelection['kind'], { heading: string; blurb: string }> = {
  'cleaned-callsign': {
    heading: 'A cleaned callsign',
    blurb: 'The register is mirrored verbatim, so a callsign cell can carry case, whitespace or invisible-character artefacts. The cleaned form is a derived value; its working shows exactly which characters were removed, and links the verbatim source line they came from.',
  },
  'licence-category': {
    heading: 'A looked-up licence category',
    blurb: 'The canonical licence category is resolved from the row’s product cell through the versioned licence-category reference table — a lookup, so it reads out Looked-up on the confidence axis. The working links both the product cell and the reference row it matched.',
  },
  'forbidden-suffix-flag': {
    heading: 'A forbidden-suffix flag',
    blurb: 'The forbidden-suffix flag records that a callsign’s suffix appears on the ever-forbidden union — an observation, not an accusation: most such callsigns are long-standing allocations that predate the withholding. The working links the raw token and the reference-data row the suffix matched.',
  },
};

// ---- the page ---------------------------------------------------------------

function flagsSection(newestKey: string, newestStats: Record<string, number>): string[] {
  const registry = parseFlagRegistry();
  const rows = registry.map(({ flag, meaning }) => {
    // First sentence only, as the lookup does; the registry page carries the
    // full text and grounding.
    const firstSentence = meaning.split(/(?<=\.)\s/, 1)[0];
    const count = newestStats[flag] ?? 0;
    const countCell = count === 0 ? '<span class="gap">none</span>' : count.toLocaleString('en-GB');
    return `<tr id="${flagAnchor(flag)}"><th scope="row"><code>${escapeHtml(flag)}</code></th>`
      + `<td>${renderInline(firstSentence)}</td>`
      + `<td class="n">${countCell}</td></tr>`;
  });
  return [
    '<h2 id="flags">Data-quality flags — what a flagged record means</h2>',
    '<p>A flag is a <b>recorded observation</b> about a value as the source published it — never a correction, and never a verdict about a record or its holder. The mirror’s rule is to <b>resolve and flag</b>: the verbatim value is kept, the derived views work from a cleaned form, and the flag says exactly what was observed so nothing is silently transformed or dropped.</p>',
    `<p>Each flag’s full meaning and grounding lives in the <a href="datasets/docs/flags.html">flag registry</a> (the authoritative, committed copy). The counts below are from the latest archived publication (${escapeHtml(newestKey)}); a count of “none” means the flag did not fire there, not that it never fires.</p>`,
    '<table>',
    tableCaption('Every registered data-quality flag, with its meaning and its row count in the latest publication'),
    '<thead><tr><th scope="col">flag</th><th scope="col">meaning (first sentence)</th><th scope="col" class="n">rows in latest publication</th></tr></thead>',
    '<tbody>',
    ...rows,
    '</tbody>',
    '</table>',
    `<p>Where the site shows a flagged record inline — a badge beside a callsign in a preview, a note on a ${glossaryTerm('prefix-series', 0, { label: 'series' })} page — the badge links straight back to the flag’s row above.</p>`,
  ];
}

function provenanceSection(): string[] {
  return [
    '<h2 id="provenance">Provenance — the chain of custody</h2>',
    '<p>Every dataset the mirror publishes is traceable back to the bytes it came from:</p>',
    '<ul>',
    `<li><b>Verbatim raw files.</b> Each archive entry keeps the publisher’s bytes untouched; every derived file (the ${glossaryTerm('normalised', 0, { label: 'normalised view' })}, the components decomposition) is regenerated from them and declares its method.</li>`,
    '<li><b>Hash-pinned declarations.</b> Each entry’s <code>meta.json</code> declares a sha256 for every file, alongside where, when and how the file was obtained — including, for recovered material, the witness links (UK Government Web Archive, WhatDoTheyKnow, Ofcom’s own site) a reader can check independently.</li>',
    '<li><b>Source positions and permalinks.</b> The claim ledger records the physical source line each observation sits on; a permalink back to that exact line is <em>computed on read</em> from the recorded position and a pinned git commit at which our copy provably exists — never a stored string that could drift. A record with no recorded position honestly gets no link.</li>',
    `<li><b>Archive facts stay labelled as ours.</b> When the mirror states when <em>it</em> obtained or first committed a file, that is a fact about the mirror’s handling of its copy — carried under its own <code>archive:</code> namespace, and never presented as a date intrinsic to the source.</li>`,
    '</ul>',
    `<p>Start from the <a href="datasets/index.html">dataset index</a> to browse any entry’s files, hashes and witnesses; the ${glossaryTerm('axis-confidence', 0, { label: 'claim-confidence axis' })} in the glossary explains how As-published, Computed and Looked-up values differ.</p>`,
  ];
}

function consistencySection(): string[] {
  return [
    '<h2 id="consistency">Within-table consistency — when one table disagrees with itself</h2>',
    '<p>Beyond per-value flags, the ledger runs consistency passes <em>within each table</em> and records file-level flags on the affected column — review candidates, never auto-corrections:</p>',
    '<ul>',
    '<li><code>within-table-date-format-mixing</code> — a date column whose raw values need more than one day/month ordering (or a mix of shapes) to all be valid dates. The column’s date interpretation is marked doubtful; nothing is guessed.</li>',
    '<li><code>within-table-normalisation-collision</code> — two distinct raw values in one table collapse to the same canonical value (across tables that is legitimate vocabulary drift; inside one table it may mean the terms are not as equivalent as the mapping assumes).</li>',
    '</ul>',
    '<p>These findings currently live in the claim ledger and its committed self-checks; listing each affected file here, with its evidence, is planned as a follow-up surface. The passes are described in ADR 0018 '
      + externalLink(`${REPO_URL}/blob/main/docs/adr/0018-attest-column-interpretation-and-within-table-flags.md`, '(attest column interpretation and within-table flags)') + '.</p>',
  ];
}

function showWorkingSection(examples: { heading: string; blurb: string; context: string; html: string }[]): string[] {
  const body = [
    '<h2 id="show-working">Show the working — the evidence behind a derived value</h2>',
    '<p>Every derived value in the claim ledger names the rule that produced it, and its <b>working</b> — the exact inputs it was computed from, the transformation steps, and the reproduced result — is <em>reconstructed on demand by re-running the same code that derived it</em>, so what is shown cannot drift from what was computed. Each input links back to the exact source line (or versioned reference-table row) it rests on.</p>',
    '<p>These are real records from the latest archived publication, not mock-ups — open each disclosure and follow its links back to the source:</p>',
  ];
  for (const example of examples) {
    body.push(`<h3>${escapeHtml(example.heading)}</h3>`);
    body.push(`<p>${example.blurb} <span class="gap">${escapeHtml(example.context)}</span></p>`);
    body.push(example.html);
  }
  if (examples.length === 0) {
    body.push('<p class="gap">No archived publication is available to draw a worked example from in this build.</p>');
  }
  return body;
}

function reconstructionSection(): string[] {
  const familyGloss: Record<string, string> = {
    'open-data-register': 'the Ofcom open-data register publications',
    'foi-register': 'the FOI register-snapshot CSVs',
    'attribute-addendum': 'the FOI attribute-addendum tables',
    'foi-verbatim-csv': 'the FOI preamble/prefixed sheets (mirrored verbatim)',
    'foi-markdown-table': 'the FOI markdown-table transcriptions (table region only)',
  };
  const items = COVERED_FAMILIES.map(family =>
    `<li><code>${escapeHtml(family)}</code> — ${escapeHtml(familyGloss[family] ?? family)}</li>`);
  return [
    '<h2 id="reconstruction">Reconstruction — proving nothing was lost on the way in</h2>',
    '<p>The strongest self-check the mirror runs: each text source file is <b>rebuilt from its ledger claims alone</b> and compared against the original raw bytes, modulo a minimal declared set of cosmetic differences. A pass proves the claim layer genuinely captures the source — headers, order, footer furniture and all — and a regression that dropped or corrupted source structure would fail the build loudly.</p>',
    '<p>Source families covered today:</p>',
    `<ul>${items.join('')}</ul>`,
    `<p>For markdown transcriptions the fidelity claim is scoped honestly: ${escapeHtml(MARKDOWN_PROSE_SCOPE_NOTE)}.</p>`,
    '<p>The oracle runs as a committed test in CI on every change — see '
      + externalLink(`${REPO_URL}/blob/main/src/ci/reconstruction-oracle.ts`, 'src/ci/reconstruction-oracle.ts')
      + ' — so “the archive round-trips” is a continuously re-verified property, not a one-time claim.</p>',
  ];
}

function reverifySection(): string[] {
  const exploreHref = exploreDeepLink('', 'combined', 'SELECT dataset, COUNT(*) AS rows FROM register_history GROUP BY dataset ORDER BY dataset');
  return [
    '<h2 id="reverify">Examine and re-verify — don’t take the mirror’s word for it</h2>',
    '<ul>',
    '<li><b>Check the hashes.</b> Download any entry’s files (or its one-click zip) from the <a href="datasets/index.html">dataset index</a> and compare each sha256 against the entry’s <code>meta.json</code>.</li>',
    '<li><b>Follow a permalink.</b> Every “show the working” evidence link lands on the exact line of the archived source file at a pinned commit — the byte the claim rests on.</li>',
    `<li><b>Query the data yourself.</b> The <a href="${exploreHref}">Explore console</a> runs SQL over the combined database in your browser; every published figure should be reproducible from it.</li>`,
    '<li><b>Re-run the checks.</b> Clone ' + externalLink(REPO_URL, 'the repository') + ' and run the test suite: the reconstruction oracle, the explain oracle (every derived claim’s working reproduces its value) and the golden-master report checks all run from the committed data.</li>',
    '<li><b>Report something that looks wrong.</b> If a record, a flag or a figure looks off, ' + externalLink(`${REPO_URL}/issues`, 'open an issue') + ' — corrections land by adding sources, never by silently editing the record.</li>',
    '</ul>',
  ];
}

// Build fidelity.html at the site root. Returns the page URLs for the sitemap.
export function buildFidelityPage(outputDir: string, baseUrl: string = DEFAULT_BASE_URL): string[] {
  const archiveDir = defaultArchiveDir();
  const keys = listArchiveKeys().sort();
  const newestKey = keys[keys.length - 1];

  // The worked examples: real derived claims from the newest publication,
  // explained and rendered through the shared disclosure. The source is sliced
  // to just the example rows (positions kept) so this never emits the
  // whole-corpus ledger.
  const rendered: { heading: string; blurb: string; context: string; html: string }[] = [];
  let newestStats: Record<string, number> = {};
  if (newestKey !== undefined) {
    const statsPath = path.join(archiveDir, newestKey, 'stats.json');
    if (fs.existsSync(statsPath)) {
      newestStats = (JSON.parse(fs.readFileSync(statsPath, 'utf8')) as { callsignFlags?: Record<string, number> }).callsignFlags ?? {};
    }
    const meta = JSON.parse(fs.readFileSync(path.join(archiveDir, newestKey, 'meta.json'), 'utf8')) as ArchiveMeta;
    const ref = loadReferenceData();
    const source = loadOpenDataRegisterSource(archiveDir, newestKey, meta);
    const examples = chooseExamples(source, ref);
    const { slice, sliceOrdinalOf } = sliceObservations(source, examples.map(e => e.ordinal));
    const ledger = emitLedger(slice, ref);
    const commitSha = buildCommit();
    for (const example of examples) {
      const sliceOrdinal = sliceOrdinalOf.get(example.ordinal);
      if (sliceOrdinal === undefined) continue; // unreachable: the slice is built from these ordinals
      const claim = exampleClaim(example, ledger, sliceOrdinal);
      const working = explain(claim, ledger, ref);
      const line = slice.lineNumbers === undefined ? undefined : slice.lineNumbers[sliceOrdinal];
      const context = `From the publication of ${newestKey}${line === undefined ? '' : `, the row on line ${line.toLocaleString('en-GB')} of the archived source file`}.`;
      rendered.push({ ...EXAMPLE_BLURBS[example.kind], context, html: renderWorking(working, ledger, commitSha) });
    }
  }

  const body = [
    '<h1>Fidelity &amp; integrity</h1>',
    '<p class="lead">How the mirror keeps faith with its sources — and how you can check. This page elaborates the small fidelity notes shown beside records across the site: what the flags mean, where every value comes from, how derived values show their working, and how the whole archive is continuously re-verified.</p>',
    '<h2 id="about">What a fidelity note is (and is not)</h2>',
    '<p>The mirror reports <b>what the sources show</b>. When a value carries a quirk — a lowercase callsign, a spreadsheet artefact, a suffix on a withheld list — the mirror keeps the verbatim value, derives what it can, and <b>flags the observation</b> so nothing is silently transformed, inferred or dropped. A fidelity note is therefore an observation with evidence behind it, never a verdict about a record or the person it concerns.</p>',
    `<p>Two standing caveats apply everywhere: figures are <b>declared, not verified</b> (a publisher’s stated coverage is intent, not a guarantee), and <b>absence is not evidence</b> — a record missing from a snapshot tells you about the snapshot, not the world. See ${glossaryTerm('declared-complete', 0)} and the ${glossaryTerm('axis-confidence', 0, { label: 'confidence axis' })} in the glossary.</p>`,
    ...provenanceSection(),
    ...flagsSection(newestKey ?? '(no archive entries)', newestStats),
    ...consistencySection(),
    ...showWorkingSection(rendered),
    ...reconstructionSection(),
    ...reverifySection(),
  ];

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'fidelity.html'), htmlPage('Fidelity & integrity', 0, body, { currentNav: 'Reports', sourcePath: 'src/ci/build-fidelity-page.ts' }));
  return [`${baseUrl}/fidelity.html`];
}

function main(): void {
  const [outputDir, baseUrl] = process.argv.slice(2).filter(a => a.trim().length > 0);
  if (!outputDir) {
    console.error('usage: node src/ci/build-fidelity-page.ts <output-dir> [base-url]');
    process.exitCode = 1;
    return;
  }
  const urls = buildFidelityPage(outputDir, baseUrl);
  console.log(`fidelity page: ${urls.length} page`);
}

if (import.meta.main) {
  main();
}
