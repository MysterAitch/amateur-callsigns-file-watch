#!/usr/bin/env node

/**
 * Builds the published dataset index for GitHub Pages (issue #149 item 3):
 * a crawlable tree of per-entry pages that link the raw, extract and
 * normalised files themselves - all copied into the deploy artefact with
 * stable URLs - plus a Frictionless datapackage.json descriptor per entry
 * and a sitemap.xml. The index is the Wayback Machine crawl seed: index ->
 * entry pages -> data files, plain anchors throughout, no scripts.
 *
 * DELIBERATELY NOT COMMITTED: like the SQLite database (ADR 0003) this is
 * derived at deploy time from committed data. Output is deterministic for
 * unchanged inputs (no timestamps), so re-crawls only see changes when the
 * data changed.
 *
 * Descriptor choice: Frictionless Data (datapackage.json) over W3C CSVW -
 * one dataset-level JSON with a resources[] list (path, bytes, sha256,
 * description) fits the entry-directory shape directly, and column schemas
 * are derived from each CSV's own header so there is no second source of
 * truth to drift.
 *
 * Usage: node src/ci/build-dataset-pages.ts <output-dir> [base-url]
 */

import * as fs from 'fs';
import * as path from 'path';
import { listArchiveKeys } from '../shared/archive.ts';
import { derivedEntryFile, derivedEntryFileExists, derivedEntryFileNamesPresent, isDerivedEntryFile } from '../shared/derived-entries.ts';
import { CONSTANTS } from '../shared/utils.ts';
import { linkOrCopyFileSync } from '../shared/link-or-copy.ts';
import { listFoiEntryKeys, readFoiEntryMeta, type FoiEntryMeta, type FoiWitness } from '../shared/foi-archive.ts';
import { readPublisherRegister, channelIndex, publisherIndexById, publisherForChannel, authorPublisherId, type PublisherEntry } from '../shared/publishers.ts';
import { classifyWitnessAgreement, heldHashSet, type WitnessAgreement } from '../shared/witness-agreement.ts';
import { deriveTransitiveAuthority, renderTransitiveAuthority, transitiveVariantFromEnv } from './render/transitive-authority.ts';
import type { SourceAuthority } from '../shared/source-authority.ts';
import { buildPublisherPages, publisherHref } from './build-publisher-pages.ts';
import { renderMarkdown, renderInline } from '../shared/render-markdown.ts';
import { parseFlagRegistry } from './build-sqlite.ts';
import { parse } from 'csv-parse/sync';
import { buildZip } from '../shared/zip.ts';
import { buildForbiddenSection } from './build-forbidden-section.ts';
import { buildClassPages, classChipLink } from './build-class-pages.ts';
import { buildInterdatasetStats } from './build-interdataset-stats.ts';
import { buildFidelityPage } from './build-fidelity-page.ts';
import { fidelityHref, fidelityNudge, flagNudges } from './render/fidelity.ts';
import { reportAffordance } from './render/report.ts';
import { parseCallsign, cleanedCallsign, loadReferenceData, type ReferenceData } from '../sources/ofcom-amateur/components.ts';
import { time, perfReport } from '../shared/perf.ts';
import { parseCsvCached } from '../shared/parse-cache.ts';
import {
  REPO_URL,
  escapeHtml,
  formatBytes,
  sizeOf,
  humanDate,
  humaniseLabel,
  breakdownRows,
  noticeStrip,
  downloadSlot,
  placeholderSlot,
  downloadTier,
  breadcrumbHtml,
  htmlPage,
  entryPage,
  callsignPill,
  callsignField,
  statusField,
  licenceField,
  prefixSeriesField,
  prefixSeriesDisplay,
  prefixSeriesSlug,
  datasetLabel,
  exploreDeepLink,
  glossaryTerm,
  tableCaption,
  type CallsignComponents,
} from './site-render.ts';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const DEFAULT_BASE_URL = 'https://mysteraitch.github.io/amateur-callsigns-file-watch';

// Hard ceiling well under the GitHub Pages 1 GB site cap - fail loudly
// before a deploy that would silently degrade.
const MAX_TOTAL_BYTES = 900 * 1024 * 1024;

// Every open-data derivative is parsed with the same options: header row as
// keys, blank lines skipped, and a leading BOM tolerated.
const ARCHIVE_CSV_PARSE_OPTIONS = { columns: true, skip_empty_lines: true, bom: true } as const;

// A full-file parse of an archived open-data derivative is the build's heaviest
// read - a single publication's normalised.csv is ~158k rows - and several
// independent page sections parse the same file within one run (the glance
// breakdowns, the distribution charts, the publication summary, the series and
// forbidden-suffix sections). The shared process-lifetime memo
// (shared/parse-cache.ts) returns the parsed rows for an unchanged source file,
// keyed by absolute path plus last-modified time and the parse shape, so an
// edited file re-parses while those repeats collapse into one parse per file.
//
// The cached rows are treated as read-only by every caller (each only tallies,
// filters, or maps them), so returning the shared array is byte-identical to a
// fresh parse; the rebuild-determinism check still renders each build
// independently from these shared rows. The memo runs in the deploy as well as
// under test: it is provably idempotent, so there is no behaviour to keep off
// the published path, only repeated parses to save.
function parseArchiveCsv(filePath: string): Record<string, string>[] {
  return parseCsvCached(filePath, ARCHIVE_CSV_PARSE_OPTIONS, 'parse:archive-csv');
}

export interface DatasetPagesSummary {
  entryCount: number;
  fileCount: number;
  totalBytes: number;
  pageUrls: string[];
}

// Column names from a CSV's own header row - the honest schema source.
function csvHeaderFields(filePath: string): { name: string; type: string }[] | undefined {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(64 * 1024);
    const read = fs.readSync(fd, buffer, 0, buffer.length, 0);
    const text = buffer.toString('utf8', 0, read);
    const firstLine = text.split(/\r?\n/, 1)[0]?.replace(/^﻿/, '');
    if (firstLine === undefined || firstLine.length === 0) return undefined;
    // Header rows in this repository's derived CSVs are unquoted; raw
    // sources may not be - a quoted header falls back to no schema rather
    // than a wrong one.
    if (firstLine.includes('"')) return undefined;
    return firstLine.split(',').map(name => ({ name, type: 'string' }));
  } finally {
    fs.closeSync(fd);
  }
}

interface CopiedFile {
  name: string;
  bytes: number;
  description?: string;
  sha256?: string;
  schemaFields?: { name: string; type: string }[];
  // Present for markdown files: the rendered .html sibling written next to
  // the verbatim .md - the browsing default, with the raw file one click
  // away.
  renderedName?: string;
  // Pre-rendered witness links (recovered-from provenance), derived from
  // the entry's meta so page and meta cannot drift.
  witnessHtml?: string;
}

// Witness channel display names come from the publisher register (#618): the
// register is the single vocabulary that turns a channel token into a publisher
// name, so a token can no longer drift from an ad-hoc rendering map (issue
// #620). The register is validated in validate:data, so every token a page
// renders here is one the register knows; the index is read once, lazily.
let cachedChannelIndex: Map<string, PublisherEntry> | undefined;
function witnessChannelIndex(): Map<string, PublisherEntry> {
  cachedChannelIndex ??= channelIndex(readPublisherRegister());
  return cachedChannelIndex;
}

// The register keyed by publisher id, read once, lazily — used to name an
// entry's author (resolved by id from its sourceKey) on the published-by block.
let cachedPublisherById: Map<string, PublisherEntry> | undefined;
function publisherById(): Map<string, PublisherEntry> {
  cachedPublisherById ??= publisherIndexById(readPublisherRegister());
  return cachedPublisherById;
}

// "recovered from <publisher>, capture/fetched <date>" as clickable links. The
// resolved publisher name links to its page (issue #618, increment 2) — so a
// witness is a two-way link: the capture URL to verify the bytes, the publisher
// name to see everything else that publisher hosts and what basis the mirror
// holds it on. UKGWA URLs embed the capture timestamp - surface that; otherwise
// the fetch date. An unresolved token (never expected past validation) keeps the
// raw token with no page link rather than manufacturing one.
// The "when" clause for a witness: the capture date embedded in a UKGWA replay
// URL where present, else the recorded fetch date, else an honest "date not
// recorded" (some disclosure-log `live` copies carry no fetch timestamp) — never
// a fabricated or "undefined" date. Returns escaped, ready to render.
function witnessWhen(w: FoiWitness, capture: RegExpExecArray | null): string {
  if (capture !== null) return `capture ${capture[1]}-${capture[2]}-${capture[3]}`;
  return w.fetchedAt !== undefined && w.fetchedAt !== '' ? `fetched ${escapeHtml(w.fetchedAt)}` : 'fetch date not recorded';
}

// The agreement class a witness carries, phrased quietly (issue #618 increment
// 3). A corroborating witness says so — the mirror holds those exact bytes, and
// #619's "provable availability" is exactly this fact made visible. A divergent
// witness (a differing hash, always paired with a divergence record) is marked
// as differing. A citation-grade witness (no hash) renders nothing extra, so the
// affordance never manufactures doubt where no observation exists.
function agreementMarker(agreement: WitnessAgreement): string {
  switch (agreement) {
    case 'corroborating':
      return ' <small class="gap">(corroborating — the mirror holds these exact bytes, sha256 verified)</small>';
    case 'divergent':
      return ' <small class="gap">(diverges from the held copy — see the divergence record)</small>';
    case 'citation-grade':
      return '';
  }
}

function witnessLinks(witnesses: FoiWitness[] | undefined, heldHashes: ReadonlySet<string>, depthToRoot = 3): string {
  if (witnesses === undefined || witnesses.length === 0) return '';
  return witnesses.map(w => {
    const publisher = publisherForChannel(witnessChannelIndex(), w.channel);
    const channelName = publisher?.name ?? w.channel;
    const capture = /\/ukgwa\/(\d{4})(\d{2})(\d{2})/.exec(w.url);
    const when = witnessWhen(w, capture);
    const publisherLink = publisher === undefined
      ? escapeHtml(channelName)
      : `<a href="${publisherHref(publisher.id, depthToRoot)}">${escapeHtml(channelName)}</a>`;
    return ` · recovered from ${publisherLink} — <a href="${escapeHtml(w.url)}">${when}</a>${agreementMarker(classifyWitnessAgreement(w.sha256, heldHashes))}`;
  }).join('');
}

