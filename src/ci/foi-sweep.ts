#!/usr/bin/env node

/**
 * FOI-lane derivation sweep (issue #149, item 1): the daily companion to the
 * report sweep, covering `archive/foi/`.
 *
 * For every FOI entry this re-executes the full derivation chain from the
 * committed bytes and verifies it reproduces the committed derivatives
 * byte-for-byte:
 *
 *   - workbook extracts (declared `extractedBy: src/shared/xlsx-extract.ts`)
 *     are re-derived from their `extractOf` workbook;
 *   - normalised files are re-derived by the entry's authored converter
 *     binding ({script, variant} in meta.json).
 *
 * Unlike the open-data sweep this is REPORT-AND-VERIFY ONLY - no writeback,
 * no PR. In the FOI lane a converter change must regenerate its outputs in
 * the same reviewed PR (the golden-master tests enforce byte-equality on
 * every CI run), so daily drift can only mean environment divergence or
 * archive corruption: either way the run turns red and the coverage
 * dashboard names the entry. Entries that legitimately have nothing to
 * derive are reported honestly rather than omitted: `record-only` (no
 * dataset - not-held/referral responses), `raw-only` (dataset present, no
 * converter yet), and transcription-backed extracts (attested, not
 * mechanically re-derivable).
 *
 * Emits a coverage-markdown section for the workflow to concatenate with the
 * open-data report (COVERAGE_MARKDOWN_FILE, same convention), and exits
 * non-zero if any entry fails or drifts.
 *
 * Usage: node src/ci/foi-sweep.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { convertFoiEntry } from '../shared/foi-normalise.ts';
import { extractWorkbook, toCsvBytes, extractFileNameFor } from '../shared/xlsx-extract.ts';
import { errorMessage } from '../shared/utils.ts';
import { type FoiFileDeclaration, readFoiEntryMeta } from '../shared/foi-archive.ts';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
export const FOI_ARCHIVE_DIR = path.join(REPO_ROOT, 'archive', 'foi');

const XLSX_EXTRACTOR = 'src/shared/xlsx-extract.ts';

export interface FoiEntryReport {
  entryKey: string;
  classes: string[];
  // 'verified' | 'record-only' | 'raw-only' | 'drift' | 'failed'
  state: string;
  note: string;
}

export interface FoiSweepReport {
  entries: FoiEntryReport[];
  failed: FoiEntryReport[];
  coverageMarkdown: string;
}

// Re-derives every mechanically-extracted file in the entry and returns the
// list of drifted file names (committed bytes differ from re-derivation).
function verifyExtracts(entryDir: string, files: Record<string, FoiFileDeclaration>): { drifted: string[]; verified: number } {
  const mechanical = Object.entries(files)
    .filter(([, decl]) => decl.role === 'extract' && decl.extractedBy === XLSX_EXTRACTOR);
  const byWorkbook = new Map<string, Set<string>>();
  for (const [name, decl] of mechanical) {
    if (decl.extractOf === undefined) throw new Error(`${name}: mechanical extract with no extractOf`);
    let names = byWorkbook.get(decl.extractOf);
    if (names === undefined) byWorkbook.set(decl.extractOf, names = new Set());
    names.add(name);
  }

  const drifted: string[] = [];
  let verified = 0;
  for (const [workbook, declaredNames] of byWorkbook) {
    const produced = new Set<string>();
    for (const sheet of extractWorkbook(fs.readFileSync(path.join(entryDir, workbook)))) {
      if (sheet.rows === null) continue;
      const name = extractFileNameFor(sheet);
      produced.add(name);
      if (!declaredNames.has(name)) {
        drifted.push(`${name} (extracted but not declared in meta)`);
        continue;
      }
      const committed = fs.readFileSync(path.join(entryDir, name));
      if (toCsvBytes(sheet.rows).equals(committed)) verified += 1;
      else drifted.push(name);
    }
    for (const name of declaredNames) {
      if (!produced.has(name)) drifted.push(`${name} (declared but no longer extractable)`);
    }
  }
  return { drifted, verified };
}

// Re-runs the entry's authored converter and returns drifted output names.
function verifyConversions(entryDir: string, variant: string, files: Record<string, FoiFileDeclaration>): { drifted: string[]; verified: number } {
  const drifted: string[] = [];
  let verified = 0;
  const produced = new Set<string>();
  for (const result of convertFoiEntry(entryDir, variant)) {
    produced.add(result.outputFileName);
    if (files[result.outputFileName] === undefined) {
      drifted.push(`${result.outputFileName} (derived but not declared in meta)`);
      continue;
    }
    const committed = fs.readFileSync(path.join(entryDir, result.outputFileName), 'utf8');
    if (result.csv === committed) verified += 1;
    else drifted.push(result.outputFileName);
  }
  for (const [name, decl] of Object.entries(files)) {
    if (decl.role === 'normalised' && !produced.has(name)) {
      drifted.push(`${name} (declared normalised but not produced by the converter)`);
    }
  }
  return { drifted, verified };
}

function sweepEntry(archiveDir: string, entryKey: string): FoiEntryReport {
  const entryDir = path.join(archiveDir, entryKey);
  const meta = readFoiEntryMeta(archiveDir, entryKey);
  const classes = meta.datasetClasses ?? [];
  const files = meta.files ?? {};

  try {
    const extracts = verifyExtracts(entryDir, files);
    const transcriptions = Object.values(files)
      .filter(decl => decl.role === 'extract' && decl.extractedBy === undefined).length;
    const notes: string[] = [];
    if (extracts.verified > 0) notes.push(`${extracts.verified} extract(s) re-derived byte-identical`);
    if (transcriptions > 0) notes.push(`${transcriptions} transcription extract(s) (attested, not re-derivable)`);

    const variant = meta.converter?.variant;
    if (typeof variant === 'string') {
      const conversions = verifyConversions(entryDir, variant, files);
      const drifted = [...extracts.drifted, ...conversions.drifted];
      if (drifted.length > 0) {
        return { entryKey, classes, state: 'drift', note: `DRIFT: ${drifted.join('; ')}` };
      }
      notes.unshift(`${conversions.verified} normalised file(s) re-derived byte-identical (variant ${variant})`);
      return { entryKey, classes, state: 'verified', note: notes.join('; ') };
    }

    if (extracts.drifted.length > 0) {
      return { entryKey, classes, state: 'drift', note: `DRIFT: ${extracts.drifted.join('; ')}` };
    }
    const hasDataFiles = Object.values(files).some(decl => decl.role === 'data' || decl.role === 'data-container');
    if (!hasDataFiles) {
      const flavour = meta.outcome === 'not held' ? 'not held' : 'no dataset bytes recovered';
      return { entryKey, classes, state: 'record-only', note: [flavour, ...notes].join('; ') };
    }
    return { entryKey, classes, state: 'raw-only', note: ['dataset present, no converter authored', ...notes].join('; ') };
  } catch (err) {
    return { entryKey, classes, state: 'failed', note: errorMessage(err) };
  }
}

// Parameterised for tests (tamper checks run against a scratch archive);
// production use is always the repo's archive/foi.
export function sweepFoiLaneAt(archiveDir: string): FoiSweepReport {
  const entryKeys = fs.readdirSync(archiveDir)
    .filter(name => fs.statSync(path.join(archiveDir, name)).isDirectory())
    .sort();
  if (entryKeys.length === 0) throw new Error('no FOI archive entries found');

  const entries = entryKeys.map(entryKey => sweepEntry(archiveDir, entryKey));
  const failed = entries.filter(e => e.state === 'failed' || e.state === 'drift');

  const stateCounts = new Map<string, number>();
  for (const entry of entries) {
    stateCounts.set(entry.state, (stateCounts.get(entry.state) ?? 0) + 1);
  }
  const summary = [...stateCounts.entries()].map(([state, count]) => `${count} ${state}`).join(', ');

  const lines = [
    `## FOI lane (${entries.length} entries: ${summary})`,
    '',
    'Every derivation re-executed from committed bytes and byte-compared against the committed derivatives (report-and-verify; converter changes ship their regenerated outputs in reviewed PRs, so drift here means environment divergence or corruption).',
    '',
    '| entry | classes | state | note |',
    '|---|---|---|---|',
    ...entries.map(e => `| ${e.entryKey} | ${e.classes.join(', ')} | ${e.state} | ${e.note} |`),
  ];

  return { entries, failed, coverageMarkdown: lines.join('\n') };
}

export function sweepFoiLane(): FoiSweepReport {
  return sweepFoiLaneAt(FOI_ARCHIVE_DIR);
}

function main(): void {
  const report = sweepFoiLane();
  console.log(report.coverageMarkdown);
  if (process.env.COVERAGE_MARKDOWN_FILE) {
    fs.writeFileSync(process.env.COVERAGE_MARKDOWN_FILE, report.coverageMarkdown + '\n');
  }
  if (report.failed.length > 0) {
    console.error(`\n${report.failed.length} entry/entries failed or drifted:`);
    for (const entry of report.failed) console.error(`  ${entry.entryKey}: ${entry.note}`);
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  main();
}
