#!/usr/bin/env node

/**
 * One-pass CLI for the issue #726 event-time surfaces built at deploy:
 * folds the corpus's S1 event-date claims once (event-time-projection.ts),
 * then emits
 *   - the per-callsign event-strip shards + meta
 *     (<siteDir>/callsign/data/events/, build-callsign-event-shards.ts), and
 *   - the "on this day" calendar page
 *     (<siteDir>/on-this-day.html, build-on-this-day.ts).
 *
 * Usage: node src/ci/build-event-time-surfaces.ts [site-dir]
 */

import * as path from 'path';
import { foldEventTimeProjection } from './event-time-projection.ts';
import { buildCallsignEventShards } from './build-callsign-event-shards.ts';
import { buildOnThisDay } from './build-on-this-day.ts';
import { time, perfReport } from '../shared/perf.ts';

if (import.meta.main) {
  const args = process.argv.slice(2).filter(a => a.trim().length > 0);
  const siteDir = args[0] ?? '_site';

  const projection = time('event-surfaces:projection', () => foldEventTimeProjection());
  const shards = time('event-surfaces:shards', () =>
    buildCallsignEventShards(projection, path.join(siteDir, 'callsign', 'data', 'events')));
  const onThisDay = time('event-surfaces:on-this-day', () =>
    buildOnThisDay(projection, path.join(siteDir, 'on-this-day.html')));

  console.log(`built event-time surfaces in ${siteDir}`);
  console.log(`  datasets: ${shards.datasets}, subjects: ${shards.subjects}, episodes: ${shards.episodes}, as at ${projection.asAt}`);
  console.log(`  event shards: ${shards.shards}, total ${(shards.totalBytes / 1024 / 1024).toFixed(1)} MB (meta ${(shards.metaBytes / 1024).toFixed(1)} KB)`);
  console.log(`  largest shard: ${shards.largestShard.name}.json - ${(shards.largestShard.bytes / 1024).toFixed(1)} KB, ${shards.largestShard.subjects} callsigns`);
  console.log(`  on-this-day: ${onThisDay.entries} entries across ${onThisDay.days} days -> ${onThisDay.outputPath}`);
  perfReport({ entrypoint: 'build-event-time-surfaces' });
}
