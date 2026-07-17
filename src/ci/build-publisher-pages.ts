#!/usr/bin/env node

/**
 * Builds the publisher section of the GitHub Pages site (issue #618, increment
 * 2): one page per register entry at publishers/{id}/index.html, plus a
 * publishers/index.html listing them all. A publisher page says what the
 * organisation IS (the roles it can hold, its operator, its homepage), states
 * the DEFAULT/typical licence basis on which the mirror may hold and republish
 * its material, explains the authority ceiling in the ADR 0014 vocabulary, and
 * lists the mirror's holdings BY RELATIONSHIP.
 *
 * Author, publication channel and host are SEPARATE AXES and the page keeps them
 * distinct: a dataset's AUTHOR is a claim about origin (derived from sourceKey —
 * every dataset the mirror holds is authored by Ofcom, wherever a copy
 * surfaces); a copy's HOST is where the bytes were obtained (derived from the
 * witness `channel` tokens, resolved through the register). Ofcom is the author
 * even of copies held via UKGWA, WhatDoTheyKnow or a web archive.
 *
 * Only DIRECT relationships exist in the data this increment reads — a holding a
 * publisher authored, or a copy obtained straight from that publisher. The
 * wording labels them as direct so transitive corroboration (a copy shown to
 * correspond to an authoritative one via an intermediary) can slot in later
 * without re-architecting the page.
 *
 * Licensing wording never overstates: `licenceBasis` is the publisher's
 * default/typical basis, and a specific publication — particularly a historical
 * vintage — may carry a different one (per-publication licence fields arrive in
 * a later increment). The register's own `licenceStatement` is the source; an
 * `unverified` basis is rendered honestly as "not established", never a guess.
 *
 * DELIBERATELY NOT COMMITTED: like the other generated pages this is derived at
 * deploy time from committed data (the register + the archive metas), so it is
 * deterministic for unchanged inputs (no timestamps).
 *
 * Usage: node src/ci/build-publisher-pages.ts <output-dir> [base-url]
 */

import * as fs from 'fs';
import * as path from 'path';
import { listArchiveKeys } from '../shared/archive.ts';
import { derivedEntryFile, derivedEntryFileExists } from '../shared/derived-entries.ts';
import { type ArchiveMeta } from '../shared/utils.ts';
import { DIRS } from '../shared/constants.ts';
import { listFoiEntryKeys, readFoiEntryMeta } from '../shared/foi-archive.ts';
import { parseCsvCached } from '../shared/parse-cache.ts';
import {
  readPublisherRegister,
  channelIndex,
  publisherIndexById,
  authorPublisherId,
  type PublisherEntry,
  type PublisherRegister,
} from '../shared/publishers.ts';
import {
  classifyWitnessAgreement,
  heldHashSet,
  type WitnessAgreement,
  type WitnessLike,
} from '../shared/witness-agreement.ts';
import {
  escapeHtml,
  externalLink,
  humanDate,
  monthYear,
  htmlPage,
  breadcrumbHtml,
  glossaryTerm,
  tableCaption,
  zeroCell,
} from './site-render.ts';
import { humaniseClassKey } from './dataset-class-overviews.ts';
import { classSlug, OPEN_DATA_IMPLICIT_CLASS } from './build-class-pages.ts';
import { fidelityHref } from './render/fidelity.ts';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const DEFAULT_BASE_URL = 'https://mysteraitch.github.io/amateur-callsigns-file-watch';

// The functional roles a publisher can hold, in plain English — what the
// organisation IS, not what any single holding is. Keyed by the register's
// machine tokens (src/shared/publishers.ts PUBLISHER_ROLES); an unmapped token
// falls back to a humanised form of the token itself so a future role never
// renders as a blank rather than loudly.
// Each phrase is a predicate that reads after "<name> is …", so a single- or
// multi-role sentence stays grammatical.
const ROLE_DESCRIPTIONS: Readonly<Record<string, string>> = {
  'originator': 'an originator of the material it publishes',
  'official-archive': 'an official government archive that captures and republishes others’ publications',
  'web-archive': 'a general-purpose web archive that replays third-party captures',
  'foi-aggregator': 'an aggregator that publishes and archives Freedom-of-Information correspondence',
  'community-documentation': 'a source of community-authored reference documentation',
  'incidental-host': 'an incidental host of material it does not curate',
};

// The machine licence-basis tokens (src/shared/publishers.ts LICENCE_BASES)
// rendered in plain English. `unverified` is the deliberate fail-honest value:
// it states the basis has NOT been established, never a flattering guess.
// Exported so the About page's register-derived acknowledgement (issue #560)
// reuses this one vocabulary rather than keeping a second copy that could drift.
export const LICENCE_BASIS_LABELS: Readonly<Record<string, string>> = {
  'ogl-v3': 'Open Government Licence v3',
  'ofcom-terms': 'Ofcom’s terms of use',
  'crown-copyright': 'Crown copyright',
  'copyright-cite-only': 'third-party copyright — cited, not redistributed in bulk',
  'site-terms': 'the host’s own site terms',
  'unverified': 'not established (unverified)',
};

// What material witnessed ONLY via this ceiling can at most carry, phrased for
// the trust-treatment section. The ceiling reuses ADR 0014's source-authority
// rungs verbatim; the glossary #axis-authority panel is the canonical
// definition, linked alongside.
const CEILING_DESCRIPTIONS: Readonly<Record<string, string>> = {
  'Official': 'an official publication direct from the body that issues it',
  'FOI': 'a Freedom-of-Information disclosure by the public authority that holds it',
  'Reference': 'an authoritative external reference, cited rather than mirrored in bulk',
  'Community': 'community-authored material, useful context rather than an authority',
  'Self': 'material this mirror derives or originates itself',
};

function humaniseToken(token: string): string {
  return token.replace(/-/g, ' ');
}

// ---- Holdings derivation ---------------------------------------------------

// A single archive entry as it relates to publishers: its author (from
// sourceKey) and the distinct publishers whose channels witnessed a copy of it
// (from witnesses[].channel, resolved through the register). Both lanes fold
// into this one shape so a publisher page reads across the whole corpus.
export interface Holding {
  key: string;
  lane: 'open-data' | 'foi';
  title: string;
  // sourceKey -> author publisher id; undefined when the sourceKey is unmapped
  // (surfaced as a flag rather than a guessed author).
  authorId: string | undefined;
  sourceKey: string;
  // Distinct publisher ids a copy of this entry was witnessed through, resolved
  // from the witness channel tokens. Empty when the entry carries no witness
  // (an open-data publication fetched live directly from its author).
  witnessPublisherIds: string[];
  // The strongest agreement class of the copies witnessed through each publisher
  // (#618 increment 3), derived on read against the entry's held bytes:
  // corroborating (byte-identical held) beats divergent beats citation-grade.
  // Keyed by publisher id, for every id in witnessPublisherIds.
  witnessAgreementByPublisher: Record<string, WitnessAgreement>;
  // Witness channel tokens that did NOT resolve to any publisher — surfaced, not
  // dropped (the validator is the loud line of defence; this keeps the page
  // honest if it is ever built against an unvalidated register).
  unresolvedChannels: string[];
  datasetClasses?: string[];
  // The data vintage as a comparable ISO string (date or month): the archive key
  // for open-data publications, `dataVintage` for FOI entries. Absent for FOI
  // entries that declare no vintage (rendered honestly as undated).
  vintage?: string;
  // Scale — the row count of the LARGEST SINGLE normalised table, never a
  // cross-sheet sum (which would double-count a callsign held on two sheets).
  // Absent when the entry has no tabular data (a not-held response, a letter).
  recordCount?: number;
  // How many normalised tables the entry holds (open-data always one; a
  // multi-sheet FOI workbook several). Used to caveat the scale as the largest
  // of k tables rather than pretending it is one figure.
  tableCount?: number;
  // Declared coverage — the publisher's INTENDED scope. Present only on the
  // open-data lane, which carries the field; a `false` complete means declared
  // partial. FOI entries have no such field and render as "not declared".
  coverage?: { complete: boolean; scopeNotes?: string };
  // True when the lane carries an intendedCoverage field at all (open-data). The
  // FOI lane does not, so its absence is "not declared", never "declared
  // partial".
  hasCoverageField?: boolean;
  // Verified-quality observations recorded against the publication (open-data
  // lane). A count so several fold into one flag; coverageAffecting is surfaced
  // distinctly because such absences are not evidence.
  qualityCount?: number;
  coverageAffecting?: boolean;
  // Provenance of the archived bytes; 'recovered-from-web-archive' is a notable
  // marker, with the capturing archive named by recoveredChannels.
  provenance?: string;
  // Distinct web-archive channels a copy was recovered through (UKGWA, Wayback),
  // display-cased. Empty when the bytes came direct from the author.
  recoveredChannels?: string[];
  // Archive-side recovery state (FOI lane): 'partial' or 'unrecovered' when the
  // disclosed dataset was not fully captured. Absent = fully recovered.
  datasetRecovery?: string;
  // The FOI-transaction outcome ('successful' / 'not held'); a 'not held'
  // response is a notable record rather than a dataset.
  outcome?: string;
  // True when the entry holds an .xlsx workbook — the first such publication by
  // vintage is a notable marker (Ofcom's first spreadsheet disclosure).
  hasXlsx?: boolean;
}

