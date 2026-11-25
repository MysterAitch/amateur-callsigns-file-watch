import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { sharedModuleClosure } from './build-v1-shared-modules.ts';

// Test names follow Subject_Scenario_Outcome per project convention.
//
// The root of the deployed site serves a worker whose only job is to
// unregister itself (site/v1/sw.js). Anything served at the root that
// registered a worker would install it, be unregistered, be reloaded, and
// register it again without end - for every visitor. So nothing the deploy
// places at the root may register one.
//
// "At the root" is two sets: the v1 folder's own pages and scripts, and the
// shared modules the deploy copies beside them. The second set comes from the
// site's older tree, where registering a worker is normal, which is why it is
// enumerated by the deploy step's own function and not by a list kept here.

const V1_DIR = path.join('site', 'v1');
const SHARED_DIR = 'site';
const RETIREMENT_WORKER = 'sw.js';
const REGISTERS_A_WORKER = /serviceWorker\s*\.\s*register/;

function v1RootFiles(): string[] {
  return fs
    .readdirSync(V1_DIR)
    .filter((name) => /\.(html|js)$/.test(name) && !name.endsWith('.test.ts') && name !== RETIREMENT_WORKER)
    .map((name) => path.join(V1_DIR, name));
}

function sharedRootFiles(): string[] {
  return sharedModuleClosure(SHARED_DIR).map((name) => path.join(SHARED_DIR, name));
}

describe('what the deploy serves at the site root', { tags: ['unit'] }, () => {
  it('RootPagesAndScripts_NeverRegisterAServiceWorker', () => {
    const offenders = [...v1RootFiles(), ...sharedRootFiles()].filter((file) => REGISTERS_A_WORKER.test(fs.readFileSync(file, 'utf8')));

    expect(offenders).toEqual([]);
  });

  it('RootFileEnumeration_FindsBothSets_SoTheScanIsNotOfNothing', () => {
    expect(v1RootFiles().some((file) => file.endsWith('index.html'))).toBe(true);
    expect(v1RootFiles().some((file) => file.endsWith('.js'))).toBe(true);
    expect(sharedRootFiles().length).toBeGreaterThan(0);
  });

  it('RegistrationPattern_MatchesTheOlderTreesOwnRegistration_SoItCanFindOne', () => {
    // The older tree does register a worker; if this pattern cannot see that,
    // an empty offender list above means nothing.
    expect(REGISTERS_A_WORKER.test(fs.readFileSync(path.join('site', 'app.js'), 'utf8'))).toBe(true);
  });
});
