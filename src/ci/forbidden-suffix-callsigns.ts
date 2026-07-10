/**
 * Suffix -> callsigns index (issue #291 phase 3): for every suffix in the
 * ever-forbidden union, every callsign observed carrying it across the whole
 * corpus - the open-data publications (components.csv joined to normalised.csv
 * for status and dates) AND the callsign-bearing FOI observations - with each
 * callsign broken DOWN BY STATUS, never a bare total.
 *
 * The status decomposition is the point, not decoration: a callsign counted
 * against a forbidden suffix may be Allocated (issued / in use), Reserved,
 * Available, Forbidden (the prohibition itself expressed as a callsign row) or
 * blank, and these must not be conflated. A rise in matches could be a Reserved
 * spike, or a batch of Forbidden prohibition rows, rather than new Allocated
 * issuance - a very different meaning. So the index groups distinct callsigns
 * by their latest-known status and keeps the full per-source observation trail
 * behind it, so a status transition (e.g. Forbidden in a 2016 snapshot, then
 * Allocated in the 2025 register) is visible rather than flattened away.
 *
 * Built ONCE over a single pass of each source (mirrors value-catalogue.ts's
 * join approach); the per-suffix page renderer reads this index, it does not
 * re-scan the archive per page. Read from absolute repo paths so the result is
 * independent of the working directory. Every figure is DECLARED, not verified;
 * absence of a callsign is not evidence a suffix may be issued.
 */

import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';
import { buildFoiObservations } from '../shared/foi-observations.ts';
import { parseCallsign, loadReferenceData, type ReferenceData } from '../sources/ofcom-amateur/components.ts';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const ARCHIVE_DIR = path.join(REPO_ROOT, 'archive');
const FOI_DIR = path.join(ARCHIVE_DIR, 'foi');

// Publication directory names are ISO dates (optionally with a content-hash
// suffix). Lexicographic order is chronological, so the last is the current
// register.
const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}(--[0-9a-f]+)?$/;

// One sighting of a callsign carrying a forbidden suffix, in one source.
export interface CallsignObservation {
  // The publication key (open data) or FOI entry key the sighting comes from.
  source: string;
  lane: 'open-data' | 'foi';
  // ISO-ordered key for chronological sorting: the publication date or the
  // FOI disclosure vintage. May be '' when a source declares no vintage.
  dateKey: string;
  // Register status the source asserts for the callsign; '' when the source
  // asserted a blank, matching the humanised (blank) rendering elsewhere.
  status: string;
  // The licence version's original start date (or the nearest issue date the
  // source carries); '' when the source asserts none.
  startDate: string;
}

// A distinct callsign carrying a suffix, with its full observation trail and
// the derived fields the per-suffix page renders.
export interface SuffixCallsign {
  callsign: string;
  observations: CallsignObservation[];
  // Status from the most recent observation - the callsign's latest-known
  // state, which is what the status breakdown counts it under.
  latestStatus: string;
  // Present in the current register (the newest open-data publication).
  inCurrentRegister: boolean;
  // Best-known original-start / issue date (the most recent non-blank one).
  startDate: string;
  // Distinct lanes the callsign is witnessed in ('open-data', 'foi').
  lanes: string[];
}

// A latest-status bucket of callsigns for one suffix - the status breakdown.
export interface StatusBreakdown {
  status: string;
  count: number;
  callsigns: string[];
}

export interface SuffixCallsignInfo {
  suffix: string;
  callsigns: SuffixCallsign[];
  // Distinct callsigns grouped by their latest-known status - NEVER a bare
  // total. Empty when no callsign carries the suffix.
  byStatus: StatusBreakdown[];
  total: number;
}

export type SuffixCallsignIndex = Map<string, SuffixCallsignInfo>;

interface RawObs {
  status: string;
  startDate: string;
}

function readCsv(file: string): Record<string, string>[] {
  return fs.existsSync(file)
    ? parse(fs.readFileSync(file, 'utf8'), { columns: true, bom: true, skip_empty_lines: true }) as Record<string, string>[]
    : [];
}

// The open-data publication keys, chronological; the last is the current
// register. Read from the absolute archive dir so the result does not depend on
// the working directory.
export function listOpenDataKeys(): string[] {
  if (!fs.existsSync(ARCHIVE_DIR)) return [];
  return fs.readdirSync(ARCHIVE_DIR)
    .filter(name => DATE_KEY_RE.test(name) && fs.statSync(path.join(ARCHIVE_DIR, name)).isDirectory())
    .sort();
}

// The status-breakdown ordering: the states we have reasoned about first
// (Allocated is the one that means "issued"), then anything else by count then
// name, with a blank status last - it is real (an asserted blank) but least
// informative.
const STATUS_PRIORITY = new Map<string, number>([
  ['Allocated', 0], ['Reserved', 1], ['Available', 2], ['Forbidden', 3], ['Quarantine', 4],
]);
function statusRank(status: string): number {
  if (status === '') return 100;
  return STATUS_PRIORITY.get(status) ?? 50;
}

// Accumulate one sighting into the per-(suffix, callsign) observation map.
function record(
  acc: Map<string, Map<string, CallsignObservation[]>>,
  union: Set<string>,
  suffix: string,
  callsign: string,
  obs: CallsignObservation,
): void {
  if (!union.has(suffix)) return;
  let byCallsign = acc.get(suffix);
  if (byCallsign === undefined) { byCallsign = new Map(); acc.set(suffix, byCallsign); }
  const list = byCallsign.get(callsign) ?? [];
  list.push(obs);
  byCallsign.set(callsign, list);
}