// The "Published by / witnessed at" block for an entry page (issue #618,
// increment 2): the AUTHOR (origin, derived from sourceKey) and the HOSTS
// (copies obtained, resolved from witness channels) as separate axes, each
// linking to its publisher page. Only DIRECT relationships exist in the data, so
// the wording labels them direct — transitive corroboration slots in later
// without re-architecting. Distinct witnesses are keyed by (channel, url) so a
// copy witnessed by several files lists once.
function publishedByBlock(sourceKey: string, witnesses: FoiWitness[], heldHashes: ReadonlySet<string>, entryAuthority: SourceAuthority, depthToRoot: number): string {
  const index = witnessChannelIndex();
  const variant = transitiveVariantFromEnv();
  const authorId = authorPublisherId(sourceKey);
  // The author is resolved by id (not by channel): an author may originate a
  // dataset without operating any witness channel of its own.
  const authorName = authorId === undefined ? undefined : (publisherById().get(authorId)?.name ?? authorId);

  const authorLine = authorId === undefined
    ? `<p><b>Author:</b> not resolved from source key <code>${escapeHtml(sourceKey)}</code> — flagged, not guessed. A dataset from an unmapped source is surfaced here rather than assigned a flattering author.</p>`
    : `<p><b>Author:</b> <a href="${publisherHref(authorId, depthToRoot)}">${escapeHtml(authorName ?? authorId)}</a> originated this dataset. Authorship is a claim about origin — it holds wherever a copy is held, and does not change with the venue a copy was served from. <small class="gap">(Direct.)</small></p>`;

  const seen = new Set<string>();
  const items: string[] = [];
  for (const w of witnesses) {
    const dedupeKey = `${w.channel} ${w.url}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    const publisher = publisherForChannel(index, w.channel);
    const name = publisher?.name ?? w.channel;
    const capture = /\/ukgwa\/(\d{4})(\d{2})(\d{2})/.exec(w.url);
    const when = witnessWhen(w, capture);
    const nameLink = publisher === undefined
      ? escapeHtml(name)
      : `<a href="${publisherHref(publisher.id, depthToRoot)}">${escapeHtml(name)}</a>`;
    const agreement = classifyWitnessAgreement(w.sha256, heldHashes);
    // Transitive authority (#618 increment 4): a corroborating copy proven
    // byte-identical to this entry's held bytes borrows their authority where
    // its own publisher ceiling is lower. Derived on read from the hash match;
    // the marker is always shown with its evidence link, own standing intact.
    const own = publisher?.authorityCeiling as SourceAuthority | undefined;
    const transitive = own === undefined ? '' : renderTransitiveAuthority(
      variant,
      deriveTransitiveAuthority(own, agreement === 'corroborating' ? entryAuthority : undefined),
      depthToRoot,
    );
    items.push(`<li>${nameLink} — <a href="${escapeHtml(w.url)}">${when}</a>${agreementMarker(agreement)}${transitive === '' ? '' : ` ${transitive}`}</li>`);
  }

  const hostLine = items.length === 0
    ? `<p><b>Witnessed at:</b> obtained directly from the author; no separate third-party witness is recorded for this copy.</p>`
    : `<p><b>Witnessed at:</b> ${items.length === 1 ? 'a copy was' : 'copies were'} obtained <b>directly</b> from the following ${items.length === 1 ? 'publisher' : 'publishers'} — a copy fetched straight from that venue. A copy marked <em>corroborating</em> is byte-identical to what the mirror holds (sha256 verified); transitive corroboration will be labelled distinctly when it lands.</p><ul>${items.join('')}</ul>`;

  return [
    '<section><h2>Published by / witnessed at</h2>',
    authorLine,
    hostLine,
    '</section>',
  ].join('\n');
}

// Places every file of an entry directory into the output tree and returns
// the manifest used by both the page and the descriptor. Each archived file is
// taken verbatim, so it is hardlinked to share the checkout's blocks rather
// than duplicated on disk (issue #646), falling back to a copy where linking is
// unavailable; either way the published bytes are identical. Markdown files
// (correspondence records, PDF transcription extracts) additionally get a
// rendered .html sibling for browsing; the verbatim .md remains the
// published record.
//
// resolveSource, when given, maps a file NAME to the path its bytes are taken
// from (the open-data lane routes its derived files through the archive/
// projection switch this way). names, when given, is the caller's own
// enumeration (the open-data lane unions the archive listing with the derived
// names present through the switch); the default enumeration is sourceDir's
// listing.
function copyEntryFiles(sourceDir: string, targetDir: string, descriptions: Map<string, string>, hashes: Map<string, string>, entryTitle: string, resolveSource?: (name: string) => string, names?: readonly string[]): CopiedFile[] {
  fs.mkdirSync(targetDir, { recursive: true });
  return [...(names ?? fs.readdirSync(sourceDir).sort())].map(name => {
    const sourcePath = resolveSource === undefined ? path.join(sourceDir, name) : resolveSource(name);
    linkOrCopyFileSync(sourcePath, path.join(targetDir, name));
    const bytes = fs.statSync(sourcePath).size;
    const schemaFields = name.endsWith('.csv') ? csvHeaderFields(sourcePath) : undefined;
    let renderedName: string | undefined;
    if (name.endsWith('.md')) {
      renderedName = `${name}.html`;
      const body = [
        `<p><small>Rendered from <a href="${encodeURIComponent(name)}">${escapeHtml(name)}</a> (the verbatim record) — part of <a href="index.html">${escapeHtml(entryTitle)}</a>.</small></p>`,
        '<hr>',
        renderMarkdown(fs.readFileSync(sourcePath, 'utf8')),
      ];
      fs.writeFileSync(path.join(targetDir, renderedName), htmlPage(`${name} — ${entryTitle}`, 3, body));
    }
    return { name, bytes, description: descriptions.get(name), sha256: hashes.get(name), schemaFields, renderedName };
  });
}

function dataPackage(name: string, title: string, files: CopiedFile[]): string {
  return JSON.stringify({
    name,
    title,
    homepage: REPO_URL,
    resources: files.map(file => ({
      name: file.name,
      path: file.name,
      bytes: file.bytes,
      ...(file.sha256 === undefined ? {} : { hash: `sha256:${file.sha256}` }),
      ...(file.description === undefined ? {} : { description: file.description }),
      ...(file.schemaFields === undefined ? {} : { schema: { fields: file.schemaFields } }),
    })),
  }, null, 2) + '\n';
}


interface SheetsIndicative {
  note?: string;
  sheets: { name: string; approxRows?: number; cols?: string; datasetClass?: string }[];
}

function asSheetsIndicative(value: unknown): SheetsIndicative | undefined {
  if (typeof value !== 'object' || value === null || !Array.isArray((value as SheetsIndicative).sheets)) return undefined;
  return value as SheetsIndicative;
}


// One deterministic zip per entry: every archived file, the
// datapackage.json descriptor, AND the lane's data dictionary (the
// committed authoritative sources, under docs/ inside the zip), so a
// single download carries the data, its provenance/integrity record and
// the vocabulary to interpret it. Zip bytes only change when content
// changes - timestamps are pinned by the writer - so a dictionary edit
// legitimately re-versions every zip that carries it. Returns the zip's
// byte size.
function writeEntryZip(sourceDir: string, targetDir: string, key: string, descriptorJson: string, dictionarySources: string[], resolveSource?: (name: string) => string, names?: readonly string[]): number {
  const entries = [...(names ?? fs.readdirSync(sourceDir).sort())].map(name => ({
    name,
    data: fs.readFileSync(resolveSource === undefined ? path.join(sourceDir, name) : resolveSource(name)),
  }));
  entries.push({ name: 'datapackage.json', data: Buffer.from(descriptorJson, 'utf8') });
  for (const source of dictionarySources) {
    entries.push({ name: `docs/${path.basename(source)}`, data: fs.readFileSync(path.join(REPO_ROOT, source)) });
  }
  const zip = buildZip(entries);
  fs.writeFileSync(path.join(targetDir, `${key}.zip`), zip);
  return zip.length;
}

// The lane-appropriate data dictionary: FOI entries carry the FOI schema
// registry; open-data entries carry the normalised schema and the flag
// registry their metrics reference.
const FOI_DICTIONARY_SOURCES = ['docs/foi-schemas.md'];
const OPEN_DATA_DICTIONARY_SOURCES = ['docs/normalised-schema.md', 'reference-data/flags.md'];

// A committed markdown source rendered onto the site as a themed HTML page.
interface RenderedDoc { source: string; slug: string; label: string; blurb: string }

// The repository's schema documentation, rendered onto the site so the
// published datasets are interpretable without the repo (two of the sources
// are themselves generated and freshness-tested). Module scope so both the
// dataset index and the reports hub can point at the same pages; their
// contextual citations elsewhere on the site stay where they are cited.
const DICTIONARY_DOCS: RenderedDoc[] = [
  { source: 'docs/normalised-schema.md', slug: 'normalised-schema', label: 'Open-data normalised schema', blurb: 'column-by-column definitions of every open-data publication’s <code>normalised.csv</code>, plus the line-accounting contract.' },
  { source: 'docs/foi-schemas.md', slug: 'foi-schemas', label: 'FOI dataset schemas', blurb: 'the dataset-class glossary, row-schema families, registered extension columns, and per-variant conversion detail behind every FOI <code>normalised--*.csv</code>.' },
  { source: 'reference-data/flags.md', slug: 'flags', label: 'Data-quality flag registry', blurb: 'the meaning and grounding of every anomaly flag used in the metrics and the lookup.' },
];

// The standing reports (issue #51): deterministic, sweep-regenerated views over
// the whole archive, committed as golden masters so a change in a diff is itself
// a signal. Rendered onto the site and indexed by the reports hub the "Reports"
// nav link lands on.
const STANDING_REPORTS: RenderedDoc[] = [
  { source: 'reports/value-catalogue.md', slug: 'value-catalogue', label: 'Value catalogue', blurb: 'every distinct value of the tracked fields across both lanes, with counts — a new one appearing in the diff is a drift signal.' },
  { source: 'reports/data-quality.md', slug: 'data-quality', label: 'Data-quality rollup', blurb: 'the callsign defect detectors, flag instances and parse statuses across the open-data lane, plus the FOI lane’s own unkeyable-row share.' },
  { source: 'reports/callsign-patterns.md', slug: 'callsign-patterns', label: 'Callsign pattern time-series', blurb: 'the distribution of structural callsign patterns across every publication.' },
  { source: 'reports/prefixes.md', slug: 'prefixes', label: 'Prefix-series distributions', blurb: 'how callsigns divide across prefix series (M0, 2E0, …) in each publication.' },
  { source: 'reports/regional-identifiers.md', slug: 'regional-identifiers', label: 'Regional-identifier distributions', blurb: 'the national/regional secondary locators seen across the corpus.' },
  { source: 'reports/class-product-mismatches.md', slug: 'class-product-mismatches', label: 'Class-product mismatches', blurb: 'every row whose licence class and licensing product disagree — a standing table of affected rows.' },
  { source: 'reports/cross-dataset-invariants.md', slug: 'cross-dataset-invariants', label: 'Cross-dataset invariants', blurb: 'the FOI available-pool snapshots joined against the register — depletion over time, the still-absent decomposition, the original-issue-date invariant, the available × record-of overlap matrix, and the same-vintage complementarity residual.' },
];

// Register-status prose that belongs with the reports rather than the data
// dictionary: the mirror's own per-dataset coverage/build status.
const STATUS_DOCS: RenderedDoc[] = [
  { source: 'docs/dataset-status.md', slug: 'dataset-status', label: 'Dataset status', blurb: 'the mirror’s per-dataset build and coverage status.' },
];


// ---- Redesigned entry-page components (variant Q, static half) ----

// Reconstructed-provenance notice: keeps the "reconstructed, not first-hand"
// caveat prominent in the always-visible summary, and discloses the entry's
// own reconstructionNotes (and the git commit it was recovered from, when
// known) inline — one click away, rather than sending the reader off to
// fetch meta.json. Notice styling matches noticeStrip; the disclosure is a
// details element (invalid nested inside noticeStrip's span), so it is built
// directly here.
function reconstructionNotice(provenance: string, reconstructionNotes?: string, gitCommitSha?: string): string {
  const caveat = `<em>Provenance: ${escapeHtml(provenance.replace(/-/g, ' '))} — not fetched first-hand by the mirror.</em>`;
  const detail: string[] = [];
  if (reconstructionNotes !== undefined) detail.push(`<p>${escapeHtml(reconstructionNotes)}</p>`);
  if (gitCommitSha !== undefined) detail.push(`<p>Recovered from git commit <code>${escapeHtml(gitCommitSha)}</code>.</p>`);
  detail.push(`<p><small>Full provenance and integrity record in <a href="meta.json">meta.json</a> · <a href="${fidelityHref(3, 'provenance')}">how the mirror records provenance and custody</a>.</small></p>`);
  return `<details class="notice provenance"><summary><span aria-hidden="true">ⓘ</span> ${caveat}</summary><div class="pdetail">${detail.join('')}</div></details>`;
}

// Coverage / provenance / verified-quality notices as full-width strips
// above the two-column region. Safety information (a coverage-affecting
// quality observation) renders amber.
function coverageNotices(meta: {
  provenance?: string;
  reconstructionNotes?: string;
  gitCommitSha?: string;
  intendedCoverage?: { complete: boolean; scopeNotes?: string };
  qualityObservations?: { statement: string; evidence: string; coverageAffecting?: boolean }[];
}): string[] {
  const out: string[] = [];
  if (meta.provenance !== undefined && meta.provenance !== 'live') {
    out.push(reconstructionNotice(meta.provenance, meta.reconstructionNotes, meta.gitCommitSha));
  }
  if (meta.intendedCoverage?.complete === false) {
    out.push(noticeStrip(true, `<b>Declared-partial publication:</b> ${escapeHtml(meta.intendedCoverage.scopeNotes ?? 'the publisher presented this as a partial dataset')}. Absence of a callsign from this publication is not evidence of anything.`));
  } else if (meta.intendedCoverage?.complete === true) {
    out.push(noticeStrip(false, `Declared <b>complete</b> — the publisher's stated intent, not a verified guarantee. <a href="../../docs/normalised-schema.html">How we read coverage →</a>`));
  }
  for (const o of meta.qualityObservations ?? []) {
    const lead = o.coverageAffecting === true ? '<b>Data-quality caveat (affects coverage):</b> ' : '<b>Data-quality note:</b> ';
    out.push(noticeStrip(o.coverageAffecting === true, `${lead}${escapeHtml(o.statement)} <small>(${escapeHtml(o.evidence)})</small>`));
  }
  return out;
}

interface InspectTab { id: string; label: string; panel: string }

// Deep-linkable :target tabs (pure CSS, hash survives reload). The first
// panel shows by default; the active tab is highlighted via :has().
function inspectTabsHtml(tabs: InspectTab[]): string {
  if (tabs.length === 0) return '';
  const activeRules = tabs.map(t => `.tabs:has(#${t.id}:target) a[href="#${t.id}"]`).join(',')
    + `,.tabs:not(:has(.panel:target)) a[href="#${tabs[0].id}"]`;
  return [
    '<section class="tabs">',
    `<style>${activeRules}{background:var(--accent);color:#fff;border-color:var(--accent)}</style>`,
    '<h2>Inspect a file</h2>',
    `<div class="tablist">${tabs.map(t => `<a href="#${t.id}">${escapeHtml(t.label)}</a>`).join('')}</div>`,
    ...tabs.map((t, i) => `<div class="panel${i === 0 ? ' first' : ''}" id="${t.id}">${t.panel}</div>`),
    '</section>',
  ].join('\n');
}

// A CSV file's own column list, rendered from its header row.
function csvSchemaPanel(filePath: string, rowNote: string): string {
  const fields = csvHeaderFields(filePath);
  if (fields === undefined) return `<p class="lead">${escapeHtml(rowNote)}</p>`;
  return `<p class="lead">${escapeHtml(rowNote)} · ${fields.length} columns.</p><table>${tableCaption('Columns in this file')}<thead><tr><th scope="col">column</th></tr></thead><tbody>${fields.map(f => `<tr><td><code>${escapeHtml(f.name)}</code></td></tr>`).join('')}</tbody></table>`;
}

// Marks a breakdown row / chart element as a filter trigger for the scoped
// browser: clicking toggles this column=value into the shared facet set.
function facetAttr(col: string, value: string): string {
  return ` data-filter-col="${col}" data-filter-val="${escapeHtml(value)}" role="button" tabindex="0"`;
}

// Status and implied-class distributions for an open-data publication,
// read from its normalised.csv (status) and components.csv (implied_class,
// prefix_series). The RSL matrix used to be the components consumer on
// entry pages; it has moved to the statistics home, so this read replaces
// it rather than adding one.

function openDataBreakdowns(key: string): {
  recordCount: number;
  status: [string, number][];
  impliedClass: [string, number][];
  declared: [string, number][];
  prefixes: [string, number][];
  prefixLevel: Map<string, string>;
  international: number;
  flaggedRows: number;
  forbiddenTotal: number;
  forbiddenSince: number;
} {
  const statusRows = parseArchiveCsv(derivedEntryFile(key, 'normalised.csv'));
  const componentRows = parseArchiveCsv(derivedEntryFile(key, 'components.csv'));
  // Empty is a distinct, meaningful bucket (a record the source left blank,
  // or an unparseable callsign with no series) - counted as '' and humanised
  // at display, never silently dropped.
  const tally = (rows: Record<string, string>[], column: string): Map<string, number> => {
    const m = new Map<string, number>();
    for (const r of rows) { const v = (r[column] ?? '').trim(); m.set(v, (m.get(v) ?? 0) + 1); }
    return m;
  };
  const prefixLevel = new Map<string, string>();
  for (const r of componentRows) {
    const p = (r.prefix_series ?? '').trim();
    if (p !== '' && !prefixLevel.has(p)) prefixLevel.set(p, (r.implied_class ?? '').trim());
  }
  const flaggedRows = componentRows.filter(r => (r.flags ?? '') !== '').length;
  const international = componentRows.filter(r => (r.callsign ?? '').includes('/')).length;
  // Forbidden-suffix cohort: the whole flagged set, and the subset that also
  // carries the forbidden-suffix-issued-after-first-known-list flag - issued
  // after the suffix's own first-known-forbidden date rather than a flat
  // list-wide boundary (re-issues and artefacts are innocent explanations;
  // see issue #179). Counting the flag keeps this affordance in step with the
  // per-suffix flag population its drill-down links to.
  let forbiddenTotal = 0; let forbiddenSince = 0;
  for (const r of componentRows) {
    const flags = (r.flags ?? '').split(';');
    if (!flags.includes('forbidden-suffix')) continue;
    forbiddenTotal += 1;
    if (flags.includes('forbidden-suffix-issued-after-first-known-list')) forbiddenSince += 1;
  }
  const sortDesc = (m: Map<string, number>, n?: number): [string, number][] =>
    [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n);
  return {
    recordCount: statusRows.length,
    status: sortDesc(tally(statusRows, 'status')),
    impliedClass: sortDesc(tally(componentRows, 'implied_class')),
    declared: sortDesc(tally(statusRows, 'product')),
    prefixes: sortDesc(tally(componentRows, 'prefix_series')),
    prefixLevel,
    international,
    flaggedRows,
    forbiddenTotal,
    forbiddenSince,
  };
}

// A static preview of a CSV's first rows (reads only the head buffer, not
// the whole 158k-row file). Columns with no value in the sample are
// dropped so the preview stays legible.
// The reference data (prefix formats, RSL letters, forbidden suffixes) the
// callsign parser needs, read at most once per build - many entry pages are
// rendered in one run and each would otherwise re-read the same files.
let cachedReferenceData: ReferenceData | undefined;
function referenceData(): ReferenceData {
  cachedReferenceData ??= loadReferenceData();
  return cachedReferenceData;
}

// The registered flag names (reference-data/flags.md), read at most once per
// build: the per-record fidelity nudges deep-link a registered flag to its own
// row on the deep-dive page, and land an unregistered one on the section
// heading instead (the anchor-honesty rule in render/fidelity.ts).
let cachedRegisteredFlags: ReadonlySet<string> | undefined;
function registeredFlags(): ReadonlySet<string> {
  cachedRegisteredFlags ??= new Set(parseFlagRegistry().map(r => r.flag));
  return cachedRegisteredFlags;
}

// A callsign preview cell: the shared pill (accessible name = the bare
// callsign, linking to the register lookup at the given depth), with the
// supplementary title built from the same parser used everywhere. A blank
// callsign carries no pill - there is nothing to look up - and an unparseable
// value degrades to the bare callsign with no title. When the record carries
// data-quality flags they follow the pill as inline fidelity nudges (issue
// #438) — each linking to that flag's row on the deep-dive page — and a
// record with no flags renders the pill alone, so the affordance never
// manufactures doubt where no observation exists.
function callsignCell(callsign: string, licenceClass: string, depthToRoot: number, flags: readonly string[] = []): string {
  if (callsign === '') return '<td></td>';
  const comp = parseCallsign(callsign, licenceClass, referenceData());
  const pill = callsignPill(callsign, depthToRoot, {
    prefixSeries: comp.prefixSeries,
    rsl: comp.rsl,
    suffix: comp.suffix,
    licenceClass: comp.impliedClass,
  });
  const nudges = flagNudges(flags, depthToRoot, registeredFlags());
  return `<td>${pill}${nudges === '' ? '' : ` ${nudges}`}</td>`;
}

