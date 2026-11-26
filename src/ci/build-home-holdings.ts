#!/usr/bin/env node

/**
 * Home span-dial holdings manifest (issue #921).
 *
 * The v1 home "record at a glance" span dial is a miniature of the site's
 * bi-temporal instrument: per-publication markers drop DOWN from the axis at
 * their vintage (assertion time), and notable register-history milestones point
 * UP (event time). To render those marks HONESTLY the home page needs the real
 * enumeration of held publications and the real, cited milestone set — never a
 * hand-authored list of vintages, which would be exactly the hand-maintained-
 * duplicate fragility class this repo hunts (a 65-entry hand list drifting the
 * day a publication lands).
 *
 * So this build step DERIVES a small, root-served `holdings.json` from the same
 * source of truth the deploy already folds:
 *   - PUBLICATIONS (the down-markers) come from the callsign-shards manifest
 *     (datasets.json — itself a pure projection of the archived publications,
 *     src/ci/build-callsign-shards.ts). We read it back rather than re-folding
 *     the archive, so the home dial and the callsign page can never disagree
 *     about what is held. Each publication carries its vintage, its dataset-kind
 *     letter (the SAME KIND_LETTER vocabulary the v0 holdings map uses, so the
 *     marks read as the same component, never a second copy that could drift),
 *     its title and row count for the hover/text-parity detail, and a flag for
 *     the single newest register snapshot (the ringed cell).
 *   - MILESTONES (the up-markers) come ONLY from already-cited in-repo reference
 *     data. Series introductions read from reference-data/prefix-formats.csv's
 *     `introduced` + `notes` columns (the same source the callsign dial's
 *     series-introduction marker uses); each carries its own citation, so a
 *     milestone can never ship uncited. One further milestone — the mid-2010s
 *     licensing-system change — is a documented narrative fact, cited to the
 *     in-repo chronology below and flagged where a detail is inferred rather
 *     than observed (claims bar: an inferred fact renders as inferred, or not at
 *     all). The qualifying in-repo set is deliberately small; expanding the
 *     sourced catalogue is a tracked follow-up (community-level register history).
 *
 * The 1903 history horizon is NOT in this manifest: the publication enumeration
 * does not carry it, so it stays a report-cited constant on the home model. The
 * newest register's callsign total is (latestRegister).
 *
 * DETERMINISM. The output is a pure function of its inputs: publications are
 * ordered by (vintage, title); milestones by (start, label); no timestamps or
 * environment values are written. The self-check test builds twice and asserts
 * byte-identity.
 *
 * Usage: node src/ci/build-home-holdings.ts <site-root>
 *   reads  <site-root>/callsign/data/datasets.json
 *   writes <site-root>/holdings.json
 */

import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';
import { KIND_LETTER } from './build-publisher-pages.ts';
import { OPEN_DATA_IMPLICIT_CLASS } from './build-class-pages.ts';
import { parseJsonObject } from '../shared/json-shape.ts';

// The FOI-lane fallback kind, matching build-publisher-pages.primaryClass: a FOI
// dataset that declares no class is drawn as reference context.
const FOI_IMPLICIT_CLASS = 'reference-context';

// The milestone catalogue is authored HERE (the deploy/render layer), not as a
// new reference-data file: it CITES the reference data and the narrative docs
// rather than living among them. Series introductions are read straight from
// reference-data/prefix-formats.csv's `introduced` + `notes` columns — reading
// the committed reference data at build time, never modifying it — so a series
// milestone carries its own reference-data citation. The reference-data
// directory is anchored to this module's location so the build works from any
// working directory.
const REFERENCE_DATA_DIR = path.resolve(import.meta.dirname, '..', '..', 'reference-data');

// One prefix-series row's introduction fields, as read from prefix-formats.csv.
export interface PrefixIntroRow {
  prefix: string;
  introduced: string;
  notes: string;
}

export function loadPrefixIntroRows(referenceDataDir: string = REFERENCE_DATA_DIR): PrefixIntroRow[] {
  const csv = fs.readFileSync(path.join(referenceDataDir, 'prefix-formats.csv'), 'utf8');
  const rows = parse(csv, { columns: true, skip_empty_lines: true }) as Record<string, string>[];
  return rows.map(r => ({ prefix: r.prefix ?? '', introduced: r.introduced ?? '', notes: r.notes ?? '' }));
}

