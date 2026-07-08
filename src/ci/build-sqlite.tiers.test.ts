import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as zlib from 'zlib';
import { DatabaseSync } from 'node:sqlite';
import { buildPublishedTiers } from './build-sqlite.ts';
import { OBSERVATION_VALUE_COLUMNS } from '../shared/foi-observations.ts';

// Test names follow Subject_Scenario_Outcome per project convention.
//
// The published data tiers (issue #149 item 4): the gzipped flat union CSV,
// one SQLite per archive entry, and the master database. Built here from
// the real archive exactly as the Pages workflow does. Deliberately a
// separate test file: the build is heavy (hundreds of MB into scratch).

let dataDir: string;
let summary: Record<string, number>;

beforeAll(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-tiers-'));
  summary = buildPublishedTiers(dataDir);
}, 300_000);

afterAll(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('Published data tiers', () => {
  it('Tiers_UnionCsv_GunzipsToFullHeaderAndDeclaredRowCount', { timeout: 120_000 }, () => {
    const csv = zlib.gunzipSync(fs.readFileSync(path.join(dataDir, 'foi-observations.csv.gz'))).toString('utf8');
    const lines = csv.trimEnd().split('\n');
    expect(lines[0]).toBe(['callsign', 'entry', 'source_file', 'dataset_classes', 'vintage', ...OBSERVATION_VALUE_COLUMNS].join(','));
    expect(lines.length - 1).toBe(summary['foi-observations.csv.gz rows']);
  });

  it('Tiers_MasterObservations_KeepNullVsAssertedBlankDistinct', { timeout: 120_000 }, () => {
    const db = new DatabaseSync(path.join(dataDir, 'master.sqlite.png'), { readOnly: true });
    try {
      // The 2019-08 register asserts blank statuses (''); the re-issue
      // events file has no status column at all (NULL). SQL can tell them
      // apart - that is the whole point of the master form.
      const blank = db.prepare("SELECT COUNT(*) AS c FROM observations WHERE entry = 'wdtk-596532--allocated-reserved-forbidden' AND status = ''").get() as { c: number | bigint };
      expect(Number(blank.c)).toBe(6);
      const notAsserted = db.prepare("SELECT COUNT(*) AS c FROM observations WHERE entry = 'ofcom-498903--reissued-callsigns-since-2010' AND status IS NULL").get() as { c: number | bigint };
      expect(Number(notAsserted.c)).toBe(113);
      // register_history spans every open-data publication.
      const publications = db.prepare('SELECT COUNT(DISTINCT dataset) AS c FROM register_history').get() as { c: number | bigint };
      expect(Number(publications.c)).toBeGreaterThanOrEqual(7);
    } finally {
      db.close();
    }
  });

  it('Tiers_PerDatasetDatabases_CarryOneTablePerCsvUnderHonestNames', { timeout: 120_000 }, () => {
    expect(summary['per-dataset databases']).toBeGreaterThanOrEqual(25);
    // Download artefacts wear honest names (.sqlite.gz); only the site's
    // range-queried databases need the .png workaround.
    const gzPath = path.join(dataDir, 'datasets', 'foi--ofcom-498906--reciprocal-licences-since-2010.sqlite.gz');
    const sqlitePath = path.join(dataDir, 'unpacked-test.sqlite');
    fs.writeFileSync(sqlitePath, zlib.gunzipSync(fs.readFileSync(gzPath)));
    const db = new DatabaseSync(sqlitePath, { readOnly: true });
    try {
      const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map(t => t.name);
      expect(tables).toContain('normalised_sheet_1_sheet1');
      expect(tables).toContain('raw_extract_sheet_1_sheet1');
      const rows = db.prepare('SELECT COUNT(*) AS c FROM normalised_sheet_1_sheet1').get() as { c: number | bigint };
      expect(Number(rows.c)).toBe(319);
    } finally {
      db.close();
    }
  });

  it('Tiers_MasterDownloadTwin_GunzipsByteIdenticalToTheRangeRequestVariant', { timeout: 120_000 }, () => {
    const gunzipped = zlib.gunzipSync(fs.readFileSync(path.join(dataDir, 'master.sqlite.gz')));
    const png = fs.readFileSync(path.join(dataDir, 'master.sqlite.png'));
    expect(gunzipped.equals(png)).toBe(true);
  });
});