// Static, crawlable preview of a normalised CSV's first rows. When
// pillCallsignDepth is given, any 'callsign' column is rendered with the shared
// callsign pill (issue #310) so the register/observation tables present a
// callsign the same way as the rest of the site; omit it (the default) and the
// table is byte-for-byte the plain-text form, so previews with no callsign
// column - and callers that do not opt in - are unchanged. `flagsByCallsign`
// (issue #438) joins each previewed record to its data-quality flags
// (components.csv), rendered as inline fidelity nudges beside the pill; omit
// it for sources with no per-record flag join (e.g. FOI extracts), whose
// previews are then unchanged.
function csvPreviewTable(filePath: string, pillCallsignDepth?: number, sampleSize = 12, flagsByCallsign?: ReadonlyMap<string, string>): string {
  if (!fs.existsSync(filePath)) return '';
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.alloc(128 * 1024);
  const read = fs.readSync(fd, buffer, 0, buffer.length, 0);
  fs.closeSync(fd);
  const lines = buffer.toString('utf8', 0, read).split('\n').filter(l => l.length > 0).slice(0, sampleSize + 1);
  if (lines.length < 2) return '';
  const rows = parse(lines.join('\n'), { columns: true, bom: true }) as Record<string, string>[];
  const headers = Object.keys(rows[0]).filter(h => rows.some(r => (r[h] ?? '') !== ''));
  const head = headers.map(h => `<th scope="col">${escapeHtml(h)}</th>`).join('');
  const flagsFor = (callsign: string): string[] => {
    const joined = flagsByCallsign?.get(callsign) ?? '';
    return joined === '' ? [] : joined.split(';');
  };
  // A 'status' or licence-class/product column (#553) routes through the
  // shared field wrappers so a previewed raw row reads consistently with the
  // rest of the site. Status is pinned to 'plain' (drift-guard): this preview
  // repeats the same handful of values across up to `sampleSize` rows, where
  // the glossary affordance on every one would be noise, not help.
  const body = rows.map(r => `<tr>${headers.map(h => {
    if (pillCallsignDepth !== undefined && h === 'callsign') return callsignCell(r[h] ?? '', r['licence_class'] ?? '', pillCallsignDepth, flagsFor(r[h] ?? ''));
    if (h === 'status') return `<td>${statusField(r[h] ?? '', { glossaryLinking: 'plain' })}</td>`;
    if (h === 'product' || h === 'licence_class') return `<td>${licenceField(r[h] ?? '')}</td>`;
    return `<td>${escapeHtml(r[h] ?? '')}</td>`;
  }).join('')}</tr>`).join('');
  return `<div style="overflow-x:auto"><table>${tableCaption(`Preview — first ${rows.length} rows of this file`)}<thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

// The anomaly-flag table (first-sentence meanings + registry link), used
// in the stats.json inspect panel.
function anomalyFlagsHtml(flags: Record<string, number>): string {
  const registry = new Map(parseFlagRegistry().map(r => [r.flag, r.meaning]));
  const entries = Object.entries(flags).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return '<p class="lead">No data-quality flags recorded.</p>';
  const rows = entries.map(([flag, count]) => {
    const meaning = (registry.get(flag) ?? '').split(/(?<=\.)\s/, 1)[0];
    return `<tr><td><code>${escapeHtml(flag)}</code></td><td class="n">${count.toLocaleString('en-GB')}</td><td>${renderInline(meaning)} <a href="../../docs/flags.html">registry →</a></td></tr>`;
  }).join('');
  return `<table>${tableCaption('Data-quality flags recorded, with row counts and meanings')}<thead><tr><th scope="col">flag</th><th scope="col" class="n">rows</th><th scope="col">meaning</th></tr></thead><tbody>${rows}</tbody></table>`;
}

// The At-a-glance sidebar for an open-data publication: headline count,
// status/licence-level breakdowns with bars, largest prefixes (linked to
// their series pages), attribution, and the Notable coda.
function atAGlanceOpenData(key: string, previousKey: string | undefined, stats: OpenDataStats, meta: {
  sourceUrl?: string; ofcomReportedUpdateIso?: string; ofcomReportedUpdate?: string; fetchedAt?: string;
  diffSummary?: OpenDataDiffSummary;
}): string {
  const bd = openDataBreakdowns(key);
  const allocatedCount = bd.status.find(([s]) => s === 'Allocated')?.[1] ?? 0;

  // Notable: computed findings with the drill-downs Roger asked to keep.
  // Row-level filtered links are correct only for the latest publication
  // (the whole-register lookup ≈ this publication); the scoped, per-
  // publication browser in 3b makes them exact for every entry.
  const notable: string[] = [];
  // The forbidden-suffix cohort is the interesting story, not the raw count:
  // two filter links - the whole flagged set, and the narrower "issued while
  // the withheld list existed" subset (the second only when non-empty).
  if (bd.forbiddenTotal > 0) {
    const allSql = `SELECT callsign, cleaned, status, prefix_series, implied_class FROM register_history WHERE dataset = '${key}' AND suffix IN (SELECT suffix FROM ref_forbidden_suffixes) ORDER BY callsign`;
    const sinceSql = `SELECT callsign, status, prefix_series, licence_version_original_start_date AS issued FROM register_history WHERE dataset = '${key}' AND ';' || flags || ';' LIKE '%;forbidden-suffix-issued-after-first-known-list;%' ORDER BY issued`;
    const sinceLink = bd.forbiddenSince > 0
      ? ` — <a href="#" data-browser-sql="${escapeHtml(sinceSql)}"><b>${bd.forbiddenSince.toLocaleString('en-GB')}</b> issued after the suffix was first withheld</a>, worth a look`
      : '';
    notable.push(`<li><a href="#" data-browser-sql="${escapeHtml(allSql)}"><b>${bd.forbiddenTotal.toLocaleString('en-GB')}</b> withheld-suffix</a> (mostly legacy holders)${sinceLink}.</li>`);
  }
  const topFlag = Object.entries(stats.callsignFlags).sort((a, b) => b[1] - a[1])[0];
  if (topFlag !== undefined && topFlag[0] !== 'forbidden-suffix') notable.push(`<li><b>${topFlag[1].toLocaleString('en-GB')}</b> rows flagged <a href="../../docs/flags.html"><code>${escapeHtml(topFlag[0])}</code></a>.</li>`);
  const unparseable = stats.parseStatuses.unparseable ?? 0;
  if (unparseable > 0) notable.push(`<li><b>${unparseable.toLocaleString('en-GB')}</b> callsign${unparseable === 1 ? '' : 's'} don't parse — likely upstream corruption.</li>`);
  const diff = meta.diffSummary;
  if (diff !== undefined && diff.previousArchiveKey === key && previousKey !== undefined) {
    notable.push(`<li class="rel"><b>Re-fetch:</b> byte-identical to the earlier fetch. Compare with <a href="../${escapeHtml(previousKey)}/index.html">${humanDate(previousKey)}</a>.</li>`);
  } else if (diff !== undefined) {
    notable.push(`<li class="rel"><b>vs <a href="../${escapeHtml(diff.previousArchiveKey)}/index.html">${humanDate(diff.previousArchiveKey)}</a>:</b> ${diff.added.toLocaleString('en-GB')} added, ${diff.removed.toLocaleString('en-GB')} removed, ${diff.fieldChanged.toLocaleString('en-GB')} changed.</li>`);
  }

  const publishedIso = meta.ofcomReportedUpdateIso ?? key;
  // Breakdown row with the shared bar + %; the prefix rows carry a
  // de-emphasised inferred level, the declared-level rows a shortened
  // product. All are click-to-filter facets.
  const bar = (n: number): string => {
    const pct = bd.recordCount > 0 ? Math.round((n / bd.recordCount) * 100) : 0;
    return `<span class="pct">${pct === 0 && n > 0 ? '<1%' : `${pct}%`}</span><b>${n.toLocaleString('en-GB')}</b><span class="barbg" style="width:${Math.min(pct, 100)}%"></span>`;
  };
  // The shared licence field wrapper (#553), pinned to the shortened form
  // (drift-guard): this row is tight on width and would otherwise repeat the
  // source's own boilerplate ('Amateur … Radio Licence') on every line; the
  // full declared string still rides in the title, never dropped.
  const shortProduct = (p: string): string => licenceField(p, { form: 'shortened' });
  // The prefix label FILTERS on click (the row is the facet trigger); the
  // small ↗ is the only link, to the series page (the row handler ignores
  // clicks on <a>). Previously the whole label navigated, surprising anyone
  // expecting a filter.
  const prefixRows = bd.prefixes.map(([p, n]) => {
    const level = bd.prefixLevel.get(p) ?? '';
    const tag = level === '' ? '' : ` <small class="lvl">${escapeHtml(level.toLowerCase())}</small>`;
    // A blank prefix series has no series page (the series generator skips it),
    // so it carries no ↗ series-nav link - the row stays a filter-only target
    // rather than pointing at a non-existent series/.html. The label itself
    // routes through the shared prefix-series field wrapper (#644), so a
    // blank bucket (an unparseable callsign has no series) is humanised
    // rather than rendering an invisible label. The row is its own
    // click-to-filter facet target (role="button"), so the label stays plain
    // content - not the wrapper's own opt-in link - matching the ↗ arrow
    // staying the one navigation affordance beside it.
    const seriesNav = prefixSeriesSlug(p) === '' ? '' : ` <a class="seriesnav" href="../../../series/${prefixSeriesSlug(p)}.html" aria-label="${escapeHtml(prefixSeriesDisplay(p))} series page">↗</a>`;
    return `<div class="brow"${facetAttr('prefix_series', p)}><span class="lab">${prefixSeriesField(p, { blankLabel: '(unparseable — no series)' })}${tag}${seriesNav}</span>${bar(n)}</div>`;
  }).join('');
  const declaredRows = bd.declared.map(([p, n]) => `<div class="brow"${facetAttr('product', p)}><span class="lab">${shortProduct(p)}</span>${bar(n)}</div>`).join('');
  const intlExpr = "CASE WHEN callsign LIKE '%/%' THEN 'yes' ELSE 'no' END";
  return [
    '<section>',
    '<h2>At a glance</h2>',
    `<div class="headline">${bd.recordCount.toLocaleString('en-GB')} <small>register rows · ${allocatedCount.toLocaleString('en-GB')} allocated</small></div>`,
    // Both breakdowns route their labels through the shared field wrapper
    // (#553). Status is pinned to 'plain' (drift-guard): each row is itself a
    // click-to-filter role="button" target (facetAttr), and a glossary <a>
    // nested inside one would be a nested-interactive-control anti-pattern.
    bd.status.length > 0 ? `<div class="bd"><h3>${glossaryTerm('status-values', 3, { label: 'Status' })}</h3>${breakdownRows(bd.status, bd.recordCount, undefined, label => facetAttr('status', label), label => statusField(label, { glossaryLinking: 'plain' }))}</div>` : '',
    bd.impliedClass.length > 0 ? `<div class="bd"><h3>${glossaryTerm('licence-class', 3, { label: 'Licence level' })} (implied)</h3>${breakdownRows(bd.impliedClass, bd.recordCount, undefined, label => facetAttr('implied_class', label), label => licenceField(label))}</div>` : '',
    bd.declared.length > 0 ? `<div class="bd"><h3>${glossaryTerm('licence-class', 3, { label: 'Licence level' })} (declared)</h3>${declaredRows}</div>` : '',
    bd.prefixes.length > 0 ? `<div class="bd"><h3>${glossaryTerm('prefix-series', 3, { label: 'Prefixes' })} <small class="lvl">— all ${bd.prefixes.length}, with inferred level</small></h3><div class="prefixscroll">${prefixRows}</div><div class="brow"><a href="../../../series/index.html">all series →</a></div></div>` : '',
    bd.international > 0 ? `<div class="bd"><h3>International / visitor</h3><div class="brow" data-filter-expr="${escapeHtml(intlExpr)}" data-filter-val="yes" data-filter-label="international" role="button" tabindex="0"><span class="lab">contain <code>/</code> (e.g. <code>M/</code>) — country lookup planned</span>${bar(bd.international)}</div></div>` : '',
    // Dataset class: an open-data publication is the register state at a
    // vintage, so it is classified (declared, from the lane's shape) as a
    // register-snapshot; the chip links to every entry of that class.
    `<div class="bd"><h3>${glossaryTerm('dataset-class', 3, { label: 'Dataset class' })}</h3><div class="brow"><span class="lab">${classChipLink('register-snapshot', '../../')} <small class="lvl">declared</small></span></div></div>`,
    '<div class="attr">',
    `<div><b>Source</b> · ${meta.sourceUrl !== undefined ? `<a href="${escapeHtml(meta.sourceUrl)}">Ofcom open-data page →</a>` : 'Ofcom open-data page'}</div>`,
    `<div>Published ${escapeHtml(humanDate(publishedIso))}${meta.fetchedAt !== undefined ? ` · fetched ${escapeHtml(humanDate(meta.fetchedAt.slice(0, 10)))}` : ''}</div>`,
    `<div>${bd.flaggedRows.toLocaleString('en-GB')} rows carry a quality flag · ${fidelityNudge(3, { section: 'flags', label: 'what flags mean', about: 'what data-quality flags mean (observations, not verdicts)' })}</div>`,
    '</div>',
    notable.length > 0 ? `<div class="notable"><h3>Notable</h3><ul>${notable.join('')}</ul></div>` : '',
    '</section>',
  ].filter(s => s !== '').join('\n');
}

