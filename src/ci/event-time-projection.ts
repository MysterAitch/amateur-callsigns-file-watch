/**
 * The in-process event-time projection for the reader-facing surfaces
 * (issue #726): every S1 event-date claim in the corpus, folded per cleaned
 * subject into the exact evidence-row shape the state-at-t engine consumes
 * (SubjectEventRow), plus the day histogram the mass-episode detector reads
 * (DaySignal) — all derived in one pass over the SAME canonical inputs the
 * claim ledger is built from.
 *
 * Why in-process rather than a DuckDB fold of the ledger: the site-assembly
 * job builds its artefacts from the committed archive without the ledger emit
 * or the deploy Parquet in scope, and the shard builders (the issue #594
 * precedent) are deterministic projections of the same canonical inputs the
 * databases fold. This module therefore runs the S1 emit path ITSELF —
 * collectLedgerSources + emitEventDateClaims, the very functions buildLedger
 * uses — so the evidence rows here are the ledger's event tier, not a
 * re-implementation of it. The corpus parity test
 * (event-time-surfaces-corpus.test.ts) pins that equivalence against
 * foldSubjectEvents over a real claims source for the recorded exemplars.
 *
 * Epistemics carried through unchanged (binding on every consumer):
 *  - a row asserts only that THIS dataset, AT THIS vintage, stated this date;
 *  - absence of a row is NON-OBSERVATION, never "nothing happened",
 *    "was available" or "did not exist";
 *  - the version-scoped start kinds mean "earliest start SURVIVING in the
 *    asserting vintage" (issue #800), never "the true original".
 */

import { emitEventDateClaims, eventKindOf } from '../v2/claim.ts';
import { collectLedgerSources } from '../v2/collectors/index.ts';
import { defaultArchiveDir } from '../v2/collectors/open-data-register.ts';
import type { ResolvedLedgerSource } from '../v2/collectors/types.ts';
import { defaultFoiDir, readFoiEntryMeta, type FoiEntryMeta } from '../shared/foi-archive.ts';
import { cleanedCallsign } from '../sources/ofcom-amateur/components.ts';
import { vintageDaySpan, type SubjectEventRow } from './state-at-t.ts';
import type { DaySignal } from './event-time-coherency.ts';
import { time } from '../shared/perf.ts';

// One dataset that asserted at least one event-date claim: the reference the
// compact shard records index into (by position in the projection's dataset
// list), resolving to the dataset entry page the site already publishes.
export interface EventDatasetRef {
  // The ledger's lane token (split_part(sourceFile, '/', 1)): 'opendata' | 'foi'.
  lane: string;
  // The ledger's dataset key (split_part(sourceFile, '/', 2)): the archive
  // date key for the open-data lane, the FOI entry key for the FOI lane.
  dataset: string;
  // The dataset's assertion-time vintage, day-keyed (yyyy-mm-dd) or
  // month-keyed (yyyy-mm) — verified against the vintage grammar at fold time.
  vintage: string;
  title: string;
  // Site-root-relative dataset entry page.
  href: string;
}

export interface EventTimeProjection {
  datasets: EventDatasetRef[];
  // Per cleaned subject, every aggregated (kind, dataset, day) assertion —
  // the same rows foldSubjectEvents yields from the ledger, in the same
  // (kind, day, lane, dataset, vintage) order.
  rows: Map<string, SubjectEventRow[]>;
  // The (dataset, kind, day) histogram the S2 mass-episode detector reads.
  daySignals: DaySignal[];
  // The latest assertion day any consulted vintage is proven to cover — the
  // deterministic "as at" instant the derived state findings are computed for
  // (never the build clock, so the artefact is a pure function of the corpus).
  asAt: string;
  // Rows whose subject cell cleans to nothing: unaddressable by callsign, so
  // they cannot join a per-callsign surface. Counted, never silently dropped —
  // they remain in the ledger, which the surfaces link to.
  unkeyableEventClaims: number;
}

