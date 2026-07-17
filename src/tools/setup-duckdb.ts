#!/usr/bin/env node

/**
 * Local/worktree equivalent of .github/actions/setup-duckdb (issue #336/#398):
 * download the SAME pinned, checksum-verified DuckDB CLI the CI action installs
 * into a repo-local `.duckdb/` directory, so a fresh checkout can run the
 * report-fold and report-sweep tests that fold committed reports via DuckDB.
 *
 * Supply-chain posture (ADR 0002): this is an EXPLICIT opt-in `npm run
 * setup:duckdb`, never a lifecycle/postinstall hook - `npm ci` still runs no
 * download and no compile step, and `ignore-scripts` holds. The version is
 * pinned and the download's SHA-256 is verified before the archive is opened;
 * a mismatch fails loudly rather than running an unexpected binary. No runtime
 * dependency is added to shipped code: the download, checksum and unzip all use
 * Node built-ins only.
 *
 * The pinned version and the linux-amd64 checksum are kept in lock-step with the
 * CI action (bump both together). linux-amd64 and windows-amd64 are checksum-
 * pinned; other platforms are named for the download URL but their SHA-256 must
 * be pinned before use, so no platform is ever fetched unverified.
 */

import { execFileSync } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';

// Pinned DuckDB CLI version. Keep in lock-step with .github/actions/setup-duckdb.
export const DUCKDB_VERSION = 'v1.5.4';

interface Release {
  // Release-asset filename on the DuckDB GitHub release.
  asset: string;
  // SHA-256 of that asset, or null when this platform is not yet pinned. A null
  // checksum means "download refused" - we never fetch an unverified binary.
  sha256: string | null;
  // Name of the extracted executable (and of the local copy we install).
  binaryName: string;
}

// Keyed by `${process.platform}-${process.arch}`. linux-x64 (what CI runs, its
// checksum shared with the action) and win32-x64 are pinned; each SHA-256 is of
// the official HTTPS release asset for DUCKDB_VERSION. The remaining platforms
// carry the correct asset name so the error message can name the exact download
// to pin, but are deliberately left unverified - no platform is ever fetched
// without a pinned checksum. To add one, hash its asset for DUCKDB_VERSION and
// fill in sha256 here.
const RELEASES: Record<string, Release> = {
  'linux-x64': {
    asset: 'duckdb_cli-linux-amd64.zip',
    sha256: '1f2fa724fb054b3dbe1a9cbd13de5b76997d850e7087ec762ba88db04e0180cf',
    binaryName: 'duckdb',
  },
  'win32-x64': {
    asset: 'duckdb_cli-windows-amd64.zip',
    sha256: '09e27c773eaab396754cbaa8fdbc5055c0006db4a579439839c7bb671894610f',
    binaryName: 'duckdb.exe',
  },
  'linux-arm64': { asset: 'duckdb_cli-linux-arm64.zip', sha256: null, binaryName: 'duckdb' },
  'darwin-x64': { asset: 'duckdb_cli-osx-universal.zip', sha256: null, binaryName: 'duckdb' },
  'darwin-arm64': { asset: 'duckdb_cli-osx-universal.zip', sha256: null, binaryName: 'duckdb' },
};

export function platformKey(): string {
  return `${process.platform}-${process.arch}`;
}

// Repo root, anchored to this file's location (src/tools) rather than cwd - the
// sweep tests chdir into throwaway fixtures, so cwd is not a reliable anchor.
export function repoRoot(): string {
  return path.resolve(import.meta.dirname, '..', '..');
}

// The install directory and binary path. Optional root for testability.
export function duckdbDir(root: string = repoRoot()): string {
  return path.join(root, '.duckdb');
}

function binaryNameFor(): string {
  return RELEASES[platformKey()]?.binaryName ?? (process.platform === 'win32' ? 'duckdb.exe' : 'duckdb');
}

export function duckdbBinaryPath(root: string = repoRoot()): string {
  return path.join(duckdbDir(root), binaryNameFor());
}

// Sidecar recording the SHA-256 of the installed binary, written after a
// verified install. It makes re-runs a true no-op (nothing re-downloaded when
// the on-disk binary still matches) and detects a corrupted/tampered binary.
function sidecarPath(root: string = repoRoot()): string {
  return path.join(duckdbDir(root), 'installed.sha256');
}

// The bootstrapped binary's path if it is present, else undefined. Callers (the
// vitest setup helper, tests) use this to decide whether the DuckDB-backed
// suites can run or must skip.
export function resolveBootstrappedDuckdb(root: string = repoRoot()): string | undefined {
  const bin = duckdbBinaryPath(root);
  return fs.existsSync(bin) ? bin : undefined;
}

function sha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// Fail-loud checksum gate: throws with both hashes on mismatch so an unexpected
// download is never opened or executed.
export function verifyChecksum(buf: Buffer, expected: string): void {
  const actual = sha256(buf);
  if (actual !== expected) {
    throw new Error(`DuckDB download checksum mismatch: expected ${expected}, got ${actual}. Refusing to install an unverified binary.`);
  }
}

