/**
 * Forbidden-suffix history (issues #289 / #291 phase 1): a committed,
 * byte-deterministic observation/diff layer over every forbidden-suffix
 * disclosure the archive holds, joined on the suffix key.
 *
 * The forbidden list is a first-class dataset category (#288), not only a
 * per-callsign flag. This report makes "has the disallowed vocabulary
 * evolved, and when?" answerable from committed data alone: it reads the
 * normalised suffix files of the FOI `forbidden-list` entries - never the
 * gitignored `landing/` drop zone - so the comparison is traceable and a
 * change in a PR diff is a drift signal, exactly like the cross-dataset
 * invariants (#241) it mirrors.
 *
 * Per disclosure it surfaces: the distinct-suffix count (with any duplicate
 * rows called out as a within-disclosure data-quality artefact, never
 * silently deduplicated); the set diff against the previous disclosure
 * (added / removed suffixes, listed in full); and the `LastModifiedDate`
 * DISTRIBUTION where the source carries one - shown as a histogram, never
 * reduced to a single date (the 2024 export is one outlier over a 2016
 * origin bulk, and that shape is the finding).
 *
 * Two derived observations ground later phases:
 *  - the EVER-FORBIDDEN UNION - the distinct union of suffixes across all
 *    disclosures. A future row-level `forbidden-suffix` flag will key off
 *    this rather than any single list: flagging against "ever forbidden" is
 *    robust to churn and to suspected omission ERRORS (working theory: the
 *    2024 de-listing of QNF/ZFJ is an artefact, not a deliberate policy
 *    change, so those suffixes must stay flagged).
 *  - each suffix's FIRST-KNOWN-FORBIDDEN date - the earliest disclosure or
 *    `LastModifiedDate` at which it appears. A future temporal flag
 *    (`forbidden-suffix-issued-after-first-known-list`) will key off this;
 *    the 2024 export's per-suffix dates make it finer than the disclosure
 *    vintages alone (JIZ is first known 2020-12-10, before its only
 *    appearance in the 2024 disclosure).
 *
 * The per-(suffix, disclosure) presence matrix is deliberately keyed so a
 * LATER phase can attach, per suffix, the count of matching callsigns BROKEN
 * DOWN BY STATUS (Allocated / Reserved / Available): a bare total would
 * mislead - a rise in matches could be a Reserved spike rather than new
 * issuance - so the shape is left ready for that decomposition even though
 * the callsign cross-link is out of scope here. Every figure is DECLARED,
 * not verified.
 */

import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';
import { defaultFoiDir, listFoiEntryKeys, readFoiEntryMeta } from '../shared/foi-archive.ts';

// One forbidden-suffix disclosure: a single FOI entry's suffix file, with the
// diff against its predecessor and the last-modified distribution where the
// source asserts one.
export interface ForbiddenDisclosure {
  entry: string;
  vintage: string;
  sourceFile: string;
  // Raw normalised rows vs distinct suffixes: equal unless the source
  // duplicated a row (2016's ZIT), which is a data-quality artefact of that
  // disclosure, not a vocabulary change.
  rowCount: number;
  distinctCount: number;
  distinctSuffixes: string[];
  duplicates: string[];
  // Set diff vs the previous disclosure (empty for the first).
  added: string[];
  removed: string[];
  // LastModifiedDate distribution: full disclosed value -> count, biggest
  // bucket first. Empty when the source carries no such column.
  lastModified: { value: string; count: number; suffixes: string[] }[];
}

// A suffix's earliest known forbidden point: an ISO-ordered date key (for
// comparison / bucketing), the fuller disclosed value for display, and the
// basis (which disclosure and whether from its vintage or its per-suffix
// LastModifiedDate).
export interface SuffixFirstKnown {
  dateKey: string;
  displayValue: string;
  basis: string;
}

export interface ForbiddenSuffixHistory {
  disclosures: ForbiddenDisclosure[];
  // The distinct union of every suffix ever forbidden, across all
  // disclosures - the churn-robust basis for the future row-level flag.
  everForbiddenUnion: string[];
  // The suffixes whose list membership changed at any point - the drift set
  // the observation matrix and the phase-3 per-suffix pages hang off.
  changedSuffixes: string[];
  // Per-union-suffix first-known-forbidden point (see SuffixFirstKnown).
  firstKnownForbidden: Record<string, SuffixFirstKnown>;
}

interface RawDisclosure {
  entry: string;
  vintage: string;
  sourceFile: string;
  rows: { suffix: string; lastModified: string | undefined }[];
}

// Buckets small enough to name every member (the outlier last-modified date,
// the handful of drifting suffixes); larger buckets are counted only.
const ENUMERATE_LIMIT = 25;