// Exact row count of a normalised CSV — parsed (not line-counted) so a quoted
// embedded newline never miscounts; the process-lifetime memo collapses repeat
// parses across the build.
function countCsvDataRows(filePath: string): number {
  if (!fs.existsSync(filePath)) return 0;
  return parseCsvCached(filePath, { columns: true, skip_empty_lines: true, bom: true }, 'parse:publisher-scale').length;
}

// The web-archive channels a set of witness tokens recovered a copy through,
// display-cased and de-duplicated. Only the recognised archive channels count;
// a live/direct fetch is not a recovery.
const RECOVERY_CHANNEL_LABELS: Readonly<Record<string, string>> = {
  'ukgwa': 'UKGWA',
  'wayback': 'Wayback',
};
function recoveredChannelsOf(channels: string[]): string[] {
  const out: string[] = [];
  for (const channel of channels) {
    const label = RECOVERY_CHANNEL_LABELS[channel];
    if (label !== undefined && !out.includes(label)) out.push(label);
  }
  return out;
}

function anyXlsx(fileNames: Iterable<string>): boolean {
  for (const name of fileNames) if (name.toLowerCase().endsWith('.xlsx')) return true;
  return false;
}

// The site-root-relative path of an entry's page (the publisher pages link to
// it from depth 2, so callers prepend their own '../').
function entryHref(holding: Holding): string {
  return holding.lane === 'open-data'
    ? `datasets/open-data/${encodeURIComponent(holding.key)}/index.html`
    : `datasets/foi/${encodeURIComponent(holding.key)}/index.html`;
}

// The precedence used to fold several witnesses of one publisher into a single
// agreement class for a holding: a corroborating copy (byte-identical held) is
// the strongest statement of availability, a divergent one the next-strongest
// finding, citation-grade the weakest (a location only).
const AGREEMENT_PRECEDENCE: Record<WitnessAgreement, number> = {
  'corroborating': 2,
  'divergent': 1,
  'citation-grade': 0,
};

function strongerAgreement(a: WitnessAgreement, b: WitnessAgreement): WitnessAgreement {
  return AGREEMENT_PRECEDENCE[a] >= AGREEMENT_PRECEDENCE[b] ? a : b;
}

// Resolve the distinct publisher ids (and any unresolved tokens) for a set of
// witnesses, deduplicated and register-ordered by first sight, tracking the
// strongest agreement class witnessed through each publisher (derived on read
// against the entry's held bytes).
function resolveWitnessPublishers(
  witnesses: WitnessLike[],
  chIndex: Map<string, PublisherEntry>,
  heldHashes: ReadonlySet<string>,
): { ids: string[]; unresolved: string[]; agreementByPublisher: Record<string, WitnessAgreement> } {
  const ids: string[] = [];
  const unresolved: string[] = [];
  const agreementByPublisher: Record<string, WitnessAgreement> = {};
  for (const witness of witnesses) {
    const publisher = chIndex.get(witness.channel);
    if (publisher === undefined) {
      if (!unresolved.includes(witness.channel)) unresolved.push(witness.channel);
      continue;
    }
    if (!ids.includes(publisher.id)) ids.push(publisher.id);
    const agreement = classifyWitnessAgreement(witness.sha256, heldHashes);
    const existing = agreementByPublisher[publisher.id];
    agreementByPublisher[publisher.id] = existing === undefined ? agreement : strongerAgreement(existing, agreement);
  }
  return { ids, unresolved, agreementByPublisher };
}

// Sweep both lanes into the flat holdings list, resolving each entry's author
// and witness publishers. Reads the committed archive; deterministic for
// unchanged inputs.
// The record count from an entry's mode-resolved stats.json, or undefined when
// the entry has no derived stats at all (a raw-only source - honest absence).
// A stats.json that EXISTS but carries no numeric recordCount is an integrity
// failure and fails loudly: every stats schema version has carried the field,
// so its absence means corruption, not a legitimate blank.
function statsRecordCount(key: string, archiveDir: string): number | undefined {
  if (!derivedEntryFileExists(key, 'stats.json', archiveDir)) return undefined;
  const statsPath = derivedEntryFile(key, 'stats.json', archiveDir);
  const stats = JSON.parse(fs.readFileSync(statsPath, 'utf8')) as { recordCount?: unknown };
  if (typeof stats.recordCount !== 'number') {
    throw new Error(`${statsPath}: stats.json carries no numeric recordCount - refusing to publish an unaccounted holdings figure`);
  }
  return stats.recordCount;
}