// An accessible, progressive-enhancement bar chart: the data table IS the
// content (crawlable, screen-reader-native, survives with no SVG); the
// inline SVG is a visual layer over it inside a <figure>. The SVG carries
// role="img" + <title>/<desc> for a spoken summary, a per-bar <title> for
// hover, and text value labels (never colour/height alone). Theme-aware via
// the CSS custom properties; no client JS, no charting dependency (d3 and
// friends belong in the interactive downstream graph layer, not this
// static record).
// facetExpr, when given, is a SQL expression (e.g. CAST(LENGTH(callsign) AS
// TEXT)) that both the bars and the data-table rows carry as a filter
// trigger, so clicking a bar toggles that value into the scoped browser's
// facet set (crossfilter-style coordination). Trusted build-time SQL only.
function svgBarChart(idBase: string, heading: string, summary: string, unit: string, data: [string, number][], facetExpr?: string): string {
  if (data.length === 0) return '';
  const max = Math.max(...data.map(d => d[1]));
  const width = 600; const chartH = 150; const padTop = 12; const padBottom = 28; const gap = data.length > 40 ? 1 : 2;
  const barW = (width - (data.length - 1) * gap) / data.length;
  const labelEvery = data.length <= 14 ? 1 : Math.ceil(data.length / 12);
  const parts = data.map(([label, n], i) => {
    const shown = escapeHtml(humaniseLabel(label));
    const h = max > 0 ? (n / max) * chartH : 0;
    const x = i * (barW + gap);
    const y = padTop + (chartH - h);
    const cx = (x + barW / 2).toFixed(1);
    const value = data.length <= 14 ? `<text x="${cx}" y="${(y - 2).toFixed(1)}" text-anchor="middle" font-size="9" fill="var(--muted)">${n.toLocaleString('en-GB')}</text>` : '';
    // Bar and axis tick carry the same facet trigger: in a highly skewed
    // distribution a tiny bar is a near-single-pixel click target, so the
    // label under it keeps the category clickable too.
    const trigger = facetExpr === undefined ? '' : ` role="button" tabindex="0" data-filter-expr="${escapeHtml(facetExpr)}" data-filter-val="${escapeHtml(label)}"`;
    const tick = i % labelEvery === 0 ? `<text x="${cx}" y="${(padTop + chartH + 14).toFixed(1)}" text-anchor="middle" font-size="9" fill="var(--muted)"${trigger === '' ? '' : ` class="tickfilter"${trigger}`}>${shown}</text>` : '';
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(barW, 0.5).toFixed(1)}" height="${h.toFixed(1)}" fill="var(--accent)"${trigger === '' ? '' : ` class="barfilter"${trigger}`}><title>${shown}: ${n.toLocaleString('en-GB')}</title></rect>${value}${tick}`;
  }).join('');
  // Bars and data-table rows both toggle the value into the scoped browser
  // (crossfilter-style): clicking adds to the current filters, not replaces.
  const tableRows = data.map(([label, n]) => {
    const attrs = facetExpr === undefined ? '' : ` class="explore" role="button" tabindex="0" data-filter-expr="${escapeHtml(facetExpr)}" data-filter-val="${escapeHtml(label)}"`;
    return `<tr${attrs}><td>${escapeHtml(humaniseLabel(label))}</td><td class="n">${n.toLocaleString('en-GB')}</td></tr>`;
  }).join('');
  const exploreHint = facetExpr === undefined ? '' : ' — click a bar or row to filter the browser above';
  // The SVG is pinned to its native min-width (page.ts's `.chart svg`, #655)
  // so its labels never shrink below legibility; below that width the
  // overflow wrapper scrolls the chart horizontally rather than the whole
  // page, matching the convention used for wide tables elsewhere.
  return `<figure class="chart"><figcaption>${escapeHtml(heading)}</figcaption>`
    + `<div class="overflow" style="overflow-x:auto">`
    + `<svg viewBox="0 0 ${width} ${padTop + chartH + padBottom}" role="img" aria-labelledby="${idBase}-t ${idBase}-d" preserveAspectRatio="xMidYMid meet">`
    + `<title id="${idBase}-t">${escapeHtml(heading)}</title><desc id="${idBase}-d">${escapeHtml(summary)}</desc>${parts}</svg>`
    + `</div>`
    + `<details><summary>Data table${exploreHint}</summary><table>${tableCaption(`${heading} — the figures behind the chart`)}<thead><tr><th scope="col">${escapeHtml(unit)}</th><th scope="col" class="n">callsigns</th></tr></thead><tbody>${tableRows}</tbody></table></details></figure>`;
}

