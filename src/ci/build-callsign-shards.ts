#!/usr/bin/env node

/**
 * Prefix-sharded static JSON for the instant per-callsign page (issue #594).
 *
 * Resolving ONE callsign is the most common entry intent, yet every existing
 * path rides the in-browser SQLite worker (cold opens measured ~20-30s on
 * Pages, #475). A single callsign's data is a few hundred bytes, so this build
 * emits it as static JSON the page answers from in ONE small fetch - no
 * database, no worker, no wasm on that path.
 *
 * Derivation (the ledger-canonical direction, #361/#572): a deterministic,
 * purpose-shaped projection of the SAME canonical inputs the published
 * databases fold - every archived open-data publication's normalised.csv
 * (listArchiveKeys) plus every callsign-bearing FOI normalised file
 * (buildFoiObservations, the union the combined database's observations table
 * ships). Nothing is asserted here that those inputs do not carry; the claim
 * ledger remains the deep-provenance surface and the page links out to it.
 *
 * Output shape, under <outputDir>:
 *   datasets.json      - the once-fetched manifest: every folded dataset in
 *                        vintage order (the history string's positions), the
 *                        status-letter legend, the product/type/implied-class
 *                        vocabularies records index into, and the shard list.
 *   <SHARD>.json       - one file per shard, `{ shard, callsigns: {...} }`,
 *                        keyed by the cleaned callsign form.
 *
 * SHARDING. The shard key is the first two characters of the cleaned form
 * (cleanedCallsign: upper-case, A-Z 0-9 / only), with an `irregular` fallback
 * bucket for forms whose first two characters are not both [A-Z0-9] (visitor
 * `M/...` renderings, one-character tokens). Real callsigns concentrate into a
 * handful of hot two-character buckets (M7, M0, G0, ...), each far too big for
 * an instant fetch, so a bucket exceeding SHARD_SPLIT_THRESHOLD callsigns is
 * subdivided by its third character ([A-Z0-9] only); the residue (two-character
 * forms, or a non-alphanumeric third character) stays in the parent shard. The
 * client resolves a callsign by testing its 3-char then 2-char prefix against
 * the manifest's shard list, then the fallback - so the rule lives here ONCE
 * and the page just does a longest-prefix match.
 *
 * DETERMINISM. The output is a pure function of the archive bytes: datasets
 * are ordered by (vintage, key); callsigns are emitted in sorted order; the
 * vocabularies are sorted; status letters are assigned on first encounter in
 * that fixed processing order. No timestamps or environment values are
 * written. The self-check test builds twice and asserts byte-identity.
 *
 * PER-CALLSIGN RECORD (compact keys, mirrored by the JSDoc typedef in
 * site/callsign.js - the two must be kept in step):
 *   h  presence/status history: one character per manifest dataset, in order.
 *      A status letter (legend.statuses), or a marker (legend.markers):
 *      '.' absent · '?' listed but the file carries no status column ·
 *      '-' listed with a blank status · '!' listed more than once with
 *      DISAGREEING statuses (surfaced, never resolved - the ledger shows both).
 *   l  latest register-snapshot observation: { d: dataset index,
 *      s: status letters, p: product vocab indices, t: type vocab indices }
 *      (arrays because one snapshot can carry more than one row for a cleaned
 *      form; empty arrays are omitted). Absent for callsigns never seen in a
 *      register-snapshot dataset (e.g. availability-list-only sightings).
 *   d  dates from the latest open-data row, verbatim as published:
 *      { c: created, m: last modified, o: original start } (blanks omitted;
 *      whole block omitted when the callsign is not in any open-data
 *      publication, or that publication lists it more than once).
 *   a  parsed components of the cleaned form (parseCallsign, the same
 *      build-time parser the archive derivatives use): { ps: parse status
 *      (omitted when 'parsed'), pre: prefix series, rsl, sfx: suffix,
 *      ph: placeholder form, hc: home callsign, ic: implied-class vocab
 *      index }; blank components are omitted.
 *   f  data-quality flags from that parse (reference-data/flags.md
 *      vocabulary); omitted when none.
 *   v  raw published forms that differ from the cleaned key (verbatim, so
 *      whitespace/case artefacts stay visible); omitted when none.
 *   tw the latest register snapshot's per-variant rows, present ONLY when that
 *      snapshot lists the cleaned form more than once: [{ r: raw form verbatim,
 *      s: status letter, m: source-intrinsic last-modified date, p: product
 *      vocab index }] (blank s/m/p omitted). Lets the page annotate a
 *      cleaned-key conflict with format-normality and recency context (#633) -
 *      surfaced, never adjudicated. Rows are in file order.
 *   m  dataset indices where this cleaned form appears MORE THAN ONCE
 *      (e.g. a clean row beside a stripped-collision twin); omitted when none.
 *
 * Like the SQLite artefacts this is BUILT AT DEPLOY, never committed - though
 * unlike them it IS byte-deterministic, which is what the self-check asserts.
 *
 * Usage: node src/ci/build-callsign-shards.ts [output-dir]
 */

