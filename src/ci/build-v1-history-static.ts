#!/usr/bin/env node

/**
 * Static no-JS baseline for the v1 HISTORY journeys (issues #965, #966; ADR 0022).
 *
 * The two history surfaces — the on-this-day calendar and the event-time
 * timeline — are the bi-temporal showcase. Rendered only in the browser they
 * are, to anything that is not a browser, an empty shell: a crawler indexes
 * nothing and a web-archive snapshot preserves nothing. The archive's first
 * capture of a URL is the one future readers surface, and it cannot be re-taken,
 * so the served HTML has to state the substance itself.
 *
 * This step stamps that substance in. It renders through the SAME renderStatic
 * the browser path uses (site/v1/on-this-day-sections.js,
 * site/v1/timeline-sections.js) under the el() foundation's jsdom build
 * backend, and serialises it into each page's marked region. There is no second
 * markup builder to keep in step: the static baseline is GENERATED from the one
 * implementation, so a parity test would have nothing to police.
 *
 * DETERMINISM. The output is a pure function of the manifests: no timestamps,
 * environment values, clock reads or random sources enter the render, and
 * stamping an already-stamped tree reproduces the same bytes. The self-check
 * test builds twice and asserts byte-identity.
 *
 * Runs in the deploy pipeline AFTER build-v1-history.ts writes the manifests it
 * consumes, and OUTSIDE the golden-master closure — as the chip stamp does.
 *
 * Usage: node src/ci/build-v1-history-static.ts <site-root>
 *   reads    <site-root>/on-this-day.json, <site-root>/timeline.json
 *   rewrites the marked region of <site-root>/on-this-day.html and timeline.html
 */

import * as fs from 'fs';
import * as path from 'path';
import { JSDOM } from 'jsdom';
import { parseJsonObject } from '../shared/json-shape.ts';
import { serialise, setBuildDocument } from '../../site/v1/el.js';
import * as onThisDay from '../../site/v1/on-this-day-sections.js';
import * as timeline from '../../site/v1/timeline-sections.js';

// The el() foundation's Node build backend (ADR 0022): one jsdom document,
// supplied once, used only where no browser document exists — so importing this
// module from a DOM-environment test leaves that environment untouched.
setBuildDocument(new JSDOM('').window.document);

// The region of a history page the stamp owns, delimited by comment markers so
// the boundary is explicit in the committed page rather than inferred from
// nesting. The page name inside the opening marker says which manifest fills it,
// so a mis-stamped page is a loud mismatch rather than a silent swap.
export const REGION_START = (page: string): string => `<!-- v1-history-static: ${page} -->`;
export const REGION_END = '<!-- /v1-history-static -->';

function regionPattern(page: string): RegExp {
  // The delimiters are literal comments this repository authors; the body is
  // matched lazily so a page carrying two regions never swallows what is
  // between them.
  return new RegExp(`${REGION_START(page)}[\\s\\S]*?${REGION_END}`, 'g');
}

/**
 * Replace a page's marked region with freshly-rendered static HTML, reporting
 * how many regions were rewritten so the caller can fail loud on a page that
 * lost its markers.
 */
export function stampRegion(html: string, page: string, rendered: string): { html: string; replaced: number } {
  let replaced = 0;
  const out = html.replace(regionPattern(page), () => {
    replaced += 1;
    return `${REGION_START(page)}\n${rendered}\n${REGION_END}`;
  });
  return { html: out, replaced };
}

// Which `data-component` names this step's renders may emit. A component root
// whose name no page registers an enhancer for would ship as static content
// that silently never upgrades, so the emitted set is checked against the set
// the page bootstraps register rather than assumed to match.
const REGISTERED_COMPONENTS: ReadonlySet<string> = new Set([onThisDay.COMPONENT, timeline.COMPONENT]);

const COMPONENT_ATTRIBUTE_RE = /data-component="([^"]*)"/g;

export function assertComponentsRegistered(html: string, where: string): string[] {
  const emitted = [...html.matchAll(COMPONENT_ATTRIBUTE_RE)].map(m => m[1] ?? '');
  const unknown = [...new Set(emitted)].filter(name => !REGISTERED_COMPONENTS.has(name)).sort();
  if (unknown.length > 0) {
    throw new Error(`build-v1-history-static: ${where} emits data-component ${unknown.map(n => `"${n}"`).join(', ')} with no registered enhancer — a component that never upgrades is a silent gap, not a static baseline`);
  }
  return [...new Set(emitted)].sort();
}

// The tree's shape in document order, as `depth:tag` steps. Compared either
// side of a serialise-and-reparse so a divergence names where it happened.
function treeShape(root: Element): string[] {
  const shape: string[] = [];
  const walk = (node: Element, depth: number): void => {
    shape.push(`${depth}:${node.nodeName.toLowerCase()}`);
    for (const child of node.children) walk(child, depth + 1);
  };
  walk(root, 0);
  return shape;
}

