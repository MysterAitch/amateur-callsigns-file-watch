import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { sharedModuleClosure } from './build-v1-shared-modules.ts';

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
});
