// Genuinely cross-family repository layout. Deliberately slim: the only
// constant every source family shares is where publications are archived.
// Per-source filenames, URLs and source keys belong to that source's own
// module (see src/sources/ofcom-amateur/constants.ts, and the rsgb-scc
// module's own constants), so shared/ code never has to know a specific
// source's paths.
export const DIRS = {
  // Per-publication archive root. Each subdirectory is one publication with
  // raw.csv, raw-sorted.csv, meta.json (and any future derived artefacts).
  // The FOI lane nests its own material under archive/foi/ (ADR 0004).
  archive: 'archive',
};