// Extract a single named entry from a ZIP buffer using only node:zlib. Walks the
// central directory (which always carries the sizes, unlike a streamed local
// header) and inflates the raw deflate stream. Supports the only two methods a
// release zip uses: stored (0) and deflate (8).
export function extractZipEntry(zip: Buffer, wantBaseName: string): Buffer {
  const EOCD_SIG = 0x06054b50;
  const CEN_SIG = 0x02014b50;
  // Locate the End Of Central Directory record (scan back over its variable
  // trailing comment).
  let eocd = -1;
  for (let i = zip.length - 22; i >= 0; i--) {
    if (zip.readUInt32LE(i) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a ZIP archive: no end-of-central-directory record found');
  const entries = zip.readUInt16LE(eocd + 10);
  let pos = zip.readUInt32LE(eocd + 16);

  for (let n = 0; n < entries; n++) {
    if (zip.readUInt32LE(pos) !== CEN_SIG) throw new Error('corrupt ZIP central directory');
    const method = zip.readUInt16LE(pos + 10);
    const compSize = zip.readUInt32LE(pos + 20);
    const uncompSize = zip.readUInt32LE(pos + 24);
    const fnLen = zip.readUInt16LE(pos + 28);
    const extraLen = zip.readUInt16LE(pos + 30);
    const commentLen = zip.readUInt16LE(pos + 32);
    const localOffset = zip.readUInt32LE(pos + 42);
    const name = zip.toString('utf8', pos + 46, pos + 46 + fnLen);
    pos += 46 + fnLen + extraLen + commentLen;

    if (path.posix.basename(name) !== wantBaseName) continue;

    // Data start is computed from the LOCAL header's own name/extra lengths.
    const localFnLen = zip.readUInt16LE(localOffset + 26);
    const localExtraLen = zip.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localFnLen + localExtraLen;
    const compData = zip.subarray(dataStart, dataStart + compSize);
    const out = method === 0 ? Buffer.from(compData) : zlib.inflateRawSync(compData);
    if (out.length !== uncompSize) throw new Error(`ZIP entry ${name}: inflated size ${out.length} != declared ${uncompSize}`);
    return out;
  }
  throw new Error(`ZIP entry not found: ${wantBaseName}`);
}

export interface BootstrapResult {
  path: string;
  installed: boolean; // false => already present and verified (no-op)
}

// Idempotent, fail-loud bootstrap. No-op when the binary is already present and
// still matches the sidecar; otherwise downloads the pinned asset, verifies its
// SHA-256, extracts the binary, marks it executable and records its hash.
export async function bootstrapDuckdb(root: string = repoRoot()): Promise<BootstrapResult> {
  const bin = duckdbBinaryPath(root);
  const sidecar = sidecarPath(root);
  if (fs.existsSync(bin) && fs.existsSync(sidecar)) {
    const recorded = fs.readFileSync(sidecar, 'utf8').trim();
    if (recorded === sha256(fs.readFileSync(bin))) {
      return { path: bin, installed: false };
    }
  }

  const key = platformKey();
  const release = RELEASES[key];
  if (release === undefined) {
    throw new Error(`No DuckDB release mapping for platform ${key}. Add one to src/tools/setup-duckdb.ts.`);
  }
  if (release.sha256 === null) {
    throw new Error(
      `DuckDB is not checksum-pinned for platform ${key}. Only linux-x64 is pinned (it matches CI). `
      + `To enable ${key}, pin the SHA-256 of ${release.asset} for ${DUCKDB_VERSION} in src/tools/setup-duckdb.ts.`,
    );
  }

  const url = `https://github.com/duckdb/duckdb/releases/download/${DUCKDB_VERSION}/${release.asset}`;
  process.stderr.write(`Downloading ${url}\n`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status} ${res.statusText}): ${url}`);
  const zip = Buffer.from(await res.arrayBuffer());
  verifyChecksum(zip, release.sha256);

  const binary = extractZipEntry(zip, release.binaryName);
  fs.mkdirSync(duckdbDir(root), { recursive: true });
  fs.writeFileSync(bin, binary);
  if (process.platform !== 'win32') fs.chmodSync(bin, 0o755);
  fs.writeFileSync(sidecar, sha256(binary) + '\n');
  return { path: bin, installed: true };
}

async function main(): Promise<void> {
  const result = await bootstrapDuckdb();
  if (!result.installed) {
    process.stderr.write(`DuckDB already installed and verified: ${result.path}\n`);
  }
  // Prove the installed binary runs, mirroring the CI action's `--version`.
  const version = execFileSync(result.path, ['--version'], { encoding: 'utf8' }).trim();
  process.stderr.write(`${result.installed ? 'Installed' : 'Verified'} DuckDB CLI: ${version}\n`);
  process.stderr.write(`Set DUCKDB_BIN=${result.path} to use it outside the test suite.\n`);
}

if (import.meta.main) {
  main().catch((err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
}
