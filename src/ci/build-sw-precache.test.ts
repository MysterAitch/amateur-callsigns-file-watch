import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  shellAssetNames,
  shellVersion,
  stampPrecache,
  renderPrecacheBlock,
  VENDOR_SHELL_ASSETS,
  ROOT_SHELL_ASSET,
  PRECACHE_START,
  PRECACHE_END,
} from './build-sw-precache.ts';

// A throwaway site-like directory; each test seeds only the files it cares
// about, so the rule's behaviour is asserted in isolation from the real site/.
function makeSiteDir(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-precache-'));
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(dir, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return dir;
}

describe('service-worker precache generator', { tags: ['unit'] }, () => {
  it('PrecacheRule_EnumeratesShippedShellAssets_ByExtension', () => {
    const dir = makeSiteDir({
      'index.html': '<!doctype html>',
      'about.html': '<!doctype html>',
      'app.js': 'export {};',
      'debug.js': 'export {};',
      'style.css': 'body{}',
      'manifest.webmanifest': '{}',
    });
    const assets = shellAssetNames(dir);
    expect(assets).toEqual([
      ROOT_SHELL_ASSET,
      'about.html',
      'index.html',
      'app.js',
      'debug.js',
      'style.css',
      'manifest.webmanifest',
      ...VENDOR_SHELL_ASSETS,
    ]);
  });

  it('PrecacheRule_ANewSiteModule_IsPrecachedWithNoHandEdit', () => {
    const before = makeSiteDir({ 'index.html': 'x', 'app.js': 'export {};' });
    expect(shellAssetNames(before)).not.toContain('newly-added.js');
    // The very contention issue #614 removes: dropping a module into site/ is
    // all it takes for the rule to precache it.
    fs.writeFileSync(path.join(before, 'newly-added.js'), 'export {};');
    expect(shellAssetNames(before)).toContain('newly-added.js');
  });

  it('PrecacheRule_ExcludesTheWorkerAndNonShellFiles_FromTheList', () => {
    const dir = makeSiteDir({
      'app.js': 'export {};',
      'sw.js': '// worker',            // never precaches itself
      'app.test.ts': '// tooling',      // not a shipped asset
      'notes.md': '# doc',              // not a shell asset
      'sub/nested.js': 'export {};',    // subtree module, out of the top-level rule
    });
    const assets = shellAssetNames(dir);
    expect(assets).toContain('app.js');
    expect(assets).not.toContain('sw.js');
    expect(assets).not.toContain('app.test.ts');
    expect(assets).not.toContain('notes.md');
    expect(assets).not.toContain('sub/nested.js');
  });

  it('ShellVersion_WhenPrecachedSetGrows_Changes', () => {
    const dir = makeSiteDir({ 'index.html': 'x', 'app.js': 'export {};' });
    const before = shellVersion(dir, shellAssetNames(dir));
    fs.writeFileSync(path.join(dir, 'extra.js'), 'export {};');
    const after = shellVersion(dir, shellAssetNames(dir));
    expect(after).not.toBe(before);
  });

  it('ShellVersion_WhenAPrecachedFileContentChanges_Changes', () => {
    const dir = makeSiteDir({ 'index.html': 'x', 'app.js': 'export const a = 1;' });
    const assets = shellAssetNames(dir);
    const before = shellVersion(dir, assets);
    fs.writeFileSync(path.join(dir, 'app.js'), 'export const a = 2;');
    const after = shellVersion(dir, assets);
    expect(after).not.toBe(before);
  });

  it('ShellVersion_WhenNothingChanges_IsStable', () => {
    const dir = makeSiteDir({ 'index.html': 'x', 'app.js': 'export {};' });
    const assets = shellAssetNames(dir);
    expect(shellVersion(dir, assets)).toBe(shellVersion(dir, assets));
  });

  it('Stamp_ReplacesTheMarkedRegion_AndIsIdempotent', () => {
    const source = [
      'const DEPLOY_VERSION = \'dev\';',
      PRECACHE_START,
      'const SHELL_VERSION = \'dev\';',
      'const SHELL_ASSETS = [',
      '  \'./\',',
      '];',
      PRECACHE_END,
      'const SHELL_CACHE = `callsign-shell-${SHELL_VERSION}`;',
    ].join('\n');
    const assets = ['./', 'index.html', 'app.js'];
    const once = stampPrecache(source, 'abc123', assets);
    expect(once).toContain('const DEPLOY_VERSION = \'dev\';');
    expect(once).toContain('const SHELL_CACHE = `callsign-shell-${SHELL_VERSION}`;');
    expect(once).toContain(renderPrecacheBlock('abc123', assets));
    // Re-stamping the same output with the same inputs is a no-op.
    expect(stampPrecache(once, 'abc123', assets)).toBe(once);
  });

  it('Stamp_WhenMarkersAbsent_FailsLoudly', () => {
    expect(() => stampPrecache('const SHELL_ASSETS = [];', 'v', ['./'])).toThrow(/precache markers not found/);
  });
});