// Per-publication distributions computed at build: callsign length, issue
// year (from the best available start-date column), and issuance in the
// trailing 12 months before THIS publication's date (anchored on the
// publication date, not today, so the build stays reproducible), split by
// implied licence level.
function distributions(key: string): {
  length: [string, number][];
  suffixLength: [string, number][];
  issueYear: [string, number][];
  recentByClass: [string, number][];
  dateColumn: string | undefined;
} {
  const normRows = parseArchiveCsv(derivedEntryFile(key, 'normalised.csv'));
  const compRows = parseArchiveCsv(derivedEntryFile(key, 'components.csv'));
  const classByCallsign = new Map(compRows.map(r => [r.callsign, r.implied_class]));

  const lengthMap = new Map<number, number>();
  for (const r of normRows) { const len = (r.callsign ?? '').length; if (len > 0) lengthMap.set(len, (lengthMap.get(len) ?? 0) + 1); }
  const length = [...lengthMap.entries()].sort((a, b) => a[0] - b[0]).map(([l, n]): [string, number] => [String(l), n]);

  // Suffix length distinguishes heritage 2-letter callsigns (the G2 series
  // and older G/M holders) from the modern 3-letter allocations.
  const suffixLengthMap = new Map<number, number>();
  for (const r of compRows) { const len = (r.suffix ?? '').length; if (len > 0) suffixLengthMap.set(len, (suffixLengthMap.get(len) ?? 0) + 1); }
  const suffixLength = [...suffixLengthMap.entries()].sort((a, b) => a[0] - b[0]).map(([l, n]): [string, number] => [String(l), n]);

  const dateColumn = ['licence_version_original_start_date', 'created_date'].find(c => normRows.some(r => (r[c] ?? '') !== ''));
  const pubDate = /^\d{4}-\d{2}-\d{2}$/.test(key) ? Date.parse(`${key}T00:00:00Z`) : NaN;
  const cutoff = Number.isNaN(pubDate) ? NaN : pubDate - 365 * 24 * 3600 * 1000;
  const yearMap = new Map<string, number>();
  const recentMap = new Map<string, number>();
  if (dateColumn !== undefined) {
    for (const r of normRows) {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(r[dateColumn] ?? '');
      if (m === null) continue;
      yearMap.set(m[1], (yearMap.get(m[1]) ?? 0) + 1);
      if (!Number.isNaN(cutoff)) {
        const rowDate = Date.parse(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
        if (rowDate >= cutoff && rowDate <= pubDate) {
          const cls = classByCallsign.get(r.callsign);
          const clsLabel = cls === undefined || cls === '' ? '(unclassified)' : cls;
          recentMap.set(clsLabel, (recentMap.get(clsLabel) ?? 0) + 1);
        }
      }
    }
  }
  const issueYear = [...yearMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([y, n]): [string, number] => [y, n]);
  const recentByClass = [...recentMap.entries()].sort((a, b) => b[1] - a[1]);
  return { length, suffixLength, issueYear, recentByClass, dateColumn };
}

function distributionsSection(key: string): string[] {
  const dist = distributions(key);
  if (dist.length.length === 0 && dist.issueYear.length === 0) return [];
  const dateLabel = dist.dateColumn === 'created_date' ? 'record creation' : 'licence start';
  const recentTotal = dist.recentByClass.reduce((a, b) => a + b[1], 0);
  return [
    '<section><h2>Distributions</h2>',
    dist.length.length > 0 ? svgBarChart('dist-length', 'Callsign length', `Number of callsigns of each length in characters, from ${dist.length[0][0]} to ${dist.length[dist.length.length - 1][0]}.`, 'length (characters)', dist.length, 'CAST(LENGTH(callsign) AS TEXT)') : '',
    dist.suffixLength.length > 0 ? svgBarChart('dist-suffixlen', 'Suffix length', 'Callsigns by suffix length — 2-letter suffixes are heritage (G2 series and older holders), 3-letter the modern allocations.', 'suffix length', dist.suffixLength, 'CAST(LENGTH(suffix) AS TEXT)') : '',
    dist.issueYear.length > 0 && dist.dateColumn !== undefined ? svgBarChart('dist-year', `Issue year (by ${dateLabel})`, `Callsigns by year of ${dateLabel}, from ${dist.issueYear[0][0]} to ${dist.issueYear[dist.issueYear.length - 1][0]}.`, 'year', dist.issueYear, `substr("${dist.dateColumn}", 1, 4)`) : '',
    dist.recentByClass.length > 0 ? `<h3 style="font-size:.92rem;margin:.3rem 0 .4rem">New in the 12 months to ${escapeHtml(humanDate(key))}, by licence level (${recentTotal.toLocaleString('en-GB')} total)</h3>${breakdownRows(dist.recentByClass, recentTotal, undefined, undefined, label => licenceField(label))}` : '',
    '</section>',
  ].filter(s => s !== '');
}

function buildFoiEntry(outputDir: string, foiDir: string, key: string, summaries: PublicationSummary[], foiEntries: FoiNavEntry[], pageUrl: string): { files: CopiedFile[]; meta: FoiEntryMeta; zipBytes: number } {
  const meta = readFoiEntryMeta(foiDir, key);
  const descriptions = new Map<string, string>();
  const hashes = new Map<string, string>();
  for (const [name, decl] of Object.entries(meta.files)) {
    const parts = [decl.role, decl.contentsIndicative].filter((p): p is string => p !== undefined);
    descriptions.set(name, parts.join(' — '));
    hashes.set(name, decl.sha256);
  }
  descriptions.set('meta.json', 'provenance, outcome, and hash-pinned file declarations');
  // The bytes the mirror holds for this entry, for deriving witness agreement on
  // read (#618 increment 3): a witness whose sha256 matches any held copy is
  // corroborating.
  const heldHashes = heldHashSet(Object.values(meta.files).map(f => f.sha256));
  const targetDir = path.join(outputDir, 'datasets', 'foi', key);
  const files = copyEntryFiles(path.join(foiDir, key), targetDir, descriptions, hashes, meta.title);

  // Real entry ids get <code> + a link; free-text related notes render as
  // prose - <code>-styling a whole sentence made it read as a dead slug.
  const related = (meta.relatedEntries ?? []).map(rel =>
    `<li>${/^(wdtk|ofcom)-[^\s/]+$/.test(rel.entry) ? `<a href="../${encodeURIComponent(rel.entry)}/index.html"><code>${escapeHtml(rel.entry)}</code></a>` : `<em>${escapeHtml(rel.entry)}</em>`} — ${escapeHtml(rel.relation)}</li>`);

  const descriptor = dataPackage(key, meta.title, files);
  const zipBytes = writeEntryZip(path.join(foiDir, key), targetDir, key, descriptor, FOI_DICTIONARY_SOURCES);
  const sizeMap = new Map(files.map(f => [f.name, formatBytes(f.bytes)]));
  const isDerived = (name: string): boolean => /normalis|extract/i.test(name) || /normalis|extract/i.test(meta.files[name]?.role ?? '');

  // Inspect: a tab per declared file (workbook → its sheets; CSV → column
  // schema; document → role + contents + witnesses), plus meta.json.
  const dataTabs: InspectTab[] = Object.keys(meta.files).map((name, i) => {
    const decl = meta.files[name];
    const indicative = asSheetsIndicative(decl.sheetsIndicative);
    const roleLine = [decl.role, decl.contentsIndicative].filter(Boolean).join(' — ');
    let panel: string;
    if (indicative !== undefined) {
      const rows = indicative.sheets.map(s => `<tr><td>${escapeHtml(s.name)}</td><td class="n">${s.approxRows === undefined ? '—' : `~${s.approxRows.toLocaleString('en-GB')}`}</td><td>${escapeHtml(s.cols ?? '—')}</td><td>${s.datasetClass === undefined ? '—' : `<code>${escapeHtml(s.datasetClass)}</code>`}</td></tr>`).join('');
      panel = `<p class="lead">${escapeHtml(roleLine)}</p><table>${tableCaption('Sheets in this workbook, with indicative row and column counts')}<thead><tr><th scope="col">sheet</th><th scope="col" class="n">rows</th><th scope="col">cols</th><th scope="col">${glossaryTerm('dataset-class', 3, { label: 'class' })}</th></tr></thead><tbody>${rows}</tbody></table>${indicative.note !== undefined ? `<p class="lead">${escapeHtml(indicative.note)}</p>` : ''}`;
    } else if (name.endsWith('.csv')) {
      panel = csvSchemaPanel(path.join(targetDir, name), roleLine || 'CSV');
    } else {
      // Markdown files are rendered to a readable .md.html sibling; link
      // it as the default view, with the verbatim .md a download away.
      const renderedLink = name.endsWith('.md') && fs.existsSync(path.join(targetDir, `${name}.html`))
        ? ` <a href="${encodeURIComponent(`${name}.html`)}">read the rendered version →</a>` : '';
      panel = `<p class="lead">${escapeHtml(roleLine || 'archived file')}.${renderedLink}</p>`;
    }
    // Witness provenance (recovered-from links) belongs on every file's
    // panel, whatever its type - it is how a reader verifies the source.
    return { id: `i-${i}`, label: name, panel: panel + witnessLinks(decl.witnesses, heldHashes) };
  });
  dataTabs.push({ id: 'i-meta', label: 'meta.json', panel: `<table>${tableCaption('meta.json — this entry’s declared facts')}<tbody><tr><th scope="row">outcome</th><td>${escapeHtml(meta.outcome)}</td></tr><tr><th scope="row">${glossaryTerm('dataset-class', 3, { label: 'dataset classes' })}</th><td>${meta.datasetClasses.map(c => classChipLink(c, '../../')).join(', ')}</td></tr><tr><th scope="row">data ${glossaryTerm('vintage', 3, { label: 'vintage' })}</th><td>${escapeHtml(meta.dataVintage ?? '—')}</td></tr></tbody></table>` });

  // Browse the data: preview the largest normalised CSV, if any.
  const previewName = files.filter(f => isDerived(f.name) && f.name.endsWith('.csv')).sort((a, b) => b.bytes - a.bytes)[0]?.name;
  const browseSection = previewName === undefined ? [] : [
    '<section><h2>Browse the data</h2>',
    `<p class="lead">A preview of the <b>normalised</b> extract <code>${escapeHtml(previewName)}</code>; download it for all rows, or inspect the source document below.</p>`,
    csvPreviewTable(path.join(targetDir, previewName), 3),
    '</section>',
  ];

  // Download grid: source/disclosure vs derived, with the open-data-only
  // slots as "not applicable" placeholders (the lane flip).
  const sourceSlots = files.filter(f => !isDerived(f.name) && f.name !== 'meta.json')
    .map(f => downloadSlot(f.name, encodeURIComponent(f.name), sizeMap.get(f.name) ?? '', meta.files[f.name]?.role ?? ''));
  sourceSlots.push(downloadSlot('meta.json', 'meta.json', sizeMap.get('meta.json') ?? 'JSON', 'provenance, outcome, integrity'));
  const dbName = `foi--${key}.sqlite.gz`;
  const dbSize = sizeOf(path.join(outputDir, 'data', 'datasets', dbName));
  const derivedSlots = files.filter(f => isDerived(f.name)).map(f => downloadSlot(f.name, encodeURIComponent(f.name), sizeMap.get(f.name) ?? '', meta.files[f.name]?.role ?? 'derived'));
  derivedSlots.push(dbSize !== '' ? downloadSlot(dbName, `../../../data/datasets/${encodeURIComponent(dbName)}`, `SQLite${dbSize}`, 'one database, one table per CSV') : placeholderSlot('SQLite', 'built at deploy'));
  derivedSlots.push(downloadSlot(`${key}.zip`, encodeURIComponent(`${key}.zip`), `ZIP ${formatBytes(zipBytes)}`, 'everything + descriptor + dictionary'));
  derivedSlots.push(downloadSlot('datapackage.json', 'datapackage.json', 'Frictionless', 'machine-readable manifest'));

  // At a glance (FOI): outcome, vintage, classes, attribution, notable.
  const totalRows = foiApproxRecords(meta.files);
  const notable: string[] = [];
  if (totalRows > 0) notable.push(`<li><b>~${totalRows.toLocaleString('en-GB')}</b> records across the disclosed sheets.</li>`);
  if (meta.relatedEntries !== undefined && meta.relatedEntries.length > 0) notable.push(`<li><b>${meta.relatedEntries.length}</b> related ${meta.relatedEntries.length === 1 ? 'entry' : 'entries'} — see below.</li>`);
  const atAGlance = [
    '<section><h2>At a glance</h2>',
    `<div class="headline">${escapeHtml(meta.outcome)} <small>FOI outcome</small></div>`,
    `<div class="bd"><h3>Data ${glossaryTerm('vintage', 3, { label: 'vintage' })}</h3><div class="brow"><span class="lab">${escapeHtml(meta.dataVintage ?? 'not stated')}</span></div></div>`,
    `<div class="bd"><h3>${glossaryTerm('dataset-class', 3, { label: 'Dataset classes' })}</h3>${meta.datasetClasses.map(c => `<div class="brow"><span class="lab">${classChipLink(c, '../../')}</span></div>`).join('')}</div>`,
    '<div class="attr">',
    meta.requestUrl !== null ? `<div><b>Source</b> · <a href="${escapeHtml(meta.requestUrl)}">request on WhatDoTheyKnow →</a></div>` : '',
    meta.publicationUrl !== undefined ? `<div><a href="${escapeHtml(meta.publicationUrl)}">also published by Ofcom →</a></div>` : '',
    `<div>Requested ${escapeHtml(meta.requestedAt ?? '—')} · responded ${escapeHtml(meta.respondedAt ?? '—')}</div>`,
    '</div>',
    notable.length > 0 ? `<div class="notable"><h3>Notable</h3><ul>${notable.join('')}</ul></div>` : '',
    '</section>',
  ].filter(s => s !== '').join('\n');

  // The report-this invite (issue #439): a calm, always-present affordance to
  // report a suspected problem or examine this entry further, pre-filled with
  // this exact FOI entry so a report is located to its hop.
  const reportSection = [
    '<section class="report-invite">',
    '<h2>See something worth a closer look?</h2>',
    reportAffordance(
      { surface: 'a Freedom-of-Information dataset entry page', subject: meta.title, datasetKey: key, pageUrl },
      3,
      { label: 'Report or examine this dataset' },
    ),
    '</section>',
  ].join('\n');

  const recoveryNotice = meta.datasetRecovery !== undefined && meta.datasetRecovery !== 'recovered'
    ? [noticeStrip(true, `<b>Dataset ${escapeHtml(meta.datasetRecovery)}:</b> the response data itself is not held in this entry (the correspondence and provenance are). Absence of data here is a recovery state, not evidence about the register.`)]
    : [noticeStrip(false, `Freedom-of-Information disclosure — a point-in-time snapshot, not a live feed.`)];

  // A calm divergence notice (issue #618 increment 4 / #619): where another copy
  // of this disclosure differs from the faithful one held here. Flag, never
  // adjudicate — both copies are held so the difference is re-verifiable, and the
  // fidelity nudge links the deep-dive. Absent when nothing diverges.
  const divergenceCount = (meta.divergences ?? []).length;
  const divergenceNotice = divergenceCount === 0 ? [] : [noticeStrip(false,
    `<b>${divergenceCount === 1 ? 'A divergent copy is' : `${divergenceCount} divergent copies are`} on record:</b> another copy claiming to be this disclosure differs from the faithful one held here. Both copies are held so the difference is re-verifiable — the mirror states which it parses, it does not adjudicate. `
    + fidelityNudge(3, { section: 'divergence', label: 'what differs, and why', about: 'the divergence between two copies of this publication' }))];

  // Provenance interlink (issue #618): FOI witnesses live per file, so the
  // entry's copies are the union across every declared file.
  const foiWitnesses = Object.values(meta.files).flatMap(f => f.witnesses ?? []);
  const body = [
    breadcrumbHtml([['Datasets', '../../index.html'], ['FOI requests', '../../index.html#foi'], [key, undefined]]),
    `<h1>${escapeHtml(meta.title)}</h1>`,
    `<p class="subtitle">Freedom-of-Information response from Ofcom, recovered and mirrored. FOI archive entry <code>${escapeHtml(key)}</code> · <a href="datapackage.json">datapackage.json</a>.</p>`,
    ...recoveryNotice,
    ...divergenceNotice,
    publishedByBlock(meta.sourceKey, foiWitnesses, heldHashes, 'FOI', 3),
    '<div class="main-region">',
    datasetNavSidebar(key, summaries, foiEntries),
    '<div class="col">',
    ...browseSection,
    inspectTabsHtml(dataTabs),
    '<section><h2>Get the data</h2>',
    downloadTier('Source & disclosure', sourceSlots),
    downloadTier('Derived & bundles', derivedSlots),
    downloadTier('Not applicable to this entry', [placeholderSlot('raw.csv', 'n/a — source is not a single CSV'), placeholderSlot('components.csv', 'n/a — FOI snapshot, not the parsed register')]),
    '</section>',
    reportSection,
    '</div>',
    `<div class="side">${atAGlance}</div>`,
    '</div>',
    related.length > 0 ? `<section><h2>Related entries</h2><ul>${related.join('')}</ul></section>` : '',
  ].filter(s => s !== '');
  fs.writeFileSync(path.join(targetDir, 'index.html'), entryPage(meta.title, body, { metaJsonHref: 'meta.json', currentNav: 'Dataset index', sourcePath: `archive/foi/${key}` }));
  fs.writeFileSync(path.join(targetDir, 'datapackage.json'), descriptor);
  return { files, meta, zipBytes };
}


interface OpenDataStats {
  recordCount: number;
  parseStatuses: Record<string, number>;
  callsignFlags: Record<string, number>;
  callsignQuality: Record<string, { count: number; examples: string[] }>;
}

interface OpenDataDiffSummary {
  previousArchiveKey: string;
  previousRecordCount: number;
  unchanged: number;
  fieldChanged: number;
  added: number;
  removed: number;
}

// A lean per-publication summary for the dataset-navigation sidebar - the
// headline figures every page compares itself against. Parses normalised.csv
// once (row count + status -> allocated, plus the unkeyable-row count, issue
// #632) and reads meta for the known-issues / partial-scope signals; deltas
// are computed at render time relative to whichever publication's page is
// showing.
interface PublicationSummary {
  key: string;
  recordCount: number;
  allocated: number;
  // Rows whose callsign cell, cleaned, carries no A-Z0-9/ character at all
  // (a blank cell, or a punctuation-only token) - counted in recordCount
  // above and never dropped, but not addressable by callsign (issue #632).
  unkeyable: number;
  knownIssues: boolean;
  partial: boolean;
}

function publicationSummary(key: string): PublicationSummary {
  const sourceDir = path.join(CONSTANTS.DIRS.archive, key);
  const rows = parseArchiveCsv(derivedEntryFile(key, 'normalised.csv'));
  let allocated = 0;
  let unkeyable = 0;
  for (const r of rows) {
    if ((r.status ?? '').trim() === 'Allocated') allocated += 1;
    if (cleanedCallsign(r.callsign ?? '') === '') unkeyable += 1;
  }
  const meta = JSON.parse(fs.readFileSync(path.join(sourceDir, 'meta.json'), 'utf8')) as {
    intendedCoverage?: { complete: boolean };
    qualityObservations?: unknown[];
  };
  return {
    key,
    recordCount: rows.length,
    allocated,
    unkeyable,
    knownIssues: (meta.qualityObservations?.length ?? 0) > 0,
    partial: meta.intendedCoverage?.complete === false,
  };
}

// Whole days from `to` back to `from` (negative = earlier). Both are
// date-shaped archive keys; Date.parse of a YYYY-MM-DD is fixed-input and so
// stays golden-master deterministic.
export function dayGap(from: string, to: string): number {
  return Math.round((Date.parse(from) - Date.parse(to)) / 86_400_000);
}

// A signed "(+1,234; +0.8%)" delta versus the current page's figure, empty
// when identical. The percentage is relative to the current publication (the
// reference), as asked.
export function signedDelta(value: number, reference: number): string {
  const d = value - reference;
  if (d === 0) return '';
  const sign = d > 0 ? '+' : '−';
  const magnitude = Math.abs(d).toLocaleString('en-GB');
  const pct = reference > 0 ? `; ${sign}${Math.abs((d / reference) * 100).toFixed(1)}%` : '';
  return ` (${sign}${magnitude}${pct})`;
}

// A data-bearing FOI disclosure, for the sidebar's second (cross-lane)
// section: the register snapshots and attribute addenda that sit beside the
// open-data timeline. Correspondence-only entries (no dataset) stay in the
// dataset index, not this navigation.
interface FoiNavEntry {
  key: string;
  title: string;
  vintage: string | null;
  classes: string[];
  approxRecords: number;
}

// Approximate record count declared for an FOI entry (summed across the
// disclosed sheets' approxRows). Approximate by nature - it is the publisher's
// indicative figure - so it is always shown with a leading ~.
function foiApproxRecords(files: FoiEntryMeta['files']): number {
  return Object.values(files)
    .flatMap(d => asSheetsIndicative(d.sheetsIndicative)?.sheets ?? [])
    .reduce((a, s) => a + (s.approxRows ?? 0), 0);
}

// The left dataset-navigation sidebar, shared by both lanes so open-data and
// FOI entry pages navigate identically. Every open-data publication is a
// compact elevator pitch - source + ISO date, and (only when viewed FROM an
// open-data page) the day-gap and row/allocated deltas relative to THIS
// publication; from an FOI page the same rows show absolute figures. The
// current entry is marked, not linked. Declared-partial snapshots and the
// data-bearing FOI disclosures follow in their own collapsed sections. Links
// use the lane-uniform ../../{lane}/{key}/ form (every entry page sits two
// levels under datasets/). Opposite side to the At-a-glance panel.
function datasetNavSidebar(currentKey: string, summaries: PublicationSummary[], foiEntries: FoiNavEntry[]): string {
  const onOpenDataPage = /^\d{4}-\d{2}-\d{2}$/.test(currentKey);
  const byNewest = <T extends { key: string }>(a: T, b: T): number => b.key.localeCompare(a.key);
  const current = onOpenDataPage ? summaries.find(s => s.key === currentKey) : undefined;
  // Deltas compare each entry against a full-register baseline: the publication
  // you are on, or - from an FOI page - the latest complete publication. So an
  // FOI's figure reads as a share of the register (e.g. -99.9%, revealing a
  // narrow request), never an absurd inverse against a tiny snapshot. Equal
  // figures (the baseline vs itself) emit no delta.
  const latestComplete = summaries.filter(s => !s.partial).sort(byNewest)[0];
  const refCount = current?.recordCount ?? latestComplete?.recordCount;
  const refAllocated = current?.allocated ?? latestComplete?.allocated;
  const rowDelta = (n: number): string => refCount === undefined ? '' : signedDelta(n, refCount);
  const allocDelta = (n: number): string => refAllocated === undefined ? '' : signedDelta(n, refAllocated);
  const markersOf = (s: PublicationSummary): string => {
    const m: string[] = [];
    if (s.partial) m.push('partial export');
    if (s.knownIssues) m.push('known data issues');
    return m.length > 0 ? ` · ${m.join(' · ')}` : '';
  };
  const item = (s: PublicationSummary): string => {
    const isCurrent = s.key === currentKey;
    const gap = dayGap(s.key, currentKey);
    // The day-gap is date arithmetic, so only meaningful from an open-data page.
    const gapHtml = !onOpenDataPage ? '' : isCurrent ? ' <small class="gap">this page</small>' : ` <small class="gap">(${gap > 0 ? '+' : '−'}${Math.abs(gap)} days)</small>`;
    const caption = `${s.recordCount.toLocaleString('en-GB')} rows${rowDelta(s.recordCount)}, ${s.allocated.toLocaleString('en-GB')} allocated callsigns${allocDelta(s.allocated)}${markersOf(s)}`;
    const inner = `<span class="dpitch"><small class="src">Ofcom open data</small> <b>${escapeHtml(s.key)}</b>${gapHtml}</span><small class="dcap">${escapeHtml(caption)}</small>`;
    return isCurrent
      ? `<li class="dcur" aria-current="page">${inner}</li>`
      : `<li><a href="../../open-data/${escapeHtml(s.key)}/index.html">${inner}</a></li>`;
  };
  // Declared-complete publications (plus the page you are on, even if it is
  // itself partial) are the timeline. Declared-partial snapshots collapse into
  // an expandable section - still browseable, and their delta shows exactly
  // how incomplete they are, but not mistaken for a timeline neighbour.
  const timeline = summaries.filter(s => !s.partial || s.key === currentKey).sort(byNewest);
  const partials = summaries.filter(s => s.partial && s.key !== currentKey).sort(byNewest);
  const partialsBlock = partials.length === 0 ? ''
    : `<details class="partials"><summary>${partials.length} partial export${partials.length === 1 ? '' : 's'}</summary><ol class="dlist">${partials.map(item).join('')}</ol></details>`;
  // FOI disclosures are a different lane (request-keyed, various vintages), so
  // a separate collapsed section ordered by data vintage, newest first. Each
  // shows its ~approximate record count with a delta to the register baseline -
  // the whole point: a narrow request (say, reciprocal calls only) reads far
  // below the register, a full snapshot near it. On an FOI page the current
  // entry is marked and the section starts expanded.
  const foiOnCurrent = !onOpenDataPage && foiEntries.some(e => e.key === currentKey);
  const foiItem = (e: FoiNavEntry): string => {
    const isCurrent = e.key === currentKey;
    const parts: string[] = [];
    if (e.approxRecords > 0) parts.push(`~${e.approxRecords.toLocaleString('en-GB')} records${rowDelta(e.approxRecords)}`);
    parts.push(e.title);
    if (e.classes.length > 0) parts.push(e.classes.join(', '));
    const gapHtml = isCurrent ? ' <small class="gap">this page</small>' : '';
    const inner = `<span class="dpitch"><small class="src">FOI</small> <b>${escapeHtml(e.vintage ?? 'undated')}</b>${gapHtml}</span><small class="dcap">${escapeHtml(parts.join(' · '))}</small>`;
    return isCurrent
      ? `<li class="dcur" aria-current="page">${inner}</li>`
      : `<li><a href="../../foi/${escapeHtml(e.key)}/index.html">${inner}</a></li>`;
  };
  const foiItems = [...foiEntries].sort((a, b) => (b.vintage ?? '').localeCompare(a.vintage ?? '')).map(foiItem).join('');
  const foiBlock = foiItems === '' ? ''
    : `<details class="foi-nav"${foiOnCurrent ? ' open' : ''}><summary>${foiEntries.length} FOI dataset${foiEntries.length === 1 ? '' : 's'}</summary><ol class="dlist">${foiItems}</ol></details>`;
  return `<nav class="nav-side" aria-label="Publications"><h2>Publications</h2><ol class="dlist">${timeline.map(item).join('')}</ol>${partialsBlock}${foiBlock}</nav>`;
}

// The set-aside (ignored) raw-line affordance (issue #331). Lines the
// normalisation deliberately excluded — blank lines and curated export
// furniture, the ignoredLines vocabulary — are shown, when present, as their
// own JS-free disclosure so a reader sees they were intentionally set aside,
// not lost. Each line is one table row carrying BOTH a pale amber tint (the
// `.set-aside` class, styled in site/ledger.css) and a visible "set aside"
// text badge, so colour is never the sole indicator (WCAG 1.4.1). The count
// reads in the always-visible summary; the enumeration and the reason each was
// excluded are one click away. Empty for a publication with no curated ignores
// (the ~always case), so nothing that could read as a data caveat appears
// there. `depthToRoot` places the glossary link at the caller's relative depth.
export function setAsideLinesSection(ignored: { line: number; content: string; reason: string }[], depthToRoot: number): string {
  if (ignored.length === 0) return '';
  const noun = ignored.length === 1 ? 'line' : 'lines';
  const reasons = [...new Set(ignored.map(l => l.reason))].map(escapeHtml).join('; ');
  const term = glossaryTerm('ignored-line', depthToRoot, { label: 'set aside as non-data' });
  const rows = ignored.map(l => {
    // A blank source line is itself information; humanise it rather than
    // rendering an empty cell (matches the site-wide humanising convention).
    const content = l.content === '' ? '<em>(blank line)</em>' : `<code>${escapeHtml(l.content)}</code>`;
    return `<tr class="set-aside"><th scope="row" class="n">${l.line.toLocaleString('en-GB')}</th>`
      + `<td><span class="tb setaside">set aside</span> ${content}</td>`
      + `<td>${escapeHtml(l.reason)}</td></tr>`;
  }).join('');
  return `<details class="set-aside-lines"><summary>${ignored.length} raw ${noun} set aside as non-data</summary>`
    + `<p class="lead">These raw lines were deliberately excluded from the register during normalisation (${reasons}) — ${term}, enumerated verbatim here and in <a href="meta.json">meta.json</a>. Every other raw line is a header or a data row, so the line accounting stays exact and nothing is silently dropped.</p>`
    + `<table>${tableCaption('Raw lines set aside as non-data, with the reason each was excluded')}`
    + '<thead><tr><th scope="col" class="n">raw line</th><th scope="col">content</th><th scope="col">reason set aside</th></tr></thead>'
    + `<tbody>${rows}</tbody></table></details>`;
}

// The unkeyable-row aside (issue #632), completing the same row-accounting
// narrative as setAsideLinesSection above: a row whose callsign cell, cleaned,
// carries no A-Z0-9/ character at all (a blank cell, or a punctuation-only
// token such as a literal ",,") is counted in the record count shown above
// and never dropped - it simply has no key to join a callsign lookup by, so
// this is the only place its existence becomes visible for this publication.
// Empty for the common case of zero, so nothing that could read as a data
// caveat appears there. `depthToRoot` places the glossary link at the
// caller's relative depth.
export function unkeyableRowsNote(unkeyable: number, depthToRoot: number): string {
  if (unkeyable <= 0) return '';
  const verb = unkeyable === 1 ? 'has' : 'have';
  const term = glossaryTerm('unkeyable-row', depthToRoot, { label: 'unkeyable' });
  return `<p class="lead"><b>${unkeyable.toLocaleString('en-GB')}</b> of the rows above ${verb} no usable `
    + `callsign (blank or punctuation-only) — ${term}, carried in the row count above, but not addressable `
    + 'by callsign, so it never reaches a callsign-shard entry or lookup.</p>';
}

function buildOpenDataEntry(outputDir: string, key: string, previousKey: string | undefined, summaries: PublicationSummary[], foiEntries: FoiNavEntry[], pageUrl: string): { files: CopiedFile[]; zipBytes: number } {
  const sourceDir = path.join(CONSTANTS.DIRS.archive, key);
  const descriptions = new Map<string, string>([
    ['raw.csv', "Ofcom's bytes, verbatim"],
    ['raw.xlsx', "Ofcom's bytes, verbatim (published as a workbook)"],
    ['raw-extract.csv', 'mechanical parse-source extract of the raw file'],
    ['raw-extract-sheet-1-sheet1.csv', 'mechanical sheet extract of the raw workbook'],
    ['meta.json', 'provenance + shape + diff summary'],
    ['normalised.csv', 'canonical schema derivation — see the data dictionary'],
    ['components.csv', 'per-callsign component decomposition'],
    ['stats.json', 'per-publication statistics and data-quality flags'],
  ]);
  const pageTitle = `Publication of ${humanDate(key)}`;
  const targetDir = path.join(outputDir, 'datasets', 'open-data', key);
  // The published copy and the zip take their derived-file bytes through the
  // archive/projection switch (proven byte-identical by the parity gate);
  // raw.*, extracts and meta.json are published from the archive verbatim.
  // Enumeration is the UNION of the archive entry's files and the derived
  // names present through the switch: an entry whose derivatives exist only
  // in the projection (a publication newer than the frozen committed
  // baseline) still publishes and zips all three, and in archive mode the
  // union is a no-op.
  const resolveSource = (name: string): string =>
    isDerivedEntryFile(name) ? derivedEntryFile(key, name) : path.join(sourceDir, name);
  const publishNames = [...new Set([
    ...fs.readdirSync(sourceDir),
    ...derivedEntryFileNamesPresent(key),
  ])].sort();
  const files = copyEntryFiles(sourceDir, targetDir, descriptions, new Map(), pageTitle, resolveSource, publishNames);
  const descriptor = dataPackage(key, `Ofcom open-data publication ${key}`, files);
  const zipBytes = writeEntryZip(sourceDir, targetDir, key, descriptor, OPEN_DATA_DICTIONARY_SOURCES, resolveSource, publishNames);
  const meta = JSON.parse(fs.readFileSync(path.join(sourceDir, 'meta.json'), 'utf8')) as {
    provenance?: string;
    reconstructionNotes?: string;
    gitCommitSha?: string;
    sourceKey?: string;
    intendedCoverage?: { complete: boolean; scopeNotes?: string };
    qualityObservations?: { statement: string; evidence: string; coverageAffecting?: boolean }[];
    sourceUrl?: string; ofcomReportedUpdateIso?: string; ofcomReportedUpdate?: string; fetchedAt?: string;
    witnesses?: { channel: string; url: string; fetchedAt: string; sha256?: string; originalFilename?: string; note?: string }[];
    files?: Record<string, { sha256?: string }>;
    diffSummary?: OpenDataDiffSummary;
    ignoredLines?: { line: number; content: string; reason: string }[];
  };
  // The bytes the mirror holds for this publication, for deriving witness
  // agreement on read (#618 increment 3).
  const heldHashes = heldHashSet(Object.values(meta.files ?? {}).map(f => f.sha256 ?? ''));
  const stats = derivedEntryFileExists(key, 'stats.json')
    ? JSON.parse(fs.readFileSync(derivedEntryFile(key, 'stats.json'), 'utf8')) as OpenDataStats
    : { recordCount: 0, parseStatuses: {}, callsignFlags: {}, callsignQuality: {} };
  const sizeMap = new Map(files.map(f => [f.name, formatBytes(f.bytes)]));
  const dl = (name: string, meta2: string, desc: string): string => sizeMap.has(name)
    ? downloadSlot(name, encodeURIComponent(name), sizeMap.get(name) ?? meta2, desc) : placeholderSlot(name, 'not present');
  const dbName = `open-data--${key}.sqlite.gz`;
  const dbSize = sizeOf(path.join(outputDir, 'data', 'datasets', dbName));

  // Inspect: per-file schemas (raw included - the source file's own shape).
  const parseStatuses = Object.entries(stats.parseStatuses).sort().map(([s, n]) => `${n.toLocaleString('en-GB')} ${escapeHtml(s)}`).join(' · ');
  const quality = Object.entries(stats.callsignQuality).filter(([, q]) => q.count > 0).sort();
  const qualityHtml = quality.length === 0 ? '' : `<h3 style="font-size:.9rem;margin-top:.8rem">Value-level checks</h3><ul>${quality.map(([check, q]) => {
    // Stats examples carry their {U+XXXX} markers from derivation time, so the
    // shared callsign field wrapper (#553) is pinned to 'pre-marked' (highlight,
    // never re-mark); this surface's established blank wording is likewise
    // pinned rather than left to the wrapper's movable default.
    const shown = q.examples.slice(0, 5).map(e => callsignField(e, { oddCharacters: 'pre-marked', blankLabel: '(empty value)' }));
    return `<li>${escapeHtml(check)}: ${q.count.toLocaleString('en-GB')}${shown.length > 0 ? ` — e.g. ${shown.join(', ')}` : ''}</li>`;
  }).join('')}</ul>`;
  // The raw publication may be a CSV (schema panel over its own bytes) or a
  // workbook (verbatim binary - the schema panel shows its mechanical extract,
  // the file the normaliser parses).
  const rawIsCsv = fs.existsSync(path.join(sourceDir, 'raw.csv'));
  const extractName = fs.readdirSync(sourceDir).find(n => n.startsWith('raw-extract') && n.endsWith('.csv'));
  const rawTabs: InspectTab[] = rawIsCsv
    ? [{ id: 'i-raw', label: 'raw.csv', panel: csvSchemaPanel(path.join(sourceDir, 'raw.csv'), "Ofcom's bytes, verbatim") }]
    : [{ id: 'i-raw', label: 'raw.xlsx', panel: '<p class="lead">Published as a workbook and archived verbatim — no CSV schema of its own. The mechanical sheet extract below is the parse source.</p>' }];
  if (extractName !== undefined) {
    rawTabs.push({ id: 'i-extract', label: extractName, panel: csvSchemaPanel(path.join(sourceDir, extractName), 'Mechanical parse-source extract of the raw publication') });
  }
  const tabs: InspectTab[] = [
    ...rawTabs,
    { id: 'i-norm', label: 'normalised.csv', panel: csvSchemaPanel(derivedEntryFile(key, 'normalised.csv'), 'Canonical schema — one stable shape across every publication') },
    { id: 'i-comp', label: 'components.csv', panel: csvSchemaPanel(derivedEntryFile(key, 'components.csv'), 'Per-callsign decomposition + join keys') },
    { id: 'i-stats', label: 'stats.json', panel: `<p class="lead">Parse statuses: ${parseStatuses}.</p>${anomalyFlagsHtml(stats.callsignFlags)}${qualityHtml}` },
    { id: 'i-meta', label: 'meta.json', panel: `<table>${tableCaption('meta.json — this publication’s declared facts')}<tbody><tr><th scope="row">provenance</th><td>${escapeHtml(meta.provenance ?? 'live')}</td></tr><tr><th scope="row">${glossaryTerm('declared-complete', 3, { label: 'declared coverage' })}</th><td>${meta.intendedCoverage === undefined ? '—' : `${meta.intendedCoverage.complete ? 'complete' : 'partial'} (intent, not verified)`}</td></tr></tbody></table>` },
  ].filter(t => t.panel !== '');

  const ignoredNote = setAsideLinesSection(meta.ignoredLines ?? [], 3);
  const unkeyableNote = unkeyableRowsNote(summaries.find(s => s.key === key)?.unkeyable ?? 0, 3);

  // The per-record flag join for the browse preview's fidelity nudges (issue
  // #438): components.csv carries each record's data-quality flags keyed by the
  // same callsign the normalised preview rows show. Only flagged records enter
  // the map, so an unflagged preview row costs nothing and renders unchanged.
  const flagsByCallsign = new Map<string, string>();
  for (const r of parseArchiveCsv(derivedEntryFile(key, 'components.csv'))) {
    const flags = (r.flags ?? '').trim();
    if (flags !== '') flagsByCallsign.set(r.callsign ?? '', flags);
  }

  const related: string[] = [];
  if (previousKey !== undefined) related.push(`<p style="margin:.1rem 0;font-size:.9rem"><b>Chronological:</b> ← <a href="../${escapeHtml(previousKey)}/index.html">Publication of ${humanDate(previousKey)}</a>.</p>`);
  if (fs.existsSync(path.join(REPO_ROOT, 'reports', 'entries', `${key}.md`))) {
    related.push(`<p style="margin:.1rem 0;font-size:.9rem"><b>Drill-down:</b> <a href="../../../reports/entries/${encodeURIComponent(key)}.html">Data-quality report for ${humanDate(key)}</a> — pattern tables, windowed matrices, pairwise comparison.</p>`);
  }

  const body = [
    breadcrumbHtml([['Datasets', '../../index.html'], ['Ofcom open data', '../../index.html#open-data'], [key, undefined]]),
    `<h1>${escapeHtml(pageTitle)}</h1>`,
    `<p class="subtitle">Ofcom amateur-radio callsign register, mirrored byte-for-byte. Archive entry <code>${escapeHtml(key)}</code> · <a href="datapackage.json">datapackage.json</a>.</p>`,
    ...coverageNotices(meta),
    publishedByBlock(meta.sourceKey ?? 'ofcom-amateur-callsigns', meta.witnesses ?? [], heldHashes, 'Official', 3),
    '<div class="main-region">',
    datasetNavSidebar(key, summaries, foiEntries),
    '<div class="col">',
    `<section class="browser" data-dataset="${escapeHtml(key)}"><h2>Browse the data</h2>`,
    // Deep-link the "query it" hand-off (issue #333) to the Explore console
    // PRE-FILTERED to this publication's rows, rather than the empty tool the
    // reader must then re-scope. register_history holds one row per normalised
    // record keyed by `dataset`, so `WHERE dataset = <key>` is exactly this
    // publication's normalised register — the very set the sentence names.
    `<p class="lead">The <b>normalised</b> register — the canonical shape, not the raw file (inspect <code>raw.csv</code> below for that). Showing the first rows of ${stats.recordCount.toLocaleString('en-GB')} (${(summaries.find(s => s.key === key)?.allocated ?? 0).toLocaleString('en-GB')} allocated callsigns); download <code>normalised.csv</code> for all, or <a href="${exploreDeepLink('../../../', 'combined', `SELECT * FROM register_history WHERE dataset = '${key.replace(/'/g, "''")}' ORDER BY callsign`)}">query this publication on the Explore console</a> — pre-filtered to its rows.</p>`,
    `<div class="browser-static">${csvPreviewTable(derivedEntryFile(key, 'normalised.csv'), 3, 12, flagsByCallsign)}</div>`,
    unkeyableNote,
    ignoredNote,
    '</section>',
    inspectTabsHtml(tabs),
    ...distributionsSection(key),
    '<section><h2>Get the data</h2>',
    downloadTier('Canonical — most-wanted', [
      dl('normalised.csv', 'CSV', 'canonical schema across all publications'),
      dl('components.csv', 'CSV', 'decomposition + join keys'),
      dl('stats.json', 'JSON', 'counts & quality flags'),
      dl('meta.json', 'JSON', 'provenance & integrity'),
    ]),
    downloadTier('Source & bundles', [
      rawIsCsv ? dl('raw.csv', 'CSV', "Ofcom's bytes, verbatim") : dl('raw.xlsx', 'XLSX', "Ofcom's bytes, verbatim (workbook)"),
      dbSize !== '' ? downloadSlot(dbName, `../../../data/datasets/${encodeURIComponent(dbName)}`, `SQLite${dbSize}`, 'one database, one table per CSV') : placeholderSlot('SQLite', 'built at deploy'),
      downloadSlot(`${key}.zip`, encodeURIComponent(`${key}.zip`), `ZIP ${formatBytes(zipBytes)}`, 'everything + descriptor + dictionary'),
      downloadSlot('datapackage.json', 'datapackage.json', 'Frictionless', 'machine-readable manifest with schemas'),
    ]),
    downloadTier('Entry-specific', [
      placeholderSlot('source documents', 'none — open-data is one CSV'),
      placeholderSlot('edges.csv', 'planned — graph export'),
    ]),
    '</section>',
    // The report-this invite (issue #439): pre-filled with this exact
    // publication so a report about a record or figure here is located to it.
    '<section class="report-invite">',
    '<h2>See something worth a closer look?</h2>',
    reportAffordance(
      { surface: 'an Ofcom open-data publication entry page', subject: `the register publication of ${humanDate(key)}`, datasetKey: key, pageUrl },
      3,
      { label: 'Report or examine this publication' },
    ),
    '</section>',
    '</div>',
    '<div class="side">',
    atAGlanceOpenData(key, previousKey, stats, meta),
    '</div>',
    '</div>',
    related.length > 0 ? `<section><h2>Related</h2>${related.join('')}</section>` : '',
    '<a class="linkout" href="../../../statistics.html">Register structure (prefix series × RSL) → on the statistics page (near-constant across publications, not a property of this one).</a>',
    // Progressive enhancement: the scoped data browser queries the combined
    // database (filtered to this publication) over range requests. With JS
    // off, the static preview above is the complete, crawlable record.
    '<script src="../../../vendor/index.js"></script>',
    '<script type="module" src="../../../entry-browser.js"></script>',
  ].filter(s => s !== '');
  fs.writeFileSync(path.join(targetDir, 'index.html'), entryPage(pageTitle, body, { metaJsonHref: 'meta.json', currentNav: 'Dataset index', sourcePath: `archive/${key}` }));
  fs.writeFileSync(path.join(targetDir, 'datapackage.json'), descriptor);
  return { files, zipBytes };
}

