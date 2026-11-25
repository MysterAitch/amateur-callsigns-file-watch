#!/usr/bin/env node

/**
 * Static no-script baseline for the v1 HOME page (ADR 0022).
 *
 * The home page's "record at a glance" and "from the record" sections state
 * figures that change with every publication: how many publications are held,
 * the newest register's callsign total, and the newest snapshot's date. The
 * page's script redraws them from the holdings manifest, but the markup a
 * crawler, a web archive or a reader without scripts receives was written by
 * hand, and after the 22 September 2026 publication it went on saying 158,318
 * callsigns and naming 23 June 2026 as the newest publication held.
 *
 * This step writes those two sections into the served index.html from the same
 * manifest (holdings.json) and the same mount functions the script uses
 * (site/v1/home-sections.js), so the baseline cannot say anything the script
 * would not. It runs after build-home-holdings.ts, outside the golden-master
 * closure, as the chip and history stamps do.
 *
 * WHAT IT REFUSES is stated once, at staticHomeModel below, where it is enforced.
 *
 * WHAT IT LEAVES OUT. The per-publication marks and the milestone caption are
 * not stamped: the caption's previous and next controls do nothing without a
 * script, so the baseline keeps the axis and the figures and says the marks
 * appear when the script runs (the dial's own note). Stamping the full render was
 * considered and rejected for that reason.
 *
 * DETERMINISM. The output is a pure function of the manifest; stamping twice
 * from one manifest gives the same bytes.
 *
 * Usage: node src/ci/build-v1-home-static.ts <site-root>
 *   reads    <site-root>/holdings.json
 *   rewrites the marked regions of <site-root>/index.html
 */

import * as fs from 'fs';
import * as path from 'path';
import { JSDOM } from 'jsdom';
import { parseJsonObject } from '../shared/json-shape.ts';
import { serialise, setBuildDocument, renderDocument } from '../../site/v1/el.js';
import {
  defaultHomeModel,
  enhanceHomeModel,
  newestReading,
  parseHoldings,
  HOME_SECTION_REGISTRY,
  MANIFEST_DERIVED_SECTIONS,
} from '../../site/v1/home-sections.js';
import { assertBalancedRegions, assertReparsesIdentically, stampMarkedRegion } from './static-region.ts';

// The el() foundation's Node build backend (ADR 0022): one jsdom document,
// supplied once, used only where no browser document exists.
setBuildDocument(new JSDOM('').window.document);

type HomeModel = ReturnType<typeof defaultHomeModel>;
type HomeHoldings = NonNullable<ReturnType<typeof parseHoldings>>;

// The region of the home page each stamped section occupies, delimited by
// comment markers so the boundary is explicit in the committed page. The section
// id inside the opening marker says which render fills it.
export const HOME_REGION_START = (id: string): string => `<!-- v1-home-static: ${id} -->`;
export const HOME_REGION_END = '<!-- /v1-home-static -->';

// Exactly the sections the script re-mounts when the manifest arrives: a section
// whose content the manifest changes is a section whose baseline goes stale.
export const STAMPED_HOME_SECTIONS: readonly string[] = MANIFEST_DERIVED_SECTIONS;

/**
 * The model the baseline is stamped from: the script's enhancement of its
 * defaults by the manifest (enhanceHomeModel), with the marks left out.
 *
 * THE REFUSAL RULE (the one statement of it; other files point here). Where the
 * manifest leaves a figure to enhanceHomeModel's fallback, the script shows its
 * hand-written default for that figure. That is tolerable for a page the script
 * then replaces, and not for a baseline with no script behind it, so the build
 * fails instead of stamping it. Each check asks the same question the fallback
 * does, never a stricter or looser one of its own:
 *   - no register snapshot named: the callsign total would be the default;
 *   - newestReading null: the newest date cannot be stated at any precision
 *     (a month-only or year-only date CAN be, and is stamped as such);
 *   - no held-run years: the span would be the default.
 * The one figure the manifest never carries is the 1903 history horizon, a
 * cited constant pinned to its report by site/v1/sections.test.ts.
 */
