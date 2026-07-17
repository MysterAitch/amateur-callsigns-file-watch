import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse } from 'csv-parse/sync';
import { DIRS } from '../shared/constants.ts';
import { listArchiveKeys } from '../shared/archive.ts';
import { defaultFoiDir, listFoiEntryKeys } from '../shared/foi-archive.ts';

// Some CSV exports append empty-named trailing columns that csv-parse collapses
// (duplicate empty headers -> one key), which loses the true column count so the
// raw cannot round-trip. The recorded, auditable remedy is a raw-extract that is
// byte-for-byte the raw with ONLY the empty header names filled in (unknown-1..N)
// and LF line endings - a shape/parsing edit, never a data edit. This oracle is
// the audit of that promise across BOTH archive lanes (archive/{date}/ and
// archive/foi/): it proves, over the real archive, that every such extract's
// data cells are identical to its raw source, so the header synthesis changed
// nothing but the shape. Without it the "otherwise exactly the raw" claim would
// rest on trust; here it is checked continuously, and any future entry that
// declares a CSV-to-CSV extract joins the audit automatically.
//
// An extract qualifies when it declares extractOf a sibling whose own bytes are
// a text CSV (not a binary workbook or PDF) - i.e. a CSV-to-CSV header
// synthesis. Workbook and PDF extracts are excluded deliberately: their
// fidelity is covered by the extractor's own tests plus the sweep's
// re-derivation, not by byte comparison against a binary.

interface QualifyingExtract {
  label: string;
  entryDir: string;
  extract: string;
  raw: string;
}

// Both lanes' meta.json declare files{} with the same role/extractOf vocabulary
// (ArchivedFileMeta mirrors the FOI lane's FoiFileDeclaration), so one reader
// serves both.
interface MetaFilesOnly {
  files?: Record<string, { role?: string; extractOf?: string }>;
}

function csvHeaderSynthesisedExtracts(): QualifyingExtract[] {
  const foiDir = defaultFoiDir();
  const entryDirs = [
    ...listArchiveKeys().map(key => path.join(DIRS.archive, key)),
    ...listFoiEntryKeys(foiDir).map(key => path.join(foiDir, key)),
  ];
  const out: QualifyingExtract[] = [];
  for (const entryDir of entryDirs) {
    const metaPath = path.join(entryDir, 'meta.json');
    if (!fs.existsSync(metaPath)) continue;
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as MetaFilesOnly;
    for (const [name, decl] of Object.entries(meta.files ?? {})) {
      if (decl.role !== 'extract' || typeof decl.extractOf !== 'string') continue;
      if (!decl.extractOf.toLowerCase().endsWith('.csv')) continue; // CSV-to-CSV only
      out.push({
        label: `${path.relative(DIRS.archive, entryDir).split(path.sep).join('/')}/${name}`,
        entryDir,
        extract: name,
        raw: decl.extractOf,
      });
    }
  }
  return out;
}

const rows = (buf: Buffer): string[][] =>
  parse(buf.toString('utf8'), { columns: false, skip_empty_lines: true, bom: true, relax_column_count: true });

describe('CSV header-synthesised extracts change only the shape, never the data', { tags: ['data-validity'] }, () => {
  const qualifying = csvHeaderSynthesisedExtracts();
  // Observability: how many extracts this run actually audits.
  process.stderr.write(`[extract-audit] ${qualifying.length} CSV-to-CSV extract(s) discovered across both lanes\n`);

  it('CsvToCsvExtracts_WhenDiscoveredAcrossBothLanes_AtLeastOneQualifies', () => {
    // The audit must never pass vacuously: the 2025-11-11 open-data recovery
    // committed a raw-extract.csv, so an empty discovery means the enumeration
    // broke (renamed helper, moved lane), not that the archive has none.
    expect(qualifying.length).toBeGreaterThanOrEqual(1);
  });

  it.each(qualifying)(
    'CsvHeaderSynthesisedExtract_WhenComparedToItsRaw_HasByteIdenticalDataRows ($label)',
    (q) => {
      const rawRows = rows(fs.readFileSync(path.join(q.entryDir, q.raw)));
      const extractRows = rows(fs.readFileSync(path.join(q.entryDir, q.extract)));
      // Same number of physical rows (header + every data row).
      expect(extractRows.length, `${q.label}: row count`).toBe(rawRows.length);
      // Every DATA row (index >= 1) is identical field-for-field.
      for (let i = 1; i < rawRows.length; i++) {
        expect(extractRows[i], `${q.label}: data row ${i + 1} differs from the raw`).toEqual(rawRows[i]);
      }
    },
  );

  it.each(qualifying)(
    'CsvHeaderSynthesisedExtract_WhenComparedToItsRaw_HeaderDiffersOnlyByFillingEmptyNames ($label)',
    (q) => {
      const rawHeader = rows(fs.readFileSync(path.join(q.entryDir, q.raw)))[0];
      const extractHeader = rows(fs.readFileSync(path.join(q.entryDir, q.extract)))[0];
      // Each raw header cell is either unchanged, or was empty and is now a
      // non-empty synthetic name - never renamed, dropped or added.
      expect(extractHeader.length, `${q.label}: header width`).toBe(rawHeader.length);
      for (let c = 0; c < rawHeader.length; c++) {
        if (rawHeader[c] === '') {
          expect(extractHeader[c], `${q.label}: empty header ${c} must be filled`).not.toBe('');
        } else {
          expect(extractHeader[c], `${q.label}: non-empty header ${c} must be unchanged`).toBe(rawHeader[c]);
        }
      }
    },
  );

  it.each(qualifying)(
    'CsvHeaderSynthesisedExtract_WhenInspectedForLineEndings_UsesTheDocumentedLfNormalisation ($label)',
    (q) => {
      // The documented extract shape is LF endings throughout; a carriage return
      // anywhere (line ending or embedded in a cell) deviates from that record.
      const extractBytes = fs.readFileSync(path.join(q.entryDir, q.extract));
      expect(extractBytes.includes(0x0d), `${q.label}: extract must use LF line endings only`).toBe(false);
    },
  );
});