export function collectHoldings(
  register: PublisherRegister,
  archiveDir: string = DIRS.archive,
  foiDir: string = path.join(REPO_ROOT, 'archive', 'foi'),
): Holding[] {
  const chIndex = channelIndex(register);
  const holdings: Holding[] = [];

  for (const key of listArchiveKeys().sort()) {
    const meta = JSON.parse(fs.readFileSync(path.join(archiveDir, key, 'meta.json'), 'utf8')) as ArchiveMeta;
    const heldHashes = heldHashSet(Object.values(meta.files).map(f => f.sha256));
    const witnesses = meta.witnesses ?? [];
    const channels = witnesses.map(w => w.channel);
    const { ids, unresolved, agreementByPublisher } = resolveWitnessPublishers(witnesses, chIndex, heldHashes);
    // Open-data scale is the declared record count of the normalised register
    // (no CSV parse needed) - and for an entry whose meta carries no
    // declaration (a publication newer than the frozen committed derivatives),
    // the same figure from the mode-resolved stats.json, so the holdings table
    // never under-reports an entry the deploy demonstrably serves in full.
    const normalisedCount = meta.files['normalised.csv']?.recordCount ?? statsRecordCount(key, archiveDir);
    const quality = meta.qualityObservations ?? [];
    holdings.push({
      key,
      lane: 'open-data',
      title: `Publication of ${humanDate(key)}`,
      authorId: authorPublisherId(meta.sourceKey),
      sourceKey: meta.sourceKey,
      witnessPublisherIds: ids,
      witnessAgreementByPublisher: agreementByPublisher,
      unresolvedChannels: unresolved,
      datasetClasses: [OPEN_DATA_IMPLICIT_CLASS],
      vintage: key,
      recordCount: normalisedCount,
      tableCount: normalisedCount === undefined ? 0 : 1,
      coverage: meta.intendedCoverage,
      hasCoverageField: true,
      qualityCount: quality.length,
      coverageAffecting: quality.some(o => o.coverageAffecting === true),
      provenance: meta.provenance,
      recoveredChannels: recoveredChannelsOf(channels),
      hasXlsx: anyXlsx(Object.keys(meta.files)),
    });
  }

  for (const key of listFoiEntryKeys(foiDir)) {
    const meta = readFoiEntryMeta(foiDir, key);
    // witnessed any of its files. Agreement is against the union of the entry's
    // held file hashes, so a copy the mirror holds anywhere corroborates.
    const heldHashes = heldHashSet(Object.values(meta.files).map(f => f.sha256));
    const witnesses = Object.values(meta.files).flatMap(f => f.witnesses ?? []);
    const channels = witnesses.map(w => w.channel);
    const { ids, unresolved, agreementByPublisher } = resolveWitnessPublishers(witnesses, chIndex, heldHashes);
    // FOI scale is counted from the normalised tables at build time (the lane
    // carries no recordCount). The reported figure is the LARGEST SINGLE table,
    // never the sum across sheets — a callsign on two sheets must not be counted
    // twice.
    const normalisedNames = Object.entries(meta.files)
      .filter(([, decl]) => decl.role === 'normalised')
      .map(([name]) => name);
    const tableCounts = normalisedNames.map(name => countCsvDataRows(path.join(foiDir, key, name)));
    holdings.push({
      key,
      lane: 'foi',
      title: meta.title,
      authorId: authorPublisherId(meta.sourceKey),
      sourceKey: meta.sourceKey,
      witnessPublisherIds: ids,
      witnessAgreementByPublisher: agreementByPublisher,
      unresolvedChannels: unresolved,
      datasetClasses: meta.datasetClasses,
      vintage: meta.dataVintage ?? undefined,
      recordCount: tableCounts.length > 0 ? Math.max(...tableCounts) : undefined,
      tableCount: normalisedNames.length,
      hasCoverageField: false,
      qualityCount: 0,
      coverageAffecting: false,
      recoveredChannels: recoveredChannelsOf(channels),
      datasetRecovery: meta.datasetRecovery,
      outcome: meta.outcome,
      hasXlsx: anyXlsx(Object.keys(meta.files)),
    });
  }

  return holdings;
}

// The two holding relationships a publisher page groups by. `authored` is the
// entries this publisher originated; `hosted` is the entries a copy of which was
// obtained via this publisher's channels (which may include entries it also
// authored — Ofcom both authors and self-hosts).
export interface PublisherHoldings {
  authored: Holding[];
  hosted: Holding[];
}

export function holdingsForPublisher(publisherId: string, holdings: Holding[]): PublisherHoldings {
  return {
    authored: holdings.filter(h => h.authorId === publisherId),
    hosted: holdings.filter(h => h.witnessPublisherIds.includes(publisherId)),
  };
}

// ---- Rendering -------------------------------------------------------------

// A publisher page sits at publishers/{id}/ (depth 2); the index at
// publishers/ (depth 1). The helpers below build depth-correct links from
// either.
const PUBLISHER_PAGE_DEPTH = 2;
const PUBLISHER_INDEX_DEPTH = 1;

// The relative href to a publisher's page from a page at the given depth below
// the site root.
export function publisherHref(publisherId: string, depthToRoot: number): string {
  return `${'../'.repeat(depthToRoot)}publishers/${encodeURIComponent(publisherId)}/index.html`;
}

function rolesSentence(entry: PublisherEntry): string {
  const parts = entry.roles.map(r => ROLE_DESCRIPTIONS[r] ?? humaniseToken(r));
  if (parts.length === 0) return `${escapeHtml(entry.name)} has no role recorded.`;
  if (parts.length === 1) return `${escapeHtml(entry.name)} is ${escapeHtml(parts[0])}.`;
  const last = parts[parts.length - 1];
  const head = parts.slice(0, -1).map(escapeHtml).join(', ');
  return `${escapeHtml(entry.name)} is ${head}, and ${escapeHtml(last)}.`;
}

function identitySection(entry: PublisherEntry): string {
  const rows: string[] = [];
  rows.push(`<tr><th scope="row">What it is</th><td>${rolesSentence(entry)}</td></tr>`);
  if (entry.operator !== undefined) {
    rows.push(`<tr><th scope="row">Operator</th><td>${escapeHtml(entry.operator)}</td></tr>`);
  }
  rows.push(`<tr><th scope="row">Roles</th><td>${entry.roles.map(r => `<code>${escapeHtml(r)}</code>`).join(', ')}</td></tr>`);
  rows.push(`<tr><th scope="row">Homepage</th><td>${externalLink(entry.url, entry.url)}</td></tr>`);
  return [
    '<h2>What this publisher is</h2>',
    `<p>${rolesSentence(entry)} The roles describe what the organisation <em>can be</em>; each holding below records its own author and host independently, so a page never conflates the two.</p>`,
    `<table>${tableCaption(`Identity of ${entry.name}`)}<tbody>${rows.join('')}</tbody></table>`,
  ].join('\n');
}

function licenceSection(entry: PublisherEntry): string {
  const basisLabel = LICENCE_BASIS_LABELS[entry.licenceBasis] ?? humaniseToken(entry.licenceBasis);
  const unverified = entry.licenceBasis === 'unverified';
  const basisLine = unverified
    ? `<p><b>Default licence basis:</b> <b>not established</b> — recorded as <code>unverified</code>. The mirror does not assert a basis it has not checked; a basis must be settled before any of this publisher's material is redistributed. This is a fail-honest state, not a claim.</p>`
    : `<p><b>Default licence basis:</b> ${escapeHtml(basisLabel)} (<code>${escapeHtml(entry.licenceBasis)}</code>). This is the publisher's <em>default/typical</em> basis, not a blanket claim over its whole catalogue: licensing is publication-specific, so a specific publication — particularly a historical vintage — may carry a different basis and override this default.</p>`;
  const statement = `<p>${escapeHtml(entry.licenceStatement)}</p>`;
  const terms = entry.licenceUrl !== undefined
    ? `<p>Governing terms: ${externalLink(entry.licenceUrl, entry.licenceUrl)}.</p>`
    : `<p>No settled terms document to cite (the basis is <code>unverified</code>).</p>`;
  // How to verify this: the pages a human would visit to reach the same
  // conclusion, each with what it establishes. No licence claim rests on
  // evidence the public cannot check; an unverified basis says so honestly.
  const citations = entry.licenceCitations.length > 0
    ? [
      '<h3>How to verify this</h3>',
      `<p>Each source below has been read and confirmed to say what its note claims — follow the links to check for yourself:</p>`,
      `<ul>${entry.licenceCitations.map(c => `<li>${externalLink(c.url, c.url)} — ${escapeHtml(c.note)}</li>`).join('')}</ul>`,
    ].join('\n')
    : `<p><small>No verifiable licence source is cited: the basis is <code>unverified</code>, so a citation would overstate what has been checked. The statement above records what was sought and not found.</small></p>`;
  const notes = entry.notes !== undefined ? `<p><small>${escapeHtml(entry.notes)}</small></p>` : '';
  return [
    '<h2>Licence basis</h2>',
    basisLine,
    statement,
    terms,
    citations,
    notes,
  ].filter(s => s !== '').join('\n');
}

