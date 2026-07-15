import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse } from 'csv-parse/sync';
import { defaultFoiDir } from '../shared/foi-archive.ts';

// Some open-data CSV exports append empty-named trailing columns that csv-parse
// collapses (duplicate empty headers -> one key), which loses the true column
// count so the raw cannot round-trip. The recorded, auditable remedy (agreed
// 2026-07-15) is a raw-extract that is byte-for-byte the raw with ONLY the empty
// header names filled in (unknown-1..N) and LF endings - a shape/parsing edit,
// never a data edit. This oracle is the audit of that promise: it proves, over
// the real archive, that every such extract's data cells are identical to its
// raw source, so the header-synthesis changed nothing but the shape. Without it
// the "otherwise exactly the raw" claim would rest on trust; here it is checked.

// An extract qualifies when it declares extractOf a sibling whose own bytes are
// a text CSV (not a binary workbook) - i.e. a CSV-to-CSV header synthesis.
interface Qualifying { entryDir: string; extract: string; raw: string; }

function csvHeaderSynthesisedExtracts(foiDir: string): Qualifying[] {
  const out: Qualifying[] = [];
  if (!fs.existsSync(foiDir)) return out;
  for (const key of fs.readdirSync(foiDir)) {
    const metaPath = path.join(foiDir, key, 'meta.json');
    if (!fs.existsSync(metaPath)) continue;
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as {
      files?: Record<string, { role?: string; extractOf?: string }>;
    };
    for (const [name, decl] of Object.entries(meta.files ?? {})) {
      if (decl.role !== 'extract' || typeof decl.extractOf !== 'string') continue;
      if (!decl.extractOf.toLowerCase().endsWith('.csv')) continue; // CSV-to-CSV only
      out.push({ entryDir: path.join(foiDir, key), extract: name, raw: decl.extractOf });
    }
  }
  return out;
}

const rows = (buf: Buffer): string[][] =>
  parse(buf.toString('utf8'), { columns: false, skip_empty_lines: true, bom: true, relax_column_count: true });

describe('CSV header-synthesised extracts change only the shape, never the data', { tags: ['data-validity'] }, () => {
  const qualifying = csvHeaderSynthesisedExtracts(defaultFoiDir());

  it('CsvHeaderSynthesisedExtract_WhenComparedToItsRaw_HasByteIdenticalDataRows', () => {
    for (const q of qualifying) {
      const rawRows = rows(fs.readFileSync(path.join(q.entryDir, q.raw)));
      const extractRows = rows(fs.readFileSync(path.join(q.entryDir, q.extract)));
      const label = `${path.basename(q.entryDir)}/${q.extract}`;
      // Same number of physical rows (header + every data row).
      expect(extractRows.length, `${label}: row count`).toBe(rawRows.length);
      // Every DATA row (index >= 1) is identical field-for-field.
      for (let i = 1; i < rawRows.length; i++) {
        expect(extractRows[i], `${label}: data row ${i + 1} differs from the raw`).toEqual(rawRows[i]);
      }
      // The header differs ONLY by filling empty names: each raw header cell is
      // either unchanged, or was empty and is now a non-empty synthetic name.
      const rawHeader = rawRows[0];
      const extractHeader = extractRows[0];
      expect(extractHeader.length, `${label}: header width`).toBe(rawHeader.length);
      for (let c = 0; c < rawHeader.length; c++) {
        if (rawHeader[c] === '') {
          expect(extractHeader[c], `${label}: empty header ${c} must be filled`).not.toBe('');
        } else {
          expect(extractHeader[c], `${label}: non-empty header ${c} must be unchanged`).toBe(rawHeader[c]);
        }
      }
    }
  });
});
