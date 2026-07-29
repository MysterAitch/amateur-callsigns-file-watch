import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  V1_SHARED_ENTRYPOINTS,
  sharedModuleClosure,
  deployV1SharedModules,
} from './build-v1-shared-modules.ts';
import { assertNonEmpty } from '../testing/non-vacuity.ts';

// The v1 shared-module deployment (issue #921): the pure data modules the v1
// callsign page imports at runtime, deployed at the site root so the v1 surface
// references nothing outside itself. Test names follow Subject_Scenario_Outcome.

const SITE_DIR = 'site';

describe('v1 shared-module deployment', { tags: ['unit'] }, () => {
  it('SharedModuleClosure_CoversEveryTransitiveDependency_OfTheEntryPoints', () => {
    const closure = sharedModuleClosure(SITE_DIR);
    // Every entry point is in its own closure.
    for (const entry of V1_SHARED_ENTRYPOINTS) expect(closure).toContain(entry);
    // Known transitive dependencies must be pulled in — a page that imported
    // these but shipped only the entry points would 404 at load.
    for (const dep of ['callsign-pill.js', 'field-wrappers.js', 'ledger.js', 'datetime.js', 'db-loading.js']) {
      expect(closure, `${dep} must be in the shipped closure`).toContain(dep);
    }
  });

  it('SharedModuleClosure_IsComplete_EveryModuleImportsOnlyOtherClosureMembers', () => {
    // The closure is closed under import: no module in it imports a relative
    // module outside the set (which would 404 when the browser followed it).
    const closure = new Set(assertNonEmpty(sharedModuleClosure(SITE_DIR), 'v1 shared-module closure'));
    for (const file of closure) {
      const src = fs.readFileSync(path.join(SITE_DIR, file), 'utf8');
      for (const m of src.matchAll(/from\s+['"]\.\/([a-z0-9-]+\.js)['"]/g)) {
        expect(closure.has(m[1]), `${file} imports ./${m[1]}, absent from the shipped closure`).toBe(true);
      }
    }
  });

  it('DeployV1SharedModules_CopiesEveryClosureModule_IntoTheDeployRoot', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v1-shared-'));
    const copied = assertNonEmpty(deployV1SharedModules(SITE_DIR, dir), 'deployed v1 shared modules');
    expect(copied).toEqual(sharedModuleClosure(SITE_DIR));
    for (const file of copied) {
      expect(fs.existsSync(path.join(dir, file)), `${file} was not copied`).toBe(true);
      expect(fs.readFileSync(path.join(dir, file)).equals(fs.readFileSync(path.join(SITE_DIR, file))), `${file} differs from source`).toBe(true);
    }
  });
});