function trustSection(entry: PublisherEntry): string {
  const ceilingDesc = CEILING_DESCRIPTIONS[entry.authorityCeiling] ?? '';
  return [
    '<h2>Trust treatment</h2>',
    `<p>Material witnessed <em>only</em> through this publisher can carry at most the <b>${escapeHtml(entry.authorityCeiling)}</b> rung on the ${glossaryTerm('axis-authority', PUBLISHER_PAGE_DEPTH, { label: 'source-authority axis' })}${ceilingDesc === '' ? '' : ` — ${escapeHtml(ceilingDesc)}`}.</p>`,
    `<p>This is a <em>ceiling</em>, a cross-check — not a second trust dial. A dataset's rung is still derived from the lane its bytes live in (ADR 0014); the ceiling only flags where a surfaced rung would exceed what the witnessing publisher can support, and never inflates one. Where a copy is later shown to correspond byte-for-byte to a higher-authority original, that authority is derived transitively from the correspondence, and labelled distinctly from a direct claim.</p>`,
  ].join('\n');
}

// ---- Holdings composite: overview map → vintage timeline → scan-strip rows ---
//
// The authored/hosted holdings render as a composite (issue #637): an
// anchor-linked overview MAP on top (one lettered, kind-tinted cell per dataset,
// stacked on a continuous vintage axis so empty years show as gaps), a vintage
// TIMELINE as the structure (year headings, newest first), and a five-signal
// SCAN STRIP per dataset nested within (vintage · scale + shared-axis bar ·
// declared coverage, with notable/quality flags right-aligned) above the title,
// derived blurb (#636) and calm metadata pills. Every signal is derived from the
// committed metadata; nothing is inferred. Colour is never the sole cue — the
// map's letters carry the kind, and every glyph is paired with words.

// The shared magnitude axis (rows) the scale bars are drawn against, so a
// truncated publication reads as a short bar beside a full-length one. Chosen a
// little above the largest register snapshot so full snapshots nearly fill it.
const SCALE_AXIS_MAX = 160000;

// The composite's stylesheet, emitted once per page inside the holdings section.
// It layers on the shared design tokens (--ink/--paper/--accent/--line/--muted,
// light + dark) the page shell already inlines; the good/warn signal colours and
// the per-kind tints are defined here with a dark-mode variant so the composite
// reads correctly in both themes. Every glyph is paired with words and every
// cell carries a letter, so colour is never the sole cue.
const HOLDINGS_STYLE = [
  '<style>',
  // Overview map (candidate E)
  '.hold-map{border:1px solid var(--line);border-radius:10px;padding:.7rem .9rem;margin:.5rem 0 1.1rem;background:color-mix(in srgb,var(--accent) 2%,var(--paper))}',
  '.hold-map-lead{margin:0 0 .6rem;font-size:.82rem;color:var(--muted);line-height:1.4}',
  '.hold-map-grid{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:.18rem}',
  '.hold-map-yr{list-style:none;display:grid;grid-template-columns:3.4rem 1fr;align-items:center;gap:.55rem;min-height:1.55rem}',
  '.hold-map-yrlab{font-size:.76rem;color:var(--muted);font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}',
  '.hold-map-yr--empty{opacity:.7}.hold-map-yr--empty .hold-map-cells::before{content:"—";color:var(--muted);font-size:.8rem}',
  '.hold-map-cells{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:.25rem;min-height:1.35rem;align-items:center}',
  '.hold-map-cells li{list-style:none;margin:0}',
  '.hold-cell{display:flex;align-items:center;justify-content:center;width:1.5rem;height:1.5rem;border-radius:5px;font-size:.72rem;font-weight:700;font-family:ui-monospace,monospace;text-decoration:none;--kh:#8a8f98;background:color-mix(in srgb,var(--kh) 22%,var(--paper));border:1px solid color-mix(in srgb,var(--kh) 52%,var(--paper));color:var(--ink)}',
  // Every map cell is an <a> (it links to its row), and site/ledger.css's
  // page-wide `.ledger a{color:var(--raw)}` (specificity 0,1,1) otherwise beats
  // `.hold-cell`'s own colour (0,1,0) regardless of load order, dimming every
  // kind letter to the link colour instead of the intended ink (issue #687).
  // Scoping the override to the map's own ancestor (0,2,1) settles it by
  // specificity alone, so it holds however the stylesheets end up ordered -
  // the legend reuses `.hold-cell` on a bare <span>, which `.ledger a` never
  // matches, so it already read correctly and needs no equivalent rule.
  '.hold-map a.hold-cell{color:var(--ink)}',
  '.hold-cell:hover,.hold-cell:focus-visible{outline:2px solid var(--accent);outline-offset:1px}',
  '.hold-cell[data-kind="register-snapshot"]{--kh:#3b82c4}',
  '.hold-cell[data-kind="available-pool"]{--kh:#3f9d6b}',
  '.hold-cell[data-kind="issuance-events"]{--kh:#c07d1a}',
  '.hold-cell[data-kind="forbidden-list"]{--kh:#c0485d}',
  '.hold-cell[data-kind="statistics-aggregate"]{--kh:#7c6bcc}',
  '.hold-cell[data-kind="attribute-addendum"]{--kh:#3fa3a3}',
  '.hold-cell[data-kind="reference-context"]{--kh:#8a8f98}',
  '.hold-legend{list-style:none;display:flex;flex-wrap:wrap;gap:.55rem 1rem;margin:.65rem 0 0;padding:.55rem 0 0;border-top:1px solid var(--line);font-size:.76rem;color:var(--muted)}',
  '.hold-legend li{list-style:none;margin:0;display:flex;align-items:center;gap:.3rem}',
  '.hold-cell--legend{width:1.3rem;height:1.3rem;font-size:.68rem}',
  // Timeline (candidate B) + rows
  '.hold-timeline{list-style:none;margin:.3rem 0 0;padding:0}',
  '.hold-yeargroup{list-style:none;margin:0;border-left:2px solid var(--line);padding:0 0 .2rem .9rem}',
  '.hold-yeargroup--undated{border-left-style:dashed}',
  '.hold-yearhead{display:flex;align-items:baseline;gap:.55rem;margin:.85rem 0 .5rem;font-size:1.15rem;line-height:1.1}',
  '.hold-yearnum{font-weight:700;font-variant-numeric:tabular-nums}',
  '.hold-yearcount{font-size:.72rem;font-weight:400;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}',
  '.hold-rows{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:.5rem}',
  '.hold-row{list-style:none;border:1px solid var(--line);border-radius:9px;padding:.5rem .7rem;background:color-mix(in srgb,var(--accent) 3%,var(--paper));scroll-margin-top:4rem}',
  '.hold-row:target{border-color:var(--accent);box-shadow:0 0 0 2px color-mix(in srgb,var(--accent) 32%,transparent);background:color-mix(in srgb,var(--accent) 8%,var(--paper))}',
  // Scan strip (candidate A) — one shared grid template so columns align across
  // every row, the bars sharing one left edge and the ticks one column.
  '.hold-strip{display:grid;grid-template-columns:5.8rem minmax(8.5rem,12rem) 9rem 1fr;column-gap:.8rem;align-items:start}',
  '.hold-col{min-width:0}',
  '.hold-vintage{font-size:.82rem;color:var(--muted);font-variant-numeric:tabular-nums;padding-top:.12rem}',
  '.hold-vintage--none{font-style:italic}',
  '.hold-scale{display:flex;flex-direction:column;gap:.2rem}',
  '.hold-num{font-size:.95rem;line-height:1.1}.hold-num b{font-weight:700;font-variant-numeric:tabular-nums}',
  '.hold-unit{color:var(--muted);font-size:.77rem}',
  '.hold-bar{display:block;height:5px;width:100%;background:color-mix(in srgb,var(--ink) 9%,var(--paper));border-radius:3px;overflow:hidden}',
  '.hold-bar-fill{display:block;height:100%;background:color-mix(in srgb,var(--accent) 55%,var(--paper));border-radius:3px}',
  '.hold-scale-note{font-size:.71rem;color:var(--muted)}',
  '.hold-scale--none{font-size:.82rem;color:var(--muted);font-style:italic;padding-top:.12rem}',
  '.hold-cov{font-size:.82rem;display:flex;align-items:baseline;gap:.28rem;padding-top:.12rem}',
  '.hold-cov-glyph{font-weight:700}',
  '.hold-cov--complete{color:#3f7d55}.hold-cov--partial{color:#8a3c00}.hold-cov--none{color:var(--muted)}',
  // Flags cell: notable exceptions, orange and right-aligned, interrupting the scan.
  '.hold-flags{display:flex;flex-wrap:wrap;gap:.3rem;justify-content:flex-end;align-content:flex-start}',
  '.hold-flag{font-size:.73rem;padding:.13rem .5rem;border-radius:999px;white-space:nowrap;line-height:1.45}',
  '.hold-flag--note{color:#7a3d00;background:#fbeee2;border:1px solid #e6c9a8}',
  '.hold-flag--issue{color:#7a3d00;background:#fbeee2;border:1px solid #c98a3f;font-weight:600;text-decoration:none}',
  '.hold-flag--issue:hover{border-color:#7a3d00}',
  // Corroboration pill (#618 increment 3): a hosted copy proven byte-identical
  // to a held one — a calm POSITIVE green, distinct from the orange note/issue
  // pills, because provable availability is not an exception to flag.
  '.hold-flag--held{color:#2c6a45;background:#e8f3ec;border:1px solid #b6dcc4}',
  // Body: title with a demoted key, the derived blurb, calm kind pills on their own line.
  '.hold-body{margin-top:.45rem}',
  '.hold-title{font-size:1rem;font-weight:600;text-decoration:none;color:var(--accent)}.hold-title:hover{text-decoration:underline}',
  '.hold-key{font-size:.71rem;color:var(--muted);margin-left:.35rem}',
  '.hold-blurb{margin:.28rem 0 .4rem;font-size:.88rem;line-height:1.45;color:var(--ink)}',
  '.hold-tags{list-style:none;display:flex;flex-wrap:wrap;gap:.3rem;margin:.15rem 0 0;padding:0}',
  '.hold-tags li{list-style:none;margin:0}',
  '.hold-tag{display:inline-block;font-size:.73rem;padding:.1rem .5rem;border-radius:999px;text-decoration:none;color:#2c5a72;background:#eaf1f6;border:1px solid #cfe0ea}',
  '.hold-tag:hover{border-color:#2c5a72}',
  // Dark-mode signal colours and pill tints.
  '@media(prefers-color-scheme:dark){',
  '.hold-cov--complete{color:#7fbf97}.hold-cov--partial{color:#e8a35c}',
  '.hold-flag--note{color:#e8b877;background:#2a2016;border-color:#6a4a1f}',
  '.hold-flag--issue{color:#e8b877;background:#2a2016;border-color:#8a5a1f}.hold-flag--issue:hover{border-color:#e8b877}',
  '.hold-flag--held{color:#7fbf97;background:#16261c;border-color:#2f5a3f}',
  '.hold-tag{color:#9dc4d8;background:#16242c;border-color:#2c4048}.hold-tag:hover{border-color:#9dc4d8}',
  '}',
  // Narrow viewport: a light reflow so nothing overflows; full refinement deferred.
  '@media(max-width:40rem){.hold-strip{grid-template-columns:1fr 1fr;row-gap:.35rem}.hold-flags{grid-column:1/-1;justify-content:flex-start}.hold-cov{grid-column:1/-1}}',
  '</style>',
].join('');

