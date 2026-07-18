#!/usr/bin/env node

/**
 * Stage 1 of the raw-keyed claim-ledger pipeline (issue #361): emit the
 * canonical claim ledger (JSONL) straight from the RAW published bytes of the
 * register-snapshot sources, and report the corpus scale.
 *
 * SOURCE FAMILIES. The ledger folds over several published-source families, all
 * emitting through the ONE emit path (emitLedger) once a family resolves to a
 * SourceObservationSet - the raw rows under the publisher's own headers, with
 * the callsign/product columns read from that family's AUTHORED converter
 * binding, never re-guessed. Each family lives in its own module under
 * collectors/ and joins the corpus through the collectors/index.ts registry;
 * the families covered today are:
 *   - foi-register: the FOI-disclosed register snapshots (archive/foi/**),
 *     keyed off FOI_ENTRY_CONVERSIONS (foi-normalise.ts).
 *   - open-data-register: Ofcom's open-data register publications
 *     (archive/<date>/raw.csv), keyed off the header-variant registry
 *     (ofcom-amateur/normalise.ts), honouring each entry's curated ignoredLines
 *     so export footer furniture never becomes a bogus observation.
 *   - attribute-addendum: FOI entries whose datasetClasses carry
 *     'attribute-addendum' (archive/foi/**), the per-callsign attribute rows
 *     (licence-issued / original-start dates, reservation expiries) that the
 *     register family deliberately excludes at the entry level. Its
 *     callsign-row-per-line CSV sources ride the SAME register machinery
 *     (registerSourcesFor + loadRegisterSource), keyed off the authored
 *     converter binding.
 * Adding a family is additive and file-local: implement a collectors/<family>.ts
 * exporting a LedgerCollector (see collectors/open-data-register.ts for the
 * pattern) and add it to the COLLECTORS registry. A collector declares its
 * subjectKind, so the emit path runs callsign normalisation only for callsign
 * subjects and never mis-normalises a suffix / pool-slot / aggregate token. The
 * remaining families (available-pools, forbidden lists, statistics) follow the
 * same shape where they are callsign-row-per-line; a shape that is not (a
 * statistics aggregate, a markdown-table or PDF-only transcription needing a raw
 * parser lifted from the FOI converter) needs a bespoke adapter.
 *
 * The inversion #361 proposes makes a CLAIM the atom and every published table
 * a fold over the ledger. This runner is the emit half, keyed - deliberately -
 * off the RAW bytes, never the normalised CSVs: for each register snapshot it
 * reads that snapshot's raw source (the mechanical raw-extract of a disclosed
 * workbook, or the CSV-native disclosure itself), under Ofcom's OWN column
 * names, and calls emitLedger from claim.ts. The raw callsign token travels
 * verbatim, so the ledger preserves distinctions the normalised store discards
 * (the G0TQK trailing-NBSP twin). The combined SQLite is generated FROM the
 * normalised CSVs and keyed to the normalised callsign, so it is deliberately
 * NOT a dependency here - the whole point is to work from raw.
 *
 * Layers, this stage: the seed's raw / derived only. Raw = the verbatim source
 * cells under Ofcom's headers PLUS the file-level manifest (the verbatim header
 * set/order, the subject column, and the curated furniture the loader strips -
 * a header/furniture string IS a source byte, ADR 0016); derived = the
 * normalises_to edges lifted from components.ts. The full T0-T4 tier ladder
 * (attribute-level derived claims for the status/class/date rules) is a LATER
 * stage - noted here, not built.
 *
 * CANONICAL RECONSTRUCTION FRAMING (issue #455). The file-level manifest rides
 * the canonical emit here (emitSourceLedgerClaims), not only the reconstruction
 * oracle's own stream, so the persisted ledger carries the WHOLE structure a
 * source needs to be rebuilt - the reconstruction oracle round-trips FROM the
 * ledger (src/ci/reconstruction-oracle.ts), the committed raw file being
 * redundant-by-derivation, rather than from a parallel oracle-only projection.
 * Manifest claims ride the FILE_LEVEL_ORDINAL sentinel, so every ordinal-keyed
 * fold excludes them (isFileLevelClaim) and the observation multiset the
 * projections see is unchanged.
 *
 * WHICH raw file backs each snapshot, and which raw column is the callsign, are
 * read from the entry's authored converter binding (FOI_ENTRY_CONVERSIONS) - the
 * one place that already records raw-source -> normalised provenance - so this
 * runner never re-guesses either. Only callsign-bearing register sources are
 * emitted; a forbidden-suffix sheet riding inside a register entry (suffix rows,
 * not callsigns) is skipped, as are the attribute-addendum / statistics-aggregate
 * classes excluded by the entry filter.
 *
 * The ledger is written as JSONL to a BUILD OUTPUT directory (scratch, exactly
 * as build-sqlite.ts writes its tiers). The full claim corpus runs to millions
 * of lines and is NOT committed: this stage proves the pipeline and shape, not
 * the committed-artefact strategy (that proposal lives in the PR).
 *
 * Usage: node src/v2/build-ledger.ts [output-dir]
 */

