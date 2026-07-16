// Stamp each range-served database's REAL current byte size into the site's size
// labels at deploy time (issue #499), so they never drift as the databases grow
// with ingestion (the combined database was labelled "257 MB" long after it passed
// 1 GB). The deploy has already built the databases into _site/data; this stats
// them, humanises the size, and substitutes the `[[db-size:<name>]]` placeholders
// the hand-authored pages carry - failing loudly if a database is missing (the
// labels must be correct, never silently stale). Frameworkless, no dependencies.
import * as fs from 'fs';
import * as path from 'path';

// name -> the built file under _site/data. The lookup/history names are the
// ledger-derived projection databases the interactive surfaces query (issue
// #572); the legacy callsigns/combined runtime databases have been retired
// (issue #445), so only the projection pair is stamped.
export const SIZED_DATABASES: Record<string, string> = {
  lookup: 'ledger-lookup.sqlite.png',
  history: 'ledger-history.sqlite.png',
};

// Match the site's existing phrasing ("28 MB", "257 MB"): whole MB below a GiB,
// two-decimal GB at or above it.
export function humaniseSize(bytes: number): string {
  const mib = bytes / (1024 * 1024);
  return mib >= 1024 ? `${(mib / 1024).toFixed(2)} GB` : `${Math.round(mib)} MB`;
}

// Replace every [[db-size:<name>]] token in `html` with its humanised size.
// Returns the rewritten HTML and how many substitutions were made.
export function stampSizes(html: string, sizes: Record<string, string>): { html: string; count: number } {
  let count = 0;
  let out = html;
  for (const [name, size] of Object.entries(sizes)) {
    const token = `[[db-size:${name}]]`;
    const parts = out.split(token);
    count += parts.length - 1;
    out = parts.join(size);
  }
  return { html: out, count };
}

if (import.meta.main) {
  const siteDir = process.argv[2] ?? '_site';
  const dataDir = path.join(siteDir, 'data');
  const sizes: Record<string, string> = {};
  for (const [name, file] of Object.entries(SIZED_DATABASES)) {
    const full = path.join(dataDir, file);
    if (!fs.existsSync(full)) throw new Error(`build-db-sizes: ${full} not found - the database must be built before this step`);
    sizes[name] = humaniseSize(fs.statSync(full).size);
  }
  let total = 0;
  for (const file of fs.readdirSync(siteDir)) {
    if (!file.endsWith('.html')) continue;
    const full = path.join(siteDir, file);
    const { html, count } = stampSizes(fs.readFileSync(full, 'utf8'), sizes);
    if (count > 0) { fs.writeFileSync(full, html); total += count; }
  }
  console.log(`db sizes stamped (${total} label${total === 1 ? '' : 's'}):`, sizes);
}