import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { DIRS } from '../shared/constants.ts';
import { listArchiveKeys } from '../shared/archive.ts';
import { derivedEntryFile } from '../shared/derived-entries.ts';
import { buildFoiObservations, type FoiObservationRow } from '../shared/foi-observations.ts';
import { defaultFoiDir } from '../shared/foi-archive.ts';
import { parseCsvCached } from '../shared/parse-cache.ts';
import { cleanedCallsign, parseCallsign, loadReferenceData, type ReferenceData } from '../sources/ofcom-amateur/components.ts';

// A two-character bucket larger than this is subdivided by third character so
// no shard fetch is ever more than a few tens of KB gzipped. Chosen so a full
// child shard stays around a few hundred KB raw (~tens of KB over the wire).
export const SHARD_SPLIT_THRESHOLD = 2000;

// History-string marker characters (everything that is NOT a status letter).
// Kept out of the status-letter alphabet by the assigner below.
export const MARKERS = {
  '.': 'not present in this dataset',
  '?': 'listed, but this dataset carries no status column',
  '-': 'listed, with a blank status',
  '!': 'listed more than once with disagreeing statuses',
} as const;

const RESERVED_CHARS = new Set(Object.keys(MARKERS));

// One folded observation row, normalised across the two lanes.
interface SourceRow {
  callsign: string;
  status: string | null; // null = the file carries no status column
  product: string | null;
  type: string | null;
  created: string | null;
  modified: string | null;
  // The licence-version's own last-modified stamp (2026-schema
  // `licence_version_last_modified_date`), which populates for allocated rows
  // where the plain `modified` column is blank; the source-intrinsic timestamp
  // the twin-conflict recency annotation reads (#633).
  versionModified: string | null;
  originalStart: string | null;
}

// One dataset as the manifest publishes it (`rows`/`unkeyable` are filled in
// during the fold).
export interface ShardDataset {
  key: string;
  lane: 'open-data' | 'foi';
  entry: string;
  file: string | null;
  vintage: string | null;
  title: string;
  classes: string[];
  href: string;
  rows: number;
  // Rows whose cleaned form is empty (no A-Z/0-9// characters at all, e.g. a
  // ",," token) - unaddressable by callsign, so they cannot join a shard.
  // Counted here rather than silently dropped.
  unkeyable: number;
  // Coverage intent as published (open-data meta.json); null = undeclared
  // (every FOI dataset - the disclosures declare no completeness intent).
  // Absence is only ever evidence in a declared-complete dataset, and even
  // then only as a lead (see coverageNote).
  intendedComplete: boolean | null;
  scopeNotes: string;
  // Verified-quality observations that mean the publication omits records it
  // claims to hold - absence there is NOT evidence even though intent said
  // complete.
  coverageNote: string;
}

interface DatasetSource {
  dataset: ShardDataset;
  loadRows: () => SourceRow[];
}

interface OpenDataMeta {
  intendedCoverage?: { complete: boolean; scopeNotes?: string };
  qualityObservations?: { statement: string; coverageAffecting?: boolean }[];
}

