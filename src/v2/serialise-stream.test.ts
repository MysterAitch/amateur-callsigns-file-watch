import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { serialiseClaimsJsonl, parseClaimsJsonl, writeClaimsJsonlSync, readClaimsJsonlSync } from './serialise.ts';
import type { Claim } from './claim.ts';

// Test names follow the project's Subject_Scenario_Outcome convention.
//
// The event-time tier (issue #725 S1) grew the biggest per-source ledgers past
// V8's maximum string length, so the persisted JSONL now streams to and from
// disk in bounded chunks. The contract these tests pin is BYTE-IDENTITY with
// the whole-string serialiser: chunking changes how the bytes move, never what
// they are — a re-run diff over the persisted ledger stays a real signal.

function sampleClaims(count: number): Claim[] {
  const claims: Claim[] = [];
  for (let i = 0; i < count; i += 1) {
    claims.push({
      layer: i % 3 === 0 ? 'raw' : 'derived',
      rawSubject: `M7TE${i}`,
      predicate: i % 3 === 0 ? '@listed' : 'event-date/record-created',
      object: i % 3 === 0 ? '' : '2016-07-23',
      provenance: {
        sourceFile: 'synthetic/stream.csv',
        ordinal: i,
        vintage: '2026-01-01',
        position: { kind: 'csv-line', line: i + 2 },
        viewAnchor: { repoPath: 'archive/synthetic/stream.csv', line: i + 2 },
      },
      ...(i % 3 === 0 ? {} : { rule: 'event-date-extraction' }),
    });
  }
  // A multi-byte value, so the byte-level line splitting is proven safe for
  // non-ASCII content (0x0A never occurs inside a UTF-8 continuation).
  claims.push({
    layer: 'raw', rawSubject: 'G0TQK ', predicate: 'Licensee', object: 'Ofcom — £ ✓',
    provenance: { sourceFile: 'synthetic/stream.csv', ordinal: count, vintage: '2026-01-01' },
  });
  return claims;
}

describe('the chunked JSONL write/read path is byte-identical to the whole-string serialiser', { tags: ['unit'] }, () => {
  it('LedgerFile_WhenWrittenInChunks_HoldsExactlyTheWholeStringSerialisation', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serialise-stream-'));
    try {
      const claims = sampleClaims(2_500);
      const filePath = path.join(dir, 'claims.jsonl');
      writeClaimsJsonlSync(filePath, claims);
      expect(fs.readFileSync(filePath, 'utf8')).toBe(serialiseClaimsJsonl(claims));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('LedgerFile_WhenReadBackChunked_RoundTripsEveryClaimIncludingEnrichments', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serialise-stream-'));
    try {
      const claims = sampleClaims(1_000);
      const filePath = path.join(dir, 'claims.jsonl');
      writeClaimsJsonlSync(filePath, claims);
      const readBack = readClaimsJsonlSync(filePath);
      expect(readBack).toEqual(parseClaimsJsonl(serialiseClaimsJsonl(claims)));
      expect(readBack).toEqual(parseClaimsJsonl(fs.readFileSync(filePath, 'utf8')));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('EmptyLedger_WhenWrittenAndReadChunked_StaysAnEmptyFileAndAnEmptyClaimSet', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serialise-stream-'));
    try {
      const filePath = path.join(dir, 'claims.jsonl');
      writeClaimsJsonlSync(filePath, []);
      expect(fs.readFileSync(filePath, 'utf8')).toBe(serialiseClaimsJsonl([]));
      expect(readClaimsJsonlSync(filePath)).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