/**
 * Assert the serialised markup PARSES BACK to the tree that was rendered.
 *
 * A build-time render carries a hazard a browser-only render never meets: the
 * DOM it builds is not what the reader receives — the reader receives the
 * SERIALISED form, re-parsed. HTML's implied-end-tag rules can quietly restructure
 * that (a `<details>` ends an open `<p>`, so its following siblings escape the
 * paragraph). The render looks right in every jsdom unit test that never round-
 * trips, and wrong on the page.
 *
 * el()'s own guards refuse the nestings known to do this; this is the backstop
 * that would catch a rule nobody thought of, checked on the real output of every
 * build rather than on a fixture.
 */
export function assertReparsesIdentically(rendered: Element, html: string, where: string): void {
  const reparsed = new JSDOM(`<!DOCTYPE html><body>${html}</body>`).window.document.body.firstElementChild;
  if (reparsed === null) {
    throw new Error(`build-v1-history-static: ${where} serialised to markup that parses back to nothing`);
  }
  const before = treeShape(rendered);
  const after = treeShape(reparsed);
  const at = before.findIndex((step, i) => step !== after[i]);
  if (at !== -1 || before.length !== after.length) {
    const step = at === -1 ? before.length : at;
    throw new Error(`build-v1-history-static: ${where} does not survive serialisation — the markup a reader receives parses back to a DIFFERENT tree (${before.length} elements rendered, ${after.length} after reparse; first divergence at step ${step}: rendered "${before[step] ?? '(end)'}" vs reparsed "${after[step] ?? '(end)'}")`);
  }
}

/** Read a manifest and hand it to its own shape validator, failing loud rather than rendering a wrong shape. */
function readManifest<T>(siteRoot: string, name: string, parse: (v: unknown) => T | null): T {
  const manifestPath = path.join(siteRoot, name);
  const raw: unknown = parseJsonObject(fs.readFileSync(manifestPath, 'utf8'), manifestPath);
  const parsed = parse(raw);
  if (parsed === null) {
    throw new Error(`build-v1-history-static: ${manifestPath} is not the shape the page renders — refusing to stamp a page from it`);
  }
  return parsed;
}

export function onThisDayHtml(siteRoot: string): string {
  const data = readManifest(siteRoot, 'on-this-day.json', onThisDay.parseOnThisDay);
  const rendered = onThisDay.renderStatic(data);
  const html = serialise(rendered);
  assertComponentsRegistered(html, 'the on-this-day render');
  assertReparsesIdentically(rendered, html, 'the on-this-day render');
  return html;
}

export function timelineHtml(siteRoot: string): string {
  const data = readManifest(siteRoot, 'timeline.json', timeline.parseTimeline);
  const rendered = timeline.renderStatic(data);
  const html = serialise(rendered);
  assertComponentsRegistered(html, 'the timeline render');
  assertReparsesIdentically(rendered, html, 'the timeline render');
  return html;
}

export interface HistoryStaticSummary {
  page: string;
  bytes: number;
}

export function buildV1HistoryStatic(siteRoot: string): HistoryStaticSummary[] {
  const pages: { page: string; file: string; render: () => string }[] = [
    { page: onThisDay.COMPONENT, file: 'on-this-day.html', render: () => onThisDayHtml(siteRoot) },
    { page: timeline.COMPONENT, file: 'timeline.html', render: () => timelineHtml(siteRoot) },
  ];

  const summary: HistoryStaticSummary[] = [];
  for (const { page, file, render } of pages) {
    const target = path.join(siteRoot, file);
    if (!fs.existsSync(target)) {
      throw new Error(`build-v1-history-static: ${target} not found — the v1 shell must be deployed before the history baseline is stamped`);
    }
    const stamped = stampRegion(fs.readFileSync(target, 'utf8'), page, render());
    if (stamped.replaced !== 1) {
      throw new Error(`build-v1-history-static: expected exactly one "${page}" region in ${target}, rewrote ${stamped.replaced} — the page's markers are the contract between the shell and this stamp`);
    }
    fs.writeFileSync(target, stamped.html);
    summary.push({ page: file, bytes: Buffer.byteLength(stamped.html) });
  }
  return summary;
}

if (import.meta.main) {
  const siteRoot = process.argv.slice(2).filter(a => a.trim().length > 0)[0] ?? '_site';
  for (const { page, bytes } of buildV1HistoryStatic(siteRoot)) {
    console.log(`stamped the static history baseline into ${page} (${(bytes / 1024).toFixed(1)} KiB served)`);
  }
}
