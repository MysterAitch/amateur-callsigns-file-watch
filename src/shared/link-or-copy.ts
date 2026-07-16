/**
 * Hardlink-or-copy for the site assembly's verbatim files (issue #646). The
 * deploy assembles _site on the same filesystem as the checkout, so every file
 * taken byte-for-byte from archive/ (the ~600 MB of published dataset files)
 * need not be duplicated on disk: a hardlink names the same inode, so the
 * assembled tree shares the checkout's blocks rather than doubling them. The
 * combined saving removes the duplication the ENOSPC fired inside.
 *
 * A hardlink is not always possible - a cross-device target (EXDEV), a
 * filesystem that does not support links (ENOTSUP/EPERM), a hardlink ceiling
 * (EMLINK), or a Windows dev box where linking needs a privilege the process
 * lacks. In every such case the fallback is a plain copy, which is silent and
 * byte-identical: the assembled file has the same contents either way, so the
 * published output does not depend on which path ran. A pre-existing target is
 * removed first so the result matches copyFileSync's overwrite semantics
 * whether the link or the copy path serves it.
 */

import * as fs from 'fs';

// Seam for the fallback test: the real assembly always uses fs, but a test can
// force the link path to fail (simulating a cross-device or unprivileged
// target) to prove the copy fallback is taken and stays byte-identical.
export interface LinkOrCopyIo {
  link: (sourcePath: string, targetPath: string) => void;
  copy: (sourcePath: string, targetPath: string) => void;
  removeIfPresent: (targetPath: string) => void;
}

const defaultIo: LinkOrCopyIo = {
  link: (sourcePath, targetPath) => fs.linkSync(sourcePath, targetPath),
  copy: (sourcePath, targetPath) => fs.copyFileSync(sourcePath, targetPath),
  removeIfPresent: targetPath => fs.rmSync(targetPath, { force: true }),
};

// Places targetPath as a hardlink to sourcePath, falling back to a byte-for-byte
// copy when linking is unavailable. Returns which path served, purely so callers
// can report the split (linked vs copied) - the assembled bytes are identical
// either way. Any failure of the copy fallback itself propagates: a genuinely
// broken assembly must fail loudly, never silently.
export function linkOrCopyFileSync(
  sourcePath: string,
  targetPath: string,
  io: LinkOrCopyIo = defaultIo,
): 'link' | 'copy' {
  io.removeIfPresent(targetPath);
  try {
    io.link(sourcePath, targetPath);
    return 'link';
  } catch {
    io.copy(sourcePath, targetPath);
    return 'copy';
  }
}
