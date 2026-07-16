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
import { CONSTANTS, type ArchiveMeta } from '../shared/utils.ts';
import { listFoiEntryKeys, readFoiEntryMeta } from '../shared/foi-archive.ts';
import {
  readPublisherRegister,
  channelIndex,
  publisherIndexById,
  authorPublisherId,
  type PublisherEntry,
  type PublisherRegister,
} from '../shared/publishers.ts';
import {
  escapeHtml,
  externalLink,
  humanDate,
  htmlPage,
  breadcrumbHtml,
  glossaryTerm,
  tableCaption,
} from './site-render.ts';

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
const LICENCE_BASIS_LABELS: Readonly<Record<string, string>> = {
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
  // Witness channel tokens that did NOT resolve to any publisher — surfaced, not
  // dropped (the validator is the loud line of defence; this keeps the page
  // honest if it is ever built against an unvalidated register).
  unresolvedChannels: string[];
  datasetClasses?: string[];
  vintage?: string;
}

// The site-root-relative path of an entry's page (the publisher pages link to
// it from depth 2, so callers prepend their own '../').
function entryHref(holding: Holding): string {
  return holding.lane === 'open-data'
    ? `datasets/open-data/${encodeURIComponent(holding.key)}/index.html`
    : `datasets/foi/${encodeURIComponent(holding.key)}/index.html`;
}

// Resolve the distinct publisher ids (and any unresolved tokens) for a set of
// witness channel tokens, deduplicated and register-ordered by first sight.
function resolveWitnessPublishers(
  channels: string[],
  chIndex: Map<string, PublisherEntry>,
): { ids: string[]; unresolved: string[] } {
  const ids: string[] = [];
  const unresolved: string[] = [];
  for (const channel of channels) {
    const publisher = chIndex.get(channel);
    if (publisher === undefined) {
      if (!unresolved.includes(channel)) unresolved.push(channel);
    } else if (!ids.includes(publisher.id)) {
      ids.push(publisher.id);
    }
  }
  return { ids, unresolved };
}

