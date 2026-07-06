import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runNormaliseSweep } from './normalise-sweep';
import { CONSTANTS } from '../shared/utils';

// Test names follow Subject_Scenario_Outcome per project convention.
//
// The normalise sweep walks every archive entry, dispatches to the source's
// converter by meta.sourceKey, and closes the gap between intended and
// achieved schema versions - with per-entry independence (one failing entry
// never blocks the rest) and honest reporting of the coverage state.

const SALESFORCE_RAW =
  'Value__c,Product__c,Status__c,Type__c,CreatedDate,LastModifiedDate\n' +
  'M7TEE,Amateur Foundation Radio Licence,Allocated,Call Sign - Amateur,20/01/2019,21/04/2024\n' +
  'G5ABC,,Available,Call Sign - Amateur,21/01/2019,21/01/2019\n';

function sha256(content: string | Buffer): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function writeEntry(root: string, key: string, rawContent: string, metaOverrides: Record<string, unknown> = {}): void {
  const dir = path.join(root, CONSTANTS.DIRS.archive, key);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'raw.csv'), rawContent);
  const meta = {
    schemaVersion: 1,
    sourceKey: CONSTANTS.SOURCES.OFCOM_AMATEUR,
    provenance: 'live',
    fetchedAt: '2026-07-06T18:00:00.000Z',
    ofcomReportedUpdateIso: key,
    files: {
      'raw.csv': { size: Buffer.byteLength(rawContent), sha256: sha256(rawContent), format: 'csv' },
    },
    ...metaOverrides,
  };
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');
}

function readMeta(root: string, key: string): any {
  return JSON.parse(fs.readFileSync(path.join(root, CONSTANTS.DIRS.archive, key, 'meta.json'), 'utf8'));
}

let tmpRoot: string;
let originalCwd: string;

beforeEach(() => {
  originalCwd = process.cwd();
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'callsigns-norm-sweep-'));
  process.chdir(tmpRoot);
});

afterEach(() => {
  process.chdir(originalCwd);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('runNormaliseSweep', () => {
  it('Sweep_WhenEntryHasNoNormalisedFile_CreatesItAndDeclaresInMeta', () => {
    writeEntry(tmpRoot, '2026-01-01', SALESFORCE_RAW);
    const report = runNormaliseSweep();

    expect(report.changed).toEqual(['2026-01-01']);
    expect(report.failed).toEqual([]);
    const normalised = fs.readFileSync(path.join(tmpRoot, 'archive', '2026-01-01', 'normalised.csv'), 'utf8');
    expect(normalised.startsWith('callsign,product,status,type,')).toBe(true);
    const meta = readMeta(tmpRoot, '2026-01-01');
    expect(meta.normalised).toEqual({ schemaVersion: 1, headerVariant: 'v2025-salesforce' });
    expect(meta.files['normalised.csv'].sha256).toBe(sha256(normalised));
    expect(meta.files['normalised.csv'].recordCount).toBe(2);
  });

  it('Sweep_WhenOutputAlreadyCurrent_MakesNoChanges', () => {
    writeEntry(tmpRoot, '2026-01-01', SALESFORCE_RAW);
    runNormaliseSweep();
    const metaBefore = fs.readFileSync(path.join(tmpRoot, 'archive', '2026-01-01', 'meta.json'), 'utf8');

    const second = runNormaliseSweep();

    expect(second.changed).toEqual([]);
    expect(second.upToDate).toEqual(['2026-01-01']);
    // Meta is byte-identical too - re-runs must be true no-ops or the
    // golden-master property (no diff => no PR) breaks.
    expect(fs.readFileSync(path.join(tmpRoot, 'archive', '2026-01-01', 'meta.json'), 'utf8')).toBe(metaBefore);
  });

  it('Sweep_WhenOneEntryFails_OthersStillNormalise', () => {
    writeEntry(tmpRoot, '2026-01-01', SALESFORCE_RAW);
    writeEntry(tmpRoot, '2026-02-02', 'Unknown,Columns\nx,y\n');
    const report = runNormaliseSweep();

    expect(report.changed).toEqual(['2026-01-01']);
    expect(report.failed).toHaveLength(1);
    expect(report.failed[0].key).toBe('2026-02-02');
    expect(report.failed[0].reason).toMatch(/unknown raw header/i);
  });

  it('Sweep_WhenSourceHasNoConverter_ReportsEntryAsUnsupported', () => {
    writeEntry(tmpRoot, '2026-03-03', SALESFORCE_RAW, { sourceKey: 'some-future-source' });
    const report = runNormaliseSweep();

    expect(report.unsupported).toEqual(['2026-03-03']);
    expect(report.changed).toEqual([]);
    expect(fs.existsSync(path.join(tmpRoot, 'archive', '2026-03-03', 'normalised.csv'))).toBe(false);
  });

  it('Sweep_WhenConverterOutputChanges_RewritesFileAndMeta', () => {
    // Simulates a converter/schema evolution: an existing normalised.csv
    // whose bytes no longer match what the current converter produces.
    writeEntry(tmpRoot, '2026-01-01', SALESFORCE_RAW);
    runNormaliseSweep();
    const file = path.join(tmpRoot, 'archive', '2026-01-01', 'normalised.csv');
    fs.writeFileSync(file, 'stale,output\n');
    // Meta must also be stale-consistent for the scenario: sweep compares
    // bytes, not meta, so no meta edit needed here.

    const report = runNormaliseSweep();

    expect(report.changed).toEqual(['2026-01-01']);
    const normalised = fs.readFileSync(file, 'utf8');
    expect(normalised.startsWith('callsign,')).toBe(true);
    expect(readMeta(tmpRoot, '2026-01-01').files['normalised.csv'].sha256).toBe(sha256(normalised));
  });

  it('Sweep_ReportIncludesCoverageSummaryForRollingIssue', () => {
    writeEntry(tmpRoot, '2026-01-01', SALESFORCE_RAW);
    writeEntry(tmpRoot, '2026-02-02', 'Unknown,Columns\nx,y\n');
    writeEntry(tmpRoot, '2026-03-03', SALESFORCE_RAW, { sourceKey: 'some-future-source' });

    const report = runNormaliseSweep();
    const summary = report.coverageMarkdown;

    expect(summary).toContain('2026-01-01');
    expect(summary).toContain('2026-02-02');
    expect(summary).toContain('2026-03-03');
    expect(summary).toMatch(/v1|schemaVersion/i);
    expect(summary).toMatch(/unknown raw header/i);
    expect(summary).toMatch(/no converter/i);
  });

  it('Sweep_WhenEntryDeclaredPartialCoverage_FlaggedInSummary', () => {
    // A truncated/scoped raw record still normalises, but the dashboard must
    // mark it so nobody reads its row count as the full population.
    writeEntry(tmpRoot, '2026-01-01', SALESFORCE_RAW, {
      intendedCoverage: { complete: false, scopeNotes: 'truncated publication' },
    });
    const report = runNormaliseSweep();
    expect(report.changed).toEqual(['2026-01-01']);
    expect(report.coverageMarkdown).toContain('PARTIAL raw coverage');
  });
});