// The subset of the callsign-shards manifest the home dial needs. Depending on
// only these fields keeps this build step decoupled from the rest of the shard
// record's shape.
interface ManifestDataset {
  lane: 'open-data' | 'foi';
  vintage: string | null;
  title: string;
  classes: string[];
  // Rows the lookup could key by callsign.
  rows: number;
  // Rows it could not (a callsign that cleans to nothing). They are in the
  // file all the same, so a count of what the file holds adds them back.
  unkeyable?: number;
  // The publisher's declared coverage intent (false = declared partial), and a
  // verified observation that the file omits records it claims to hold. Both
  // feed the whole-register test (isWholeRegister).
  intendedComplete?: boolean | null;
  coverageNote?: string;
}

// One held publication, as the down-markers read it.
export interface HoldingPublication {
  // The publication's data vintage (ISO date or month) — its position on the
  // axis, and the assertion-time reading the mark represents.
  vintage: string;
  // The dataset-class key (register-snapshot, available-pool, …) driving the
  // mark's tint, carried so kind is never conveyed by colour alone.
  kind: string;
  // The kind's single letter (R/A/I/F/S/T/C) — the colour-independent cue.
  letter: string;
  title: string;
  // Every row in the publication's file, keyable or not (recordsInFile).
  rows: number;
  // The single newest register snapshot: the ringed "latest" mark.
  latest: boolean;
}

// One register-history milestone, as the up-markers read it. `start`/`end` are
// ISO year or month strings; a point milestone has start === end, a range (a
// loosely-dated event) spans them. Every milestone carries its citation.
export interface HoldingMilestone {
  start: string;
  end: string;
  range: boolean;
  // Record-scoped, claims-bar wording (guarded by build-home-holdings.test.ts).
  label: string;
  // The in-repo citation for the milestone — never empty.
  citation: string;
  // Present for series-introduction milestones (the prefix series, e.g. 'M7').
  series?: string;
}

export interface HomeHoldings {
  schemaVersion: 1;
  generator: string;
  // Publications held — the derived figure that retires the hand-authored count.
  count: number;
  // Span endpoints of the held run (the dense assertion-time axis), by year.
  heldStartYear: number | null;
  latestYear: number | null;
  // The newest publication's full vintage where it is a full date, so the dial's
  // "read as of" reading is derived rather than hand-stamped; null when the
  // newest vintage is month-only.
  latestDateIso: string | null;
  // The newest register snapshot and how many records its file holds, so the
  // home page's callsign total follows the data. Kept apart from latestDateIso,
  // which is the newest publication of ANY kind: the two coincide only while
  // the newest thing held happens to be a register. Null when no register
  // snapshot is held.
  latestRegister: { vintage: string; records: number } | null;
  publications: HoldingPublication[];
  milestones: HoldingMilestone[];
}

const GENERATOR = 'src/ci/build-home-holdings.ts (issue #921)';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// The 4-digit leading year of an ISO vintage ('2016-09-20' -> 2016); null when
// the string carries no leading year (honestly unknown rather than guessed).
export function yearOf(vintage: string | null): number | null {
  if (vintage === null) return null;
  const m = /^(\d{4})/.exec(vintage);
  return m === null ? null : Number(m[1]);
}

// "October 2018" from an ISO year/month; the bare year when no month is present.
export function monthLabel(iso: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(iso);
  if (m === null) return iso;
  const monthName = MONTHS[Number(m[2]) - 1];
  return monthName === undefined ? iso : `${monthName} ${m[1]}`;
}

// The dataset kind a publication is drawn as: its first declared class, or the
// lane's implicit default. Mirrors build-publisher-pages.primaryClass so the
// home marks and the v0 holdings map derive kind identically.
function primaryKind(dataset: ManifestDataset): string {
  return dataset.classes[0] ?? (dataset.lane === 'open-data' ? OPEN_DATA_IMPLICIT_CLASS : FOI_IMPLICIT_CLASS);
}

// Every row a publication's file holds: the rows the lookup keyed plus those it
// could not. The home page states this one count for a publication wherever it
// shows one, as the dataset and statistics pages do; the dial's marks once
// counted keyed rows only and so read "163,341 rows" beside "163,342 callsigns"
// for the same 2026-09-22 register.
function recordsInFile(dataset: ManifestDataset): number {
  return dataset.rows + (dataset.unkeyable ?? 0);
}

