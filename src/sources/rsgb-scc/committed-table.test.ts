import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import { parse } from 'csv-parse/sync';
import {
  SCC_CSV_HEADER,
  CANONICAL_STATUSES,
  KNOWN_STATUS_TYPOS,
  NOMINAL_ROW_COUNT,
  ROW_COUNT_TOLERANCE,
  classifyStatus,
} from './parse-scc.ts';
import { SCC_CSV_PATH, SCC_META_PATH, readCommittedRows } from './fetch-scc.ts';
import type { SccMeta } from './parse-scc.ts';

// These validations run against the REAL committed derived table, not a fixture —
// the encoded assumptions this project relies on for the RSGB Special Contest
// Calls reference data. They are the standing self-check that a future scheduled
// refresh cannot silently introduce an unrecognised status, lose the "Updated"
// banner, drift the row count, or let the sidecar metadata diverge from the CSV.

const rows = readCommittedRows(SCC_CSV_PATH);
const meta = JSON.parse(fs.readFileSync(SCC_META_PATH, 'utf8')) as SccMeta;

// The closed vocabulary the committed table's status column is allowed to draw
// from: the canonical set plus the curated known typos (each carried verbatim).
const ALLOWED_RAW_STATUSES = new Set<string>([
  ...CANONICAL_STATUSES,
  ...CANONICAL_STATUSES.map((s) => s.toLowerCase()),
  ...KNOWN_STATUS_TYPOS.keys(),
]);

const ALLOWED_NOTE_FLAGS = new Set(['status-noncanonical-case', 'status-typo']);

describe('committed SCC table', { tags: ['data-validity'] }, () => {
  it('Csv_WhenParsed_CarriesExactlyTheDeclaredColumns', () => {
    const raw = fs.readFileSync(SCC_CSV_PATH, 'utf8');
    const parsed = parse(raw, { columns: false, skip_empty_lines: true }) as string[][];
    expect(parsed[0]).toEqual([...SCC_CSV_HEADER]);
    expect(parsed.every((r) => r.length === SCC_CSV_HEADER.length)).toBe(true);
  });

  it('RowCount_WhenChecked_SitsWithinTheSanityBand', () => {
    expect(rows.length).toBeGreaterThanOrEqual(NOMINAL_ROW_COUNT - ROW_COUNT_TOLERANCE);
    expect(rows.length).toBeLessThanOrEqual(NOMINAL_ROW_COUNT + ROW_COUNT_TOLERANCE);
  });

  it('EveryStatus_WhenChecked_IsCanonicalOrAnAllowListedAnomaly', () => {
    const offenders = rows.filter((r) => !ALLOWED_RAW_STATUSES.has(r.status)).map((r) => `${r.scc_code}=${r.status}`);
    expect(offenders, `unrecognised statuses would fail the sweep's fail-loud gate: ${offenders.join(', ')}`).toEqual([]);
    // And none classify as unrecognised — the same check the live gate applies.
    expect(rows.every((r) => !classifyStatus(r.status).unrecognised)).toBe(true);
  });

  it('SccCodes_WhenChecked_AreUniqueAndSorted', () => {
    const codes = rows.map((r) => r.scc_code);
    expect(new Set(codes).size).toBe(codes.length);
    expect([...codes]).toEqual([...codes].sort((a, b) => a.localeCompare(b)));
  });

  it('NotesFlags_WhenChecked_DrawFromTheClosedVocabulary', () => {
    for (const row of rows) {
      if (row.notes === '') continue;
      for (const token of row.notes.split('; ')) {
        // A remnant capture is `source-cell-remnant:<column>=<verbatim>`; a status
        // flag is one of the closed set. Anything else is an unexpected note.
        const isRemnant = token.startsWith('source-cell-remnant:');
        expect(isRemnant || ALLOWED_NOTE_FLAGS.has(token), `unexpected note token: ${token}`).toBe(true);
      }
    }
  });

  it('CarriedAnomalies_WhenChecked_AreFlaggedNotSilentlyPresent', () => {
    // Each status carried in a non-canonical spelling/casing MUST also carry the
    // matching flag in its notes — the carry-verbatim-AND-flag contract.
    for (const row of rows) {
      const expectedFlags = classifyStatus(row.status).flags.filter((f) => f !== 'status-unrecognised');
      for (const flag of expectedFlags) {
        expect(row.notes.split('; '), `${row.scc_code} carries status "${row.status}" but is not flagged ${flag}`).toContain(flag);
      }
    }
  });

  it('Metadata_WhenChecked_MatchesTheCsvShapeAndCarriesProvenance', () => {
    expect(meta.rowCount).toBe(rows.length);
    expect(meta.source.url).toBe('https://www.rsgbcc.org/hf/information/scc.shtml');
    expect(Number.isNaN(Date.parse(meta.fetchedAt))).toBe(false);
    expect(meta.upstreamUpdated.iso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Number.isNaN(Date.parse(meta.upstreamUpdated.iso))).toBe(false);

    // The recorded status distribution is re-derived from the CSV and must agree.
    const derived: Record<string, number> = {};
    for (const row of rows) derived[row.status] = (derived[row.status] ?? 0) + 1;
    expect(meta.statusCounts).toEqual(derived);
  });

  it('CapturedRemnants_WhenChecked_ArePresentForTheKnownHiddenCells', () => {
    // At least one hidden x:str remnant is captured (the attested source bytes
    // that would otherwise be lost); each names a real column of the table.
    const remnantRows = rows.filter((r) => r.notes.includes('source-cell-remnant:'));
    expect(remnantRows.length).toBeGreaterThan(0);
    for (const row of remnantRows) {
      for (const token of row.notes.split('; ').filter((t) => t.startsWith('source-cell-remnant:'))) {
        const column = token.slice('source-cell-remnant:'.length).split('=')[0];
        expect(SCC_CSV_HEADER as readonly string[]).toContain(column);
      }
    }
  });
});
