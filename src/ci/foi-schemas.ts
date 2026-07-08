#!/usr/bin/env node

/**
 * Generates docs/foi-schemas.md (issue #149 Phase A): the published FOI
 * schema registry - dataset-class glossary, row-schema families, the
 * registered extension-column vocabulary, and the full per-variant
 * conversion detail, all rendered from the same authored values the
 * validator and the governance test enforce (FOI_DATASET_CLASSES in
 * foi-archive.ts; FOI_ROW_SCHEMA_FAMILIES / FOI_EXTENSION_COLUMNS /
 * FOI_ENTRY_CONVERSIONS in foi-normalise.ts), so the documentation and the
 * accepted vocabulary cannot diverge.
 *
 * The committed file is a DERIVED, byte-deterministic document: regenerate
 * with `npm run foi:schemas`; the test suite fails when it is stale.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  FOI_ENTRY_CONVERSIONS,
  FOI_ROW_SCHEMA_FAMILIES,
  FOI_EXTENSION_COLUMNS,
  type FoiColumnSpec,
  type FoiSourceConversion,
} from '../shared/foi-normalise.ts';
import { FOI_DATASET_CLASSES, listFoiEntryKeys, readFoiEntryMeta } from '../shared/foi-archive.ts';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const FOI_ARCHIVE_DIR = path.join(REPO_ROOT, 'archive', 'foi');
export const SCHEMAS_FILE = path.join(REPO_ROOT, 'docs', 'foi-schemas.md');

function columnSourceLabel(column: FoiColumnSpec): string {
  // An empty-string source rendered as `` `` `` showed two literal
  // backticks on the published page - treat it like no source.
  if (column.source !== null && column.source !== '') {
    return column.kind === 'prefixed' ? `\`${column.source}\` (prefix \`${column.prefix ?? ''}\`)` : `\`${column.source}\``;
  }
  return column.constant === undefined ? '*(emitted empty)*' : `constant \`${column.constant}\``;
}

function conversionSection(conversion: FoiSourceConversion): string[] {
  const lines = [
    `**\`${conversion.sourceFile}\`** (${conversion.format ?? 'csv'}, ${conversion.encoding}${conversion.dataFile === undefined ? '' : `, transcribes \`${conversion.dataFile}\``}${conversion.preamble === undefined ? '' : `, ${conversion.preamble.length} verbatim-matched preamble row(s)`})`,
    '',
    '| output column | source | kind |',
    '|---|---|---|',
    ...conversion.columns.map(column =>
      `| \`${column.output}\` | ${columnSourceLabel(column)} | ${column.kind}${column.futureAllowed === true ? ' (future allowed)' : ''} |`),
    '',
  ];
  if (conversion.ignoredColumns.length > 0) {
    lines.push(`Required-present but not carried: ${conversion.ignoredColumns.map(c => `\`${c}\``).join(', ')}.`, '');
  }
  lines.push(`Row order: **${conversion.rowOrder}** — ${conversion.orderRationale}.`);
  if (conversion.referenceDateIso !== undefined) {
    lines.push('', `Date plausibility bound: ${conversion.referenceDateIso}.`);
  }
  lines.push('');
  return lines;
}

export function renderFoiSchemas(): string {
  // Reverse index: which archive entries bind each variant.
  const entriesByVariant = new Map<string, string[]>();
  for (const key of listFoiEntryKeys(FOI_ARCHIVE_DIR)) {
    const variant = readFoiEntryMeta(FOI_ARCHIVE_DIR, key).converter?.variant;
    if (typeof variant === 'string') {
      entriesByVariant.set(variant, [...(entriesByVariant.get(variant) ?? []), key]);
    }
  }
  const variantNames = Object.keys(FOI_ENTRY_CONVERSIONS).sort();

  const lines: string[] = [
    '# FOI dataset schemas',
    '',
    '**Generated from the converter registry** (`npm run foi:schemas`; the',
    'repository copy is authoritative and the test suite fails when it is',
    'stale - do not edit by hand). Rendered from the authored registry values',
    'that validation and the column-governance test enforce, so this page and',
    'the accepted vocabulary are the same thing.',
    '',
    'Committed normalised files are **per-class core + registered extensions**',
    '(the composed-stack working decision, 2026-07): each file carries its row',
    "family's core columns plus only the extension columns its source asserts.",
    'The union view is a derived, downstream projection (SQLite / published',
    'union CSV), never the committed format. The open-data lane\'s schema is',
    'documented separately in [`normalised-schema.md`](normalised-schema.md).',
    '',
    '## Dataset classes (entry-level vocabulary)',
    '',
    '| class | definition |',
    '|---|---|',
    ...Object.entries(FOI_DATASET_CLASSES).map(([cls, definition]) => `| \`${cls}\` | ${definition} |`),
    '',
    '## Row-schema families',
    '',
    '| family | core columns | description |',
    '|---|---|---|',
    ...FOI_ROW_SCHEMA_FAMILIES.map(family =>
      `| \`${family.name}\` | ${family.coreColumns.map(c => `\`${c}\``).join(', ')} | ${family.description} |`),
    '',
    '## Registered extension columns',
    '',
    'Carried only where the source asserts them; adding a column means adding a',
    'reviewed definition here (enforced by the governance test), never inventing',
    'a header.',
    '',
    '| column | applicable families | definition |',
    '|---|---|---|',
    ...Object.entries(FOI_EXTENSION_COLUMNS).map(([name, extension]) =>
      `| \`${name}\` | ${extension.families.map(f => `\`${f}\``).join(', ')} | ${extension.definition} |`),
    '',
    '## Converter variants',
    '',
    'Column **kind** vocabulary: `verbatim` (value carried unchanged),',
    '`prefixed` (source value with an authored prefix), `date` (parsed from',
    'the source\'s date format to ISO order), `iso-date` (already ISO-shaped',
    'at source, verified not reformatted), `count` (numeric with thousands',
    'separators stripped), `constant` (authored fixed value, stated in the',
    'source column). A **date plausibility bound** appears only for',
    'conversions whose outputs include date columns - dates beyond the bound',
    'fail the conversion.',
    '',
    '| variant | bound by |',
    '|---|---|',
    ...variantNames.map(variant => {
      const entries = entriesByVariant.get(variant);
      const bound = entries === undefined
        ? '**no entry binds this variant**'
        : entries.sort().map(key => `\`${key}\``).join(', ');
      return `| \`${variant}\` | ${bound} |`;
    }),
    '',
  ];

  for (const variant of variantNames) {
    lines.push(`### \`${variant}\``, '');
    for (const conversion of FOI_ENTRY_CONVERSIONS[variant]) {
      lines.push(...conversionSection(conversion));
    }
  }

  return lines.join('\n');
}

function main(): void {
  fs.writeFileSync(SCHEMAS_FILE, renderFoiSchemas());
  console.log(`wrote ${path.relative(REPO_ROOT, SCHEMAS_FILE)}`);
}

if (import.meta.main) {
  main();
}