// One letter per dataset kind, carried on the map cell so kind is legible
// without relying on the tint (colour is never the sole cue). An unmapped class
// falls back to its own initial rather than rendering blank. Exported so the
// home-page holdings map (src/ci/build-front-door.ts) reuses this one
// vocabulary and its cells read as the same component, never a second copy that
// could drift.
export const KIND_LETTER: Readonly<Record<string, string>> = {
  'register-snapshot': 'R',
  'available-pool': 'A',
  'issuance-events': 'I',
  'forbidden-list': 'F',
  'statistics-aggregate': 'S',
  'attribute-addendum': 'T',
  'reference-context': 'C',
};

// The blurb vocabulary (#636): a plain-English noun for each kind and the unit
// its scale counts, so a derived sentence reads naturally ("A register snapshot
// of ~158,000 callsigns …", "A list of forbidden suffixes …"). Reuses the
// dataset-class vocabulary's own sense; an unmapped class humanises its token.
const KIND_BLURB: Readonly<Record<string, { noun: string; unit: string }>> = {
  'register-snapshot': { noun: 'register snapshot', unit: 'callsigns' },
  'available-pool': { noun: 'list of available callsigns', unit: 'callsigns' },
  'issuance-events': { noun: 'log of issuance events', unit: 'events' },
  'forbidden-list': { noun: 'list of forbidden suffixes', unit: 'suffixes' },
  'statistics-aggregate': { noun: 'set of statistics', unit: 'rows' },
  'attribute-addendum': { noun: 'set of per-callsign attributes', unit: 'records' },
  'reference-context': { noun: 'reference record', unit: 'rows' },
};

// The corpus-relative notability of one holding within the set being rendered:
// the earliest by vintage, the largest single table, the first spreadsheet
// publication. Computed once per set so a row can be flagged without a repeat
// scan.
interface HoldingMarks {
  earliestKey: string | undefined;
  largestKey: string | undefined;
  firstXlsxKey: string | undefined;
}

// The kind a holding is drawn as: its first declared class, or the lane's
// default. Exported alongside kindLetter so the home-page holdings map derives
// each cell's kind exactly as the publisher pages do.
export function primaryClass(h: Holding): string {
  return (h.datasetClasses ?? [])[0] ?? (h.lane === 'open-data' ? OPEN_DATA_IMPLICIT_CLASS : 'reference-context');
}

export function kindLetter(cls: string): string {
  return KIND_LETTER[cls] ?? cls.charAt(0).toUpperCase();
}

// The site-root-relative dataset-page href of a holding (open-data by
// publication date, FOI by request key). Exported so the home-page holdings map
// links each cell to the very page the publisher pages link their rows' titles
// to — one source for the destination, never a second that could drift.
export function holdingEntryHref(holding: Holding): string {
  return entryHref(holding);
}

// A vintage ISO (date or month) as a month-precision label for the scan surface
// and the exact value for its title attribute, per the established date
// convention.
function vintageParts(vintage: string): { short: string; exact: string } {
  const monthLabel = monthYear(vintage.slice(0, 7));
  const exact = /^\d{4}-\d{2}-\d{2}$/.test(vintage) ? humanDate(vintage) : monthLabel;
  return { short: monthLabel, exact };
}

// A friendly ~N approximation for the blurb, rounded coarser the larger it gets
// so it reads as "about", never as a precise figure the strip already carries.
function approxCount(n: number): string {
  let rounded: number;
  if (n >= 10000) rounded = Math.round(n / 1000) * 1000;
  else if (n >= 1000) rounded = Math.round(n / 100) * 100;
  else if (n >= 100) rounded = Math.round(n / 10) * 10;
  else rounded = n;
  return `~${rounded.toLocaleString('en-GB')}`;
}

