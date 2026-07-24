#!/usr/bin/env node

/**
 * Dated-fact chip build stamp (issues #965, #966).
 *
 * The v1 site-bar chip — "Record as of <date> · <n> publications held" — states
 * the record's currency: the newest held publication date and the number of
 * publications held. It must be BUILD-DERIVED (never a hand-maintained constant
 * that silently lies the moment the next snapshot lands), crawler-visible (in the
 * static HTML, not only after the page's script runs), and non-drifting (one
 * source, consumed everywhere).
 *
 * This step is the injection half of that contract. The AUTHORING happens in
 * exactly one place — the build-derived holdings manifest (holdings.json, itself
 * a pure projection of the archived publications, src/ci/build-home-holdings.ts).
 * From it this step stamps:
 *   - the single JS source of truth (record-facts.js), which the shared site bar
 *     (site/v1/shell.js) reads as the sole facts source, so no page re-authors
 *     the value; and
 *   - every root v1 page's STATIC chip (the no-JS baseline a crawler captures),
 *     which mirrors that same value.
 * The cross-page parity test (site/v1/sections.test.ts) holds the static
 * baselines to the JS source, the backstop for the one copy that cannot be
 * de-duplicated without server-rendering the shell.
 *
 * DETERMINISM. The output is a pure function of the manifest: no timestamps or
 * environment values are written, and stamping an already-stamped tree is a
 * no-op beyond re-substituting the same figures. Runs in the deploy pipeline
 * AFTER build-home-holdings.ts, OUTSIDE the golden-master closure.
 *
 * Usage: node src/ci/build-v1-chip.ts <site-root>
 *   reads   <site-root>/holdings.json
 *   rewrites <site-root>/record-facts.js and the chip in each <site-root>/*.html
 */

import * as fs from 'fs';
import * as path from 'path';
import { V1_COPY } from './render/v1-copy.ts';
import { parseJsonObject } from '../shared/json-shape.ts';

export interface RecordFacts {
  date: string;
  count: number;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// "23 June 2026" from a full ISO date; null for anything that is not a full date,
// so a month-only value never implies a day.
export function humaniseIsoDate(iso: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (m === null) return null;
  const month = MONTHS[Number(m[2]) - 1];
  return month === undefined ? null : `${Number(m[3])} ${month} ${m[1]}`;
}

// The subset of the holdings manifest the chip needs.
export interface ChipHoldings {
  count: number;
  latestDateIso: string | null;
  latestYear: number | null;
}

// The chip facts, DERIVED from the holdings manifest: the number held, and the
// newest held publication date humanised. The newest full date leads; when the
// newest vintage is month-only the year stands in (never a fabricated day), and
// an empty record degrades to an honest blank rather than a bare em dash.
export function datedFactsFromHoldings(h: ChipHoldings): RecordFacts {
  const full = h.latestDateIso !== null ? humaniseIsoDate(h.latestDateIso) : null;
  const date = full ?? (h.latestYear !== null ? String(h.latestYear) : '(date not recorded)');
  return { date, count: h.count };
}

function escAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// The chip's static-HTML markup, built from the copy registry template + title.
// The count is split off the TEMPLATE (never the rendered string, which can also
// contain the count inside the date) and bolded, matching the shell's DOM render
// so the parity test compares like with like.
export function chipHtml(facts: RecordFacts): string {
  const [rawBefore, rawAfter = ''] = V1_COPY.chip.template.split('{count}');
  const before = rawBefore.replaceAll('{date}', facts.date);
  const after = rawAfter.replaceAll('{date}', facts.date);
  const title = V1_COPY.chip.title.replaceAll('{date}', facts.date).replaceAll('{count}', String(facts.count));
  return `<span class="chip asof" title="${escAttr(title)}">${escText(before)}<b>${facts.count}</b>${escText(after)}</span>`;
}

// The chip span sits on a single line, and its title carries no '>' — so a
// greedy-safe `[^>]*` over the attributes plus a non-greedy body to the first
// closing tag matches exactly one chip per occurrence without over-reaching.
const CHIP_RE = /<span class="chip asof"[^>]*>.*?<\/span>/g;

// Replace every static chip in a page with the freshly-built one, reporting how
// many were rewritten so the caller can fail loud on a page that lost its chip.
export function stampChipHtml(html: string, facts: RecordFacts): { html: string; replaced: number } {
  let replaced = 0;
  const out = html.replace(CHIP_RE, () => { replaced += 1; return chipHtml(facts); });
  return { html: out, replaced };
}

// The single RECORD_FACTS literal in record-facts.js, rewritten to the derived
// figures. The object has no nested braces, so `\{[^}]*\}` matches its whole body.
const RECORD_FACTS_RE = /export const RECORD_FACTS = \{[^}]*\};/;

