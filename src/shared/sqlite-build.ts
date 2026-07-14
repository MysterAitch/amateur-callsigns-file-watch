/**
 * Build-time SQLite tuning shared by the deploy database builders (issue #533).
 *
 * Every database these builders produce is written once in a single process,
 * closed, and then only ever read (range-request serving, gzipped downloads,
 * the content-oracle tests), so the durability machinery SQLite runs by
 * default during the load is pure cost: nothing ever needs to survive a crash
 * mid-build, because a failed build's half-written file is discarded and the
 * build re-run.
 *
 * HARD CONSTRAINT these settings must preserve: the finished artefact must be
 * one plain, complete, standalone SQLite file. The range-request serving lane
 * and the download twins both read the single file, so a mode that leaves
 * side files (WAL) or an un-checkpointed state would corrupt consumers.
 * `journal_mode = OFF` satisfies that by construction - no journal, no WAL,
 * one file - and `DatabaseSync.close()` flushes everything before returning.
 */

import { DatabaseSync } from 'node:sqlite';

// Apply the build-time PRAGMAs to a freshly opened build database. Call once,
// immediately after `new DatabaseSync(...)` and before any DDL/DML.
export function applyBuildPragmas(db: DatabaseSync): void {
  // No rollback journal: the builders always create the file fresh (the
  // previous one is removed first) and a failed build discards the output, so
  // crash recoverability buys nothing. OFF also guarantees no side files -
  // the finished database is a single plain SQLite file.
  db.exec('PRAGMA journal_mode = OFF');
  // No fsync barriers during the load: durability of intermediate state is
  // irrelevant for a discard-on-failure build, and the final close() still
  // writes everything out before the process exits.
  db.exec('PRAGMA synchronous = OFF');
  // A generous page cache (the value is KiB when negative: 256 MiB). The
  // default (~2 MiB) thrashes on the multi-hundred-MB builds' index creation
  // and ANALYZE passes; 256 MiB is native (outside the V8 heap) and well
  // within the build runners' memory alongside the emit's working set.
  db.exec('PRAGMA cache_size = -262144');
  // Temporary b-trees (index sorts, ANALYZE scratch) in memory rather than
  // spilled to temp files on disk.
  db.exec('PRAGMA temp_store = MEMORY');
}
