/**
 * The collector contract: each source family is a self-contained module that
 * exports one LedgerCollector, and the registry (index.ts) folds them into the
 * corpus. Adding a family is adding a file plus one registry line, never an edit
 * spread across build-ledger.ts.
 */

import type { SourceObservationSet } from '../claim.ts';

// The location roots every collector may need, threaded once instead of
// per-family default-arg plumbing.
export interface LedgerRoots {
  foiDir: string;
  archiveDir: string;
}

// What kind of subject each row's subjectColumn holds. Governs whether the emit
// path runs callsign normalisation (cleanedCallsign + normalises_to edges) or
// emits raw observations only. Register/addendum families are 'callsign'; a
// forbidden-suffix list is 'suffix'; a statistics aggregate has no per-row
// subject ('aggregate'); an available-pool slot is 'pool-slot'; a 'token' is the
// explicitly raw-only kind for a source whose subject cell is carried purely as
// the published token (the pre-war annex, issue #813 Stage B) - it makes no
// analytical assertion at all, so it acquires no derived tier of any kind.
// Extend the union as bespoke families land - the point is the emit path never
// mis-normalises a non-callsign token AS a callsign.
export type SubjectKind = 'callsign' | 'suffix' | 'pool-slot' | 'aggregate' | 'token';

// One published source resolved to everything buildLedger needs: how to load
// its rows, and a filesystem-safe unique stem for its JSONL. `entry` is the
// family's natural key (an FOI entry key, or an open-data archive-date key) so
// an EntrySelector reads the same across families. `subjectKind` is copied from
// the collector so the emit path can branch per source without re-looking-up
// the collector.
export interface ResolvedLedgerSource {
  family: string;
  subjectKind: SubjectKind;
  entry: string;
  // The corpus-unique logical source key this resolution will emit under
  // (`foi/<entry>/<file>` / `opendata/<key>/<file>`), declared at RESOLUTION
  // time - no data row is parsed to know it (issue #813 Stage D). Structural
  // coverage keys off it (the registry's declared keys ARE the reconstruction
  // corpus, reconstruction-oracle.ts listNotYetCovered), and buildLedger
  // fails loud if a loaded observation set emits under a different key than
  // its resolution declared.
  sourceFile: string;
  jsonlStem: string;
  load(): SourceObservationSet;
}

// One source family: its provenance tag, the kind of subject its rows carry,
// and how to resolve its published sources against the shared roots.
export interface LedgerCollector {
  family: string;
  subjectKind: SubjectKind;
  collect(roots: LedgerRoots): ResolvedLedgerSource[];
}