// The derived per-dataset blurb (#636): kind in plain English, scale, vintage
// and any declared scope, saying only what the record knows and humanising thin
// data rather than padding it. A not-held response says so plainly, and names
// the very FOI response it rests on — the same one linked immediately above
// this blurb in the row's title, so the citation is not left bare.
function holdingBlurb(h: Holding, rel: string): string {
  const vintageClause = h.vintage === undefined
    ? ''
    : ` ${h.lane === 'open-data' ? 'as published' : 'as at'} ${escapeHtml(vintageParts(h.vintage).exact)}`;

  if (h.outcome === 'not held') {
    return `A <a href="${rel}${entryHref(h)}">Freedom-of-Information response</a> (<code>${escapeHtml(h.key)}</code>) recording that Ofcom does not hold this data${vintageClause}.`;
  }

  const classes = h.datasetClasses ?? [];
  const nouns = (classes.length > 0 ? classes : [primaryClass(h)])
    .map(c => KIND_BLURB[c]?.noun ?? escapeHtml(humaniseClassKey(c).toLowerCase()));
  const nounPhrase = nouns.length > 1 ? `${nouns.slice(0, -1).join(', ')} and ${nouns[nouns.length - 1]}` : nouns[0];
  const article = /^[aeiou]/i.test(nounPhrase) ? 'An' : 'A';

  const unit = KIND_BLURB[primaryClass(h)]?.unit ?? 'rows';
  const rc = h.recordCount;
  const scaleClause = rc === undefined || rc === 0
    ? ''
    : ` of ${approxCount(rc)} ${unit}${(h.tableCount ?? 1) > 1 ? ` (its largest of ${h.tableCount} tables)` : ''}`;

  const scopeClause = h.coverage?.scopeNotes !== undefined ? `, ${escapeHtml(h.coverage.scopeNotes)}` : '';

  return `${article} ${nounPhrase}${scaleClause}${vintageClause}${scopeClause}.`;
}

// The vintage cell: month precision on the surface, the exact value in the
// title, undated stated honestly.
function vintageCell(h: Holding): string {
  if (h.vintage === undefined) {
    return '<span class="hold-col hold-vintage hold-vintage--none">undated</span>';
  }
  const { short, exact } = vintageParts(h.vintage);
  return `<span class="hold-col hold-vintage" title="${escapeHtml(exact)}">${escapeHtml(short)}</span>`;
}

// The scale cell: the largest single table's row count (never a cross-sheet sum)
// with a shared-axis bar beneath it, so magnitude is glanceable and the bars
// share one left-hand edge down the column. Entries with no tabular data say so.
function scaleCell(h: Holding): string {
  const rc = h.recordCount;
  if (rc === undefined || rc === 0) {
    return '<span class="hold-col hold-scale hold-scale--none">no tabular data</span>';
  }
  const unit = KIND_BLURB[primaryClass(h)]?.unit ?? 'rows';
  const pct = Math.min(100, Math.round((rc / SCALE_AXIS_MAX) * 100));
  const tablesNote = (h.tableCount ?? 1) > 1
    ? `<span class="hold-scale-note">largest of ${h.tableCount} tables</span>`
    : '';
  return [
    '<span class="hold-col hold-scale">',
    `<span class="hold-num"><b>${rc.toLocaleString('en-GB')}</b> <span class="hold-unit">${escapeHtml(unit)}</span></span>`,
    `<span class="hold-bar"><span class="hold-bar-fill" style="width:${pct}%"></span></span>`,
    tablesNote,
    '</span>',
  ].join('');
}

// The declared-coverage cell: glyph + words, never colour alone. Only the
// open-data lane carries the field; FOI has none and reads "not declared".
function coverageCell(h: Holding): string {
  if (h.hasCoverageField !== true || h.coverage === undefined) {
    return '<span class="hold-col hold-cov hold-cov--none"><span class="hold-cov-glyph" aria-hidden="true">–</span> not declared</span>';
  }
  if (h.coverage.complete) {
    return '<span class="hold-col hold-cov hold-cov--complete"><span class="hold-cov-glyph" aria-hidden="true">✓</span> declared complete</span>';
  }
  const scope = h.coverage.scopeNotes;
  return `<span class="hold-col hold-cov hold-cov--partial"${scope === undefined ? '' : ` title="${escapeHtml(scope)}"`}><span class="hold-cov-glyph" aria-hidden="true">◐</span> declared partial</span>`;
}

// The flags cell (right-aligned, orange): the notable exceptions that
// deliberately interrupt the vertical scan. Notability markers each carry their
// own words; several data-quality observations fold into a single COUNT rather
// than stacking, linking to the fidelity page.
function flagsCell(h: Holding, depthToRoot: number, marks: HoldingMarks, forPublisherId?: string): string {
  const notes: string[] = [];
  if (marks.earliestKey === h.key) notes.push('★ earliest holding');
  if (marks.largestKey === h.key) notes.push('▲ largest single table');
  const recovered = h.recoveredChannels ?? [];
  if (recovered.length > 0) notes.push(`recovered · ${recovered.map(escapeHtml).join(' · ')}`);
  if (h.outcome === 'not held') notes.push('not held');
  if (h.datasetRecovery === 'partial') notes.push('partial recovery');
  else if (h.datasetRecovery === 'unrecovered') notes.push('unrecovered');
  if (marks.firstXlsxKey === h.key) notes.push('first spreadsheet');

  const pills = notes.map(n => `<span class="hold-flag hold-flag--note">${n}</span>`);

  // Witness agreement of the copy witnessed through THIS publisher (#618
  // increment 3), on the hosted composite only (forPublisherId set): a
  // corroborating copy is byte-identical to a held one — provable availability,
  // shown as a calm positive pill; a divergent copy is flagged. A citation-grade
  // copy adds nothing, so no doubt is manufactured where none exists.
  if (forPublisherId !== undefined) {
    const agreement = h.witnessAgreementByPublisher[forPublisherId];
    if (agreement === 'corroborating') {
      pills.push('<span class="hold-flag hold-flag--held"><span aria-hidden="true">✓</span> corroborating · bytes held</span>');
    } else if (agreement === 'divergent') {
      pills.push(`<a class="hold-flag hold-flag--issue" href="${fidelityHref(depthToRoot, 'divergence')}"><span aria-hidden="true">⚑</span> divergent · differs from held</a>`);
    }
  }

  const q = h.qualityCount ?? 0;
  if (q > 0) {
    const base = `${q} data-quality flag${q > 1 ? 's' : ''}`;
    const label = h.coverageAffecting === true ? `${base} · coverage-affecting` : base;
    pills.push(`<a class="hold-flag hold-flag--issue" href="${fidelityHref(depthToRoot)}"><span aria-hidden="true">⚑</span> ${label}</a>`);
  }

  return `<span class="hold-col hold-flags">${pills.join('')}</span>`;
}

// The calm metadata pills, spread wide on their own line beneath the strip: the
// dataset kind(s) in plain English, each linking to its class overview. These
// blend into the top-down scan, distinct from the orange flag pills above.
function kindTags(h: Holding, rel: string): string {
  const classes = h.datasetClasses ?? [];
  if (classes.length === 0) return '';
  const tags = classes
    .map(c => `<li><a class="hold-tag" href="${rel}datasets/classes/${classSlug(c)}.html">${escapeHtml(humaniseClassKey(c).toLowerCase())}</a></li>`)
    .join('');
  return `<ul class="hold-tags">${tags}</ul>`;
}