export function staticHomeModel(holdings: HomeHoldings, where: string): HomeModel {
  if (holdings.latestRegister === null || holdings.latestRegister === undefined) {
    throw new Error(`build-v1-home-static: ${where} names no register snapshot, so the page would keep its hand-written callsign total - refusing to stamp it`);
  }
  if (newestReading(holdings) === null) {
    const newest = holdings.latestDateIso ?? holdings.publications.map(p => p.vintage).sort().at(-1) ?? '(no publications)';
    throw new Error(`build-v1-home-static: ${where} gives the newest publication a date the page cannot state (${newest}), so the page would keep its hand-written snapshot date - refusing to stamp it`);
  }
  if (holdings.heldStartYear === null || holdings.latestYear === null) {
    throw new Error(`build-v1-home-static: ${where} gives the held run no years, so the page would keep its hand-written span - refusing to stamp it`);
  }
  const model = enhanceHomeModel(defaultHomeModel(), holdings);
  return { ...model, span: { ...model.span, publications: [], milestones: [] } };
}

/** One home section rendered by the script's own mount, serialised, and proven to reparse to the same tree. */
export function homeSectionHtml(model: HomeModel, id: string): string {
  const entry = HOME_SECTION_REGISTRY[id];
  if (entry === undefined) {
    throw new Error(`build-v1-home-static: no registered home section "${id}"`);
  }
  const section = renderDocument().createElement('section');
  section.setAttribute('data-section', id);
  entry.mount(section, model);
  const html = serialise(section);
  assertReparsesIdentically(section, html, `build-v1-home-static: the "${id}" section`);
  return html;
}

function readHoldings(siteRoot: string): HomeHoldings {
  const manifestPath = path.join(siteRoot, 'holdings.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`build-v1-home-static: ${manifestPath} not found - the holdings manifest must be built before the home baseline is stamped`);
  }
  const holdings = parseHoldings(parseJsonObject(fs.readFileSync(manifestPath, 'utf8'), manifestPath));
  if (holdings === null) {
    throw new Error(`build-v1-home-static: ${manifestPath} is not the shape the home page reads - refusing to stamp the page from it`);
  }
  return holdings;
}

export function buildV1HomeStatic(siteRoot: string): { sections: string[]; newest: string } {
  const manifestPath = path.join(siteRoot, 'holdings.json');
  const holdings = readHoldings(siteRoot);
  const model = staticHomeModel(holdings, manifestPath);

  const target = path.join(siteRoot, 'index.html');
  if (!fs.existsSync(target)) {
    throw new Error(`build-v1-home-static: ${target} not found - the v1 shell must be deployed before the home baseline is stamped`);
  }
  let html = fs.readFileSync(target, 'utf8');
  assertBalancedRegions(html, new Map(STAMPED_HOME_SECTIONS.map(id => [id, HOME_REGION_START(id)])), HOME_REGION_END, `build-v1-home-static: ${target}`);
  for (const id of STAMPED_HOME_SECTIONS) {
    const stamped = stampMarkedRegion(html, HOME_REGION_START(id), HOME_REGION_END, homeSectionHtml(model, id));
    if (stamped.replaced !== 1) {
      throw new Error(`build-v1-home-static: expected exactly one "${id}" region in ${target}, rewrote ${stamped.replaced} - the page's markers are the contract between the page and this stamp`);
    }
    html = stamped.html;
  }
  fs.writeFileSync(target, html);
  return { sections: [...STAMPED_HOME_SECTIONS], newest: model.span.latestLabel };
}

if (import.meta.main) {
  const siteRoot = process.argv.slice(2).filter(a => a.trim().length > 0)[0] ?? '_site';
  const { sections, newest } = buildV1HomeStatic(siteRoot);
  console.log(`stamped the home page's no-script baseline, newest publication ${newest}: ${sections.join(', ')}`);
}
