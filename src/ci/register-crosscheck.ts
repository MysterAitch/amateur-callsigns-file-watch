#!/usr/bin/env node

/**
 * Source-register staleness check (issue #149 Phase A; hardened #673): flags
 * docs/source-register.md rows still marked `pending-ingest`/`pending-fetch`
 * whose dataset already exists as an FOI archive entry - the register is
 * hand-maintained and drifts as entries land.
 *
 * Matching is deliberately conservative (heuristic tooling, not a gate):
 * a pending row is flagged when its FIRST table cell mentions an ingested
 * entry's identifier (the `wdtk-{id}` / `ofcom-{ref}` key segment) or its
 * `ofcomReference`, or when the row anywhere names one of an ingested
 * entry's declared data files. Prose mentions of an id in later cells ("9
 * days before the 356636 response") deliberately do not match - context is
 * not ingestion. A row keyed only by a human-readable title plus an Ofcom
 * FOI reference (no `wdtk-{id}`/`ofcom-{ref}`-shaped identifier anywhere in
 * it) escaped every axis before the `ofcomReference` addition - issue #673,
 * the club-callsigns row that stayed `pending-ingest` unflagged through the
 * disclosure's actual ingestion (#668).
 *
 * A second, complementary check (also #673) runs over the FOI-titled
 * sections of the register: a row claiming the `ingested` status is expected
 * to match one of the same entries by one of the same axes (checked across
 * the whole row this time, since a confirmed-ingested row's own notes
 * conventionally cite its `archive/foi/{key}` pointer directly) - a row that
 * claims `ingested` but matches nothing is exactly as loud a signal as a
 * `pending` row that matches something: both mean the register's claimed
 * status disagrees with the archive.
 *
 * Output drives register-tidying commits; run via
 * `node src/ci/register-crosscheck.ts` (exit code 1 when stale or unmatched
 * rows exist, so it can double as a local pre-tidy check - it is NOT wired
 * into CI).
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
  matchedBy: 'identifier' | 'data-file' | 'ofcom-reference';
}

// A row claiming the `ingested` status inside an FOI-titled section that
// matches no known entry by any axis - the register asserts an ingestion the
// archive cannot corroborate (issue #673).
export interface UnmatchedIngestedRow {
  line: number;
  firstCell: string;
}

interface IngestedEntry {
  key: string;
  // The key segment between the lane prefix and the slug: '356636',
  // '2017-07-03', 'Callsign-database-20-Sep', ...
  identifier: string;
  // meta.ofcomReference, split on '/' - some entries cite several Ofcom case
  // references in one string (e.g. "1-273972981 / 1-274238044 / ...").
  ofcomReferences: string[];
  dataFileNames: string[];
}

function ingestedEntries(foiDir: string): IngestedEntry[] {
  return listFoiEntryKeys(foiDir).map(key => {
    const identifier = /^(?:wdtk|ofcom)-(.+?)--/.exec(key)?.[1] ?? key;
    const meta = readFoiEntryMeta(foiDir, key);
    const dataFileNames = Object.entries(meta.files)
      .filter(([, decl]) => decl.role === 'data' || decl.role === 'data-container')
      .map(([name]) => name);
    const ofcomReferences = typeof meta.ofcomReference === 'string'
      ? meta.ofcomReference.split('/').map(part => part.trim()).filter(part => part !== '')
      : [];
    return { key, identifier, ofcomReferences, dataFileNames };
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
    // Identifier-or-ofcomReference-in-first-cell is the strong signal and
    // wins outright; a data-file name anywhere in the row is a weaker
    // fallback candidate (rows often cite ingested entries' files as related
    // material).
    const byIdentifier = entries.find(entry => firstCell.includes(entry.identifier));
    if (byIdentifier !== undefined) {
      stale.push({ line: i + 1, firstCell, matchedEntry: byIdentifier.key, matchedBy: 'identifier' });
      continue;
    }
    const byOfcomReference = entries.find(entry => entry.ofcomReferences.some(ref => firstCell.includes(ref)));
    if (byOfcomReference !== undefined) {
      stale.push({ line: i + 1, firstCell, matchedEntry: byOfcomReference.key, matchedBy: 'ofcom-reference' });
      continue;
    }
    const byDataFile = entries.find(entry => entry.dataFileNames.some(name => line.includes(name)));
    if (byDataFile !== undefined) {
      stale.push({ line: i + 1, firstCell, matchedEntry: byDataFile.key, matchedBy: 'data-file' });
    }
  }
  return stale;
}

// The register sections whose rows are expected to correspond 1:1 with
// `archive/foi/{key}` entries - the sections this tool's matching axes
// (identifier, ofcomReference, data-file, all drawn from the FOI archive)
// can actually speak to. The open-data-lane table, the context-documents
// table and the reference/documentation table use the same status
// vocabulary (including the bare word `ingested`) for entries this tool has
// no way to corroborate, so they are deliberately out of scope for the
// unmatched-row check below - only heading text is used to decide scope, no
// column-position assumption.
const FOI_SECTION_HEADING = /^##\s+.*FOI.*$/i;

// A row's status cell, for the small family of 4-column FOI-section tables
// (`| source | date | status | notes |` / `| source | data vintage | status
// | notes |`) this check runs over.
function statusCell(line: string): string {
  return line.split('|')[3]?.trim() ?? '';
}

export function findUnmatchedIngestedRows(registerMarkdown: string, foiDir: string = FOI_ARCHIVE_DIR): UnmatchedIngestedRow[] {
  const entries = ingestedEntries(foiDir);
  const unmatched: UnmatchedIngestedRow[] = [];
  const lines = registerMarkdown.split('\n');
  let inFoiSection = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^##\s+/.test(line)) {
      inFoiSection = FOI_SECTION_HEADING.test(line);
      continue;
    }
    if (!inFoiSection || !line.startsWith('|')) continue;
    if (statusCell(line) !== 'ingested') continue;
    const firstCell = line.split('|')[1]?.trim() ?? '';
    if (firstCell === '' || firstCell === 'source') continue; // header row
    // Deliberately checked across the WHOLE row, not just the first cell: a
    // confirmed-ingested row conventionally cites its own `archive/foi/{key}`
    // pointer in the notes column, and this check's job is to confirm that
    // citation is real, not to hunt for it under the first-cell-only
    // discipline the stale-pending check above uses to avoid false positives.
    const matches = entries.some(entry =>
      line.includes(entry.identifier) ||
      entry.ofcomReferences.some(ref => line.includes(ref)) ||
      entry.dataFileNames.some(name => line.includes(name)),
    );
    if (!matches) {
      unmatched.push({ line: i + 1, firstCell });
    }
  }
  return unmatched;
}

function main(): void {
  const registerMarkdown = fs.readFileSync(REGISTER_FILE, 'utf8');
  const stale = findStaleRegisterRows(registerMarkdown);
  const unmatched = findUnmatchedIngestedRows(registerMarkdown);

  if (stale.length === 0) {
    console.log('source-register.md: no pending rows reference ingested entries.');
  } else {
    console.log(`source-register.md: ${stale.length} pending row(s) reference ingested entries - flip to ingested with a pointer:`);
    for (const row of stale) {
      console.log(`  line ${row.line}: "${row.firstCell}" -> archive/foi/${row.matchedEntry} (matched by ${row.matchedBy})`);
    }
  }

  if (unmatched.length === 0) {
    console.log('source-register.md: every ingested row in an FOI section matches a known archive entry.');
  } else {
    console.log(`source-register.md: ${unmatched.length} row(s) claim ingested but match no archive entry by any axis:`);
    for (const row of unmatched) {
      console.log(`  line ${row.line}: "${row.firstCell}"`);
    }
  }

  if (stale.length > 0 || unmatched.length > 0) {
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  main();
}