// One dataset row: the aligned scan strip, then the title with a demoted key,
// the derived blurb and the calm kind pills. The id anchors the overview map's
// cell (:target highlights it).
function holdingRow(h: Holding, depthToRoot: number, idPrefix: string, marks: HoldingMarks, forPublisherId?: string): string {
  const rel = '../'.repeat(depthToRoot);
  return [
    `<li class="hold-row" id="${escapeHtml(`${idPrefix}-hold-${h.key}`)}">`,
    '<div class="hold-strip">',
    vintageCell(h),
    scaleCell(h),
    coverageCell(h),
    flagsCell(h, depthToRoot, marks, forPublisherId),
    '</div>',
    '<div class="hold-body">',
    `<a class="hold-title" href="${rel}${entryHref(h)}">${escapeHtml(h.title)}</a> <code class="hold-key">${escapeHtml(h.key)}</code>`,
    `<p class="hold-blurb">${holdingBlurb(h, rel)}</p>`,
    kindTags(h, rel),
    '</div>',
    '</li>',
  ].filter(s => s !== '').join('');
}

// A holding's vintage year, or undefined when undated.
function vintageYear(h: Holding): number | undefined {
  return h.vintage === undefined ? undefined : Number(h.vintage.slice(0, 4));
}

// Newest first within a year group; a stable key tiebreak keeps the build
// deterministic across re-crawls.
function byVintageThenKeyDesc(a: Holding, b: Holding): number {
  const av = a.vintage ?? '';
  const bv = b.vintage ?? '';
  return bv.localeCompare(av) || a.key.localeCompare(b.key);
}

// The overview map (candidate E): one lettered, kind-tinted cell per dataset,
// stacked on a CONTINUOUS vintage axis so a year holding nothing renders as a
// visible gap. Each cell links to its row (:target highlights it) and spells out
// title, kind and vintage for assistive tech; a legend maps letter+tint to kind.
function holdingsMap(holdings: Holding[], depthToRoot: number, idPrefix: string, overviewLabel: string): string {
  const dated = holdings.filter(h => h.vintage !== undefined);
  const undated = holdings.filter(h => h.vintage === undefined);

  const cell = (h: Holding): string => {
    const cls = primaryClass(h);
    const vintageLabel = h.vintage === undefined ? 'undated' : vintageParts(h.vintage).exact;
    const aria = `${h.title} — ${humaniseClassKey(cls)} — ${vintageLabel}`;
    return `<li><a class="hold-cell" data-kind="${escapeHtml(cls)}" href="#${escapeHtml(`${idPrefix}-hold-${h.key}`)}" aria-label="${escapeHtml(aria)}"><span aria-hidden="true">${escapeHtml(kindLetter(cls))}</span></a></li>`;
  };

  const yearRows: string[] = [];
  if (dated.length > 0) {
    const years = dated.map(h => vintageYear(h)).filter((y): y is number => y !== undefined);
    const minYear = Math.min(...years);
    const maxYear = Math.max(...years);
    // Continuous axis, newest year first; an empty year is a visible gap.
    for (let year = maxYear; year >= minYear; year--) {
      const inYear = dated.filter(h => vintageYear(h) === year).sort(byVintageThenKeyDesc);
      const cells = inYear.map(cell).join('');
      yearRows.push(`<li class="hold-map-yr${cells === '' ? ' hold-map-yr--empty' : ''}"><span class="hold-map-yrlab">${year}</span><ul class="hold-map-cells">${cells}</ul></li>`);
    }
  }
  if (undated.length > 0) {
    const cells = undated.slice().sort((a, b) => a.key.localeCompare(b.key)).map(cell).join('');
    yearRows.push(`<li class="hold-map-yr"><span class="hold-map-yrlab">undated</span><ul class="hold-map-cells">${cells}</ul></li>`);
  }

  // Legend: only the kinds actually present, in the vocabulary's own order.
  const present = new Set(holdings.map(primaryClass));
  const legendOrder = [...Object.keys(KIND_LETTER), ...[...present].filter(c => !(c in KIND_LETTER))];
  const legend = legendOrder
    .filter(c => present.has(c))
    .map(c => `<li><span class="hold-cell hold-cell--legend" data-kind="${escapeHtml(c)}" aria-hidden="true">${escapeHtml(kindLetter(c))}</span> ${escapeHtml(humaniseClassKey(c))}</li>`)
    .join('');

  return [
    `<nav class="hold-map" aria-label="${escapeHtml(overviewLabel)}">`,
    '<p class="hold-map-lead">Every dataset at a glance, stacked by data vintage — one cell each, lettered and tinted by kind. Empty years are left as gaps. Select a cell to jump to its row.</p>',
    `<ol class="hold-map-grid">${yearRows.join('')}</ol>`,
    `<ul class="hold-legend">${legend}</ul>`,
    '</nav>',
  ].join('');
}

// The composite for one set of holdings (authored or hosted): the overview map,
// then the vintage timeline of scan-strip rows. idPrefix namespaces the row ids
// so an entry that is both authored and hosted never collides.
function holdingsComposite(holdings: Holding[], depthToRoot: number, idPrefix: string, overviewLabel: string, forPublisherId?: string): string {
  if (holdings.length === 0) return '';

  const dated = holdings.filter(h => h.vintage !== undefined);
  const earliest = dated.slice().sort((a, b) => (a.vintage ?? '').localeCompare(b.vintage ?? '') || a.key.localeCompare(b.key))[0];
  const scaled = holdings.filter(h => (h.recordCount ?? 0) > 0);
  const largest = scaled.slice().sort((a, b) => (b.recordCount ?? 0) - (a.recordCount ?? 0) || a.key.localeCompare(b.key))[0];
  const xlsxDated = dated.filter(h => h.hasXlsx === true);
  const firstXlsx = xlsxDated.slice().sort((a, b) => (a.vintage ?? '').localeCompare(b.vintage ?? '') || a.key.localeCompare(b.key))[0];
  const marks: HoldingMarks = {
    earliestKey: earliest?.key,
    largestKey: largest?.key,
    firstXlsxKey: firstXlsx?.key,
  };

  // Timeline: newest vintage year first, undated entries under their own
  // heading at the end (candidate B's structure).
  const years = [...new Set(dated.map(h => vintageYear(h)).filter((y): y is number => y !== undefined))].sort((a, b) => b - a);
  const groups: string[] = [];
  for (const year of years) {
    const inYear = dated.filter(h => vintageYear(h) === year).sort(byVintageThenKeyDesc);
    const rows = inYear.map(h => holdingRow(h, depthToRoot, idPrefix, marks, forPublisherId)).join('');
    groups.push(`<li class="hold-yeargroup"><h4 class="hold-yearhead"><span class="hold-yearnum">${year}</span> <span class="hold-yearcount">${inYear.length} dataset${inYear.length > 1 ? 's' : ''}</span></h4><ol class="hold-rows">${rows}</ol></li>`);
  }
  const undated = holdings.filter(h => h.vintage === undefined).sort((a, b) => a.key.localeCompare(b.key));
  if (undated.length > 0) {
    const rows = undated.map(h => holdingRow(h, depthToRoot, idPrefix, marks, forPublisherId)).join('');
    groups.push(`<li class="hold-yeargroup hold-yeargroup--undated"><h4 class="hold-yearhead"><span class="hold-yearnum">Undated</span> <span class="hold-yearcount">${undated.length} dataset${undated.length > 1 ? 's' : ''}</span></h4><ol class="hold-rows">${rows}</ol></li>`);
  }

  return [
    holdingsMap(holdings, depthToRoot, idPrefix, overviewLabel),
    `<ol class="hold-timeline">${groups.join('')}</ol>`,
  ].join('\n');
}