function num(n: number): string {
  return n.toLocaleString('en-GB');
}

function readCsv(file: string): Record<string, string>[] {
  return fs.existsSync(file)
    ? parse(fs.readFileSync(file, 'utf8'), { columns: true, bom: true, skip_empty_lines: true }) as Record<string, string>[]
    : [];
}

// Every FOI `forbidden-list` entry's normalised suffix file (a normalised
// file whose header carries a `suffix` column). Ordered by (vintage, entry)
// so consecutive diffs read chronologically and regeneration is stable.
function collectRawDisclosures(foiDir: string): RawDisclosure[] {
  const out: RawDisclosure[] = [];
  for (const entry of listFoiEntryKeys(foiDir)) {
    const meta = readFoiEntryMeta(foiDir, entry);
    if (!(meta.datasetClasses ?? []).includes('forbidden-list')) continue;
    const entryDir = path.join(foiDir, entry);
    for (const [fileName, decl] of Object.entries(meta.files)) {
      if (decl.role !== 'normalised') continue;
      const records = readCsv(path.join(entryDir, fileName));
      if (records.length === 0 || records[0]['suffix'] === undefined) continue;
      out.push({
        entry,
        vintage: meta.dataVintage ?? '—',
        sourceFile: fileName,
        rows: records.map(r => ({ suffix: r['suffix'], lastModified: r['last_modified_date'] })),
      });
    }
  }
  out.sort((a, b) => a.vintage.localeCompare(b.vintage) || a.entry.localeCompare(b.entry) || a.sourceFile.localeCompare(b.sourceFile));
  return out;
}