// Precomputed per-series entity pages (the static half of the entity-pages
// plan; callsigns stay dynamic behind ?c= deep links because 158k static
// pages would alone exceed the Pages size cap): reference-data facts plus
// latest-publication derived numbers, one page per prefix series observed
// in the data or named in reference data. Fully static - archived captures
// are complete. Returns the page URLs for the sitemap.
function buildSeriesPages(outputDir: string, baseUrl: string): { urls: string[]; series: Set<string> } {
  const keys = listArchiveKeys().sort();
  const newest = keys[keys.length - 1];
  if (newest === undefined) return { urls: [], series: new Set() };
  const componentsRows = parseArchiveCsv(derivedEntryFile(newest, 'components.csv'));
  const normalisedRows = parseArchiveCsv(derivedEntryFile(newest, 'normalised.csv'));
  const statusByCallsign = new Map(normalisedRows.map(r => [r.callsign, r.status]));
  const reference = new Map(
    (parse(fs.readFileSync(path.join(REPO_ROOT, 'reference-data', 'prefix-formats.csv'), 'utf8'), { columns: true, bom: true }) as Record<string, string>[])
      .map(r => [r.prefix, r]));

  interface SeriesAccumulator {
    total: number;
    statuses: Map<string, number>;
    rsls: Map<string, number>;
    flags: Map<string, number>;
    // Each example keeps the parsed components alongside the callsign so the
    // shared pill can carry the same supplementary title used site-wide.
    examples: { callsign: string; components: CallsignComponents }[];
  }
  const bySeries = new Map<string, SeriesAccumulator>();
  for (const row of componentsRows) {
    if (row.parse_status !== 'parsed' || row.prefix_series === '') continue;
    const acc: SeriesAccumulator = bySeries.get(row.prefix_series) ?? { total: 0, statuses: new Map(), rsls: new Map(), flags: new Map(), examples: [] };
    acc.total += 1;
    const status = statusByCallsign.get(row.callsign) ?? '(unknown)';
    acc.statuses.set(status, (acc.statuses.get(status) ?? 0) + 1);
    if (row.rsl !== '') acc.rsls.set(row.rsl, (acc.rsls.get(row.rsl) ?? 0) + 1);
    for (const flag of row.flags === '' ? [] : row.flags.split(';')) acc.flags.set(flag, (acc.flags.get(flag) ?? 0) + 1);
    if (acc.examples.length < 5) acc.examples.push({
      callsign: row.callsign,
      components: { prefixSeries: row.prefix_series, rsl: row.rsl, suffix: row.suffix, licenceClass: row.implied_class },
    });
    bySeries.set(row.prefix_series, acc);
  }

  const allSeries = [...new Set([...reference.keys(), ...bySeries.keys()])].sort((a, b) => a.localeCompare(b));
  const seriesDir = path.join(outputDir, 'series');
  fs.mkdirSync(seriesDir, { recursive: true });
  const urls: string[] = [];

  // linkFor turns each count into a filtered-lookup link ("which N?"):
  // a return of undefined (synthetic values like "(unknown)") stays plain.
  // labelFor, when given, supplies the value cell's inner HTML directly (the
  // shared status field wrapper, #553) instead of plain escaped text - safe
  // here because the value sits in its own plain <td>, not a click-to-filter
  // row (the count cell carries that behaviour via linkFor).
  const countTable = (title: string, counts: Map<string, number>, linkFor?: (value: string) => string | undefined, labelFor?: (value: string) => string): string[] => {
    if (counts.size === 0) return [];
    const rows = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return [`<h2>${escapeHtml(title)}</h2>`, '<table>', tableCaption(title), '<thead>', `<tr><th scope="col">value</th><th scope="col" class="n">rows</th></tr>`, '</thead>', '<tbody>',
      ...rows.map(([value, n]) => {
        const count = n.toLocaleString('en-GB');
        const href = linkFor?.(value);
        const shown = labelFor !== undefined ? labelFor(value) : escapeHtml(value);
        return `<tr><td>${shown}</td><td class="n">${href === undefined ? count : `<a href="${href}">${count}</a>`}</td></tr>`;
      }), '</tbody>', '</table>'];
  };
  const filterLink = (series: string, param: 'status' | 'flags', value: string): string | undefined =>
    value.startsWith('(') ? undefined : `../index.html?series=${encodeURIComponent(series)}&${param}=${encodeURIComponent(value)}`;

  const indexRows: string[] = [];
  for (const series of allSeries) {
    const slug = prefixSeriesSlug(series);
    const ref = reference.get(series);
    const acc = bySeries.get(series);
    // A plain-text form for contexts that cannot carry HTML (the <title>
    // element, this page's own document title): the field wrapper itself
    // handles every place the series is rendered as content.
    const display = prefixSeriesDisplay(series);
    const facts: string[] = [];
    if (ref !== undefined) {
      facts.push(
        '<table>',
        tableCaption('Reference facts for this prefix series'),
        '<tbody>',
        `<tr><th scope="row">${glossaryTerm('licence-class', 1, { label: 'station level' })}</th><td>${licenceField(ref.station_level)}</td></tr>`,
        `<tr><th scope="row">issuing status</th><td>${escapeHtml(ref.issuing_status)}</td></tr>`,
        `<tr><th scope="row">${glossaryTerm('rsl', 1, { label: 'RSL' })} required</th><td>${escapeHtml(ref.rsl_required)}</td></tr>`,
        ...(ref.notes ? [`<tr><th scope="row">notes</th><td>${escapeHtml(ref.notes)}</td></tr>`] : []),
        '</tbody>',
        '</table>',
      );
    } else {
      facts.push('<p>⚠ Observed in the register but absent from <a href="https://github.com/MysterAitch/amateur-callsigns-file-watch/tree/main/reference-data">reference data</a> — an open research item, not an established series.</p>');
    }
    const numbers = acc === undefined
      ? ['<p>No parsed register rows in the latest publication carry this series.</p>']
      : [
        `<p>${acc.total.toLocaleString('en-GB')} parsed register rows in the latest publication (${escapeHtml(newest)}). Counts link to the matching rows in the live lookup.</p>`,
        // The shared status field wrapper (#553): a bounded list of distinct
        // status values, sitting in a plain <td>, so the default 'linked'
        // treatment crosslinks a recognised one to its glossary definition.
        ...countTable('Status breakdown', acc.statuses, status => filterLink(series, 'status', status), status => statusField(status, { depthToRoot: 1 })),
        ...countTable('Stored RSL letters', acc.rsls),
        ...countTable('Data-quality flags within this series', acc.flags, flag => filterLink(series, 'flags', flag)),
        `<p>Examples, as stored in the register (the RSL letter, where one applies, is stored separately from the row): ${acc.examples.map(e => callsignPill(e.callsign, 1, e.components)).join(', ')} — each opens the live lookup.</p>`,
      ];
    const body = [
      // Self-referential (this IS the series' own page), so the field
      // wrapper renders unlinked here - the opt-in crosslink is for OTHER
      // pages pointing at this one (the breakdown row, the index table below).
      `<h1>Prefix series ${prefixSeriesField(series)}</h1>`,
      `<p><code>#</code> marks where the ${glossaryTerm('rsl', 1, { label: 'Regional Secondary Locator' })} sits when one is present. Reference facts are hand-curated; numbers derive from the latest archived publication and regenerate on every deploy.</p>`,
      ...facts,
      ...numbers,
      '<p>See the <a href="../statistics.html">statistics page</a> for the all-series locator matrix, or <a href="index.html">all series</a>.</p>',
    ];
    fs.writeFileSync(path.join(seriesDir, `${slug}.html`), htmlPage(`Prefix series ${display}`, 1, body, { currentNav: 'Series', sourcePath: 'reference-data/prefix-formats.csv' }));
    urls.push(`${baseUrl}/series/${slug}.html`);
    // This index sits IN series/ alongside the page it links to (slug.html,
    // same directory), so the plain relative href is built directly rather
    // than through the wrapper's own `link` option - that option's href
    // always resolves from the SITE ROOT (matching every other adoption site,
    // which sits elsewhere), which would double back through series/ needlessly
    // from here. The wrapper still supplies the shared visual as an unlinked
    // span, nested inside this page-local anchor.
    indexRows.push(`<tr><th scope="row"><a href="${slug}.html">${prefixSeriesField(series)}</a></th><td>${ref === undefined ? '⚠ unreferenced' : licenceField(ref.station_level)}</td><td>${ref === undefined ? '—' : escapeHtml(ref.issuing_status)}</td><td class="n">${(acc?.total ?? 0).toLocaleString('en-GB')}</td></tr>`);
  }

  const indexBody = [
    '<h1>Prefix series</h1>',
    `<p>One page per callsign ${glossaryTerm('prefix-series', 1, { label: 'prefix series' })} — hand-curated reference facts joined with numbers derived from the latest archived publication (${escapeHtml(newest)}). <code>#</code> marks the ${glossaryTerm('rsl', 1, { label: 'RSL' })} slot.</p>`,
    '<table>',
    tableCaption('Every prefix series, with its reference facts and register row count'),
    '<thead>',
    `<tr><th scope="col">${glossaryTerm('prefix-series', 1, { label: 'series' })}</th><th scope="col">${glossaryTerm('licence-class', 1, { label: 'station level' })}</th><th scope="col">issuing status</th><th scope="col" class="n">rows</th></tr>`,
    '</thead>',
    '<tbody>',
    ...indexRows,
    '</tbody>',
    '</table>',
  ];
  fs.writeFileSync(path.join(seriesDir, 'index.html'), htmlPage('Prefix series', 1, indexBody, { currentNav: 'Series', sourcePath: 'reference-data/prefix-formats.csv' }));
  urls.unshift(`${baseUrl}/series/index.html`);
  return { urls, series: new Set(allSeries) };
}