function holdingsSection(entry: PublisherEntry, holdings: PublisherHoldings): string {
  const authoredCount = holdings.authored.length;
  const hostedCount = holdings.hosted.length;
  const out: string[] = ['<h2>Holdings</h2>'];

  if (authoredCount === 0 && hostedCount === 0) {
    out.push(`<p>No dataset in the mirror is authored by or witnessed through ${escapeHtml(entry.name)} yet. It is seeded in the register so existing citations of it resolve to a publisher page, and so it has a home in the graph when a holding first relates to it.</p>`);
    return out.join('\n');
  }

  // The composite holdings styling, emitted once per page (before the first
  // composite) so both the authored and hosted sections draw on it.
  out.push(HOLDINGS_STYLE);

  out.push('<h3>Datasets authored by this publisher</h3>');
  if (authoredCount === 0) {
    out.push(`<p>None — no dataset the mirror holds is authored by ${escapeHtml(entry.name)}. (It appears here as a host of copies, below.)</p>`);
  } else {
    out.push(`<p><b>${authoredCount}</b> ${authoredCount === 1 ? 'dataset originates' : 'datasets originate'} from ${escapeHtml(entry.name)} — a <b>direct</b> authorship claim derived from each entry's source. This holds wherever a copy surfaced: the author is a fact about origin, not about which venue served the bytes.</p>`);
    out.push(holdingsComposite(holdings.authored, PUBLISHER_PAGE_DEPTH, 'a', `Datasets authored by ${entry.name}, by vintage year`));
  }

  out.push('<h3>Copies hosted or witnessed here</h3>');
  if (hostedCount === 0) {
    out.push(`<p>None — no copy the mirror holds was obtained through ${escapeHtml(entry.name)}'s channels.</p>`);
  } else {
    out.push(`<p><b>${hostedCount}</b> ${hostedCount === 1 ? 'copy was' : 'copies were'} obtained <b>directly</b> through ${escapeHtml(entry.name)} — a copy fetched straight from this publisher's channels, resolved from each entry's recorded witnesses. A copy marked <em>corroborating</em> is byte-identical to what the mirror holds (sha256 verified) — provable availability, not an assumption; a <em>divergent</em> copy is flagged with its own record. Transitive corroboration (a copy shown to correspond to an authoritative original via an intermediary) will be labelled distinctly from these direct copies when it lands.</p>`);
    out.push(holdingsComposite(holdings.hosted, PUBLISHER_PAGE_DEPTH, 'h', `Copies of others' datasets hosted or witnessed by ${entry.name}, by vintage year`, entry.id));
  }

  return out.filter(s => s !== '').join('\n');
}

// One publisher page. Exported so a test can render a single entry against
// fixture holdings without building the whole section.
export function publisherPage(entry: PublisherEntry, holdings: PublisherHoldings): string {
  const body = [
    breadcrumbHtml([['Publishers', '../index.html'], [entry.name, undefined]]),
    `<h1>${escapeHtml(entry.name)}</h1>`,
    `<p>A publisher in the mirror's register: a body that originates, archives, aggregates or hosts the material this project mirrors. Author, publication channel and host are kept as separate axes throughout — this page states what ${escapeHtml(entry.name)} is, the default basis on which the mirror may hold its material, and every holding related to it, by relationship.</p>`,
    identitySection(entry),
    licenceSection(entry),
    trustSection(entry),
    holdingsSection(entry, holdings),
    `<p><small>See every publisher on the <a href="../index.html">publishers index</a>, or browse the data on the <a href="../../datasets/index.html">dataset index</a>.</small></p>`,
  ];
  return htmlPage(`${entry.name} — publisher`, PUBLISHER_PAGE_DEPTH, body, {
    currentNav: 'Publishers',
    sourcePath: 'reference-data/publishers.json',
  });
}

// The publishers index: every register entry with a role summary, its licence
// basis, ceiling, and holding counts, each linking to its page.
export function publishersIndexPage(register: PublisherRegister, holdings: Holding[]): string {
  const rows = register.publishers.map(entry => {
    const h = holdingsForPublisher(entry.id, holdings);
    const basisLabel = LICENCE_BASIS_LABELS[entry.licenceBasis] ?? humaniseToken(entry.licenceBasis);
    const roleChips = entry.roles.map(r => `<code>${escapeHtml(r)}</code>`).join(' ');
    return `<tr><th scope="row"><a href="${encodeURIComponent(entry.id)}/index.html">${escapeHtml(entry.name)}</a>${entry.operator === undefined ? '' : `<br><small class="gap">${escapeHtml(entry.operator)}</small>`}</th><td>${roleChips}</td><td>${escapeHtml(basisLabel)}</td><td>${escapeHtml(entry.authorityCeiling)}</td><td class="n">${zeroCell(h.authored.length)}</td><td class="n">${zeroCell(h.hosted.length)}</td></tr>`;
  }).join('');
  const body = [
    '<h1>Publishers</h1>',
    `<p>The bodies that originate, archive, aggregate or host the material this project mirrors — a hand-curated, code-reviewed register. Each entry says what the organisation is, the ${glossaryTerm('axis-authority', PUBLISHER_INDEX_DEPTH, { label: 'authority' })} its material can carry, and the mirror's holdings related to it. <b>Author</b>, publication channel and <b>host</b> are separate axes: every dataset the mirror holds is <em>authored</em> by Ofcom, whichever venue a copy was obtained from.</p>`,
    '<p>Licensing shown here is each publisher\'s <em>default/typical</em> basis; a specific publication may carry a different one. An <code>unverified</code> basis is stated honestly as not-established, never guessed.</p>',
    `<div class="overflow"><table>${tableCaption('Publishers in the register, with roles, default licence basis, authority ceiling, and holding counts')}<thead><tr><th scope="col">publisher</th><th scope="col">roles</th><th scope="col">default licence basis</th><th scope="col">authority ceiling</th><th scope="col" class="n">authored</th><th scope="col" class="n">hosted copies</th></tr></thead><tbody>${rows}</tbody></table></div>`,
    '<p><small><b>Authored</b> counts the datasets a publisher originates; <b>hosted copies</b> counts the entries a copy of which was obtained through its channels — the same entry can appear under both (Ofcom both authors and self-hosts). Both are direct relationships in the data today.</small></p>',
    `<p><small>Back to the <a href="../datasets/index.html">dataset index</a> · the <a href="../reports/index.html">reports hub</a>.</small></p>`,
  ];
  return htmlPage('Publishers', PUBLISHER_INDEX_DEPTH, body, {
    currentNav: 'Publishers',
    sourcePath: 'reference-data/publishers.json',
  });
}

// Build the whole section under {outputDir}/publishers/. Returns the page URLs
// for the caller's sitemap. Deterministic for unchanged inputs.
export function buildPublisherPages(outputDir: string, baseUrl: string = DEFAULT_BASE_URL): string[] {
  const register = readPublisherRegister();
  const holdings = collectHoldings(register);
  const dir = path.join(outputDir, 'publishers');
  fs.mkdirSync(dir, { recursive: true });
  const urls: string[] = [];

  fs.writeFileSync(path.join(dir, 'index.html'), publishersIndexPage(register, holdings));
  urls.push(`${baseUrl}/publishers/index.html`);

  const byId = publisherIndexById(register);
  for (const entry of register.publishers) {
    const publisher = byId.get(entry.id);
    if (publisher === undefined) continue;
    const pageDir = path.join(dir, entry.id);
    fs.mkdirSync(pageDir, { recursive: true });
    fs.writeFileSync(path.join(pageDir, 'index.html'), publisherPage(entry, holdingsForPublisher(entry.id, holdings)));
    urls.push(`${baseUrl}/publishers/${encodeURIComponent(entry.id)}/index.html`);
  }

  return urls;
}

function main(): void {
  const [outputDir, baseUrl] = process.argv.slice(2).filter(a => a.trim().length > 0);
  if (!outputDir) {
    console.error('usage: node src/ci/build-publisher-pages.ts <output-dir> [base-url]');
    process.exitCode = 1;
    return;
  }
  const urls = buildPublisherPages(outputDir, baseUrl);
  console.log(`publisher section: ${urls.length} pages`);
}

if (import.meta.main) {
  main();
}