function lastModifiedDistribution(rows: RawDisclosure['rows']): ForbiddenDisclosure['lastModified'] {
  const withDate = rows.filter(r => r.lastModified !== undefined && r.lastModified !== '');
  if (withDate.length === 0) return [];
  const buckets = new Map<string, string[]>();
  for (const r of withDate) {
    const value = r.lastModified as string;
    const suffixes = buckets.get(value) ?? [];
    suffixes.push(r.suffix);
    buckets.set(value, suffixes);
  }
  return [...buckets.entries()]
    .map(([value, suffixes]) => ({ value, count: suffixes.length, suffixes: [...suffixes].sort() }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

// The earliest known forbidden point for a suffix: the minimum, across every
// disclosure that lists it, of the disclosure vintage AND (where present) the
// suffix's own LastModifiedDate. All values are ISO-ordered, so string
// comparison is chronological; the per-suffix LastModifiedDate wins ties and
// is generally finer/earlier than the disclosure vintage.
function firstKnownFor(suffix: string, disclosures: ForbiddenDisclosure[]): SuffixFirstKnown {
  const candidates: SuffixFirstKnown[] = [];
  for (const d of disclosures) {
    if (!d.distinctSuffixes.includes(suffix)) continue;
    candidates.push({ dateKey: d.vintage, displayValue: d.vintage, basis: `${d.entry} (vintage)` });
    const bucket = d.lastModified.find(b => b.suffixes.includes(suffix));
    if (bucket !== undefined) {
      candidates.push({ dateKey: bucket.value.slice(0, 10), displayValue: bucket.value, basis: `${d.entry} (LastModifiedDate)` });
    }
  }
  candidates.sort((a, b) => a.dateKey.localeCompare(b.dateKey) || a.basis.localeCompare(b.basis));
  // Union membership guarantees at least one candidate.
  return candidates[0];
}

export function buildForbiddenSuffixHistory(foiDir: string = defaultFoiDir()): ForbiddenSuffixHistory {
  const raw = collectRawDisclosures(foiDir);
  const disclosures: ForbiddenDisclosure[] = [];
  const changed = new Set<string>();
  const union = new Set<string>();
  let previousSet: Set<string> | undefined;

  for (const d of raw) {
    const seen = new Set<string>();
    const duplicates = new Set<string>();
    for (const { suffix } of d.rows) {
      if (seen.has(suffix)) duplicates.add(suffix);
      else seen.add(suffix);
    }
    for (const s of seen) union.add(s);
    // Bind to a const so the closures narrow (previousSet is reassigned in the loop).
    const prev = previousSet;
    const added = prev === undefined ? [] : [...seen].filter(s => !prev.has(s)).sort();
    const removed = prev === undefined ? [] : [...prev].filter(s => !seen.has(s)).sort();
    for (const s of added) changed.add(s);
    for (const s of removed) changed.add(s);
    disclosures.push({
      entry: d.entry,
      vintage: d.vintage,
      sourceFile: d.sourceFile,
      rowCount: d.rows.length,
      distinctCount: seen.size,
      distinctSuffixes: [...seen].sort(),
      duplicates: [...duplicates].sort(),
      added,
      removed,
      lastModified: lastModifiedDistribution(d.rows),
    });
    previousSet = seen;
  }

  const everForbiddenUnion = [...union].sort();
  const firstKnownForbidden: Record<string, SuffixFirstKnown> = {};
  for (const suffix of everForbiddenUnion) {
    firstKnownForbidden[suffix] = firstKnownFor(suffix, disclosures);
  }

  return {
    disclosures,
    everForbiddenUnion,
    changedSuffixes: [...changed].sort(),
    firstKnownForbidden,
  };
}

function suffixList(suffixes: string[]): string {
  return suffixes.length === 0 ? '—' : suffixes.map(s => `\`${s}\``).join(', ');
}

// Histogram of the union's first-known-forbidden dates, keyed by date part -
// showing the shape (an origin bulk plus a couple of later points), never a
// single figure. Small buckets are enumerated so the outliers are named.
function firstKnownDistribution(h: ForbiddenSuffixHistory): { dateKey: string; count: number; suffixes: string[] }[] {
  const buckets = new Map<string, string[]>();
  for (const suffix of h.everForbiddenUnion) {
    const key = h.firstKnownForbidden[suffix].dateKey;
    const suffixes = buckets.get(key) ?? [];
    suffixes.push(suffix);
    buckets.set(key, suffixes);
  }
  return [...buckets.entries()]
    .map(([dateKey, suffixes]) => ({ dateKey, count: suffixes.length, suffixes: [...suffixes].sort() }))
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey));
}

export function renderForbiddenSuffixHistory(h: ForbiddenSuffixHistory): string {
  const out: string[] = [];
  out.push('# Forbidden-suffix history');
  out.push('');
  out.push('The forbidden-suffix list — three-letter suffixes Ofcom withholds from');
  out.push('issue — tracked across every disclosure the archive holds, joined on the');
  out.push('suffix key. Built from the committed FOI `forbidden-list` entries (never');
  out.push('the `landing/` drop zone), regenerated and committed, so a change in a PR');
  out.push('diff is a drift signal. Every figure below is **declared, not verified**.');
  out.push('');
  out.push('The disallowed vocabulary is **not static**, and both invariance and drift');
  out.push('are findings: it is unchanged 2016 → 2019 (the two 2019 witnesses agree');
  out.push('exactly with the 2016 set), then changes by the December 2024 disclosure.');
  out.push('');

  out.push('## Disclosures');
  out.push('');
  out.push('One row per forbidden-list disclosure, oldest first. **Distinct** is the');
  out.push('suffix vocabulary; **rows** exceeds it only where the source duplicated a');
  out.push('row (surfaced, never silently deduplicated). **Added / removed** are the');
  out.push('set diff against the previous disclosure.');
  out.push('');
  out.push('| vintage | disclosure | distinct | rows | duplicated | added | removed |');
  out.push('|---|---|---:|---:|---|---|---|');
  for (const d of h.disclosures) {
    out.push(`| ${d.vintage} | \`${d.entry}\` | ${num(d.distinctCount)} | ${num(d.rowCount)} | ${suffixList(d.duplicates)} | ${suffixList(d.added)} | ${suffixList(d.removed)} |`);
  }
  out.push('');

  out.push('## Ever-forbidden union');
  out.push('');
  out.push(`Across every disclosure held, **${num(h.everForbiddenUnion.length)}** distinct`);
  out.push('suffixes have been forbidden at some point. This union — not any single');
  out.push('list — is the intended basis for the future row-level `forbidden-suffix`');
  out.push('flag: flagging against "ever forbidden" is robust to churn and to suspected');
  out.push('omission errors. A suffix on the 2016/2019 lists but absent from 2024 (the');
  out.push('working theory is that the `QNF`/`ZFJ` de-listing is an artefact, not a');
  out.push('deliberate policy change) stays in the union, and so would stay flagged.');
  out.push('');

  out.push('## Changes, disclosure by disclosure');
  out.push('');
  out.push('The set diff between each disclosure and the one before it. Each added or');
  out.push('removed suffix is a drill-down candidate for a per-suffix detail page');
  out.push('(phase 3): its list history plus every callsign carrying it.');
  out.push('');
  const [first, ...rest] = h.disclosures;
  if (first !== undefined) {
    out.push(`- **${first.vintage}** (\`${first.entry}\`): baseline — ${num(first.distinctCount)} suffixes, no prior disclosure to diff against.`);
  }
  for (const d of rest) {
    if (d.added.length === 0 && d.removed.length === 0) {
      out.push(`- **${d.vintage}** (\`${d.entry}\`): no change — the same ${num(d.distinctCount)}-suffix set as the previous disclosure.`);
    } else {
      const parts: string[] = [];
      if (d.added.length > 0) parts.push(`added ${suffixList(d.added)}`);
      if (d.removed.length > 0) parts.push(`removed ${suffixList(d.removed)}`);
      out.push(`- **${d.vintage}** (\`${d.entry}\`): ${parts.join('; ')} → ${num(d.distinctCount)} suffixes.`);
    }
  }
  out.push('');

  out.push('## Last-modified distribution');
  out.push('');
  out.push('Where a disclosure carries a per-suffix `LastModifiedDate` (the December');
  out.push('2024 export does; the earlier lists do not), the **distribution** of those');
  out.push('timestamps — not a single figure. A near-uniform bulk with one outlier is');
  out.push('itself the finding: it dates the list\'s origin and pins when a lone suffix');
  out.push('was touched.');
  out.push('');
  const withDates = h.disclosures.filter(d => d.lastModified.length > 0);
  if (withDates.length === 0) {
    out.push('_No disclosure held carries a last-modified column._');
    out.push('');
  }
  for (const d of withDates) {
    out.push(`### ${d.vintage} — \`${d.entry}\``);
    out.push('');
    out.push('| last modified | suffixes | which |');
    out.push('|---|---:|---|');
    for (const bucket of d.lastModified) {
      const which = bucket.count <= ENUMERATE_LIMIT ? suffixList(bucket.suffixes) : `_(${num(bucket.count)} suffixes — not enumerated)_`;
      out.push(`| ${bucket.value} | ${num(bucket.count)} | ${which} |`);
    }
    out.push('');
  }

  out.push('## First-known-forbidden distribution');
  out.push('');
  out.push('For every suffix in the union, the earliest disclosure or `LastModifiedDate`');
  out.push('at which it is known to have been forbidden — bucketed by date. This is the');
  out.push('per-suffix temporal anchor a future `forbidden-suffix-issued-after-first-known-list`');
  out.push('flag will key off; the 2024 export makes it finer than the disclosure');
  out.push('vintages alone.');
  out.push('');
  out.push('| first known forbidden | suffixes | which |');
  out.push('|---|---:|---|');
  for (const bucket of firstKnownDistribution(h)) {
    const which = bucket.count <= ENUMERATE_LIMIT ? suffixList(bucket.suffixes) : `_(${num(bucket.count)} suffixes — not enumerated)_`;
    out.push(`| ${bucket.dateKey} | ${num(bucket.count)} | ${which} |`);
  }
  out.push('');

  out.push('## Changed-suffix observations');
  out.push('');
  out.push('Only the suffixes whose list membership changed at some point — the drift');
  out.push('set. `✓` = on the list at that disclosure, `·` = absent. This per-(suffix,');
  out.push('disclosure) matrix is the seed for the phase-3 per-suffix pages; a later');
  out.push('phase will attach, per suffix, the count of callsigns carrying it **broken');
  out.push('down by status** (Allocated / Reserved / Available) — a bare total would');
  out.push('mislead, since a rise could be a Reserved spike rather than new issuance,');
  out.push('so the shape is left ready for that decomposition.');
  out.push('');
  if (h.changedSuffixes.length === 0) {
    out.push('_No suffix changed membership across the disclosures held._');
    out.push('');
  } else {
    const cols = h.disclosures.map(d => d.vintage);
    const presentSets = h.disclosures.map(d => new Set(d.distinctSuffixes));
    out.push(`| suffix | ${cols.join(' | ')} | first known forbidden |`);
    out.push(`|---|${h.disclosures.map(() => '---:').join('|')}|---|`);
    for (const suffix of h.changedSuffixes) {
      const cells = presentSets.map(set => (set.has(suffix) ? '✓' : '·'));
      const fk = h.firstKnownForbidden[suffix];
      out.push(`| \`${suffix}\` | ${cells.join(' | ')} | ${fk.displayValue} — ${fk.basis} |`);
    }
    out.push('');
  }

  return out.join('\n');
}

export const FORBIDDEN_SUFFIX_HISTORY_PATH = 'reports/forbidden-suffix-history.md';

export function writeForbiddenSuffixHistory(): { path: string; changed: boolean } {
  const markdown = renderForbiddenSuffixHistory(buildForbiddenSuffixHistory());
  const target = path.resolve(process.cwd(), FORBIDDEN_SUFFIX_HISTORY_PATH);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const existing = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : undefined;
  const changed = existing !== markdown;
  if (changed) fs.writeFileSync(target, markdown);
  return { path: FORBIDDEN_SUFFIX_HISTORY_PATH, changed };
}

if (import.meta.main) {
  const { path: written, changed } = writeForbiddenSuffixHistory();
  console.log(`${changed ? 'wrote' : 'up to date'}: ${written}`);
}
