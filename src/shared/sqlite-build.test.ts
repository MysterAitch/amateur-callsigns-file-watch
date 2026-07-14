import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { applyBuildPragmas } from './sqlite-build.ts';

// Test names follow the project's Subject_Scenario_Outcome convention.
//
// The build-time PRAGMAs (issue #533) trade durability-during-build for load
// speed. The user-recognisable contract they must NOT trade away: the finished
// artefact is one plain, complete, standalone SQLite file - the range-request
// serving lane and the download twins read the single file and nothing else.

describe('build-time SQLite pragmas', { tags: ['unit'] }, () => {
  it('BuildDatabase_WhenBuiltWithPragmasAndClosed_LeavesOneStandalonePlainSqliteFile', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-build-pragmas-'));
    try {
      const dbPath = path.join(dir, 'built.sqlite');
      const db = new DatabaseSync(dbPath);
      applyBuildPragmas(db);
      db.exec('CREATE TABLE t (k TEXT, v TEXT)');
      db.exec('BEGIN');
      const insert = db.prepare('INSERT INTO t VALUES (?, ?)');
      for (let i = 0; i < 1000; i += 1) insert.run(`k${i}`, `v${i}`);
      db.exec('COMMIT');
      db.exec('CREATE INDEX idx_t_k ON t(k)');
      db.close();

      // Exactly one file: no -journal / -wal / -shm side files left behind.
      expect(fs.readdirSync(dir)).toEqual(['built.sqlite']);
      // A plain SQLite file, complete and openable read-only - the same way
      // the serving lane and the content oracles consume the artefacts. The
      // on-disk format's 16-byte magic is "SQLite format 3" plus a NUL.
      const headerBytes = fs.readFileSync(dbPath).subarray(0, 16);
      expect(headerBytes.subarray(0, 15).toString('utf8')).toBe('SQLite format 3');
      expect(headerBytes[15]).toBe(0);
      const readBack = new DatabaseSync(dbPath, { readOnly: true });
      try {
        const n = Number((readBack.prepare('SELECT COUNT(*) AS c FROM t').get() as { c: number | bigint }).c);
        expect(n).toBe(1000);
        const row = readBack.prepare('SELECT v FROM t WHERE k = ?').get('k123') as { v: string };
        expect(row.v).toBe('v123');
      } finally {
        readBack.close();
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('BuildDatabase_WhenInsertFailsMidBuild_ErrorStillSurfacesLoud', () => {
    // journal_mode = OFF removes crash recoverability, not error reporting: a
    // constraint violation during a build must still throw so the build fails
    // loud and the half-written file is discarded - never shipped.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-build-pragmas-err-'));
    try {
      const db = new DatabaseSync(path.join(dir, 'built.sqlite'));
      applyBuildPragmas(db);
      db.exec('CREATE TABLE u (k TEXT PRIMARY KEY)');
      const insert = db.prepare('INSERT INTO u VALUES (?)');
      insert.run('dup');
      expect(() => insert.run('dup')).toThrow();
      db.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