import * as fs from 'fs';
import * as path from 'path';
import { emitLedger, emitClaims, emitAuthoredRoleClaims, emitFileManifestClaims, type Claim, type SourceObservationSet } from './claim.ts';
import { serialiseClaimsJsonl } from './serialise.ts';
import type { SubjectKind } from './collectors/types.ts';
import { errorMessage } from '../shared/utils.ts';
import { defaultFoiDir } from '../shared/foi-archive.ts';
import { loadReferenceData, type ReferenceData } from '../sources/ofcom-amateur/components.ts';
import { COLLECTORS, collectLedgerSources } from './collectors/index.ts';
import { defaultArchiveDir } from './collectors/open-data-register.ts';
import type { LedgerRoots } from './collectors/types.ts';

// The covered source families, in the registry's stable declaration order. The
// tallies below are keyed off this list, so a newly-registered family is
// counted without editing a literal here.
const FAMILIES: readonly string[] = COLLECTORS.map(collector => collector.family);

export interface SourceLedgerSummary {
  family: string;
  entry: string;
  sourceFile: string;
  vintage: string;
  observations: number;
  rawClaims: number;
  derivedClaims: number;
}

export interface LedgerBuildSummary {
  outputDir: string;
  entriesProcessed: number;
  sourcesProcessed: number;
  // Distinct entries and sources contributed by each family, so the corpus
  // report shows coverage per source family, not just the total.
  entriesByFamily: Record<string, number>;
  sourcesByFamily: Record<string, number>;
  totalObservations: number;
  totalRawClaims: number;
  totalDerivedClaims: number;
  totalClaims: number;
  perSource: SourceLedgerSummary[];
  // Sources whose load/emit threw and were skipped — empty unless a caller
  // opted into skipFailedSources. Surfaced (not swallowed) so a lenient build
  // still reports what it could not process.
  skipped: SkippedSource[];
}

export interface SkippedSource {
  family: string;
  entry: string;
  error: string;
}

// The canonical per-source claim stream the ledger persists: the raw layer
// (existence + verbatim attribute claims, plus the derived normalisation/tier
// claims for a callsign subject), any derived authored-binding-role claims the
// source attests (issue #813 Stage D - the available-pool role vocabulary,
// derived because an authored word is not a published byte), FOLLOWED BY the
// file-level manifest (issue #434/#455, ADR 0016). A callsign subject runs the
// full emit path (cleanedCallsign + normalises_to edges + tiers); any other
// subject kind emits the raw observation claims only, so a non-callsign token
// is never mis-normalised AS a callsign. The manifest is appended LAST so the
// per-row existence anchor stays claims[0] - the claim the projections read the
// source key and vintage off.
export function emitSourceLedgerClaims(source: SourceObservationSet, subjectKind: SubjectKind, ref: ReferenceData): Claim[] {
  const claims = subjectKind === 'callsign' ? emitLedger(source, ref) : emitClaims(source);
  return [...claims, ...emitAuthoredRoleClaims(source), ...emitFileManifestClaims(source)];
}

