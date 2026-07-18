// A filesystem-safe stem, unique per source, for one source's JSONL.
export function jsonlStem(...parts: string[]): string {
  return parts.join('--').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// The dataset class marking an available-pool disclosure. Lives here (not in
// available-pool.ts) so the foi-verbatim-csv mirror can scope itself out of the
// available-pool entries without importing the collector module whose loader
// core it supplies (available-pool.ts imports loadFoiVerbatimCsvSource, so an
// import in the other direction would be a cycle).
export const AVAILABLE_POOL_CLASS = 'available-pool';
