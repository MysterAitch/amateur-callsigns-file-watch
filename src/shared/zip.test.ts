import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { buildZip } from './zip.ts';

// Test names follow Subject_Scenario_Outcome per project convention.
//
// The deterministic zip writer feeds the published per-entry downloads.
// Round-trip verification uses an INDEPENDENT extractor (PowerShell's
// Expand-Archive on Windows, unzip elsewhere) - the writer must produce
// archives real tools accept, not merely ones it can describe.

function extractWith(systemTool: boolean, zipPath: string, destDir: string): void {
  if (systemTool && process.platform === 'win32') {
    execFileSync('powershell.exe', ['-NoProfile', '-Command', `Expand-Archive -Path "${zipPath}" -DestinationPath "${destDir}"`]);
  } else {
    execFileSync('unzip', ['-q', zipPath, '-d', destDir]);
  }
}

describe('Deterministic zip writer', () => {
  it('BuildZip_MixedContent_RoundTripsThroughAnIndependentExtractor', () => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-'));
    try {
      const text = Buffer.from('callsign,status\nM7TEE,Allocated\n'.repeat(1000), 'utf8');
      const binary = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0xff, 0x00, 0x81]);
      const zip = buildZip([
        { name: 'normalised.csv', data: text },
        { name: 'meta.json', data: Buffer.from('{"a":1}\n') },
        { name: 'raw.bin', data: binary },
      ]);
      const zipPath = path.join(scratch, 'entry.zip');
      fs.writeFileSync(zipPath, zip);
      const dest = path.join(scratch, 'out');
      extractWith(true, zipPath, dest);
      expect(fs.readFileSync(path.join(dest, 'normalised.csv')).equals(text)).toBe(true);
      expect(fs.readFileSync(path.join(dest, 'raw.bin')).equals(binary)).toBe(true);
      expect(fs.readFileSync(path.join(dest, 'meta.json'), 'utf8')).toBe('{"a":1}\n');
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('BuildZip_SameInputs_ProducesIdenticalBytesRegardlessOfEntryOrder', () => {
    const a = { name: 'a.txt', data: Buffer.from('alpha') };
    const b = { name: 'b.txt', data: Buffer.from('beta') };
    const first = buildZip([a, b]);
    const second = buildZip([b, a]);
    expect(first.equals(second)).toBe(true);
  });

  it('BuildZip_CompressibleVsIncompressible_ChoosesSmallerRepresentation', () => {
    const compressible = Buffer.from('x'.repeat(100_000), 'utf8');
    const zip = buildZip([{ name: 'big.txt', data: compressible }]);
    expect(zip.length).toBeLessThan(compressible.length / 10);
    // Incompressible data must not GROW the archive beyond header overhead.
    const random = Buffer.from(Array.from({ length: 10_000 }, (_, i) => (i * 7919) % 256));
    const deflated = buildZip([{ name: 'r.bin', data: random }]);
    expect(deflated.length).toBeLessThan(random.length + 200);
  });
});