// Render the standing reports and the register-status doc onto the site under
// /reports/, with a hub index the "Reports" nav link lands on. The
// data-dictionary docs are cross-referenced here (their own pages are built
// with the dataset index, their contextual citations left in place). Returns
// the page URLs so the caller can seed the sitemap.
// Cross-link a rendered report: rewrite a `<code>TOKEN</code>` span into a link
// when the token names a canonical page elsewhere on the site — an archived FOI
// entry (its dataset page), a prefix series (its series page), or a
// data-quality flag (the flag registry). A span already inside an anchor is
// left alone, so nothing is double-linked. Report pages sit at /reports/, so
// targets are one level up. This is what makes the value catalogue's series and
// flags tables, and every entry key named in prose, click-through (issue #234).
function linkKnownEntities(html: string, foiKeys: ReadonlySet<string>, series: ReadonlySet<string>, flags: ReadonlySet<string>, rel: string): string {
  return html.replace(/<code>([^<]+)<\/code>/g, (whole: string, token: string, offset: number, full: string) => {
    if (/<a\b[^>]*>\s*$/.test(full.slice(Math.max(0, offset - 80), offset))) return whole; // already linked
    if (foiKeys.has(token)) return `<a href="${rel}datasets/foi/${encodeURIComponent(token)}/index.html">${whole}</a>`;
    if (series.has(token)) return `<a href="${rel}series/${prefixSeriesSlug(token)}.html">${whole}</a>`;
    if (flags.has(token)) return `<a href="${rel}datasets/docs/flags.html">${whole}</a>`;
    return whole;
  });
}

export function buildReportPages(outputDir: string, baseUrl: string, foiKeys: string[], series: ReadonlySet<string>, flags: ReadonlySet<string>): string[] {
  const urls: string[] = [];
  const foiKeySet = new Set(foiKeys);
  const reportsDir = path.join(outputDir, 'reports');
  fs.mkdirSync(reportsDir, { recursive: true });

  const renderDoc = (doc: RenderedDoc): void => {
    let rendered = renderMarkdown(fs.readFileSync(path.join(REPO_ROOT, doc.source), 'utf8'));
    // A relative link to a sibling repo doc with no rendered page on the site
    // (e.g. dataset-status → source-register.md) points at the authoritative
    // repo copy rather than 404ing.
    const sourceDir = path.posix.dirname(doc.source.replace(/\\/g, '/'));
    rendered = rendered.replace(/href="([^":/?#]+\.md)"/g, (_m, target: string) =>
      `href="${REPO_URL}/blob/main/${sourceDir}/${target}"`);
    // Named entities (FOI entries, prefix series, flags) deep-link to their
    // pages. Standing reports sit at /reports/, one level below root.
    rendered = linkKnownEntities(rendered, foiKeySet, series, flags, '../');
    const body = [
      `<p><small>Rendered from <a href="${REPO_URL}/blob/main/${doc.source}">${escapeHtml(doc.source)}</a> in the repository (the authoritative, sweep-generated copy). <a href="index.html">All reports →</a></small></p>`,
      '<hr>',
      rendered,
    ];
    fs.writeFileSync(path.join(reportsDir, `${doc.slug}.html`), htmlPage(doc.label, 1, body, { currentNav: 'Reports', sourcePath: doc.source }));
    urls.push(`${baseUrl}/reports/${doc.slug}.html`);
  };

  for (const doc of [...STANDING_REPORTS, ...STATUS_DOCS]) renderDoc(doc);

  // Per-publication drill-downs (issue #51): rendered under /reports/entries/
  // and linked from each publication's dataset page, not listed on the hub (to
  // keep the index curated as it grows with every publication).
  const entriesSourceDir = path.join(REPO_ROOT, 'reports', 'entries');
  let entryReportCount = 0;
  if (fs.existsSync(entriesSourceDir)) {
    const entriesOutDir = path.join(reportsDir, 'entries');
    fs.mkdirSync(entriesOutDir, { recursive: true });
    for (const name of fs.readdirSync(entriesSourceDir).filter(n => n.endsWith('.md')).sort()) {
      const slug = name.slice(0, -'.md'.length);
      // Entry drill-downs sit at /reports/entries/, two levels below root.
      const rendered = linkKnownEntities(renderMarkdown(fs.readFileSync(path.join(entriesSourceDir, name), 'utf8')), foiKeySet, series, flags, '../../');
      const body = [
        `<p><small>Per-publication data-quality drill-down, rendered from <a href="${REPO_URL}/blob/main/reports/entries/${name}">reports/entries/${name}</a>. Back to the <a href="../index.html">reports index</a> or this publication's <a href="../../datasets/open-data/${encodeURIComponent(slug)}/index.html">dataset page</a>.</small></p>`,
        '<hr>',
        rendered,
      ];
      fs.writeFileSync(path.join(entriesOutDir, `${slug}.html`), htmlPage(`Data-quality drill-down — ${slug}`, 2, body, { currentNav: 'Reports', sourcePath: `reports/entries/${name}` }));
      urls.push(`${baseUrl}/reports/entries/${slug}.html`);
      entryReportCount += 1;
    }
  }

  const listOf = (docs: RenderedDoc[], rel: string): string[] =>
    ['<ul>', ...docs.map(d => `<li><a href="${rel}${d.slug}.html">${escapeHtml(d.label)}</a> — ${d.blurb}</li>`), '</ul>'];
  const hubBody = [
    '<h1>Reports</h1>',
    '<p>Standing, deterministic views over the whole archive — regenerated by the normalise sweep and committed, so each is a stable snapshot whose change in a diff is itself a signal. Everything here derives from the same archived data the <a href="../datasets/index.html">datasets</a> publish and the <a href="../explore.html">Explore</a> page queries.</p>',
    '<h2>Standing reports</h2>',
    ...listOf(STANDING_REPORTS, ''),
    ...(entryReportCount > 0
      ? [`<p><small>Per-publication data-quality drill-downs (pattern tables, windowed matrices, pairwise comparisons) — ${entryReportCount} of them — are linked from each publication's own <a href="../datasets/index.html">dataset page</a>, where they belong in context.</small></p>`]
      : []),
    '<h2>Register status</h2>',
    ...listOf(STATUS_DOCS, ''),
    '<h2>Publishers</h2>',
    '<p>The <a href="../publishers/index.html">publisher register</a> — the bodies that originate, archive, aggregate or host the mirrored material, each with the licence basis on which the mirror holds it, its authority ceiling, and the datasets it authored or hosted. Author, publication channel and host are kept as separate axes.</p>',
    '<h2>Fidelity &amp; integrity</h2>',
    `<p><a href="../fidelity.html">Fidelity &amp; integrity</a> — what the data-quality flags mean, the provenance chain behind every value, worked "show the working" examples from real records, the reconstruction self-check, and how to re-verify any of it. The small fidelity notes beside records across the site all land here.</p>`,
    '<h2>Data dictionary</h2>',
    '<p>The schemas and vocabularies that make the datasets interpretable — cited in context throughout the site, and collected here.</p>',
    ...listOf(DICTIONARY_DOCS, '../datasets/docs/'),
  ];
  fs.writeFileSync(path.join(reportsDir, 'index.html'), htmlPage('Reports', 1, hubBody, { currentNav: 'Reports', sourcePath: 'reports' }));
  urls.push(`${baseUrl}/reports/index.html`);
  return urls;
}

