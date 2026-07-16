import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'node:crypto';
import { linkOrCopyFileSync, type LinkOrCopyIo } from './link-or-copy.ts';

// The site assembly takes ~600 MB of files byte-for-byte out of the checkout
// (issue #646). Placing each as a hardlink instead of a copy shares the
// checkout's blocks rather than doubling them - as long as the assembled bytes
// stay identical whether a link or a copy served the file. These scenarios pin
// that property from the assembly's point of view: same contents out, a shared
// inode where the filesystem allows it, and a silent copy fallback where it
// does not.

const sha256 = (filePath: string): string =>
  createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');

let workDir: string;
let sourcePath: string;
const sourceBytes = Buffer.from('callsign,cleaned\nM7TEE,M7TEE\nG6FMU,G6FMU\n', 'utf8');

beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'link-or-copy-'));
  sourcePath = path.join(workDir, 'source.csv');
  fs.writeFileSync(sourcePath, sourceBytes);
});

afterEach(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

describe('linkOrCopyFileSync', { tags: ['unit'] }, () => {
  it('AssembledFile_WhenLinkingSucceeds_SharesTheSourceInode', () => {
    const targetPath = path.join(workDir, 'target.csv');

    const via = linkOrCopyFileSync(sourcePath, targetPath);

    expect(via).toBe('link');
    expect(fs.readFileSync(targetPath).equals(sourceBytes)).toBe(true);
    // A hardlink names the same inode as the source: the block-level saving the
    // fix depends on. Both entries then report a link count of two.
    expect(fs.statSync(targetPath).ino).toBe(fs.statSync(sourcePath).ino);
    expect(fs.statSync(targetPath).nlink).toBe(2);
  });

  it('AssembledFile_WhenLinkingUnsupported_FallsBackToAByteIdenticalCopy', () => {
    const targetPath = path.join(workDir, 'target.csv');
    // A filesystem that refuses hardlinks (cross-device, unsupported FS, or an
    // unprivileged Windows dev box) raises on link; the fallback must be a
    // silent, correct copy.
    const failingLink: LinkOrCopyIo = {
      link: () => { const error = new Error('EXDEV: cross-device link not permitted'); throw error; },
      copy: (src, dest) => fs.copyFileSync(src, dest),
      removeIfPresent: dest => fs.rmSync(dest, { force: true }),
    };

    const via = linkOrCopyFileSync(sourcePath, targetPath, failingLink);

    expect(via).toBe('copy');
    // Byte-identical to the source, and an independent inode (a real copy, not
    // a link) - so the published output is the same regardless of which path ran.
    expect(sha256(targetPath)).toBe(sha256(sourcePath));
    expect(fs.statSync(targetPath).ino).not.toBe(fs.statSync(sourcePath).ino);
  });

  it('AssembledFile_WhenTargetAlreadyExists_IsOverwrittenWithTheSource', () => {
    const targetPath = path.join(workDir, 'target.csv');
    fs.writeFileSync(targetPath, Buffer.from('stale contents from a previous assembly\n', 'utf8'));

    const via = linkOrCopyFileSync(sourcePath, targetPath);

    // A re-run over an existing tree must land the current source, matching the
    // overwrite semantics of the copyFileSync it replaces, whichever path serves.
    expect(via).toBe('link');
    expect(sha256(targetPath)).toBe(sha256(sourcePath));
  });

  it('AssembledFile_WhenTargetExistsAndLinkingUnsupported_IsOverwrittenByTheCopy', () => {
    const targetPath = path.join(workDir, 'target.csv');
    fs.writeFileSync(targetPath, Buffer.from('stale contents from a previous assembly\n', 'utf8'));
    const failingLink: LinkOrCopyIo = {
      link: () => { throw new Error('EPERM: operation not permitted'); },
      copy: (src, dest) => fs.copyFileSync(src, dest),
      removeIfPresent: dest => fs.rmSync(dest, { force: true }),
    };

    const via = linkOrCopyFileSync(sourcePath, targetPath, failingLink);

    expect(via).toBe('copy');
    expect(sha256(targetPath)).toBe(sha256(sourcePath));
  });

  it('AssembledFile_WhenBothLinkAndCopyFail_FailsLoudly', () => {
    const targetPath = path.join(workDir, 'target.csv');
    // A genuinely broken assembly (e.g. no space left for the copy fallback)
    // must surface, never be swallowed by the fallback.
    const bothFail: LinkOrCopyIo = {
      link: () => { throw new Error('EXDEV: cross-device link not permitted'); },
      copy: () => { throw new Error('ENOSPC: no space left on device'); },
      removeIfPresent: dest => fs.rmSync(dest, { force: true }),
    };

    expect(() => linkOrCopyFileSync(sourcePath, targetPath, bothFail)).toThrow(/ENOSPC/);
  });
});
