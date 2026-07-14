import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as zlib from 'zlib';
import { packagePublishedTiers } from './build-sqlite.ts';

let workDir: string;

beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'build-sqlite-package-'));
  fs.mkdirSync(path.join(workDir, 'datasets'), { recursive: true });
  fs.writeFileSync(path.join(workDir, 'foi-observations.csv'), 'callsign\nM7TEE\n');
  fs.writeFileSync(path.join(workDir, 'datasets', 'sample.sqlite'), 'sample sqlite bytes');
  fs.writeFileSync(path.join(workDir, 'combined.sqlite.png'), 'combined sqlite bytes');
});

afterEach(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

describe('published tiers packaging', { tags: ['unit'] }, () => {
  it('PublishedTiers_WhenRawBuildAlreadyExists_PackagesDeployArtefactsWithoutRebuilding', () => {
    const summary = packagePublishedTiers(workDir);

    expect(summary['packaged union csv']).toBe(1);
    expect(summary['packaged per-dataset databases']).toBe(1);
    expect(summary['packaged combined download twin']).toBe(1);

    expect(fs.existsSync(path.join(workDir, 'foi-observations.csv'))).toBe(false);
    expect(zlib.gunzipSync(fs.readFileSync(path.join(workDir, 'foi-observations.csv.gz'))).toString('utf8')).toBe('callsign\nM7TEE\n');

    expect(fs.existsSync(path.join(workDir, 'datasets', 'sample.sqlite'))).toBe(false);
    expect(zlib.gunzipSync(fs.readFileSync(path.join(workDir, 'datasets', 'sample.sqlite.gz'))).toString('utf8')).toBe('sample sqlite bytes');

    expect(fs.readFileSync(path.join(workDir, 'combined.sqlite.png'), 'utf8')).toBe('combined sqlite bytes');
    expect(zlib.gunzipSync(fs.readFileSync(path.join(workDir, 'combined.sqlite.gz'))).toString('utf8')).toBe('combined sqlite bytes');
  });
});