export interface EventProjectionOptions {
  archiveDir?: string;
  foiDir?: string;
  // Test seam: fold these resolved sources instead of collecting the real
  // corpus. Production callers omit it.
  sources?: ResolvedLedgerSource[];
}

interface DatasetAcc {
  ref: EventDatasetRef;
  index: number;
}

// The friendly publication name for a dataset reference, never the raw entry
// key (issue #954: an event's assertion-time provenance fold must name "Radio
// amateur licence breakdown by duration held and age", not
// "wdtk-1180568--licence-breakdown-duration-age"). The FOI entry's own
// meta.json carries a mandatory title field in the real archive; a synthetic
// fixture entry the test seam folds (`options.sources`) carries no such
// meta.json on disk at all, so THAT specific miss falls back to the raw key
// HONESTLY (never a fabricated name) rather than failing the whole
// projection. Any OTHER read failure - malformed JSON, or a meta.json that
// exists but declares a blank title - is a data-integrity defect on a real
// archive entry, never the fixture seam, so it fails loud rather than being
// swallowed into the same silent fallback.
function datasetTitle(lane: string, dataset: string, foiDir: string): string {
  if (lane !== 'foi') return `Ofcom open data, ${dataset}`;
  let meta: FoiEntryMeta;
  try {
    meta = readFoiEntryMeta(foiDir, dataset);
  } catch (cause) {
    if (cause instanceof Error && cause.message.includes('meta.json not found')) return dataset;
    throw cause;
  }
  if (typeof meta.title !== 'string' || meta.title.trim() === '') {
    throw new Error(`${foiDir}/${dataset}/meta.json: title is missing or blank - every FOI entry must declare a non-empty title`);
  }
  return meta.title;
}

function datasetHref(lane: string, dataset: string): string {
  return lane === 'opendata'
    ? `datasets/open-data/${dataset}/index.html`
    : `datasets/foi/${dataset}/index.html`;
}

