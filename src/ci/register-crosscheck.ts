#!/usr/bin/env node

/**
 * Source-register staleness check (issue #149 Phase A): flags
 * docs/source-register.md rows still marked `pending-ingest`/`pending-fetch`
 * whose dataset already exists as an FOI archive entry - the register is
 * hand-maintained and drifts as entries land.
 *
 * Matching is deliberately conservative (heuristic tooling, not a gate):
 * a pending row is flagged when its FIRST table cell mentions an ingested
 * entry's identifier (the `wdtk-{id}` / `ofcom-{ref}` key segment), or when
 * the row anywhere names one of an ingested entry's declared data files.
 * Prose mentions of an id in later cells ("9 days before the 356636
 * response") deliberately do not match - context is not ingestion.
 *
 * Output drives register-tidying commits; run via
 * `node src/ci/register-crosscheck.ts` (exit code 1 when stale rows exist,
 * so it can double as a local pre-tidy check - it is NOT wired into CI).
 */

import * as fs from 'fs';
import * as path from 'path';
import { listFoiEntryKeys, readFoiEntryMeta } from '../shared/foi-archive.ts';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const FOI_ARCHIVE_DIR = path.join(REPO_ROOT, 'archive', 'foi');
export const REGISTER_FILE = path.join(REPO_ROOT, 'docs', 'source-register.md');

export interface StaleRegisterRow {
  line: number;
  firstCell: string;
  matchedEntry: string;
  matchedBy: 'identifier' | 'data-file';
}

interface IngestedEntry {
  key: string;
  // The key segment between the lane prefix and the slug: '356636',
  // '2017-07-03', 'Callsign-database-20-Sep', ...
  identifier: string;
  dataFileNames: string[];
}

function ingestedEntries(foiDir: string): IngestedEntry[] {
  return listFoiEntryKeys(foiDir).map(key => {
    const identifier = /^(?:wdtk|ofcom)-(.+?)--/.exec(key)?.[1] ?? key;
    const meta = readFoiEntryMeta(foiDir, key);
    const dataFileNames = Object.entries(meta.files)
      .filter(([, decl]) => decl.role === 'data' || decl.role === 'data-container')
      .map(([name]) => name);
    return { key, identifier, dataFileNames };
  });
}

export function findStaleRegisterRows(registerMarkdown: string, foiDir: string = FOI_ARCHIVE_DIR): StaleRegisterRow[] {
  const entries = ingestedEntries(foiDir);
  const stale: StaleRegisterRow[] = [];
  const lines = registerMarkdown.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith('|') || !/pending-(ingest|fetch)/.test(line)) continue;
    const firstCell = line.split('|')[1]?.trim() ?? '';
    // Identifier-in-first-cell is the strong signal and wins outright;
    // a data-file name anywhere in the row is a weaker fallback candidate
    // (rows often cite ingested entries' files as related material).
    const byIdentifier = entries.find(entry => firstCell.includes(entry.identifier));
    if (byIdentifier !== undefined) {
      stale.push({ line: i + 1, firstCell, matchedEntry: byIdentifier.key, matchedBy: 'identifier' });
      continue;
    }
    const byDataFile = entries.find(entry => entry.dataFileNames.some(name => line.includes(name)));
    if (byDataFile !== undefined) {
      stale.push({ line: i + 1, firstCell, matchedEntry: byDataFile.key, matchedBy: 'data-file' });
    }
  }
  return stale;
}

function main(): void {
  const stale = findStaleRegisterRows(fs.readFileSync(REGISTER_FILE, 'utf8'));
  if (stale.length === 0) {
    console.log('source-register.md: no pending rows reference ingested entries.');
    return;
  }
  console.log(`source-register.md: ${stale.length} pending row(s) reference ingested entries - flip to ingested with a pointer:`);
  for (const row of stale) {
    console.log(`  line ${row.line}: "${row.firstCell}" -> archive/foi/${row.matchedEntry} (matched by ${row.matchedBy})`);
  }
  process.exitCode = 1;
}

if (import.meta.main) {
  main();
}
