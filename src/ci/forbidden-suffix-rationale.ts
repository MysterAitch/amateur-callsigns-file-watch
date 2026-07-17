#!/usr/bin/env node

/**
 * Forbidden-suffix RATIONALE (issue #196): a categorisation of WHY each
 * withheld suffix is likely restricted, layered over the ever-forbidden union
 * in `reference-data/forbidden-suffixes.csv`. Ofcom does not publish a
 * per-suffix reason, so this module distinguishes what is genuinely SOURCED
 * from what would be this project's own INFERENCE, and refuses to invent the
 * latter (the transparency/epistemics rule: an unknown rationale stays
 * unknown, never guessed).
 *
 * THE PRIMARY SOURCE. Ofcom's own FOI response (ref 337399, within
 * `archive/foi/wdtk-356636--all-callsigns-plus-forbidden`) states its
 * withholding rationale in its own words:
 *
 *   "We do not hold a policy on reserving unsuitable or inappropriate call
 *   signs for allocation. However, as a matter of conventional practice we do
 *   not issue call signs or parts of call signs that might spell out
 *   (English) words that we think are likely to be generally offensive or
 *   which may lead to undue on-air bullying of the licensee. […] It does
 *   change over time, as taste and social tolerance change.
 *
 *   In addition to the list of potentially offensive call signs, we are
 *   required by Art 19.46 et seq of the Radio Regulations not to allow call
 *   signs that might be confused with internationally accepted signals. That
 *   is therefore an international obligation. For example, 'SOS'. In
 *   addition, there is an international list of so-called 'Q-Codes'. […] Our
 *   licensing system has been programmed not to allow these as suffixes."
 *
 * That single letter names every family this module categorises:
 *
 *  - itu-q-code: the ENTIRE QAA-QZZ block (676 of 1,466 union suffixes - the
 *    full 26x26 combinatorial set, not merely the ones a Q-code table happens
 *    to assign a meaning to). Ofcom's letter treats "Q-codes" as a class, and
 *    the wholesale block match corroborates a blanket rule, not a per-code
 *    lookup. Cited further-information document: ITU-R Recommendation
 *    M.1172, "Miscellaneous abbreviations and signals to be used for
 *    radiocommunications in the maritime mobile service" (the same document
 *    Ofcom's letter itself links to).
 *  - itu-operational-abbreviation: a three-letter token that ITU-R M.1172's
 *    Section II ("Miscellaneous Abbreviations and Signals") separately
 *    defines as an internationally-accepted operating abbreviation (ADS, CFM,
 *    COL, DSC, ETA, KTS, MIN, MSG, MSI, NIL, PBL, PSE, RCC, REF, RPT, SAR,
 *    SIG, SLT, SVC, SYS, TFC, TXT). EVERY one of these 22 tokens is
 *    independently present on the forbidden-suffix union - a 100% hit rate
 *    that is not plausibly coincidence, and falls under the same Art 19.46
 *    "confused with internationally accepted signals" obligation the letter
 *    states, of which Q-codes are named as one instance among others.
 *  - itu-signal-confusion: SOS itself, the letter's own worked example of an
 *    internationally accepted signal a callsign must not be confused with.
 *
 * What this module DELIBERATELY does NOT do: it does not attempt to
 * individually attribute any of the residual (non-Q-code, non-M.1172,
 * non-SOS) suffixes to Ofcom's "potentially offensive / bullying-prone"
 * bucket. Ofcom's letter confirms that bucket EXISTS and explains its
 * general character, but publishes no per-suffix mapping, and this project
 * has no independent authority to declare that a specific three-letter
 * string was withheld for that reason rather than left over from some other
 * cause. Guessing word-by-word would be exactly the invented rationale the
 * project's epistemics rule forbids, so every suffix outside the three
 * sourced families above is left OUT of the committed CSV entirely -
 * "unclassified", not "offensive": absence here is not evidence of anything
 * beyond "not attributable to a specific citable rule". The collective,
 * sourced context for that residual set is carried as prose (in the
 * forbidden-suffix section index, not per-suffix), quoting Ofcom's own words
 * above rather than asserting a category this project cannot support.
 *
 * Two further internationally-recognised procedural signals worth naming
 * for the record and NOT classifying: TTT (safety) and XXX (urgency) are
 * well known in amateur/maritime radio convention, but ITU-R M.1172 - the
 * only primary document this project holds a citable copy of - does not
 * define them, so they are deliberately left unclassified rather than cited
 * to a document that does not actually say so.
 */

import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const FORBIDDEN_SUFFIXES_CSV = path.join(REPO_ROOT, 'reference-data', 'forbidden-suffixes.csv');
const RATIONALE_CSV = path.join(REPO_ROOT, 'reference-data', 'forbidden-suffix-rationale.csv');

export type RationaleCategory = 'itu-q-code' | 'itu-operational-abbreviation' | 'itu-signal-confusion';
export type Epistemics = 'sourced' | 'inferred';

export interface SuffixRationale {
  suffix: string;
  category: RationaleCategory;
  epistemics: Epistemics;
  // A short citation key, resolved to full prose/URLs by the section
  // renderer and reference-data/README.md - never duplicated inline here.
  source: string;
}