export function stampRecordFacts(js: string, facts: RecordFacts): { js: string; replaced: number } {
  let replaced = 0;
  const out = js.replace(RECORD_FACTS_RE, () => {
    replaced += 1;
    return `export const RECORD_FACTS = { date: ${JSON.stringify(facts.date)}, count: ${facts.count} };`;
  });
  return { js: out, replaced };
}

// Read the holdings manifest and validate only the fields the chip needs, so a
// malformed manifest fails loud rather than stamping a silent NaN.
export function readChipHoldings(siteRoot: string): ChipHoldings {
  const manifestPath = path.join(siteRoot, 'holdings.json');
  const raw = parseJsonObject(fs.readFileSync(manifestPath, 'utf8'), manifestPath);
  const o = raw as Record<string, unknown>;
  if (typeof o.count !== 'number' || !Number.isFinite(o.count)) {
    throw new Error(`build-v1-chip: ${manifestPath} has no finite count`);
  }
  const latestDateIso = typeof o.latestDateIso === 'string' ? o.latestDateIso : null;
  const latestYear = typeof o.latestYear === 'number' && Number.isFinite(o.latestYear) ? o.latestYear : null;
  return { count: o.count, latestDateIso, latestYear };
}

// Stamp the JS source of truth and every root v1 page's static chip from the
// just-built holdings manifest.
export function buildV1Chip(siteRoot: string): { facts: RecordFacts; pagesStamped: string[] } {
  const facts = datedFactsFromHoldings(readChipHoldings(siteRoot));

  const factsPath = path.join(siteRoot, 'record-facts.js');
  if (!fs.existsSync(factsPath)) {
    throw new Error(`build-v1-chip: ${factsPath} not found — the v1 shell must be deployed before the chip is stamped`);
  }
  const stampedJs = stampRecordFacts(fs.readFileSync(factsPath, 'utf8'), facts);
  if (stampedJs.replaced !== 1) {
    throw new Error(`build-v1-chip: expected exactly one RECORD_FACTS literal in ${factsPath}, rewrote ${stampedJs.replaced}`);
  }
  fs.writeFileSync(factsPath, stampedJs.js);

  const pagesStamped: string[] = [];
  for (const name of fs.readdirSync(siteRoot).filter(f => f.endsWith('.html')).sort()) {
    const p = path.join(siteRoot, name);
    const src = fs.readFileSync(p, 'utf8');
    if (!src.includes('class="chip asof"')) continue;
    const stamped = stampChipHtml(src, facts);
    if (stamped.replaced === 0) continue;
    fs.writeFileSync(p, stamped.html);
    pagesStamped.push(name);
  }
  return { facts, pagesStamped };
}

if (import.meta.main) {
  const siteRoot = process.argv.slice(2).filter(a => a.trim().length > 0)[0] ?? '_site';
  const { facts, pagesStamped } = buildV1Chip(siteRoot);
  console.log(`stamped the dated-fact chip: "Record as of ${facts.date} · ${facts.count} publications held"`);
  console.log(`  record-facts.js + ${pagesStamped.length} static page(s): ${pagesStamped.join(', ')}`);
}