export function buildDatasetPages(outputDir: string, baseUrl: string = DEFAULT_BASE_URL): DatasetPagesSummary {
  const foiDir = path.join(REPO_ROOT, 'archive', 'foi');
  const openDataKeys = listArchiveKeys().sort();
  const foiKeys = listFoiEntryKeys(foiDir);

  let fileCount = 0;
  let totalBytes = 0;
  const pageUrls: string[] = [`${baseUrl}/datasets/index.html`];

  const openDataRows: string[] = [];
  // The changes-since pointer targets the most recent INTENDED-COMPLETE
  // earlier publication: pointing at a declared-partial truncation would
  // imply ~150k spurious additions (caught in review).
  let lastCompleteKey: string | undefined;
  // Precompute each publication's headline figures once; every entry's
  // navigation sidebar lists them all, with deltas relative to that page.
  const summaries = time('dataset-pages:summaries', () => openDataKeys.map(publicationSummary));
  // The cross-lane FOI section lists only data-bearing disclosures (a dataset
  // to navigate to); correspondence-only entries stay in the dataset index.
  const foiNav: FoiNavEntry[] = foiKeys.map(k => {
    const m = readFoiEntryMeta(foiDir, k);
    return { key: k, title: m.title, vintage: m.dataVintage, classes: m.datasetClasses, approxRecords: foiApproxRecords(m.files) };
  }).filter(e => e.classes.length > 0);
  for (const key of openDataKeys) {
    const { files, zipBytes } = time('dataset-pages:open-data-entry', () => buildOpenDataEntry(outputDir, key, lastCompleteKey, summaries, foiNav, `${baseUrl}/datasets/open-data/${key}/index.html`));
    const entryMeta = JSON.parse(fs.readFileSync(path.join(CONSTANTS.DIRS.archive, key, 'meta.json'), 'utf8')) as { intendedCoverage?: { complete: boolean } };
    if (entryMeta.intendedCoverage?.complete !== false) lastCompleteKey = key;
    fileCount += files.length;
    totalBytes += files.reduce((sum, f) => sum + f.bytes, 0) + zipBytes;
    pageUrls.push(`${baseUrl}/datasets/open-data/${key}/index.html`);
    openDataRows.push(`<tr><th scope="row" class="dskey">${datasetLabel(`Publication of ${humanDate(key)}`, key, { href: `open-data/${key}/index.html` })}</th><td class="n">${files.length}</td><td class="n">${formatBytes(files.reduce((s, f) => s + f.bytes, 0))}</td></tr>`);
  }

  const foiRows: string[] = [];
  for (const key of foiKeys) {
    const { files, meta, zipBytes } = time('dataset-pages:foi-entry', () => buildFoiEntry(outputDir, foiDir, key, summaries, foiNav, `${baseUrl}/datasets/foi/${encodeURIComponent(key)}/index.html`));
    fileCount += files.length;
    totalBytes += files.reduce((sum, f) => sum + f.bytes, 0) + zipBytes;
    pageUrls.push(`${baseUrl}/datasets/foi/${key}/index.html`);
    foiRows.push(`<tr><th scope="row" class="dskey">${datasetLabel(meta.title, key, { href: `foi/${encodeURIComponent(key)}/index.html` })}</th><td>${escapeHtml(meta.dataVintage ?? '—')}</td><td>${meta.datasetClasses.map(c => classChipLink(c, '')).join(', ')}</td></tr>`);
  }

  if (totalBytes > MAX_TOTAL_BYTES) {
    throw new Error(`dataset pages would ship ${totalBytes} bytes - over the ${MAX_TOTAL_BYTES} ceiling; revisit what is published before deploying`);
  }

  // Data dictionary: the repository's schema documentation rendered onto
  // the site so the published datasets are interpretable without the
  // repo. Sources are the committed docs (two of them generated and
  // freshness-tested), rendered with the same markdown renderer as the
  // correspondence records.
  const docsDir = path.join(outputDir, 'datasets', 'docs');
  fs.mkdirSync(docsDir, { recursive: true });
  for (const doc of DICTIONARY_DOCS) {
    let rendered = renderMarkdown(fs.readFileSync(path.join(REPO_ROOT, doc.source), 'utf8'));
    // Cross-references between the dictionary docs are .md links in the
    // repository; on the site the siblings are .html (the .md forms 404ed
    // live). Entry keys named in the docs become links to their pages -
    // the schema tables are the natural jumping-off point to the data.
    for (const sibling of DICTIONARY_DOCS) {
      rendered = rendered.replaceAll(`href="${path.basename(sibling.source)}"`, `href="${sibling.slug}.html"`);
    }
    // Any remaining relative .md link (e.g. an ADR under docs/adr/) has no
    // rendered page on the site; point it at the authoritative repo copy rather
    // than a 404 - matching how the standing reports rewrite their sibling docs.
    const docSourceDir = path.posix.dirname(doc.source.replace(/\\/g, '/'));
    rendered = rendered.replace(/href="([^":/?#][^":?#]*\.md)"/g, (_m, target: string) =>
      `href="${REPO_URL}/blob/main/${docSourceDir}/${target}"`);
    for (const key of foiKeys) {
      rendered = rendered.replaceAll(`<code>${key}</code>`, `<a href="../foi/${encodeURIComponent(key)}/index.html"><code>${key}</code></a>`);
    }
    const docBody = [
      `<p><small>Rendered from <a href="${REPO_URL}/blob/main/${doc.source}">${escapeHtml(doc.source)}</a> in the repository (the authoritative copy). Collected with the standing views on the <a href="../../reports/index.html">reports</a> page.</small></p>`,
      '<hr>',
      rendered,
    ];
    fs.writeFileSync(path.join(docsDir, `${doc.slug}.html`), htmlPage(doc.label, 2, docBody, { currentNav: 'Reports' }));
    pageUrls.push(`${baseUrl}/datasets/docs/${doc.slug}.html`);
  }
  const dictionarySection = [
    '<h2>Data dictionary</h2>',
    '<p>The schemas and vocabularies that make the datasets interpretable — also collected, with the standing <a href="../reports/index.html">reports</a>, on the reports page.</p>',
    '<ul>',
    ...DICTIONARY_DOCS.map(doc => `<li><a href="docs/${doc.slug}.html">${escapeHtml(doc.label)}</a> — ${doc.blurb}</li>`),
    '</ul>',
  ];

  const indexBody = [
    '<h1>Dataset index</h1>',
    '<p>Every archived dataset in both collections below, with the raw, extract and normalised files published verbatim at stable URLs. Integrity: each entry’s <code>meta.json</code> declares sha256 for every file; each entry ships a <a href="https://datapackage.org/">Frictionless</a> <code>datapackage.json</code> and a one-click <code>.zip</code> of everything.</p>',
    '<p>Prefer to browse by kind of data? Every entry carries one or more <a href="classes/index.html">dataset types</a> — a register snapshot, an availability pool, a forbidden-suffix list, and so on — each with a full overview page: what that kind of data is, the shape of a row, its provenance and quirks, and every entry that carries it, across both collections.</p>',
    '<p>Comparing publications rather than browsing one? The <a href="../statistics/inter-dataset.html">inter-dataset statistics</a> page sets the archived publications side by side — blank-product filtering, record-count deltas, and flag and pattern drift.</p>',
    '<p>Want to know who published what? Every dataset here is <a href="../publishers/index.html">authored by, and witnessed through, a publisher</a> — Ofcom originates the data, and copies are held via its open-data page, the UK Government Web Archive, WhatDoTheyKnow and others. Each publisher page states the basis on which the mirror holds its material and lists every related holding.</p>',
    ...dictionarySection,
    '<h2>Bulk downloads</h2>',
    '<ul>',
    `<li><a href="../data/foi-observations.csv.gz">foi-observations.csv.gz</a>${sizeOf(path.join(outputDir, 'data', 'foi-observations.csv.gz'))} — the flat union of every callsign-bearing FOI normalised row (one CSV, gzipped; empty cells conflate not-asserted with asserted-blank — the combined database keeps them distinct as NULL vs empty string).</li>`,
    `<li><a href="../data/combined.sqlite.gz">combined.sqlite.gz</a>${sizeOf(path.join(outputDir, 'data', 'combined.sqlite.gz'))} — one SQLite database of everything: the FOI observations union plus every open-data publication’s normalised rows (<code>register_history</code>).</li>`,
    '<li>One SQLite database per archive entry (one table per CSV), offered with its size from each entry’s own page below.</li>',
    '</ul>',
    '<!-- Reading the source? The site also serves ledger-lookup.sqlite.png and ledger-history.sqlite.png: those ARE plain SQLite databases (folded from the claim ledger), served for the in-browser surfaces\' HTTP range-request reads (sql.js-httpvfs). The .png extension defeats GitHub Pages\' gzip transcoding of Range responses, which corrupts partial reads. For a whole-database download use the .sqlite.gz downloads above; the .png files exist for the in-browser surfaces. -->',
    '<details><summary>Why do the site’s own database files end in <code>.png</code>?</summary>',
    '<p>The in-browser surfaces query their databases over HTTP <em>range requests</em> without downloading them whole. GitHub Pages gzip-transcodes text-like content types — including their range responses, which corrupts partial reads — but never re-compresses image types, so the databases the site queries live (<code>ledger-lookup.sqlite.png</code>, <code>ledger-history.sqlite.png</code>) wear a <code>.png</code> name. They are plain SQLite files; if you ended up with one, rename it to <code>.sqlite</code> and it will open normally. For a whole-database download, prefer the gzipped downloads above.</p>',
    '</details>',
    `<h2 id="open-data">Ofcom open data (${openDataKeys.length} publications)</h2>`,
    '<p>Ofcom publish the current amateur radio callsign dataset on their',
    '<a href="https://www.ofcom.org.uk/about-ofcom/our-research/opendata">open data page</a> —',
    'but only the current version, with no historical archive. This section preserves a copy of each',
    'publication as obtained at the time, byte-for-byte, so past register states remain checkable.</p>',
    `<table>${tableCaption('Archived Ofcom open-data publications')}<thead><tr><th scope="col">publication</th><th scope="col" class="n">files</th><th scope="col" class="n">size</th></tr></thead><tbody>`,
    ...openDataRows,
    '</tbody></table>',
    `<h2 id="foi">FOI requests and responses (${foiKeys.length} entries)</h2>`,
    '<p>Ofcom is a public body: under the Freedom of Information Act 2000 it must, on request, disclose',
    'information it holds (subject to the Act’s exemptions). Following years of such requests, Ofcom now',
    'publishes point-in-time callsign data periodically — the open data section above. This section archives',
    'amateur-radio FOI requests and responses recovered from Ofcom’s own published responses, the UK',
    'Government Web Archive, and third-party sites such as',
    `<a href="https://www.whatdotheyknow.com/">WhatDoTheyKnow</a> — a decade of ${glossaryTerm('register-snapshot', 1, { label: 'register snapshots' })},`,
    'availability lists and issuance records predating the open data page. Where, when and how each file',
    'was retrieved is recorded alongside it: machine-readably in the entry’s hash-pinned <code>meta.json</code>,',
    'and narratively in its correspondence record.</p>',
    `<table>${tableCaption('Archived FOI requests and responses')}<thead><tr><th scope="col">entry</th><th scope="col">${glossaryTerm('vintage', 1, { label: 'vintage' })}</th><th scope="col">${glossaryTerm('dataset-class', 1, { label: 'dataset classes' })}</th></tr></thead><tbody>`,
    ...foiRows,
    '</tbody></table>',
  ];
  const datasetsDir = path.join(outputDir, 'datasets');
  fs.mkdirSync(datasetsDir, { recursive: true });
  fs.writeFileSync(path.join(datasetsDir, 'index.html'), htmlPage('Dataset index', 1, indexBody, { currentNav: 'Dataset index', sourcePath: 'archive' }));

  const seriesPages = time('dataset-pages:series', () => buildSeriesPages(outputDir, baseUrl));
  pageUrls.push(...seriesPages.urls);
  const flagNames = new Set(parseFlagRegistry().map(r => r.flag));
  pageUrls.push(...time('dataset-pages:reports', () => buildReportPages(outputDir, baseUrl, foiKeys, seriesPages.series, flagNames)));

  // The forbidden-suffix section (issue #291 phase 2): a discrete, static,
  // crawlable section built like series/reports — one generator, wired here so
  // no cicd.yaml change is needed. It links its downloads to the FOI entry
  // copies published in the loop above, so it must build after them.
  pageUrls.push(...time('dataset-pages:forbidden-section', () => buildForbiddenSection(outputDir, baseUrl)));

  // The dataset-class section (issue #178): one page per class, listing every
  // entry across both lanes that carries it, headed by the class's registry
  // prose. Built like series/reports/forbidden — one generator, wired here.
  // It writes under datasets/classes/, so it must run after the dataset
  // entry pages the chips link back to.
  pageUrls.push(...time('dataset-pages:class-pages', () => buildClassPages(outputDir, baseUrl)));

  // The fidelity & integrity deep-dive (issue #438): the one page the inline
  // fidelity nudges land on — flag meanings, the provenance chain, worked
  // show-the-working examples from the newest publication, and the
  // reconstruction status. Built like the sections above; it reads the
  // committed archive + reference data, so ordering does not matter.
  pageUrls.push(...time('dataset-pages:fidelity', () => buildFidelityPage(outputDir, baseUrl)));

  // The inter-dataset statistics page (issue #177, Surface 2): a discrete,
  // static, crawlable view of statistics ACROSS publications (blank-product
  // filtering, record-count deltas, column/flag/pattern drift) — distinct from
  // the latest-publication statistics page. Built like the sections above; it
  // reads only the committed stats.json/meta.json, so ordering does not matter.
  pageUrls.push(...time('dataset-pages:interdataset-stats', () => buildInterdatasetStats(outputDir, baseUrl)));

  // The publisher section (issue #618, increment 2): one page per register
  // entry plus an index, cross-linking datasets to the bodies that authored or
  // hosted them. Built like the sections above — one generator, wired here so no
  // workflow change is needed; it reads the committed register + archive metas,
  // so ordering does not matter.
  pageUrls.push(...time('dataset-pages:publisher-pages', () => buildPublisherPages(outputDir, baseUrl)));

  const sitemap = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    `<url><loc>${baseUrl}/index.html</loc></url>`,
    `<url><loc>${baseUrl}/statistics.html</loc></url>`,
    `<url><loc>${baseUrl}/explore.html</loc></url>`,
    ...pageUrls.map(url => `<url><loc>${url}</loc></url>`),
    '</urlset>',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(outputDir, 'sitemap.xml'), sitemap);

  return { entryCount: openDataKeys.length + foiKeys.length, fileCount, totalBytes, pageUrls };
}

function main(): void {
  const [outputDir, baseUrl] = process.argv.slice(2).filter(a => a.trim().length > 0);
  if (!outputDir) {
    console.error('usage: node src/ci/build-dataset-pages.ts <output-dir> [base-url]');
    process.exitCode = 1;
    return;
  }
  const summary = buildDatasetPages(outputDir, baseUrl);
  console.log(`dataset pages: ${summary.entryCount} entries, ${summary.fileCount} files, ${formatBytes(summary.totalBytes)} (+ index, descriptors, sitemap)`);
  // Self-guarded: prints the profiling breakdown to stderr only under PERF.
  perfReport();
}

if (import.meta.main) {
  main();
}
