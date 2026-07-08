/**
 * Minimal DETERMINISTIC zip writer for the published per-entry downloads.
 *
 * Hand-rolled on Node built-ins for the same supply-chain reasons as the
 * workbook reader (no new dependency for a bounded format need): the zip
 * container is local-file-header + deflated bytes per file, then a central
 * directory - nothing else. Compression is zlib deflateRaw; integrity is
 * zlib.crc32.
 *
 * Determinism matters because the zips ship in the Pages deploy artefact:
 * rebuilds over unchanged data must be byte-identical so archive re-crawls
 * see no phantom changes. Hence: a FIXED DOS timestamp (zip has no notion
 * of "no timestamp"; 1980-01-01 is the format's epoch and the conventional
 * reproducible-build choice), entries written in sorted name order, and no
 * platform-dependent extra fields.
 */

import * as zlib from 'zlib';

const DOS_EPOCH_DATE = (1 << 5) | 1; // 1980-01-01: year 0, month 1, day 1
const DOS_EPOCH_TIME = 0;

interface ZipEntry {
  name: string;
  data: Buffer;
}

function uint16(value: number): Buffer {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  return buffer;
}

function uint32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0);
  return buffer;
}

export function buildZip(entries: ZipEntry[]): Buffer {
  const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name));
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of sorted) {
    const nameBytes = Buffer.from(entry.name, 'utf8');
    const crc = zlib.crc32(entry.data);
    const deflated = zlib.deflateRawSync(entry.data, { level: 9 });
    // Store uncompressed when deflate does not help (already-compressed
    // formats: xlsx, pdf, gz) - smaller output, faster extraction.
    const useDeflate = deflated.length < entry.data.length;
    const stored = useDeflate ? deflated : entry.data;
    const method = useDeflate ? 8 : 0;

    const common = Buffer.concat([
      uint16(20), // version needed
      uint16(1 << 11), // general-purpose flags: UTF-8 names
      uint16(method),
      uint16(DOS_EPOCH_TIME),
      uint16(DOS_EPOCH_DATE),
      uint32(crc),
      uint32(stored.length),
      uint32(entry.data.length),
      uint16(nameBytes.length),
      uint16(0), // extra length
    ]);

    localParts.push(Buffer.concat([uint32(0x04034b50), common, nameBytes, stored]));
    centralParts.push(Buffer.concat([
      uint32(0x02014b50),
      uint16(20), // version made by
      common,
      uint16(0), // comment length
      uint16(0), // disk number
      uint16(0), // internal attributes
      uint32(0), // external attributes
      uint32(offset),
      nameBytes,
    ]));
    offset += 30 + nameBytes.length + stored.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const endRecord = Buffer.concat([
    uint32(0x06054b50),
    uint16(0), // disk number
    uint16(0), // central-directory start disk
    uint16(sorted.length),
    uint16(sorted.length),
    uint32(centralDirectory.length),
    uint32(offset),
    uint16(0), // comment length
  ]);

  return Buffer.concat([...localParts, centralDirectory, endRecord]);
}
