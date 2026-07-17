#!/usr/bin/env node

/**
 * Generates docs/dataset-status.md (issue #149): the per-dataset overview of
 * what the archive holds and how far each entry's derivation chain goes -
 * raw bytes, extracts, converter, normalised outputs - for both lanes.
 *
 * The committed file is a DERIVED, byte-deterministic document: every PR
 * that changes archive content regenerates it (`npm run dataset:status`)
 * and the test suite fails if it is stale, so it stays honest the same way
 * normalised files do. Facts come from meta.json declarations only - the
 * generator asserts nothing the metas do not.
 *
 * Division of labour: this file documents WHAT exists; the #360 dashboard
 * (the report sweep) and the per-PR verification suites report whether the
 * derivations VERIFY; and
 * docs/source-register.md tracks intake that has not reached the archive
 * yet.
 *
 * Usage: node src/ci/dataset-status.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { listArchiveKeys } from '../shared/archive.ts';
import { CONSTANTS } from '../shared/utils.ts';
import { listFoiEntryKeys, readFoiEntryMeta } from '../shared/foi-archive.ts';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const FOI_ARCHIVE_DIR = path.join(REPO_ROOT, 'archive', 'foi');
export const STATUS_FILE = path.join(REPO_ROOT, 'docs', 'dataset-status.md');

const tick = (present: boolean): string => (present ? '✔' : '—');
const count = (n: number, symbol = '✔'): string => (n === 0 ? '—' : `${symbol} ${n}`);

function openDataRows(): string[] {
  return listArchiveKeys().sort().map(key => {
    const dir = path.join(CONSTANTS.DIRS.archive, key);
    const has = (name: string): boolean => fs.existsSync(path.join(dir, name));
    return `| ${key} | ${tick(has('raw.csv'))} | ${tick(has('meta.json'))} | ${tick(has('normalised.csv'))} | ${tick(has('components.csv'))} |`;
  });
}

function foiRows(): string[] {
  return listFoiEntryKeys(FOI_ARCHIVE_DIR)
    .map(key => {
      const meta = readFoiEntryMeta(FOI_ARCHIVE_DIR, key);
      const files = Object.values(meta.files ?? {});
      const data = files.filter(f => f.role === 'data' || f.role === 'data-container').length;
      const mechanical = files.filter(f => f.role === 'extract' && f.extractedBy !== undefined).length;
      const transcribed = files.filter(f => f.role === 'extract' && f.extractedBy === undefined).length;
      const normalised = files.filter(f => f.role === 'normalised').length;
      const converter = meta.converter?.variant;
      const extracts = [mechanical > 0 ? `${mechanical} mech` : '', transcribed > 0 ? `${transcribed} transcr` : '']
        .filter(Boolean).join(' + ') || '—';
      return `| ${key} | ${meta.outcome ?? '?'} | ${(meta.datasetClasses ?? []).join(', ')} | ${meta.dataVintage ?? '—'} | ${count(data)} | ${extracts} | ${converter === undefined ? '—' : `\`${converter}\``} | ${count(normalised)} |`;
    });
}

export function renderDatasetStatus(): string {
  const openData = openDataRows();
  const foi = foiRows();
  return [
    '# Archive dataset status',
    '',
    '**Generated file - do not edit by hand.** Regenerate with `npm run dataset:status`;',
    'the test suite fails when this file is stale, so any PR changing archive content',
    'must include the regenerated table (changelog discipline, enforced).',
    '',
    'This documents **what exists**. Whether each derivation still *verifies* is the',
    '[normalisation coverage dashboard](https://github.com/MysterAitch/amateur-callsigns-file-watch/issues/360)',
    "(daily sweeps); intake that has not reached the archive yet is tracked in",
    '[`source-register.md`](source-register.md).',
    '',
    `## Open-data lane (${openData.length} entries)`,
    '',
    '| entry | raw | meta | normalised | components |',
    '|---|---|---|---|---|',
    ...openData,
    '',
    `## FOI lane (${foi.length} entries)`,
    '',
    'Extracts: `mech` = mechanically re-derivable (xlsx, via `src/shared/xlsx-extract.ts`);',
    '`transcr` = attested transcription of a PDF (see the entry\'s raw-extract file).',
    'Entries with no data files are record-only responses (not-held, referrals, or',
    'datasets attested but not yet recovered - see each entry\'s meta and correspondence).',
    '',
    '| entry | outcome | dataset classes | vintage | data files | extracts | converter | normalised |',
    '|---|---|---|---|---|---|---|---|',
    ...foi,
    '',
  ].join('\n');
}

function main(): void {
  fs.writeFileSync(STATUS_FILE, renderDatasetStatus());
  console.log(`wrote ${path.relative(REPO_ROOT, STATUS_FILE)}`);
}

if (import.meta.main) {
  main();
}