// The emit-time sole-emitter precondition (issue #813 Stage D, design §1a):
// exactly one family emits per sourceFile, and a loader must emit under the
// exact key its resolution declared (the key structural coverage and the
// sole-emitter reasoning key off). Both violations abort the build - a
// scope-predicate overlap or a declaration drift is a build-integrity failure,
// never something to persist and detect later. Exported so the failure modes
// are unit-testable without constructing a colliding real archive.
export function registerEmittedSource(
  emittedBy: Map<string, string>,
  declared: { family: string; entry: string; sourceFile: string },
  actualSourceFile: string,
): void {
  if (actualSourceFile !== declared.sourceFile) {
    throw new Error(`[${declared.family}] ${declared.entry}: loader emitted sourceFile "${actualSourceFile}" but the resolution declared "${declared.sourceFile}" - the declared key is what structural coverage and the sole-emitter check reason over, so a drift is a build-integrity failure`);
  }
  const priorEmitter = emittedBy.get(declared.sourceFile);
  if (priorEmitter !== undefined) {
    throw new Error(`duplicate sourceFile "${declared.sourceFile}": emitted by both "${priorEmitter}" and "${declared.family}" - exactly one family may emit per source (issue #813, the sole-emitter invariant)`);
  }
  emittedBy.set(declared.sourceFile, declared.family);
}

function tallyLayers(claims: readonly Claim[]): { raw: number; derived: number } {
  let raw = 0;
  let derived = 0;
  for (const claim of claims) {
    if (claim.layer === 'raw') raw += 1;
    else derived += 1;
  }
  return { raw, derived };
}

// A fresh per-family counter with every covered family present at zero, built
// from the registry so the family set is never a hardcoded literal.
function emptyFamilyTally(): Record<string, number> {
  const tally: Record<string, number> = {};
  for (const family of FAMILIES) tally[family] = 0;
  return tally;
}

// Build the register ledger from the RAW bytes and write it as one JSONL file
// per source into outputDir/ledger/. Claims are serialised and released per
// source (a single register snapshot is ~150k rows / hundreds of thousands of
// claims), so peak memory is one source's ledger, not the whole corpus - the
// same streaming discipline build-sqlite.ts uses for the tiers.
// An optional entry selector, so a caller can build the ledger for a
// tractable representative subset of entries rather than the whole corpus. The
// default (undefined) processes every qualifying source across all families -
// the full-corpus build the CLI runs. A downstream artefact build
// (build-ledger-db) uses this to key off a handful of snapshots without
// re-implementing the emit path; the selector matches an entry's natural key,
// so a subset naming FOI entry keys naturally excludes the open-data lane.
export type EntrySelector = (entry: string) => boolean;