// ---------------------------------------------------------------------------
// Publications (the down-markers), derived from the shards manifest.

export function holdingsPublications(datasets: readonly ManifestDataset[]): HoldingPublication[] {
  const dated = datasets.filter((d): d is ManifestDataset & { vintage: string } => typeof d.vintage === 'string' && d.vintage !== '');
  // The ringed "latest" mark is the newest WHOLE register (newestWholeRegister),
  // the same file whose records the home page counts.
  const newestWhole = newestWholeRegister(datasets);
  return dated
    .map((d): HoldingPublication => {
      const kind = primaryKind(d);
      return {
        vintage: d.vintage,
        kind,
        letter: KIND_LETTER[kind] ?? kind.charAt(0).toUpperCase(),
        title: d.title,
        rows: recordsInFile(d),
        latest: d === newestWhole,
      };
    })
    .sort((a, b) => (a.vintage < b.vintage ? -1 : a.vintage > b.vintage ? 1 : a.title < b.title ? -1 : a.title > b.title ? 1 : 0));
}

// ---------------------------------------------------------------------------
// Milestones (the up-markers), from already-cited in-repo reference data only.

// Series introductions: the prefix-series rows that record an introduction
// month, each cited by its own reference-data note. Sorted by (date, series) so
// the set is deterministic.
export function seriesMilestones(prefixRows: readonly PrefixIntroRow[]): HoldingMilestone[] {
  return prefixRows
    .filter(row => row.introduced.trim() !== '')
    .map((row): HoldingMilestone => ({
      start: row.introduced,
      end: row.introduced,
      range: false,
      label: `${row.prefix} series opened ${monthLabel(row.introduced)}`,
      citation: row.notes.trim(),
      series: row.prefix,
    }))
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
}

// The mid-2010s licensing-system change — a documented narrative milestone. The
// headline is anchored to the EVIDENCED change date: a "system change" had
// replaced list-based assignment by 2016. The 2017 date is only when the
// platform's name was disclosed, so it stays in the citation fold rather than
// widening the headline into a two-year span the record does not describe. The
// pre-2016 platform is INFERRED to be Siebel: the archive's curatorial notes and
// source register associate it (the wdtk-174341 significance note, the 2014/15
// Licence-View field dictionary), but the verbatim held FOI correspondence does
// not name it — so the wording flags it as inferred rather than asserting it.
// A point milestone (not a range), positioned at the evidenced change year.
export const SYSTEM_MIGRATION_MILESTONE: HoldingMilestone = {
  start: '2016',
  end: '2016',
  range: false,
  label: 'Licensing system changed, by 2016',
  citation:
    'The record shows Ofcom’s licensing system changing by 2016: a “system change” had replaced list-based assignment with an algorithm by September 2016. The licensing database was later named Salesforce in 2017 (seen in the salesforce.com copyright line and the Value__c column names). The pre-2016 platform is inferred to be Siebel — the archive’s curatorial notes and source register associate it (the wdtk-174341 significance note; the 2014/15 Licence-View field dictionary, archive/foi/wdtk-238892) — but the verbatim held FOI correspondence does not name it. Sources: docs/narratives/ofcom-systems-and-publication-chronology.md; docs/hypothesis-register.md.',
};

export function homeMilestones(prefixRows: readonly PrefixIntroRow[]): HoldingMilestone[] {
  return [...seriesMilestones(prefixRows), SYSTEM_MIGRATION_MILESTONE]
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
}

// ---------------------------------------------------------------------------
// Assembly.

// A register file counts as WHOLE - a reading of the full register on its date -
// when its publisher did not declare it partial, no verified observation says
// it omits records, and it holds at least this share of the previous whole
// register's records. The share sits between the two populations the archive
// actually holds: partial register files (allocated-only, reserved-only,
// issued-scope, the duration breakdown, a blank-product omission) hold at most
// 72% of the whole register before them, while whole registers have never fallen
// below 91% (2026-01-14, itself a known omission). Taking "the newest register"
// as simply the newest register-kind file put a 1,074-row truncated file, a
// reserved-only list, and others in that place at 10 of the 39 points since the
// first register was held, so a callsign page read nearly every status as
// out of date the day such a file arrived.
//
// What it cannot tell: a whole register that genuinely shrinks by a fifth or
// more is skipped until a later one is as large; a partial file holding four
// fifths or more of the register, with no declaration or coverage note, is
// taken as whole; and a month-only vintage cannot be ordered against a dated
// one in the same month (the string order puts the month first).
export const WHOLE_REGISTER_SHARE = 0.8;