function openDataObs(key: string, acc: Map<string, Map<string, CallsignObservation[]>>, union: Set<string>): void {
  const dir = path.join(ARCHIVE_DIR, key);
  // Status and the original-start date live on normalised.csv, keyed by
  // callsign; the suffix lives on components.csv. Build the join once per
  // publication (the same shape value-catalogue uses).
  const byCallsign = new Map<string, RawObs>();
  for (const r of readCsv(path.join(dir, 'normalised.csv'))) {
    const callsign = (r['callsign'] ?? '').trim();
    if (callsign === '') continue;
    const startDate = (r['licence_version_original_start_date'] ?? '').trim() || (r['created_date'] ?? '').trim();
    byCallsign.set(callsign, { status: (r['status'] ?? '').trim(), startDate });
  }
  for (const r of readCsv(path.join(dir, 'components.csv'))) {
    const suffix = (r['suffix'] ?? '').trim();
    if (suffix === '' || !union.has(suffix)) continue;
    const callsign = (r['callsign'] ?? '').trim();
    const joined = byCallsign.get(callsign);
    record(acc, union, suffix, callsign, {
      source: key,
      lane: 'open-data',
      dateKey: key,
      status: joined?.status ?? '',
      startDate: joined?.startDate ?? '',
    });
  }
}

function foiObs(acc: Map<string, Map<string, CallsignObservation[]>>, union: Set<string>, ref: ReferenceData): void {
  for (const obs of buildFoiObservations(FOI_DIR)) {
    const callsign = obs.callsign.trim();
    if (callsign === '') continue;
    // Prefer a source-asserted suffix column (the available-callsign lists
    // carry one); otherwise derive it the same way the open-data components do,
    // so the all-callsigns snapshot (no suffix column) still joins.
    const declared = (obs.values['suffix'] ?? '').trim();
    const suffix = declared !== '' ? declared : parseCallsign(callsign, obs.values['licence_class'] ?? '', ref).suffix;
    if (suffix === '' || !union.has(suffix)) continue;
    const startDate = (obs.values['original_start_date'] ?? '').trim()
      || (obs.values['licence_issued_date'] ?? '').trim()
      || (obs.values['created_date'] ?? '').trim();
    record(acc, union, suffix, callsign, {
      source: obs.entry,
      lane: 'foi',
      dateKey: obs.vintage ?? '',
      status: (obs.values['status'] ?? '').trim(),
      startDate,
    });
  }
}

function summariseCallsign(callsign: string, raw: CallsignObservation[], currentKey: string | undefined): SuffixCallsign {
  const observations = [...raw].sort((a, b) =>
    a.dateKey.localeCompare(b.dateKey) || a.lane.localeCompare(b.lane) || a.source.localeCompare(b.source));
  const latest = observations[observations.length - 1];
  // Most recent non-blank start date across the trail (issue dates do not
  // change, but only some sources carry the column).
  let startDate = '';
  for (let i = observations.length - 1; i >= 0; i -= 1) {
    if (observations[i].startDate !== '') { startDate = observations[i].startDate; break; }
  }
  return {
    callsign,
    observations,
    latestStatus: latest.status,
    inCurrentRegister: currentKey !== undefined && observations.some(o => o.lane === 'open-data' && o.source === currentKey),
    startDate,
    lanes: [...new Set(observations.map(o => o.lane))].sort(),
  };
}

function breakdown(callsigns: SuffixCallsign[]): StatusBreakdown[] {
  const buckets = new Map<string, string[]>();
  for (const c of callsigns) {
    const list = buckets.get(c.latestStatus) ?? [];
    list.push(c.callsign);
    buckets.set(c.latestStatus, list);
  }
  return [...buckets.entries()]
    .map(([status, cs]) => ({ status, count: cs.length, callsigns: [...cs].sort() }))
    .sort((a, b) => statusRank(a.status) - statusRank(b.status) || b.count - a.count || a.status.localeCompare(b.status));
}

// Build the whole suffix -> callsigns index over the union in a single pass of
// each source. Suffixes with no callsign get an empty entry, so a "withheld and
// unused" page is still backed by a real (empty) result rather than a guess.
export function buildSuffixCallsignIndex(union: readonly string[]): SuffixCallsignIndex {
  const unionSet = new Set(union);
  const acc = new Map<string, Map<string, CallsignObservation[]>>();
  const keys = listOpenDataKeys();
  const currentKey = keys[keys.length - 1];
  for (const key of keys) openDataObs(key, acc, unionSet);
  foiObs(acc, unionSet, loadReferenceData());

  const index: SuffixCallsignIndex = new Map();
  for (const suffix of union) {
    const byCallsign = acc.get(suffix);
    const callsigns = byCallsign === undefined
      ? []
      : [...byCallsign.entries()]
          .map(([callsign, raw]) => summariseCallsign(callsign, raw, currentKey))
          .sort((a, b) => a.callsign.localeCompare(b.callsign));
    index.set(suffix, {
      suffix,
      callsigns,
      byStatus: breakdown(callsigns),
      total: callsigns.length,
    });
  }
  return index;
}