// Whether a source whose load/emit throws aborts the whole build (the default —
// a real-archive integrity failure must fail loud) or is skipped and recorded so
// the build produces a ledger of what it COULD process. Only a downstream
// consumer that must tolerate a partially-malformed archive with the same
// per-entry independence the report lane needs (a report fold running
// over a sweep's working archive) opts in; the real-archive CLI/artefact builds
// keep the fail-loud default.
export function buildLedger(
  outputDir: string,
  foiDir: string = defaultFoiDir(),
  ref: ReferenceData = loadReferenceData(),
  selectEntry?: EntrySelector,
  skipFailedSources = false,
): LedgerBuildSummary {
  const ledgerDir = path.join(outputDir, 'ledger');
  fs.mkdirSync(ledgerDir, { recursive: true });

  const perSource: SourceLedgerSummary[] = [];
  const skipped: SkippedSource[] = [];
  const entriesSeen: Record<string, Set<string>> = {};
  for (const family of FAMILIES) entriesSeen[family] = new Set();

  const roots: LedgerRoots = { foiDir, archiveDir: defaultArchiveDir() };
  // The sole-emitter invariant as an emit-time PRECONDITION (issue #813 Stage
  // D, design §1a): exactly one family emits per sourceFile. The corpus-level
  // test asserts the same invariant after the fact; failing here makes the
  // double-count class impossible to PERSIST at all - a scope-predicate overlap
  // aborts the build naming both emitters, even in a lenient skipFailedSources
  // run (an overlap is a build-integrity failure, not a bad source).
  const emittedBy = new Map<string, string>();
  for (const source of collectLedgerSources(roots)) {
    if (selectEntry !== undefined && !selectEntry(source.entry)) continue;
    let observationSet;
    let claims;
    try {
      observationSet = source.load();
      // The canonical per-source stream: raw + derived (for a callsign subject)
      // plus the file-level manifest, so the persisted ledger is self-sufficient
      // for reconstruction (issue #455).
      claims = emitSourceLedgerClaims(observationSet, source.subjectKind, ref);
    } catch (err) {
      if (!skipFailedSources) throw err;
      skipped.push({ family: source.family, entry: source.entry, error: errorMessage(err) });
      continue;
    }
    registerEmittedSource(emittedBy, { family: source.family, entry: source.entry, sourceFile: source.sourceFile }, observationSet.sourceFile);
    const { raw, derived } = tallyLayers(claims);
    fs.writeFileSync(path.join(ledgerDir, `${source.jsonlStem}.jsonl`), serialiseClaimsJsonl(claims));
    entriesSeen[source.family].add(source.entry);
    perSource.push({
      family: source.family,
      entry: source.entry,
      sourceFile: observationSet.sourceFile,
      vintage: observationSet.vintage,
      observations: observationSet.rows.length,
      rawClaims: raw,
      derivedClaims: derived,
    });
  }

  const entriesByFamily = emptyFamilyTally();
  const sourcesByFamily = emptyFamilyTally();
  for (const family of FAMILIES) entriesByFamily[family] = entriesSeen[family].size;
  for (const s of perSource) sourcesByFamily[s.family] += 1;

  const totalObservations = perSource.reduce((sum, s) => sum + s.observations, 0);
  const totalRawClaims = perSource.reduce((sum, s) => sum + s.rawClaims, 0);
  const totalDerivedClaims = perSource.reduce((sum, s) => sum + s.derivedClaims, 0);
  const entriesProcessed = (Object.values(entriesByFamily) as number[]).reduce((sum, count) => sum + count, 0);
  return {
    outputDir: ledgerDir,
    entriesProcessed,
    sourcesProcessed: perSource.length,
    entriesByFamily,
    sourcesByFamily,
    totalObservations,
    totalRawClaims,
    totalDerivedClaims,
    totalClaims: totalRawClaims + totalDerivedClaims,
    perSource,
    skipped,
  };
}

if (import.meta.main) {
  const args = process.argv.slice(2).filter(a => a.trim().length > 0);
  const outputDir = args[0] ?? path.join('_build', 'v2-ledger');
  const summary = buildLedger(outputDir);
  console.log(`wrote raw-keyed claim ledger to ${summary.outputDir}`);
  console.log(`  entries: ${summary.entriesProcessed}, sources: ${summary.sourcesProcessed}, observations: ${summary.totalObservations}`);
  const byFamily = FAMILIES
    .map(family => `${family} ${summary.entriesByFamily[family]} entries / ${summary.sourcesByFamily[family]} sources`)
    .join(', ');
  console.log(`  by family: ${byFamily}`);
  console.log(`  claims: ${summary.totalClaims} (raw ${summary.totalRawClaims}, derived ${summary.totalDerivedClaims})`);
  for (const s of summary.perSource) {
    console.log(`  [${s.family}] ${s.entry} [${s.vintage}] ${s.observations} obs -> ${s.rawClaims + s.derivedClaims} claims (raw ${s.rawClaims}, derived ${s.derivedClaims})  ${s.sourceFile}`);
  }
}