// The single citation every sourced rationale in this file rests on: Ofcom's
// own FOI response, which is what actually states the withholding rationale
// (the ITU-R M.1172 document it links to is corroborating detail, not a
// second independent source).
export const OFCOM_FOI_SOURCE = 'ofcom-foi-337399';

// ITU-R Recommendation M.1172, Section II ("Miscellaneous Abbreviations and
// Signals"): every three-letter abbreviation the document defines, extracted
// by hand from the mirrored copy (landing/reference/, gitignored per the
// ITU cite-don't-commit policy; see reference-data/README.md and
// docs/source-register.md for the fetch record). Kept as a flat, auditable
// list rather than re-parsed from the PDF on every build.
const ITU_M1172_SECTION_II_ABBREVIATIONS: readonly string[] = [
  'ADS', 'CFM', 'COL', 'DSC', 'ETA', 'KTS', 'MIN', 'MSG', 'MSI', 'NIL',
  'PBL', 'PSE', 'RCC', 'REF', 'RPT', 'SAR', 'SIG', 'SLT', 'SVC', 'SYS',
  'TFC', 'TXT',
];

// Ofcom's own worked example of an internationally accepted signal a
// callsign must not be confused with (Radio Regulations Art 19.46 et seq).
const SIGNAL_CONFUSION_SUFFIXES: readonly string[] = ['SOS'];

const Q_CODE_PATTERN = /^Q[A-Z]{2}$/;

// Categorise a single suffix against the three sourced, citable families.
// Returns undefined for anything outside them - the caller must never
// invent a category for an undefined result.
export function categoriseSuffix(suffix: string): { category: RationaleCategory; epistemics: Epistemics; source: string } | undefined {
  if (Q_CODE_PATTERN.test(suffix)) {
    return { category: 'itu-q-code', epistemics: 'sourced', source: OFCOM_FOI_SOURCE };
  }
  if (SIGNAL_CONFUSION_SUFFIXES.includes(suffix)) {
    return { category: 'itu-signal-confusion', epistemics: 'sourced', source: OFCOM_FOI_SOURCE };
  }
  if (ITU_M1172_SECTION_II_ABBREVIATIONS.includes(suffix)) {
    return { category: 'itu-operational-abbreviation', epistemics: 'sourced', source: OFCOM_FOI_SOURCE };
  }
  return undefined;
}

// Read the ever-forbidden union's suffixes (the CSV's first column), in file
// order, skipping the header row and any blank line.
export function everForbiddenSuffixes(csvPath: string = FORBIDDEN_SUFFIXES_CSV): string[] {
  const lines = fs.readFileSync(csvPath, 'utf8').split(/\r?\n/);
  return lines
    .slice(1)
    .map(line => line.split(',', 1)[0].trim())
    .filter(suffix => suffix !== '');
}

// Every suffix on the ever-forbidden union that this module can categorise,
// sorted by suffix (deterministic, matching the reference-data convention).
// Suffixes with no established rationale are simply absent - never a row
// with an invented or blank category.
export function buildForbiddenSuffixRationale(csvPath: string = FORBIDDEN_SUFFIXES_CSV): SuffixRationale[] {
  const rows: SuffixRationale[] = [];
  for (const suffix of everForbiddenSuffixes(csvPath)) {
    const c = categoriseSuffix(suffix);
    if (c !== undefined) rows.push({ suffix, ...c });
  }
  return rows.sort((a, b) => a.suffix.localeCompare(b.suffix));
}

// Load the committed rationale CSV into a lookup map, keyed by suffix - the
// shape the section renderer and tests actually want. Returns undefined for
// any suffix absent from the file (unclassified), never a fabricated entry.
export function loadForbiddenSuffixRationale(csvPath: string = RATIONALE_CSV): Map<string, SuffixRationale> {
  const map = new Map<string, SuffixRationale>();
  const lines = fs.readFileSync(csvPath, 'utf8').split(/\r?\n/);
  for (const line of lines.slice(1)) {
    if (line.trim() === '') continue;
    const [suffix, category, epistemics, source] = line.split(',');
    map.set(suffix, { suffix, category: category as RationaleCategory, epistemics: epistemics as Epistemics, source });
  }
  return map;
}

function toCsv(rows: SuffixRationale[]): string {
  const header = 'suffix,category,epistemics,source';
  const body = rows.map(r => `${r.suffix},${r.category},${r.epistemics},${r.source}`);
  return [header, ...body].join('\n') + '\n';
}

function main(): void {
  const rows = buildForbiddenSuffixRationale();
  fs.writeFileSync(RATIONALE_CSV, toCsv(rows));
  const byCategory = new Map<string, number>();
  for (const r of rows) byCategory.set(r.category, (byCategory.get(r.category) ?? 0) + 1);
  console.log(`forbidden-suffix rationale: ${rows.length} classified of ${everForbiddenSuffixes().length} union suffixes`);
  for (const [category, count] of byCategory) console.log(`  ${category}: ${count}`);
}

if (import.meta.main) {
  main();
}