// Latest register-snapshot observation for one entity (arrays: one snapshot
// can list a cleaned form more than once).
interface LatestObservation {
  d: number;
  statuses: string[];
  products: string[];
  types: string[];
}

// One conflicting twin row of the latest register snapshot: the raw token
// verbatim (so an abnormal spelling stays visible), its status and product, and
// its source-intrinsic last-modified stamp. Surfaced so the page can annotate a
// cleaned-key conflict with normality and recency context (#633) - never to
// pick a winner.
interface TwinVariant {
  raw: string;
  status: string;
  product: string;
  modified: string;
}

interface EntityAcc {
  h: string; // grows dataset by dataset; padded to full length at emit
  forms: Set<string> | null;
  latest: LatestObservation | null;
  dates: { c: string; m: string; o: string } | null;
  // The latest register snapshot's per-variant rows, ONLY when that snapshot
  // lists the cleaned form more than once (else null). Refreshed each register
  // snapshot so it always tracks `latest`.
  twins: TwinVariant[] | null;
  multi: number[];
}

// Per-dataset aggregation for one cleaned form, discarded once the dataset's
// column of the history string is written.
interface CellAgg {
  count: number;
  statuses: Set<string>;
  products: Set<string>;
  types: Set<string>;
  onlyRow: SourceRow | null; // the row, only while count === 1
  rows: SourceRow[]; // every row of this cleaned form, for the twin breakdown
}

export interface ShardBuildSummary {
  outputDir: string;
  datasets: number;
  callsigns: number;
  unkeyableRows: number;
  shards: number;
  totalBytes: number;
  manifestBytes: number;
  largestShard: { name: string; bytes: number; callsigns: number };
}

// ---------------------------------------------------------------------------
// Dataset enumeration: both lanes resolved to the same SourceRow shape, in
// deterministic (vintage, key) order.

function openDataSources(archiveDir: string): DatasetSource[] {
  return listArchiveKeys().sort().map(key => {
    const metaPath = path.join(archiveDir, key, 'meta.json');
    const meta: OpenDataMeta = fs.existsSync(metaPath)
      ? JSON.parse(fs.readFileSync(metaPath, 'utf8')) as OpenDataMeta
      : {};
    const coverageNote = (meta.qualityObservations ?? [])
      .filter(o => o.coverageAffecting === true).map(o => o.statement).join(' ');
    const dataset: ShardDataset = {
      key: `open-data--${key}`,
      lane: 'open-data',
      entry: key,
      file: null,
      vintage: key,
      title: `Ofcom open data, ${key}`,
      classes: ['register-snapshot'],
      href: `datasets/open-data/${key}/index.html`,
      rows: 0,
      unkeyable: 0,
      intendedComplete: meta.intendedCoverage === undefined ? null : meta.intendedCoverage.complete,
      scopeNotes: meta.intendedCoverage?.scopeNotes ?? '',
      coverageNote,
    };
    return {
      dataset,
      loadRows: (): SourceRow[] => {
        const records = parseCsvCached(derivedEntryFile(key, 'normalised.csv', archiveDir), { columns: true, skip_empty_lines: true });
        const hasStatus = records.length > 0 && Object.hasOwn(records[0], 'status');
        return records.map(r => ({
          callsign: r.callsign ?? '',
          status: hasStatus ? (r.status ?? '') : null,
          product: r.product ?? null,
          type: r.type ?? null,
          created: r.created_date ?? null,
          modified: r.last_modified_date ?? null,
          versionModified: r.licence_version_last_modified_date ?? null,
          originalStart: r.licence_version_original_start_date ?? null,
        }));
      },
    };
  });
}

