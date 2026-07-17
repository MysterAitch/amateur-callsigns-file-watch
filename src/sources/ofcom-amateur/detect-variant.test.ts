import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { observeEntryHeader } from './detect-variant.ts';

// Test names follow Subject_Scenario_Outcome per project convention.
//
// Header observation from an entry's own parse source (issue #629 phase 3):
// the piece that lets a freshly fetched publication - raw + meta only, no
// curated declarations - resolve its authored raw->canonical binding in the
// ledger projection, and lets the data-status grid report such an entry's
// columns as mapped. An unknown or unreadable shape must stay honestly
// undetected, never guessed.

function stageEntry(name: string, firstLine: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `detect-variant-${name}-`));
  fs.writeFileSync(path.join(dir, 'raw.csv'), `${firstLine}\nM7TEE\n`);
  return dir;
}

describe('observeEntryHeader', { tags: ['unit'] }, () => {
  it('ObserveEntryHeader_FreshEntryWithAuthoredHeaderShape_DetectsTheVariant', () => {
    const dir = stageEntry('known', 'Callsign,Product__c,Status,Type__c,Licence_Version.LastModifiedDate,Licence_Version.Original_start_date__c');
    try {
      const observed = observeEntryHeader(dir, {});
      expect(observed.variant).toBe('v2026-licence-version');
      expect(observed.headers?.[0]).toBe('Callsign');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ObserveEntryHeader_BomPrefixedHeaderRow_StillDetects', () => {
    // Real exports have arrived BOM-prefixed; the observation must read the
    // same post-BOM-strip headers the converter lane reads.
    const dir = stageEntry('bom', '﻿Value,Status,Type');
    try {
      expect(observeEntryHeader(dir, {}).variant).toBe('v2022-minimal');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ObserveEntryHeader_UnknownHeaderShape_ReturnsHeadersButNoVariant', () => {
    const dir = stageEntry('unknown', 'Mystery__c,Columns__c');
    try {
      const observed = observeEntryHeader(dir, {});
      expect(observed.variant).toBeUndefined();
      expect(observed.headers).toEqual(['Mystery__c', 'Columns__c']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ObserveEntryHeader_DeclaredExtractParseSource_IsObservedInsteadOfRaw', () => {
    // A workbook entry's parse source is its declared extract - the header
    // observation must follow the same parse-source rule every other reader
    // uses, never assume raw.csv.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'detect-variant-extract-'));
    try {
      fs.writeFileSync(path.join(dir, 'raw.xlsx'), 'not-actually-a-workbook');
      fs.writeFileSync(path.join(dir, 'raw-extract-sheet-1-sheet1.csv'), 'Value,Status,Type\nM7TEE,Allocated,Amateur\n');
      const meta = {
        files: {
          'raw.xlsx': { bytes: 1, sha256: 'x', format: 'xlsx' as const },
          'raw-extract-sheet-1-sheet1.csv': { bytes: 1, sha256: 'x', format: 'csv' as const, role: 'extract' as const, extractOf: 'raw.xlsx' },
        },
      };
      expect(observeEntryHeader(dir, meta).variant).toBe('v2022-minimal');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ObserveEntryHeader_MissingParseSource_ReturnsNothingObserved', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'detect-variant-empty-'));
    try {
      const observed = observeEntryHeader(dir, {});
      expect(observed.headers).toBeUndefined();
      expect(observed.variant).toBeUndefined();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
