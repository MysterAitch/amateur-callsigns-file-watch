// Configuration owned by the Ofcom amateur-callsigns source family. These
// paths, URLs and the source key are specific to this one source, so they
// live with it rather than in shared/ - the same shape the RSGB Special
// Contest Calls module adopted (its own paths/URL/meta locations sit in
// src/sources/rsgb-scc/). Genuinely cross-family layout stays in
// src/shared/constants.ts.

export const FILES = {
  // Staging inbox: scrape-and-download writes the freshly-fetched raw CSV here;
  // process-csv reads from here, produces the archive entry, then updates the
  // latest-* pointers. Kept at a stable path so scrape and process share a handoff.
  originalRawCsvFile: 'amateur-callsigns-raw.csv',

  // Convenience "pointer" copies at repo root - always reflect the newest archive
  // entry. Consumers that just want "the current dataset" read these without
  // walking archive/.
  latestRawCsv: 'latest-raw.csv',
  latestRawSortedCsv: 'latest-raw-sorted.csv',
  latestJson: 'latest.json',
  latestRawSortedJson: 'latest-raw-sorted.json',
  latestMeta: 'latest-meta.json',

  // Per-fetch download context (URL, ?v=, Ofcom-reported date). Written by scrape,
  // read by process to enrich the archive entry's meta.json.
  downloadMetadataFile: 'metadata-download-info.json',

  // Debug: last successfully-fetched HTML page from Ofcom's opendata index.
  htmlOutput: 'ofcom_page.html',
};

export const URLS = {
  OFCOM_URL: 'https://www.ofcom.org.uk/about-ofcom/our-research/opendata',
  OFCOM_BASE_URL: 'https://www.ofcom.org.uk',
};

// Stable key identifying this source in archive metadata. Each source has its
// own key. Do not change without a migration pass over existing
// archive/*/meta.json files.
export const OFCOM_AMATEUR_SOURCE_KEY = 'ofcom-amateur-callsigns';