// Sweep both lanes into the flat holdings list, resolving each entry's author
// and witness publishers. Reads the committed archive; deterministic for
// unchanged inputs.
export function collectHoldings(
  register: PublisherRegister,
  archiveDir: string = CONSTANTS.DIRS.archive,
  foiDir: string = path.join(REPO_ROOT, 'archive', 'foi'),
): Holding[] {
  const chIndex = channelIndex(register);
  const holdings: Holding[] = [];

  for (const key of listArchiveKeys().sort()) {
    const meta = JSON.parse(fs.readFileSync(path.join(archiveDir, key, 'meta.json'), 'utf8')) as ArchiveMeta;
    const channels = (meta.witnesses ?? []).map(w => w.channel);
    const { ids, unresolved } = resolveWitnessPublishers(channels, chIndex);
    holdings.push({
      key,
      lane: 'open-data',
      title: `Publication of ${humanDate(key)}`,
      authorId: authorPublisherId(meta.sourceKey),
      sourceKey: meta.sourceKey,
      witnessPublisherIds: ids,
      unresolvedChannels: unresolved,
    });
  }

  for (const key of listFoiEntryKeys(foiDir)) {
    const meta = readFoiEntryMeta(foiDir, key);
    // FOI witnesses live per file; a publisher witnessed the ENTRY if it
    // witnessed any of its files.
    const channels = Object.values(meta.files).flatMap(f => (f.witnesses ?? []).map(w => w.channel));
    const { ids, unresolved } = resolveWitnessPublishers(channels, chIndex);
    holdings.push({
      key,
      lane: 'foi',
      title: meta.title,
      authorId: authorPublisherId(meta.sourceKey),
      sourceKey: meta.sourceKey,
      witnessPublisherIds: ids,
      unresolvedChannels: unresolved,
      datasetClasses: meta.datasetClasses,
      vintage: meta.dataVintage ?? undefined,
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
  const notes = entry.notes !== undefined ? `<p><small>${escapeHtml(entry.notes)}</small></p>` : '';
  return [
    '<h2>Licence basis</h2>',
    basisLine,
    statement,
    terms,
    notes,
  ].filter(s => s !== '').join('\n');
}

function trustSection(entry: PublisherEntry): string {
  const ceilingDesc = CEILING_DESCRIPTIONS[entry.authorityCeiling] ?? '';
  return [
    '<h2>Trust treatment</h2>',
    `<p>Material witnessed <em>only</em> through this publisher can carry at most the <b>${escapeHtml(entry.authorityCeiling)}</b> rung on the ${glossaryTerm('axis-authority', PUBLISHER_PAGE_DEPTH, { label: 'source-authority axis' })}${ceilingDesc === '' ? '' : ` — ${escapeHtml(ceilingDesc)}`}.</p>`,
    `<p>This is a <em>ceiling</em>, a cross-check — not a second trust dial. A dataset's rung is still derived on read from the lane its bytes live in (ADR 0014); the ceiling only flags where a surfaced rung would exceed what the witnessing publisher can support, and never inflates one. Where a copy is later shown to correspond byte-for-byte to a higher-authority original, that authority is derived transitively from the correspondence, and labelled distinctly from a direct claim.</p>`,
  ].join('\n');
}

// A compact, crawlable list of holdings grouped by lane, each entry linking to
// its own page. Every holding is reachable so no page is orphaned.
function holdingsList(holdings: Holding[], depthToRoot: number): string {
  if (holdings.length === 0) return '';
  const rel = '../'.repeat(depthToRoot);
  const openData = holdings.filter(h => h.lane === 'open-data');
  const foi = holdings.filter(h => h.lane === 'foi');
  const groupHtml = (label: string, group: Holding[]): string => {
    if (group.length === 0) return '';
    const items = group.map(h => {
      const classes = (h.datasetClasses ?? []).length > 0
        ? ` <small class="gap">(${h.datasetClasses?.map(c => escapeHtml(c)).join(', ')})</small>`
        : '';
      return `<li><a href="${rel}${entryHref(h)}">${escapeHtml(h.title)}</a> — <code>${escapeHtml(h.key)}</code>${classes}</li>`;
    }).join('');
    return `<h4>${escapeHtml(label)} (${group.length})</h4><ul>${items}</ul>`;
  };
  return [groupHtml('Ofcom open data', openData), groupHtml('FOI requests and responses', foi)].filter(s => s !== '').join('\n');
}

function holdingsSection(entry: PublisherEntry, holdings: PublisherHoldings): string {
  const authoredCount = holdings.authored.length;
  const hostedCount = holdings.hosted.length;
  const out: string[] = ['<h2>Holdings</h2>'];

  if (authoredCount === 0 && hostedCount === 0) {
    out.push(`<p>No dataset in the mirror is authored by or witnessed through ${escapeHtml(entry.name)} yet. It is seeded in the register so existing citations of it resolve to a publisher page, and so it has a home in the graph when a holding first relates to it.</p>`);
    return out.join('\n');
  }

  out.push('<h3>Datasets authored by this publisher</h3>');
  if (authoredCount === 0) {
    out.push(`<p>None — no dataset the mirror holds is authored by ${escapeHtml(entry.name)}. (It appears here as a host of copies, below.)</p>`);
  } else {
    out.push(`<p><b>${authoredCount}</b> ${authoredCount === 1 ? 'dataset originates' : 'datasets originate'} from ${escapeHtml(entry.name)} — a <b>direct</b> authorship claim derived from each entry's source. This holds wherever a copy surfaced: the author is a fact about origin, not about which venue served the bytes.</p>`);
    out.push(holdingsList(holdings.authored, PUBLISHER_PAGE_DEPTH));
  }

  out.push('<h3>Copies hosted or witnessed here</h3>');
  if (hostedCount === 0) {
    out.push(`<p>None — no copy the mirror holds was obtained through ${escapeHtml(entry.name)}'s channels.</p>`);
  } else {
    out.push(`<p><b>${hostedCount}</b> ${hostedCount === 1 ? 'copy was' : 'copies were'} obtained <b>directly</b> through ${escapeHtml(entry.name)} — a copy fetched straight from this publisher's channels, resolved from each entry's recorded witnesses. Transitive corroboration (a copy shown to correspond to an authoritative original via an intermediary) will be labelled distinctly from these direct copies when it lands.</p>`);
    out.push(holdingsList(holdings.hosted, PUBLISHER_PAGE_DEPTH));
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
    currentNav: 'Dataset index',
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
    return `<tr><th scope="row"><a href="${encodeURIComponent(entry.id)}/index.html">${escapeHtml(entry.name)}</a>${entry.operator === undefined ? '' : `<br><small class="gap">${escapeHtml(entry.operator)}</small>`}</th><td>${roleChips}</td><td>${escapeHtml(basisLabel)}</td><td>${escapeHtml(entry.authorityCeiling)}</td><td class="n">${h.authored.length}</td><td class="n">${h.hosted.length}</td></tr>`;
  }).join('');
  const body = [
    '<h1>Publishers</h1>',
    `<p>The bodies that originate, archive, aggregate or host the material this project mirrors — a hand-curated, code-reviewed register. Each entry says what the organisation is, the ${glossaryTerm('axis-authority', PUBLISHER_INDEX_DEPTH, { label: 'authority' })} its material can carry, and the mirror's holdings related to it. <b>Author</b>, publication channel and <b>host</b> are separate axes: every dataset the mirror holds is <em>authored</em> by Ofcom, whichever venue a copy was obtained from.</p>`,
    '<p>Licensing shown here is each publisher\'s <em>default/typical</em> basis; a specific publication may carry a different one. An <code>unverified</code> basis is stated honestly as not-established, never guessed.</p>',
    `<table>${tableCaption('Publishers in the register, with roles, default licence basis, authority ceiling, and holding counts')}<thead><tr><th scope="col">publisher</th><th scope="col">roles</th><th scope="col">default licence basis</th><th scope="col">authority ceiling</th><th scope="col" class="n">authored</th><th scope="col" class="n">hosted copies</th></tr></thead><tbody>${rows}</tbody></table>`,
    '<p><small><b>Authored</b> counts the datasets a publisher originates; <b>hosted copies</b> counts the entries a copy of which was obtained through its channels — the same entry can appear under both (Ofcom both authors and self-hosts). Both are direct relationships in the data today.</small></p>',
    `<p><small>Back to the <a href="../datasets/index.html">dataset index</a> · the <a href="../reports/index.html">reports hub</a>.</small></p>`,
  ];
  return htmlPage('Publishers', PUBLISHER_INDEX_DEPTH, body, {
    currentNav: 'Dataset index',
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