function isRegisterCandidate(d: ManifestDataset): d is ManifestDataset & { vintage: string } {
  return typeof d.vintage === 'string' && d.vintage !== '' && primaryKind(d) === 'register-snapshot'
    && d.intendedComplete !== false && (d.coverageNote ?? '') === '';
}

// The newest whole register file, or null when no register snapshot is held.
// Files are walked by date, the larger first within one date, each compared to
// the whole register before it; the first register held is taken as whole.
export function newestWholeRegister(datasets: readonly ManifestDataset[]): ManifestDataset | null {
  const candidates = datasets.filter(isRegisterCandidate)
    .sort((a, b) => (a.vintage < b.vintage ? -1 : a.vintage > b.vintage ? 1 : recordsInFile(b) - recordsInFile(a)));
  let whole: ManifestDataset | null = null;
  for (const d of candidates) {
    if (whole === null || recordsInFile(d) >= WHOLE_REGISTER_SHARE * recordsInFile(whole)) whole = d;
  }
  return whole;
}

// The newest whole register, with every record its file holds. On 2026-09-22
// one row's callsign was a single full stop: the lookup cannot key it, and the
// file still has 163,342 records, not 163,341.
export function latestRegister(datasets: readonly ManifestDataset[]): { vintage: string; records: number } | null {
  const newest = newestWholeRegister(datasets);
  return newest === null || newest.vintage === null ? null : { vintage: newest.vintage, records: recordsInFile(newest) };
}

export function homeHoldings(datasets: readonly ManifestDataset[], prefixRows: readonly PrefixIntroRow[]): HomeHoldings {
  const publications = holdingsPublications(datasets);
  const years = publications
    .map(p => yearOf(p.vintage))
    .filter((y): y is number => y !== null);
  const heldStartYear = years.length > 0 ? Math.min(...years) : null;
  const latestYear = years.length > 0 ? Math.max(...years) : null;
  // The "read as of" reading: the newest publication vintage, but only when it
  // is a full date (the register snapshot the chip also names); month-only
  // newest vintages leave it null rather than implying a day.
  const newest = publications.length > 0 ? publications[publications.length - 1].vintage : null;
  const latestDateIso = newest !== null && /^\d{4}-\d{2}-\d{2}$/.test(newest) ? newest : null;
  return {
    schemaVersion: 1,
    generator: GENERATOR,
    count: publications.length,
    heldStartYear,
    latestYear,
    latestDateIso,
    latestRegister: latestRegister(datasets),
    publications,
    milestones: homeMilestones(prefixRows),
  };
}

// Read the already-built shards manifest and emit the holdings manifest beside
// the deployed root pages.
export function buildHomeHoldings(siteRoot: string, prefixRows: readonly PrefixIntroRow[] = loadPrefixIntroRows()): HomeHoldings {
  const manifestPath = path.join(siteRoot, 'callsign', 'data', 'datasets.json');
  const manifest = parseJsonObject(fs.readFileSync(manifestPath, 'utf8'), manifestPath) as { datasets: ManifestDataset[] };
  const holdings = homeHoldings(manifest.datasets, prefixRows);
  fs.writeFileSync(path.join(siteRoot, 'holdings.json'), JSON.stringify(holdings));
  return holdings;
}

if (import.meta.main) {
  const siteRoot = process.argv.slice(2).filter(a => a.trim().length > 0)[0] ?? '_site';
  const holdings = buildHomeHoldings(siteRoot);
  console.log(`built home holdings manifest in ${path.join(siteRoot, 'holdings.json')}`);
  console.log(`  publications: ${holdings.count} (${holdings.heldStartYear ?? '?'} → ${holdings.latestYear ?? '?'})`);
  console.log(`  milestones: ${holdings.milestones.length}`);
}