function foiSources(foiDir: string): DatasetSource[] {
  // buildFoiObservations already folds every callsign-bearing normalised FOI
  // file (and only those) into one union; group its rows back into per-file
  // datasets so each file is one history-string position.
  const rows = buildFoiObservations(foiDir);
  const groups = new Map<string, FoiObservationRow[]>();
  for (const row of rows) {
    const groupKey = `${row.entry}/${row.sourceFile}`;
    const group = groups.get(groupKey);
    if (group) group.push(row);
    else groups.set(groupKey, [row]);
  }
  const sources: DatasetSource[] = [];
  for (const [groupKey, group] of [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const first = group[0];
    const dataset: ShardDataset = {
      key: `foi--${groupKey}`,
      lane: 'foi',
      entry: first.entry,
      file: first.sourceFile,
      vintage: first.vintage,
      title: first.entry,
      classes: first.datasetClasses.split(',').filter(c => c !== ''),
      href: `datasets/foi/${first.entry}/index.html`,
      rows: 0,
      unkeyable: 0,
      intendedComplete: null,
      scopeNotes: '',
      coverageNote: '',
    };
    sources.push({
      dataset,
      loadRows: (): SourceRow[] => group.map(r => ({
        callsign: r.callsign,
        status: r.values['status'] ?? null,
        product: r.values['licence_class'] ?? null,
        type: null,
        created: null,
        modified: null,
        versionModified: null,
        originalStart: null,
      })),
    });
  }
  return sources;
}

// Vintage-major dataset order: the history string reads oldest to newest.
// String comparison is enough for the ISO-ordered vintages the archive uses
// ('2016-09' sorts before '2016-09-20'); a null vintage sorts first, honestly
// unknown rather than guessed.
function datasetOrder(a: DatasetSource, b: DatasetSource): number {
  const av = a.dataset.vintage ?? '';
  const bv = b.dataset.vintage ?? '';
  if (av !== bv) return av < bv ? -1 : 1;
  return a.dataset.key < b.dataset.key ? -1 : a.dataset.key > b.dataset.key ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Status letters: assigned on first encounter in the fixed processing order
// (deterministic for a given archive). Prefers a letter from the status's own
// text so the legend stays humanly guessable (Allocated -> A, Reserved -> R).
class StatusLetters {
  private readonly byStatus = new Map<string, string>();
  private readonly used = new Set<string>(RESERVED_CHARS);

  letterFor(status: string): string {
    const existing = this.byStatus.get(status);
    if (existing !== undefined) return existing;
    const candidates = `${status.toUpperCase().replace(/[^A-Z0-9]/g, '')}ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789`;
    for (const ch of candidates) {
      if (!this.used.has(ch)) {
        this.used.add(ch);
        this.byStatus.set(status, ch);
        return ch;
      }
    }
    throw new Error(`status-letter alphabet exhausted assigning "${status}" - more distinct status values than letters`);
  }

  legend(): Record<string, string> {
    const legend: Record<string, string> = {};
    for (const [status, letter] of [...this.byStatus.entries()].sort(([, a], [, b]) => (a < b ? -1 : 1))) {
      legend[letter] = status;
    }
    return legend;
  }
}

// The history-string character for one dataset's aggregated sightings of one
// cleaned form. Disagreement is surfaced as '!' - never resolved to a winner.
function cellChar(cell: CellAgg, letters: StatusLetters): string {
  const statuses = [...cell.statuses];
  if (statuses.length === 0) return '?'; // no status column in this file
  if (statuses.length > 1) return '!';
  const only = statuses[0].trim();
  return only === '' ? '-' : letters.letterFor(only);
}

// ---------------------------------------------------------------------------
// Sharding.

// The two-character shard bucket for a cleaned form ('irregular' when the
// first two characters are not both plain [A-Z0-9], e.g. visitor M/ forms).
export function shardBucketOf(cleaned: string): string {
  const two = cleaned.slice(0, 2);
  return /^[A-Z0-9]{2}$/.test(two) ? two : 'irregular';
}

// The shard file a cleaned form lands in, given the final shard-name set:
// longest [A-Z0-9] prefix match (3-char child, then 2-char bucket), then the
// fallback. The client mirrors this against the manifest's shard list.
export function shardNameFor(cleaned: string, shardNames: ReadonlySet<string>): string {
  const three = cleaned.slice(0, 3);
  if (/^[A-Z0-9]{3}$/.test(three) && shardNames.has(three)) return three;
  const two = cleaned.slice(0, 2);
  if (/^[A-Z0-9]{2}$/.test(two) && shardNames.has(two)) return two;
  return 'irregular';
}

// Partition sorted entity keys into the final shard map: two-character
// buckets, with any bucket over the threshold subdivided by third character
// (its residue - two-character forms, or a non-alphanumeric third character -
// keeps the parent name).
export function partitionShards(sortedKeys: readonly string[], threshold: number = SHARD_SPLIT_THRESHOLD): Map<string, string[]> {
  const buckets = new Map<string, string[]>();
  for (const key of sortedKeys) {
    const bucket = shardBucketOf(key);
    const list = buckets.get(bucket);
    if (list) list.push(key);
    else buckets.set(bucket, [key]);
  }
  const shards = new Map<string, string[]>();
  for (const [bucket, keys] of [...buckets.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (bucket === 'irregular' || keys.length <= threshold) {
      shards.set(bucket, keys);
      continue;
    }
    const residue: string[] = [];
    const children = new Map<string, string[]>();
    for (const key of keys) {
      const three = key.slice(0, 3);
      if (/^[A-Z0-9]{3}$/.test(three)) {
        const child = children.get(three);
        if (child) child.push(key);
        else children.set(three, [key]);
      } else {
        residue.push(key);
      }
    }
    if (residue.length > 0) shards.set(bucket, residue);
    for (const [child, childKeys] of [...children.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
      shards.set(child, childKeys);
    }
  }
  return shards;
}

// ---------------------------------------------------------------------------
// The fold + emit.

export function buildCallsignShards(
  outputDir: string,
  options: { archiveDir?: string; foiDir?: string; ref?: ReferenceData } = {},
): ShardBuildSummary {
  const archiveDir = options.archiveDir ?? DIRS.archive;
  const foiDir = options.foiDir ?? defaultFoiDir();
  const ref = options.ref ?? loadReferenceData();

  const sources = [...openDataSources(archiveDir), ...foiSources(foiDir)].sort(datasetOrder);
  if (sources.length === 0) throw new Error('no datasets found to fold - archive missing?');

  const letters = new StatusLetters();
  const entities = new Map<string, EntityAcc>();

  sources.forEach((source, index) => {
    const { dataset } = source;
    const isRegister = dataset.classes.includes('register-snapshot');
    const cells = new Map<string, CellAgg>();
    for (const row of source.loadRows()) {
      const cleaned = cleanedCallsign(row.callsign);
      if (cleaned === '') {
        dataset.unkeyable += 1;
        continue;
      }
      dataset.rows += 1;
      let cell = cells.get(cleaned);
      if (cell === undefined) {
        cell = { count: 0, statuses: new Set(), products: new Set(), types: new Set(), onlyRow: null, rows: [] };
        cells.set(cleaned, cell);
      }
      cell.count += 1;
      cell.onlyRow = cell.count === 1 ? row : null;
      cell.rows.push(row);
      if (row.status !== null) cell.statuses.add(row.status.trim());
      if (row.product !== null && row.product.trim() !== '') cell.products.add(row.product.trim());
      if (row.type !== null && row.type.trim() !== '') cell.types.add(row.type.trim());

      let entity = entities.get(cleaned);
      if (entity === undefined) {
        entity = { h: '', forms: null, latest: null, dates: null, twins: null, multi: [] };
        entities.set(cleaned, entity);
      }
      if (row.callsign !== cleaned) {
        entity.forms ??= new Set();
        entity.forms.add(row.callsign);
      }
    }

    // Close this dataset's column of every present entity's history string.
    for (const [cleaned, cell] of cells) {
      const entity = entities.get(cleaned);
      if (entity === undefined) continue; // unreachable: every cell created its entity
      entity.h = entity.h.padEnd(index, '.') + cellChar(cell, letters);
      if (cell.count > 1) entity.multi.push(index);
      if (isRegister) {
        entity.latest = {
          d: index,
          statuses: [...cell.statuses].map(s => s.trim()).filter(s => s !== '').sort(),
          products: [...cell.products].sort(),
          types: [...cell.types].sort(),
        };
        // The twin breakdown tracks the latest register snapshot: refreshed
        // whenever a register snapshot lists this form more than once, and
        // cleared to null when a later snapshot lists it exactly once (so the
        // annotation never shows a stale conflict). Rows are kept in file order
        // - the page orders the format-normal form first for presentation.
        entity.twins = cell.count > 1
          ? cell.rows.map(r => ({
              raw: r.callsign,
              status: (r.status ?? '').trim(),
              product: (r.product ?? '').trim(),
              modified: (r.versionModified ?? '').trim() || (r.modified ?? '').trim(),
            }))
          : null;
      }
      if (dataset.lane === 'open-data') {
        // Dates travel only when the publication lists the form exactly once -
        // two rows would make any single set of dates an arbitrary pick.
        entity.dates = cell.count === 1 && cell.onlyRow !== null
          ? {
              c: (cell.onlyRow.created ?? '').trim(),
              m: (cell.onlyRow.modified ?? '').trim(),
              o: (cell.onlyRow.originalStart ?? '').trim(),
            }
          : null;
      }
    }
  });

  // Pad every history string to the full dataset count.
  const datasetCount = sources.length;
  for (const entity of entities.values()) entity.h = entity.h.padEnd(datasetCount, '.');

  // Parse the cleaned form once per entity with the same build-time parser the
  // archive derivatives use, anchored on the latest register product and the
  // latest open-data original-start date (so e.g. the forbidden-suffix
  // temporal flag has its inputs). Collect the vocabularies as we go.
  const productSet = new Set<string>();
  const typeSet = new Set<string>();
  const classSet = new Set<string>();
  const parsed = new Map<string, ReturnType<typeof parseCallsign>>();
  for (const [cleaned, entity] of entities) {
    const latestProduct = entity.latest?.products[0] ?? '';
    const components = parseCallsign(cleaned, latestProduct, ref, entity.dates?.o ?? '');
    parsed.set(cleaned, components);
    if (components.impliedClass !== '') classSet.add(components.impliedClass);
    if (entity.latest !== null) {
      for (const p of entity.latest.products) productSet.add(p);
      for (const t of entity.latest.types) typeSet.add(t);
    }
  }
  const productVocab = [...productSet].sort();
  const typeVocab = [...typeSet].sort();
  const classVocab = [...classSet].sort();
  const productIndex = new Map(productVocab.map((v, i) => [v, i]));
  const typeIndex = new Map(typeVocab.map((v, i) => [v, i]));
  const classIndex = new Map(classVocab.map((v, i) => [v, i]));

  // Emit one compact record per entity (see the module header for the shape).
  const recordFor = (cleaned: string, entity: EntityAcc): Record<string, unknown> => {
    const record: Record<string, unknown> = { h: entity.h };
    if (entity.latest !== null) {
      const l: Record<string, unknown> = { d: entity.latest.d };
      if (entity.latest.statuses.length > 0) l.s = entity.latest.statuses.map(s => letters.letterFor(s));
      if (entity.latest.products.length > 0) l.p = entity.latest.products.map(p => productIndex.get(p) ?? -1);
      if (entity.latest.types.length > 0) l.t = entity.latest.types.map(t => typeIndex.get(t) ?? -1);
      record.l = l;
    }
    if (entity.dates !== null) {
      const d: Record<string, string> = {};
      if (entity.dates.c !== '') d.c = entity.dates.c;
      if (entity.dates.m !== '') d.m = entity.dates.m;
      if (entity.dates.o !== '') d.o = entity.dates.o;
      if (Object.keys(d).length > 0) record.d = d;
    }
    const components = parsed.get(cleaned);
    if (components !== undefined) {
      const a: Record<string, unknown> = {};
      if (components.parseStatus !== 'parsed') a.ps = components.parseStatus;
      if (components.prefixSeries !== '') a.pre = components.prefixSeries;
      if (components.rsl !== '') a.rsl = components.rsl;
      if (components.suffix !== '') a.sfx = components.suffix;
      if (components.placeholderForm !== '') a.ph = components.placeholderForm;
      if (components.homeCallsign !== '') a.hc = components.homeCallsign;
      const ic = classIndex.get(components.impliedClass);
      if (ic !== undefined) a.ic = ic;
      record.a = a;
      if (components.flags.length > 0) record.f = components.flags;
    }
    if (entity.forms !== null) record.v = [...entity.forms].sort();
    // The latest register snapshot's per-variant conflict breakdown (#633).
    // Every status here is already in `l.s` (same snapshot), so letterFor is a
    // no-op assignment and the legend cannot shift; every non-blank product is
    // already in that snapshot's product set, so its index resolves.
    if (entity.twins !== null) {
      record.tw = entity.twins.map(t => {
        const tw: Record<string, unknown> = { r: t.raw };
        if (t.status !== '') tw.s = letters.letterFor(t.status);
        if (t.modified !== '') tw.m = t.modified;
        const pi = productIndex.get(t.product);
        if (pi !== undefined) tw.p = pi;
        return tw;
      });
    }
    if (entity.multi.length > 0) record.m = entity.multi;
    return record;
  };

  const sortedKeys = [...entities.keys()].sort();
  const shards = partitionShards(sortedKeys);

  fs.mkdirSync(outputDir, { recursive: true });
  let totalBytes = 0;
  let unkeyableRows = 0;
  const largestShard = { name: '', bytes: 0, callsigns: 0 };
  for (const [name, keys] of shards) {
    const callsigns: Record<string, unknown> = {};
    for (const key of keys) {
      const entity = entities.get(key);
      if (entity === undefined) continue; // unreachable: keys come from the entity map
      callsigns[key] = recordFor(key, entity);
    }
    const json = JSON.stringify({ shard: name, callsigns });
    const filePath = path.join(outputDir, `${name}.json`);
    fs.writeFileSync(filePath, json);
    totalBytes += Buffer.byteLength(json);
    if (Buffer.byteLength(json) > largestShard.bytes) {
      largestShard.name = name;
      largestShard.bytes = Buffer.byteLength(json);
      largestShard.callsigns = keys.length;
    }
  }
  for (const source of sources) unkeyableRows += source.dataset.unkeyable;

  const manifest = {
    schemaVersion: 1,
    generator: 'src/ci/build-callsign-shards.ts (issue #594)',
    counts: { datasets: datasetCount, callsigns: entities.size, shards: shards.size, unkeyableRows },
    legend: { statuses: letters.legend(), markers: MARKERS },
    vocab: { product: productVocab, type: typeVocab, impliedClass: classVocab },
    shards: [...shards.keys()],
    datasets: sources.map(s => s.dataset),
  };
  const manifestJson = JSON.stringify(manifest);
  fs.writeFileSync(path.join(outputDir, 'datasets.json'), manifestJson);

  return {
    outputDir,
    datasets: datasetCount,
    callsigns: entities.size,
    unkeyableRows,
    shards: shards.size,
    totalBytes,
    manifestBytes: Buffer.byteLength(manifestJson),
    largestShard,
  };
}

if (import.meta.main) {
  const args = process.argv.slice(2).filter(a => a.trim().length > 0);
  const outputDir = args[0] ?? path.join('_site', 'callsign', 'data');
  const summary = buildCallsignShards(outputDir);
  console.log(`built callsign shards in ${summary.outputDir}`);
  console.log(`  datasets: ${summary.datasets}, callsigns: ${summary.callsigns}, unkeyable rows: ${summary.unkeyableRows}`);
  console.log(`  shards: ${summary.shards}, total ${(summary.totalBytes / 1024 / 1024).toFixed(1)} MB (manifest ${(summary.manifestBytes / 1024).toFixed(1)} KB)`);
  console.log(`  largest shard: ${summary.largestShard.name}.json - ${(summary.largestShard.bytes / 1024).toFixed(1)} KB, ${summary.largestShard.callsigns} callsigns`);
  const largest = fs.readFileSync(path.join(outputDir, `${summary.largestShard.name}.json`));
  console.log(`  largest shard gzipped: ${(zlib.gzipSync(largest, { level: 9 }).length / 1024).toFixed(1)} KB`);
}