// Fold the whole corpus's S1 event-date claims into the per-subject evidence
// rows and the day histogram. Deterministic: source order is the collector
// registry's stable corpus order, and every output list is explicitly sorted.
export function foldEventTimeProjection(options: EventProjectionOptions = {}): EventTimeProjection {
  const foiDir = options.foiDir ?? defaultFoiDir();
  const sources = options.sources ?? collectLedgerSources({
    archiveDir: options.archiveDir ?? defaultArchiveDir(),
    foiDir,
  });

  const datasetsByKey = new Map<string, DatasetAcc>();
  // subject -> "kind\nlane\ndataset\nvintage\nday" -> nrows
  const perSubject = new Map<string, Map<string, SubjectEventRow>>();
  // "lane\ndataset\nkind\nday" -> { vintage, n }
  const dayAgg = new Map<string, { lane: string; dataset: string; vintage: string; kind: string; day: string; n: number }>();
  let unkeyableEventClaims = 0;

  for (const source of sources) {
    const set = time(`event-projection:load:${source.sourceFile}`, () => source.load());
    const claims = emitEventDateClaims(set);
    if (claims.length === 0) continue;

    const [lane, dataset] = set.sourceFile.split('/');
    const vintage = set.vintage;
    // Fail loud on a vintage outside the authored grammar (day- or
    // month-keyed): the state engine could not compare it, so a source
    // emitting event claims under one is a defect, never data.
    vintageDaySpan(vintage);

    let acc = datasetsByKey.get(`${lane}/${dataset}`);
    if (acc === undefined) {
      acc = {
        ref: { lane, dataset, vintage, title: datasetTitle(lane, dataset, foiDir), href: datasetHref(lane, dataset) },
        index: -1,
      };
      datasetsByKey.set(`${lane}/${dataset}`, acc);
    }

    for (const claim of claims) {
      const kind = eventKindOf(claim.predicate);
      if (kind === undefined) {
        throw new Error(`foldEventTimeProjection: ${set.sourceFile} emitted an event claim under unclassified predicate "${claim.predicate}"`);
      }
      const subject = cleanedCallsign(claim.rawSubject);
      if (subject === '') {
        unkeyableEventClaims += 1;
        continue;
      }
      const day = claim.object;

      let subjectRows = perSubject.get(subject);
      if (subjectRows === undefined) {
        subjectRows = new Map();
        perSubject.set(subject, subjectRows);
      }
      const rowKey = `${kind}\n${lane}\n${dataset}\n${vintage}\n${day}`;
      const existing = subjectRows.get(rowKey);
      if (existing === undefined) subjectRows.set(rowKey, { kind, lane, dataset, vintage, day, nrows: 1 });
      else existing.nrows += 1;

      const dayKey = `${lane}\n${dataset}\n${kind}\n${day}`;
      const dayEntry = dayAgg.get(dayKey);
      if (dayEntry === undefined) dayAgg.set(dayKey, { lane, dataset, vintage, kind, day, n: 1 });
      else {
        dayEntry.n += 1;
        // foldDaySignals reports min(vintage) per (kind, lane, dataset, day);
        // within one dataset the vintage is constant, but keep the same rule.
        if (vintage < dayEntry.vintage) dayEntry.vintage = vintage;
      }
    }
  }

  if (datasetsByKey.size === 0) {
    return { datasets: [], rows: new Map(), daySignals: [], asAt: '', unkeyableEventClaims };
  }

  // Dataset order: assertion-time-major (vintage, lane, dataset) — the same
  // oldest-first reading order the shard manifest uses.
  const datasets = [...datasetsByKey.values()]
    .sort((a, b) => a.ref.vintage.localeCompare(b.ref.vintage) || a.ref.lane.localeCompare(b.ref.lane) || a.ref.dataset.localeCompare(b.ref.dataset));
  datasets.forEach((acc, index) => { acc.index = index; });

  // Per-subject rows in foldSubjectEvents' order: kind, day, lane, dataset, vintage.
  const rows = new Map<string, SubjectEventRow[]>();
  for (const subject of [...perSubject.keys()].sort()) {
    const subjectRows = perSubject.get(subject);
    if (subjectRows === undefined) continue; // unreachable: keys come from the map
    rows.set(subject, [...subjectRows.values()].sort((a, b) =>
      a.kind.localeCompare(b.kind) || a.day.localeCompare(b.day) || a.lane.localeCompare(b.lane)
      || a.dataset.localeCompare(b.dataset) || a.vintage.localeCompare(b.vintage)));
  }

  const daySignals: DaySignal[] = [...dayAgg.values()].sort((a, b) =>
    a.kind.localeCompare(b.kind) || a.lane.localeCompare(b.lane) || a.dataset.localeCompare(b.dataset) || a.day.localeCompare(b.day));

  // The latest proven assertion day across the emitting datasets — a pure
  // function of the corpus, so re-running over unchanged inputs re-derives the
  // same instant (unlike a build clock).
  const asAt = datasets
    .map(acc => vintageDaySpan(acc.ref.vintage).latest)
    .reduce((max, day) => (day > max ? day : max));

  return { datasets: datasets.map(acc => acc.ref), rows, daySignals, asAt, unkeyableEventClaims };
}

// The dataset index for one evidence assertion (lane + dataset), against the
// projection's dataset list. Fail loud on a miss: an assertion citing a
// dataset outside the list would render an unattributable claim.
export function datasetIndexOf(datasets: readonly EventDatasetRef[], lane: string, dataset: string): number {
  const index = datasets.findIndex(ref => ref.lane === lane && ref.dataset === dataset);
  if (index === -1) {
    throw new Error(`datasetIndexOf: no dataset reference for ${lane}/${dataset} - every asserted-by entry must resolve to a listed dataset`);
  }
  return index;
}
