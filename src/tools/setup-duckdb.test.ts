import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { verifyChecksum, extractZipEntry, resolveBootstrappedDuckdb, duckdbBinaryPath } from './setup-duckdb.ts';

// Offline tests for the DuckDB bootstrap (issue #336/#398). The network
// download itself is not exercised here (tests must run without internet); the
// pieces it composes - checksum gating, ZIP extraction, and the present/absent
// resolution that drives the skip path - are. Test names follow
// Subject_Scenario_Outcome.

const KNOWN = Buffer.from('duckdb-bootstrap-fixture');
// sha256 of KNOWN, computed from Node's own crypto (independent of the module
// under test) so the gate is tested against a genuine hash, not a copy of its
// own output.
const KNOWN_SHA = crypto.createHash('sha256').update(KNOWN).digest('hex');

// Build a minimal single-entry ZIP (local header + data + central directory +
// EOCD). CRC is left zero - the extractor validates by inflated length, not
// CRC - so the fixture stays small. method: 0 = stored, 8 = raw deflate.
function makeZip(name: string, data: Buffer, method: 0 | 8): Buffer {
  const comp = method === 8 ? zlib.deflateRawSync(data) : data;
  const nameBuf = Buffer.from(name, 'utf8');

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(method, 8);
  local.writeUInt32LE(comp.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  const localBlock = Buffer.concat([local, nameBuf, comp]);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(method, 10);
  central.writeUInt32LE(comp.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt32LE(0, 42); // local header offset
  const centralBlock = Buffer.concat([central, nameBuf]);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8); // entries this disk
  eocd.writeUInt16LE(1, 10); // total entries
  eocd.writeUInt32LE(centralBlock.length, 12); // cd size
  eocd.writeUInt32LE(localBlock.length, 16); // cd offset

  return Buffer.concat([localBlock, centralBlock, eocd]);
}

describe('setup-duckdb — checksum gate', { tags: ['unit'] }, () => {
  it('VerifyChecksum_WhenHashMatches_DoesNotThrow', () => {
    expect(() => verifyChecksum(KNOWN, KNOWN_SHA)).not.toThrow();
  });

  it('VerifyChecksum_WhenHashMismatch_ThrowsNamingBothHashes', () => {
    const wrong = 'deadbeef'.repeat(8);
    expect(() => verifyChecksum(KNOWN, wrong)).toThrow(/checksum mismatch/i);
    expect(() => verifyChecksum(KNOWN, wrong)).toThrow(wrong);
  });
});

describe('setup-duckdb — ZIP extraction', { tags: ['unit'] }, () => {
  it('ExtractZipEntry_StoredEntry_ReturnsExactBytes', () => {
    const zip = makeZip('duckdb', KNOWN, 0);
    expect(extractZipEntry(zip, 'duckdb').equals(KNOWN)).toBe(true);
  });

  it('ExtractZipEntry_DeflatedEntry_ReturnsInflatedBytes', () => {
    const payload = Buffer.from('x'.repeat(5000)); // compressible, forces deflate
    const zip = makeZip('duckdb.exe', payload, 8);
    expect(extractZipEntry(zip, 'duckdb.exe').equals(payload)).toBe(true);
  });

  it('ExtractZipEntry_WhenEntryAbsent_Throws', () => {
    const zip = makeZip('something-else', KNOWN, 0);
    expect(() => extractZipEntry(zip, 'duckdb')).toThrow(/not found/i);
  });
});

describe('setup-duckdb — bootstrapped-binary resolution', { tags: ['unit'] }, () => {
  let root: string;
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'duckdb-setup-')); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it('ResolveBootstrappedDuckdb_WhenBinaryAbsent_ReturnsUndefined', () => {
    // The skip path: a fresh checkout that never ran setup:duckdb resolves to
    // nothing, so the DuckDB-gated suites skip rather than break.
    expect(resolveBootstrappedDuckdb(root)).toBeUndefined();
  });

  it('ResolveBootstrappedDuckdb_WhenBinaryPresent_ReturnsItsPath', () => {
    const bin = duckdbBinaryPath(root);
    fs.mkdirSync(path.dirname(bin), { recursive: true });
    fs.writeFileSync(bin, 'stub');
    expect(resolveBootstrappedDuckdb(root)).toBe(bin);
  });
});
