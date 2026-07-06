#!/usr/bin/env node

/**
 * Normalise sweep (ADR 0001's final piece): walk every archive entry,
 * dispatch to the entry's source converter by meta.sourceKey, and close the
 * gap between the converter's intended schema version and what each entry
 * has achieved.
 *
 * Properties:
 *  - per-entry independence: one failing entry never blocks the rest, and a
 *    source with no converter yet is reported, not an error;
 *  - true no-ops: byte-identical output touches neither normalised.csv nor
 *    meta.json, so "no diff => no PR" holds for scheduled re-runs;
 *  - honest coverage reporting: the returned markdown table (rendered into
 *    the rolling coverage issue and PR bodies) shows intended-vs-achieved
 *    per entry, including failures and unsupported sources.
 *
 * The workflow wrapper commits whatever changed to a branch and opens a PR;
 * normaliser PRs are always human-reviewed (the cross-entry diff IS the
 * review artefact), never auto-merged.
 */

import * as fs from 'fs';
import * as path from 'path';
import { CONSTANTS, ArchiveMeta, calculateFileHash } from '../shared/utils';
import { listArchiveKeys } from '../shared/archive';
import { convertRawCsv, NORMALISED_SCHEMA_VERSION, ConvertResult } from '../sources/ofcom-amateur/normalise';

interface SourceConverter {
  schemaVersion: number;
  convert(rawContent: string, referenceDateIso: string): ConvertResult;
}

// Converter registry, keyed by meta.sourceKey. Future sources (FOI xlsx via
// the holding pen, etc.) register here.
const CONVERTERS: Record<string, SourceConverter> = {
  [CONSTANTS.SOURCES.OFCOM_AMATEUR]: {
    schemaVersion: NORMALISED_SCHEMA_VERSION,
    convert: (rawContent, referenceDateIso) => convertRawCsv(rawContent, { referenceDateIso }),
  },
};

// Sanitise arbitrary text (error messages can quote raw CSV content) for use
// inside a one-line markdown table cell: escape backslashes FIRST, then
// pipes, then collapse newlines - order matters, or the pipe-escaping can
// itself be neutralised by a preceding backslash.
function mdCell(text: string, maxLength = 160): string {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ')
    .slice(0, maxLength);
}

export interface SweepReport {
  changed: string[];
  upToDate: string[];
  unsupported: string[];
  failed: { key: string; reason: string }[];
  coverageMarkdown: string;
}

export function runNormaliseSweep(): SweepReport {
  const report: SweepReport = { changed: [], upToDate: [], unsupported: [], failed: [], coverageMarkdown: '' };
  const coverageRows: string[] = [];

  for (const key of listArchiveKeys()) {
    const dir = path.join(CONSTANTS.DIRS.archive, key);
    const metaPath = path.join(dir, 'meta.json');
    let meta: ArchiveMeta & { normalised?: { schemaVersion: number; headerVariant: string } };
    try {
      meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    } catch (err: any) {
      report.failed.push({ key, reason: `meta.json unreadable: ${err.message}` });
      coverageRows.push(`| ${key} | ? | FAILED | meta.json unreadable |`);
      continue;
    }

    const converter = CONVERTERS[meta.sourceKey];
    if (!converter) {
      report.unsupported.push(key);
      coverageRows.push(`| ${key} | ${meta.sourceKey} | raw-only | no converter for this source yet |`);
      continue;
    }

    const referenceDateIso = meta.ofcomReportedUpdateIso ?? meta.fetchedAt.slice(0, 10);
    let result: ConvertResult;
    try {
      const raw = fs.readFileSync(path.join(dir, 'raw.csv'), 'utf8');
      result = converter.convert(raw, referenceDateIso);
    } catch (err: any) {
      report.failed.push({ key, reason: err.message });
      coverageRows.push(`| ${key} | ${meta.sourceKey} | FAILED | ${mdCell(err.message)} |`);
      continue;
    }

    const outPath = path.join(dir, 'normalised.csv');
    const existing = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8') : undefined;
    if (existing === result.csv && meta.normalised?.schemaVersion === result.schemaVersion) {
      report.upToDate.push(key);
      coverageRows.push(`| ${key} | ${meta.sourceKey} | v${result.schemaVersion} (${result.headerVariant}) | up to date |`);
      continue;
    }

    fs.writeFileSync(outPath, result.csv);
    meta.normalised = { schemaVersion: result.schemaVersion, headerVariant: result.headerVariant };
    meta.files['normalised.csv'] = {
      size: Buffer.byteLength(result.csv),
      sha256: calculateFileHash(outPath),
      format: 'csv',
      recordCount: result.recordCount,
      sortedBy: 'callsign',
    };
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n');
    report.changed.push(key);
    const dateNote = result.unverifiedDateColumns.length === 0
      ? 'all date columns day-first-verified'
      : `UNVERIFIED date-order columns: ${result.unverifiedDateColumns.join(', ')}`;
    const partialNote = meta.intendedCoverage?.complete === false ? '; PARTIAL raw coverage (see meta scopeNotes)' : '';
    coverageRows.push(`| ${key} | ${meta.sourceKey} | v${result.schemaVersion} (${result.headerVariant}) | updated this run; ${dateNote}${partialNote} |`);
  }

  report.coverageMarkdown = [
    `Intended schema version per source: ${Object.entries(CONVERTERS).map(([k, c]) => `\`${k}\` → v${c.schemaVersion}`).join(', ')}`,
    '',
    '| entry | source | achieved | note |',
    '|---|---|---|---|',
    ...coverageRows,
  ].join('\n');

  return report;
}

function main(): void {
  const report = runNormaliseSweep();
  console.log(report.coverageMarkdown);
  console.log('');
  console.log(`changed=${report.changed.length} upToDate=${report.upToDate.length} unsupported=${report.unsupported.length} failed=${report.failed.length}`);
  for (const f of report.failed) {
    console.error(`FAILED ${f.key}: ${f.reason}`);
  }
  // Emit the summary for the workflow to consume (rolling issue + PR body).
  if (process.env.GITHUB_OUTPUT) {
    const changed = report.changed.join(' ');
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed}\nfailedCount=${report.failed.length}\n`);
  }
  if (process.env.COVERAGE_MARKDOWN_FILE) {
    fs.writeFileSync(process.env.COVERAGE_MARKDOWN_FILE, report.coverageMarkdown + '\n');
  }
  if (report.failed.length > 0) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}
