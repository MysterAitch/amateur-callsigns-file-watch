import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { sharedModuleClosure } from './build-v1-shared-modules.ts';
import { buildCallsignShards } from './build-callsign-shards.ts';
import { foldEventTimeProjection } from './event-time-projection.ts';
import { buildCallsignEventShards } from './build-callsign-event-shards.ts';
import { parseJsonObject } from '../shared/json-shape.ts';
import { SITE_INDEXABLE } from './build-root-discovery.ts';

// v1 SELF-CONTAINMENT (issue #921), mechanically enforced. The v1 surface must
// reference nothing under the legacy tree: no href, import specifier, fetch
// path or copy string may point at it. If something has not been migrated yet,
// the honest state is "not here yet" — never a pointer off the surface. This
// walks every file the deploy ships to the ROOT (the site/v1 tree plus the
// shared-module closure that lands beside it) and fails on any legacy reference.
// Test names follow Subject_Scenario_Outcome.

const V1_DIR = path.join('site', 'v1');
const SITE_DIR = 'site';

// The legacy path/identifier token: "v0" NOT preceded by a letter — so a genuine
// reference (v0/, "v0", .v0mark, V0_BASE, a fetch path) is caught, while an
// incidental substring inside a word (the "cv01" OpenType feature) is not.
const LEGACY_REF = /(?<![a-z])v0/i;

// Every file the deploy copies to the root from site/v1 (pages, modules,
// stylesheets). *.test.ts are tooling and are never deployed.
function v1DeployedFiles(): string[] {
  return fs.readdirSync(V1_DIR)
    .filter(f => ['.html', '.js', '.css'].includes(path.extname(f)) && !f.endsWith('.test.ts'))
    .map(f => path.join(V1_DIR, f));
}

// The shared modules the deploy also copies to the root beside the v1 pages.
function sharedDeployedFiles(): string[] {
  return sharedModuleClosure(SITE_DIR).map(f => path.join(SITE_DIR, f));
}

describe('v1 self-containment', { tags: ['unit'] }, () => {
  it('V1Surface_AnyDeployedFile_NeverReferencesTheLegacyTree', () => {
    const offenders: string[] = [];
    for (const file of [...v1DeployedFiles(), ...sharedDeployedFiles()]) {
      const content = fs.readFileSync(file, 'utf8');
      content.split('\n').forEach((line, i) => {
        if (LEGACY_REF.test(line)) offenders.push(`${file}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offenders, `deployed v1 files reference the legacy tree:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('V1Surface_ShipsTheThreeLaunchedPages_AndTheirChrome', () => {
    // A guard that the walk above is not vacuous: the pages that must exist do.
    const names = new Set(fs.readdirSync(V1_DIR));
    for (const page of ['index.html', 'callsign.html', 'how-to-get-the-raw-data.html', '404.html']) {
      expect(names.has(page), `${page} is missing from site/v1`).toBe(true);
    }
  });

  it('V1Pages_RobotsMeta_MatchTheIndexabilityFlag', () => {
    // The whole site is withheld from crawlers pre-launch (SITE_INDEXABLE): every
    // v1 page carries a noindex meta while the flag is false, and none may once
    // it flips. Coupling the static pages to the flag makes the launch flip
    // one line that cannot half-apply.
    for (const page of ['index.html', 'callsign.html', 'how-to-get-the-raw-data.html', '404.html']) {
      const html = fs.readFileSync(path.join(V1_DIR, page), 'utf8');
      const hasNoindex = /<meta name="robots" content="noindex">/.test(html);
      expect(hasNoindex, `${page} robots meta must match SITE_INDEXABLE=${String(SITE_INDEXABLE)}`).toBe(!SITE_INDEXABLE);
    }
  });

  it('RootServedCallsignData_HrefFields_CarryNoLegacyPrefix', () => {
    // The walk above covers html/js/css, but the callsign page also fetches
    // JSON that the workflow hard-links to the root (_site/callsign/data). A
    // future change to href construction could ship a legacy pointer inside that
    // JSON, unseen. Build the data through the REAL builders and assert every
    // emitted href is root-relative (no legacy prefix).
    const evDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v1-selfcheck-ev-'));
    buildCallsignEventShards(foldEventTimeProjection(), evDir);
    const evMeta = parseJsonObject(fs.readFileSync(path.join(evDir, 'meta.json'), 'utf8'), 'meta.json') as { datasets: { href: string }[] };
    expect(evMeta.datasets.length).toBeGreaterThan(0);
    for (const d of evMeta.datasets) expect(d.href, `event dataset href: ${d.href}`).not.toMatch(LEGACY_REF);

    const shDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v1-selfcheck-sh-'));
    buildCallsignShards(shDir);
    const shManifest = parseJsonObject(fs.readFileSync(path.join(shDir, 'datasets.json'), 'utf8'), 'datasets.json') as { datasets: { href: string }[] };
    expect(shManifest.datasets.length).toBeGreaterThan(0);
    for (const d of shManifest.datasets) expect(d.href, `shard dataset href: ${d.href}`).not.toMatch(LEGACY_REF);
  });
});

// EVERGREEN NOTE — a class of legacy reference the LEGACY_REF regex cannot catch.
// The shared modules shipped to root (the closure above) include legacy
// renderers the v1 surface never invokes — e.g. renderEventStripInto in
// callsign-events.js — whose markup hardcodes hrefs to pages that do not exist
// at the root (ledger.html, on-this-day.html, glossary.html). These are INERT
// on the v1 surface: site/v1/callsign-page.js destructures only the pure data
// functions (shardNameFor, latestSummary, stripModel, …) and never calls the
// renderers, so their hrefs are never emitted; were one ever mis-wired, its
// bare relative href would resolve at the root and fall through to the honest
// 404. The token scan cannot see this — the hrefs carry no "v0" token — so the
// safeguard is the destructure-only contract in callsign-page.js, not a regex.
