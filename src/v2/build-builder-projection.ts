#!/usr/bin/env node

/**
 * The builder-facing PROJECTION of the claim ledger (issue #629, phase 1):
 * materialise, per open-data archive entry, the exact derivative files the
 * deploy-time builders and validation read today from the committed archive -
 * normalised.csv (canonical rows), components.csv (per-callsign decomposition
 * + flags) and stats.json (the per-entry statistics aggregate) - as a fold
 * over the claim ledger rather than a read of the committed files.
 *
 * WHY FILES, NOT A DATABASE: the seven consumers (build-dataset-pages,
 * build-callsign-shards, build-home-aggregates, build-data-status,
 * build-interdataset-stats, forbidden-suffix-callsigns, validate-data) all
 * read per-entry archive/<key>/{normalised.csv,components.csv,stats.json}
 * paths and parse them as CSV/JSON. Reproducing those files BYTE-IDENTICALLY
 * makes the later consumer repoint (phase 2) a base-directory change with
 * zero consumer logic touched, and makes the parity obligation the honest
 * maximum: byte equality per entry, provable by hash (the committed files are
 * themselves byte-deterministic - the normalise sweep's no-op re-runs depend
 * on that).
 *
 * HOW THE BYTES ARE REPRODUCED: the rows and components fold from the ledger
 * exactly as the surface projection's fold does (projectPublicationsFromLedger,
 * issue #572); the serialisations are then the SAME functions the converter
 * lane writes with - renderCsv for both CSVs, entryStatsForCanonicalRows +
 * renderStatsJson for stats.json - so there is no second serialiser to drift.
 *
 * WHAT IS NOT PROJECTED (curation, not derivation): meta.json (curated scope,
 * provenance and declarations), raw.* (verbatim publications), the FOI lane's
 * normalised--*.csv (needs the FOI reconstruction tiers; tracked on the
 * #445/#447 chain). Consumers keep reading those from the archive.
 *
 * NOTHING RETIRES HERE: the sweeps still regenerate the committed files, the
 * consumers still read them. This build step exists alongside, gated by the
 * full-corpus parity suite (builder-projection-parity.test.ts), the merge gate
 * for the #446 -> #447 -> #448 retirement chain.
 *
 * Usage:
 *   node src/v2/build-builder-projection.ts [outDir] [--ledger-dir=<dir>]
 *
 * --ledger-dir names a directory whose ledger/ subdirectory already holds the
 * per-source JSONL ledgers (the deploy emits the corpus ONCE and hands the
 * same emit to every projection); when absent or empty, the build emits its
 * own ledger restricted to the open-data register entries it folds.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildLedger, type EntrySelector } from './build-ledger.ts';
import {
  hasEmittedLedger,
  openDataEntrySelector,
  projectPublicationsFromLedger,
  type ProjectedPublication,
} from './build-projection-db.ts';
import { CANONICAL_COLUMNS, entryStatsForCanonicalRows } from '../sources/ofcom-amateur/normalise.ts';
import { COMPONENT_COLUMNS, componentRowToCells, loadReferenceData } from '../sources/ofcom-amateur/components.ts';
import { renderCsv } from '../shared/normalise.ts';
import { renderStatsJson } from '../shared/stats.ts';

// The names the consumers read per entry - identical to the committed archive
// layout, so the phase-2 repoint is a directory change, not a rename map.
export const PROJECTED_ENTRY_FILES = ['normalised.csv', 'components.csv', 'stats.json'] as const;

export interface EntryDerivatives {
  normalisedCsv: string;
  componentsCsv: string;
  statsJson: string;
}

// One folded publication's derivative files, serialised exactly as the
// converter lane serialises the committed ones: renderCsv over the canonical
// header + sorted rows (normalised.csv), renderCsv over the component cells
// (components.csv), and the sorted-key stats rendering (stats.json). Pure -
// the parity suite and the writer below share it.
export function entryDerivativesFor(publication: ProjectedPublication): EntryDerivatives {
  return {
    normalisedCsv: renderCsv([...CANONICAL_COLUMNS], publication.rows),
    componentsCsv: renderCsv([...COMPONENT_COLUMNS], publication.components.map(componentRowToCells)),
    statsJson: renderStatsJson(entryStatsForCanonicalRows(publication.rows, publication.components)),
  };
}

export interface BuildBuilderProjectionOptions {
  // A directory whose ledger/ subdirectory already holds the per-source JSONL
  // ledgers (the deploy's shared emit). When absent or empty, the build emits
  // its own, restricted to the open-data register entries it folds.
  ledgerDir?: string;
  // Restrict the build's OWN emit to a subset of entries (ignored when an
  // already-populated ledgerDir is reused).
  selectEntry?: EntrySelector;
  // The archive root the per-entry curated meta.json (declared header variant,
  // scope facts) is read from. Defaults to the repository archive.
  archiveDir?: string;
}

export interface ProjectedEntrySummary {
  key: string;
  recordCount: number;
  bytes: number;
}

export interface BuildBuilderProjectionResult {
  outDir: string;
  entries: ProjectedEntrySummary[];
  totalBytes: number;
}

// Fold every open-data publication out of the ledger and write its derivative
// files under outDir/<key>/ - the builder-facing twin of the surface
// projection's database build, sharing its reuse-or-emit --ledger-dir
// behaviour so the deploy pays for one corpus emit only.
export function buildBuilderProjection(outDir: string, options: BuildBuilderProjectionOptions = {}): BuildBuilderProjectionResult {
  const ref = loadReferenceData();
  const ownsLedgerRoot = options.ledgerDir === undefined;
  const ledgerRoot = options.ledgerDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'v2-builder-projection-'));
  try {
    if (!hasEmittedLedger(ledgerRoot)) {
      buildLedger(ledgerRoot, undefined, ref, options.selectEntry ?? openDataEntrySelector());
    }
    const publications = options.archiveDir === undefined
      ? projectPublicationsFromLedger(path.join(ledgerRoot, 'ledger'), ref)
      : projectPublicationsFromLedger(path.join(ledgerRoot, 'ledger'), ref, options.archiveDir);

    const entries: ProjectedEntrySummary[] = [];
    for (const publication of publications) {
      const derivatives = entryDerivativesFor(publication);
      const entryDir = path.join(outDir, publication.key);
      fs.mkdirSync(entryDir, { recursive: true });
      fs.writeFileSync(path.join(entryDir, 'normalised.csv'), derivatives.normalisedCsv);
      fs.writeFileSync(path.join(entryDir, 'components.csv'), derivatives.componentsCsv);
      fs.writeFileSync(path.join(entryDir, 'stats.json'), derivatives.statsJson);
      entries.push({
        key: publication.key,
        recordCount: publication.rows.length,
        bytes: Buffer.byteLength(derivatives.normalisedCsv)
          + Buffer.byteLength(derivatives.componentsCsv)
          + Buffer.byteLength(derivatives.statsJson),
      });
    }
    return {
      outDir,
      entries,
      totalBytes: entries.reduce((sum, e) => sum + e.bytes, 0),
    };
  } finally {
    if (ownsLedgerRoot) fs.rmSync(ledgerRoot, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2).filter(a => a.trim().length > 0);
  const positional = args.filter(a => !a.startsWith('--'));
  const ledgerDirFlag = args.find(a => a.startsWith('--ledger-dir='));
  const outDir = positional[0] ?? '_projection';
  const started = Date.now();
  const result = buildBuilderProjection(outDir, {
    ledgerDir: ledgerDirFlag?.slice('--ledger-dir='.length),
  });
  const first = result.entries[0];
  const last = result.entries[result.entries.length - 1];
  console.log(`built builder-facing ledger projection for ${result.entries.length} publications (${first.key} → ${last.key}) in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  for (const entry of result.entries) {
    console.log(`  ${entry.key}: ${entry.recordCount} records, ${entry.bytes} bytes`);
  }
  console.log(`  total ${result.totalBytes} bytes under ${result.outDir}`);
}
